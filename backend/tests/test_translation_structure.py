"""Saved structure/translation contracts with a fake SDK and no database server."""
import json
import socket
from contextlib import asynccontextmanager
from html import escape
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import NAMESPACE_URL, uuid5

import pytest

from app.domain.errors import DomainError
from app.models import Document, Finding, FindingEvidence, Review, SourceBlock, Translation, Unit
from app.reporting.labels import LABELS
from app.reporting.rendering import original_payload, render_report, validate_translation
from app.reporting.types import ReportSnapshot
from app.services import translations


def identifier(value):
    return uuid5(NAMESPACE_URL, f"delphi-structure-translation-test:{value}")


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def deny(*args, **kwargs):
        raise AssertionError("These tests cannot open network connections")
    monkeypatch.setattr(socket.socket, "connect", deny)


@pytest.fixture
def snapshot():
    documents, sources, units = {}, {}, {}
    for side in ("before", "after"):
        document_id, source_id, unit_id = (identifier(f"{side}-{kind}") for kind in ("document", "source", "unit"))
        documents[document_id] = Document(
            id=document_id, side=side, filename=f"SYNTHETIC-{side}.md",
            revision_label=None, parse_status="parsed", warnings=[],
        )
        sources[source_id] = SourceBlock(
            id=source_id, document_id=document_id, clause_no="1.1",
            original_text=f"1.1. Исходная цитата {side}:  два пробела.\n<script>source()</script>",
            locator={"paragraph": 1},
        )
        units[str(unit_id)] = Unit(
            id=unit_id, side=side, kind="department", name_original=f"Отдел {side}",
            source_ids=[str(source_id)],
        )
    extra = identifier("before-extra-source")
    sources[extra] = SourceBlock(
        id=extra, document_id=identifier("before-document"), clause_no="1.2",
        original_text="1.2. Дополнительная исходная обязанность.", locator={"paragraph": 2},
    )
    finding_id = identifier("finding")
    finding = Finding(
        id=finding_id, title="Синтетическая передача", change_type="transferred", issue_type=None,
        explanation="Исходное пояснение", recommendation="Проверить исполнителя", search=None,
        before_function_ids=[], after_function_ids=[],
    )
    evidence = [FindingEvidence(
        id=identifier(f"{side}-evidence"), finding_id=finding_id,
        source_id=identifier(f"{side}-source"), evidence_role=side,
        start_offset=None, end_offset=None,
    ) for side in ("before", "after")]
    return ReportSnapshot(
        run_id=identifier("run"), review_revision=3, output_language="ru",
        title="SYNTHETIC structure translation", state="partial",
        coverage={"total_sources": 3, "processed_sources": 2}, errors=["Synthetic incomplete input"],
        documents=documents, sources=sources, units=units, functions=[], findings=[finding],
        reviews={finding_id: Review(finding_id=finding_id, status="confirmed", note="  Заметка\n<script>review()</script>  ")},
        evidence={finding_id: evidence}, structure=[{
            "id": str(identifier("structure")), "before_unit_ids": [str(identifier("before-unit"))],
            "after_unit_ids": [str(identifier("after-unit"))], "status": "transformed",
            "source_ids": [str(identifier("before-source")), str(identifier("after-source"))],
            "explanation": "Исходное пояснение структуры",
        }],
    )


def translated_payload(snapshot):
    payload = original_payload(snapshot)
    payload.findings[0].title = "Translated finding"
    payload.structure[0].explanation = "Translated structure <script>model()</script>"
    return payload


def sdk(payload, *, status="completed"):
    client = Mock()
    client.with_options.return_value = client
    client.responses.parse = AsyncMock(return_value=SimpleNamespace(status=status, output_parsed=payload))
    return client


class Session:
    def __init__(self, *values):
        self.scalar = AsyncMock(side_effect=values)
        self.delete = AsyncMock()
        self.execute = AsyncMock()
        self.add = Mock()

    @asynccontextmanager
    async def begin(self):
        yield self


@pytest.mark.parametrize("locale", ["ru", "kk", "en"])
def test_structure_payload_and_report_translate_only_explanations(snapshot, locale):
    original = original_payload(snapshot)
    assert original.structure[0].explanation == snapshot.structure[0]["explanation"]
    serialized = original.model_dump_json()
    assert "source()" not in serialized and "review()" not in serialized
    assert all(unit.name_original not in serialized for unit in snapshot.units.values())
    payload = translated_payload(snapshot)
    html = render_report(snapshot, locale, payload)
    assert escape(payload.structure[0].explanation) in html
    assert "Translated finding" in html
    for item in snapshot.evidence[snapshot.findings[0].id]:
        assert escape(snapshot.sources[item.source_id].original_text) in html
    assert escape(snapshot.reviews[snapshot.findings[0].id].note) in html
    assert all(unit.name_original in html for unit in snapshot.units.values())
    assert "<script>" not in html
    assert LABELS[locale]["partial"] in html


@pytest.mark.parametrize("defect", ["unknown", "missing", "duplicate"])
def test_translation_rejects_changed_structure_id_set(snapshot, defect):
    payload = translated_payload(snapshot)
    if defect == "unknown":
        payload.structure[0].id = str(identifier("invented-structure"))
    elif defect == "missing":
        payload.structure = []
    else:
        payload.structure.append(payload.structure[0].model_copy())
    with pytest.raises(DomainError) as error:
        validate_translation(snapshot, payload)
    assert error.value.code == "translation_structure_mismatch"


async def test_sdk_receives_structure_prose_without_original_quotes_or_reviews(snapshot):
    payload = original_payload(snapshot)
    translated = translated_payload(snapshot)
    client = sdk(translated)
    actual = await translations.translate_text(client, "synthetic-model", payload, "en", 5)
    assert actual == translated
    request = client.responses.parse.await_args.kwargs
    body = json.loads(request["input"][1]["content"])
    assert body["structure"] == [
        {"id": snapshot.structure[0]["id"], "explanation": snapshot.structure[0]["explanation"]},
    ]
    assert "source()" not in json.dumps(body) and "review()" not in json.dumps(body)
    assert request["store"] is False


@pytest.mark.parametrize("status,has_output", [("incomplete", True), ("completed", False)])
async def test_incomplete_translation_is_not_accepted(snapshot, status, has_output):
    payload = original_payload(snapshot)
    client = sdk(payload if has_output else None, status=status)
    with pytest.raises(DomainError) as error:
        await translations.translate_text(client, "synthetic-model", payload, "en", 5)
    assert error.value.code == "incomplete_translation"
    assert client.responses.parse.await_count == 1


@pytest.mark.parametrize("locale", ["ru", "kk", "en"])
def test_before_search_report_uses_before_sources_and_new_duty_limit(snapshot, locale):
    snapshot.findings[0].search = {
        "method": "semantic_all_before_batches", "complete": False,
        "reviewed_source_ids": [str(identifier("before-source"))],
        "candidate_source_ids": [str(identifier("before-source"))],
        "errors": ["SYNTHETIC omitted Before clause"], "input_partial": True,
    }
    html = render_report(snapshot, locale, original_payload(snapshot))
    labels = LABELS[locale]
    assert f"<h4>{labels['search_before']}</h4>" in html
    assert labels["search_new_incomplete"] in html
    assert labels["search_incomplete"] not in html
    assert f"{labels['search_sources']}: 1 / 2" in html
    assert labels["partial"] in html
    assert "SYNTHETIC omitted Before clause" in html


async def test_legacy_translation_upgrades_structure_and_invalidates_old_export(snapshot, monkeypatch):
    legacy = original_payload(snapshot).model_dump()
    legacy.pop("structure")
    cached = Translation(run_id=snapshot.run_id, review_revision=snapshot.review_revision, locale="en", payload=legacy)
    run = SimpleNamespace(review_revision=snapshot.review_revision)
    db = Session(cached, run, None)
    monkeypatch.setattr(translations, "capture_snapshot", AsyncMock(return_value=snapshot))
    client = sdk(translated_payload(snapshot))
    result = await translations.create_translation(db, snapshot.run_id, "en", client, "synthetic-model", 5)
    assert result.cached is False
    assert result.payload.structure[0].explanation.startswith("Translated structure")
    db.delete.assert_awaited_once_with(cached)
    db.execute.assert_awaited_once()
    saved = db.add.call_args.args[0]
    assert saved.payload["structure"] == result.payload.model_dump()["structure"]
    assert saved.review_revision == snapshot.review_revision
    lock_query = db.scalar.await_args_list[1].args[0]
    assert lock_query.get_execution_options()["populate_existing"] is True


async def test_review_or_resume_revision_change_rejects_translation_before_saving(snapshot, monkeypatch):
    db = Session(None, SimpleNamespace(review_revision=snapshot.review_revision + 1))
    monkeypatch.setattr(translations, "capture_snapshot", AsyncMock(return_value=snapshot))
    with pytest.raises(DomainError) as error:
        await translations.create_translation(db, snapshot.run_id, "en", sdk(translated_payload(snapshot)), "synthetic-model", 5)
    assert error.value.code == "review_changed"
    db.add.assert_not_called()
    assert db.scalar.await_args_list[1].args[0].get_execution_options()["populate_existing"] is True


async def test_invalid_structure_from_provider_does_not_reach_cache(snapshot, monkeypatch):
    db = Session(None)
    monkeypatch.setattr(translations, "capture_snapshot", AsyncMock(return_value=snapshot))
    invalid = translated_payload(snapshot)
    invalid.structure = []
    with pytest.raises(DomainError) as error:
        await translations.create_translation(db, snapshot.run_id, "en", sdk(invalid), "synthetic-model", 5)
    assert error.value.status_code == 502
    assert error.value.code == "translation_findings_mismatch"
    db.add.assert_not_called()
    assert db.scalar.await_count == 1
