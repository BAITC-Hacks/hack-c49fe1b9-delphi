# Delphi — demo-frontend

React 18 + TypeScript + Vite + Tailwind CSS 4 + shadcn/ui. UI на русском. Дизайн-система и UX-правила: [`docs/design/DESIGN.md`](docs/design/DESIGN.md). Продуктовые требования: [`docs/product.md`](../docs/product.md).

Решения и журнал фронта — [`docs/decisions.md`](docs/decisions.md); дизайн и сценарии — [`docs/design/`](docs/design/); правила для Codex и других агентов — [`AGENTS.md`](AGENTS.md). Решения фронта пишутся здесь, а не в корневой `docs/`.

## Демо-версия (по умолчанию)

Решение команды: `demo-frontend` — самостоятельное демо на сохранённых результатах, без бэкенда и модели. Живой продукт — `frontend/` (Next.js).

| Шаг | Что показать |
|---|---|
| `/` История | Кейсы: реальные обезличенные редакции 8 → 9 и синтетические контрольные примеры (помечены «Синтетика») |
| `/new` → «Показать анализ» | Пять стадий анализа воспроизводятся за несколько секунд с пометкой «Модель не вызывается» |
| `/analyses/:id` | Сводные плитки (не найдено · передано · вопросы · ждут решения) — клик открывает очередь с фильтром |
| `/analyses/:id/review` | Очередь проверки: вопросы слева, изменение и дословные цитаты справа, решение внизу (1/2/3, J/K). Решения хранятся в браузере и попадают в заключение и экспорт; «Сбросить решения примера» — для повторного показа |

Живой API включается переменной `VITE_LIVE_API=1` (см. «Контракт API» ниже).

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

Фронт ходит в гранулярный API бэкенда — истина в [`backend/openapi.json`](../backend/openapi.json). Вызовы — `src/lib/api.ts`, сырые типы — нижняя часть `src/types.ts`, преобразование в модель экранов (`AnalysisResult`, `JobStatus`, `Clause`) — `src/lib/adapter.ts` по таблицам [`docs/handoff.md`](../docs/handoff.md) §3.2–3.3. Офлайн-демо (`/analyses/demo`) в API не ходит.

| Экран | Вызовы |
|---|---|
| `/` История | `GET /api/analyses`, `GET /api/health` (бейдж «ИИ не настроен» / «Сервер недоступен») |
| `/new` Загрузка | `POST /api/analyses {title}` → `POST /api/analyses/{id}/documents` (form-data `side`, `file`) по одному файлу → при `parse_status = partial` чекбокс «Запустить ограниченный анализ» → `POST /api/analyses/{id}/runs {output_language: "ru", allow_partial}`. Удалённые из зоны файлы — `DELETE …/documents/{doc}` (пока черновик) |
| `/runs/:runId` Прогресс | `GET /api/runs/{id}` раз в 2 с до `completed / partial / failed / interrupted`. «Повторить анализ» = `POST /api/analyses/{id}/repeat` + новый запуск. Отмены в API нет — кнопка «К истории» |
| `/analyses/:id` Результат | `GET /api/analyses/{id}` → `GET /api/runs/{run}` + `…/findings` + `…/functions` + `GET /api/analyses/{id}/documents/{doc}/sources` на каждый документ + `GET /api/findings/{f}/evidence` на каждую находку (≤ 6 параллельно) |
| Панель источников | Текст пункта из загруженных `sources` (дословно `original_text`), подсветка — `excerpt` из evidence; `clause_id` = `source_id` |
| Проверка человеком | `PUT /api/findings/{id}/review {status, note}`; результат пересобирается из сохранённого пакета без перезагрузки |
| Экспорт | Клиентский HTML / печать / CSV из того же результата; в live-режиме ещё `GET /api/runs/{id}/report?lang=ru&format=html` и `…/functions.csv` |

Ошибки: `{code, message, details}` — известные `code` показываются по-русски (`ERROR_RU` в `api.ts`), остальные — `message` сервера. Ошибки выполнения run (`errors[]`) переводятся в `runError()` адаптера.

Что адаптер не выдумывает: уверенности сопоставления у бэкенда нет — колонка показывает «—»; трассы инструментов API не отдаёт — панель «Как агент решал» в live-режиме скрыта, вместо неё у каждой «не найденной» функции строка покрытия поиска («Поиск по N пунктам комплекта «После», полный: да/нет»). Роли (`kind = role`) в таблицу «Структура» не попадают.

## Структура

```
src/
  types.ts            контракт данных
  lib/api.ts          вызовы backend/openapi.json, демо-режим, коды ошибок → русский текст
  lib/adapter.ts      RunDetail / findings / functions / evidence → AnalysisResult, JobStatus, Clause
  lib/status.ts       словарь статусов: метки, иконки, цвета
  lib/format.ts       цитаты «ред. 9, п. 5.3.3», проценты, мс
  lib/export.ts       HTML-отчёт, CSV
  hooks/              useAnalysis, useJob (опрос 2 с, таймаут 11 мин), useClause
  components/         StatusChip, UploadZone, AnalysisProgress, UnitTable, FunctionMapTable,
                      RiskCard, EvidenceDrawer, ClauseFragment, ConclusionReport, ExportMenu,
                      TracePanel, EmptyState, RefButton, EditionBadge, ModeBadge, ReviewControls
  components/ui/      shadcn/ui (button.tsx обёрнут в forwardRef — не перегенерировать)
  pages/              HistoryPage (/), UploadPage (/new), ProgressPage (/runs/:id), AnalysisPage (/analyses/:id)
public/demo/          result.json, clauses.json — офлайн-пример
```

## Не реализовано (из `docs/product.md`)

| Возможность | Оценка | Комментарий |
|---|---|---|
| RU / ҚАЗ / EN интерфейс (i18next) | 40 мин + вычитка KK | Сейчас только RU. Казахский требует проверки носителем — иначе заявлять нельзя |
| Очередь проверки с фильтром в URL | отдельная ветка `nurdaulet-review-queue` | Прямая ссылка `?finding=<id>` уже открывает источники на текущем экране |
| Соседние пункты в панели источников | 15 мин | Поле `parent` уже показывается |
| Язык результата при запуске | 10 мин | Поле в форме `/new` |


## Контракт доказательств для очереди (23 сентября 2026)

База интеграции: `nurdaulet-api-integration` (PR #2). Сырые `Api*` и backend API не изменены. Компоненты используют UI-модель из `src/types.ts`; `public/demo/result.json` переведён в тот же формат.

| Поле | Контракт |
|---|---|
| `functions[].before`, `after` | Всегда массивы `FunctionSide[]`, включая пустой массив |
| `FunctionSide` | `{ function_id?, owners: string[], unit: string, refs: ClauseRef[], summary: string }`; `unit` — готовая подпись всех исполнителей, `refs` — все источники |
| `risks[].sides` | Все участники `RiskSide[]`; прежних `a/b` нет. Те же `owners`, `unit`, `refs`, необязательные `summary` и `function_id` |
| `functions[].search` | Для потенциально отсутствующей функции: `{ complete, reviewed, candidates, errors: string[], text }`. Логику строить по `complete`, а не разбирать `text`. При отсутствии сохранённого покрытия `complete: false` |
| `functions[].evidence`, `risks[].evidence` | `{ before: ClauseRef[], after: ClauseRef[], context: ClauseRef[], error?: string }`. Ошибка загрузки не означает отсутствие соответствия. Ссылки из сторон функции и evidence дополняют друг друга |
| `ClauseRef` | Прежние идентификаторы, `highlight`, `side` плюс `start_offset/end_offset`. Offsets считают Unicode code points, конец исключительный. `ClauseFragment` сам переводит их в UTF-16; не пересчитывать в очереди |
| `result.coverage` | `{ complete: boolean, processed: number, total: number }`; разрешено утверждать полноту только при `complete === true`. В демо флаг может отсутствовать |
| `units[].before`, `after` | Массивы `ClauseRef[]`; источники структуры тоже не обрезаются |
| `result.structureFindings` | Дополнительные findings изменения структуры с `finding_id`, источниками и review; не путать с обзорными строками `units[]` |
| `saveReview(...)` | После успешного сохранения возвращает `AnalysisResult`; при ошибке выбрасывает исключение |

`id/title/status/note/recommendation/review`, `result.live`, `editions`, `mode`, `partial.failed_stage` и интерфейс `ClauseFragment({ ref_, analysisId })` сохранены. Цитаты всегда исходные, не переводятся и не подменяются пояснением модели.

`src/lib/evidence.ts`: `functionEvidence`, `riskEvidence` объединяют полный набор ссылок; `reviewQueue` собирает уникальные findings по ID для существующей панели и экспорта. Порядок и фильтры новой очереди остаются в `hooks/useReviewQueue.ts`. `uniqueRefs` различает одинаковые цитаты с разными offsets. Не копировать только `sides[].refs[0]`.

У пересечения функций оба набора могут принадлежать «После»: не рисовать пустое «До» как отсутствие соответствия. Контекст показывать отдельным блоком. При `evidence.error` — предупреждение и повтор загрузки, а не молчаливый fallback. При неверных offsets показать весь пункт и предупреждение; строковый поиск допускается только без offsets и при единственном совпадении.

Проверки: `npm test` (Node test runner + уже установленный TypeScript), `npm run build`. Живой AI-анализ этими проверками не запускается.
