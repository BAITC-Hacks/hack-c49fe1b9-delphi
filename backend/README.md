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
- Missing-duty candidates require a search over the entire available After set. Incomplete inputs downgrade these findings to “needs review.”
- AI references are checked against the frozen database sources before results are saved. Evidence excerpts are sliced from the original text by code.
- Review changes increment `review_revision` in the same transaction. Reports and translations are cached by run, revision and language.
- RU/KK/EN explanations and report headings; original quotations and reviewer notes remain unchanged. Language changes translate saved findings instead of rerunning comparison.

Results are committed atomically after the agent returns. Progress and errors are persisted during execution; extracted intermediate objects are not checkpointed. A process restart marks queued/running work `interrupted`. A timeout marks the run `failed`; the user can create a repeat. A PostgreSQL advisory lock prevents a second application worker from starting against the same database.

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
| Start and poll processing | `start_run`, `get_run` |
| Display functions/findings | `list_functions`, `list_findings` |
| Open evidence and save review | `get_finding_evidence`, `update_finding_review` |
| Repeat with editable documents | `repeat_analysis` |
| Translate/export saved results | `create_translation`, `get_report`, `export_functions` |

After `start_run` returns HTTP 202, poll `get_run` until its state is `completed`, `partial`, `failed` or `interrupted`. Findings are published when result persistence completes. Treat `partial` as a visible limitation. Compare `review_revision` when refreshing exports/translations. HTML reports in another language require `create_translation` first; CSV does not require translation. Use a frontend development proxy for `/api`, or deploy the frontend and API behind the same origin.

Regenerate the schema after changing a route or DTO, from `backend/`:

```sh
uv run --no-sync python scripts/export_openapi.py
```

This imports the application without starting its lifecycle: no database, Docker, API key or AI request is required. Give the resulting `backend/openapi.json` to your HeyAPI generator. Keep generated clients in the frontend's shared API directory and consume them from feature modules.

## Configuration and later startup

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

Optional demo fixture instructions are in [fixtures/README.md](fixtures/README.md). Development user records are preparation for a later authentication phase: login, JWT and access control are not implemented. The current MVP uses one shared demo workspace.

## Verification status

This preparation step uses Ruff, Python compilation/import checks and offline OpenAPI generation. No API server, image build, live AI request or end-to-end scenario was run after the request to limit work to code preparation. Earlier parser and mocked-agent checks passed before the final structural refactors; rerun them before integration:

```sh
uv run ruff check app scripts migrations tests
uv run pytest tests/test_parsers.py tests/test_agent.py
```

The initial migration was checked against PostgreSQL earlier in the session. The later development-user migration is prepared in code. Full API/database behavior, the final refactors and real AI quality still need integration verification. Real supplied documents are Russian; Kazakh/English semantic quality needs separate examples. Scanned PDFs need OCR outside the current parser, tracked changes and absent annexes remain explicit coverage limitations.

Product rules and acceptance examples: [architecture](../docs/architecture.md), [implementation plan](../docs/implementation-plan.md), [source analysis](../docs/source-analysis.md).
