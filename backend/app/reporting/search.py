import json
from html import escape
from uuid import UUID

from app.domain.errors import DomainError
from app.reporting.labels import LABELS
from app.reporting.types import ReportSnapshot
from app.schemas.common import Locale


def render_search(snapshot: ReportSnapshot, search: dict, locale: Locale) -> str:
    method = search.get("method")
    if method not in {"semantic_all_after_batches", "semantic_all_before_batches"}:
        raise DomainError(409, "invalid_saved_search", "Unknown saved search method")
    side = "before" if method == "semantic_all_before_batches" else "after"
    searched_sources = {
        str(source.id): source
        for source in snapshot.sources.values()
        if snapshot.documents[source.document_id].side == side
    }
    reviewed = search.get("reviewed_source_ids")
    candidates = search.get("candidate_source_ids")
    errors = search.get("errors")
    complete = search.get("complete")
    if (
        not isinstance(reviewed, list)
        or not isinstance(candidates, list)
        or not isinstance(errors, list)
        or any(not isinstance(value, str) for value in reviewed + candidates + errors)
        or type(complete) is not bool
        or len(reviewed) != len(set(reviewed))
        or len(candidates) != len(set(candidates))
        or not set(reviewed) <= set(searched_sources)
        or not set(candidates) <= set(reviewed)
        or (
            complete
            and (set(reviewed) != set(searched_sources) or errors or search.get("input_partial"))
        )
    ):
        raise DomainError(409, "invalid_saved_search", "Saved search coverage is inconsistent")
    labels = LABELS[locale]
    reviewed_documents = {searched_sources[identifier].document_id for identifier in reviewed}
    searched_documents = {doc.id for doc in snapshot.documents.values() if doc.side == side}
    heading = labels["search_before" if side == "before" else "search"]
    status = labels["search_complete" if complete else ("search_new_incomplete" if side == "before" else "search_incomplete")]
    parts = [
        f"<h4>{heading}</h4>",
        f"<p>{status}</p>",
        f"<p>{labels['search_sources']}: {len(reviewed)} / {len(searched_sources)} · "
        f"{labels['documents']}: {len(reviewed_documents)} / {len(searched_documents)}</p>",
        f"<p>{labels['search_scope']}</p>",
        f"<p><strong>{labels['search_candidates']}:</strong> {len(candidates)}</p>",
    ]
    if candidates:
        parts.append("<ul>")
        for identifier in candidates:
            source = snapshot.sources[UUID(identifier)]
            document = snapshot.documents[source.document_id]
            location = (
                f"{labels['clause']} {source.clause_no}"
                if source.clause_no
                else f"{labels['position']} {json.dumps(source.locator, ensure_ascii=False)}"
            )
            parts.append(f"<li>{escape(document.filename)} · {escape(location)} · {source.id}</li>")
        parts.append("</ul>")
    if errors:
        parts.append(f"<p><strong>{labels['errors']}:</strong></p><ul>")
        parts.extend(f"<li>{escape(error)}</li>" for error in errors)
        parts.append("</ul>")
    return "\n".join(parts)
