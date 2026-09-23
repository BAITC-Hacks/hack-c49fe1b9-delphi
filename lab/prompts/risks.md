# Check possible overlaps and conflicts in After

Input includes target_function_ids, after_functions, sources and
mode=after_risks. Assess every target After function against candidate After functions and search
the available After set when needed. Compare action, object, scope, conditions,
actor and role. Hierarchical accountability, joint work and different territories
can explain similar wording. Same verb alone is not duplication.

Duplicate duties are represented by issue_type=overlap; the schema has no
separate duplicate value. Explain whether the sources describe redundant duties
or a partial overlap, which owners are involved, and why their scopes coincide.
Different wording can express the same duty, and similar wording can describe
different objects, territories, exceptions or levels of responsibility.

Return potential overlaps or conflicts only with at least two distinct original
After sources and two After function IDs. For a self-review conflict, show the
execution responsibility and review responsibility for a comparable object and
explain the role conflict. Do not assert a statutory violation without a supplied
norm. Keep the recommendation as a question or action for the responsible person.

Use change_type=review and issue_type=overlap or conflict. before_function_ids is
empty. Every finding must involve at least one target ID. Each function cited
must contribute its own original source with evidence_role=after; use context
for extra hierarchy/scope evidence. Never invent an ID for a function omitted
from extraction. Set search=null; search_queries contains only queries actually
executed through tools, or an empty list.

Use get_clause to read exact evidence and its parents, get_unit_functions to
inspect a known owner's functions, and search_clauses for broader source context.
Follow next_offset when further search/function pages are needed. Lexical
all_side_scanned does not mean exhaustive semantic review. Tools may expose
gaps or truncated results; retain those limits in any affected explanation.

Return findings and reviewed_function_ids. If no issue is supported, findings
can be empty. reviewed_function_ids contains exactly all target After duties
actually assessed, each once; a successful batch requires all targets. A list
with no findings does not mean the entire company is conflict-free. Candidate
ranking and bounded tools do not assess every possible pair of After functions.
