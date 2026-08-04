from __future__ import annotations

import re
from uuid import uuid4

import httpx

from paperpilot.domain.models import Paper, ResearchBrief


class PubMedConnector:
    name = "pubmed"
    base_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"

    def __init__(
        self,
        client: httpx.AsyncClient | None = None,
        email: str = "researcher@example.com",
        api_key: str | None = None,
        limit: int = 30,
    ) -> None:
        self.client = client or httpx.AsyncClient(timeout=30)
        self.email = email
        self.api_key = api_key
        self.limit = limit

    async def search(self, brief: ResearchBrief) -> list[Paper]:
        common = {"retmode": "json", "tool": "paperpilot", "email": self.email}
        if self.api_key:
            common["api_key"] = self.api_key
        search = await self.client.get(
            f"{self.base_url}/esearch.fcgi",
            params={**common, "db": "pubmed", "term": self._query(brief), "retmax": self.limit},
        )
        search.raise_for_status()
        ids = search.json().get("esearchresult", {}).get("idlist", [])
        if not ids:
            return []
        summary = await self.client.get(
            f"{self.base_url}/esummary.fcgi",
            params={**common, "db": "pubmed", "id": ",".join(ids)},
        )
        summary.raise_for_status()
        result = summary.json().get("result", {})
        papers: list[Paper] = []
        for pmid in result.get("uids", []):
            record = result.get(pmid, {})
            article_ids = {
                item.get("idtype"): item.get("value") for item in record.get("articleids", [])
            }
            title = str(record.get("title", "Untitled PubMed record")).rstrip(".")
            year_match = re.search(r"\b(19|20)\d{2}\b", str(record.get("pubdate", "")))
            papers.append(
                Paper(
                    id=f"pubmed-{pmid or uuid4().hex[:12]}",
                    title=title,
                    abstract=f"{title}. PubMed metadata record; inspect the linked article for full text.",
                    year=int(year_match.group()) if year_match else None,
                    doi=article_ids.get("doi"),
                    pmid=pmid,
                    pmcid=article_ids.get("pmc"),
                    authors=[item.get("name", "") for item in record.get("authors", []) if item.get("name")],
                    journal=record.get("fulljournalname"),
                    url=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
                    source=self.name,
                )
            )
        return papers

    @staticmethod
    def _query(brief: ResearchBrief) -> str:
        parts = [brief.question.rstrip("?？")]
        parts.extend(brief.keywords)
        if brief.population:
            parts.append(brief.population)
        query = " AND ".join(f"({part})" for part in parts if part.strip())
        if brief.date_from and brief.date_to:
            query += (
                f' AND ("{brief.date_from}/01/01"[Date - Publication] : '
                f'"{brief.date_to}/12/31"[Date - Publication])'
            )
        return query
