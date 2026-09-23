# Working on Delphi

The repository currently contains specifications and source documents; the application is not implemented yet.

## Read the relevant docs

- Start with [docs/README.md](docs/README.md) for status and document ownership.
- UI, features and RU/KK/EN: [docs/product.md](docs/product.md).
- Backend, parsing, agent, schemas and API: [docs/architecture.md](docs/architecture.md).
- Tasks, team ownership, acceptance and demo: [docs/implementation-plan.md](docs/implementation-plan.md).
- Ground truth, source clauses and parser traps: [docs/source-analysis.md](docs/source-analysis.md).
- Required scope: [organizer instructions](docs/hackaton/hackaton_instructiona.md) and [selected case](<docs/hackaton/tracks/HackAlem_AI_ИИ_агент_«Анализ_организационной_структуры_и_функционала».md>).

## Implementation rules

- Preserve docs/hackaton and original files in docs/sources. Put synthetic fixtures elsewhere and label them.
- Follow the selected MVP: React/TypeScript, FastAPI, SQLite, one application worker and one bounded agent.
- Keep source IDs and original quotations intact. Unknown IDs are errors; uncertain interpretations with valid evidence need review.
- Search the available After set before reporting an unmatched duty. Track parsing/search gaps and retain role/scope context.
- Support many-to-many function mappings. Duplicates and potential conflicts are required.
- Translate UI and saved explanations; do not replace source quotations or rerun analysis on a language switch.
- Human review is separate from AI findings. UI and export use the same saved result.
- Update the owning document when contracts change; avoid duplicate plans. Do not claim planned features or unrun checks are implemented.
- Use meaningful acceptance checks from the plan. Add actual run/test commands to README when code exists.
