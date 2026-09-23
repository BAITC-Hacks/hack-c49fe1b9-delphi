import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from app.domain.errors import DomainError
from app.schemas.errors import ErrorDetail, ErrorResponse

logger = logging.getLogger(__name__)
ERROR_RESPONSES = {
    status: {"model": ErrorResponse} for status in (404, 409, 413, 422, 500, 502, 503, 504)
}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def domain_error(request: Request, exc: DomainError) -> JSONResponse:
        body = ErrorResponse(code=exc.code, message=exc.message, details=[])
        return JSONResponse(status_code=exc.status_code, content=body.model_dump())

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        body = ErrorResponse(
            code="validation_error",
            message="Request validation failed",
            details=[
                ErrorDetail(location=list(error["loc"]), message=error["msg"], type=error["type"])
                for error in exc.errors()
            ],
        )
        return JSONResponse(status_code=422, content=body.model_dump())

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        body = ErrorResponse(code="http_error", message=str(exc.detail), details=[])
        return JSONResponse(
            status_code=exc.status_code, content=body.model_dump(), headers=exc.headers
        )

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        logger.error(
            "Unhandled request error: %s %s", request.method, request.url.path, exc_info=exc
        )
        body = ErrorResponse(
            code="internal_error", message="An unexpected server error occurred", details=[]
        )
        return JSONResponse(status_code=500, content=body.model_dump())
