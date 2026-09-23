# Extract atomic duties

Input contains primary_blocks, context_blocks and side. No tools are available
at this stage. Read every primary block,
including rights, obligations, resources and general sections, not just a duties
chapter. Context blocks explain parents and must not create duplicate duties.
An accepted response must return processed_source_ids containing exactly all
primary IDs, each once. Do not acknowledge a block you could not finish: an
incomplete acknowledgement keeps this batch unaccepted rather than pretending
to have full coverage. Context-only IDs never count as processed primary IDs.

Extract units (unit, role or group) and atomic functions. Use local IDs in this
response; every entry in owner_unit_ids must refer to a returned unit. Each function needs
at least one primary source. Include parent IDs when they establish actor/scope.
actor_original and name_original preserve the source's wording. Keep unresolved
actor explicit and owner_unit_ids empty rather than making one up. Include units
that are merely listed as part of a structure, without inventing duties for them.

Unit fields are id, side, kind, name_original, source_ids and parent_unit_id.
Use kind=unit for an organisational unit, role for a position, and group for an
explicit collective. parent_unit_id is null unless the supplied sources state
the relationship; otherwise it refers to another unit's local ID in this same
response. Return that parent unit with its evidence too. No self-parent or
cyclic hierarchy. A director position must not become a department. Extracted
source IDs must belong to primary_blocks or context_blocks on the input side.

Function fields: id, side, owner_unit_ids, actor_original, action, object, scope,
condition, modality, source_ids. Follow the supplied JSON schema exactly.
Separate distinct duties in one clause. Preserve shared responsibility, a narrow
specialisation and may/must/must-not. Keep conditions and scoped exceptions in
the corresponding fields; do not inflate a specific duty into an organisation's
entire remit. Preserve original actor/name text and write internal action,
object, scope and condition summaries in English. Use an empty string for an
unstated textual field, never an invented fact. Do not turn headings, TOCs, empty clauses or
an absent appendix into duties. An entity first appearing in a revision is only
first listed here; its actual creation date is unknown.

Return units, functions and processed_source_ids. No findings at extraction.
