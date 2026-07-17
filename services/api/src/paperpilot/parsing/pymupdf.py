from __future__ import annotations

from paperpilot.parsing.documents import ParsedDocument, ParsedSection


class PyMuPdfParser:
    async def parse(self, content: bytes, filename: str) -> ParsedDocument:
        try:
            import fitz
        except ImportError as exc:
            raise RuntimeError("Install paperpilot-api[pdf] to enable the PyMuPDF fallback") from exc
        document = fitz.open(stream=content, filetype="pdf")
        page_text = [page.get_text("text").strip() for page in document]
        first_nonempty = next((text for text in page_text if text), filename)
        title = first_nonempty.splitlines()[0][:300]
        abstract = first_nonempty[:1800]
        sections = [
            ParsedSection(heading=f"Page {index + 1}", text=text, page=index + 1)
            for index, text in enumerate(page_text)
            if text
        ]
        return ParsedDocument(title=title, abstract=abstract, sections=sections)
