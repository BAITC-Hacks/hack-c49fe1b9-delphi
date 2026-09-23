"""Fast previews remain separate from resumable exhaustive runs."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from test_checkpoints import saved_run

from app.domain.errors import DomainError
from app.services.checkpoints import (
    FAST_PIPELINE_VERSION,
    load_checkpoint,
    resume_available,
    save_checkpoint,
)
from app.services.runs import RunService


def test_fast_checkpoint_can_be_recovered_but_cannot_resume_as_full():
    run, sources, output = saved_run()
    run.pipeline_version = FAST_PIPELINE_VERSION
    save_checkpoint(run, output, sources)
    assert load_checkpoint(run, sources) == output
    assert not resume_available(run)


async def test_full_checkpoint_is_not_sent_to_fast_engine():
    run, _, _ = saved_run()
    db = SimpleNamespace(scalar=AsyncMock(return_value=run), commit=AsyncMock())
    worker = SimpleNamespace(available=True, enqueue=Mock())
    settings = SimpleNamespace(openai_model=run.model, analysis_mode="fast")
    with pytest.raises(DomainError) as error:
        await RunService(db).resume(run.id, settings, worker)
    assert error.value.code == "resume_mode_mismatch"
    db.commit.assert_not_awaited()
    worker.enqueue.assert_not_called()
