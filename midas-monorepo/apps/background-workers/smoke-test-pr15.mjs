/**
 * Smoke test — Phase 2.4 PR 15
 * Tests AccountBalanceBlock / _numericAdd / buildAccountBalanceBlock
 * and buildPreviewScreen accountBlock rendering in background-workers.
 *
 * Run: node apps/background-workers/smoke-test-pr15.mjs
 * Requires: tsc build (dist/ must be fresh) OR runs against src via ts-node
 *
 * NOTE: We import directly from the compiled JS in dist/.
 * Build first: cd apps/background-workers && npx tsc
 */

import {
  _numericAdd,
  buildAccountBalanceBlock,
  buildPreviewScreen,
} from './dist/utils/screen-builder.js';

// ─── Helpers ────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`📋 ${title}`);
  console.log('─'.repeat(60));
}

// ─── TEST 1: _numericAdd ─────────────────────────────────────────────────────
section('PR15-1 — _numericAdd (BigInt arithmetic, SEC-02)');

check('1000 + 500 = 1500',           _numericAdd('1000', '500', false) === '1500');
check('1000 - 500 = 500',            _numericAdd('1000', '500', true)  === '500');
check('1000 - 1500 = -500',          _numericAdd('1000', '1500', true) === '-500');
check('100.5 + 0.5 = 101',           _numericAdd('100.5', '0.5', false) === '101');
check('15400.0000 - 500 = 14900',    _numericAdd('15400.0000', '500', true) === '14900');
check('0 + 0 = 0',                   _numericAdd('0', '0', false) === '0');
check('0.0001 + 0.0001 = 0.0002',    _numericAdd('0.0001', '0.0001', false) === '0.0002');
check('trailing zeros stripped: 100.0000 - 0 = 100', _numericAdd('100.0000', '0', true) === '100');

// ─── TEST 2: buildAccountBalanceBlock ───────────────────────────────────────
section('PR15-2 — buildAccountBalanceBlock rendering');

const expenseBlock = buildAccountBalanceBlock({
  accountName:     'Bybit',
  accountCurrency: 'USDT',
  currentBalance:  '15400',
  debitAmount:     '500',
  debitCurrency:   'USDT',
  intent:          'expense',
});

const incomeBlock = buildAccountBalanceBlock({
  accountName:     'Bybit',
  accountCurrency: 'USDT',
  currentBalance:  '15400',
  debitAmount:     '500',
  debitCurrency:   'USDT',
  intent:          'income',
});

check('expense: contains 🏦 <b>Bybit</b>',       expenseBlock.includes('<b>Bybit</b>'));
check('expense: contains · USDT',                expenseBlock.includes('· USDT'));
check('expense: contains 💳',                    expenseBlock.includes('💳'));
check('expense: subtract sign −',               expenseBlock.includes('−'));
check('expense: balanceAfter = 14900',           expenseBlock.includes('14900'));
check('income: add sign +',                      incomeBlock.includes('+'));
check('income: balanceAfter = 15900',            incomeBlock.includes('15900'));

// debt_given (same as expense)
const debtGivenBlock = buildAccountBalanceBlock({
  accountName: 'Тинькофф', accountCurrency: 'RUB',
  currentBalance: '10000', debitAmount: '2000', debitCurrency: 'RUB',
  intent: 'debt_given',
});
check('debt_given: subtract sign',               debtGivenBlock.includes('−'));
check('debt_given: balanceAfter = 8000',         debtGivenBlock.includes('8000'));

// debt_received (same as income)
const debtRecvBlock = buildAccountBalanceBlock({
  accountName: 'Тинькофф', accountCurrency: 'RUB',
  currentBalance: '10000', debitAmount: '2000', debitCurrency: 'RUB',
  intent: 'debt_received',
});
check('debt_received: add sign',                 debtRecvBlock.includes('+'));
check('debt_received: balanceAfter = 12000',     debtRecvBlock.includes('12000'));

// ─── TEST 3: buildPreviewScreen with accountBlock ────────────────────────────
section('PR15-3 — buildPreviewScreen with accountBlock');

const previewWithBlock = buildPreviewScreen({
  intent:      'expense',
  amount:      '100',
  currency:    'USDT',
  categoryHint: 'Кафе',
  accountHint:  null,
  itemName:    'кофе',
  accountBlock: {
    accountName:     'Bybit',
    accountCurrency: 'USDT',
    currentBalance:  '15400',
    debitAmount:     '100',
    debitCurrency:   'USDT',
    intent:          'expense',
  },
});

check('preview with accountBlock: contains 🏦 <b>Bybit</b>', previewWithBlock.includes('<b>Bybit</b>'));
check('preview with accountBlock: shows balance math',        previewWithBlock.includes('15300'));
check('preview with accountBlock: contains category 📁',     previewWithBlock.includes('📁'));
check('preview with accountBlock: NO raw 🏦 accountHint',    !previewWithBlock.includes('🏦 null'));
check('preview with accountBlock: Всё верно?',               previewWithBlock.includes('Всё верно?'));

// Without accountBlock — backward compat
const previewNoBlock = buildPreviewScreen({
  intent:      'income',
  amount:      '5000',
  currency:    'RUB',
  categoryHint: null,
  accountHint:  'Тинькофф',
  itemName:    null,
  accountBlock: null,
});

check('preview no accountBlock: shows 🏦 accountHint', previewNoBlock.includes('🏦'));
check('preview no accountBlock: shows Тинькофф',       previewNoBlock.includes('Тинькофф'));
check('preview no accountBlock: no balance math',       !previewNoBlock.includes('💳'));

// ─── Итог ────────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log(`📊 Результат: ${passed} ✅ прошло / ${failed} ❌ провалено`);

if (failed === 0) {
  console.log('🎉 ВСЕ ТЕСТЫ ПРОШЛИ — PR 15 зелёный');
  process.exit(0);
} else {
  console.log('⚠️  Есть провалы — нужна доработка');
  process.exit(1);
}
