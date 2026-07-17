from __future__ import annotations

import httpx

from paperpilot.domain.models import Paper, ResearchBrief


class EuropePmcConnector:
    name = "europe_pmc"
    endpoint = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"

    def __init__(self, client: httpx.AsyncClient | None = None, limit: int = 30) -> None:
        self.client = client or httpx.AsyncClient(timeout=30)
        self.limit = limit

    async def search(self, brief: ResearchBrief) -> list[Paper]:
        response = await self.client.get(
            self.endpoint,
            params={
                "query": brief.question,
                "format": "json",
                "pageSize": self.limit,
                "resultType": "core",
            },
        )
        response.raise_for_status()
        records = response.json().get("resultList", {}).get("result", [])
        return [self._paper(record) for record in records if record.get("title")]

    def _paper(self, record: dict[str, object]) -> Paper:
        pmcid = str(record.get("pmcid") or "") or None
        pmid = str(record.get("pmid") or "") or None
        identifier = pmid or pmcid or str(record.get("id") or "unknown")
        authors = [
            author.strip()
            for author in str(record.get("authorString") or "").split(",")
            if author.strip()
        ]
        return Paper(
            id=f"europe-pmc-{identifier}",
            title=str(record["title"]),
            abstract=str(record.get("abstractText") or record["title"]),
            year=int(str(record["pubYear"])) if record.get("pubYear") else None,
            doi=str(record.get("doi") or "") or None,
            pmid=pmid,
            pmcid=pmcid,
            authors=authors,
            journal=str(record.get("journalTitle") or "") or None,
            url=(
                f"https://europepmc.org/articles/{pmcid}"
                if pmcid
                else f"https://europepmc.org/article/MED/{pmid}"
            ),
            source=self.name,
        )
