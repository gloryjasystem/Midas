# Event Storming — Phase 0.1 (Part 3/3)
# Invariants, Gaps, Risks, Open Questions, ADR Recommendations

---

## 7. ИНВАРИАНТЫ ПО АГРЕГАТАМ

### Workspace
| ID | Инвариант | Источник |
|---|---|---|
| INV-WS-01 | Каждый Workspace имеет ровно одного владельца (telegram_user_id) | ТЗ §9, МП §4 |
| INV-WS-02 | Все дочерние сущности обязаны иметь совпадающий `tenant_id` (RLS) | МП §1, PC §3.1 |
| INV-WS-03 | Default Workspace создаётся автоматически при первом /start | МП §4, PC §4.1 |
| INV-WS-04 | Workspace не может быть удалён если есть активные Loans | ТЗ §3.3 |

### User
| ID | Инвариант | Источник |
|---|---|---|
| INV-US-01 | telegram_user_id уникален глобально | ТЗ §9 |
| INV-US-02 | Пользователь привязан минимум к одному Workspace | МП §4 |
| INV-US-03 | Идентификация — Telegram User ID, без регистрации | ТЗ §9, PC §7.4 |

### Transaction
| ID | Инвариант | Источник |
|---|---|---|
| INV-TX-01 | Обязательные поля: `original_amount`, `currency`, `exchange_rate_at_timestamp` | МП §Этап1, PC §3.3 |
| INV-TX-02 | Транзакция обязана принадлежать валидной категории | ТЗ §3 |
| INV-TX-03 | Крипто-транзакция: UNIQUE(tx_hash, network_id) | МП §Этап2, PC §6.2 |
| INV-TX-04 | Ручная транзакция записывается в БД только после подтверждения пользователем [Да] | МП §4, PC §4.2 |
| INV-TX-05 | exchange_rate фиксируется в момент создания, не пересчитывается | PC §3.3 |
| INV-TX-06 | `original_amount` — тип DECIMAL / NUMERIC, не float | МП §Промпт 1 |

### Category
| ID | Инвариант | Источник |
|---|---|---|
| INV-CT-01 | Имя категории уникально в пределах Workspace | ТЗ §3 |
| INV-CT-02 | Обязательная принадлежность к группе: Бизнес или Жизнь | ТЗ §3.1, §3.2 |
| INV-CT-03 | «Серые направления» — всегда отображается красным цветом (текст + иконка) | ТЗ §3.1 ⚠️ |
| INV-CT-04 | Категория не может быть удалена если есть привязанные транзакции (soft delete или reassign) | Имплицитно |

### Wallet
| ID | Инвариант | Источник |
|---|---|---|
| INV-WL-01 | Максимум 5-7 адресов на Workspace | ТЗ §5 |
| INV-WL-02 | Только read-only подключение (публичный адрес) | ТЗ §5, §9, PC §6.1 |
| INV-WL-03 | Приватные ключи НИКОГДА не хранятся | ТЗ §9, PC §6.1 |
| INV-WL-04 | При добавлении адреса — обязательная загрузка исторических данных | ТЗ §5 ⚠️ |

### Person
| ID | Инвариант | Источник |
|---|---|---|
| INV-PR-01 | Имя уникально в Workspace после Fuzzy Matching | МП §Этап1, PC §4.4 |
| INV-PR-02 | Нельзя удалить Person с активными Loans | ТЗ §3.3 |
| INV-PR-03 | Суммарный отчёт расходов по человеку доступен за любой период | ТЗ §3.2 ⚠️ |

### Loan
| ID | Инвариант | Источник |
|---|---|---|
| INV-LN-01 | Обязательные поля: сумма, валюта, имя (Person), дата, направление (in/out) | ТЗ §3.3 |
| INV-LN-02 | Статусы: `active` → `partially_repaid` → `closed` (однонаправленный переход) | ТЗ §3.3 |
| INV-LN-03 | Нельзя закрыть Loan если outstanding_amount > 0 | Имплицитно |
| INV-LN-04 | Настраиваемые напоминания в Telegram | ТЗ §3.3 |

### Integration
| ID | Инвариант | Источник |
|---|---|---|
| INV-IG-01 | OAuth токены хранятся зашифрованными | ТЗ §9, PC §8 |
| INV-IG-02 | Refresh токена — через Redlock, без race condition | МП §Этап3, PC §5.1 |
| INV-IG-03 | В Notion — только агрегированные данные, не сырые транзакции/адреса | МП §Этап3, PC §8 |
| INV-IG-04 | Circuit Breaker при 429 от внешних API | МП §Этап3, PC §5.2 |

### Alert
| ID | Инвариант | Источник |
|---|---|---|
| INV-AL-01 | Пороговые значения задаются пользователем через /alert или TMA | ТЗ §7.3 |
| INV-AL-02 | Типы: входящая крипто-транзакция, превышение бюджета категории, напоминание Loan | ТЗ §7.3 |

### Report
| ID | Инвариант | Источник |
|---|---|---|
| INV-RP-01 | Форматы: текст в чате, инфографика, TMA-дашборд, PDF, запись в Notion | ТЗ §7.1 |
| INV-RP-02 | Автоотчёты: ежедневный, еженедельный, ежемесячный — периодичность настраивается | ТЗ §7.2 |
| INV-RP-03 | Дата/время автоотчёта задаётся в настройках TMA | ТЗ §7.2 ⚠️ |
| INV-RP-04 | PDF/инфографика — в Worker Threads, не блокировать Event Loop | МП §Этап5, PC §5.3 |

---

## 8. MISSING EVENTS / ENTITIES (Обнаруженные пробелы)

### 8.1 Отсутствующие сущности

| # | Сущность | Обоснование | Приоритет |
|---|---|---|---|
| MISS-E-01 | **ExchangeRate** (справочник курсов) | PC §3.3 требует фиксации курса, но не определён источник API и стратегия кэширования | 🔴 Высокий |
| MISS-E-02 | **AuditLog** | Нет явного audit trail; нужен для Chain Reorg rollbacks, удалений, Fuzzy-merges | 🟡 Средний |
| MISS-E-03 | **CategoryBudget** | ТЗ §7.3: «Превышение бюджета по категории» — но нет сущности для хранения лимитов | 🔴 Высокий |
| MISS-E-04 | **SyncJob** | Отслеживание статуса синхронизации Google Sheets / Notion (in_progress, completed, failed) | 🟡 Средний |
| MISS-E-05 | **NotificationDelivery** | Статус доставки алертов (sent, delivered, failed, retried) | 🟢 Низкий |
| MISS-E-06 | **Currency** (справочник валют) | Поддерживаемые валюты, символы, десятичные знаки | 🟡 Средний |
| MISS-E-07 | **UserPreferences** | Часовой пояс, язык, формат дат — ТЗ §8 (настройки в TMA) | 🟡 Средний |

### 8.2 Отсутствующие события

| # | Событие | Обоснование |
|---|---|---|
| MISS-EV-01 | `BudgetLimitSet` | Нет события для установки/изменения бюджетного лимита по категории |
| MISS-EV-02 | `WebhookValidationFailed` | Обработка невалидных/подписанных вебхуков от блокчейна |
| MISS-EV-03 | `IntegrationSyncFailed` | Google/Notion sync failure → retry / circuit breaker |
| MISS-EV-04 | `IntegrationSyncCompleted` | Успешное завершение синхронизации |
| MISS-EV-05 | `UserPreferencesUpdated` | Изменение часового пояса, языка, формата |
| MISS-EV-06 | `DraftExpired` | TTL draft'а истёк, пользователь не ответил (cleanup) |
| MISS-EV-07 | `HistoricalImportFailed` | Неудача при загрузке исторических данных кошелька |
| MISS-EV-08 | `FuzzyMatchConflict` | Fuzzy Matching нашёл несколько кандидатов, нужен выбор пользователя |

---

## 9. RISK REGISTER

| ID | Риск | Вероятность | Импакт | Митигация | Статус |
|---|---|---|---|---|---|
| R-01 | **Python vs Node.js конфликт** (C-1, C-2, C-3) — фундаментальный стек не согласован | Высокая | 🔴 Critical | Требуется явное решение владельца проекта | ⛔ OPEN |
| R-02 | **Claude API rate limits / costs** — Haiku вызывается на каждое сообщение | Средняя | 🟡 High | Кэширование парсинга, батчинг, fallback на regex для простых случаев | OPEN |
| R-03 | **Exchange Rate API — single point of failure** | Средняя | 🟡 High | Мультипровайдер (CoinGecko + fallback), кэширование на 5 мин | OPEN |
| R-04 | **Blockchain API reliability** — Tronscan/BSCScan/Etherscan могут быть нестабильны | Средняя | 🟡 High | Circuit Breaker + fallback-провайдеры + DLQ | PLANNED |
| R-05 | **Fuzzy Matching false positives** — «Макс» и «Максим» это один человек, но «Максим К.» и «Максим Л.» — разные | Средняя | 🟡 Medium | Human-in-the-Loop при low-confidence match (FuzzyMatchConflict event) | OPEN |
| R-06 | **TMA iOS keyboard bug** — может ухудшать UX на 40%+ iOS-пользователей | Высокая | 🟡 Medium | hideKeyboard (Bot API 9.1+), тестирование на реальных устройствах | PLANNED |
| R-07 | **OAuth token encryption at rest** — если компрометирован сервер, токены утекут | Низкая | 🔴 Critical | AES-256 encryption, отдельный key management | OPEN |
| R-08 | **Draft TTL не определён** — если пользователь не отвечает, draft висит вечно | Средняя | 🟡 Medium | Определить TTL (напр. 24 часа), DraftExpired event | OPEN |
| R-09 | **Celery зависимость** — если стек Node.js, нужна замена (BullMQ?) | Высокая | 🟡 High | Решается вместе с R-01 | ⛔ BLOCKED by R-01 |
| R-10 | **Notion privacy leak** — risk of raw transaction data leaking to Notion | Низкая | 🔴 Critical | Строгий whitelist полей, только агрегированные данные | PLANNED |

---

## 10. OPEN QUESTIONS (Требуют решения владельца)

| # | Вопрос | Контекст | Влияние на |
|---|---|---|---|
| Q-01 | **Python (FastAPI+aiogram) или Node.js?** ТЗ явно указывает Python. Мастер-план переключил на Node.js. Какой стек финальный? | C-1, C-2, C-3, R-01, R-09 | Весь бэкенд, бот-фреймворк, очередь задач |
| Q-02 | **Vue остаётся опцией или только React?** ТЗ указывает React/Vue, project_config зафиксировал только React. | C-4 | Frontend architecture |
| Q-03 | **Один Workspace на пользователя или мульти-workspace?** RLS с tenant_id подразумевает мульти, но ТЗ подразумевает single. | Aggregate Workspace | Архитектура БД, UX |
| Q-04 | **Откуда брать курсы валют?** Нет определённого провайдера API для exchange rates. | MISS-E-01, R-03 | Transaction recording |
| Q-05 | **Какой TTL для TransactionDraft?** Сколько ждать подтверждения от пользователя? | R-08, MISS-EV-06 | Draft lifecycle |
| Q-06 | **Какой Confirmation Depth для каждой сети?** TRC20, BEP20, ERC20 имеют разную скорость блоков. | INV-TX-03, Flow 3 | Blockchain module |
| Q-07 | **Auto-confirm для импорта из Sheets/Notion или всегда Human-in-the-Loop?** | Flow 6, Draft lifecycle 5.3 | UX, data quality |
| Q-08 | **Алгоритм Fuzzy Matching?** Levenshtein, Jaro-Winkler, или phonetic? Какой порог similarity? | INV-PR-01, R-05, MISS-EV-08 | Person deduplication |
| Q-09 | **Нужна ли сущность CategoryBudget?** ТЗ упоминает «превышение бюджета», но нет UI для задания лимитов. | MISS-E-03 | Alert logic |
| Q-10 | **n8n как low-code альтернатива** — ТЗ упоминает, Мастер-план молчит. Отбрасываем? | M-5 | Architecture |

---

## 11. РЕКОМЕНДОВАННЫЕ ADR ДЛЯ PHASE 0.2

> Генерация ADR не начинается до одобрения результатов Event Storming.

| ADR | Заголовок | Приоритет | Зависит от Q# |
|---|---|---|---|
| ADR-001 | Выбор языка бэкенда: Python vs Node.js | 🔴 P0 — блокирует всё | Q-01 |
| ADR-002 | Мультитенантность: Shared DB + RLS vs Separate Schemas | 🔴 P0 | Q-03 |
| ADR-003 | ULID vs UUIDv4 для первичных ключей | 🟡 P1 | — |
| ADR-004 | Redlock vs Mutex vs Advisory Locks для OAuth refresh | 🟡 P1 | — |
| ADR-005 | Chain Reorg: Confirmation Depth + Rollback strategy | 🟡 P1 | Q-06 |
| ADR-006 | Идемпотентность блокчейн-вебхуков: tx_hash + network_id UNIQUE | 🟡 P1 | — |
| ADR-007 | Circuit Breaker + Dead Letter Queue для внешних API | 🟡 P1 | — |
| ADR-008 | Фиксация exchange rate: snapshot vs live conversion | 🟡 P1 | Q-04 |
| ADR-009 | Fuzzy Matching: алгоритм и порог для Person dedup | 🟡 P1 | Q-08 |
| ADR-010 | SecureStorage vs localStorage в TMA | 🟢 P2 | — |
| ADR-011 | Worker Threads vs dedicated microservice для тяжёлых задач | 🟢 P2 | — |
| ADR-012 | TransactionDraft TTL и стратегия cleanup | 🟢 P2 | Q-05 |
| ADR-013 | Tremor Raw vs Tremor npm vs альтернативный UI kit | 🟢 P2 | — |
| ADR-014 | Очередь задач: BullMQ (Node) vs Celery (Python) vs Redis Streams | 🔴 P0 | Q-01 |

---

> **END OF EVENT STORMING DELIVERABLE — PHASE 0.1**
> Статус: WAITING_FOR_USER_REVIEW
> Следующий шаг: Phase 0.2 (ADR) — после одобрения
