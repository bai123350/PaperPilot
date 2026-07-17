from paperpilot.domain.models import Report


def render_markdown(report: Report) -> str:
    lines = [
        f"# {report.title}",
        "",
        report.summary,
        "",
        "## 主要结论",
        "",
    ]
    for claim in report.claims:
        citations = " ".join(f"[^{evidence_id}]" for evidence_id in claim.evidence_ids)
        lines.append(f"- {claim.statement} {citations}")

    lines.extend(["", "## 证据空白", ""])
    lines.extend(f"- {gap}" for gap in report.gaps)
    lines.extend(["", "## 下一步研究方案", ""])
    for index, recommendation in enumerate(report.recommendations, start=1):
        citations = " ".join(f"[^{item}]" for item in recommendation.evidence_ids)
        lines.extend(
            [
                f"### {index}. {recommendation.title}",
                "",
                f"- **依据：** {recommendation.rationale} {citations}",
                f"- **可检验假设：** {recommendation.hypothesis}",
                f"- **最小验证：** {recommendation.minimal_validation}",
                f"- **所需资源：** {'、'.join(recommendation.resources)}",
                f"- **主要风险：** {'、'.join(recommendation.risks)}",
                f"- **停止条件：** {recommendation.stop_condition}",
                "",
            ]
        )

    lines.extend(["## Evidence Records", ""])
    paper_titles = {paper.id: paper.title for paper in report.papers}
    for evidence in report.evidence:
        identifiers = [
            value
            for value in (
                f"PMID: {evidence.pmid}" if evidence.pmid else None,
                f"DOI: {evidence.doi}" if evidence.doi else None,
            )
            if value
        ]
        lines.append(
            f"[^{evidence.id}]: **{paper_titles.get(evidence.paper_id, evidence.paper_id)}** "
            f"({evidence.locator}; {'; '.join(identifiers) or 'metadata unavailable'}). "
            f"\"{evidence.excerpt}\""
        )

    lines.extend(["", "---", "", report.disclaimer, ""])
    return "\n".join(lines)
