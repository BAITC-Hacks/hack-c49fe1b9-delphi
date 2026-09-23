from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent import SourceInput
from app.models import Document, Run, SourceBlock


async def load_run_sources(db: AsyncSession, run: Run) -> list[SourceInput]:
    document_ids = [UUID(identifier) for identifier in run.immutable_document_ids]
    rows = (
        await db.execute(
            select(SourceBlock, Document)
            .join(Document)
            .where(Document.id.in_(document_ids), Document.analysis_id == run.analysis_id)
            .order_by(
                Document.created_at, Document.id, SourceBlock.locator["block_index"].as_integer()
            )
        )
    ).all()
    if {str(doc.id) for _, doc in rows} != set(run.immutable_document_ids):
        raise ValueError("The immutable document set is incomplete")
    blocks = {block.id: block for block, _ in rows}
    sources = []
    for block, doc in rows:
        ancestors: list[str] = []
        visited = {block.id}
        parent_id = block.parent_id
        while parent_id is not None:
            if parent_id in visited or parent_id not in blocks:
                raise ValueError("Invalid source hierarchy")
            parent = blocks[parent_id]
            if parent.document_id != block.document_id:
                raise ValueError("Source parent belongs to a different document")
            ancestors.append(parent.original_text)
            visited.add(parent_id)
            parent_id = parent.parent_id
        sources.append(
            SourceInput(
                id=str(block.id),
                document_id=str(doc.id),
                side=doc.side,
                clause_no=block.clause_no,
                text=block.original_text,
                parent_text="\n".join(reversed(ancestors)) if ancestors else None,
                locator=block.locator,
            )
        )
    return sources
