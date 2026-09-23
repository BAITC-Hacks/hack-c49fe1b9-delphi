# Стоимость и время действий агента Delphi

Самостоятельный инструмент в `agent_costs/`. Основной модуль не зависит от `/lab`; отдельный launcher ниже подключает наблюдение к его CLI без изменения исходников. Backend, frontend и Docker не изменяются. Все команды ниже выполняются **из корня репозитория**. Python 3.10+; базовые расчёты, учёт и отчёты работают без сторонних зависимостей.

## End-to-end запуск `/lab` вместе с учётом стоимости

Используйте **эту команду вместо обычного `lab/run.ps1`**. Нужны уже установленное окружение `lab/.venv` и ключ/модель в `lab/.env`. Launcher сам загрузит существующие настройки лаборатории; копировать ключ в `agent_costs` не нужно.

Короткий синтетический smoke test:

```powershell
lab/.venv/Scripts/python -B -m agent_costs.lab_run -- demo --fixture ru --mode live
```

Реальные документы 8/9:

```powershell
lab/.venv/Scripts/python -B -m agent_costs.lab_run -- demo --mode live --allow-limited
```

Модель остаётся заданной через `OPENAI_MODEL=gpt-6-sol` в `lab/.env`. При необходимости можно задать `$env:OPENAI_MODEL = "gpt-6-sol"` в терминале, откуда запускается команда; окружение имеет приоритет над `.env`. Это **платный запуск самого пайплайна**, без дополнительных модельных запросов со стороны учёта. Лимиты `LAB_MAX_CALLS`, `LAB_TIMEOUT_SECONDS` и остальные настройки `/lab` сохраняются.

Для каждого ответа в терминале появляются строки `[agent_costs]` с этапом, попыткой, USD и временем. Сохраняются:

- `agent_costs/out/lab/<run_id>/events.jsonl` — вызовы модели и локальных инструментов;
- `agent_costs/out/lab/<run_id>/report.json` и `report.csv` — обновляются по мере работы;
- обычные результаты лаборатории — в её стандартном `lab/data/runs/<run_id>/`.

Из второго терминала можно смотреть **тот же** прогон:

```powershell
python -m agent_costs report agent_costs/out/lab/<run_id>/events.jsonl
```

Стоимость OpenAI обозначается `rate_estimate`: фактические токены умножаются на опубликованные ставки, это не сумма из инвойса. Снимок [prices.openai-gpt6-sol.json](examples/prices.openai-gpt6-sol.json) проверен 23.09.2026 по [странице модели](https://developers.openai.com/api/docs/models/gpt-6-sol). Launcher выбирает Standard/Flex/Fast по `service_tier` ответа и применяет повышение тарифа при входе больше 272 000 токенов. Неизвестная модель/tier/usage остаётся без цены. `--prices <файл>` задаёт другой проверенный тариф; тарифы OpenRouter не подставляются вместо OpenAI.

Подключение действует только в текущем Python-процессе: оборачиваются `_Runner.request`, вызов `Responses.create`, локальные инструменты и CLI `execute_run`. Запросы, результаты, retry-цикл и лимиты агента не меняются. Ошибка записи метрик не вызывает повторного запроса; выводится предупреждение, launcher возвращает ненулевой код. Поддержаны команды `demo` и `analyze`, прямой нерегиональный OpenAI endpoint, текущий последовательный агент. `serve`/`translate` этим launcher не оборачиваются. `-B` предотвращает запись bytecode в `/lab`.

Если пайплайн уже запущен обычным `lab/run.ps1`, присоединить этот launcher к работающему процессу нельзя. Текущий `/lab` хранит только суммарные входные/выходные токены, без полной детализации кэша по запросам; точный журнал по этапам задним числом из `result.json` не восстановить. Используйте launcher для следующего запуска.

Инструмент умеет:

- оценивать стоимость каждого действия и всего сценария по числу токенов либо тексту запроса;
- получать тарифы выбранных моделей из публичного каталога OpenRouter и сохранять снимок с датой;
- учитывать ответы OpenRouter Chat Completions и OpenAI Responses/Chat Completions;
- сохранять вызовы, попытки, ошибки, токены, стоимость и длительность в JSONL;
- формировать JSON/CSV и таблицу по `run_id → action → provider → model`, включая mean/p50/p95 времени запросов;
- выполнять отдельный запрос через OpenRouter для замера промпта.

## Быстрый запуск без ключа и платных запросов

```powershell
python -m agent_costs estimate agent_costs/examples/scenario.json --prices agent_costs/examples/prices.openrouter.json --output agent_costs/out/estimate.json
python -m unittest discover -s agent_costs/tests -v
```

`scenario.json` — **синтетическая нагрузка**, не результаты `/lab`. В нём перечислены извлечение функций, сопоставление, поиск возможных потерь, дубли/конфликты, раунды инструментов, проверка, заключение и переводы. Модель меняется в `defaults.model` или у отдельного действия. Названия действий произвольные; они не создают новых агентов и не меняют пайплайн приложения.

Сохранённый тариф `prices.openrouter.json` получен из API, дата находится в `fetched_at`. Для заданной синтетической нагрузки оценка по этому снимку — **$0.13416**. Это иллюстрация арифметики, не замер стоимости реального анализа.

Обновление тарифов без генерации:

```powershell
python -m agent_costs refresh-prices --models openai/gpt-4.1-mini --output agent_costs/out/prices.json
python -m agent_costs estimate agent_costs/examples/scenario.json --prices agent_costs/out/prices.json
```

После `--models` можно перечислить несколько точных ID через пробел. Выбранный в примерах ID служит примером конфигурации. Неизвестная модель вызывает ошибку, подстановка другой модели не выполняется. Для сравнения моделей добавьте варианты действий с разными `model` и загрузите их тарифы.

## Оценка текста промпта

Только для этого режима нужен `tiktoken`. Окружение остаётся внутри новой папки:

```powershell
python -m venv agent_costs/.venv
agent_costs/.venv/Scripts/python -m pip install -r agent_costs/requirements.txt
agent_costs/.venv/Scripts/python -m agent_costs estimate agent_costs/examples/prompt-scenario.json --prices agent_costs/examples/prices.openrouter.json --output agent_costs/out/prompt-estimate.json
agent_costs/.venv/Scripts/python -m unittest discover -s agent_costs/tests -v
```

Для Linux/macOS путь к этому интерпретатору: `agent_costs/.venv/bin/python`. Первый вызов выбранного encoding в `tiktoken` может загрузить публичный словарь токенизатора; текст промпта в сеть не отправляется. После прогрева словаря оценка работает офлайн.

В действии задаются `request_file` (относительно сценария), `encoding`, `output_tokens`, `calls`. Можно передать объект `request` прямо в JSON. Поддерживаются текстовые `messages` и Responses `input`; также учитываются `instructions`, определения `tools`, `tool_choice`, история сообщений и схема результата.

Токенизация сериализованного контекста — **приблизительная оценка**, поскольку сервер использует собственное оформление сообщений и может добавлять скрытые токены. `o200k_base` выбран явно только для примера OpenAI, он не является универсальным токенизатором всех моделей OpenRouter. Для другой модели передайте измеренные `input_tokens` или явно выбранный приближённый encoding. Изображения, аудио, файлы и скрытая история через `previous_response_id`/`conversation` не оцениваются локально: используйте фактический `usage` или предварительно полученное число токенов полного контекста.

`output_tokens` — ожидаемый **полный оплачиваемый выход, включая reasoning**. `calls` — количество всех модельных запросов этого действия, включая повторные попытки и раунды. Если контекст растёт, задавайте раунды отдельными строками, а не умножайте короткий начальный запрос. `cached_tokens` и `cache_write_tokens` задаются на один вызов; кэш нельзя считать гарантированным. Для сценария без кэша оставьте оба поля равными нулю.

## Журнал и отчёт без реальных запросов

```powershell
python -m agent_costs record agent_costs/examples/responses.synthetic.jsonl --prices agent_costs/examples/prices.openrouter.json --output agent_costs/out/demo-events.jsonl
python -m agent_costs report agent_costs/out/demo-events.jsonl --json agent_costs/out/demo-report.json --csv agent_costs/out/demo-report.csv
```

Импорт создаёт новый файл и отказывается перезаписывать существующий. Для повторного импорта выберите другое имя. `report --run-id <ID>` ограничивает отчёт конкретным запуском. Повторная запись одного `event_id` или ответа с тем же `provider + response_id` не увеличивает сумму; число пропущенных дублей указано в JSON. Первое событие сохраняет принадлежность действию и запуску.

Демо специально содержит timeout и ответ OpenAI без тарифа. Поэтому `known_subtotal_usd = 0.01668`, `unpriced_calls = 2`, `cost_complete = false`. Неизвестная стоимость не превращается в бесплатный вызов. В этом демо токены, время и списания синтетические.

Каждая строка импорта — объект с обязательными `run_id`, `action`, `provider`, `model` и необязательными `response`, `elapsed_ms`, `attempt`, `status`, `error_type`, `synthetic`. `response` — сохранённый JSON ответа API целиком. Для потока передайте один собранный итоговый ответ с финальным `usage`, а не каждую SSE-часть.

## Подключение к существующему агенту

Публичный интерфейс — `Tracker` из `agent_costs`. Установка OpenAI SDK нужна только в окружении самого агента, если он уже использует этот SDK. Пример для клиента OpenRouter:

```python
import os
from openai import OpenAI
from agent_costs import Tracker
from agent_costs.cost_tracker import load_prices

model = os.environ["AGENT_MODEL"]  # например, openai/gpt-4.1-mini
client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.environ["OPENROUTER_API_KEY"],
    max_retries=0,
)
tracker = Tracker("agent_costs/out/events.jsonl", run_id="analysis-001",
                  prices=load_prices("agent_costs/out/prices.json"))

# messages и tools подготовлены вашим агентом.
response = tracker.measure(
    "match_functions", "openrouter", model,
    lambda: client.chat.completions.create(
        model=model, messages=messages, tools=tools, max_tokens=2000,
    ),
    attempt=1,
)
```

Для асинхронного клиента: `response = await tracker.measure_async(action, provider, model, lambda: client.chat.completions.create(...))`. Для OpenAI напрямую передайте `provider="openai"` и оберните `client.responses.create(...)`; SDK-объект преобразуется через `model_dump`. Если ответ уже получен, вызовите `tracker.record(action, provider, model, response, elapsed_ms=...)`.

Один wrapper — одна попытка одного API-запроса. Отключите внутренние retries клиента, повторяйте запросы в существующем ограниченном цикле агента и передавайте `attempt=2`, чтобы не скрывать дополнительные вызовы. Tracker сам не повторяет запросы и не выполняет инструменты агента. Исключения записываются и передаются вызывающему коду. Поток нужно завершить до записи итогового usage; TTFT здесь не измеряется.

Локальные операции (`search_clauses`, `get_clause`, `get_unit_functions`, `check_references`) учитывайте через `tracker.record("get_clause", "local", "local", elapsed_ms=2)`. У них нулевая плата модельному API; стоимость CPU/хранилища сюда не входит. Текст, возвращённый инструментом модели, оплачивается как вход **следующего** модельного запроса и не должен начисляться вторично отдельной строкой.

Один экземпляр Tracker поддерживает два параллельных запроса и защищает запись потоков lock. Между процессами блокировки нет: используйте отдельные журналы. Ошибки записи журнала передаются вызывающему коду; не запускайте генерацию повторно автоматически при ошибке логирования, чтобы не оплатить её дважды.

## Один реальный замер через OpenRouter

Команда `run` отправляет один запрос и может потратить средства. Ключ читается только из `OPENROUTER_API_KEY` окружения. Файл `.env` автоматически не загружается.

```powershell
python -m agent_costs run --request agent_costs/examples/request.synthetic.json --model openai/gpt-4.1-mini --action extract_functions --run-id prompt-bench-001 --prices agent_costs/examples/prices.openrouter.json --log agent_costs/out/real-events.jsonl
python -m agent_costs report agent_costs/out/real-events.jsonl
```

В request обязателен положительный `max_tokens`. CLI поддерживает non-streaming Chat Completions, один явно выбранный model, без автоматических retries. Ответ модели не сохраняется и не печатается; выводятся ID, модель и usage. Это замер одного подготовленного промпта, не запуск полного агента или сравнения документов. Полный агент подключается через Tracker.

## Как рассчитывается стоимость

1. Для OpenRouter приоритет имеет `usage.cost`, включая точный ноль. `cost_details.upstream_inference_cost` не прибавляется: это другая характеристика того же вызова. [OpenRouter Usage Accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting).
2. Когда списание не возвращено, используется тариф **фактически возвращённой** модели; результат обозначается `rate_estimate`. Название запрошенной модели хранится отдельно. Отсутствующий/неподходящий тариф означает `unknown`.
3. Формула: `(input − cache_read − cache_write) × input_rate + cache_read × read_rate + cache_write × write_rate + output × output_rate + request_fee`. Кэш-запись заменяет обычную цену входного токена, а не добавляется к ней. [OpenAI Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).
4. Reasoning входит в выходные токены и показывается отдельно только для диагностики. Повторно к сумме он не добавляется. [OpenAI Reasoning](https://developers.openai.com/api/docs/guides/reasoning).
5. Деньги считаются через `Decimal` и сохраняются десятичными строками. Тарифы OpenRouter — USD **за токен/запрос**, не за миллион. [OpenRouter Models](https://openrouter.ai/docs/guides/overview/models).

`rate_snapshot` сохраняется в событии, поэтому позднее обновление каталога не пересчитывает историю. Отчёт отдельно суммирует `provider_reported_usd` и `rate_estimated_usd`. `cost_complete=true` означает отсутствие неизвестных сумм, а не сверку с банковским счётом или провайдерским инвойсом.

Тарифы OpenRouter нельзя автоматически переносить на OpenAI напрямую. Для прямого OpenAI создайте свой файл того же формата с ключом `openai:<точное возвращаемое имя модели>`, `input`, `output`, `cache_read`, `cache_write`, `request` в USD за токен/запрос, а также `source`, `fetched_at` и `service_tier`, совпадающим с ответом. Берите значения из [официального прайса OpenAI](https://developers.openai.com/api/docs/pricing), учитывая модель, длину контекста и tier. Различие tier блокирует оценку; тарифы автоматически из HTML не извлекаются.

Если нет ставки для использованного кэша, usage некорректен, каталог содержит условные `overrides` или отдельный ненулевой `internal_reasoning`, инструмент не выдумывает цену. Используйте `usage.cost` либо отдельный проверенный тариф для этих условий. Плата за встроенный web/file search, мультимодальность и другие услуги не вычисляется из текстовой формулы; при OpenRouter она учитывается в общей сумме, возвращённой провайдером. BYOK-счёт upstream, пополнение баланса, налоги и инфраструктура отдельно не суммируются.

Сохраняются служебные метки и счётчики, а не ключи, тексты документов, промпты или ответы. Не помещайте секреты в `run_id`/`action`. Оценки по сценарию тоже не содержат исходный request.

## Приёмка и границы

Тесты проверяют арифметику кэша и reasoning, нулевые списания, неизвестную стоимость, различие запрошенной/ответившей модели, тарифы провайдеров/tier, retries, p50/p95, дедупликацию, импорт/экспорт, async, параллельную запись, RU/KK-токенизацию и учёт schemas/tools. Запись в `/lab` заблокирована самим модулем. Синтетические данные лежат только здесь, оригиналы проекта не меняются.

Для оценки результата агента дополнительно нужны найденные ожидаемые изменения, пропуски и ложные срабатывания из [плана приёмки](../docs/implementation-plan.md). Стоимость и задержка не являются метриками смысловой точности. `sum_request_ms` складывает длительности запросов и при параллельной работе не равен времени всего анализа; p95 использует nearest-rank, p50 — медиану.

Не включены: присоединение к уже работающему процессу, парсеры документов, сервер, UI, Docker, собственное выполнение раундов агента, сверка инвойсов и бюджетный ограничитель. Для старых запусков без usage точную цену восстановить этим журналом нельзя: потребуется история провайдера. Публичный каталог проверяется командой `refresh-prices`; тесты не совершают платных запросов.
