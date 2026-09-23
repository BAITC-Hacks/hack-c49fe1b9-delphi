# Delphi — document review and revision feedback

Updated: 2026-09-23. This document consolidates the workspace review and the agreed frontend/backend recommendations from the chat. It records current behavior, proposed improvements and relevant implementation files. Creating this document does not implement the proposed features or establish new test results.

**Scope update:** Phase 1 native lab-to-backend integration is complete. The separately requested Phase 2 demo-design transfer is now implemented in the connected frontend. Only the demo directory was refreshed from remote to `231811e` (design code unchanged from `45b3372`). Evidence highlighting, grouped Before/After passages, bounded word differences and queue/table views are implemented. Full-document alignment, editable proposals, revision editing and live AI acceptance remain future work.

This is a feedback reference, not a replacement task tracker. [Implementation plan](implementation-plan.md) owns tasks, acceptance and delivery status; [product.md](product.md) owns product behavior; [architecture.md](architecture.md) owns data and API contracts. Promote accepted changes into those documents when implementation begins. The delivery steps below are feature proposals; current phase ownership is defined in the implementation plan.

## 1. Current implementation and limits

| Area | Available in the connected application | Remaining gap |
|---|---|---|
| Authentication | Better Auth sign-in/sign-up, persistent sessions, protected Next.js pages and backend proxy | Backend has no per-user ownership or enforced roles; signed-in users share the workspace |
| Uploads | Named drafts, multiple Before/After documents, DOCX/text PDF/XLSX/Markdown, parsing notes and explicit partial-analysis consent | Scanned PDFs need separate OCR; original Office page layout is not rendered |
| History | Saved comparisons, title search, status filters, Open/Continue and Repeat | No linked document-version timeline; revision labels are metadata |
| Document preview | Searchable original extracted blocks, clause numbers and source locations | No faithful Word/PDF viewer or in-app paragraph editing |
| Findings | Summary filters, queue/table views, structure/function changes, original evidence grouped by side, responsive paired passages and bounded word differences | No exhaustive full-document alignment; many-to-many evidence is not forced into arbitrary pairs |
| Source panel / evidence cards | Original clause, parent context, readable locations, navigation and verified Unicode-offset highlighting in evidence cards | No faithful Office layout or in-app editing; invalid offsets show the original block without highlighting |
| Human review | Confirm, reject, request clarification and save a note | Review does not approve replacement wording or edit a document |
| Recommendations | Saved explanation of what should be checked or clarified | No proposed replacement text, proposal decision or application workflow |
| Languages and reports | RU/KK/EN UI, explicit translation of saved explanations, HTML/print-to-PDF and function CSV | Live AI analysis and translation quality still require acceptance |
| Verification | Phase 2 lint/typecheck/build and 16/16 evidence/queue tests; real history/new-draft and synthetic summary/review visual spot checks at desktop/mobile widths | No full pipeline E2E or live AI run; the existing generated browser report is historical and was not overwritten |

The [frontend README](../frontend/README.md) records current commands and focused visual checks. The earlier [browser report](../frontend/docs/report/latest.md) remains unchanged and describes its own recorded version; its [README](../frontend/docs/report/README.md) explains real versus synthetic coverage.

## 2. Current user journey

1. With local services running, open `http://localhost:3000` and sign in or register. Setup and local demo accounts are documented in the [frontend README](../frontend/README.md).
2. Open shared comparison history. Continue a draft, open a saved result, or choose **New comparison** and enter a title.
3. Upload documents under **Before** and **After**. Defaults are 10 MiB per file and 10 documents per comparison; backend settings own the actual limits. Files and extracted source blocks are saved during preparation.
4. Preview the original extracted text, check warnings and revision labels, and correct file placement. Draft files can be removed or moved between sides. Their content cannot be edited in the application.
5. Choose the explanation language and start analysis. Both sides require readable content; parsing gaps require explicit consent. Starting locks the input set. The backend extracts units/functions, compares structure and duties, searches all available After sources for suspected losses and Before sources before calling a duty new, checks overlaps/conflicts, validates evidence and saves the result. The UI polls progress.
6. Inspect structure, findings and their original sources. Save human-review decisions and notes, then view/export the conclusion. UI language changes do not rerun analysis; translation is an explicit action on saved explanations.
7. To compare revised content, choose **Repeat**, remove the copied file being replaced, upload its replacement and start a new run. The previous analysis keeps its original input and result. Today the new comparison is not linked into a document-version timeline.

## 3. Implemented reader and comparison; remaining validation

The connected `frontend/` now uses the demo navy/white tokens, locally bundled
Inter/JetBrains Mono, top navigation, compact history and real two-column
Before/After upload zones. Draft creation, server uploads, revision labels,
moving/removing files and explicit partial-analysis consent remain intact.
Results offer summary filters and queue/table views over the same saved data;
URL filters and finding/source links remain available. Review decisions still
save through the product API and advance the queue to another unreviewed finding.

### A. Evidence reader and exact highlighting — implemented

Evidence cards show original text, file/revision/clause context and expandable
parent text. They validate integer Python Unicode code-point offsets, convert
them to JavaScript UTF-16 and require an exact excerpt match. Null offsets mean
the whole block only when excerpt matches it. Invalid bounds or a mismatched
excerpt show the full original block with a warning and no fabricated highlight.
Long clauses can expand; original whitespace and quotations remain unchanged.
This is an extracted-text reader, not a faithful Office/PDF layout viewer.

### B. Grouped Before/After passages and word differences — implemented

All direct Before/After sources and additional context are retained, shown beside
one another when space permits and stacked on narrow views. Missing or
inapplicable sides do not receive invented quotations. Overlap/conflict findings
retain their After evidence. Many-to-many mappings remain groups.

Word differences are available only when one Before function and one After
function each have exactly one direct source with valid evidence offsets.
Split/merge, overlap/conflict and ambiguous groups are excluded. The local LCS
preserves whitespace and is bounded to 600 word/whitespace tokens and 60,000
UTF-16 units on each side; oversized input keeps the original passages and shows
a limit message. Removed wording is not proof of a lost duty. Opening evidence,
changing queue/table mode or showing word differences makes no model request.

Full-document alignment, a separate complete-document comparison mode and the
proposal/editor/version workflows below remain future work. Current technical
checks and visual spot checks are recorded in the frontend README; they do not
establish live model correctness.

### C. Future live AI validation — outside this design transfer

Follow the existing [acceptance plan](implementation-plan.md) and [source ground truth](source-analysis.md):

- Official editions 8/9: structure changes in 3.4, transfer `5.4.4 → 5.3.3`, renumbering `5.8 → 5.7`, modality change in 9.15, and no unsupported loss of reporting duties.
- Labelled synthetic examples: missing duty, overlap, potential conflict, multi-document transfer and legitimate differences in scope.
- Actual saved review, translation and export behavior, beyond the synthetic result-screen tests.
- Runtime, coverage, partial/error states and actual model-call costs under explicit limits. Record misses and false positives rather than inventing a general accuracy percentage.

The backend now saves accepted checkpoints and supports continuation before human review, using the frozen PostgreSQL source registry. Partial outputs remain explicit; this does not establish model quality. Existing lab cost accounting is unchanged, and a separate backend cost-accounting expansion was not part of the current integration or design transfer.

## 4. Subsequent delivery: AI wording proposals

Add an explicitly requested proposal beside the original:

```text
Current wording → Proposed wording → Reason → Supporting sources
```

- Start with replacement of one clearly selected passage. Users may edit the proposal and accept or reject it. An insertion for a missing duty requires an explicit destination/anchor.
- Add a separate proposal model/API containing originating run/finding/source IDs, operation, target, exact base text/hash, proposed text, rationale, evidence, decision and proposal version. These models and endpoints do not exist today.
- Keep proposal generation bounded and on demand. Merely opening a finding or switching language must not generate wording.
- Keep **finding confirmed**, **proposal accepted** and **change applied** as separate actions and states. Accepting a proposal does not modify a document.
- Editing an accepted proposal reopens its decision. Version checks must reject stale edits/decisions rather than silently overwriting them.
- Establish trusted backend author identity before claiming who proposed, edited or accepted wording. A browser-supplied author ID is not trusted identity. Current Better Auth gating does not supply backend authorship.
- Display proposals as proposed wording, not original quotations or newly verified findings. Preserve the original saved analysis and its report semantics.

**Acceptance:** a proposal has traceable sources and a precise target; editing, accepting or rejecting it survives refresh and does not change source text, finding review or analysis output.

## 5. Later delivery: editable drafts and revision history

```text
Original documents → Saved analysis → Proposed correction → New document draft → New analysis
```

**Frontend work**

- Add a clearer **Compare newer revision** action using the existing Repeat preparation flow; distinguish the copied draft in history.
- When version storage exists, display linked revisions and manual/AI-assisted changes.
- Let the user apply an accepted proposal to a separate draft and review the resulting content before explicitly starting another analysis.

**Backend work**

- Add document-family/revision relationships, parent comparison links where needed, immutable revision snapshots and change records. A revision label alone is not version history.
- Keep document versions and proposal versions separate from `review_revision`, which tracks human review of findings.
- Applying a proposal must verify the expected draft version and target hash, write the change/audit record and advance the version atomically. Duplicate application must not apply the change twice.
- Preserve original source IDs/text for existing analyses. Reanalysis freezes a new source set with new IDs and links it to the appropriate draft revision.
- Use verified authorship and conflict handling for shared edits. Per-user private workspaces would additionally require backend ownership/access controls; they are not provided by this revision feature alone.

**Acceptance:** editing a new draft cannot alter evidence or source quotations in an earlier analysis/report; a stale proposal cannot overwrite changed text; a new analysis uses the exact selected draft revision.

Faithful Word editing, automatic numbering, tables, formatting and Office tracked changes are a separate larger feature. An extracted-text draft must not be advertised or exported as preserving the original DOCX layout. OCR and comprehensive document-wide alignment are also outside the immediate reader delivery.

## 6. Visual and data rules across all deliveries

| Meaning | What the UI may claim |
|---|---|
| Evidence highlight | This exact original phrase supports this finding |
| Text difference | These words differ between the displayed passages |
| Proposed correction | A user or AI proposes this wording for a new draft |

Use labels and accessible styling to distinguish these meanings; color alone is insufficient. A removed word is not proof of a lost function, and a transfer is not automatically a risk. Preserve roles, scope, many-to-many relationships and incomplete-coverage warnings throughout the flow.

UI translations must preserve original quotations. Reviewing a finding must not apply a proposal. Applying a proposal must not silently rerun analysis. Unknown source IDs are errors, and uncertain mappings remain review questions.

## 7. Project file references

### Owning documents and requirements

| Purpose | Files |
|---|---|
| Navigation and repository rules | [Project README](../README.md), [documentation index](README.md), [AGENTS.md](../AGENTS.md) |
| Product, architecture and delivery ownership | [Product](product.md), [architecture](architecture.md), [implementation plan](implementation-plan.md) |
| Required hackathon scope | [Organizer instructions](hackaton/hackaton_instructiona.md), [selected organizational-analysis case](hackaton/tracks/HackAlem_AI_ИИ_агент_«Анализ_организационной_структуры_и_функционала».md) |
| Ground truth and original inputs | [Source analysis](source-analysis.md), [original sources](sources/), [synthetic acceptance corpus](../backend/fixtures/synthetic/README.md) |
| Frontend conventions and setup | [Frontend README](../frontend/README.md), [frontend rules](../frontend/AGENTS.md), [coding conventions](guides/frontend-coding-conventions.md) |
| Backend setup and API | [Backend README](../backend/README.md), [OpenAPI](../backend/openapi.json), [configuration](../backend/app/config.py) |

### Connected frontend implementation

| Area | Existing files to consult |
|---|---|
| Login, registration and protection | [Sign-in](../frontend/src/features/auth/client/sign-in-form.tsx), [sign-up](../frontend/src/features/auth/client/sign-up-form.tsx), [auth configuration](../frontend/src/server/auth.ts), [workspace gate](<../frontend/src/app/(workspace)/layout.tsx>), [proxy route](../frontend/src/app/backend/[...path]/route.ts), [proxy forwarding](../frontend/src/server/backend-proxy.ts) |
| History and repeat | [History table](../frontend/src/features/analyses/client/history-table-view.tsx), [analysis API](../frontend/src/features/analyses/api/analyses.ts) |
| Upload and document preparation | [Comparison editor](../frontend/src/features/analyses/client/comparison-editor.tsx), [document card](../frontend/src/features/analyses/client/document-card.tsx), [source preview](../frontend/src/features/analyses/client/source-preview.tsx) |
| Reader and comparison integration | [Evidence validation/diff](../frontend/src/features/results/model/evidence.ts), [evidence cards](../frontend/src/features/results/client/evidence-card.tsx), [word differences](../frontend/src/features/results/client/word-diff.tsx), [review queue](../frontend/src/features/results/client/review-queue.tsx), [Results workspace](../frontend/src/features/results/client/results-workspace.tsx), [findings table](../frontend/src/features/results/client/findings-table-view.tsx), [finding detail](../frontend/src/features/results/client/finding-detail.tsx), [source panel](../frontend/src/features/results/client/source-panel.tsx) |
| Structure, coverage and shareable state | [Structure view](../frontend/src/features/results/client/structure-view.tsx), [coverage summary](../frontend/src/features/results/client/coverage-summary.tsx), [URL state](../frontend/src/features/results/client/use-results-location.ts) |
| Review, translation and exports | [Review form](../frontend/src/features/results/client/review-form.tsx), [conclusion view](../frontend/src/features/results/client/conclusion-view.tsx), [results API](../frontend/src/features/results/api/results-api.ts), [UI localization](../frontend/src/shared/i18n/index.tsx) |
| Generated contract | [HeyAPI configuration](../frontend/openapi-ts.config.ts), [generated client/types](../frontend/src/shared/api/generated/) — regenerate from OpenAPI; do not hand-edit |

### Backend implementation

| Area | Existing files to consult |
|---|---|
| Analysis/history/repeat | [Analysis service](../backend/app/services/analyses.py), [analysis model](../backend/app/models/analyses.py), [analysis schemas](../backend/app/schemas/analyses.py) |
| Uploads, originals and source blocks | [Document service](../backend/app/services/documents.py), [source service](../backend/app/services/sources.py), [document models](../backend/app/models/documents.py), [document schemas](../backend/app/schemas/documents.py), [parser types](../backend/app/parsers/types.py), [parsers](../backend/app/parsers/) |
| Evidence, offsets and human review | [Finding service](../backend/app/services/findings.py), [finding/evidence/review models](../backend/app/models/findings.py), [evidence schemas](../backend/app/schemas/findings.py), [finding routes](../backend/app/api/findings.py) |
| Frozen runs and persistence | [Run service](../backend/app/services/runs.py), [workflow](../backend/app/services/workflow.py), [result persistence](../backend/app/services/results.py), [run models](../backend/app/models/runs.py) |
| Semantic comparison and coverage | [Agent engine](../backend/app/agent/engine.py), [extraction](../backend/app/agent/extraction.py), [matching](../backend/app/agent/matching.py), [structure comparison](../backend/app/agent/structure.py), [missing-duty search](../backend/app/agent/missing.py), [source tools](../backend/app/agent/tools.py) |
| Integrity and bounded model calls | [Agent validation](../backend/app/agent/validation.py), [result validation](../backend/app/domain/result_validation.py), [model client](../backend/app/agent/model_client.py) |
| Saved-result translation and reports | [Translation service](../backend/app/services/translations.py), [report service](../backend/app/services/reports.py), [report rendering](../backend/app/reporting/rendering.py) |
| Future proposal/version contract changes | [Schemas](../backend/app/schemas/), [models](../backend/app/models/), [services](../backend/app/services/), [thin API routes](../backend/app/api/), [Alembic migrations](../backend/migrations/), [OpenAPI export script](../backend/scripts/export_openapi.py) — proposed feature files do not exist yet |

### Verification, experiments and historical context

| Purpose | Files and interpretation |
|---|---|
| Browser acceptance | [Results tests](../frontend/tests/e2e/results.spec.ts), [workspace tests](../frontend/tests/e2e/workspace.spec.ts), [auth tests](../frontend/tests/e2e/auth.spec.ts), [mobile tests](../frontend/tests/e2e/mobile.spec.ts), [synthetic result fixtures](../frontend/tests/fixtures/results.ts) |
| Browser report | [Latest report](../frontend/docs/report/latest.md), [report instructions](../frontend/docs/report/README.md), [reporter tests](../frontend/tests/reporters/ui-report.test.mjs) |
| Backend regression checks | [Parser tests](../backend/tests/test_parsers.py), [mocked-agent tests](../backend/tests/test_agent.py), [report integrity](../backend/tests/test_report_integrity.py), [synthetic corpus checks](../backend/tests/test_synthetic_fixtures.py) |
| Demo design reference | [Demo README](../demo-frontend/README.md), [design](../demo-frontend/docs/design/DESIGN.md), [scenarios](../demo-frontend/docs/design/SCENARIOS.md), [UI prompts](../demo-frontend/docs/design/ASTRA-UI-PROMPTS.md). The design is adapted to the connected Next.js frontend; demo fixtures and transport remain separate. |
| Earlier project snapshots | [Earlier feedback](research/delphi-current-feedback.md), [handoff](handoff.md), [history](history.md). Frontend/readiness claims describe earlier states; prefer current owning docs, code and reports. |
| Lab and reliability proposals | [Lab README](../lab/README.md), [lab documentation](../lab/docs/README.md), [partial live-run handoff](../lab/docs/handoff.md), [backend/lab alignment](../lab/docs/backend-lab-alignment.md), [cost tooling](../agent_costs/README.md). Experimental results and proposed transfers are not implemented product guarantees; do not introduce a SQLite fallback. |

## 8. Implementation handoff

- **A/B are implemented within the limits above.** Phase 2 retained product API/auth/RU-KK-EN/review semantics and passed current static/unit checks plus focused real/synthetic visual checks. C, complete-document alignment, proposals and editable drafts remain future work; no full pipeline E2E or live AI run was added.
- Move selected tasks and acceptance status into [implementation-plan.md](implementation-plan.md); update [product.md](product.md) for UI behavior and [architecture.md](architecture.md) for changed contracts. Keep this document as the rationale and file map.
- Preserve original files under `docs/sources` and `docs/hackaton`. Put new synthetic fixtures in their dedicated locations and label screenshots/results accurately.
- Keep the current stack, thin routers, service-owned transactions, PostgreSQL/Alembic, one bounded agent and stable OpenAPI operation IDs. Generate shadcn primitives through the CLI and keep product components outside `components/ui`.
- For implementation changes, use the actual commands and prerequisites in the frontend/backend READMEs: targeted integrity checks, frontend lint/typecheck/build and appropriate browser scenarios. Regenerate HeyAPI when the API contract changes. Run reporter tests only when changing reporting behavior.
- Record checks actually performed. Documentation work, mocked responses and a successful build do not establish real AI quality or faithful Office editing.
