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

  // Append language hint FIRST (before file — xAI requirement)
  if (languageHint) {
    formData.append('language', languageHint);
  }

  // ── STT Context Prompt ────────────────────────────────────
  // Biases the model towards financial/numeric speech vocabulary.
  // Critical for correctly transcribing: "10 тысяч" (not "10"), scale words,
  // transfer verbs ("перевёл", "скинул"), and currency names.
  // Equivalent to Whisper's initial_prompt parameter.
  const STT_FINANCE_PROMPT =
    'Финансовый трекер. Суммы: 10 тысяч, 500 тысяч, 2 миллиона, 50 тыс, 1.5 млн. ' +
    'Действия: перевёл, перевел, скинул, отправил, потратил, купил, получил, заработал, снял. ' +
    'Валюты: рублей, гривен, долларов, евро, юань, USDT, BTC, ETH, тенге. ' +
    'Числа словами: тысяча, тысяч, тысячи, пятьсот, двести, миллион, сотня.';
  formData.append('prompt', STT_FINANCE_PROMPT);

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
