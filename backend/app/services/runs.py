from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.domain.errors import DomainError
from app.models import Analysis, Document, Finding, Function, Run, SourceBlock, Unit
from app.schemas import RunAccepted, RunDetail, RunResponse, StartRun, UnitResponse
from app.schemas.runs import FunctionResponse
from app.services.checkpoints import (
    FAST_PIPELINE_VERSION,
    PIPELINE_VERSION,
    clear_generated_result,
    load_checkpoint,
    resume_available,
)
from app.services.common import get_or_raise
from app.services.results import validate_registry
from app.services.sources import load_run_sources
from app.services.workflow import Workflow


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
            pipeline_version=(
                FAST_PIPELINE_VERSION if settings.analysis_mode == "fast" else PIPELINE_VERSION
            ),
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
        detail = RunResponse.model_validate(run)
        detail.resume_available = resume_available(run)
        return RunDetail(
            **detail.model_dump(),
            units=[UnitResponse.model_validate(unit) for unit in units],
            finding_count=count,
        )

    async def resume(self, run_id: UUID, settings: Settings, workflow: Workflow) -> RunAccepted:
        run = await self.db.scalar(select(Run).where(Run.id == run_id).with_for_update())
        if run is None:
            raise DomainError(404, "not_found", "Run not found")
        if run.state in {"queued", "running"}:
            return RunAccepted(run_id=run.id, state=run.state)
        if not resume_available(run):
            raise DomainError(
                409, "resume_unavailable", "No compatible checkpoint, or human review has changed"
            )
        if getattr(settings, "analysis_mode", "full") != "full":
            raise DomainError(
                409, "resume_mode_mismatch", "Full checkpoints require ANALYSIS_MODE=full"
            )
        if not workflow.available or settings.openai_model != run.model:
            raise DomainError(409, "resume_model_mismatch", "Resume requires the original AI model")
        sources = await load_run_sources(self.db, run)
        try:
            await validate_registry(self.db, run, sources)
            load_checkpoint(run, sources)
        except (ValueError, KeyError) as exc:
            raise DomainError(409, "invalid_checkpoint", "Checkpoint validation failed") from exc
        await clear_generated_result(self.db, run)
        run.trace = [*run.trace, {"operation": "resume", "previous_errors": run.errors}]
        run.errors = []
        run.review_revision += 1
        run.checkpoint = {**run.checkpoint, "review_revision": run.review_revision}
        run.state = "queued"
        run.stage = "queued"
        run.finished_at = None
        await self.db.commit()
        workflow.enqueue(run.id)
        return RunAccepted(run_id=run.id, state=run.state)

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
