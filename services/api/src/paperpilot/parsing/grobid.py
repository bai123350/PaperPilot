from __future__ import annotations

from typing import Protocol
from xml.etree import ElementTree

import httpx

from paperpilot.parsing.documents import ParsedDocument, ParsedSection


class DocumentParser(Protocol):
    async def parse(self, content: bytes, filename: str) -> ParsedDocument: ...


class GrobidPdfParser:
    namespace = {"tei": "http://www.tei-c.org/ns/1.0"}

    def __init__(
        self,
        base_url: str,
        client: httpx.AsyncClient | None = None,
        fallback: DocumentParser | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.client = client or httpx.AsyncClient(timeout=120)
        self.fallback = fallback

    async def parse(self, content: bytes, filename: str) -> ParsedDocument:
        try:
            response = await self.client.post(
                f"{self.base_url}/api/processFulltextDocument",
                files={"input": (filename, content, "application/pdf")},
                data={"consolidateHeader": "1", "consolidateCitations": "0"},
            )
            response.raise_for_status()
            return self._parse_tei(response.content)
        except (httpx.HTTPError, ElementTree.ParseError, ValueError):
            if self.fallback:
                return await self.fallback.parse(content, filename)
            raise

    def _parse_tei(self, content: bytes) -> ParsedDocument:
        root = ElementTree.fromstring(content)
        title = self._text(root.find(".//tei:titleStmt/tei:title", self.namespace)) or "Untitled manuscript"
        abstract = self._text(root.find(".//tei:profileDesc/tei:abstract", self.namespace))
        sections: list[ParsedSection] = []
        for division in root.findall(".//tei:text/tei:body/tei:div", self.namespace):
            heading = self._text(division.find("tei:head", self.namespace)) or "Section"
            paragraphs = [self._text(item) for item in division.findall("tei:p", self.namespace)]
            text = "\n".join(item for item in paragraphs if item)
            if text:
                sections.append(ParsedSection(heading=heading, text=text))
        return ParsedDocument(title=title, abstract=abstract, sections=sections)

    @staticmethod
    def _text(element: ElementTree.Element | None) -> str:
        if element is None:
            return ""
        return " ".join("".join(element.itertext()).split())
