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
const KNOWN_COMMANDS = new Set(['/start', '/report', '/help', '/category', '/add_category', '/accounts', '/add_account', '/balance', '/set_balance', '/settings']);

/**
 * Russian-language help text listing all currently available commands.
 * Phase 1.10: /start, /report, /help
 * Phase 1.11: /category
 * Phase 1.13: /add_category
 * Phase 1.14: /accounts
 * Phase 1.17: /add_account
 * Phase 1.21: /balance
 * Phase 1.23: /set_balance
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

      // ── 5d-acc: /accounts (Phase 1.14) ───────────────────────
      if (commandToken === '/accounts') {
        try {
          const resolved = await resolveWorkspace(telegramUserId, chatId);
          const accountText = await getAccountList(resolved.workspaceId, resolved.userId);
          void sendMessage(chatId, accountText);

          request.log.info({
            msg: '[midas:bot:webhook] /accounts sent',
            telegramUserId,
            workspaceId: resolved.workspaceId,
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

    // ── Step 5g: Phase 1.26 — settings search mode intercept ───
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
