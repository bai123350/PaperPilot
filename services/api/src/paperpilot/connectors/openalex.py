from __future__ import annotations

import re

import httpx

from paperpilot.domain.models import Paper, ResearchBrief


class OpenAlexConnector:
    name = "openalex"
    endpoint = "https://api.openalex.org/works"

    def __init__(self, client: httpx.AsyncClient | None = None, limit: int = 30) -> None:
        self.client = client or httpx.AsyncClient(timeout=30)
        self.limit = limit

    async def search(self, brief: ResearchBrief) -> list[Paper]:
        params: dict[str, str | int] = {"search": brief.question, "per-page": self.limit}
        if brief.date_from and brief.date_to:
            params["filter"] = (
                f"from_publication_date:{brief.date_from}-01-01,"
                f"to_publication_date:{brief.date_to}-12-31"
            )
        response = await self.client.get(
            self.endpoint,
            params=params,
        )
        response.raise_for_status()
        return [self._paper(record) for record in response.json().get("results", []) if record.get("display_name")]

    def _paper(self, record: dict) -> Paper:
        ids = record.get("ids") or {}
        pmid_match = re.search(r"(\d+)$", str(ids.get("pmid") or ""))
        primary_location = record.get("primary_location") or {}
        return Paper(
            id=str(record.get("id") or "").rsplit("/", 1)[-1],
            title=str(record["display_name"]),
            abstract=self._abstract(record.get("abstract_inverted_index")),
            year=record.get("publication_year"),
            doi=record.get("doi"),
            pmid=pmid_match.group(1) if pmid_match else None,
            authors=[
                str(authorship.get("author", {}).get("display_name"))
                for authorship in record.get("authorships", [])
                if authorship.get("author", {}).get("display_name")
            ],
            url=primary_location.get("landing_page_url"),
            source=self.name,
        )

    @staticmethod
    def _abstract(inverted: dict[str, list[int]] | None) -> str:
        if not inverted:
            return "OpenAlex metadata record; abstract was not available from the source."
        positioned = [(position, word) for word, positions in inverted.items() for position in positions]
        return " ".join(word for _, word in sorted(positioned))
