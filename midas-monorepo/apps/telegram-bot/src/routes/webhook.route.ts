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
import { sendMessage } from '../services/telegram-api.js';
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
} from '../services/settings.service.js';
import {
  sendMessageWithKeyboard,
  editMessageText,
  answerCallbackQuery,
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
  buildStartOnboardKeyboard,         // Phase 1.30
  buildExchangePickerKeyboard,       // Phase 1.30
  buildOnboardCurrencyKeyboard,      // Phase 1.30
  buildAfterCreateKeyboard,          // Phase 1.30
  ACCOUNTS_EMPTY_TEXT,               // Phase 1.30
  START_ONBOARD_TEXT,                // Phase 1.30
  EXCHANGE_PICKER_TEXT,              // Phase 1.30
  CURRENCY_PICKER_TEXT,              // Phase 1.30
  nameInputPrompt,                   // Phase 1.30
  CURRENCY_INPUT_PROMPT,             // Phase 1.30
  type AccountOnboardState,          // Phase 1.30
} from '../services/account-onboard-keyboard.service.js';

import { callbackConfirmQueue } from '../queues/callback-confirm-queue.js';

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
            if (acCmd.cmd === 'skip') {
              // User skipped onboarding — clear state, confirm
              await redisConnection.del(acKey);
              if (acMsgId) void editMessageText(chatId, acMsgId, '✅ Хорошо! Добавишь счёт позже через /add_account или /accounts.', { inline_keyboard: [] });

            } else if (acCmd.cmd === 'done') {
              // User finished — clear state, show account list
              await redisConnection.del(acKey);
              const accountText = await getAccountList(acResolved.workspaceId, acResolved.userId);
              if (acMsgId) void editMessageText(chatId, acMsgId, accountText, { inline_keyboard: [] });

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
            void sendMessage(chatId, '💰 Текущая сумма изменится. Напиши новое значение (например: 380 или 1500.50):');

          } else if (cmd.cmd === 'field_cat') {
            const categories = await getWorkspaceCategories(edResolved.workspaceId, edResolved.userId);
            if (categories.length === 0) {
              void sendMessage(chatId, '⚠️ В рабочем пространстве нет категорий.');
            } else {
              const keyboard = buildCategoryPickerKeyboard(cmd.txId, categories, cmd.page);
              if (messageId) void editMessageText(chatId, messageId, '📁 Выберите новую категорию:', keyboard);
            }

          } else if (cmd.cmd === 'field_acc') {
            const accounts = await getWorkspaceAccounts(edResolved.workspaceId, edResolved.userId);
            if (accounts.length === 0) {
              void sendMessage(chatId, '⚠️ В рабочем пространстве нет счетов.');
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
              void sendMessage(chatId, '⚠️ Категория не найдена.');
            } else {
              void sendMessage(chatId, '⚠️ Транзакция не найдена.');
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
              void sendMessage(chatId, '⚠️ Счёт не найден.');
            } else {
              void sendMessage(chatId, '⚠️ Транзакция не найдена.');
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
                void sendMessage(chatId, '⚠️ Транзакция не найдена.');
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
          } else if (cmd.cmd === 'menu' || cmd.cmd === 'grouppicker') {
            if (cmd.cmd === 'menu') {
              // Re-show main menu (refresh)
              const settings = await getSettings(stResolved.workspaceId, stResolved.userId);
              const text = formatSettingsMenuText(
                settings?.default_currency ?? 'USDT',
                settings?.timezone ?? 'UTC',
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
          } else {
            // Set Redis TTL search mode key
            const rKey = searchModeKey(telegramUserId, chatId);
            await redisConnection.set(rKey, '1', 'EX', SEARCH_MODE_TTL_SEC);
            void sendMessage(chatId, '🔍 Напиши символ или название валюты:');
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

          // If existing user, send a re-greeting (resolveWorkspace only sends for isNewUser)
          if (!resolved.isNewUser) {
            void sendMessage(
              chatId,
              '✅ Вы уже зарегистрированы. Просто отправьте сообщение о расходе или доходе.',
            );
          } else {
            // Phase 1.30: new user — show guided account onboarding keyboard (Scenario Е).
            // The default account was already created by system_find_or_create_user.
            // This keyboard allows the user to add NAMED accounts on top of the default.
            void sendMessageWithKeyboard(chatId, START_ONBOARD_TEXT, buildStartOnboardKeyboard());
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
          void sendMessage(chatId, reportText);

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
          void sendMessage(chatId, '⚠️ Не удалось сформировать отчёт. Попробуйте позже.');
        }

        await reply.status(200).send({ ok: true });
        return;
      }

      // ── 5c-bal: /balance (Phase 1.21) ────────────────────────
      if (commandToken === '/balance') {
        try {
          const resolved = await resolveWorkspace(telegramUserId, chatId);
          const balanceText = await getAccountBalances(resolved.workspaceId, resolved.userId);
          void sendMessage(chatId, balanceText);

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
          void sendMessage(chatId, '⚠️ Не удалось получить баланс. Попробуйте позже.');
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
          void sendMessage(chatId, parsed.error);
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
          void sendMessage(chatId, replyText);

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
          void sendMessage(chatId, '⚠️ Не удалось синхронизировать баланс. Попробуйте позже.');
        }

        await reply.status(200).send({ ok: true });
        return;
      }

      // ── 5d-cat: /category (Phase 1.11) ───────────────────────
      if (commandToken === '/category') {
        try {
          const resolved = await resolveWorkspace(telegramUserId, chatId);
          const categoryText = await getCategoryList(resolved.workspaceId, resolved.userId);
          void sendMessage(chatId, categoryText);

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
          void sendMessage(chatId, '⚠️ Не удалось получить список категорий. Попробуйте позже.');
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
            void sendMessageWithKeyboard(chatId, ACCOUNTS_EMPTY_TEXT, buildAccountTypeKeyboard());
          } else {
            const accountText = await getAccountList(resolved.workspaceId, resolved.userId);
            void sendMessage(chatId, accountText);
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
          void sendMessage(chatId, '⚠️ Не удалось получить список счетов. Попробуйте позже.');
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
          void sendMessage(chatId, parsed.error);
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
            void sendMessage(chatId, 'Счёт с таким названием уже существует.');
          } else {
            // escapeHtml: parsed.name is user input rendered in parse_mode:'HTML' context (Phase 1.15 pattern).
            void sendMessage(
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
          void sendMessage(chatId, '⚠️ Не удалось добавить счёт. Попробуйте позже.');
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
          void sendMessage(chatId, parsed.error);
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
            void sendMessage(chatId, 'Категория с таким именем уже существует.');
          } else {
            // escapeHtml: parsed.canonicalGroup and parsed.name are user-influenced values
            // rendered in parse_mode:'HTML' context (Phase 1.15 hardening).
            void sendMessage(
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
          void sendMessage(chatId, '⚠️ Не удалось добавить категорию. Попробуйте позже.');
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
          void sendMessage(chatId, parsed.error);
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
            );
            void sendMessageWithKeyboard(chatId, menuText, buildSettingsMainKeyboard());
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
            if (result === 'not_found') {
              void sendMessage(chatId, '⚠️ Не удалось обновить валюту. Попробуйте позже.');
            } else {
              void sendMessage(chatId, formatCurrencyUpdated(parsed.code, oldCode));
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
              void sendMessage(chatId, '⚠️ Не удалось обновить часовой пояс. Попробуйте позже.');
            } else {
              void sendMessage(chatId, formatTimezoneUpdated(parsed.zone, oldZone));
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
          void sendMessage(chatId, '⚠️ Ошибка настроек. Попробуйте позже.');
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
            void sendMessage(chatId, '🗒 У вас ещё нет транзакций для редактирования.');
          } else {
            const totalPages = Math.max(1, Math.ceil(total / EDIT_PAGE_SIZE));
            const header = formatTransactionListHeader(0, totalPages);
            const lines = items.map((tx, i) => formatTransactionListLine(tx, i));
            const text = [header, ...lines].join('\n');
            const keyboard = buildTransactionListKeyboard(items, 0, totalPages);
            void sendMessageWithKeyboard(chatId, text, keyboard);
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
          void sendMessage(chatId, '⚠️ Не удалось открыть список транзакций. Попробуйте позже.');
        }

        await reply.status(200).send({ ok: true });
        return;
      }

      // ── 5d: /help (Phase 1.10) ───────────────────────────────
      if (commandToken === '/help') {
        void sendMessage(chatId, HELP_TEXT);
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
        void sendMessage(chatId, UNKNOWN_COMMAND_TEXT);
        request.log.info({
          msg: '[midas:bot:webhook] unknown slash command blocked',
          telegramUserId,
          commandToken,
        });
        await reply.status(200).send({ ok: true });
        return;
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
            void sendMessage(chatId, '⚠️ Название не может быть пустым или длиннее 100 символов. Попробуй ещё раз:');
          } else {
            const updatedState: AccountOnboardState = { ...acState, step: 'cur_pick', name: trimmed };
            await redisConnection.set(acKey, JSON.stringify(updatedState), 'EX', ONBOARD_STATE_TTL_SEC);
            try {
              const resolved = await resolveWorkspace(telegramUserId, chatId);
              void sendMessageWithKeyboard(chatId, CURRENCY_PICKER_TEXT, buildOnboardCurrencyKeyboard());
              request.log.info({ msg: '[midas:bot:webhook] ac: name input received', workspaceId: resolved.workspaceId });
            } catch {
              void sendMessage(chatId, CURRENCY_PICKER_TEXT);
            }
          }
          await reply.status(200).send({ ok: true });
          return;

        } else if (acState.step === 'cur_input') {
          // User typed a custom currency code — validate and create account
          const rawCode = message.text.trim().toUpperCase();
          if (!/^[A-Z]{1,10}$/.test(rawCode)) {
            void sendMessage(chatId, '⚠️ Неверный код валюты. Используй латинские буквы, например: <i>SOL</i>, <i>UAH</i>, <i>MATIC</i>.');
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
              void sendMessageWithKeyboard(
                chatId,
                `⚠️ Счёт <b>${escapeHtml(accountName)}</b> уже существует.`,
                buildAfterCreateKeyboard(),
              );
            } else {
              void sendMessageWithKeyboard(
                chatId,
                `✅ Счёт <b>${escapeHtml(accountName)}</b> (${escapeHtml(rawCode)}) создан!`,
                buildAfterCreateKeyboard(),
              );
              request.log.info({ msg: '[midas:bot:webhook] ac: account created via custom currency text', workspaceId: resolved.workspaceId });
            }
          } catch (err: unknown) {
            const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
            request.log.error({ msg: '[midas:bot:webhook] ac: cur_input account create failed', errorClass });
            void sendMessage(chatId, '⚠️ Не удалось создать счёт. Попробуйте позже.');
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
              void sendMessage(chatId, '✅ Сумма изменена. Баланс пересчитан автоматически.');
              request.log.info({ msg: '[midas:bot:webhook] edit: amount updated via text', txId, workspaceId: edWorkspaceId });
            } else if (res.status === 'invalid_amount') {
              void sendMessage(chatId, '⚠️ Неверная сумма. Отправьте число, например: 380 или 1500.50');
            } else if (res.status === 'cross_currency_blocked') {
              void sendMessage(chatId, '⚠️ Изменение суммы недоступно для мультивалютных транзакций.');
            } else {
              void sendMessage(chatId, '⚠️ Транзакция не найдена.');
            }
          } catch (err: unknown) {
            const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
            request.log.error({ msg: '[midas:bot:webhook] edit amount update failed', txId, errorClass });
            void sendMessage(chatId, '⚠️ Не удалось сохранить. Попробуйте позже.');
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
          void sendMessage(
            chatId,
            '❌ Ничего не найдено. Попробуй: USDT, BTC, EUR — или /settings для меню.',
          );
        } else {
          void sendMessageWithKeyboard(
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
