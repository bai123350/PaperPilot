from dataclasses import dataclass
from typing import Protocol

from paperpilot.domain.models import Paper, ResearchBrief
from paperpilot.parsing.documents import ParsedDocument


class ReadableStore(Protocol):
    def read(self, key: str) -> bytes: ...


class Parser(Protocol):
    async def parse(self, content: bytes, filename: str) -> ParsedDocument: ...


@dataclass(frozen=True)
class PrivateMaterial:
    id: str
    key: str
    filename: str


class PrivateMaterialConnector:
    name = "private_upload"

    def __init__(
        self,
        store: ReadableStore,
        parser: Parser,
        materials: list[PrivateMaterial],
    ) -> None:
        self.store = store
        self.parser = parser
        self.materials = materials

    async def search(self, brief: ResearchBrief) -> list[Paper]:
        papers: list[Paper] = []
        for material in self.materials:
            document = await self.parser.parse(self.store.read(material.key), material.filename)
            section_text = " ".join(section.text for section in document.sections)
            abstract = " ".join(part for part in (document.abstract, section_text) if part).strip()
            papers.append(
                Paper(
                    id=f"private-{material.id}",
                    title=document.title,
                    abstract=abstract[:8000],
                    source=self.name,
                )
            )
        return papers
