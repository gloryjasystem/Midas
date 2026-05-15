import { readFileSync } from 'fs';

const hub = readFileSync('apps/telegram-bot/src/services/transaction-hub.service.ts', 'utf8');
const kb  = readFileSync('apps/telegram-bot/src/services/transaction-keyboard.service.ts', 'utf8');

const checks = [
  ['hub: TX_PAGE_SIZE=5',          hub.includes('TX_PAGE_SIZE = 5')],
  ['hub: IntentFilter dg/dr/t',    hub.includes("'dg' | 'dr' | 't'")],
  ['hub: debt_given_count field',  hub.includes('debt_given_count:    number')],
  ['hub: debt_received_count field',hub.includes('debt_received_count: number')],
  ['hub: transfer_count field',    hub.includes('transfer_count:      number')],
  ['hub: SQL dg filter',           hub.includes("'dg' AND t.transaction_intent = 'debt_given'")],
  ['hub: SQL dr filter',           hub.includes("'dr' AND t.transaction_intent = 'debt_received'")],
  ['hub: SQL t filter',            hub.includes("'t'  AND t.transaction_intent = 'transfer'")],
  ['hub: count SQL dg',            hub.includes("'dg' AND transaction_intent = 'debt_given'")],
  ['hub: count SQL dr',            hub.includes("'dr' AND transaction_intent = 'debt_received'")],
  ['hub: OLD d-filter GONE',       !hub.includes("'d' AND transaction_intent IN ('debt_given'")],
  ['kb:  CCY_SYMBOL map',          kb.includes('CCY_SYMBOL')],
  ['kb:  fmtCurrency function',    kb.includes('function fmtCurrency')],
  ['kb:  intentEmoji 📤',          kb.includes("'debt_given':    return '\\uD83D\\uDCE4'") || kb.includes("debt_given':    return '📤'")],
  ['kb:  FILTER_LABELS 6 entries', kb.includes("dr: { text: '📥") || kb.includes("dr: { text: '\\uD83D\\uDCE5")],
  ['kb:  grid ROW_1 e/i/t',        kb.includes("FILTER_ROW_1: IntentFilter[] = ['e', 'i', 't']")],
  ['kb:  grid ROW_2 dr/dg/a',      kb.includes("FILTER_ROW_2: IntentFilter[] = ['dr', 'dg', 'a']")],
  ['kb:  pagination Позже',        kb.includes('Позже')],
  ['kb:  pagination Раньше',       kb.includes('Раньше')],
  ['kb:  formatTxListHeader dg',   kb.includes("filter === 'dg'")],
  ['kb:  formatTxListHeader t',    kb.includes("filter === 't'")],
  ['kb:  VALID_FILTERS dg/dr/t',   kb.includes("'dg', 'dr', 't'")],
  ['kb:  fallback d->a',           kb.includes("=== 'd') filter = 'a'")],
];

let allOk = true;
for (const [name, ok] of checks) {
  console.log(ok ? '✅' : '❌', name);
  if (!ok) allOk = false;
}
console.log('\n' + (allOk ? '🎉 ALL CHECKS PASSED' : '⚠️  SOME CHECKS FAILED'));
