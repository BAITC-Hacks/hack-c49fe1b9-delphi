"""Lab contracts: saved source text is authoritative; model prose is not evidence."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

Side = Literal["before", "after"]
Locale = Literal["ru", "kk", "en"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SourceBlock(StrictModel):
    id: str
    document_id: str
    side: Side
    locator: str
    clause_no: str | None = None
    parent_id: str | None = None
    original_text: str
    normalized_text: str
    kind: Literal["text", "heading", "toc"] = "text"


class Document(StrictModel):
    id: str
    side: Side
    filename: str
    sha256: str
    format: str
    detected_language: str
    parse_status: Literal["ok", "limited", "error"]
    warnings: list[str] = Field(default_factory=list)
    blocks: list[SourceBlock] = Field(default_factory=list)


class Unit(StrictModel):
    id: str
    side: Side
    kind: Literal["unit", "role", "group"]
    name_original: str
    source_ids: list[str]


class Function(StrictModel):
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


class Evidence(StrictModel):
    source_id: str
    evidence_role: Literal["before", "after", "context"]
    start_offset: int | None = None
    end_offset: int | None = None


class Finding(StrictModel):
    id: str
    title: str
    change_type: Literal["preserved", "rephrased", "transferred", "split", "merged", "added", "unmatched", "review"]
    issue_type: Literal["none", "gap", "overlap", "conflict", "scope_changed", "modality_changed", "uncertainty"]
    before_function_ids: list[str]
    after_function_ids: list[str]
    explanation: str
    recommendation: str
    evidence: list[Evidence]
    search_queries: list[str] = Field(default_factory=list)


class AgentResult(StrictModel):
    units: list[Unit] = Field(default_factory=list)
    functions: list[Function] = Field(default_factory=list)
    findings: list[Finding] = Field(default_factory=list)
    trace: list[dict] = Field(default_factory=list)
    usage: dict = Field(default_factory=dict)
    errors: list[str] = Field(default_factory=list)
    coverage: dict = Field(default_factory=dict)
    complete: bool = False
