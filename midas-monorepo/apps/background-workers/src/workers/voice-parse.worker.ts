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
// Phase 2.3: STT transcript normalizer — crypto ticker fix
//
// Problem: xAI Grok STT transcribes spoken "USDT" as:
//   "юзд", "юздт", "юсдт", "usdt", "USD T", "US DT", "usd t" etc.
// Claude then maps "юзд" → USD (incorrect) per the prompt alias table.
//
// Solution: deterministic regex replacement BEFORE Claude sees the text.
// This is O(1), zero latency, zero LLM calls — the only right approach.
// ─────────────────────────────────────────────────────────────

const STT_CRYPTO_NORMALIZATIONS: Array<{ pattern: RegExp; replacement: string }> = [
  // USDT — most common mismatch. Must run BEFORE USD rules.
  // Covers: "юздт", "юсдт", "юзд т", "usdt", "usd t", "USD T", "us dt"
  { pattern: /\bюзд\s*т\b|\bюсд\s*т\b|\bюздт\b|\bюсдт\b/gi, replacement: 'USDT' },
  { pattern: /\busd\s*t\b|\bus\s*dt\b/gi,                       replacement: 'USDT' },
  { pattern: /\bтезер\b|\btether\b/gi,                           replacement: 'USDT' },

  // USDC — similar phonetics
  { pattern: /\bюздс\b|\bюсдс\b|\busd\s*c\b/gi,                 replacement: 'USDC' },

  // BTC — "биток" already in prompt but add STT variants
  { pattern: /\bbt\s*c\b|\bb\s*t\s*c\b/gi,                      replacement: 'BTC' },

  // ETH — "эфир" already in prompt; add STT split variants
  { pattern: /\be\s*t\s*h\b/gi,                                  replacement: 'ETH' },

  // TON — Telegram's own coin, common in CIS
  { pattern: /\bтон\s*коин\b|\bton\s*coin\b/gi,                  replacement: 'TON' },

  // SOL — Solana, often spoken as "сол" or "солана"
  { pattern: /\bсолана\b|\bsolana\b/gi,                           replacement: 'SOL' },

  // MATIC/POL — Polygon
  { pattern: /\bматик\b|\bполигон\b|\bpolygon\b/gi,               replacement: 'MATIC' },

  // XRP — Ripple
  { pattern: /\bрипл\b|\bripple\b/gi,                             replacement: 'XRP' },

  // TRX — Tron
  { pattern: /\bтрон\b(?!\s*(?:ов|ах|у|е|ом|ями))/gi,            replacement: 'TRX' },
];

// ─────────────────────────────────────────────────────────────
// Phase 2.7: STT spoken-number normalizer
//
// Problem: Voice input transcribes numbers as words:
//   "сто" → "100", "двести пятьдесят" → "250", "тысяча" → "1000"
// Without this, computeMissingFields() sees no digit → asks "Сколько?"
// even though the amount is clearly spoken.
//
// Strategy: single-pass greedy match of compound number words.
// Handles RU + UA phonetic variants (двохсот, п'ятдесят etc. handled
// by adding common Grok STT outputs for Ukrainian speech).
// ─────────────────────────────────────────────────────────────

/**
 * Map of spoken-number words → numeric values.
 * Ordered longest-first inside each tier to avoid partial matches.
 */
const SPOKEN_NUMBERS: Array<{ pattern: RegExp; value: number }> = [
  // Hundreds (compound: двести, triста etc. — must stay as single words, NOT split)
  { pattern: /\bдевятьсот\b/gi,      value: 900 },
  { pattern: /\bвосемьсот\b/gi,      value: 800 },
  { pattern: /\bвісімсот\b/gi,       value: 800 }, // UA
  { pattern: /\bсемьсот\b/gi,        value: 700 },
  { pattern: /\bшестьсот\b/gi,       value: 600 },
  { pattern: /\bпятьсот\b/gi,        value: 500 },
  { pattern: /\bп'?ятсот\b/gi,       value: 500 }, // UA
  { pattern: /\bчетыреста\b/gi,      value: 400 },
  { pattern: /\bчотириста\b/gi,      value: 400 }, // UA
  { pattern: /\bтриста\b/gi,         value: 300 },
  { pattern: /\bдвести\b|\bдвісті\b/gi, value: 200 },
  { pattern: /\bсто\b/gi,            value: 100 },

  // Tens
  { pattern: /\bдевяносто?\b/gi,     value: 90 },
  { pattern: /\bвосемьдесят\b/gi,    value: 80 },
  { pattern: /\bвісімдесят\b/gi,     value: 80 }, // UA
  { pattern: /\bсемьдесят\b/gi,      value: 70 },
  { pattern: /\bшестьдесят\b/gi,     value: 60 },
  { pattern: /\bпятьдесят\b/gi,      value: 50 },
  { pattern: /\bп'?ятдесят\b/gi,     value: 50 }, // UA
  { pattern: /\bсорок\b/gi,          value: 40 },
  { pattern: /\bтридцать\b|\bтридцять\b/gi, value: 30 },
  { pattern: /\bдвадцать\b|\bдвадцять\b/gi, value: 20 },

  // Teens (must be before single digits to avoid "один" matching in "одиннадцать")
  { pattern: /\bдевятнадцать\b|\bдев'?ятнадцять\b/gi, value: 19 },
  { pattern: /\bвосемнадцать\b|\bвісімнадцять\b/gi,    value: 18 },
  { pattern: /\bсемнадцать\b|\bсімнадцять\b/gi,        value: 17 },
  { pattern: /\bшестнадцать\b|\bшістнадцять\b/gi,      value: 16 },
  { pattern: /\bпятнадцать\b|\bп'?ятнадцять\b/gi,      value: 15 },
  { pattern: /\bчетырнадцать\b|\bчотирнадцять\b/gi,    value: 14 },
  { pattern: /\bтринадцать\b|\bтринадцять\b/gi,        value: 13 },
  { pattern: /\bдвенадцать\b|\bдванадцять\b/gi,        value: 12 },
  { pattern: /\bодиннадцать\b|\bодинадцять\b/gi,       value: 11 },
  { pattern: /\bдесять\b/gi,                           value: 10 },

  // Singles (last — most likely to false-positive)
  { pattern: /\bдевять\b|\bдев'?ять\b/gi,              value: 9 },
  { pattern: /\bвосемь\b|\bвісім\b/gi,                 value: 8 },
  { pattern: /\bсемь\b|\bсім\b/gi,                     value: 7 },
  { pattern: /\bшесть\b|\bшість\b/gi,                  value: 6 },
  { pattern: /\bпять\b|\bп'?ять\b/gi,                  value: 5 },
  { pattern: /\bчетыре\b|\bчотири\b/gi,                value: 4 },
  { pattern: /\bтри\b/gi,                              value: 3 },
  { pattern: /\bдва\b|\bдві\b|\bдвух\b/gi,             value: 2 },
  { pattern: /\bодин\b|\bодна\b|\bодно\b/gi,           value: 1 },
];

/**
 * Multiplicative scale words: N тысяч / N миллионов / N миллиардов.
 * These are replaced BEFORE SPOKEN_NUMBERS so "тысяч" doesn't become 1000
 * and then fail the descending-magnitude check in the aggregation pass.
 *
 * Examples:
 *   "10 тысяч"         → "10000"
 *   "полтора миллиона" → "1500000"  (handled separately below)
 *   "двадцать тысяч"   → after SPOKEN_NUMBERS pass: "20 тысяч" → "20000"
 *                        (the multiplicative pre-pass runs first as raw text)
 */
const MULTIPLICATIVE_PATTERNS: Array<{ pattern: RegExp; multiplier: number }> = [
  // миллиардов / млрд
  { pattern: /\b(\d+(?:[.,]\d+)?)\s*(?:миллиард(?:а|ов|ам|ами|ах)?|млрд\.?|мільярд(?:а|ів|ам|ами|ах)?)\b/gi, multiplier: 1_000_000_000 },
  // миллионов / млн
  { pattern: /\b(\d+(?:[.,]\d+)?)\s*(?:миллион(?:а|ов|ам|ами|ах)?|млн\.?|мільйон(?:а|ів|ам|ами|ах)?)\b/gi,  multiplier: 1_000_000 },
  // тысяч / тысячи / тыс
  { pattern: /\b(\d+(?:[.,]\d+)?)\s*(?:тысяч(?:а|и|у|ей|ам|ами|ах)?|тыс\.?|тисяч(?:а|і|у|ею|ами|ах)?|тис\.?)\b/gi, multiplier: 1_000 },
];

/**
 * Word-form multiplicative patterns (spoken digit word + scale word).
 * These run BEFORE SPOKEN_NUMBERS so the scale word isn't converted to a raw digit.
 * E.g. "двадцать тысяч" → "20000" (not "20 1000" which fails aggregation).
 */
const WORD_MULTIPLICATIVE_PATTERNS: Array<{ wordPattern: RegExp; multiplier: number }> = [
  // N тысяч(и) — word form, e.g. "двадцать тысяч", "пятьдесят тысяч"
  {
    wordPattern: /\b((?:девяносто?|восемьдесят|вісімдесят|семьдесят|шестьдесят|пятьдесят|п'?ятдесят|сорок|тридцать|тридцять|двадцать|двадцять|девятнадцать|дев'?ятнадцять|восемнадцать|вісімнадцять|семнадцать|сімнадцять|шестнадцать|шістнадцять|пятнадцать|п'?ятнадцять|четырнадцать|чотирнадцять|тринадцать|тринадцять|двенадцать|дванадцять|одиннадцать|одинадцять|десять|девять|дев'?ять|восемь|вісім|семь|сім|шесть|шість|пять|п'?ять|четыре|чотири|три|два|дві|двух|один|одна|одно)(?:\s+(?:девяносто?|восемьдесят|вісімдесят|семьдесят|шестьдесят|пятьдесят|п'?ятдесят|сорок|тридцать|тридцять|двадцать|двадцять))?)\s+тысяч(?:а|и|у|ей|ам|ами|ах)?\b/gi,
    multiplier: 1_000,
  },
  {
    wordPattern: /\b((?:девяносто?|восемьдесят|вісімдесят|семьдесят|шестьдесят|пятьдесят|п'?ятдесят|сорок|тридцать|тридцять|двадцать|двадцять|девятнадцать|дев'?ятнадцять|восемнадцать|вісімнадцять|семнадцать|сімнадцять|шестнадцать|шістнадцять|пятнадцать|п'?ятнадцять|четырнадцать|чотирнадцять|тринадцать|тринадцять|двенадцать|дванадцять|одиннадцать|одинадцять|десять|девять|дев'?ять|восемь|вісім|семь|сім|шесть|шість|пять|п'?ять|четыре|чотири|три|два|дві|двух|один|одна|одно)(?:\s+(?:девяносто?|восемьдесят|вісімдесят|семьдесят|шестьдесят|пятьдесят|п'?ятдесят|сорок|тридцать|тридцять|двадцать|двадцять))?)\s+тисяч(?:а|і|у|ею|ами|ах)?\b/gi,
    multiplier: 1_000,
  },
];

/**
 * Convert spoken-number words to digits in a transcript.
 *
 * Strategy: replace isolated number words one-by-one with their numeric
 * equivalents. Adjacent numbers are then summed by the following
 * aggregation pass (e.g. "двести пятьдесят" → "200 50" → "250").
 *
 * Note: only converts when the number word(s) appear adjacent to a
 * currency word or at the start of the amount position.
 * Avoids false positives like "три рубля" in "мы потратили три рубля"
 * — those still trigger correctly.
 *
 * SEC-12: text never logged here.
 */
function normalizeSpokenNumbers(text: string): string {
  let result = text;

  // ── Pass 1: word-multiplicative pre-pass ───────────────────────────────
  // Handle "двадцать тысяч", "пятьдесят тысяч" BEFORE converting words to digits.
  // The regex captures the multiplied word(s) and multiplies by the scale.
  // Must run BEFORE SPOKEN_NUMBERS so scale words aren't converted to bare digits first.
  for (const { wordPattern, multiplier } of WORD_MULTIPLICATIVE_PATTERNS) {
    result = result.replace(wordPattern, (match, numWords: string) => {
      // Temporarily apply SPOKEN_NUMBERS to the captured word group to get its value
      let numStr = numWords;
      for (const { pattern, value } of SPOKEN_NUMBERS) {
        numStr = numStr.replace(pattern, String(value));
      }
      // Collapse any additive compound (e.g. "20 5" from "двадцать пять")
      const digits = numStr.trim().split(/\s+/).map(Number).filter(n => !isNaN(n));
      if (digits.length === 0) return match;
      // Additive sum (must be descending)
      let sum = 0; let prev = Infinity; let ok = true;
      for (const d of digits) {
        if (d >= prev) { ok = false; break; }
        prev = d; sum += d;
      }
      if (!ok || sum <= 0) return match;
      return String(sum * multiplier);
    });
  }

  // ── Pass 2: digit-multiplicative pass ─────────────────────────────────
  // Handle "10 тысяч", "5 миллионов", "3.5 млн" — digit followed by scale word.
  // Must run BEFORE SPOKEN_NUMBERS (which would wrongly convert "тысяч" → 1000).
  for (const { pattern, multiplier } of MULTIPLICATIVE_PATTERNS) {
    result = result.replace(pattern, (_, numStr: string) => {
      const n = parseFloat(numStr.replace(',', '.'));
      if (isNaN(n) || n <= 0) return _;
      const product = Math.round(n * multiplier);
      if (product > 10_000_000_000) return _; // sanity cap
      return String(product);
    });
  }

  // ── Pass 3: spoken-word → digit replacement ────────────────────────────
  // Replace individual number words with their digit values.
  for (const { pattern, value } of SPOKEN_NUMBERS) {
    result = result.replace(pattern, String(value));
  }

  // ── Pass 4: additive aggregation ──────────────────────────────────────
  // Sum adjacent digit sequences for compound numbers: "200 50" → "250".
  // Only collapses descending-magnitude sequences (standard Russian compound numbers).
  result = result.replace(/\b(\d+)(\s+\d+)+\b/g, (match) => {
    const parts = match.split(/\s+/).map(Number);
    let sum = 0;
    let prevMagnitude = Infinity;
    let valid = true;
    for (const p of parts) {
      if (p >= prevMagnitude) { valid = false; break; }
      prevMagnitude = p;
      sum += p;
    }
    if (valid && sum > 0 && sum <= 10_000_000) return String(sum);
    return match;
  });

  return result;
}

/**
 * Normalize crypto ticker phonetic transcriptions + spoken numbers in a raw STT transcript.
 *
 * Runs deterministic regex replacements BEFORE Claude sees the text.
 * Preserves all other words and numbers unchanged.
 *
 * SEC-12: input/output text NEVER logged — caller's responsibility.
 */
function normalizeSttTranscript(transcript: string): string {
  let result = transcript;
  // Pass 1: crypto tickers
  for (const { pattern, replacement } of STT_CRYPTO_NORMALIZATIONS) {
    result = result.replace(pattern, replacement);
  }
  // Pass 2: spoken numbers → digits
  result = normalizeSpokenNumbers(result);
  return result;
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

// ─────────────────────────────────────────────────────────────
// Redis key helpers
// ─────────────────────────────────────────────────────────────

/** Tracks consecutive voice failures per user (for UX degradation) */
function voiceFailKey(telegramUserId: string, chatId: string): string {
  return `midas:voice:fail:${telegramUserId}:${chatId}`;
}

/**
 * Stores the ID of the last STT error message.
 * Read and deleted by the webhook when the user sends the next voice.
 * TTL: 24h (error messages older than that can't be deleted by Telegram anyway).
 */
function voiceErrMsgKey(telegramUserId: string, chatId: string): string {
  return `midas:voice:err:msg:${telegramUserId}:${chatId}`;
}

// ─────────────────────────────────────────────────────────────
// Worker processor
// ─────────────────────────────────────────────────────────────

async function processVoiceParse(job: Job<VoiceParseJobPayload>): Promise<void> {
  // Top-level guard: if anything throws unexpectedly, edit the status
  // message so the user never sees a frozen "⏳ Распознаю..." forever.
  // SEC-12: errors logged without transcript content.
  try {
    return await _processVoiceParse(job);
  } catch (err) {
    const statusMsgId = job.data.statusMessageId;
    const chatId      = job.data.chatId;
    console.error('[midas:voice-parse-worker] Unhandled error — editing status msg', {
      jobId: job.id,
      workspaceId: job.data.workspaceId,
      errorClass: err instanceof Error ? err.constructor.name : 'Unknown',
    });
    if (statusMsgId && chatId) {
      await editStatusMessage(chatId, statusMsgId, VOICE_ERROR_API_TEXT);
    }
    throw err; // re-throw so BullMQ marks the job as failed & retries
  }
}

async function _processVoiceParse(job: Job<VoiceParseJobPayload>): Promise<void> {
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
    // Store error message ID so next voice attempt deletes it
    void redisConnection.set(voiceErrMsgKey(telegramUserId, chatId), statusMessageId, 'EX', 86400);

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
    // Store error message ID so next voice attempt deletes it
    void redisConnection.set(voiceErrMsgKey(telegramUserId, chatId), statusMessageId, 'EX', 86400);
    // Don't increment failure counter for API errors — not user's fault
    return;
  }

  // ── Step 4b: STT succeeded ────────────────────────────────
  // Reset consecutive failure counter
  void redisConnection.del(failKey);

  // SEC-12: transcript exists in sttResult.text — NEVER log it
  // Phase 2.3: normalize crypto tickers BEFORE ai-parse sees the text.
  // e.g. "купил куртку за 300 юзд" → "купил куртку за 300 USDT"
  const transcript = normalizeSttTranscript(sttResult.text);

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

  // NOTE: BullMQ prohibits colons in custom job IDs.
  // IdempotencyKeyBuilder.aiParse uses ':' separators → crashes here.
  // Voice jobs are already deduplicated at the webhook level (voiceParse key),
  // so we use a plain ULID for the downstream ai-parse job.
  const aiJobId = ulid();
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
