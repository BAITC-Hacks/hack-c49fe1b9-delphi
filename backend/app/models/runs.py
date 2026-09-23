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
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    analysis_id: Mapped[UUID] = mapped_column(ForeignKey("analyses.id", ondelete="CASCADE"))
    immutable_document_ids: Mapped[list[str]] = mapped_column(JSONB)
    state: Mapped[str] = mapped_column(String(16))
    stage: Mapped[str] = mapped_column(String(100))
    coverage: Mapped[dict[str, Any]] = mapped_column(JSONB)
    structure: Mapped[list[Any]] = mapped_column(JSONB)
    model: Mapped[str] = mapped_column(String(200))
    output_language: Mapped[str] = mapped_column(String(2))
    pipeline_version: Mapped[str] = mapped_column(String(100))
    review_revision: Mapped[int] = mapped_column(Integer, server_default="0")
    errors: Mapped[list[Any]] = mapped_column(JSONB)
    trace: Mapped[list[Any]] = mapped_column(JSONB)
    checkpoint: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("analysis_id", name="uq_runs_analysis"),
        CheckConstraint(
            "state IN ('queued', 'running', 'completed', 'partial', 'failed', 'interrupted')",
            name="ck_runs_state",
        ),
        CheckConstraint("output_language IN ('ru', 'kk', 'en')", name="ck_runs_output_language"),
        CheckConstraint("review_revision >= 0", name="ck_runs_review_revision"),
        CheckConstraint(
            "jsonb_typeof(immutable_document_ids) = 'array'", name="ck_runs_document_ids_array"
        ),
        CheckConstraint("jsonb_typeof(coverage) = 'object'", name="ck_runs_coverage_object"),
        CheckConstraint("jsonb_typeof(structure) = 'array'", name="ck_runs_structure_array"),
        CheckConstraint("jsonb_typeof(errors) = 'array'", name="ck_runs_errors_array"),
        CheckConstraint("jsonb_typeof(trace) = 'array'", name="ck_runs_trace_array"),
        CheckConstraint(
            "finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at",
            name="ck_runs_timestamps",
        ),
        Index("ix_runs_state", "state"),
    )


class Unit(Base):
    __tablename__ = "units"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    run_id: Mapped[UUID] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"))
    side: Mapped[str] = mapped_column(String(6))
    kind: Mapped[str] = mapped_column(String(16))
    name_original: Mapped[str] = mapped_column(Text)
    parent_unit_id: Mapped[UUID | None] = mapped_column(ForeignKey("units.id", ondelete="SET NULL"))
    source_ids: Mapped[list[str]] = mapped_column(JSONB)

    __table_args__ = (
        CheckConstraint("side IN ('before', 'after')", name="ck_units_side"),
        CheckConstraint("kind IN ('department', 'role', 'group')", name="ck_units_kind"),
        CheckConstraint("jsonb_typeof(source_ids) = 'array'", name="ck_units_source_ids_array"),
        CheckConstraint(
            "parent_unit_id IS NULL OR parent_unit_id <> id", name="ck_units_parent_not_self"
        ),
        Index("ix_units_run_side", "run_id", "side"),
        Index("ix_units_parent", "parent_unit_id"),
    )


class Function(Base):
    __tablename__ = "functions"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    run_id: Mapped[UUID] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"))
    side: Mapped[str] = mapped_column(String(6))
    owner_unit_ids: Mapped[list[str]] = mapped_column(JSONB)
    actor_original: Mapped[str] = mapped_column(Text)
    action: Mapped[str] = mapped_column(Text)
    object: Mapped[str] = mapped_column(Text)
    scope: Mapped[str] = mapped_column(Text)
    condition: Mapped[str] = mapped_column(Text)
    modality: Mapped[str] = mapped_column(Text)
    source_ids: Mapped[list[str]] = mapped_column(JSONB)

    __table_args__ = (
        CheckConstraint("side IN ('before', 'after')", name="ck_functions_side"),
        CheckConstraint(
            "jsonb_typeof(owner_unit_ids) = 'array'", name="ck_functions_owner_ids_array"
        ),
        CheckConstraint("jsonb_typeof(source_ids) = 'array'", name="ck_functions_source_ids_array"),
        Index("ix_functions_run_side", "run_id", "side"),
    )
