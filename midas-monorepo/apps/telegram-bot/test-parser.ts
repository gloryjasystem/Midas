import fs from 'fs';
const env = fs.readFileSync('.env', 'utf-8');
for (const line of env.split('\n')) {
  if (line.startsWith('ANTHROPIC_API_KEY=')) {
    process.env.ANTHROPIC_API_KEY = line.split('=')[1].trim();
  }
}
import { parseTransaction } from '../../packages/ai-core/src/claude-client.js';

async function main() {
  const result = await parseTransaction("порше панамера 200000 юзд");
  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
