/**
 * @midas/ai-core — Voice STT Client — Phase 2.5
 *
 * Architecture:
 *   1. xAI Grok STT → raw transcript (may have ITN artifacts)
 *   2. Grok LLM correction → restore dropped scale words (тысяч/миллион)
 *   3. Return corrected transcript to voice-parse.worker
 *
 * Root cause of "10 долларов" instead of "10000 долларов":
 *   xAI STT's Inverse Text Normalization (ITN) fires when it detects
 *   Russian currency words (долларов, гривен, рублей). ITN converts
 *   "десять тысяч" → "10" but then DROPS "тысяч" entirely.
 *   Result: "десять тысяч долларов" → "10 долларов" (scale word lost).
 *
 * Fix: after STT, call Grok LLM (fast, cheap grok-3-mini) to detect
 * and restore dropped scale words from financial context.
 *
 * SEC-12: Transcript text is NEVER logged inside this module.
 */

const XAI_STT_ENDPOINT  = 'https://api.x.ai/v1/stt';
const XAI_CHAT_ENDPOINT = 'https://api.x.ai/v1/chat/completions';
const GROQ_STT_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const REQUEST_TIMEOUT_MS = 15_000;
const LLM_TIMEOUT_MS     = 8_000;

// NOTE: xAI STT does NOT support a `prompt` field — only language+file.
// (Confirmed: adding extra FormData fields breaks xAI's number rendering.)

// ─────────────────────────────────────────────────────────────
// Groq Whisper prompt (used only when GROQ_API_KEY is set)
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
// LLM correction layer (xAI Grok chat — grok-3-mini)
// ─────────────────────────────────────────────────────────────
//
// Called AFTER xAI STT when the transcript looks like it may have
// had scale words (тысяч / миллион) dropped by ITN.
//
// Detection heuristic: digit ≤ 9999 immediately before a currency word
// with no scale word present anywhere in the transcript.
//
// SEC-12: transcript passed as user message — not logged here.
// ─────────────────────────────────────────────────────────────

const CURRENCY_WORDS_RE = /\b(рублей|рубля|гривен|гривни|гривень|долларов|доллара|евро|юаней|юаня|тенге|USD|EUR|PLN|UAH|RUB|GBP|CHF|USDT|USDC|BTC|ETH|TON|SOL|TRX|XRP|MATIC)\b/i;
const SCALE_WORDS_RE    = /\b(тысяч|тысячи|тысяча|тыс|миллион|миллиона|миллионов|млн|миллиард|млрд)\b/i;
const SMALL_DIGIT_RE    = /\b(\d{1,4})\s+(?:рублей|рубля|гривен|гривні|долларов|доллара|евро|юаней|тенге|USD|EUR|PLN|UAH|RUB|GBP|CHF|USDT|USDC|BTC|ETH|TON|SOL|TRX|XRP|MATIC)\b/i;

// Everyday cheap-item keywords: if present, the amount is almost certainly correct
// and ITN did NOT drop a scale word. Suppresses LLM correction (deterministic, zero-cost).
const SMALL_PURCHASE_RE =
  /\b(мороженое|кофе|чай|вода|обед|ужин|завтрак|еда|хлеб|фрукты|овощи|продукты|такси|метро|автобус|паркинг|кино|театр|кафе|ресторан[а-я]*|бургер|пицц[а-я]+|суши|шаурм[а-я]+|батон|молоко|сигарет|пиво|вин[оа]|стаканчик|перекус|снек|закуск[а-я]+|шоколад|конфет[а-я]+|чипсы|напит[а-я]+|роллы|ланч|фастфуд|заправк[а-я]+|аптек[а-я]+|лекарств[а-я]+|проезд)\b/i;

function looksLikeDroppedScaleWord(text: string): boolean {
  // Skip LLM correction if transcript mentions a cheap everyday item —
  // the amount is almost certainly correct (10 USD ice cream is plausible).
  if (SMALL_PURCHASE_RE.test(text)) return false;
  // Trigger correction if: small number (≤9999) + currency, no scale word present
  return (
    CURRENCY_WORDS_RE.test(text) &&
    !SCALE_WORDS_RE.test(text) &&
    SMALL_DIGIT_RE.test(text)
  );
}

async function correctWithGrokLLM(text: string, apiKey: string): Promise<string> {
  const system =
    'Ты — корректор транскрипций голосового финансового ввода.\n' +
    'Проблема: speech-to-text (STT) иногда теряет масштабное слово (тысяч/миллион) ' +
    'из-за автоматической нормализации текста (ITN).\n\n' +
    'ДОБАВЛЯЙ «тысяч» ТОЛЬКО если ОДНОВРЕМЕННО выполнены ВСЕ условия:\n' +
    '  1. Есть число ≤ 99 непосредственно перед валютой\n' +
    '  2. Нет масштабного слова (тысяч, млн и т.п.)\n' +
    '  3. Контекст — крупная финансовая операция (перевод, аренда, зарплата, крипта, долг)\n' +
    '  4. Сумма нереалистично мала для данного контекста\n\n' +
    'Примеры ИСПРАВЛЕНИЯ:\n' +
    '  «перевёл 10 долларов» → «перевёл 10 тысяч долларов»\n' +
    '  «оплатил аренду 50 USD» → «оплатил аренду 50 тысяч USD»\n' +
    '  «отправил 20 USDT на Bybit» → «отправил 20 тысяч USDT на Bybit»\n\n' +
    'Примеры КОГДА ОСТАВЛЯТЬ БЕЗ ИЗМЕНЕНИЙ:\n' +
    '  «мороженое за 10 USD» → без изменений (еда, сумма реалистична)\n' +
    '  «кофе за 5 долларов» → без изменений\n' +
    '  «такси 15 USD» → без изменений\n' +
    '  «купил воду за 2 EUR» → без изменений\n' +
    '  «пополнил баланс на 50 USD» → без изменений (50 USD — реалистичная малая сумма)\n\n' +
    'Если не уверен — ОСТАВЛЯЙ КАК ЕСТЬ. Лучше не исправить, чем исправить неверно.\n' +
    'Отвечай ТОЛЬКО итоговой фразой, без объяснений.';


  const controller = new AbortController();
  const timeout = setTimeout(() => { controller.abort(); }, LLM_TIMEOUT_MS);

  try {
    const response = await fetch(XAI_CHAT_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'grok-3-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: text },
        ],
        max_tokens: 100,
        temperature: 0,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) return text; // on error — return original

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const corrected = json.choices?.[0]?.message?.content?.trim();
    if (!corrected || corrected.length === 0) return text;
    if (corrected.length > text.length * 3) return text; // sanity: reject bloated output

    return corrected;
  } catch {
    clearTimeout(timeout);
    return text; // on any failure — return original, don't block pipeline
  }
}

// ─────────────────────────────────────────────────────────────
// Provider: xAI Grok STT + optional LLM correction
// ─────────────────────────────────────────────────────────────

async function transcribeWithXai(
  audioBuffer: Buffer,
  filename: string,
  apiKey: string,
  language: string,
): Promise<TranscribeResult> {
  const formData = new FormData();

  // language first — xAI ordering requirement
  formData.append('language', language);

  // NOTE: xAI STT does NOT support `prompt`, `temperature`, or any extra
  // FormData fields. Adding unknown fields causes xAI to switch from
  // word-based rendering to digit mode — dropping scale words (тысяч etc.).
  // ONLY language + file are sent. (confirmed broken in commit 1d79738)

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

    // ── LLM correction pass ─────────────────────────────────
    // If ITN likely dropped a scale word (e.g. "10 долларов" from
    // "десять тысяч долларов"), send to Grok LLM for correction.
    // Falls back to original text on any error — never blocks pipeline.
    const corrected = looksLikeDroppedScaleWord(trimmed)
      ? await correctWithGrokLLM(trimmed, apiKey)
      : trimmed;

    return { status: 'ok', text: corrected };
  } catch (err) {
    clearTimeout(timeout);
    const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
    console.error('[xai-stt] Fetch failed', { errorClass });
    return { status: 'error', reason: `xAI STT fetch failed: ${errorClass}` };
  }
}

// ─────────────────────────────────────────────────────────────
// Provider: Groq Whisper (if GROQ_API_KEY is set)
// ─────────────────────────────────────────────────────────────

async function transcribeWithGroq(
  audioBuffer: Buffer,
  filename: string,
  apiKey: string,
  language: string,
): Promise<TranscribeResult> {
  const formData = new FormData();
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('language', language);
  formData.append('prompt', STT_FINANCE_PROMPT);
  formData.append('temperature', '0');
  formData.append('response_format', 'text');

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

    const text = await response.text();
    const trimmed = text.trim();
    if (!trimmed) return { status: 'empty' };
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
// Public API
// ─────────────────────────────────────────────────────────────

export async function transcribeVoice(
  audioBuffer: Buffer,
  filename: string,
  languageHint?: string,
): Promise<TranscribeResult> {
  const language = languageHint ?? 'ru';

  // Priority 1: Groq Whisper (if key present — natively handles scale words)
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    const result = await transcribeWithGroq(audioBuffer, filename, groqKey, language);
    if (result.status === 'error') {
      const xaiKey = process.env.XAI_API_KEY;
      if (xaiKey) {
        console.warn('[stt] Groq failed, falling back to xAI');
        return transcribeWithXai(audioBuffer, filename, xaiKey, language);
      }
    }
    return result;
  }

  // Priority 2: xAI STT + Grok LLM correction
  const xaiKey = process.env.XAI_API_KEY;
  if (xaiKey) {
    return transcribeWithXai(audioBuffer, filename, xaiKey, language);
  }

  return { status: 'error', reason: '[stt] No API key set (GROQ_API_KEY or XAI_API_KEY).' };
}
