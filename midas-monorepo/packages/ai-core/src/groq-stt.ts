/**
 * @midas/ai-core — Voice STT Client — Phase 2.4
 *
 * Transcribes audio buffers (OGG/OPUS from Telegram) to text.
 *
 * Provider priority:
 *   1. Groq Whisper (whisper-large-v3-turbo) — PREFERRED
 *      - Supports `prompt` parameter → vocabulary bias for "тысяч", "миллион"
 *      - Supports `temperature=0` → deterministic decoding
 *      - Excellent Russian number recognition
 *      - Endpoint: POST https://api.groq.com/openai/v1/audio/transcriptions
 *
 *   2. xAI Grok STT — FALLBACK (if GROQ_API_KEY is not set)
 *      - Does NOT support `prompt` parameter (silently ignores it)
 *      - Known to drop scale words ("тысяч") from Russian speech
 *      - Endpoint: POST https://api.x.ai/v1/stt
 *
 * SEC-12: Transcript text is NEVER logged inside this module.
 * SEC-03: No workspace/user context — pure audio → text conversion.
 */

const GROQ_STT_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const XAI_STT_ENDPOINT = 'https://api.x.ai/v1/stt';
const REQUEST_TIMEOUT_MS = 15_000;

// ─────────────────────────────────────────────────────────────
// STT Context Prompt — Whisper "initial_prompt"
// ─────────────────────────────────────────────────────────────
//
// Whisper `prompt` is NOT an instruction — it's "previous context".
// The model treats it as text that came BEFORE the current audio.
// This biases vocabulary toward financial speech:
//   - scale words: тысяч, тысячи, тысяча, миллион
//   - transfer verbs: перевёл, скинул, отправил
//   - currency names: долларов, гривен, рублей
//   - number words: десять, двадцать, пятьдесят, сто, двести, пятьсот
//
// ONLY effective with Groq Whisper. xAI ignores this parameter.
// ─────────────────────────────────────────────────────────────

const STT_FINANCE_PROMPT = [
  'Перевёл десять тысяч долларов на Сбербанк.',
  'Скинул пятьдесят тысяч гривен.',
  'Потратил три тысячи рублей на продукты.',
  'Получил двадцать тысяч от Миши.',
  'Отправил пять тысяч долларов.',
  'Купил за двести пятьдесят тысяч гривен.',
  'Заработал сто тысяч рублей.',
  'Перевёл пятнадцать тысяч на Монобанк.',
  'Снял два миллиона тенге.',
  'Расход десять тысяч пятьсот долларов.',
].join(' ');

// ─────────────────────────────────────────────────────────────
// Return types
// ─────────────────────────────────────────────────────────────

export type TranscribeResult =
  | { status: 'ok'; text: string }
  | { status: 'empty' }
  | { status: 'error'; reason: string };

// ─────────────────────────────────────────────────────────────
// Provider: Groq Whisper (PRIMARY)
// ─────────────────────────────────────────────────────────────

async function transcribeWithGroq(
  audioBuffer: Buffer,
  filename: string,
  apiKey: string,
  language: string,
): Promise<TranscribeResult> {
  const formData = new FormData();

  // Model — whisper-large-v3-turbo: best speed/accuracy for Russian
  formData.append('model', 'whisper-large-v3-turbo');

  // Language — force Russian to prevent language switching
  formData.append('language', language);

  // Prompt — THIS ACTUALLY WORKS on Groq (unlike xAI)
  // Biases the vocabulary toward financial speech with scale words
  formData.append('prompt', STT_FINANCE_PROMPT);

  // Temperature = 0 → deterministic decoding, no random word drops
  formData.append('temperature', '0');

  // Response format — plain text (lighter than JSON)
  formData.append('response_format', 'text');

  // File — must be a Blob with proper MIME type
  const ab = audioBuffer.buffer.slice(
    audioBuffer.byteOffset,
    audioBuffer.byteOffset + audioBuffer.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([ab], { type: 'audio/ogg' });
  formData.append('file', blob, filename);

  const controller = new AbortController();
  const timeout = setTimeout(() => { controller.abort(); }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(GROQ_STT_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const statusCode = response.status;
      console.error('[groq-stt] API returned non-OK status', { statusCode });
      const isRetriable = statusCode === 429 || statusCode >= 500;
      return {
        status: 'error',
        reason: isRetriable
          ? `Groq STT temporarily unavailable (${String(statusCode)})`
          : `Groq STT error (${String(statusCode)})`,
      };
    }

    // response_format=text → body is plain text, not JSON
    const text = await response.text();
    const trimmed = text.trim();

    if (!trimmed) return { status: 'empty' };

    // Whisper non-speech placeholder tags
    if (/^\[.{1,30}\]$/.test(trimmed)) return { status: 'empty' };

    return { status: 'ok', text: trimmed };
  } catch (err) {
    clearTimeout(timeout);
    const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
    console.error('[groq-stt] Fetch failed', { errorClass });
    return { status: 'error', reason: `Groq STT fetch failed: ${errorClass}` };
  }
}

// ─────────────────────────────────────────────────────────────
// Provider: xAI Grok STT (FALLBACK)
// ─────────────────────────────────────────────────────────────

async function transcribeWithXai(
  audioBuffer: Buffer,
  filename: string,
  apiKey: string,
  language: string,
): Promise<TranscribeResult> {
  const formData = new FormData();

  // Language hint
  formData.append('language', language);

  // NOTE: xAI does NOT support `prompt` or `temperature`.
  // These parameters are silently ignored by xAI's STT API.
  // This is why "тысяч" is frequently dropped in transcriptions.

  // File LAST — xAI strict ordering requirement
  const ab = audioBuffer.buffer.slice(
    audioBuffer.byteOffset,
    audioBuffer.byteOffset + audioBuffer.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([ab], { type: 'audio/ogg' });
  formData.append('file', blob, filename);

  const controller = new AbortController();
  const timeout = setTimeout(() => { controller.abort(); }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(XAI_STT_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const statusCode = response.status;
      console.error('[xai-stt] API returned non-OK status', { statusCode });
      const isRetriable = statusCode === 429 || statusCode >= 500;
      return {
        status: 'error',
        reason: isRetriable
          ? `xAI STT temporarily unavailable (${String(statusCode)})`
          : `xAI STT error (${String(statusCode)})`,
      };
    }

    const responseJson = (await response.json()) as { text?: string; error?: string };
    const trimmed = (responseJson.text ?? '').trim();

    if (!trimmed) return { status: 'empty' };
    if (/^\[.{1,30}\]$/.test(trimmed)) return { status: 'empty' };

    return { status: 'ok', text: trimmed };
  } catch (err) {
    clearTimeout(timeout);
    const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
    console.error('[xai-stt] Fetch failed', { errorClass });
    return { status: 'error', reason: `xAI STT fetch failed: ${errorClass}` };
  }
}

// ─────────────────────────────────────────────────────────────
// Public API: transcribeVoice (auto-selects provider)
// ─────────────────────────────────────────────────────────────

/**
 * Transcribe an OGG/OPUS audio buffer to text.
 *
 * Provider selection:
 *   - GROQ_API_KEY set → Groq Whisper (supports prompt/temperature)
 *   - Only XAI_API_KEY → xAI Grok STT (no prompt support, less reliable for numbers)
 *
 * @param audioBuffer  - Raw audio bytes downloaded from Telegram
 * @param filename     - Filename with extension (e.g. "voice.ogg")
 * @param languageHint - Optional ISO-639-1 language hint (defaults to "ru")
 * @returns TranscribeResult discriminated union.
 *
 * SEC-12: Transcribed text is returned to caller — NEVER logged here.
 */
export async function transcribeVoice(
  audioBuffer: Buffer,
  filename: string,
  languageHint?: string,
): Promise<TranscribeResult> {
  const language = languageHint ?? 'ru';

  // ── Priority 1: Groq Whisper ─────────────────────────────
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    console.log('[stt] Using Groq Whisper (whisper-large-v3-turbo)');
    const result = await transcribeWithGroq(audioBuffer, filename, groqKey, language);

    // If Groq fails with a transient error, try xAI as fallback
    if (result.status === 'error') {
      const xaiKey = process.env.XAI_API_KEY;
      if (xaiKey) {
        console.warn('[stt] Groq failed, falling back to xAI', { reason: result.reason });
        return transcribeWithXai(audioBuffer, filename, xaiKey, language);
      }
    }

    return result;
  }

  // ── Priority 2: xAI Grok STT ────────────────────────────
  const xaiKey = process.env.XAI_API_KEY;
  if (xaiKey) {
    console.log('[stt] Using xAI Grok STT (no prompt support — numbers may be unreliable)');
    return transcribeWithXai(audioBuffer, filename, xaiKey, language);
  }

  // ── No provider available ─────────────────────────────────
  return {
    status: 'error',
    reason: '[stt] Neither GROQ_API_KEY nor XAI_API_KEY is set. Add one to Railway environment variables.',
  };
}
