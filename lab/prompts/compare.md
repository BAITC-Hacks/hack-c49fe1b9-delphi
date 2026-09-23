# Compare duties using evidence

Read before_functions and after_functions together with source blocks and parent
context. Candidate ranking is lexical assistance, never proof of no match. Use
search_clauses and get_clause for synonyms, other owners, changed numbers, split
clauses and wider/narrower formulations. get_unit_functions shows the context of
a supplied unit. check_references locates actual cross-reference targets but does
not prove their semantic correctness.

Return mappings of every assessed target Before duty: preserved, rephrased,
transferred, split or merged. Many-to-many function ID lists are allowed. A
different owner can mean a transfer even if wording is unchanged. Transfer alone
is not a problem. Compare mandatory/permitted/prohibited and scope separately.
Use modality_changed or scope_changed when supported by both sides.

Each mapped finding needs valid Before and After function IDs and source evidence
from both. Include the parent sources that establish an actor when necessary.
Review evidence must exist. Do not emit added or unmatched findings here: the
application performs an additional sweep before deciding they are unresolved.

For a target with no supported mapping, include its ID in unmatched_function_ids.
reviewed_function_ids must identify all target Before duties actually assessed.
Each target must either appear in a mapping or in unmatched_function_ids, never
both. Return every target exactly once in reviewed_function_ids. A mapping can
include several Before and several After IDs; use split only for 1-to-many and
merged only for many-to-1. For many-to-many use transferred, rephrased or review
as the evidence warrants. No counterpart in the candidates is not global absence.

Use issue_type=none, scope_changed, modality_changed or uncertainty. Overlap and
conflict belong to the risks pass. Every referenced function must contribute a
source with its own before/after evidence_role; context evidence alone cannot
prove either side. Set search=null: search coverage is maintained by application
code, never by the model. Use null offsets for whole blocks unless exact offsets
are known. Do not supply quotation text in the response.

Findings must be concise. search_queries may contain only queries actually run
through tools. Empty list is correct when none were used. Do not invent searches.
