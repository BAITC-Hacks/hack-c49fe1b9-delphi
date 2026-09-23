from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent.models import AnalysisOutput, SourceInput
from app.domain.result_validation import unique_ids, uuid_value, validate_output
from app.models import Document, Finding, FindingEvidence, Function, Review, Run, SourceBlock, Unit


async def persist_result(
    db: AsyncSession, run: Run, output: AnalysisOutput, sources: list[SourceInput]
) -> None:
    with db.no_autoflush:
        await validate_registry(db, run, sources)
        result = output.model_copy(deep=True)
        input_partial = run.coverage.get("input_partial") is True
        if input_partial:
            mark_incomplete_input(result, run.output_language)
        validate_output(result, sources)

    units = {}
    for item in result.units:
        record = Unit(
            id=uuid_value(item.id),
            run_id=run.id,
            side=item.side,
            kind=item.kind,
            name_original=item.name_original,
            parent_unit_id=None,
            source_ids=item.source_ids,
        )
        units[item.id] = record
        db.add(record)
    await db.flush()
    for item in result.units:
        if item.parent_unit_id is not None:
            units[item.id].parent_unit_id = uuid_value(item.parent_unit_id)
    for item in result.functions:
        db.add(Function(id=uuid_value(item.id), run_id=run.id, **item.model_dump(exclude={"id"})))
    for item in result.findings:
        db.add(
            Finding(
                id=uuid_value(item.id),
                run_id=run.id,
                **item.model_dump(exclude={"id", "evidence"}),
            )
        )
    await db.flush()
    for item in result.findings:
        finding_id = uuid_value(item.id)
        db.add(Review(finding_id=finding_id, status="unreviewed", note=""))
        for evidence in item.evidence:
            db.add(
                FindingEvidence(
                    finding_id=finding_id,
                    source_id=uuid_value(evidence.source_id),
                    evidence_role=evidence.evidence_role,
                    start_offset=evidence.start_offset,
                    end_offset=evidence.end_offset,
                )
            )
    input_metadata = {
        key: value
        for key, value in run.coverage.items()
        if key in {"input_partial", "allow_partial", "input_warnings"}
    }
    run.coverage = {**run.coverage, **result.coverage, **input_metadata}
    run.structure = [match.model_dump() for match in result.structure]
    run.errors = [*run.errors, *result.errors]
    run.trace = [*run.trace, *result.operations]
    run.state = "partial" if result.partial or run.errors or input_partial else "completed"
    run.stage = run.state
    run.finished_at = datetime.now(UTC)


async def validate_registry(db: AsyncSession, run: Run, sources: list[SourceInput]) -> None:
    registry = unique_ids(sources)
    document_ids = [uuid_value(value) for value in run.immutable_document_ids]
    if not document_ids or len(set(document_ids)) != len(document_ids):
        raise ValueError("Run has an invalid immutable document set")
    documents = (await db.scalars(select(Document).where(Document.id.in_(document_ids)))).all()
    if {document.id for document in documents} != set(document_ids):
        raise ValueError("Run references a missing document")
    if any(document.analysis_id != run.analysis_id for document in documents):
        raise ValueError("Run references a document from another analysis")
    document_map = {str(document.id): document for document in documents}
    blocks = (
        await db.scalars(select(SourceBlock).where(SourceBlock.document_id.in_(document_ids)))
    ).all()
    if set(registry) != {str(block.id) for block in blocks}:
        raise ValueError("Result source registry differs from the frozen document set")
    block_map = {block.id: block for block in blocks}
    for block in blocks:
        source = registry[str(block.id)]
        ancestors = []
        visited = {block.id}
        parent_id = block.parent_id
        while parent_id is not None:
            if parent_id in visited or parent_id not in block_map:
                raise ValueError("Source hierarchy contains a cycle or an unknown parent")
            parent = block_map[parent_id]
            if parent.document_id != block.document_id:
                raise ValueError("Source parent belongs to a different document")
            ancestors.append(parent.original_text)
            visited.add(parent_id)
            parent_id = parent.parent_id
        parent_text = "\n".join(reversed(ancestors)) if ancestors else None
        if (
            source.document_id != str(block.document_id)
            or source.side != document_map[str(block.document_id)].side
            or source.text != block.original_text
            or source.clause_no != block.clause_no
            or source.parent_text != parent_text
            or (source.locator is not None and source.locator != block.locator)
        ):
            raise ValueError("Result source metadata differs from the saved source")


def mark_incomplete_input(output: AnalysisOutput, language: str) -> None:
    output.partial = True
    messages = {
        "ru": (
            "Соответствие требует проверки",
            "Часть документов прочитана не полностью. Потеря или появление функции не установлены.",
        ),
        "kk": (
            "Сәйкестікті тексеру қажет",
            "Құжаттардың бір бөлігі толық оқылмады. Функцияның жоғалуы немесе пайда болуы анықталған жоқ.",
        ),
        "en": (
            "Function mapping needs review",
            "Some documents were not fully read. A missing or new duty has not been established.",
        ),
    }
    recommendations = {
        "ru": "Прочитайте недостающие источники и повторно проверьте распределение ответственности.",
        "kk": "Жетіспейтін дереккөздерді оқып, жауапкершіліктің бөлінуін қайта тексеріңіз.",
        "en": "Read the missing sources and review the distribution of responsibilities again.",
    }
    if language not in messages:
        raise ValueError("Unsupported result language")
    for finding in output.findings:
        if finding.change_type not in {"potentially_missing", "new"}:
            continue
        finding.change_type = "changed"
        finding.issue_type = "insufficient_evidence"
        finding.title, finding.explanation = messages[language]
        finding.recommendation = recommendations[language]
        if finding.search is not None:
            finding.search = {**finding.search, "complete": False, "input_partial": True}
