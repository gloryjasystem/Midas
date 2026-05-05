# Event Storming — Phase 0.1 (Part 1/3)
# Midas Financial OS | 2026-05-04

---

## 1. РЕКОНЧИЛЯЦИЯ ИСТОЧНИКОВ: Противоречия между ТЗ, Мастер-планом и project_config.md

> Все отклонения зафиксированы. Ни одно требование продукта не перезаписано молча.

### 1.1 КРИТИЧЕСКИЕ ПРОТИВОРЕЧИЯ (требуют решения)

| # | Тема | ТЗ (Midaz_TZ) | Мастер-план v2.0 | project_config.md | Статус |
|---|---|---|---|---|---|
| C-1 | **Язык бэкенда** | Python (FastAPI + aiogram) | Node.js (FastAPI/Rust для микросервисов) | Node.js 24 LTS | ⛔ КОНФЛИКТ — ТЗ явно указывает Python+aiogram, project_config переключил на Node.js без согласования |
| C-2 | **Бот-фреймворк** | aiogram 3.x (Python) | Не указан явно (имплицитно Node.js) | grammY / telegraf / raw webhook | ⛔ КОНФЛИКТ — aiogram = Python-only, несовместим с Node.js стеком |
| C-3 | **Очередь задач** | Celery + Redis | Не указано | Redis (без Celery) | ⛔ КОНФЛИКТ — Celery = Python-only, удалён молча при переходе на Node.js |
| C-4 | **Frontend фреймворк** | React / Vue (оба варианта) | React 18 (Vite) | React 19.x | ⚠️ Vue удалён как опция без согласования |

### 1.2 МИНОРНЫЕ РАСХОЖДЕНИЯ (информационные)

| # | Тема | Источник | Отклонение | Оценка |
|---|---|---|---|---|
| M-1 | React версия | ТЗ: не указана, МП: 18, PC: 19 | Актуализация версии | ✅ Корректно |
| M-2 | Tremor | МП: Tremor UI (npm), PC: Tremor Raw (copy-paste) | Другой подход интеграции | ⚠️ Отметить в ADR |
| M-3 | Claude модели | МП: 3.5 Haiku/3.5 Sonnet/3.7 Opus, PC: 4.5/4.6/4.7 | Актуализация моделей | ✅ Корректно |
| M-4 | Bot API | МП: 9.1 (hideKeyboard), PC: 9.6 | Актуализация API | ✅ Корректно |
| M-5 | Оркестрация low-code | ТЗ: n8n как альтернатива | Не упомянута нигде далее | ⚠️ Опция отброшена молча |

### 1.3 ТРЕБОВАНИЯ ТЗ, ОТСУТСТВУЮЩИЕ В project_config.md

| # | Требование ТЗ | Секция ТЗ | Статус в PC |
|---|---|---|---|
| G-1 | Категория «Серые направления» — красный цвет в UI | §3.1 | ❌ Не упомянуто |
| G-2 | Функция «Люди» — суммарный отчёт расходов по человеку за период | §3.2 | Частично (Fuzzy Matching есть, отчёт по людям — нет) |
| G-3 | Система Loan — статус «частично погашен» и настраиваемые алерты | §3.3 | Частично |
| G-4 | Список slash-команд (/add, /balance, /report, /loan, /alert, /settings, /category) | §4 | ❌ Не зафиксирован |
| G-5 | PDF-отчёт как формат доставки | §7.1 | Упомянут в структуре монорепо, не в правилах |
| G-6 | Дата/время автоотчётов задаётся в Mini App | §7.2 | ❌ Не зафиксировано |
| G-7 | Исторические данные подгружаются при добавлении нового адреса | §5 | ❌ Не упомянуто |
| G-8 | Ответ бота ≤3с, отчёт ≤10с (NFR) | §11 | Есть в §10 PC, но не как «нерушимое правило» |

---

## 2. EVENT CATALOG

### 2.1 Входящие события (External Triggers)

| ID | Событие | Источник | Payload (ключевые поля) |
|---|---|---|---|
| E-IN-01 | `TelegramMessageReceived` | Telegram Webhook | telegram_user_id, text, chat_id, message_id |
| E-IN-02 | `TelegramCommandReceived` | Telegram Webhook | telegram_user_id, command, args |
| E-IN-03 | `MiniAppOpened` | TMA initData | telegram_user_id, startapp_param, initData_hash |
| E-IN-04 | `CryptoWebhookFired` | Blockchain Provider | tx_hash, network_id, from, to, amount, token, block_number |
| E-IN-05 | `GoogleSheetsChanged` | Google Sheets Webhook / Poll | spreadsheet_id, range, changed_cells |
| E-IN-06 | `NotionDatabaseUpdated` | Notion Webhook / Poll | database_id, page_id, changed_properties |
| E-IN-07 | `OAuthCallbackReceived` | Google/Notion OAuth | provider, auth_code, state_token |
| E-IN-08 | `CronTickFired` | Internal Scheduler | job_type, scheduled_at, workspace_id |

### 2.2 Доменные события (Internal Domain Events)

| ID | Событие | Агрегат | Триггер |
|---|---|---|---|
| E-D-01 | `WorkspaceCreated` | Workspace | Первый /start пользователя |
| E-D-02 | `TransactionDraftCreated` | Transaction | Haiku распарсил текст |
| E-D-03 | `TransactionDraftConfirmed` | Transaction | Пользователь нажал [Да] |
| E-D-04 | `TransactionDraftRejected` | Transaction | Пользователь нажал [Изменить] |
| E-D-05 | `TransactionDraftEdited` | Transaction | Пользователь скорректировал данные |
| E-D-06 | `TransactionRecorded` | Transaction | Подтверждение записано в БД |
| E-D-07 | `CryptoTransactionDetected` | Wallet | Новая on-chain транзакция |
| E-D-08 | `CryptoTransactionConfirmed` | Wallet | Достигнута Confirmation Depth |
| E-D-09 | `BlockchainReorgDetected` | Wallet | Orphaned block обнаружен |
| E-D-10 | `TransactionReverted` | Transaction | Rollback из-за Chain Reorg |
| E-D-11 | `CategoryCreated` | Category | Пользователь создал категорию |
| E-D-12 | `CategoryUpdated` | Category | Переименование / смена цвета |
| E-D-13 | `CategoryDeleted` | Category | Удаление категории |
| E-D-14 | `WalletAdded` | Wallet | Добавлен крипто-адрес |
| E-D-15 | `WalletRemoved` | Wallet | Удалён крипто-адрес |
| E-D-16 | `LoanCreated` | Loan | Создан долг (in/out) |
| E-D-17 | `LoanPartiallyRepaid` | Loan | Частичное погашение |
| E-D-18 | `LoanClosed` | Loan | Полное погашение |
| E-D-19 | `PersonLinked` | Person | Расход привязан к человеку |
| E-D-20 | `PersonMerged` | Person | Fuzzy-дубли объединены |
| E-D-21 | `BudgetThresholdExceeded` | Alert | Лимит по категории превышен |
| E-D-22 | `CryptoThresholdExceeded` | Alert | Транзакция выше порога |
| E-D-23 | `LoanReminderTriggered` | Alert | Напоминание о долге |
| E-D-24 | `IntegrationConnected` | Integration | OAuth завершён |
| E-D-25 | `IntegrationDisconnected` | Integration | Пользователь отключил |
| E-D-26 | `TokenRefreshLockAcquired` | Integration | Redlock захвачен |
| E-D-27 | `TokenRefreshed` | Integration | Новый токен получен |
| E-D-28 | `CircuitBreakerTripped` | Integration | API вернул 429 |
| E-D-29 | `CircuitBreakerReset` | Integration | API восстановлен |
| E-D-30 | `ReportGenerated` | Report | Отчёт готов |
| E-D-31 | `ParseFailed` | Transaction | Haiku не смог распарсить текст |
| E-D-32 | `ExchangeRateSnapshotted` | Transaction | Курс зафиксирован |
| E-D-33 | `HistoricalImportStarted` | Wallet | Подгрузка истории нового адреса |
| E-D-34 | `HistoricalImportCompleted` | Wallet | Импорт завершён |

### 2.3 Исходящие события (Side Effects)

| ID | Событие | Получатель | Payload |
|---|---|---|---|
| E-OUT-01 | `TelegramMessageSent` | Telegram | chat_id, text, inline_keyboard |
| E-OUT-02 | `TelegramAlertSent` | Telegram | chat_id, alert_type, message |
| E-OUT-03 | `TelegramReportDelivered` | Telegram | chat_id, report_type, media |
| E-OUT-04 | `NotionReportSynced` | Notion API | page_id, aggregated_data |
| E-OUT-05 | `GoogleSheetUpdated` | Google Sheets API | spreadsheet_id, range, values |
| E-OUT-06 | `PDFGenerated` | Background Worker → Telegram | file_bytes, report_period |
| E-OUT-07 | `InfographicGenerated` | Background Worker → Telegram | image_bytes, chart_type |

---

## 3. COMMAND / EVENT MATRIX

| Команда (Command) | Инициатор | Порождает событие | Агрегат |
|---|---|---|---|
| `InitWorkspace` | System (auto on /start) | WorkspaceCreated | Workspace |
| `ParseFreeText` | E-IN-01 | TransactionDraftCreated OR ParseFailed | Transaction |
| `ConfirmDraft` | User [Да] | TransactionDraftConfirmed → TransactionRecorded | Transaction |
| `RejectDraft` | User [Изменить] | TransactionDraftRejected | Transaction |
| `EditDraft` | User (коррекция) | TransactionDraftEdited | Transaction |
| `CreateCategory` | User (/category, TMA) | CategoryCreated | Category |
| `UpdateCategory` | User (TMA) | CategoryUpdated | Category |
| `DeleteCategory` | User (TMA) | CategoryDeleted | Category |
| `AddWallet` | User (TMA) | WalletAdded → HistoricalImportStarted | Wallet |
| `RemoveWallet` | User (TMA) | WalletRemoved | Wallet |
| `ProcessCryptoWebhook` | E-IN-04 | CryptoTransactionDetected (idempotent) | Wallet |
| `ConfirmCryptoTx` | System (depth reached) | CryptoTransactionConfirmed → TransactionRecorded | Transaction |
| `HandleChainReorg` | E-D-09 | TransactionReverted + TelegramAlertSent | Transaction |
| `CreateLoan` | User (/loan, TMA) | LoanCreated + PersonLinked | Loan |
| `RepayLoan` | User | LoanPartiallyRepaid OR LoanClosed | Loan |
| `LinkPerson` | User (text) | PersonLinked (with Fuzzy Matching) | Person |
| `MergeDuplicatePersons` | System/User | PersonMerged | Person |
| `ConnectIntegration` | User (TMA) | OAuthCallbackReceived → IntegrationConnected | Integration |
| `DisconnectIntegration` | User (TMA) | IntegrationDisconnected | Integration |
| `RefreshOAuthToken` | System (Redlock) | TokenRefreshLockAcquired → TokenRefreshed | Integration |
| `SetAlertThreshold` | User (/alert, TMA) | AlertConfigured | Alert |
| `GenerateReport` | User (/report) OR CronTickFired | ReportGenerated → delivery event | Report |
| `ExportPDF` | User | PDFGenerated → TelegramReportDelivered | Report |
| `SyncToNotion` | User / CRON | NotionReportSynced | Report |
| `SnapshotExchangeRate` | System (at parse time) | ExchangeRateSnapshotted | Transaction |
