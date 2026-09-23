from .types import ParseError, TextChunk


def read_markdown(content: bytes) -> tuple[list[TextChunk], list[str]]:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ParseError("invalid_encoding", "Markdown must use UTF-8 encoding.") from exc
    if "\x00" in text:
        raise ParseError("invalid_format", "The Markdown file contains binary data.")
    chunks = []
    offset = 0
    for number, line in enumerate(text.splitlines(keepends=True), 1):
        chunks.append(
            TextChunk(
                f"line:{number}", line.rstrip("\r\n"), {"line": number, "document_offset": offset}
            )
        )
        offset += len(line)
    return chunks, []
