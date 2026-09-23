"""Internal snapshots use the product UUID registry, never the lab database."""

import hashlib
import json

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.models import AnalysisOutput, SourceInput
from app.domain.result_validation import validate_output
from app.models import Export, Finding, Function, Run, Translation, Unit

PIPELINE_VERSION = "delphi-0.2"
FAST_PIPELINE_VERSION = "delphi-0.2-fast"


def source_fingerprint(sources: list[SourceInput]) -> str:
    payload = [source.model_dump(mode="json") for source in sorted(sources, key=lambda s: s.id)]
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def resume_available(run: Run) -> bool:
    saved = run.checkpoint
    return bool(
        run.state in {"partial", "failed", "interrupted"}
        and run.pipeline_version == PIPELINE_VERSION
        and isinstance(saved, dict)
        and saved.get("pipeline_version") == PIPELINE_VERSION
        and saved.get("model") == run.model
        and saved.get("review_revision") == run.review_revision
        and saved.get("output")
    )


def load_checkpoint(run: Run, sources: list[SourceInput]) -> AnalysisOutput:
    saved = run.checkpoint
    if (
        not isinstance(saved, dict)
        or run.pipeline_version not in {PIPELINE_VERSION, FAST_PIPELINE_VERSION}
        or saved.get("pipeline_version") != run.pipeline_version
        or saved.get("model") != run.model
        or saved.get("review_revision") != run.review_revision
        or saved.get("source_fingerprint") != source_fingerprint(sources)
    ):
        raise ValueError("Checkpoint does not match this pipeline, model, review or source set")
    output = AnalysisOutput.model_validate(saved["output"])
    validate_output(output, sources)
    return output


def save_checkpoint(run: Run, output: AnalysisOutput, sources: list[SourceInput]) -> None:
    validate_output(output, sources)
    run.checkpoint = {
        "pipeline_version": run.pipeline_version,
        "model": run.model,
        "review_revision": run.review_revision,
        "source_fingerprint": source_fingerprint(sources),
        "output": output.model_dump(mode="json"),
    }


async def clear_generated_result(db: AsyncSession, run: Run) -> None:
    # Caller holds the run lock and has checked that no human review changed.
    # Finding evidence/review rows cascade; input documents and sources are untouched.
    for model in (Export, Translation, Finding, Function, Unit):
        await db.execute(delete(model).where(model.run_id == run.id))
    run.structure = []
