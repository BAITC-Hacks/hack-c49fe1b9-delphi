# Frontend coding conventions

These rules apply only to [`frontend/`](../../frontend). They keep the Next.js
application connected to the generated FastAPI client without duplicating backend
models or mixing browser and server code.

## Boundaries

- `src/app` is routing only: `page`, `layout`, route handlers, loading and
  error boundaries. A page may read route parameters and render a feature, but
  does not own request state or business UI.
- A feature owns one domain end-to-end under
  `src/features/<name>/{model,client,api}`. Create a feature only when it has
  real UI or mapping code; do not create empty future feature folders.
- `model` is safe for server and browser imports: Zod schemas, view-model
  types, constants and display mappings. It is not a hand-written copy of
  FastAPI OpenAPI DTOs.
- `client` contains `"use client"` components, browser state and hooks.
- `api` owns calls to the generated SDK and turns transport responses into
  feature view models. Browser components never call `fetch` directly.
- Server-only authentication, database access and backend proxy code live in
  `src/server` and route handlers. Import `server-only` in every server module.
  A client module must never import a server module, Node API or secret.

## UI

- Generate `components/ui` primitives with `npx shadcn@latest add <component>`.
  Do not handwrite replacement primitives. If generation is unavailable, use
  matching official components from `../next-better-auth-template`. Keep Delphi
  wording, business rules and custom styling in wrappers outside this folder.
- Reusable Delphi components belong in `components/custom-ui` and are imported
  from there. Feature-specific components remain inside their feature.
- `components/data-table` is the shared TanStack table foundation. A simple,
  short read-only list may use `components/ui/table`; searchable, sortable or
  paginated views use `DataTable`.
- Dialogs shared by unrelated features are NiceModal components named
  `*NiceDialog` and opened through their promise-based helper. A dialog owned
  by one feature is regular local component state.
- Use existing semantic tokens and shadcn variants. Do not introduce arbitrary
  colours for status: every colour must have a text label.
- Keyboard focus, Escape to close dialogs, long RU/KK labels and narrow
  screens are required considerations for every interactive component.

## API and auth

- `src/shared/api/generated` is owned by HeyAPI. Never edit it manually.
  Regenerate it from `../backend/openapi.json` with `npm run api:generate` only
  after the backend contract is accepted.
- The generated client uses the same-origin `/backend` route. It never exposes
  `BACKEND_INTERNAL_URL` to the browser.
- Better Auth owns its dedicated PostgreSQL database. It must not share or map
  to the backend's development `users` table.
- A protected Next.js layout and proxy gate the current frontend, but FastAPI
  has no identity or resource-ownership contract yet. Do not claim that this
  frontend-only login implements backend authorization.

## Forms, state and language

- Use React Hook Form with a Zod schema from the feature's `model` folder.
  Disable submissions while pending; preserve typed values and show field or
  root errors near the action.
- Prefer URL state for a linkable analysis, finding, table filter or sort. Use
  local state only for ephemeral component interaction.
- TanStack Query owns server state. Invalidate findings, run, report and
  translation queries after reviews so exports follow the saved revision.
- Use `shared/notifications` for actionable success/error notifications. Its
  bell records real events in memory and clears on sign-out; it is not an audit log.
- UI strings are prepared for RU, KK and EN. The UI language is independent of
  an analysis output language. Never replace original source quotations with a
  translated UI string.

## Naming and checks

- Use kebab-case filenames named after their main export. `*-form` is a form,
  `*-table-view` is a DataTable view, and `*-nice-dialog` is a NiceModal
  component.
- Run `npm run typecheck` and `npm run lint` before handoff. Run `npm run
  build` with valid frontend environment variables before release.
- Do not start the backend, call AI, or generate the HeyAPI client merely to
  validate frontend layout work.
