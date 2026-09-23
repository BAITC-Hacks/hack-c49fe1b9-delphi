"""Free preflight: lower bounds are not a promise of duration, cost or completion."""
from math import ceil

from .config import Settings
from .models import Document


def estimate(documents: list[Document], settings: Settings, *, saved_run: dict | None = None) -> dict:
    pending = set(saved_run.get('coverage', {}).get('unprocessed_source_ids', [])) if saved_run else None
    batch_count = 8 if saved_run else 16
    counts = []
    for document in documents:
        body = [block for block in document.blocks if block.kind != 'toc'
                and (pending is None or block.id in pending)]
        counts.append({'document_id': document.id, 'side': document.side, 'pending_body_blocks': len(body),
                       'minimum_extraction_calls': ceil(len(body) / batch_count)})
    minimum = sum(row['minimum_extraction_calls'] for row in counts)
    used = int(saved_run.get('usage', {}).get('api_calls', 0)) if saved_run else 0
    remaining = max(0, settings.max_calls - used)
    return {'documents': counts, 'minimum_extraction_calls': minimum,
            'remaining_call_limit': remaining, 'extraction_count_limit_sufficient': minimum <= remaining,
            'note': 'Lower bound for extraction only. Input/context size, output splits, structure, comparison, '
                    'source sweeps, risks and retries require additional calls. No model was called; '
                    'cost and completion time are not predicted.'}
