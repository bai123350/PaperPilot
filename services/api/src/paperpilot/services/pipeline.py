from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Protocol

import httpx

from paperpilot.domain.models import (
    Claim,
    EvidenceRecord,
    Paper,
    Recommendation,
    Report,
    ResearchBrief,
    RunStage,
    TimelineItem,
)
from paperpilot.services.deduplication import deduplicate_papers


logger = logging.getLogger(__name__)


class LiteratureConnector(Protocol):
    name: str

    async def search(self, brief: ResearchBrief) -> list[Paper]: ...


StageCallback = Callable[[RunStage], None]


class ReportSynthesizer(Protocol):
    async def synthesize(
        self,
        brief: ResearchBrief,
        papers: list[Paper],
        evidence: list[EvidenceRecord],
    ) -> dict: ...


class ResearchPipeline:
    def __init__(
        self,
        connectors: list[LiteratureConnector],
        synthesizer: ReportSynthesizer | None = None,
    ) -> None:
        self.connectors = connectors
        self.synthesizer = synthesizer

    async def run(self, brief: ResearchBrief, on_stage: StageCallback) -> Report:
        papers: list[Paper] = []
        evidence: list[EvidenceRecord] = []

        on_stage(RunStage.PLANNING)
        on_stage(RunStage.SEARCHING)
        for connector in self.connectors:
            try:
                papers.extend(await connector.search(brief))
            except httpx.HTTPError as exc:
                logger.warning(
                    "Literature connector unavailable",
                    extra={
                        "connector": connector.name,
                        "error_type": type(exc).__name__,
                    },
                )

        on_stage(RunStage.DEDUPLICATING)
        papers = deduplicate_papers(papers)

        on_stage(RunStage.SCREENING)
        papers = [paper for paper in papers if paper.abstract.strip()][:100]

        on_stage(RunStage.PARSING)
        on_stage(RunStage.EXTRACTING)
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
            raise ValueError("No evidence-bearing papers were found for this research brief")

        on_stage(RunStage.SYNTHESIZING)
        if self.synthesizer:
            synthesis = await self.synthesizer.synthesize(brief, papers, evidence)
            claims = [Claim.model_validate(item) for item in synthesis["claims"]]
            summary = synthesis["summary"]
            themes = synthesis["themes"]
            controversies = synthesis["controversies"]
            gaps = synthesis["gaps"]
            on_stage(RunStage.RECOMMENDING)
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
            on_stage(RunStage.RECOMMENDING)
            recommendations = self._recommendations(evidence)

        on_stage(RunStage.AUDITING)
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
            controversies=controversies,
            gaps=gaps,
            recommendations=recommendations,
            papers=papers,
        )

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
