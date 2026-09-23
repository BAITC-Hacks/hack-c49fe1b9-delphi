# Астра · 6 UI-промптов для Delphi (Нурдаулет, 14:15–17:20)

Порядок жёсткий. Каждый промпт — отдельная задача Codex. Перед каждым: `git pull --rebase`. После каждого: `npm run build` в `demo-frontend/`, проверить в браузере, коммит только своих файлов (`demo-frontend/**`, `demo-frontend/docs/design/**`, `docs/screenshots/**`, `README.md`).

Зона владения: `demo-frontend/**`. API, парсер, агент — Осман. Не трогать `backend/**`. Нужна правка контракта — писать Осману, не менять `types.ts` в одностороннем порядке после 14:40.

Если Осман выбрал Next.js вместо Vite — заменить в промптах «Vite» на «Next.js App Router», пути `demo-frontend/src/` на `app/` + `components/`; компоненты и токены не меняются.

---

## Вставить в `AGENTS.md` (раздел UI) до первого промпта

```
## UI (demo-frontend/)
- Read demo-frontend/docs/design/DESIGN.md before any UI task. It is the single source of truth for tokens, components, states, statuses and Russian microcopy.
- Stack: React 18 + TypeScript + Vite + Tailwind + shadcn/ui + lucide-react + sonner. No Framer Motion, no other UI kits.
- All UI text in Russian, taken from DESIGN.md §9 where it exists. Tone: hypotheses, not verdicts. Never "функция потеряна"; always "Соответствие не найдено в комплекте «После»".
- Status colors come only from tokens (status.*); every StatusChip has icon + text. Color is never the only signal.
- Evidence text is always fetched by clause_id from the API (or demo JSON), never taken from model output.
- The "Загрузить пример" button must work with the backend down: it loads demo-frontend/public/demo/result.json and sets mode = "cached".
- Components render; data logic lives in hooks/. Files > 200 lines with two responsibilities get split.
- Motion: only the three rules in DESIGN.md §7; respect prefers-reduced-motion.
- Do not edit backend/** or shared API schema without asking. types.ts mirrors the backend schema agreed at 14:40.
- Before finishing: `npm run build` passes, no TypeScript errors, page works at 375px width.
```

---

## UI-1 · 14:15–14:45 · каркас, токены, кит, экран загрузки

> Прочитай `demo-frontend/docs/design/DESIGN.md` полностью. Создай `demo-frontend/` — Vite + React 18 + TypeScript + Tailwind + shadcn/ui (инициализируй shadcn, добавь компоненты: button card tabs table badge sheet progress alert dialog tooltip skeleton separator scroll-area collapsible input select dropdown-menu sonner). Подключи шрифты `@fontsource-variable/inter` и `@fontsource-variable/jetbrains-mono`. Создай `src/styles/tokens.css` ровно с переменными из DESIGN.md §2 и расширь `tailwind.config` цветами `status.*` и `evidence.highlight`. Создай `src/types.ts` из DESIGN.md §6. Реализуй `AppShell`, `EditionBadge`, `ModeBadge`, `StatusChip` (словарь §3 с иконками lucide), `EmptyState`, `UploadZone` и страницу `/` по §4.1–4.2: две зоны, список файлов, кнопка «Анализировать» (disabled пока обе зоны пусты), кнопка «Загрузить пример: редакции 8 и 9». Пример пока грузит `public/demo/result.json` — создай правдоподобный мок по типам из `types.ts` с 4 подразделениями (ДНМ, ДККМ сохранены; ДИТААД, ДОА добавлены), 8 функциями разных статусов, включая передачу «ред. 8 п. 5.4.4 → ред. 9 п. 5.3.3», 1 дублированием, заключением и трассой из 4 вызовов инструментов. После загрузки примера показывай заглушку «Результаты — в разработке» и `ModeBadge` «Пример». `npm run build` должен проходить. Не трогай ничего вне `demo-frontend/`.

**Проверка:** страница открывается, зоны принимают файлы, кнопка примера ставит бейдж. Коммит `feat(ui): каркас, токены, кит shadcn, экран загрузки`.

---

## UI-2 · 14:45–15:15 · прогресс анализа и вкладка «Структура»

> Прочитай `demo-frontend/docs/design/DESIGN.md` §4.3–4.4 и §7. Реализуй `AnalysisProgress` со степпером из 5 стадий, счётчиками, общим `Progress`, кнопками «Отменить» и «Повторить стадию», `aria-live`. Хук `useJob(jobId)` опрашивает `GET /api/jobs/:id` раз в 1,5 с (URL API из `import.meta.env.VITE_API_URL`), по `result_id` переходит на `/analysis/:id`. Реализуй страницу `/analysis/:id` с `Tabs` «Структура · Функции и риски · Заключение» и вкладку «Структура»: сводка счётчиков + `UnitTable` по §4.4 со `StatusChip` и кнопками «Открыть источник» (пока `console.log(clauseId)`). Хук `useAnalysis(id)` берёт результат из API, а для `id === "demo"` — из `public/demo/result.json`. Роутинг — `react-router-dom`. Правило движения для таблиц из §7 с `prefers-reduced-motion`. Не трогай ничего вне `demo-frontend/`.

**Проверка:** «Загрузить пример» → `/analysis/demo` → вкладка «Структура» с 4 строками и чипами. Коммит `feat(ui): прогресс анализа и вкладка Структура`.

---

## UI-3 · 15:15–15:50 · функции, риски, панель источников

> Прочитай `demo-frontend/docs/design/DESIGN.md` §4.4–4.5 и §9. Реализуй вкладку «Функции и риски»: `FunctionMapTable` (колонки по §4.4, фильтр по статусам чипами-переключателями, поиск по тексту, сортировка по умолчанию `missing → transferred → split → reworded → kept → new`, уверенность полоской с `Tooltip`), затем список `RiskCard` по §4.4. Реализуй `EvidenceDrawer` на `Sheet` (560px, на мобильном full-screen): два столбца «До / После» с `ClauseFragment` — текст пункта, номер `font-mono`, подсветка фрагмента `bg-evidence-highlight` с одноразовым пульсом по §7, свёрнутые соседние пункты, кнопка «Скопировать ссылку на пункт» (формат `ред. 9, п. 5.3.3`, тост через sonner). Пустой столбец для `missing`/`new` — `EmptyState` янтарным, текст из §9. Текст пункта берётся через `GET /api/clauses/:document_id/:clause_id`; для демо — из `public/demo/clauses.json` (создай, с реальными фрагментами п. 5.4.4 ред. 8 и п. 5.3.3 ред. 9 из `docs/hackaton/tracks/*.md`). Подключи «Открыть источник» во всех таблицах и карточках. На мобильном строки таблицы рендерятся карточками. Не трогай ничего вне `demo-frontend/`.

**Проверка:** клик по функции «передана» открывает панель с двумя реальными фрагментами и подсветкой. Коммит `feat(ui): функции, риски, панель источников`.

---

## UI-4 · 15:50–16:20 · заключение, экспорт, трасса, режимы

> Прочитай `demo-frontend/docs/design/DESIGN.md` §4.4 (Заключение), §4.6, §4.7. Реализуй `ConclusionReport` с разделами и кнопками-ссылками на пункты, `ExportMenu` («Скачать HTML» — сериализация отчёта в самодостаточный HTML с инлайн-стилями; «Печать / PDF» — `window.print()` с print-стилями, скрывающими шапку и вкладки; «CSV функций» — колонки `status, before_unit, before_clause, after_unit, after_clause, confidence, note`). Реализуй `TracePanel` (`Collapsible`, «Как агент решал», человекочитаемый список вызовов с мс, вход/выход свёрнуты). Подключи `ModeBadge` ко всем режимам из §4.6; для `partial` — янтарный `Alert` над вкладками с номером незавершённой стадии и кнопкой «Повторить стадию». Все `EmptyState` из §4.7. Не трогай ничего вне `demo-frontend/`.

**Проверка:** экспорт HTML открывается отдельно и содержит источники; печать даёт читаемый PDF; трасса раскрывается. Коммит `feat(ui): заключение, экспорт, трасса, режимы`.

---

## UI-5 · 16:20–16:50 · реальный API, ошибки, мобильный

> Подключи интерфейс к реальному бэкенду Османа: `POST /api/analyses` (multipart: файлы `before[]`, `after[]`) → `{ job_id }`; `GET /api/jobs/:id`; `GET /api/analyses/:id`; `GET /api/clauses/:document_id/:clause_id`. Сверь `src/types.ts` с фактическими ответами и исправь расхождения в UI, не в бэкенде. Обработай ошибки: сетевые и 5xx — `Alert destructive` с текстом по-русски и «Повторить»; 4xx валидации файлов — текст с бэкенда в зоне загрузки; таймаут опроса > 8 минут — предложение открыть пример. Защити от двойной отправки (disabled + spinner). Пройди всё на ширине 375px: зоны столбиком, таблицы карточками, Sheet full-screen, вкладки скроллятся. Проверь фокус-кольца и `Esc` на Sheet. Не трогай ничего вне `demo-frontend/`.

**Проверка:** живой прогон «загрузить редакции 8 и 9 → прогресс → результаты → источник» на живой ссылке с телефона. Коммит `feat(ui): интеграция с API, ошибки, мобильная вёрстка`.

---

## UI-6 · 16:50–17:00 · полировка · затем 17:00–17:20 скриншоты

> Только косметика, без новых фич: выровняй отступы по DESIGN.md §2, проверь три правила движения из §7 и `prefers-reduced-motion`, тексты по §9 буквально, `<title>` «Delphi — контроль функций при реорганизации», favicon. Убери `console.log`. `npm run build` без предупреждений TypeScript. Не трогай ничего вне `demo-frontend/`.

**17:00 — фриз.** Дальше только скриншоты по DESIGN.md §10 в `docs/screenshots/` и раздел интерфейса в README (что на каждом скриншоте и что это доказывает, одной строкой). Коммит `docs: скриншоты интерфейса`.

---

## Если что-то сломалось без ошибки (Code Detective)

> Ожидаемое поведение: <X>. Фактическое: <Y>. Ошибок в консоли нет. Вот компонент и хук: <...>. Пройди по коду построчно, отслеживая состояние и пропсы на каждом рендере, найди место, где логика расходится с ожиданием, объясни причину простыми словами и дай исправленную версию. Не меняй файлы вне `demo-frontend/`.

---

## Что режем, если горит (в этом порядке)

1. CSV-экспорт (оставить HTML + печать).
2. Пульс подсветки и stagger строк (оставить `Sheet` по умолчанию).
3. Соседние пункты в `ClauseFragment` (оставить только сам пункт).
4. Поиск по тексту в `FunctionMapTable` (оставить фильтр по статусу).
5. `TracePanel` человекочитаемый → простой `<pre>` JSON.

**Не режем:** «Загрузить пример» офлайн, `StatusChip` с иконкой и текстом, `EvidenceDrawer` с реальными фрагментами, `ModeBadge`, мобильная вёрстка загрузки и таблиц.
