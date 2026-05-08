/**
 * @midas/ai-core — AI Output Zod Schema (SEC-01)
 *
 * Strict allowlist for Claude Haiku output validation.
 *
 * SEC-01 rules:
 *   - Schema is STRICT: unknown fields cause parsing failure, not silent strip.
 *   - AI output MUST NOT contain system fields: id, user_id, workspace_id,
 *     tenant_id, status, created_at, updated_at, draft_id, transaction_id,
 *     account_id, base_amount, exchange_rate, category_id, person_id.
 *   - System fields are injected ONLY by the backend controller after validation.
 *   - Malformed or ambiguous AI output → ParsedIntentStatus 'needs_clarification'
 *     or 'rejected'. AI CANNOT create a Transaction directly (only Draft).
 *
 * Financial precision (SEC-02, ADR-009):
 *   - All monetary amounts from AI are strings (AI outputs a human-readable number).
 *   - The backend converts to Decimal AFTER Zod validation.
 *   - AI must not output Infinity, NaN, or negative amounts for expenses.
 *
 * Phase 1.32 additions:
 *   - amount is now OPTIONAL — AI may omit it when unclear (triggers missing-amount
 *     clarification round instead of hard needs_clarification).
 *   - intent is now OPTIONAL — AI may omit it at very low confidence.
 *   - PARTIAL_CONFIDENCE_THRESHOLD (0.3): below this = nonsense, ≥ this = targeted
 *     clarification. MIN_CONFIDENCE_THRESHOLD (0.5) remains = full parse threshold.
 *   - MissingFields type: tracks which fields need clarification.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// Intent types
// ─────────────────────────────────────────────────────────────

export const ParsedIntentType = z.enum([
  'expense',
  'income',
  'debt_given',   // Я дал в долг
  'debt_received', // Мне дали в долг
  'transfer',
]);
export type ParsedIntentType = z.infer<typeof ParsedIntentType>;

// ─────────────────────────────────────────────────────────────
// Amount string validation
// Must be a valid positive decimal string — NOT a JS number.
// AI outputs: "500", "1500.50", "25.00" etc.
// ─────────────────────────────────────────────────────────────

const AmountString = z
  .string()
  .regex(
    // NUMERIC(19,4) boundary enforcement:
    //   - integer part: max 15 digits (= NUMERIC precision 19 minus scale 4)
    //   - fractional part: 0 or 1–4 digits after decimal
    //   - positive only: lookahead rejects all-zero values
    //   - no leading zeros on multi-digit integers ("0001" → rejected)
    //
    // Structure: ^(?!zero-only)(?:0 | [1-9] + up to 14 more digits)(?:. + 1-4 digits)?$
    //
    // Accepted:  "500", "1500.50", "0.50", "0.0001", "999999999999999.9999"
    // Rejected:  "0", "0.0000", "NaN", "-1", "123abc", "12.34.56", "", "1e5",
    //            " 5", "+5", "0001", "1000000000000000.0000", "9999999999999999"
    //
    // SEC-02: No parseFloat(), Number(), or float arithmetic used here.
    // DB:     Compatible with PostgreSQL NUMERIC(19,4).
    /^(?!0+(?:\.0+)?$)(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/,
    'Amount must be a positive decimal string compatible with NUMERIC(19,4): ' +
      'max 15 integer digits, max 4 decimal places, no NaN/negative/zero/leading zeros',
  );

// ─────────────────────────────────────────────────────────────
// AiOutput — the ONLY fields AI is allowed to produce
// .strict() ensures any unknown field causes a ZodError (SEC-01)
// ─────────────────────────────────────────────────────────────

export const AiOutputSchema = z
  .object({
    /** Intent classification. Phase 1.32: optional — AI may omit when very uncertain. */
    intent: ParsedIntentType.optional(),

    /**
     * Amount as string (SEC-02: not a JS number).
     * AI outputs human-readable value, backend converts to Decimal.
     * Phase 1.32: optional — AI may omit when amount is not in the message.
     */
    amount: AmountString.optional(),

    /**
     * Currency code (ISO 4217 or ticker). Optional.
     * If omitted → backend applies workspace.default_currency (SEC-10).
     */
    currency: z
      .string()
      .trim()
      .min(1)
      .max(10)
      .regex(/^[A-Z]{3,6}$/, 'Currency must be 3–6 uppercase letters')
      .optional(),

    /**
     * Item/product/merchant description extracted from user text (Phase 1.35).
     * Examples: "кофе Starbucks", "Netflix", "бензин", "Facebook Ads".
     * Stored as item_name on draft and transaction. NOT a category.
     * SEC-01: free text hint — never an ID or system field.
     * SEC-12: treated as PII — never logged.
     */
    item_hint: z.string().trim().min(1).max(200).optional(),

    /**
     * Category name hint from AI (free text, NOT a category_id — SEC-01).
     * Must be a BROAD budget group (e.g. "Кафе и рестораны"), not an item name.
     * Backend maps to actual category via resolution pipeline or fallback.
     * Max 100 chars to prevent prompt injection via category field.
     */
    category_hint: z.string().trim().min(1).max(100).optional(),

    /**
     * Person/counterparty name hint from AI (NOT a person_id — SEC-01).
     * Backend resolves via fuzzy matching (Phase 1.6+) or leaves null.
     */
    person_hint: z.string().trim().min(1).max(100).optional(),

    /**
     * Account or place name hint from AI (NOT an account_id — SEC-01).
     * Backend resolves via fuzzy/exact matching (Phase 1.31).
     * Only set when user explicitly mentions a named account, exchange, or
     * place where money is kept (e.g. «с Binance», «на карту», «из PayPal»).
     * Backend maps to actual account_sources row by name match or prompts
     * inline account creation.
     * Max 100 chars to prevent injection via account field.
     * SEC-01: this is a hint string only — never an account_id or system field.
     */
    account_hint: z.string().trim().min(1).max(100).optional(),

    /**
     * Note or description AI extracted from the message.
     * Stored in draft.note. NOT used for any financial calculation.
     * Max 500 chars.
     */
    note: z.string().trim().max(500).optional(),

    /**
     * AI confidence level. Used to decide needs_clarification threshold.
     * 0.0 = unsure, 1.0 = certain.
     */
    confidence: z.number().min(0).max(1),
  })
  .strict(); // SEC-01: unknown fields = ZodError, not silent strip

export type AiOutput = z.infer<typeof AiOutputSchema>;

// ─────────────────────────────────────────────────────────────
// Confidence thresholds (Phase 1.32)
// ─────────────────────────────────────────────────────────────

/**
 * Full confidence threshold: AI output accepted as-is.
 * Below this → targeted clarification (ask about missing/unclear fields).
 */
export const MIN_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Partial confidence threshold (Phase 1.32).
 * confidence >= PARTIAL_CONFIDENCE_THRESHOLD AND < MIN_CONFIDENCE_THRESHOLD
 *   → "partial" parse — targeted clarification for missing/unclear fields.
 * confidence < PARTIAL_CONFIDENCE_THRESHOLD
 *   → "nonsense" — show shortcut buttons, draft is abandoned.
 */
export const PARTIAL_CONFIDENCE_THRESHOLD = 0.3;

// ─────────────────────────────────────────────────────────────
// MissingFields — Phase 1.32
// ─────────────────────────────────────────────────────────────

/**
 * Identifies which fields need clarification after a partial parse.
 * Priority order for one-question-at-a-time UX: amount → intent → category.
 * Only the FIRST missing field triggers a clarification question.
 */
export type MissingField = 'amount' | 'intent' | 'category';
