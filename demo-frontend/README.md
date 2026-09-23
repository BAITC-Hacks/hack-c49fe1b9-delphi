# Delphi — demo-frontend

React 18 + TypeScript + Vite + Tailwind CSS 4 + shadcn/ui. UI на русском. Дизайн-система и UX-правила: [`docs/design/DESIGN.md`](docs/design/DESIGN.md). Продуктовые требования: [`docs/product.md`](../docs/product.md).

Решения и журнал фронта — [`docs/decisions.md`](docs/decisions.md); дизайн и сценарии — [`docs/design/`](docs/design/). Решения фронта пишутся здесь, а не в корневой `docs/`.

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
| Ссылка на вывод `?finding=<id>` | 15 мин | Открыть вкладку и строку по параметру |
| Соседние пункты в панели источников | 15 мин | Поле `parent` уже показывается |
| Язык результата при запуске | 10 мин | Поле в форме `/new` |
