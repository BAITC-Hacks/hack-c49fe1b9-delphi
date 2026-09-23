# Browser checks and screenshot report

Run from `frontend/` with PostgreSQL migrated, the official DOCX seed loaded,
Better Auth migrated/seeded, and FastAPI available at the configured internal
address. See [frontend setup](../../README.md). Playwright starts Next.js when
needed and reuses the local development server outside CI.

```sh
npm ci
npx playwright install chromium
npm run test:report
```

The command runs browser assertions and writes:

- [latest.md](latest.md): test totals, page names, short descriptions, routes,
  screenshot links, data provenance and failures from the latest run.
- `latest.json`: the same run's structured report metadata.
- `screenshots/<run-id>/`: screenshots captured by that run. Previous runs are
  retained; `latest.md` links only to the current run.
- `playwright-report/`: Playwright's detailed HTML report (ignored by Git).
- `test-results/`: temporary attachments and failure traces (ignored by Git).

The script returns a nonzero exit code when tests fail. A failed run replaces
the latest report instead of leaving a previous passing report visible. Filtered
runs list only their selected tests; use the command above for full coverage.

## Coverage and data

Desktop Chromium uses 1440 × 1000; mobile Chromium uses 390 × 844. Tests cover
authentication, protected navigation, registration validation, history,
Before/After uploads, parsing consent, exact source previews, document edits,
notifications, results, reviews, reports and mobile language/navigation behavior.
Captures assert that the page fits its viewport. Uncaught browser errors fail
the test.

Authentication, history and document preparation use real local PostgreSQL,
Better Auth and FastAPI. The upload test creates explicitly labelled synthetic
Markdown documents and removes only its own temporary draft and files.
The official revision 8/9 draft remains unchanged; no analysis is started.

Results tests intercept the result API with typed, synthetic fixtures. They
exercise the real UI, evidence, review state, polling, exports and explicit
translation requests without calling an AI provider. Those screenshots are
labelled accordingly. Passing this suite does **not** establish live AI quality
or backend semantic correctness. Registration checks validation without creating
extra users. Mobile tests emulate Chromium, not an actual device or WebKit.

The default local account is `analyst@delphi.local`; set `PLAYWRIGHT_EMAIL` and
`DELPHI_DEMO_PASSWORD` if your seeded credentials differ. `.env` is loaded by
the Playwright config. `PLAYWRIGHT_BASE_URL` selects the frontend address and
must agree with Better Auth's origin configuration. The upload cleanup requires
the local backend `.env` and refuses nonlocal database hosts.

Passwords are masked in page captures. Failure traces may contain request
details and session cookies: they stay in ignored local directories and must
not be added to the shareable report.

## Other commands

```sh
npm run test:e2e
npm run test:e2e:ui
npm run test:report -- --project=desktop-chromium
npm run test:reporter
npx playwright show-report
```

`test:e2e` also uses the configured Markdown reporter. The report generator and
its file handling have separate Node tests. To add a documented page capture,
use `capturePage` from `tests/support/fixtures.ts` with a page name, description
and accurate data source. Keep browser tests under `tests/e2e` and synthetic
result DTOs under `tests/fixtures`.
