# Delphi — document review and revision feedback

Updated: 2026-09-23. This document consolidates the workspace review and the agreed frontend/backend recommendations from the chat. It records current behavior, proposed improvements and relevant implementation files. Creating this document does not implement the proposed features or establish new test results.

**Recommended next delivery:** an improved document reader, exact evidence highlighting and a Before/After comparison of mapped passages. Validate the real AI pipeline in parallel. Add proposed corrections and editable drafts afterward.

This is a feedback reference, not a replacement task tracker. [Implementation plan](implementation-plan.md) owns tasks, acceptance and delivery status; [product.md](product.md) owns product behavior; [architecture.md](architecture.md) owns data and API contracts. Promote accepted changes into those documents when implementation begins. The delivery steps below do not renumber the existing project phases.

## 1. Current implementation and limits

| Area | Available in the connected application | Remaining gap |
|---|---|---|
| Authentication | Better Auth sign-in/sign-up, persistent sessions, protected Next.js pages and backend proxy | Backend has no per-user ownership or enforced roles; signed-in users share the workspace |
| Uploads | Named drafts, multiple Before/After documents, DOCX/text PDF/XLSX/Markdown, parsing notes and explicit partial-analysis consent | Scanned PDFs need separate OCR; original Office page layout is not rendered |
| History | Saved comparisons, title search, status filters, Open/Continue and Repeat | No linked document-version timeline; revision labels are metadata |
| Document preview | Searchable original extracted blocks, clause numbers and source locations | No faithful Word/PDF viewer or in-app paragraph editing |
| Findings | Structure/function changes, potential risks, explanations and original evidence grouped by side | Before/After passages are stacked; no dedicated paired comparison or word-level difference highlighting |
| Source panel | Original clause, parent context and previous/next passage navigation | No exact supporting-phrase highlight; locations currently expose raw locator JSON |
| Human review | Confirm, reject, request clarification and save a note | Review does not approve replacement wording or edit a document |
| Recommendations | Saved explanation of what should be checked or clarified | No proposed replacement text, proposal decision or application workflow |
| Languages and reports | RU/KK/EN UI, explicit translation of saved explanations, HTML/print-to-PDF and function CSV | Live AI analysis and translation quality still require acceptance |
| Verification | Recorded migrations/seeds, basic HTTP checks, lint/typecheck/build; current plan records 10 browser tests and 10 report-generator tests passed | Result-screen browser tests use synthetic API fixtures; they do not prove live AI correctness |

The [browser report](../frontend/docs/report/latest.md) is the changing source for the latest UI test result; its [README](../frontend/docs/report/README.md) explains real versus synthetic coverage. Counts above describe the snapshot reviewed for this feedback, not a new test run.

## 2. Current user journey

1. With local services running, open `http://localhost:3000` and sign in or register. Setup and local demo accounts are documented in the [frontend README](../frontend/README.md).
2. Open shared comparison history. Continue a draft, open a saved result, or choose **New comparison** and enter a title.
3. Upload documents under **Before** and **After**. Defaults are 10 MiB per file and 10 documents per comparison; backend settings own the actual limits. Files and extracted source blocks are saved during preparation.
4. Preview the original extracted text, check warnings and revision labels, and correct file placement. Draft files can be removed or moved between sides. Their content cannot be edited in the application.
5. Choose the explanation language and start analysis. Both sides require readable content; parsing gaps require explicit consent. Starting locks the input set. The backend extracts units/functions, compares structure and duties, searches available After sources for suspected losses, checks overlaps/conflicts, validates evidence and saves the result. The UI polls progress.
6. Inspect structure, findings and their original sources. Save human-review decisions and notes, then view/export the conclusion. UI language changes do not rerun analysis; translation is an explicit action on saved explanations.
7. To compare revised content, choose **Repeat**, remove the copied file being replaced, upload its replacement and start a new run. The previous analysis keeps its original input and result. Today the new comparison is not linked into a document-version timeline.

## 3. Next delivery: reader and comparison

Build inside the connected `frontend/` application and its FastAPI backend. Use the existing results workspace, especially **Functions and risks**, rather than adding another main page.

```text
Finding list → Original / Before–After reader → Explanation and human review
```

### A. Document reader and exact evidence highlighting

**Frontend work**

- Make all uploaded extracted documents accessible from the result screen.
- Show filename, side, revision label, clause number, parent/surrounding context and parsing limitations.
- Highlight the exact phrase supporting the selected finding while preserving the original text and whitespace.
- Show page, sheet, cell or paragraph information when available instead of raw location JSON. Do not invent page numbers for formats where the parser does not provide them.
- Support keyboard navigation, small screens and the existing finding/source links.

**Backend/contract work**

- Reuse `original_text`, `excerpt`, `start_offset` and `end_offset` from the evidence API. Basic highlighting needs no new persistence model.
- Document offsets as Unicode code-point positions with an exclusive end, matching Python slicing. Convert correctly in JavaScript; ordinary UTF-16 string slicing is not equivalent for every character.
- Check bounds and that the selected exact text matches the excerpt. Do not trim or normalize the stored source before applying offsets.
- Null, invalid or ambiguous offsets must fall back to the cited block without a fabricated phrase highlight.

**Acceptance:** selecting a finding opens the right source and highlights only verified evidence. Test repeated phrases, newlines, RU/KK/EN text, combining marks and non-BMP characters. Original source content remains unchanged.

### B. Before/After comparison of mapped passages

**Frontend work**

- Show Before and After passages in paired columns on desktop and stacked sections on mobile.
- Provide Original and Before/After modes, with optional deterministic added/removed-word highlighting.
- Preserve the selected finding, source context, filters and deep links while changing modes.
- Support multiple documents and many-to-many mappings, including split and merged duties.
- For overlap/conflict findings, show the relevant After passages together. A missing counterpart should remain explicitly absent; do not fabricate an After quotation.

**Backend/contract work**

- Reuse saved function/source relationships. Do not pair clauses solely by equal numbering or evidence-list position.
- Keep ambiguous or multiple relationships visible as groups; a many-to-many mapping does not establish a unique paragraph pair.
- A deterministic text-difference helper can initially work on already available passages. A full-document diff endpoint is not required for this delivery.
- Label the scope accurately: mapped-passage comparison does not enumerate every textual change in the entire document set. Comprehensive document comparison would need a separate alignment and coverage contract.

**Acceptance:** the `5.4.4 → 5.3.3` transfer opens both actual sources; split/merge and two-After-source cases work; renumbering alone is not presented as a lost duty. Reading or changing comparison modes makes no new model request.

### C. Live AI validation in parallel

Follow the existing [acceptance plan](implementation-plan.md) and [source ground truth](source-analysis.md):

- Official editions 8/9: structure changes in 3.4, transfer `5.4.4 → 5.3.3`, renumbering `5.8 → 5.7`, modality change in 9.15, and no unsupported loss of reporting duties.
- Labelled synthetic examples: missing duty, overlap, potential conflict, multi-document transfer and legitimate differences in scope.
- Actual saved review, translation and export behavior, beyond the synthetic result-screen tests.
- Runtime, coverage, partial/error states and actual model-call costs under explicit limits. Record misses and false positives rather than inventing a general accuracy percentage.

The backend currently persists progress during execution but saves extracted results after the agent returns. Checkpoint/resume and cost accounting are useful follow-ups if observed failures require them; they are not prerequisites for the reader. The separate lab's partial run does not establish product AI readiness.

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
| Reader and comparison integration | [Results workspace](../frontend/src/features/results/client/results-workspace.tsx), [findings table](../frontend/src/features/results/client/findings-table-view.tsx), [finding detail](../frontend/src/features/results/client/finding-detail.tsx), [source panel](../frontend/src/features/results/client/source-panel.tsx) |
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
| Separate demo/design work | [Demo README](../demo-frontend/README.md), [design](design/DESIGN.md), [scenarios](design/SCENARIOS.md), [UI prompts](design/ASTRA-UI-PROMPTS.md). These do not prove a feature exists in the connected Next.js frontend; demo design remains a separate project phase. |
| Earlier project snapshots | [Earlier feedback](research/delphi-current-feedback.md), [handoff](handoff.md), [history](history.md). Frontend/readiness claims describe earlier states; prefer current owning docs, code and reports. |
| Lab and reliability proposals | [Lab README](../lab/README.md), [lab documentation](../lab/docs/README.md), [partial live-run handoff](../lab/docs/handoff.md), [backend/lab alignment](../lab/docs/backend-lab-alignment.md), [cost tooling](../agent_costs/README.md). Experimental results and proposed transfers are not implemented product guarantees; do not introduce a SQLite fallback. |

## 8. Implementation handoff

- Immediate scope is **A + B**, with **C** as parallel validation. Proposals and editable drafts are subsequent work, not implied additions to the current hackathon MVP.
- Move selected tasks and acceptance status into [implementation-plan.md](implementation-plan.md); update [product.md](product.md) for UI behavior and [architecture.md](architecture.md) for changed contracts. Keep this document as the rationale and file map.
- Preserve original files under `docs/sources` and `docs/hackaton`. Put new synthetic fixtures in their dedicated locations and label screenshots/results accurately.
- Keep the current stack, thin routers, service-owned transactions, PostgreSQL/Alembic, one bounded agent and stable OpenAPI operation IDs. Generate shadcn primitives through the CLI and keep product components outside `components/ui`.
- For implementation changes, use the actual commands and prerequisites in the frontend/backend READMEs: targeted integrity checks, frontend lint/typecheck/build and appropriate browser scenarios. Regenerate HeyAPI when the API contract changes. Run reporter tests only when changing reporting behavior.
- Record checks actually performed. Documentation work, mocked responses and a successful build do not establish real AI quality or faithful Office editing.
