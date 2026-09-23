import hashlib
from pathlib import Path
from uuid import UUID, uuid4, uuid5

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.config import Settings
from app.domain.errors import DomainError
from app.models import Document, SourceBlock
from app.parsers import ParseError, parse_document
from app.schemas import DocumentResponse, PatchDocument
from app.services.common import get_or_raise, lock_draft


class DocumentService:
    def __init__(self, db: AsyncSession, settings: Settings):
        self.db = db
        self.settings = settings

    async def upload(self, analysis_id: UUID, side: str, filename: str, content: bytes) -> Document:
        if side not in {"before", "after"}:
            raise DomainError(422, "invalid_side", "Document side must be before or after")
        filename = Path(filename.replace("\\", "/")).name
        if not filename or "\x00" in filename:
            raise DomainError(422, "invalid_filename", "A valid filename is required")
        if not content:
            raise DomainError(422, "empty_file", "The uploaded document is empty")
        if len(content) > self.settings.max_upload_bytes:
            raise DomainError(413, "upload_size_limit", "File exceeds MAX_UPLOAD_BYTES")
        try:
            parsed = await run_in_threadpool(
                parse_document,
                filename,
                content,
                max_uncompressed_bytes=self.settings.max_uncompressed_bytes,
            )
        except ParseError as exc:
            raise DomainError(422, exc.code, exc.message) from exc

        await lock_draft(self.db, analysis_id)
        count = await self.db.scalar(
            select(func.count()).select_from(Document).where(Document.analysis_id == analysis_id)
        )
        if count >= self.settings.max_documents_per_analysis:
            raise DomainError(422, "document_limit", "Analysis document limit reached")
        digest = hashlib.sha256(content).hexdigest()
        duplicate = await self.db.scalar(
            select(Document.id).where(
                Document.analysis_id == analysis_id,
                Document.side == side,
                Document.hash == digest,
            )
        )
        if duplicate:
            raise DomainError(
                409, "duplicate_document", "This document is already uploaded on this side"
            )

        identifier = uuid4()
        extension = Path(filename).suffix.lower()
        storage_key = str(identifier) + extension
        path = self.settings.storage_path / storage_key
        has_gaps = any(
            not warning.startswith("table_of_contents_skipped:") for warning in parsed.warnings
        )
        document = Document(
            id=identifier,
            analysis_id=analysis_id,
            side=side,
            filename=filename,
            storage_key=storage_key,
            hash=digest,
            revision_label=parsed.revision_label,
            format=extension.removeprefix("."),
            detected_language=parsed.detected_language,
            parse_status="partial" if has_gaps else "parsed",
            warnings=parsed.warnings,
        )
        sources = {
            block.key: SourceBlock(
                id=uuid5(identifier, block.key),
                document_id=identifier,
                clause_no=block.clause_no,
                parent_id=None,
                locator={**block.locator, "block_index": index},
                original_text=block.original_text,
                normalized_text=block.normalized_text,
            )
            for index, block in enumerate(parsed.blocks)
        }
        try:
            await run_in_threadpool(path.write_bytes, content)
            self.db.add(document)
            await self.db.flush()
            self.db.add_all(sources.values())
            await self.db.flush()
            for block in parsed.blocks:
                if block.parent_key is not None:
                    sources[block.key].parent_id = sources[block.parent_key].id
            await self.db.commit()
        except Exception:
            await self.db.rollback()
            await run_in_threadpool(path.unlink, missing_ok=True)
            raise
        return document

    async def patch(self, analysis_id: UUID, document_id: UUID, body: PatchDocument) -> Document:
        await lock_draft(self.db, analysis_id)
        document = await self._document(analysis_id, document_id)
        if "side" in body.model_fields_set:
            if body.side is None:
                raise DomainError(422, "invalid_side", "Document side cannot be null")
            duplicate = await self.db.scalar(
                select(Document.id).where(
                    Document.analysis_id == analysis_id,
                    Document.side == body.side,
                    Document.hash == document.hash,
                    Document.id != document_id,
                )
            )
            if duplicate:
                raise DomainError(
                    409, "duplicate_document", "The destination already contains this document"
                )
            document.side = body.side
        if "revision_label" in body.model_fields_set:
            document.revision_label = body.revision_label
        await self.db.commit()
        return document

    async def delete(self, analysis_id: UUID, document_id: UUID) -> None:
        await lock_draft(self.db, analysis_id)
        document = await self._document(analysis_id, document_id)
        storage_key = document.storage_key
        await self.db.delete(document)
        await self.db.commit()
        references = await self.db.scalar(
            select(func.count()).select_from(Document).where(Document.storage_key == storage_key)
        )
        if references == 0:
            path = self.settings.storage_path / storage_key
            await run_in_threadpool(path.unlink, missing_ok=True)

    async def list_sources(self, analysis_id: UUID, document_id: UUID) -> list[SourceBlock]:
        await self._document(analysis_id, document_id)
        sources = await self.db.scalars(
            select(SourceBlock)
            .where(SourceBlock.document_id == document_id)
            .order_by(SourceBlock.locator["block_index"].as_integer())
        )
        return list(sources)

    async def describe(self, document: Document) -> DocumentResponse:
        count = await self.db.scalar(
            select(func.count())
            .select_from(SourceBlock)
            .where(SourceBlock.document_id == document.id)
        )
        return DocumentResponse(
            id=document.id,
            analysis_id=document.analysis_id,
            side=document.side,
            filename=document.filename,
            hash=document.hash,
            revision_label=document.revision_label,
            format=document.format,
            detected_language=document.detected_language,
            parse_status=document.parse_status,
            warnings=document.warnings,
            created_at=document.created_at,
            block_count=count,
        )

    async def _document(self, analysis_id: UUID, document_id: UUID) -> Document:
        document = await get_or_raise(self.db, Document, document_id)
        if document.analysis_id != analysis_id:
            raise DomainError(404, "document_not_found", "Document not found")
        return document
