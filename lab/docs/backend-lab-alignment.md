# Delphi lab → основной backend: передача

Обновлено 23.09.2026 после 106 offline-тестов lab и preprocess DOCX 8/9.
Backend и frontend в этой работе не читались и не менялись. Требования переноса
основаны на [общей архитектуре](../../docs/architecture.md) и командном handoff;
актуальный целевой код владелец сверяет при переносе. Миграция не выполнена.

## Что готово переносить

| Логика lab | Инвариант |
|---|---|
| Extraction и parent_unit_id | Точные источники, контекст и разные ID одинаковых ролей под разными родителями |
| Structure | Evidence каждого unit, вся иерархия; неизвестная связь не означает ликвидацию |
| Many-to-many comparison | Стороны, область, модальность и источник каждой функции; transfer не равен риску |
| Raw-source sweeps After/Before | Missing/new нельзя объявлять по лексическому поиску или только извлечённым функциям |
| Risk pass | Несколько функций и источников After; кандидатный проход не равен перебору всех пар |
| Validation/checkpoints | Невалидная партия не меняет принятый результат; проверка до сохранения |
| Resume | Extraction сохраняется; при пробелах производные этапы пересчитываются; reviewed run заморожен |
| Translation/report | Сохранённые findings и структура; original quotations/reviewer notes неизменны; revision проверяется при записи |
| Prompt manifest | Версия инструкций фиксируется; несовместимый resume отклоняется, legacy обозначается |
| Tests | Переносить сценарии test_agent_semantics/test_lab_workflow, не статус их успешности на другой runtime |

## Контракт адаптера

| Область | Lab | Целевое правило продукта |
|---|---|---|
| Хранилище | SQLite Store, OS-lock | PostgreSQL, async SQLAlchemy, Alembic; SQLite не становится fallback |
| ID | doc_…:b00001, run_…, fn_… | Явное отображение на UUID, привязанное к run, хешу документа, locator/offset и версии парсера |
| Подразделение | unit/role/group + parent_unit_id | unit → department; родители через таблицу ID, не одно имя |
| Finding | preserved/rephrased/added/unmatched/review | retained/reworded/new/potentially_missing/changed с учётом evidence/search и смысла |
| Issue | none/conflict/uncertainty/gap и другие | none → null, conflict → potential_conflict; неоднозначные типы требуют явного отображения |
| Parse state | ok/limited/error | parsed/partial/failed; предупреждения сохраняются |
| Coverage | raw-source IDs, unprocessed IDs, classified_after, structure coverage | Одинаковая семантика множеств; число блоков разных парсеров не является точностью |
| Старт | mode/language/allow_limited, prepared для preprocess | output_language/allow_partial; prepared не становится completed AI run |
| Стадии | extract/structure/compare/source_search/risks/additions/finished | Явный маппинг к продуктовому enum; partial сохраняет ограничения |
| API | Dict-ответы и detail, отдельный resume | Основной OpenAPI остаётся источником frontend-клиента |

Исторические runs/источники не перезаписывать. Адаптер проверяется на отдельной
копии или новом run. Одного clause_no для сопоставления источников недостаточно.

## Фоновая работа и стоимость

Lab уже регистрирует asyncio-задачи и запускает последовательный агент через
`to_thread`. Есть защита от второго старта/resume, OS-lock, checkpoints и recovery.
Нормальное завершение ждёт текущую задачу; после аварийного завершения работа
помечается interrupted. Это не распределённый worker и не автоматическое платное
возобновление. Перенос должен сохранять транзакции и принятую модель одного
исполнителя основного приложения. Redis/Celery не нужны для текущего MVP.

Стоимость уже считает agent_costs; обычный вход — lab/run.ps1, старый launcher
не применять. Целевой observer должен учитывать каждую SDK-попытку, tool round и
перевод с явным run_id. Usage платного ответа фиксируется до локальной structured-
валидации; ошибка метрик не вызывает новый запрос. Синхронная запись журнала требует
адаптации к async runtime, не второго калькулятора. UNKNOWN остаётся UNKNOWN,
бюджетный hold не является биллингом. Код legacy holds уже есть и проверен, но
исторический run и его журналы не изменялись.

Следующие задачи — в [общем плане](../../docs/implementation-plan.md). Успешные
lab-тесты не подтверждают PostgreSQL/API/UI или качество реальной модели.