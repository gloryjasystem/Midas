/**
 * Telegram Webhook Route — POST /webhook
 *
 * Entry point for all incoming Telegram updates.
 *
 * Security constraints implemented here:
 *
 *   SEC-04: X-Telegram-Bot-Api-Secret-Token validation
 *     → Handled upstream by telegram-auth.plugin.ts (preHandler hook)
 *
 *   SEC-05: Non-text input rejection
 *     → Messages without `text` field are silently acknowledged (HTTP 200)
 *       but NOT enqueued. Telegram retries 200-acknowledged webhooks 0 times.
 *     → Supported types that are silently dropped: voice, video, photo,
 *       document, sticker, video_note, animation, audio, contact, location.
 *
 *   SEC-06: Idempotency key
 *     → Key: telegram:bot:{botId}:chat:{chatId}:msg:{messageId}
 *     → BullMQ deduplicates jobs with the same jobId in waiting/active state.
 *
 *   SEC-09: Rate limiting (pre-enqueue)
 *     → Rate limiting is enforced by the webhook-ingestion WORKER (Phase 1.3).
 *       The HTTP server returns 200 immediately and lets the worker handle limits.
 *       This ensures Telegram never gets a non-200 response due to rate limits.
 *
 *   SEC-12: Logging privacy
 *     → `raw_text` is NEVER logged. Only job metadata is logged.
 *
 * Slash-command routing (Phase 1.10 + Phase 1.13 + Phase 1.21 + Phase 1.23):
 *   Known commands: /start, /report, /balance, /set_balance, /help, /category,
 *                   /add_category, /accounts, /add_account
 *   Unknown slash commands are rejected with a safe Russian message
 *   and do NOT reach the AI parse queue.
 *   Normal free-text (no leading "/") continues to AI parse exactly as before.
 *
 * Flow:
 *   1. Receive TelegramUpdate JSON
 *   2. Zod-validate basic shape
 *   3. Extract message (if present)
 *   4. SEC-05: check for text field — skip if absent
 *   5. SEC-03: resolve workspace_id from trusted backend source
 *   6. Build WebhookIngestionJobPayload
 *   7. Enqueue with idempotency key (SEC-06)
 *   8. Return HTTP 200 immediately (SEC-04 requirement)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  IdempotencyKeyBuilder,
  QUEUE_NAMES,
  type TelegramUpdate,
  type WebhookIngestionJobPayload,
  type CallbackConfirmJobPayload,
} from '@midas/shared';
import { webhookIngestionQueue } from '../queues/webhook-queue.js';
import { resolveWorkspace } from '../services/workspace-resolver.js';
import { checkOnboardingRateLimit } from '../services/rate-limiter.js';
// Phase 1.33: sendMessage no longer imported directly — all sends go via upsertBotMessage.
import { getMonthlyReport } from '../services/report.service.js';
import { getBalanceData, getAccountDetail, setAccountBalanceById, getAccountTxCount } from '../services/balance.service.js';
import {
  setAccountBalance,
  parseSetBalanceArgs,
  formatSetBalanceResult,
} from '../services/setBalance.service.js';
import {
  getCategoryList,
  addCategory,
  parseAddCategoryArgs,
} from '../services/category.service.js';
import {
  getAccountList,
  addAccount,
  hasAccounts,                     // Phase 1.30
  addAccountWithCurrency,          // Phase 1.30 (used in cur_input text path)
  addAccountReturningId,           // Phase 2.2 (used in currency callback → bal_input)
  parseAddAccountArgs,
  renameAccount,                   // Phase 2.1
  changeAccountCurrency,           // Phase 2.1
  softDeleteAccount,               // Phase 2.1
  softDeletePlaceholderAccount,    // Phase LD: soft-delete Default when user creates custom account
  activatePlaceholderAccount,      // Phase LD: promote Default to real account when user skips
  getWorkspaceDefaultAccount,      // Phase LD+: fetch real default account for success screen
  getWorkspaceActiveAccounts,      // Phase LD+: fetch all accounts for D.4 portfolio line
  getAccountRoles,                 // Phase LD++: role flags for account card
  setAccountRole,                  // Phase LD++: set cyclical role
} from '../services/account.service.js';
import {
  getSettings,
  updateCurrency,
  updateTimezone,
  parseSettingsArgs,
  formatCurrencyUpdated,
  formatTimezoneUpdated,
  setDefaultAccount,
} from '../services/settings.service.js';
import {
  // Phase 1.33: sendMessageWithKeyboard no longer imported — routed via upsertBotMessage.
  editMessageText,
  answerCallbackQuery,
  sendMessageWithReplyKeyboard,  // Phase 1.36-UX: persistent bottom nav keyboard
  deleteMessage,                 // Phase 1.37-UX: clean chat — delete stale bot messages
} from '../services/telegram-api.js';
import { redisConnection } from '../queues/redis.js';
import { pool } from '@midas/database'; // Phase 1.39: DB persistence for preview msg
import { searchCurrencies } from '../services/currencies.js';
import {
  parseSettingsCallback,
  buildSettingsMainKeyboard,
  buildGroupPickerKeyboard,
  buildCurrencyPageKeyboard,
  buildSearchResultsKeyboard,
  formatSettingsMenuText,
  formatCurrencyPageText,
  formatPickConfirmText,
  GROUP_PICKER_TEXT,
  EMPTY_KEYBOARD,
} from '../services/settings-keyboard.service.js';
import { escapeHtml } from '../utils/html-escape.js';
import {
  getRecentTransactions,
  countTransactions,
  getTransactionCard,
  updateTransactionAmount,
  updateTransactionCategory,
  updateTransactionAccount,
  updateTransactionIntent,
  softDeleteTransaction,      // Phase 1.29
  getWorkspaceCategories,
  getWorkspaceAccounts,
  formatTransactionListHeader,
  formatTransactionListLine,
  formatTransactionCard,
  EDIT_PAGE_SIZE,
  EDITABLE_INTENTS,           // Phase 2.0: intent picker in tx: handler
} from '../services/edit.service.js';
import {
  parseEditCallback,
  buildTransactionListKeyboard,
  buildTransactionCardKeyboard,
  buildCategoryPickerKeyboard,
  buildAccountPickerKeyboard,
  buildIntentPickerKeyboard,
  buildDeleteConfirmKeyboard,   // Phase 1.29
} from '../services/edit-keyboard.service.js';
import {
  parseAccountCallback,             // Phase 1.30
  buildAccountTypeKeyboard,          // Phase 1.30
  buildStartSimpleKeyboard,          // Phase 1.37-UX: 2-button /start keyboard
  buildFiatCurrencyKeyboard,         // Phase 2.1 (alias → page 0, still used for cash)
  buildOnboardCurrencyKeyboard,      // Phase 1.30
  buildAfterCreateKeyboard,          // Phase 1.30
  // Phase 2.2: paginated builders
  buildBankPickerPage,               // Phase 2.2
  buildExchangePickerPage,           // Phase 2.2
  buildFiatCurrencyPage,             // Phase 2.2
  buildCryptoCurrencyPage,           // Phase 2.2
  buildSkipBalanceKeyboard,          // Phase 2.2
  ACCOUNTS_EMPTY_TEXT,               // Phase 1.30
  NEW_ACCOUNT_TEXT,                  // Phase 2.5
  START_WELCOME_TEXT,                // Phase 1.37-UX: new user welcome
  SETUP_COMPLETE_TEXT,               // Phase 1.37-UX: ReplyKeyboard activation message
  EXCHANGE_PICKER_TEXT,              // Phase 1.30
  BANK_PICKER_TEXT,                  // Phase 2.1
  CURRENCY_INPUT_PROMPT,             // Phase 1.30
  buildFinishOnboardKeyboard,        // Phase 2.3
  SKIP_COMPLETE_TEXT,                // Phase 2.3: ac:skip D1 message with ReplyKeyboard
  fuzzyMatchAccountName,             // Phase 2.3: smart name fuzzy matching
  buildSmartConfirmKeyboard,         // Phase 2.3: smart confirm UI
  buildSmartConfirmText,             // Phase 2.3: smart confirm message
  // Phase 2.3: input-first redesign
  buildWalletSubtypeKeyboard,        // Phase 2.3: wallet sub-type picker screen
  buildInputPromptText,              // Phase 2.3: input prompt text (Экран 2Б)
  buildFreeTextPromptText,           // Phase 2.3: re-prompt after cus_keep
  buildFreeTextPromptKeyboard,       // Phase 2.3: keyboard for re-prompt
  buildSuccessScreenText,            // Phase 2.3: post-creation success screen
  buildCurrencyPickerText,           // Phase 2.3: context-aware currency picker header
  buildBalancePromptText,            // Phase 2.3: context-aware balance prompt
  getProviderIcon,                   // Phase 2.3: provider emoji for success screen
  PROVIDER_ICONS,                    // Phase LD+: D.4 portfolio name-based icon lookup
  capitalizeFirst,                   // Phase 2.3: auto-capitalize user input
  // master_roadmap: no-match screen + currency search
  buildNoMatchText,                  // master_roadmap 1.7
  buildNoMatchKeyboard,              // master_roadmap 1.7
  buildCurrencySearchPromptText,     // master_roadmap 1.6
  buildCurrencySearchResultsText,    // master_roadmap 1.6
  buildCurrencySearchResultsKeyboard,// master_roadmap 1.6
  buildCurrencySearchNoResultsText,  // master_roadmap 1.6
  buildCurrencySearchNoResultsKeyboard, // master_roadmap 1.6+
  searchCurrencies as searchCurrenciesOnboard, // master_roadmap 1.6
  FIAT_CURRENCY_PRESETS,             // master_roadmap: currency pool helper
  CRYPTO_CURRENCY_PRESETS,           // master_roadmap: currency pool helper
  TON_CURRENCY_PRESETS,              // master_roadmap: currency pool helper
  type AccountOnboardState,          // Phase 1.30
  buildStartOnboardKeyboardWithBack, // Phase 2.5: onboarding from draft picker with back btn
} from '../services/account-onboard-keyboard.service.js';
import {
  parseBalanceCallback,              // Phase 2.1
  buildBalanceListKeyboard,          // Phase 2.1
  buildAccountActionsKeyboard,       // Phase 2.1
  buildDeleteConfirmKeyboard as buildBalanceDeleteConfirmKeyboard, // Phase 2.1
  buildCurrencyWarningKeyboard,      // Phase 2.1
  buildBalanceFiatCurrencyKeyboard,  // Phase 2.1
  formatAccountDetailText,           // Phase 2.1
  type BalanceAccountRow,            // Phase 2.1
} from '../services/balance-keyboard.service.js';
import {
  parseInlineAccountCallback,        // Phase 1.31
  RENAME_PROMPT,                     // Phase 1.31
  type InlineAccountState,           // Phase 1.31
  buildAccountPickerV2Keyboard,      // Phase 2.4 PR9: V2 account picker keyboard (auto-show on parse)
  getPickerV2Text,                   // Phase 2.4 PR17: intent-aware picker header text
  buildAccountPickerForDraft,        // Phase 2.4 PR11: full picker (✓ + type emoji + back btn)
  getPickerScreenText,               // Phase 2.4 PR17: intent-aware full picker header text
  ACCOUNT_PICKER_EMPTY_TEXT,         // Phase 2.4 PR11: empty-state text for no-account workspaces
  type AccountPickerFullEntry,       // Phase 2.4 PR11: rich entry type
  buildCrossCurrencyInputText,       // Phase 2.4 PR12: xfx input screen text
  buildCrossCurrencyInputKeyboard,   // Phase 2.4 PR12: xfx input screen keyboard
  xfxRedisKey,                       // Phase 2.4 PR12: Redis key helper (midas:xfx:ptr:{uid}:{cid})
} from '../services/account-inline-keyboard.service.js';
import {
  getWorkspaceAccountsForInline,     // Phase 1.31
  getAccountById,                    // Phase 1.31
  getDraftAccountHint,               // Phase 1.31
  setDraftAccountId,                 // Phase 1.31
  getWorkspaceAccountsWithBalances,  // Phase 2.4 PR9: account picker data source
  toAccountPickerEntries,            // Phase 2.4 PR9: AccountWithBalance[] adapter
  getAccountWithBalance,             // Phase 2.4 PR9: single account + balance for math block
} from '../services/account.service.js';
import {
  patchDraftAmount,                  // Phase 1.32
  patchDraftIntent,                  // Phase 1.32
  patchDraftCategory,                // Phase 1.32
  validateAmountString,              // Phase 1.32
  getDraftFields,                    // Phase 1.35
  patchDraftCurrency,                // Phase 1.35
  validateCurrencyCode,              // Phase 1.35
  patchDraftAccount,                 // Phase 2.4 PR9: delink (null) / relink account on draft
  patchDraftCategoryHint,            // Phase 2.5: smart category detector
} from '../services/clarification.service.js';
import { detectCategoryFromItem } from '../services/item-category-detector.service.js'; // Phase 2.5
import { validateAccountCurrency } from '../services/account-currency-validator.service.js'; // Phase 2.5
import {
  upsertBotMessage,                  // Phase 1.33
  sendNavMessage,                    // Phase 2.9: nav buttons never delete tx records
  tryDeleteUserMessage,              // Phase 1.33
  setActiveMessageId,                // Phase 1.33
  clearActiveMessageId,              // Phase 1.33
  getActiveMessageId,                // Phase 1.37-UX: read old msg ID before /start reset
  getNavMessageId,                   // Phase 2.9+: read nav panel pointer before tx parse
  clearNavMessageId,                 // Phase 2.9+: clear nav panel pointer on tx input
} from '../services/active-message.service.js';

import { callbackConfirmQueue } from '../queues/callback-confirm-queue.js';
import {
  buildPreviewScreen,
  buildConfirmKeyboard,            // Phase 2.4 PR12: extended with account + xfx rows
  type AccountBalanceBlock,        // Phase 2.4 PR9: data type for balance block
  buildMainMenuKeyboard,           // Phase 1.36-UX: persistent bottom nav keyboard
  NAV_BTN_BALANCE,                 // Phase 1.36-UX: button text intercept constants
  NAV_BTN_REPORT,                  // Phase 1.36-UX
  NAV_BTN_SETTINGS,                // Phase 1.36-UX
  NAV_BTN_TRANSACTIONS,            // Phase 2.0
  buildRejectedScreen,             // ia:cancel handler
} from '../utils/screen-builder.js'; // Phase 1.35
import {
  getTransactionList,
  countFilteredTransactions,
  getMonthMiniStats,
  TX_PAGE_SIZE,
} from '../services/transaction-hub.service.js';
import {
  buildTxListKeyboard,
  formatTxListHeader,
} from '../services/transaction-keyboard.service.js';

// ─────────────────────────────────────────────────────────────
// Zod schema — validates raw incoming Telegram Update shape
// Only validates structural integrity, NOT business logic.
// This is a first-pass guard against malformed payloads.
// SEC-01 note: AI output validation (Zod allowlist) happens in the ai-parse worker.
// ─────────────────────────────────────────────────────────────

const telegramUserSchema = z.object({
  id: z.number(),
  is_bot: z.boolean(),
  first_name: z.string(),
  username: z.string().optional(),
});

const telegramChatSchema = z.object({
  id: z.number(),
  type: z.enum(['private', 'group', 'supergroup', 'channel']),
});

const telegramMessageSchema = z.object({
  message_id: z.number(),
  from: telegramUserSchema.optional(),
  chat: telegramChatSchema,
  date: z.number(),
  text: z.string().optional(), // absent = non-text message (SEC-05)
});

const telegramCallbackQuerySchema = z.object({
  id: z.string(),
  from: telegramUserSchema,
  message: telegramMessageSchema.optional(),
  data: z.string().optional(),
});

const telegramUpdateSchema = z.object({
  update_id: z.number(),
  message: telegramMessageSchema.optional(),
  callback_query: telegramCallbackQuerySchema.optional(),
});

// ─────────────────────────────────────────────────────────────
// Command routing helpers (Phase 1.10)
// ─────────────────────────────────────────────────────────────

/**
 * Parse the first token of a Telegram message text as a slash command.
 *
 * Returns the command string (e.g. "/start", "/report") or null if the
 * text does not start with "/".
 *
 * Rules:
 *   - Leading whitespace is stripped (trimStart).
 *   - The first whitespace-delimited token is taken.
 *   - A @BotName suffix is stripped (e.g. /help@MyBot → /help).
 *   - /reportabc is returned as-is ("/reportabc") — NOT treated as /report.
 *
 * Limitation: Telegram bot-mention stripping is best-effort.
 * If a bot name contains unusual characters the result may be unexpected,
 * but all commands are then cross-checked against KNOWN_COMMANDS so unknown
 * results are safely blocked.
 */
function parseCommandToken(text: string): string | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('/')) return null;
  const token = trimmed.split(/\s+/)[0] ?? '';
  // Strip @BotName suffix if present
  const atIdx = token.indexOf('@');
  return atIdx === -1 ? token : token.slice(0, atIdx);
}

/**
 * Set of implemented slash commands (Phase 1.10).
 * Any command NOT in this set is blocked before AI parse.
 * Extend only when a new command is implemented in a future phase.
 */
const KNOWN_COMMANDS = new Set(['/start', '/report', '/help', '/category', '/add_category', '/accounts', '/add_account', '/balance', '/set_balance', '/settings', '/edit']);

/**
 * Russian-language help text listing all currently available commands.
 * Phase 1.10: /start, /report, /help
 * Phase 1.11: /category
 * Phase 1.13: /add_category
 * Phase 1.14: /accounts
 * Phase 1.17: /add_account
 * Phase 1.21: /balance
 * Phase 1.23: /set_balance
 * Phase 1.28: /edit
 */
const HELP_TEXT =
  'ℹ️ <b>Доступные команды Midas:</b>\n\n' +
  '/start — Регистрация и приветствие\n' +
  '/report — Отчёт о доходах и расходах за текущий месяц\n' +
  '/balance — Баланс по всем счетам (за всё время)\n' +
  '/set_balance <название> <сумма> — Синхронизировать баланс счёта\n' +
  '/settings — Настройки (валюта, часовой пояс)\n' +
  '/category — Список категорий вашего кошелька\n' +
  '/add_category <группа> <название> — Добавить категорию\n' +
  '/accounts — Список ваших счетов\n' +
  '/add_account <название> — Добавить счёт\n' +
  '/edit — Редактировать последние транзакции\n' +
  '/help — Показать это сообщение\n\n' +
  'Группы для /add_category: Бизнес, Жизнь\n' +
  'Пример: /add_category Жизнь Кофе\n\n' +
  'Для записи транзакции просто напишите мне сообщение, например:\n' +
  '<i>«Потратил 500 рублей на кофе»</i>';

/** Message returned for any unrecognised slash command. */
const UNKNOWN_COMMAND_TEXT = 'Команда не распознана или пока находится в разработке.';

// ─────────────────────────────────────────────────────────────
// Route plugin
// ─────────────────────────────────────────────────────────────

const BOT_ID = process.env.TELEGRAM_BOT_ID ?? 'unknown_bot';

// Phase 1.26: Redis key for settings search mode TTL state
const SEARCH_MODE_TTL_SEC = 120;
function searchModeKey(telegramUserId: string, chatId: string): string {
  return `midas:settings:search:${telegramUserId}:${chatId}`;
}

// Phase 1.28: Redis key for edit-amount waiting state
// Value format: "amt:<txId>" — identifies which field and which transaction
const EDIT_STATE_TTL_SEC = 300; // 5 minutes
function editStateKey(telegramUserId: string, chatId: string): string {
  return `midas:edit:${telegramUserId}:${chatId}`;
}

// Phase 1.30: Redis key for account onboarding multi-step state
// Value format: JSON.stringify(AccountOnboardState)
const ONBOARD_STATE_TTL_SEC = 1800; // 30 minutes — covers full onboarding session incl. idle time
function onboardStateKey(telegramUserId: string, chatId: string): string {
  return `midas:ac:${telegramUserId}:${chatId}`;
}

// Phase 1.31: Redis key for inline account creation sub-flow (rename step)
// Value format: JSON.stringify(InlineAccountState)
// Key is scoped to draftId — deterministic and tenant-isolated.
const INLINE_ACCOUNT_TTL_SEC = 300; // 5 minutes
function inlineAccountKey(draftId: string): string {
  return `midas:ia:${draftId}`;
}

// Phase 1.32: Redis key for clarification amount-text intercept.
// Value format: "{draftId}:amt" — identifies draft and field being clarified.
// Key scoped to userId+chatId — same user in same chat.
// TTL: 300s (same as other text intercepts).
const CLARIFICATION_STATE_TTL_SEC = 300; // 5 minutes
function clarStateKey(telegramUserId: string, chatId: string): string {
  return `midas:clar:${telegramUserId}:${chatId}`;
}

// Phase 1.36-UX: Redis key for /start greeting message_id.
// Stored so we can delete the greeting when the user sends their first text.
// TTL: 24h — same as active message pointer.
const GREETING_MSG_TTL_SEC = 86400;
function greetingMsgKey(telegramUserId: string, chatId: string): string {
  return `midas:greet:${telegramUserId}:${chatId}`;
}

// Phase LD+: Redis key for last "account added" success message_id.
// Used by D.4 hybrid: delete old success card, send fresh one.
// TTL: 30 days — user may add accounts much later.
const LAST_SUCCESS_MSG_TTL_SEC = 2592000; // 30 days
function lastSuccessMsgKey(telegramUserId: string, chatId: string): string {
  return `midas:last_success:${telegramUserId}:${chatId}`;
}

/**
 * Resolve the best emoji icon for an account based on its NAME (fuzzy match
 * against PROVIDER_ICONS keys) or fallback keyword detection.
 *
 * Used in portfolio lines because all accounts in DB have type='manual' —
 * the semantic type (cash / card / exchange / wallet) is only available at
 * creation time in AccountOnboardState, not persisted to account_sources.
 */
function getIconByName(name: string, providerIconsMap: ReadonlyMap<string, string>): string {
  const lower = name.toLowerCase();
  // 1. Direct provider key match (binance, tinkoff, ledger …)
  for (const [key, icon] of providerIconsMap) {
    if (lower.includes(key)) return icon;
  }
  // 2. Keyword heuristics for common Russian account names
  if (/наличн|кэш|cash|нал\b/.test(lower)) return '💵';
  if (/крипто|crypto|биржа|exchange|бирж/.test(lower)) return '🔄';
  if (/кошел|wallet/.test(lower)) return '👛';
  if (/карт|card|банк|bank/.test(lower)) return '💳';
  // 3. Generic fallback
  return '💳';
}

/**
 * Build the D.4 "Гибрид" account-added success message text.
 *
 * Used when user adds their 2nd, 3rd, … N-th account.
 * Previous success card is deleted before this is sent.
 *
 * Format:
 *   ✅ Счёт добавлен
 *
 *   {icon} {name} · {currency}[ · {balance}]
 *
 *   Напишите операцию — «продукты 800» или «зарплата 45 000».
 *   Midas распознает сумму, тип и категорию автоматически.
 *
 *   Все счета:
 *   {icon1} {name1} · {cur1}
 *   {icon2} {name2} · {cur2}
 *   …
 */
function buildAccountAddedD4Text(
  newIcon: string,
  newName: string,
  newCurrency: string,
  newBalance: number | string | undefined,
  portfolio: Array<{ name: string; currency: string; type: string }>,
  providerIconsMap: ReadonlyMap<string, string>,
): string {
  // Dedup: if name already ends with currency (e.g. "Наличные PLN"), skip " · PLN"
  const newNameEndsCur = newName.trimEnd().toUpperCase().endsWith(newCurrency.toUpperCase());
  const headerCurPart = newNameEndsCur ? '' : ` · ${newCurrency}`;
  const balPart = newBalance !== undefined ? ` · ${newBalance} ${newCurrency}` : '';
  const portfolioLines = portfolio
    .map((a) => {
      const endsCur = a.name.trimEnd().toUpperCase().endsWith(a.currency.toUpperCase());
      const curSuffix = endsCur ? '' : ` · ${a.currency}`;
      return `${getIconByName(a.name, providerIconsMap)} ${a.name}${curSuffix}`;
    })
    .join('\n');
  return (
    `✅ Счёт добавлен\n\n` +
    `${newIcon} <b>${newName}</b>${headerCurPart}${balPart}\n\n` +
    `Напишите операцию — «продукты 800» или «зарплата 45 000».\n` +
    `Midas распознает сумму, тип и категорию автоматически.\n\n` +
    `<b>Все счета:</b>\n${portfolioLines}`
  );
}

// ── Phase 1.38: Currency normalization ─────────────────────────
// Maps colloquial/partial/symbol currency names to ISO codes.
// SEC-01: output is always uppercase 2-8 char code.
// SEC-12: raw input is not logged.

const CURRENCY_MAP: Record<string, string> = {
  // RUB
  'руб': 'RUB', 'рубл': 'RUB', 'рублей': 'RUB', 'рубль': 'RUB',
  'рубли': 'RUB', 'rub': 'RUB', '₽': 'RUB',
  // USD
  'долл': 'USD', 'доллар': 'USD', 'долларов': 'USD', 'долларів': 'USD',
  'dollar': 'USD', 'dollars': 'USD', 'бакс': 'USD', 'баксов': 'USD',
  'usd': 'USD', '$': 'USD',
  // EUR
  'евр': 'EUR', 'евро': 'EUR', 'euro': 'EUR', 'euros': 'EUR',
  'eur': 'EUR', '€': 'EUR',
  // UAH
  'грн': 'UAH', 'гривн': 'UAH', 'гривень': 'UAH', 'гривні': 'UAH',
  'hryvnia': 'UAH', 'uah': 'UAH', '₴': 'UAH',
  // GBP
  'фунт': 'GBP', 'фунтов': 'GBP', 'pound': 'GBP', 'gbp': 'GBP', '£': 'GBP',
  // Crypto
  'usdt': 'USDT', 'тезер': 'USDT', 'tether': 'USDT',
  'btc': 'BTC', 'биткоин': 'BTC', 'bitcoin': 'BTC',
  'eth': 'ETH', 'эфир': 'ETH', 'ethereum': 'ETH',
  'sol': 'SOL', 'солана': 'SOL', 'solana': 'SOL',
  'ton': 'TON', 'тон': 'TON',
  'usdc': 'USDC',
  // CNY
  'юань': 'CNY', 'yuan': 'CNY', 'cny': 'CNY', '¥': 'CNY',
};

function normalizeCurrencyInput(raw: string): string | null {
  const key = raw.toLowerCase().replace(/[\s.]/g, '');
  if (key.length === 0) return null;

  // 1. Exact match
  if (CURRENCY_MAP[key]) return CURRENCY_MAP[key];

  // 2. Prefix match: user typed partial word (e.g. "дол" → "долл" → USD)
  for (const [k, v] of Object.entries(CURRENCY_MAP)) {
    if (k.startsWith(key) || key.startsWith(k)) return v;
  }

  // 3. ISO code passthrough: 2-6 uppercase letters
  const iso = raw.toUpperCase().trim();
  if (/^[A-Z]{2,6}$/.test(iso)) return iso;

  return null;
}

// Phase 2.4 PR12: confirmKb now delegates to buildConfirmKeyboard (account + xfx aware).
// Callers that don't pass account/xfx get the same plain keyboard as before.
function confirmKb(
  draftId: string,
  account?: { id: string; name: string; currency: string } | null,
  xfx?: { hasCrossAmount: boolean } | null,
) {
  return buildConfirmKeyboard(draftId, account, xfx);
}

/** master_roadmap: pick currency keyboard based on account type + wallet sub-type. */
function chooseCurKeyboard(typ: string, sub?: string) {
  if (typ === 'card' || typ === 'cash') return buildFiatCurrencyPage(0);
  if (typ === 'wallet') {
    if (sub === 'ton') return buildCryptoCurrencyPage(0); // TON ecosystem
    if (sub === 'ewallet') return buildFiatCurrencyPage(0);   // fiat e-wallets
    return buildCryptoCurrencyPage(0); // crypto / lightning default
  }
  if (typ === 'exchange') return buildCryptoCurrencyPage(0);
  return buildOnboardCurrencyKeyboard(); // custom
}


// Phase 1.38: Unified currency clarification prompt — Variant Б
// Blockquote #1: currency examples. Blockquote #2: settings hint with path.
const CUR_PROMPT_MSG =
  '💱 <b>В какой валюте записать?</b>' +
  '\n\n<blockquote>руб · USD · USDT · EUR · $ · BTC · доллар · евро</blockquote>' +
  '\n\n<blockquote>💡 Чтобы не спрашивало каждый раз — установи валюту по умолчанию:\n' +
  '⚙️ Настройки → Базовая валюта</blockquote>';

/**
 * Phase 1.38: Extract the first valid number from free-form text.
 * Supports: "500", "500 рублей", "1 000.50 USD", "1000долларов"
 * Returns the numeric string ready for DB write, or null if nothing found.
 */
function extractAmountFromText(input: string): string | null {
  // Strip thousands-separator spaces: "1 000" → "1000"
  const normalized = input.replace(/(\d)\s+(\d)/g, '$1$2');
  // Find first decimal number
  const match = normalized.match(/(?<!\d)(\d+(?:[.,]\d{1,4})?)(?!\d)/);
  if (!match) return null;
  const num = match[1]!.replace(',', '.');
  return validateAmountString(num);
}

// Phase 2.4: Build preview card from draft data including account balance block.
// Phase 2.4 PR12: full preview result — text + keyboard metadata
interface ConfirmPreviewResult {
  text: string;
  /** Linked account for buildConfirmKeyboard, or null if no account. */
  account: { id: string; name: string; currency: string } | null;
  /** True when account currency differs from tx currency (cross-currency). */
  isCrossCurrency: boolean;
  /** True when account_debit_amount is already set on the draft. */
  hasCrossAmount: boolean;
}



/**
 * Full preview build: text + keyboard metadata.
 * Used internally by ia:pk pick handler and ia:xfx flow (PR12).
 */
async function confirmPreviewFull(
  workspaceId: string,
  userId: string,
  draftId: string,
): Promise<ConfirmPreviewResult> {
  const draft = await getDraftFields(workspaceId, userId, draftId);
  if (!draft) {
    return {
      text: '📝 Готово. Подтвердите или отклоните транзакцию:',
      account: null,
      isCrossCurrency: false,
      hasCrossAmount: false,
    };
  }

  // ── Phase 2.4: Account balance block ─────────────────────────────────
  let accountBlock: AccountBalanceBlock | null = null;
  let linkedAccount: { id: string; name: string; currency: string } | null = null;
  let isCrossCurrency = false;
  let hasCrossAmount  = false;

  if (draft.account_id) {
    const acct = await getAccountWithBalance(workspaceId, userId, draft.account_id);
    if (acct) {
      linkedAccount = { id: acct.id, name: escapeHtml(acct.name), currency: acct.currency };

      // Cross-currency: account currency differs from tx currency
      isCrossCurrency = !!draft.parsed_currency && acct.currency !== draft.parsed_currency;
      hasCrossAmount  = !!draft.account_debit_amount;

      // Debit amount: if cross-currency, debitAmount is account_debit_amount (null if not set).
      // If same currency, debitAmount is just parsed_amount.
      const debitAmount = isCrossCurrency ? draft.account_debit_amount : draft.parsed_amount;
      
      accountBlock = {
        accountName:     escapeHtml(acct.name),
        accountCurrency: acct.currency,
        currentBalance:  acct.balance,
        debitAmount:     debitAmount,
        debitCurrency:   acct.currency,
        txAmount:        draft.parsed_amount ?? '0',
        txCurrency:      draft.parsed_currency ?? 'USD',
        intent:          draft.parsed_intent,
      };
    }
  }

  const text = buildPreviewScreen({
    intent:       draft.parsed_intent,
    amount:       draft.parsed_amount,
    currency:     draft.parsed_currency,
    categoryHint: draft.parsed_category_hint ? escapeHtml(draft.parsed_category_hint) : null,
    accountHint:  null,
    itemName:     draft.item_name ? escapeHtml(draft.item_name) : null,
    accountBlock,
  });

  return { text, account: linkedAccount, isCrossCurrency, hasCrossAmount };
}

/**
 * Build the correct InlineKeyboard for a draft preview card.
 * Reads account + cross-currency state directly from confirmPreviewFull result.
 */
function confirmKbForDraft(draftId: string, res: ConfirmPreviewResult) {
  const xfx = res.isCrossCurrency
    ? { hasCrossAmount: res.hasCrossAmount }
    : null;
  return confirmKb(draftId, res.account, xfx);
}




/**
 * Phase 2.4 PR10: Show draft preview (or V2 account picker first).
 *
 * Decision tree:
 *   1. Draft has account_id already                  → preview with balance block.
 *   2. No account_id AND workspace has ≥1 accounts  → V2 picker first; ia:pk shows preview next.
 *   3. No account_id AND no accounts (new user)      → plain preview.
 *
 * msgId always stored in Redis/DB so confirm worker can edit card in-place.
 * SEC-02: no float math. SEC-12: names not logged.
 */
async function sendAndStorePreview(
  telegramUserId: string,
  chatId: string,
  workspaceId: string,
  userId: string,
  draftId: string,
  prefixText?: string, // optional prefix (e.g. account creation label)
): Promise<void> {
  // ── Phase 2.4: Picker vs Preview decision ─────────────────────────────
  // ALWAYS show account picker first (regardless of whether AI pre-set account_id).
  // This ensures the user always explicitly selects/confirms the account.
  const draft = await getDraftFields(workspaceId, userId, draftId);
  if (draft) {
    const accounts = await getWorkspaceAccountsWithBalances(workspaceId, userId, draft.parsed_intent);

    if (accounts.length > 0) {
      const pickerEntries = toAccountPickerEntries(accounts).map((e) => ({
        ...e,
        name: escapeHtml(e.name),
      }));
      const pickerText = prefixText
        ? `${prefixText}\n\n${getPickerV2Text(draft.parsed_intent)}`
        : getPickerV2Text(draft.parsed_intent);

      const pickerMsgId = await upsertBotMessage(
        telegramUserId,
        chatId,
        pickerText,
        buildAccountPickerV2Keyboard(pickerEntries, draftId),
      );
      // Store picker msgId — ia:pk handler (PR9) will editMessageText → preview.
      if (pickerMsgId) {
        try {
          await redisConnection.set(`midas:preview:${draftId}`, pickerMsgId, 'EX', 3600);
          void pool.query(
            `UPDATE transaction_drafts
             SET preview_message_id = $1, preview_chat_id = $2, updated_at = NOW()
             WHERE id = $3 AND workspace_id = $4`,
            [pickerMsgId, chatId, draftId, workspaceId],
          ).catch(() => {/* non-fatal */ });
        } catch { /* non-fatal */ }
      }
      return; // picker sent — ia:pk handler continues the flow.
    }
  }

  // ── Standard path: preview with (optional) account balance block ──────

  // ── Phase 2.5: Smart category auto-detection ─────────────────────────
  // If item_name matches a known brand/product keyword and current category
  // hint is null / empty / "Другое", patch it silently before rendering preview.
  // Non-blocking: await is safe here (single DB UPDATE, <5ms). Any failure is
  // silently swallowed by patchDraftCategoryHint — preview is never blocked.
  if (draft?.item_name) {
    const detected = detectCategoryFromItem(draft.item_name);
    if (detected) {
      void patchDraftCategoryHint(workspaceId, userId, draftId, detected.category);
    }
  }

  const res = await confirmPreviewFull(workspaceId, userId, draftId);
  const fullText = prefixText ? `${prefixText}\n\n${res.text}` : res.text;

  const msgId = await upsertBotMessage(
    telegramUserId,
    chatId,
    fullText,
    confirmKbForDraft(draftId, res),
  );
  if (msgId) {
    try {
      // Phase 1.39: TTL = 3600s to match draft TTL.
      await redisConnection.set(`midas:preview:${draftId}`, msgId, 'EX', 3600);
      void pool.query(
        `UPDATE transaction_drafts
         SET preview_message_id = $1, preview_chat_id = $2, updated_at = NOW()
         WHERE id = $3 AND workspace_id = $4`,
        [msgId, chatId, draftId, workspaceId],
      ).catch(() => {/* non-fatal DB persist */ });
    } catch { /* non-fatal */ }
  }
}



const webhookRoute: FastifyPluginAsync = async (fastify) => {
  // Await a no-op: Fastify route plugins must be async; the actual async work
  // happens inside the route handler. Promise.resolve() satisfies require-await.
  await Promise.resolve();

  fastify.post<{ Body: TelegramUpdate }>('/webhook', async (request, reply) => {
    // ── Step 1: Validate Update shape ────────────────────────
    const parseResult = telegramUpdateSchema.safeParse(request.body);

    if (!parseResult.success) {
      // Malformed payload from Telegram — log minimally, ack with 200
      // (Telegram should not retry 200 responses, so this silently discards)
      request.log.warn({
        msg: '[midas:bot:webhook] Malformed Update payload — discarding',
        updateId: (request.body as { update_id?: unknown }).update_id,
        zodErrors: parseResult.error.issues.length,
      });
      await reply.status(200).send({ ok: true });
      return;
    }

    const update = parseResult.data;

    // ── Step 2: Handle callback_query (inline keyboard) ──────
    // Phase 1.6-B: approve/reject TransactionDraft confirmation.
    // callback_data format: "approve:{draftId}" or "reject:{draftId}"
    if (update.callback_query) {
      const cq = update.callback_query;
      const telegramUserId = String(cq.from.id);
      const chatId = cq.message ? String(cq.message.chat.id) : String(cq.from.id);
      const callbackData = cq.data ?? '';

      // Phase 1.33: Sync active message pointer — the callback's message IS the active UI.
      // Phase LD++: DO NOT set active message pointer for FLOATING CARDS.
      // If we do, clicking main menu buttons (like "Баланс") will edit/delete the floating card!
      if (cq.message) {
        const isFloatingCard =
          callbackData.startsWith('approve:') ||
          callbackData.startsWith('reject:') ||
          callbackData.startsWith('ia:') ||
          callbackData.startsWith('clar:') ||
          callbackData.startsWith('ed:');

        if (!isFloatingCard) {
          void setActiveMessageId(telegramUserId, chatId, String(cq.message.message_id));
        }
      }

      // ── Phase 1.30: account onboarding callbacks (prefix "ac:") ────
      if (callbackData.startsWith('ac:')) {
        const acCmd = parseAccountCallback(callbackData);
        if (!acCmd) {
          request.log.warn({
            msg: '[midas:bot:webhook] ac: callback: unrecognised data — acknowledged',
            callbackId: cq.id,
          });
          await answerCallbackQuery(cq.id);
          await reply.status(200).send({ ok: true });
          return;
        }

        let acResolved: { workspaceId: string; userId: string };
        try {
          acResolved = await resolveWorkspace(telegramUserId, chatId);
        } catch {
          await answerCallbackQuery(cq.id);
          await reply.status(200).send({ ok: true });
          return;
        }

        const acKey = onboardStateKey(telegramUserId, chatId);
        const acMsgId = cq.message ? String(cq.message.message_id) : null;

        // ── Phase 2.5: Preserve linked draft ID globally for onboarding ──
        const rawAcStateGlob = await redisConnection.get(acKey);
        let globalLinkedDraftId: string | undefined;
        if (rawAcStateGlob) {
          try {
            globalLinkedDraftId = (JSON.parse(rawAcStateGlob) as AccountOnboardState).linkedDraftId;
          } catch { /* ignore */ }
        }

        try {
          if (acCmd.cmd === 'open') {
            // Phase 1.37-UX: User tapped "Добавить счёт" from the 2-button /start keyboard.
            // Edit the same message in-place — no new message, chat stays clean.
            if (acMsgId) void editMessageText(chatId, acMsgId, ACCOUNTS_EMPTY_TEXT, buildAccountTypeKeyboard());
            // Silent gate: set FSM state so any text typed here is silently swallowed.
            // The 'type_pick' step is caught by the else-branch in Step 5f-ac text intercept.
            await redisConnection.set(acKey, JSON.stringify({ step: 'type_pick' }), 'EX', ONBOARD_STATE_TTL_SEC);

          } else if (acCmd.cmd === 'skip') {
            // Phase LD (Lazy Default): User skipped onboarding.
            // The Default account was created as a placeholder at registration.
            // Promote it to a real account by clearing is_onboarding_placeholder flag.
            await redisConnection.del(acKey);
            try {
              await activatePlaceholderAccount(acResolved.workspaceId, acResolved.userId);
              // Fallback: if for some reason no placeholder exists (e.g. older user),
              // hasAccounts() guard ensures they still get a Default account.
              const noAccounts = !(await hasAccounts(acResolved.workspaceId, acResolved.userId));
              if (noAccounts) {
                await addAccountWithCurrency(acResolved.workspaceId, acResolved.userId, 'Основной', 'USDT');
              }
            } catch { /* Non-fatal — skip silently, don't block UX */ }
            if (acMsgId) void deleteMessage(chatId, acMsgId);
            await clearActiveMessageId(telegramUserId, chatId);
            // Phase 2.3: D1 message — action-first, informs about default account.
            // sendMessageWithReplyKeyboard activates the nav panel (same as ac:fin/ac:done).
            void sendMessageWithReplyKeyboard(chatId, SKIP_COMPLETE_TEXT, buildMainMenuKeyboard());

          } else if (acCmd.cmd === 'done') {
            // Phase 1.37-UX: User finished account setup (backward compat — old buttons in chat).
            await redisConnection.del(acKey);
            if (acMsgId) void deleteMessage(chatId, acMsgId);
            await clearActiveMessageId(telegramUserId, chatId);
            const blSource = await redisConnection.get(`bl:source:${telegramUserId}:${chatId}`);
            if (blSource) {
              await redisConnection.del(`bl:source:${telegramUserId}:${chatId}`);
              const { text, accounts } = await getBalanceData(acResolved.workspaceId, acResolved.userId);
              void upsertBotMessage(telegramUserId, chatId, text, buildBalanceListKeyboard(accounts as BalanceAccountRow[]));
            } else {
              void sendMessageWithReplyKeyboard(chatId, SETUP_COMPLETE_TEXT, buildMainMenuKeyboard());
            }

          } else if (acCmd.cmd === 'fin') {
            // Phase 2.3: User tapped "✅ Завершить" from the new type picker after account creation.
            await redisConnection.del(acKey);
            if (acMsgId) void deleteMessage(chatId, acMsgId);
            await clearActiveMessageId(telegramUserId, chatId);
            const blSourceFin = await redisConnection.get(`bl:source:${telegramUserId}:${chatId}`);
            if (blSourceFin) {
              await redisConnection.del(`bl:source:${telegramUserId}:${chatId}`);
              const { text, accounts } = await getBalanceData(acResolved.workspaceId, acResolved.userId);
              void upsertBotMessage(telegramUserId, chatId, text, buildBalanceListKeyboard(accounts as BalanceAccountRow[]));
            } else {
              void sendMessageWithReplyKeyboard(chatId, SETUP_COMPLETE_TEXT, buildMainMenuKeyboard());
            }

          } else if (acCmd.cmd === 'more') {
            // Phase 2.3: backward compat — old [+Добавить ещё счёт] button in old messages.
            // Redirect to ac:fin flow (clean finish).
            await redisConnection.del(acKey);
            if (acMsgId) void deleteMessage(chatId, acMsgId);
            await clearActiveMessageId(telegramUserId, chatId);
            void sendMessageWithReplyKeyboard(chatId, SETUP_COMPLETE_TEXT, buildMainMenuKeyboard());

          } else if (acCmd.cmd === 'cus_ok') {
            // Phase 2.3: user confirmed the fuzzy-matched name suggestion.
            // Load state → use suggestedName + suggestedType → route to currency picker.
            const rawStateCus = await redisConnection.get(acKey);
            if (!rawStateCus) {
              if (acMsgId) void editMessageText(chatId, acMsgId, ACCOUNTS_EMPTY_TEXT, buildAccountTypeKeyboard());
            } else {
              let sCus: AccountOnboardState;
              try { sCus = JSON.parse(rawStateCus) as AccountOnboardState; }
              catch { sCus = { step: 'type_pick' }; }

              const confirmedName = sCus.suggestedName ?? sCus.originalName ?? 'Счёт';
              const confirmedType = sCus.suggestedType ?? 'custom';
              const newState: AccountOnboardState = {
                ...sCus,
                step: 'cur_pick',
                accountType: confirmedType,
                name: confirmedName,
              };
              await redisConnection.set(acKey, JSON.stringify(newState), 'EX', ONBOARD_STATE_TTL_SEC);
              const curKb = (confirmedType === 'card' || confirmedType === 'cash')
                ? buildFiatCurrencyPage(0)
                : (confirmedType === 'exchange' || confirmedType === 'wallet')
                  ? buildCryptoCurrencyPage(0)
                  : buildOnboardCurrencyKeyboard();
              if (acMsgId) void editMessageText(chatId, acMsgId, buildCurrencyPickerText(confirmedName), curKb);
            }

          } else if (acCmd.cmd === 'cus_keep') {
            // Phase 2.3: user rejected the suggestion — re-prompt with free-text input.
            // The user typed a name that fuzzy-matched something — but they want a different name.
            // We set fuzzyDisabled=true so next text intercept skips fuzzy and saves as-is.
            const rawStateCusK = await redisConnection.get(acKey);
            if (!rawStateCusK) {
              if (acMsgId) void editMessageText(chatId, acMsgId, ACCOUNTS_EMPTY_TEXT, buildAccountTypeKeyboard());
            } else {
              let sKeep: AccountOnboardState;
              try { sKeep = JSON.parse(rawStateCusK) as AccountOnboardState; }
              catch { sKeep = { step: 'type_pick' }; }

              // Restore to name_input with fuzzy disabled — next text goes straight to currency
              const newStateK: AccountOnboardState = {
                ...sKeep,
                step: 'name_input',
                fuzzyDisabled: true,
              };
              await redisConnection.set(acKey, JSON.stringify(newStateK), 'EX', ONBOARD_STATE_TTL_SEC);
              // Show re-prompt with appropriate examples and a back button
              const backTarget = sKeep.accountType === 'wallet' ? 'subtype' : 'type';
              const reprText = buildFreeTextPromptText(sKeep.accountType ?? 'custom', sKeep.walletSubtype);
              const reprKb = buildFreeTextPromptKeyboard(backTarget);
              if (acMsgId) void editMessageText(chatId, acMsgId, reprText, reprKb);
            }

          } else if (acCmd.cmd === 'type') {
            // ── Phase 2.3: Input-first flow ──────────────────────────────────────
            if (acCmd.accountType === 'card') {
              // Card → input prompt (Экран 2Б): «🏦 Как называется ваш банк?»
              const state: AccountOnboardState = { step: 'name_input', accountType: 'card', linkedDraftId: globalLinkedDraftId };
              await redisConnection.set(acKey, JSON.stringify(state), 'EX', ONBOARD_STATE_TTL_SEC);
              const promptText = buildInputPromptText('card', undefined, 2, 5);
              if (acMsgId) void editMessageText(chatId, acMsgId, promptText, { inline_keyboard: [] });

            } else if (acCmd.accountType === 'exchange') {
              // Exchange → input prompt (Экран 2Б): «📊 Какая биржа?»
              const state: AccountOnboardState = { step: 'name_input', accountType: 'exchange', linkedDraftId: globalLinkedDraftId };
              await redisConnection.set(acKey, JSON.stringify(state), 'EX', ONBOARD_STATE_TTL_SEC);
              const promptText = buildInputPromptText('exchange', undefined, 2, 5);
              if (acMsgId) void editMessageText(chatId, acMsgId, promptText, { inline_keyboard: [] });

            } else if (acCmd.accountType === 'wallet') {
              // Wallet → sub-type picker (Экран 2А): «Крипто / E-wallet / TON / Lightning»
              const state: AccountOnboardState = { step: 'wallet_subtype', accountType: 'wallet', linkedDraftId: globalLinkedDraftId };
              await redisConnection.set(acKey, JSON.stringify(state), 'EX', ONBOARD_STATE_TTL_SEC);
              if (acMsgId) void editMessageText(chatId, acMsgId, '🔐 <b>Выберите тип кошелька:</b>', buildWalletSubtypeKeyboard());

            } else if (acCmd.accountType === 'cash') {
              // Cash: name is auto-determined from currency (e.g. «Наличные RUB»)
              const state: AccountOnboardState = { step: 'cur_pick', accountType: 'cash', linkedDraftId: globalLinkedDraftId };
              await redisConnection.set(acKey, JSON.stringify(state), 'EX', ONBOARD_STATE_TTL_SEC);
              if (acMsgId) void editMessageText(chatId, acMsgId, buildCurrencyPickerText('Наличные'), buildFiatCurrencyKeyboard());

            } else {
              // Custom: input prompt with generic label
              const state: AccountOnboardState = { step: 'name_input', accountType: acCmd.accountType, linkedDraftId: globalLinkedDraftId };
              await redisConnection.set(acKey, JSON.stringify(state), 'EX', ONBOARD_STATE_TTL_SEC);
              const promptText = buildInputPromptText('custom', undefined, 2, 5);
              if (acMsgId) void editMessageText(chatId, acMsgId, promptText, { inline_keyboard: [] });
            }

          } else if (acCmd.cmd === 'wallet_subtype') {
            // ── Phase 2.3: Wallet sub-type selected (ac:wsub:*) ──────────────────
            // Store subtype, move to name_input, show input prompt for the specific wallet type.
            const subtype = acCmd.subtype; // 'crypto' | 'ewallet' | 'ton' | 'lightning'
            const stepTotal = subtype === 'lightning' ? 5 : 6;
            const state: AccountOnboardState = {
              step: 'name_input',
              accountType: 'wallet',
              walletSubtype: subtype,
              linkedDraftId: globalLinkedDraftId,
            };
            await redisConnection.set(acKey, JSON.stringify(state), 'EX', ONBOARD_STATE_TTL_SEC);
            const promptText = buildInputPromptText('wallet', subtype, 3, stepTotal);
            if (acMsgId) void editMessageText(chatId, acMsgId, promptText, { inline_keyboard: [] });

          } else if (acCmd.cmd === 'type_back') {
            // ── Phase 2.3: Back to type picker (ac:type:back from wallet sub-type) ──
            const state: AccountOnboardState = { step: 'type_pick', linkedDraftId: globalLinkedDraftId };
            await redisConnection.set(acKey, JSON.stringify(state), 'EX', ONBOARD_STATE_TTL_SEC);
            if (acMsgId) void editMessageText(chatId, acMsgId, ACCOUNTS_EMPTY_TEXT, buildAccountTypeKeyboard());

          } else if (acCmd.cmd === 'bank_preset') {
            // Phase 2.1: User picked a bank preset — set name, show fiat currency picker
            const state: AccountOnboardState = { step: 'cur_pick', accountType: 'card', name: acCmd.name, linkedDraftId: globalLinkedDraftId };
            await redisConnection.set(acKey, JSON.stringify(state), 'EX', ONBOARD_STATE_TTL_SEC);
            if (acMsgId) void editMessageText(chatId, acMsgId, buildCurrencyPickerText(acCmd.name), buildFiatCurrencyPage(0));

          } else if (acCmd.cmd === 'bank_custom') {
            // Phase 2.3: User tapped "Другой банк" — show free-text re-prompt
            const state: AccountOnboardState = { step: 'name_input', accountType: 'card', linkedDraftId: globalLinkedDraftId };
            await redisConnection.set(acKey, JSON.stringify(state), 'EX', ONBOARD_STATE_TTL_SEC);
            const reprText = buildFreeTextPromptText('card');
            if (acMsgId) void editMessageText(chatId, acMsgId, reprText, buildFreeTextPromptKeyboard('type'));

          } else if (acCmd.cmd === 'exchange_preset') {
            // User picked an exchange preset — show crypto currency picker
            const state: AccountOnboardState = { step: 'cur_pick', accountType: 'exchange', name: acCmd.name, linkedDraftId: globalLinkedDraftId };
            await redisConnection.set(acKey, JSON.stringify(state), 'EX', ONBOARD_STATE_TTL_SEC);
            if (acMsgId) void editMessageText(chatId, acMsgId, buildCurrencyPickerText(acCmd.name), buildCryptoCurrencyPage(0));

          } else if (acCmd.cmd === 'exchange_custom') {
            // Phase 2.3: User tapped "Другая биржа" — show free-text re-prompt
            const state: AccountOnboardState = { step: 'name_input', accountType: 'exchange', linkedDraftId: globalLinkedDraftId };
            await redisConnection.set(acKey, JSON.stringify(state), 'EX', ONBOARD_STATE_TTL_SEC);
            const reprText = buildFreeTextPromptText('exchange');
            if (acMsgId) void editMessageText(chatId, acMsgId, reprText, buildFreeTextPromptKeyboard('type'));

          } else if (acCmd.cmd === 'wallet_preset') {
            // Phase 2.3: User picked a wallet preset — show crypto currency picker
            const state: AccountOnboardState = { step: 'cur_pick', accountType: 'wallet', name: acCmd.name, linkedDraftId: globalLinkedDraftId };
            await redisConnection.set(acKey, JSON.stringify(state), 'EX', ONBOARD_STATE_TTL_SEC);
            if (acMsgId) void editMessageText(chatId, acMsgId, buildCurrencyPickerText(acCmd.name), buildCryptoCurrencyPage(0));

          } else if (acCmd.cmd === 'wallet_custom') {
            // Phase 2.3: User tapped "Другой кошелёк" — re-prompt with subtype context
            const rawStateWc = await redisConnection.get(acKey);
            let walletSubtypeWc: string | undefined;
            if (rawStateWc) {
              try { walletSubtypeWc = (JSON.parse(rawStateWc) as AccountOnboardState).walletSubtype; } catch { /* ignore */ }
            }
            const stateWc: AccountOnboardState = { step: 'name_input', accountType: 'wallet', walletSubtype: walletSubtypeWc as AccountOnboardState['walletSubtype'], linkedDraftId: globalLinkedDraftId };
            await redisConnection.set(acKey, JSON.stringify(stateWc), 'EX', ONBOARD_STATE_TTL_SEC);
            const reprText = buildFreeTextPromptText('wallet', walletSubtypeWc);
            if (acMsgId) void editMessageText(chatId, acMsgId, reprText, buildFreeTextPromptKeyboard('subtype'));

          } else if (acCmd.cmd === 'currency') {
            // User picked a currency — load state, create account, go to bal_input
            const rawState = await redisConnection.get(acKey);
            if (!rawState) {
              // State expired — restart
              if (acMsgId) void editMessageText(chatId, acMsgId, ACCOUNTS_EMPTY_TEXT, buildAccountTypeKeyboard());
            } else {
              let state: AccountOnboardState;
              try { state = JSON.parse(rawState) as AccountOnboardState; }
              catch { state = { step: 'type_pick' }; }

              let accountName: string;
              if (state.accountType === 'cash') {
                accountName = `Наличные ${acCmd.code}`;
              } else {
                accountName = state.name ?? 'Счёт';
              }

              // ── Phase 2.5: Account-currency compatibility gate ────────
              const providerKeyForValidation = (state.name ?? '').toLowerCase();
              const currencyValidation = validateAccountCurrency(
                state.accountType,
                state.walletSubtype,
                providerKeyForValidation,
                acCmd.code,
              );
              if (!currencyValidation.valid) {
                // Block creation — show error, keep state intact so user can pick a different currency
                if (acMsgId) {
                  void editMessageText(chatId, acMsgId, currencyValidation.errorMessage);
                } else {
                  void upsertBotMessage(telegramUserId, chatId, currencyValidation.errorMessage);
                }
                await reply.status(200).send({ ok: true });
                return;
              }
              // ── End Phase 2.5 ─────────────────────────────────────────

              const res = await addAccountReturningId(
                acResolved.workspaceId, acResolved.userId, accountName, acCmd.code,
              );


              if (res.status === 'duplicate') {
                await redisConnection.del(acKey);
                if (acMsgId) void editMessageText(
                  chatId, acMsgId,
                  `⚠️ Счёт <b>${escapeHtml(accountName)}</b> уже существует.`,
                  buildAfterCreateKeyboard(),
                );
              } else {
                // Phase LD: custom account created — soft-delete the onboarding placeholder.
                // Non-fatal: if placeholder already gone or never existed, 'none' is returned.
                try {
                  await softDeletePlaceholderAccount(acResolved.workspaceId, acResolved.userId);
                } catch { /* non-fatal — don't block onboarding UX */ }
                // Phase 2.2: transition to bal_input step
                // Phase 2.5: preserve linkedDraftId if onboarding was started from draft picker
                const newState: AccountOnboardState = {
                  step: 'bal_input',
                  accountType: state.accountType,
                  name: accountName,
                  accountId: res.accountId,
                  currency: acCmd.code,
                  linkedDraftId: state.linkedDraftId,
                };
                await redisConnection.set(acKey, JSON.stringify(newState), 'EX', ONBOARD_STATE_TTL_SEC);
                const balPrompt = buildBalancePromptText(escapeHtml(accountName), escapeHtml(acCmd.code));
                if (acMsgId) void editMessageText(chatId, acMsgId, balPrompt, buildSkipBalanceKeyboard());
                request.log.info({ msg: '[midas:bot:webhook] ac: account created, awaiting balance', workspaceId: acResolved.workspaceId });
              }
            }

          } else if (acCmd.cmd === 'bal_skip') {
            // Phase 2.3: user skipped balance — show success screen immediately
            const rawStateBal = await redisConnection.get(acKey);
            let skippedName = 'Счёт';
            let skippedCur = '';
            let skippedType = 'custom';
            let skippedSub: string | undefined;
            if (rawStateBal) {
              try {
                const s = JSON.parse(rawStateBal) as AccountOnboardState;
                skippedName = s.name ?? 'Счёт';
                skippedCur = s.currency ?? '';
                skippedType = s.accountType ?? 'custom';
                skippedSub = s.walletSubtype;
              } catch { /* ignore */ }
            }

            // ── Phase 2.5: If launched from draft picker — link account and return to draft ──
            // Read state again to get linkedDraftId and accountId.
            let linkedDraftIdBal: string | undefined;
            let linkedAccountIdBal: string | undefined;
            if (rawStateBal) {
              try {
                const sLink = JSON.parse(rawStateBal) as AccountOnboardState;
                linkedDraftIdBal = sLink.linkedDraftId;
                linkedAccountIdBal = sLink.accountId;
              } catch { /* ignore */ }
            }

            if (linkedDraftIdBal && linkedAccountIdBal) {
              await redisConnection.del(acKey);
              try {
                await setDraftAccountId(acResolved.workspaceId, acResolved.userId, linkedDraftIdBal, linkedAccountIdBal);
              } catch { /* non-fatal */ }
              try {
                await softDeletePlaceholderAccount(acResolved.workspaceId, acResolved.userId);
              } catch { /* non-fatal */ }
              const pickerMsgIdBal = await getActiveMessageId(telegramUserId, chatId);
              await clearActiveMessageId(telegramUserId, chatId);
              const previewResNewAcc = await confirmPreviewFull(acResolved.workspaceId, acResolved.userId, linkedDraftIdBal);
              const confirmMsgNewAcc = previewResNewAcc.text;
              if (pickerMsgIdBal) {
                void editMessageText(chatId, pickerMsgIdBal, confirmMsgNewAcc, confirmKbForDraft(linkedDraftIdBal, previewResNewAcc));
                try { await redisConnection.set(`midas:preview:${linkedDraftIdBal}`, pickerMsgIdBal, 'EX', 3600); } catch { /* non-fatal */ }
              } else {
                void upsertBotMessage(telegramUserId, chatId, confirmMsgNewAcc, confirmKbForDraft(linkedDraftIdBal, previewResNewAcc));
              }
              request.log.info({ msg: '[midas:bot:webhook] ac: bal_skip — account linked to draft', workspaceId: acResolved.workspaceId });
              // Skip standard D4 / first-account success screen
            } else {
              await redisConnection.del(acKey);
              // Phase LD: user completed custom account creation (with skipped balance).
              // Soft-delete the onboarding placeholder — only the custom account remains.
              try {
                await softDeletePlaceholderAccount(acResolved.workspaceId, acResolved.userId);
              } catch { /* non-fatal */ }
              const skippedIcon = getProviderIcon(undefined, skippedType, skippedSub);
              // Phase LD+: fetch default account + check if first
              const defBal = await getWorkspaceDefaultAccount(acResolved.workspaceId, acResolved.userId).catch(() => null);
              // Activate nav keyboard: delete inline onboarding msg
              if (acMsgId) void deleteMessage(chatId, acMsgId);
              await clearActiveMessageId(telegramUserId, chatId);
              if (defBal && !defBal.isFirst) {
                // D.4 Hybrid: 2nd+ account — delete old success card, send fresh one
                const oldSuccessId = await redisConnection.get(lastSuccessMsgKey(telegramUserId, chatId));
                if (oldSuccessId) void deleteMessage(chatId, oldSuccessId);
                const portfolio = await getWorkspaceActiveAccounts(acResolved.workspaceId, acResolved.userId).catch(() => []);
                const d4Text = buildAccountAddedD4Text(
                  skippedIcon, escapeHtml(skippedName), skippedCur, undefined, portfolio,
                  PROVIDER_ICONS,
                );
                const newSuccessId = await sendMessageWithReplyKeyboard(chatId, d4Text, buildMainMenuKeyboard());
                if (newSuccessId) void redisConnection.set(lastSuccessMsgKey(telegramUserId, chatId), newSuccessId, 'EX', LAST_SUCCESS_MSG_TTL_SEC);
              } else {
                // First account — full onboarding success screen
                const defIcon = defBal ? getProviderIcon(undefined, defBal.type, undefined) : skippedIcon;
                const defName = defBal?.name ?? skippedName;
                const defCur = defBal?.currency ?? skippedCur;
                const firstSuccessId = await sendMessageWithReplyKeyboard(
                  chatId,
                  buildSuccessScreenText(escapeHtml(defName), defCur, undefined, defIcon),
                  buildMainMenuKeyboard(),
                );
                if (firstSuccessId) void redisConnection.set(lastSuccessMsgKey(telegramUserId, chatId), firstSuccessId, 'EX', LAST_SUCCESS_MSG_TTL_SEC);
              }
            } // end else (standard D4 path)

          } else if (acCmd.cmd === 'bank_page') {
            // Phase 2.2: paginate bank picker
            if (acMsgId) void editMessageText(chatId, acMsgId, BANK_PICKER_TEXT, buildBankPickerPage(acCmd.page));

          } else if (acCmd.cmd === 'exchange_page') {
            // Phase 2.2: paginate exchange picker
            if (acMsgId) void editMessageText(chatId, acMsgId, EXCHANGE_PICKER_TEXT, buildExchangePickerPage(acCmd.page));

          } else if (acCmd.cmd === 'fiat_page') {
            // Phase 2.2: paginate fiat currency picker
            const rawStateFp = await redisConnection.get(acKey);
            let fiatPageName: string | undefined;
            let fiatPageCustom = false;
            if (rawStateFp) {
              try {
                const s = JSON.parse(rawStateFp) as AccountOnboardState;
                fiatPageName = s.name;
                fiatPageCustom = s.isCustomName === true;
              } catch { /* ignore */ }
            }
            if (acMsgId) void editMessageText(chatId, acMsgId, buildCurrencyPickerText(fiatPageName, fiatPageCustom), buildFiatCurrencyPage(acCmd.page));

          } else if (acCmd.cmd === 'crypto_page') {
            // Phase 2.2: paginate crypto currency picker
            const rawStateCp = await redisConnection.get(acKey);
            let cryptoPageName: string | undefined;
            let cryptoPageCustom = false;
            if (rawStateCp) {
              try {
                const s = JSON.parse(rawStateCp) as AccountOnboardState;
                cryptoPageName = s.name;
                cryptoPageCustom = s.isCustomName === true;
              } catch { /* ignore */ }
            }
            if (acMsgId) void editMessageText(chatId, acMsgId, buildCurrencyPickerText(cryptoPageName, cryptoPageCustom), buildCryptoCurrencyPage(acCmd.page));

          } else if (acCmd.cmd === 'cus_save') {
            // master_roadmap 2.2: user confirmed custom name from no-match screen
            const rawStateSave = await redisConnection.get(acKey);
            if (!rawStateSave) {
              if (acMsgId) void editMessageText(chatId, acMsgId, ACCOUNTS_EMPTY_TEXT, buildAccountTypeKeyboard());
            } else {
              let sSave: AccountOnboardState;
              try { sSave = JSON.parse(rawStateSave) as AccountOnboardState; }
              catch { sSave = { step: 'type_pick' }; }
              const savedName = sSave.pendingName ?? 'Счёт';
              const newStateSave: AccountOnboardState = {
                ...sSave,
                step: 'cur_pick',
                name: savedName,
                isCustomName: true,
                pendingName: undefined,
              };
              await redisConnection.set(acKey, JSON.stringify(newStateSave), 'EX', ONBOARD_STATE_TTL_SEC);
              const curKb = chooseCurKeyboard(sSave.accountType ?? 'custom', sSave.walletSubtype);
              if (acMsgId) void editMessageText(chatId, acMsgId, buildCurrencyPickerText(savedName, true), curKb);
            }

          } else if (acCmd.cmd === 'cur_search') {
            // master_roadmap 2.3: open currency free-text search mode
            const rawStateCs = await redisConnection.get(acKey);
            if (!rawStateCs) {
              if (acMsgId) void editMessageText(chatId, acMsgId, ACCOUNTS_EMPTY_TEXT, buildAccountTypeKeyboard());
            } else {
              let sCs: AccountOnboardState;
              try { sCs = JSON.parse(rawStateCs) as AccountOnboardState; }
              catch { sCs = { step: 'cur_pick' }; }
              const newStateCs: AccountOnboardState = { ...sCs, step: 'cur_search' };
              await redisConnection.set(acKey, JSON.stringify(newStateCs), 'EX', ONBOARD_STATE_TTL_SEC);
              const isCustomCs = sCs.isCustomName === true;
              if (acMsgId) void editMessageText(
                chatId, acMsgId,
                buildCurrencySearchPromptText(sCs.name ?? '', isCustomCs, sCs.accountType, sCs.walletSubtype),
                { inline_keyboard: [[{ text: '◀️ Вернуться к списку', callback_data: 'ac:cur:list' }]] },
              );
            }

          } else if (acCmd.cmd === 'cur_list') {
            // master_roadmap 2.4: return from search back to currency list
            const rawStateCl = await redisConnection.get(acKey);
            if (!rawStateCl) {
              if (acMsgId) void editMessageText(chatId, acMsgId, ACCOUNTS_EMPTY_TEXT, buildAccountTypeKeyboard());
            } else {
              let sCl: AccountOnboardState;
              try { sCl = JSON.parse(rawStateCl) as AccountOnboardState; }
              catch { sCl = { step: 'cur_pick' }; }
              const newStateCl: AccountOnboardState = { ...sCl, step: 'cur_pick' };
              await redisConnection.set(acKey, JSON.stringify(newStateCl), 'EX', ONBOARD_STATE_TTL_SEC);
              const isCustomCl = sCl.isCustomName === true;
              const curKbCl = chooseCurKeyboard(sCl.accountType ?? 'custom', sCl.walletSubtype);
              if (acMsgId) void editMessageText(chatId, acMsgId, buildCurrencyPickerText(sCl.name, isCustomCl), curKbCl);
            }

          } else {
            // currency_custom: prompt free-text currency input
            const rawState = await redisConnection.get(acKey);
            if (rawState) {
              let state: AccountOnboardState;
              try { state = JSON.parse(rawState) as AccountOnboardState; }
              catch { state = { step: 'cur_input' }; }
              state.step = 'cur_input';
              await redisConnection.set(acKey, JSON.stringify(state), 'EX', ONBOARD_STATE_TTL_SEC);
            }
            if (acMsgId) void editMessageText(chatId, acMsgId, CURRENCY_INPUT_PROMPT, { inline_keyboard: [] });
          }


        } catch (err: unknown) {
          const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
          request.log.error({ msg: '[midas:bot:webhook] ac: callback failed', callbackId: cq.id, errorClass });
        }

        await answerCallbackQuery(cq.id);
        await reply.status(200).send({ ok: true });
        return;
      }

      // ── Phase 1.31: inline account creation callbacks (prefix "ia:") ────
      if (callbackData.startsWith('ia:')) {
        const iaCmd = parseInlineAccountCallback(callbackData);
        if (!iaCmd) {
          request.log.warn({
            msg: '[midas:bot:webhook] ia: callback: unrecognised data — acknowledged',
            callbackId: cq.id,
          });
          await answerCallbackQuery(cq.id);
          await reply.status(200).send({ ok: true });
          return;
        }

        let iaResolved: { workspaceId: string; userId: string };
        try {
          iaResolved = await resolveWorkspace(telegramUserId, chatId);
        } catch {
          await answerCallbackQuery(cq.id);
          await reply.status(200).send({ ok: true });
          return;
        }

        const iaMsgId = cq.message ? String(cq.message.message_id) : null;

        try {
          if (iaCmd.cmd === 'skip') {
            // User chose to record without a specific account — proceed with draft as-is.
            // draft-confirmation.service will use the default account fallback.
            await redisConnection.del(inlineAccountKey(iaCmd.draftId));
            if (iaMsgId) {
              const previewRes = await confirmPreviewFull(iaResolved.workspaceId, iaResolved.userId, iaCmd.draftId);
              void editMessageText(chatId, iaMsgId, previewRes.text, confirmKbForDraft(iaCmd.draftId, previewRes));
              try { await redisConnection.set(`midas:preview:${iaCmd.draftId}`, iaMsgId, 'EX', 3600); } catch { /* non-fatal */ }
            }

          } else if (iaCmd.cmd === 'cancel') {
            // User tapped "✖️ Отмена" on the no-match ("Создать счёт?") card.
            // 1. Edit card in-place → "❌ Отменено" (no keyboard)
            // 2. Reject draft in DB (workspace-scoped, safe without full withTenantTransaction)
            // 3. Cleanup Redis keys
            if (iaMsgId) {
              void editMessageText(chatId, iaMsgId, buildRejectedScreen(), { inline_keyboard: [] });
            }
            // Reject draft — simple SQL, workspace-scoped (SEC-03 RLS via workspace_id filter)
            void pool.query(
              `UPDATE transaction_drafts SET status = 'rejected', updated_at = NOW()
               WHERE id = $1 AND workspace_id = $2 AND status = 'pending_user'`,
              [iaCmd.draftId, iaResolved.workspaceId],
            ).catch(() => { /* non-fatal */ });
            // Cleanup
            void redisConnection.del(inlineAccountKey(iaCmd.draftId));
            void redisConnection.del(`midas:preview:${iaCmd.draftId}`);
            void redisConnection.del(`midas:gate_sent:${telegramUserId}:${chatId}`);

          } else if (iaCmd.cmd === 'rename') {
            // User wants to type a custom account name.
            // Store draft state in Redis — next text message will be intercepted.
            // Use getDraftAccountHint to get parsed_currency from the draft (SEC-03).
            const draftHint = await getDraftAccountHint(iaResolved.workspaceId, iaResolved.userId, iaCmd.draftId);
            const draftCurrency = draftHint?.parsed_currency ?? 'USDT';
            const suggestedName = draftHint?.parsed_account_hint ?? '';
            const iaState: InlineAccountState = {
              step: 'name_input',
              suggestedName,
              currency: draftCurrency,
              draftId: iaCmd.draftId,
            };
            await redisConnection.set(inlineAccountKey(iaCmd.draftId), JSON.stringify(iaState), 'EX', INLINE_ACCOUNT_TTL_SEC);
            // Set user-scoped pointer key so the text intercept can find the active draft.
            const iaPointerKey = `midas:ia:ptr:${telegramUserId}:${chatId}`;
            await redisConnection.set(iaPointerKey, iaCmd.draftId, 'EX', INLINE_ACCOUNT_TTL_SEC);
            void upsertBotMessage(telegramUserId, chatId, RENAME_PROMPT);

          } else if (iaCmd.cmd === 'create') {
            // User confirmed creation with AI-suggested name.
            // Fetch suggested name and currency from getDraftAccountHint (SEC-03).
            await redisConnection.del(inlineAccountKey(iaCmd.draftId));
            const draftHintForCreate = await getDraftAccountHint(iaResolved.workspaceId, iaResolved.userId, iaCmd.draftId);
            const createName = draftHintForCreate?.parsed_account_hint ?? 'Счёт';
            const createCurrency = draftHintForCreate?.parsed_currency ?? 'USDT';

            const createRes = await addAccountReturningId(
              iaResolved.workspaceId, iaResolved.userId, createName, createCurrency,
            );

            if (createRes.status === 'duplicate') {
              const allAccounts = await getWorkspaceAccountsForInline(iaResolved.workspaceId, iaResolved.userId);
              const foundAcc = allAccounts.find((a) => a.name.trim().toLowerCase() === createName.trim().toLowerCase());
              if (foundAcc) {
                await setDraftAccountId(iaResolved.workspaceId, iaResolved.userId, iaCmd.draftId, foundAcc.id);
              }
              const label = `⚠️ Счёт уже существует.`;
              if (iaMsgId) {
                const previewRes = await confirmPreviewFull(iaResolved.workspaceId, iaResolved.userId, iaCmd.draftId);
                void editMessageText(chatId, iaMsgId, `${label}\n\n${previewRes.text}`, confirmKbForDraft(iaCmd.draftId, previewRes));
                try { await redisConnection.set(`midas:preview:${iaCmd.draftId}`, iaMsgId, 'EX', 3600); } catch { /* non-fatal */ }
              }
              request.log.info({ msg: '[midas:bot:webhook] ia: duplicate account inline', workspaceId: iaResolved.workspaceId });
            } else {
              // Newly created. We want to ask for balance!
              const acKey = `midas:ac:${telegramUserId}:${chatId}`;
              const newState: AccountOnboardState = {
                step: 'bal_input',
                accountType: 'custom',
                name: createName,
                accountId: createRes.accountId,
                currency: createCurrency,
                linkedDraftId: iaCmd.draftId,
              };
              await redisConnection.set(acKey, JSON.stringify(newState), 'EX', ONBOARD_STATE_TTL_SEC);
              const balPrompt = buildBalancePromptText(escapeHtml(createName), escapeHtml(createCurrency));
              if (iaMsgId) {
                void editMessageText(chatId, iaMsgId, balPrompt, buildSkipBalanceKeyboard());
              } else {
                void upsertBotMessage(telegramUserId, chatId, balPrompt, buildSkipBalanceKeyboard());
              }
              request.log.info({ msg: '[midas:bot:webhook] ia: account created inline, awaiting balance', workspaceId: iaResolved.workspaceId });
            }

          } else if (iaCmd.cmd === 'use' || iaCmd.cmd === 'fuzzy') {
            // user selected an existing account.
            // SEC-01: Validate accountId belongs to this workspace before using.
            const acct = await getAccountById(iaResolved.workspaceId, iaResolved.userId, iaCmd.accountId);
            if (!acct) {
              // IDOR guard: accountId not in this workspace — safe fallback
              if (iaMsgId) void editMessageText(
                chatId, iaMsgId,
                '⚠️ Счёт не найден.',
                { inline_keyboard: [] },
              );
            } else {
              await setDraftAccountId(iaResolved.workspaceId, iaResolved.userId, iaCmd.draftId, acct.id);
              await redisConnection.del(inlineAccountKey(iaCmd.draftId));
              if (iaMsgId) {
                const previewRes = await confirmPreviewFull(iaResolved.workspaceId, iaResolved.userId, iaCmd.draftId);
                void editMessageText(
                  chatId, iaMsgId,
                  `✅ Счёт <b>${escapeHtml(acct.name)}</b> выбран.\n\n${previewRes.text}`,
                  confirmKbForDraft(iaCmd.draftId, previewRes),
                );
                try { await redisConnection.set(`midas:preview:${iaCmd.draftId}`, iaMsgId, 'EX', 3600); } catch { /* non-fatal */ }
              }
              request.log.info({ msg: '[midas:bot:webhook] ia: account selected', workspaceId: iaResolved.workspaceId });
            }

          // ── Phase 2.4: ia:pk — user picked account from V2/full picker ──
          } else if (iaCmd.cmd === 'pick') {
            // SEC-01: IDOR guard — validate accountId belongs to this workspace.
            const pickedAcct = await getAccountById(iaResolved.workspaceId, iaResolved.userId, iaCmd.accountId);
            if (!pickedAcct) {
              if (iaMsgId) void editMessageText(
                chatId, iaMsgId,
                '⚠️ Счёт не найден. Попробуйте ещё раз.',
                { inline_keyboard: [] },
              );
            } else {
              // Link account to draft, then re-render preview with account row + xfx button.
              await setDraftAccountId(iaResolved.workspaceId, iaResolved.userId, iaCmd.draftId, pickedAcct.id);
              if (iaMsgId) {
                const previewRes = await confirmPreviewFull(iaResolved.workspaceId, iaResolved.userId, iaCmd.draftId);
                void editMessageText(chatId, iaMsgId, previewRes.text, confirmKbForDraft(iaCmd.draftId, previewRes));
                try { await redisConnection.set(`midas:preview:${iaCmd.draftId}`, iaMsgId, 'EX', 3600); } catch { /* non-fatal */ }
              }
              request.log.info({ msg: '[midas:bot:webhook] ia:pk: account picked', workspaceId: iaResolved.workspaceId });
            }

          // ── Phase 2.4 PR11: ia:delink — user tapped "🔄 Сменить счёт" ────
          } else if (iaCmd.cmd === 'delink') {
            // Before delinking, fetch and save the current account_id to Redis
            // so we can restore it if the user presses "◀️ Назад" from the picker.
            const delinkDraftBefore = await getDraftFields(iaResolved.workspaceId, iaResolved.userId, iaCmd.draftId);
            const prevAccountId = delinkDraftBefore?.account_id ?? null;
            if (prevAccountId) {
              try {
                await redisConnection.set(`midas:prev_acct:${iaCmd.draftId}`, prevAccountId, 'EX', 600);
              } catch { /* non-fatal */ }
            }

            // Delink: set account_id = NULL on the draft (patchDraftAccount with null).
            await patchDraftAccount(iaResolved.workspaceId, iaResolved.userId, iaCmd.draftId, null);

            // Fetch intent for sort priority.
            const delinkIntent = delinkDraftBefore?.parsed_intent ?? null;

            // Fetch all workspace accounts with balances for the picker.
            const allAccounts = await getWorkspaceAccountsWithBalances(
              iaResolved.workspaceId, iaResolved.userId, delinkIntent,
            );

            // PR 11: build rich picker entries (type emoji + ✓ marker + ◀️ Назад)
            const fullPickerEntries: AccountPickerFullEntry[] = allAccounts.map((acc) => ({
              id:       acc.id,
              name:     escapeHtml(acc.name),
              currency: acc.currency,
              type:     acc.type,
              balance:  acc.balance,
            }));

            if (iaMsgId) {
              const pickerText = fullPickerEntries.length > 0
                ? getPickerScreenText(delinkIntent)
                : ACCOUNT_PICKER_EMPTY_TEXT;
              void editMessageText(
                chatId, iaMsgId,
                pickerText,
                buildAccountPickerForDraft(iaCmd.draftId, fullPickerEntries, null),
              );
            }
            request.log.info({ msg: '[midas:bot:webhook] ia:delink: account delinked → full picker shown', workspaceId: iaResolved.workspaceId });

          // ── Phase 2.4 PR13: ia:back — user tapped "◀️ Назад" on account picker screen ────
          } else if (iaCmd.cmd === 'back') {
            // Restore previously linked account (saved by ia:delink before unlinking)
            const prevAcctKey = `midas:prev_acct:${iaCmd.draftId}`;
            try {
              const savedAcctId = await redisConnection.get(prevAcctKey);
              if (savedAcctId) {
                await patchDraftAccount(iaResolved.workspaceId, iaResolved.userId, iaCmd.draftId, savedAcctId);
                void redisConnection.del(prevAcctKey);
              }
            } catch { /* non-fatal */ }

            if (iaMsgId) {
              const previewRes = await confirmPreviewFull(iaResolved.workspaceId, iaResolved.userId, iaCmd.draftId);
              void editMessageText(chatId, iaMsgId, previewRes.text, confirmKbForDraft(iaCmd.draftId, previewRes));
              try { await redisConnection.set(`midas:preview:${iaCmd.draftId}`, iaMsgId, 'EX', 3600); } catch { /* non-fatal */ }
            }
            request.log.info({ msg: '[midas:bot:webhook] ia:back: account restored, returning to preview card', workspaceId: iaResolved.workspaceId });

          // ── Phase 2.4 PR12: ia:xfx — user tapped "✏️ Указать сумму в {cur}" ──
          } else if (iaCmd.cmd === 'xfx') {
            // Save the cross-currency input pointer in Redis so the next free-text
            // message from this user/chat is captured as the debit amount.
            const xfxKey = xfxRedisKey(iaResolved.userId, chatId);
            try { await redisConnection.set(xfxKey, iaCmd.draftId, 'EX', 600); } catch { /* non-fatal */ }

            // Show the cross-currency input screen.
            const xfxDraft = await getDraftFields(iaResolved.workspaceId, iaResolved.userId, iaCmd.draftId);
            if (iaMsgId && xfxDraft?.account_id) {
              const acct = await getAccountWithBalance(iaResolved.workspaceId, iaResolved.userId, xfxDraft.account_id);
              if (acct) {
                const xfxText = buildCrossCurrencyInputText(
                  xfxDraft.parsed_amount ?? '?',
                  xfxDraft.parsed_currency ?? '?',
                  escapeHtml(acct.name),
                  acct.currency,
                );
                void editMessageText(chatId, iaMsgId, xfxText, buildCrossCurrencyInputKeyboard(iaCmd.draftId));
              }
            }
            request.log.info({ msg: '[midas:bot:webhook] ia:xfx: cross-currency input screen shown', workspaceId: iaResolved.workspaceId });

          // ── Phase 2.4 PR12: ia:xfx_back — user tapped "◀️ Назад" on xfx screen ──
          } else if (iaCmd.cmd === 'xfx_back') {
            // Delete the Redis pointer so free-text returns to normal flow.
            const xfxKey = xfxRedisKey(iaResolved.userId, chatId);
            try { await redisConnection.del(xfxKey); } catch { /* non-fatal */ }

            // Restore the draft card preview.
            if (iaMsgId) {
              const previewRes = await confirmPreviewFull(iaResolved.workspaceId, iaResolved.userId, iaCmd.draftId);
              void editMessageText(chatId, iaMsgId, previewRes.text, confirmKbForDraft(iaCmd.draftId, previewRes));
            }
            request.log.info({ msg: '[midas:bot:webhook] ia:xfx:back: cross-currency input cancelled', workspaceId: iaResolved.workspaceId });

          // ── Phase 2.5: ia:newaccount — launch account creation from draft picker ──
          } else if (iaCmd.cmd === 'newaccount') {
            // User tapped «➕ Создать счёт» from the V2 account picker on a draft card.
            // 1. Save onboarding state with linkedDraftId so the onboarding flow knows
            //    to link the new account to this draft when done, instead of showing D4 screen.
            // 2. Edit the picker message in-place → onboarding type picker screen.
            // 3. Store iaMsgId as activeMessageId so the ac: text handlers (bal_input)
            //    can edit/delete this same message when balance is entered.
            const acKeyNew = onboardStateKey(telegramUserId, chatId);
            const initStateNew: AccountOnboardState = {
              step: 'type_pick',
              linkedDraftId: iaCmd.draftId,
            };
            await redisConnection.set(acKeyNew, JSON.stringify(initStateNew), 'EX', ONBOARD_STATE_TTL_SEC);

            if (iaMsgId) {
              void editMessageText(
                chatId, iaMsgId,
                NEW_ACCOUNT_TEXT,
                buildStartOnboardKeyboardWithBack(iaCmd.draftId),
              );
              // Store msgId as activeMessageId — bal_input text handler will delete/edit this msg.
              await setActiveMessageId(telegramUserId, chatId, iaMsgId);
            }
            request.log.info({ msg: '[midas:bot:webhook] ia:newaccount: onboarding started from draft picker', workspaceId: iaResolved.workspaceId });

          // ── Phase 2.5: ia:showpicker — «◀️ Назад» from type-picker → show account picker ──
          } else if (iaCmd.cmd === 'showpicker') {
            // Restore the previously saved account_id (saved by ia:delink before unlinking).
            // This ensures the draft is not left in an account-less state if user bails out.
            const prevAcctKey = `midas:prev_acct:${iaCmd.draftId}`;
            try {
              const savedAcctId = await redisConnection.get(prevAcctKey);
              if (savedAcctId) {
                await patchDraftAccount(iaResolved.workspaceId, iaResolved.userId, iaCmd.draftId, savedAcctId);
                // Keep the key alive — user might open the picker again and go back again.
              }
            } catch { /* non-fatal */ }

            // Clear FSM onboarding state — user backed out, so any partial ac: state is irrelevant.
            void redisConnection.del(onboardStateKey(telegramUserId, chatId));

            // Fetch intent + accounts and show the full picker (same as ia:delink flow).
            const showPickerDraft = await getDraftFields(iaResolved.workspaceId, iaResolved.userId, iaCmd.draftId);
            const showPickerIntent = showPickerDraft?.parsed_intent ?? null;
            const showPickerAccounts = await getWorkspaceAccountsWithBalances(
              iaResolved.workspaceId, iaResolved.userId, showPickerIntent,
            );
            const showPickerEntries: AccountPickerFullEntry[] = showPickerAccounts.map((acc) => ({
              id:       acc.id,
              name:     escapeHtml(acc.name),
              currency: acc.currency,
              type:     acc.type,
              balance:  acc.balance,
            }));
            if (iaMsgId) {
              const pickerText = showPickerEntries.length > 0
                ? getPickerScreenText(showPickerIntent)
                : ACCOUNT_PICKER_EMPTY_TEXT;
              void editMessageText(
                chatId, iaMsgId,
                pickerText,
                buildAccountPickerForDraft(iaCmd.draftId, showPickerEntries, null),
              );
            }
            request.log.info({ msg: '[midas:bot:webhook] ia:showpicker: returned to account picker from type screen', workspaceId: iaResolved.workspaceId });
          }

        } catch (err: unknown) {
          const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
          request.log.error({ msg: '[midas:bot:webhook] ia: callback failed', callbackId: cq.id, errorClass });
        }

        await answerCallbackQuery(cq.id);
        await reply.status(200).send({ ok: true });
        return;
      }

      // ── Phase 2.0: transaction hub callbacks (prefix "tx:") ───
      // All handlers use editMessageText (ISSUE-7: never upsertBotMessage from callbacks).
      if (callbackData.startsWith('tx:')) {
        const { parseTxCallback, buildSearchMenuKeyboard: buildTxSearchMenu } = await import('../services/transaction-keyboard.service.js');
        const txCmd = parseTxCallback(callbackData);
        if (!txCmd) {
          request.log.warn({ msg: '[midas:bot:webhook] tx callback: unrecognised', callbackId: cq.id });
          await answerCallbackQuery(cq.id);
          await reply.status(200).send({ ok: true });
          return;
        }

        let txResolved: { workspaceId: string; userId: string };
        try { txResolved = await resolveWorkspace(telegramUserId, chatId); }
        catch { await answerCallbackQuery(cq.id); await reply.status(200).send({ ok: true }); return; }

        const txMsgId = cq.message ? String(cq.message.message_id) : null;

        try {
          if (txCmd.cmd === 'cancel') {
            if (txMsgId) void editMessageText(chatId, txMsgId, '📋 Закрыто.', { inline_keyboard: [] });
          } else if (txCmd.cmd === 'close') {
            // Clean close of transaction panel - delete message
            if (txMsgId) {
              const { deleteMessage } = await import('../services/telegram-api.js');
              void deleteMessage(chatId, txMsgId);
              await redisConnection.del(`midas:empty_tx_msg:${chatId}`).catch(() => {});
            }
          } else if (txCmd.cmd === 'done') {
            // Returns to "✅ Записано" success card (Screenshot 1) with recalculated balance
            const card = await getTransactionCard(txCmd.txId, txResolved.workspaceId, txResolved.userId);
            if (card && txMsgId) {
              const { getAccountWithBalance } = await import('../services/account.service.js');
              const { formatRestoredSuccessCard } = await import('../utils/screen-builder.js');
              const account = card.account_id ? await getAccountWithBalance(txResolved.workspaceId, txResolved.userId, card.account_id) : null;
              void editMessageText(chatId, txMsgId, formatRestoredSuccessCard(card, account), { inline_keyboard: [[{ text: '\u270F\uFE0F \u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0437\u0430\u043F\u0438\u0441\u044C', callback_data: `ed:v:${txCmd.txId}` }]] });
            }
          } else if (txCmd.cmd === 'list') {
            const [items, total, stats] = await Promise.all([
              getTransactionList(txResolved.workspaceId, txResolved.userId, txCmd.page, txCmd.filter),
              countFilteredTransactions(txResolved.workspaceId, txResolved.userId, txCmd.filter),
              getMonthMiniStats(txResolved.workspaceId, txResolved.userId),
            ]);
            const totalPages = Math.max(1, Math.ceil(total / TX_PAGE_SIZE));
            const header = formatTxListHeader(stats, txCmd.filter);
            const keyboard = buildTxListKeyboard(items, txCmd.page, totalPages, txCmd.filter);
            if (txMsgId) void editMessageText(chatId, txMsgId, header, keyboard);
          } else if (txCmd.cmd === 'view') {
            // FIX: clear both edit-state keys when returning to tx menu (e.g. pressing "Отмена"
            // on the amount-entry screen). This prevents a dangling Redis key from intercepting
            // subsequent free-form messages as an amount input.
            void redisConnection.del(`midas:tx:edit:amt:${telegramUserId}:${chatId}`);
            void redisConnection.del(editStateKey(telegramUserId, chatId));

            const card = await getTransactionCard(txCmd.txId, txResolved.workspaceId, txResolved.userId);
            if (card) {
              const { formatTxDetailCard } = await import('../utils/screen-builder.js');
              const text = formatTxDetailCard(card);
              const rows: { text: string; callback_data: string }[][] = [];
              // Preserve the 'from' context in all sub-action callbacks so that
              // navigating deeper and returning always brings back this view with
              // the same context intact.
              const sf = txCmd.from ? `:${txCmd.from}` : '';
              if (!card.is_cross_currency) rows.push([{ text: '\u270F\uFE0F \u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0441\u0443\u043C\u043C\u0443', callback_data: `tx:f:amt:${txCmd.txId}${sf}` }]);
              rows.push([{ text: '\uD83D\uDCC1 \u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044E', callback_data: `tx:f:cat:${txCmd.txId}:0${sf}` }]);
              rows.push([{ text: '\uD83C\uDFE6 \u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0441\u0447\u0451\u0442', callback_data: `tx:f:acc:${txCmd.txId}${sf}` }]);
              rows.push([{ text: '\uD83D\uDD04 \u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0442\u0438\u043F', callback_data: `tx:f:int:${txCmd.txId}${sf}` }]);
              rows.push([{ text: '\uD83D\uDDD1\uFE0F \u0423\u0434\u0430\u043B\u0438\u0442\u044C', callback_data: `tx:d:ask:${txCmd.txId}${sf}` }]);
              // BUG-FIX: when from === 's' (arrived from a floating success card via ed:v:),
              // "Закрыть" must restore Screenshot 1 via tx:done rather than delete the message.
              const closeCallback = txCmd.from === 's' ? `tx:done:${txCmd.txId}` : 'tx:close';
              rows.push([{ text: '\u2716\uFE0F \u0417\u0430\u043A\u0440\u044B\u0442\u044C', callback_data: closeCallback }]);
              if (txMsgId) void editMessageText(chatId, txMsgId, text, { inline_keyboard: rows });
            } else {
              if (txMsgId) void editMessageText(chatId, txMsgId, '\u26A0\uFE0F \u0422\u0440\u0430\u043D\u0437\u0430\u043A\u0446\u0438\u044F \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430.', { inline_keyboard: [[{ text: '\u25C0\uFE0F \u041D\u0430\u0437\u0430\u0434', callback_data: 'tx:l:0:a' }]] });
            }
          } else if (txCmd.cmd === 'search_menu') {
            if (txMsgId) void editMessageText(chatId, txMsgId, '\u{1F50D} <b>\u041F\u043E\u0438\u0441\u043A \u0442\u0440\u0430\u043D\u0437\u0430\u043A\u0446\u0438\u0439</b>\n\n\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u0438\u043F \u043F\u043E\u0438\u0441\u043A\u0430:', buildTxSearchMenu());
          } else if (txCmd.cmd === 'field_amount') {
            if (txMsgId) {
              const sf = txCmd.from ? `:${txCmd.from}` : '';
              void editMessageText(chatId, txMsgId, '\u270F\uFE0F \u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043D\u043E\u0432\u0443\u044E \u0441\u0443\u043C\u043C\u0443:', { inline_keyboard: [[{ text: '\u25C0\uFE0F \u041E\u0442\u043C\u0435\u043D\u0430', callback_data: `tx:v:${txCmd.txId}${sf}` }]] });
              try { await redisConnection.set(`midas:tx:edit:amt:${telegramUserId}:${chatId}`, `${txCmd.txId}:${txMsgId}:${txCmd.from || ''}`, 'EX', 120); } catch { /* non-fatal */ }
            }
          } else if (txCmd.cmd === 'field_cat') {
            const cats = await getWorkspaceCategories(txResolved.workspaceId, txResolved.userId);
            const catPageSize = 8; const catCols = 2;
            const start = txCmd.page * catPageSize;
            const pageItems = cats.slice(start, start + catPageSize);
            const catTotalPages = Math.ceil(cats.length / catPageSize);
            const rows: { text: string; callback_data: string }[][] = [];
            const sf = txCmd.from ? `:${txCmd.from}` : '';
            for (let i = 0; i < pageItems.length; i += catCols) {
              rows.push(pageItems.slice(i, i + catCols).map((cat) => ({ text: escapeHtml(cat.name), callback_data: `tx:c:cat:${txCmd.txId}:${cat.id}${sf}` })));
            }
            const navRow: { text: string; callback_data: string }[] = [];
            if (txCmd.page > 0) navRow.push({ text: '\u25C0\uFE0F', callback_data: `tx:f:cat:${txCmd.txId}:${txCmd.page - 1}${sf}` });
            if (catTotalPages > 1) navRow.push({ text: `${txCmd.page + 1}/${catTotalPages}`, callback_data: 'tx:x' });
            if (txCmd.page < catTotalPages - 1) navRow.push({ text: '\u25B6\uFE0F', callback_data: `tx:f:cat:${txCmd.txId}:${txCmd.page + 1}${sf}` });
            if (navRow.length > 0) rows.push(navRow);
            rows.push([{ text: '\u25C0\uFE0F \u041D\u0430\u0437\u0430\u0434', callback_data: `tx:v:${txCmd.txId}${sf}` }]);
            if (txMsgId) void editMessageText(chatId, txMsgId, '\u{1F4C1} \u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044E:', { inline_keyboard: rows });
          } else if (txCmd.cmd === 'field_acc') {
            const accs = await getWorkspaceAccounts(txResolved.workspaceId, txResolved.userId);
            const sf = txCmd.from ? `:${txCmd.from}` : '';
            const rows: { text: string; callback_data: string }[][] = accs.map((acc) => [{ text: escapeHtml(acc.name), callback_data: `tx:c:acc:${txCmd.txId}:${acc.id}${sf}` }]);
            rows.push([{ text: '\u25C0\uFE0F \u041D\u0430\u0437\u0430\u0434', callback_data: `tx:v:${txCmd.txId}${sf}` }]);
            if (txMsgId) void editMessageText(chatId, txMsgId, '\u{1F3E6} \u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0441\u0447\u0451\u0442:', { inline_keyboard: rows });
          } else if (txCmd.cmd === 'field_int') {
            const intentLabels: Record<string, string> = { income: '\u{1F4B0} \u0414\u043E\u0445\u043E\u0434', expense: '\u{1F4B8} \u0420\u0430\u0441\u0445\u043E\u0434', debt_given: '\u{1F534} \u0414\u043E\u043B\u0433 \u0432\u044B\u0434\u0430\u043D', debt_received: '\u{1F7E2} \u0414\u043E\u043B\u0433 \u043F\u043E\u043B\u0443\u0447\u0435\u043D', transfer: '\u{1F504} \u041F\u0435\u0440\u0435\u0432\u043E\u0434' };
            const sf = txCmd.from ? `:${txCmd.from}` : '';
            const rows: { text: string; callback_data: string }[][] = (EDITABLE_INTENTS as readonly string[]).map((int) => [{ text: intentLabels[int] ?? int, callback_data: `tx:c:int:${txCmd.txId}:${int}${sf}` }]);
            rows.push([{ text: '\u25C0\uFE0F \u041D\u0430\u0437\u0430\u0434', callback_data: `tx:v:${txCmd.txId}${sf}` }]);
            if (txMsgId) void editMessageText(chatId, txMsgId, '\u{1F504} \u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u0438\u043F:', { inline_keyboard: rows });
          } else if (txCmd.cmd === 'confirm_cat') {
            const result = await updateTransactionCategory(txCmd.txId, txResolved.workspaceId, txResolved.userId, txCmd.catId);
            const sf = txCmd.from ? `:${txCmd.from}` : '';
            if (result.status === 'ok') {
              const card = await getTransactionCard(txCmd.txId, txResolved.workspaceId, txResolved.userId);
              if (card && txMsgId) void editMessageText(chatId, txMsgId, '\u2705 \u041A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044F \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0430.\n\n' + formatTransactionCard(card), { inline_keyboard: [[{ text: '\u25C0\uFE0F \u041A \u0442\u0440\u0430\u043D\u0437\u0430\u043A\u0446\u0438\u0438', callback_data: `tx:v:${txCmd.txId}${sf}` }]] });
            } else if (txMsgId) void editMessageText(chatId, txMsgId, '\u26A0\uFE0F \u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C.', { inline_keyboard: [[{ text: '\u25C0\uFE0F \u041D\u0430\u0437\u0430\u0434', callback_data: `tx:v:${txCmd.txId}${sf}` }]] });
          } else if (txCmd.cmd === 'confirm_acc') {
            const result = await updateTransactionAccount(txCmd.txId, txResolved.workspaceId, txResolved.userId, txCmd.accId);
            const sf = txCmd.from ? `:${txCmd.from}` : '';
            if (result.status === 'ok') {
              const card = await getTransactionCard(txCmd.txId, txResolved.workspaceId, txResolved.userId);
              if (card && txMsgId) void editMessageText(chatId, txMsgId, '\u2705 \u0421\u0447\u0451\u0442 \u0438\u0437\u043C\u0435\u043D\u0451\u043D.\n\n' + formatTransactionCard(card), { inline_keyboard: [[{ text: '\u25C0\uFE0F \u041A \u0442\u0440\u0430\u043D\u0437\u0430\u043A\u0446\u0438\u0438', callback_data: `tx:v:${txCmd.txId}${sf}` }]] });
            } else if (txMsgId) void editMessageText(chatId, txMsgId, '\u26A0\uFE0F \u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C.', { inline_keyboard: [[{ text: '\u25C0\uFE0F \u041D\u0430\u0437\u0430\u0434', callback_data: `tx:v:${txCmd.txId}${sf}` }]] });
          } else if (txCmd.cmd === 'confirm_int') {
            const result = await updateTransactionIntent(txCmd.txId, txResolved.workspaceId, txResolved.userId, txCmd.intent);
            const sf = txCmd.from ? `:${txCmd.from}` : '';
            if (result.status === 'ok') {
              const card = await getTransactionCard(txCmd.txId, txResolved.workspaceId, txResolved.userId);
              if (card && txMsgId) void editMessageText(chatId, txMsgId, '\u2705 \u0422\u0438\u043F \u0438\u0437\u043C\u0435\u043D\u0451\u043D.\n\n' + formatTransactionCard(card), { inline_keyboard: [[{ text: '\u25C0\uFE0F \u041A \u0442\u0440\u0430\u043D\u0437\u0430\u043A\u0446\u0438\u0438', callback_data: `tx:v:${txCmd.txId}${sf}` }]] });
            } else if (txMsgId) void editMessageText(chatId, txMsgId, '\u26A0\uFE0F \u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C.', { inline_keyboard: [[{ text: '\u25C0\uFE0F \u041D\u0430\u0437\u0430\u0434', callback_data: `tx:v:${txCmd.txId}${sf}` }]] });
          } else if (txCmd.cmd === 'delete_ask') {
            const sf = txCmd.from ? `:${txCmd.from}` : '';
            if (txMsgId) void editMessageText(chatId, txMsgId, '\u{1F5D1}\uFE0F <b>\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0442\u0440\u0430\u043D\u0437\u0430\u043A\u0446\u0438\u044E?</b>\n\n\u042D\u0442\u043E \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043D\u0435\u043B\u044C\u0437\u044F \u043E\u0442\u043C\u0435\u043D\u0438\u0442\u044C.', { inline_keyboard: [[{ text: '\u{1F5D1}\uFE0F \u0414\u0430, \u0443\u0434\u0430\u043B\u0438\u0442\u044C', callback_data: `tx:d:yes:${txCmd.txId}${sf}` }, { text: '\u25C0\uFE0F \u041E\u0442\u043C\u0435\u043D\u0430', callback_data: `tx:v:${txCmd.txId}${sf}` }]] });
          } else if (txCmd.cmd === 'delete_confirm') {
            const result = await softDeleteTransaction(txCmd.txId, txResolved.workspaceId, txResolved.userId);
            if (result.status === 'ok') {
              if (txCmd.from === 's') {
                if (txMsgId) void editMessageText(chatId, txMsgId, '\u2705 \u0422\u0440\u0430\u043D\u0437\u0430\u043A\u0446\u0438\u044F \u0443\u0434\u0430\u043B\u0435\u043D\u0430.', { inline_keyboard: [[{ text: '\u2716\uFE0F \u0417\u0430\u043A\u0440\u044B\u0442\u044C', callback_data: 'tx:close' }]] });
              } else {
                if (txMsgId) void editMessageText(chatId, txMsgId, '\u2705 \u0422\u0440\u0430\u043D\u0437\u0430\u043A\u0446\u0438\u044F \u0443\u0434\u0430\u043B\u0435\u043D\u0430.', { inline_keyboard: [[{ text: '\u25C0\uFE0F \u041A \u0441\u043F\u0438\u0441\u043A\u0443', callback_data: 'tx:l:0:a' }]] });
              }
            } else {
              if (txMsgId) void editMessageText(chatId, txMsgId, '\u26A0\uFE0F \u0422\u0440\u0430\u043D\u0437\u0430\u043A\u0446\u0438\u044F \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430.', { inline_keyboard: [[{ text: '\u25C0\uFE0F \u041A \u0441\u043F\u0438\u0441\u043A\u0443', callback_data: 'tx:l:0:a' }]] });
            }
            // ── tx:s:n → search by name (set Redis intercept) ──
          } else if (txCmd.cmd === 'search_name') {
            const searchKey = `midas:tx:search:${telegramUserId}:${chatId}`;
            try { await redisConnection.set(searchKey, 'name', 'EX', 120); } catch { /* non-fatal */ }
            if (txMsgId) void editMessageText(chatId, txMsgId,
              '📝 <b>Поиск по названию</b>\n\nНапиши название товара или услуги:',
              { inline_keyboard: [[{ text: '◀️ Отмена', callback_data: 'tx:s' }]] });

            // ── tx:s:amt → search by amount (set Redis intercept) ──
          } else if (txCmd.cmd === 'search_amount') {
            const searchKey = `midas:tx:search:${telegramUserId}:${chatId}`;
            try { await redisConnection.set(searchKey, 'amount', 'EX', 120); } catch { /* non-fatal */ }
            if (txMsgId) void editMessageText(chatId, txMsgId,
              '💲 <b>Поиск по сумме</b>\n\nВведи сумму (например: 1000 или 250.50):',
              { inline_keyboard: [[{ text: '◀️ Отмена', callback_data: 'tx:s' }]] });

            // ── tx:s:c → search by category (show picker) ──
          } else if (txCmd.cmd === 'search_category') {
            const cats = await getWorkspaceCategories(txResolved.workspaceId, txResolved.userId);
            const catRows: { text: string; callback_data: string }[][] = cats.map((cat) => [{ text: escapeHtml(cat.name), callback_data: `tx:s:cv:${cat.id}` }]);
            catRows.push([{ text: '◀️ Назад', callback_data: 'tx:s' }]);
            if (txMsgId) void editMessageText(chatId, txMsgId, '📁 <b>Поиск по категории</b>\n\nВыбери категорию:', { inline_keyboard: catRows });

            // ── tx:s:cv:{catId} → execute category search (page 0) ──
          } else if (txCmd.cmd === 'search_cat_result') {
            const { searchByCategory: searchByCat, SEARCH_PAGE_SIZE: SPS } = await import('../services/transaction-hub.service.js');
            const { items, total } = await searchByCat(txResolved.workspaceId, txResolved.userId, txCmd.catId, 0);
            const { buildSearchResultsKeyboard: buildSRK } = await import('../services/transaction-keyboard.service.js');
            // Store search context for pagination
            const srCtxKey = `midas:tx:sr:ctx:${telegramUserId}:${chatId}`;
            const ctx = JSON.stringify({ t: 'c', id: txCmd.catId });
            try { await redisConnection.set(srCtxKey, ctx, 'EX', 600); } catch { /* non-fatal */ }
            const totalPages = Math.max(1, Math.ceil(total / SPS));
            if (total === 0) {
              if (txMsgId) void editMessageText(chatId, txMsgId, '🔍 Ничего не найдено.', { inline_keyboard: [[{ text: '🔍 Новый поиск', callback_data: 'tx:s' }, { text: '◀️ К списку', callback_data: 'tx:l:0:a' }]] });
            } else {
              if (txMsgId) void editMessageText(chatId, txMsgId,
                `📁 <b>По категории</b> (${String(total)} тр.):`,
                buildSRK(items, 0, totalPages, 'tx:s:c'));
            }

            // ── tx:s:dt → date picker menu ──────────────────────
          } else if (txCmd.cmd === 'search_date_menu') {
            const { buildDatePickerKeyboard: buildDPK } = await import('../services/transaction-keyboard.service.js');
            if (txMsgId) void editMessageText(chatId, txMsgId, '📅 <b>Поиск по дате</b>\n\nВыбери период:', buildDPK());

            // ── tx:s:dt:{today|yday|week|month} → preset date range ──
          } else if (txCmd.cmd === 'search_date_preset') {
            const now = new Date();
            let from: Date, to: Date, label: string;

            if (txCmd.preset === 'today') {
              from = new Date(now); from.setHours(0, 0, 0, 0);
              to = new Date(now); to.setHours(23, 59, 59, 999);
              const dd = String(now.getDate()).padStart(2, '0');
              const mm = String(now.getMonth() + 1).padStart(2, '0');
              label = `${dd}.${mm}.${String(now.getFullYear())}`;
            } else if (txCmd.preset === 'yday') {
              const y = new Date(now); y.setDate(now.getDate() - 1);
              from = new Date(y); from.setHours(0, 0, 0, 0);
              to = new Date(y); to.setHours(23, 59, 59, 999);
              const dd = String(y.getDate()).padStart(2, '0');
              const mm = String(y.getMonth() + 1).padStart(2, '0');
              label = `${dd}.${mm}.${String(y.getFullYear())}`;
            } else if (txCmd.preset === 'week') {
              from = new Date(now); from.setDate(now.getDate() - 6); from.setHours(0, 0, 0, 0);
              to = new Date(now); to.setHours(23, 59, 59, 999);
              const dd0 = String(from.getDate()).padStart(2, '0');
              const mm0 = String(from.getMonth() + 1).padStart(2, '0');
              const dd1 = String(now.getDate()).padStart(2, '0');
              const mm1 = String(now.getMonth() + 1).padStart(2, '0');
              label = `${dd0}.${mm0} – ${dd1}.${mm1}`;
            } else {
              from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
              to = new Date(now); to.setHours(23, 59, 59, 999);
              const mm = String(now.getMonth() + 1).padStart(2, '0');
              label = `${mm}.${String(now.getFullYear())}`;
            }

            const { searchByDateRange, SEARCH_PAGE_SIZE: SPS2 } = await import('../services/transaction-hub.service.js');
            const { buildSearchResultsKeyboard: buildSRK2, buildDatePickerKeyboard: buildDPK2 } = await import('../services/transaction-keyboard.service.js');
            void buildDPK2;

            const { items: dateItems, total: dateTotal } = await searchByDateRange(
              txResolved.workspaceId, txResolved.userId, from.toISOString(), to.toISOString(), 0,
            );
            // Store context for pagination
            const srCtxKey2 = `midas:tx:sr:ctx:${telegramUserId}:${chatId}`;
            const ctx2 = JSON.stringify({ t: 'd', f: from.toISOString(), to: to.toISOString(), lb: label });
            try { await redisConnection.set(srCtxKey2, ctx2, 'EX', 600); } catch { /* non-fatal */ }

            const totalPages2 = Math.max(1, Math.ceil(dateTotal / SPS2));
            if (dateTotal === 0) {
              if (txMsgId) void editMessageText(chatId, txMsgId,
                `📅 За <b>${escapeHtml(label)}</b>\n\nТранзакций не найдено.`,
                {
                  inline_keyboard: [
                    [{ text: '◀️ К выбору периода', callback_data: 'tx:s:dt' }],
                    [{ text: '◀️ К транзакциям', callback_data: 'tx:l:0:a' }],
                  ]
                });
            } else {
              if (txMsgId) void editMessageText(chatId, txMsgId,
                `📅 <b>За ${escapeHtml(label)}</b> (${String(dateTotal)} тр.):`,
                buildSRK2(dateItems, 0, totalPages2, 'tx:s:dt'));
            }

            // ── tx:s:dt:custom → prompt free-text date input ──────
          } else if (txCmd.cmd === 'search_date_custom') {
            const searchKey = `midas:tx:search:${telegramUserId}:${chatId}`;
            try { await redisConnection.set(searchKey, 'date', 'EX', 180); } catch { /* non-fatal */ }
            if (txMsgId) void editMessageText(chatId, txMsgId,
              '📅 <b>Введи дату</b>\n\n' +
              'Форматы:\n' +
              '  <code>10.05</code>  — конкретный день\n' +
              '  <code>10.05.2026</code>  — с годом\n' +
              '  <code>01.05 - 10.05</code>  — диапазон',
              { inline_keyboard: [[{ text: '✖️ Отменить', callback_data: 'tx:s:dt:cancel' }]] },
            );

            // ── tx:s:dt:cancel → abort custom date, back to picker ─
          } else if (txCmd.cmd === 'search_date_cancel') {
            const searchKey = `midas:tx:search:${telegramUserId}:${chatId}`;
            try { await redisConnection.del(searchKey); } catch { /* non-fatal */ }
            const { buildDatePickerKeyboard: buildDPK3 } = await import('../services/transaction-keyboard.service.js');
            if (txMsgId) void editMessageText(chatId, txMsgId, '📅 <b>Поиск по дате</b>\n\nВыбери период:', buildDPK3());

            // ── tx:sr:p:{page} → paginated search results navigation ──
          } else if (txCmd.cmd === 'search_results_page') {
            const srCtxKey3 = `midas:tx:sr:ctx:${telegramUserId}:${chatId}`;
            const ctxRaw = await redisConnection.get(srCtxKey3);
            if (!ctxRaw) {
              // Context expired — ask user to search again
              if (txMsgId) void editMessageText(chatId, txMsgId,
                '⚠️ Сессия поиска истекла. Выполни поиск заново.',
                { inline_keyboard: [[{ text: '🔍 К поиску', callback_data: 'tx:s' }]] });
            } else {
              const srCtx = JSON.parse(ctxRaw) as {
                t: 'n' | 'a' | 'c' | 'd';
                q?: string; id?: string;
                f?: string; to?: string; lb?: string;
              };
              const page = txCmd.page;
              const { searchByName, searchByAmount, searchByCategory: searchByCatPg,
                searchByDateRange: searchByDRPg, SEARCH_PAGE_SIZE: SPS3 } =
                await import('../services/transaction-hub.service.js');
              const { buildSearchResultsKeyboard: buildSRK3 } =
                await import('../services/transaction-keyboard.service.js');

              let pgItems: import('../services/transaction-hub.service.js').TxListItem[];
              let pgTotal = 0;
              let pgHeader = '🔍 <b>Результаты</b>';
              let pgBack = 'tx:s';

              if (srCtx.t === 'n') {
                const r = await searchByName(txResolved.workspaceId, txResolved.userId, srCtx.q ?? '', page);
                pgItems = r.items; pgTotal = r.total;
                pgHeader = `📝 <b>По названию</b> (${String(pgTotal)} тр.)`;
                pgBack = 'tx:s';
              } else if (srCtx.t === 'a') {
                const r = await searchByAmount(txResolved.workspaceId, txResolved.userId, srCtx.q ?? '', page);
                pgItems = r.items; pgTotal = r.total;
                pgHeader = `💲 <b>По сумме</b> (${String(pgTotal)} тр.)`;
                pgBack = 'tx:s';
              } else if (srCtx.t === 'c') {
                const r = await searchByCatPg(txResolved.workspaceId, txResolved.userId, srCtx.id ?? '', page);
                pgItems = r.items; pgTotal = r.total;
                pgHeader = `📁 <b>По категории</b> (${String(pgTotal)} тр.)`;
                pgBack = 'tx:s:c';
              } else {
                const r = await searchByDRPg(txResolved.workspaceId, txResolved.userId, srCtx.f ?? '', srCtx.to ?? '', page);
                pgItems = r.items; pgTotal = r.total;
                pgHeader = `📅 <b>За ${escapeHtml(srCtx.lb ?? '')}</b> (${String(pgTotal)} тр.)`;
                pgBack = 'tx:s:dt';
              }

              const pgTotalPages = Math.max(1, Math.ceil(pgTotal / SPS3));
              if (txMsgId) void editMessageText(chatId, txMsgId,
                `${pgHeader}:`,
                buildSRK3(pgItems, page, pgTotalPages, pgBack));
            }
          }

        } catch (err: unknown) {
          const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
          request.log.error({ msg: '[midas:bot:webhook] tx callback failed', callbackId: cq.id, errorClass });
        }

        await answerCallbackQuery(cq.id);
        await reply.status(200).send({ ok: true });
        return;
      }

      // ── Phase 2.0 Sprint 4: report callbacks (prefix "rp:") ─────────────
      // ISSUE-7: All callback handlers use editMessageText (not upsertBotMessage).
      if (callbackData.startsWith('rp:')) {
        const { parseRpCallback, buildPeriodPickerKeyboard, buildReportSubMenuKeyboard, buildReportBackKeyboard, periodCodeToRange, periodLabel: getPeriodLabel } = await import('../services/report-keyboard.service.js');
        const rpCmd = parseRpCallback(callbackData);

        if (!rpCmd) {
          await answerCallbackQuery(cq.id);
          await reply.status(200).send({ ok: true });
          return;
        }

        const rpMsgId = String(cq.message?.message_id ?? '');

        try {
          // period_picker / back → show period picker
          if (rpCmd.cmd === 'period_picker' || rpCmd.cmd === 'back') {
            if (rpMsgId) void editMessageText(chatId, rpMsgId, '📊 <b>Отчёты</b>\n\nВыбери период:', buildPeriodPickerKeyboard());
          }

          // set_period → store in Redis, show sub-menu
          else if (rpCmd.cmd === 'set_period') {
            const range = periodCodeToRange(rpCmd.code);
            const label = getPeriodLabel(rpCmd.code);
            const rpKey = `midas:rp:period:${telegramUserId}:${chatId}`;
            await redisConnection.set(rpKey, `${range.start}|${range.end}|${rpCmd.code}`, 'EX', 600);
            if (rpMsgId) void editMessageText(chatId, rpMsgId, `📊 <b>Отчёты: ${escapeHtml(label)}</b>\n\nВыбери тип отчёта:`, buildReportSubMenuKeyboard());
          }

          // close → delete the reports message from chat
          else if (rpCmd.cmd === 'close') {
            if (rpMsgId) {
              const { deleteMessage } = await import('../services/telegram-api.js');
              void deleteMessage(chatId, rpMsgId);
            }
          }

          // Report commands — read period from Redis, run query
          else {
            const rpKey = `midas:rp:period:${telegramUserId}:${chatId}`;
            const rpPeriod = await redisConnection.get(rpKey);
            if (!rpPeriod) {
              if (rpMsgId) void editMessageText(chatId, rpMsgId, '⚠️ Период не выбран. Выбери период:', buildPeriodPickerKeyboard());
            } else {
              const [rpStart, rpEnd, rpCode] = rpPeriod.split('|');
              const label = getPeriodLabel((rpCode ?? 'tm') as import('../services/report-keyboard.service.js').PeriodCode);

              let rpResolved: { workspaceId: string; userId: string };
              rpResolved = await resolveWorkspace(telegramUserId, chatId);

              const { getReportSummary, getCategoryBreakdown, getExpenseOnlyReport, getIncomeOnlyReport, getComparisonReport, getAccountMovements } = await import('../services/report-advanced.service.js');

              let reportText = '';
              if (rpCmd.cmd === 'summary') {
                reportText = await getReportSummary(rpResolved.workspaceId, rpResolved.userId, rpStart!, rpEnd!, label);
              } else if (rpCmd.cmd === 'categories') {
                reportText = await getCategoryBreakdown(rpResolved.workspaceId, rpResolved.userId, rpStart!, rpEnd!, label);
              } else if (rpCmd.cmd === 'expenses') {
                reportText = await getExpenseOnlyReport(rpResolved.workspaceId, rpResolved.userId, rpStart!, rpEnd!, label);
              } else if (rpCmd.cmd === 'income') {
                reportText = await getIncomeOnlyReport(rpResolved.workspaceId, rpResolved.userId, rpStart!, rpEnd!, label);
              } else if (rpCmd.cmd === 'comparison') {
                reportText = await getComparisonReport(rpResolved.workspaceId, rpResolved.userId, rpStart!, rpEnd!, label);
              } else if (rpCmd.cmd === 'accounts') {
                reportText = await getAccountMovements(rpResolved.workspaceId, rpResolved.userId, rpStart!, rpEnd!, label);
              }

              if (rpMsgId && reportText) void editMessageText(chatId, rpMsgId, reportText, buildReportBackKeyboard());
            }
          }
        } catch (err: unknown) {
          const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
          request.log.error({ msg: '[midas:bot:webhook] rp callback failed', callbackId: cq.id, errorClass });
        }

        await answerCallbackQuery(cq.id);
        await reply.status(200).send({ ok: true });
        return;
      }

      // ── Phase 1.28: edit callbacks (prefix "ed:") ─────────────
      // Phase 2.0: ed: is deprecated alias for tx:
      // ISSUE-2 FIX: structure matches (tx:f: = ed:f:, tx:d: = ed:d:, tx:v: = ed:v:)
      // Simple prefix remap: ed:v:{id} → tx:v:{id}, ed:l:0 → tx:l:0 (filter defaults to 'a')
      if (callbackData.startsWith('ed:')) {
        let remapped = 'tx:' + callbackData.slice(3);
        if (callbackData.startsWith('ed:v:') || callbackData.startsWith('ed:f:')) {
          remapped += ':s';
        }
        const { parseTxCallback: parseTxAlias } = await import('../services/transaction-keyboard.service.js');
        const aliasCmd = parseTxAlias(remapped);
        if (aliasCmd) {
          // Re-route to tx: handler — simulate tx: callback
          request.log.info({ msg: '[midas:bot:webhook] ed: → tx: remap', original: callbackData, remapped });
          // Process via tx: routing (same logic as the tx: block above)
          let txResolved: { workspaceId: string; userId: string };
          try { txResolved = await resolveWorkspace(telegramUserId, chatId); }
          catch { await answerCallbackQuery(cq.id); await reply.status(200).send({ ok: true }); return; }
          const txMsgId = cq.message ? String(cq.message.message_id) : null;
          try {
            if (aliasCmd.cmd === 'list') {
              const [items, total, stats] = await Promise.all([
                getTransactionList(txResolved.workspaceId, txResolved.userId, aliasCmd.page, aliasCmd.filter),
                countFilteredTransactions(txResolved.workspaceId, txResolved.userId, aliasCmd.filter),
                getMonthMiniStats(txResolved.workspaceId, txResolved.userId),
              ]);
              const totalPages = Math.max(1, Math.ceil(total / TX_PAGE_SIZE));
              const header = formatTxListHeader(stats, aliasCmd.filter);
              const keyboard = buildTxListKeyboard(items, aliasCmd.page, totalPages, aliasCmd.filter);
              if (txMsgId) void editMessageText(chatId, txMsgId, header, keyboard);
            } else if (aliasCmd.cmd === 'view') {
              const card = await getTransactionCard(aliasCmd.txId, txResolved.workspaceId, txResolved.userId);
              if (card) {
                const { formatTxDetailCard } = await import('../utils/screen-builder.js');
                const text = formatTxDetailCard(card);
                const rows: { text: string; callback_data: string }[][] = [];
                if (!card.is_cross_currency) rows.push([{ text: '\u270F\uFE0F \u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0441\u0443\u043C\u043C\u0443', callback_data: `tx:f:amt:${aliasCmd.txId}:s` }]);
                rows.push([{ text: '\uD83D\uDCC1 \u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044E', callback_data: `tx:f:cat:${aliasCmd.txId}:0:s` }]);
                rows.push([{ text: '\uD83C\uDFE6 \u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0441\u0447\u0451\u0442', callback_data: `tx:f:acc:${aliasCmd.txId}:s` }]);
                rows.push([{ text: '\uD83D\uDD04 \u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0442\u0438\u043F', callback_data: `tx:f:int:${aliasCmd.txId}:s` }]);
                rows.push([{ text: '\uD83D\uDDD1\uFE0F \u0423\u0434\u0430\u043B\u0438\u0442\u044C', callback_data: `tx:d:ask:${aliasCmd.txId}:s` }]);
                rows.push([{ text: '\u2716\uFE0F \u0417\u0430\u043A\u0440\u044B\u0442\u044C', callback_data: `tx:done:${aliasCmd.txId}` }]);
                if (txMsgId) void editMessageText(chatId, txMsgId, text, { inline_keyboard: rows });
              } else {
                if (txMsgId) void editMessageText(chatId, txMsgId, '\u26A0\uFE0F \u0422\u0440\u0430\u043D\u0437\u0430\u043A\u0446\u0438\u044F \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430.', { inline_keyboard: [[{ text: '\u25C0\uFE0F \u041D\u0430\u0437\u0430\u0434', callback_data: 'tx:l:0:a' }]] });
              }
            } else if (aliasCmd.cmd === 'cancel') {
              if (txMsgId) void editMessageText(chatId, txMsgId, '\uD83D\uDCCB \u0417\u0430\u043A\u0440\u044B\u0442\u043E.', { inline_keyboard: [] });
            }
            // All other ed: commands still fall through to original ed: handler below
          } catch (err: unknown) {
            const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
            request.log.error({ msg: '[midas:bot:webhook] ed→tx remap failed', callbackId: cq.id, errorClass });
          }
          if (aliasCmd.cmd === 'list' || aliasCmd.cmd === 'view' || aliasCmd.cmd === 'cancel') {
            await answerCallbackQuery(cq.id);
            await reply.status(200).send({ ok: true });
            return;
          }
        }
        // Fall through to original ed: handler for commands not remapped above
        const cmd = parseEditCallback(callbackData);
        if (!cmd) {
          request.log.warn({
            msg: '[midas:bot:webhook] edit callback: unrecognised data — acknowledged',
            callbackId: cq.id,
          });
          await answerCallbackQuery(cq.id);
          await reply.status(200).send({ ok: true });
          return;
        }

        let edResolved: { workspaceId: string; userId: string };
        try {
          edResolved = await resolveWorkspace(telegramUserId, chatId);
        } catch {
          await answerCallbackQuery(cq.id);
          await reply.status(200).send({ ok: true });
          return;
        }

        const messageId = cq.message ? String(cq.message.message_id) : null;

        try {
          if (cmd.cmd === 'cancel') {
            if (messageId) void editMessageText(chatId, messageId, '✅ Редактирование закрыто.', { inline_keyboard: [] });

          } else if (cmd.cmd === 'list') {
            const [items, total] = await Promise.all([
              getRecentTransactions(edResolved.workspaceId, edResolved.userId, cmd.page),
              countTransactions(edResolved.workspaceId, edResolved.userId),
            ]);
            const totalPages = Math.max(1, Math.ceil(total / EDIT_PAGE_SIZE));
            const header = formatTransactionListHeader(cmd.page, totalPages);
            const lines = items.map((tx, i) => formatTransactionListLine(tx, cmd.page * EDIT_PAGE_SIZE + i));
            const text = [header, ...lines].join('\n');
            const keyboard = buildTransactionListKeyboard(items, cmd.page, totalPages);
            if (messageId) void editMessageText(chatId, messageId, text, keyboard);

          } else if (cmd.cmd === 'view') {
            // FIX: clear both edit-state keys when returning to card view (symmetry with tx:view fix).
            void redisConnection.del(`midas:tx:edit:amt:${telegramUserId}:${chatId}`);
            void redisConnection.del(editStateKey(telegramUserId, chatId));

            const card = await getTransactionCard(cmd.txId, edResolved.workspaceId, edResolved.userId);
            if (!card) {
              // Phase 1.29: transaction may be soft-deleted (deleted_at IS NOT NULL).
              // Graceful degradation: safe message + clear keyboard.
              // Also handles IDOR attempt (txId not in this workspace).
              if (messageId) void editMessageText(chatId, messageId, '⚠️ Транзакция не найдена или уже удалена.', { inline_keyboard: [] });
            } else {
              const text = formatTransactionCard(card);
              const keyboard = buildTransactionCardKeyboard(cmd.txId, card.is_cross_currency);
              if (messageId) void editMessageText(chatId, messageId, text, keyboard);
            }

          } else if (cmd.cmd === 'field_amount') {
            // Set Redis state — next text message from this user is the new amount
            const rKey = editStateKey(telegramUserId, chatId);
            await redisConnection.set(rKey, `amt:${cmd.txId}`, 'EX', EDIT_STATE_TTL_SEC);
            void upsertBotMessage(telegramUserId, chatId, '💰 Текущая сумма изменится. Напиши новое значение (например: 380 или 1500.50):');

          } else if (cmd.cmd === 'field_cat') {
            const categories = await getWorkspaceCategories(edResolved.workspaceId, edResolved.userId);
            if (categories.length === 0) {
              void upsertBotMessage(telegramUserId, chatId, '⚠️ В рабочем пространстве нет категорий.');
            } else {
              const keyboard = buildCategoryPickerKeyboard(cmd.txId, categories, cmd.page);
              if (messageId) void editMessageText(chatId, messageId, '📁 Выберите новую категорию:', keyboard);
            }

          } else if (cmd.cmd === 'field_acc') {
            const accounts = await getWorkspaceAccounts(edResolved.workspaceId, edResolved.userId);
            if (accounts.length === 0) {
              void upsertBotMessage(telegramUserId, chatId, '⚠️ В рабочем пространстве нет счетов.');
            } else {
              const keyboard = buildAccountPickerKeyboard(cmd.txId, accounts);
              if (messageId) void editMessageText(chatId, messageId, '🏦 Выберите новый счёт:', keyboard);
            }

          } else if (cmd.cmd === 'field_int') {
            const keyboard = buildIntentPickerKeyboard(cmd.txId);
            if (messageId) void editMessageText(chatId, messageId, '🔄 Выберите тип транзакции:', keyboard);

          } else if (cmd.cmd === 'confirm_cat') {
            const res = await updateTransactionCategory(
              cmd.txId, edResolved.workspaceId, edResolved.userId, cmd.catId,
            );
            if (res.status === 'ok') {
              const card = await getTransactionCard(cmd.txId, edResolved.workspaceId, edResolved.userId);
              if (card && messageId) {
                void editMessageText(chatId, messageId, formatTransactionCard(card), buildTransactionCardKeyboard(cmd.txId, card.is_cross_currency));
              }
              request.log.info({ msg: '[midas:bot:webhook] edit: category updated', txId: cmd.txId, workspaceId: edResolved.workspaceId });
            } else if (res.status === 'invalid_category') {
              void upsertBotMessage(telegramUserId, chatId, '⚠️ Категория не найдена.');
            } else {
              void upsertBotMessage(telegramUserId, chatId, '⚠️ Транзакция не найдена.');
            }

          } else if (cmd.cmd === 'confirm_acc') {
            const res = await updateTransactionAccount(
              cmd.txId, edResolved.workspaceId, edResolved.userId, cmd.accId,
            );
            if (res.status === 'ok') {
              const card = await getTransactionCard(cmd.txId, edResolved.workspaceId, edResolved.userId);
              if (card && messageId) {
                void editMessageText(chatId, messageId, formatTransactionCard(card), buildTransactionCardKeyboard(cmd.txId, card.is_cross_currency));
              }
              request.log.info({ msg: '[midas:bot:webhook] edit: account updated', txId: cmd.txId, workspaceId: edResolved.workspaceId });
            } else if (res.status === 'invalid_account') {
              void upsertBotMessage(telegramUserId, chatId, '⚠️ Счёт не найден.');
            } else {
              void upsertBotMessage(telegramUserId, chatId, '⚠️ Транзакция не найдена.');
            }

          } else {
            // confirm_int | delete_ask | delete_confirm
            // All other branches exhausted above — remaining union is always one of these three.
            if (cmd.cmd === 'confirm_int') {
              // confirm_int
              const res = await updateTransactionIntent(
                cmd.txId, edResolved.workspaceId, edResolved.userId, cmd.intent,
              );
              if (res.status === 'ok') {
                const card = await getTransactionCard(cmd.txId, edResolved.workspaceId, edResolved.userId);
                if (card && messageId) {
                  void editMessageText(chatId, messageId, formatTransactionCard(card), buildTransactionCardKeyboard(cmd.txId, card.is_cross_currency));
                }
                request.log.info({ msg: '[midas:bot:webhook] edit: intent updated', txId: cmd.txId, workspaceId: edResolved.workspaceId });
              } else {
                void upsertBotMessage(telegramUserId, chatId, '⚠️ Транзакция не найдена.');
              }

            } else if (cmd.cmd === 'delete_ask') {
              // Phase 1.29: show delete warning state.
              const card = await getTransactionCard(cmd.txId, edResolved.workspaceId, edResolved.userId);
              if (!card) {
                // Soft-deleted already, or IDOR — graceful degradation.
                if (messageId) void editMessageText(chatId, messageId, '⚠️ Транзакция не найдена или уже удалена.', { inline_keyboard: [] });
              } else {
                const warningText =
                  '⚠️ <b>Удалить транзакцию?</b>\n\n' +
                  `${formatTransactionCard(card)}\n` +
                  'Транзакция будет скрыта из всех отчётов и баланс автоматически пересчитается.';
                const keyboard = buildDeleteConfirmKeyboard(cmd.txId);
                if (messageId) void editMessageText(chatId, messageId, warningText, keyboard);
              }

            } else {
              // delete_confirm: last branch — Phase 1.29 execute soft delete.
              const res = await softDeleteTransaction(cmd.txId, edResolved.workspaceId, edResolved.userId);
              if (res.status === 'ok') {
                if (messageId) void editMessageText(chatId, messageId, '✅ Транзакция удалена. Баланс и отчёт пересчитаны автоматически.', { inline_keyboard: [] });
                request.log.info({ msg: '[midas:bot:webhook] edit: transaction soft-deleted', txId: cmd.txId, workspaceId: edResolved.workspaceId });
              } else {
                // 'not_found' or 'already_deleted' — safe fallback
                if (messageId) void editMessageText(chatId, messageId, '⚠️ Транзакция не найдена или уже удалена.', { inline_keyboard: [] });
              }
            }
          } // end Phase 1.29 delete / confirm_int branch
        } catch (err: unknown) {
          const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
          request.log.error({
            msg: '[midas:bot:webhook] edit callback failed',
            callbackId: cq.id,
            errorClass,
          });
        }

        await answerCallbackQuery(cq.id);
        await reply.status(200).send({ ok: true });
        return;
      }

      // ── Phase 1.26: settings callbacks (prefix "st:") ────────
      // Handled synchronously — no queue needed (no transactions, lightweight DB).
      if (callbackData.startsWith('st:')) {
        const cmd = parseSettingsCallback(callbackData);
        if (!cmd) {
          // Malformed settings callback — silently ack
          request.log.warn({
            msg: '[midas:bot:webhook] settings callback: unrecognised data — acknowledged',
            callbackId: cq.id,
          });
          await reply.status(200).send({ ok: true });
          return;
        }

        // SEC-03: resolve workspace from trusted source (DB), NOT from callback_data
        let stResolved: { workspaceId: string; userId: string };
        try {
          stResolved = await resolveWorkspace(telegramUserId, chatId);
        } catch {
          await answerCallbackQuery(cq.id);
          await reply.status(200).send({ ok: true });
          return;
        }

        const messageId = cq.message ? String(cq.message.message_id) : null;

        try {
          if (cmd.cmd === 'cancel') {
            // Phase 2.9+: Silent close — just delete the nav message, no "закрыто" text sent
            if (messageId) {
              void deleteMessage(chatId, messageId);
              void clearNavMessageId(telegramUserId, chatId);
            }
          } else if (cmd.cmd === 'menu' || cmd.cmd === 'grouppicker' || cmd.cmd === 'back') {
            if (cmd.cmd === 'menu' || cmd.cmd === 'back') {
              // Re-show main menu (refresh)
              const settings = await getSettings(stResolved.workspaceId, stResolved.userId);
              const text = formatSettingsMenuText(
                settings?.default_currency ?? 'USDT',
                settings?.timezone ?? 'UTC',
                settings?.main_account_name ?? null,
              );
              if (messageId) {
                void editMessageText(chatId, messageId, text, buildSettingsMainKeyboard());
              }
            } else {
              // Show group picker
              if (messageId) {
                void editMessageText(chatId, messageId, GROUP_PICKER_TEXT, buildGroupPickerKeyboard());
              }
            }
          } else if (cmd.cmd === 'group' || cmd.cmd === 'page') {
            const text = formatCurrencyPageText(cmd.group, cmd.page);
            const keyboard = buildCurrencyPageKeyboard(cmd.group, cmd.page);
            if (messageId) {
              void editMessageText(chatId, messageId, text, keyboard);
            }
          } else if (cmd.cmd === 'pick') {
            // Validate code is 3-5 uppercase letters (already done in parseSettingsCallback)
            const before = await getSettings(stResolved.workspaceId, stResolved.userId);
            const oldCode = before?.default_currency ?? '?';
            await updateCurrency(stResolved.workspaceId, stResolved.userId, cmd.code);
            // Phase 1.38: Mark that user explicitly set a currency
            await redisConnection.set(`midas:cur_set:${stResolved.workspaceId}`, '1');
            const confirmText = formatPickConfirmText(cmd.code, oldCode);
            const backToSettingsKb = {
              inline_keyboard: [
                [{ text: '⚙️ Назад в настройки', callback_data: 'st:back' }],
              ],
            };
            if (messageId) {
              void editMessageText(chatId, messageId, confirmText, backToSettingsKb);
            }
            request.log.info({
              msg: '[midas:bot:webhook] settings: currency updated via UI',
              telegramUserId,
              workspaceId: stResolved.workspaceId,
              // code NOT logged (SEC-12 consistency)
            });
          } else if (cmd.cmd === 'search') {
            // Set Redis TTL search mode key
            const rKey = searchModeKey(telegramUserId, chatId);
            await redisConnection.set(rKey, '1', 'EX', SEARCH_MODE_TTL_SEC);
            void upsertBotMessage(telegramUserId, chatId, '🔍 Напиши символ или название валюты:');
          } else if (cmd.cmd === 'default_account_picker') {
            // Phase 1.35: Show account picker keyboard
            const accounts = await getWorkspaceAccounts(stResolved.workspaceId, stResolved.userId);
            const settings = await getSettings(stResolved.workspaceId, stResolved.userId);
            const currentId = settings?.default_expense_account_id ?? null;

            const text = '🏦 <b>Основной счет</b>\n\nВыберите счет по умолчанию. По нему будет вестись базовый Cashflow (списания и пополнения), если при создании транзакции вы не укажете конкретный счет.\n\nВыберите счет из списка ваших активных балансов:';

            const { buildAccountPickerKeyboard } = await import('../services/settings.service.js');
            const keyboard = buildAccountPickerKeyboard(accounts, currentId);

            if (messageId) {
              void editMessageText(chatId, messageId, text, keyboard);
            }
          } else if (cmd.cmd === 'default_account_set') {
            // Phase 1.35: Set default account
            await setDefaultAccount(stResolved.workspaceId, stResolved.userId, cmd.accountId);
            // Return to main menu
            const settings = await getSettings(stResolved.workspaceId, stResolved.userId);
            const text = formatSettingsMenuText(
              settings?.default_currency ?? 'USDT',
              settings?.timezone ?? 'UTC',
              settings?.main_account_name ?? null,
            );
            if (messageId) {
              void editMessageText(chatId, messageId, text, buildSettingsMainKeyboard());
            }
            request.log.info({
              msg: '[midas:bot:webhook] settings: default account set',
              telegramUserId,
            });
          } else if (cmd.cmd === 'default_account_clear') {
            // Phase 1.35: Clear default account
            await setDefaultAccount(stResolved.workspaceId, stResolved.userId, null);
            const settings = await getSettings(stResolved.workspaceId, stResolved.userId);
            const text = formatSettingsMenuText(
              settings?.default_currency ?? 'USDT',
              settings?.timezone ?? 'UTC',
              settings?.main_account_name ?? null,
            );
            if (messageId) {
              void editMessageText(chatId, messageId, text, buildSettingsMainKeyboard());
            }
          }
          // ── Phase 2.0: advanced settings handlers ──
          else if (cmd.cmd === 'categories') {
            // Show workspace categories list (reuse existing category.service)
            const { getCategoryList } = await import('../services/category.service.js');
            const catText = await getCategoryList(stResolved.workspaceId, stResolved.userId);
            const kb = { inline_keyboard: [[{ text: '← Назад', callback_data: 'st:back' }]] };
            if (messageId) void editMessageText(chatId, messageId, catText, kb);
          }
          else if (cmd.cmd === 'notifications') {
            const { getUserPreferences } = await import('../services/settings-advanced.service.js');
            const prefs = await getUserPreferences(stResolved.workspaceId, stResolved.userId);
            const ds = prefs.dailySummaryEnabled ? '✅' : '❌';
            const la = prefs.limitAlertsEnabled ? '✅' : '❌';
            const rr = prefs.recordReminderEnabled ? '✅' : '❌';
            let text = '🔔 <b>Уведомления</b>\n\n';
            text += `📊 Ежедневная сводка:  ${ds} (${String(prefs.dailySummaryHour)}:00)\n`;
            text += `⚠️ Лимит по категории: ${la}\n`;
            text += `📝 Напоминание записи: ${rr}\n`;
            const kb = {
              inline_keyboard: [
                [{ text: `📊 Сводка: ${prefs.dailySummaryEnabled ? 'выкл' : 'вкл'}`, callback_data: 'st:ntf:ds' }],
                [{ text: `⚠️ Лимиты: ${prefs.limitAlertsEnabled ? 'выкл' : 'вкл'}`, callback_data: 'st:ntf:la' }],
                [{ text: `📝 Напоминания: ${prefs.recordReminderEnabled ? 'выкл' : 'вкл'}`, callback_data: 'st:ntf:rr' }],
                [{ text: '← Назад', callback_data: 'st:back' }],
              ]
            };
            if (messageId) void editMessageText(chatId, messageId, text, kb);
          }
          else if (cmd.cmd === 'ntf_toggle') {
            const { getUserPreferences, updateNotificationSetting } = await import('../services/settings-advanced.service.js');
            const prefs = await getUserPreferences(stResolved.workspaceId, stResolved.userId);
            const keyMap = { ds: 'daily_summary_enabled' as const, la: 'limit_alerts_enabled' as const, rr: 'record_reminder_enabled' as const };
            const dbKey = keyMap[cmd.key];
            const currentVal = cmd.key === 'ds' ? prefs.dailySummaryEnabled : cmd.key === 'la' ? prefs.limitAlertsEnabled : prefs.recordReminderEnabled;
            await updateNotificationSetting(stResolved.workspaceId, stResolved.userId, dbKey, !currentVal);
            // Re-render notifications screen (re-trigger cmd)
            const prefs2 = await getUserPreferences(stResolved.workspaceId, stResolved.userId);
            const ds2 = prefs2.dailySummaryEnabled ? '✅' : '❌';
            const la2 = prefs2.limitAlertsEnabled ? '✅' : '❌';
            const rr2 = prefs2.recordReminderEnabled ? '✅' : '❌';
            let text2 = '🔔 <b>Уведомления</b>\n\n';
            text2 += `📊 Ежедневная сводка:  ${ds2} (${String(prefs2.dailySummaryHour)}:00)\n`;
            text2 += `⚠️ Лимит по категории: ${la2}\n`;
            text2 += `📝 Напоминание записи: ${rr2}\n`;
            const kb2 = {
              inline_keyboard: [
                [{ text: `📊 Сводка: ${prefs2.dailySummaryEnabled ? 'выкл' : 'вкл'}`, callback_data: 'st:ntf:ds' }],
                [{ text: `⚠️ Лимиты: ${prefs2.limitAlertsEnabled ? 'выкл' : 'вкл'}`, callback_data: 'st:ntf:la' }],
                [{ text: `📝 Напоминания: ${prefs2.recordReminderEnabled ? 'выкл' : 'вкл'}`, callback_data: 'st:ntf:rr' }],
                [{ text: '← Назад', callback_data: 'st:back' }],
              ]
            };
            if (messageId) void editMessageText(chatId, messageId, text2, kb2);
          }
          else if (cmd.cmd === 'number_format') {
            const { getUserPreferences } = await import('../services/settings-advanced.service.js');
            const prefs = await getUserPreferences(stResolved.workspaceId, stResolved.userId);
            const fmt = prefs.numberFormat;
            let text = '🔢 <b>Формат отображения</b>\n\n';
            text += `Текущий: <b>${fmt === 'ru' ? '1 234 567,89' : fmt === 'en' ? '1,234,567.89' : '1.234.567,89'}</b>\n`;
            const kb = {
              inline_keyboard: [
                [{ text: `1,234,567.89 ${fmt === 'en' ? '✓' : ''}`, callback_data: 'st:nf:s:en' }],
                [{ text: `1 234 567,89 ${fmt === 'ru' ? '✓' : ''}`, callback_data: 'st:nf:s:ru' }],
                [{ text: `1.234.567,89 ${fmt === 'de' ? '✓' : ''}`, callback_data: 'st:nf:s:de' }],
                [{ text: '← Назад', callback_data: 'st:back' }],
              ]
            };
            if (messageId) void editMessageText(chatId, messageId, text, kb);
          }
          else if (cmd.cmd === 'nf_set') {
            const { updateNumberFormat } = await import('../services/settings-advanced.service.js');
            await updateNumberFormat(stResolved.workspaceId, stResolved.userId, cmd.format as 'ru' | 'en' | 'de');
            const fmtLabel = cmd.format === 'ru' ? '1 234 567,89' : cmd.format === 'en' ? '1,234,567.89' : '1.234.567,89';
            if (messageId) void editMessageText(chatId, messageId, `✅ Формат чисел: <b>${fmtLabel}</b>`, { inline_keyboard: [[{ text: '← Назад', callback_data: 'st:back' }]] });
          }
          else if (cmd.cmd === 'language_menu') {
            const { getUserPreferences } = await import('../services/settings-advanced.service.js');
            const prefs = await getUserPreferences(stResolved.workspaceId, stResolved.userId);
            const lang = prefs.language;
            const kb = {
              inline_keyboard: [
                [{ text: `🇷🇺 Русский ${lang === 'ru' ? '✓' : ''}`, callback_data: 'st:lang:s:ru' }],
                [{ text: `🇬🇧 English ${lang === 'en' ? '✓' : ''}`, callback_data: 'st:lang:s:en' }],
                [{ text: `🇺🇦 Українська ${lang === 'ua' ? '✓' : ''}`, callback_data: 'st:lang:s:ua' }],
                [{ text: '← Назад', callback_data: 'st:back' }],
              ]
            };
            if (messageId) void editMessageText(chatId, messageId, '🌍 <b>Язык интерфейса</b>', kb);
          }
          else if (cmd.cmd === 'lang_set') {
            const { updateLanguage } = await import('../services/settings-advanced.service.js');
            await updateLanguage(stResolved.workspaceId, stResolved.userId, cmd.lang as 'ru' | 'en' | 'ua');
            const langLabel = cmd.lang === 'ru' ? '🇷🇺 Русский' : cmd.lang === 'en' ? '🇬🇧 English' : '🇺🇦 Українська';
            if (messageId) void editMessageText(chatId, messageId, `✅ Язык: <b>${langLabel}</b>`, { inline_keyboard: [[{ text: '← Назад', callback_data: 'st:back' }]] });
          }
          else if (cmd.cmd === 'export_menu' || cmd.cmd === 'export_csv') {
            if (cmd.cmd === 'export_menu') {
              const kb = {
                inline_keyboard: [
                  [{ text: '📄 Скачать CSV', callback_data: 'st:exp:csv' }],
                  [{ text: '← Назад', callback_data: 'st:back' }],
                ]
              };
              if (messageId) void editMessageText(chatId, messageId, '📤 <b>Экспорт данных</b>\n\nВыберите формат:', kb);
            } else {
              // Generate CSV and send as document
              const { exportTransactionsCSV } = await import('../services/settings-advanced.service.js');
              const csvBuf = await exportTransactionsCSV(stResolved.workspaceId, stResolved.userId);
              const { sendDocument } = await import('../services/telegram-api.js');
              await sendDocument(chatId, csvBuf, 'midas_export.csv', 'Экспорт транзакций Midas');
              if (messageId) void editMessageText(chatId, messageId, '✅ Файл отправлен.', { inline_keyboard: [[{ text: '← Назад', callback_data: 'st:back' }]] });
            }
          }
          else if (cmd.cmd === 'info') {
            const infoText = `✨ <b>Midas — ваш интеллектуальный финансовый ассистент.</b>

Midas создан, чтобы сделать учет денег максимально простым, быстрым и профессиональным. Забудьте о скучных таблицах и ручном вводе — доверьте рутину Искусственному Интеллекту.

<b>Ключевые возможности:</b>
🎙 <b>Голосовой и текстовый ввод:</b> Просто скажите или напишите транзакцию, и ИИ сам поймет сумму, валюту и намерение.
🧠 <b>Автоматическое определение категорий:</b> Нейросеть с высочайшей точностью распределяет ваши траты и доходы.
📊 <b>Глубокий анализ и Кэшфлоу (Cashflow):</b> Полный контроль над вашим денежным потоком и статистикой.
💳 <b>Создание и настройка счетов:</b> Легкое добавление карт, наличных или крипты, выбор основного счета для автоматических списаний.
⚡️ <b>Легкое управление транзакциями:</b> Интерактивные карточки позволяют в один клик изменить категорию, счет или исправить ошибку.

Мы используем передовые технологии безопасности и строго соблюдаем конфиденциальность ваших данных.`;
            const kb = { inline_keyboard: [[{ text: '← Назад', callback_data: 'st:back' }]] };
            if (messageId) void editMessageText(chatId, messageId, infoText, kb);
          }
          // ── Phase 2.2: Timezone ─────────────────────────────────
          else if (cmd.cmd === 'timezone_menu') {
            const settings = await getSettings(stResolved.workspaceId, stResolved.userId);
            const current = settings?.timezone ?? 'UTC';
            const { getTzOffset } = await import('../services/timezones.js');
            const offset = getTzOffset(current);
            const tzText =
              `🕒 <b>Часовой пояс</b>\n\n` +
              `Текущий: <b>${escapeHtml(current)}</b>${offset ? ` (${escapeHtml(offset)})` : ''}\n\n` +
              `Часовой пояс используется для отображения времени транзакций, ежедневной сводки и напоминаний.\n\n` +
              `Введите название вашего <b>города или страны</b> на русском или английском — и я найду нужный пояс:`;
            const tzKb = {
              inline_keyboard: [
                [{ text: '← Назад', callback_data: 'st:back' }],
              ],
            };
            // Activate tz search mode: next text from this user = timezone query
            await redisConnection.set(`midas:tz_srch:${telegramUserId}:${chatId}`, messageId?.toString() ?? '0', 'EX', 300);
            if (messageId) void editMessageText(chatId, messageId, tzText, tzKb);
          }
          else if (cmd.cmd === 'timezone_country') {
            const { MULTI_TZ_COUNTRIES } = await import('../services/timezones.js');
            const country = MULTI_TZ_COUNTRIES[cmd.countryIndex];
            if (!country) {
              if (messageId) void editMessageText(chatId, messageId, '⚠️ Страна не найдена.', { inline_keyboard: [[{ text: '← Назад', callback_data: 'st:tz' }]] });
            } else {
              const countryText = `${country.flag} <b>${escapeHtml(country.nameRu)}</b>\n\nВыберите ваш регион или город:`;
              const zoneRows = country.zones.map((z) => {
                const encoded = Buffer.from(z.iana).toString('base64url');
                return [{ text: z.label, callback_data: `st:tz:p:${encoded}` }];
              });
              zoneRows.push([{ text: '← Назад', callback_data: 'st:tz' }]);
              if (messageId) void editMessageText(chatId, messageId, countryText, { inline_keyboard: zoneRows });
            }
          }
          else if (cmd.cmd === 'timezone_pick') {
            const { ALL_TIMEZONES, getTzOffset } = await import('../services/timezones.js');
            if (!ALL_TIMEZONES.has(cmd.iana)) {
              if (messageId) void editMessageText(chatId, messageId, '⚠️ Недопустимый часовой пояс. Попробуйте снова.', { inline_keyboard: [[{ text: '← Назад', callback_data: 'st:tz' }]] });
            } else {
              const before = await getSettings(stResolved.workspaceId, stResolved.userId);
              const oldZone = before?.timezone ?? 'UTC';
              await updateTimezone(stResolved.workspaceId, stResolved.userId, cmd.iana);
              await redisConnection.del(`midas:tz_srch:${telegramUserId}:${chatId}`);
              const offset = getTzOffset(cmd.iana);
              const tzConfirm =
                `✅ <b>Часовой пояс обновлён</b>\n\n` +
                `<b>${escapeHtml(cmd.iana)}</b>${offset ? ` (${escapeHtml(offset)})` : ''}\n` +
                `Было: ${escapeHtml(oldZone)}\n\n` +
                `Все временны́е метки теперь отображаются в вашем часовом поясе.`;
              const tzConfirmKb = { inline_keyboard: [[{ text: '⚙️ Назад в настройки', callback_data: 'st:back' }]] };
              if (messageId) void editMessageText(chatId, messageId, tzConfirm, tzConfirmKb);
              request.log.info({ msg: '[midas:bot:webhook] settings: timezone updated', telegramUserId });
            }
          }
        } catch (err: unknown) {
          const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
          request.log.error({
            msg: '[midas:bot:webhook] settings callback failed',
            callbackId: cq.id,
            errorClass,
          });
        }

        await answerCallbackQuery(cq.id);
        await reply.status(200).send({ ok: true });
        return;
      }

      // ── Phase 1.35: draft edit sub-menu (prefix "draft:edit:" / "draft:back:") ──
      // draft:edit:{draftId} — opens field picker for an unconfirmed draft.
      // draft:back:{draftId} — restores confirmation card.
      // Byte sizes: draft:edit:{26} = 37 ✓  draft:back:{26} = 37 ✓
      if (callbackData.startsWith('draft:edit:') || callbackData.startsWith('draft:back:')) {
        const isBack = callbackData.startsWith('draft:back:');
        const draftEditId = isBack
          ? callbackData.slice('draft:back:'.length)
          : callbackData.slice('draft:edit:'.length);

        // Validate draftId format (ULID_RE)
        if (!/^[0-9A-Z]{26}$/.test(draftEditId)) {
          await answerCallbackQuery(cq.id);
          await reply.status(200).send({ ok: true });
          return;
        }

        try {
          const deResolved = await resolveWorkspace(telegramUserId, chatId);
          const draft = await getDraftFields(deResolved.workspaceId, deResolved.userId, draftEditId);

          if (!draft) {
            // Expired or not found
            void upsertBotMessage(
              telegramUserId, chatId,
              '⏰ <b>Черновик истёк</b>\n\nОтправьте сообщение повторно.',
            );
            await answerCallbackQuery(cq.id);
            await reply.status(200).send({ ok: true });
            return;
          }

          if (isBack) {
            // Restore confirmation card
            const previewRes = await confirmPreviewFull(deResolved.workspaceId, deResolved.userId, draftEditId);
            if (cq.message?.message_id) {
              void editMessageText(chatId, String(cq.message.message_id), previewRes.text, confirmKbForDraft(draftEditId, previewRes));
              try { await redisConnection.set(`midas:preview:${draftEditId}`, String(cq.message.message_id), 'EX', 3600); } catch { /* non-fatal */ }
            } else {
              void upsertBotMessage(telegramUserId, chatId, previewRes.text, confirmKbForDraft(draftEditId, previewRes));
            }
          } else {
            // Show edit sub-menu
            const { intentEmoji, intentLabel, formatAmount } = await import('../utils/screen-builder.js');
            const iLabel = draft.parsed_intent
              ? `${intentEmoji(draft.parsed_intent)} ${intentLabel(draft.parsed_intent)}`
              : null;
            const lines = ['✏️ <b>Что изменить?</b>', ''];
            if (iLabel) lines.push(iLabel);
            if (draft.parsed_amount) lines.push(`Сумма: <b>${formatAmount(draft.parsed_amount)} ${draft.parsed_currency ?? 'USDT'}</b>`);
            if (draft.item_name) lines.push(`Товар: ${draft.item_name}`);

            const subKeyboard = {
              inline_keyboard: [
                [
                  { text: '💰 Сумму', callback_data: `draft:amt:${draftEditId}` },
                  { text: '📁 Категорию', callback_data: `draft:cat:${draftEditId}` },
                ],
                [
                  { text: '🔄 Тип', callback_data: `draft:intent:${draftEditId}` },
                  { text: '💱 Валюту', callback_data: `draft:cur:${draftEditId}` },
                ],
                [
                  { text: '◀️ Назад', callback_data: `draft:back:${draftEditId}` },
                ],
              ],
            };
            // Byte checks: draft:amt:{26}=35, draft:cat:{26}=35, draft:intent:{26}=39, draft:cur:{26}=35 ✓
            void upsertBotMessage(telegramUserId, chatId, lines.join('\n'), subKeyboard);
          }
        } catch (err: unknown) {
          const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
          request.log.error({ msg: '[midas:bot:webhook] draft:edit: failed', callbackId: cq.id, errorClass });
        }

        await answerCallbackQuery(cq.id);
        await reply.status(200).send({ ok: true });
        return;
      }

      // ── Phase 1.35: draft field-edit sub-actions ──
      // draft:amt:{draftId}    — set Redis intercept for amount
      // draft:cat:{draftId}    — show category picker
      // draft:intent:{draftId} — show intent picker
      // Byte checks: draft:amt:{26}=35, draft:cat:{26}=35, draft:intent:{26}=39 ✓
      if (
        callbackData.startsWith('draft:amt:') ||
        callbackData.startsWith('draft:cat:') ||
        callbackData.startsWith('draft:intent:')
      ) {
        const isAmt = callbackData.startsWith('draft:amt:');
        const isCat = callbackData.startsWith('draft:cat:');
        const draftSubId = isAmt
          ? callbackData.slice('draft:amt:'.length)
          : isCat
            ? callbackData.slice('draft:cat:'.length)
            : callbackData.slice('draft:intent:'.length);

        if (!/^[0-9A-Z]{26}$/.test(draftSubId)) {
          await answerCallbackQuery(cq.id);
          await reply.status(200).send({ ok: true });
          return;
        }

        try {
          const dsResolved = await resolveWorkspace(telegramUserId, chatId);

          if (isAmt) {
            // Set Redis intercept key — same as clarification amount flow
            const clarKey = `midas:clar:${telegramUserId}:${chatId}`;
            await redisConnection.set(clarKey, `${draftSubId}:amt`, 'EX', 300);
            void upsertBotMessage(
              telegramUserId, chatId,
              '💰 Напиши новую сумму:',
            );
          } else if (isCat) {
            // Reuse existing category picker from clar:cat: flow
            const { getWorkspaceCategories } = await import('../services/edit.service.js');
            const categories = await getWorkspaceCategories(dsResolved.workspaceId, dsResolved.userId);
            // Build a clar:cat: keyboard so existing handlers process the result
            const rows: { text: string; callback_data: string }[][] = [];
            const top6 = categories.slice(0, 6);
            for (let i = 0; i < top6.length; i += 2) {
              const row = [{ text: top6[i]?.name ?? '', callback_data: `clar:cat:${top6[i]?.id ?? ''}:${draftSubId}` }];
              if (top6[i + 1]) row.push({ text: top6[i + 1]?.name ?? '', callback_data: `clar:cat:${top6[i + 1]?.id ?? ''}:${draftSubId}` });
              rows.push(row);
            }
            rows.push([{ text: '📋 Без категории', callback_data: `clar:nocat:${draftSubId}` }]);
            rows.push([{ text: '◀️ Назад', callback_data: `draft:back:${draftSubId}` }]);
            void upsertBotMessage(
              telegramUserId, chatId,
              '📁 <b>Выбери категорию:</b>',
              { inline_keyboard: rows },
            );
          } else {
            // Intent picker — reuse clar:intent: keyboard
            const intentKeyboard = {
              inline_keyboard: [
                [
                  { text: '💸 Расход', callback_data: `clar:intent:expense:${draftSubId}` },
                  { text: '💰 Доход', callback_data: `clar:intent:income:${draftSubId}` },
                ],
                [
                  { text: '🤝 Долг (дал)', callback_data: `clar:intent:debt_given:${draftSubId}` },
                  { text: '🤲 Долг (взял)', callback_data: `clar:intent:debt_received:${draftSubId}` },
                ],
                [
                  { text: '◀️ Назад', callback_data: `draft:back:${draftSubId}` },
                ],
              ],
            };
            void upsertBotMessage(
              telegramUserId, chatId,
              '🔄 <b>Выбери тип операции:</b>',
              intentKeyboard,
            );
          }
        } catch (err: unknown) {
          const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
          request.log.error({ msg: '[midas:bot:webhook] draft sub-action failed', callbackId: cq.id, errorClass });
        }

        await answerCallbackQuery(cq.id);
        await reply.status(200).send({ ok: true });
        return;
      }

      // ── Phase 1.35: currency picker (prefix "draft:cur:" / "draft:setcur:") ──
      // draft:cur:{draftId}              — shows currency picker buttons
      // draft:setcur:{currency}:{draftId} — patches parsed_currency
      // Byte checks: draft:cur:{26}=35 ✓  draft:setcur:USDT:{26}=44 ✓
      if (callbackData.startsWith('draft:cur:') || callbackData.startsWith('draft:setcur:')) {
        const isSet = callbackData.startsWith('draft:setcur:');

        let curDraftId: string;
        let curValue: string | null = null;

        if (isSet) {
          // draft:setcur:{currency}:{draftId}
          const afterPrefix = callbackData.slice('draft:setcur:'.length);
          const colonIdx = afterPrefix.lastIndexOf(':');
          curDraftId = afterPrefix.slice(colonIdx + 1);
          curValue = afterPrefix.slice(0, colonIdx);
        } else {
          curDraftId = callbackData.slice('draft:cur:'.length);
        }

        if (!/^[0-9A-Z]{26}$/.test(curDraftId)) {
          await answerCallbackQuery(cq.id);
          await reply.status(200).send({ ok: true });
          return;
        }

        try {
          const curResolved = await resolveWorkspace(telegramUserId, chatId);

          if (isSet && curValue) {
            // SEC-01: validate currency code
            const validCur = validateCurrencyCode(curValue);
            if (!validCur) {
              await answerCallbackQuery(cq.id, '❌ Неверный код валюты');
              await reply.status(200).send({ ok: true });
              return;
            }
            const patchRes = await patchDraftCurrency(
              curResolved.workspaceId, curResolved.userId, curDraftId, validCur,
            );
            if (patchRes.status === 'ready') {
              // Refresh draft and restore confirm card
              const refreshed = await getDraftFields(curResolved.workspaceId, curResolved.userId, curDraftId);
              if (refreshed) {
                const previewRes = await confirmPreviewFull(curResolved.workspaceId, curResolved.userId, curDraftId);
                if (cq.message?.message_id) {
                  void editMessageText(chatId, String(cq.message.message_id), previewRes.text, confirmKbForDraft(curDraftId, previewRes));
                  try { await redisConnection.set(`midas:preview:${curDraftId}`, String(cq.message.message_id), 'EX', 3600); } catch { /* non-fatal */ }
                } else {
                  void upsertBotMessage(telegramUserId, chatId, previewRes.text, confirmKbForDraft(curDraftId, previewRes));
                }
              }
            } else {
              void upsertBotMessage(telegramUserId, chatId, '⏰ <b>Черновик истёк</b>\n\nОтправьте сообщение повторно.');
            }
          } else {
            // Show currency picker
            // Top-8 currencies as inline buttons
            const currencyKeyboard = {
              inline_keyboard: [
                [
                  { text: 'USDT', callback_data: `draft:setcur:USDT:${curDraftId}` },
                  { text: 'USD', callback_data: `draft:setcur:USD:${curDraftId}` },
                  { text: 'EUR', callback_data: `draft:setcur:EUR:${curDraftId}` },
                  { text: 'RUB', callback_data: `draft:setcur:RUB:${curDraftId}` },
                ],
                [
                  { text: 'BTC', callback_data: `draft:setcur:BTC:${curDraftId}` },
                  { text: 'ETH', callback_data: `draft:setcur:ETH:${curDraftId}` },
                  { text: 'GBP', callback_data: `draft:setcur:GBP:${curDraftId}` },
                  { text: 'CNY', callback_data: `draft:setcur:CNY:${curDraftId}` },
                ],
                [
                  { text: '◀️ Назад', callback_data: `draft:edit:${curDraftId}` },
                ],
              ],
            };
            // Byte: draft:setcur:USDT:{26} = 44 ✓
            void upsertBotMessage(
              telegramUserId, chatId,
              '💱 <b>Выбери валюту:</b>',
              currencyKeyboard,
            );
          }
        } catch (err: unknown) {
          const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
          request.log.error({ msg: '[midas:bot:webhook] draft:cur: failed', callbackId: cq.id, errorClass });
        }

        await answerCallbackQuery(cq.id);
        await reply.status(200).send({ ok: true });
        return;
      }

      // ── Phase 1.32: clarification callbacks (prefix "clar:") ─────
      // Handles: clar:intent:{value}:{draftId}, clar:cat:{catId}:{draftId},
      //          clar:nocat:{draftId}, clar:cmd:{balance|report}
      // All callback_data ≤ 62 bytes (verified in advisory).
      if (callbackData.startsWith('clar:')) {
        const parts = callbackData.split(':');
        const clarAction = parts[1] ?? '';

        // ── clar:cmd:balance / clar:cmd:report ──
        // These are shortcut buttons from nonsense keyboard — trigger commands,
        // do NOT patch any draft. The nonsense draft is simply abandoned.
        if (clarAction === 'cmd') {
          const cmdTarget = parts[2] ?? '';
          if (cmdTarget === 'balance') {
            try {
              const cmdResolved = await resolveWorkspace(telegramUserId, chatId);
              const { getAccountBalances } = await import('../services/balance.service.js');
              const balanceText = await getAccountBalances(cmdResolved.workspaceId, cmdResolved.userId);
              void upsertBotMessage(telegramUserId, chatId, balanceText);
            } catch {
              void upsertBotMessage(telegramUserId, chatId, '⚠️ Не удалось получить баланс. Попробуйте позже.');
            }
          } else if (cmdTarget === 'report') {
            try {
              const cmdResolved = await resolveWorkspace(telegramUserId, chatId);
              const reportText = await getMonthlyReport(cmdResolved.workspaceId, cmdResolved.userId);
              void upsertBotMessage(telegramUserId, chatId, reportText);
            } catch {
              void upsertBotMessage(telegramUserId, chatId, '⚠️ Не удалось получить отчёт. Попробуйте позже.');
            }
          }
          await answerCallbackQuery(cq.id);
          await reply.status(200).send({ ok: true });
          return;
        }

        // All remaining clar: callbacks require workspace resolution.
        let clarResolved: { workspaceId: string; userId: string };
        try {
          clarResolved = await resolveWorkspace(telegramUserId, chatId);
        } catch {
          await answerCallbackQuery(cq.id);
          await reply.status(200).send({ ok: true });
          return;
        }

        const clarMsgId = cq.message ? String(cq.message.message_id) : null;

        try {
          if (clarAction === 'intent') {
            // ── clar:intent:{value}:{draftId} ──
            const intentValue = parts[2] ?? '';
            const intentDraftId = parts[3] ?? '';
            // Validate draftId format (ULID)
            if (!/^[0-9A-Z]{26}$/.test(intentDraftId)) {
              await answerCallbackQuery(cq.id);
              await reply.status(200).send({ ok: true });
              return;
            }
            const intentResult = await patchDraftIntent(
              clarResolved.workspaceId, clarResolved.userId, intentDraftId, intentValue,
            );
            if (intentResult.status === 'ready') {
              if (clarMsgId) {
                const previewRes = await confirmPreviewFull(clarResolved.workspaceId, clarResolved.userId, intentDraftId);
                void editMessageText(chatId, clarMsgId, previewRes.text, confirmKbForDraft(intentDraftId, previewRes));
                try { await redisConnection.set(`midas:preview:${intentDraftId}`, clarMsgId, 'EX', 3600); } catch { /* non-fatal */ }
              }
            } else if (intentResult.status === 'still_needs' && intentResult.field === 'amount') {
              // Set Redis intercept for amount
              const clarKey = clarStateKey(telegramUserId, chatId);
              await redisConnection.set(clarKey, `${intentDraftId}:amt`, 'EX', CLARIFICATION_STATE_TTL_SEC);
              if (clarMsgId) void editMessageText(chatId, clarMsgId, '💰 Сколько потратил? Напиши сумму:', { inline_keyboard: [] });
            } else {
              if (clarMsgId) void editMessageText(chatId, clarMsgId, '⚠️ Транзакция не найдена или уже обработана.', { inline_keyboard: [] });
            }
            request.log.info({ msg: '[midas:bot:webhook] clar: intent patched', workspaceId: clarResolved.workspaceId, intentResult: intentResult.status });

          } else if (clarAction === 'cat') {
            // ── clar:cat:{catId}:{draftId} ──
            const catId = parts[2] ?? '';
            const catDraftId = parts[3] ?? '';
            if (!/^[0-9A-Z]{26}$/.test(catId) || !/^[0-9A-Z]{26}$/.test(catDraftId)) {
              await answerCallbackQuery(cq.id);
              await reply.status(200).send({ ok: true });
              return;
            }
            const catResult = await patchDraftCategory(
              clarResolved.workspaceId, clarResolved.userId, catDraftId, catId,
            );
            if (catResult.status === 'ready') {
              if (clarMsgId) {
                const previewRes = await confirmPreviewFull(clarResolved.workspaceId, clarResolved.userId, catDraftId);
                void editMessageText(chatId, clarMsgId, previewRes.text, confirmKbForDraft(catDraftId, previewRes));
                try { await redisConnection.set(`midas:preview:${catDraftId}`, clarMsgId, 'EX', 3600); } catch { /* non-fatal */ }
              }
            } else {
              if (clarMsgId) void editMessageText(chatId, clarMsgId, '⚠️ Категория не найдена или транзакция уже обработана.', { inline_keyboard: [] });
            }
            request.log.info({ msg: '[midas:bot:webhook] clar: category patched', workspaceId: clarResolved.workspaceId, catResult: catResult.status });

          } else if (clarAction === 'nocat') {
            // ── clar:nocat:{draftId} ── (without category)
            const nocatDraftId = parts[2] ?? '';
            if (!/^[0-9A-Z]{26}$/.test(nocatDraftId)) {
              await answerCallbackQuery(cq.id);
              await reply.status(200).send({ ok: true });
              return;
            }
            const nocatResult = await patchDraftCategory(
              clarResolved.workspaceId, clarResolved.userId, nocatDraftId, null,
            );
            if (nocatResult.status === 'ready') {
              if (clarMsgId) {
                const previewRes = await confirmPreviewFull(clarResolved.workspaceId, clarResolved.userId, nocatDraftId);
                void editMessageText(chatId, clarMsgId, previewRes.text, confirmKbForDraft(nocatDraftId, previewRes));
                try { await redisConnection.set(`midas:preview:${nocatDraftId}`, clarMsgId, 'EX', 3600); } catch { /* non-fatal */ }
              }
            } else {
              if (clarMsgId) void editMessageText(chatId, clarMsgId, '⚠️ Транзакция не найдена или уже обработана.', { inline_keyboard: [] });
            }
            request.log.info({ msg: '[midas:bot:webhook] clar: no-category patched', workspaceId: clarResolved.workspaceId });

          } else {
            // Unknown clar: sub-command — silently acknowledge
            request.log.warn({ msg: '[midas:bot:webhook] clar: unknown action', clarAction, callbackId: cq.id });
          }
        } catch (err: unknown) {
          const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
          request.log.error({ msg: '[midas:bot:webhook] clar: callback failed', callbackId: cq.id, errorClass });
        }

        await answerCallbackQuery(cq.id);
        await reply.status(200).send({ ok: true });
        return;
      }
      // ── Phase 1.34: navigation callbacks (prefix "nav:") ───────
      // Post-confirmation [📊 Баланс] and [📋 Отчёт] buttons.
      if (callbackData.startsWith('nav:')) {
        const navCmd = callbackData.slice(4); // 'balance' | 'report'

        let navResolved: { workspaceId: string; userId: string };
        try {
          navResolved = await resolveWorkspace(telegramUserId, chatId);
        } catch {
          await answerCallbackQuery(cq.id);
          await reply.status(200).send({ ok: true });
          return;
        }

        try {
          if (navCmd === 'balance') {
            const { text: balanceMsg, accounts } = await getBalanceData(navResolved.workspaceId, navResolved.userId);
            await upsertBotMessage(telegramUserId, chatId, balanceMsg, buildBalanceListKeyboard(accounts as BalanceAccountRow[]));
          } else if (navCmd === 'report') {
            const reportMsg = await getMonthlyReport(navResolved.workspaceId, navResolved.userId);
            await upsertBotMessage(telegramUserId, chatId, reportMsg, {
              inline_keyboard: [[
                { text: '💰 Баланс', callback_data: 'nav:balance' },
                { text: '⚙️ Настройки', callback_data: 'stg:main' },
              ]],
            });
          }
        } catch (err: unknown) {
          const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
          request.log.error({ msg: '[midas:bot:webhook] nav: callback failed', callbackId: cq.id, errorClass });
        }

        await answerCallbackQuery(cq.id);
        await reply.status(200).send({ ok: true });
        return;
      }

      // ── Phase 2.1: balance management callbacks (prefix "bl:") ────
      if (callbackData.startsWith('bl:')) {
        const blCmd = parseBalanceCallback(callbackData);
        if (!blCmd) {
          await answerCallbackQuery(cq.id);
          await reply.status(200).send({ ok: true });
          return;
        }

        let blResolved: { workspaceId: string; userId: string };
        try {
          blResolved = await resolveWorkspace(telegramUserId, chatId);
        } catch {
          await answerCallbackQuery(cq.id);
          await reply.status(200).send({ ok: true });
          return;
        }

        const blKey = `bl:state:${telegramUserId}:${chatId}`;

        try {
          if (blCmd.cmd === 'add_account') {
            // Redirect to account onboarding — show account type picker
            // Set a flag so that after creation, the user returns to balance
            await redisConnection.set(`bl:source:${telegramUserId}:${chatId}`, '1', 'EX', 300);
            await upsertBotMessage(telegramUserId, chatId, NEW_ACCOUNT_TEXT, buildAccountTypeKeyboard());

          } else if (blCmd.cmd === 'back') {
            // Return to balance list
            const { text, accounts } = await getBalanceData(blResolved.workspaceId, blResolved.userId);
            await upsertBotMessage(telegramUserId, chatId, text, buildBalanceListKeyboard(accounts as BalanceAccountRow[]));

          } else if (blCmd.cmd === 'view_account') {
            const detail = await getAccountDetail(blResolved.workspaceId, blResolved.userId, blCmd.accountId);
            if (!detail) {
              await upsertBotMessage(telegramUserId, chatId, '⚠️ Счёт не найден.');
            } else {
              // Phase LD++: fetch role flags for circle-toggle buttons
              const roles = await getAccountRoles(blResolved.workspaceId, blResolved.userId, blCmd.accountId);
              await upsertBotMessage(
                telegramUserId, chatId,
                formatAccountDetailText(detail, roles),
                buildAccountActionsKeyboard(blCmd.accountId, roles),
              );
            }

          } else if (blCmd.cmd === 'rename') {
            // Set text intercept for rename
            await redisConnection.set(blKey, JSON.stringify({ action: 'rename', accountId: blCmd.accountId }), 'EX', 120);
            await upsertBotMessage(telegramUserId, chatId, '✏️ Введите новое название счёта:');

          } else if (blCmd.cmd === 'change_currency') {
            // Check if account has transactions — warn if so
            const txCount = await getAccountTxCount(blResolved.workspaceId, blResolved.userId, blCmd.accountId);
            if (txCount > 0) {
              await upsertBotMessage(
                telegramUserId, chatId,
                `⚠️ У этого счёта <b>${String(txCount)}</b> транзакций. Если смените валюту, они не будут учитываться в балансе.\n\nПродолжить?`,
                buildCurrencyWarningKeyboard(blCmd.accountId),
              );
            } else {
              // No transactions — show currency picker directly
              await redisConnection.set(blKey, JSON.stringify({ action: 'currency', accountId: blCmd.accountId }), 'EX', 120);
              await upsertBotMessage(
                telegramUserId, chatId,
                '💱 Выберите новую валюту:',
                buildBalanceFiatCurrencyKeyboard(),
              );
            }

          } else if (blCmd.cmd === 'change_currency_force') {
            // User confirmed currency change despite having transactions
            await redisConnection.set(blKey, JSON.stringify({ action: 'currency', accountId: blCmd.accountId }), 'EX', 120);
            await upsertBotMessage(
              telegramUserId, chatId,
              '💱 Выберите новую валюту:',
              buildBalanceFiatCurrencyKeyboard(),
            );

          } else if (blCmd.cmd === 'currency_set') {
            // User picked a currency from bl: picker
            const rawState = await redisConnection.get(blKey);
            if (rawState) {
              const state = JSON.parse(rawState) as { action: string; accountId: string };
              if (state.action === 'currency') {
                await changeAccountCurrency(blResolved.workspaceId, blResolved.userId, state.accountId, blCmd.code);
                await redisConnection.del(blKey);
                const detail = await getAccountDetail(blResolved.workspaceId, blResolved.userId, state.accountId);
                if (detail) {
                  // Phase LD++: roles must be fetched AFTER currency change to reflect new state
                  const roles = await getAccountRoles(blResolved.workspaceId, blResolved.userId, state.accountId);
                  await upsertBotMessage(
                    telegramUserId, chatId,
                    `✅ Валюта изменена на <b>${escapeHtml(blCmd.code)}</b>.\n\n` + formatAccountDetailText(detail, roles),
                    buildAccountActionsKeyboard(state.accountId, roles),
                  );
                }
              }
            }

          } else if (blCmd.cmd === 'currency_input') {
            // Free-text currency input
            const rawState = await redisConnection.get(blKey);
            if (rawState) {
              const state = JSON.parse(rawState) as { action: string; accountId: string };
              state.action = 'currency_input';
              await redisConnection.set(blKey, JSON.stringify(state), 'EX', 120);
              await upsertBotMessage(telegramUserId, chatId, '✏️ Введите код валюты (например: USD, BTC):');
            }

          } else if (blCmd.cmd === 'set_balance') {
            // Set text intercept for balance sync
            await redisConnection.set(blKey, JSON.stringify({ action: 'set_balance', accountId: blCmd.accountId }), 'EX', 120);
            await upsertBotMessage(telegramUserId, chatId, '🔄 Введите актуальный баланс счёта:');

          } else if (blCmd.cmd === 'delete') {
            // Show delete confirmation
            const detail = await getAccountDetail(blResolved.workspaceId, blResolved.userId, blCmd.accountId);
            const name = detail ? escapeHtml(detail.name) : 'Счёт';
            const txInfo = detail && parseInt(detail.tx_count, 10) > 0
              ? `\n⚠️ У этого счёта ${detail.tx_count} транзакций. Они сохранятся.`
              : '';
            await upsertBotMessage(
              telegramUserId, chatId,
              `🗑 Удалить счёт <b>${name}</b>?${txInfo}`,
              buildBalanceDeleteConfirmKeyboard(blCmd.accountId),
            );

          } else if (blCmd.cmd === 'delete_confirm') {
            await softDeleteAccount(blResolved.workspaceId, blResolved.userId, blCmd.accountId);
            const { text, accounts } = await getBalanceData(blResolved.workspaceId, blResolved.userId);
            await upsertBotMessage(
              telegramUserId, chatId,
              '✅ Счёт удалён.\n\n' + text,
              buildBalanceListKeyboard(accounts as BalanceAccountRow[]),
            );

          // ── Phase LD++: default account role toggles (cyclical) ───
          } else if (blCmd.cmd === 'set_role') {
            const result = await setAccountRole(blResolved.workspaceId, blResolved.userId, blCmd.accountId, blCmd.role);
            if (result === 'not_found') {
              await answerCallbackQuery(cq.id, '⚠️ Счёт не найден');
            } else {
              const detail = await getAccountDetail(blResolved.workspaceId, blResolved.userId, blCmd.accountId);
              const roles = await getAccountRoles(blResolved.workspaceId, blResolved.userId, blCmd.accountId);
              if (detail) {
                await upsertBotMessage(
                  telegramUserId, chatId,
                  formatAccountDetailText(detail, roles),
                  buildAccountActionsKeyboard(blCmd.accountId, roles),
                );
              }
              // Toast message based on new role
              let toastMsg = 'Обычный счёт установлен';
              if (blCmd.role === 'expense') toastMsg = '💸 Назначен только для расходов';
              if (blCmd.role === 'income') toastMsg = '💰 Назначен только для доходов';
              if (blCmd.role === 'main') toastMsg = '💸💰 Счёт назначен основным';
              if (blCmd.role === 'none') toastMsg = 'Счёт стал обычным';
              
              await answerCallbackQuery(cq.id, toastMsg);
            }

          } else if (blCmd.cmd === 'close') {
            // Phase 2.9+: Clean close of balance screen — delete message + clear nav pointer
            const msgId = cq.message ? String(cq.message.message_id) : null;
            if (msgId) {
              const { deleteMessage } = await import('../services/telegram-api.js');
              void deleteMessage(chatId, msgId);
              void clearNavMessageId(telegramUserId, chatId);
            }
          }
        } catch (err: unknown) {
          const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
          request.log.error({ msg: '[midas:bot:webhook] bl: callback failed', callbackId: cq.id, errorClass });
        }

        await answerCallbackQuery(cq.id);
        await reply.status(200).send({ ok: true });
        return;
      }

      // ── Phase 1.6-B: approve/reject callbacks ─────────────────
      // Parse callback_data — format: "action:draftId"
      const colonIdx = callbackData.indexOf(':');
      if (colonIdx === -1) {
        // Unknown callback_data format — silently acknowledge
        request.log.info({
          msg: '[midas:bot:webhook] callback_query: unknown data format — acknowledged',
          callbackId: cq.id,
        });
        await reply.status(200).send({ ok: true });
        return;
      }

      const action = callbackData.slice(0, colonIdx);
      const draftId = callbackData.slice(colonIdx + 1);

      // Validate action — only 'approve' and 'reject' are permitted (SEC-01)
      if (action !== 'approve' && action !== 'reject') {
        request.log.warn({
          msg: '[midas:bot:webhook] callback_query: invalid action — rejected',
          callbackId: cq.id,
          action,
        });
        await reply.status(200).send({ ok: true });
        return;
      }

      // Validate draftId format (ULID: 26 chars, base32 alphabet)
      if (!/^[0-9A-Z]{26}$/.test(draftId)) {
        request.log.warn({
          msg: '[midas:bot:webhook] callback_query: malformed draftId — rejected',
          callbackId: cq.id,
        });
        await reply.status(200).send({ ok: true });
        return;
      }

      // SEC-03: Resolve workspaceId from trusted source (DB), NOT from callback_data
      let workspaceId: string;
      try {
        const resolved = await resolveWorkspace(telegramUserId, chatId);
        workspaceId = resolved.workspaceId;
      } catch (err: unknown) {
        const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
        request.log.error({
          msg: '[midas:bot:webhook] callback_query: workspace resolution failed',
          callbackId: cq.id,
          errorClass,
        });
        await reply.status(200).send({ ok: true });
        return;
      }

      // Phase 1.36-UX Bug Fix: Answer callback_query IMMEDIATELY so Telegram
      // removes the loading spinner at once. All other callback handlers do this;
      // approve/reject were the only ones missing it — causing the "button stuck"
      // UX where the spinner timed out after 10 s with no visible feedback.
      // The worker (confirmation.worker.ts) may still attempt to answer again;
      // that second call will be silently rejected by Telegram (already answered).
      await answerCallbackQuery(cq.id);

      // Enqueue to callback-confirm queue (SEC-06: idempotency key)
      const idempotencyKey = IdempotencyKeyBuilder.callbackConfirm(
        telegramUserId,
        draftId,
        action,
      );

      const payload: CallbackConfirmJobPayload = {
        callbackQueryId: cq.id,
        telegramUserId,
        draftId,
        action,
        workspaceId, // SEC-03: from trusted backend source
        chatId,
      };

      await callbackConfirmQueue.add(QUEUE_NAMES.CALLBACK_CONFIRM, payload, {
        jobId: idempotencyKey, // SEC-06: idempotent — duplicate taps are deduped
      });

      // Phase 1.36-UX fix: Clear stale clarification state so the next user
      // message is not silently consumed by the clar: intercept. The clar:
      // state may survive up to TTL=300s after the draft was approved/rejected.
      void redisConnection.del(clarStateKey(telegramUserId, chatId));
      request.log.info({
        msg: '[midas:bot:webhook] callback_query enqueued',
        callbackId: cq.id,
        draftId,
        action,
        workspaceId,
        idempotencyKey,
      });

      await reply.status(200).send({ ok: true });
      return;
    }

    // ── Step 3: Extract message ───────────────────────────────
    const message = update.message;

    if (!message) {
      // Update type not supported in Phase 1 (e.g. edited_message, channel_post)
      await reply.status(200).send({ ok: true });
      return;
    }

    // ── Step 4: SEC-05 — Non-text filter ─────────────────────
    if (!message.text || message.text.trim().length === 0) {
      // Voice, photo, video, sticker, document, etc. — silently drop
      request.log.info({
        msg: '[midas:bot:webhook] SEC-05: non-text message — discarded',
        chatId: String(message.chat.id),
        messageId: String(message.message_id),
      });
      await reply.status(200).send({ ok: true });
      return;
    }

    // ── Step 5: Extract user identity ────────────────────────
    const from = message.from;

    if (!from || from.is_bot) {
      // Ignore bot messages and messages without sender (channel posts, etc.)
      await reply.status(200).send({ ok: true });
      return;
    }

    // All IDs stored as strings — SEC-02: never use Number() on financial or ID values
    const telegramUserId = String(from.id);
    const chatId = String(message.chat.id);
    const messageId = String(message.message_id);
    // Unix timestamp → ISO string
    const receivedAt = new Date(message.date * 1000).toISOString();

    // ── Step 5b–5e: Slash-command routing (Phase 1.10) ────────
    //
    // Dispatch model:
    //   - Parse first token. If not a slash command → fall through to AI parse.
    //   - /start  → onboarding flow (Phase 1.5)
    //   - /report → monthly report (Phase 1.9)
    //   - /help   → inline help text (Phase 1.10)
    //   - any other slash command → blocked (Phase 1.10 guard)
    //
    // parseCommandToken returns null for free text → AI parse path is unchanged.

    const commandToken = parseCommandToken(message.text);

    // Phase 1.33: Best-effort delete user's text message to keep chat clean.
    // Runs for ALL text messages (commands and free-text) before any processing.
    tryDeleteUserMessage(chatId, messageId);

    // ── Phase 1.36-UX: Reply Keyboard button shortcuts ──────────────────
    // Reply Keyboard buttons send their label text as a plain message.
    // Intercept here — before AI parse — and route to the correct handler.
    const navText = message.text.trim();

    if (navText === NAV_BTN_BALANCE) {
      // Phase 2.9: sendNavMessage — always sends NEW message, never edits/deletes tx records
      try {
        const resolved = await resolveWorkspace(telegramUserId, chatId);
        const { text: balanceText, accounts } = await getBalanceData(resolved.workspaceId, resolved.userId);
        void sendNavMessage(telegramUserId, chatId, balanceText, buildBalanceListKeyboard(accounts as BalanceAccountRow[]));
        request.log.info({ msg: '[midas:bot:webhook] nav:balance shortcut', telegramUserId, workspaceId: resolved.workspaceId });
      } catch (err: unknown) {
        const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
        request.log.error({ msg: '[midas:bot:webhook] nav:balance shortcut failed', telegramUserId, errorClass });
        void sendNavMessage(telegramUserId, chatId, '⚠️ Не удалось получить баланс. Попробуйте позже.');
      }
      await reply.status(200).send({ ok: true });
      return;
    }

    if (navText === NAV_BTN_REPORT) {
      // Phase 2.9: sendNavMessage — always sends NEW message, never edits/deletes tx records
      try {
        const { buildPeriodPickerKeyboard } = await import('../services/report-keyboard.service.js');
        void sendNavMessage(telegramUserId, chatId, '📊 <b>Отчёты</b>\n\nВыбери период:', buildPeriodPickerKeyboard());
        request.log.info({ msg: '[midas:bot:webhook] nav:report → period picker', telegramUserId });
      } catch (err: unknown) {
        const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
        request.log.error({ msg: '[midas:bot:webhook] nav:report failed', telegramUserId, errorClass });
        void sendNavMessage(telegramUserId, chatId, '⚠️ Не удалось открыть отчёты. Попробуйте позже.');
      }
      await reply.status(200).send({ ok: true });
      return;
    }

    if (navText === NAV_BTN_SETTINGS) {
      // Phase 2.9: sendNavMessage — always sends NEW message, never edits/deletes tx records
      try {
        const resolved = await resolveWorkspace(telegramUserId, chatId);
        const settings = await getSettings(resolved.workspaceId, resolved.userId);
        const menuText = formatSettingsMenuText(
          settings?.default_currency ?? 'USDT',
          settings?.timezone ?? 'UTC',
          settings?.main_account_name ?? null,
        );
        void sendNavMessage(telegramUserId, chatId, menuText, buildSettingsMainKeyboard());
        request.log.info({ msg: '[midas:bot:webhook] nav:settings shortcut', telegramUserId, workspaceId: resolved.workspaceId });
      } catch (err: unknown) {
        const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
        request.log.error({ msg: '[midas:bot:webhook] nav:settings shortcut failed', telegramUserId, errorClass });
        void sendNavMessage(telegramUserId, chatId, '⚠️ Ошибка настроек. Попробуйте позже.');
      }
      await reply.status(200).send({ ok: true });
      return;
    }

    // Phase 2.0: Transaction Hub nav button
    if (navText === NAV_BTN_TRANSACTIONS) {
      // Phase 2.9: sendNavMessage — always sends NEW message, never edits/deletes tx records
      try {
        const resolved = await resolveWorkspace(telegramUserId, chatId);
        const [items, total, stats] = await Promise.all([
          getTransactionList(resolved.workspaceId, resolved.userId, 0, 'a'),
          countFilteredTransactions(resolved.workspaceId, resolved.userId, 'a'),
          getMonthMiniStats(resolved.workspaceId, resolved.userId),
        ]);
        if (total === 0) {
          const emptyMsgId = await sendNavMessage(telegramUserId, chatId,
            '📋 <b>Транзакции</b>\n\nТранзакций пока нет.', EMPTY_KEYBOARD);
          if (emptyMsgId) {
            await redisConnection.set(`midas:empty_tx_msg:${chatId}`, emptyMsgId, 'EX', 86400);
          }
        } else {
          const totalPages = Math.max(1, Math.ceil(total / TX_PAGE_SIZE));
          const header = formatTxListHeader(stats, 'a');
          const keyboard = buildTxListKeyboard(items, 0, totalPages, 'a');
          void sendNavMessage(telegramUserId, chatId, header, keyboard);
        }
        request.log.info({ msg: '[midas:bot:webhook] nav:transactions', telegramUserId, workspaceId: resolved.workspaceId });
      } catch (err: unknown) {
        const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
        request.log.error({ msg: '[midas:bot:webhook] nav:transactions failed', telegramUserId, errorClass });
        void sendNavMessage(telegramUserId, chatId, '⚠️ Не удалось загрузить транзакции. Попробуйте позже.');
      }
      await reply.status(200).send({ ok: true });
      return;
    }

    // ── Phase 2.1: Balance management text intercepts ─────────────────
    // Fires before slash-command routing to capture free-text input for:
    //   - bl:rn (rename), bl:sb (set_balance), bl:cv (currency_input)
    const blStateKey = `bl:state:${telegramUserId}:${chatId}`;
    const rawBlState = await redisConnection.get(blStateKey);
    if (rawBlState && !commandToken) {
      try {
        const blState = JSON.parse(rawBlState) as { action: string; accountId: string };
        const blResolved = await resolveWorkspace(telegramUserId, chatId);
        const userInput = message.text.trim();

        if (blState.action === 'rename') {
          // Rename account
          if (userInput.length === 0 || userInput.length > 100) {
            void upsertBotMessage(telegramUserId, chatId, '⚠️ Название должно быть от 1 до 100 символов.');
          } else {
            const result = await renameAccount(blResolved.workspaceId, blResolved.userId, blState.accountId, userInput);
            await redisConnection.del(blStateKey);
            if (result === 'duplicate') {
              void upsertBotMessage(telegramUserId, chatId, '⚠️ Счёт с таким названием уже существует.');
            } else if (result === 'not_found') {
              void upsertBotMessage(telegramUserId, chatId, '⚠️ Счёт не найден.');
            } else {
              const detail = await getAccountDetail(blResolved.workspaceId, blResolved.userId, blState.accountId);
              if (detail) {
                // Phase LD++: fetch roles after rename to reflect current state
                const roles = await getAccountRoles(blResolved.workspaceId, blResolved.userId, blState.accountId);
                void upsertBotMessage(
                  telegramUserId, chatId,
                  `✅ Счёт переименован.\n\n` + formatAccountDetailText(detail, roles),
                  buildAccountActionsKeyboard(blState.accountId, roles),
                );
              }
            }
          }
          await reply.status(200).send({ ok: true });
          return;
        }

        if (blState.action === 'set_balance') {
          // Sync balance
          const amountStr = userInput.replace(/,/g, '.').replace(/\s/g, '');
          if (!/^-?\d+(\.\d+)?$/.test(amountStr)) {
            void upsertBotMessage(telegramUserId, chatId, '⚠️ Введите числовое значение (например: 1500 или 2847.50).');
          } else {
            const result = await setAccountBalanceById(blResolved.workspaceId, blResolved.userId, blState.accountId, amountStr);
            await redisConnection.del(blStateKey);
            if (result === 'not_found') {
              void upsertBotMessage(telegramUserId, chatId, '⚠️ Счёт не найден.');
            } else {
              const detail = await getAccountDetail(blResolved.workspaceId, blResolved.userId, blState.accountId);
              if (detail) {
                // Phase LD++: fetch roles after balance sync
                const roles = await getAccountRoles(blResolved.workspaceId, blResolved.userId, blState.accountId);
                void upsertBotMessage(
                  telegramUserId, chatId,
                  `✅ Баланс обновлён.\n\n` + formatAccountDetailText(detail, roles),
                  buildAccountActionsKeyboard(blState.accountId, roles),
                );
              }
            }
          }
          await reply.status(200).send({ ok: true });
          return;
        }

        if (blState.action === 'currency_input') {
          // Free-text currency code
          const code = userInput.toUpperCase().replace(/\s/g, '');
          if (!/^[A-Z]{1,10}$/.test(code)) {
            void upsertBotMessage(telegramUserId, chatId, '⚠️ Код валюты должен содержать 1–10 латинских букв (например: USD, BTC).');
          } else {
            await changeAccountCurrency(blResolved.workspaceId, blResolved.userId, blState.accountId, code);
            await redisConnection.del(blStateKey);
            const detail = await getAccountDetail(blResolved.workspaceId, blResolved.userId, blState.accountId);
            if (detail) {
              // Phase LD++: fetch roles after currency change
              const roles = await getAccountRoles(blResolved.workspaceId, blResolved.userId, blState.accountId);
              void upsertBotMessage(
                telegramUserId, chatId,
                `✅ Валюта изменена на <b>${escapeHtml(code)}</b>.\n\n` + formatAccountDetailText(detail, roles),
                buildAccountActionsKeyboard(blState.accountId, roles),
              );
            }
          }
          await reply.status(200).send({ ok: true });
          return;
        }
      } catch (err: unknown) {
        const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
        request.log.error({ msg: '[midas:bot:webhook] bl: text intercept failed', telegramUserId, errorClass });
      }
    }

    if (commandToken !== null) {
      // ── 5b: /start ───────────────────────────────────────────
      if (commandToken === '/start') {
        const allowed = await checkOnboardingRateLimit(telegramUserId);

        if (!allowed) {
          // Rate-limited: silent 200. Do NOT send another message (would spam the user).
          request.log.info({
            msg: '[midas:bot:webhook] /start rate-limited',
            telegramUserId,
          });
          await reply.status(200).send({ ok: true });
          return;
        }

        // Run onboarding: find or create User + Workspace + Membership
        try {
          const resolved = await resolveWorkspace(telegramUserId, chatId);
          request.log.info({
            msg: '[midas:bot:webhook] /start onboarding complete',
            telegramUserId,
            workspaceId: resolved.workspaceId,
            isNewUser: resolved.isNewUser,
          });

          // Phase 1.37-UX: /start clean-chat reset.
          //
          // Race-condition fix (Phase 1.33 had `void clearActiveMessageId` — not awaited):
          //   upsertBotMessage ran immediately after and found the old pointer, tried to edit
          //   the old message, failed, sent a new one — leaving TWO messages visible.
          //
          // New strategy:
          //   1. Read the old active message ID from Redis
          //   2. Delete the old Telegram message (best-effort — non-throwing)
          //   3. Await the Redis clear so the pointer is gone before upsertBotMessage runs
          //   4. Send the new message via upsertBotMessage / sendMessageWithReplyKeyboard
          const oldActiveMsgId = await getActiveMessageId(telegramUserId, chatId);
          if (oldActiveMsgId) void deleteMessage(chatId, oldActiveMsgId);
          await clearActiveMessageId(telegramUserId, chatId);

          // If existing user, send a re-greeting (resolveWorkspace only sends for isNewUser)
          if (!resolved.isNewUser) {
            // Phase 1.37-UX: Existing user re-greeting with ReplyKeyboard.
            // Old active message was already deleted above — chat is clean.
            const greetMsgId = await sendMessageWithReplyKeyboard(
              chatId,
              '✅ С возвращением в Midas!\n\nОпишите операцию — бот распознает её автоматически.',
              buildMainMenuKeyboard(),
            );
            if (greetMsgId) {
              void redisConnection.set(
                greetingMsgKey(telegramUserId, chatId), greetMsgId, 'EX', GREETING_MSG_TTL_SEC,
              );
            }
          } else {
            // Phase 1.37-UX: New user onboarding — ONE message, NO ReplyKeyboard.
            //
            // Design rationale:
            //   - Showing ReplyKeyboard (Balance/Report/Settings) to a new user with no
            //     data is noise. The keyboard activates only after ac:done (account setup)
            //     or after the first confirmed transaction (workers send replyKeyboardJson).
            //   - Single message: welcome text + 2-button inline keyboard (Add / Skip).
            //     Telegram API cannot combine ReplyKeyboard + InlineKeyboard in one message.
            //   - The default account ("Default") was already created by system_find_or_create_user,
            //     so the user can transact immediately without setting up accounts.
            void upsertBotMessage(
              telegramUserId, chatId,
              START_WELCOME_TEXT,
              buildStartSimpleKeyboard(),
            );
            // Silent gate: set FSM state so text messages are silently swallowed
            // while the user is on the /start 2-button screen (before any button tap).
            // Cleared automatically by ac:skip / ac:done / ac:fin handlers.
            await redisConnection.set(
              onboardStateKey(telegramUserId, chatId),
              JSON.stringify({ step: 'type_pick' }),
              'EX',
              ONBOARD_STATE_TTL_SEC,
            );
          }
        } catch (err: unknown) {
          const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
          request.log.error({
            msg: '[midas:bot:webhook] /start onboarding failed',
            telegramUserId,
            errorClass,
          });
          // Non-throwing: return 200 to Telegram
        }

        await reply.status(200).send({ ok: true });
        return;
      }

      // ── 5c: /report ──────────────────────────────────────────
      if (commandToken === '/report') {
        try {
          const resolved = await resolveWorkspace(telegramUserId, chatId);
          const reportText = await getMonthlyReport(resolved.workspaceId, resolved.userId);
          void upsertBotMessage(telegramUserId, chatId, reportText);

          request.log.info({
            msg: '[midas:bot:webhook] /report sent',
            telegramUserId,
            workspaceId: resolved.workspaceId,
          });
        } catch (err: unknown) {
          const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
          request.log.error({
            msg: '[midas:bot:webhook] /report failed',
            telegramUserId,
            errorClass,
          });
          void upsertBotMessage(telegramUserId, chatId, '⚠️ Не удалось сформировать отчёт. Попробуйте позже.');
        }

        await reply.status(200).send({ ok: true });
        return;
      }

      // ── 5c-bal: /balance (Phase 1.21) ────────────────────────
      if (commandToken === '/balance') {
        try {
          const resolved = await resolveWorkspace(telegramUserId, chatId);
          const { text: balanceText, accounts } = await getBalanceData(resolved.workspaceId, resolved.userId);
          void upsertBotMessage(telegramUserId, chatId, balanceText, buildBalanceListKeyboard(accounts as BalanceAccountRow[]));

          request.log.info({
            msg: '[midas:bot:webhook] /balance sent',
            telegramUserId,
            workspaceId: resolved.workspaceId,
          });
        } catch (err: unknown) {
          const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
          request.log.error({
            msg: '[midas:bot:webhook] /balance failed',
            telegramUserId,
            errorClass,
          });
          void upsertBotMessage(telegramUserId, chatId, '⚠️ Не удалось получить баланс. Попробуйте позже.');
        }

        await reply.status(200).send({ ok: true });
        return;
      }

      // ── 5c-setbal: /set_balance (Phase 1.23) ─────────────────
      if (commandToken === '/set_balance') {
        // Parse and validate args before any DB call
        const parsed = parseSetBalanceArgs(message.text);

        if ('error' in parsed) {
          // Argument validation failed — send usage hint, do NOT enqueue
          void upsertBotMessage(telegramUserId, chatId, parsed.error);
          request.log.info({
            msg: '[midas:bot:webhook] /set_balance bad args',
            telegramUserId,
            // accountName and amount NOT logged (SEC-12)
          });
          await reply.status(200).send({ ok: true });
          return;
        }

        try {
          const resolved = await resolveWorkspace(telegramUserId, chatId);
          const result = await setAccountBalance(
            resolved.workspaceId,
            resolved.userId,
            parsed.accountName,
            parsed.amountStr,
          );

          const replyText = formatSetBalanceResult(result, parsed.accountName);
          void upsertBotMessage(telegramUserId, chatId, replyText);

          request.log.info({
            msg: '[midas:bot:webhook] /set_balance processed',
            telegramUserId,
            workspaceId: resolved.workspaceId,
            resultStatus: result.status,
            // accountName and amount NOT logged (SEC-12)
          });
        } catch (err: unknown) {
          const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
          request.log.error({
            msg: '[midas:bot:webhook] /set_balance failed',
            telegramUserId,
            errorClass,
          });
          void upsertBotMessage(telegramUserId, chatId, '⚠️ Не удалось синхронизировать баланс. Попробуйте позже.');
        }

        await reply.status(200).send({ ok: true });
        return;
      }

      // ── 5d-cat: /category (Phase 1.11) ───────────────────────
      if (commandToken === '/category') {
        try {
          const resolved = await resolveWorkspace(telegramUserId, chatId);
          const categoryText = await getCategoryList(resolved.workspaceId, resolved.userId);
          void upsertBotMessage(telegramUserId, chatId, categoryText);

          request.log.info({
            msg: '[midas:bot:webhook] /category sent',
            telegramUserId,
            workspaceId: resolved.workspaceId,
          });
        } catch (err: unknown) {
          const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
          request.log.error({
            msg: '[midas:bot:webhook] /category failed',
            telegramUserId,
            errorClass,
          });
          void upsertBotMessage(telegramUserId, chatId, '⚠️ Не удалось получить список категорий. Попробуйте позже.');
        }

        await reply.status(200).send({ ok: true });
        return;
      }

      // ── 5d-acc: /accounts (Phase 1.14 + 1.30) ───────────────
      if (commandToken === '/accounts') {
        try {
          const resolved = await resolveWorkspace(telegramUserId, chatId);
          // Phase 1.30: if workspace has no accounts, show guided onboarding keyboard.
          // Otherwise show the regular flat list (unchanged).
          const accountsExist = await hasAccounts(resolved.workspaceId, resolved.userId);
          if (!accountsExist) {
            void upsertBotMessage(telegramUserId, chatId, ACCOUNTS_EMPTY_TEXT, buildAccountTypeKeyboard());
          } else {
            const accountText = await getAccountList(resolved.workspaceId, resolved.userId);
            void upsertBotMessage(telegramUserId, chatId, accountText);
          }

          request.log.info({
            msg: '[midas:bot:webhook] /accounts sent',
            telegramUserId,
            workspaceId: resolved.workspaceId,
            hasAccounts: accountsExist,
          });
        } catch (err: unknown) {
          const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
          request.log.error({
            msg: '[midas:bot:webhook] /accounts failed',
            telegramUserId,
            errorClass,
          });
          void upsertBotMessage(telegramUserId, chatId, '⚠️ Не удалось получить список счетов. Попробуйте позже.');
        }

        await reply.status(200).send({ ok: true });
        return;
      }

      // ── 5e-add-acc: /add_account (Phase 1.17) ────────────────
      if (commandToken === '/add_account') {
        // Parse and validate args before any DB call
        const parsed = parseAddAccountArgs(message.text);

        if ('error' in parsed) {
          // Argument validation failed — send usage hint, do NOT enqueue
          void upsertBotMessage(telegramUserId, chatId, parsed.error);
          request.log.info({
            msg: '[midas:bot:webhook] /add_account bad args',
            telegramUserId,
            // name NOT logged (SEC-12)
          });
          await reply.status(200).send({ ok: true });
          return;
        }

        try {
          const resolved = await resolveWorkspace(telegramUserId, chatId);
          const result = await addAccount(
            resolved.workspaceId,
            resolved.userId,
            parsed.name,
          );

          if (result === 'duplicate') {
            void upsertBotMessage(telegramUserId, chatId, 'Счёт с таким названием уже существует.');
          } else {
            // escapeHtml: parsed.name is user input rendered in parse_mode:'HTML' context (Phase 1.15 pattern).
            void upsertBotMessage(
              telegramUserId,
              chatId,
              `✅ Счёт добавлен: <b>${escapeHtml(parsed.name)}</b>`,
            );
          }

          request.log.info({
            msg: '[midas:bot:webhook] /add_account processed',
            telegramUserId,
            workspaceId: resolved.workspaceId,
            result,
            // name NOT logged (SEC-12)
          });
        } catch (err: unknown) {
          const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
          request.log.error({
            msg: '[midas:bot:webhook] /add_account failed',
            telegramUserId,
            errorClass,
          });
          void upsertBotMessage(telegramUserId, chatId, '⚠️ Не удалось добавить счёт. Попробуйте позже.');
        }

        await reply.status(200).send({ ok: true });
        return;
      }

      // ── 5e-add: /add_category (Phase 1.13) ───────────────────
      if (commandToken === '/add_category') {
        // Parse and validate args before any DB call
        const parsed = parseAddCategoryArgs(message.text);

        if ('error' in parsed) {
          // Argument validation failed — send usage hint, do NOT enqueue
          void upsertBotMessage(telegramUserId, chatId, parsed.error);
          request.log.info({
            msg: '[midas:bot:webhook] /add_category bad args',
            telegramUserId,
            // name/group NOT logged (SEC-12)
          });
          await reply.status(200).send({ ok: true });
          return;
        }

        try {
          const resolved = await resolveWorkspace(telegramUserId, chatId);
          const result = await addCategory(
            resolved.workspaceId,
            resolved.userId,
            parsed.canonicalGroup,
            parsed.name,
          );

          if (result === 'duplicate') {
            void upsertBotMessage(telegramUserId, chatId, 'Категория с таким именем уже существует.');
          } else {
            // escapeHtml: parsed.canonicalGroup and parsed.name are user-influenced values
            // rendered in parse_mode:'HTML' context (Phase 1.15 hardening).
            void upsertBotMessage(
              telegramUserId,
              chatId,
              `✅ Категория добавлена: <b>${escapeHtml(parsed.canonicalGroup)}</b> / ${escapeHtml(parsed.name)}`,
            );
          }

          request.log.info({
            msg: '[midas:bot:webhook] /add_category processed',
            telegramUserId,
            workspaceId: resolved.workspaceId,
            result,
            // name/group NOT logged (SEC-12)
          });
        } catch (err: unknown) {
          const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
          request.log.error({
            msg: '[midas:bot:webhook] /add_category failed',
            telegramUserId,
            errorClass,
          });
          void upsertBotMessage(telegramUserId, chatId, '⚠️ Не удалось добавить категорию. Попробуйте позже.');
        }

        await reply.status(200).send({ ok: true });
        return;
      }

      // ── 5f-settings: /settings (Phase 1.25 + Phase 1.26) ────
      // /settings alone → show inline keyboard UI (Phase 1.26)
      // /settings currency <CODE> and /settings timezone <ZONE> → text mode (Phase 1.25)
      if (commandToken === '/settings') {
        const parsed = parseSettingsArgs(message.text);

        if ('error' in parsed) {
          void upsertBotMessage(telegramUserId, chatId, parsed.error);
          request.log.info({
            msg: '[midas:bot:webhook] /settings bad args',
            telegramUserId,
            // subcommand NOT logged (SEC-12 consistency)
          });
          await reply.status(200).send({ ok: true });
          return;
        }

        try {
          const resolved = await resolveWorkspace(telegramUserId, chatId);

          if (parsed.action === 'view') {
            // Phase 1.26: /settings alone → inline keyboard UI
            const settings = await getSettings(resolved.workspaceId, resolved.userId);
            const menuText = formatSettingsMenuText(
              settings?.default_currency ?? 'USDT',
              settings?.timezone ?? 'UTC',
              settings?.main_account_name ?? null,
            );
            void upsertBotMessage(telegramUserId, chatId, menuText, buildSettingsMainKeyboard());
            request.log.info({
              msg: '[midas:bot:webhook] /settings menu sent',
              telegramUserId,
              workspaceId: resolved.workspaceId,
            });
          } else if (parsed.action === 'currency') {
            // Phase 1.25 text mode — kept for backward compatibility
            const before = await getSettings(resolved.workspaceId, resolved.userId);
            const oldCode = before?.default_currency ?? '?';

            const result = await updateCurrency(resolved.workspaceId, resolved.userId, parsed.code);
            // Phase 1.38: Mark that user explicitly set a currency
            if (result !== 'not_found') {
              await redisConnection.set(`midas:cur_set:${resolved.workspaceId}`, '1');
            }
            if (result === 'not_found') {
              void upsertBotMessage(telegramUserId, chatId, '⚠️ Не удалось обновить валюту. Попробуйте позже.');
            } else {
              void upsertBotMessage(telegramUserId, chatId, formatCurrencyUpdated(parsed.code, oldCode));
            }
            request.log.info({
              msg: '[midas:bot:webhook] /settings currency updated (text mode)',
              telegramUserId,
              workspaceId: resolved.workspaceId,
              // code NOT logged (SEC-12 consistency)
            });
          } else {
            // Phase 1.25 text mode: /settings timezone <ZONE>
            const before = await getSettings(resolved.workspaceId, resolved.userId);
            const oldZone = before?.timezone ?? 'UTC';

            const result = await updateTimezone(resolved.workspaceId, resolved.userId, parsed.zone);
            if (result === 'not_found') {
              void upsertBotMessage(telegramUserId, chatId, '⚠️ Не удалось обновить часовой пояс. Попробуйте позже.');
            } else {
              void upsertBotMessage(telegramUserId, chatId, formatTimezoneUpdated(parsed.zone, oldZone));
            }
            request.log.info({
              msg: '[midas:bot:webhook] /settings timezone updated (text mode)',
              telegramUserId,
              workspaceId: resolved.workspaceId,
              // zone NOT logged (SEC-12 consistency)
            });
          }
        } catch (err: unknown) {
          const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
          request.log.error({
            msg: '[midas:bot:webhook] /settings failed',
            telegramUserId,
            errorClass,
          });
          void upsertBotMessage(telegramUserId, chatId, '⚠️ Ошибка настроек. Попробуйте позже.');
        }

        await reply.status(200).send({ ok: true });
        return;
      }

      // ── 5f-edit: /edit → redirect to Transaction Hub (Phase 2.0) ──
      if (commandToken === '/edit') {
        try {
          const resolved = await resolveWorkspace(telegramUserId, chatId);
          // Phase 2.0: redirect /edit to the new Transaction Hub (same as NAV_BTN_TRANSACTIONS)
          const [items, total, stats] = await Promise.all([
            getTransactionList(resolved.workspaceId, resolved.userId, 0, 'a'),
            countFilteredTransactions(resolved.workspaceId, resolved.userId, 'a'),
            getMonthMiniStats(resolved.workspaceId, resolved.userId),
          ]);
          if (total === 0) {
            void upsertBotMessage(telegramUserId, chatId,
              '📋 <b>Транзакции</b>\n\nТранзакций пока нет.');
          } else {
            const totalPages = Math.max(1, Math.ceil(total / TX_PAGE_SIZE));
            const header = formatTxListHeader(stats, 'a');
            const keyboard = buildTxListKeyboard(items, 0, totalPages, 'a');
            void upsertBotMessage(telegramUserId, chatId, header, keyboard);
          }
          request.log.info({
            msg: '[midas:bot:webhook] /edit → tx hub redirect',
            telegramUserId,
            workspaceId: resolved.workspaceId,
          });
        } catch (err: unknown) {
          const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
          request.log.error({
            msg: '[midas:bot:webhook] /edit failed',
            telegramUserId,
            errorClass,
          });
          void upsertBotMessage(telegramUserId, chatId, '⚠️ Не удалось открыть список транзакций. Попробуйте позже.');
        }

        await reply.status(200).send({ ok: true });
        return;
      }

      // ── 5d: /help (Phase 1.10) ───────────────────────────────
      if (commandToken === '/help') {
        void upsertBotMessage(telegramUserId, chatId, HELP_TEXT);
        request.log.info({
          msg: '[midas:bot:webhook] /help sent',
          telegramUserId,
        });
        await reply.status(200).send({ ok: true });
        return;
      }

      // ── 5e: Unknown slash-command guard (Phase 1.10) ─────────
      // Any text starting with "/" that is NOT in KNOWN_COMMANDS is blocked here.
      // It does NOT reach the AI parse queue.
      if (!KNOWN_COMMANDS.has(commandToken)) {
        void upsertBotMessage(telegramUserId, chatId, UNKNOWN_COMMAND_TEXT);
        request.log.info({
          msg: '[midas:bot:webhook] unknown slash command blocked',
          telegramUserId,
          commandToken,
        });
        await reply.status(200).send({ ok: true });
        return;
      }
    }

    // ── Phase 2.2: Timezone search text intercept ──────────────
    // If midas:tz_srch: key exists, user is in timezone search mode.
    // Their next text is treated as a city/country query, NOT a transaction.
    if (!commandToken) {
      const tzSrchKey = `midas:tz_srch:${telegramUserId}:${chatId}`;
      const tzSrchMsgId = await redisConnection.get(tzSrchKey);
      if (tzSrchMsgId !== null) {
        const rawQuery = message.text?.trim() ?? '';
        if (rawQuery.length < 2) {
          void upsertBotMessage(telegramUserId, chatId, '⚠️ Введите не менее 2 символов для поиска часового пояса.');
          await reply.status(200).send({ ok: true });
          return;
        }

        const { searchTimezone } = await import('../services/timezones.js');
        const result = searchTimezone(rawQuery);

        if (!result) {
          // Not found — keep search mode active, prompt to try again
          const notFoundKb = {
            inline_keyboard: [
              [{ text: '🔄 Попробовать снова', callback_data: 'st:tz' }],
              [{ text: '← Назад в настройки', callback_data: 'st:back' }],
            ],
          };
          void upsertBotMessage(
            telegramUserId, chatId,
            `🔍 По запросу «${escapeHtml(rawQuery)}» ничего не найдено.\n\nПопробуйте: <i>Москва, Dubai, Россия, New York, Украина</i>`,
            notFoundKb,
          );
          await reply.status(200).send({ ok: true });
          return;
        }

        // Clear search mode
        await redisConnection.del(tzSrchKey);

        if (result.type === 'single') {
          // Direct match → show confirm button
          const { getTzOffset } = await import('../services/timezones.js');
          const offset = getTzOffset(result.iana);
          const encoded = Buffer.from(result.iana).toString('base64url');
          const singleKb = {
            inline_keyboard: [
              [{ text: `${result.flag} Выбрать: ${result.label}`, callback_data: `st:tz:p:${encoded}` }],
              [{ text: '🔄 Поискать другой', callback_data: 'st:tz' }],
              [{ text: '← Назад в настройки', callback_data: 'st:back' }],
            ],
          };
          void upsertBotMessage(
            telegramUserId, chatId,
            `🕒 Найден часовой пояс:\n\n<b>${escapeHtml(result.iana)}</b>${offset ? ` (${escapeHtml(offset)})` : ''}\n${result.label}`,
            singleKb,
          );
        } else if (result.type === 'multi_country') {
          // Country with multiple TZ → show zone list
          const country = result.country;
          const zoneRows = country.zones.map((z) => {
            const encoded = Buffer.from(z.iana).toString('base64url');
            return [{ text: z.label, callback_data: `st:tz:p:${encoded}` }];
          });
          zoneRows.push([{ text: '← Назад', callback_data: 'st:tz' }]);
          void upsertBotMessage(
            telegramUserId, chatId,
            `${country.flag} <b>${escapeHtml(country.nameRu)}</b>\n\nУ этой страны несколько часовых поясов — выберите ваш регион:`,
            { inline_keyboard: zoneRows },
          );
        } else {
          // IANA list
          const zoneRows = result.zones.map((iana) => {
            const encoded = Buffer.from(iana).toString('base64url');
            return [{ text: iana, callback_data: `st:tz:p:${encoded}` }];
          });
          zoneRows.push([{ text: '🔄 Поискать другой', callback_data: 'st:tz' }]);
          zoneRows.push([{ text: '← Назад в настройки', callback_data: 'st:back' }]);
          void upsertBotMessage(
            telegramUserId, chatId,
            `🕒 Найдено несколько вариантов — выберите подходящий:`,
            { inline_keyboard: zoneRows },
          );
        }

        await reply.status(200).send({ ok: true });
        return;
      }
    }

    // ── Step 5f-xfx: Phase 2.4 PR12 — cross-currency debit amount intercept ──
    // If user is in the xfx input state (tapped "✏️ Указать сумму"), intercept
    // their next text message as the cross-currency debit amount.
    // Runs BEFORE clarification-intercept and AI parse.
    if (!commandToken) {
      let xfxResolved: { workspaceId: string; userId: string } | null = null;
      // Redis key pattern: midas:xfx:ptr:{internalUserId}:{chatId}
      // We don't know internalUserId yet, so use KEYS wildcard on chatId.
      const xfxCandidateKey = `midas:xfx:ptr:*:${chatId}`;
      const xfxKeys = await redisConnection.keys(xfxCandidateKey).catch(() => [] as string[]);
      const xfxPointerKey = xfxKeys[0] ?? null;

      if (xfxPointerKey) {
        const xfxDraftId = await redisConnection.get(xfxPointerKey).catch(() => null);
        if (xfxDraftId && /^[0-9A-Z]{26}$/.test(xfxDraftId) && message.text) {
          try {
            xfxResolved = await resolveWorkspace(telegramUserId, chatId);
          } catch { /* workspace not found — fall through */ }

          if (xfxResolved) {
            // Validate amount (SEC-02: no float, use validateAmountString)
            const { validateAmountString } = await import('../services/clarification.service.js');
            const rawInput = message.text.trim().replace(/[,\s]/g, '');  // "920 000" → "920000"
            const validAmount = validateAmountString(rawInput);

            if (!validAmount) {
              // Invalid — prompt user again, don't consume the intercept
              void upsertBotMessage(telegramUserId, chatId,
                '⚠️ Не понял сумму. Напиши числом, например: <code>920000</code>',
              );
              await reply.status(200).send({ ok: true });
              return;
            }

            // Fetch draft to get account currency
            const xfxDraft = await getDraftFields(xfxResolved.workspaceId, xfxResolved.userId, xfxDraftId);
            const xfxAcct  = xfxDraft?.account_id
              ? await getAccountWithBalance(xfxResolved.workspaceId, xfxResolved.userId, xfxDraft.account_id)
              : null;

            if (!xfxDraft || !xfxAcct) {
              // Draft or account gone — clear intercept and fall through
              await redisConnection.del(xfxPointerKey).catch(() => {/* non-fatal */});
            } else {
              // Save the debit amount
              const { patchDraftDebitAmount } = await import('../services/clarification.service.js');
              const patchRes = await patchDraftDebitAmount(
                xfxResolved.workspaceId, xfxResolved.userId, xfxDraftId,
                validAmount, xfxAcct.currency,
              );

              // Clear the intercept key regardless of patch result
              await redisConnection.del(xfxPointerKey).catch(() => {/* non-fatal */});

              if (patchRes.status !== 'ready') {
                void upsertBotMessage(telegramUserId, chatId,
                  '⚠️ Не удалось сохранить сумму. Попробуй ещё раз.',
                );
                await reply.status(200).send({ ok: true });
                return;
              }

              // Restore preview card with updated math block + xfx button
              const previewMsgId = await redisConnection.get(`midas:preview:${xfxDraftId}`).catch(() => null);
              if (previewMsgId) {
                const previewRes = await confirmPreviewFull(xfxResolved.workspaceId, xfxResolved.userId, xfxDraftId);
                void editMessageText(chatId, previewMsgId, previewRes.text, confirmKbForDraft(xfxDraftId, previewRes));
              } else {
                // Fallback: send new message if card not in Redis
                const previewRes = await confirmPreviewFull(xfxResolved.workspaceId, xfxResolved.userId, xfxDraftId);
                void upsertBotMessage(telegramUserId, chatId, previewRes.text, confirmKbForDraft(xfxDraftId, previewRes));
              }

              request.log.info({ msg: '[midas:bot:webhook] xfx: debit amount saved', workspaceId: xfxResolved.workspaceId });
              await reply.status(200).send({ ok: true });
              return;
            }
          }
        }
      }
    }

    // ── Step 5f-clar: Phase 1.32 — clarification amount text intercept ────
    // If user is in the midas:clar: state (bot asked «Сколько?»), intercept
    // their next text message as the new amount.
    // Runs BEFORE ia: intercept, BEFORE ac: onboarding, BEFORE edit, BEFORE AI parse.
    if (!commandToken) {


      const clarIntKey = clarStateKey(telegramUserId, chatId);
      const clarIntState = await redisConnection.get(clarIntKey);
      if (clarIntState) {
        // clarIntState format: "{draftId}:amt"
        const colonPos = clarIntState.indexOf(':');
        const clarDraftId = colonPos === -1 ? clarIntState : clarIntState.slice(0, colonPos);
        const clarField = colonPos === -1 ? '' : clarIntState.slice(colonPos + 1);

        // ── Phase 1.38: amt+cur — combined amount + currency answer ───────
        if (clarField === 'amt+cur' && /^[0-9A-Z]{26}$/.test(clarDraftId)) {
          // Extract amount from free-form input: "500", "500 рублей", "1000 долларов" all work
          const amtCurText = message.text ?? '';
          const validAmountAC = extractAmountFromText(amtCurText);
          if (!validAmountAC) {
            void upsertBotMessage(telegramUserId, chatId,
              '⚠️ Не нашёл сумму. Напиши, например: <code>1000 USD</code> или <code>500 руб</code>',
            );
            await reply.status(200).send({ ok: true });
            return;
          }

          // Try to extract currency from the same message (anything non-numeric after/before number)
          // Uses normalizeCurrencyInput so colloquial words work: "евро" → EUR, "доллар" → USD
          const currencyMatchAC = amtCurText
            .replace(/[\d\s.,]/g, ' ')   // strip numbers + punctuation
            .trim()
            .split(/\s+/)
            .find((t) => /^[a-zA-Zа-яА-ЯёЁ₴$€£¥₿]{1,10}$/.test(t)) ?? null;
          const validCurrencyAC = currencyMatchAC
            ? normalizeCurrencyInput(currencyMatchAC)  // handles 'евро', 'руб', 'доллар' etc.
            : null;

          // Delete intercept key and clar card
          await redisConnection.del(clarIntKey);
          const clarMsgCacheKeyAC = `midas:clar:msg:${telegramUserId}:${chatId}`;
          try {
            const prevId = await redisConnection.get(clarMsgCacheKeyAC);
            if (prevId) {
              await redisConnection.del(clarMsgCacheKeyAC);
              void deleteMessage(chatId, prevId);
            }
          } catch { /* non-fatal */ }

          let acResolved: { workspaceId: string; userId: string };
          try {
            acResolved = await resolveWorkspace(telegramUserId, chatId);
          } catch {
            void upsertBotMessage(telegramUserId, chatId, '⚠️ Не удалось обработать. Попробуйте позже.');
            await reply.status(200).send({ ok: true });
            return;
          }

          // Patch amount
          const amtPatchAC = await patchDraftAmount(
            acResolved.workspaceId, acResolved.userId, clarDraftId, validAmountAC,
          );

          if (amtPatchAC.status !== 'ready' && amtPatchAC.status !== 'wrong_state') {
            void upsertBotMessage(telegramUserId, chatId, '⚠️ Транзакция не найдена или уже обработана.');
            await reply.status(200).send({ ok: true });
            return;
          }

          if (validCurrencyAC) {
            // Both amount and currency extracted — patch currency and show confirm card
            await patchDraftCurrency(
              acResolved.workspaceId, acResolved.userId, clarDraftId, validCurrencyAC,
            );
            await sendAndStorePreview(telegramUserId, chatId, acResolved.workspaceId, acResolved.userId, clarDraftId);
          } else {
            // Amount extracted but no currency — ask for currency separately
            const awaitCurKeyAC = `midas:awaiting_cur:${chatId}`;
            await redisConnection.setex(
              awaitCurKeyAC,
              300,
              `${clarDraftId}:${acResolved.workspaceId}:${acResolved.userId}`,
            );
            const curClarMsg = await upsertBotMessage(
              telegramUserId,
              chatId,
              CUR_PROMPT_MSG,
            );
            if (curClarMsg) {
              await redisConnection.setex(`midas:clar:msg:${telegramUserId}:${chatId}`, 300, curClarMsg);
            }
          }

          request.log.info({ msg: '[midas:bot:webhook] clar: amt+cur patched', workspaceId: acResolved.workspaceId, hadCurrency: !!validCurrencyAC });
          await reply.status(200).send({ ok: true });
          return;
        }

        if (clarField === 'amt' && /^[0-9A-Z]{26}$/.test(clarDraftId)) {
          // Validate amount (SEC-02: NUMERIC regex)
          const validAmount = extractAmountFromText(message.text);
          if (!validAmount) {
            void upsertBotMessage(telegramUserId, chatId, '⚠️ Неверная сумма. Напиши число, например: 380 или 1500.50');
            // Keep Redis key alive — user can try again within TTL
            await reply.status(200).send({ ok: true });
            return;
          }

          // Valid amount — delete intercept key and patch draft
          await redisConnection.del(clarIntKey);

          let clarIntResolved: { workspaceId: string; userId: string };
          try {
            clarIntResolved = await resolveWorkspace(telegramUserId, chatId);
          } catch {
            void upsertBotMessage(telegramUserId, chatId, '⚠️ Не удалось обработать. Попробуйте позже.');
            await reply.status(200).send({ ok: true });
            return;
          }

          // Phase 1.38 fix: delete the old clarification card before showing confirm card
          const clarMsgCacheKey = `midas:clar:msg:${telegramUserId}:${chatId}`;
          let prevClarMsgIdToDelete: string | null = null;
          try {
            prevClarMsgIdToDelete = await redisConnection.get(clarMsgCacheKey);
            if (prevClarMsgIdToDelete) {
              await redisConnection.del(clarMsgCacheKey);
              void deleteMessage(chatId, prevClarMsgIdToDelete);
            }
          } catch {
            // Non-fatal — proceed even if delete fails
          }

          const amtPatchResult = await patchDraftAmount(
            clarIntResolved.workspaceId, clarIntResolved.userId, clarDraftId, validAmount,
          );

          if (amtPatchResult.status === 'ready') {
            // Phase 1.38: Check if currency is already set before showing confirm card.
            // If user hasn't set a default currency in Settings, ask for it now.
            const curSetFlag = await redisConnection.exists(
              `midas:cur_set:${clarIntResolved.workspaceId}`,
            );
            if (!curSetFlag) {
              // Store currency await context so the next message is intercepted
              const awaitCurKey = `midas:awaiting_cur:${chatId}`;
              await redisConnection.setex(
                awaitCurKey,
                300, // 5-minute TTL
                `${clarDraftId}:${clarIntResolved.workspaceId}:${clarIntResolved.userId}`,
              );
              const clarMsg = await upsertBotMessage(
                telegramUserId,
                chatId,
                CUR_PROMPT_MSG,
              );
              if (clarMsg) {
                await redisConnection.setex(
                  `midas:clar:msg:${telegramUserId}:${chatId}`,
                  300,
                  clarMsg,
                );
              }
            } else {
              await sendAndStorePreview(telegramUserId, chatId, clarIntResolved.workspaceId, clarIntResolved.userId, clarDraftId);
            }
          } else if (amtPatchResult.status === 'still_needs' && amtPatchResult.field === 'intent') {
            void upsertBotMessage(
              telegramUserId,
              chatId,
              '🤔 Уточни, что произошло:',
              {
                inline_keyboard: [
                  [{ text: '💸 Расход', callback_data: `clar:intent:expense:${clarDraftId}` }, { text: '💰 Доход', callback_data: `clar:intent:income:${clarDraftId}` }],
                  [{ text: '🤝 Долг (дал)', callback_data: `clar:intent:debt_given:${clarDraftId}` }, { text: '🤲 Долг (взял)', callback_data: `clar:intent:debt_received:${clarDraftId}` }],
                ]
              },
            );
          } else {
            void upsertBotMessage(telegramUserId, chatId, '⚠️ Транзакция не найдена или уже обработана.');
          }

          request.log.info({ msg: '[midas:bot:webhook] clar: amount patched via text', workspaceId: clarIntResolved.workspaceId, result: amtPatchResult.status });
          await reply.status(200).send({ ok: true });
          return;
        } else {
          // Malformed state — clear and fall through
          await redisConnection.del(clarIntKey);
          request.log.warn({ msg: '[midas:bot:webhook] clar: malformed Redis state — cleared', clarField });
        }
      }
    }

    // ── Step 5f-ia: Phase 1.31 — inline account creation name intercept ──
    // If user is in the ia:rename sub-flow (tapped ✏️ Другое название), intercept
    // their next text message as the custom account name.
    // Runs BEFORE Phase 1.30 onboarding intercept and BEFORE AI parse.
    if (!commandToken) {
      // Scan active ia: keys for this user — keyed by draftId.
      // We use a unique-per-draft key; check by pattern is not needed:
      // the text intercept is only active after ia:rename sets it.
      // We cannot easily enumerate all draftIds per-user without a separate index.
      // Solution: store the active ia draftId in a user-scoped "pointer" key.
      const iaPointerKey = `midas:ia:ptr:${telegramUserId}:${chatId}`;
      const activeDraftId = await redisConnection.get(iaPointerKey);
      if (activeDraftId) {
        const iaRaw = await redisConnection.get(inlineAccountKey(activeDraftId));
        if (iaRaw) {
          let iaState: InlineAccountState;
          try { iaState = JSON.parse(iaRaw) as InlineAccountState; }
          catch {
            await redisConnection.del(inlineAccountKey(activeDraftId));
            await redisConnection.del(iaPointerKey);
            iaState = { step: 'name_input', suggestedName: '', currency: 'USDT', draftId: activeDraftId };
          }

          // iaState.step is always 'name_input' at this point (the only step in this flow)
          {
            const trimmedName = message.text.trim();
            if (trimmedName.length === 0 || trimmedName.length > 100) {
              void upsertBotMessage(telegramUserId, chatId, '⚠️ Название не может быть пустым или длиннее 100 символов. Попробуй ещё раз:');
              await reply.status(200).send({ ok: true });
              return;
            }

            await redisConnection.del(inlineAccountKey(activeDraftId));
            await redisConnection.del(iaPointerKey);

            try {
              const resolved = await resolveWorkspace(telegramUserId, chatId);
              const createRes = await addAccountWithCurrency(
                resolved.workspaceId, resolved.userId, trimmedName, iaState.currency,
              );
              // Link account to draft
              const allAccounts = await getWorkspaceAccountsForInline(resolved.workspaceId, resolved.userId);
              const foundAcc = allAccounts.find((a) => a.name.trim().toLowerCase() === trimmedName.toLowerCase());
              if (foundAcc) {
                await setDraftAccountId(resolved.workspaceId, resolved.userId, activeDraftId, foundAcc.id);
              }
              const label = createRes === 'duplicate'
                ? `⚠️ Счёт <b>${escapeHtml(trimmedName)}</b> уже существует.`
                : `✅ Счёт <b>${escapeHtml(trimmedName)}</b> (${escapeHtml(iaState.currency)}) создан!`;
              const previewRes = await confirmPreviewFull(resolved.workspaceId, resolved.userId, activeDraftId);
              void upsertBotMessage(
                telegramUserId,
                chatId,
                `${label}\n\n${previewRes.text}`,
                confirmKbForDraft(activeDraftId, previewRes),
              );
              request.log.info({ msg: '[midas:bot:webhook] ia: account created via text rename', workspaceId: resolved.workspaceId });
            } catch (err: unknown) {
              const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
              request.log.error({ msg: '[midas:bot:webhook] ia: rename text create failed', errorClass });
              void upsertBotMessage(telegramUserId, chatId, '⚠️ Не удалось создать счёт. Попробуйте позже.');
            }
            await reply.status(200).send({ ok: true });
            return;
          }
        }
      }
    }

    // ── Step 5f-ac: Phase 1.30 — account onboarding text intercept ───────
    // If user is in account onboarding (name_input or cur_input step), intercept
    // their next text message as account name or currency code.
    // Runs BEFORE edit-amount intercept and BEFORE AI parse.
    if (!commandToken) {
      const acKey = onboardStateKey(telegramUserId, chatId);
      const acRaw = await redisConnection.get(acKey);
      if (acRaw) {
        let acState: AccountOnboardState;
        try { acState = JSON.parse(acRaw) as AccountOnboardState; }
        catch {
          await redisConnection.del(acKey);
          // Malformed state — fall through to normal flow
          acState = { step: 'type_pick' };
        }

        if (acState.step === 'name_input') {
          // User typed the account name — validate, auto-capitalize, fuzzy-match, then move to currency.
          const raw = message.text.trim();
          const trimmed = capitalizeFirst(raw); // U4: auto-capitalize first char

          // U6: empty input — friendly nudge, not an error
          if (raw.length === 0) {
            void upsertBotMessage(
              telegramUserId, chatId,
              '🤔 Просто напишите название — например, <i>Тинькофф</i> или <i>Binance</i>',
            );
            await reply.status(200).send({ ok: true });
            return;
          }

          // Hard limit: >100 chars is garbage input
          if (trimmed.length > 100) {
            void upsertBotMessage(telegramUserId, chatId, '⚠️ Название слишком длинное (макс. 100 символов). Попробуй покороче:');
            await reply.status(200).send({ ok: true });
            return;
          }

          // U7: soft warning for >28 chars (still accepted, just notified)
          if (trimmed.length > 28) {
            void upsertBotMessage(
              telegramUserId, chatId,
              `ℹ️ Название длинновато — в интерфейсе оно может обрезаться. Продолжаем...`,
            );
          }

          {
            // Phase 2.3: skip fuzzy if user already rejected a suggestion once
            const skipFuzzy = acState.fuzzyDisabled === true;

            if (!skipFuzzy) {
              // Restrict fuzzy search by accountType
              const typeFilter = acState.accountType === 'card'
                ? 'card'
                : acState.accountType === 'exchange'
                  ? 'exchange'
                  : acState.accountType === 'wallet'
                    ? 'wallet'
                    : undefined; // 'custom' → match across all types

              const fuzzyMatch: import('../services/account-onboard-keyboard.service.js').FuzzyAccountMatch | null =
                fuzzyMatchAccountName(trimmed, typeFilter);

              if (fuzzyMatch) {
                // Smart confirm: save state with suggestion, show confirm UI
                const smartState: AccountOnboardState = {
                  ...acState,
                  step: 'smart_confirm',
                  originalName: trimmed,
                  suggestedName: fuzzyMatch.name,
                  suggestedType: fuzzyMatch.type,
                  suggestedCurrency: fuzzyMatch.defaultCurrency,
                };
                await redisConnection.set(acKey, JSON.stringify(smartState), 'EX', ONBOARD_STATE_TTL_SEC);
                try {
                  const resolved = await resolveWorkspace(telegramUserId, chatId);
                  void upsertBotMessage(
                    telegramUserId, chatId,
                    buildSmartConfirmText(fuzzyMatch),
                    buildSmartConfirmKeyboard(fuzzyMatch.name),
                  );
                  request.log.info({ msg: '[midas:bot:webhook] ac: smart name suggestion shown', workspaceId: resolved.workspaceId });
                } catch {
                  void upsertBotMessage(telegramUserId, chatId, buildSmartConfirmText(fuzzyMatch), buildSmartConfirmKeyboard(fuzzyMatch.name));
                }
                await reply.status(200).send({ ok: true });
                return;
              }
            }

            // No match (or fuzzy disabled)
            // master_roadmap 2.1: show no-match screen instead of jumping to currency picker
            // Special case: Lightning — currency is always BTC, always skip currency picker
            if (acState.accountType === 'wallet' && acState.walletSubtype === 'lightning') {
              // Lightning → create account directly with BTC currency
              const acName = trimmed;
              const acCur = 'BTC';
              const updatedState: AccountOnboardState = { ...acState, step: 'cur_pick', name: acName, currency: acCur, isCustomName: true };
              await redisConnection.set(acKey, JSON.stringify(updatedState), 'EX', ONBOARD_STATE_TTL_SEC);
              try {
                const resolved = await resolveWorkspace(telegramUserId, chatId);
                void upsertBotMessage(telegramUserId, chatId, buildCurrencyPickerText(acName, true), buildCryptoCurrencyPage(0));
                request.log.info({ msg: '[midas:bot:webhook] ac: wallet/lightning name received', workspaceId: resolved.workspaceId });
              } catch {
                void upsertBotMessage(telegramUserId, chatId, buildCurrencyPickerText(acName, true), buildCryptoCurrencyPage(0));
              }
            } else if (acState.fuzzyDisabled === true) {
              // User already rejected a suggestion — go directly to currency picker with this name
              const updatedState: AccountOnboardState = { ...acState, step: 'cur_pick', name: trimmed, isCustomName: true };
              await redisConnection.set(acKey, JSON.stringify(updatedState), 'EX', ONBOARD_STATE_TTL_SEC);
              try {
                const resolved = await resolveWorkspace(telegramUserId, chatId);
                const curKb = chooseCurKeyboard(acState.accountType ?? 'custom', acState.walletSubtype);
                void upsertBotMessage(telegramUserId, chatId, buildCurrencyPickerText(trimmed, true), curKb);
                request.log.info({ msg: '[midas:bot:webhook] ac: name re-input received (fuzzy disabled)', workspaceId: resolved.workspaceId });
              } catch {
                void upsertBotMessage(telegramUserId, chatId, buildCurrencyPickerText(trimmed, true));
              }
            } else {
              // master_roadmap 1.7: no match found → show no-match screen
              const noMatchState: AccountOnboardState = {
                ...acState,
                step: 'name_confirm_custom',
                pendingName: trimmed,
              };
              await redisConnection.set(acKey, JSON.stringify(noMatchState), 'EX', ONBOARD_STATE_TTL_SEC);
              const backTarget = acState.accountType === 'wallet' ? 'subtype' : 'type';
              void upsertBotMessage(
                telegramUserId, chatId,
                buildNoMatchText(trimmed, acState.accountType ?? 'custom', acState.walletSubtype),
                buildNoMatchKeyboard(trimmed, backTarget),
              );
            }
          }
          await reply.status(200).send({ ok: true });
          return;

        } else if (acState.step === 'cur_search') {
          // master_roadmap 2.5: user typed a currency search query
          const query = message.text.trim();
          if (query.length === 0) {
            await reply.status(200).send({ ok: true });
            return;
          }
          // Determine which pool to search
          const poolType = acState.accountType ?? 'custom';
          const pool: string[] = (
            poolType === 'card' || poolType === 'cash'
              ? [...FIAT_CURRENCY_PRESETS]
              : poolType === 'wallet' && acState.walletSubtype === 'ewallet'
                ? [...FIAT_CURRENCY_PRESETS]
                : poolType === 'wallet' && acState.walletSubtype === 'ton'
                  ? [...TON_CURRENCY_PRESETS]
                  : poolType === 'wallet' || poolType === 'exchange'
                    ? [...CRYPTO_CURRENCY_PRESETS]
                    : [...FIAT_CURRENCY_PRESETS, ...CRYPTO_CURRENCY_PRESETS] // custom
          );
          const matches = searchCurrenciesOnboard(query, pool);
          const isCustomPool = acState.isCustomName === true;
          const acNamePool = acState.name ?? '';
          if (matches.length === 0) {
            void upsertBotMessage(
              telegramUserId, chatId,
              buildCurrencySearchNoResultsText(query, acNamePool, isCustomPool),
              buildCurrencySearchNoResultsKeyboard(query, 'ac:cur:list'),
            );
          } else {
            void upsertBotMessage(
              telegramUserId, chatId,
              buildCurrencySearchResultsText(query, acNamePool, isCustomPool, acState.accountType, acState.walletSubtype),
              buildCurrencySearchResultsKeyboard(matches, 'ac:cur:list'),
            );
          }
          await reply.status(200).send({ ok: true });
          return;

        } else if (acState.step === 'cur_input') {
          // User typed a custom currency code — validate and create account
          const rawCode = message.text.trim().toUpperCase();
          if (!/^[A-Z]{1,10}$/.test(rawCode)) {
            void upsertBotMessage(telegramUserId, chatId, '⚠️ Неверный код валюты. Используй латинские буквы, например: <i>SOL</i>, <i>UAH</i>, <i>MATIC</i>.');
            await reply.status(200).send({ ok: true });
            return;
          }

          // ── Phase 2.5: Account-currency compatibility gate ────────────
          const curInputValidation = validateAccountCurrency(
            acState.accountType,
            acState.walletSubtype,
            (acState.name ?? '').toLowerCase(),
            rawCode,
          );
          if (!curInputValidation.valid) {
            // Do NOT delete state — user can type a valid code instead
            void upsertBotMessage(telegramUserId, chatId, curInputValidation.errorMessage);
            await reply.status(200).send({ ok: true });
            return;
          }
          // ── End Phase 2.5 ────────────────────────────────────────────

          await redisConnection.del(acKey);
          try {
            const resolved = await resolveWorkspace(telegramUserId, chatId);
            let accountName: string;
            if (acState.accountType === 'cash') {
              accountName = `Наличные ${rawCode}`;
            } else {
              accountName = acState.name ?? 'Счёт';
            }
            const res = await addAccountReturningId(resolved.workspaceId, resolved.userId, accountName, rawCode);
            if (res.status === 'duplicate') {

              void upsertBotMessage(
                telegramUserId,
                chatId,
                `⚠️ Счёт <b>${escapeHtml(accountName)}</b> уже существует.`,
                buildFinishOnboardKeyboard(),
              );
            } else {
              // ── Phase 2.5: If launched from draft picker — link account and return to draft ──
              if (acState.linkedDraftId && res.accountId) {
                try {
                  await setDraftAccountId(resolved.workspaceId, resolved.userId, acState.linkedDraftId, res.accountId);
                } catch { /* non-fatal */ }
                try {
                  await softDeletePlaceholderAccount(resolved.workspaceId, resolved.userId);
                } catch { /* non-fatal */ }
                const pickerMsgIdCi = await getActiveMessageId(telegramUserId, chatId);
                await clearActiveMessageId(telegramUserId, chatId);
                const previewResCi = await confirmPreviewFull(resolved.workspaceId, resolved.userId, acState.linkedDraftId);
                const confirmMsgCi = previewResCi.text;
                if (pickerMsgIdCi) {
                  void editMessageText(chatId, pickerMsgIdCi, confirmMsgCi, confirmKbForDraft(acState.linkedDraftId, previewResCi));
                  try { await redisConnection.set(`midas:preview:${acState.linkedDraftId}`, pickerMsgIdCi, 'EX', 3600); } catch { /* non-fatal */ }
                } else {
                  void upsertBotMessage(telegramUserId, chatId, confirmMsgCi, confirmKbForDraft(acState.linkedDraftId, previewResCi));
                }
                request.log.info({ msg: '[midas:bot:webhook] ac: cur_input — account linked to draft', workspaceId: resolved.workspaceId });
                await reply.status(200).send({ ok: true });
                return; // Skip standard D4 / first-account success screen
              }

              // Phase LD: custom account created via free-text currency input.
              // Soft-delete the onboarding placeholder — only the custom account remains.
              try {
                await softDeletePlaceholderAccount(resolved.workspaceId, resolved.userId);
              } catch { /* non-fatal */ }
              const icon = getProviderIcon(undefined, acState.accountType ?? 'custom', acState.walletSubtype);
              // Phase LD+: fetch the REAL default account for the success screen
              const defCi = await getWorkspaceDefaultAccount(resolved.workspaceId, resolved.userId).catch(() => null);
              // Activate nav keyboard: delete inline onboarding msg, send success + ReplyKeyboard
              const oldMsgIdCi = await getActiveMessageId(telegramUserId, chatId);
              if (oldMsgIdCi) void deleteMessage(chatId, oldMsgIdCi);
              await clearActiveMessageId(telegramUserId, chatId);
              if (defCi && !defCi.isFirst) {
                // D.4 Hybrid: 2nd+ account — delete old success card, send fresh one
                const oldSuccessIdCi = await redisConnection.get(lastSuccessMsgKey(telegramUserId, chatId));
                if (oldSuccessIdCi) void deleteMessage(chatId, oldSuccessIdCi);
                const portfolioCi = await getWorkspaceActiveAccounts(resolved.workspaceId, resolved.userId).catch(() => []);
                const d4TextCi = buildAccountAddedD4Text(
                  icon, escapeHtml(accountName), escapeHtml(rawCode), undefined, portfolioCi,
                  PROVIDER_ICONS,
                );
                const newSuccessIdCi = await sendMessageWithReplyKeyboard(chatId, d4TextCi, buildMainMenuKeyboard());
                if (newSuccessIdCi) void redisConnection.set(lastSuccessMsgKey(telegramUserId, chatId), newSuccessIdCi, 'EX', LAST_SUCCESS_MSG_TTL_SEC);
              } else {
                // First account — full onboarding success screen
                const defIconCi = defCi ? getProviderIcon(undefined, defCi.type, undefined) : icon;
                const defNameCi = defCi?.name ?? accountName;
                const defCurCi = defCi?.currency ?? rawCode;
                const firstSuccessIdCi = await sendMessageWithReplyKeyboard(
                  chatId,
                  buildSuccessScreenText(escapeHtml(defNameCi), escapeHtml(defCurCi), undefined, defIconCi),
                  buildMainMenuKeyboard(),
                );
                if (firstSuccessIdCi) void redisConnection.set(lastSuccessMsgKey(telegramUserId, chatId), firstSuccessIdCi, 'EX', LAST_SUCCESS_MSG_TTL_SEC);
              }
              request.log.info({ msg: '[midas:bot:webhook] ac: account created via custom currency text', workspaceId: resolved.workspaceId });
            }
          } catch (err: unknown) {
            const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
            request.log.error({ msg: '[midas:bot:webhook] ac: cur_input account create failed', errorClass });
            void upsertBotMessage(telegramUserId, chatId, '⚠️ Не удалось создать счёт. Попробуйте позже.');
          }
          await reply.status(200).send({ ok: true });
          return;

        } else if (acState.step === 'bal_input') {
          // Phase 2.2: user typed initial balance amount
          const amount = extractAmountFromText(message.text);
          if (!amount) {
            void upsertBotMessage(
              telegramUserId, chatId,
              '⚠️ Не распознал число. Напиши сумму цифрами, например: <i>15000</i>',
              buildSkipBalanceKeyboard(),
            );
            await reply.status(200).send({ ok: true });
            return;
          }

          if (!acState.accountId) {
            // Safety: missing accountId — skip to finish keyboard
            await redisConnection.del(acKey);
            void upsertBotMessage(telegramUserId, chatId, '⚠️ Ошибка состояния. Счёт создан.', buildFinishOnboardKeyboard());
            await reply.status(200).send({ ok: true });
            return;
          }

          await redisConnection.del(acKey);
          try {
            const resolved = await resolveWorkspace(telegramUserId, chatId);
            await setAccountBalanceById(resolved.workspaceId, resolved.userId, acState.accountId, amount);

            // ── Phase 2.5: If launched from draft picker — link account and return to draft ──
            if (acState.linkedDraftId) {
              try {
                await setDraftAccountId(resolved.workspaceId, resolved.userId, acState.linkedDraftId, acState.accountId);
              } catch { /* non-fatal */ }
              try {
                await softDeletePlaceholderAccount(resolved.workspaceId, resolved.userId);
              } catch { /* non-fatal */ }
              const pickerMsgIdBi2 = await getActiveMessageId(telegramUserId, chatId);
              await clearActiveMessageId(telegramUserId, chatId);
              const previewResBi2 = await confirmPreviewFull(resolved.workspaceId, resolved.userId, acState.linkedDraftId);
              const confirmMsgBi2 = previewResBi2.text;
              if (pickerMsgIdBi2) {
                void editMessageText(chatId, pickerMsgIdBi2, confirmMsgBi2, confirmKbForDraft(acState.linkedDraftId, previewResBi2));
                try { await redisConnection.set(`midas:preview:${acState.linkedDraftId}`, pickerMsgIdBi2, 'EX', 3600); } catch { /* non-fatal */ }
              } else {
                void upsertBotMessage(telegramUserId, chatId, confirmMsgBi2, confirmKbForDraft(acState.linkedDraftId, previewResBi2));
              }
              request.log.info({ msg: '[midas:bot:webhook] ac: bal_input — account linked to draft', workspaceId: resolved.workspaceId });
              await reply.status(200).send({ ok: true });
              return; // Skip standard D4 / first-account success screen
            }

            // Phase LD: balance entered — custom account fully set up.
            // Soft-delete the onboarding placeholder (already gone after ac:currency, but idempotent).
            try {
              await softDeletePlaceholderAccount(resolved.workspaceId, resolved.userId);
            } catch { /* non-fatal */ }
            // Phase LD+: fetch the REAL default account for the success screen
            const defBi = await getWorkspaceDefaultAccount(resolved.workspaceId, resolved.userId).catch(() => null);
            const acName = acState.name ?? 'Счёт';
            const acCur = acState.currency ?? '';
            const icon = getProviderIcon(undefined, acState.accountType ?? 'custom', acState.walletSubtype);
            // Activate nav keyboard: delete inline onboarding msg, send success + ReplyKeyboard
            const oldMsgIdBal = await getActiveMessageId(telegramUserId, chatId);
            if (oldMsgIdBal) void deleteMessage(chatId, oldMsgIdBal);
            await clearActiveMessageId(telegramUserId, chatId);
            if (defBi && !defBi.isFirst) {
              // D.4 Hybrid: 2nd+ account — delete old success card, send fresh one
              const oldSuccessIdBi = await redisConnection.get(lastSuccessMsgKey(telegramUserId, chatId));
              if (oldSuccessIdBi) void deleteMessage(chatId, oldSuccessIdBi);
              const portfolioBi = await getWorkspaceActiveAccounts(resolved.workspaceId, resolved.userId).catch(() => []);
              const d4TextBi = buildAccountAddedD4Text(
                icon, escapeHtml(acName), escapeHtml(acCur), amount, portfolioBi,
                PROVIDER_ICONS,
              );
              const newSuccessIdBi = await sendMessageWithReplyKeyboard(chatId, d4TextBi, buildMainMenuKeyboard());
              if (newSuccessIdBi) void redisConnection.set(lastSuccessMsgKey(telegramUserId, chatId), newSuccessIdBi, 'EX', LAST_SUCCESS_MSG_TTL_SEC);
            } else {
              // First account — full onboarding success screen with balance
              const defIconBi = defBi ? getProviderIcon(undefined, defBi.type, undefined) : icon;
              const defNameBi = defBi?.name ?? acName;
              const defCurBi = defBi?.currency ?? acCur;
              const firstSuccessIdBi = await sendMessageWithReplyKeyboard(
                chatId,
                buildSuccessScreenText(escapeHtml(defNameBi), escapeHtml(defCurBi), amount, defIconBi),
                buildMainMenuKeyboard(),
              );
              if (firstSuccessIdBi) void redisConnection.set(lastSuccessMsgKey(telegramUserId, chatId), firstSuccessIdBi, 'EX', LAST_SUCCESS_MSG_TTL_SEC);
            }
            request.log.info({ msg: '[midas:bot:webhook] ac: balance set via onboarding', workspaceId: resolved.workspaceId });
          } catch (err: unknown) {
            const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
            request.log.error({ msg: '[midas:bot:webhook] ac: bal_input setBalance failed', errorClass });
            void upsertBotMessage(telegramUserId, chatId, '⚠️ Не удалось записать баланс. Счёт создан.', buildFinishOnboardKeyboard());
          }
          await reply.status(200).send({ ok: true });
          return;
        } else {
          // Onboarding is active but current step does NOT expect free text
          // (cur_pick, wallet_subtype, type_pick, name_confirm_custom — waiting for button).
          // Phase 2.5+: Instead of silently ignoring the message, clear the onboarding state
          // and fall through to the AI parser so the user can naturally "escape" by typing
          // a new transaction (e.g. "кофе 150" while on type_pick step).
          await redisConnection.del(acKey);
          // Fall through — do NOT return here. The message continues to the AI parse path below.
        }
      }
    }

    // ── Step 5g: Phase 1.28 — edit amount text intercept ─────────────
    // If user is in edit-amount mode (tapped “✅ Изменить сумму”), intercept their next
    // text message as the new amount value.
    // This check runs BEFORE settings search and BEFORE AI parse.
    if (!commandToken) {
      const edKey = editStateKey(telegramUserId, chatId);
      const edState = await redisConnection.get(edKey);
      if (edState) {
        // edState format: "amt:<txId>"
        const colonIdx = edState.indexOf(':');
        const field = colonIdx === -1 ? edState : edState.slice(0, colonIdx);
        const txId = colonIdx === -1 ? '' : edState.slice(colonIdx + 1);

        if (field === 'amt' && /^[0-9A-Z]{26}$/.test(txId)) {
          // FIX: extract number from free-form text ("убил кенни 50000 руб" → "50000").
          // If no number present, user is writing a new transaction — clear state and fall through to AI.
          const extractedAmtOld = extractAmountFromText(message.text);
          if (!extractedAmtOld) {
            await redisConnection.del(edKey);
            request.log.info({ msg: '[midas:bot:webhook] edit: no number in text — cleared edit state, falling through to AI', txId });
            // No return — fall through to AI parse below
          } else {
            let edWorkspaceId: string;
            try {
              const resolved = await resolveWorkspace(telegramUserId, chatId);
              edWorkspaceId = resolved.workspaceId;
              const res = await updateTransactionAmount(txId, edWorkspaceId, resolved.userId, extractedAmtOld);

              if (res.status === 'invalid_amount') {
                // Keep state alive so user can try again
                await redisConnection.expire(edKey, EDIT_STATE_TTL_SEC);
                void upsertBotMessage(telegramUserId, chatId, '⚠️ Неверная сумма. Отправьте число, например: 380 или 1500.50');
              } else {
                // Delete state on success or hard error
                await redisConnection.del(edKey);

                if (res.status === 'ok') {
                  const card = await getTransactionCard(txId, edWorkspaceId, resolved.userId);
                  if (card) {
                    void upsertBotMessage(
                      telegramUserId,
                      chatId,
                      formatTransactionCard(card),
                      buildTransactionCardKeyboard(txId, card.is_cross_currency)
                    );
                  } else {
                    void upsertBotMessage(telegramUserId, chatId, '✅ Сумма изменена. Баланс пересчитан автоматически.');
                  }
                  request.log.info({ msg: '[midas:bot:webhook] edit: amount updated via text', txId, workspaceId: edWorkspaceId });
                } else if (res.status === 'cross_currency_blocked') {
                  void upsertBotMessage(telegramUserId, chatId, '⚠️ Изменение суммы недоступно для мультивалютных транзакций.');
                } else {
                  void upsertBotMessage(telegramUserId, chatId, '⚠️ Транзакция не найдена.');
                }
              }
            } catch (err: unknown) {
              await redisConnection.del(edKey);
              const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
              request.log.error({ msg: '[midas:bot:webhook] edit amount update failed', txId, errorClass });
              void upsertBotMessage(telegramUserId, chatId, '⚠️ Не удалось сохранить. Попробуйте позже.');
            }
            await reply.status(200).send({ ok: true });
            return;
          }
        } else {
          // Malformed state — discard silently, let message fall through
          await redisConnection.del(edKey);
          request.log.warn({ msg: '[midas:bot:webhook] edit: malformed Redis state — discarded', field });
        }
      }
    }

    // ── Step 5g-tx-edit: Phase 2.0 — transaction hub edit amount intercept ────────
    if (!commandToken) {
      const txEdKey = `midas:tx:edit:amt:${telegramUserId}:${chatId}`;
      const txEdStateValue = await redisConnection.get(txEdKey);
      if (txEdStateValue) {
        const [txEdStateTxId, txMsgId] = txEdStateValue.split(':') as [string, string | undefined];
        if (txEdStateTxId && /^[0-9A-Z]{26}$/.test(txEdStateTxId)) {
          // FIX: extract number from free-form text ("убил кенни 50000 руб" → "50000").
          // If no number present, user is writing a new transaction — clear state and fall through to AI.
          const extractedAmt = extractAmountFromText(message.text);
          if (!extractedAmt) {
            await redisConnection.del(txEdKey);
            request.log.info({ msg: '[midas:bot:webhook] tx edit: no number in text — cleared edit state, falling through to AI', txId: txEdStateTxId });
            // No return — fall through to AI parse below
          } else {
            let edWorkspaceId: string;
            try {
              const resolved = await resolveWorkspace(telegramUserId, chatId);
              edWorkspaceId = resolved.workspaceId;
              const res = await updateTransactionAmount(txEdStateTxId, edWorkspaceId, resolved.userId, extractedAmt);

              if (res.status === 'invalid_amount') {
                await redisConnection.expire(txEdKey, 120);
                void upsertBotMessage(telegramUserId, chatId, '⚠️ Неверная сумма. Отправьте число, например: 380 или 1500.50');
              } else {
                await redisConnection.del(txEdKey);
                if (res.status === 'ok') {
                  const card = await getTransactionCard(txEdStateTxId, edWorkspaceId, resolved.userId);
                  if (card) {
                    const { formatTxDetailCard } = await import('../utils/screen-builder.js');
                    const detailRows: { text: string; callback_data: string }[][] = [];
                    if (!card.is_cross_currency) detailRows.push([{ text: '\u270F\uFE0F \u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0441\u0443\u043C\u043C\u0443', callback_data: `tx:f:amt:${txEdStateTxId}:s` }]);
                    detailRows.push([{ text: '\uD83D\uDCC1 \u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044E', callback_data: `tx:f:cat:${txEdStateTxId}:0:s` }]);
                    detailRows.push([{ text: '\uD83C\uDFE6 \u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0441\u0447\u0451\u0442', callback_data: `tx:f:acc:${txEdStateTxId}:s` }]);
                    detailRows.push([{ text: '\uD83D\uDD04 \u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0442\u0438\u043F', callback_data: `tx:f:int:${txEdStateTxId}:s` }]);
                    detailRows.push([{ text: '\uD83D\uDDD1\uFE0F \u0423\u0434\u0430\u043B\u0438\u0442\u044C', callback_data: `tx:d:ask:${txEdStateTxId}:s` }]);
                    detailRows.push([{ text: '\u2716\uFE0F \u0417\u0430\u043A\u0440\u044B\u0442\u044C', callback_data: `tx:done:${txEdStateTxId}` }]);
                    if (txMsgId) {
                      const { editMessageText: editMsg, deleteMessage } = await import('../services/telegram-api.js');
                      void editMsg(chatId, txMsgId, formatTxDetailCard(card), { inline_keyboard: detailRows });
                      void deleteMessage(chatId, String(message.message_id));
                    } else {
                      void upsertBotMessage(telegramUserId, chatId, formatTxDetailCard(card), { inline_keyboard: detailRows });
                    }
                  } else {
                    void upsertBotMessage(telegramUserId, chatId, '✅ Сумма изменена. Баланс пересчитан.');
                  }
                  request.log.info({ msg: '[midas:bot:webhook] tx edit: amount updated via text', txId: txEdStateTxId, workspaceId: edWorkspaceId });
                } else if (res.status === 'cross_currency_blocked') {
                  void upsertBotMessage(telegramUserId, chatId, '⚠️ Изменение суммы недоступно для мультивалютных транзакций.');
                } else {
                  void upsertBotMessage(telegramUserId, chatId, '⚠️ Транзакция не найдена.');
                }
              }
            } catch (err: unknown) {
              await redisConnection.del(txEdKey);
              const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
              request.log.error({ msg: '[midas:bot:webhook] tx edit amount update failed', txId: txEdStateTxId, errorClass });
              void upsertBotMessage(telegramUserId, chatId, '⚠️ Не удалось сохранить. Попробуйте позже.');
            }
            await reply.status(200).send({ ok: true });
            return;
          }
        } else if (txEdStateTxId) {
          // Malformed state
          await redisConnection.del(txEdKey);
        }
      }
    }

    // ── Step 5g-tx: Phase 2.0 — transaction search text intercept ────────
    // If user is in tx search mode (tapped Поиск by name/amount/date), intercept their
    // next text message as the search query. Runs BEFORE settings search and AI parse.
    if (!commandToken) {
      const txSearchKey = `midas:tx:search:${telegramUserId}:${chatId}`;
      const txSearchMode = await redisConnection.get(txSearchKey);
      if (txSearchMode) {
        await redisConnection.del(txSearchKey);
        const queryText = (message.text ?? '').trim();

        try {
          const resolved = await resolveWorkspace(telegramUserId, chatId);
          const { searchByName, searchByAmount, searchByDateRange, parseDateInput,
            SEARCH_PAGE_SIZE: SPS_TX } = await import('../services/transaction-hub.service.js');
          const { buildSearchResultsKeyboard: buildSRKtx } = await import('../services/transaction-keyboard.service.js');
          const srCtxKeyTx = `midas:tx:sr:ctx:${telegramUserId}:${chatId}`;

          if (txSearchMode === 'name') {
            const { items, total } = await searchByName(resolved.workspaceId, resolved.userId, queryText, 0);
            // Store context for pagination
            try { await redisConnection.set(srCtxKeyTx, JSON.stringify({ t: 'n', q: queryText }), 'EX', 600); } catch { /* non-fatal */ }
            if (total === 0) {
              void upsertBotMessage(telegramUserId, chatId, '🔍 Ничего не найдено.',
                { inline_keyboard: [[{ text: '🔍 Новый поиск', callback_data: 'tx:s' }, { text: '◀️ К списку', callback_data: 'tx:l:0:a' }]] });
            } else {
              const totalPages = Math.max(1, Math.ceil(total / SPS_TX));
              void upsertBotMessage(telegramUserId, chatId,
                `📝 <b>По названию: «${queryText}»</b> (${String(total)} тр.):`,
                buildSRKtx(items, 0, totalPages, 'tx:s'));
            }

          } else if (txSearchMode === 'date') {
            const parsed = parseDateInput(queryText);
            if (!parsed) {
              // Restore state so they can try again
              await redisConnection.setex(txSearchKey, 120, 'date');
              void upsertBotMessage(telegramUserId, chatId,
                '⚠️ Не удалось распознать дату.\n\nПопробуй:\n' +
                '  <code>10.05</code>  — конкретный день\n' +
                '  <code>10.05.2026</code>  — с годом\n' +
                '  <code>01.05 - 10.05</code>  — диапазон',
                { inline_keyboard: [[{ text: '📅 Назад к выбору', callback_data: 'tx:s:dt' }]] },
              );
              await reply.status(200).send({ ok: true });
              return;
            }
            const { items: dtItems, total: dtTotal } = await searchByDateRange(
              resolved.workspaceId, resolved.userId, parsed.from, parsed.to, 0,
            );
            try { await redisConnection.set(srCtxKeyTx, JSON.stringify({ t: 'd', f: parsed.from, to: parsed.to, lb: parsed.label }), 'EX', 600); } catch { /* non-fatal */ }
            if (dtTotal === 0) {
              void upsertBotMessage(telegramUserId, chatId,
                `📅 За <b>${parsed.label}</b>\n\nТранзакций не найдено.`,
                { inline_keyboard: [[{ text: '◀️ К выбору периода', callback_data: 'tx:s:dt' }, { text: '◀️ К списку', callback_data: 'tx:l:0:a' }]] },
              );
            } else {
              const dtTotalPages = Math.max(1, Math.ceil(dtTotal / SPS_TX));
              void upsertBotMessage(telegramUserId, chatId,
                `📅 <b>За ${parsed.label}</b> (${String(dtTotal)} тр.):`,
                buildSRKtx(dtItems, 0, dtTotalPages, 'tx:s:dt'),
              );
            }
            await reply.status(200).send({ ok: true });
            return;

          } else {
            const amountMatch = queryText.replace(/[^\d.,]/g, '').replace(',', '.');
            if (!amountMatch || !/^\d+(\.\d{1,2})?$/.test(amountMatch)) {
              // Restore state so they can try again
              await redisConnection.setex(txSearchKey, 120, 'amount');
              void upsertBotMessage(telegramUserId, chatId, '⚠️ Неверная сумма. Введите число, например: 1000 или 250.50');
              await reply.status(200).send({ ok: true });
              return;
            }
            const { items: amtItems, total: amtTotal } = await searchByAmount(resolved.workspaceId, resolved.userId, amountMatch, 0);
            try { await redisConnection.set(srCtxKeyTx, JSON.stringify({ t: 'a', q: amountMatch }), 'EX', 600); } catch { /* non-fatal */ }
            if (amtTotal === 0) {
              void upsertBotMessage(telegramUserId, chatId, '🔍 Ничего не найдено.',
                { inline_keyboard: [[{ text: '🔍 Новый поиск', callback_data: 'tx:s' }, { text: '◀️ К списку', callback_data: 'tx:l:0:a' }]] });
            } else {
              const amtTotalPages = Math.max(1, Math.ceil(amtTotal / SPS_TX));
              void upsertBotMessage(telegramUserId, chatId,
                `💲 <b>По сумме: ${amountMatch}</b> (${String(amtTotal)} тр.):`,
                buildSRKtx(amtItems, 0, amtTotalPages, 'tx:s'));
            }
          }

          request.log.info({ msg: '[midas:bot:webhook] tx search handled', mode: txSearchMode, workspaceId: resolved.workspaceId });
        } catch (err: unknown) {
          const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
          request.log.error({ msg: '[midas:bot:webhook] tx search failed', errorClass });
          void upsertBotMessage(telegramUserId, chatId, '⚠️ Ошибка поиска. Попробуйте позже.');
        }
        await reply.status(200).send({ ok: true });
        return;
      }
    }


    // ── Step 5h: Phase 1.26 — settings search mode intercept ───────────
    // If user is in settings search mode (pressed 🔍 in /settings UI),
    // intercept their next text message as a currency search query.
    // This check runs BEFORE AI parse — search messages must never reach AI.
    if (!commandToken) {
      const rKey = searchModeKey(telegramUserId, chatId);
      const inSearch = await redisConnection.get(rKey);
      if (inSearch) {
        await redisConnection.del(rKey);
        const results = searchCurrencies(message.text);
        if (results.length === 0) {
          void upsertBotMessage(
            telegramUserId,
            chatId,
            '❌ Ничего не найдено. Попробуй: USDT, BTC, EUR — или /settings для меню.',
          );
        } else {
          void upsertBotMessage(
            telegramUserId,
            chatId,
            `🔍 Результаты (${String(results.length)}):`,
            buildSearchResultsKeyboard(results),
          );
        }
        request.log.info({
          msg: '[midas:bot:webhook] settings search handled',
          telegramUserId,
          resultCount: results.length,
          // query NOT logged (SEC-12)
        });
        await reply.status(200).send({ ok: true });
        return;
      }
    }

    // ── Step 5h-cur: Phase 1.38 — Currency await intercept ───────────
    // If user is answering "В какой валюте?", intercept before AI parse.
    // Redis key set by ai-parse.worker when currency is missing.
    if (!commandToken) {
      const awaitKey = `midas:awaiting_cur:${chatId}`;
      const awaitRaw = await redisConnection.get(awaitKey);
      if (awaitRaw && message.text) {
        // Format: "{draftId}:{workspaceId}:{userId}"
        const sepIdx1 = awaitRaw.indexOf(':');
        const sepIdx2 = awaitRaw.indexOf(':', sepIdx1 + 1);
        if (sepIdx1 > 0 && sepIdx2 > sepIdx1) {
          const awaitDraftId = awaitRaw.slice(0, sepIdx1);
          const awaitWsId = awaitRaw.slice(sepIdx1 + 1, sepIdx2);
          const awaitUserId = awaitRaw.slice(sepIdx2 + 1);

          // Extract currency from message — handles: "евро", "50 евро", "EUR", "$"
          // First try full text, then try to find the currency token inside (e.g. user typed "50 евро")
          const rawCurText = message.text.trim();
          let validCur = normalizeCurrencyInput(rawCurText);
          if (!validCur) {
            // Maybe they typed "50 евро" — extract the non-numeric token
            const curToken = rawCurText
              .replace(/[\d\s.,]/g, ' ')
              .trim()
              .split(/\s+/)
              .find((t) => /^[a-zA-Zа-яА-ЯёЁ₴$€£¥₿]{1,10}$/.test(t)) ?? null;
            if (curToken) validCur = normalizeCurrencyInput(curToken);
          }
          if (!validCur) {
            void upsertBotMessage(
              telegramUserId, chatId,
              '❌ Не понял валюту. Попробуй: руб, USD, €, USDT',
            );
            await reply.status(200).send({ ok: true });
            return;
          }

          // Clean up await key
          await redisConnection.del(awaitKey);

          // NOTE: cur_set is NOT set here intentionally.
          // Answering the currency prompt for one transaction ≠ setting a default.
          // Default currency is only saved when the user explicitly goes to
          // ⚙️ Настройки → Валюта → picks one. (Phase 1.38 UX fix)

          // Phase 1.38 fix: delete the old clarification card before showing confirm card
          const clarMsgCacheKey = `midas:clar:msg:${telegramUserId}:${chatId}`;
          let prevClarMsgIdToDelete: string | null = null;
          try {
            prevClarMsgIdToDelete = await redisConnection.get(clarMsgCacheKey);
            if (prevClarMsgIdToDelete) {
              await redisConnection.del(clarMsgCacheKey);
              void deleteMessage(chatId, prevClarMsgIdToDelete);
            }
          } catch {
            // Non-fatal — proceed even if delete fails
          }

          // Patch draft currency
          const patchRes = await patchDraftCurrency(
            awaitWsId, awaitUserId, awaitDraftId, validCur,
          );

          if (patchRes.status === 'ready') {
            await sendAndStorePreview(telegramUserId, chatId, awaitWsId, awaitUserId, awaitDraftId);
          } else {
            void upsertBotMessage(
              telegramUserId, chatId,
              '⏰ Транзакция уже обработана или истекла.\nОтправьте новое сообщение для записи.',
            );
          }

          request.log.info({
            msg: '[midas:bot:webhook] Phase 1.38: currency await intercepted',
            telegramUserId,
            // currency NOT logged (SEC-12)
          });
          await reply.status(200).send({ ok: true });
          return;
        }
        // Malformed state — clear and fall through
        await redisConnection.del(awaitKey);
      }
    }

    // ── Step 5i: Phase 1.38 — Bare number guard ──────────────────────
    // Pure digits (with optional spaces/commas/dots) → not a transaction.
    // Instant response (<50ms) without AI call or draft creation.
    if (!commandToken) {
      const BARE_NUMBER_RE = /^\d[\d\s.,]*$/;
      if (BARE_NUMBER_RE.test(message.text.trim())) {
        const num = message.text.trim().replace(/\s+/g, '');
        const hint = [
          '💡 <b>Укажи сумму с валютой</b>',
          '',
          `${escapeHtml(num)} доллар  ·  ${escapeHtml(num)} евр  ·  ${escapeHtml(num)} грн`,
          `или кофе ${escapeHtml(num)} руб  ·  зарплата ${escapeHtml(num)} USDT`,
        ].join('\n');
        void upsertBotMessage(telegramUserId, chatId, hint);
        request.log.info({
          msg: '[midas:bot:webhook] Phase 1.38: bare number intercepted',
          telegramUserId,
        });
        await reply.status(200).send({ ok: true });
        return;
      }
    }

    // ── Step 6: SEC-03 — Resolve workspace from trusted source
    let workspaceId: string;
    try {
      // Pass chatId so resolveWorkspace can send welcome message for first-time users
      // who reach us via a regular text message (bypassing /start).
      const resolved = await resolveWorkspace(telegramUserId, chatId);
      workspaceId = resolved.workspaceId;
    } catch (err: unknown) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      request.log.error({
        msg: '[midas:bot:webhook] Workspace resolution failed — dropping message',
        telegramUserId,
        errorClass,
        // raw_text NOT logged (SEC-12)
      });
      // Return 200 to prevent Telegram retries flooding us during DB outage
      await reply.status(200).send({ ok: true });
      return;
    }

    // ── Step 7: Build payload & enqueue (SEC-06) ─────────────
    const idempotencyKey = IdempotencyKeyBuilder.webhookIngestion(BOT_ID, chatId, messageId);

    const payload: WebhookIngestionJobPayload = {
      botId: BOT_ID,
      chatId,
      messageId,
      telegramUserId,
      workspaceId, // from trusted backend source (SEC-03)
      raw_text: message.text, // MUST NOT be logged (SEC-12)
      receivedAt,
    };

    // Phase LD++: When the user initiates a free-text transaction, delete the current Active UI
    // (Balance, Transactions, Settings, Report, empty_tx_msg, etc.) to prevent chat clutter
    // before the AI draft or clarification card appears.

    // Phase 2.9+: Delete nav panel message (Баланс/Отчёт/Транзакции/Настройки) if open.
    // midas:nav: is a separate key — NEVER mixes with midas:am: (tx records stay safe).
    const navId = await getNavMessageId(telegramUserId, chatId);
    if (navId) {
      void deleteMessage(chatId, navId);
      void clearNavMessageId(telegramUserId, chatId);
    }

    // Delete the active message pointer (draft pickers, previews, etc.)
    const amId = await getActiveMessageId(telegramUserId, chatId);
    if (amId) {
      void deleteMessage(chatId, amId);
      void clearActiveMessageId(telegramUserId, chatId);
    }

    // Also clean up the explicit empty_tx_msg key just in case
    const emptyMsgId = await redisConnection.get(`midas:empty_tx_msg:${chatId}`).catch(() => null);
    if (emptyMsgId) {
      if (emptyMsgId !== amId) void deleteMessage(chatId, emptyMsgId);
      await redisConnection.del(`midas:empty_tx_msg:${chatId}`).catch(() => {});
    }


    await webhookIngestionQueue.add(QUEUE_NAMES.WEBHOOK_INGESTION, payload, {
      jobId: idempotencyKey,
    });

    // NOTE: greeting deletion moved to confirmation.worker (approve path).
    // The greeting is shown until the first transaction is CONFIRMED, not just typed.

    // ── Step 8: SEC-04 — Return 200 immediately ──────────────
    // Log only safe metadata — no raw_text (SEC-12)
    request.log.info({
      msg: '[midas:bot:webhook] Message enqueued',
      jobId: idempotencyKey,
      workspaceId,
      telegramUserId,
      // raw_text deliberately excluded (SEC-12)
    });

    await reply.status(200).send({ ok: true });
  });
};

export default webhookRoute;
