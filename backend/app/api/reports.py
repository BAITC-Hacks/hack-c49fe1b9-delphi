from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, Response

from app.api.dependencies import DB
from app.schemas.common import Locale, TranslateRequest
from app.schemas.reports import TranslationResponse
from app.services.reports import create_export
from app.services.translations import create_translation as prepare_translation

router = APIRouter(prefix="/api/runs", tags=["reports"])


@router.get(
    "/{run_id}/report",
    operation_id="get_report",
    response_class=Response,
    responses={
        200: {
            "description": "Saved report for the current review revision",
            "content": {"text/html": {"schema": {"type": "string"}}},
        }
    },
)
async def get_report(
    run_id: UUID, db: DB, lang: Locale = "ru", format: Literal["html"] = "html"
) -> HTMLResponse:
    result = await create_export(db, run_id, lang, format)
    return HTMLResponse(
        result.payload,
        headers={
            "X-Delphi-Review-Revision": str(result.review_revision),
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get(
    "/{run_id}/functions.csv",
    operation_id="export_functions",
    response_class=Response,
    responses={
        200: {
            "description": "Function table; source values remain in their original language",
            "content": {"text/csv": {"schema": {"type": "string"}}},
        }
    },
)
async def export_functions(run_id: UUID, db: DB, lang: Locale = "ru") -> Response:
    result = await create_export(db, run_id, lang, "csv")
    return Response(
        result.payload,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="delphi-{run_id}-{lang}.csv"',
            "X-Delphi-Review-Revision": str(result.review_revision),
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post(
    "/{run_id}/translations", operation_id="create_translation", response_model=TranslationResponse
)
async def create_translation(
    run_id: UUID, body: TranslateRequest, request: Request, db: DB
) -> TranslationResponse:
    settings = request.app.state.settings
    return await prepare_translation(
        db,
        run_id,
        body.locale,
        request.app.state.openai_client,
        settings.openai_model,
        settings.request_timeout_seconds,
    )
