from dataclasses import dataclass
from typing import Any


class ParseError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


@dataclass(frozen=True)
class ParsedBlock:
    key: str
    clause_no: str | None
    parent_key: str | None
    original_text: str
    normalized_text: str
    locator: dict[str, Any]


@dataclass(frozen=True)
class ParsedDocument:
    blocks: list[ParsedBlock]
    warnings: list[str]
    detected_language: str | None
    revision_label: str | None


@dataclass(frozen=True)
class TextChunk:
    key: str
    text: str
    locator: dict[str, Any]
