# Delphi — demo-frontend

React 18 + TypeScript + Vite + Tailwind CSS 4 + shadcn/ui. UI на русском. Дизайн-система и UX-правила: [`docs/design/DESIGN.md`](../docs/design/DESIGN.md). Продуктовые требования: [`docs/product.md`](../docs/product.md).

## Запуск

```bash
cd demo-frontend
npm install
npm run dev        # http://localhost:5173, /api/* проксируется на http://localhost:8000
npm run build      # tsc --noEmit && vite build → dist/
```

Переменные (`.env.example`):

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `VITE_API_URL` | пусто | База API. Пусто = тот же origin (dev-прокси или FastAPI static в проде) |
| `API_PROXY_TARGET` | `http://localhost:8000` | Куда `vite dev` проксирует `/api` |

В проде бэкенд отдаёт `demo-frontend/dist` как статику с того же origin; SPA-маршруты должны падать на `index.html`.

## Маршруты (по `docs/product.md` §3)

| Адрес | Страница |
|---|---|
| `/` | История анализов (`GET /api/analyses`; при недоступном бэкенде — пустое состояние) |
| `/new` | Новое сравнение: две зоны «До/После», «Анализировать», «Загрузить пример» |
| `/runs/:runId` | Прогресс анализа: степпер 5 стадий, опрос раз в 2 с |
| `/analyses/:id` | Результаты: вкладки «Структура», «Функции и риски», «Заключение»; панель источников; трасса агента |
| `/analyses/demo` | Офлайн-пример из `public/demo/*.json` |

## Офлайн-демо

Кнопка «Загрузить пример: редакции 8 и 9» открывает `/analyses/demo` и читает `public/demo/result.json` + `public/demo/clauses.json` без бэкенда. В шапке — бейдж «Пример: показан сохранённый результат». Тексты пунктов взяты дословно из `docs/hackaton/tracks/Положение_о_внутреннем_аудите_редакция_{8,9}_обезличено.docx.md`.

## Контракт API

> **Статус на 15:50:** бэкенд в `backend/` реализовал гранулярный API (`backend/openapi.json`), а не композитный ниже. Адаптация фронта — задача №1, пошаговый план и маппинг enum-ов: `docs/handoff.md` §3. Таблица ниже описывает то, что фронт ждёт **сейчас**; после адаптации её заменить на реальные вызовы.

`docs/architecture.md` §4 описывает гранулярный API (documents → runs → findings → evidence → sources). Фронт пока использует **композитную обёртку**. Типы — `src/types.ts`, вызовы — `src/lib/api.ts`. При расхождении правится фронт.

| Метод | Путь | Тело / ответ |
|---|---|---|
| `GET` | `/api/analyses` | `AnalysisSummary[] { id, title?, created_at?, state, documents_before?, documents_after?, open_questions? }` |
| `POST` | `/api/analyses` | multipart `title?`, `before` (файлы), `after` (файлы) → `{ analysis_id, run_id }`. Эквивалент трёх вызовов architecture.md: создать черновик, загрузить документы с side, запустить run |
| `GET` | `/api/runs/:run_id` | `JobStatus { id, analysis_id?, stage 1–5, stage_state running\|done\|failed, counters, result_id?, error? }`. `result_id` = analysis id, появляется когда run завершён |
| `POST` | `/api/runs/:run_id/retry` | → `JobStatus` |
| `POST` | `/api/runs/:run_id/cancel` | → 204 |
| `GET` | `/api/analyses/:id` | `AnalysisResult` — см. `types.ts`; образец `public/demo/result.json`. Это агрегат Run + Units + Findings + Conclusion + trace |
| `GET` | `/api/analyses/:id/sources/:document_id/:clause_id` | `Clause { document_id, edition, clause_id, clause_number, text, parent? }` — текст дословно из SourceBlock |

Ошибки: `{ "error": { "code", "message_ru" } }` или FastAPI `{ "detail" }` — оба отображаются.

### Соответствие моделям `architecture.md`

| architecture.md | `types.ts` |
|---|---|
| Unit {kind, name_original, parent_unit_id, source_ids} | `Unit {unit_id, name, status, parent?, before?, after?}` |
| Finding.change_type | `FunctionMapping.status`: `kept \| reworded \| transferred \| split \| merged \| missing \| new` |
| Finding.issue_type | `Risk.kind`: `duplicate \| conflict \| reference \| modality \| scope \| unclear` |
| Finding.explanation / recommendation | `FunctionMapping.note` / `.recommendation`, `Risk.why` / `.check` |
| FindingEvidence {source_id, role, offsets} | `ClauseRef {document_id, clause_id, highlight?}` в `before` / `after` |
| Review {status, note} | `Review` (опционально на `FunctionMapping` и `Risk`; элементы управления ещё не реализованы) |
| SourceBlock.original_text | `Clause.text` |

Стадии прогресса: 1 Извлечение пунктов · 2 Подразделения и обязанности · 3 Сопоставление функций · 4 Проверка пробелов и пересечений · 5 Заключение. Ключи `counters`: `clauses`, `units`, `functions`, `matched`, `risks`, `references` получают русские подписи.

## Структура

```
src/
  types.ts            контракт данных
  lib/api.ts          fetch-обёртки, демо-режим
  lib/status.ts       словарь статусов: метки, иконки, цвета
  lib/format.ts       цитаты «ред. 9, п. 5.3.3», проценты, мс
  lib/export.ts       HTML-отчёт, CSV
  hooks/              useAnalysis, useJob (опрос 2 с, таймаут 8 мин), useClause
  components/         StatusChip, UploadZone, AnalysisProgress, UnitTable, FunctionMapTable,
                      RiskCard, EvidenceDrawer, ClauseFragment, ConclusionReport, ExportMenu,
                      TracePanel, EmptyState, RefButton, EditionBadge, ModeBadge
  components/ui/      shadcn/ui (button.tsx обёрнут в forwardRef — не перегенерировать)
  pages/              HistoryPage (/), UploadPage (/new), ProgressPage (/runs/:id), AnalysisPage (/analyses/:id)
public/demo/          result.json, clauses.json — офлайн-пример
```

## Не реализовано (из `docs/product.md`)

| Возможность | Оценка | Комментарий |
|---|---|---|
| Проверка человеком: «Подтвердить / Вопрос / Отклонить» + заметка | 25–30 мин | Типы `Review` уже есть; нужен `PATCH /api/analyses/:id/findings/:finding_id/review` |
| RU / ҚАЗ / EN интерфейс (i18next) | 40 мин + вычитка KK | Сейчас только RU. Казахский требует проверки носителем — иначе заявлять нельзя |
| Ссылка на вывод `?finding=<id>` | 15 мин | Открыть вкладку и строку по параметру |
| Соседние пункты в панели источников | 15 мин | Поле `parent` уже показывается |
| Язык результата при запуске | 10 мин | Поле в форме `/new` |
