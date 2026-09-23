# Delphi frontend

Next.js App Router + TypeScript, Better Auth, TanStack Query, generated HeyAPI,
React Hook Form/Zod and official shadcn components. Feature modules own their
forms, queries and screens; route files stay small.

## Working MVP

- `/sign-in`, `/sign-up`: email/password authentication and persistent sessions.
- `/`: saved comparisons, search, status filters and repeat as a new draft.
- `/new?analysis=<id>`: draft creation, multiple Before/After uploads, revision
  labels, moving/deleting documents, parsing warnings and exact source previews.
- `/analyses/<id>`: run polling, coverage, structure, findings, evidence, human
  review notes, report preview/print/HTML download and function CSV export.
- RU/KK/EN UI, mobile navigation and a notification bell showing real actions.
  Notifications are in memory for the current tab and clear on sign-out.

UI language and analysis output language are separate. Switching UI language
never reruns an analysis or automatically calls AI. Translation of saved
explanations requires an explicit action; source quotes and review notes stay
unchanged.

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

Live AI analysis/translation quality remains a separate Phase 2 check. Set
`OPENAI_API_KEY` and `OPENAI_MODEL` on the backend for AI operations; without
them, preparation works and the UI shows an explicit configuration notice.
Phase 3 remains the separate demo-frontend design.
