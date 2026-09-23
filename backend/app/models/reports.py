from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Translation(Base):
    __tablename__ = "translations"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    run_id: Mapped[UUID] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"))
    review_revision: Mapped[int] = mapped_column(Integer)
    locale: Mapped[str] = mapped_column(String(2))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "run_id", "review_revision", "locale", name="uq_translations_run_revision_locale"
        ),
        CheckConstraint("review_revision >= 0", name="ck_translations_review_revision"),
        CheckConstraint("locale IN ('ru', 'kk', 'en')", name="ck_translations_locale"),
        CheckConstraint("jsonb_typeof(payload) = 'object'", name="ck_translations_payload_object"),
    )


class Export(Base):
    __tablename__ = "exports"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    run_id: Mapped[UUID] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"))
    review_revision: Mapped[int] = mapped_column(Integer)
    locale: Mapped[str] = mapped_column(String(2))
    format: Mapped[str] = mapped_column(String(8))
    payload: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "run_id",
            "review_revision",
            "locale",
            "format",
            name="uq_exports_run_revision_locale_format",
        ),
        CheckConstraint("review_revision >= 0", name="ck_exports_review_revision"),
        CheckConstraint("locale IN ('ru', 'kk', 'en')", name="ck_exports_locale"),
        CheckConstraint("format IN ('html', 'csv')", name="ck_exports_format"),
    )
