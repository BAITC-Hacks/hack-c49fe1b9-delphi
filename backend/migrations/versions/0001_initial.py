"""Create the PostgreSQL analysis workspace."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "analyses",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_analyses_created_at", "analyses", ["created_at"])

    op.create_table(
        "documents",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "analysis_id",
            sa.Uuid(),
            sa.ForeignKey("analyses.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("side", sa.String(6), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("hash", sa.String(64), nullable=False),
        sa.Column("revision_label", sa.String(200)),
        sa.Column("format", sa.String(8), nullable=False),
        sa.Column("detected_language", sa.String(16)),
        sa.Column("parse_status", sa.String(16), nullable=False),
        sa.Column("warnings", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("side IN ('before', 'after')", name="ck_documents_side"),
        sa.CheckConstraint("format IN ('md', 'docx', 'pdf', 'xlsx')", name="ck_documents_format"),
        sa.CheckConstraint(
            "parse_status IN ('pending', 'parsed', 'partial', 'failed')",
            name="ck_documents_parse_status",
        ),
        sa.CheckConstraint("jsonb_typeof(warnings) = 'array'", name="ck_documents_warnings_array"),
    )
    op.create_index("ix_documents_analysis_side", "documents", ["analysis_id", "side"])
    op.create_index("ix_documents_analysis_hash", "documents", ["analysis_id", "hash"])

    op.create_table(
        "source_blocks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "document_id",
            sa.Uuid(),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("locator", postgresql.JSONB(), nullable=False),
        sa.Column("clause_no", sa.String(100)),
        sa.Column("parent_id", sa.Uuid(), sa.ForeignKey("source_blocks.id", ondelete="SET NULL")),
        sa.Column("original_text", sa.Text(), nullable=False),
        sa.Column("normalized_text", sa.Text(), nullable=False),
        sa.CheckConstraint(
            "jsonb_typeof(locator) = 'object'", name="ck_source_blocks_locator_object"
        ),
        sa.CheckConstraint(
            "parent_id IS NULL OR parent_id <> id", name="ck_source_blocks_parent_not_self"
        ),
        sa.UniqueConstraint("document_id", "locator", name="uq_source_blocks_document_locator"),
    )
    op.create_index(
        "ix_source_blocks_document_clause", "source_blocks", ["document_id", "clause_no"]
    )
    op.create_index("ix_source_blocks_parent", "source_blocks", ["parent_id"])

    op.create_table(
        "runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "analysis_id",
            sa.Uuid(),
            sa.ForeignKey("analyses.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("immutable_document_ids", postgresql.JSONB(), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("stage", sa.String(100), nullable=False),
        sa.Column("coverage", postgresql.JSONB(), nullable=False),
        sa.Column("structure", postgresql.JSONB(), nullable=False),
        sa.Column("model", sa.String(200), nullable=False),
        sa.Column("output_language", sa.String(2), nullable=False),
        sa.Column("pipeline_version", sa.String(100), nullable=False),
        sa.Column("review_revision", sa.Integer(), server_default="0", nullable=False),
        sa.Column("errors", postgresql.JSONB(), nullable=False),
        sa.Column("trace", postgresql.JSONB(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("analysis_id", name="uq_runs_analysis"),
        sa.CheckConstraint(
            "state IN ('queued', 'running', 'completed', 'partial', 'failed', 'interrupted')",
            name="ck_runs_state",
        ),
        sa.CheckConstraint("output_language IN ('ru', 'kk', 'en')", name="ck_runs_output_language"),
        sa.CheckConstraint("review_revision >= 0", name="ck_runs_review_revision"),
        sa.CheckConstraint(
            "jsonb_typeof(immutable_document_ids) = 'array'", name="ck_runs_document_ids_array"
        ),
        sa.CheckConstraint("jsonb_typeof(coverage) = 'object'", name="ck_runs_coverage_object"),
        sa.CheckConstraint("jsonb_typeof(structure) = 'array'", name="ck_runs_structure_array"),
        sa.CheckConstraint("jsonb_typeof(errors) = 'array'", name="ck_runs_errors_array"),
        sa.CheckConstraint("jsonb_typeof(trace) = 'array'", name="ck_runs_trace_array"),
        sa.CheckConstraint(
            "finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at",
            name="ck_runs_timestamps",
        ),
    )
    op.create_index("ix_runs_state", "runs", ["state"])

    op.create_table(
        "units",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "run_id", sa.Uuid(), sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("side", sa.String(6), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("name_original", sa.Text(), nullable=False),
        sa.Column("parent_unit_id", sa.Uuid(), sa.ForeignKey("units.id", ondelete="SET NULL")),
        sa.Column("source_ids", postgresql.JSONB(), nullable=False),
        sa.CheckConstraint("side IN ('before', 'after')", name="ck_units_side"),
        sa.CheckConstraint("kind IN ('department', 'role', 'group')", name="ck_units_kind"),
        sa.CheckConstraint("jsonb_typeof(source_ids) = 'array'", name="ck_units_source_ids_array"),
        sa.CheckConstraint(
            "parent_unit_id IS NULL OR parent_unit_id <> id", name="ck_units_parent_not_self"
        ),
    )
    op.create_index("ix_units_run_side", "units", ["run_id", "side"])
    op.create_index("ix_units_parent", "units", ["parent_unit_id"])

    op.create_table(
        "functions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "run_id", sa.Uuid(), sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("side", sa.String(6), nullable=False),
        sa.Column("owner_unit_ids", postgresql.JSONB(), nullable=False),
        sa.Column("actor_original", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("object", sa.Text(), nullable=False),
        sa.Column("scope", sa.Text(), nullable=False),
        sa.Column("condition", sa.Text(), nullable=False),
        sa.Column("modality", sa.Text(), nullable=False),
        sa.Column("source_ids", postgresql.JSONB(), nullable=False),
        sa.CheckConstraint("side IN ('before', 'after')", name="ck_functions_side"),
        sa.CheckConstraint(
            "jsonb_typeof(owner_unit_ids) = 'array'", name="ck_functions_owner_ids_array"
        ),
        sa.CheckConstraint(
            "jsonb_typeof(source_ids) = 'array'", name="ck_functions_source_ids_array"
        ),
    )
    op.create_index("ix_functions_run_side", "functions", ["run_id", "side"])

    op.create_table(
        "findings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "run_id", sa.Uuid(), sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("change_type", sa.String(50), nullable=False),
        sa.Column("issue_type", sa.String(50)),
        sa.Column("before_function_ids", postgresql.JSONB(), nullable=False),
        sa.Column("after_function_ids", postgresql.JSONB(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("recommendation", sa.Text(), nullable=False),
        sa.Column("search", postgresql.JSONB(none_as_null=True)),
        sa.CheckConstraint(
            "jsonb_typeof(before_function_ids) = 'array'", name="ck_findings_before_ids_array"
        ),
        sa.CheckConstraint(
            "jsonb_typeof(after_function_ids) = 'array'", name="ck_findings_after_ids_array"
        ),
        sa.CheckConstraint(
            "search IS NULL OR jsonb_typeof(search) = 'object'", name="ck_findings_search_object"
        ),
    )
    op.create_index("ix_findings_run", "findings", ["run_id"])

    op.create_table(
        "finding_evidence",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "finding_id",
            sa.Uuid(),
            sa.ForeignKey("findings.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "source_id",
            sa.Uuid(),
            sa.ForeignKey("source_blocks.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("evidence_role", sa.String(7), nullable=False),
        sa.Column("start_offset", sa.Integer()),
        sa.Column("end_offset", sa.Integer()),
        sa.CheckConstraint(
            "evidence_role IN ('before', 'after', 'context')", name="ck_finding_evidence_role"
        ),
        sa.CheckConstraint(
            "(start_offset IS NULL AND end_offset IS NULL) OR "
            "(start_offset IS NOT NULL AND end_offset IS NOT NULL AND start_offset >= 0 AND end_offset > start_offset)",
            name="ck_finding_evidence_offsets",
        ),
    )
    op.create_index("ix_finding_evidence_finding", "finding_evidence", ["finding_id"])
    op.create_index("ix_finding_evidence_source", "finding_evidence", ["source_id"])

    op.create_table(
        "reviews",
        sa.Column(
            "finding_id",
            sa.Uuid(),
            sa.ForeignKey("findings.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "status IN ('unreviewed', 'confirmed', 'needs_clarification', 'rejected')",
            name="ck_reviews_status",
        ),
    )

    op.create_table(
        "translations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "run_id", sa.Uuid(), sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("review_revision", sa.Integer(), nullable=False),
        sa.Column("locale", sa.String(2), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint(
            "run_id", "review_revision", "locale", name="uq_translations_run_revision_locale"
        ),
        sa.CheckConstraint("review_revision >= 0", name="ck_translations_review_revision"),
        sa.CheckConstraint("locale IN ('ru', 'kk', 'en')", name="ck_translations_locale"),
        sa.CheckConstraint(
            "jsonb_typeof(payload) = 'object'", name="ck_translations_payload_object"
        ),
    )

    op.create_table(
        "exports",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "run_id", sa.Uuid(), sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("review_revision", sa.Integer(), nullable=False),
        sa.Column("locale", sa.String(2), nullable=False),
        sa.Column("format", sa.String(8), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint(
            "run_id",
            "review_revision",
            "locale",
            "format",
            name="uq_exports_run_revision_locale_format",
        ),
        sa.CheckConstraint("review_revision >= 0", name="ck_exports_review_revision"),
        sa.CheckConstraint("locale IN ('ru', 'kk', 'en')", name="ck_exports_locale"),
        sa.CheckConstraint("format IN ('html', 'csv')", name="ck_exports_format"),
    )


def downgrade() -> None:
    op.drop_table("exports")
    op.drop_table("translations")
    op.drop_table("reviews")
    op.drop_table("finding_evidence")
    op.drop_table("findings")
    op.drop_table("functions")
    op.drop_table("units")
    op.drop_table("runs")
    op.drop_table("source_blocks")
    op.drop_table("documents")
    op.drop_table("analyses")
