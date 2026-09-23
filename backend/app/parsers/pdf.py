from io import BytesIO

from pypdf import PdfReader

from .limits import MAX_PDF_PAGES, MAX_TEXT_CHARS
from .types import ParseError, TextChunk


def read_pdf(content: bytes) -> tuple[list[TextChunk], list[str]]:
    if not content.startswith(b"%PDF-"):
        raise ParseError("invalid_format", "The uploaded file is not a PDF document.")
    reader = PdfReader(BytesIO(content), strict=True)
    if reader.is_encrypted:
        raise ParseError("encrypted_document", "Encrypted PDF files are not supported.")
    if len(reader.pages) > MAX_PDF_PAGES:
        raise ParseError("pdf_page_limit", f"PDF files are limited to {MAX_PDF_PAGES} pages.")
    chunks = []
    warnings = ["pdf_reading_order_requires_review"]
    total_chars = 0
    for number, page in enumerate(reader.pages, 1):
        try:
            text = page.extract_text()
        except Exception:
            warnings.append(f"pdf_page_extraction_failed:{number}")
            continue
        if not text or not text.strip():
            warnings.append(f"pdf_page_without_text:{number}")
            continue
        total_chars += len(text)
        if total_chars > MAX_TEXT_CHARS:
            raise ParseError("text_limit", "The extracted PDF text exceeds the parser limit.")
        offset = 0
        for line_number, line in enumerate(text.splitlines(keepends=True), 1):
            locator = {"page": number, "line": line_number, "page_offset": offset}
            chunks.append(
                TextChunk(f"page:{number}:line:{line_number}", line.rstrip("\r\n"), locator)
            )
            offset += len(line)
    return chunks, warnings
