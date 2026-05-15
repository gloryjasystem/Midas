/**
 * voice-parse Worker — Phase 2.1
 *
 * Processes jobs from the `voice-parse` queue.
 * Concurrency: 3 (xAI Grok STT rate limit: well within budget at ~$0.10/hr)
 *
 * Flow:
 *   1. Get Telegram file_path via getFile Bot API
 *   2. Download OGG audio buffer from Telegram CDN
 *   3. Transcribe via xAI Grok STT (groq-stt.ts)
 *   4a. On STT error/empty → edit status msg to user-friendly error UX
 *   4b. On success → store statusMessageId in midas:clar:msg: Redis key
 *       (ai-parse.worker reads this key and deletes it when draft card appears)
 *   5. Re-enqueue as AiParseJobPayload (raw_text = transcript)
 *      → ai-parse.worker handles the rest (Claude Haiku, draft, confirm card)
 *
 * Phase 2.2: Voice command detection — if transcript matches a navigation
 * command ("покажи баланс", "какой отчёт", etc.), executes it directly
 * WITHOUT creating a draft.
 *
 * SEC-12: Transcript text is NEVER logged in this worker.
 * SEC-03: workspaceId always comes from job payload (trusted backend source).
 */

import { Worker, type Job } from 'bullmq';
import { QUEUE_NAMES, type VoiceParseJobPayload, type AiParseJobPayload, IdempotencyKeyBuilder } from '@midas/shared';
import { transcribeVoice } from '@midas/ai-core';
import { redisConnection } from '../queues/redis.js';
import { aiParseQueue, notificationsQueue } from '../queues/queue-definitions.js';
import { ulid } from 'ulid';

// ─────────────────────────────────────────────────────────────
// Telegram file download helpers
// ─────────────────────────────────────────────────────────────

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const DOWNLOAD_TIMEOUT_MS = 15_000;

interface TelegramGetFileResult {
  ok: boolean;
  result?: { file_path?: string };
}

/**
 * Get the temporary download path for a Telegram file.
 * SEC-12: Only logs file_id length — not the ID itself.
 */
async function getTelegramFilePath(fileId: string): Promise<string | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); }, DOWNLOAD_TIMEOUT_MS);

    const resp = await fetch(`${TELEGRAM_API_BASE}/bot${token}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) return null;
    const data = (await resp.json()) as TelegramGetFileResult;
    return data.result?.file_path ?? null;
  } catch {
    return null;
  }
}

/**
 * Download a Telegram file as a Buffer.
 * Telegram CDN provides the file at: https://api.telegram.org/file/bot{token}/{file_path}
 */
async function downloadTelegramFile(filePath: string): Promise<Buffer | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); }, DOWNLOAD_TIMEOUT_MS);

    const resp = await fetch(
      `${TELEGRAM_API_BASE}/file/bot${token}/${filePath}`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    if (!resp.ok) return null;
    const arrayBuffer = await resp.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Edit status message (update "⏳ Распознаю..." in-place)
// ─────────────────────────────────────────────────────────────

async function editStatusMessage(
  chatId: string,
  messageId: string,
  text: string,
  keyboard?: object,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  try {
    await fetch(`${TELEGRAM_API_BASE}/bot${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: parseInt(messageId, 10),
        text,
        parse_mode: 'HTML',
        ...(keyboard ? { reply_markup: keyboard } : {}),
      }),
    });
  } catch {
    // Non-fatal: status message may already be deleted or expired
  }
}

// ─────────────────────────────────────────────────────────────
// Phase 2.2: Voice command router
// Detects navigation commands in transcript before creating a draft.
// ─────────────────────────────────────────────────────────────

type VoiceCommand = 'balance' | 'report' | 'transactions' | 'settings' | null;

const VOICE_COMMAND_PATTERNS: Array<{ re: RegExp; cmd: VoiceCommand }> = [
  { re: /\b(покажи?\s+баланс|какой\s+баланс|мой\s+баланс|баланс)/i, cmd: 'balance' },
  { re: /\b(покажи?\s+отч[её]т|какой\s+отч[её]т|отч[её]т\s+за)/i, cmd: 'report' },
  { re: /\b(покажи?\s+транзакции|мои\s+транзакции|список\s+транзакций)/i, cmd: 'transactions' },
  { re: /\b(откро[йи]\s+настройки|настройки|мои\s+настройки)/i, cmd: 'settings' },
];

function detectVoiceCommand(text: string): VoiceCommand {
  const lower = text.toLowerCase();
  for (const { re, cmd } of VOICE_COMMAND_PATTERNS) {
    if (re.test(lower)) return cmd;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// UX message templates
// ─────────────────────────────────────────────────────────────

const VOICE_ERROR_EMPTY_TEXT =
  '😕 <b>Не смог разобрать голосовое.</b>\n\n' +
  'Возможные причины:\n' +
  '• Слишком тихо или шумно вокруг\n' +
  '• Слишком короткое сообщение\n\n' +
  'Попробуй ещё раз или напиши текстом 👇';

const VOICE_ERROR_API_TEXT =
  '⚠️ <b>Сервис распознавания временно недоступен.</b>\n\n' +
  'Напиши транзакцию текстом — я точно пойму!';

const VOICE_ERROR_DOWNLOAD_TEXT =
  '⚠️ <b>Не смог загрузить голосовое сообщение.</b>\n\n' +
  'Попробуй ещё раз или напиши текстом 👇';

// Counter key: tracks consecutive voice failures per user
function voiceFailKey(telegramUserId: string, chatId: string): string {
  return `midas:voice:fail:${telegramUserId}:${chatId}`;
}

// ─────────────────────────────────────────────────────────────
// Worker processor
// ─────────────────────────────────────────────────────────────

async function processVoiceParse(job: Job<VoiceParseJobPayload>): Promise<void> {
  const { botId, chatId, messageId, telegramUserId, workspaceId, fileId, duration, statusMessageId } = job.data;

  console.log('[midas:voice-parse-worker] Processing job', {
    jobId: job.id,
    workspaceId,
    telegramUserId,
    duration,
    // fileId and statusMessageId are operational metadata — safe to log (no user text)
  });

  const failKey = voiceFailKey(telegramUserId, chatId);

  // ── Step 1: Get Telegram file path ────────────────────────
  const filePath = await getTelegramFilePath(fileId);
  if (!filePath) {
    console.warn('[midas:voice-parse-worker] Failed to get file_path from Telegram', {
      jobId: job.id, workspaceId,
    });
    await editStatusMessage(chatId, statusMessageId, VOICE_ERROR_DOWNLOAD_TEXT);
    await redisConnection.incr(failKey);
    await redisConnection.expire(failKey, 3600);
    return;
  }

  // ── Step 2: Download OGG buffer ────────────────────────────
  const audioBuffer = await downloadTelegramFile(filePath);
  if (!audioBuffer) {
    console.warn('[midas:voice-parse-worker] Failed to download audio buffer', {
      jobId: job.id, workspaceId,
    });
    await editStatusMessage(chatId, statusMessageId, VOICE_ERROR_DOWNLOAD_TEXT);
    await redisConnection.incr(failKey);
    await redisConnection.expire(failKey, 3600);
    return;
  }

  // ── Step 3: xAI Grok STT ─────────────────────────────────
  // Extract filename from filePath (e.g. "voice/file_1.oga" → "voice.ogg")
  const ext = filePath.split('.').pop() ?? 'ogg';
  const filename = `voice.${ext}`;

  const sttResult = await transcribeVoice(audioBuffer, filename, 'ru');
  // SEC-12: sttResult.text NEVER logged below

  // ── Step 4a: Handle STT failures ──────────────────────────
  if (sttResult.status === 'empty') {
    console.log('[midas:voice-parse-worker] STT returned empty — silent or noise audio', {
      jobId: job.id, workspaceId,
    });
    await editStatusMessage(chatId, statusMessageId, VOICE_ERROR_EMPTY_TEXT);

    // Increment failure counter — suggest text input after 3 failures
    const failCount = await redisConnection.incr(failKey);
    await redisConnection.expire(failKey, 3600);

    if (failCount >= 3) {
      const exhaustedText =
        '😊 <b>Похоже, голосом пока не получается.</b>\n\n' +
        'Попробуй написать текстом — я точно пойму что нужно сделать.';
      await editStatusMessage(chatId, statusMessageId, exhaustedText);
      void redisConnection.del(failKey); // reset counter
    }
    return;
  }

  if (sttResult.status === 'error') {
    console.warn('[midas:voice-parse-worker] STT API error', {
      jobId: job.id, workspaceId,
      reason: sttResult.reason, // reason is system message, not user text — safe
    });
    await editStatusMessage(chatId, statusMessageId, VOICE_ERROR_API_TEXT);
    // Don't increment failure counter for API errors — not user's fault
    return;
  }

  // ── Step 4b: STT succeeded ────────────────────────────────
  // Reset consecutive failure counter
  void redisConnection.del(failKey);

  // SEC-12: transcript exists in sttResult.text — NEVER log it
  const transcript = sttResult.text;

  // ── Phase 2.2: Voice command detection ───────────────────
  const voiceCmd = detectVoiceCommand(transcript);
  if (voiceCmd) {
    console.log('[midas:voice-parse-worker] Phase 2.2: voice command detected', {
      jobId: job.id, workspaceId, voiceCmd,
    });

    // Map command to callback_data that the webhook route already handles
    const cmdMap: Record<NonNullable<VoiceCommand>, string> = {
      balance:      '📊 Баланс',
      report:       '📋 Отчёт',
      transactions: '📋 Транзакции',
      settings:     '⚙️ Настройки',
    };

    // Send a notification that triggers the command result
    // We reuse the notifications queue + send a message with the command result
    // The simplest approach: send a plain message telling user to tap the nav button,
    // or we could directly trigger the relevant data. For now we show a helpful prompt.
    const cmdText = `🎤 <b>Распознал команду:</b> «${cmdMap[voiceCmd]}»\n\nНажми кнопку в меню ниже 👇`;
    const alertId = ulid();
    await notificationsQueue.add(
      QUEUE_NAMES.NOTIFICATIONS,
      {
        alertId,
        workspaceId,
        chatId,
        message: cmdText,
        activeMessageId: statusMessageId,
        telegramUserId,
      },
      { jobId: IdempotencyKeyBuilder.notification(workspaceId, alertId) },
    );
    return;
  }

  // ── Step 5: Store status msgId → ai-parse will delete it ──
  // The ai-parse.worker reads `midas:clar:msg:{uid}:{cid}` and passes it
  // as `deleteMessageId` when the draft card is sent. This makes the
  // "⏳ Распознаю..." message disappear exactly when the card appears.
  const clarMsgKey = `midas:clar:msg:${telegramUserId}:${chatId}`;
  try {
    await redisConnection.set(clarMsgKey, statusMessageId, 'EX', 600);
  } catch {
    // Non-fatal: if this fails, the "⏳" message stays but UX still works
  }

  // ── Step 6: Re-enqueue as ai-parse job ───────────────────
  // raw_text = Whisper transcript. The entire existing ai-parse.worker flow
  // handles draft creation, account picker, and confirmation — zero duplication.
  const aiParsePayload: AiParseJobPayload = {
    botId,
    messageId,
    chatId,
    telegramUserId,
    workspaceId,
    raw_text: transcript, // SEC-12: stored in job payload, never logged
    receivedAt: job.data.receivedAt,
  };

  const aiJobId = IdempotencyKeyBuilder.aiParse(botId, `voice:${messageId}`);
  await aiParseQueue.add(QUEUE_NAMES.AI_PARSE, aiParsePayload, { jobId: aiJobId });

  console.log('[midas:voice-parse-worker] Transcript enqueued to ai-parse', {
    jobId: job.id,
    workspaceId,
    aiJobId,
    // transcript NOT logged (SEC-12)
  });
}

// ─────────────────────────────────────────────────────────────
// Worker instantiation
// ─────────────────────────────────────────────────────────────

export function createVoiceParseWorker(): Worker<VoiceParseJobPayload> {
  const worker = new Worker<VoiceParseJobPayload>(
    QUEUE_NAMES.VOICE_PARSE,
    processVoiceParse,
    {
      connection: redisConnection,
      prefix: 'bull',
      concurrency: 3,
      // xAI Grok STT rate limit is generous — 3 concurrent workers is well within budget.
      limiter: {
        max: 30,
        duration: 60_000,
      },
    },
  );

  worker.on('completed', (job: Job<VoiceParseJobPayload>) => {
    console.log('[midas:voice-parse-worker] Job completed', {
      jobId: job.id,
      workspaceId: job.data.workspaceId,
      duration: job.data.duration,
    });
  });

  worker.on('failed', (job: Job<VoiceParseJobPayload> | undefined, err: Error) => {
    console.error('[midas:voice-parse-worker] Job failed', {
      jobId: job?.id ?? 'unknown',
      workspaceId: job?.data.workspaceId,
      errorClass: err.constructor.name,
      attemptsMade: job?.attemptsMade,
    });
  });

  return worker;
}
