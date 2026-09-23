from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.errors import DomainError
from app.models import Analysis, Document, Run, SourceBlock
from app.schemas import (
    AnalysisDetail,
    AnalysisListItem,
    AnalysisResponse,
    DocumentResponse,
    RunResponse,
)
from app.services.common import get_or_raise, record


class AnalysisService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, title: str) -> AnalysisResponse:
        analysis = Analysis(title=title)
        self.db.add(analysis)
        await self.db.commit()
        return AnalysisResponse.model_validate(analysis)

    async def list(self) -> list[AnalysisListItem]:
        rows = (
            await self.db.execute(
                select(Analysis, Run).outerjoin(Run).order_by(Analysis.created_at.desc())
            )
        ).all()
        return [
            AnalysisListItem(
                **record(analysis),
                run_id=run.id if run else None,
                state=run.state if run else "draft",
            )
            for analysis, run in rows
        ]

    async def get(self, analysis_id: UUID) -> AnalysisDetail:
        analysis = await get_or_raise(self.db, Analysis, analysis_id)
        rows = (
            await self.db.execute(
                select(Document, func.count(SourceBlock.id))
                .outerjoin(SourceBlock)
                .where(Document.analysis_id == analysis_id)
                .group_by(Document.id)
                .order_by(Document.created_at, Document.id)
            )
        ).all()
        run = await self.db.scalar(select(Run).where(Run.analysis_id == analysis_id))
        return AnalysisDetail(
            **record(analysis),
            documents=[
                DocumentResponse(**record(doc, exclude=("storage_key",)), block_count=count)
                for doc, count in rows
            ],
            run=RunResponse.model_validate(run) if run else None,
        )

    async def repeat(self, analysis_id: UUID) -> AnalysisResponse:
        original = await self.db.scalar(
            select(Analysis).where(Analysis.id == analysis_id).with_for_update()
        )
        if original is None:
            raise DomainError(404, "not_found", "Analysis not found")
        analysis = Analysis(title=original.title)
        self.db.add(analysis)
        await self.db.flush()
        documents = (
            await self.db.scalars(
                select(Document)
                .where(Document.analysis_id == analysis_id)
                .order_by(Document.created_at, Document.id)
            )
        ).all()
        for old in documents:
            new = Document(
                id=uuid4(),
                analysis_id=analysis.id,
                **record(old, exclude=("id", "analysis_id", "created_at")),
            )
            self.db.add(new)
            await self.db.flush()
            await self._clone_sources(old.id, new.id)
        await self.db.commit()
        return AnalysisResponse.model_validate(analysis)

    async def _clone_sources(self, old_document_id: UUID, new_document_id: UUID) -> None:
        blocks = (
            await self.db.scalars(
                select(SourceBlock).where(SourceBlock.document_id == old_document_id)
            )
        ).all()
        clones = {
            block.id: SourceBlock(
                id=uuid4(),
                document_id=new_document_id,
                parent_id=None,
                **record(block, exclude=("id", "document_id", "parent_id")),
            )
            for block in blocks
        }
        self.db.add_all(clones.values())
        await self.db.flush()
        for block in blocks:
            if block.parent_id is not None:
                clones[block.id].parent_id = clones[block.parent_id].id
