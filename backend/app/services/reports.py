from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.errors import DomainError
from app.models import (
    Analysis,
    Document,
    Export,
    Finding,
    FindingEvidence,
    Function,
    Review,
    Run,
    SourceBlock,
    Translation,
    Unit,
)
from app.reporting.rendering import (
    original_payload,
    render_functions_csv,
    render_report,
    source_excerpt,
    validate_translation,
)
from app.reporting.types import RenderedExport, ReportSnapshot
from app.schemas.common import Locale, TranslatedPayload


async def capture_snapshot(db: AsyncSession, run_id: UUID) -> ReportSnapshot:
    run = await db.scalar(select(Run).where(Run.id == run_id).with_for_update())
    if run is None:
        raise DomainError(404, "run_not_found", "Run not found")
    if run.state not in {"completed", "partial"}:
        raise DomainError(409, "run_not_finished", "Reports require a completed or partial run")
    analysis = await db.get(Analysis, run.analysis_id)
    if analysis is None:
        raise DomainError(409, "incomplete_saved_result", "Run is missing its analysis")
    try:
        document_ids = [UUID(value) for value in run.immutable_document_ids]
    except (ValueError, TypeError, AttributeError) as exc:
        raise DomainError(409, "invalid_document_set", "Run contains invalid document IDs") from exc
    documents = list(
        await db.scalars(
            select(Document)
            .where(
                Document.analysis_id == run.analysis_id,
                Document.id.in_(document_ids),
            )
            .order_by(Document.created_at, Document.id)
        )
    )
    documents_by_id = {document.id: document for document in documents}
    if (
        not document_ids
        or len(document_ids) != len(set(document_ids))
        or set(documents_by_id) != set(document_ids)
        or {document.side for document in documents} != {"before", "after"}
    ):
        raise DomainError(
            409, "incomplete_saved_result", "Run is missing its complete document set"
        )
    findings = list(
        await db.scalars(select(Finding).where(Finding.run_id == run_id).order_by(Finding.id))
    )
    finding_ids = [finding.id for finding in findings]
    reviews = {
        row.finding_id: row
        for row in await db.scalars(select(Review).where(Review.finding_id.in_(finding_ids)))
    }
    if set(reviews) != set(finding_ids):
        raise DomainError(
            409, "incomplete_saved_result", "A finding is missing its saved review state"
        )
    sources = {
        row.id: row
        for row in await db.scalars(
            select(SourceBlock).where(
                SourceBlock.document_id.in_([document.id for document in documents]),
            )
        )
    }
    evidence = {finding_id: [] for finding_id in finding_ids}
    for row in await db.scalars(
        select(FindingEvidence)
        .where(FindingEvidence.finding_id.in_(finding_ids))
        .order_by(FindingEvidence.id)
    ):
        if row.source_id not in sources:
            raise DomainError(
                409, "invalid_saved_evidence", "Evidence references a source outside this run"
            )
        source = sources[row.source_id]
        side = documents_by_id[source.document_id].side
        if row.evidence_role != "context" and row.evidence_role != side:
            raise DomainError(
                409, "invalid_saved_evidence", "Evidence has the wrong comparison side"
            )
        source_excerpt(source, row)
        evidence[row.finding_id].append(row)
    if any(not items for items in evidence.values()):
        raise DomainError(409, "incomplete_saved_result", "A finding is missing its saved evidence")
    functions = list(
        await db.scalars(
            select(Function).where(Function.run_id == run_id).order_by(Function.side, Function.id)
        )
    )
    units = {
        str(row.id): row for row in await db.scalars(select(Unit).where(Unit.run_id == run_id))
    }
    return ReportSnapshot(
        run_id=run.id,
        review_revision=run.review_revision,
        output_language=run.output_language,
        title=analysis.title,
        state=run.state,
        coverage=run.coverage,
        errors=run.errors,
        documents=documents_by_id,
        findings=findings,
        reviews=reviews,
        evidence=evidence,
        sources=sources,
        functions=functions,
        units=units,
    )


def read_translation(snapshot: ReportSnapshot, translation: Translation) -> TranslatedPayload:
    if (
        translation.review_revision != snapshot.review_revision
        or translation.run_id != snapshot.run_id
    ):
        raise DomainError(
            409, "stale_translation", "Translation belongs to another review revision"
        )
    try:
        payload = TranslatedPayload.model_validate(translation.payload)
    except ValidationError as exc:
        raise DomainError(409, "invalid_saved_translation", "Saved translation is invalid") from exc
    validate_translation(snapshot, payload)
    return payload


async def create_export(
    db: AsyncSession, run_id: UUID, locale: Locale, file_format: str
) -> RenderedExport:
    async with db.begin():
        snapshot = await capture_snapshot(db, run_id)
        cached = await db.scalar(
            select(Export).where(
                Export.run_id == run_id,
                Export.review_revision == snapshot.review_revision,
                Export.locale == locale,
                Export.format == file_format,
            )
        )
        if cached is not None:
            return RenderedExport(cached.payload, snapshot.review_revision)
        if file_format == "csv":
            rendered = render_functions_csv(snapshot, locale)
        elif file_format == "html":
            if locale == snapshot.output_language:
                payload = original_payload(snapshot)
            else:
                translation = await db.scalar(
                    select(Translation).where(
                        Translation.run_id == run_id,
                        Translation.review_revision == snapshot.review_revision,
                        Translation.locale == locale,
                    )
                )
                if translation is None:
                    raise DomainError(
                        409,
                        "translation_required",
                        "Prepare a translation for the current review revision first",
                    )
                payload = read_translation(snapshot, translation)
            rendered = render_report(snapshot, locale, payload)
        else:
            raise DomainError(
                422, "unsupported_report_format", "Supported report formats are html and csv"
            )
        db.add(
            Export(
                run_id=run_id,
                review_revision=snapshot.review_revision,
                locale=locale,
                format=file_format,
                payload=rendered,
            )
        )
        return RenderedExport(rendered, snapshot.review_revision)
