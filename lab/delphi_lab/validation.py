"""Server-side references: schema validity alone never establishes evidence."""
from .models import AgentResult, Document


def validate_result(result: AgentResult, documents: list[Document]) -> None:
    sources = {b.id: b for d in documents for b in d.blocks}
    units = {u.id: u for u in result.units}
    functions = {f.id: f for f in result.functions}
    if len({d.id for d in documents}) != len(documents) or len(sources) != sum(len(d.blocks) for d in documents):
        raise ValueError('Duplicate document or source ID')
    if len(units) != len(result.units) or len(functions) != len(result.functions):
        raise ValueError('Duplicate entity ID')
    if len({f.id for f in result.findings}) != len(result.findings):
        raise ValueError('Duplicate finding ID')

    def unique(ids: list[str]) -> None:
        if any(not value.strip() for value in ids) or len(set(ids)) != len(ids):
            raise ValueError('Empty or duplicate reference ID')

    def acyclic(registry, parent_field: str) -> None:
        finished = set()
        for entity in registry.values():
            path = set()
            current = entity
            while current is not None and current.id not in finished:
                if current.id in path:
                    raise ValueError('Cyclic parent hierarchy')
                path.add(current.id)
                current = registry.get(getattr(current, parent_field))
            finished.update(path)

    unique([d.id for d in documents])
    unique(list(sources))
    unique(list(units))
    unique(list(functions))
    unique([f.id for f in result.findings])
    for document in documents:
        for block in document.blocks:
            if block.document_id != document.id or block.side != document.side:
                raise ValueError('Source does not belong to its document and side')
            if block.parent_id is not None:
                parent = sources.get(block.parent_id)
                if parent is None or parent.document_id != block.document_id or parent.side != block.side or parent.kind == 'toc':
                    raise ValueError('Invalid source parent registry')
    acyclic(sources, 'parent_id')

    def source_ids(ids: list[str], side: str) -> None:
        unique(ids)
        if not ids:
            raise ValueError('Entity has no source evidence')
        if any(i not in sources or sources[i].side != side or sources[i].kind == 'toc' for i in ids):
            raise ValueError('Unknown or wrong-side source ID')

    for unit in result.units:
        source_ids(unit.source_ids, unit.side)
        if unit.parent_unit_id is not None:
            parent = units.get(unit.parent_unit_id)
            if parent is None or parent.side != unit.side:
                raise ValueError('Unknown or wrong-side parent unit ID')
    acyclic(units, 'parent_unit_id')
    for function in result.functions:
        source_ids(function.source_ids, function.side)
        unique(function.owner_unit_ids)
        if any(i not in units or units[i].side != function.side for i in function.owner_unit_ids):
            raise ValueError('Unknown or wrong-side unit ID')
        # Preserve legacy/partial extraction without inventing an owner. It
        # cannot establish a completed responsibility analysis.
        if result.complete and not function.owner_unit_ids:
            raise ValueError('Completed analysis has an unresolved function owner')
    for finding in result.findings:
        for side, ids in [('before', finding.before_function_ids), ('after', finding.after_function_ids)]:
            unique(ids)
            if any(i not in functions or functions[i].side != side for i in ids):
                raise ValueError('Unknown or wrong-side function ID')
        sides = set()
        after_ids = set()
        if not finding.evidence:
            raise ValueError('Finding has no evidence')
        for evidence in finding.evidence:
            block = sources.get(evidence.source_id)
            if block is None or block.kind == 'toc':
                raise ValueError('Finding cites a source outside this run')
            if evidence.evidence_role != 'context' and evidence.evidence_role != block.side:
                raise ValueError('Wrong evidence side')
            start, end = evidence.start_offset, evidence.end_offset
            if (start is None) != (end is None):
                raise ValueError('Both evidence offsets are required together')
            if start is not None and not (0 <= start < end <= len(block.original_text)):
                raise ValueError('Evidence offsets are out of bounds')
            if evidence.evidence_role != 'context':
                sides.add(block.side)
            if block.side == 'after' and evidence.evidence_role == 'after':
                after_ids.add(block.id)
        evidence_keys = [(e.source_id, e.evidence_role, e.start_offset, e.end_offset) for e in finding.evidence]
        if len(set(evidence_keys)) != len(evidence_keys):
            raise ValueError('Duplicate evidence reference')
        for function_id in finding.before_function_ids + finding.after_function_ids:
            function = functions[function_id]
            cited = {e.source_id for e in finding.evidence if e.evidence_role == function.side}
            if not cited.intersection(function.source_ids):
                raise ValueError('Referenced function has no linked source evidence')
        if finding.change_type in {'preserved', 'rephrased', 'transferred', 'split', 'merged'}:
            if sides != {'before', 'after'} or not finding.before_function_ids or not finding.after_function_ids:
                raise ValueError('Mapping requires functions and evidence from both sides')
        if finding.change_type == 'split' and (len(finding.before_function_ids) != 1 or len(finding.after_function_ids) < 2):
            raise ValueError('Split requires one Before and multiple After functions')
        if finding.change_type == 'merged' and (len(finding.before_function_ids) < 2 or len(finding.after_function_ids) != 1):
            raise ValueError('Merge requires multiple Before and one After function')
        if finding.issue_type in {'overlap', 'conflict'} and (len(after_ids) < 2 or len(finding.after_function_ids) < 2):
            raise ValueError('Overlap/conflict requires two After sources')
        if finding.change_type == 'unmatched':
            if not finding.before_function_ids or finding.after_function_ids or not finding.search_queries:
                raise ValueError('Unmatched requires a Before function and recorded After searches')
        if finding.change_type == 'added' and (finding.before_function_ids or not finding.after_function_ids or 'after' not in sides):
            raise ValueError('Added requires only After functions and evidence')
        search = finding.search
        if search is not None:
            unique(search.reviewed_source_ids)
            unique(search.candidate_source_ids)
            raw_ids = {b.id for b in sources.values() if b.side == search.side and b.kind != 'toc'}
            if not set(search.reviewed_source_ids) <= raw_ids or not set(search.candidate_source_ids) <= raw_ids:
                raise ValueError('Search contains unknown or wrong-side source IDs')
            if not set(search.candidate_source_ids) <= set(search.reviewed_source_ids):
                raise ValueError('Search candidate was not reviewed')
            if search.complete and (set(search.reviewed_source_ids) != raw_ids or search.errors):
                raise ValueError('Complete search must cover all raw source blocks without gaps')
            if search.complete and any(document.parse_status != 'ok' for document in documents):
                raise ValueError('Complete search cannot hide parsing gaps')
        if finding.change_type in {'unmatched', 'added'}:
            opposite = 'after' if finding.change_type == 'unmatched' else 'before'
            # Old saved partial runs remain readable. New absence claims must
            # carry an explicit full raw-source sweep, not extracted functions.
            if search is None:
                if result.complete:
                    raise ValueError('Completed absence claim has no raw-source search coverage')
            elif search.side != opposite or not search.complete or search.errors or search.candidate_source_ids:
                raise ValueError('Absence claim requires complete opposite-side search without unresolved candidates')

    unique([change.id for change in result.structure])
    mapped_units = set()
    for change in result.structure:
        unique(change.before_unit_ids)
        unique(change.after_unit_ids)
        unique(change.source_ids)
        ids = change.before_unit_ids + change.after_unit_ids
        if not ids or not change.source_ids:
            raise ValueError('Structure change requires units and sources')
        for side, side_ids in [('before', change.before_unit_ids), ('after', change.after_unit_ids)]:
            for identifier in side_ids:
                unit = units.get(identifier)
                if unit is None or unit.side != side or unit.kind == 'role':
                    raise ValueError('Structure change has invalid unit or side')
                if not set(unit.source_ids).intersection(change.source_ids):
                    raise ValueError('Structure unit has no linked source evidence')
        if any(identifier not in sources or sources[identifier].kind == 'toc' for identifier in change.source_ids):
            raise ValueError('Structure change cites an unknown source')
        if change.status in {'retained', 'transformed'} and (not change.before_unit_ids or not change.after_unit_ids):
            raise ValueError('Structure mapping requires both sides')
        if change.status == 'newly_listed' and (change.before_unit_ids or not change.after_unit_ids):
            raise ValueError('New structure unit requires only After units')
        if change.status == 'unmatched' and (not change.before_unit_ids or change.after_unit_ids):
            raise ValueError('Unmatched structure unit requires only Before units')
        if mapped_units.intersection(ids):
            raise ValueError('Structure unit occurs in multiple mappings')
        mapped_units.update(ids)
    if result.complete:
        expected_units = {unit.id for unit in result.units if unit.kind != 'role'}
        if mapped_units != expected_units:
            raise ValueError('Completed analysis lacks structure coverage')


def materialize_evidence(finding: dict, sources: dict[str, dict]) -> list[dict]:
    result = []
    for evidence in finding['evidence']:
        source = sources[evidence['source_id']]
        start, end = evidence.get('start_offset'), evidence.get('end_offset')
        text = source['original_text'] if start is None else source['original_text'][start:end]
        result.append({**evidence, 'excerpt': text, 'locator': source['locator'],
                       'clause_no': source['clause_no'], 'document_id': source['document_id'],
                       'side': source['side'], 'parent_id': source['parent_id']})
    return result
