"""Server-side references: schema validity alone never establishes evidence."""
from .models import AgentResult, Document


def validate_result(result: AgentResult, documents: list[Document]) -> None:
    sources = {b.id: b for d in documents for b in d.blocks}
    units = {u.id: u for u in result.units}
    functions = {f.id: f for f in result.functions}
    if len(units) != len(result.units) or len(functions) != len(result.functions):
        raise ValueError('Duplicate entity ID')
    if len({f.id for f in result.findings}) != len(result.findings):
        raise ValueError('Duplicate finding ID')

    def source_ids(ids: list[str], side: str) -> None:
        if not ids:
            raise ValueError('Entity has no source evidence')
        if any(i not in sources or sources[i].side != side for i in ids):
            raise ValueError('Unknown or wrong-side source ID')

    for unit in result.units:
        source_ids(unit.source_ids, unit.side)
    for function in result.functions:
        source_ids(function.source_ids, function.side)
        if any(i not in units or units[i].side != function.side for i in function.owner_unit_ids):
            raise ValueError('Unknown or wrong-side unit ID')
    for finding in result.findings:
        for side, ids in [('before', finding.before_function_ids), ('after', finding.after_function_ids)]:
            if any(i not in functions or functions[i].side != side for i in ids):
                raise ValueError('Unknown or wrong-side function ID')
        sides = set()
        after_ids = set()
        if not finding.evidence:
            raise ValueError('Finding has no evidence')
        for evidence in finding.evidence:
            block = sources.get(evidence.source_id)
            if block is None:
                raise ValueError('Finding cites a source outside this run')
            if evidence.evidence_role != 'context' and evidence.evidence_role != block.side:
                raise ValueError('Wrong evidence side')
            start, end = evidence.start_offset, evidence.end_offset
            if (start is None) != (end is None):
                raise ValueError('Both evidence offsets are required together')
            if start is not None and not (0 <= start < end <= len(block.original_text)):
                raise ValueError('Evidence offsets are out of bounds')
            sides.add(block.side)
            if block.side == 'after':
                after_ids.add(block.id)
        if finding.change_type in {'preserved', 'rephrased', 'transferred', 'split', 'merged'}:
            if sides != {'before', 'after'} or not finding.before_function_ids or not finding.after_function_ids:
                raise ValueError('Mapping requires functions and evidence from both sides')
        if finding.issue_type in {'overlap', 'conflict'} and len(after_ids) < 2:
            raise ValueError('Overlap/conflict requires two After sources')
        if finding.change_type == 'unmatched':
            if not finding.before_function_ids or finding.after_function_ids or not finding.search_queries:
                raise ValueError('Unmatched requires a Before function and recorded After searches')


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
