import { readFileSync, writeFileSync } from 'fs';

const FILE = 'apps/telegram-bot/src/services/transaction-hub.service.ts';
const content = readFileSync(FILE, 'utf8');
const lines = content.split('\n');

// Find the broken section: starts at line 117 (0-indexed: 116) = "    const r = await client.query<{ cnt: string }>("
// Ends at line 131 (0-indexed: 130) = "    );"
const startIdx = lines.findIndex(l => l.includes("client.query<{ cnt: string }>"));
const endIdx = startIdx + lines.slice(startIdx).findIndex((l, i) => i > 0 && l.trim() === ');') + 1;

console.log('Start idx (1-indexed):', startIdx + 1);
console.log('End idx (1-indexed):', endIdx + 1);
console.log('Lines to replace:');
for (let i = startIdx; i <= endIdx; i++) console.log(i+1, JSON.stringify(lines[i]));

const replacement = [
  "    const r = await client.query<{ cnt: string }>(",
  "      `SELECT COUNT(*)::text AS cnt",
  "       FROM transactions",
  "       WHERE workspace_id = $1",
  "         AND deleted_at IS NULL",
  "         AND (",
  "           $2 = 'a'",
  "           OR ($2 = 'e'  AND transaction_intent = 'expense')",
  "           OR ($2 = 'i'  AND transaction_intent = 'income')",
  "           OR ($2 = 'dg' AND transaction_intent = 'debt_given')",
  "           OR ($2 = 'dr' AND transaction_intent = 'debt_received')",
  "           OR ($2 = 't'  AND transaction_intent = 'transfer')",
  "         )`,",
  "      [workspaceId, filter],",
  "    );",
];

lines.splice(startIdx, endIdx - startIdx + 1, ...replacement);
writeFileSync(FILE, lines.join('\n'), 'utf8');
console.log('✅ Fixed countFilteredTransactions SQL block.');
