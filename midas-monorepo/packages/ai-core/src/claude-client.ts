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
// Allowed categories — strict validation set (Phase 1.37)
// If Claude returns a category not in this set, it's replaced with 'Другое'.
// ─────────────────────────────────────────────────────────────

const ALLOWED_CATEGORIES = new Set([
  // Personal
  'Продукты', 'Кафе и рестораны', 'Транспорт', 'Жильё', 'Здоровье',
  'Одежда', 'Красота', 'Развлечения', 'Подписки', 'Связь',
  'Образование', 'Спорт', 'Путешествия', 'Подарки', 'Дети',
  'Питомцы', 'Дом', 'Другое',
  // Business
  'Зарплаты и выплаты', 'Фриланс', 'Реклама', 'Софт и сервисы',
  'Оборудование', 'Офис', 'Налоги', 'Комиссии', 'Крипто-комиссии',
  'Подрядчики', 'Продажи', 'Инвестиции',
]);

// ─────────────────────────────────────────────────────────────
// Post-processing: intent recovery + confidence boost
// Runs AFTER Claude returns — never before (no pre-processing).
// Uses word-boundary regex to avoid false positives.
// ─────────────────────────────────────────────────────────────

const EXPENSE_PATTERNS: RegExp[] = [
  /\b(потратил\w*|потрачен\w*)\b/i,
  /\b(заплатил\w*|оплатил\w*)\b/i,
  /\b(на)?купил\w*/i,
  /\b(списал\w*|списан\w*)\b/i,
  /\b(обошл\w+|вышл[оа]\s|ушл[оа]\s)/i,
  /\b(поел\w*|сходил\w*|заправил\w*|заказал\w*|арендовал\w*)\b/i,
  /\b(слил\w*|угробил\w*|накупил\w*)\b/i,
  /\bвзял\w*\s+(кофе|такси|обед|пиво|чай|воду|сок|билет)/i,
];

const EXPENSE_CATEGORY_PATTERNS: RegExp[] = [
  /\b(кофе|обед|ужин|завтрак|еда|продукты|ресторан|кафе|доставк\w*)\b/i,
  /\b(такси|метро|бензин|заправк\w*|парковк\w*|штраф\w*)\b/i,
  /\b(подписк\w*|аптек\w*|лекарств\w*|коммуналк\w*|аренд\w*)\b/i,
  /\b(одежд\w*|обувь|парикмахерск\w*|косметик\w*|фитнес\w*)\b/i,
  /\b(врач\w*|стоматолог\w*|ремонт\w*|курс\w*|подарок|цвет\w*)\b/i,
  /\b(страховк\w*|связь|интернет|развлечени\w*|кино|театр\w*|игр\w*|магазин\w*)\b/i,
];

const INCOME_PATTERNS: RegExp[] = [
  /\b(получил\w*|пришл[оиа]\w*)\b/i,
  /\b(заработал\w*)\b/i,
  /\b(начислил\w*|зачислен\w*|поступил\w*|перечислил\w*|выплатил\w*|выдали)\b/i,
  /\b(вернул\w*|возврат\w*)\b/i,
  /\b(продал\w*|продаж\w*|выручк\w*)\b/i,
  /\b(прилетел\w*|упал[оа]|капнул\w*|налетел\w*)\b/i,
];

const INCOME_CATEGORY_PATTERNS: RegExp[] = [
  /\b(зарплат\w*|получк\w*|аванс\w*|преми[яю]\w*|стипенди\w*)\b/i,
  /\b(кешбэк\w*|кэшбэк\w*|cashback|дивиденд\w*)\b/i,
  /\b(пенси[яю]\w*|пособи[еяю]\w*|гонорар\w*|фриланс\w*|подработк\w*|халтур\w*)\b/i,
];

const DEBT_GIVEN_PATTERNS: RegExp[] = [
  /\bдал\w*\s+(в\s+долг|взаймы)/i,
  /\bодолжил\w*\s+(?!у\s)/i,
];

const DEBT_RECEIVED_PATTERNS: RegExp[] = [
  /\bвзял\w*\s+(в\s+долг|взаймы)/i,
  /\bзанял\w*\s+у\s/i,
  /\bодолжил\w*\s+у\s/i,
];

const TRANSFER_PATTERNS: RegExp[] = [
  /\b(перев[её]л\w*|перекинул\w*|перебросил\w*)\b/i,
  /\b(вывел\w*|зав[её]л\w*)\b/i,
  /\bобменял\w*\b/i,
  /\bконвертнул\w*\b/i,
];

const NEGATION_WINDOW = 20; // chars before keyword to check for negation

function hasNegationBefore(text: string, matchIndex: number): boolean {
  const window = text.slice(Math.max(0, matchIndex - NEGATION_WINDOW), matchIndex).toLowerCase();
  return /\b(не|ни|без|нет)\s*$/.test(window);
}

type IntentType = 'expense' | 'income' | 'debt_given' | 'debt_received' | 'transfer';

/**
 * Post-process: attempt to recover intent from rawText when Claude is uncertain.
 * Returns detected intent + confidence boost value, or null.
 */
function postProcessIntentRecovery(
  rawText: string,
): { intent: IntentType; boost: number } | null {
  const lower = rawText.toLowerCase();

  const groups: Array<{ patterns: RegExp[]; intent: IntentType; boost: number }> = [
    // Debt patterns checked FIRST (more specific than expense/income)
    { patterns: DEBT_GIVEN_PATTERNS, intent: 'debt_given', boost: 0.25 },
    { patterns: DEBT_RECEIVED_PATTERNS, intent: 'debt_received', boost: 0.25 },
    { patterns: TRANSFER_PATTERNS, intent: 'transfer', boost: 0.25 },
    // Verb patterns (strong signal)
    { patterns: EXPENSE_PATTERNS, intent: 'expense', boost: 0.25 },
    { patterns: INCOME_PATTERNS, intent: 'income', boost: 0.25 },
    // Category patterns (weaker signal)
    { patterns: EXPENSE_CATEGORY_PATTERNS, intent: 'expense', boost: 0.15 },
    { patterns: INCOME_CATEGORY_PATTERNS, intent: 'income', boost: 0.15 },
  ];

  for (const group of groups) {
    for (const pattern of group.patterns) {
      const match = pattern.exec(lower);
      if (match && !hasNegationBefore(lower, match.index)) {
        return { intent: group.intent, boost: group.boost };
      }
    }
  }

  return null;
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
      temperature: 0, // Deterministic extraction — no randomness for classification
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
  let rawJson = (textBlock as { type: 'text'; text: string }).text.trim();

  // Strip markdown code fences if Claude wrapped output (e.g. ```json ... ```)
  // Haiku sometimes ignores "no markdown" instruction despite it being explicit.
  rawJson = rawJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

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

  // ── Category validation (Phase 1.37) ──────────────────────
  // If Claude returned a category_hint not in our allowed set,
  // replace with 'Другое' to prevent hallucinated categories.
  if (aiData.category_hint && !ALLOWED_CATEGORIES.has(aiData.category_hint)) {
    aiData.category_hint = 'Другое';
  }

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

  // ── Post-processing: intent recovery + confidence boost ───
  // Runs AFTER Claude — fills missing intent or boosts low confidence
  // when strong keyword evidence exists in the original text.
  if (isLowConfidence || hasMissingFields) {
    const recovery = postProcessIntentRecovery(rawText);
    if (recovery) {
      // Fill missing intent if Claude omitted it
      if (!aiData.intent) {
        aiData.intent = recovery.intent;
        // NOTE: re-evaluation of missingFields happens below via computeMissingFields(aiData)
      }
      // Boost confidence if keyword agrees with Claude's intent
      if (aiData.intent === recovery.intent) {
        aiData.confidence = Math.min(1.0, aiData.confidence + recovery.boost);
      }
    }
  }

  // Re-evaluate after post-processing
  const stillLowConfidence = aiData.confidence < MIN_CONFIDENCE_THRESHOLD;
  const stillMissingFields = computeMissingFields(aiData).length > 0;

  if (stillLowConfidence || stillMissingFields) {
    return {
      status: 'partial',
      data: aiData,
      missingFields: computeMissingFields(aiData),
      tokensUsed,
    };
  }

  // ── Full success ──────────────────────────────────────────
  return { status: 'ok', data: aiData, tokensUsed };
}
