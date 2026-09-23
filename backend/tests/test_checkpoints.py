"""Focused service/state tests: no server, database or model calls."""
import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

import pytest

from app.agent.models import AnalysisOutput, SourceInput
from app.domain.errors import DomainError
from app.models import Run
from app.services.checkpoints import (
    PIPELINE_VERSION,
    load_checkpoint,
    resume_available,
    save_checkpoint,
)
from app.services.runs import RunService
from app.services.workflow import Workflow


def saved_run():
    sources = [SourceInput(
        id=str(uuid4()), document_id=str(uuid4()), side=side,
        text=f'{side} duty', parent_text='Director', locator={'paragraph': 1},
    ) for side in ('before', 'after')]
    output = AnalysisOutput(
        units=[], functions=[], findings=[], structure=[], operations=[], errors=[], partial=True,
        coverage={'total_sources': 2, 'processed_sources': 0,
                  'unprocessed_source_ids': [s.id for s in sources]},
    )
    run = Run(
        id=uuid4(), analysis_id=uuid4(), state='partial', stage='partial',
        model='test-model', pipeline_version=PIPELINE_VERSION, review_revision=0,
        output_language='en', coverage={'input_partial': False}, errors=[], trace=[], structure=[],
    )
    save_checkpoint(run, output, sources)
    return run, sources, output


def test_checkpoint_uses_frozen_text_context_and_locator_not_only_ids():
    run, sources, output = saved_run()
    assert resume_available(run)
    assert load_checkpoint(run, list(reversed(sources))) == output
    for field, value in [('text', 'altered'), ('parent_text', 'Another actor'), ('locator', {'page': 7})]:
        changed = [s.model_copy(deep=True) for s in sources]
        setattr(changed[0], field, value)
        with pytest.raises(ValueError, match='source set'):
            load_checkpoint(run, changed)


@pytest.mark.parametrize('field,value', [
    ('review_revision', 1), ('pipeline_version', 'old-pipeline'), ('model', 'another-model'),
    ('state', 'completed'), ('state', 'running'),
])
def test_continuation_never_overwrites_human_review_or_incompatible_run(field, value):
    run, _, _ = saved_run()
    setattr(run, field, value)
    assert not resume_available(run)


async def test_resume_rejects_review_revision_before_mutation_or_enqueue():
    run, _, _ = saved_run()
    run.review_revision += 1
    db = SimpleNamespace(scalar=AsyncMock(return_value=run), commit=AsyncMock())
    worker = SimpleNamespace(available=True, enqueue=Mock())
    with pytest.raises(DomainError) as error:
        await RunService(db).resume(run.id, SimpleNamespace(openai_model=run.model), worker)
    assert error.value.code == 'resume_unavailable'
    db.commit.assert_not_awaited()
    worker.enqueue.assert_not_called()


async def test_resume_validates_then_invalidates_caches_and_queues_same_run():
    run, sources, _ = saved_run()
    run.errors = ['Transient extraction failure']
    db = SimpleNamespace(scalar=AsyncMock(return_value=run), commit=AsyncMock())
    worker = SimpleNamespace(available=True, enqueue=Mock())
    with patch('app.services.runs.load_run_sources', AsyncMock(return_value=sources)), \
         patch('app.services.runs.validate_registry', AsyncMock()) as registry, \
         patch('app.services.runs.clear_generated_result', AsyncMock()) as clear:
        result = await RunService(db).resume(run.id, SimpleNamespace(openai_model=run.model), worker)
    registry.assert_awaited_once()
    clear.assert_awaited_once()
    assert result.run_id == run.id and result.state == 'queued'
    assert run.review_revision == run.checkpoint['review_revision'] == 1
    assert run.trace[-1]['previous_errors'] == ['Transient extraction failure']
    assert run.errors == [] and run.finished_at is None
    db.commit.assert_awaited_once()
    worker.enqueue.assert_called_once_with(run.id)


async def test_resume_is_idempotent_while_queued():
    run, _, _ = saved_run()
    run.state = 'queued'
    db = SimpleNamespace(scalar=AsyncMock(return_value=run), commit=AsyncMock())
    worker = SimpleNamespace(available=True, enqueue=Mock())
    result = await RunService(db).resume(run.id, SimpleNamespace(openai_model=run.model), worker)
    assert result.state == 'queued'
    db.commit.assert_not_awaited()
    worker.enqueue.assert_not_called()


async def test_interruption_materializes_latest_accepted_checkpoint():
    run, sources, _ = saved_run()
    run.state = 'running'
    db = SimpleNamespace(scalar=AsyncMock(return_value=run), commit=AsyncMock())

    @asynccontextmanager
    async def sessions():
        yield db

    worker = Workflow(sessions, Mock(), 1)
    with patch('app.services.workflow.load_run_sources', AsyncMock(return_value=sources)), \
         patch('app.services.workflow.clear_generated_result', AsyncMock()), \
         patch('app.services.workflow.persist_result', AsyncMock()) as persist:
        await worker._fail(run.id, 'interrupted', 'Application stopped')
    output = persist.await_args.args[2]
    assert output.partial is True and 'Application stopped' in output.errors
    assert output.coverage['unprocessed_source_ids'] == [s.id for s in sources]
    db.commit.assert_awaited_once()


async def test_invalid_checkpoint_does_not_leave_run_running():
    run, sources, _ = saved_run()
    run.state = 'running'
    run.checkpoint['source_fingerprint'] = 'invalid'
    db = SimpleNamespace(scalar=AsyncMock(return_value=run), commit=AsyncMock())

    @asynccontextmanager
    async def sessions():
        yield db

    with patch('app.services.workflow.load_run_sources', AsyncMock(return_value=sources)):
        await Workflow(sessions, Mock(), 1)._fail(run.id, 'failed', 'Stopped')
    assert run.state == 'failed'
    assert 'Saved checkpoint validation failed' in run.errors
    db.commit.assert_awaited_once()


async def test_resume_during_previous_task_teardown_is_not_lost():
    worker = Workflow(Mock(), Mock(), 1)
    worker._execute = AsyncMock()
    gate = asyncio.Event()
    previous = asyncio.create_task(gate.wait())
    run_id = uuid4()
    worker._tasks[run_id] = previous
    worker.enqueue(run_id)
    worker._execute.assert_not_awaited()
    gate.set()
    await previous
    for _ in range(4):
        await asyncio.sleep(0)
    worker._execute.assert_awaited_once_with(run_id)
    await worker.close()
