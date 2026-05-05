# Event Storming — Phase 0.1 (Part 2/3)
# Aggregate Map, Lifecycle, Event Flows

---

## 4. AGGREGATE MAP

### 4.1 Карта агрегатов и их границы

```
┌─────────────────────────────────────────────────────────┐
│                    WORKSPACE (Root)                      │
│                  tenant_id = ULID                        │
│                                                         │
│  ┌──────────┐  ┌─────────────┐  ┌──────────────────┐   │
│  │   User   │  │  Category   │  │   Integration    │   │
│  │          │  │ (Бизнес/    │  │ (Google/Notion)  │   │
│  │ tg_id    │  │  Жизнь)     │  │ oauth_tokens     │   │
│  └──────────┘  └─────────────┘  │ redlock_key      │   │
│                                  └──────────────────┘   │
│  ┌──────────────────────────────────────────────┐       │
│  │              Transaction                      │       │
│  │  draft_status | original_amount | currency    │       │
│  │  exchange_rate_at_timestamp | category_id     │       │
│  │  person_id | source (manual/crypto/sheets)    │       │
│  └──────────────────────────────────────────────┘       │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │  Wallet  │  │  Person  │  │   Loan   │              │
│  │ address  │  │ name     │  │ amount   │              │
│  │ network  │  │ aliases  │  │ dir(in/  │              │
│  │ readonly │  │ fuzzy_id │  │  out)    │              │
│  └──────────┘  └──────────┘  │ status   │              │
│                               │ person_id│              │
│  ┌──────────┐  ┌──────────┐  └──────────┘              │
│  │  Alert   │  │  Report  │                             │
│  │ type     │  │ type     │                             │
│  │ threshold│  │ period   │                             │
│  │ entity_id│  │ format   │                             │
│  └──────────┘  │ cron     │                             │
│                 └──────────┘                             │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Связи между агрегатами

| Родитель | Дочерний | Тип связи | Кардинальность |
|---|---|---|---|
| Workspace | User | owns | 1 : N (но MVP = 1:1) |
| Workspace | Category | owns | 1 : N |
| Workspace | Transaction | owns | 1 : N |
| Workspace | Wallet | owns | 1 : N (max 5-7) |
| Workspace | Person | owns | 1 : N |
| Workspace | Loan | owns | 1 : N |
| Workspace | Integration | owns | 1 : N |
| Workspace | Alert | owns | 1 : N |
| Workspace | Report | owns | 1 : N |
| Category | Transaction | references | 1 : N |
| Person | Transaction | references | 1 : N (optional) |
| Person | Loan | references | 1 : N |
| Wallet | Transaction | references (source) | 1 : N |

---

## 5. TRANSACTION DRAFT LIFECYCLE (Конечный автомат)

### 5.1 Ручной ввод (свободный текст)

```mermaid
stateDiagram-v2
    [*] --> ParseAttempt : TelegramMessageReceived
    ParseAttempt --> ParseFailed : Haiku не распознал
    ParseAttempt --> PendingConfirmation : TransactionDraftCreated
    
    ParseFailed --> ParseAttempt : Пользователь перефразировал
    ParseFailed --> [*] : Пользователь не отвечает
    
    PendingConfirmation --> Confirmed : [Да] → TransactionDraftConfirmed
    PendingConfirmation --> Editing : [Изменить] → TransactionDraftRejected
    PendingConfirmation --> Expired : Timeout (TTL)
    
    Editing --> PendingConfirmation : TransactionDraftEdited
    Editing --> Discarded : Пользователь отменил
    
    Confirmed --> Recorded : TransactionRecorded (в БД)
    Recorded --> [*]
    Expired --> [*]
    Discarded --> [*]
```

**Состояния:**
| Состояние | Описание | Переходы |
|---|---|---|
| `PARSE_ATTEMPT` | Haiku обрабатывает текст | → PENDING_CONFIRMATION / PARSE_FAILED |
| `PARSE_FAILED` | Не удалось извлечь данные | → PARSE_ATTEMPT (retry) / terminal |
| `PENDING_CONFIRMATION` | Ожидание [Да]/[Изменить] | → CONFIRMED / EDITING / EXPIRED |
| `EDITING` | Пользователь корректирует | → PENDING_CONFIRMATION / DISCARDED |
| `CONFIRMED` | Пользователь подтвердил | → RECORDED |
| `RECORDED` | Записано в БД | terminal |
| `EXPIRED` | Истёк TTL ожидания | terminal |
| `DISCARDED` | Отменено пользователем | terminal |

### 5.2 Крипто-транзакция (Webhook)

```mermaid
stateDiagram-v2
    [*] --> IdempotencyCheck : CryptoWebhookFired
    IdempotencyCheck --> Duplicate : tx_hash+network_id exists
    IdempotencyCheck --> PendingBlockchain : CryptoTransactionDetected
    
    Duplicate --> [*] : Silently ignored
    
    PendingBlockchain --> Confirmed : Confirmation Depth reached
    PendingBlockchain --> Reverted : BlockchainReorgDetected
    
    Confirmed --> Recorded : CryptoTransactionConfirmed → TransactionRecorded
    Reverted --> RolledBack : TransactionReverted + ROLLBACK
    
    Recorded --> Reverted : Late Reorg (rare)
    RolledBack --> [*] : TelegramAlertSent
    Recorded --> [*]
```

**Состояния:**
| Состояние | Описание |
|---|---|
| `IDEMPOTENCY_CHECK` | Проверка UNIQUE(tx_hash, network_id) |
| `PENDING_BLOCKCHAIN` | Ожидание Confirmation Depth |
| `CONFIRMED` | Достаточно подтверждений |
| `RECORDED` | Записано в БД |
| `REVERTED` | Откат из-за Chain Reorg |
| `DUPLICATE` | Дубль вебхука — игнорируется |

### 5.3 Импорт из Google Sheets / Notion

```mermaid
stateDiagram-v2
    [*] --> SyncDetected : GoogleSheetsChanged / NotionDatabaseUpdated
    SyncDetected --> Parsing : Извлечение данных
    Parsing --> PendingConfirmation : TransactionDraftCreated (если требуется подтверждение)
    Parsing --> AutoRecorded : TransactionRecorded (если auto-confirm включён)
    PendingConfirmation --> Confirmed : [Да]
    Confirmed --> Recorded : TransactionRecorded
    AutoRecorded --> [*]
    Recorded --> [*]
```

---

## 6. ШЕСТЬ КЛЮЧЕВЫХ EVENT FLOW ДИАГРАММ

### Flow 1: Первый запуск (Frictionless Onboarding)

```mermaid
sequenceDiagram
    participant U as User
    participant TG as Telegram
    participant Bot as Midas Bot
    participant DB as PostgreSQL (RLS)
    
    U->>TG: /start
    TG->>Bot: TelegramCommandReceived(cmd=/start, tg_id)
    Bot->>Bot: Validate initData crypto-signature
    Bot->>DB: SELECT workspace WHERE owner_tg_id = tg_id
    DB-->>Bot: NULL (first time)
    Bot->>DB: BEGIN; SET LOCAL tenant_id = new_ulid
    Bot->>DB: INSERT workspace (id, owner_tg_id, name='Default')
    Bot->>DB: INSERT default_categories (6 бизнес + 5 жизнь)
    Bot->>DB: COMMIT
    Note over Bot,DB: WorkspaceCreated event emitted
    Bot->>TG: "Привет! Midas готов. Просто пиши свои траты."
    TG->>U: Welcome message + Mini App button
```

### Flow 2: Свободный текст → Парсинг → Подтверждение → Запись

```mermaid
sequenceDiagram
    participant U as User
    participant TG as Telegram
    participant Bot as Midas Bot
    participant AI as Claude Haiku
    participant FX as Exchange Rate API
    participant DB as PostgreSQL

    U->>TG: "потратил 320 евро на аренду офиса"
    TG->>Bot: TelegramMessageReceived
    Bot->>Bot: Resolve workspace_id by tg_id
    Bot->>AI: Parse free text → JSON
    AI-->>Bot: {amount:320, currency:EUR, category:"Аренда", type:expense}
    Bot->>FX: GET rate EUR→USD at now()
    FX-->>Bot: rate=1.08
    Note over Bot: ExchangeRateSnapshotted
    Bot->>Bot: TransactionDraftCreated(status=PENDING_CONFIRMATION)
    Bot->>TG: "Расход: 320€, Категория: Аренда. Верно? [Да][Изменить]"
    TG->>U: Inline keyboard
    U->>TG: [Да]
    TG->>Bot: CallbackQuery → ConfirmDraft
    Bot->>DB: BEGIN; SET LOCAL tenant_id=ws_id
    Bot->>DB: INSERT transaction(amount, currency, rate, category_id)
    Bot->>DB: COMMIT
    Note over Bot,DB: TransactionRecorded
    Bot->>Bot: Check BudgetThresholdExceeded?
    Bot->>TG: "✅ Записано: -320€ Аренда"
```

### Flow 3: Крипто-вебхук → Идемпотентность → Pending → Confirmed

```mermaid
sequenceDiagram
    participant BP as Blockchain Provider
    participant Bot as Midas Bot
    participant DB as PostgreSQL
    participant TG as Telegram

    BP->>Bot: CryptoWebhookFired(tx_hash, network_id, amount, block_n)
    Bot->>DB: SELECT WHERE tx_hash=X AND network_id=Y
    alt Duplicate
        DB-->>Bot: EXISTS
        Bot->>Bot: Silently ignore (idempotent)
    else New
        DB-->>Bot: NULL
        Bot->>DB: INSERT crypto_tx(status=PENDING, confirmation_count=0)
        Note over Bot: CryptoTransactionDetected
        Bot->>TG: "🔄 Обнаружена транзакция: +500 USDT (ожидание подтверждений)"
    end
    
    loop Every poll cycle
        Bot->>BP: Check confirmation count
        BP-->>Bot: current_confirmations
        Bot->>DB: UPDATE confirmation_count
    end
    
    Note over Bot: confirmation_count >= DEPTH_THRESHOLD
    Bot->>DB: UPDATE status=CONFIRMED
    Bot->>DB: INSERT transaction (TransactionRecorded)
    Note over Bot: CryptoTransactionConfirmed
    Bot->>TG: "✅ Подтверждено: +500 USDT (12 подтверждений)"
```

### Flow 4: Chain Reorg → Rollback → Уведомление

```mermaid
sequenceDiagram
    participant BP as Blockchain Provider
    participant Bot as Midas Bot
    participant DB as PostgreSQL
    participant TG as Telegram

    BP->>Bot: WebhookFired(orphaned_block, affected_tx_hashes)
    Note over Bot: BlockchainReorgDetected
    
    loop For each affected tx_hash
        Bot->>DB: SELECT tx WHERE tx_hash=X AND status IN (PENDING, CONFIRMED)
        alt Transaction found
            Bot->>DB: BEGIN
            Bot->>DB: UPDATE crypto_tx SET status=REVERTED
            Bot->>DB: UPDATE transaction SET status=REVERTED (soft delete)
            Bot->>DB: INSERT audit_log(action=REORG_ROLLBACK)
            Bot->>DB: COMMIT
            Note over Bot,DB: TransactionReverted
            Bot->>TG: "⚠️ Реорганизация блокчейна: транзакция {hash} отменена"
        else Not found
            Bot->>Bot: Log warning, skip
        end
    end
```

### Flow 5: OAuth Refresh → Redlock → Token Update

```mermaid
sequenceDiagram
    participant W1 as Worker 1
    participant W2 as Worker 2
    participant Redis as Redis (Redlock)
    participant Google as Google OAuth
    participant DB as PostgreSQL

    W1->>Google: API call with access_token
    Google-->>W1: 401 Unauthorized (token expired)
    
    W1->>Redis: LOCK("oauth:refresh:{integration_id}", TTL=30s)
    Redis-->>W1: OK (lock acquired)
    Note over W1,Redis: TokenRefreshLockAcquired
    
    W2->>Google: API call with access_token
    Google-->>W2: 401 Unauthorized
    W2->>Redis: LOCK("oauth:refresh:{integration_id}", TTL=30s)
    Redis-->>W2: FAIL (lock held by W1)
    W2->>W2: Wait + retry loop
    
    W1->>Google: POST /token (refresh_token)
    Google-->>W1: new_access_token, new_refresh_token
    W1->>DB: UPDATE integration SET tokens=encrypt(new_tokens)
    Note over W1: TokenRefreshed
    W1->>Redis: UNLOCK("oauth:refresh:{integration_id}")
    
    W2->>Redis: LOCK (retry)
    Redis-->>W2: OK
    W2->>DB: SELECT tokens (already refreshed)
    W2->>W2: Use new token, skip refresh
    W2->>Redis: UNLOCK
```

### Flow 6: CRON → Автоотчёт → Telegram / Notion

```mermaid
sequenceDiagram
    participant CRON as Scheduler (CRON)
    participant Worker as Background Worker
    participant DB as PostgreSQL
    participant AI as Claude Haiku
    participant TG as Telegram
    participant Notion as Notion API

    CRON->>Worker: CronTickFired(job=weekly_report, ws_id)
    Worker->>DB: SELECT transactions WHERE workspace_id=ws_id AND period=last_week
    DB-->>Worker: [transactions]
    Worker->>DB: SELECT categories, wallets, loans for ws_id
    Worker->>AI: Generate summary text from aggregated data
    AI-->>Worker: formatted_report_text
    
    alt Report format = text
        Worker->>TG: Send text report
        Note over Worker,TG: TelegramReportDelivered
    else Report format = infographic
        Worker->>Worker: Generate chart (Worker Thread)
        Worker->>TG: Send image
        Note over Worker,TG: InfographicGenerated
    else Report format = PDF
        Worker->>Worker: Generate PDF (Worker Thread!)
        Worker->>TG: Send document
        Note over Worker,TG: PDFGenerated
    end
    
    alt Notion sync enabled
        Worker->>Notion: POST aggregated report (NO raw tx data!)
        Note over Worker,Notion: NotionReportSynced
    end
    
    Note over Worker: ReportGenerated event logged
```
