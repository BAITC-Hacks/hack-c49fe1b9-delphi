from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from .common import Side


class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    analysis_id: UUID
    side: Side
    filename: str
    hash: str
    revision_label: str | None
    format: Literal["md", "docx", "pdf", "xlsx"]
    detected_language: str | None
    parse_status: Literal["pending", "parsed", "partial", "failed"]
    warnings: list[str]
    created_at: datetime
    block_count: int


class SourceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    document_id: UUID
    clause_no: str | None
    parent_id: UUID | None
    original_text: str
    locator: dict[str, Any]
