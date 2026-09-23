# Delphi — дизайн-система и UX-брief (для Codex/Астры)

Это единственный источник правды по интерфейсу. Codex читает этот файл перед каждым UI-промптом из `demo-frontend/docs/design/ASTRA-UI-PROMPTS.md`. Всё, чего здесь нет, — не делаем до 18:00.

**Принцип:** дизайн-система = токены + готовый кит shadcn/ui + 12 доменных компонентов. Не Figma-файл. Не библиотека анимаций. Скриншоты для README снимаются с живого приложения, а не из макета.

---

## 0. Что это за продукт (контекст для дизайна)

Delphi сравнивает комплекты организационных документов «До» и «После» реорганизации, отслеживает передачу функций между подразделениями, находит потенциальные пробелы и пересечения ответственности и формирует проверяемое заключение со ссылками на пункты.

Пользователь — сотрудник, проводящий анализ оргизменений. Не дизайнер, не разработчик. Читает много текста, сверяет цитаты, принимает решение сам. Интерфейс — рабочий инструмент комплаенса, а не лендинг.

**Три качества интерфейса, которые проверяет жюри:**
1. Каждый вывод открывает **точный фрагмент** исходного документа (редакция, пункт, текст).
2. Статус функции виден сразу: сохранена / переформулирована / передана / разделена / соответствие не найдено.
3. Формулировки — **гипотезы для проверки**, не вердикты. «Соответствие не найдено в комплекте „После“», а не «функция потеряна».

---

## 1. Стек интерфейса

| Слой | Выбор | Причина |
|---|---|---|
| Фреймворк | React 18 + TypeScript + Vite (папка `demo-frontend/`). Если Осман выбрал Next.js — те же компоненты, App Router | Согласовано с планом команды |
| Стили | Tailwind CSS 3 + CSS-переменные | Токены в одном файле, Codex знает идеально |
| Кит | **shadcn/ui** (Radix) + `lucide-react` + `sonner` | Tabs, Table, Sheet, Progress, Alert, Dialog, Tooltip, Skeleton уже готовы и доступны |
| Шрифты | **Inter** (кириллица) через `@fontsource-variable/inter`; **JetBrains Mono** для номеров пунктов через `@fontsource-variable/jetbrains-mono` | Без внешних запросов к Google Fonts на защите |
| Анимация | `tailwindcss-animate` (входит в shadcn). Framer Motion **не ставим** | Три правила движения (§7) закрываются CSS |
| Иконки | `lucide-react` | Совместимы с shadcn |

Компоненты shadcn добавлять командой `npx shadcn@latest add <name>`: `button card tabs table badge sheet progress alert dialog tooltip skeleton separator scroll-area collapsible input select dropdown-menu sonner`.

---

## 2. Токены (`demo-frontend/src/styles/tokens.css`)

shadcn-совместимые HSL-переменные + доменные статусы. Только светлая тема (тёмную не делаем — нет времени и нет требования).

```css
:root {
  /* shadcn base */
  --background: 210 20% 98%;
  --foreground: 222 47% 11%;
  --card: 0 0% 100%;
  --card-foreground: 222 47% 11%;
  --popover: 0 0% 100%;
  --popover-foreground: 222 47% 11%;
  --primary: 221 63% 33%;          /* глубокий синий, комплаенс-тон, не брендовый */
  --primary-foreground: 0 0% 100%;
  --secondary: 214 32% 91%;
  --secondary-foreground: 222 47% 11%;
  --muted: 214 32% 94%;
  --muted-foreground: 215 16% 40%;
  --accent: 214 32% 91%;
  --accent-foreground: 222 47% 11%;
  --destructive: 0 72% 51%;
  --destructive-foreground: 0 0% 100%;
  --border: 214 32% 88%;
  --input: 214 32% 88%;
  --ring: 221 63% 33%;
  --radius: 0.5rem;

  /* доменные статусы функций: bg / fg / border */
  --status-kept-bg: 215 20% 95%;        --status-kept-fg: 215 25% 30%;
  --status-reworded-bg: 214 95% 94%;    --status-reworded-fg: 221 70% 35%;
  --status-transferred-bg: 262 83% 95%; --status-transferred-fg: 262 60% 40%;
  --status-split-bg: 173 60% 92%;       --status-split-fg: 175 60% 25%;
  --status-missing-bg: 43 96% 90%;      --status-missing-fg: 30 80% 30%;   /* янтарный: гипотеза, не ошибка */
  --status-duplicate-bg: 24 95% 92%;    --status-duplicate-fg: 20 80% 32%;
  --status-conflict-bg: 350 85% 94%;    --status-conflict-fg: 345 65% 35%;
  --status-new-bg: 142 70% 92%;         --status-new-fg: 142 60% 25%;

  /* подсветка цитаты в источнике */
  --evidence-highlight: 48 100% 85%;

  /* типографика */
  --font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono Variable", ui-monospace, monospace;
}
```

Tailwind: расширить `theme.colors` через `hsl(var(--…))` как в шаблоне shadcn; добавить `status.{kept,reworded,transferred,split,missing,duplicate,conflict,new}.{bg,fg}` и `evidence.highlight`.

### Шкалы

| Токен | Значения |
|---|---|
| Отступы | Tailwind по умолчанию (4px база). Страница: `px-4 md:px-8`, контент `max-w-[1280px] mx-auto` |
| Радиусы | `--radius` 8px; чипы `rounded-full`; карточки `rounded-lg` |
| Тени | только `shadow-sm` на карточках; Sheet — стандартная shadcn |
| Типографика | `text-sm` (14) базовый для таблиц; `text-base` (16) для текста заключения; `text-lg font-semibold` заголовки вкладок; `text-2xl font-semibold tracking-tight` заголовок страницы; номера пунктов — `font-mono text-xs` |
| Ширина текста | цитаты и заключение — `max-w-prose` |

Контраст всех пар статусов ≥ 4.5:1 (проверено на HSL выше при `font-medium`). Цвет **никогда** не единственный носитель смысла: у каждого чипа — иконка и текст.

---

## 3. Словарь статусов (единый для UI, API и README)

| Код | Метка (RU) | Иконка lucide | Смысл |
|---|---|---|---|
| `kept` | Сохранена | `Check` | Та же функция, тот же исполнитель, формулировка совпадает |
| `reworded` | Переформулирована | `PenLine` | Смысл тот же, текст изменён (в т. ч. обязательность: «осуществляется» → «может осуществляться») |
| `transferred` | Передана | `ArrowRightLeft` | Функция у другого исполнителя/подразделения |
| `split` | Разделена | `GitFork` | Одна старая функция → несколько новых пунктов/исполнителей |
| `missing` | Соответствие не найдено | `SearchX` | Не найдено в комплекте «После» после поиска по всему комплекту. **Гипотеза.** |
| `duplicate` | Возможное дублирование | `Copy` | Два подразделения: действие + объект + область совпадают |
| `conflict` | Возможный конфликт | `AlertTriangle` | Конфликт интересов или противоречие требований; конкретная причина раскрывается в пояснении. **К проверке.** |
| `new` | Добавлено | `Plus` | Есть только в «После» |

Статусы подразделений (вкладка «Структура»): `kept` Сохранено · `new` Добавлено · `changed` Изменено (`PenLine`) · `missing` Не найдено в «После».

---

## 4. Экраны и состояния

### 4.1 Оболочка (`AppShell`)

Верхняя панель 56px: слева слово **Delphi** + подзаголовок «Контроль функций при реорганизации»; в центре — два `EditionBadge` («До: ред. 8 · 25.06.2021», «После: ред. 9 · 23.12.2022») после загрузки; справа — `ModeBadge` (см. §4.6) и кнопка «Новый анализ». Ниже — контент. Футер не нужен.

### 4.2 Экран загрузки (`/`)

Две зоны `UploadZone` рядом (на мобильном — столбиком): «Комплект „До“» / «Комплект „После“». Принимают `.docx .pdf .md .xlsx`, несколько файлов. После загрузки — список файлов с размером, определённой редакцией/датой (если распознано) и кнопкой удалить. Под зонами — кнопка **«Анализировать»** (primary, disabled пока обе зоны пусты) и ссылка-кнопка **«Загрузить пример: редакции 8 и 9»**.

Пример — это **не запуск анализа**, а мгновенный показ заранее посчитанного результата из `demo-frontend/public/demo/result.json` с `ModeBadge = «Пример»`. Это страховка демо: интерфейс показывает результат даже при упавшем бэкенде.

Состояния: `idle` · `uploading` (прогресс на зоне) · `invalid` (Alert: «Формат не поддерживается» / «Сканированный PDF без текстового слоя — требуется OCR, не поддерживается в этой версии») · `ready`.

### 4.3 Прогресс анализа (`AnalysisProgress`)

Анализ — фоновая задача на минуты. Полноэкранная карточка со степпером из 5 стадий:

1. Извлечение пунктов · 2. Подразделения и обязанности · 3. Сопоставление функций · 4. Проверка пробелов и пересечений · 5. Заключение

У активной стадии — спиннер и живые счётчики («извлечено 313 пунктов», «сопоставлено 84 из 120»). Завершённые — `Check`. Внизу — `Progress` общий и текст «Обычно 2–4 минуты». Кнопка «Отменить». Опрос `GET /api/jobs/{id}` раз в 1,5 с; `aria-live="polite"` на строке статуса.

Если стадия упала: стадия помечается `AlertTriangle`, показываем «Частичный результат» (см. §4.6), кнопка «Повторить стадию».

### 4.4 Результаты (`/analysis/:id`) — три вкладки

**Вкладка «Структура»** — `UnitTable`: Подразделение · Статус (чип) · Подчинённость · Источник «До» · Источник «После». Клик по источнику → `EvidenceDrawer`. Сверху — сводка: «Сохранено 2 · Добавлено 2 · Изменено 0 · Не найдено 0».

**Вкладка «Функции и риски»** — две секции:
- `FunctionMapTable`: Функция («До», пункт) → Исполнитель «После» (пункт) · Статус · Уверенность (`0–1` полоской, `Tooltip` с пояснением) · «Источник». Фильтр по статусу (`Select`, мультивыбор через чипы) и поиск по тексту. Сортировка по умолчанию: `missing` → `transferred` → `split` → `reworded` → `kept` → `new`. Строки `missing` первыми — это то, что человек проверяет.
- `RiskCard` (список): заголовок «Возможное дублирование: ДИТААД и ДОА — подготовка отчётов по…», два столбца с двумя пунктами, поле «Почему это может быть проблемой» (текст модели), поле «Что проверить» и кнопки-источники. Карточка `conflict` — с плашкой «Требует проверки ответственным сотрудником».

**Вкладка «Заключение»** — `ConclusionReport`: разделы «Изменения структуры», «Передача функций», «Вопросы для проверки», «Ограничения анализа» (что не парсилось, что за пределами комплекта), «Источники». Каждое утверждение с кнопкой-ссылкой на пункт. Справа сверху — `ExportMenu`: «Скачать HTML», «Печать / PDF» (через `window.print()` с print-стилями), «CSV функций».

### 4.5 Панель источников (`EvidenceDrawer`)

`Sheet` справа, ширина 560px (на мобильном — во весь экран). Заголовок: статус-чип + название функции. Два столбца (на мобильном — стеком): **«До · ред. 8 · п. 5.4.4»** и **«После · ред. 9 · п. 5.3.3»**. В каждом — `ClauseFragment`: текст пункта с подсветкой цитируемого фрагмента (`bg-evidence-highlight`), номер пункта `font-mono`, контекст ±1 пункт свёрнут («Показать соседние пункты»). Кнопка «Скопировать ссылку на пункт» (формат: `ред. 9, п. 5.3.3`). Если у столбца нет пункта (статус `missing` или `new`) — `EmptyState` «В этом комплекте соответствие не найдено» — без красного, янтарный.

Правило: **цитата всегда берётся из исходного текста по `clause_id`**, а не из ответа модели. Панель показывает ровно то, что лежит в документе.

### 4.6 Режимы и честность (`ModeBadge`, `TracePanel`)

`ModeBadge` в шапке: `live` — не показывается; `cached`/«Пример» — серый чип «Показан сохранённый результат»; `partial` — янтарный «Частичный результат: стадия N не завершена»; `rule_based` — серый «Без LLM: только структурное сопоставление».

`TracePanel` (`Collapsible` внизу результатов): «Как агент решал» — список вызовов инструментов `search_clauses / get_clause / get_unit_functions / check_references` с входом, выходом (свёрнуто) и мс. Это доказательство агентности для жюри; должно быть читаемо, не сырой JSON-дамп.

### 4.7 Пустые и ошибочные состояния

`EmptyState` (иконка + одна фраза + одно действие): «Пока нет анализов — загрузите комплекты или откройте пример»; «По фильтру ничего не найдено — сбросить фильтр»; «Дублирований не выявлено — это результат проверки, а не отсутствие проверки».

Ошибка API: `Alert destructive` с текстом по-русски и кнопкой «Повторить». Никогда не пустой экран, никогда сырой stack trace.

---

## 5. Компоненты — инвентарь

| Компонент | Файл | На базе shadcn | Пропсы (ключевые) |
|---|---|---|---|
| `AppShell` | `components/layout/AppShell.tsx` | — | `editions?`, `mode` |
| `EditionBadge` | `components/EditionBadge.tsx` | Badge | `side: 'before'\|'after'`, `label`, `date?` |
| `ModeBadge` | `components/ModeBadge.tsx` | Badge | `mode` |
| `StatusChip` | `components/StatusChip.tsx` | Badge | `status` (из §3), `size?` |
| `UploadZone` | `components/UploadZone.tsx` | Card | `side`, `files`, `onFiles`, `onRemove`, `state` |
| `AnalysisProgress` | `components/AnalysisProgress.tsx` | Progress, Card | `stages`, `current`, `counters`, `onCancel`, `onRetryStage` |
| `UnitTable` | `components/UnitTable.tsx` | Table | `units`, `onEvidence(clauseId)` |
| `FunctionMapTable` | `components/FunctionMapTable.tsx` | Table, Select, Input | `functions`, `filter`, `onEvidence` |
| `RiskCard` | `components/RiskCard.tsx` | Card | `risk`, `onEvidence` |
| `EvidenceDrawer` | `components/EvidenceDrawer.tsx` | Sheet | `open`, `before?`, `after?`, `status`, `onClose` |
| `ClauseFragment` | `components/ClauseFragment.tsx` | ScrollArea | `clause`, `highlight?`, `neighbors?` |
| `ConclusionReport` | `components/ConclusionReport.tsx` | Card, Separator | `report`, `onEvidence` |
| `ExportMenu` | `components/ExportMenu.tsx` | DropdownMenu | `onHtml`, `onPrint`, `onCsv` |
| `TracePanel` | `components/TracePanel.tsx` | Collapsible | `trace` |
| `EmptyState` | `components/EmptyState.tsx` | — | `icon`, `title`, `action?` |

Правило размера: файл > 200 строк с двумя обязанностями — разделить. Логика данных — в хуках `hooks/useAnalysis.ts`, `hooks/useJob.ts`; компоненты только рендерят.

---

## 6. Контракт данных для UI (`demo-frontend/src/types.ts`)

Черновик. **Сверить с Османом до 14:40** — его схема первична, UI подстраивается.

```ts
export type FunctionStatus =
  | "kept" | "reworded" | "transferred" | "split" | "missing" | "duplicate" | "conflict" | "new";
export type UnitStatus = "kept" | "new" | "changed" | "missing";
export type Mode = "live" | "cached" | "partial" | "rule_based";

export interface ClauseRef { document_id: string; edition: string; clause_id: string; clause_number: string; }
export interface Clause extends ClauseRef { text: string; highlight?: { start: number; end: number }; }

export interface Unit { unit_id: string; name: string; status: UnitStatus; parent?: string; before?: ClauseRef; after?: ClauseRef; }
export interface FunctionMapping {
  id: string; status: FunctionStatus; confidence: number;
  before?: { unit: string; ref: ClauseRef; summary: string };
  after?: Array<{ unit: string; ref: ClauseRef; summary: string }>;
  note?: string; // что изменилось словами
}
export interface Risk { id: string; kind: "duplicate" | "conflict"; title: string; a: { unit: string; ref: ClauseRef }; b: { unit: string; ref: ClauseRef }; why: string; check: string; }
export interface Conclusion { sections: Array<{ title: string; items: Array<{ text: string; refs: ClauseRef[] }> }>; limitations: string[]; }
export interface TraceItem { tool: string; input: unknown; output: unknown; ms: number; }

export interface AnalysisResult {
  id: string; mode: Mode;
  editions: { before: { label: string; date?: string }; after: { label: string; date?: string } };
  units: Unit[]; functions: FunctionMapping[]; risks: Risk[]; conclusion: Conclusion; trace: TraceItem[];
}
export interface JobStatus { id: string; stage: 1|2|3|4|5; stage_state: "running"|"done"|"failed"; counters: Record<string, number>; result_id?: string; error?: string; }
// GET /api/clauses/:document_id/:clause_id -> Clause  (для EvidenceDrawer)
```

---

## 7. Движение — ровно три правила

| Где | Что | Длительность / easing |
|---|---|---|
| Степпер анализа | Переход стадии: чек появляется `animate-in fade-in zoom-in-95`, счётчики обновляются без анимации | 200 ms, ease-out |
| Панель источников | `Sheet` выезжает справа (стандарт shadcn); цитируемый фрагмент один раз мигает подсветкой (`@keyframes evidence-pulse`, 2 итерации) | 250 ms + 600 ms пульс |
| Таблицы результатов | Строки появляются `animate-in fade-in slide-in-from-bottom-1` со `stagger` 20 ms, не более 300 ms суммарно | 150 ms каждая |

Всё остальное — `transition-colors duration-150` на hover/focus и не больше. `@media (prefers-reduced-motion: reduce)` — все анимации выключены (`animate-none`). Никаких анимаций на загрузке страницы, никаких «hero».

---

## 8. Доступность и мобильная вёрстка

- Фокус-кольца видимы (`ring-2 ring-ring ring-offset-2`), клавиатура открывает/закрывает Sheet (`Esc`), таблицы с `<th scope>`.
- Чипы: иконка + текст, `aria-label` совпадает с меткой.
- Прогресс: `role="status" aria-live="polite"`.
- Мобильный (≤ 768): зоны загрузки столбиком; таблицы — карточками (`FunctionMapTable` рендерит `<Card>` на строку); Sheet — full-screen; вкладки скроллятся горизонтально.
- Проверка с телефона по мобильному интернету — 16:40 (план Нурдаулета).

---

## 9. Микротексты (RU) — использовать буквально

| Место | Текст |
|---|---|
| Заголовок | Delphi · Контроль функций при реорганизации |
| Зона | Комплект «До» · Комплект «После» · Перетащите файлы или нажмите. DOCX, PDF с текстом, MD, XLSX |
| Кнопки | Анализировать · Загрузить пример: редакции 8 и 9 · Новый анализ · Открыть источник · Скопировать ссылку · Повторить · Отменить |
| Статус `missing` | Соответствие не найдено в комплекте «После» |
| Подпись к `missing` | Функция могла сменить исполнителя, номер или формулировку. Проверьте вручную по источнику |
| Риск `conflict` | Требует проверки ответственным сотрудником |
| Пример | Показан сохранённый результат для редакций 8 и 9 |
| Ограничения | Анализ ограничен предоставленными документами. Сканированные PDF не обрабатываются |
| Пустой фильтр | По фильтру ничего не найдено · Сбросить |

Тон: нейтральный, без восклицаний, без «ИИ обнаружил ошибку». Модель предполагает — человек проверяет.

---

## 10. Скриншоты для README (снимать после 17:00 с живой ссылки)

| Файл | Экран | Что доказывает |
|---|---|---|
| `docs/screenshots/01-upload.png` | Экран загрузки с двумя зонами и кнопкой примера | Must-have «загрузка комплектов» |
| `docs/screenshots/02-structure.png` | Вкладка «Структура»: 2 сохранено, 2 добавлено | Must-have 1 |
| `docs/screenshots/03-transfer-evidence.png` | Функция «передана» 5.4.4 → 5.3.3 с открытой панелью источников | Must-have 2 + 4, killer feature |
| `docs/screenshots/04-risks.png` | Карточка дублирования с двумя пунктами | Must-have 3 |
| `docs/screenshots/05-conclusion.png` | Заключение с экспортом | Must-have 5 |
| `docs/screenshots/06-progress-mobile.png` | Степпер на телефоне | Продуктовость |

---

## 11. Про Figma — честно

Figma MCP в этой сессии требует авторизации коннектора (не выполнена) и даже при доступе круг «макет → код» стоит 45–60 минут, которых нет. Рубрика не содержит критерия «дизайн»; интерфейс влияет на баллы только через «работоспособность» и «ценность».

Если есть готовый шаблон UX/UI: экспортировать 3–4 экрана в PNG в `demo-frontend/docs/design/reference/`, положить рядом и указать Codex в промпте UI-1 «следуй композиции из `demo-frontend/docs/design/reference/*.png`, токены и компоненты — из DESIGN.md». Codex читает изображения. Этого достаточно.

Полная дизайн-система в Figma — пункт для раздела «Потенциал развития» README, не для сегодняшнего дня.
