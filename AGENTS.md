# Working on Delphi

The backend and Phase 1 frontend are connected. PostgreSQL migrations, repeatable demo seeds, authentication and basic HTTP flows are verified. Phase 2 adds Playwright tests and a generated page report; live AI validation remains separate. The demo design is Phase 3.

## Read the relevant docs

- Start with [docs/README.md](docs/README.md) for status and document ownership.
- UI, features and RU/KK/EN: [docs/product.md](docs/product.md).
- Backend, parsing, agent, schemas and API: [docs/architecture.md](docs/architecture.md).
- Backend configuration, commands and verification status: [backend/README.md](backend/README.md).
- Frontend setup and feature boundaries: [frontend/README.md](frontend/README.md), [frontend rules](frontend/AGENTS.md), [coding conventions](docs/guides/frontend-coding-conventions.md).
- Tasks, team ownership, acceptance and demo: [docs/implementation-plan.md](docs/implementation-plan.md).
- Ground truth, source clauses and parser traps: [docs/source-analysis.md](docs/source-analysis.md).
- Required scope: [organizer instructions](docs/hackaton/hackaton_instructiona.md) and [selected case](<docs/hackaton/tracks/HackAlem_AI_ИИ_агент_«Анализ_организационной_структуры_и_функционала».md>).

## Implementation rules

- Preserve docs/hackaton and original files in docs/sources. Put synthetic fixtures elsewhere and label them.
- Follow the selected MVP: Next.js/TypeScript, Better Auth, TanStack Query and generated HeyAPI; FastAPI, PostgreSQL, async SQLAlchemy, Alembic, one application worker and one bounded agent. Do not add a SQLite fallback.
- Keep routers thin and responses typed. Services own business rules and transactions; models, parsers and the agent do not import HTTP handlers. Keep OpenAPI operation IDs stable for HeyAPI generation.
- Phase 0/1 includes seeding, frontend integration and basic HTTP checks. Phase 2 browser checks use `frontend/tests/e2e` and generate `frontend/docs/report/latest.md`. Synthetic result fixtures must be labelled and do not establish live AI quality. Leave demo-frontend design to Phase 3.
- Generate frontend UI primitives with `npx shadcn@latest`; keep product-specific components outside `components/ui`.
- Keep source IDs and original quotations intact. Unknown IDs are errors; uncertain interpretations with valid evidence need review.
- Search the available After set before reporting an unmatched duty. Track parsing/search gaps and retain role/scope context.
- Support many-to-many function mappings. Duplicates and potential conflicts are required.
- Translate UI and saved explanations; do not replace source quotations or rerun analysis on a language switch.
- Human review is separate from AI findings. UI and export use the same saved result.
- The backend workspace is shared. Better Auth uses a dedicated frontend database and gates the Next.js pages/proxy. Backend User seeds remain scaffolding; do not claim per-user backend authorization or roles.
- Update the owning document when contracts change; avoid duplicate plans. Do not claim planned features or unrun checks are implemented.
- Use meaningful acceptance checks from the plan. Add actual run/test commands to README when code exists.
