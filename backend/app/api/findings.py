from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from app.api.dependencies import DB
from app.schemas import (
    EvidenceResponse,
    FindingResponse,
    ReviewUpdated,
    SourceResponse,
    UpdateReview,
)
from app.services.findings import FindingService

router = APIRouter(prefix="/api", tags=["findings"])


def finding_service(db: DB) -> FindingService:
    return FindingService(db)


Findings = Annotated[FindingService, Depends(finding_service)]


@router.get(
    "/runs/{run_id}/findings",
    response_model=list[FindingResponse],
    operation_id="list_findings",
)
async def list_findings(run_id: UUID, service: Findings) -> list[FindingResponse]:
    return await service.list_findings(run_id)


@router.get(
    "/findings/{finding_id}/evidence",
    response_model=list[EvidenceResponse],
    operation_id="get_finding_evidence",
)
async def get_finding_evidence(finding_id: UUID, service: Findings) -> list[EvidenceResponse]:
    return await service.get_evidence(finding_id)


@router.put(
    "/findings/{finding_id}/review",
    response_model=ReviewUpdated,
    operation_id="update_finding_review",
)
async def update_finding_review(
    finding_id: UUID, body: UpdateReview, service: Findings
) -> ReviewUpdated:
    return await service.update_review(finding_id, body)


@router.get("/sources/{source_id}", response_model=SourceResponse, operation_id="get_source")
async def get_source(source_id: UUID, service: Findings) -> SourceResponse:
    return await service.get_source(source_id)
