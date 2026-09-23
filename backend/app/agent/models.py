from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue

Side = Literal["before", "after"]
Language = Literal["ru", "kk", "en"]
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


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SourceInput(Contract):
    id: str
    document_id: str
    side: Side
    clause_no: str | None = None
    text: str
    parent_text: str | None = None
    locator: dict[str, JsonValue] | None = None


class UnitOutput(Contract):
    id: str
    side: Side
    kind: Literal["department", "role", "group"]
    name_original: str
    parent_unit_id: str | None
    source_ids: list[str]


class FunctionOutput(Contract):
    id: str
    side: Side
    owner_unit_ids: list[str]
    actor_original: str
    action: str
    object: str
    scope: str
    condition: str
    modality: str
    source_ids: list[str]


class EvidenceOutput(Contract):
    source_id: str
    evidence_role: Literal["before", "after", "context"]
    start_offset: int | None = None
    end_offset: int | None = None


class FindingOutput(Contract):
    id: str
    title: str
    change_type: ChangeType
    issue_type: IssueType | None
    before_function_ids: list[str]
    after_function_ids: list[str]
    explanation: str
    recommendation: str
    evidence: list[EvidenceOutput]
    search: dict | None = None


class AnalysisOutput(Contract):
    units: list[UnitOutput]
    functions: list[FunctionOutput]
    findings: list[FindingOutput]
    structure: list["UnitMatchOutput"]
    coverage: dict
    errors: list[str]
    operations: list[dict]
    partial: bool


class UnitMatchOutput(Contract):
    id: str
    before_unit_ids: list[str]
    after_unit_ids: list[str]
    status: Literal["retained", "newly_listed", "transformed", "unmatched"]
    source_ids: list[str]
    explanation: str


class UnitMatchDraft(Contract):
    before_unit_ids: list[str]
    after_unit_ids: list[str]
    status: Literal["retained", "newly_listed", "transformed", "unmatched"]
    source_ids: list[str] = Field(min_length=1)
    explanation: str


class StructureComparison(Contract):
    matches: list[UnitMatchDraft]


class UnitDraft(Contract):
    key: str
    kind: Literal["department", "role", "group"]
    name_original: str
    parent_key: str | None
    source_ids: list[str] = Field(min_length=1)


class FunctionDraft(Contract):
    owner_keys: list[str] = Field(min_length=1)
    actor_original: str
    action: str
    object: str
    scope: str
    condition: str
    modality: str
    source_ids: list[str] = Field(min_length=1)


class Extraction(Contract):
    processed_source_ids: list[str]
    units: list[UnitDraft]
    functions: list[FunctionDraft]


class EvidenceDraft(Contract):
    source_id: str
    evidence_role: Literal["before", "after", "context"]
    start_offset: int | None
    end_offset: int | None


class FindingDraft(Contract):
    title: str
    change_type: ChangeType
    issue_type: IssueType | None
    before_function_ids: list[str]
    after_function_ids: list[str]
    explanation: str
    recommendation: str
    evidence: list[EvidenceDraft] = Field(min_length=1)


class Comparison(Contract):
    reviewed_function_ids: list[str]
    findings: list[FindingDraft]


class MissingSearch(Contract):
    reviewed_source_ids: list[str]
    candidate_source_ids: list[str]
    explanation: str


class AgentError(Exception):
    pass
