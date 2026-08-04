from __future__ import annotations

from typing import Annotated, Protocol

from pydantic import BaseModel, Field, ValidationError

from paperpilot.domain.models import Claim, EvidenceRecord, Paper, Recommendation, ResearchBrief
from paperpilot.models.deepseek import ModelResponseError


class JsonModel(Protocol):
    async def complete_json(self, system_prompt: str, payload: dict) -> dict: ...


class SynthesisPayload(BaseModel):
    summary: Annotated[str, Field(min_length=20, max_length=6000)]
    themes: list[str]
    claims: Annotated[list[Claim], Field(min_length=1)]
    controversies: list[str]
    gaps: Annotated[list[str], Field(min_length=1)]
    recommendations: Annotated[list[Recommendation], Field(min_length=3, max_length=3)]


class SearchQueryPayload(BaseModel):
    query: Annotated[str, Field(min_length=1, max_length=500)]


class LlmReportSynthesizer:
    def __init__(self, model: JsonModel) -> None:
        self.model = model

    async def build_search_query(self, brief: ResearchBrief) -> str:
        request_payload = {
            "research_brief": brief.model_dump(mode="json", exclude_none=True),
            "effective_publication_range": {
                "from": brief.date_from or 2010,
                "to": brief.date_to,
            },
            "output_schema": SearchQueryPayload.model_json_schema(),
        }
        candidate = await self.model.complete_json(self._search_prompt(), request_payload)
        query = self._parse_search_query(candidate)
        if query is not None:
            return query

        repaired = await self.model.complete_json(
            self._search_correction_prompt(),
            {
                "candidate": candidate,
                "research_question": brief.question,
                "user_keywords": brief.keywords,
                "output_schema": SearchQueryPayload.model_json_schema(),
            },
        )
        return self._parse_search_query(repaired) or self._fallback_search_query(brief)

    async def synthesize(
        self,
        brief: ResearchBrief,
        papers: list[Paper],
        evidence: list[EvidenceRecord],
    ) -> dict:
        selected_evidence = evidence[:60]
        selected_paper_ids = {item.paper_id for item in selected_evidence}
        request_payload = {
            "research_brief": brief.model_dump(mode="json", exclude_none=True),
            "papers": [
                {"id": paper.id, "title": paper.title, "year": paper.year}
                for paper in papers
                if paper.id in selected_paper_ids
            ],
            "evidence": [
                {
                    "id": item.id,
                    "paper_id": item.paper_id,
                    "excerpt": item.excerpt[:1200],
                    "locator": item.locator,
                    "evidence_type": item.evidence_type,
                }
                for item in selected_evidence
            ],
            "output_schema": SynthesisPayload.model_json_schema(),
        }
        payload = await self.model.complete_json(self._system_prompt(), request_payload)
        try:
            synthesis = SynthesisPayload.model_validate(payload)
        except ValidationError as first_error:
            correction_payload = {
                **request_payload,
                "validation_errors": [
                    {"location": list(error["loc"]), "type": error["type"]}
                    for error in first_error.errors(include_url=False, include_input=False)
                ],
            }
            corrected = await self.model.complete_json(
                self._correction_prompt(), correction_payload
            )
            try:
                synthesis = SynthesisPayload.model_validate(corrected)
            except ValidationError:
                raise ModelResponseError("DeepSeek returned an invalid synthesis payload") from None

        allowed = {item.id for item in evidence}
        cited = {
            evidence_id
            for section in (synthesis.claims, synthesis.recommendations)
            for item in section
            for evidence_id in item.evidence_ids
        }
        unknown = cited - allowed
        if unknown:
            raise ModelResponseError("DeepSeek cited evidence outside the current research run")
        return synthesis.model_dump(mode="json")

    async def aclose(self) -> None:
        close = getattr(self.model, "aclose", None)
        if close is not None:
            await close()

    @staticmethod
    def _system_prompt() -> str:
        return (
            "你是 PaperPilot 生物医学研究综合器。只能依据提供的 Evidence Record 生成报告，"
            "不得使用模型记忆补充未提供的研究结果。summary、themes、claims、controversies、gaps "
            "以及 recommendations 中的所有叙述性字段必须使用简洁、专业的简体中文。DOI、PMID、"
            "evidence ID、基因和蛋白符号、通用生物医学缩写及必要的来源标题保持原样。只返回严格符合 "
            "output_schema 的 JSON。每个主要结论和建议必须引用一个或多个已提供的 evidence_ids，"
            "不得虚构或修改 evidence ID。recommendations 必须恰好三项，每项必须包含 title、rationale、"
            "hypothesis、minimal_validation、resources、risks、stop_condition 和 evidence_ids。"
            "所有字段需满足 schema 长度限制。不得提供诊断、用药或治疗建议。"
        )

    @staticmethod
    def _correction_prompt() -> str:
        return (
            "重新生成完整的生物医学研究报告，只返回 JSON，不要解释或使用 Markdown。先前输出未通过 "
            "validation_errors 所列的结构校验；新输出必须严格符合 output_schema，并包含恰好三个建议。"
            "所有叙述性字段必须使用简体中文，只能引用 evidence 列表中已有的 evidence ID。DOI、PMID、"
            "基因和蛋白符号及通用生物医学缩写保持原样。"
        )

    @staticmethod
    def _search_prompt() -> str:
        return (
            "You are a biomedical literature search expert. Convert the research brief into one concise "
            "English Boolean query that works across Europe PMC, PubMed, OpenAlex, and Crossref. Use core "
            "concepts with AND/OR. Do not use database-specific field or date syntax because connectors "
            "apply dates separately. Use only concepts from the question, PICO, or user keywords and do "
            "not broaden them. Return JSON only with exactly one query field; do not answer the question."
        )

    @staticmethod
    def _search_correction_prompt() -> str:
        return (
            "Repair candidate into one cross-database English Boolean literature query without adding new "
            "concepts. Return JSON only in the exact form {\"query\":\"(concept OR synonym) AND "
            "(concept)\"}. The query must be a single line."
        )

    @staticmethod
    def _parse_search_query(payload: dict) -> str | None:
        try:
            query = SearchQueryPayload.model_validate(payload).query
        except ValidationError:
            return None
        normalized = " ".join(query.strip().strip("`").split())
        return normalized if normalized and len(normalized) <= 500 else None

    @staticmethod
    def _fallback_search_query(brief: ResearchBrief) -> str:
        terms = [*brief.keywords]
        terms.extend(
            value
            for value in (brief.population, brief.intervention)
            if value and value.strip()
        )
        if not terms:
            return brief.question.strip()
        return " AND ".join(f'\"{term.strip().replace(chr(34), "")}\"' for term in terms)
