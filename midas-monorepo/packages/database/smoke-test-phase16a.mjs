/**
 * Phase 1.6-A Smoke Test Suite
 *
 * Tests (no real ANTHROPIC_API_KEY required):
 *   1. SEC-01: Zod allowlist — valid AI output parses correctly
 *   2. SEC-01: System field injection rejected (workspace_id, user_id, status, id, draft_id, transaction_id)
 *   3. SEC-01: Malformed JSON → needs_clarification
 *   4. SEC-01: Low confidence → needs_clarification
 *   5. SEC-02: Invalid amounts rejected without parseFloat (NaN, -1, 0, "123abc", "12.34.56", empty)
 *   5b. SEC-02: NUMERIC(19,4) boundary: >15 integer digits rejected
 *   6. SEC-02: Valid amounts accepted including NUMERIC(19,4) max
 *   7. SEC-12: removeOnFail age configured on ai-parse queue
 *   8. Draft service: createDraft uses withTenantTransaction (code-level verification)
 *
 * Mocked Claude: we validate AiOutputSchema directly — no real API call needed.
 *
 * Run from midas-monorepo root:
 *   node packages/database/smoke-test-phase16a.mjs
 */

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ─── Load built ai-core dist ──────────────────────────────────────────────────
// We test the compiled output to ensure build pipeline is also correct.
const aiCoreDist = path.resolve(__dirname, '../../packages/ai-core/dist/index.js');
const { AiOutputSchema } = await import(pathToFileURL(aiCoreDist).href);

// ─── Load queue-definitions to check removeOnFail config ──────────────────────
// We read the source file directly (avoid running the module which needs Redis).
const queueDefsPath = path.resolve(
  __dirname,
  '../../apps/background-workers/src/queues/queue-definitions.ts',
);
const queueDefsSource = readFileSync(queueDefsPath, 'utf8');

// ─── Helpers ─────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. SEC-01: Valid AI output — all allowed fields present
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── SEC-01: Valid AI output ──────────────────────────────────');

const validOutput = {
  intent: 'expense',
  amount: '500',
  currency: 'RUB',
  category_hint: 'Кофе',
  confidence: 0.95,
};
const validResult = AiOutputSchema.safeParse(validOutput);
assert('Valid expense output parses OK', validResult.success);
assert(
  'Valid: intent = expense',
  validResult.success && validResult.data.intent === 'expense',
);
assert(
  'Valid: amount = "500"',
  validResult.success && validResult.data.amount === '500',
);

const validIncome = { intent: 'income', amount: '80000.50', currency: 'RUB', confidence: 0.9 };
assert('Valid income with decimal amount', AiOutputSchema.safeParse(validIncome).success);

const validMinimal = { intent: 'transfer', amount: '0.01', confidence: 0.7 };
assert('Valid minimal output (no optional fields)', AiOutputSchema.safeParse(validMinimal).success);

// ─────────────────────────────────────────────────────────────────────────────
// 2. SEC-01: System field injection must be REJECTED (schema is .strict())
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── SEC-01: System field injection tests ─────────────────────');

const systemFields = [
  'workspace_id',
  'user_id',
  'status',
  'id',
  'draft_id',
  'transaction_id',
  'account_id',
  'base_amount',
  'exchange_rate',
  'category_id',
  'person_id',
  'tenant_id',
  'created_at',
  'updated_at',
];

for (const field of systemFields) {
  const injected = {
    intent: 'expense',
    amount: '100',
    confidence: 0.9,
    [field]: 'evil-injected-value',
  };
  const result = AiOutputSchema.safeParse(injected);
  assert(
    `System field "${field}" causes validation failure`,
    !result.success,
    result.success ? `SECURITY: field "${field}" was accepted!` : '',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. SEC-01: Malformed JSON simulation (post-parse Zod tests)
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── SEC-01: Malformed/ambiguous AI output ────────────────────');

assert('null input rejected', !AiOutputSchema.safeParse(null).success);
assert('empty object rejected', !AiOutputSchema.safeParse({}).success);
assert('array input rejected', !AiOutputSchema.safeParse([]).success);
assert('string input rejected', !AiOutputSchema.safeParse('expense 500').success);
assert(
  'Missing intent rejected',
  !AiOutputSchema.safeParse({ amount: '100', confidence: 0.9 }).success,
);
assert(
  'Missing confidence rejected',
  !AiOutputSchema.safeParse({ intent: 'expense', amount: '100' }).success,
);
assert(
  'Invalid intent value rejected',
  !AiOutputSchema.safeParse({ intent: 'buy', amount: '100', confidence: 0.9 }).success,
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. SEC-01: Low confidence
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── SEC-01: Confidence validation ────────────────────────────');

assert(
  'confidence = 0.0 is valid Zod (needs_clarification handled by worker)',
  AiOutputSchema.safeParse({ intent: 'expense', amount: '100', confidence: 0.0 }).success,
);
assert(
  'confidence > 1.0 rejected',
  !AiOutputSchema.safeParse({ intent: 'expense', amount: '100', confidence: 1.1 }).success,
);
assert(
  'confidence < 0 rejected',
  !AiOutputSchema.safeParse({ intent: 'expense', amount: '100', confidence: -0.1 }).success,
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. SEC-02: Invalid amounts — no parseFloat used
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── SEC-02: Amount validation (no parseFloat) ────────────────');

const invalidAmounts = [
  ['NaN', 'NaN'],
  ['-1', 'negative'],
  ['0', 'zero'],
  ['0.0000', 'zero decimal'],
  ['123abc', 'alphanumeric'],
  ['12.34.56', 'double dot'],
  ['', 'empty string'],
  ['1e5', 'scientific notation'],
  [' 500', 'leading space'],
  ['500 ', 'trailing space'],
  ['1.23456', 'too many decimal places (5)'],
  ['-0.5', 'negative decimal'],
  ['+5', 'unary plus'],
  ['Infinity', 'Infinity'],
  ['1,500', 'comma separator'],
  // ── NUMERIC(19,4) boundary tests ──────────────────────
  ['1000000000000000.0000', 'NUMERIC overflow: 16 integer digits'],
  ['9999999999999999', 'NUMERIC overflow: 16 integer digits no decimal'],
  ['9999999999999999999', 'NUMERIC overflow: 19 integer digits'],
  ['0001', 'leading zeros on integer'],
];

for (const [amount, label] of invalidAmounts) {
  const result = AiOutputSchema.safeParse({ intent: 'expense', amount, confidence: 0.9 });
  assert(`Amount "${label}" (${JSON.stringify(amount)}) rejected`, !result.success);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. SEC-02: Valid amounts accepted
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── SEC-02: Valid amounts ────────────────────────────────────');

const validAmounts = [
  ['500', 'integer'],
  ['1500.50', 'two decimals'],
  ['0.50', 'less than one'],
  ['25.0001', 'four decimals'],
  ['1', 'one'],
  ['999999', 'large integer'],
  ['0.0001', 'min fraction'],
  // ── NUMERIC(19,4) boundary tests ──────────────────────
  ['999999999999999.9999', 'NUMERIC(19,4) max valid (15 int + 4 dec)'],
  ['999999999999999', 'NUMERIC max 15 integer digits no decimal'],
];

for (const [amount, label] of validAmounts) {
  const result = AiOutputSchema.safeParse({ intent: 'expense', amount, confidence: 0.9 });
  assert(`Amount "${label}" (${JSON.stringify(amount)}) accepted`, result.success);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. SEC-12: removeOnFail age check on ai-parse queue source
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── SEC-12: Queue removeOnFail config ────────────────────────');

assert(
  'ai-parse queue has removeOnFail with age (SEC-12)',
  queueDefsSource.includes('removeOnFail') &&
    queueDefsSource.includes('age') &&
    queueDefsSource.includes('86_400'),
);
assert(
  'ai-parse queue does NOT have removeOnFail: false (other queues may)',
  (() => {
    // Extract only the ai-parse queue section
    // ai-parse is between '// ai-parse Queue' and the next queue comment
    const startIdx = queueDefsSource.indexOf('// ai-parse Queue');
    const endMarkers = [
      queueDefsSource.indexOf('// notifications Queue'),
      queueDefsSource.indexOf('// callback-confirm Queue'),
      queueDefsSource.indexOf('// Callback-confirm Queue'),
    ].filter((i) => i > startIdx && i !== -1);
    const endIdx = endMarkers.length > 0 ? Math.min(...endMarkers) : queueDefsSource.length;
    const aiParseSection = queueDefsSource.slice(startIdx, endIdx);
    return !aiParseSection.includes('removeOnFail: false');
  })(),
);

// ─────────────────────────────────────────────────────────────────────────────
// 8. SEC-12: raw_text logging audit — ai-parse worker source
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── SEC-12: raw_text logging audit ───────────────────────────');

const workerPath = path.resolve(
  __dirname,
  '../../apps/background-workers/src/workers/ai-parse.worker.ts',
);
const workerSource = readFileSync(workerPath, 'utf8');

// Check raw_text is NOT used as a value in any non-comment console call.
// We look for console.log/warn/error lines where raw_text appears as a variable
// reference (e.g. "raw_text: someVar" or "raw_text,") — NOT in comments or string literals.
const consoleLines = workerSource
  .split('\n')
  .filter((line) => /console\.(log|warn|error)/.test(line) && !line.trim().startsWith('//'))
  .join('\n');

// Check for raw_text as a variable/property reference (not inside a string or comment)
// Patterns that would indicate a leak: raw_text: job.data.raw_text, or similar
const rawTextAsValue = /raw_text:\s*(?!')[^'[\n]/.test(consoleLines);
assert('raw_text not exposed as a value in any console call in ai-parse worker', !rawTextAsValue);

// Check updateData is called for sanitization
assert(
  'job.updateData() called for SEC-12 sanitization on final fail',
  workerSource.includes('updateData') && workerSource.includes('[REDACTED]'),
);

// Check comment explicitly excludes raw_text from logs
assert(
  'Worker has SEC-12 exclusion comment',
  workerSource.includes('SEC-12') && workerSource.includes('deliberately excluded'),
);

// ─────────────────────────────────────────────────────────────────────────────
// 9. SEC-03: draft.service.ts uses withTenantTransaction
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── SEC-03: Draft creation audit ─────────────────────────────');

const draftServicePath = path.resolve(
  __dirname,
  '../../apps/background-workers/src/services/draft.service.ts',
);
const draftServiceSource = readFileSync(draftServicePath, 'utf8');

assert(
  'draft.service uses withTenantTransaction',
  draftServiceSource.includes('withTenantTransaction'),
);
assert(
  'draft.service passes workspaceId AND userId to withTenantTransaction',
  draftServiceSource.includes('withTenantTransaction(workspaceId, userId,'),
);
assert(
  'draft.service uses ULID for draftId (ADR-004)',
  draftServiceSource.includes('ulid()'),
);
assert(
  'draft.service does NOT use AI-provided id fields',
  !draftServiceSource.includes('aiData.id') &&
    !draftServiceSource.includes('aiData.workspace_id') &&
    !draftServiceSource.includes('aiData.user_id') &&
    !draftServiceSource.includes('aiData.draft_id'),
);
assert(
  'draft.service sets status = pending_user or needs_clarification (never from AI)',
  draftServiceSource.includes("'pending_user'") &&
    draftServiceSource.includes("'needs_clarification'"),
);
assert(
  'No final Transaction INSERT in draft.service',
  !draftServiceSource.toLowerCase().includes('insert into transactions'),
);

// ─────────────────────────────────────────────────────────────────────────────
// 10. SEC-01: userId resolved from DB, not AI output
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── SEC-01: userId/workspaceId source audit ──────────────────');

assert(
  'Worker resolves userId via resolveUserId() from DB (not AI output)',
  workerSource.includes('resolveUserId(telegramUserId)'),
);
assert(
  'Worker: workspaceId comes from job.data (trusted ingestion path), not AI output',
  workerSource.includes('job.data') && workerSource.includes('workspaceId'),
);
assert(
  'No final Transaction creation in worker',
  !workerSource.toLowerCase().includes('insert into transactions'),
);

// ─────────────────────────────────────────────────────────────────────────────
// 11. Scope Guard
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── Scope Guard: Phase 1.6-B features absent ─────────────────');

// Phase 1.6-B scope guards removed — Phase 1.6-B has been implemented.
// inline_keyboard, callback_query, and draft approval are now present in ai-parse.worker.ts.
// These guards were Phase 1.6-A-specific checks to prevent premature implementation.
assert(
  'No CRON references in Phase 1.6-A files',
  !draftServiceSource.includes('cron') && !workerSource.includes('cron'),
);
assert(
  'draft.service (Phase 1.6-A) does not INSERT into transactions directly',
  !draftServiceSource.toLowerCase().includes("insert into transactions"),
);

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n════════════════════════════════════════════════════════════');
console.log(`Phase 1.6-A Smoke Test: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('✅ ALL TESTS PASSED — Phase 1.6-A verification: PASS');
} else {
  console.error(`❌ ${String(failed)} TESTS FAILED — Phase 1.6-A verification: FAIL`);
  process.exit(1);
}
