# Функциональная карта Lean Center
Дата: 25.11.2026. Статус: проект требований, не реализованные функции. P0 — фундамент/сохранение baseline; P1 — функциональное расширение; P2 — дополнительные возможности.

| ID | Модуль | Источник | Целевая функция | Компонент/данные | Приёмка | Приоритет |
|---|---|---|---|---|---|---|
| CORE-01 | Общее ядро | Frappe / NocoBase / QAtrial | Единые справочники и связи; формы, фильтры, журнал | src/core; org_unit, person, operation | Одна запись сотрудника для всех ролей; история переводов | P0 |
| CORE-02 | Хранение | Skima / Stage43 / RC1 | Локальная БД, переносимые копии, проверяемый импорт | src/storage; meta, change_event, exchange_package | Повторный импорт идемпотентен; конфликт не затирает данные | P0 |
| CORE-03 | Интерфейс | Skima / Poka | Навигация, общий поиск, карточки, фильтры и рабочие пространства | src/shell | Каждый модуль доступен независимо; единая стилистика | P0 |
| DOC-01 | СОП | Stage43 / Dozuki | Редактор, фото, КМ и причины, импорт XLSX, два формата A3, чек-лист | src/modules/sop; document, document_revision, document_step | Регрессии Stage43; предпросмотр не менять без задания | P0 |
| DOC-02 | Документы | QualiSuite / QAtrial | Версии, согласование, действующие документы, архив и сравнение | document_revision, document_approval | Одна действующая версия; неизменность выпущенной редакции | P1 |
| DOC-03 | Документы | Dozuki / QualiSuite | Анализ влияния изменений на TWI, обучение, оценки | document_relation, training_assignment | Не аннулировать компетенции автоматически | P1 |
| FRV-01 | ФРВ | Stage43 | Исследование, замеры, потери, библиотека, Excel, ИИ | frv_study, frv_measurement | Сохранить исходные замеры, независимый запуск | P0 |
| FRV-02 | ФРВ | Poka / ECharts | До/после, тренды и мероприятия | frv_study, action_item | Сопоставимые единицы и контекст; экономия не выдумывается | P1 |
| SK-01 | Компетенции | Skima | Матрица и транспонирование, категории, профили, карточки | skill, role_requirement, assessment_session, assessment_item | Не оценено, неприменимо и ноль различаются | P0 |
| SK-02 | Компетенции | AG5 | Покрытие смен/участков, сроки квалификации, замены | coverage_requirement, person_assignment | Учитывать действующие допуски и требуемый уровень | P1 |
| SK-03 | Компетенции | Skima | История оценок, срезы, тренды, пробелы, критичность | assessment_session, assessment_item | Пороги и веса едины и версионируются | P1 |
| DEV-01 | Развитие | Skima | Индивидуальные планы, цели, мероприятия и доказательства | development_plan, development_goal, action_item | Цель связана с подтверждённым дефицитом | P1 |
| TWI-01 | TWI | Stage43 / Dozuki | Лист разбивки работы, КМ/причины, четыре шага JI, печать | document_revision, document_relation | Ссылка на конкретную версию СОП, сохранять XLSX | P0 |
| TWI-02 | Обучение | Dozuki / Poka | Планы, назначения, наставник, события, практическое подтверждение | training_assignment, training_session, assessment_session | Завершение обучения не равно подтверждению навыка | P1 |
| MENT-01 | Наставничество | Skima / AG5 | Реестр, разрешённые операции, нагрузка, профиль, развитие | mentor_authorization, training_session | Право обучать отдельно от мастерства | P1 |
| AUD-01 | Аудит L1 | RC1 | 20 критериев, версии, 4 шага, журнал, аннулирование | checklist_version, checklist_criterion, audit_session, audit_response | Не менять исторические критерии/оценки | P0 |
| AUD-02 | Аудит L1 | Skima / Ease.io | Матрица наставник×критерий, динамика, план аудита, повторные проверки | schedule_event, audit_session | Сравнивать только совместимые версии; размер выборки | P1 |
| AUD-03 | Аудит L1 | RC1 / Audit Companion | Доказательства, 4 состояния, критичность, полнота наблюдения | audit_response, finding, attachment_link | Ненаблюдавшееся не считать нарушением; критичность отдельно | P1 |
| AUD-04 | Аудит L1 | RC1 | Мобильные формы, перенос, сроки L2/L3 | exchange_package, schedule_event | Идемпотентность; L2/L3 без выдуманных чек-листов | P0 |
| ACT-01 | Мероприятия | Audit Companion / Ease.io | Единый CAPA, ответственные, сроки, верификация эффекта | finding, action_item, action_verification | Выполнено != эффект подтверждён; повтор критического нарушения блокирует подтверждение | P1 |
| CAL-01 | Планирование | Ease.io / Poka | Один календарь обучения, аудитов, оценок, пересмотров и CAPA | schedule_event | Нет двойных записей; локальные уведомления при запуске | P1 |
| BI-01 | Аналитика | Skima / ECharts / Frappe Insights / Metabase | KPI, Парето, радары, тепловые карты, тренды, переход к фактам | src/analytics; SQL views | Пустая выборка не 0%; формулы, знаменатели и версии видимы | P1 |
| AI-01 | ИИ | Stage43 / RC1 / QAtrial | Единый шлюз, специализированные задачи, обезличивание | src/services/ai | Без секретов и ФИО в запросах; только предложения | P2 |
| SEC-01 | Доступ | Frappe / QAtrial / NocoBase | Роли интерфейса и права сетевой папки | person_role, change_event | Локальная роль не является серверной авторизацией | P0 |

## Реестр изученных платформ и границы доказательств
- [Skima](https://github.com/henfrydls/Skima): README, schema.prisma, dashboardLogic.js, skillsLogic.js, EvaluationsTab, development/evolution API проверены. Review/OKR/KPI присутствуют в схеме, полноценный UI не подтверждён. AGPL-3.0; независимая реализация. Не копировать неодинаковые веса частоты и исключение нулей без методики.
- [AG5](https://www.ag5.com/): покрытие навыками, взаимозаменяемость, сроки; коммерческий образец, исходники недоступны.
- [Dozuki](https://www.dozuki.com/): документация, TWI, переобучение; коммерческий образец.
- [Poka](https://www.poka.io/): connected worker, единое пространство; коммерческий образец.
- [Ease.io](https://www.ease.io/): планирование аудитов, контроль; не подменять TWI JI универсальным LPA.
- [Audit Companion](https://github.com/omvnn/audit-companion): README, планы, доказательства, CAPA, аналитика; лицензия не установлена, только концепция.
- [QualiSuite](https://github.com/jrsinc/eQMS): README, версии, обучение, SQLite, SharePoint; лицензия не установлена, только концепция.
- [QAtrial](https://github.com/A78Daydreamer/QAtrial): README, React/Hono/PostgreSQL, связанные документы/обучение/аудиты; AGPL, не копировать код.
- [Frappe](https://github.com/frappe/frappe) (MIT), [NocoBase](https://github.com/nocobase/nocobase) (проверять редакцию/лицензию): справочники, формы, workflow. Серверные runtime не обязательны в нашем центре.
- [Frappe Learning](https://github.com/frappe/lms), [Moodle](https://github.com/moodle/moodle): учебные планы, результаты; не внедрять целиком.
- [Frappe Insights](https://github.com/frappe/insights), [Metabase](https://github.com/metabase/metabase): аналитические разрезы; не внедрять серверный BI.
- [ERPNext](https://github.com/frappe/erpnext), [OCA](https://github.com/OCA/management-system): качество, аудит, несоответствия; концепция.
- [Qualvora](https://github.com/ManishVlogs/qualvora), [LPA System](https://github.com/tomtops43-png/Layered-Process-Audit-System): прототипы LPA, не подтверждена пригодность/лицензия.
- [ECharts](https://github.com/apache/echarts): Apache-2.0, локальная библиотека; версия закрепляется перед интеграцией.
- Stage43 и RC1: точные исходные сборки перенесены в baselines. Реальные данные запрещено переносить в GitHub.

Сторонние приложения не запускались в сравнительном пилоте. Коммерческие функции — ориентиры, а не доказательство полной реализации. Аудит L1 — равноправный модуль; общая архитектура не строится вокруг него.
