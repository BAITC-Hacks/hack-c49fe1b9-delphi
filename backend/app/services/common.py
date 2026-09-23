from uuid import UUID

from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.errors import DomainError
from app.models import Analysis, Run


def record(row, *, exclude: tuple[str, ...] = ()) -> dict:
    return {
        column.key: getattr(row, column.key)
        for column in inspect(row).mapper.column_attrs
        if column.key not in exclude
    }


async def get_or_raise(db: AsyncSession, model, identifier: UUID):
    row = await db.get(model, identifier)
    if row is None:
        raise DomainError(404, "not_found", f"{model.__name__} not found")
    return row


async def lock_draft(db: AsyncSession, analysis_id: UUID) -> Analysis:
    analysis = await db.scalar(select(Analysis).where(Analysis.id == analysis_id).with_for_update())
    if analysis is None:
        raise DomainError(404, "not_found", "Analysis not found")
    if await db.scalar(select(Run.id).where(Run.analysis_id == analysis_id)):
        raise DomainError(409, "immutable_analysis", "Create a new comparison to change documents")
    return analysis
