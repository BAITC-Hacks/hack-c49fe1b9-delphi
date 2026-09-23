from dataclasses import dataclass
from uuid import UUID

from app.models import (
    Document,
    Finding,
    FindingEvidence,
    Function,
    Review,
    SourceBlock,
    Unit,
)


@dataclass(frozen=True)
class ReportSnapshot:
    run_id: UUID
    review_revision: int
    output_language: str
    title: str
    state: str
    coverage: dict
    errors: list
    documents: dict[UUID, Document]
    findings: list[Finding]
    reviews: dict[UUID, Review]
    evidence: dict[UUID, list[FindingEvidence]]
    sources: dict[UUID, SourceBlock]
    functions: list[Function]
    units: dict[str, Unit]


@dataclass(frozen=True)
class RenderedExport:
    payload: str
    review_revision: int
