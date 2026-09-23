from uuid import UUID

from fastapi import APIRouter

from app.api.dependencies import DB
from app.schemas import AnalysisDetail, AnalysisListItem, AnalysisResponse, CreateAnalysis
from app.services.analyses import AnalysisService

router = APIRouter(prefix="/api/analyses", tags=["analyses"])


@router.post("", status_code=201, response_model=AnalysisResponse, operation_id="create_analysis")
async def create_analysis(body: CreateAnalysis, db: DB) -> AnalysisResponse:
    return await AnalysisService(db).create(body.title)


@router.get("", response_model=list[AnalysisListItem], operation_id="list_analyses")
async def list_analyses(db: DB) -> list[AnalysisListItem]:
    return await AnalysisService(db).list()


@router.get("/{analysis_id}", response_model=AnalysisDetail, operation_id="get_analysis")
async def get_analysis(analysis_id: UUID, db: DB) -> AnalysisDetail:
    return await AnalysisService(db).get(analysis_id)


@router.post(
    "/{analysis_id}/repeat",
    status_code=201,
    response_model=AnalysisResponse,
    operation_id="repeat_analysis",
)
async def repeat_analysis(analysis_id: UUID, db: DB) -> AnalysisResponse:
    return await AnalysisService(db).repeat(analysis_id)
