# Latest Delphi UI report

Generated: 2026-09-23T11:33:11.187Z  
Run: 2026-09-23T11-32-49-881Z-59eaa4f8  
Result: **passed** · Duration: 21.3 seconds

Browser checks cover the local application. Each capture identifies its data source: live local backend data or explicitly mocked synthetic results. Synthetic results test UI interactions; they do not validate live AI analysis or translation quality. Authentication uses the local application. This report contains screenshots only, not session cookies, authentication state or traces.

## Test results

| Total | Passed | Failed | Flaky | Skipped | Not run |
|---|---|---|---|---|---|
| 10 | 10 | 0 | 0 | 0 | 0 |

## Pages and states

Each row is a captured state from this run. A screenshot can exist even when a later assertion in its test fails; the status records the test attempt that produced it.

| Page | Short description | Route | Viewport | Data source | Test status | Screenshot |
|---|---|---|---|---|---|---|
| Sign in | Protected pages redirect to the email/password sign-in screen. | /sign-in | 1440 × 1000 | Live local Better Auth and PostgreSQL | passed | [Open screenshot](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/001-sign-in-desktop-chromium.png) |
| Create account | Registration shows field errors without losing entered values. Passwords are masked in screenshots. | /sign-up | 1440 × 1000 | Real frontend form validation; no account created | passed | [Open screenshot](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/002-sign-up-desktop-chromium.png) |
| Analysis · Structure | Before/after unit mappings link each structural change to its original source clauses. | /analyses/10000000-0000-4000-8000-000000000001?tab=structure | 1440 × 1000 | Synthetic API fixture; real frontend and authentication; no live AI | passed | [Open screenshot](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/003-results-structure-desktop-chromium.png) |
| Analysis · Original source and parent context | The source panel keeps original Russian quotations, parent clauses and neighbouring-block navigation. | /analyses/10000000-0000-4000-8000-000000000001?tab=structure | 1440 × 1000 | Synthetic API fixture; real frontend and authentication; no live AI | passed | [Open screenshot](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/004-results-source-context-desktop-chromium.png) |
| Analysis · Functions and risks | Searchable findings use shareable URL filters for change type, issues, review status and units. | /analyses/10000000-0000-4000-8000-000000000001?change=transferred | 1440 × 1000 | Synthetic API fixture; real frontend and authentication; no live AI | passed | [Open screenshot](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/005-results-findings-filter-desktop-chromium.png) |
| Analysis · Finding evidence and human review | A deep-linked finding shows original before/after quotations and a separate human-review form. | /analyses/10000000-0000-4000-8000-000000000001?finding=70000000-0000-4000-8000-000000000001 | 1440 × 1000 | Synthetic API fixture; real frontend and authentication; no live AI | passed | [Open screenshot](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/006-results-finding-evidence-desktop-chromium.png) |
| Analysis · Reviewed conclusion and exports | The report reflects the saved human review and stays available in its original language before translation. | /analyses/10000000-0000-4000-8000-000000000001?finding=70000000-0000-4000-8000-000000000001&tab=conclusion | 1440 × 1000 | Synthetic API fixture; real frontend and authentication; no live AI | passed | [Open screenshot](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/007-results-reviewed-conclusion-desktop-chromium.png) |
| Analysis · Explicit saved-result translation | Translation is requested explicitly; translated reports preserve original source quotations and review revision. | /analyses/10000000-0000-4000-8000-000000000001?tab=conclusion | 1440 × 1000 | Synthetic API fixture; real frontend and authentication; no live AI | passed | [Open screenshot](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/008-results-translated-conclusion-desktop-chromium.png) |
| Analysis · Running | An active run shows its current stage and coverage while polling for completion; unavailable findings are hidden. | /analyses/10000000-0000-4000-8000-000000000001 | 1440 × 1000 | Synthetic API fixture; real frontend and authentication; no live AI | passed | [Open screenshot](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/009-results-running-desktop-chromium.png) |
| Analysis · Failed run and coverage | Failure details and incomplete coverage are visible, with a new-draft retry action instead of invented results. | /analyses/10000000-0000-4000-8000-000000000001 | 1440 × 1000 | Synthetic API fixture; real frontend and authentication; no live AI | passed | [Open screenshot](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/010-results-failed-desktop-chromium.png) |
| Comparison history | Saved comparisons from PostgreSQL with draft status, search, status filtering and navigation. | / | 1440 × 1000 | Live local PostgreSQL and FastAPI; official DOCX seed | passed | [Open screenshot](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/011-comparison-history-desktop-chromium.png) |
| Official DOCX comparison draft | Revision 8 and 9 input files, parsing warnings and required consent for a partial analysis. No AI run is started. | /new?analysis=e8448c34-b056-4db6-b59b-98793a52765c | 1440 × 1000 | Live local PostgreSQL and FastAPI; official DOCX seed | passed | [Open screenshot](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/012-official-draft-desktop-chromium.png) |
| Original source preview | Searchable original Russian wording and clause identifiers remain intact while the interface is in English. | /new?analysis=e8448c34-b056-4db6-b59b-98793a52765c | 1440 × 1000 | Live local PostgreSQL and FastAPI; official DOCX seed | passed | [Open screenshot](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/013-original-source-preview-desktop-chromium.png) |
| New comparison | A named draft starts the Before/After document preparation workflow. | /new | 1440 × 1000 | Live local application; empty form before creating a synthetic test draft | passed | [Open screenshot](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/014-new-comparison-desktop-chromium.png) |
| Prepared Before/After documents | Real Markdown uploads, saved revision labels and parsed source counts; both sides are ready without calling AI. | /new?analysis=0954425e-326a-4036-96d0-c43de03bc02a | 1440 × 1000 | Live local PostgreSQL and FastAPI; explicitly synthetic uploaded Markdown, removed after this test | passed | [Open screenshot](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/015-prepared-synthetic-draft-desktop-chromium.png) |
| Mobile history | Comparison history remains usable on a 390-pixel mobile viewport. | / | 390 × 844 | Live local FastAPI and PostgreSQL | passed | [Open screenshot](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/016-mobile-history-mobile-chromium.png) |
| Mobile navigation | The side sheet exposes history, new comparison and sign-out on small screens. | / | 390 × 844 | Real frontend navigation and authenticated session | passed | [Open screenshot](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/017-mobile-navigation-mobile-chromium.png) |
| New comparison — Kazakh mobile UI | The Kazakh interface persists after reload, including mobile form and navigation labels. | /new | 390 × 844 | Real frontend locale persistence | passed | [Open screenshot](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/018-mobile-new-kk-mobile-chromium.png) |

## Checks

| Test | Project | Result |
|---|---|---|
| desktop-chromium › auth.spec.ts › sign-in validation, real session and sign-out protection | desktop-chromium | passed |
| desktop-chromium › auth.spec.ts › registration page validates fields and preserves entered values | desktop-chromium | passed |
| desktop-chromium › results.spec.ts › structure mappings preserve source context and source navigation | desktop-chromium | passed |
| desktop-chromium › results.spec.ts › findings support URL filters, evidence, review persistence and report exports | desktop-chromium | passed |
| desktop-chromium › results.spec.ts › language changes do not run AI and explicit translations expire after review changes | desktop-chromium | passed |
| desktop-chromium › results.spec.ts › active runs poll and failed runs explain why results are unavailable | desktop-chromium | passed |
| desktop-chromium › results.spec.ts › invalid finding links and empty filters have explicit recoverable states | desktop-chromium | passed |
| desktop-chromium › workspace.spec.ts › official history, parsing consent and exact source preview | desktop-chromium | passed |
| desktop-chromium › workspace.spec.ts › create a draft, upload both sides, revise, move and remove documents | desktop-chromium | passed |
| mobile-chromium › mobile.spec.ts › mobile navigation, notifications and persistent RU/KK/EN selection | mobile-chromium | passed |

## Screenshot previews

### Sign in · 1440 × 1000

Protected pages redirect to the email/password sign-in screen. **Data:** Live local Better Auth and PostgreSQL. **Test:** passed.

![Sign in](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/001-sign-in-desktop-chromium.png)

### Create account · 1440 × 1000

Registration shows field errors without losing entered values. Passwords are masked in screenshots. **Data:** Real frontend form validation; no account created. **Test:** passed.

![Create account](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/002-sign-up-desktop-chromium.png)

### Analysis · Structure · 1440 × 1000

Before/after unit mappings link each structural change to its original source clauses. **Data:** Synthetic API fixture; real frontend and authentication; no live AI. **Test:** passed.

![Analysis · Structure](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/003-results-structure-desktop-chromium.png)

### Analysis · Original source and parent context · 1440 × 1000

The source panel keeps original Russian quotations, parent clauses and neighbouring-block navigation. **Data:** Synthetic API fixture; real frontend and authentication; no live AI. **Test:** passed.

![Analysis · Original source and parent context](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/004-results-source-context-desktop-chromium.png)

### Analysis · Functions and risks · 1440 × 1000

Searchable findings use shareable URL filters for change type, issues, review status and units. **Data:** Synthetic API fixture; real frontend and authentication; no live AI. **Test:** passed.

![Analysis · Functions and risks](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/005-results-findings-filter-desktop-chromium.png)

### Analysis · Finding evidence and human review · 1440 × 1000

A deep-linked finding shows original before/after quotations and a separate human-review form. **Data:** Synthetic API fixture; real frontend and authentication; no live AI. **Test:** passed.

![Analysis · Finding evidence and human review](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/006-results-finding-evidence-desktop-chromium.png)

### Analysis · Reviewed conclusion and exports · 1440 × 1000

The report reflects the saved human review and stays available in its original language before translation. **Data:** Synthetic API fixture; real frontend and authentication; no live AI. **Test:** passed.

![Analysis · Reviewed conclusion and exports](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/007-results-reviewed-conclusion-desktop-chromium.png)

### Analysis · Explicit saved-result translation · 1440 × 1000

Translation is requested explicitly; translated reports preserve original source quotations and review revision. **Data:** Synthetic API fixture; real frontend and authentication; no live AI. **Test:** passed.

![Analysis · Explicit saved-result translation](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/008-results-translated-conclusion-desktop-chromium.png)

### Analysis · Running · 1440 × 1000

An active run shows its current stage and coverage while polling for completion; unavailable findings are hidden. **Data:** Synthetic API fixture; real frontend and authentication; no live AI. **Test:** passed.

![Analysis · Running](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/009-results-running-desktop-chromium.png)

### Analysis · Failed run and coverage · 1440 × 1000

Failure details and incomplete coverage are visible, with a new-draft retry action instead of invented results. **Data:** Synthetic API fixture; real frontend and authentication; no live AI. **Test:** passed.

![Analysis · Failed run and coverage](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/010-results-failed-desktop-chromium.png)

### Comparison history · 1440 × 1000

Saved comparisons from PostgreSQL with draft status, search, status filtering and navigation. **Data:** Live local PostgreSQL and FastAPI; official DOCX seed. **Test:** passed.

![Comparison history](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/011-comparison-history-desktop-chromium.png)

### Official DOCX comparison draft · 1440 × 1000

Revision 8 and 9 input files, parsing warnings and required consent for a partial analysis. No AI run is started. **Data:** Live local PostgreSQL and FastAPI; official DOCX seed. **Test:** passed.

![Official DOCX comparison draft](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/012-official-draft-desktop-chromium.png)

### Original source preview · 1440 × 1000

Searchable original Russian wording and clause identifiers remain intact while the interface is in English. **Data:** Live local PostgreSQL and FastAPI; official DOCX seed. **Test:** passed.

![Original source preview](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/013-original-source-preview-desktop-chromium.png)

### New comparison · 1440 × 1000

A named draft starts the Before/After document preparation workflow. **Data:** Live local application; empty form before creating a synthetic test draft. **Test:** passed.

![New comparison](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/014-new-comparison-desktop-chromium.png)

### Prepared Before/After documents · 1440 × 1000

Real Markdown uploads, saved revision labels and parsed source counts; both sides are ready without calling AI. **Data:** Live local PostgreSQL and FastAPI; explicitly synthetic uploaded Markdown, removed after this test. **Test:** passed.

![Prepared Before/After documents](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/015-prepared-synthetic-draft-desktop-chromium.png)

### Mobile history · 390 × 844

Comparison history remains usable on a 390-pixel mobile viewport. **Data:** Live local FastAPI and PostgreSQL. **Test:** passed.

![Mobile history](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/016-mobile-history-mobile-chromium.png)

### Mobile navigation · 390 × 844

The side sheet exposes history, new comparison and sign-out on small screens. **Data:** Real frontend navigation and authenticated session. **Test:** passed.

![Mobile navigation](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/017-mobile-navigation-mobile-chromium.png)

### New comparison — Kazakh mobile UI · 390 × 844

The Kazakh interface persists after reload, including mobile form and navigation labels. **Data:** Real frontend locale persistence. **Test:** passed.

![New comparison — Kazakh mobile UI](screenshots/2026-09-23T11-32-49-881Z-59eaa4f8/018-mobile-new-kk-mobile-chromium.png)

