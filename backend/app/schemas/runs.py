from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from .common import Locale, Side

RunState = Literal["queued", "running", "completed", "partial", "failed", "interrupted"]
RunStage = Literal[
    "queued",
    "extracting",
    "comparing",
    "checking_risks",
    "validating",
    "completed",
    "partial",
    "failed",
    "interrupted",
]


class RunCoverage(BaseModel):
    allow_partial: bool
    input_partial: bool
    input_warnings: dict[UUID, list[str]]
    total_documents: int
    total_sources: int
    processed_sources: int
    before_functions: int
    compared_before_functions: int
    after_functions: int
    reviewed_after_functions: int
    structure_units: int
    reviewed_structure_units: int
    unprocessed_source_ids: list[UUID]
    unreviewed_function_ids: list[UUID]


class RunAccepted(BaseModel):
    run_id: UUID
    state: RunState


class UnitResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    side: Side
    kind: Literal["department", "role", "group"]
    name_original: str
    parent_unit_id: UUID | None
    source_ids: list[UUID]


class StructureChange(BaseModel):
    id: UUID
    before_unit_ids: list[UUID]
    after_unit_ids: list[UUID]
    status: Literal["retained", "newly_listed", "transformed", "unmatched"]
    source_ids: list[UUID]
    explanation: str


class FunctionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    run_id: UUID
    side: Side
    owner_unit_ids: list[UUID]
    actor_original: str
    action: str
    object: str
    scope: str
    condition: str
    modality: str
    source_ids: list[UUID]


class RunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    analysis_id: UUID
    state: RunState
    stage: RunStage
    output_language: Locale
    model: str
    pipeline_version: str
    review_revision: int
    coverage: RunCoverage
    structure: list[StructureChange]
    errors: list[str]
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class RunDetail(RunResponse):
    units: list[UnitResponse]
    finding_count: int
