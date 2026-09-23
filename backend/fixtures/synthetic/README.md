# Synthetic acceptance inputs

These small Russian policy documents are invented test materials, clearly labelled in every file. They are unrelated to the supplied Kazakhtelecom revisions. Upload each case as its own analysis and preserve every file's Before/After side.

| Case | Before | After | Expected behavior |
|---|---|---|---|
| `missing` | `before.md` | `after.md` | Monthly risk-register duty is potentially missing after a complete search. Renumbered archive duty is retained. |
| `overlap` | `before.md` | `after.md` | Two departments have the same exclusive responsibility for the same systems and period. Cite both After duties. |
| `conflict` | `before.md` | `after.md` | One rule requires payment before approval; the other prohibits it. Cite both After rules and require human review. |
| `transfer` | `before.md` | **Both** `after-audit.md` and `after-risk.md` | Risk-register duty moves to another department in a second document. It is not missing. |
| `distinct-scope` | `before.md` | `after.md` | Similar duties cover different cities; do not report overlap, conflict, or loss. |

Paths in the table are relative to each case directory. `manifest.json` records exact expected source clauses, acceptable classification labels, mandatory evidence and forbidden interpretations. References use document keys and clause numbers; actual source/function IDs must come from a real upload/run. The listed findings are required semantic checks, not an exhaustive prediction of every legitimate change.

For a future real-model acceptance run:

1. Create one analysis per case and upload all listed documents.
2. Run the configured agent normally. Never send the manifest or expected outcomes to the model as document input.
3. Resolve every finding to its saved original clauses and compare it with the manifest. Confirm the relevant scope and owner, not merely the presence of a label anywhere in the run.
4. For potential loss, verify successful search across all After documents, no remaining candidate and no parsing/search gap. The claim is limited to the supplied set.
5. Record missed expectations and false positives separately. Do not seed or rewrite results to satisfy expectations.

The local check validates parseability, exact clause text and manifest references. It does **not** validate AI understanding and makes no network or database calls:

```sh
cd backend
uv run pytest -q tests/test_synthetic_fixtures.py
```
