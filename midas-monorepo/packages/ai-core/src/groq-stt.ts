/**
 * @midas/ai-core — xAI Grok STT Client — Phase 2.1
 *
 * Transcribes audio buffers (OGG/OPUS from Telegram) to text
 * using xAI's Grok Speech-to-Text API.
 *
 * Endpoint: POST https://api.x.ai/v1/stt (Batch/REST)
 * Pricing:  $0.10/hour of audio (~$0.0002 per 8-second voice message)
 * Formats:  12 audio formats supported including OGG (Telegram native)
 * Languages: 25+ including RU/UK/EN
 *
 * SEC-12: Transcript text is NEVER logged inside this module.
 * SEC-03: No workspace/user context — pure audio → text conversion.
 *
 * Returns a discriminated union:
 *   { status: 'ok'; text: string }       — transcription succeeded
 *   { status: 'empty' }                  — audio had no speech (silence/noise)
 *   { status: 'error'; reason: string }  — API error (rate limit, outage)
 */

const XAI_STT_ENDPOINT = 'https://api.x.ai/v1/stt';
const REQUEST_TIMEOUT_MS = 15_000;

// ─────────────────────────────────────────────────────────────
// STT Context Prompt — Whisper-compatible "initial_prompt"
// ─────────────────────────────────────────────────────────────
//
// CRITICAL: Whisper/Grok `prompt` is NOT an instruction field.
// It acts as a "previous transcription context" — the model treats
// it as text that came BEFORE the current audio and uses it to:
//   1. Bias vocabulary (words in prompt are much more likely to appear)
//   2. Set formatting conventions (punctuation, capitalization)
//   3. Prime number/scale recognition
//
// Therefore we provide EXAMPLE SENTENCES that look like real
// transcriptions a user would say, containing all critical vocabulary:
//   - scale words: тысяч, тысячи, тысяча, миллион
//   - transfer verbs: перевёл, скинул, отправил
//   - currency names: долларов, гривен, рублей
//   - number words: десять, двадцать, пятьдесят, сто, двести, пятьсот
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
// transcribeVoice
// ─────────────────────────────────────────────────────────────

/**
 * Transcribe an OGG/OPUS audio buffer to text using xAI Grok STT.
 *
 * IMPORTANT: xAI requires the `file` field to be the LAST field
 * in the multipart form data. Other params (language) must be appended first.
 *
 * @param audioBuffer  - Raw audio bytes downloaded from Telegram
 * @param filename     - Filename with extension (e.g. "voice.ogg")
 * @param languageHint - Optional ISO-639-1 language hint (e.g. "ru")
 * @returns TranscribeResult discriminated union.
 *
 * SEC-12: Transcribed text is returned to caller — NEVER logged here.
 */
export async function transcribeVoice(
  audioBuffer: Buffer,
  filename: string,
  languageHint?: string,
): Promise<TranscribeResult> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return {
      status: 'error',
      reason: '[xai-stt] XAI_API_KEY is not set. Add it to Railway environment variables.',
    };
  }

  // ── Build multipart/form-data ──────────────────────────────
  // xAI REQUIREMENT: `file` field MUST be the last field in the form.
  const formData = new FormData();

  // Language — always 'ru' for Russian financial speech.
  // Hardcoding prevents Grok from auto-detecting Ukrainian or English
  // fragments and switching language models mid-sentence.
  formData.append('language', languageHint ?? 'ru');

  // Context prompt — biases vocabulary toward financial speech
  // (see STT_FINANCE_PROMPT block above for rationale).
  formData.append('prompt', STT_FINANCE_PROMPT);

  // Temperature = 0 → deterministic decoding.
  // Eliminates random hallucinations where "тысяч" is dropped.
  formData.append('temperature', '0');

  // Append file LAST — xAI strict ordering requirement
  const ab = audioBuffer.buffer.slice(
    audioBuffer.byteOffset,
    audioBuffer.byteOffset + audioBuffer.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([ab], { type: 'audio/ogg' });
  formData.append('file', blob, filename);

  // ── Call xAI STT API ───────────────────────────────────────
  const controller = new AbortController();
  const timeout = setTimeout(() => { controller.abort(); }, REQUEST_TIMEOUT_MS);

  let responseJson: { text?: string; error?: string };
  try {
    const response = await fetch(XAI_STT_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      // Do NOT set Content-Type manually — FormData sets it with boundary
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      // SEC-12: Log only status code, not body
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

    responseJson = (await response.json()) as { text?: string; error?: string };
  } catch (err) {
    clearTimeout(timeout);
    const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
    console.error('[xai-stt] Fetch failed', { errorClass });
    return { status: 'error', reason: `xAI STT fetch failed: ${errorClass}` };
  }

  // ── Validate transcript ────────────────────────────────────
  const trimmed = (responseJson.text ?? '').trim();

  if (!trimmed) {
    // Empty response → audio was silence or noise below detection threshold
    return { status: 'empty' };
  }

  // Whisper-style non-speech placeholder tags (xAI uses same convention)
  const NON_SPEECH_RE = /^\[.{1,30}\]$/;
  if (NON_SPEECH_RE.test(trimmed)) {
    return { status: 'empty' };
  }

  // SEC-12: trimmed transcript NOT logged — returned to worker only
  return { status: 'ok', text: trimmed };
}
