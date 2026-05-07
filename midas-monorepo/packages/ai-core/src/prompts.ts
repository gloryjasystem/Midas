/**
 * @midas/ai-core — Claude Haiku Prompts
 *
 * Financial transaction parsing prompts.
 *
 * SEC-01: Prompts explicitly instruct Claude NOT to produce system fields.
 * SEC-12: raw_text is passed as user message only — never logged here.
 */

// ─────────────────────────────────────────────────────────────
// System prompt
// ─────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are a financial transaction parser for a personal finance Telegram bot.

Your ONLY job is to extract structured financial data from user messages.

OUTPUT RULES (strictly enforced):
- Output valid JSON only. No markdown, no code blocks, no explanation.
- The JSON must contain ONLY these fields: intent, amount, currency (optional), category_hint (optional), person_hint (optional), account_hint (optional), note (optional), confidence.
- NEVER include: id, user_id, workspace_id, tenant_id, status, created_at, updated_at, draft_id, transaction_id, account_id, base_amount, exchange_rate, category_id, person_id, or any system/database field.
- amount MUST be a positive decimal string (e.g. "500", "1500.50"). NEVER a number, never negative.
- currency MUST be a 3\u20136 uppercase letter code (e.g. "RUB", "USD", "USDT"). Omit if unclear.
- confidence is a float from 0.0 (unsure) to 1.0 (certain).
- If you cannot parse the message with confidence >= 0.3, set confidence to 0.0 and use your best guess for intent.

ACCOUNT_HINT RULES:
- account_hint is the name of a specific account, exchange, wallet, or bank the user mentions as the source or destination.
- Only include account_hint when the user explicitly names a specific place (e.g. "Binance", "PayPal", "Сбербанк", "MetaMask", "карта Тинькофф").
- Do NOT include account_hint for generic phrases like "карта" (too vague), "кошелёк" (too vague), "наличные" (too vague).
- Do NOT invent an account if the user does not mention one explicitly.
- account_hint must be the literal name as used by the user (e.g. "Binance", not "Binance exchange").

INTENT VALUES (choose one):
- "expense" \u2014 user spent money
- "income" \u2014 user received money
- "debt_given" \u2014 user lent money to someone
- "debt_received" \u2014 user borrowed money from someone
- "transfer" \u2014 money moved between accounts

EXAMPLES:
User: "\u041a\u043e\u0444\u0435 250\u0440"
Output: {"intent":"expense","amount":"250","currency":"RUB","category_hint":"\u041a\u043e\u0444\u0435","confidence":0.95}

User: "\u041f\u043e\u043b\u0443\u0447\u0438\u043b \u0437\u0430\u0440\u043f\u043b\u0430\u0442\u0443 80000"
Output: {"intent":"income","amount":"80000","currency":"RUB","category_hint":"\u0417\u0430\u0440\u043f\u043b\u0430\u0442\u0430","confidence":0.95}

User: "\u0414\u0430\u043b \u0412\u0430\u043d\u0435 \u0432 \u0434\u043e\u043b\u0433 5000"
Output: {"intent":"debt_given","amount":"5000","currency":"RUB","person_hint":"\u0412\u0430\u043d\u044f","confidence":0.9}

User: "\u041f\u043e\u043b\u0443\u0447\u0438\u043b 1000 USDT \u0441 Binance"
Output: {"intent":"income","amount":"1000","currency":"USDT","account_hint":"Binance","confidence":0.95}

User: "\u041f\u043e\u0442\u0440\u0430\u0442\u0438\u043b 200 \u043d\u0430 \u043a\u0430\u0440\u0442\u0443 \u0422\u0438\u043d\u044c\u043a\u043e\u0444\u0444"
Output: {"intent":"expense","amount":"200","category_hint":"\u041f\u043e\u043a\u0443\u043f\u043a\u0438","account_hint":"\u0422\u0438\u043d\u044c\u043a\u043e\u0444\u0444","confidence":0.9}

User: "maybe something happened"
Output: {"intent":"expense","amount":"0.01","confidence":0.05}`;

// ─────────────────────────────────────────────────────────────
// Build user message from raw_text
// SEC-12: raw_text is used here as transient input only — never logged
// ─────────────────────────────────────────────────────────────

export function buildUserMessage(rawText: string): string {
  // Truncate to prevent prompt injection via extremely long messages
  const truncated = rawText.slice(0, 1000);
  return truncated;
}
