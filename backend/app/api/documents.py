from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile

from app.api.dependencies import DB
from app.schemas import DocumentResponse, PatchDocument, Side, SourceResponse
from app.services.documents import DocumentService

router = APIRouter(prefix="/api/analyses/{analysis_id}/documents", tags=["documents"])


def document_service(request: Request, db: DB) -> DocumentService:
    return DocumentService(db, request.app.state.settings)


Documents = Annotated[DocumentService, Depends(document_service)]


@router.post("", status_code=201, response_model=DocumentResponse, operation_id="upload_document")
async def upload_document(
    analysis_id: UUID,
    service: Documents,
    side: Annotated[Side, Form()],
    file: Annotated[UploadFile, File()],
) -> DocumentResponse:
    try:
        content = await file.read(service.settings.max_upload_bytes + 1)
    finally:
        await file.close()
    document = await service.upload(analysis_id, side, file.filename or "", content)
    return await service.describe(document)


@router.patch("/{document_id}", response_model=DocumentResponse, operation_id="update_document")
async def update_document(
    analysis_id: UUID, document_id: UUID, body: PatchDocument, service: Documents
) -> DocumentResponse:
    document = await service.patch(analysis_id, document_id, body)
    return await service.describe(document)


@router.delete("/{document_id}", status_code=204, operation_id="delete_document")
async def delete_document(analysis_id: UUID, document_id: UUID, service: Documents) -> None:
    await service.delete(analysis_id, document_id)


@router.get(
    "/{document_id}/sources",
    response_model=list[SourceResponse],
    operation_id="list_document_sources",
)
async def list_document_sources(
    analysis_id: UUID, document_id: UUID, service: Documents
) -> list[SourceResponse]:
    sources = await service.list_sources(analysis_id, document_id)
    return [SourceResponse.model_validate(source) for source in sources]
