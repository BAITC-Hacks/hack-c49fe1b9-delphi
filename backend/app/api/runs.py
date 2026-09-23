from uuid import UUID

from fastapi import APIRouter, Request

from app.api.dependencies import DB
from app.schemas import RunAccepted, RunDetail, StartRun
from app.schemas.runs import FunctionResponse
from app.services.runs import RunService

router = APIRouter(tags=["runs"])


@router.post(
    "/api/analyses/{analysis_id}/runs",
    status_code=202,
    response_model=RunAccepted,
    operation_id="start_run",
)
async def start_run(analysis_id: UUID, body: StartRun, request: Request, db: DB) -> RunAccepted:
    return await RunService(db).start(
        analysis_id, body, request.app.state.settings, request.app.state.workflow
    )


@router.get("/api/runs/{run_id}", response_model=RunDetail, operation_id="get_run")
async def get_run(run_id: UUID, db: DB) -> RunDetail:
    return await RunService(db).get(run_id)


@router.post(
    "/api/runs/{run_id}/resume",
    status_code=202,
    response_model=RunAccepted,
    operation_id="resume_run",
)
async def resume_run(run_id: UUID, request: Request, db: DB) -> RunAccepted:
    return await RunService(db).resume(
        run_id, request.app.state.settings, request.app.state.workflow
    )


@router.get(
    "/api/runs/{run_id}/functions",
    response_model=list[FunctionResponse],
    operation_id="list_functions",
)
async def list_functions(run_id: UUID, db: DB) -> list[FunctionResponse]:
    return await RunService(db).functions(run_id)
