# Delphi frontend

Next.js App Router + TypeScript, Better Auth, TanStack Query, generated HeyAPI,
React Hook Form/Zod and official shadcn components. Feature modules own their
forms, queries and screens; route files stay small.

Phase 1 lab integration is connected to the existing frontend: saved-run
continuation, Before/After source-search coverage and translated structure
explanations use the generated backend contract. Phase 2 now adapts the latest
`demo-frontend` design to this connected application. Only the demo directory was
refreshed from `origin/main` to `231811e`; its design code is unchanged from
`45b3372`. No demo fixtures, demo transport or offline mode were copied into the
product. Navy/white tokens, bundled Inter and JetBrains Mono, top navigation,
history, real Before/After drop zones and the results workspace share one style.

## Working MVP

- `/sign-in`, `/sign-up`: email/password authentication and persistent sessions.
- `/`: compact saved comparisons, search, status filters, pagination and repeat as a new draft.
- `/new?analysis=<id>`: draft creation, multiple Before/After uploads, revision
  labels, moving/deleting documents, parsing warnings and exact source previews.
  Keyboard-accessible drop zones support real drag-and-drop and file selection.
- `/analyses/<id>`: run polling, coverage, structure, findings, evidence, human
  review notes, report preview/print/HTML download and function CSV export.
  Summary tiles filter the saved findings. Queue and table views share URL state;
  the queue advances to the next unreviewed finding after a saved decision.
  A linked finding stays selected even when queue filters exclude it; unknown
  finding IDs show an error. Copied finding links clear filters and source selection.
  Responsive tabs and filters keep the analysis usable on narrow screens;
  the coverage summary exposes saved limitations even when collapsed.
  Before/After evidence preserves all sources, many-to-many groups and context.
  Stopped runs show their saved findings and source evidence. When the backend
  reports that continuation is available, **Continue analysis** resumes saved
  progress with the same input documents. **Repeat in a new draft** creates a
  separate comparison. Saving a human review decision or note prevents resume.
- RU/KK/EN UI, mobile navigation and a notification bell showing real actions.
  Notifications are in memory for the current tab and clear on sign-out.

UI language and analysis output language are separate. Switching UI language
never reruns an analysis or automatically calls AI. Translation of saved
finding and structure explanations requires an explicit action; original unit
names, source quotes and review notes stay unchanged. Evidence search shows
whether the Before or After document set was checked. Coverage distinguishes
After risk checks from verification of the origin of After functions. Source views
show readable document positions and the saved parent-context chain; sources
outside the current comparison are rejected in the results panel.

Evidence highlighting checks Python Unicode code-point offsets against the exact
saved excerpt before converting to JavaScript UTF-16. Invalid bounds display the
full original block with a warning; no approximate phrase match is substituted.
Long clauses can expand, with their saved parent context available. Local word
differences are available only for an unambiguous one-function/one-source pair
on each side; split/merge and overlap/conflict groups are excluded. The LCS is
bounded to 600 word/whitespace tokens and 60,000 UTF-16 units per side. Larger
inputs keep their original quotations with an explicit limit message. This is
passage comparison, not complete document alignment or a document editor.

## Local setup

Use Node.js 22 or newer. Start PostgreSQL and the backend using
[backend/README.md](../backend/README.md). From `backend/`, populate the official
revision 8/9 DOCX draft:

```sh
uv run --no-sync alembic upgrade head
uv run --no-sync python scripts/seed.py
```

Better Auth requires a separate database, `delphi_frontend`. On a fresh local
Compose setup, create it once from the repository root:

```sh
docker compose --env-file backend/.env exec postgres createdb -U delphi delphi_frontend
```

Do not run `createdb` again when the database already exists. The backend's
development `users` table is unrelated to Better Auth accounts.

From `frontend/`:

```sh
npm ci
```

If `.env` does not exist, copy `.env.example` to it. Set `AUTH_DATABASE_URL` to
the dedicated database, `BETTER_AUTH_SECRET` to a generated secret of at least
32 characters, `BETTER_AUTH_URL=http://localhost:3000`, and
`BACKEND_INTERNAL_URL=http://127.0.0.1:8000`. Keep this file private and ignored.
The local Compose PostgreSQL port is `54329`.

```sh
npm run auth:migrate
npm run auth:seed
npm run api:generate
npm run dev
```

Open **http://localhost:3000**. The seeded accounts are:

| Email | Local demo password |
|---|---|
| `admin@delphi.local` | `password123` |
| `analyst@delphi.local` | `password123` |
| `reviewer@delphi.local` | `password123` |

`DELPHI_DEMO_PASSWORD` can override the password for newly seeded accounts.
Seeding skips existing accounts and preserves their passwords. The seed script
refuses production mode. Names such as “admin” do not grant application roles:
all signed-in users currently share the same backend workspace.

## API and UI boundaries

The browser calls `/backend/api/...`; the Next.js proxy verifies its session,
checks mutation origins and forwards to the server-only backend address. It
preserves multipart uploads, downloads and relevant report headers. FastAPI
does not yet implement user ownership or backend authorization. Keep it on the
internal/loopback network and expose Next.js as the application entry point.

`npm run api:generate` reads `../backend/openapi.json`. Generated DTOs and SDK
files live in `src/shared/api/generated`; feature API modules consume them.
Regenerate the backend schema first whenever its contracts change.

Generate UI primitives through the official CLI:

```sh
npx shadcn@latest add <component>
```

Keep custom Delphi components outside `components/ui`. See
[coding conventions](../docs/guides/frontend-coding-conventions.md).

## Checks and handoff

```sh
npm run lint
npm run typecheck
npm run build
```

Verified locally: these three checks; repeatable database migration/seeding;
HTTP sign-in/session/sign-out; protected pages; proxy authentication and origin
guards; real multipart upload/source read/deletion. The retained seed contains
one draft, two official DOCX documents and 966 exact source blocks. Both files
have parsing limitations, visible in the editor and requiring explicit consent
for a partial analysis.

The Phase 1 lab integration passed lint, typecheck and build without a new
browser/E2E/live run. The Phase 2 design transfer separately passed:

- `npm run lint`, `npm run typecheck`, `npm run build`.
- `node --experimental-strip-types --test tests/unit/*.test.mjs`: **16/16**
  evidence/queue checks passed using Node.js 24.
- Four visual captures of real history/new-draft pages at two widths.
- Synthetic result summary/review at 1440 and 390 px, plus word differences:
  no horizontal overflow, page errors or unhandled requests were found.

Current visual artifacts are local: `/tmp/delphi-design-phase2` for real pages and
`/tmp/delphi-analysis-design` for synthetic result views. Synthetic data was used
only by the verification harness, not added as a product demo mode. This was a
focused UI check, not a full analysis pipeline E2E or live AI-quality test.

Final analysis-page polish also passed lint, typecheck and build, followed by
**10/10** focused Playwright checks:

```sh
npm run test:report -- tests/e2e/results.spec.ts tests/e2e/mobile.spec.ts
```

The regenerated [browser report](docs/report/latest.md) covers structure/source
navigation, finding filters and links, review persistence, HTML/CSV exports,
explicit translation, stopped runs, and mobile navigation. Result data and
translations are synthetic fixtures with real frontend authentication. The
mobile history check covers the shell and does not establish backend availability
or saved-history correctness. This run does not validate live AI quality or the
complete upload-to-analysis pipeline.

## Browser tests and page report

With the backend running and both databases seeded:

```sh
npx playwright install chromium
npm run test:report
```

Playwright runs real authentication/document workflows and clearly labelled
synthetic result scenarios, including mobile checks. It generates
[the latest Markdown report](docs/report/latest.md), with page names,
descriptions and links to screenshots in `docs/report/screenshots/<run-id>/`.
The command fails when a browser assertion fails. Instructions and scope:
[report README](docs/report/README.md).

Live AI analysis/translation quality still requires a separately requested check. Set
`OPENAI_API_KEY` and `OPENAI_MODEL` on the backend for AI operations; without
them, preparation works and the UI shows an explicit configuration notice.
The existing browser-report workflow above remains available for future validation.
