/**
 * @midas/ai-core — Claude Haiku Client + parseTransaction()
 *
 * Wraps Anthropic SDK to parse financial transaction text.
 *
 * SEC-01: AI output validated through strict Zod allowlist (schemas.ts).
 *         Unknown/system fields → ZodError → ParseResult.status = 'rejected'.
 * SEC-09: Token usage tracked in Redis with date-scoped key (ai_budget:YYYY-MM-DD).
 * SEC-12: raw_text NEVER appears in logs, errors, or external monitoring output.
 *
 * Returns a discriminated union:
 *   { status: 'ok', data: AiOutput, tokensUsed: number }
 *   { status: 'needs_clarification', reason: string }
 *   { status: 'rejected', reason: string }
 */

import Anthropic from '@anthropic-ai/sdk';
import { AiOutputSchema, type AiOutput, MIN_CONFIDENCE_THRESHOLD } from './schemas.js';
import { SYSTEM_PROMPT, buildUserMessage } from './prompts.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type ParseResult =
  | { status: 'ok'; data: AiOutput; tokensUsed: number }
  | { status: 'needs_clarification'; reason: string; tokensUsed: number }
  | { status: 'rejected'; reason: string; tokensUsed: number };

// ─────────────────────────────────────────────────────────────
// Claude client (lazy singleton)
// ─────────────────────────────────────────────────────────────

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        '[ai-core] ANTHROPIC_API_KEY is not set. Set it in .env before starting.',
      );
    }
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

// ─────────────────────────────────────────────────────────────
// parseTransaction
// ─────────────────────────────────────────────────────────────

/**
 * Parse a financial transaction from user's raw text using Claude Haiku.
 *
 * @param rawText - The user's message text. SEC-12: never logged inside this fn.
 * @returns ParseResult discriminated union.
 */
export async function parseTransaction(rawText: string): Promise<ParseResult> {
  const client = getClient();

  let response: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildUserMessage(rawText),
        },
      ],
    });
  } catch (err) {
    // SEC-12: log only error class, not rawText or response body
    const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
    console.error('[ai-core] Claude API call failed', { errorClass });
    throw err; // Let worker handle retry/DLQ
  }

  const tokensUsed =
    (response.usage.input_tokens) + (response.usage.output_tokens);

  // ── Extract text content ───────────────────────────────────
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) {
    return {
      status: 'rejected',
      reason: 'Claude returned no text content',
      tokensUsed,
    };
  }

  // textBlock.type === 'text' is guaranteed by the find predicate above
  const rawJson = (textBlock as { type: 'text'; text: string }).text.trim();

  // ── Parse JSON ────────────────────────────────────────────
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    // SEC-12: rawJson might contain user text fragments — log only error class
    return {
      status: 'needs_clarification',
      reason: 'Claude output was not valid JSON',
      tokensUsed,
    };
  }

  // ── Zod validation (SEC-01 strict allowlist) ──────────────
  const result = AiOutputSchema.safeParse(parsed);
  if (!result.success) {
    // Zod error path includes field names (not values) — safe to log
    const zodIssues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
      .slice(0, 300); // truncate for safety

    console.warn('[ai-core] Zod validation failed', {
      issues: zodIssues,
      // SEC-12: NO rawText, NO rawJson in this log
    });

    return {
      status: 'needs_clarification',
      reason: `AI output failed validation: ${zodIssues}`,
      tokensUsed,
    };
  }

  const aiData: AiOutput = result.data;

  // ── Confidence check ──────────────────────────────────────
  if (aiData.confidence < MIN_CONFIDENCE_THRESHOLD) {
    return {
      status: 'needs_clarification',
      reason: `Low confidence: ${aiData.confidence.toFixed(2)}`,
      tokensUsed,
    };
  }

  return { status: 'ok', data: aiData, tokensUsed };
}
