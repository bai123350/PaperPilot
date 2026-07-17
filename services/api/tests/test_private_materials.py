from paperpilot.connectors.private_materials import PrivateMaterial, PrivateMaterialConnector
from paperpilot.domain.models import ResearchBrief
from paperpilot.parsing.documents import ParsedDocument, ParsedSection


class MemoryStore:
    def read(self, key: str) -> bytes:
        assert key == "user/project/private.pdf"
        return b"%PDF-private"


class StubParser:
    async def parse(self, content: bytes, filename: str) -> ParsedDocument:
        assert content.startswith(b"%PDF")
        return ParsedDocument(
            title="Unpublished prospective cohort",
            abstract="A private cohort observed stable discrimination in an external site.",
            sections=[ParsedSection(heading="Results", text="The locked model achieved AUC 0.81.")],
        )


async def test_private_materials_enter_the_literature_pipeline_as_scoped_papers() -> None:
    connector = PrivateMaterialConnector(
        store=MemoryStore(),
        parser=StubParser(),
        materials=[PrivateMaterial(id="upload-1", key="user/project/private.pdf", filename="private.pdf")],
    )

    papers = await connector.search(
        ResearchBrief(question="What evidence supports external biomarker validation?")
    )

    assert papers[0].id == "private-upload-1"
    assert papers[0].source == "private_upload"
    assert "AUC 0.81" in papers[0].abstract
