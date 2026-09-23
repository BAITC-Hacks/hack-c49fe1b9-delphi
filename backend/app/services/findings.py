from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.errors import DomainError
from app.models import Document, Finding, FindingEvidence, Review, Run, SourceBlock
from app.schemas import (
    EvidenceResponse,
    FindingResponse,
    ReviewResponse,
    ReviewUpdated,
    SourceResponse,
    UpdateReview,
)
from app.services.common import get_or_raise


class FindingService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_findings(self, run_id: UUID) -> list[FindingResponse]:
        run = await get_or_raise(self.db, Run, run_id)
        findings = list(
            await self.db.scalars(
                select(Finding).where(Finding.run_id == run_id).order_by(Finding.id)
            )
        )
        if not findings:
            return []
        identifiers = [finding.id for finding in findings]
        reviews = {
            review.finding_id: review
            for review in await self.db.scalars(
                select(Review).where(Review.finding_id.in_(identifiers))
            )
        }
        if set(reviews) != set(identifiers):
            raise DomainError(
                409, "incomplete_saved_result", "A finding is missing its saved review state"
            )
        evidence = await self._evidence_by_finding(run, identifiers)
        return [
            FindingResponse(
                id=finding.id,
                run_id=finding.run_id,
                title=finding.title,
                change_type=finding.change_type,
                issue_type=finding.issue_type,
                before_function_ids=finding.before_function_ids,
                after_function_ids=finding.after_function_ids,
                explanation=finding.explanation,
                recommendation=finding.recommendation,
                source_ids=list(dict.fromkeys(item.source_id for item in evidence[finding.id])),
                search=finding.search,
                review=ReviewResponse.model_validate(reviews[finding.id]),
            )
            for finding in findings
        ]

    async def get_evidence(self, finding_id: UUID) -> list[EvidenceResponse]:
        finding = await get_or_raise(self.db, Finding, finding_id)
        run = await get_or_raise(self.db, Run, finding.run_id)
        evidence = await self._evidence_by_finding(run, [finding_id])
        return evidence[finding_id]

    async def update_review(self, finding_id: UUID, body: UpdateReview) -> ReviewUpdated:
        finding = await get_or_raise(self.db, Finding, finding_id)
        run = await self.db.scalar(select(Run).where(Run.id == finding.run_id).with_for_update())
        if run is None:
            raise DomainError(409, "incomplete_saved_result", "The finding run is missing")
        review = await self.db.get(Review, finding_id)
        if review is None:
            raise DomainError(
                409, "incomplete_saved_result", "The finding is missing its saved review state"
            )
        if review.status != body.status or review.note != body.note:
            review.status = body.status
            review.note = body.note
            review.updated_at = datetime.now(UTC)
            run.review_revision += 1
        await self.db.commit()
        return ReviewUpdated(
            finding_id=review.finding_id,
            status=review.status,
            note=review.note,
            updated_at=review.updated_at,
            review_revision=run.review_revision,
        )

    async def get_source(self, source_id: UUID) -> SourceResponse:
        source = await get_or_raise(self.db, SourceBlock, source_id)
        return SourceResponse.model_validate(source)

    async def _evidence_by_finding(
        self, run: Run, finding_ids: list[UUID]
    ) -> dict[UUID, list[EvidenceResponse]]:
        evidence = {identifier: [] for identifier in finding_ids}
        rows = await self.db.execute(
            select(FindingEvidence, SourceBlock, Document)
            .outerjoin(SourceBlock, SourceBlock.id == FindingEvidence.source_id)
            .outerjoin(Document, Document.id == SourceBlock.document_id)
            .where(FindingEvidence.finding_id.in_(finding_ids))
            .order_by(FindingEvidence.finding_id, FindingEvidence.id)
        )
        document_ids = set(run.immutable_document_ids)
        for item, source, document in rows:
            if (
                source is None
                or document is None
                or document.analysis_id != run.analysis_id
                or str(document.id) not in document_ids
            ):
                raise DomainError(
                    409, "invalid_saved_evidence", "Evidence references a source outside this run"
                )
            if item.evidence_role != "context" and item.evidence_role != document.side:
                raise DomainError(
                    409, "invalid_saved_evidence", "Evidence has the wrong comparison side"
                )
            evidence[item.finding_id].append(
                EvidenceResponse(
                    source_id=source.id,
                    document_id=document.id,
                    filename=document.filename,
                    side=document.side,
                    clause_no=source.clause_no,
                    original_text=source.original_text,
                    excerpt=self._excerpt(source, item),
                    locator=source.locator,
                    evidence_role=item.evidence_role,
                    start_offset=item.start_offset,
                    end_offset=item.end_offset,
                )
            )
        if any(not items for items in evidence.values()):
            raise DomainError(
                409, "invalid_saved_evidence", "A finding is missing its saved evidence"
            )
        return evidence

    @staticmethod
    def _excerpt(source: SourceBlock, evidence: FindingEvidence) -> str:
        start, end = evidence.start_offset, evidence.end_offset
        if start is None and end is None:
            return source.original_text
        if start is None or end is None or not 0 <= start < end <= len(source.original_text):
            raise DomainError(
                409, "invalid_saved_evidence", "Evidence offsets are outside the saved source"
            )
        return source.original_text[start:end]
