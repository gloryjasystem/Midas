/**
 * @midas/ai-core
 *
 * Integration with Claude Haiku for NLP parsing.
 * Provides:
 * - parseTransaction(): Claude API call + Zod validation (SEC-01)
 * - AiOutputSchema / AiOutput: strict Zod allowlist
 * - ParseResult: discriminated union for parse outcome
 * - MIN_CONFIDENCE_THRESHOLD: full parse confidence cutoff
 * - PARTIAL_CONFIDENCE_THRESHOLD: partial parse cutoff (Phase 1.32)
 * - MissingField: which fields need clarification (Phase 1.32)
 * - Token usage tracking for budget guard (SEC-09)
 *
 * Phase 1.6-A: Full implementation.
 * Phase 1.32: Added 'partial' ParseResult, PARTIAL_CONFIDENCE_THRESHOLD, MissingField.
 */

export { parseTransaction, type ParseResult } from './claude-client.js';
export {
  AiOutputSchema,
  ParsedIntentType,
  MIN_CONFIDENCE_THRESHOLD,
  PARTIAL_CONFIDENCE_THRESHOLD,
  type AiOutput,
  type MissingField,
} from './schemas.js';
