import csv
import io
import json
from collections import Counter
from html import escape
from uuid import UUID

from app.domain.errors import DomainError
from app.models import (
    FindingEvidence,
    SourceBlock,
)
from app.reporting.labels import LABELS
from app.reporting.search import render_search
from app.reporting.types import ReportSnapshot
from app.schemas.common import Locale, TranslatedFinding, TranslatedPayload


def original_payload(snapshot: ReportSnapshot) -> TranslatedPayload:
    labels = LABELS[snapshot.output_language]
    active = sum(snapshot.reviews[row.id].status != "rejected" for row in snapshot.findings)
    summary = f"{labels['findings']}: {len(snapshot.findings)}. {labels['active']}: {active}."
    return TranslatedPayload(
        findings=[
            TranslatedFinding(
                id=str(row.id),
                title=row.title,
                explanation=row.explanation,
                recommendation=row.recommendation,
            )
            for row in snapshot.findings
        ],
        summary=summary,
    )


def validate_translation(snapshot: ReportSnapshot, payload: TranslatedPayload) -> None:
    expected = Counter(str(row.id) for row in snapshot.findings)
    if Counter(row.id for row in payload.findings) != expected:
        raise DomainError(
            409, "translation_findings_mismatch", "Translation does not match saved finding IDs"
        )


def source_excerpt(source: SourceBlock, evidence: FindingEvidence) -> str:
    start, end = evidence.start_offset, evidence.end_offset
    if start is None and end is None:
        return source.original_text
    if start is None or end is None or not 0 <= start < end <= len(source.original_text):
        raise DomainError(
            409, "invalid_saved_evidence", "Evidence offsets are outside the saved source"
        )
    return source.original_text[start:end]


def render_report(snapshot: ReportSnapshot, locale: Locale, payload: TranslatedPayload) -> str:
    validate_translation(snapshot, payload)
    labels = LABELS[locale]
    translated = {row.id: row for row in payload.findings}
    parts = [
        f'<!doctype html><html lang="{locale}"><head><meta charset="utf-8">',
        f"<title>{escape(snapshot.title)} — Delphi</title>",
        "<style>body{font:16px/1.5 system-ui,sans-serif;max-width:1000px;margin:40px auto;padding:0 24px;color:#18202b}h1,h2,h3{line-height:1.2}article{border-top:1px solid #ccc;padding:16px 0;break-inside:avoid}blockquote,pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f5f7;padding:12px}small{color:#555}.rejected{opacity:.7}@media print{body{margin:0;max-width:none}a{color:inherit}}</style></head><body>",
        f"<h1>{labels['report']}: {escape(snapshot.title)}</h1>",
        f"<p>{labels[snapshot.state]} · {labels['revision']}: {snapshot.review_revision}</p>",
        f"<p>{escape(payload.summary)}</p><p><small>{labels['original']}</small></p>",
        f"<h2>{labels['documents']}</h2><ul>",
    ]
    for document in snapshot.documents.values():
        revision = f" · {escape(document.revision_label)}" if document.revision_label else ""
        parts.append(
            f"<li>{labels[document.side]}: {escape(document.filename)}{revision} · {escape(document.parse_status)}</li>"
        )
        if document.warnings:
            parts.append(
                f"<li><pre>{escape(json.dumps(document.warnings, ensure_ascii=False, indent=2))}</pre></li>"
            )
    parts.extend(
        [
            "</ul>",
            f"<h2>{labels['coverage']}</h2><pre>{escape(json.dumps(snapshot.coverage, ensure_ascii=False, indent=2))}</pre>",
        ]
    )
    if snapshot.errors:
        parts.append(
            f"<h2>{labels['errors']}</h2><pre>{escape(json.dumps(snapshot.errors, ensure_ascii=False, indent=2))}</pre>"
        )
    for status in ("confirmed", "unreviewed", "needs_clarification", "rejected"):
        group = [row for row in snapshot.findings if snapshot.reviews[row.id].status == status]
        parts.append(f'<section class="{status}"><h2>{labels[status]} ({len(group)})</h2>')
        for finding in group:
            text = translated[str(finding.id)]
            review = snapshot.reviews[finding.id]
            parts.extend(
                [
                    f'<article id="finding-{finding.id}"><h3>{escape(text.title)}</h3>',
                    f"<p><small>{escape(finding.change_type)}{(' · ' + escape(finding.issue_type)) if finding.issue_type else ''}</small></p>",
                    f"<p>{escape(text.explanation)}</p><p><strong>{labels['recommendation']}:</strong> {escape(text.recommendation)}</p>",
                    f"<p><strong>{labels['note']}:</strong></p><pre>{escape(review.note) if review.note else labels['none']}</pre>",
                ]
            )
            if finding.search is not None:
                parts.append(render_search(snapshot, finding.search, locale))
            parts.append(f"<h4>{labels['evidence']}</h4>")
            for item in snapshot.evidence[finding.id]:
                source = snapshot.sources[item.source_id]
                document = snapshot.documents[source.document_id]
                if item.evidence_role != "context" and item.evidence_role != document.side:
                    raise DomainError(
                        409, "invalid_saved_evidence", "Evidence has the wrong comparison side"
                    )
                location = (
                    f"{labels['clause']} {source.clause_no}"
                    if source.clause_no
                    else f"{labels['position']} {json.dumps(source.locator, ensure_ascii=False)}"
                )
                parts.extend(
                    [
                        f'<div id="evidence-{item.id}"><p><a href="#evidence-{item.id}">{labels[document.side]} · {escape(document.filename)} · {escape(location)}</a></p>',
                        f"<blockquote>{escape(source_excerpt(source, item))}</blockquote><small>{source.id}</small></div>",
                    ]
                )
            parts.append("</article>")
        parts.append("</section>")
    parts.append("</body></html>")
    return "\n".join(parts)


def csv_cell(value: str) -> str:
    if value.startswith(("\t", "\r", "\n")) or value.lstrip(" \t\r\n\ufeff").startswith(
        ("=", "+", "-", "@")
    ):
        return "'" + value
    return value


def render_functions_csv(snapshot: ReportSnapshot, locale: Locale) -> str:
    labels = LABELS[locale]
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    writer.writerow(
        [
            labels[key]
            for key in (
                "function",
                "side",
                "owners",
                "actor",
                "action",
                "object",
                "scope",
                "condition",
                "modality",
                "evidence",
                "findings",
                "review",
            )
        ]
    )
    for function in snapshot.functions:
        if any(owner not in snapshot.units for owner in function.owner_unit_ids) or any(
            UUID(source) not in snapshot.sources for source in function.source_ids
        ):
            raise DomainError(
                409, "invalid_saved_function", "Function references unknown units or sources"
            )
        related = [
            finding
            for finding in snapshot.findings
            if str(function.id) in finding.before_function_ids + finding.after_function_ids
        ]
        row = [
            str(function.id),
            labels[function.side],
            "; ".join(snapshot.units[owner].name_original for owner in function.owner_unit_ids),
            function.actor_original,
            function.action,
            function.object,
            function.scope,
            function.condition,
            function.modality,
            "; ".join(function.source_ids),
            "; ".join(str(finding.id) for finding in related),
            "; ".join(
                f"{finding.id}: {labels[snapshot.reviews[finding.id].status]}"
                for finding in related
            ),
        ]
        writer.writerow([csv_cell(value) for value in row])
    return "\ufeff" + buffer.getvalue()
