from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from .common import ReviewStatus, Side

ChangeType = Literal[
    "retained",
    "reworded",
    "transferred",
    "split",
    "merged",
    "new",
    "potentially_missing",
    "changed",
    "structure_changed",
]
IssueType = Literal[
    "overlap",
    "potential_conflict",
    "modality_changed",
    "scope_changed",
    "insufficient_evidence",
]


class SearchCoverage(BaseModel):
    method: Literal["semantic_all_after_batches", "semantic_all_before_batches"]
    complete: bool
    reviewed_source_ids: list[UUID]
    candidate_source_ids: list[UUID]
    errors: list[str]
    input_partial: bool | None = None


class ReviewResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    finding_id: UUID
    status: ReviewStatus
    note: str
    updated_at: datetime


class ReviewUpdated(ReviewResponse):
    review_revision: int


class FindingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    run_id: UUID
    title: str
    change_type: ChangeType
    issue_type: IssueType | None
    before_function_ids: list[UUID]
    after_function_ids: list[UUID]
    explanation: str
    recommendation: str
    source_ids: list[UUID]
    search: SearchCoverage | None
    review: ReviewResponse


class EvidenceResponse(BaseModel):
    source_id: UUID
    document_id: UUID
    filename: str
    side: Side
    clause_no: str | None
    original_text: str
    excerpt: str
    locator: dict[str, Any]
    evidence_role: Literal["before", "after", "context"]
    start_offset: int | None
    end_offset: int | None
