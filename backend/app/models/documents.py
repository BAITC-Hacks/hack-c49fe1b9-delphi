from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    analysis_id: Mapped[UUID] = mapped_column(ForeignKey("analyses.id", ondelete="CASCADE"))
    side: Mapped[str] = mapped_column(String(6))
    filename: Mapped[str] = mapped_column(Text)
    storage_key: Mapped[str] = mapped_column(Text)
    hash: Mapped[str] = mapped_column(String(64))
    revision_label: Mapped[str | None] = mapped_column(String(200))
    format: Mapped[str] = mapped_column(String(8))
    detected_language: Mapped[str | None] = mapped_column(String(16))
    parse_status: Mapped[str] = mapped_column(String(16))
    warnings: Mapped[list[Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("side IN ('before', 'after')", name="ck_documents_side"),
        CheckConstraint("format IN ('md', 'docx', 'pdf', 'xlsx')", name="ck_documents_format"),
        CheckConstraint(
            "parse_status IN ('pending', 'parsed', 'partial', 'failed')",
            name="ck_documents_parse_status",
        ),
        CheckConstraint("jsonb_typeof(warnings) = 'array'", name="ck_documents_warnings_array"),
        Index("ix_documents_analysis_side", "analysis_id", "side"),
        Index("ix_documents_analysis_hash", "analysis_id", "hash"),
    )


class SourceBlock(Base):
    __tablename__ = "source_blocks"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    document_id: Mapped[UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    locator: Mapped[dict[str, Any]] = mapped_column(JSONB)
    clause_no: Mapped[str | None] = mapped_column(String(100))
    parent_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("source_blocks.id", ondelete="SET NULL")
    )
    original_text: Mapped[str] = mapped_column(Text)
    normalized_text: Mapped[str] = mapped_column(Text)

    __table_args__ = (
        CheckConstraint("jsonb_typeof(locator) = 'object'", name="ck_source_blocks_locator_object"),
        CheckConstraint(
            "parent_id IS NULL OR parent_id <> id", name="ck_source_blocks_parent_not_self"
        ),
        UniqueConstraint("document_id", "locator", name="uq_source_blocks_document_locator"),
        Index("ix_source_blocks_document_clause", "document_id", "clause_no"),
        Index("ix_source_blocks_parent", "parent_id"),
    )
