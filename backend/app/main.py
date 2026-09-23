from typing import Literal

from fastapi import FastAPI, Request
from pydantic import BaseModel

from app.api import analyses, documents, findings, reports, runs
from app.api.errors import ERROR_RESPONSES, install_error_handlers
from app.config import Settings
from app.lifespan import application_lifespan


class HealthResponse(BaseModel):
    status: Literal["ok"]
    ai_configured: bool


def create_app(settings: Settings | None = None) -> FastAPI:
    app = FastAPI(
        title="Delphi API",
        version="0.1.0",
        description="Compare organizational documents with traceable evidence and human review.",
        lifespan=application_lifespan(settings),
        responses=ERROR_RESPONSES,
    )
    install_error_handlers(app)
    for router in (analyses.router, documents.router, runs.router, findings.router, reports.router):
        app.include_router(router)

    @app.get(
        "/api/health", tags=["system"], response_model=HealthResponse, operation_id="get_health"
    )
    async def health(request: Request) -> HealthResponse:
        return HealthResponse(status="ok", ai_configured=request.app.state.settings.ai_configured)

    return app


app = create_app()
