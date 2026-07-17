from __future__ import annotations

from html import unescape
from xml.etree import ElementTree

import httpx

from paperpilot.domain.models import Paper, ResearchBrief


class CrossrefConnector:
    name = "crossref"
    endpoint = "https://api.crossref.org/works"

    def __init__(self, client: httpx.AsyncClient | None = None, limit: int = 30) -> None:
        self.client = client or httpx.AsyncClient(timeout=30)
        self.limit = limit

    async def search(self, brief: ResearchBrief) -> list[Paper]:
        response = await self.client.get(
            self.endpoint,
            params={
                "query.bibliographic": brief.question,
                "rows": self.limit,
                "select": "DOI,title,abstract,published,author,container-title,URL",
            },
            headers={"User-Agent": "PaperPilot/0.1 (mailto:researcher@example.com)"},
        )
        response.raise_for_status()
        records = response.json().get("message", {}).get("items", [])
        return [paper for record in records if (paper := self._paper(record)) is not None]

    def _paper(self, record: dict) -> Paper | None:
        titles = record.get("title") or []
        if not titles:
            return None
        date_parts = (record.get("published") or {}).get("date-parts") or []
        year = date_parts[0][0] if date_parts and date_parts[0] else None
        authors = [
            " ".join(part for part in (author.get("given"), author.get("family")) if part)
            for author in record.get("author", [])
        ]
        containers = record.get("container-title") or []
        abstract = self._jats_text(record.get("abstract") or "")
        title = str(titles[0])
        return Paper(
            id=f"crossref-{record.get('DOI') or title}",
            title=title,
            abstract=abstract or f"{title}. Crossref metadata record; full text was not available.",
            year=year,
            doi=record.get("DOI"),
            authors=[author for author in authors if author],
            journal=str(containers[0]) if containers else None,
            url=record.get("URL"),
            source=self.name,
        )

    @staticmethod
    def _jats_text(value: str) -> str:
        if not value:
            return ""
        try:
            root = ElementTree.fromstring(f'<root xmlns:jats="urn:jats">{value}</root>')
            return " ".join("".join(root.itertext()).split())
        except ElementTree.ParseError:
            return " ".join(unescape(value).split())
