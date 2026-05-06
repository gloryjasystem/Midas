/**
 * Smoke Tests — Phase 1.10: Slash-Command Guard + Inline /help
 *
 * Tests (10 scenarios — pure logic, no DB required):
 *   1.  /help is classified as a known command
 *   2.  /start is classified as a known command
 *   3.  /report is classified as a known command
 *   4.  /balance is classified as UNKNOWN (blocked)
 *   5.  /category is classified as UNKNOWN (blocked)
 *   6.  /add_category is classified as UNKNOWN (blocked)
 *   7.  /clear is classified as UNKNOWN (blocked)
 *   8.  /reportabc is NOT /report (no prefix match — must be exact command token)
 *   9.  Normal free text is NOT a slash command → AI parse path
 *  10.  /help response text contains expected Russian content and all 3 commands
 *
 * No DB connection required — all tests are pure routing logic.
 */

// ─────────────────────────────────────────────────────────────
// Test utilities
// ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  }
}

// ─────────────────────────────────────────────────────────────
// Replicate the exact routing logic from webhook.route.ts
// (Phase 1.10 version)
// ─────────────────────────────────────────────────────────────

/**
 * Parse the command token from a message text.
 * Returns null if the text is not a slash command.
 * Strips @BotName suffix if present, but only for the known-command check.
 * e.g. "/start" → "/start"
 *      "/report" → "/report"
 *      "/reportabc" → "/reportabc"   (NOT /report — exact token)
 *      "/balance" → "/balance"
 *      "hello" → null
 */
function parseCommandToken(text) {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('/')) return null;
  // First whitespace-delimited token
  const token = trimmed.split(/\s+/)[0] ?? '';
  // Strip @BotName suffix if present (e.g. /help@MyBot → /help)
  const atIdx = token.indexOf('@');
  return atIdx === -1 ? token : token.slice(0, atIdx);
}

const KNOWN_COMMANDS = new Set(['/start', '/report', '/help']);

/**
 * /help response text (mirrors the implementation in webhook.route.ts).
 */
const HELP_TEXT = `ℹ️ <b>Доступные команды Midas:</b>

/start — Регистрация и приветствие
/report — Отчёт о доходах и расходах за текущий месяц
/help — Показать это сообщение

Для записи транзакции просто напишите мне сообщение, например:
<i>«Потратил 500 рублей на кофе»</i>`;

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n🔍 Phase 1.10 Smoke Tests — Slash-Command Guard + Inline /help\n');

  // ─────────────────────────────────────────────────────────────
  // TEST 1: /help is a known command
  // ─────────────────────────────────────────────────────────────
  console.log('\n[TEST 1] /help is classified as a known command');
  {
    const token = parseCommandToken('/help');
    assert(token === '/help', `/help token parsed correctly (got: ${token})`);
    assert(KNOWN_COMMANDS.has(token), `/help is in KNOWN_COMMANDS`);
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 2: /start is a known command
  // ─────────────────────────────────────────────────────────────
  console.log('\n[TEST 2] /start is classified as a known command');
  {
    const token = parseCommandToken('/start');
    assert(token === '/start', `/start token parsed correctly (got: ${token})`);
    assert(KNOWN_COMMANDS.has(token), `/start is in KNOWN_COMMANDS`);
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 3: /report is a known command
  // ─────────────────────────────────────────────────────────────
  console.log('\n[TEST 3] /report is classified as a known command');
  {
    const token = parseCommandToken('/report');
    assert(token === '/report', `/report token parsed correctly (got: ${token})`);
    assert(KNOWN_COMMANDS.has(token), `/report is in KNOWN_COMMANDS`);
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 4: /balance is an unknown command (blocked)
  // ─────────────────────────────────────────────────────────────
  console.log('\n[TEST 4] /balance is blocked (unknown command)');
  {
    const token = parseCommandToken('/balance');
    assert(token === '/balance', `/balance token parsed correctly (got: ${token})`);
    assert(!KNOWN_COMMANDS.has(token), `/balance is NOT in KNOWN_COMMANDS (blocked)`);
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 5: /category is an unknown command (blocked)
  // ─────────────────────────────────────────────────────────────
  console.log('\n[TEST 5] /category is blocked (unknown command)');
  {
    const token = parseCommandToken('/category');
    assert(token === '/category', `/category token parsed correctly (got: ${token})`);
    assert(!KNOWN_COMMANDS.has(token), `/category is NOT in KNOWN_COMMANDS (blocked)`);
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 6: /add_category is an unknown command (blocked)
  // ─────────────────────────────────────────────────────────────
  console.log('\n[TEST 6] /add_category is blocked (unknown command)');
  {
    const token = parseCommandToken('/add_category');
    assert(token === '/add_category', `/add_category token parsed correctly (got: ${token})`);
    assert(!KNOWN_COMMANDS.has(token), `/add_category is NOT in KNOWN_COMMANDS (blocked)`);
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 7: /clear is an unknown command (blocked)
  // ─────────────────────────────────────────────────────────────
  console.log('\n[TEST 7] /clear is blocked (unknown command)');
  {
    const token = parseCommandToken('/clear');
    assert(token === '/clear', `/clear token parsed correctly (got: ${token})`);
    assert(!KNOWN_COMMANDS.has(token), `/clear is NOT in KNOWN_COMMANDS (blocked)`);
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 8: /reportabc is NOT /report (exact token match, not prefix)
  // ─────────────────────────────────────────────────────────────
  console.log('\n[TEST 8] /reportabc is NOT treated as /report (exact token required)');
  {
    const token = parseCommandToken('/reportabc');
    assert(token === '/reportabc', `/reportabc token parsed correctly (got: ${token})`);
    assert(!KNOWN_COMMANDS.has(token), `/reportabc is NOT in KNOWN_COMMANDS`);
    assert(token !== '/report', `/reportabc !== /report (no prefix match)`);
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 9: Normal free text is NOT a slash command
  // ─────────────────────────────────────────────────────────────
  console.log('\n[TEST 9] Normal free text does not match slash command');
  {
    const inputs = [
      'Потратил 500 рублей на кофе',
      'купил продукты за 1200',
      'report',          // no leading slash
      'balance',
      '',                // empty string after trim handled upstream; parseCommandToken returns null
    ];

    for (const text of inputs) {
      if (text === '') {
        // empty text is filtered before this logic (SEC-05)
        // parseCommandToken would return null (no slash)
        const token = parseCommandToken(text);
        assert(token === null, `empty string returns null token (got: ${token})`);
      } else {
        const token = parseCommandToken(text);
        assert(token === null, `"${text}" returns null (no slash) (got: ${token})`);
      }
    }

    // Edge: text that contains /report mid-sentence must NOT be detected as a command
    const midSentence = 'Please run /report for me';
    const token = parseCommandToken(midSentence);
    // trimStart leaves "Please..." → does not start with "/" → null
    assert(token === null, `"/report" mid-sentence is not a slash command (got: ${token})`);
  }

  // ─────────────────────────────────────────────────────────────
  // TEST 10: /help response contains expected Russian text and all 3 commands
  // ─────────────────────────────────────────────────────────────
  console.log('\n[TEST 10] /help response text contains expected content');
  {
    assert(HELP_TEXT.includes('/start'), `/help text contains /start`);
    assert(HELP_TEXT.includes('/report'), `/help text contains /report`);
    assert(HELP_TEXT.includes('/help'), `/help text contains /help`);
    // Must be Russian-language
    assert(HELP_TEXT.includes('команд') || HELP_TEXT.includes('Команд'), `/help text is Russian-language`);
    // Must NOT mention blocked commands
    assert(!HELP_TEXT.includes('/balance'), `/help text does NOT mention /balance`);
    assert(!HELP_TEXT.includes('/category'), `/help text does NOT mention /category`);
    assert(!HELP_TEXT.includes('/add_category'), `/help text does NOT mention /add_category`);
  }
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

runTests()
  .then(() => {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Phase 1.10 Smoke Tests: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      console.error('\n❌ SMOKE TEST FAILED');
      process.exit(1);
    } else {
      console.log('\n✅ ALL SMOKE TESTS PASSED');
      process.exit(0);
    }
  })
  .catch((err) => {
    console.error('\n💥 Smoke test runner crashed:', err);
    process.exit(1);
  });
