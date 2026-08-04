from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Protocol
from datetime import datetime, timezone

import httpx

from paperpilot.domain.models import (
    Claim,
    EvidenceRecord,
    Paper,
    PublicDataset,
    Recommendation,
    Report,
    ResearchBrief,
    RunStage,
    TimelineItem,
)
from paperpilot.domain.operations import OperationKind, OperationTaskKind, OperationUpdate
from paperpilot.services.deduplication import deduplicate_papers


logger = logging.getLogger(__name__)


class LiteratureConnector(Protocol):
    name: str

    async def search(self, brief: ResearchBrief) -> list[Paper]: ...


class DatasetConnector(Protocol):
    name: str

    async def search(self, brief: ResearchBrief) -> list[PublicDataset]: ...


StageCallback = Callable[[RunStage], None]


class OperationSink(Protocol):
    def start(self, update: OperationUpdate) -> str: ...

    def complete(self, operation_id: str, metrics: dict[str, int] | None = None) -> None: ...

    def fail(self, operation_id: str, error_category: str) -> None: ...


class NullOperationSink:
    def start(self, update: OperationUpdate) -> str:
        return ""

    def complete(self, operation_id: str, metrics: dict[str, int] | None = None) -> None:
        return None

    def fail(self, operation_id: str, error_category: str) -> None:
        return None


class ReportSynthesizer(Protocol):
    async def synthesize(
        self,
        brief: ResearchBrief,
        papers: list[Paper],
        evidence: list[EvidenceRecord],
    ) -> dict: ...


class ResearchPlanner(Protocol):
    async def build_search_query(self, brief: ResearchBrief) -> str: ...


class ResearchPipeline:
    def __init__(
        self,
        connectors: list[LiteratureConnector],
        dataset_connectors: list[DatasetConnector] | None = None,
        synthesizer: ReportSynthesizer | None = None,
        planner: ResearchPlanner | None = None,
    ) -> None:
        self.connectors = connectors
        self.dataset_connectors = dataset_connectors or []
        self.synthesizer = synthesizer
        self.planner = planner

    async def run(
        self,
        brief: ResearchBrief,
        on_stage: StageCallback,
        on_operation: OperationSink | None = None,
    ) -> Report:
        operations = on_operation or NullOperationSink()
        papers: list[Paper] = []
        related_datasets: list[PublicDataset] = []
        evidence: list[EvidenceRecord] = []

        on_stage(RunStage.PLANNING)
        operation_id = operations.start(
            OperationUpdate(
                task_kind=OperationTaskKind.RESEARCH_RUN,
                operation_kind=OperationKind.STRUCTURE_QUESTION,
                stage=RunStage.PLANNING,
            )
        )
        search_brief = brief
        if self.planner:
            try:
                query = await self.planner.build_search_query(brief)
            except Exception:
                operations.fail(operation_id, "provider_unavailable")
                raise
            current_year = datetime.now(timezone.utc).year
            search_brief = brief.model_copy(
                update={
                    "question": query,
                    "date_from": brief.date_from or 2010,
                    "date_to": brief.date_to or current_year,
                }
            )
        operations.complete(operation_id)

        on_stage(RunStage.SEARCHING)
        operation_id = operations.start(
            OperationUpdate(
                task_kind=OperationTaskKind.RESEARCH_RUN,
                operation_kind=OperationKind.SEARCH_SOURCE,
                stage=RunStage.SEARCHING,
                metrics={"source_count": len(self.connectors)},
            )
        )
        successful_sources = 0
        failed_sources = 0
        literature_brief = search_brief.model_copy(
            update={"keywords": [], "population": None, "intervention": None}
        )
        for connector in self.connectors:
            try:
                found = await connector.search(literature_brief)
                papers.extend(found)
                successful_sources += 1
            except httpx.HTTPError as exc:
                failed_sources += 1
                logger.warning(
                    "Literature connector unavailable",
                    extra={
                        "connector": connector.name,
                        "error_type": type(exc).__name__,
                    },
                )
        if self.connectors and successful_sources == 0:
            operations.fail(operation_id, "literature_sources_unavailable")
            raise ValueError("All literature sources were unavailable")
        operations.complete(
            operation_id,
            {
                "candidate_count": len(papers),
                "succeeded_source_count": successful_sources,
                "failed_source_count": failed_sources,
            },
        )

        dataset_operation_id = None
        if self.dataset_connectors:
            dataset_operation_id = operations.start(
                OperationUpdate(
                    task_kind=OperationTaskKind.RESEARCH_RUN,
                    operation_kind=OperationKind.SEARCH_DATASET_SOURCE,
                    stage=RunStage.SEARCHING,
                    metrics={"dataset_source_count": len(self.dataset_connectors)},
                )
            )
        successful_dataset_sources = 0
        failed_dataset_sources = 0
        for connector in self.dataset_connectors:
            try:
                found_datasets = await connector.search(search_brief)
                related_datasets.extend(found_datasets)
                successful_dataset_sources += 1
            except (httpx.HTTPError, ValueError) as exc:
                failed_dataset_sources += 1
                logger.warning(
                    "Dataset connector unavailable",
                    extra={
                        "connector": connector.name,
                        "error_type": type(exc).__name__,
                    },
                )
        if dataset_operation_id:
            operations.complete(
                dataset_operation_id,
                {
                    "dataset_count": len(related_datasets),
                    "succeeded_source_count": successful_dataset_sources,
                    "failed_source_count": failed_dataset_sources,
                },
            )

        related_datasets = self._deduplicate_datasets(related_datasets)[:30]

        on_stage(RunStage.DEDUPLICATING)
        operation_id = operations.start(
            OperationUpdate(
                task_kind=OperationTaskKind.RESEARCH_RUN,
                operation_kind=OperationKind.DEDUPLICATE,
                stage=RunStage.DEDUPLICATING,
                metrics={"candidate_count": len(papers)},
            )
        )
        papers = deduplicate_papers(papers)
        operations.complete(operation_id, {"retained_count": len(papers)})

        on_stage(RunStage.SCREENING)
        operation_id = operations.start(
            OperationUpdate(
                task_kind=OperationTaskKind.RESEARCH_RUN,
                operation_kind=OperationKind.SCREEN,
                stage=RunStage.SCREENING,
                metrics={"candidate_count": len(papers)},
            )
        )
        papers = [paper for paper in papers if paper.abstract.strip()][:100]
        operations.complete(operation_id, {"retained_count": len(papers)})

        on_stage(RunStage.PARSING)
        operation_id = operations.start(
            OperationUpdate(
                task_kind=OperationTaskKind.RESEARCH_RUN,
                operation_kind=OperationKind.PARSE,
                stage=RunStage.PARSING,
            )
        )
        operations.complete(operation_id, {"parsed_count": len(papers)})

        on_stage(RunStage.EXTRACTING)
        operation_id = operations.start(
            OperationUpdate(
                task_kind=OperationTaskKind.RESEARCH_RUN,
                operation_kind=OperationKind.CREATE_EVIDENCE,
                stage=RunStage.EXTRACTING,
            )
        )
        for paper in papers:
            evidence.append(
                EvidenceRecord(
                    paper_id=paper.id,
                    excerpt=paper.abstract[:1800],
                    locator="Abstract",
                    evidence_type="study_finding",
                    confidence=0.78,
                    doi=paper.doi,
                    pmid=paper.pmid,
                )
            )

        if not evidence:
            operations.fail(operation_id, "no_evidence")
            raise ValueError("No evidence-bearing papers were found for this research brief")
        operations.complete(operation_id, {"evidence_count": len(evidence)})

        on_stage(RunStage.SYNTHESIZING)
        synthesis_operation_id = operations.start(
            OperationUpdate(
                task_kind=OperationTaskKind.RESEARCH_RUN,
                operation_kind=OperationKind.SYNTHESIZE,
                stage=RunStage.SYNTHESIZING,
            )
        )
        if self.synthesizer:
            try:
                synthesis = await self.synthesizer.synthesize(brief, papers, evidence)
            except Exception:
                operations.fail(synthesis_operation_id, "provider_unavailable")
                raise
            claims = [Claim.model_validate(item) for item in synthesis["claims"]]
            summary = synthesis["summary"]
            themes = synthesis["themes"]
            controversies = synthesis["controversies"]
            gaps = synthesis["gaps"]
            operations.complete(synthesis_operation_id)
            on_stage(RunStage.RECOMMENDING)
            recommendation_operation_id = operations.start(
                OperationUpdate(
                    task_kind=OperationTaskKind.RESEARCH_RUN,
                    operation_kind=OperationKind.RECOMMEND,
                    stage=RunStage.RECOMMENDING,
                )
            )
            recommendations = [
                Recommendation.model_validate(item) for item in synthesis["recommendations"]
            ]
        else:
            claims = [
                Claim(
                    statement=(
                        "现有研究提示该主题具有可测量的临床或生物学关联，"
                        "但外部验证与跨队列一致性仍需加强。"
                    ),
                    evidence_ids=[item.id for item in evidence],
                    confidence=0.78,
                )
            ]
            summary = (
                f"本报告综合了 {len(papers)} 篇可追溯文献。当前证据显示研究方向具有潜力，"
                "但需要前瞻性、外部验证和方法标准化。"
            )
            themes = ["临床效能", "外部验证", "方法标准化"]
            controversies = ["研究人群、终点定义和分析流程存在异质性。"]
            gaps = ["缺少独立外部验证。", "缺少统一、可复现的检测与分析协议。"]
            operations.complete(synthesis_operation_id)
            on_stage(RunStage.RECOMMENDING)
            recommendation_operation_id = operations.start(
                OperationUpdate(
                    task_kind=OperationTaskKind.RESEARCH_RUN,
                    operation_kind=OperationKind.RECOMMEND,
                    stage=RunStage.RECOMMENDING,
                )
            )
            recommendations = self._recommendations(evidence)
        operations.complete(
            recommendation_operation_id,
            {"recommendation_count": len(recommendations)},
        )

        on_stage(RunStage.AUDITING)
        audit_operation_id = operations.start(
            OperationUpdate(
                task_kind=OperationTaskKind.RESEARCH_RUN,
                operation_kind=OperationKind.CITATION_AUDIT,
                stage=RunStage.AUDITING,
            )
        )
        citation_count = sum(len(item.evidence_ids) for item in [*claims, *recommendations])
        operations.complete(audit_operation_id, {"citation_count": citation_count})
        return Report(
            title=brief.question.rstrip("?？"),
            summary=summary,
            themes=themes,
            timeline=[
                TimelineItem(
                    year=paper.year,
                    title=paper.title,
                    description=paper.abstract[:220],
                    paper_ids=[paper.id],
                )
                for paper in papers
                if paper.year is not None
            ],
            claims=claims,
            evidence=evidence,
            related_datasets=related_datasets,
            controversies=controversies,
            gaps=gaps,
            recommendations=recommendations,
            papers=papers,
        )

    @staticmethod
    def _deduplicate_datasets(datasets: list[PublicDataset]) -> list[PublicDataset]:
        unique: list[PublicDataset] = []
        seen: set[tuple[str, str]] = set()
        for dataset in datasets:
            key = (dataset.source.casefold(), dataset.accession.casefold())
            if key in seen:
                continue
            seen.add(key)
            unique.append(dataset)
        return unique

    @staticmethod
    def _recommendations(evidence: list[EvidenceRecord]) -> list[Recommendation]:
        evidence_ids = [item.id for item in evidence]
        common = {
            "rationale": "当前证据支持进一步验证，但仍存在队列异质性和复现不足。",
            "resources": ["独立生物样本队列", "预注册统计分析方案"],
            "risks": ["选择偏倚", "样本量不足", "检测批次效应"],
            "evidence_ids": evidence_ids,
        }
        return [
            Recommendation(
                title="开展独立前瞻性验证",
                hypothesis="候选指标在独立前瞻性队列中仍能稳定预测目标结局。",
                minimal_validation="在盲法评估的前瞻性队列中验证预先锁定的主要终点。",
                stop_condition="若主要效应方向相反或区分度低于 0.65，则停止扩大队列。",
                **common,
            ),
            Recommendation(
                title="完成跨中心外部复现",
                hypothesis="该关联能够跨中心、设备与人群保持方向一致。",
                minimal_validation="使用至少两个独立中心的数据执行完全冻结的外部验证。",
                stop_condition="若中心间异质性无法由预设协变量解释，则停止推广。",
                **common,
            ),
            Recommendation(
                title="建立检测与分析标准",
                hypothesis="标准化前处理和分析流程可降低批次差异并提高可重复性。",
                minimal_validation="对同一样本执行重复检测并比较标准化前后的变异系数。",
                stop_condition="若标准化后重复性未改善至少 20%，则停止该流程方案。",
                **common,
            ),
        ]
