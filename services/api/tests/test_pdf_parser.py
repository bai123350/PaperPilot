import httpx

from paperpilot.parsing.documents import ParsedDocument
from paperpilot.parsing.grobid import GrobidPdfParser


TEI = b"""<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt><title>Private biomarker manuscript</title></titleStmt></fileDesc>
  <profileDesc><abstract><p>Prospective results from an unpublished cohort.</p></abstract></profileDesc></teiHeader>
  <text><body><div><head>Results</head><p>The locked model achieved an AUC of 0.81.</p></div></body></text>
</TEI>"""


async def test_grobid_parser_extracts_structured_sections() -> None:
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, content=TEI)))
    parser = GrobidPdfParser("http://grobid:8070", client=client)

    document = await parser.parse(b"%PDF-private", "unpublished.pdf")

    assert document.title == "Private biomarker manuscript"
    assert document.abstract.startswith("Prospective results")
    assert document.sections[0].heading == "Results"
    assert "0.81" in document.sections[0].text


class FallbackParser:
    async def parse(self, content: bytes, filename: str) -> ParsedDocument:
        return ParsedDocument(title="Fallback title", abstract="Fallback abstract", sections=[])


async def test_grobid_parser_uses_fallback_on_service_failure() -> None:
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(503)))
    parser = GrobidPdfParser("http://grobid:8070", client=client, fallback=FallbackParser())

    document = await parser.parse(b"%PDF-private", "unpublished.pdf")

    assert document.title == "Fallback title"
