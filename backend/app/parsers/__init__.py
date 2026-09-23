from io import BytesIO
from pathlib import PurePath, PurePosixPath
from zipfile import BadZipFile, ZipFile

from .common import assemble
from .docx import read_docx
from .limits import MAX_ZIP_ENTRIES
from .markdown import read_markdown
from .pdf import read_pdf
from .types import ParsedBlock, ParsedDocument, ParseError
from .xlsx import read_xlsx

__all__ = ["ParseError", "ParsedBlock", "ParsedDocument", "parse_document"]


def _validate_office(content: bytes, extension: str, max_uncompressed_bytes: int) -> None:
    required = {"[Content_Types].xml", "_rels/.rels"}
    required.add("word/document.xml" if extension == ".docx" else "xl/workbook.xml")
    try:
        with ZipFile(BytesIO(content)) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_ZIP_ENTRIES:
                raise ParseError("archive_entry_limit", "The Office archive has too many entries.")
            names = [entry.filename for entry in entries]
            if len(set(names)) != len(names) or not required.issubset(names):
                raise ParseError(
                    "invalid_format",
                    "The Office archive is missing required parts or has duplicate entries.",
                )
            if any(entry.flag_bits & 1 for entry in entries):
                raise ParseError("encrypted_document", "Encrypted Office files are not supported.")
            for entry in entries:
                name = PurePosixPath(entry.filename.replace("\\", "/"))
                if name.is_absolute() or ".." in name.parts:
                    raise ParseError(
                        "invalid_format", "The Office archive has an unsafe member path."
                    )
            if sum(entry.file_size for entry in entries) > max_uncompressed_bytes:
                raise ParseError(
                    "expanded_size_limit",
                    "The expanded Office document exceeds the configured size limit.",
                )
            for entry in entries:
                if (
                    entry.file_size > 1024 * 1024
                    and entry.file_size / max(entry.compress_size, 1) > 200
                ):
                    raise ParseError(
                        "compression_ratio_limit",
                        "The Office archive compression ratio exceeds the parser limit.",
                    )
                if entry.filename.lower().endswith((".xml", ".rels")):
                    xml = archive.read(entry).upper().replace(b"\x00", b"")
                    if b"<!DOCTYPE" in xml or b"<!ENTITY" in xml:
                        raise ParseError(
                            "unsupported_xml",
                            "Office XML with DTD/entity declarations is unsupported.",
                        )
            if archive.testzip() is not None:
                raise ParseError("corrupt_document", "The Office archive contains damaged entries.")
    except BadZipFile as exc:
        raise ParseError("corrupt_document", "The Office archive cannot be read.") from exc


def parse_document(filename: str, content: bytes, *, max_uncompressed_bytes: int) -> ParsedDocument:
    readers = {".docx": read_docx, ".pdf": read_pdf, ".xlsx": read_xlsx, ".md": read_markdown}
    extension = PurePath(filename).suffix.lower()
    if extension not in readers:
        raise ParseError(
            "unsupported_format", "Supported document formats are DOCX, PDF, XLSX and Markdown."
        )
    if not content:
        raise ParseError("empty_file", "The uploaded document is empty.")
    if max_uncompressed_bytes <= 0:
        raise ValueError("max_uncompressed_bytes must be positive")
    try:
        if extension in {".docx", ".xlsx"}:
            _validate_office(content, extension, max_uncompressed_bytes)
        chunks, warnings = readers[extension](content)
        return assemble(chunks, warnings)
    except ParseError:
        raise
    except Exception as exc:
        raise ParseError("corrupt_document", "The document structure could not be read.") from exc
