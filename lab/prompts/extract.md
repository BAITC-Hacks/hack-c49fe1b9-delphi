# Extract atomic duties

Input contains primary_blocks, context_blocks and side. Read every primary block,
including rights, obligations, resources and general sections, not just a duties
chapter. Context blocks explain parents and must not create duplicate duties.
Return processed_source_ids containing exactly the primary IDs actually read.
Do not count a block as read if you could not finish it.

Extract units (unit, role or group) and atomic functions. Use local IDs in this
response; each owner_unit_id must refer to a returned unit. Each function needs
at least one primary source. Include parent IDs when they establish actor/scope.
actor_original and name_original preserve the source's wording. Keep unresolved
actor explicit and owner_unit_ids empty rather than making one up. Include units
that are merely listed as part of a structure, without inventing duties for them.

Unit fields: id, side, kind, name_original, source_ids, parent_unit_id. A parent
must be another local unit returned in THIS response on the same side; include
its evidence from the supplied context. Use null when hierarchy is not explicit.
Never create self-links or cycles. Distinguish identically named roles under
different departments. Do not confuse a source block parent ID with a unit ID.
All local entity IDs and reference lists must be nonempty and unique.

Function fields: id, side, owner_unit_ids, actor_original, action, object, scope,
condition, modality, source_ids. Follow the supplied JSON schema exactly.
Separate distinct duties in one clause. Preserve shared responsibility, a narrow
specialisation and may/must/must-not. Do not turn headings, TOCs, empty clauses or
an absent appendix into duties. An entity first appearing in a revision is only
first listed here; its actual creation date is unknown.

Return units, functions and processed_source_ids. No findings at extraction.
