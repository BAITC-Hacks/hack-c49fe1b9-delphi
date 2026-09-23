from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from openai import AsyncOpenAI
from sqlalchemy import text

from app.agent import AnalysisEngine
from app.config import Settings, get_settings
from app.db import create_database
from app.services.workflow import Workflow

WORKER_LOCK_ID = 909_809


def application_lifespan(config: Settings | None):
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        settings = config if config is not None else get_settings()
        engine, sessions = create_database(settings.database_url)
        client = None
        workflow = None
        try:
            async with engine.connect() as worker_connection:
                locked = await worker_connection.scalar(
                    text("SELECT pg_try_advisory_lock(:lock_id)"), {"lock_id": WORKER_LOCK_ID}
                )
                await worker_connection.commit()
                if not locked:
                    raise RuntimeError(
                        "Delphi supports one application worker; stop the other worker"
                    )
                try:
                    settings.storage_path.mkdir(parents=True, exist_ok=True)
                    agent = None
                    if settings.ai_configured:
                        client = AsyncOpenAI(
                            api_key=settings.openai_api_key.get_secret_value(),
                            timeout=settings.request_timeout_seconds,
                            max_retries=0,
                        )
                        agent = AnalysisEngine(
                            client,
                            settings.openai_model,
                            settings.request_timeout_seconds,
                            settings.max_tool_rounds,
                            settings.max_batch_chars,
                        )
                    workflow = Workflow(sessions, agent, settings.run_timeout_seconds)
                    await workflow.recover_interrupted()
                    app.state.settings = settings
                    app.state.session_factory = sessions
                    app.state.openai_client = client
                    app.state.workflow = workflow
                    yield
                finally:
                    if workflow is not None:
                        await workflow.close()
                    await worker_connection.execute(
                        text("SELECT pg_advisory_unlock(:lock_id)"), {"lock_id": WORKER_LOCK_ID}
                    )
                    await worker_connection.commit()
        finally:
            if client is not None:
                await client.close()
            await engine.dispose()

    return lifespan
