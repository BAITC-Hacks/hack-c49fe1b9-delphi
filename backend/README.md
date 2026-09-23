# Delphi backend

FastAPI backend for comparing Before/After organizational documents, following functions between units, reviewing findings and exporting evidence-backed reports. PostgreSQL is the only database. The frontend can generate its HeyAPI client from [openapi.json](openapi.json).

## Structure

```text
app/
  main.py             Application factory and router registration
  lifespan.py         Database, AI client and single-worker lifecycle
  config.py           Explicit environment configuration
  db.py               Async SQLAlchemy engine/session factory
  api/                HTTP routes grouped by feature; no database queries
  schemas/            Typed input/output contracts, enums and error responses
  services/           Analysis, document, run, review and report use cases
  domain/             Business errors and result integrity rules
  models/             PostgreSQL entities grouped by feature
  parsers/            DOCX, Markdown, text PDF and XLSX readers
  agent/              Extraction, matching, missing-duty search and bounded tools
  reporting/          HTML/CSV rendering and RU/KK/EN labels
migrations/           Alembic schema versions
scripts/              Offline OpenAPI export and optional demo seeding
fixtures/             Explicit development/demo inputs
tests/                Parser and mocked-agent checks
```

Routes call services; services own transactions and enforce business rules. Parsers, agent calls and report rendering have separate modules. There is one application and one in-process execution queue. No frontend files or generated TypeScript client are maintained here.

## Core behavior

- Multiple documents per Before/After side, with exact source text, clause numbers, parent context and format-specific locations.
- A run freezes its document set. Repeated start requests with the same options return the existing run; repeating an analysis creates a new draft with new source IDs.
- Parsing gaps require `allow_partial: true`. Complete failure to read a document prevents starting the run. TOC removal alone is informational.
- Extraction and many-to-many function matching preserve actors, units, scope, conditions and modality. Overlaps and potential conflicts require evidence from multiple After functions.
- Missing-duty candidates require the entire available After set; every unmapped After duty is searched against the original Before set before being called new. Incomplete inputs, searches or unresolved owners remain “needs review.”
- HTML reports expose the saved search coverage, candidate source references and search errors alongside the finding. A complete search only covers the supplied documents.
- AI references are checked against the frozen database sources before results are saved. Evidence excerpts are sliced from the original text by code.
- Review changes increment `review_revision` in the same transaction. Reports and translations are cached by run, revision and language.
- Explicit RU/KK/EN translation includes saved findings, structure explanations and summary. Structure and exact original evidence also appear in HTML reports; original names, quotations and reviewer notes remain unchanged.
- Review notes retain their submitted whitespace and line breaks; their text is excluded from model translation.

Accepted batches are saved in `Run.checkpoint` (JSONB, migration `0003`). On timeout, cancellation or restart, the latest valid snapshot becomes a readable `partial` result; without one, the run is `failed`/`interrupted`. `resume_run` continues the same frozen source set, original model and pipeline version before any subsequent human review. It invalidates generated result/cache rows and increments the result revision; user edits block continuation. Extraction growth invalidates dependent matches with an audit trace. A PostgreSQL advisory lock still enforces one application worker.

## Frontend contract

`openapi.json` contains stable `operationId` values, feature tags, explicit response schemas, typed coverage/status fields and a shared error envelope:

```json
{"code": "partial_input", "message": "Review parsing warnings and explicitly allow partial input", "details": []}
```

| UI action | API operation |
|---|---|
| Create/list/open comparison | `create_analysis`, `list_analyses`, `get_analysis` |
| Upload/change/remove document | `upload_document`, `update_document`, `delete_document` |
| Inspect parsed text | `list_document_sources`, `get_source` |
| Start, poll or continue processing | `start_run`, `get_run`, `resume_run` |
| Display functions/findings | `list_functions`, `list_findings` |
| Open evidence and save review | `get_finding_evidence`, `update_finding_review` |
| Repeat with editable documents | `repeat_analysis` |
| Translate/export saved results | `create_translation`, `get_report`, `export_functions` |

After `start_run` returns HTTP 202, poll `get_run` until its state is `completed`, `partial`, `failed` or `interrupted`. Findings are published when a complete or stopped partial result is persisted. `resume_available` gates the frontend continuation action. Treat `partial` as a visible limitation. Compare `review_revision` when refreshing exports/translations. HTML reports in another language require `create_translation` first; CSV does not require translation. Use a frontend development proxy for `/api`, or deploy the frontend and API behind the same origin.

Regenerate the schema after changing a route or DTO, from `backend/`:

```sh
uv run --no-sync python scripts/export_openapi.py
```

This imports the application without starting its lifecycle: no database, Docker, API key or AI request is required. Give the resulting `backend/openapi.json` to your HeyAPI generator. Keep generated clients in the frontend's shared API directory and consume them from feature modules.

## Configuration and startup

Use Python 3.12 and uv. Create `backend/.env` from [.env.example](.env.example) only if it does not already exist. Set a local PostgreSQL password and the matching `DATABASE_URL`; use a URL-safe password or URL-encode it in the DSN. Runtime limits are explicit settings. Set `OPENAI_API_KEY` and `OPENAI_MODEL` for analysis and translation. Without them, document preparation remains available and AI operations return an explicit 503.

From the repository root, when ready to run PostgreSQL:

```sh
docker compose --env-file backend/.env up -d postgres
```

Then from `backend/`:

```sh
uv sync --frozen
uv run alembic upgrade head
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

The API schema is also served at `/openapi.json`, Swagger at `/docs`, and status at `/api/health`. The configured local PostgreSQL port is `54329`. Keep one API worker. The provided Dockerfile/Compose API service is an alternative deployment configuration; it has not been built during this code-preparation step.

### Fast preview

Set `ANALYSIS_MODE=fast` in `backend/.env` and restart the single API worker to prioritize a useful first result. `full` remains the default. Fast mode sends both complete saved source sets in one bounded model request, returns a small selection of findings with validated source references, and always saves a `partial` result. It skips exhaustive function extraction, per-function absence/newness searches and tool loops. Its function counts describe only the preview catalog. It cannot establish that a function is absent or new. Input warnings, including the absent annex in DOCX revisions 8/9, remain visible.

Start a new comparison (or repeat an existing one), then use the normal `start_run` API with `{"output_language":"ru","allow_partial":true}` for the supplied DOCX pair. Fast runs use pipeline `delphi-0.2-fast`; they cannot resume as exhaustive runs. To continue an old full checkpoint, restore `ANALYSIS_MODE=full` and restart the worker. An oversized fast input is rejected explicitly; source text is never silently truncated.

With the fast backend running, from `backend/`:

```sh
uv run --no-sync python scripts/run_docx_preview.py
```

This creates a new analysis, uploads the original DOCX 8/9 pair, starts a live model run, polls its terminal state, and saves API JSON plus the Russian HTML report under `backend/storage/reports/<run_id>/`. It requires the development dependencies (`httpx`).

Optional demo fixture instructions are in [fixtures/README.md](fixtures/README.md). Backend development user records remain scaffolding: FastAPI has no login or resource-ownership enforcement. The frontend now provides Better Auth sessions in a separate database and a protected proxy; the backend workspace is shared.

## Verification status

Live fast preview (2026-09-23, explicitly requested): original DOCX revision 8 Before / revision 9 After uploaded through HTTP; file hashes matched the originals. Run `96c71d9f-1594-4093-a396-dfa287096daf` finished in **61.4 seconds** (62.7 seconds including polling/report) using `gpt-6-sol`, with all **966 readable blocks supplied**, **10 findings**, 8 selected Before functions, 10 selected After functions, and 3 structure mappings. State is intentionally `partial`. All 39 finding evidence references resolved to exact saved source text, the PostgreSQL checkpoint validated, and Russian HTML export returned 200. Local artifacts: `storage/reports/96c71d9f-1594-4093-a396-dfa287096daf/`; UI: `/analyses/b8f77135-d939-4644-b438-d96c3bc8377b`.

The earlier full run stopped during extraction with 80/966 blocks; its checkpoint and readable partial result were preserved. Provider output truncation had reached the SDK's JSON parser before the application inspected `max_output_tokens`; the client now checks the raw response status first so full extraction can split unaccepted batches. This full pipeline has not been rerun to completion. The fast result demonstrates a live backend path and evidence persistence, not exhaustive semantic quality, full missing/new-function coverage, or KK/EN quality.

After the fast-path and output-limit fixes: **153 backend tests passed**, including real-SDK mocked HTTP truncation checks and 20 fast-preview integrity checks; Ruff passed. A final offline duplicate-duty ID regression fix was applied after the live run without rewriting its saved findings. The worker was restarted with the final code and local `ANALYSIS_MODE=fast`.

Final Phase 1 checks (2026-09-23): **127 backend tests passed**, Ruff passed, OpenAPI exported with 20 operations, local Alembic upgrade to `0003` passed, and `alembic check` reported no schema drift. All model responses in these tests are scripted. Frontend HeyAPI generation, lint, typecheck and production build passed.

Phase 1 integrated lab semantics into the native backend and existing frontend. Migration `0003` was applied to local PostgreSQL and its offline SQL export succeeded. That phase did not include end-to-end, Playwright or live-model checks. The subsequently authorized fast live run is recorded above; frontend design status belongs to the frontend README.

Feedback follow-up checks run locally without services: parser and mocked-agent regression tests, synthetic fixture integrity and report integrity tests, Ruff, and an offline comparison of the generated OpenAPI with the saved contract. No API server, image build, live AI request or end-to-end scenario is included in these checks.

```sh
uv run ruff check app scripts migrations tests
uv run pytest -q
```

Phase 0/1 integration additionally applied migrations `0001`/`0002` against local PostgreSQL and reran the seed successfully. HTTP checks covered health, reading the official draft and sources, and multipart Markdown upload/deletion through the authenticated frontend proxy. The retained database has one official draft, two DOCX documents and 966 source blocks. Better Auth migration/seeding and HTTP sign-in/session/sign-out were checked separately. Earlier browser validation verified real authentication and document preparation in Playwright; result screens use labelled synthetic fixtures. See the [browser report](../frontend/docs/report/latest.md). Live AI quality remains unverified.

The supplied revision 9 DOCX is included in the parser regression checks: all 318 numbered clauses match its Markdown export after normalization, and every extracted block retains exact paragraph offsets. The official demo seed uses both DOCX files.

The [synthetic acceptance corpus](fixtures/synthetic/README.md) adds labelled missing-duty, overlap, potential-conflict and false-positive examples. Its checks establish readable inputs and valid expected source references; they do not establish that a real model produces the expected semantic findings. Keep synthetic and official results separate when measuring actual runs. Real supplied documents are Russian; Kazakh/English semantic quality needs separate examples. Scanned PDFs need OCR outside the current parser, tracked changes and absent annexes remain explicit coverage limitations.

Product rules and acceptance examples: [architecture](../docs/architecture.md), [implementation plan](../docs/implementation-plan.md), [source analysis](../docs/source-analysis.md).
