# Compare duties using evidence

Input includes target_function_ids, before_functions, after_functions, sources,
mode and available-side counts. Assess the target Before IDs; candidates and
counts are not full corpus review. Read functions with original source blocks
and parent context. Candidate ranking is lexical assistance, never proof of no match. Use
search_clauses and get_clause for synonyms, other owners, changed numbers, split
clauses and wider/narrower formulations. get_unit_functions shows the context of
a supplied unit. check_references locates actual cross-reference targets but does
not prove their semantic correctness.

For unfiltered searches supply filters.document_id=null and
filters.clause_prefix=null. search_clauses, get_unit_functions and
check_references are paginated:
use returned next_offset when more results are needed. A scanned-block count
means lexical scanning, not that you semantically read every block. A truncated
reference result cannot establish that all references were checked. A raw clause
returned by search is evidence, not a newly registered function ID.

Return mappings of every assessed target Before duty: preserved, rephrased,
transferred, split or merged; use review for an uncertain correspondence with
valid evidence from both sides. Many-to-many function ID lists are allowed. A
different owner can mean a transfer even if wording is unchanged. Transfer alone
is not a problem. Compare mandatory/permitted/prohibited and scope separately.
Use modality_changed or scope_changed when supported by both sides.
Otherwise use issue_type=none, or uncertainty when the correspondence needs
review. Do not emit gap, overlap or conflict here; those have separate passes.
A split requires one Before and at least two After functions. A merge requires
at least two Before and one After function. For a wider many-to-many mapping,
use the supported change type that describes it without misusing split/merged.

Each mapped finding needs valid Before and After function IDs and source evidence
from both. Include the parent sources that establish an actor when necessary.
Every referenced function must contribute at least one of its own source IDs
with the corresponding before/after evidence_role. Extra parent evidence may use
context. Every finding must involve at least one target Before function. Do not
invent function IDs when a promising raw source has no extracted function. Do
not emit added or unmatched findings here: the application performs a semantic
sweep of every available opposite-side raw body source for absence decisions.

For a target with no supported mapping, include its ID in unmatched_function_ids.
Return findings, reviewed_function_ids and unmatched_function_ids.
reviewed_function_ids must contain exactly all target Before duties assessed,
each once; a successful batch requires all targets. unmatched_function_ids must
be exactly the target IDs not included in any returned finding. A target cannot
be both mapped and unmatched. An unmatched ID here means unresolved candidate
comparison, not a proven missing duty in the complete After set.

Findings must be concise. Set search=null: the application owns raw-source search
coverage. search_queries may contain only queries actually run through tools.
An empty list is correct when none were used. Do not invent searches or coverage.
