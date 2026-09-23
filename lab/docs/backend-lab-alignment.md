# Backend ↔ lab: согласование после pull

Дата: 23.09.2026. Remote: `09cc7b2`; локальное слияние: `71b320c`.

**Статус:** анализ кода и документов, предложения к дальнейшей работе. Перенос реализации не выполнялся. Новая основная архитектура — FastAPI, PostgreSQL, async SQLAlchemy, Alembic, один worker и один ограниченный агент. SQLite лаборатории сохраняется как локальный исследовательский артефакт; переносить его в основной backend или добавлять fallback нельзя.

## 1. Что изменилось и чему доверять

- В [backend/README.md](../../backend/README.md) теперь описаны готовые модули, ограничения и проверенные команды; наличие кода ещё не означает проверенный live end-to-end.
- [backend/openapi.json](../../backend/openapi.json) и [backend/app/schemas](../../backend/app/schemas) задают типизированный API со стабильными operation_id.
- Появился [demo-frontend](../../demo-frontend/README.md). Его README и [общий handoff](../../docs/handoff.md) прямо отмечают расхождение текущего frontend-контракта с backend. Исправление frontend принадлежит его владельцу.
- [docs/README.md](../../docs/README.md) и начало AGENTS всё ещё говорят, что frontend не реализован. Это расхождение статусов: код офлайн-демо существует, интеграция с API не подтверждена. В этой заметке это не трактуется как готовое приложение; общие файлы не переписывались.
- DOCX редакции 9 теперь есть в `docs/sources/`. SHA-256 обеих репозиторных редакций совпадает с файлами пользователя из Downloads, на которых шёл lab run. Это позволяет сравнивать парсеры на одинаковом входе, но их source IDs и число блоков могут различаться.

## 2. Что стоит взять из lab в backend

| Приоритет | Наработка lab | Куда адаптировать | Условие переноса |
|---|---|---|---|
| P0 | Учёт каждого Responses-вызова: попытка, раунд, модель, длительность, полный usage, UNKNOWN | [agent/model_client.py](../../backend/app/agent/model_client.py), [services/translations.py](../../backend/app/services/translations.py) | Передавать настоящий run_id и stage через контекст вызова. Использовать существующий `agent_costs`, без второго калькулятора. Сейчас hooks и стоимость в backend отсутствуют |
| P0 | Сохранение принятых результатов после каждой партии | [services/workflow.py](../../backend/app/services/workflow.py), [services/results.py](../../backend/app/services/results.py) | Backend сейчас сохраняет во время работы coverage, а units/functions/findings — после возврата агента. При таймауте результат до этого момента не опубликован. Переносить принцип checkpoint с валидацией и транзакциями PostgreSQL, не код SQLite Store |
| P0 | Явные лимиты вызовов/выхода и денежное резервирование | [agent/model_client.py](../../backend/app/agent/model_client.py), [config.py](../../backend/app/config.py) | Сначала согласовать настройки и бюджет. Backend уже ограничивает время, партии и tool rounds, но не передаёт `max_output_tokens` и не считает денежный предел. Для неизвестной стоимости нужен отдельный безопасный путь; незавершённый legacy hold lab не копировать как готовую функцию |
| P1 | Проверка размера полного накопленного tool-контекста и `tool_choice='none'` на последнем разрешённом раунде | [agent/model_client.py](../../backend/app/agent/model_client.py) | Сохранить evidence/history целиком либо явно остановить партию. Не менять retry-политику под видом включения метрик: backend-клиент уже создаётся с `max_retries=0` |
| P1 | Детерминированные текстовые кандидаты без AI | [lab/delphi_lab/diffing.py](../delphi_lab/diffing.py) → отдельный preprocessing-слой backend | Может дать первый экран и дешёвые кандидаты. `exact_text` не означает сохранённого исполнителя, а `no_lexical_candidate` не означает потерю функции |
| P1 | Подставные SDK-проверки costs, retries, tool rounds, переводов, resume | [lab/tests](../tests) → изолированные backend-тесты | Сохранить сценарии и инварианты, переписать harness под AsyncOpenAI и UUID. Не переносить успешный статус lab-тестов на backend |

Стоимость подключать к обоим реальным SDK-входам: основной агент использует `responses.parse`, перевод — отдельный `responses.parse`. Один hook на `AnalysisEngine.analyze` потеряет отдельные раунды и переводы. Run-контекст должен передаваться явно; общее изменяемое поле run_id у клиента опасно при параллельном переводе другого запуска.

**Важная граница учёта:** lab записывает usage сырого ответа `responses.create` до `model_validate_json`. В backend `responses.parse` объединяет HTTP и локальную structured-валидацию; hook только после возврата `parse` может не увидеть usage оплаченного ответа, если локальный парсинг выбросит `ValidationError`. В текущем `ModelClient` перехватывается `OpenAIError`, но не эта ошибка. Перенос должен сохранить сырой ответ для учёта и отделить валидацию; ошибка метрик не должна провоцировать новый запрос. Это вывод из чтения кода, без воспроизведения в runtime. Синхронную запись файлов стоимости также нужно адаптировать к async исполнению backend.

Дополнительные адресные переносы после P0: первичные цитаты в ограниченном comparison payload lab; инструмент `check_references` для перенумерации; перевод findings партиями вместо одного большого запроса. В backend сохранить при этом перевод summary, проверку целого набора ID и review_revision. Сейчас эти переносы не выполнены.

Калькулятор и lab пока не отслеживаются Git. Для передачи решения команде потребуются явная поставка существующего `agent_costs` и тарифного файла; наличие папки на этом компьютере не означает, что зависимость уже доступна в remote или образе backend.

## 3. Что стоит взять из backend в lab

| Приоритет | Наработка backend | Применение в lab | Ограничение |
|---|---|---|---|
| P0 | Поиск отсутствующей функции по всем исходным блокам After, сохранённый `SearchCoverage` | [agent/missing.py](../../backend/app/agent/missing.py), [reporting/search.py](../../backend/app/reporting/search.py) → семантический поиск lab | В lab exhaustive sweep идёт по извлечённым After functions, а lexical search — по блокам. При пропусках extraction нельзя считать эти покрытия эквивалентными. Хранить source-level coverage/candidates/errors |
| P0 | Строгая проверка результата перед сохранением | [domain/result_validation.py](../../backend/app/domain/result_validation.py), [agent/validation.py](../../backend/app/agent/validation.py) | Перенять обязательного владельца функции, проверки иерархии, сторон и доказательств. UUID-правила применять только через явный адаптер, не менять ID уже сохранённого run |
| P1 | Отдельное сопоставление структуры и `parent_unit_id` | [agent/structure.py](../../backend/app/agent/structure.py), [schemas/runs.py](../../backend/app/schemas/runs.py) | Lab `Unit` сейчас не содержит parent_unit_id, а `AgentResult` не хранит отдельные structure changes. Это реальный функциональный пробел лаборатории по вкладке «Структура» |
| P1 | Прозрачные DTO, enum и состояния | [schemas/common.py](../../backend/app/schemas/common.py), [schemas/findings.py](../../backend/app/schemas/findings.py), [schemas/runs.py](../../backend/app/schemas/runs.py) | Будущий адаптер результата lab должен целиться в эти контракты; расширять frontend под лабораторные dict-ответы не следует |
| P1 | Синтетический manifest и точечные проверки DOCX | [fixtures/synthetic](../../backend/fixtures/synthetic), [tests/test_parsers.py](../../backend/tests/test_parsers.py) | Сравнивать ожидаемые связи и ложные срабатывания на едином корпусе. Не считать читаемость fixture доказательством качества модели |
| P1 | Версионирование перевода и отчёта при человеческой проверке | [services/translations.py](../../backend/app/services/translations.py), [services/reports.py](../../backend/app/services/reports.py) | Backend повторно сверяет review_revision после ответа модели и возвращает 409 при изменении. Сохранить этот инвариант при любом будущем объединении; цитаты и reviewer notes не переводить |

Ещё три небольших полезных решения backend: пагинация `SourceTools` с `offset/has_more` вместо обрезанной выдачи без продолжения; повторная сверка текста/locator/parent context с замороженным реестром в `services/results.py`; включение `modality` в текст для поиска кандидатов. Модульные `ModelClient`, `SourceTools`, extraction/matching/missing удобнее как границы интеграции, чем перенос всего монолитного `_Runner` из lab.

### Парсинг и контрольные примеры

| Направление | Что использовать | Что учитывать |
|---|---|---|
| Backend → lab | Структурированные locator из [parsers/types.py](../../backend/app/parsers/types.py) и форматных адаптеров; точные paragraph/cell/page/offset | Lab locator — строка. Число блоков различается: backend исключает TOC, lab сохраняет его как `kind=toc` и затем пропускает в агенте |
| Backend → lab | Проверки DOCX8/9 и 318 нормализованных пунктов DOCX9↔MD9 в [test_parsers.py](../../backend/tests/test_parsers.py) | Это готовые проверки в remote, не заново выполненные здесь. Пара в lab fixtures до сих пор описывает After MD9; сохранить его как контрольный экспорт, а основной вход согласовать с новым DOCX9 |
| Backend → lab | Manifest с передачей между двумя After-документами и [проверки целостности отчёта](../../backend/tests/test_report_integrity.py) | Добавить сценарий нескольких файлов, проверки точных цитат, HTML escaping, заметок и отклонённых выводов |
| Lab → backend | Ограничения ZIP-элементов/сжатия/XML, PDF-страниц, XLSX-листов/строк/столбцов, числа блоков/символов из [parsers.py](../delphi_lab/parsers.py) | В backend уже есть upload/uncompressed-size лимиты; остальные ограничения переносить адресно, сохранив явные parse gaps |
| Lab → backend | Рекурсивное чтение вложенных DOCX-таблиц, осторожная обработка неоднозначной границы TOC, запрет clause-number splitting для XLSX-строк | Backend сообщает о непрочитанных nested tables. Поддержку можно расширить, но нельзя молча убрать предупреждение без проверки результата |
| Lab → общий корпус | RU/KK/EN, изменение обязательности и self-audit из [lab/fixtures](../fixtures) | Казахские тексты — черновики. Семантические ожидания держать вне промптов; synthetic не смешивать с официальной парой |

Ненумерованные заголовки — отдельный риск обеих реализаций. Lab сохраняет дополнительный heading-контекст, но аудит текущего run заметил устаревшие верхние родительские заголовки. Backend в основном строит связи по нумерации. Нельзя объявить один парсер универсально лучше: сначала согласовать ожидаемую цепочку исполнителя на конкретных блоках. Уже сохранённые источники live run не менять.

## 4. Несовместимости: простое копирование JSON не работает

| Область | Lab сейчас | Remote backend | Решение для будущего адаптера |
|---|---|---|---|
| Хранилище | SQLite, локальный Store, OS-lock | PostgreSQL, транзакции, advisory lock | Никакой подмены БД; изолированный перенос функций/контрактов |
| ID | Строки `doc_…:b00001`, `run_…`, findings с префиксом run | UUID, каноническая форма и ссылки на frozen sources | Явная таблица соответствий, привязанная к версии парсера, хешу документа и точному фрагменту/locator. Одного clause_no недостаточно |
| Старт | `{mode, language, allow_limited}` | `{output_language, allow_partial}` | Преобразовать поля; `preprocess` не выдавать за завершённый backend AI run |
| Parse status | `ok / limited / error` | `pending / parsed / partial / failed` | Явная нормализация, не сравнение строк напрямую |
| Подразделение | `kind=unit`, нет родителя | `kind=department`, есть `parent_unit_id` | `unit→department`; иерархия требует данных, её нельзя восстановить переименованием |
| Finding | `preserved / rephrased / added / unmatched / review` | `retained / reworded / new / potentially_missing / changed`, отдельно `structure_changed` | Первые три допускают словарное отображение; unmatched/review требуют проверки смысла, evidence и полного поиска |
| Issue | `none / conflict / uncertainty / gap` | `null / potential_conflict / insufficient_evidence`, отдельного `gap` нет | `none→null`; отсутствие соответствия определяется совместно с change_type и search |
| Покрытие | `blocks_processed`, `before_functions_compared`, `after_functions_risk_reviewed`, trace и sweeps | `processed_sources`, `compared_before_functions`, `reviewed_after_functions`, typed coverage, finding.search | Маппинг имён допустим лишь при одинаковой семантике множества; TOC и сегментация различаются |
| Стадии | `extract / compare / risks`, финальная `finished`; также `prepared` | `extracting / comparing / checking_risks`, терминальные стадии соответствуют state | Не использовать lab stage как backend enum без адаптации |
| Ошибки/API | Нестандартизированные dict, `{detail}` | `{code, message, details}`, стабильные operation_id | Источник frontend-клиента — backend OpenAPI |

При будущей миграции начинать с отдельной копии/нового запуска. Существующий `run_34…` и его источники должны остаться читаемыми со старыми ID. Прямой импорт его `result.json` в PostgreSQL нарушит ссылки и контракт, даже если поля визуально похожи.

## 5. Практический порядок следующей работы

1. **Контракт:** описать адаптер Source/Function/Finding/Coverage под текущий backend, согласовать нужные расширения с его владельцем. Эта таблица — предложение, не новый публичный API.
2. **Учёт и сохранность платного результата:** адаптировать существующий cost observer в два SDK-входа, затем checkpoints. Это наиболее полезный вклад lab, подтверждённый текущей остановкой по времени.
3. **Смысловая полнота lab:** source-level missing search, сравнение структуры и усиление validators из backend.
4. **Приёмка после отдельного поручения:** подставные SDK-ответы, источники/ID, единый synthetic manifest; затем согласованный короткий live run. Проверять передачу 5.4.4→5.3.3, модальность 9.15, разные scope, missing при неполных данных.
5. **Полная пара:** продолжать сохранённый run только после решения UNKNOWN и с общим бюджетом $10. Частичный lab run не подтверждает готовность backend или frontend.

В рамках этого поручения выполнены Git pull, чтение кода/контрактов, сравнение хешей входов и подготовка Markdown. Реализация, сервисы и платные запросы не запускались; тесты заново не выполнялись.
