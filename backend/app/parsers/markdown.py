import re

from .types import ParseError, TextChunk


def read_markdown(content: bytes) -> tuple[list[TextChunk], list[str]]:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ParseError("invalid_encoding", "Markdown must use UTF-8 encoding.") from exc
    if "\x00" in text:
        raise ParseError("invalid_format", "The Markdown file contains binary data.")
    chunks = []
    warnings = ["markdown_images_not_extracted"] if re.search(r"!\[[^\]]*\]\(", text) else []
    offset = 0
    for number, line in enumerate(text.splitlines(keepends=True), 1):
        chunks.append(
            TextChunk(
                f"line:{number}",
                line.rstrip("\r\n"),
                {"line": number, "document_offset": offset},
                heading=bool(re.match(r"^\s*#{1,6}\s|^\s*\*\*.*\*\*\s*$", line)),
            )
        )
        offset += len(line)
    return chunks, warnings
