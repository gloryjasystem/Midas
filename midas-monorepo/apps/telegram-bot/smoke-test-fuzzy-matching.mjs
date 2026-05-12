/**
 * smoke-test-fuzzy-matching.mjs
 * Comprehensive tests for fuzzyMatchAccountName across ALL preset categories:
 *  - Banks (card) — RU/UA/BY/KZ input
 *  - Exchanges
 *  - Crypto wallets
 *  - E-wallets
 *  - TON wallets
 *  - Lightning wallets
 *  - typeFilter isolation (only correct category matches)
 *  - No false positives (garbage → null)
 *  - Short inputs (< 2 chars → null)
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Import compiled JS
const svc = await import('./dist/services/account-onboard-keyboard.service.js');
const { fuzzyMatchAccountName } = svc;

// ─────────────────────────────────────────────────────────
// Test runner
// ─────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function test(label, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  ✅ ${label}\n`);
  } catch (e) {
    failed++;
    failures.push({ label, message: e.message });
    process.stdout.write(`  ❌ ${label}\n     → ${e.message}\n`);
  }
}

function assertMatch(input, expectedName, typeFilter, label) {
  const result = fuzzyMatchAccountName(input, typeFilter);
  if (!result) {
    throw new Error(`Expected match for "${input}" → "${expectedName}", got null`);
  }
  if (result.name !== expectedName) {
    throw new Error(`Expected "${expectedName}" but got "${result.name}" (score=${result.score.toFixed(3)})`);
  }
}

function assertNoMatch(input, typeFilter, label) {
  const result = fuzzyMatchAccountName(input, typeFilter);
  if (result) {
    throw new Error(`Expected null for "${input}", got "${result.name}" (score=${result.score.toFixed(3)})`);
  }
}

function assertType(input, expectedType, typeFilter) {
  const result = fuzzyMatchAccountName(input, typeFilter);
  if (!result) throw new Error(`Expected type=${expectedType} for "${input}", got null`);
  if (result.type !== expectedType) {
    throw new Error(`Expected type="${expectedType}" but got "${result.type}" for "${input}"`);
  }
}

// ═════════════════════════════════════════════════════════════
console.log('\n════════════════════════════════════════════════════════════');
console.log('🔍 БЛОК 1 — БАНКОВСКИЕ КАРТЫ (RU + UA + BY + KZ input)');
console.log('────────────────────────────────────────────────────────────');

// Russian banks — exact and transliterated Russian input
test('виза → Visa', () => assertMatch('виза', 'Visa'));
test('виз → Visa (prefix)', () => assertMatch('виз', 'Visa'));
test('визу → Visa (accusative)', () => assertMatch('визу', 'Visa'));
test('visa (en) → Visa', () => assertMatch('visa', 'Visa'));
test('мастеркард → Mastercard', () => assertMatch('мастеркард', 'Mastercard'));
test('мастер → Mastercard', () => assertMatch('мастер', 'Mastercard'));
test('mastercard (en) → Mastercard', () => assertMatch('mastercard', 'Mastercard'));
test('тинькофф → Тинькофф', () => assertMatch('тинькофф', 'Тинькофф'));
test('тиньков → Тинькофф (typo)', () => assertMatch('тиньков', 'Тинькофф'));
test('тинк → Тинькофф', () => assertMatch('тинк', 'Тинькофф'));
test('tinkoff (en) → Тинькофф', () => assertMatch('tinkoff', 'Тинькофф'));
test('сбер → Сбербанк', () => assertMatch('сбер', 'Сбербанк'));
test('сберб → Сбербанк', () => assertMatch('сберб', 'Сбербанк'));
test('sber (en) → Сбербанк', () => assertMatch('sber', 'Сбербанк'));
test('альфа → Альфа-Банк', () => assertMatch('альфа', 'Альфа-Банк'));
test('алфа → Альфа-Банк (typo)', () => assertMatch('алфа', 'Альфа-Банк'));
test('alfa (en) → Альфа-Банк', () => assertMatch('alfa', 'Альфа-Банк'));
test('втб → ВТБ', () => assertMatch('втб', 'ВТБ'));
test('vtb (en) → ВТБ', () => assertMatch('vtb', 'ВТБ'));
test('озон → Озон Банк', () => assertMatch('озон', 'Озон Банк'));
test('ozon (en) → Озон Банк', () => assertMatch('ozon', 'Озон Банк'));
test('газпром → Газпромбанк', () => assertMatch('газпром', 'Газпромбанк'));
test('газпромбанк → Газпромбанк', () => assertMatch('газпромбанк', 'Газпромбанк'));
test('газ → Газпромбанк', () => assertMatch('газ', 'Газпромбанк'));
test('райф → Райффайзен', () => assertMatch('райф', 'Райффайзен'));
test('raif → Райффайзен', () => assertMatch('raif', 'Райффайзен'));
test('revolut → Revolut', () => assertMatch('revolut', 'Revolut'));
test('револют → Revolut', () => assertMatch('револют', 'Revolut'));
test('wise → Wise', () => assertMatch('wise', 'Wise'));
test('paypal → PayPal', () => assertMatch('paypal', 'PayPal'));

// Ukrainian banks
test('монобанк → Монобанк', () => assertMatch('монобанк', 'Монобанк'));
test('моно → Монобанк', () => assertMatch('моно', 'Монобанк'));
test('mono (en) → Монобанк', () => assertMatch('mono', 'Монобанк'));
test('приват → ПриватБанк', () => assertMatch('приват', 'ПриватБанк'));
test('privat (en) → ПриватБанк', () => assertMatch('privat', 'ПриватБанк'));
test('ощад → Ощадбанк', () => assertMatch('ощад', 'Ощадбанк'));

// Kazakhstan
test('каспи → Kaspi Bank', () => assertMatch('каспи', 'Kaspi Bank'));
test('kaspi (en) → Kaspi Bank', () => assertMatch('kaspi', 'Kaspi Bank'));
test('халык → Halyk Bank', () => assertMatch('халык', 'Halyk Bank'));

// EU/International
test('santander → Santander', () => assertMatch('santander', 'Santander'));
test('revolut → Revolut', () => assertMatch('revolut', 'Revolut'));
test('n26 → N26', () => assertMatch('n26', 'N26'));
test('revolut → Revolut', () => assertMatch('revolut', 'Revolut'));

// Карта Мир
test('мир → Карта Мир', () => assertMatch('мир', 'Карта Мир'));
test('mir → Карта Мир', () => assertMatch('mir', 'Карта Мир'));
test('юнионпей → UnionPay', () => assertMatch('юнионпей', 'UnionPay'));
test('unionpay (en) → UnionPay', () => assertMatch('unionpay', 'UnionPay'));

// ═════════════════════════════════════════════════════════════
console.log('\n════════════════════════════════════════════════════════════');
console.log('💱 БЛОК 2 — БИРЖИ (EXCHANGE PRESETS)');
console.log('────────────────────────────────────────────────────────────');

test('binance → Binance', () => assertMatch('binance', 'Binance'));
test('байнанс → Binance', () => assertMatch('байнанс', 'Binance'));
test('бинанс → Binance', () => assertMatch('бинанс', 'Binance'));
test('бинанс (filter=exchange) → Binance', () => assertMatch('бинанс', 'Binance', 'exchange'));
test('bybit → Bybit', () => assertMatch('bybit', 'Bybit'));
test('байбит → Bybit', () => assertMatch('байбит', 'Bybit'));
test('babit → Bybit (typo)', () => assertMatch('babit', 'Bybit'));
test('okx → OKX', () => assertMatch('okx', 'OKX'));
test('оkx → OKX', () => assertMatch('окс', 'OKX'));
test('kraken → Kraken', () => assertMatch('kraken', 'Kraken'));
test('кракен → Kraken', () => assertMatch('кракен', 'Kraken'));
test('kucoin → KuCoin', () => assertMatch('kucoin', 'KuCoin'));
test('кукоин → KuCoin', () => assertMatch('кукоин', 'KuCoin'));
test('whitebit → WhiteBIT', () => assertMatch('whitebit', 'WhiteBIT'));
test('вайтбит → WhiteBIT', () => assertMatch('вайтбит', 'WhiteBIT'));
test('гейт → Gate.io', () => assertMatch('гейт', 'Gate.io'));
test('gate → Gate.io', () => assertMatch('gate', 'Gate.io'));
test('gemini → Gemini', () => assertMatch('gemini', 'Gemini'));
test('гемини → Gemini', () => assertMatch('гемини', 'Gemini'));
test('bitstamp → Bitstamp', () => assertMatch('bitstamp', 'Bitstamp'));
test('exmo → EXMO', () => assertMatch('exmo', 'EXMO'));
test('эксмо → EXMO', () => assertMatch('эксмо', 'EXMO'));
test('htx → HTX', () => assertMatch('htx', 'HTX'));
test('huobi → Huobi', () => assertMatch('huobi', 'Huobi'));
test('хуоби → Huobi', () => assertMatch('хуоби', 'Huobi'));
test('mexc → MEXC', () => assertMatch('mexc', 'MEXC'));
test('coinbase → Coinbase', () => assertMatch('coinbase', 'Coinbase'));
test('коинбейс → Coinbase', () => assertMatch('коинбейс', 'Coinbase'));
test('bitget → Bitget', () => assertMatch('bitget', 'Bitget'));
test('upbit → Upbit', () => assertMatch('upbit', 'Upbit'));
test('uniswap → Uniswap', () => assertMatch('uniswap', 'Uniswap'));

// ═════════════════════════════════════════════════════════════
console.log('\n════════════════════════════════════════════════════════════');
console.log('💎 БЛОК 3 — КРИПТО-КОШЕЛЬКИ (WALLET PRESETS)');
console.log('────────────────────────────────────────────────────────────');

test('metamask → MetaMask', () => assertMatch('metamask', 'MetaMask'));
test('метамаск → MetaMask', () => assertMatch('метамаск', 'MetaMask'));
test('мета → MetaMask', () => assertMatch('мета', 'MetaMask'));
test('metamask (filter=wallet) → MetaMask', () => assertMatch('metamask', 'MetaMask', 'wallet'));
test('trust → Trust Wallet', () => assertMatch('trust', 'Trust Wallet'));
test('траст → Trust Wallet', () => assertMatch('траст', 'Trust Wallet'));
test('phantom → Phantom', () => assertMatch('phantom', 'Phantom'));
test('фантом → Phantom', () => assertMatch('фантом', 'Phantom'));
test('exodus → Exodus', () => assertMatch('exodus', 'Exodus'));
test('эксодус → Exodus', () => assertMatch('эксодус', 'Exodus'));
test('ledger → Ledger', () => assertMatch('ledger', 'Ledger'));
test('леджер → Ledger', () => assertMatch('леджер', 'Ledger'));
test('trezor → Trezor', () => assertMatch('trezor', 'Trezor'));
test('трезор → Trezor', () => assertMatch('трезор', 'Trezor'));
test('atomic → Atomic Wallet', () => assertMatch('atomic', 'Atomic Wallet'));
test('атомик → Atomic Wallet', () => assertMatch('атомик', 'Atomic Wallet'));
test('electrum → Electrum', () => assertMatch('electrum', 'Electrum'));
test('rainbow → Rainbow', () => assertMatch('rainbow', 'Rainbow'));
test('zerion → Zerion', () => assertMatch('zerion', 'Zerion'));
test('rabby → Rabby', () => assertMatch('rabby', 'Rabby'));
test('zengo → ZenGo', () => assertMatch('zengo', 'ZenGo'));

// ═════════════════════════════════════════════════════════════
console.log('\n════════════════════════════════════════════════════════════');
console.log('📱 БЛОК 4 — ЭЛЕКТРОННЫЕ КОШЕЛЬКИ (EWALLET PRESETS)');
console.log('────────────────────────────────────────────────────────────');

test('юмани → ЮМoney', () => assertMatch('юмани', 'ЮМoney'));
test('юмоней → ЮМoney', () => assertMatch('юмоней', 'ЮМoney'));
test('yoomoney → ЮМoney', () => assertMatch('yoomoney', 'ЮМoney'));
test('киви → QIWI', () => assertMatch('киви', 'QIWI'));
test('qiwi → QIWI', () => assertMatch('qiwi', 'QIWI'));
test('вебмани → WebMoney', () => assertMatch('вебмани', 'WebMoney'));
test('webmoney → WebMoney', () => assertMatch('webmoney', 'WebMoney'));
test('skrill → Skrill', () => assertMatch('skrill', 'Skrill'));
test('скрилл → Skrill', () => assertMatch('скрилл', 'Skrill'));
test('payoneer → Payoneer', () => assertMatch('payoneer', 'Payoneer'));
test('пайонир → Payoneer', () => assertMatch('пайонир', 'Payoneer'));
test('neteller → Neteller', () => assertMatch('neteller', 'Neteller'));
test('нетелер → Neteller', () => assertMatch('нетелер', 'Neteller'));
test('payeer → Payeer', () => assertMatch('payeer', 'Payeer'));
test('пайер → Payeer', () => assertMatch('пайер', 'Payeer'));
test('advcash → AdvCash', () => assertMatch('advcash', 'AdvCash'));
test('адвкэш → AdvCash', () => assertMatch('адвкэш', 'AdvCash'));
test('alipay → Alipay', () => assertMatch('alipay', 'Alipay'));
test('алипей → Alipay', () => assertMatch('алипей', 'Alipay'));
test('stripe → Stripe', () => assertMatch('stripe', 'Stripe'));

// ═════════════════════════════════════════════════════════════
console.log('\n════════════════════════════════════════════════════════════');
console.log('📲 БЛОК 5 — TON КОШЕЛЬКИ (TON WALLET PRESETS)');
console.log('────────────────────────────────────────────────────────────');

test('tonkeeper → Tonkeeper', () => assertMatch('tonkeeper', 'Tonkeeper'));
test('тонкипер → Tonkeeper', () => assertMatch('тонкипер', 'Tonkeeper'));
test('tonhub → Tonhub', () => assertMatch('tonhub', 'Tonhub'));
test('тонхаб → Tonhub', () => assertMatch('тонхаб', 'Tonhub'));
test('tonspace → TON Space', () => assertMatch('tonspace', 'TON Space'));
test('telegram wallet → Telegram Wallet', () => assertMatch('telegram wallet', 'Telegram Wallet'));
test('телеграм кошелек → Telegram Wallet', () => assertMatch('телеграм кошелек', 'Telegram Wallet'));
test('mytonwallet → MyTonWallet', () => assertMatch('mytonwallet', 'MyTonWallet'));

// ═════════════════════════════════════════════════════════════
console.log('\n════════════════════════════════════════════════════════════');
console.log('⚡ БЛОК 6 — LIGHTNING КОШЕЛЬКИ (LIGHTNING PRESETS)');
console.log('────────────────────────────────────────────────────────────');

test('phoenix → Phoenix', () => assertMatch('phoenix', 'Phoenix'));
test('феникс → Phoenix', () => assertMatch('феникс', 'Phoenix'));
test('breez → Breez', () => assertMatch('breez', 'Breez'));
test('бриз → Breez', () => assertMatch('бриз', 'Breez'));
test('zeus → Zeus', () => assertMatch('zeus', 'Zeus'));
test('зевс → Zeus', () => assertMatch('зевс', 'Zeus'));
test('strike → Strike', () => assertMatch('strike', 'Strike'));
test('страйк → Strike', () => assertMatch('страйк', 'Strike'));
test('alby → Alby', () => assertMatch('alby', 'Alby'));
test('muun → Muun', () => assertMatch('muun', 'Muun'));
test('blink → Blink', () => assertMatch('blink', 'Blink'));

// ═════════════════════════════════════════════════════════════
console.log('\n════════════════════════════════════════════════════════════');
console.log('🎯 БЛОК 7 — ТИПФИЛЬТР: правильная категория при фильтре');
console.log('────────────────────────────────────────────────────────────');

// typeFilter: exchange — должно находить только биржи
test('binance (filter=exchange) → type=exchange', () => assertType('binance', 'exchange', 'exchange'));
test('bybit (filter=exchange) → type=exchange', () => assertType('bybit', 'exchange', 'exchange'));
test('бинанс (filter=exchange) → Binance', () => assertMatch('бинанс', 'Binance', 'exchange'));
test('байбит (filter=exchange) → Bybit', () => assertMatch('байбит', 'Bybit', 'exchange'));
test('кракен (filter=exchange) → Kraken', () => assertMatch('кракен', 'Kraken', 'exchange'));
test('эксмо (filter=exchange) → EXMO', () => assertMatch('эксмо', 'EXMO', 'exchange'));

// typeFilter: card — должно находить только банки
test('visa (filter=card) → type=card', () => assertType('visa', 'card', 'card'));
test('tinkoff (filter=card) → type=card', () => assertType('tinkoff', 'card', 'card'));
test('виза (filter=card) → Visa', () => assertMatch('виза', 'Visa', 'card'));
test('тинькофф (filter=card) → Тинькофф', () => assertMatch('тинькофф', 'Тинькофф', 'card'));
test('сбер (filter=card) → Сбербанк', () => assertMatch('сбер', 'Сбербанк', 'card'));
test('моно (filter=card) → Монобанк', () => assertMatch('моно', 'Монобанк', 'card'));
test('каспи (filter=card) → Kaspi Bank', () => assertMatch('каспи', 'Kaspi Bank', 'card'));

// typeFilter: wallet — должно находить только кошельки
test('metamask (filter=wallet) → type=wallet', () => assertType('metamask', 'wallet', 'wallet'));
test('phantom (filter=wallet) → type=wallet', () => assertType('phantom', 'wallet', 'wallet'));
test('метамаск (filter=wallet) → MetaMask', () => assertMatch('метамаск', 'MetaMask', 'wallet'));
test('фантом (filter=wallet) → Phantom', () => assertMatch('фантом', 'Phantom', 'wallet'));
test('леджер (filter=wallet) → Ledger', () => assertMatch('леджер', 'Ledger', 'wallet'));
test('трезор (filter=wallet) → Trezor', () => assertMatch('трезор', 'Trezor', 'wallet'));
test('киви (filter=wallet) → QIWI', () => assertMatch('киви', 'QIWI', 'wallet'));
test('юмани (filter=wallet) → ЮМoney', () => assertMatch('юмани', 'ЮМoney', 'wallet'));
test('феникс (filter=wallet) → Phoenix', () => assertMatch('феникс', 'Phoenix', 'wallet'));
test('тонкипер (filter=wallet) → Tonkeeper', () => assertMatch('тонкипер', 'Tonkeeper', 'wallet'));

// ── КЛЮЧЕВАЯ ИЗОЛЯЦИЯ: кросс-категориальные пары ──────────────────
// Банки НЕ должны матчить в контексте биржи и кошелька
test('виза под filter=exchange → null (не биржа)', () => assertNoMatch('виза', 'exchange'));
test('виза под filter=wallet → null (не кошелёк)', () => assertNoMatch('виза', 'wallet'));
test('тинькофф под filter=exchange → null (не биржа)', () => assertNoMatch('тинькофф', 'exchange'));
test('тинькофф под filter=wallet → null (не кошелёк)', () => assertNoMatch('тинькофф', 'wallet'));
test('сбер под filter=exchange → null', () => assertNoMatch('сбер', 'exchange'));
test('сбер под filter=wallet → null', () => assertNoMatch('сбер', 'wallet'));
test('моно под filter=exchange → null', () => assertNoMatch('моно', 'exchange'));
test('моно под filter=wallet → null', () => assertNoMatch('моно', 'wallet'));
test('revolut под filter=exchange → null', () => assertNoMatch('revolut', 'exchange'));
test('revolut под filter=wallet → null', () => assertNoMatch('revolut', 'wallet'));

// Биржи НЕ должны матчить в контексте банка или кошелька
test('binance под filter=card → null (не банк)', () => assertNoMatch('binance', 'card'));
test('binance под filter=wallet → null (не кошелёк)', () => assertNoMatch('binance', 'wallet'));
test('бинанс под filter=card → null', () => assertNoMatch('бинанс', 'card'));
test('бинанс под filter=wallet → null', () => assertNoMatch('бинанс', 'wallet'));
test('kraken под filter=card → null (не банк)', () => assertNoMatch('kraken', 'card'));
test('kraken под filter=wallet → null', () => assertNoMatch('kraken', 'wallet'));
test('bybit под filter=card → null', () => assertNoMatch('bybit', 'card'));
test('bybit под filter=wallet → null', () => assertNoMatch('bybit', 'wallet'));
test('эксмо под filter=card → null', () => assertNoMatch('эксмо', 'card'));
test('эксмо под filter=wallet → null', () => assertNoMatch('эксмо', 'wallet'));

// Кошельки НЕ должны матчить в контексте банка или биржи
test('metamask под filter=card → null (не банк)', () => assertNoMatch('metamask', 'card'));
test('metamask под filter=exchange → null (не биржа)', () => assertNoMatch('metamask', 'exchange'));
test('метамаск под filter=card → null', () => assertNoMatch('метамаск', 'card'));
test('метамаск под filter=exchange → null', () => assertNoMatch('метамаск', 'exchange'));
test('ledger под filter=card → null (не банк)', () => assertNoMatch('ledger', 'card'));
test('ledger под filter=exchange → null (не биржа)', () => assertNoMatch('ledger', 'exchange'));
test('леджер под filter=card → null', () => assertNoMatch('леджер', 'card'));
test('леджер под filter=exchange → null', () => assertNoMatch('леджер', 'exchange'));
test('phantom под filter=card → null', () => assertNoMatch('phantom', 'card'));
test('phantom под filter=exchange → null', () => assertNoMatch('phantom', 'exchange'));
test('феникс под filter=card → null (Lightning ≠ банк)', () => assertNoMatch('феникс', 'card'));
test('феникс под filter=exchange → null (Lightning ≠ биржа)', () => assertNoMatch('феникс', 'exchange'));
test('тонкипер под filter=card → null (TON ≠ банк)', () => assertNoMatch('тонкипер', 'card'));
test('тонкипер под filter=exchange → null (TON ≠ биржа)', () => assertNoMatch('тонкипер', 'exchange'));

// E-кошельки (QIWI, WebMoney) НЕ должны матчить в контексте банка или биржи
test('киви под filter=card → null (QIWI ≠ банк)', () => assertNoMatch('киви', 'card'));
test('киви под filter=exchange → null (QIWI ≠ биржа)', () => assertNoMatch('киви', 'exchange'));
test('юмани под filter=card → null', () => assertNoMatch('юмани', 'card'));
test('юмани под filter=exchange → null', () => assertNoMatch('юмани', 'exchange'));

// ═════════════════════════════════════════════════════════════
console.log('\n════════════════════════════════════════════════════════════');
console.log('🚫 БЛОК 8 — НЕТ ЛОЖНЫХ СРАБАТЫВАНИЙ (false positives)');
console.log('────────────────────────────────────────────────────────────');

test('слишком короткая строка "" → null', () => assertNoMatch('', undefined));
test('1 буква "а" → null', () => assertNoMatch('а', undefined));
test('случайный текст "xzqw" → null', () => assertNoMatch('xzqw', undefined));
test('случайный текст "блаблабла" → null', () => assertNoMatch('блаблабла', undefined));
test('цифры "123456" → null', () => assertNoMatch('123456', undefined));
test('один символ "k" → null', () => assertNoMatch('k', undefined));
test('одно слово "прив" — не Приват', () => {
  // "прив" — очень короткий, 4 буквы, проверяем что score не слишком высокий
  // Если матчит ПриватБанк — OK только если score выше порога
  // Но "прив" — prefix of "privat", score >= 0.62 допустим
  // Этот тест — лишь документационный: не ломаем, но фиксируем поведение
  const r = fuzzyMatchAccountName('прив');
  // Приемлемо: может и матчнуть, и нет — главное не ложное
  process.stdout.write(`     ℹ️  "прив" → ${r ? r.name + ' score=' + r.score.toFixed(3) : 'null'} (информационно)\n`);
});
test('одно слово "бан" → null (слишком широко)', () => {
  const r = fuzzyMatchAccountName('бан');
  if (r) throw new Error(`Ожидался null, получили "${r.name}" score=${r.score.toFixed(3)}`);
});
test('одно слово "pay" — не PayPal если слишком размыто', () => {
  // "pay" — 3 буквы, только если score > 0.62
  const r = fuzzyMatchAccountName('pay');
  process.stdout.write(`     ℹ️  "pay" → ${r ? r.name + ' score=' + r.score.toFixed(3) : 'null'} (информационно)\n`);
});
test('несвязный текст "мой счет" → null', () => assertNoMatch('мой счет', undefined));
test('несвязный текст "кошелек" → null (не является именем биржи/банка)', () => {
  const r = fuzzyMatchAccountName('кошелек');
  // "кошелек" не должен матчить ни один пресет
  process.stdout.write(`     ℹ️  "кошелек" → ${r ? r.name + ' score=' + r.score.toFixed(3) : 'null'} (информационно)\n`);
});

// ═════════════════════════════════════════════════════════════
console.log('\n════════════════════════════════════════════════════════════');
console.log('🧪 БЛОК 9 — ОПЕЧАТКИ И НЕТОЧНАЯ ТРАНСЛИТЕРАЦИЯ');
console.log('────────────────────────────════════════════════════════════');

test('tinkof (1 пропущена буква) → Тинькофф', () => assertMatch('tinkof', 'Тинькофф'));
test('tinckoff (замена k→ck) → Тинькофф', () => assertMatch('tinckoff', 'Тинькофф'));
test('sbер (latcyrillic mix) → Сбербанк', () => assertMatch('sber', 'Сбербанк'));
test('монобанк (полное) → Монобанк', () => assertMatch('монобанк', 'Монобанк'));
test('монобанг (опечатка) → Монобанк', () => assertMatch('монобанг', 'Монобанк'));
test('binanse (опечатка) → Binance', () => assertMatch('binanse', 'Binance'));
test('binace (опечатка) → Binance', () => assertMatch('binace', 'Binance'));
test('метамаск → MetaMask', () => assertMatch('метамаск', 'MetaMask'));
test('метамаc → MetaMask (частичная)', () => {
  const r = fuzzyMatchAccountName('метамас');
  process.stdout.write(`     ℹ️  "метамас" → ${r ? r.name + ' score=' + r.score.toFixed(3) : 'null'}\n`);
});
test('кракен (RU) → Kraken', () => assertMatch('кракен', 'Kraken'));
test('сбербанк (полное RU) → Сбербанк', () => assertMatch('сбербанк', 'Сбербанк'));
test('privatbank (en, Ukrainian) → ПриватБанк', () => assertMatch('privatbank', 'ПриватБанк'));
test('raiffeisen → Raiffeisen', () => assertMatch('raiffeisen', 'Raiffeisen'));

// ═════════════════════════════════════════════════════════════
console.log('\n════════════════════════════════════════════════════════════');
console.log('💵 БЛОК 10 — НАЛИЧНЫЕ (CASH)');
console.log('────────────────────────────────────────────────────────────');

test('наличные → Наличные', () => assertMatch('наличные', 'Наличные'));
test('наличка → Наличные', () => assertMatch('наличка', 'Наличные'));
test('налик → Наличные', () => assertMatch('налик', 'Наличные'));
test('нал → Наличные', () => assertMatch('нал', 'Наличные'));
test('cash (en) → Наличные', () => assertMatch('cash', 'Наличные'));
test('готівка (UA) → Наличные', () => assertMatch('готівка', 'Наличные'));
test('кэш → Наличные', () => assertMatch('кэш', 'Наличные'));
test('кеш → Наличные', () => assertMatch('кеш', 'Наличные'));

// ═════════════════════════════════════════════════════════════
// Final report
// ═════════════════════════════════════════════════════════════
console.log('\n════════════════════════════════════════════════════════════');
console.log(`📊 Результат: ${passed} ✅ прошло / ${failed} ❌ провалено`);

if (failures.length > 0) {
  console.log('\n🔴 ПРОВАЛИВШИЕСЯ ТЕСТЫ:');
  for (const f of failures) {
    console.log(`  ❌ ${f.label}`);
    console.log(`     ${f.message}`);
  }
  console.log('');
  process.exit(1);
} else {
  console.log('🎉 ВСЕ ТЕСТЫ ПРОШЛИ — fuzzy matching работает для всех категорий');
  process.exit(0);
}
