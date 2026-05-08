// Test Claude directly with current prompt
// node test-claude.cjs
const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM_PROMPT = require('./packages/ai-core/dist/prompts.js').SYSTEM_PROMPT;

async function test(text) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 256,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: text }],
  });
  const raw = resp.content.find(b => b.type === 'text')?.text ?? '';
  console.log(`\nINPUT: "${text}"`);
  console.log(`OUTPUT: ${raw}`);
  console.log(`TOKENS: ${resp.usage.input_tokens}in / ${resp.usage.output_tokens}out`);
}

(async () => {
  await test('кофе 250');
  await test('потратил на офис 1000 рублей');
  await test('получил зарплату 80000');
})();
