from paperpilot.domain.models import DatasetModality, Report


DATASET_MODALITY_LABELS = {
    DatasetModality.BULK_RNA: "Bulk RNA",
    DatasetModality.SINGLE_CELL: "单细胞",
    DatasetModality.SPATIAL: "空间转录组",
    DatasetModality.ATAC_SEQ: "ATAC-seq",
    DatasetModality.GENOMICS: "基因组",
}


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

    lines.extend(["", "## 相关公共数据集", ""])
    if report.related_datasets:
        for dataset in report.related_datasets:
            metadata = [
                dataset.source,
                DATASET_MODALITY_LABELS[dataset.modality],
                dataset.organism,
                f"{dataset.sample_count} 个样本" if dataset.sample_count is not None else None,
            ]
            lines.append(
                f"- [{dataset.accession} · {dataset.title}]({dataset.url}) — "
                f"{' · '.join(item for item in metadata if item)}"
            )
    else:
        lines.append("- 本次检索未发现可追溯的公共数据集。")

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
