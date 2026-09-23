from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Finding(Base):
    __tablename__ = "findings"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    run_id: Mapped[UUID] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(Text)
    change_type: Mapped[str] = mapped_column(String(50))
    issue_type: Mapped[str | None] = mapped_column(String(50))
    before_function_ids: Mapped[list[str]] = mapped_column(JSONB)
    after_function_ids: Mapped[list[str]] = mapped_column(JSONB)
    explanation: Mapped[str] = mapped_column(Text)
    recommendation: Mapped[str] = mapped_column(Text)
    search: Mapped[dict[str, Any] | None] = mapped_column(JSONB(none_as_null=True))

    __table_args__ = (
        CheckConstraint(
            "jsonb_typeof(before_function_ids) = 'array'", name="ck_findings_before_ids_array"
        ),
        CheckConstraint(
            "jsonb_typeof(after_function_ids) = 'array'", name="ck_findings_after_ids_array"
        ),
        CheckConstraint(
            "search IS NULL OR jsonb_typeof(search) = 'object'", name="ck_findings_search_object"
        ),
        Index("ix_findings_run", "run_id"),
    )


class FindingEvidence(Base):
    __tablename__ = "finding_evidence"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    finding_id: Mapped[UUID] = mapped_column(ForeignKey("findings.id", ondelete="CASCADE"))
    source_id: Mapped[UUID] = mapped_column(ForeignKey("source_blocks.id", ondelete="RESTRICT"))
    evidence_role: Mapped[str] = mapped_column(String(7))
    start_offset: Mapped[int | None] = mapped_column(Integer)
    end_offset: Mapped[int | None] = mapped_column(Integer)

    __table_args__ = (
        CheckConstraint(
            "evidence_role IN ('before', 'after', 'context')", name="ck_finding_evidence_role"
        ),
        CheckConstraint(
            "(start_offset IS NULL AND end_offset IS NULL) OR "
            "(start_offset IS NOT NULL AND end_offset IS NOT NULL AND start_offset >= 0 AND end_offset > start_offset)",
            name="ck_finding_evidence_offsets",
        ),
        Index("ix_finding_evidence_finding", "finding_id"),
        Index("ix_finding_evidence_source", "source_id"),
    )


class Review(Base):
    __tablename__ = "reviews"

    finding_id: Mapped[UUID] = mapped_column(
        ForeignKey("findings.id", ondelete="CASCADE"), primary_key=True
    )
    status: Mapped[str] = mapped_column(String(24))
    note: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint(
            "status IN ('unreviewed', 'confirmed', 'needs_clarification', 'rejected')",
            name="ck_reviews_status",
        ),
    )
