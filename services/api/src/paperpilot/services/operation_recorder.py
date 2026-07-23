from __future__ import annotations

from collections.abc import Mapping

from sqlalchemy import func, select

from paperpilot.database import Database, RunOperationEntity, utc_now
from paperpilot.domain.operations import (
    OperationKind,
    OperationStatus,
    OperationUpdate,
    RunOperation,
)


ALLOWED_METRICS = {
    "source_count",
    "candidate_count",
    "retained_count",
    "parsed_count",
    "evidence_count",
    "recommendation_count",
    "citation_count",
    "report_version",
    "duration_ms",
}

OPERATION_TITLES = {
    OperationKind.STRUCTURE_QUESTION: "结构化研究问题",
    OperationKind.SEARCH_SOURCE: "检索文献来源",
    OperationKind.DEDUPLICATE: "归一化标识并去重",
    OperationKind.SCREEN: "筛选相关文献",
    OperationKind.PARSE: "解析文献内容",
    OperationKind.CREATE_EVIDENCE: "创建证据记录",
    OperationKind.SYNTHESIZE: "综合研究证据",
    OperationKind.RECOMMEND: "生成下一步方案",
    OperationKind.CITATION_AUDIT: "执行引用审计",
    OperationKind.SAVE_REPORT: "保存研究报告",
    OperationKind.LOOKUP_EVIDENCE: "定位相关证据",
    OperationKind.GROUNDED_RESPONSE: "生成证据化回复",
    OperationKind.SAVE_RESPONSE: "保存研究回复",
    OperationKind.REVISE_REPORT: "修订研究报告",
    OperationKind.REVISION_VALIDATION: "校验报告修订",
    OperationKind.SAVE_REVISION: "保存报告版本",
}

SAFE_ERRORS = {
    "provider_unavailable": "模型服务暂时不可用，可稍后重试。",
    "invalid_model_response": "模型返回未通过结构化校验。",
    "no_evidence": "未找到可支持当前任务的证据。",
    "run_failed": "研究任务未能完成，可稍后重试。",
}


class OperationRecorder:
    def __init__(self, database: Database) -> None:
        self.database = database

    def bind(
        self,
        run_id: str,
        conversation_message_id: str | None = None,
    ) -> BoundOperationRecorder:
        return BoundOperationRecorder(self, run_id, conversation_message_id)

    def start(
        self,
        run_id: str,
        update: OperationUpdate,
        conversation_message_id: str | None = None,
    ) -> str:
        metrics = self._validated_metrics(update.metrics)
        with self.database.session() as session:
            last_sequence = session.scalar(
                select(func.max(RunOperationEntity.sequence)).where(
                    RunOperationEntity.run_id == run_id
                )
            )
            entity = RunOperationEntity(
                run_id=run_id,
                sequence=(last_sequence or 0) + 1,
                task_kind=update.task_kind.value,
                operation_kind=update.operation_kind.value,
                stage=update.stage.value if update.stage else None,
                title=OPERATION_TITLES[update.operation_kind],
                summary=self._summary(update.operation_kind, OperationStatus.RUNNING, metrics),
                status=OperationStatus.RUNNING.value,
                metrics=metrics,
                conversation_message_id=conversation_message_id,
            )
            session.add(entity)
            session.flush()
            return entity.id

    def complete(
        self,
        operation_id: str,
        metrics: Mapping[str, int] | None = None,
    ) -> None:
        next_metrics = self._validated_metrics(metrics or {})
        with self.database.session() as session:
            entity = session.get(RunOperationEntity, operation_id)
            if not entity:
                raise ValueError("Operation not found")
            self._ensure_running(entity)
            completed_at = utc_now()
            if "duration_ms" not in next_metrics:
                started_at = entity.started_at
                if started_at.tzinfo is None and completed_at.tzinfo is not None:
                    completed_at_for_duration = completed_at.replace(tzinfo=None)
                else:
                    completed_at_for_duration = completed_at
                next_metrics["duration_ms"] = max(
                    0,
                    int((completed_at_for_duration - started_at).total_seconds() * 1000),
                )
            merged = {**dict(entity.metrics or {}), **next_metrics}
            kind = OperationKind(entity.operation_kind)
            entity.metrics = merged
            entity.status = OperationStatus.COMPLETED.value
            entity.summary = self._summary(kind, OperationStatus.COMPLETED, merged)
            entity.completed_at = completed_at

    def fail(self, operation_id: str, error_category: str) -> None:
        with self.database.session() as session:
            entity = session.get(RunOperationEntity, operation_id)
            if not entity:
                raise ValueError("Operation not found")
            self._ensure_running(entity)
            entity.status = OperationStatus.FAILED.value
            entity.summary = SAFE_ERRORS.get(error_category, SAFE_ERRORS["run_failed"])
            entity.completed_at = utc_now()

    @staticmethod
    def _validated_metrics(metrics: Mapping[str, object]) -> dict[str, int]:
        result: dict[str, int] = {}
        for key, value in metrics.items():
            if key not in ALLOWED_METRICS:
                raise ValueError(f"Unsupported operation metric: {key}")
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ValueError(f"Operation metric {key} must be a non-negative integer")
            result[key] = value
        return result

    @staticmethod
    def _ensure_running(entity: RunOperationEntity) -> None:
        if entity.status != OperationStatus.RUNNING.value:
            raise ValueError("Operation is already terminal")

    @staticmethod
    def _summary(
        kind: OperationKind,
        status: OperationStatus,
        metrics: Mapping[str, int],
    ) -> str:
        if status is OperationStatus.RUNNING:
            return {
                OperationKind.SEARCH_SOURCE: "正在检索一个文献来源。",
                OperationKind.LOOKUP_EVIDENCE: "正在当前研究运行中定位相关证据。",
            }.get(kind, f"正在{OPERATION_TITLES[kind]}。")
        if kind is OperationKind.SEARCH_SOURCE:
            return f"已完成文献来源检索，发现 {metrics.get('candidate_count', 0)} 篇候选文献。"
        if kind is OperationKind.DEDUPLICATE:
            return f"已完成标识归一化与去重，保留 {metrics.get('retained_count', 0)} 篇文献。"
        if kind is OperationKind.SCREEN:
            return f"已完成相关性筛选，保留 {metrics.get('retained_count', 0)} 篇文献。"
        if kind is OperationKind.PARSE:
            return f"已解析 {metrics.get('parsed_count', 0)} 篇文献内容。"
        if kind is OperationKind.CREATE_EVIDENCE:
            return f"已创建 {metrics.get('evidence_count', 0)} 条可追溯证据记录。"
        if kind is OperationKind.RECOMMEND:
            return f"已生成 {metrics.get('recommendation_count', 0)} 个可检验的下一步方案。"
        if kind is OperationKind.CITATION_AUDIT:
            return f"已核验 {metrics.get('citation_count', 0)} 个证据引用。"
        if kind in {OperationKind.SAVE_REPORT, OperationKind.SAVE_REVISION}:
            return f"已保存报告版本 {metrics.get('report_version', 1)}。"
        if kind is OperationKind.LOOKUP_EVIDENCE:
            return f"已定位 {metrics.get('evidence_count', 0)} 条当前研究证据。"
        return f"已完成{OPERATION_TITLES[kind]}。"


def operation_payload(entity: RunOperationEntity) -> RunOperation:
    return RunOperation(
        id=entity.id,
        run_id=entity.run_id,
        sequence=entity.sequence,
        task_kind=entity.task_kind,
        operation_kind=entity.operation_kind,
        stage=entity.stage,
        title=entity.title,
        summary=entity.summary,
        status=entity.status,
        metrics=dict(entity.metrics or {}),
        conversation_message_id=entity.conversation_message_id,
        started_at=entity.started_at,
        completed_at=entity.completed_at,
    )


class BoundOperationRecorder:
    def __init__(
        self,
        recorder: OperationRecorder,
        run_id: str,
        conversation_message_id: str | None,
    ) -> None:
        self.recorder = recorder
        self.run_id = run_id
        self.conversation_message_id = conversation_message_id

    def start(self, update: OperationUpdate) -> str:
        return self.recorder.start(
            self.run_id,
            update,
            conversation_message_id=self.conversation_message_id,
        )

    def complete(
        self,
        operation_id: str,
        metrics: Mapping[str, int] | None = None,
    ) -> None:
        self.recorder.complete(operation_id, metrics)

    def fail(self, operation_id: str, error_category: str) -> None:
        self.recorder.fail(operation_id, error_category)
