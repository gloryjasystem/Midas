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
import { getAccountBalances } from '../services/balance.service.js';
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
  hasAccounts,             // Phase 1.30
  addAccountWithCurrency,  // Phase 1.30
  parseAddAccountArgs,
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
  buildExchangePickerKeyboard,       // Phase 1.30
  buildOnboardCurrencyKeyboard,      // Phase 1.30
  buildAfterCreateKeyboard,          // Phase 1.30
  ACCOUNTS_EMPTY_TEXT,               // Phase 1.30
  START_WELCOME_TEXT,                // Phase 1.37-UX: new user welcome
  SETUP_COMPLETE_TEXT,               // Phase 1.37-UX: ReplyKeyboard activation message
  EXCHANGE_PICKER_TEXT,              // Phase 1.30
  CURRENCY_PICKER_TEXT,              // Phase 1.30
  nameInputPrompt,                   // Phase 1.30
  CURRENCY_INPUT_PROMPT,             // Phase 1.30
  type AccountOnboardState,          // Phase 1.30
} from '../services/account-onboard-keyboard.service.js';
import {
  parseInlineAccountCallback,        // Phase 1.31
  RENAME_PROMPT,                     // Phase 1.31
  type InlineAccountState,           // Phase 1.31
} from '../services/account-inline-keyboard.service.js';
import {
  getWorkspaceAccountsForInline,     // Phase 1.31
  getAccountById,                    // Phase 1.31
  getDraftAccountHint,               // Phase 1.31
  setDraftAccountId,                 // Phase 1.31
} from '../services/account.service.js';
import {
  patchDraftAmount,                  // Phase 1.32
  patchDraftIntent,                  // Phase 1.32
  patchDraftCategory,                // Phase 1.32
  validateAmountString,              // Phase 1.32
  getDraftFields,                    // Phase 1.35
  patchDraftCurrency,                // Phase 1.35
  validateCurrencyCode,              // Phase 1.35
} from '../services/clarification.service.js';
import {
  upsertBotMessage,                  // Phase 1.33
  tryDeleteUserMessage,              // Phase 1.33
  setActiveMessageId,                // Phase 1.33
  clearActiveMessageId,              // Phase 1.33
  getActiveMessageId,                // Phase 1.37-UX: read old msg ID before /start reset
} from '../services/active-message.service.js';

import { callbackConfirmQueue } from '../queues/callback-confirm-queue.js';
import {
  buildPreviewScreen,
  buildMainMenuKeyboard,   // Phase 1.36-UX: persistent bottom nav keyboard
  NAV_BTN_BALANCE,         // Phase 1.36-UX: button text intercept constants
  NAV_BTN_REPORT,          // Phase 1.36-UX
  NAV_BTN_SETTINGS,        // Phase 1.36-UX
} from '../utils/screen-builder.js'; // Phase 1.35

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
const ONBOARD_STATE_TTL_SEC = 300; // 5 minutes
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

// Centralised so all confirm screens include the edit button.
// Phase 1.36-UX: Layout aligned with screen-builder.ts buildConfirmKeyboard:
//   Row 1: [✅ Подтвердить] — full-width primary action
//   Row 2: [✏️ Изменить] [✖️ Отмена] — secondary actions, consistent emoji weight
function confirmKb(draftId: string) {
  return {
    inline_keyboard: [
      [
        // Primary action — full width, maximum tap surface
        { text: '✅  Подтвердить', callback_data: `approve:${draftId}` },
      ],
      [
        // Secondary: pencil + neutral X (not red ❌ — avoids alarming UX)
        { text: '✏️ Изменить',  callback_data: `draft:edit:${draftId}` },
        { text: '✖️ Отмена',    callback_data: `reject:${draftId}` },
      ],
    ],
  };
}

// Phase 1.35: Build preview card from draft data.
// Returns preview text or fallback if draft is not found.
async function confirmPreview(
  workspaceId: string,
  userId: string,
  draftId: string,
): Promise<string> {
  const draft = await getDraftFields(workspaceId, userId, draftId);
  if (!draft) return '📝 Готово. Подтвердите или отклоните транзакцию:';
  return buildPreviewScreen({
    intent: draft.parsed_intent,
    amount: draft.parsed_amount,
    currency: draft.parsed_currency,
    categoryHint: draft.parsed_category_hint,
    accountHint: null,
    itemName: draft.item_name,
  });
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
      if (cq.message) {
        void setActiveMessageId(telegramUserId, chatId, String(cq.message.message_id));
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

          try {
            if (acCmd.cmd === 'open') {
              // Phase 1.37-UX: User tapped "Добавить счёт" from the 2-button /start keyboard.
              // Edit the same message in-place — no new message, chat stays clean.
              if (acMsgId) void editMessageText(chatId, acMsgId, ACCOUNTS_EMPTY_TEXT, buildAccountTypeKeyboard());

            } else if (acCmd.cmd === 'skip') {
              // Phase 1.37-UX: User skipped onboarding — clean chat.
              // Delete the onboarding message, send ONE brief confirmation.
              // ReplyKeyboard appears after first confirmed transaction (workers send replyKeyboardJson).
              await redisConnection.del(acKey);
              if (acMsgId) void deleteMessage(chatId, acMsgId);
              await clearActiveMessageId(telegramUserId, chatId);
              void upsertBotMessage(
                telegramUserId, chatId,
                '✅ Хорошо. Счёт добавишь позже через /accounts или /add_account.',
              );

            } else if (acCmd.cmd === 'done') {
              // Phase 1.37-UX: User finished account setup.
              // Clean chat: delete the onboarding message, send ONE activation message with ReplyKeyboard.
              // This is the single moment the ReplyKeyboard appears for new users.
              await redisConnection.del(acKey);
              if (acMsgId) void deleteMessage(chatId, acMsgId);
              await clearActiveMessageId(telegramUserId, chatId);
              void sendMessageWithReplyKeyboard(chatId, SETUP_COMPLETE_TEXT, buildMainMenuKeyboard());

            } else if (acCmd.cmd === 'more') {
              // User wants to add another account — restart type picker
              await redisConnection.del(acKey);
              if (acMsgId) void editMessageText(chatId, acMsgId, ACCOUNTS_EMPTY_TEXT, buildAccountTypeKeyboard());

            } else if (acCmd.cmd === 'type') {
              // User selected account type
              if (acCmd.accountType === 'exchange') {
                // Exchange: show exchange preset picker first
                const state: AccountOnboardState = { step: 'name_input', accountType: 'exchange' };
                await redisConnection.set(acKey, JSON.stringify(state), 'EX', ONBOARD_STATE_TTL_SEC);
                if (acMsgId) void editMessageText(chatId, acMsgId, EXCHANGE_PICKER_TEXT, buildExchangePickerKeyboard());
              } else if (acCmd.accountType === 'cash') {
                // Cash: name is auto-determined after currency pick
                const state: AccountOnboardState = { step: 'cur_pick', accountType: 'cash' };
                await redisConnection.set(acKey, JSON.stringify(state), 'EX', ONBOARD_STATE_TTL_SEC);
                if (acMsgId) void editMessageText(chatId, acMsgId, CURRENCY_PICKER_TEXT, buildOnboardCurrencyKeyboard());
              } else {
                // card / wallet / custom: need free-text name first
                const state: AccountOnboardState = { step: 'name_input', accountType: acCmd.accountType };
                await redisConnection.set(acKey, JSON.stringify(state), 'EX', ONBOARD_STATE_TTL_SEC);
                if (acMsgId) void editMessageText(chatId, acMsgId, nameInputPrompt(acCmd.accountType), { inline_keyboard: [] });
              }

            } else if (acCmd.cmd === 'exchange_preset') {
              // User picked an exchange preset — move to currency pick with name set
              const state: AccountOnboardState = { step: 'cur_pick', accountType: 'exchange', name: acCmd.name };
              await redisConnection.set(acKey, JSON.stringify(state), 'EX', ONBOARD_STATE_TTL_SEC);
              if (acMsgId) void editMessageText(chatId, acMsgId, CURRENCY_PICKER_TEXT, buildOnboardCurrencyKeyboard());

            } else if (acCmd.cmd === 'exchange_custom') {
              // User wants to type a custom exchange name
              const state: AccountOnboardState = { step: 'name_input', accountType: 'exchange' };
              await redisConnection.set(acKey, JSON.stringify(state), 'EX', ONBOARD_STATE_TTL_SEC);
              if (acMsgId) void editMessageText(chatId, acMsgId, '✏️ Введи название биржи:', { inline_keyboard: [] });

            } else if (acCmd.cmd === 'currency') {
              // User picked a currency — load state, create account
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

                const res = await addAccountWithCurrency(
                  acResolved.workspaceId, acResolved.userId, accountName, acCmd.code,
                );

                await redisConnection.del(acKey);

                if (res === 'duplicate') {
                  if (acMsgId) void editMessageText(
                    chatId, acMsgId,
                    `⚠️ Счёт <b>${escapeHtml(accountName)}</b> уже существует.`,
                    buildAfterCreateKeyboard(),
                  );
                } else {
                  // Phase 1.37-UX: Account created — show [➕ Ещё] [✅ Готово] inline keyboard.
                  // Do NOT activate ReplyKeyboard yet — user might add more accounts.
                  // ReplyKeyboard activates only at ac:done (the final "Готово" tap).
                  if (acMsgId) void editMessageText(
                    chatId, acMsgId,
                    `✅ Счёт <b>${escapeHtml(accountName)}</b> (${escapeHtml(acCmd.code)}) создан!`,
                    buildAfterCreateKeyboard(),
                  );
                  request.log.info({ msg: '[midas:bot:webhook] ac: account created via onboarding', workspaceId: acResolved.workspaceId });
                }
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
                const previewText = await confirmPreview(iaResolved.workspaceId, iaResolved.userId, iaCmd.draftId);
                void editMessageText(chatId, iaMsgId, previewText, confirmKb(iaCmd.draftId));
              }

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

              const createRes = await addAccountWithCurrency(
                iaResolved.workspaceId, iaResolved.userId, createName, createCurrency,
              );
              // Fetch the new or existing account id
              const allAccounts = await getWorkspaceAccountsForInline(iaResolved.workspaceId, iaResolved.userId);
              const foundAcc = allAccounts.find((a) => a.name.trim().toLowerCase() === createName.trim().toLowerCase());
              if (foundAcc) {
                await setDraftAccountId(iaResolved.workspaceId, iaResolved.userId, iaCmd.draftId, foundAcc.id);
              }
              const label = createRes === 'duplicate' ? `⚠️ Счёт уже существует.` : `✅ Счёт <b>${escapeHtml(createName)}</b> (${escapeHtml(createCurrency)}) создан!`;
              if (iaMsgId) {
                const previewText = await confirmPreview(iaResolved.workspaceId, iaResolved.userId, iaCmd.draftId);
                void editMessageText(chatId, iaMsgId, `${label}\n\n${previewText}`, confirmKb(iaCmd.draftId));
              }
              request.log.info({ msg: '[midas:bot:webhook] ia: account created inline', workspaceId: iaResolved.workspaceId });

            } else {
              // iaCmd.cmd === 'use' | 'fuzzy' — user selected an existing account.
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
                  const previewText = await confirmPreview(iaResolved.workspaceId, iaResolved.userId, iaCmd.draftId);
                  void editMessageText(
                    chatId, iaMsgId,
                    `✅ Счёт <b>${escapeHtml(acct.name)}</b> выбран.\n\n${previewText}`,
                    confirmKb(iaCmd.draftId),
                  );
                }
                request.log.info({ msg: '[midas:bot:webhook] ia: account selected', workspaceId: iaResolved.workspaceId });
              }
            }
          } catch (err: unknown) {
            const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
            request.log.error({ msg: '[midas:bot:webhook] ia: callback failed', callbackId: cq.id, errorClass });
          }

          await answerCallbackQuery(cq.id);
          await reply.status(200).send({ ok: true });
          return;
        }

      // ── Phase 1.28: edit callbacks (prefix "ed:") ─────────────
      // Handled synchronously — direct DB update, no queue.
      if (callbackData.startsWith('ed:')) {
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
            // Remove keyboard from the message
            if (messageId) {
              void editMessageText(chatId, messageId, '⚙️ Настройки закрыты.', EMPTY_KEYBOARD);
            }
          } else if (cmd.cmd === 'menu' || cmd.cmd === 'grouppicker' || cmd.cmd === 'back') {
            if (cmd.cmd === 'menu' || cmd.cmd === 'back') {
              // Re-show main menu (refresh)
              const settings = await getSettings(stResolved.workspaceId, stResolved.userId);
              const text = formatSettingsMenuText(
                settings?.default_currency ?? 'USDT',
                settings?.timezone ?? 'UTC',
                settings?.expense_account_name ?? null,
                settings?.income_account_name ?? null,
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
            if (messageId) {
              void editMessageText(chatId, messageId, confirmText, EMPTY_KEYBOARD);
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
            const currentId = cmd.kind === 'expense'
              ? settings?.default_expense_account_id ?? null
              : settings?.default_income_account_id ?? null;

            const kindLabel = cmd.kind === 'expense' ? 'расходов' : 'доходов';
            const text = `🏦 Выберите основной счёт для ${kindLabel}:`;

            // Build picker keyboard inline
            const prefix = cmd.kind === 'expense' ? 'st:da:se:' : 'st:da:si:';
            const rows: { text: string; callback_data: string }[][] = [];
            for (const acct of accounts) {
              const mark = acct.id === currentId ? ' ✓' : '';
              rows.push([{ text: `${acct.name}${mark}`, callback_data: `${prefix}${acct.id}` }]);
            }
            const clearCb = cmd.kind === 'expense' ? 'st:da:ce' : 'st:da:ci';
            if (currentId) {
              rows.push([{ text: '🚫 Убрать основной', callback_data: clearCb }]);
            }
            rows.push([{ text: '← Назад', callback_data: 'st:back' }]);
            if (messageId) {
              void editMessageText(chatId, messageId, text, { inline_keyboard: rows });
            }
          } else if (cmd.cmd === 'default_account_set') {
            // Phase 1.35: Set default account
            await setDefaultAccount(stResolved.workspaceId, stResolved.userId, cmd.kind, cmd.accountId);
            // Return to main menu
            const settings = await getSettings(stResolved.workspaceId, stResolved.userId);
            const text = formatSettingsMenuText(
              settings?.default_currency ?? 'USDT',
              settings?.timezone ?? 'UTC',
              settings?.expense_account_name ?? null,
              settings?.income_account_name ?? null,
            );
            if (messageId) {
              void editMessageText(chatId, messageId, text, buildSettingsMainKeyboard());
            }
            request.log.info({
              msg: '[midas:bot:webhook] settings: default account set',
              telegramUserId,
              kind: cmd.kind,
            });
          } else if (cmd.cmd === 'default_account_clear') {
            // Phase 1.35: Clear default account
            await setDefaultAccount(stResolved.workspaceId, stResolved.userId, cmd.kind, null);
            const settings = await getSettings(stResolved.workspaceId, stResolved.userId);
            const text = formatSettingsMenuText(
              settings?.default_currency ?? 'USDT',
              settings?.timezone ?? 'UTC',
              settings?.expense_account_name ?? null,
              settings?.income_account_name ?? null,
            );
            if (messageId) {
              void editMessageText(chatId, messageId, text, buildSettingsMainKeyboard());
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
        const isBack   = callbackData.startsWith('draft:back:');
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
            const { buildPreviewScreen, buildConfirmKeyboard } = await import('../utils/screen-builder.js');
            const previewMsg = buildPreviewScreen({
              intent: draft.parsed_intent,
              amount: draft.parsed_amount,
              currency: draft.parsed_currency,
              categoryHint: draft.parsed_category_hint,
              accountHint: null,
              itemName: draft.item_name,
            });
            void upsertBotMessage(
              telegramUserId, chatId, previewMsg,
              buildConfirmKeyboard(draftEditId),
            );
          } else {
            // Show edit sub-menu
            const { intentEmoji, intentLabel } = await import('../utils/screen-builder.js');
            const iLabel = draft.parsed_intent
              ? `${intentEmoji(draft.parsed_intent)} ${intentLabel(draft.parsed_intent)}`
              : null;
            const lines = ['✏️ <b>Что изменить?</b>', ''];
            if (iLabel)                 lines.push(iLabel);
            if (draft.parsed_amount)    lines.push(`Сумма: <b>${draft.parsed_amount} ${draft.parsed_currency ?? 'USDT'}</b>`);
            if (draft.item_name)        lines.push(`Товар: ${draft.item_name}`);

            const subKeyboard = {
              inline_keyboard: [
                [
                  { text: '💰 Сумму',     callback_data: `draft:amt:${draftEditId}` },
                  { text: '📁 Категорию', callback_data: `draft:cat:${draftEditId}` },
                ],
                [
                  { text: '🔄 Тип',       callback_data: `draft:intent:${draftEditId}` },
                  { text: '💱 Валюту',    callback_data: `draft:cur:${draftEditId}` },
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
        const isAmt    = callbackData.startsWith('draft:amt:');
        const isCat    = callbackData.startsWith('draft:cat:');
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
                  { text: '💸 Расход',   callback_data: `clar:intent:expense:${draftSubId}` },
                  { text: '💰 Доход',    callback_data: `clar:intent:income:${draftSubId}` },
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
          curValue   = afterPrefix.slice(0, colonIdx);
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
                const { buildPreviewScreen, buildConfirmKeyboard } = await import('../utils/screen-builder.js');
                const previewMsg = buildPreviewScreen({
                  intent: refreshed.parsed_intent,
                  amount: refreshed.parsed_amount,
                  currency: refreshed.parsed_currency,
                  categoryHint: refreshed.parsed_category_hint,
                  accountHint: null,
                  itemName: refreshed.item_name,
                });
                void upsertBotMessage(telegramUserId, chatId, previewMsg, buildConfirmKeyboard(curDraftId));
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
                  { text: 'USD',  callback_data: `draft:setcur:USD:${curDraftId}` },
                  { text: 'EUR',  callback_data: `draft:setcur:EUR:${curDraftId}` },
                  { text: 'RUB',  callback_data: `draft:setcur:RUB:${curDraftId}` },
                ],
                [
                  { text: 'BTC',  callback_data: `draft:setcur:BTC:${curDraftId}` },
                  { text: 'ETH',  callback_data: `draft:setcur:ETH:${curDraftId}` },
                  { text: 'GBP',  callback_data: `draft:setcur:GBP:${curDraftId}` },
                  { text: 'CNY',  callback_data: `draft:setcur:CNY:${curDraftId}` },
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
                const previewText = await confirmPreview(clarResolved.workspaceId, clarResolved.userId, intentDraftId);
                void editMessageText(chatId, clarMsgId, previewText, confirmKb(intentDraftId));
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
                const previewText = await confirmPreview(clarResolved.workspaceId, clarResolved.userId, catDraftId);
                void editMessageText(chatId, clarMsgId, previewText, confirmKb(catDraftId));
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
                const previewText = await confirmPreview(clarResolved.workspaceId, clarResolved.userId, nocatDraftId);
                void editMessageText(chatId, clarMsgId, previewText, confirmKb(nocatDraftId));
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
            const balanceMsg = await getAccountBalances(navResolved.workspaceId, navResolved.userId);
            await upsertBotMessage(telegramUserId, chatId, balanceMsg, {
              inline_keyboard: [[
                { text: '📋 Отчёт',    callback_data: 'nav:report' },
                { text: '⚙️ Настройки', callback_data: 'stg:main' },
              ]],
            });
          } else if (navCmd === 'report') {
            const reportMsg = await getMonthlyReport(navResolved.workspaceId, navResolved.userId);
            await upsertBotMessage(telegramUserId, chatId, reportMsg, {
              inline_keyboard: [[
                { text: '📊 Баланс',    callback_data: 'nav:balance' },
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
      try {
        const resolved = await resolveWorkspace(telegramUserId, chatId);
        const balanceText = await getAccountBalances(resolved.workspaceId, resolved.userId);
        void upsertBotMessage(telegramUserId, chatId, balanceText);
        request.log.info({ msg: '[midas:bot:webhook] nav:balance shortcut', telegramUserId, workspaceId: resolved.workspaceId });
      } catch (err: unknown) {
        const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
        request.log.error({ msg: '[midas:bot:webhook] nav:balance shortcut failed', telegramUserId, errorClass });
        void upsertBotMessage(telegramUserId, chatId, '⚠️ Не удалось получить баланс. Попробуйте позже.');
      }
      await reply.status(200).send({ ok: true });
      return;
    }

    if (navText === NAV_BTN_REPORT) {
      try {
        const resolved = await resolveWorkspace(telegramUserId, chatId);
        const reportText = await getMonthlyReport(resolved.workspaceId, resolved.userId);
        void upsertBotMessage(telegramUserId, chatId, reportText);
        request.log.info({ msg: '[midas:bot:webhook] nav:report shortcut', telegramUserId, workspaceId: resolved.workspaceId });
      } catch (err: unknown) {
        const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
        request.log.error({ msg: '[midas:bot:webhook] nav:report shortcut failed', telegramUserId, errorClass });
        void upsertBotMessage(telegramUserId, chatId, '⚠️ Не удалось сформировать отчёт. Попробуйте позже.');
      }
      await reply.status(200).send({ ok: true });
      return;
    }

    if (navText === NAV_BTN_SETTINGS) {
      try {
        const resolved = await resolveWorkspace(telegramUserId, chatId);
        const settings = await getSettings(resolved.workspaceId, resolved.userId);
        const menuText = formatSettingsMenuText(
          settings?.default_currency ?? 'USDT',
          settings?.timezone ?? 'UTC',
          settings?.expense_account_name ?? null,
          settings?.income_account_name ?? null,
        );
        void upsertBotMessage(telegramUserId, chatId, menuText, buildSettingsMainKeyboard());
        request.log.info({ msg: '[midas:bot:webhook] nav:settings shortcut', telegramUserId, workspaceId: resolved.workspaceId });
      } catch (err: unknown) {
        const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
        request.log.error({ msg: '[midas:bot:webhook] nav:settings shortcut failed', telegramUserId, errorClass });
        void upsertBotMessage(telegramUserId, chatId, '⚠️ Ошибка настроек. Попробуйте позже.');
      }
      await reply.status(200).send({ ok: true });
      return;
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
          const balanceText = await getAccountBalances(resolved.workspaceId, resolved.userId);
          void upsertBotMessage(telegramUserId, chatId, balanceText);

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
              settings?.expense_account_name ?? null,
              settings?.income_account_name ?? null,
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

      // ── 5f-edit: /edit (Phase 1.28) ──────────────────────────
      if (commandToken === '/edit') {
        try {
          const resolved = await resolveWorkspace(telegramUserId, chatId);
          const [items, total] = await Promise.all([
            getRecentTransactions(resolved.workspaceId, resolved.userId, 0),
            countTransactions(resolved.workspaceId, resolved.userId),
          ]);

          if (total === 0) {
            void upsertBotMessage(telegramUserId, chatId, '🗒 У вас ещё нет транзакций для редактирования.');
          } else {
            const totalPages = Math.max(1, Math.ceil(total / EDIT_PAGE_SIZE));
            const header = formatTransactionListHeader(0, totalPages);
            const lines = items.map((tx, i) => formatTransactionListLine(tx, i));
            const text = [header, ...lines].join('\n');
            const keyboard = buildTransactionListKeyboard(items, 0, totalPages);
            void upsertBotMessage(telegramUserId, chatId, text, keyboard);
          }

          request.log.info({
            msg: '[midas:bot:webhook] /edit list sent',
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

    // ── Step 5f-clar: Phase 1.32 — clarification amount text intercept ────
    // If user is in the midas:clar: state (bot asked "Сколько?"), intercept
    // their next text message as the new amount.
    // Runs BEFORE ia: intercept, BEFORE ac: onboarding, BEFORE edit, BEFORE AI parse.
    if (!commandToken) {
      const clarIntKey = clarStateKey(telegramUserId, chatId);
      const clarIntState = await redisConnection.get(clarIntKey);
      if (clarIntState) {
        // clarIntState format: "{draftId}:amt"
        const colonPos = clarIntState.indexOf(':');
        const clarDraftId = colonPos === -1 ? clarIntState : clarIntState.slice(0, colonPos);
        const clarField   = colonPos === -1 ? '' : clarIntState.slice(colonPos + 1);

        if (clarField === 'amt' && /^[0-9A-Z]{26}$/.test(clarDraftId)) {
          // Validate amount (SEC-02: NUMERIC regex)
          const validAmount = validateAmountString(message.text);
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

          const amtPatchResult = await patchDraftAmount(
            clarIntResolved.workspaceId, clarIntResolved.userId, clarDraftId, validAmount,
          );

          if (amtPatchResult.status === 'ready') {
            const previewText = await confirmPreview(clarIntResolved.workspaceId, clarIntResolved.userId, clarDraftId);
            void upsertBotMessage(
              telegramUserId,
              chatId,
              previewText,
              confirmKb(clarDraftId),
            );
          } else if (amtPatchResult.status === 'still_needs' && amtPatchResult.field === 'intent') {
            void upsertBotMessage(
              telegramUserId,
              chatId,
              '🤔 Уточни, что произошло:',
              { inline_keyboard: [
                [{ text: '💸 Расход', callback_data: `clar:intent:expense:${clarDraftId}` }, { text: '💰 Доход', callback_data: `clar:intent:income:${clarDraftId}` }],
                [{ text: '🤝 Долг (дал)', callback_data: `clar:intent:debt_given:${clarDraftId}` }, { text: '🤲 Долг (взял)', callback_data: `clar:intent:debt_received:${clarDraftId}` }],
              ]},
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
              const previewText = await confirmPreview(resolved.workspaceId, resolved.userId, activeDraftId);
              void upsertBotMessage(
                telegramUserId,
                chatId,
                `${label}\n\n${previewText}`,
                confirmKb(activeDraftId),
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
          // User typed the account name — validate and move to currency pick
          const trimmed = message.text.trim();
          if (trimmed.length === 0 || trimmed.length > 100) {
            void upsertBotMessage(telegramUserId, chatId, '⚠️ Название не может быть пустым или длиннее 100 символов. Попробуй ещё раз:');
          } else {
            const updatedState: AccountOnboardState = { ...acState, step: 'cur_pick', name: trimmed };
            await redisConnection.set(acKey, JSON.stringify(updatedState), 'EX', ONBOARD_STATE_TTL_SEC);
            try {
              const resolved = await resolveWorkspace(telegramUserId, chatId);
              void upsertBotMessage(telegramUserId, chatId, CURRENCY_PICKER_TEXT, buildOnboardCurrencyKeyboard());
              request.log.info({ msg: '[midas:bot:webhook] ac: name input received', workspaceId: resolved.workspaceId });
            } catch {
              void upsertBotMessage(telegramUserId, chatId, CURRENCY_PICKER_TEXT);
            }
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

          await redisConnection.del(acKey);
          try {
            const resolved = await resolveWorkspace(telegramUserId, chatId);
            let accountName: string;
            if (acState.accountType === 'cash') {
              accountName = `Наличные ${rawCode}`;
            } else {
              accountName = acState.name ?? 'Счёт';
            }
            const res = await addAccountWithCurrency(resolved.workspaceId, resolved.userId, accountName, rawCode);
            if (res === 'duplicate') {
              void upsertBotMessage(
                telegramUserId,
                chatId,
                `⚠️ Счёт <b>${escapeHtml(accountName)}</b> уже существует.`,
                buildAfterCreateKeyboard(),
              );
            } else {
              void upsertBotMessage(
                telegramUserId,
                chatId,
                `✅ Счёт <b>${escapeHtml(accountName)}</b> (${escapeHtml(rawCode)}) создан!`,
                buildAfterCreateKeyboard(),
              );
              request.log.info({ msg: '[midas:bot:webhook] ac: account created via custom currency text', workspaceId: resolved.workspaceId });
            }
          } catch (err: unknown) {
            const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
            request.log.error({ msg: '[midas:bot:webhook] ac: cur_input account create failed', errorClass });
            void upsertBotMessage(telegramUserId, chatId, '⚠️ Не удалось создать счёт. Попробуйте позже.');
          }
          await reply.status(200).send({ ok: true });
          return;
        }
        // Other steps (type_pick, cur_pick) don't intercept text — fall through
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
        await redisConnection.del(edKey);
        // edState format: "amt:<txId>"
        const colonIdx = edState.indexOf(':');
        const field = colonIdx === -1 ? edState : edState.slice(0, colonIdx);
        const txId  = colonIdx === -1 ? '' : edState.slice(colonIdx + 1);

        if (field === 'amt' && /^[0-9A-Z]{26}$/.test(txId)) {
          let edWorkspaceId: string;
          try {
            const resolved = await resolveWorkspace(telegramUserId, chatId);
            edWorkspaceId = resolved.workspaceId;
            const res = await updateTransactionAmount(txId, edWorkspaceId, resolved.userId, message.text);
            if (res.status === 'ok') {
              void upsertBotMessage(telegramUserId, chatId, '✅ Сумма изменена. Баланс пересчитан автоматически.');
              request.log.info({ msg: '[midas:bot:webhook] edit: amount updated via text', txId, workspaceId: edWorkspaceId });
            } else if (res.status === 'invalid_amount') {
              void upsertBotMessage(telegramUserId, chatId, '⚠️ Неверная сумма. Отправьте число, например: 380 или 1500.50');
            } else if (res.status === 'cross_currency_blocked') {
              void upsertBotMessage(telegramUserId, chatId, '⚠️ Изменение суммы недоступно для мультивалютных транзакций.');
            } else {
              void upsertBotMessage(telegramUserId, chatId, '⚠️ Транзакция не найдена.');
            }
          } catch (err: unknown) {
            const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
            request.log.error({ msg: '[midas:bot:webhook] edit amount update failed', txId, errorClass });
            void upsertBotMessage(telegramUserId, chatId, '⚠️ Не удалось сохранить. Попробуйте позже.');
          }
        } else {
          // Malformed state — discard silently, let message fall through
          request.log.warn({ msg: '[midas:bot:webhook] edit: malformed Redis state — discarded', field });
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
          const awaitWsId    = awaitRaw.slice(sepIdx1 + 1, sepIdx2);
          const awaitUserId  = awaitRaw.slice(sepIdx2 + 1);

          const validCur = normalizeCurrencyInput(message.text.trim());
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

          // Set cur_set flag — user has now explicitly chosen a currency
          await redisConnection.set(`midas:cur_set:${awaitWsId}`, '1');

          // Patch draft currency
          const patchRes = await patchDraftCurrency(
            awaitWsId, awaitUserId, awaitDraftId, validCur,
          );

          if (patchRes.status === 'ready') {
            const refreshed = await getDraftFields(awaitWsId, awaitUserId, awaitDraftId);
            if (refreshed) {
              const previewMsg = buildPreviewScreen({
                intent: refreshed.parsed_intent,
                amount: refreshed.parsed_amount,
                currency: refreshed.parsed_currency,
                categoryHint: refreshed.parsed_category_hint,
                accountHint: null,
                itemName: refreshed.item_name,
              });
              void upsertBotMessage(telegramUserId, chatId, previewMsg, confirmKb(awaitDraftId));
            }
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
