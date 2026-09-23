from io import BytesIO

from pypdf import PdfReader

from .types import ParseError, TextChunk


def read_pdf(content: bytes) -> tuple[list[TextChunk], list[str]]:
    if not content.startswith(b"%PDF-"):
        raise ParseError("invalid_format", "The uploaded file is not a PDF document.")
    reader = PdfReader(BytesIO(content), strict=True)
    if reader.is_encrypted:
        raise ParseError("encrypted_document", "Encrypted PDF files are not supported.")
    chunks = []
    warnings = []
    for number, page in enumerate(reader.pages, 1):
        text = page.extract_text()
        if not text or not text.strip():
            warnings.append(f"pdf_page_without_text:{number}")
            continue
        offset = 0
        for line_number, line in enumerate(text.splitlines(keepends=True), 1):
            locator = {"page": number, "line": line_number, "page_offset": offset}
            chunks.append(
                TextChunk(f"page:{number}:line:{line_number}", line.rstrip("\r\n"), locator)
            )
            offset += len(line)
    return chunks, warnings
