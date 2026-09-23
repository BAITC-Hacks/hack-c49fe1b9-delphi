# demo-frontend — rules for coding agents (Codex, Claude)

This file overrides the root `AGENTS.md` for everything under `demo-frontend/`. The frontend exists, is wired to the real backend API, and building and running it is expected.

## Read first, in this order

1. `docs/decisions.md` — what was decided and why (newest at the bottom).
2. `docs/design/DESIGN.md` — tokens, statuses, components, Russian microcopy. Single source for the UI.
3. `README.md` — routes and the frontend ↔ API contract table.
4. `../backend/openapi.json` — the backend truth; `../docs/handoff.md` §3 — enum mapping.

## Ownership

- Edit only `demo-frontend/**`. `backend/**` belongs to Osman: never edit it. If the API lacks something, adapt in `src/lib/adapter.ts` and record the need in `docs/decisions.md`.
- Frontend decisions, journal entries and design notes go to `demo-frontend/docs/`, never to the root `docs/`.

## Architecture — do not break

- `src/types.ts`: the top part is the UI model every screen uses; the bottom part (`Api*`) is the raw backend contract.
- `src/lib/api.ts` is the only place with `fetch` and URLs. `src/lib/adapter.ts` is the only place that maps backend data to the UI model. Components never import `Api*` types.
- `/analyses/demo` must keep working with the backend down (`public/demo/*.json`, mode `cached`).
- Source text shown to users is verbatim from the backend (`original_text`, evidence `excerpt`). Never show model output as a quote, never rewrite it.
- No invented data: the backend has no match confidence (show "—"), no tool trace (panel hidden in live mode), no cancel endpoint.
- `src/components/ui/button.tsx` is wrapped in `React.forwardRef`; do not regenerate it with the shadcn CLI.

## Design principle: value over beauty

Every visual change must make one of these user tasks faster or safer, or it is not made:

1. find a duty with no match in «После»;
2. see where a function moved (transferred, split, merged);
3. open the source clause in one click and compare wording;
4. record a review decision (Подтвердить / Вопрос / Отклонить + note);
5. export the conclusion.

Status is always icon + text + token color, never color alone. Tone is a hypothesis, not a verdict: «Соответствие не найдено в комплекте «После»», never «функция потеряна».

## Figma → code

- The Figma design (Codex Astra) is the reference for layout and hierarchy; `DESIGN.md` is the reference for tokens. When they differ, update tokens first (`src/index.css` + `DESIGN.md` §2), then components.
- Reuse the existing components (`src/components/`, inventory in `DESIGN.md` §5) before adding new ones.
- One screen per task and per commit. Without Figma access, work from PNG exports in `docs/design/reference/`.

## Run

```bash
npm install
npm run dev     # http://localhost:5173, /api → http://localhost:8000 (backend start: ../docs/handoff.md §2)
npm run build   # tsc --noEmit && vite build
```

## Done means

- `npm run build` passes before every commit.
- Checked in the browser at 1280 px and 375 px: the changed screen, its empty and error states, and `/analyses/demo`.
- UI text in Russian with correct plurals (`plural()` in `src/lib/adapter.ts`).
- One line added to `docs/decisions.md`: time, what changed, which user task it serves, commit.
- Commit messages in English. Branch from `main`, PR into `main`.
