/**
 * Phase 4.0-C: Manual test for isReservedCategoryName().
 *
 * Usage:
 *   cd apps/telegram-bot
 *   npx tsx test-category-names.ts
 *
 * No DB or API keys required — this is a pure function test.
 */

import { isReservedCategoryName } from './src/services/custom-category.service.js';

const TEST_CASES = [
  { input: 'Продукты',   expected: true },
  { input: 'пРоДукТы',   expected: true },
  { input: 'ПРОДУКТЫ',   expected: true },
  { input: 'Рекс',       expected: false },
  { input: 'другое',     expected: true },
  { input: 'ДРУГОЕ',     expected: true },
  { input: 'Кафе и рестораны', expected: true },
  { input: 'кафе и рестораны', expected: true },
  { input: 'Мой кот',    expected: false },
  { input: '  Продукты ', expected: true },  // trimmed
] as const;

console.log('=== Phase 4.0-C: isReservedCategoryName() Test ===\n');

let passed = 0;
let failed = 0;

for (const tc of TEST_CASES) {
  const result = isReservedCategoryName(tc.input);
  const ok = result === tc.expected;
  if (ok) { passed++; } else { failed++; }
  console.log(
    `${ok ? '✅' : '❌'} "${tc.input}" → ${String(result)} (expected ${String(tc.expected)})`,
  );
}

console.log(`\n=== Results: ${String(passed)} passed, ${String(failed)} failed ===`);

if (failed > 0) {
  process.exit(1);
}
