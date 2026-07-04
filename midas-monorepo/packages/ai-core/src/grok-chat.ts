/**
 * @midas/ai-core — xAI Grok Chat Client (Phase 2S2.AI)
 *
 * Thin wrapper over xAI's OpenAI-compatible chat completions endpoint.
 * Shared by the text transaction parser (claude-client.ts → parseTransaction)
 * and the category emoji icon-picker (icon-picker.ts).
 *
 * Replaces the previous Anthropic Claude callers. Same behavioural contract:
 *   - system + user messages in, plain assistant text out
 *   - throws on network / non-OK HTTP so the worker's retry/DLQ path fires
 *   - never uses response_format JSON-mode — the system prompt already mandates
 *     "valid JSON only, no markdown" and callers strip stray fences, so we keep
 *     full parity with the old Claude path (zero xAI-compatibility risk).
 *
 * Model: grok-4.20-0309-non-reasoning (env-overridable). Non-reasoning is
 * deliberate — deterministic extraction at temperature 0, and it lets the
 * icon-picker's max_tokens=5 cap work (a reasoning model would burn those
 * tokens on hidden reasoning and return empty).
 *
 * SEC-12: request/response bodies are NEVER logged — only status code / error
 *         class. The system/user content may contain user text.
 */

const XAI_CHAT_ENDPOINT = 'https://api.x.ai/v1/chat/completions';

/**
 * Text/icon model id. Env-overridable so a future model retirement (as happened
 * to grok-3) is a Railway env change, not a code redeploy.
 */
export const GROK_TEXT_MODEL = process.env.XAI_TEXT_MODEL ?? 'grok-4.20-0309-non-reasoning';

export interface GrokChatParams {
  /** System prompt (instruction / persona). */
  system: string;
  /** User message content. */
  user: string;
  /** Hard cap on output tokens. */
  maxTokens: number;
  /** Sampling temperature (0 = deterministic). */
  temperature: number;
  /** Abort the request after this many ms. */
  timeoutMs: number;
}

export interface GrokChatResult {
  /** Raw assistant text (untrimmed). */
  text: string;
  /** prompt_tokens + completion_tokens (0 if usage absent — never NaN). */
  tokensUsed: number;
}

/**
 * Call xAI Grok chat completions with a system + user message.
 *
 * @throws Error if XAI_API_KEY is missing, the request aborts/fails, or the
 *   API returns a non-OK status. Callers that must never fail (icon-picker)
 *   wrap this in their own try/catch.
 */
export async function grokChat(params: GrokChatParams): Promise<GrokChatResult> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      '[ai-core] XAI_API_KEY is not set. Set it in .env before starting.',
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => { controller.abort(); }, params.timeoutMs);

  let response: Response;
  try {
    response = await fetch(XAI_CHAT_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROK_TEXT_MODEL,
        messages: [
          { role: 'system', content: params.system },
          { role: 'user', content: params.user },
        ],
        max_tokens: params.maxTokens,
        temperature: params.temperature,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    // SEC-12: log only error class, not request/response content
    const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
    console.error('[ai-core] Grok API call failed', { errorClass });
    throw err; // Let the caller/worker handle retry/DLQ
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const statusCode = response.status;
    console.error('[ai-core] Grok API returned non-OK status', { statusCode });
    throw new Error(`Grok API error (${String(statusCode)})`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = json.choices?.[0]?.message?.content ?? '';
  const tokensUsed =
    (json.usage?.prompt_tokens ?? 0) + (json.usage?.completion_tokens ?? 0);

  return { text, tokensUsed };
}
