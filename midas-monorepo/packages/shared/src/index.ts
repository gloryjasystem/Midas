/**
 * @midas/shared
 *
 * Shared types, constants, utilities used across all apps and packages.
 * Provides:
 * - Domain types (Workspace, User, TransactionDraft, etc.)
 * - ULID generation
 * - Environment config loader
 * - Shared Zod schemas for AI output validation (SEC-01)
 * - Job payload interfaces for BullMQ queues (Phase 1.3)
 * - IdempotencyKeyBuilder per SEC-06
 * - Constants (currencies, status enums)
 * - Telegram Update types (minimal subset, Phase 1.4)
 */

// ─────────────────────────────────────────────────────────────
// Queue Names — single source of truth
// ─────────────────────────────────────────────────────────────

export const QUEUE_NAMES = {
  WEBHOOK_INGESTION: 'webhook-ingestion',
  AI_PARSE: 'ai-parse',
  /** Phase 2.1: Voice message processing (download + xAI Grok STT + ai-parse re-enqueue) */
  VOICE_PARSE: 'voice-parse',
  CALLBACK_CONFIRM: 'callback-confirm',
  NOTIFICATIONS: 'notifications',
  DRAFT_EXPIRATION: 'draft-expiration',
  /** Phase 7.0-A: Daily summary dispatch — CRON every 5 minutes */
  SUMMARY_DISPATCH: 'summary-dispatch',
  /** Phase 7.0-C: Recurring payment reminders — CRON every hour */
  RECURRING_REMINDER: 'recurring-reminder',
  /** Phase 7.1: Cashflow reminder dispatch — CRON twice daily (08:00 + 20:00 UTC) */
  CASHFLOW_REMINDER: 'cashflow-reminder',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ─────────────────────────────────────────────────────────────
// Job Payload Interfaces
// NOTE: raw_text must NEVER be logged (SEC-12). It is included
// in the payload only so the worker can pass it to Claude, but
// all logging utilities must strip this field before output.
// ─────────────────────────────────────────────────────────────

/**
 * Payload for the `webhook-ingestion` queue.
 * Represents a validated Telegram text message ready for processing.
 * SEC-06 idempotency key: telegram:bot:{botId}:chat:{chatId}:msg:{messageId}
 */
export interface WebhookIngestionJobPayload {
  /** Telegram bot ID */
  botId: string;
  /** Telegram chat ID (string to avoid number precision loss) */
  chatId: string;
  /** Telegram message ID (unique within chat) */
  messageId: string;
  /** Telegram user ID (string — SEC-02: no Number() on IDs) */
  telegramUserId: string;
  /** Internal workspace ID (ULID) — injected by backend, NOT from user input (SEC-03) */
  workspaceId: string;
  /** Raw text of the message — MUST NOT be logged (SEC-12) */
  raw_text: string;
  /** ISO timestamp of the original message */
  receivedAt: string;
}

/**
 * Payload for the `ai-parse` queue.
 * Triggered after a webhook-ingestion job determines AI parsing is needed.
 * SEC-06 idempotency key: parse:bot:{botId}:msg:{messageId}
 */
export interface AiParseJobPayload {
  /** Telegram bot ID */
  botId: string;
  /** Telegram message ID */
  messageId: string;
  /** Telegram chat ID */
  chatId: string;
  /** Telegram user ID */
  telegramUserId: string;
  /** Internal workspace ID (ULID) — always from trusted backend context (SEC-03) */
  workspaceId: string;
  /** Raw text to parse — MUST NOT be logged (SEC-12) */
  raw_text: string;
  /** ISO timestamp of original message */
  receivedAt: string;
  /**
   * Phase 2.7: Optional clarification context from a prior partial parse.
   * Preserved so Claude can merge the user's clarification answer (e.g. "100 грн")
   * with the original item_hint/category_hint instead of parsing in a vacuum.
   * SEC-12: labels only — never IDs, amounts, or system fields.
   */
  clarificationContext?: {
    itemHint?: string;
    categoryHint?: string;
    intent?: string;
  };
}

/**
 * Payload for the `voice-parse` queue — Phase 2.1.
 * The worker downloads OGG audio, transcribes via xAI Grok STT,
 * then re-enqueues as AiParseJobPayload (raw_text = transcript).
 *
 * SEC-06 idempotency key: voice|bot|{botId}|chat|{chatId}|msg|{messageId}
 * SEC-12: No user text here — only Telegram file metadata.
 */
export interface VoiceParseJobPayload {
  /** Telegram bot ID */
  botId: string;
  /** Telegram chat ID */
  chatId: string;
  /** Telegram message ID */
  messageId: string;
  /** Telegram user ID */
  telegramUserId: string;
  /** Internal workspace ID (ULID) — from trusted backend (SEC-03) */
  workspaceId: string;
  /** Internal user ID (ULID) — Phase 2S2: needed for RLS queries in command executor */
  userId: string;
  /** Telegram file_id — used to call getFile API */
  fileId: string;
  /** Duration in seconds (pre-validated ≥ 1 at webhook layer) */
  duration: number;
  /** ID of the "⏳ Распознаю..." status message sent immediately by the bot */
  statusMessageId: string;
  /** ISO timestamp */
  receivedAt: string;
}

/**
 * Payload for the `notifications` queue.
 * Triggers sending a Telegram message to a user.
 * SEC-06 idempotency key: notify:{workspaceId}:{alertId}
 */
export interface NotificationJobPayload {
  /** Unique alert/notification ID (ULID) — used for idempotency */
  alertId: string;
  /** Workspace the notification belongs to */
  workspaceId: string;
  /** Telegram chat ID to send to */
  chatId: string;
  /** Text content of the notification (safe to log — no raw financial text) */
  message: string;
  /** Optional: draft_id being confirmed/rejected */
  draftId?: string;
  /** Optional: inline keyboard JSON (serialized for type safety) */
  inlineKeyboardJson?: string;
  /** Phase 1.33: Telegram user ID — needed for active-message Redis key */
  telegramUserId?: string;
  /** Phase 1.33: Current active bot message ID — try editMessageText before sendMessage */
  activeMessageId?: string;
  /**
   * Phase 1.36-UX: Reply Keyboard JSON to attach on fresh sendMessage calls.
   * Used when rejection/expiry sends a new message — activates the persistent nav keyboard.
   * NOTE: editMessageText does NOT support ReplyKeyboardMarkup; only sendMessage does.
   * So this is only applied on the sendMessage path, never on editMessageText.
   */
  replyKeyboardJson?: string;
  /**
   * Phase 1.37-UX: Redis key to write sentMessageId into after sending.
   * Used by clarification notifications to track the "current clarification message"
   * so the NEXT clarification can edit it instead of sending a duplicate.
   * Key format: midas:clar:msg:{telegramUserId}:{chatId}  TTL: 600s
   */
  cacheStoreKey?: string;
  /**
   * Phase 1.37-UX: Telegram message ID to delete before sending the new message.
   * Used when AI successfully parses a new message after a "Не понял" card was shown —
   * deletes the old clarification card so only the preview card remains in chat.
   */
  deleteMessageId?: string;
  /**
   * Phase 2.10: When true, the notifications worker will NOT update midas:am: after sending.
   * Used for confirmed transaction success cards ("✅ Записано") — these are permanent floating
   * records that must NOT be overwritten or deleted when the user types a new transaction.
   * Without this flag, midas:am: would point to the success card, causing the next
   * upsertBotMessage (new draft picker) to edit/delete the confirmed record in-place.
   */
  isSuccessCard?: boolean;
}

/**
 * Payload for the `callback-confirm` queue — Phase 1.6-B.
 * Triggered when user taps approve/reject inline keyboard button.
 * SEC-06 idempotency key: cb|user|{telegramUserId}|draft|{draftId}|action|{action}
 * SEC-03: workspaceId injected by backend (webhook route) from trusted source.
 */
export interface CallbackConfirmJobPayload {
  /** Telegram callback query ID — used to answer the callback (remove loading state) */
  callbackQueryId: string;
  /** Telegram user ID — string (SEC-02: no Number() on IDs) */
  telegramUserId: string;
  /** Internal draft ID (ULID) — from callback_data, validated against DB */
  draftId: string;
  /** Approval action — 'approve' or 'reject' */
  action: 'approve' | 'reject';
  /** Internal workspace ID — injected by backend from session, NOT from callback_data (SEC-03) */
  workspaceId: string;
  /** Telegram chat ID — for sending confirmation notification */
  chatId: string;
}

// ─────────────────────────────────────────────────────────────
// Log-safe job context — strips raw_text (SEC-12)
// ─────────────────────────────────────────────────────────────

export interface LogSafeJobContext {
  jobId: string;
  queueName: QueueName;
  workspaceId: string;
  telegramUserId?: string;
  draftId?: string;
  errorClass?: string;
}

/**
 * Build a log-safe context object from any job payload.
 * NEVER include raw_text, tokens, or financial text in logs (SEC-12).
 */
export function buildLogSafeContext(
  jobId: string,
  queueName: QueueName,
  payload: WebhookIngestionJobPayload | AiParseJobPayload | NotificationJobPayload | CallbackConfirmJobPayload,
): LogSafeJobContext {
  const ctx: LogSafeJobContext = {
    jobId,
    queueName,
    workspaceId: payload.workspaceId,
  };
  if ('telegramUserId' in payload) {
    ctx.telegramUserId = payload.telegramUserId;
  }
  if ('draftId' in payload && payload.draftId) {
    ctx.draftId = payload.draftId;
  }
  return ctx;
}

// ─────────────────────────────────────────────────────────────
// IdempotencyKeyBuilder — SEC-06
// ─────────────────────────────────────────────────────────────

/**
 * Builds deterministic, collision-resistant idempotency keys for BullMQ jobs.
 *
 * IMPORTANT — BullMQ v5 forbids ':' in custom jobId values (used internally
 * by Redis for key namespacing). All separators use '|' (pipe) instead.
 *
 * SEC-06 key formats:
 *  - Webhook ingestion: tg|bot|{botId}|chat|{chatId}|msg|{messageId}
 *  - AI parse:          parse|bot|{botId}|msg|{messageId}
 *  - Callback confirm:  cb|user|{telegramUserId}|draft|{draftId}|action|{action}
 *  - Notification:      notify|{workspaceId}|{alertId}
 */
export const IdempotencyKeyBuilder = {
  /**
   * Key for webhook-ingestion queue jobs.
   * messageId is unique only within a chat; botId+chatId+messageId is globally unique.
   */
  webhookIngestion(botId: string, chatId: string, messageId: string): string {
    return `tg|bot|${botId}|chat|${chatId}|msg|${messageId}`;
  },

  /**
   * Key for ai-parse queue jobs.
   * Prevents double-parsing of the same message.
   */
  aiParse(botId: string, messageId: string): string {
    return `parse|bot|${botId}|msg|${messageId}`;
  },

  /** Phase 2.1: Key for voice-parse queue jobs. */
  voiceParse(botId: string, chatId: string, messageId: string): string {
    return `voice|bot|${botId}|chat|${chatId}|msg|${messageId}`;
  },

  /**
   * Key for callback confirmation jobs.
   * action = 'approved' | 'rejected'
   */
  callbackConfirm(telegramUserId: string, draftId: string, action: string): string {
    return `cb|user|${telegramUserId}|draft|${draftId}|action|${action}`;
  },

  /**
   * Key for notification jobs.
   */
  notification(workspaceId: string, alertId: string): string {
    return `notify|${workspaceId}|${alertId}`;
  },
} as const;

// ─────────────────────────────────────────────────────────────
// Draft / Transaction Status Enums
// ─────────────────────────────────────────────────────────────

export const DRAFT_STATUS = {
  PENDING_USER: 'pending_user',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
  NEEDS_CLARIFICATION: 'needs_clarification',
} as const;

export type DraftStatus = (typeof DRAFT_STATUS)[keyof typeof DRAFT_STATUS];

export const TRANSACTION_TYPE = {
  EXPENSE: 'expense',
  INCOME: 'income',
  DEBT_GIVEN: 'debt_given',
  DEBT_RECEIVED: 'debt_received',
  TRANSFER: 'transfer',
} as const;

export type TransactionType = (typeof TRANSACTION_TYPE)[keyof typeof TRANSACTION_TYPE];

// ─────────────────────────────────────────────────────────────
// Telegram Bot API — minimal Update types (Phase 1.4)
// SEC-05: Only text messages are processed. All other types are rejected.
//
// We define only the fields we actually access — no third-party type library
// to keep the dependency footprint minimal and avoid version drift.
// ─────────────────────────────────────────────────────────────

/** Minimal Telegram User representation */
export interface TelegramUser {
  /** Telegram user ID (number in API, but we coerce to string immediately) */
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

/** Minimal Telegram Chat representation */
export interface TelegramChat {
  /** Telegram chat ID */
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
}

/**
 * Minimal Telegram Message — only fields required for Phase 1 text processing.
 * SEC-05: `text` being absent signals a non-text message that must be rejected.
 */
/** Phase 2.1: Minimal Telegram Voice object */
export interface TelegramVoice {
  /** Telegram file_id — pass to getFile API for download URL */
  file_id: string;
  /** Duration in seconds */
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  /** Phase 2.1: present for voice messages */
  voice?: TelegramVoice;
}

/**
 * Telegram Update object received via webhook.
 * SEC-05: We only process `message` updates with a `text` field.
 * `callback_query` is reserved for Phase 1.4 Human-in-the-Loop confirmations (stub only).
 */
export interface TelegramUpdate {
  update_id: number;
  /** Present for new messages */
  message?: TelegramMessage;
  /** Present for inline keyboard button presses — stub for Phase 1.4 */
  callback_query?: TelegramCallbackQuery;
}

/** Minimal CallbackQuery for inline keyboard handling (Human-in-the-Loop, Phase 1.4) */
export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string; // The button's callback_data value
}

// ─────────────────────────────────────────────────────────────
// Phase 2S2: Command Router — free-text navigation detection
// ─────────────────────────────────────────────────────────────

export { detectCommand, type NavCommand } from './command-router.js';

// ─────────────────────────────────────────────────────────────
// Phase 5.1-Pre: Shared UI Utilities
// Pure functions — zero I/O, usable in any app or worker context.
// ─────────────────────────────────────────────────────────────

export { getCategoryEmoji } from './category-emoji.js';
export { escapeHtml } from './html-escape.js';
export {
  buildQuickEditAmountKb,
  buildQuickEditCategoryKb,
  buildQuickEditAccountKb,
  buildQuickEditIntentKb,
  QE_EDITABLE_INTENTS,
  type QECategoryInfo,
  type QEAccountInfo,
  type QEKeyboardResult,
  type QETransactionIntent,
} from './quick-edit-ui.js';
