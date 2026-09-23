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
During mode=unmatched_sweep, the After tile is only part of the full set: do not
claim no counterpart globally. Return mappings found in this tile and mark all
assessed targets as reviewed even if no match exists in this tile.

Findings must be concise. search_queries may contain only queries actually run
through tools. Empty list is correct when none were used. Do not invent searches.
