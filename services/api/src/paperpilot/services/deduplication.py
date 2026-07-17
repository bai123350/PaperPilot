from __future__ import annotations

import re

from paperpilot.domain.models import Paper


def _title_key(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", title.lower())


def _merge(primary: Paper, candidate: Paper) -> Paper:
    values = primary.model_dump()
    if len(candidate.abstract) > len(primary.abstract):
        values["abstract"] = candidate.abstract
    for field in ("doi", "pmid", "pmcid", "journal", "url", "year"):
        if not values.get(field) and getattr(candidate, field):
            values[field] = getattr(candidate, field)
    if len(candidate.authors) > len(primary.authors):
        values["authors"] = candidate.authors
    return Paper.model_validate(values)


def deduplicate_papers(papers: list[Paper]) -> list[Paper]:
    unique: list[Paper] = []
    positions: dict[str, int] = {}
    for paper in papers:
        if paper.doi:
            key = f"doi:{paper.doi}"
        elif paper.pmid:
            key = f"pmid:{paper.pmid}"
        else:
            key = f"title:{_title_key(paper.title)}"

        position = positions.get(key)
        if position is None:
            positions[key] = len(unique)
            unique.append(paper)
        else:
            unique[position] = _merge(unique[position], paper)
    return unique
