# Handoff — состояние проекта Delphi на 15:50, 23.09.2026

Для нового чата (Opus 5.5). Порядок чтения: этот файл целиком → `backend/openapi.json` (истина по API) → `demo-frontend/README.md` → `docs/product.md` → `docs/design/SCENARIOS.md`. Дедлайн 18:00, фриз фич 17:00. Часы репозитория и `date` совпадают; ориентируйся на `date`.

> **Статус на 16:20:** §3 выполнен в ветке `nurdaulet-api-integration` (адаптер `demo-frontend/src/lib/adapter.ts`, проверка человеком). Проверено на реальном бэкенде без ключа ИИ; живой прогон с моделью — первым делом, как только в `backend/.env` будет `OPENAI_API_KEY` + `OPENAI_MODEL`. Осталось Осману: `StaticFiles` для `demo-frontend/dist` (§2).

**Ветка фронта:** `nurdaulet-design-features-update` → PR #1 в `main` (https://github.com/BAITC-Hacks/hack-c49fe1b9-delphi/pull/1). Ветка создана поверх коммитов бэкенда `0dc0689` и `56b6c5b`, конфликтов с `main` нет.

---

## 1. Что есть в репозитории

| Часть | Путь | Состояние | Кто |
|---|---|---|---|
| Бэкенд | `backend/` | FastAPI + PostgreSQL (Alembic) + агент + парсеры DOCX/MD/PDF/XLSX + отчёты RU/KK/EN + тесты + `openapi.json`. **Живой прогон с моделью ещё не проверялся** (их README, «Verification status») | Осман |
| Синтетические контрольные пары | `backend/fixtures/synthetic/{missing,overlap,conflict,transfer,distinct-scope}` | Готовы, с `manifest.json` ожидаемых находок. Это то, что жюри будет проверять | Осман / Рауан |
| Фронт | `demo-frontend/` | Все экраны готовы и проверены на офлайн-демо. **К реальному API не подключён** — контракт расходится, см. §3 | Нурдаулет |
| Документация продукта | `docs/product.md`, `docs/architecture.md`, `docs/implementation-plan.md`, `docs/source-analysis.md` | Актуальна | команда |
| Дизайн и сценарии | `docs/design/DESIGN.md`, `docs/design/SCENARIOS.md`, `docs/design/ASTRA-UI-PROMPTS.md` | Актуальны | Нурдаулет |
| Журнал | `docs/history.md` | По коммитам | Нурдаулет |

Папка называется `demo-frontend/`, а не `frontend/`, чтобы не пересекаться с путями из `architecture.md`. Если команда решит, что это и есть основной фронт — переименовать обратно одним `git mv` и заменить путь в `docs/design/*.md`, `demo-frontend/README.md`.

---

## 2. Как запустить

```bash
# бэкенд (нужны Docker, Python 3.12, uv; backend/.env из .env.example с паролем и OPENAI_API_KEY)
docker compose --env-file backend/.env up -d postgres
cd backend && uv sync --frozen && uv run alembic upgrade head
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
# проверка: curl http://127.0.0.1:8000/api/health  → {"status":"ok","ai_configured":true}

# фронт
cd demo-frontend && npm install && npm run dev      # http://localhost:5173, /api → :8000 через прокси Vite
```

CORS в бэкенде нет → фронт должен ходить same-origin. В dev это прокси Vite (уже настроен). В проде бэкенд **не отдаёт статику** (`StaticFiles` в `main.py` отсутствует) — Осману добавить `app.mount("/", StaticFiles(directory="../demo-frontend/dist", html=True))` после роутеров, либо ставить nginx перед обоими.

---

## 3. Реальный API бэкенда и маппинг на фронт — ГЛАВНАЯ ЗАДАЧА НОВОГО ЧАТА

Фронт написан под композитный контракт (`demo-frontend/README.md`). Бэкенд реализовал гранулярный. Правится **только фронт**: `demo-frontend/src/lib/api.ts`, `hooks/*`, `types.ts`, плюс поток загрузки в `UploadPage.tsx` и сборка результата в `AnalysisPage.tsx`. Оценка: 60–75 минут. Офлайн-демо (`/analyses/demo`) должно продолжать работать без бэкенда.

### 3.1 Поток вызовов

| Шаг | Реальный вызов | Ответ | Что делает фронт |
|---|---|---|---|
| Создать анализ | `POST /api/analyses` json `{title}` | `201 {id, title, created_at}` | `title` = имена файлов или «Сравнение от 23.09 15:50» |
| Загрузить каждый файл | `POST /api/analyses/{id}/documents` form-data `side: before\|after`, `file` | `201 DocumentResponse {id, side, filename, format, parse_status: pending\|parsed\|partial\|failed, warnings[], block_count, revision_label}` | Один запрос на файл, последовательно. Показать `revision_label`, `block_count`, `warnings`. `failed` → бэкенд не даст запустить run |
| Запустить | `POST /api/analyses/{id}/runs` json `{output_language: "ru", allow_partial: false}` | `202 {run_id, state}` | Если у какого-то документа `parse_status = partial` — показать предупреждение и чекбокс «Запустить ограниченный анализ» → `allow_partial: true` (product.md §3.3). Повторный запуск с теми же опциями возвращает тот же run |
| Опрашивать | `GET /api/runs/{run_id}` каждые 2 с | `RunDetail` (см. 3.2) | Пока `state ∈ {queued, running}` |
| Результат | `GET /api/runs/{run_id}` + `GET /api/runs/{run_id}/findings` + `GET /api/runs/{run_id}/functions` | `RunDetail`, `FindingResponse[]`, `FunctionResponse[]` | Собрать `AnalysisResult` (см. 3.3) |
| Источник для панели | `GET /api/findings/{finding_id}/evidence` → `EvidenceResponse[]`; текст пункта — прямо из `original_text`; либо `GET /api/sources/{source_id}` | `EvidenceResponse {source_id, document_id, filename, side, clause_no, original_text, excerpt, evidence_role: before\|after\|context, start_offset, end_offset}` | `ClauseRef.clause_id := source_id`, `clause_number := clause_no`, `highlight := excerpt`, `edition := revision_label документа или filename` |
| Проверка человеком | `PUT /api/findings/{id}/review` json `{status, note}` | `ReviewUpdated {status, note, updated_at, review_revision}` | Enum совпадает с `Review` во фронте 1:1 — сценарии H1–H5 реализуемы за 25 мин |
| Отчёт | `GET /api/runs/{run_id}/report?lang=ru&format=html`, `GET /api/runs/{run_id}/functions.csv?lang=ru` | HTML / CSV | В live-режиме «Экспорт» ведёт на эти ссылки; для демо остаётся клиентская сборка |
| История | `GET /api/analyses` | `AnalysisListItem[] {id, title, created_at, run_id, state}` | Колонок «документов» нет → скрыть; `state` см. 3.2 |
| Здоровье | `GET /api/health` | `{status, ai_configured}` | Бейдж на истории: «ИИ не настроен» если `false` (сценарий A3) |
| Ошибки | любой | `{code, message, details[]}` | В `request()` читать `message` (сейчас читается `error.message_ru` и `detail`) |

Лимиты из `backend/.env.example`: файл ≤ 10 МБ, ≤ 10 документов на анализ, таймаут запуска 600 с. Показать рядом с зонами загрузки (сценарий B7).

### 3.2 Enum-ы бэкенда → фронт

| Бэкенд | Значения | Фронт |
|---|---|---|
| `RunDetail.state` | `queued, running, completed, partial, failed, interrupted` | `JobStatus.stage_state`: queued/running → `running`; completed → `done`; partial → `done` + `mode = "partial"`; failed → `failed`; interrupted → `interrupted` |
| `RunDetail.stage` | `queued, extracting, comparing, checking_risks, validating, completed, partial, failed, interrupted` | Номер стадии степпера: queued/extracting → 1–2 (объединить как «Извлечение пунктов и обязанностей»), comparing → 3, checking_risks → 4, validating → 5, completed/partial → 5 done |
| `RunCoverage` | `total_sources, processed_sources, before_functions, compared_before_functions, after_functions, structure_units, …` | `JobStatus.counters`: `clauses: processed_sources/total_sources`, `functions: before_functions`, `matched: compared_before_functions` |
| `StructureChange.status` | `retained, newly_listed, transformed, unmatched` | `UnitStatus`: kept, new, changed, missing. Имена подразделений — из `RunDetail.units[]` по `before_unit_ids/after_unit_ids` (`name_original`, `kind: department\|role\|group`, `parent_unit_id`) |
| `FindingResponse.change_type` | `retained, reworded, transferred, split, merged, new, potentially_missing, changed, structure_changed` | `FunctionStatus`: kept, reworded, transferred, split, merged, new, **missing**, reworded (для `changed`), а `structure_changed` — не в таблицу функций, а в «Структуру»/заключение |
| `FindingResponse.issue_type` | `overlap, potential_conflict, modality_changed, scope_changed, insufficient_evidence` \| null | `Risk.kind`: duplicate, conflict, modality, scope, unclear. Finding с `issue_type` → карточка риска **и** строка функции (одна сущность, два представления) |
| `FindingResponse.search` | `SearchCoverage {method, complete, reviewed_source_ids[], candidate_source_ids[], errors[]}` | Для `missing`: в панели источников строка «Поиск по N пунктам комплекта „После“, полный: да/нет»; если `complete = false` — статус показывать как «неполная проверка», не как «не найдено» |
| `ReviewResponse.status` | `unreviewed, confirmed, needs_clarification, rejected` | `Review.status` — совпадает |
| `UnitResponse.kind` | `department, role, group` | Роли (`role`) не показывать как подразделения в таблице «Структура» (product.md §3.4) |
| `FunctionResponse` | `actor_original, action, object, scope, condition, modality, owner_unit_ids, source_ids` | `FunctionSide.summary := action + " " + object (+ scope)`, `unit := units[owner_unit_ids[0]].name_original`, `ref := первый source_id` |

### 3.3 Сборка `AnalysisResult` во фронте

```
units       ← RunDetail.structure[] × RunDetail.units[]
functions   ← findings.filter(change_type ≠ structure_changed) × functions[] × units[]
risks       ← findings.filter(issue_type ≠ null)
conclusion  ← либо iframe отчёта GET /api/runs/{id}/report?format=html (быстро, 10 мин),
              либо клиентская сборка: разделы по change_type/issue_type + coverage как «Ограничения»
trace       ← бэкенд не отдаёт трассу инструментов отдельно; показать SearchCoverage.method и
              счётчики coverage как «Как агент решал» либо скрыть панель в live-режиме
editions    ← documents[] по side: revision_label ?? filename, дата — из revision_label если есть
mode        ← state=partial → "partial"; иначе "live"
```

### 3.4 Порядок работы нового чата (60–75 мин)

1. `api.ts`: заменить функции на реальные вызовы из 3.1; `request()` читать `message`. Оставить ветку `DEMO_ID` для офлайн-демо. — 15 мин
2. `types.ts`: добавить тип `LiveBundle {run: RunDetail, findings, functions, documents}` и функцию `toAnalysisResult(bundle)` в новом `lib/adapter.ts` по 3.2–3.3. — 20 мин
3. `useAnalysis(id)`: если не demo — `GET /api/analyses/{id}` → `run.id` → три запроса → адаптер. `useClause`: если не demo — `GET /api/sources/{clause_id}`. — 10 мин
4. `UploadPage`: create → upload по одному с прогрессом на зоне → при `partial` чекбокс → start → `/runs/{run_id}`. — 15 мин
5. `useJob`: маппинг `state/stage/coverage` из 3.2; `result_id := analysis_id` при completed/partial. — 5 мин
6. Прогон на `backend/fixtures/synthetic/transfer` (два файла «После»!) и на редакциях 8/9 из `docs/hackaton/tracks/*.md`. Что не сошлось — править адаптер. — остаток
7. Если остаётся время до 17:00: кнопки «Подтвердить / Вопрос / Отклонить» + заметка через `PUT …/review` (сценарии H). — 25 мин

---

## 4. Что готово во фронте (проверено в браузере, сборка зелёная)

`/` история · `/new` загрузка с дедупликацией и предупреждениями · `/runs/:id` степпер · `/analyses/:id` три вкладки, панель источников с дословными пунктами и подсветкой, карточки рисков, экспорт HTML/печать/CSV, трасса, бейджи режимов · `/analyses/demo` офлайн-пример на реальных пунктах редакций 8 и 9 · мобильная вёрстка. Полный список сценариев и статусов — `docs/design/SCENARIOS.md`.

Не реализовано: проверка человеком (бэкенд готов), RU/ҚАЗ/EN (бэкенд отдаёт `lang`, фронт только RU), ссылка `?finding=`.

---

## 5. План до 18:00

| Время | Кто | Что |
|---|---|---|
| до 16:10 | Осман | Бэкенд поднят локально, `GET /api/health` → `ai_configured: true`; первый живой run на редакциях 8/9 |
| 15:55–17:00 | Нурдаулет + новый чат | Адаптер по §3.4, живой прогон, при остатке времени — проверка человеком |
| 16:30–17:00 | Рауан | Прогон синтетических пар через UI, сверка с `manifest.json`, README корня по промпту организаторов, скриншоты по `DESIGN.md` §10 |
| 17:00 | все | Фриз. Деплой одним контейнером (backend + `demo-frontend/dist`) или демо с ноутбука; видео 2 мин |
| 17:40 | Рауан | Сдача на платформе |

---

## 6. Известные детали

- `demo-frontend/src/components/ui/button.tsx` обёрнут в `React.forwardRef` (React 18 + Radix `asChild`). Не перегенерировать через shadcn CLI без повторной правки.
- Пакет `cn` — официальный `shadcn-ui/cn`. Tailwind v4: токены в `src/index.css`, `tailwind.config` нет намеренно.
- Vite dev-сервер мог остаться на 5173: `pkill -f "vite --port 5173"`.
- `.claude/launch.json` (локальный конфиг превью) не в репозитории.
- Синтетический кейс `transfer` требует **двух** файлов «После» (`after-audit.md`, `after-risk.md`) — фронт это поддерживает (несколько файлов на сторону).
