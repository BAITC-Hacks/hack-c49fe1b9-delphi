from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.domain.errors import DomainError
from app.models import Analysis, Document, Finding, Function, Run, SourceBlock, Unit
from app.schemas import RunAccepted, RunDetail, RunResponse, StartRun, UnitResponse
from app.schemas.runs import FunctionResponse
from app.services.common import get_or_raise
from app.services.workflow import Workflow

PIPELINE_VERSION = "delphi-0.1"


class RunService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def start(
        self, analysis_id: UUID, body: StartRun, settings: Settings, workflow: Workflow
    ) -> RunAccepted:
        analysis = await self.db.scalar(
            select(Analysis).where(Analysis.id == analysis_id).with_for_update()
        )
        if analysis is None:
            raise DomainError(404, "not_found", "Analysis not found")
        existing = await self.db.scalar(select(Run).where(Run.analysis_id == analysis_id))
        if existing is not None:
            if (
                existing.output_language != body.output_language
                or existing.coverage["allow_partial"] != body.allow_partial
            ):
                raise DomainError(409, "run_exists", "Repeat the analysis to use different options")
            return RunAccepted(run_id=existing.id, state=existing.state)
        if not workflow.available or settings.openai_model is None:
            raise DomainError(503, "ai_not_configured", "Set OPENAI_API_KEY and OPENAI_MODEL")
        rows = (
            await self.db.execute(
                select(Document, func.count(SourceBlock.id))
                .outerjoin(SourceBlock)
                .where(Document.analysis_id == analysis_id)
                .group_by(Document.id)
                .order_by(Document.created_at, Document.id)
            )
        ).all()
        if {doc.side for doc, _ in rows} != {"before", "after"}:
            raise DomainError(422, "missing_side", "Upload at least one document on each side")
        if any(doc.parse_status not in {"parsed", "partial"} or count == 0 for doc, count in rows):
            raise DomainError(422, "unreadable_document", "Every document needs readable sources")
        partial = any(doc.parse_status == "partial" for doc, _ in rows)
        if partial and not body.allow_partial:
            raise DomainError(
                409, "partial_input", "Review parsing warnings and explicitly allow partial input"
            )
        run = Run(
            analysis_id=analysis_id,
            immutable_document_ids=[str(doc.id) for doc, _ in rows],
            state="queued",
            stage="queued",
            model=settings.openai_model,
            output_language=body.output_language,
            pipeline_version=PIPELINE_VERSION,
            review_revision=0,
            structure=[],
            errors=[],
            trace=[],
            coverage={
                "allow_partial": body.allow_partial,
                "input_partial": partial,
                "total_documents": len(rows),
                "total_sources": sum(count for _, count in rows),
                "input_warnings": {str(doc.id): doc.warnings for doc, _ in rows if doc.warnings},
                "processed_sources": 0,
                "before_functions": 0,
                "compared_before_functions": 0,
                "after_functions": 0,
                "reviewed_after_functions": 0,
                "structure_units": 0,
                "reviewed_structure_units": 0,
                "unprocessed_source_ids": [],
                "unreviewed_function_ids": [],
            },
        )
        self.db.add(run)
        await self.db.commit()
        workflow.enqueue(run.id)
        return RunAccepted(run_id=run.id, state=run.state)

    async def get(self, run_id: UUID) -> RunDetail:
        run = await get_or_raise(self.db, Run, run_id)
        units = (
            await self.db.scalars(
                select(Unit)
                .where(Unit.run_id == run_id)
                .order_by(Unit.side, Unit.name_original, Unit.id)
            )
        ).all()
        count = await self.db.scalar(
            select(func.count()).select_from(Finding).where(Finding.run_id == run_id)
        )
        return RunDetail(
            **RunResponse.model_validate(run).model_dump(),
            units=[UnitResponse.model_validate(unit) for unit in units],
            finding_count=count,
        )

    async def functions(self, run_id: UUID) -> list[FunctionResponse]:
        await get_or_raise(self.db, Run, run_id)
        rows = (
            await self.db.scalars(
                select(Function)
                .where(Function.run_id == run_id)
                .order_by(Function.side, Function.id)
            )
        ).all()
        return [FunctionResponse.model_validate(row) for row in rows]
