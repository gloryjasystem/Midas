import { readFileSync, writeFileSync } from 'fs';

const FILE = 'apps/telegram-bot/src/services/transaction-hub.service.ts';
const content = readFileSync(FILE, 'utf8');
const lines = content.split('\n');

// Line 124-126 (0-indexed: 123-125)
const target126 = `           OR ($2 = 'd' AND transaction_intent IN ('debt_given', 'debt_received'))`;
const idx = lines.findIndex(l => l.includes("OR ($2 = 'd' AND transaction_intent IN"));
console.log('Found at line (1-indexed):', idx + 1);
console.log('Content:', JSON.stringify(lines[idx]));

if (idx === -1) { console.error('NOT FOUND'); process.exit(1); }

// Replace lines 123-125 (0-indexed) = lines 124-126 (1-indexed)
lines.splice(idx - 1, 3,
  `            OR ($2 = 'e'  AND transaction_intent = 'expense')`,
  `            OR ($2 = 'i'  AND transaction_intent = 'income')`,
  `            OR ($2 = 'dg' AND transaction_intent = 'debt_given')`,
  `            OR ($2 = 'dr' AND transaction_intent = 'debt_received')`,
  `            OR ($2 = 't'  AND transaction_intent = 'transfer')`
);

writeFileSync(FILE, lines.join('\n'), 'utf8');
console.log('✅ Done.');
