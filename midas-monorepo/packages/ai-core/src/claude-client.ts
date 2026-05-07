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
 *     → Full parse success. All required fields present and confidence >= 0.5.
 *
 *   { status: 'partial', data: AiOutput, missingFields: MissingField[], tokensUsed: number }
 *     → Partial parse success (confidence 0.3–0.49 OR amount/intent missing).
 *     → missingFields lists which fields need clarification (priority: amount > intent > category).
 *     → data contains what the AI DID return (intent, currency, category_hint, etc.).
 *
 *   { status: 'needs_clarification', reason: string, tokensUsed: number }
 *     → Low confidence (< 0.3) OR Zod validation failure OR JSON parse failure.
 *     → No usable data — show nonsense shortcuts.
 *
 *   { status: 'rejected', reason: string, tokensUsed: number }
 *     → Claude returned no text content. Should not happen in normal operation.
 *
 * Phase 1.32: Added 'partial' status for targeted clarification.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  AiOutputSchema,
  type AiOutput,
  type MissingField,
  MIN_CONFIDENCE_THRESHOLD,
  PARTIAL_CONFIDENCE_THRESHOLD,
} from './schemas.js';
import { SYSTEM_PROMPT, buildUserMessage } from './prompts.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type ParseResult =
  | { status: 'ok'; data: AiOutput; tokensUsed: number }
  | { status: 'partial'; data: AiOutput; missingFields: MissingField[]; tokensUsed: number }
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
// computeMissingFields — Phase 1.32
// ─────────────────────────────────────────────────────────────

/**
 * Given a validated AiOutput, determine which fields are missing.
 * Priority order (one-question-at-a-time): amount → intent → category.
 *
 * SEC-01: only looks at data fields — never produces system field names.
 */
function computeMissingFields(data: AiOutput): MissingField[] {
  const missing: MissingField[] = [];
  if (!data.amount) missing.push('amount');
  if (!data.intent) missing.push('intent');
  // category is not in AiOutput directly — category_hint is the hint.
  // Missing category means category_hint is absent AND intent is not 'transfer'.
  // We only flag category as missing when it's an expense/income/debt and no hint.
  if (
    !data.category_hint &&
    data.intent &&
    data.intent !== 'transfer'
  ) {
    missing.push('category');
  }
  return missing;
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
  // Below PARTIAL_CONFIDENCE_THRESHOLD (0.3) → nonsense → needs_clarification (no data)
  if (aiData.confidence < PARTIAL_CONFIDENCE_THRESHOLD) {
    return {
      status: 'needs_clarification',
      reason: `Very low confidence: ${aiData.confidence.toFixed(2)}`,
      tokensUsed,
    };
  }

  // ── Check for missing required fields ─────────────────────
  // If confidence is high enough (>= 0.5) but a field is missing, it's still partial.
  // If confidence is 0.3–0.49, always treat as partial regardless of fields.
  const missingFields = computeMissingFields(aiData);

  const isLowConfidence = aiData.confidence < MIN_CONFIDENCE_THRESHOLD;
  const hasMissingFields = missingFields.length > 0;

  if (isLowConfidence || hasMissingFields) {
    // Partial parse: some data is present but clarification is needed.
    return {
      status: 'partial',
      data: aiData,
      missingFields,
      tokensUsed,
    };
  }

  // ── Full success ──────────────────────────────────────────
  return { status: 'ok', data: aiData, tokensUsed };
}
