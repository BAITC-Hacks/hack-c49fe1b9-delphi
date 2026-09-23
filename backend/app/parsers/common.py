import re
import unicodedata

from .types import ParsedBlock, ParsedDocument, ParseError, TextChunk

NUMBER = re.compile(
    r"(?<![\w.])(?P<number>\d{1,3}(?:\.\d{1,3})*)(?:\\)?\.(?=\s|[A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі])"
)
LIST_MARKER = re.compile(r"^[\s*#_>]*(?:\\)?(?P<marker>[a-zа-яәғқңөұүһі])[.)]\s+", re.I)
REFERENCE = re.compile(r"(?:\bпп?\.|\bпункт[а-я]*|\bраздел[а-я]*|\bclause|\bsection)\s*$", re.I)
TOC_TITLE = {"оглавление", "содержание", "table of contents", "contents", "мазмұны"}
TOC_ENTRY = re.compile(r"^\d+(?:\.\d+)*\.?\s+.+\s\d+\s*$")


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
    known_clauses: dict[str, str] = {}
    current_clause: str | None = None
    toc = False
    annexes: list[tuple[int, str]] = []
    for chunk in chunks:
        if not chunk.text.strip():
            continue
        heading = plain_heading(chunk.text)
        if heading in TOC_TITLE:
            toc = True
            warnings.append(f"table_of_contents_skipped:{chunk.key}")
            continue
        if toc:
            if TOC_ENTRY.fullmatch(heading) or re.fullmatch(r".+\.{3,}\s*\d+", heading):
                continue
            toc = False
        annex = re.match(r"(?:приложение|annex|appendix|қосымша)\s+(\d+)", heading)
        if annex:
            annexes.append((len(blocks), annex.group(1)))
        boundaries = _boundaries(chunk.text)
        for index, (start, clause, content_start) in enumerate(boundaries):
            end = boundaries[index + 1][0] if index + 1 < len(boundaries) else len(chunk.text)
            original = chunk.text[start:end]
            if not original.strip():
                continue
            key = f"{chunk.key}:{start}-{end}"
            parent_key = known_clauses.get(current_clause) if current_clause else None
            if clause:
                parts = clause.split(".")
                parent_key = None
                for depth in range(len(parts) - 1, 0, -1):
                    prefix = ".".join(parts[:depth])
                    if prefix in known_clauses:
                        parent_key = known_clauses[prefix]
                        break
                known_clauses[clause] = key
                current_clause = clause
                if not any(char.isalnum() for char in chunk.text[content_start:end]):
                    warnings.append(f"empty_clause:{clause}")
            locator = {**chunk.locator, "start_offset": start, "end_offset": end}
            marker = LIST_MARKER.match(original)
            if marker:
                locator["list_marker"] = marker.group("marker")
            blocks.append(
                ParsedBlock(key, clause, parent_key, original, normalize(original), locator)
            )
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
