import asyncio
import logging
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.agent import AnalysisEngine
from app.agent.models import AnalysisOutput
from app.models import Run
from app.services.checkpoints import clear_generated_result, load_checkpoint, save_checkpoint
from app.services.results import persist_result
from app.services.sources import load_run_sources

logger = logging.getLogger(__name__)


class Workflow:
    def __init__(
        self,
        sessions: async_sessionmaker[AsyncSession],
        agent: AnalysisEngine | None,
        timeout_seconds: float,
    ):
        self.sessions = sessions
        self.agent = agent
        self.timeout_seconds = timeout_seconds
        self._slot = asyncio.Semaphore(1)
        self._tasks: dict[UUID, asyncio.Task] = {}
        self._closing = False

    @property
    def available(self) -> bool:
        return self.agent is not None and not self._closing

    def enqueue(self, run_id: UUID) -> None:
        if not self.available:
            raise RuntimeError("The analysis worker is unavailable")
        previous = self._tasks.get(run_id)
        if previous is not None and not previous.done():
            # A stopped result can become visible just before its task exits.
            # Resume must not disappear in that small window.
            previous.add_done_callback(lambda _: self.enqueue(run_id) if self.available else None)
            return
        task = asyncio.create_task(self._execute(run_id), name=f"analysis-{run_id}")
        self._tasks[run_id] = task

        def finished(_: asyncio.Task) -> None:
            if self._tasks.get(run_id) is task:
                self._tasks.pop(run_id, None)

        task.add_done_callback(finished)

    async def recover_interrupted(self) -> None:
        async with self.sessions() as db:
            run_ids = (
                await db.scalars(
                    select(Run.id).where(Run.state.in_(["queued", "running"]))
                )
            ).all()
        for run_id in run_ids:
            await self._fail(run_id, "interrupted", "Application restarted before the run completed")

    async def close(self) -> None:
        self._closing = True
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _execute(self, run_id: UUID) -> None:
        try:
            async with self._slot, asyncio.timeout(self.timeout_seconds):
                await self._analyze(run_id)
        except asyncio.CancelledError:
            await self._fail(run_id, "interrupted", "Application stopped during the run")
            raise
        except TimeoutError:
            await self._fail(run_id, "failed", "Analysis exceeded RUN_TIMEOUT_SECONDS")
        except Exception:
            logger.exception("Analysis failed: %s", run_id)
            await self._fail(
                run_id, "failed", "Analysis failed; inspect the server log before repeating"
            )

    async def _analyze(self, run_id: UUID) -> None:
        if self.agent is None:
            raise RuntimeError("AI provider is not configured")
        async with self.sessions() as db:
            run = await db.get(Run, run_id)
            if run is None or run.state != "queued":
                return
            run.state = "running"
            run.stage = "extracting"
            run.started_at = datetime.now(UTC)
            sources = await load_run_sources(db, run)
            language = run.output_language
            resume = load_checkpoint(run, sources) if run.checkpoint else None
            await db.commit()

        async def progress(stage: str, coverage: dict) -> None:
            async with self.sessions() as db:
                run = await db.get(Run, run_id)
                if run is None or run.state != "running":
                    raise RuntimeError("Run is no longer active")
                run.stage = stage
                run.coverage = {**run.coverage, **coverage}
                await db.commit()

        async def checkpoint(stage: str, output: AnalysisOutput) -> None:
            async with self.sessions() as db:
                run = await db.scalar(select(Run).where(Run.id == run_id).with_for_update())
                if run is None or run.state != "running":
                    raise RuntimeError("Run is no longer active")
                save_checkpoint(run, output, sources)
                run.stage = stage
                run.coverage = {**run.coverage, **output.coverage}
                await db.commit()

        result = await self.agent.analyze(
            sources, language, progress, checkpoint=checkpoint, resume=resume
        )
        async with self.sessions() as db:
            run = await db.scalar(select(Run).where(Run.id == run_id).with_for_update())
            if run is None or run.state != "running":
                raise RuntimeError("Run is no longer active")
            save_checkpoint(run, result, sources)
            await persist_result(db, run, result, sources)
            run.finished_at = datetime.now(UTC)
            await db.commit()

    async def _fail(self, run_id: UUID, state: str, message: str) -> None:
        try:
            async with self.sessions() as db:
                run = await db.scalar(select(Run).where(Run.id == run_id).with_for_update())
                if run is not None and run.state in {"queued", "running"}:
                    if run.checkpoint:
                        sources = await load_run_sources(db, run)
                        try:
                            output = load_checkpoint(run, sources)
                        except (ValueError, KeyError):
                            run.state = state
                            run.stage = state
                            run.errors = [*run.errors, message, "Saved checkpoint validation failed"]
                        else:
                            output.partial = True
                            output.errors = [*output.errors, message]
                            await clear_generated_result(db, run)
                            await persist_result(db, run, output, sources)
                    else:
                        run.state = state
                        run.stage = state
                        run.errors = [*run.errors, message]
                    run.finished_at = datetime.now(UTC)
                    await db.commit()
        except Exception:
            logger.exception("Could not persist run failure: %s", run_id)
