from html import escape
from uuid import NAMESPACE_URL, uuid5

import pytest

from app.domain.errors import DomainError
from app.models import Document, Finding, FindingEvidence, Review, SourceBlock
from app.reporting.labels import LABELS
from app.reporting.rendering import original_payload, render_report
from app.reporting.types import ReportSnapshot
from app.schemas.common import UpdateReview


def identifier(value):
    return uuid5(NAMESPACE_URL, f"delphi-report-test:{value}")


@pytest.fixture
def snapshot():
    documents = {
        identifier(name): Document(
            id=identifier(name),
            filename=f"{name}.md",
            side="before" if name == "before" else "after",
            revision_label=None,
            parse_status="parsed",
            warnings=[],
        )
        for name in ("before", "after-one", "after-two")
    }
    sources = {
        identifier(f"source-{name}"): SourceBlock(
            id=identifier(f"source-{name}"),
            document_id=identifier(name),
            clause_no="5.1",
            original_text="5.1 Директор  проверяет реестр.\n<script>source()</script>",
            locator={"paragraph": 1},
        )
        for name in ("before", "after-one", "after-two")
    }
    finding_id = identifier("finding")
    finding = Finding(
        id=finding_id,
        title="Соответствие требует проверки",
        change_type="changed",
        issue_type="insufficient_evidence",
        explanation="Поиск выполнен не полностью.",
        recommendation="Проверить оставшиеся документы.",
        search={
            "method": "semantic_all_after_batches",
            "complete": False,
            "reviewed_source_ids": [str(identifier("source-after-one"))],
            "candidate_source_ids": [str(identifier("source-after-one"))],
            "errors": ["The remaining batch returned <invalid> output"],
        },
    )
    evidence = [
        FindingEvidence(
            id=identifier(f"evidence-{name}"),
            finding_id=finding_id,
            source_id=identifier(f"source-{name}"),
            evidence_role="before" if name == "before" else "after",
            start_offset=None,
            end_offset=None,
        )
        for name in ("before", "after-one")
    ]
    return ReportSnapshot(
        run_id=identifier("run"),
        review_revision=3,
        output_language="ru",
        title="Synthetic report integrity fixture",
        state="partial",
        coverage={"processed_sources": 2, "total_sources": 3},
        errors=["Unprocessed After batch"],
        documents=documents,
        sources=sources,
        findings=[finding],
        reviews={
            finding_id: Review(
                finding_id=finding_id,
                status="needs_clarification",
                note="  Оригинальная заметка.\n\t<script>note()</script>  \n",
            )
        },
        evidence={finding_id: evidence},
        functions=[],
        units={},
    )


def test_review_request_preserves_original_whitespace():
    note = "  Проверить п. 5.1\n\tУточнить исполнителя.  \n"
    request = UpdateReview(status="needs_clarification", note=note)
    assert request.note == note


@pytest.mark.parametrize("locale", ["ru", "kk", "en"])
def test_report_preserves_quoted_sources_and_review_notes(snapshot, locale):
    payload = original_payload(snapshot)
    for text in payload.findings:
        text.title = f"Translated title ({locale})"
    html = render_report(snapshot, locale, payload)
    finding = snapshot.findings[0]
    review = snapshot.reviews[finding.id]
    for evidence in snapshot.evidence[finding.id]:
        assert escape(snapshot.sources[evidence.source_id].original_text) in html
    assert f"<pre>{escape(review.note)}</pre>" in html
    assert "<script>" not in html
    assert LABELS[locale]["partial"] in html
    assert LABELS[locale][review.status] in html
    assert f"Translated title ({locale})" in html
    assert review.note not in payload.model_dump_json()
    assert "source()" not in payload.model_dump_json()


def test_report_search_shows_actual_coverage_candidates_and_errors(snapshot):
    html = render_report(snapshot, "en", original_payload(snapshot))
    assert "Source blocks reviewed: 1 / 2" in html
    assert "Documents: 1 / 2" in html
    assert "Possible matches requiring review:</strong> 1" in html
    assert "after-one.md · Clause 5.1" in html
    assert "The remaining batch returned &lt;invalid&gt; output" in html
    assert "Search is incomplete: a missing duty has not been established" in html
    assert "All available sources reviewed" not in html
    assert "does not prove that the organization stopped an activity" in html


def test_report_search_can_show_completed_search_without_candidates(snapshot):
    snapshot.findings[0].search.update(
        complete=True,
        reviewed_source_ids=[
            str(identifier("source-after-one")),
            str(identifier("source-after-two")),
        ],
        candidate_source_ids=[],
        errors=[],
    )
    html = render_report(snapshot, "en", original_payload(snapshot))
    assert "Source blocks reviewed: 2 / 2" in html
    assert "Documents: 2 / 2" in html
    assert "Possible matches requiring review:</strong> 0" in html
    assert "All available sources reviewed" in html


@pytest.mark.parametrize(
    "changes",
    [
        {"reviewed_source_ids": [str(identifier("foreign-source"))]},
        {"reviewed_source_ids": [str(identifier("source-before"))]},
        {"candidate_source_ids": [str(identifier("source-after-two"))]},
        {"complete": True},
        {"complete": "true"},
        {"errors": "incomplete"},
    ],
)
def test_report_rejects_inconsistent_saved_search(snapshot, changes):
    snapshot.findings[0].search.update(changes)
    with pytest.raises(DomainError) as error:
        render_report(snapshot, "en", original_payload(snapshot))
    assert error.value.code == "invalid_saved_search"


def test_report_rejected_finding_stays_separate_and_preserves_its_evidence(snapshot):
    finding = snapshot.findings[0]
    snapshot.reviews[finding.id].status = "rejected"
    payload = original_payload(snapshot)
    html = render_report(snapshot, "en", payload)
    assert payload.summary.endswith("Не отклонено: 0.")
    assert html.index('<section class="rejected">') < html.index(f'id="finding-{finding.id}"')
    assert str(identifier("source-before")) in html


def test_report_extracts_exact_saved_offsets(snapshot):
    evidence = snapshot.evidence[snapshot.findings[0].id][0]
    source = snapshot.sources[evidence.source_id]
    evidence.start_offset = 4
    evidence.end_offset = source.original_text.index("\n")
    html = render_report(snapshot, "en", original_payload(snapshot))
    expected = source.original_text[evidence.start_offset : evidence.end_offset]
    assert f"<blockquote>{escape(expected)}</blockquote>" in html
