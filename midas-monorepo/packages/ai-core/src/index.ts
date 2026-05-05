/**
 * @midas/ai-core
 *
 * Integration with Claude Haiku for NLP parsing.
 * Provides:
 * - parseTransaction(): Claude API call + Zod validation (SEC-01)
 * - AiOutputSchema / AiOutput: strict Zod allowlist
 * - ParseResult: discriminated union for parse outcome
 * - MIN_CONFIDENCE_THRESHOLD: confidence cutoff for needs_clarification
 * - Token usage tracking for budget guard (SEC-09)
 *
 * Phase 1.6-A: Full implementation.
 */

export { parseTransaction, type ParseResult } from './claude-client.js';
export {
  AiOutputSchema,
  ParsedIntentType,
  MIN_CONFIDENCE_THRESHOLD,
  type AiOutput,
} from './schemas.js';
