import { parseTransaction } from './packages/ai-core/src/claude-client.js';

async function main() {
  const result = await parseTransaction("порше панамера 200000 юзд");
  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
