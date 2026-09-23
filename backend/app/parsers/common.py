import re
import unicodedata

from .limits import MAX_BLOCKS, MAX_SEGMENT_CHARS, MAX_TEXT_CHARS
from .types import ParsedBlock, ParsedDocument, ParseError, TextChunk

NUMBER = re.compile(
    r"(?<![\w.])(?P<number>\d{1,3}(?:\.\d{1,3})*)(?:\\)?\.(?=\s|[A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі])"
)
LIST_MARKER = re.compile(r"^[\s*#_>]*(?:\\)?(?P<marker>[a-zа-яәғқңөұүһі])[.)]\s+", re.I)
REFERENCE = re.compile(r"(?:\bпп?\.|\bпункт[а-я]*|\bраздел[а-я]*|\bclause|\bsection)\s*$", re.I)
TOC_TITLE = {"оглавление", "содержание", "table of contents", "contents", "мазмұны"}


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"\\([.\-_*])", r"\1", text)
    text = re.sub(r"[*_`#]", "", text)
    return " ".join(text.split()).casefold()


def plain_heading(text: str) -> str:
    return normalize(text).strip(" :.-")


def language(text: str) -> str | None:
    if re.search(r"[ӘәҒғҚқҢңӨөҰұҮүҺһІі]", text):
        return "kk"
    cyrillic = len(re.findall(r"[А-Яа-яЁё]", text))
    latin = len(re.findall(r"[A-Za-z]", text))
    if cyrillic > latin and cyrillic >= 10:
        return "ru"
    if latin > cyrillic and latin >= 10:
        return "en"
    return None


def _boundaries(text: str) -> list[tuple[int, str | None, int]]:
    found: list[tuple[int, str | None, int]] = []
    for match in NUMBER.finditer(text):
        prefix = text[: match.start()]
        at_start = not prefix.strip(" \t\r\n*#_>")
        if REFERENCE.search(prefix):
            continue
        if not at_start and prefix.rstrip()[-1:] not in ".;:!?":
            continue
        number = match.group("number")
        if not at_start and "." not in number:
            next_text = text[match.end() :].lstrip()
            if not next_text or not next_text[0].isupper():
                continue
        found.append((0 if at_start else match.start(), number, match.end()))
    if not found or found[0][0] != 0:
        found.insert(0, (0, None, 0))
    return found


def assemble(chunks: list[TextChunk], warnings: list[str]) -> ParsedDocument:
    blocks: list[ParsedBlock] = []
    known_clauses: dict[str, ParsedBlock] = {}
    chunk_roots: dict[str, str] = {}
    numbered: ParsedBlock | None = None
    unnumbered_heading: ParsedBlock | None = None
    heading_anchor: str | None = None
    section: str | None = None
    toc = False
    total_chars = 0
    annexes: list[tuple[int, str]] = []
    for chunk in chunks:
        total_chars += len(chunk.text)
        if total_chars > MAX_TEXT_CHARS:
            raise ParseError("text_limit", "The extracted document text exceeds the parser limit.")
        if not chunk.text.strip():
            continue
        heading = plain_heading(chunk.text)
        if heading in TOC_TITLE or chunk.toc:
            toc = True
            warnings.append(f"table_of_contents_skipped:{chunk.key}")
            continue
        if toc:
            leader_page = bool(re.search(r"(?:\.{2,}|…{2,}|[·•]{2,}|\t+)\s*\d+\s*$", chunk.text))
            repeated_heading = False
            candidate = re.match(r"^(\d+)\.?\s+(.+?)\s+\d+(?:\s+.*)?$", heading)
            if candidate and len(heading) <= 240 and candidate[1] in known_clauses:
                previous = known_clauses[candidate[1]]
                previous_title = re.sub(r"^\d+\.\s*", "", previous.normalized_text)
                repeated_heading = previous_title.startswith(candidate[2])
            if leader_page or repeated_heading:
                continue
            toc = False
            if heading not in {"приложения", "appendices", "appendix", "қосымшалар"}:
                warnings.append(f"toc_boundary_requires_review:{chunk.key}")
        annex = re.match(r"(?:приложение|annex|appendix|қосымша)\s+(\d+)", heading)
        if annex:
            annexes.append((len(blocks), annex.group(1)))
        boundaries = _boundaries(chunk.text) if chunk.clause_numbers else [(0, None, 0)]
        bounded = []
        for index, (start, clause, content_start) in enumerate(boundaries):
            end = boundaries[index + 1][0] if index + 1 < len(boundaries) else len(chunk.text)
            bounded.append((start, clause, content_start))
            while end - start > MAX_SEGMENT_CHARS:
                boundary = chunk.text.rfind(
                    " ", start + MAX_SEGMENT_CHARS // 2, start + MAX_SEGMENT_CHARS
                )
                start = boundary if boundary > start else start + MAX_SEGMENT_CHARS
                bounded.append((start, None, start))
        boundaries = bounded
        for index, (start, clause, content_start) in enumerate(boundaries):
            end = boundaries[index + 1][0] if index + 1 < len(boundaries) else len(chunk.text)
            original = chunk.text[start:end]
            if not original.strip():
                continue
            if len(blocks) >= MAX_BLOCKS:
                raise ParseError("block_limit", "The document has too many extracted blocks.")
            key = f"{chunk.key}:{start}-{end}"
            normalized = normalize(original)
            is_heading = chunk.heading or (normalized.endswith(":") and len(normalized) <= 300)
            parent_key = (
                numbered.key if numbered else unnumbered_heading.key if unnumbered_heading else None
            )
            if clause:
                parts = clause.split(".")
                is_heading = is_heading or len(parts) == 1
                parent_key = None
                for depth in range(len(parts) - 1, 0, -1):
                    prefix = ".".join(parts[:depth])
                    if prefix in known_clauses:
                        parent_key = known_clauses[prefix].key
                        break
                if len(parts) == 1:
                    section = clause
                    unnumbered_heading = None
                    heading_anchor = None
                elif unnumbered_heading:
                    inside_anchor = bool(heading_anchor and clause.startswith(heading_anchor + "."))
                    remainder = chunk.text[content_start:end].strip()
                    explicit_role = bool(
                        re.search(
                            r"^(?:(?:главный|chief|audit|senior|бас)\s+)?(?:директор\w*|руководител\w*|начальник\w*|аудитор\w*|director|head|manager|auditor|басшы\w*)\b",
                            remainder,
                            re.I,
                        )
                    ) and not re.search(
                        r"\b(?:обязан\w*|долж\w*|вправе|must|shall|may|міндет\w*)\b",
                        remainder,
                        re.I,
                    )
                    if (is_heading and (chunk.heading or explicit_role)) or not inside_anchor:
                        unnumbered_heading = None
                        heading_anchor = None
                    elif parent_key == unnumbered_heading.parent_key:
                        parent_key = unnumbered_heading.key
                if not any(char.isalnum() for char in chunk.text[content_start:end]):
                    warnings.append(f"empty_clause:{clause}")
            elif is_heading:
                parent_key = (
                    numbered.key
                    if numbered
                    else known_clauses[section].key
                    if section in known_clauses
                    else None
                )
            if not chunk.clause_numbers:
                # Spreadsheet headers are explicit context, never numbered clauses
                # or descendants of the last row on a different sheet.
                parent_key = chunk_roots.get(chunk.context_key) if chunk.context_key else None
            locator = {**chunk.locator, "start_offset": start, "end_offset": end}
            marker = LIST_MARKER.match(original)
            if marker:
                locator["list_marker"] = marker.group("marker")
            block = ParsedBlock(key, clause, parent_key, original, normalized, locator)
            blocks.append(block)
            chunk_roots.setdefault(chunk.key, key)
            if clause:
                known_clauses[clause] = block
                numbered = block
            elif is_heading:
                unnumbered_heading = block
                anchor = next(
                    (item for item in reversed(blocks[:-1]) if item.key == parent_key), None
                )
                heading_anchor = anchor.clause_no if anchor else None
                numbered = None
    if not blocks or not any(
        any(char.isalnum() for char in block.original_text) for block in blocks
    ):
        raise ParseError("no_text", "No readable text was found in the document.")
    for block_index, number in annexes:
        following = blocks[block_index + 1 :]
        if not following:
            warnings.append(f"missing_annex_content:{number}")
    text = "\n".join(block.original_text for block in blocks)
    revision = re.search(
        r"(?:редакци[яи]|revision|version)\s*(?:№|No\.?|number)?\s*(\d+)", text, re.I
    )
    return ParsedDocument(
        blocks,
        list(dict.fromkeys(warnings)),
        language(text),
        revision.group(1) if revision else None,
    )
