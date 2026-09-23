"""Deterministic text candidates. None of these rows is an AI semantic verdict."""
from __future__ import annotations

from collections import defaultdict
from difflib import SequenceMatcher
import re
from time import monotonic

from .models import Document, SourceBlock


def _body(block: SourceBlock) -> str:
    text = re.sub(r"^\d+(?:\.\d+)*\.\s*", "", block.normalized_text)
    text = re.sub(r"^[а-яa-z][.)]\s+", "", text, flags=re.I)
    return text.casefold().strip()


def compare_documents(documents: list[Document]) -> dict:
    """Return all Before blocks with exact or at most three fuzzy candidates.

    Matching uses normalized text, not actor or meaning; ancestor IDs are exposed
    for interpretation. Equal text can still have a different responsible role.
    An empty candidate list means no lexical candidate, not a lost function.
    """
    started = monotonic()
    blocks = [b for d in documents for b in d.blocks if b.kind != "toc"]
    before = [b for b in blocks if b.side == "before"]
    after = [b for b in blocks if b.side == "after"]
    by_id = {b.id: b for b in blocks}
    exact: dict[str, list[SourceBlock]] = defaultdict(list)
    token_index: dict[str, set[str]] = defaultdict(set)
    after_bodies = {}
    after_tokens: dict[str, set[str]] = {}
    for block in after:
        body = _body(block)
        after_bodies[block.id] = body
        exact[body].append(block)
        after_tokens[block.id] = set(re.findall(r"\w{4,}", body))
        for token in after_tokens[block.id]:
            token_index[token].add(block.id)

    def ancestors(block: SourceBlock) -> list[str]:
        chain = []
        current = block.parent_id
        while current and current in by_id and current not in chain:
            chain.append(current)
            current = by_id[current].parent_id
        return chain

    rows = []
    matched_after = set()
    exact_seen = set()
    for block in before:
        # A soft wall-clock bound between blocks; one string comparison can
        # finish after the deadline. Deferred blocks remain explicit below.
        if len(rows) >= 2000 or monotonic() - started > 20:
            break
        body = _body(block)
        direct = exact.get(body, []) if body else []
        if direct:
            candidates = [(b, 1.0) for b in direct[:32]]
            status = "exact_text"
            if body not in exact_seen:
                matched_after.update(b.id for b in direct)
                exact_seen.add(body)
        else:
            pool: set[str] = set()
            tokens = set(re.findall(r"\w{4,}", body))
            for token in tokens:
                pool.update(token_index.get(token, set()))
            # The lexical index covers every After block; expensive character
            # alignment is bounded to 32 candidates ranked by token overlap.
            # This is candidate generation, never evidence of semantic absence.
            pool_ranked = sorted(pool, key=lambda source_id: (
                -len(tokens & after_tokens[source_id]) / max(len(tokens | after_tokens[source_id]), 1), source_id,
            ))[:32]
            scores = []
            for source_id in pool_ranked:
                candidate_body = after_bodies[source_id]
                if not body or min(len(body), len(candidate_body)) / max(len(body), len(candidate_body)) < .4:
                    continue
                matcher = SequenceMatcher(None, body, candidate_body, autojunk=False)
                if matcher.quick_ratio() < .55:
                    continue
                ratio = matcher.ratio()
                if ratio >= .55:
                    scores.append((by_id[source_id], ratio))
            candidates = sorted(scores, key=lambda pair: (-pair[1], pair[0].id))[:3]
            status = "similar_text" if candidates else "no_lexical_candidate"
        matched_after.update(b.id for b, _ in candidates)
        rows.append({
            "before_source_id": block.id,
            "before_context_ids": ancestors(block),
            "status": status,
            "exact_candidate_count": len(direct),
            "candidates": [{"after_source_id": b.id, "similarity": round(score, 4), "after_context_ids": ancestors(b)} for b, score in candidates],
        })
    return {
        "kind": "deterministic_text_comparison",
        "warning": "Text candidates only; these are not preserved/transferred/lost function findings. Context, roles, scope and modality need AI/human review.",
        "before_blocks": len(before), "after_blocks": len(after),
        "fuzzy_candidate_cap": 32,
        "exact_candidate_cap": 32,
        "complete": len(rows) == len(before),
        "unprocessed_before_source_ids": [b.id for b in before[len(rows):]],
        "rows": rows,
        "after_without_candidate_ids": [b.id for b in after if b.id not in matched_after] if len(rows) == len(before) else [],
        "elapsed_seconds": round(monotonic() - started, 3),
    }
