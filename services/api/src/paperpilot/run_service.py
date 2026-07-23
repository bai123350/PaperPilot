from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from sqlalchemy import delete, select

from paperpilot.config import Settings
from paperpilot.connectors.demo import DemoConnector
from paperpilot.connectors.europe_pmc import EuropePmcConnector
from paperpilot.connectors.crossref import CrossrefConnector
from paperpilot.connectors.openalex import OpenAlexConnector
from paperpilot.connectors.pubmed import PubMedConnector
from paperpilot.connectors.private_materials import PrivateMaterial, PrivateMaterialConnector
from paperpilot.database import Database, EvidenceEntity, RunEntity, UploadEntity
from paperpilot.domain.models import ResearchBrief, RunStage, RunStatus
from paperpilot.domain.operations import OperationKind, OperationTaskKind, OperationUpdate
from paperpilot.services.pipeline import ResearchPipeline
from paperpilot.services.operation_recorder import OperationRecorder
from paperpilot.services.llm_synthesis import LlmReportSynthesizer
from paperpilot.models.deepseek import DeepSeekModel, ModelProviderError
from paperpilot.parsing.grobid import GrobidPdfParser
from paperpilot.parsing.pymupdf import PyMuPdfParser
from paperpilot.storage.factory import create_object_store


class RunService:
    def __init__(self, database: Database, settings: Settings) -> None:
        self.database = database
        self.settings = settings

    def execute(self, run_id: str) -> None:
        with self.database.session() as session:
            run = session.get(RunEntity, run_id)
            if not run or run.status == RunStatus.CANCELLED.value:
                return
            run.status = RunStatus.RUNNING.value
            brief = ResearchBrief.model_validate(run.brief)

        pipeline = ResearchPipeline(
            connectors=self._connectors(run.project_id),
            synthesizer=self._synthesizer(),
        )
        operation_recorder = OperationRecorder(self.database)

        def on_stage(stage: RunStage) -> None:
            with self.database.session() as stage_session:
                stage_run = stage_session.get(RunEntity, run_id)
                if not stage_run:
                    return
                stage_run.stage = stage.value
                events = list(stage_run.events or [])
                events.append({"stage": stage.value, "at": datetime.now(timezone.utc).isoformat()})
                stage_run.events = events

        async def run_pipeline():
            try:
                return await pipeline.run(
                    brief,
                    on_stage=on_stage,
                    on_operation=operation_recorder.bind(run_id),
                )
            finally:
                if pipeline.synthesizer:
                    await pipeline.synthesizer.aclose()

        try:
            report = asyncio.run(run_pipeline())
            with self.database.session() as session:
                run = session.get(RunEntity, run_id)
                if not run:
                    return
                run.report = report.model_dump(mode="json")
                run.status = RunStatus.COMPLETED.value
                run.completed_at = datetime.now(timezone.utc)
                session.execute(delete(EvidenceEntity).where(EvidenceEntity.run_id == run_id))
                session.add_all(
                    [
                        EvidenceEntity(id=item.id, run_id=run_id, payload=item.model_dump(mode="json"))
                        for item in report.evidence
                    ]
                )
            save_operation_id = operation_recorder.start(
                run_id,
                OperationUpdate(
                    task_kind=OperationTaskKind.RESEARCH_RUN,
                    operation_kind=OperationKind.SAVE_REPORT,
                    stage=RunStage.AUDITING,
                ),
            )
            operation_recorder.complete(
                save_operation_id,
                {"report_version": 1},
            )
        except Exception as exc:
            with self.database.session() as session:
                run = session.get(RunEntity, run_id)
                if run:
                    run.status = RunStatus.FAILED.value
                    run.error = self._safe_error(exc)
            raise

    def _connectors(self, project_id: str) -> list:
        connectors: list = []
        if self.settings.demo_mode:
            connectors.append(DemoConnector())
        else:
            connectors.extend(
                [
                    PubMedConnector(email=self.settings.ncbi_email, api_key=self.settings.ncbi_api_key),
                    EuropePmcConnector(),
                    CrossrefConnector(),
                    OpenAlexConnector(),
                ]
            )
        with self.database.session() as session:
            uploads = list(
                session.scalars(select(UploadEntity).where(UploadEntity.project_id == project_id))
            )
        if uploads:
            connectors.append(
                PrivateMaterialConnector(
                    store=create_object_store(self.settings),
                    parser=GrobidPdfParser(
                        self.settings.grobid_url,
                        fallback=PyMuPdfParser(),
                    ),
                    materials=[
                        PrivateMaterial(id=item.id, key=item.object_key, filename=item.filename)
                        for item in uploads
                    ],
                )
            )
        return connectors

    def _synthesizer(self):
        if self.settings.demo_mode:
            return None
        model = DeepSeekModel(
            base_url=self.settings.deepseek_base_url,
            api_key=self.settings.deepseek_api_key or "",
            model=self.settings.deepseek_model,
        )
        return LlmReportSynthesizer(model)

    @staticmethod
    def _safe_error(exc: Exception) -> str:
        if isinstance(exc, ModelProviderError):
            return str(exc)
        return "Research run failed"
