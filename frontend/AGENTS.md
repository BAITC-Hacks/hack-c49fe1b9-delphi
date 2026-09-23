# Delphi frontend

- Read [README](README.md), [coding conventions](../docs/guides/frontend-coding-conventions.md), and the relevant product/API docs before changing a feature.
- Use the prepared Next.js, Better Auth, TanStack Query and HeyAPI architecture. Keep route files thin and business UI in feature folders.
- Generate `components/ui` with `npx shadcn@latest add <component>`. Keep Delphi-specific styling and labels outside generated primitives.
- Generate the API client from `../backend/openapi.json`; do not edit generated files or duplicate transport types.
- Keep secrets in ignored `.env`; Better Auth uses its own PostgreSQL database. The current backend workspace is shared.
- Preserve original quotes and review notes. UI locale changes must not restart analysis or automatically request an AI translation.
- Playwright tests live in `tests/e2e`; `npm run test:report` regenerates `docs/report/latest.md` and page screenshots. Label real backend data versus synthetic result fixtures accurately; keep auth state and traces out of the report.
- Run `npm run test:reporter` when changing report generation. Keep tests deterministic and clean up only their own synthetic drafts. Live AI-quality work is separate from these browser checks; demo design remains Phase 3.
- Check typecheck, lint and build for changes. Read the installed Next.js guides under `node_modules/next/dist/docs` for version-specific behavior.
