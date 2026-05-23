# 🚀 Midas Master Specification: Voice UX & Smart Dialogue (Phase 2, Stage 2)

> **Версия:** v4-FINAL · **Дата:** 2026-05-22  
> **Автор:** Архитектурный аудит кодовой базы (7913 строк webhook.route.ts, 650+ строк voice-parse.worker.ts, все сервисы)  
> **Назначение:** Абсолютный источник истины для всех последующих сессий разработки

---

## 1. Архитектурные Открытия и Слепые Зоны (Blindspots)

### 🔴 Blindspot 1: Отсутствие `userId` в `VoiceParseJobPayload`

**Суть проблемы:**

[VoiceParseJobPayload](file:///C:/Users/secvency/Desktop/Midas/midas-monorepo/packages/shared/src/index.ts#L102-L121) содержит `workspaceId` и `telegramUserId`, но **НЕ содержит `userId`** (внутренний ULID пользователя).

При этом все query-функции, которые нам нужны для навигации (`getBalanceData`, `getSettings`, `getWorkspaceAccounts`), требуют **оба** параметра: `(workspaceId, userId)` — потому что они работают через RLS (Row-Level Security) / `withTenantTransaction`.

**Доказательство:**
- [webhook.route.ts L5211–5212](file:///C:/Users/secvency/Desktop/Midas/midas-monorepo/apps/telegram-bot/src/routes/webhook.route.ts#L5211-L5212): `const vResolved = await resolveWorkspace(...)` → `vResolved` содержит `{ workspaceId, userId }`, но payload сохраняет только `workspaceId`.
- [workspace-resolver.ts L30](file:///C:/Users/secvency/Desktop/Midas/midas-monorepo/apps/telegram-bot/src/services/workspace-resolver.ts#L30): `resolveWorkspace()` возвращает `{ userId: string; workspaceId: string }`.

**Решение:** Добавить `userId` в `VoiceParseJobPayload` и передавать при enqueue. Это 2-строчное изменение:

```diff
// packages/shared/src/index.ts — VoiceParseJobPayload
+ /** Internal user ID (ULID) — needed for RLS-protected queries (Phase 2S2) */
+ userId: string;

// webhook.route.ts L5249–5254
  const vPayload: VoiceParseJobPayload = {
    ...
    workspaceId: vWorkspaceId,
+   userId: vResolved.userId,
    ...
  };
```

> [!CAUTION]
> **Без этого фикса voice worker не сможет вызывать `getBalanceData()`, `getSettings()`, и любые RLS-protected queries.** Это блокер Phase 2.

---

### 🔴 Blindspot 2: Коллизия State Machine (Голос vs Redis-состояния)

**Суть проблемы:**

В webhook.route.ts текстовые сообщения проходят через **6 Redis state intercepts** ПЕРЕД NAV_BTN обработчиком ([L5425–L6450](file:///C:/Users/secvency/Desktop/Midas/midas-monorepo/apps/telegram-bot/src/routes/webhook.route.ts#L5425-L6450)):

| Redis-ключ | Состояние | Что перехватывает |
|---|---|---|
| `bl:state:{uid}:{cid}` | Balance action (rename/set_balance/currency) | Следующий текст = ввод нового названия/суммы |
| `midas:tz_srch:{uid}:{cid}` | Timezone search | Следующий текст = запрос города |
| `midas:clar:{uid}:{cid}` | Clarification mode | Следующий текст = ответ на вопрос бота |
| `midas:edit:{uid}:{cid}` | TX edit amount | Следующий текст = новая сумма |
| `midas:ac:{uid}:{cid}` | Account onboarding | Следующий текст = название банка/кошелька |
| `midas:cur_srch:{uid}:{cid}` | Currency search | Следующий текст = поиск валюты |

**Проблема:** Voice worker **обходит** webhook полностью → НЕ проверяет эти состояния → может показать карточку баланса **в момент, когда пользователь находится посередине онбординга счёта** (набирает название банка).

**Пример сценария:**
```
1. Пользователь нажимает «💳 Банковская карта» → бот ждёт название банка
2. Redis: midas:ac:{uid}:{cid} = { step: 'name', type: 'card' }
3. Пользователь отправляет ГОЛОСОВОЕ: «покажи баланс»
4. Voice worker: detectCommand() → 'balance' → показывает баланс
5. НО! Пользователь всё ещё в account onboarding state → конфликт!
```

**Решение:** Voice worker ОБЯЗАН проверять Redis-состояния перед выполнением навигационной команды:

```typescript
// voice-parse.worker.ts — after detectCommand() HIT
const stateKeys = [
  `bl:state:${telegramUserId}:${chatId}`,
  `midas:ac:${telegramUserId}:${chatId}`,
  `midas:clar:${telegramUserId}:${chatId}`,
  `midas:edit:${telegramUserId}:${chatId}`,
  `midas:tz_srch:${telegramUserId}:${chatId}`,
];
const states = await redis.mget(...stateKeys);
const hasActiveState = states.some(s => s !== null);

if (hasActiveState) {
  // Пользователь в mid-flow → treat voice as AI parse (not a command)
  // Enqueue to ai-parse as usual
}
```

> [!IMPORTANT]
> Эту проверку невозможно вынести в `detectCommand()` — она требует async Redis-запрос. Она должна жить в voice worker, ПОСЛЕ `detectCommand()` match и ПЕРЕД `buildCommandResponse()`.

---

### 🟡 Blindspot 3: Voice Flood → Race Condition

**Суть проблемы:**

Пользователь отправляет 3 голосовых сообщения за 2 секунды. Каждое создаёт BullMQ job с уникальным `jobId` (idempotency key = `voice|bot|{botId}|chat|{chatId}|msg|{messageId}` — у каждого сообщения свой `messageId`).

Результат: 3 параллельных job'а, каждый может обнаружить команду «баланс» и послать 3 карточки баланса в чат.

**Текущая защита:** BullMQ concurrency:3 для voice-parse → все 3 job'а выполнятся параллельно. Нет dedup на уровне команд.

**Решение:** Навигационный debounce через Redis с TTL 2 секунды:

```typescript
const navDedup = `midas:nav:dedup:${telegramUserId}:${chatId}`;
const wasSet = await redis.set(navDedup, '1', 'EX', 2, 'NX'); // SET only if NOT exists
if (!wasSet) {
  // Another voice job already handled a nav command <2s ago
  // Delete the status message and return silently
  void deleteMessage(chatId, statusMessageId);
  return;
}
```

> [!NOTE]
> Этот debounce применяется ТОЛЬКО к навигационным командам (balance, settings, etc.). Транзакционные голосовые сообщения (ai-parse) обрабатываются без dedup — каждое сообщение может быть отдельной транзакцией.

---

### 🟡 Blindspot 4: Cross-App Import Boundary (Worker → Telegram-bot services)

**Суть проблемы:**

Voice worker живёт в `apps/background-workers/`. Функции `getBalanceData()`, `formatSettingsMenuText()`, `buildBalanceListKeyboard()` живут в `apps/telegram-bot/src/services/`. Прямой импорт между apps нарушает monorepo boundaries.

**Решение — разделение на 2 слоя:**

| Слой | Где живёт | Что содержит | Кто импортирует |
|---|---|---|---|
| **Data layer** | `@midas/database` или inline SQL в worker | Чистые SQL-запросы, возвращают raw data | Worker + telegram-bot |
| **UI layer** | `apps/telegram-bot/src/services/` | `buildBalanceListKeyboard()`, `formatSettingsMenuText()` | Только telegram-bot |

**Для voice worker** мы НЕ строим полные inline keyboards (это telegram-bot). Вместо этого:

1. Worker вызывает `getBalanceData()` (SQL) → получает raw data
2. Worker форматирует **текст** (простая строка, не сложный UI)
3. Worker отправляет через `editMessageText()` / `sendMessage()` напрямую
4. Для клавиатур: **worker re-uses** уже существующие keyboard builder functions

**Прагматичный подход для Phase 2S2:**

Мы НЕ переносим query functions в `@midas/database` (это масштабный рефакторинг). Вместо этого:

> Voice worker при обнаружении навигационной команды **записывает её в Redis** как «pending nav command». Webhook route обрабатывает её в следующем цикле:

**НО**: Это добавляет latency (ждать следующий webhook hit → может не прийти).

**Финальное решение (самое простое и рабочее):**

Voice worker **дублирует минимальные SQL-запросы** для навигации. Это DRY violation, но:
- Это 3 простых SQL-запроса (balance, settings, accounts)
- Они стабильные — не менялись 40+ фаз
- Альтернатива (перенос в @midas/database) — рефакторинг на 4+ часа ради 3 функций

> [!IMPORTANT]
> **Компромисс принят:** для Phase 2S2 worker содержит inline SQL для nav commands. На Phase 3 запланирован рефакторинг в `@midas/database/queries/`.

---

## 2. Глобальная Архитектура (System Design)

### 2.1 Жизненный цикл текстового сообщения (ТЕКУЩИЙ + НОВЫЙ)

```
User → Telegram → webhook.route.ts
  │
  ├─ [L5183] Voice? → enqueue voice-parse → EXIT
  │
  ├─ [L5316] parseCommandToken() → slash command?
  │    ├─ /start, /help, /balance, /report ... → handle directly → EXIT
  │    └─ unknown slash → block → EXIT
  │
  ├─ [L5320] tryDeleteUserMessage()
  │
  ├─ [L5325] ★ NEW: detectCommand(navText)  ← FREE-TEXT ROUTER
  │    ├─ HIT → buildCommandResponse() → sendNavMessage() → EXIT
  │    └─ MISS → fall through ↓
  │
  ├─ [L5330–5422] NAV_BTN handlers (Reply Keyboard buttons)
  │    ├─ "📊 Баланс" → getBalanceData() → sendNavMessage() → EXIT
  │    ├─ "📋 Отчёт" → period picker → EXIT
  │    ├─ "📋 Транзакции" → TX Hub → EXIT
  │    └─ "⚙️ Настройки" → settings menu → EXIT
  │
  ├─ [L5425–5500] Redis state intercepts (bl:state, midas:ac)
  │    ├─ Active state → handle state input → EXIT
  │    └─ No state → fall through ↓
  │
  ├─ [L6130] Unknown slash command guard → EXIT
  │
  ├─ [L6143–6450] More Redis intercepts (tz_srch, clar, edit)
  │
  └─ [L6500+] AI Parse → enqueue to BullMQ → EXIT
```

> [!WARNING]
> **Позиция detectCommand():** ПОСЛЕ `tryDeleteUserMessage()` и ПОСЛЕ `parseCommandToken()` (слеш-команды имеют приоритет), но **ПЕРЕД** NAV_BTN handlers и **ПЕРЕД** Redis state intercepts.
>
> **Почему перед Redis intercepts?** Если пользователь в timezone search и набирает «баланс», мы хотим показать баланс, а НЕ искать timezone «баланс». Команда всегда побеждает state.
>
> **Исключение:** если `detectCommand()` вернул match, но текст содержит число и команда имеет `checkNumber: true` → пропускаем → AI parse → транзакция.

### 2.2 Жизненный цикл голосового сообщения (ОБНОВЛЁННЫЙ)

```
User → Telegram (voice) → webhook.route.ts
  │
  ├─ [L5183] message.voice → resolveWorkspace()
  │    → sendMessage("⏳ Распознаю...")
  │    → deleteMessage(user's voice msg)
  │    → enqueue VoiceParseJob (теперь с userId!)
  │
  └─ voice-parse.worker.ts
       │
       ├─ getTelegramFilePath() → downloadTelegramFile()
       ├─ transcribeVoice(buffer, 'ru') [xAI Grok STT]
       ├─ normalizeSttTranscript()
       │
       ├─ detectCommand(transcript)
       │    ├─ HIT:
       │    │    ├─ Redis state check (midas:ac, midas:clar, etc.)
       │    │    │    ├─ Active state → treat as AI parse → MISS path
       │    │    │    └─ No state → continue ↓
       │    │    ├─ Nav dedup check (midas:nav:dedup)
       │    │    │    ├─ Duplicate → delete status msg → EXIT
       │    │    │    └─ Not duplicate → continue ↓
       │    │    ├─ buildCommandResponse(cmd, ctx)
       │    │    │    → SQL queries (balance/settings/etc.)
       │    │    │    → Format text + keyboard
       │    │    ├─ editMessageText(statusMsgId → nav card)
       │    │    ├─ setNavMessageId() via Redis
       │    │    └─ EXIT
       │    │
       │    └─ MISS:
       │         ├─ enqueue to ai-parse queue
       │         └─ EXIT (status msg updated by ai-parse worker)
       │
       └─ Error handling → "😕 Не смог разобрать"
```

### 2.3 Dual Redis Pointer System (без изменений)

```
midas:am:{uid}:{cid}  → Active Message (drafts, pickers, confirmations)
                         Managed by upsertBotMessage()
                         NEVER touched by nav commands

midas:nav:{uid}:{cid} → Nav Message (balance, settings, reports, export)
                         Managed by sendNavMessage()
                         NEVER touches midas:am:
                         
Гарантия: нажатие «Баланс» НИКОГДА не перезапишет
          карточку подтверждённой транзакции с кнопкой «✏️ Изменить».
```

---

## 3. Фазы разработки (Strict Step-by-Step Execution)

---

### 🔧 Phase 0: Подготовка инфраструктуры

#### Phase 0.1 — Создание Command Router

**Задача:** Создать `detectCommand()` — лёгкий regex-движок без DB/Redis зависимостей.

**Изменяемые файлы:**
- **[NEW]** `packages/shared/src/command-router.ts`
- **[MODIFY]** [packages/shared/src/index.ts](file:///C:/Users/secvency/Desktop/Midas/midas-monorepo/packages/shared/src/index.ts) — re-export

**Логика внедрения:**

```typescript
// packages/shared/src/command-router.ts

export type NavCommand =
  | 'balance' | 'settings' | 'export' | 'add_account'
  | 'help' | 'report' | 'transactions' | 'cancel_last';

interface CommandPattern {
  cmd: NavCommand;
  patterns: RegExp[];
  /** If true, presence of a digit in text disqualifies this match → AI parse */
  checkNumber: boolean;
}

const COMMAND_PATTERNS: CommandPattern[] = [
  {
    cmd: 'balance',
    patterns: [/\bбаланс\b/i, /\bсколько денег\b/i, /\bмой баланс\b/i, /\bпортфель\b/i],
    checkNumber: true,  // "баланс 500" → AI parse
  },
  {
    cmd: 'report',
    patterns: [/\bотч[её]т\b/i, /\bстатистик/i, /\bаналитик/i],
    checkNumber: true,  // "расходы 1000" → AI parse
  },
  {
    cmd: 'settings',
    patterns: [/\bнастройк/i, /\bопции\b/i],
    checkNumber: false,
  },
  {
    cmd: 'export',
    patterns: [/\bэкспорт/i, /\bвыгруз/i, /\bскинь\b.*\bэксел/i, /\bскачай\b/i, /\bэкспортируй/i],
    checkNumber: false,
  },
  {
    cmd: 'add_account',
    patterns: [/\bдобав\w*\s+сч[её]т/i, /\bнов\w+\s+сч[её]т/i, /\bсоздай\s+сч[её]т/i],
    checkNumber: false,
  },
  {
    cmd: 'help',
    patterns: [/\bпомощь\b/i, /\bсправк/i, /\bчто ты умеешь/i, /\bкак пользоваться/i],
    checkNumber: false,
  },
  {
    cmd: 'transactions',
    patterns: [/\bтранзакци/i, /\bистори[яю]\b/i, /\bоперации\b/i],
    checkNumber: false,
  },
  {
    cmd: 'cancel_last',
    patterns: [/\bотмени\b.*\bпоследн/i, /\bудали\b.*\bпоследн/i],
    checkNumber: false,
  },
];

const HAS_DIGIT = /\d/;

export function detectCommand(text: string): NavCommand | null {
  const normalized = text.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 200) return null;

  for (const { cmd, patterns, checkNumber } of COMMAND_PATTERNS) {
    for (const re of patterns) {
      if (re.test(normalized)) {
        if (checkNumber && HAS_DIGIT.test(normalized)) {
          return null; // "баланс 500" → not a command
        }
        return cmd;
      }
    }
  }
  return null;
}
```

**Gate (Врата проверки):**
- [ ] `tsc --noEmit` — 0 errors в @midas/shared
- [ ] Unit-тест (inline или console): `detectCommand('баланс')` → `'balance'`
- [ ] `detectCommand('баланс 500')` → `null` (число → AI parse)
- [ ] `detectCommand('расходы')` → `'report'`
- [ ] `detectCommand('расходы 1000 руб')` → `null`
- [ ] `detectCommand('скинь Excel')` → `'export'`
- [ ] `detectCommand('кофе 300')` → `null` (нет match)
- [ ] `detectCommand('добавь счёт')` → `'add_account'`
- [ ] `detectCommand('отмени последнюю')` → `'cancel_last'`
- [ ] `detectCommand('')` → `null`
- [ ] Re-export из `packages/shared/src/index.ts` работает

---

#### Phase 0.2 — Добавить `userId` в VoiceParseJobPayload

**Задача:** Исправить Blindspot 1 — добавить `userId` в payload голосовых job'ов.

**Изменяемые файлы:**
- **[MODIFY]** [packages/shared/src/index.ts](file:///C:/Users/secvency/Desktop/Midas/midas-monorepo/packages/shared/src/index.ts#L102-L121) — тип VoiceParseJobPayload
- **[MODIFY]** [webhook.route.ts L5249](file:///C:/Users/secvency/Desktop/Midas/midas-monorepo/apps/telegram-bot/src/routes/webhook.route.ts#L5249-L5258) — добавить userId в payload
- **[MODIFY]** [voice-parse.worker.ts L511](file:///C:/Users/secvency/Desktop/Midas/midas-monorepo/apps/background-workers/src/workers/voice-parse.worker.ts#L511) — destructure userId из payload

**Логика внедрения:**

```diff
// packages/shared/src/index.ts
export interface VoiceParseJobPayload {
  botId: string;
  chatId: string;
  messageId: string;
  telegramUserId: string;
  workspaceId: string;
+ /** Internal user ID (ULID) — Phase 2S2: needed for RLS queries in command executor */
+ userId: string;
  fileId: string;
  duration: number;
  statusMessageId: string;
  receivedAt: string;
}

// webhook.route.ts L5249+
  const vPayload: VoiceParseJobPayload = {
    botId: BOT_ID,
    chatId: vChatId,
    ...
    workspaceId: vWorkspaceId,
+   userId: vResolved.userId,
    ...
  };
  
// voice-parse.worker.ts L511
- const { botId, chatId, messageId, telegramUserId, workspaceId, fileId, duration, statusMessageId } = job.data;
+ const { botId, chatId, messageId, telegramUserId, workspaceId, userId, fileId, duration, statusMessageId } = job.data;
```

**Gate:**
- [ ] `tsc --noEmit` — 0 errors в ВСЕХ пакетах
- [ ] `VoiceParseJobPayload` содержит поле `userId: string`
- [ ] webhook.route.ts передаёт `vResolved.userId` в payload
- [ ] voice-parse.worker.ts деструктуризирует `userId`

---

#### Phase 0.3 — Добавить кнопку «✖️ Отмена» в Account Type Picker

**Задача:** Исправить UX-долг — пользователь не может выйти из picker'а типа счёта.

**Изменяемые файлы:**
- **[MODIFY]** [account-onboard-keyboard.service.ts L955–968](file:///C:/Users/secvency/Desktop/Midas/midas-monorepo/apps/telegram-bot/src/services/account-onboard-keyboard.service.ts#L955-L968) — `buildStartOnboardKeyboard()`

**Логика внедрения:**

```diff
export function buildStartOnboardKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '💳 Банковская карта', callback_data: 'ac:type:card' },
        { text: '💵 Наличные',         callback_data: 'ac:type:cash' },
      ],
      [
        { text: '🔄 Крипто-биржа',  callback_data: 'ac:type:exchange' },
        { text: '🔐 Кошелёк',       callback_data: 'ac:type:wallet' },
      ],
      [{ text: '✏️ Своё название', callback_data: 'ac:type:custom' }],
+     [{ text: '✖️ Отмена', callback_data: 'ac:fin' }],
    ],
  };
}
```

> [!NOTE]
> `ac:fin` уже обрабатывается в webhook.route.ts как dismiss (Phase 2.3). Новая кнопка просто даёт доступ к уже работающему handler'у.

**Gate:**
- [ ] `tsc --noEmit` — 0 errors
- [ ] Проверка: `/add_account` → picker показывает 6-ю строку `[✖️ Отмена]`
- [ ] Нажатие «Отмена» → picker закрывается, сообщение удаляется

---

### ⚡ Phase 1: Core Fast Router (Текстовые команды)

#### Phase 1.1 — Создание Command Executor Service

**Задача:** Унифицированная функция `buildCommandResponse()` — единая точка правды для всех навигационных экранов.

**Изменяемые файлы:**
- **[NEW]** `apps/telegram-bot/src/services/command-executor.service.ts`

**Логика внедрения:**

```typescript
// apps/telegram-bot/src/services/command-executor.service.ts

import type { InlineKeyboardMarkup } from './telegram-api.js';
import type { NavCommand } from '@midas/shared';
import { getBalanceData } from './balance.service.js';
import { buildBalanceListKeyboard, type BalanceAccountRow } from './balance-keyboard.service.js';
import { formatSettingsMenuText, buildSettingsMainKeyboard } from './settings-keyboard.service.js';
import { buildStartOnboardKeyboard } from './account-onboard-keyboard.service.js';
import { getSettings } from './settings.service.js';

export interface CommandContext {
  telegramUserId: string;
  chatId: string;
  workspaceId: string;
  userId: string;
}

export interface CommandResponse {
  text: string;
  keyboard?: InlineKeyboardMarkup;
}

const EXPORT_STEP1_TEXT = '📤 <b>Экспорт данных</b>\n\nШаг 1 из 3 — выберите <b>период</b>:';
const EXPORT_STEP1_KB: InlineKeyboardMarkup = {
  inline_keyboard: [
    [
      { text: '📅 Этот месяц',    callback_data: 'st:exp:p:tm' },
      { text: '📅 Прошлый месяц', callback_data: 'st:exp:p:lm' },
    ],
    [
      { text: '📅 3 месяца',      callback_data: 'st:exp:p:3m' },
      { text: '📅 Весь период',    callback_data: 'st:exp:p:yr' },
    ],
    [{ text: '← Назад', callback_data: 'st:back' }],
  ],
};

export async function buildCommandResponse(
  cmd: NavCommand,
  ctx: CommandContext,
): Promise<CommandResponse> {
  switch (cmd) {
    case 'balance': {
      const { text, accounts } = await getBalanceData(ctx.workspaceId, ctx.userId);
      return { text, keyboard: buildBalanceListKeyboard(accounts as BalanceAccountRow[]) };
    }
    case 'settings': {
      const settings = await getSettings(ctx.workspaceId, ctx.userId);
      return {
        text: formatSettingsMenuText(
          settings?.default_currency ?? 'USDT',
          settings?.timezone ?? 'UTC',
          settings?.main_account_name ?? null,
        ),
        keyboard: buildSettingsMainKeyboard(),
      };
    }
    case 'export':
      return { text: EXPORT_STEP1_TEXT, keyboard: EXPORT_STEP1_KB };
    case 'add_account':
      return {
        text: '➕ <b>Новый счёт</b>\n\nВыберите тип счёта:',
        keyboard: buildStartOnboardKeyboard(),
      };
    case 'help':
      return { text: HELP_TEXT };  // existing constant from webhook.route.ts
    case 'report': {
      const { buildPeriodPickerKeyboard } = await import('./report-keyboard.service.js');
      return { text: '📊 <b>Отчёты</b>\n\nВыбери период:', keyboard: buildPeriodPickerKeyboard() };
    }
    case 'transactions':
      // Transactions require complex query + pagination → delegate to inline handler
      return { text: '__DELEGATE_TX__' }; // sentinel — webhook handles inline
    case 'cancel_last':
      return { text: '__DELEGATE_CANCEL__' }; // sentinel — Phase 3
  }
}
```

> [!IMPORTANT]
> `transactions` и `cancel_last` возвращают sentinel-значения, потому что их логика слишком сложна для простой функции (пагинация, confirm cards). Webhook route проверяет sentinel и делегирует в inline handler.

**Gate:**
- [ ] `tsc --noEmit` — 0 errors
- [ ] Функция компилируется, типы корректны
- [ ] `buildCommandResponse('balance', ctx)` возвращает `{ text, keyboard }` 
- [ ] `buildCommandResponse('export', ctx)` возвращает hardcoded Step 1

---

#### Phase 1.2 — Интеграция detectCommand() в webhook.route.ts

**Задача:** Вставить free-text router МЕЖДУ `tryDeleteUserMessage()` и NAV_BTN handlers.

**Изменяемые файлы:**
- **[MODIFY]** [webhook.route.ts L5322–5325](file:///C:/Users/secvency/Desktop/Midas/midas-monorepo/apps/telegram-bot/src/routes/webhook.route.ts#L5322-L5325) — insert point

**Логика внедрения:**

Вставка **ПОСЛЕ** L5320 (`tryDeleteUserMessage`), **ПЕРЕД** L5322 (NAV_BTN):

```typescript
// === Phase 2S2: Free-text command router ===
// Intercepts "баланс", "настройки", "экспорт" etc. BEFORE NAV_BTN handlers.
// NAV_BTN handlers remain as fallback for exact emoji-button text.
if (!commandToken) {  // Skip if it's a slash command
  const navCmd = detectCommand(navText);
  if (navCmd) {
    try {
      const resolved = await resolveWorkspace(telegramUserId, chatId);
      const ctx: CommandContext = {
        telegramUserId, chatId,
        workspaceId: resolved.workspaceId,
        userId: resolved.userId,
      };

      // Handle sentinel values (complex commands)
      if (navCmd === 'transactions') {
        // Delegate to existing NAV_BTN_TRANSACTIONS handler below
        // (fall through — NAV_BTN handler will catch exact text or we duplicate here)
      } else if (navCmd === 'cancel_last') {
        // Phase 3 — not yet implemented, fall through to AI parse
      } else {
        // Clear old nav message (same logic as NAV_BTN handlers L5327–5339)
        const oldNavId = await getNavMessageId(telegramUserId, chatId);
        if (oldNavId) {
          void deleteMessage(chatId, oldNavId);
          void clearNavMessageId(telegramUserId, chatId);
        }

        const response = await buildCommandResponse(navCmd, ctx);
        void sendNavMessage(telegramUserId, chatId, response.text, response.keyboard);
        
        // Clear export Redis state (same as export entry in settings callback)
        if (navCmd === 'export') {
          void redisConnection.del(`midas:exp:params:${telegramUserId}:${chatId}`);
        }

        request.log.info({ msg: '[midas:bot:webhook] nav:command-router', telegramUserId, cmd: navCmd });
        await reply.status(200).send({ ok: true });
        return;
      }
    } catch (err: unknown) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      request.log.error({ msg: '[midas:bot:webhook] command-router failed', telegramUserId, errorClass });
      // Fall through to existing handlers — graceful degradation
    }
  }
}
```

**Gate:**
- [ ] `tsc --noEmit` — 0 errors
- [ ] Текст «баланс» → Balance card (sendNavMessage)
- [ ] Текст «настройки» → Settings card
- [ ] Текст «экспорт» → Export Step 1 wizard
- [ ] Текст «добавь счёт» → Account Type Picker + ✖️ Отмена
- [ ] Текст «📊 Баланс» (Reply Keyboard) → Balance card (через NAV_BTN fallback ИЛИ detectCommand)
- [ ] Текст «баланс 500» → AI parse (НЕ навигация)
- [ ] Текст «кофе 300» → AI parse (НЕ команда)
- [ ] Slash command `/balance` → existing handler (не detectCommand)
- [ ] Проверить: export wizard callback buttons (`st:exp:p:tm` etc.) → работают как раньше

---

### 🎙 Phase 2: Voice Execution (Прямое исполнение команд)

#### Phase 2.1 — Рефакторинг voice command handler

**Задача:** Заменить «Нажми кнопку» на прямое отображение экрана.

**Изменяемые файлы:**
- **[MODIFY]** [voice-parse.worker.ts L590–640](file:///C:/Users/secvency/Desktop/Midas/midas-monorepo/apps/background-workers/src/workers/voice-parse.worker.ts#L590-L640) — voice command handler

**Логика внедрения:**

```typescript
// voice-parse.worker.ts — replace existing detectVoiceCommand block

import { detectCommand } from '@midas/shared';

// ... after normalizeSttTranscript() ...

const navCmd = detectCommand(normalizedTranscript);
if (navCmd) {
  // === Blindspot 2: Check Redis state machine ===
  const stateKeys = [
    `bl:state:${telegramUserId}:${chatId}`,
    `midas:ac:${telegramUserId}:${chatId}`,
    `midas:clar:${telegramUserId}:${chatId}`,
    `midas:edit:${telegramUserId}:${chatId}`,
    `midas:tz_srch:${telegramUserId}:${chatId}`,
  ];
  const states = await redisConnection.mget(...stateKeys);
  const hasActiveState = states.some(s => s !== null);

  if (!hasActiveState) {
    // === Blindspot 3: Nav dedup ===
    const navDedup = `midas:nav:dedup:${telegramUserId}:${chatId}`;
    const wasSet = await redisConnection.set(navDedup, '1', 'EX', 2, 'NX');
    
    if (wasSet) {
      try {
        // Build response using inline SQL queries (Blindspot 4: no cross-app import)
        const response = await buildVoiceNavResponse(navCmd, workspaceId, userId);
        
        if (response) {
          // Replace "⏳ Распознаю..." with the actual screen
          if (response.keyboard) {
            await editMessageText(chatId, statusMessageId, response.text, response.keyboard);
          } else {
            await editMessageText(chatId, statusMessageId, response.text);
          }
          
          // Track as nav message (via Redis — worker has access)
          await redisConnection.set(
            `midas:nav:${telegramUserId}:${chatId}`,
            statusMessageId, 'EX', 86400,
          );
          
          logger.info({ msg: '[midas:voice] nav command executed', jobId: job.id, cmd: navCmd });
          return; // Done — no AI parse needed
        }
      } catch (err) {
        logger.error({ msg: '[midas:voice] nav command failed, falling back to AI parse', cmd: navCmd });
        // Fall through to AI parse
      }
    } else {
      // Duplicate nav command — just delete status message
      void deleteMessage(chatId, statusMessageId);
      return;
    }
  }
  // If hasActiveState — fall through to AI parse below
}

// ... existing AI parse enqueue ...
```

**Функция `buildVoiceNavResponse()` (inline в worker):**

```typescript
async function buildVoiceNavResponse(
  cmd: NavCommand,
  workspaceId: string,
  userId: string,
): Promise<{ text: string; keyboard?: InlineKeyboardMarkup } | null> {
  switch (cmd) {
    case 'balance': {
      // Inline SQL — mirrors getBalanceData() from balance.service.ts
      const data = await getBalanceDataDirect(workspaceId, userId);
      return { text: data.text, keyboard: buildBalanceKeyboardDirect(data.accounts) };
    }
    case 'settings': {
      const settings = await getSettingsDirect(workspaceId, userId);
      return {
        text: `⚙️ <b>Настройки Midas</b>\n\n🕒 Часовой пояс: <b>${settings.timezone}</b>`,
        keyboard: SETTINGS_KB,
      };
    }
    case 'export':
      return { text: EXPORT_STEP1_TEXT, keyboard: EXPORT_STEP1_KB };
    case 'add_account':
      return {
        text: '➕ <b>Новый счёт</b>\n\nВыберите тип счёта:',
        keyboard: ACCOUNT_TYPE_KB,
      };
    case 'help':
      return { text: HELP_TEXT_VOICE };
    case 'report':
      return { text: '📊 <b>Отчёты</b>\n\nВыбери период:', keyboard: PERIOD_PICKER_KB };
    case 'transactions':
    case 'cancel_last':
      return null; // Too complex for worker — fall through to AI parse
  }
}
```

> [!WARNING]
> **Для `transactions` и `cancel_last`:** worker возвращает `null` → falls through to AI parse. Это приемлемо для Phase 2S2:
> - «Транзакции» голосом — редкий кейс (обычно нажимают Reply Keyboard)
> - «Отмени последнюю» — реализуем в Phase 3

**Gate:**
- [ ] `tsc --noEmit` — 0 errors
- [ ] Голос «покажи баланс» → Balance card (вместо «Нажми кнопку»)
- [ ] Голос «настройки» → Settings card
- [ ] Голос «экспорт» → Export Step 1 wizard
- [ ] Голос «кофе триста рублей» → AI parse → draft (не команда)
- [ ] Голос «покажи баланс» в момент account onboarding (Redis state active) → AI parse (не навигация)
- [ ] 3 голосовых «баланс» за 2 секунды → только 1 карточка (dedup)
- [ ] Голос «тишина» → «😕 Не смог разобрать» (без регрессии)

---

### 🔄 Phase 3: Команда `cancel_last` (Отмени последнюю)

#### Phase 3.1 — SQL + Confirm Card

**Задача:** Реализовать «отмени последнюю транзакцию» — instant undo для голосовых ошибок.

**Изменяемые файлы:**
- **[MODIFY]** `apps/telegram-bot/src/services/command-executor.service.ts` — добавить handler
- **[MODIFY]** `apps/telegram-bot/src/routes/webhook.route.ts` — обработка sentinel + confirm callback

**Логика внедрения:**

```typescript
// В command-executor.service.ts
case 'cancel_last': {
  const lastTx = await getLastTransaction(ctx.workspaceId, ctx.userId);
  if (!lastTx) {
    return { text: '📭 Нет транзакций для отмены.' };
  }
  const card = formatTransactionCard(lastTx);
  return {
    text: `🗑 <b>Удалить эту транзакцию?</b>\n\n${card}\n\nТранзакция будет скрыта из всех отчётов и баланс пересчитается.`,
    keyboard: {
      inline_keyboard: [
        [
          { text: '✅ Да, удалить', callback_data: `ed:del:y:${lastTx.id}` },
          { text: '❌ Нет',         callback_data: `ed:del:n:${lastTx.id}` },
        ],
      ],
    },
  };
}
```

**SQL для `getLastTransaction()`:**
```sql
SELECT id, item_name, base_amount, base_currency, transaction_intent, created_at
FROM transactions
WHERE workspace_id = $1 AND user_id = $2 AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 1
```

> [!NOTE]
> Callback data `ed:del:y:{txId}` и `ed:del:n:{txId}` — переиспользуем существующий `delete_ask` / `delete_confirm` flow из [webhook.route.ts L2870–2895](file:///C:/Users/secvency/Desktop/Midas/midas-monorepo/apps/telegram-bot/src/routes/webhook.route.ts#L2870-L2895). Не нужен новый handler — только правильный `callback_data` формат.

**Gate:**
- [ ] `tsc --noEmit` — 0 errors
- [ ] «Отмени последнюю» → карточка с последней транзакцией + [Да/Нет]
- [ ] «Да, удалить» → `softDeleteTransaction()` → «✅ Удалена»
- [ ] «Нет» → карточка закрывается
- [ ] Если нет транзакций → «📭 Нет транзакций для отмены»
- [ ] Проверить: soft-deleted транзакция исчезает из отчётов и баланса

---

### ✨ Phase 4: Polish, AI Prompt, Deploy

#### Phase 4.1 — Расширить AI prompt для STT

**Изменяемые файлы:**
- **[MODIFY]** [packages/ai-core/src/prompts.ts](file:///C:/Users/secvency/Desktop/Midas/midas-monorepo/packages/ai-core/src/prompts.ts)

**Логика:** Добавить ~10 строк примеров для STT-вариантов (перевод, долг):

```
TRANSFER: "перевёл", "кинул", "закинул на", "скинул на", "перекинул"
DEBT_GIVEN: "дал в долг", "одолжил кому-то", "занял кому-то"
DEBT_RECEIVED: "одолжил у", "занял у", "мне дали в долг", "взял в долг"
```

#### Phase 4.2 — Обновить HELP_TEXT

**Изменяемые файлы:**
- **[MODIFY]** webhook.route.ts — HELP_TEXT constant (~L403)

**Логика:** Добавить 🎤 секцию с примерами голосовых команд:

```
🎤 <b>Голосовые команды:</b>
«Покажи баланс» · «Настройки» · «Экспорт»
«Добавь счёт» · «Отмени последнюю» · «Помощь»
```

#### Phase 4.3 — Final Build + Deploy

**Gate (финальный):**
- [ ] `tsc --noEmit` — 0 errors
- [ ] `npm run build` — 0 errors
- [ ] Push → Railway auto-deploy
- [ ] Smoke test: текст «баланс» → Balance card
- [ ] Smoke test: голос «настройки» → Settings card  
- [ ] Smoke test: голос «кофе 300» → draft card (AI parse)
- [ ] Smoke test: «отмени последнюю» → confirm card
- [ ] Smoke test: «скинь Excel» → Export wizard Step 1
- [ ] Обновить `workflow_state.md`

---

## 4. Протокол Тестирования (QA Protocol)

### 4.1 Self-Analysis Checklist (агент выполняет ПОСЛЕ каждой фазы)

```markdown
## QA Checkpoint — Phase {N}

### TypeScript
- [ ] `tsc --noEmit` — 0 errors
- [ ] Нет circular dependency warnings

### Regression (НЕ сломали существующее)
- [ ] NAV_BTN «📊 Баланс» → работает
- [ ] NAV_BTN «⚙️ Настройки» → работает
- [ ] NAV_BTN «📋 Транзакции» → работает
- [ ] NAV_BTN «📋 Отчёт» → работает
- [ ] /start → onboarding flow → работает
- [ ] /add_account → account type picker → работает
- [ ] Текстовая транзакция «кофе 300» → draft → confirm → transaction
- [ ] Голосовая транзакция → STT → AI parse → draft → confirm
- [ ] Export через Settings → 📤 → wizard → file

### Edge Cases
- [ ] «баланс 500» → AI parse, НЕ навигация
- [ ] Голос в момент account onboarding → AI parse, НЕ команда
- [ ] 3 голосовых за 2с → 1 карточка, не 3
- [ ] Пустой голос (тишина) → «😕 Не смог разобрать»
- [ ] Слеш-команда /balance → existing handler, НЕ detectCommand

### State Machine Integrity
- [ ] midas:nav: pointer корректно обновляется
- [ ] midas:am: pointer НЕ затрагивается навигационными командами
- [ ] Redis state keys (midas:ac, midas:clar, bl:state) блокируют nav commands
```

### 4.2 Regression Killswitch

Если после деплоя обнаружены проблемы:

```typescript
// Быстрый откат: comment out 1 блок в webhook.route.ts
// ВМЕСТО:
const navCmd = detectCommand(navText);
// ЗАМЕНИТЬ НА:
const navCmd = null; // Phase 2S2 DISABLED — rollback
```

Voice worker: аналогично — заменить `detectCommand()` на `null` → fallback to existing «Нажми кнопку» behavior.

> [!CAUTION]
> **Killswitch не требует revert'а.** Одна строка `= null` отключает весь Phase 2S2 без побочных эффектов. Все existing handlers продолжают работать.

---

## 5. Сводка изменяемых файлов (полный список)

| Phase | Файл | Действие | Строки |
|---|---|---|---|
| 0.1 | `packages/shared/src/command-router.ts` | **[NEW]** | ~80 |
| 0.1 | `packages/shared/src/index.ts` | **[MODIFY]** | +1 (re-export) |
| 0.2 | `packages/shared/src/index.ts` | **[MODIFY]** | +2 (userId field) |
| 0.2 | `apps/telegram-bot/src/routes/webhook.route.ts` | **[MODIFY]** | +1 (userId in payload) |
| 0.2 | `apps/background-workers/src/workers/voice-parse.worker.ts` | **[MODIFY]** | +1 (destructure) |
| 0.3 | `apps/telegram-bot/src/services/account-onboard-keyboard.service.ts` | **[MODIFY]** | +1 (Cancel btn) |
| 1.1 | `apps/telegram-bot/src/services/command-executor.service.ts` | **[NEW]** | ~100 |
| 1.2 | `apps/telegram-bot/src/routes/webhook.route.ts` | **[MODIFY]** | +35 (router block) |
| 2.1 | `apps/background-workers/src/workers/voice-parse.worker.ts` | **[MODIFY]** | +60 (replace detect block) |
| 3.1 | `apps/telegram-bot/src/services/command-executor.service.ts` | **[MODIFY]** | +20 (cancel_last) |
| 3.1 | `apps/telegram-bot/src/routes/webhook.route.ts` | **[MODIFY]** | +10 (cancel sentinel) |
| 4.1 | `packages/ai-core/src/prompts.ts` | **[MODIFY]** | +10 (STT examples) |
| 4.2 | `apps/telegram-bot/src/routes/webhook.route.ts` | **[MODIFY]** | +5 (HELP_TEXT) |

**Итого:** 2 новых файла, 6 изменяемых файлов, ~330 строк нового кода.

---

Утверждаете ли вы этот фундаментальный Master Roadmap? Если да, скомандуйте мне начать реализацию Phase 0.
