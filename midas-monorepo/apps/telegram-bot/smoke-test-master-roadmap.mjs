/**
 * Smoke test — master_roadmap Phase 3
 * Covers tests 3.1–3.6 without a browser.
 * Run: node apps/telegram-bot/smoke-test-master-roadmap.mjs
 */

import {
  buildInputPromptText,
  buildFreeTextPromptText,
  getCurrencyFlag,
  buildCurrencyPickerText,
  buildFiatCurrencyPage,
  buildCryptoCurrencyPage,
  buildNoMatchText,
  buildNoMatchKeyboard,
  buildCurrencySearchPromptText,
  buildCurrencySearchResultsText,
  buildCurrencySearchResultsKeyboard,
  buildCurrencySearchNoResultsText,
  searchCurrencies,
  buildBankPickerPage,
  buildSuccessScreenText,
  buildBalancePromptText,
  FIAT_CURRENCY_PRESETS,
  CRYPTO_CURRENCY_PRESETS,
  TON_CURRENCY_PRESETS,
} from './dist/services/account-onboard-keyboard.service.js';

// ─── Helpers ────────────────────────────────────────────────────
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

// ─── TEST 1.1 — «Например:» в blockquote ────────────────────────
section('1.1 — «Например:» в blockquote');

const promptCard    = buildInputPromptText('card');
const promptExch    = buildInputPromptText('exchange');
const reprCard      = buildFreeTextPromptText('card');
const reprExch      = buildFreeTextPromptText('exchange');

check('buildInputPromptText(card) содержит «Например:»', promptCard.includes('Например:'), promptCard.slice(0, 120));
check('buildInputPromptText(exchange) содержит «Например:»', promptExch.includes('Например:'), promptExch.slice(0, 120));
check('buildFreeTextPromptText(card) содержит «Например:»', reprCard.includes('Например:'), reprCard.slice(0, 120));
check('buildFreeTextPromptText(exchange) содержит «Например:»', reprExch.includes('Например:'), reprExch.slice(0, 120));

// ─── TEST 1.2 — CURRENCY_FLAGS + getCurrencyFlag ────────────────
section('1.2 — CURRENCY_FLAGS / getCurrencyFlag');

check("getCurrencyFlag('RUB') === '🇷🇺'", getCurrencyFlag('RUB') === '🇷🇺', `got: "${getCurrencyFlag('RUB')}"`);
check("getCurrencyFlag('USD') === '🇺🇸'", getCurrencyFlag('USD') === '🇺🇸', `got: "${getCurrencyFlag('USD')}"`);
check("getCurrencyFlag('BTC') contains '₿'",  getCurrencyFlag('BTC').includes('₿'),  `got: "${getCurrencyFlag('BTC')}"`);
check("getCurrencyFlag('ETH') contains 'Ξ'",  getCurrencyFlag('ETH').includes('Ξ'),  `got: "${getCurrencyFlag('ETH')}"`);
check("getCurrencyFlag('UNKNOWN') === ''", getCurrencyFlag('UNKNOWN') === '', `got: "${getCurrencyFlag('UNKNOWN')}"`);

// ─── TEST 1.3 — buildPaginatedPicker: всегда 2 стрелки ──────────
section('1.3 — buildPaginatedPicker: всегда обе стрелки');

const bankPage0 = buildBankPickerPage(0);
const bankPage1 = buildBankPickerPage(1);

// Nav row is last before custom-label row on multi-page keyboards
// The last row is the custom button; the row before it is nav (if totalPages > 1)
function getNavRow(kb) {
  // Walk from the end — nav row has 3 buttons with text ◀️/▶️/n/m
  for (let i = kb.inline_keyboard.length - 1; i >= 0; i--) {
    const row = kb.inline_keyboard[i];
    if (row.length === 3 && (row[0].text === '◀️' || row[2].text === '▶️')) return row;
  }
  return null;
}

const navPage0 = getNavRow(bankPage0);
const navPage1 = getNavRow(bankPage1);

check('bankPage0: nav row существует', navPage0 !== null);
check('bankPage0: 3 кнопки в nav row', navPage0?.length === 3);
check('bankPage0: ◀️ есть (noop на первой странице)', navPage0?.[0].text === '◀️', `got: "${navPage0?.[0].text}"`);
check('bankPage0: ▶️ есть и активна',  navPage0?.[2].text === '▶️', `got: "${navPage0?.[2].text}"`);
check('bankPage0: ◀️ → ac:noop',       navPage0?.[0].callback_data === 'ac:noop', `got: "${navPage0?.[0].callback_data}"`);
check('bankPage0: ▶️ → ac:bp:1',       navPage0?.[2].callback_data === 'ac:bp:1', `got: "${navPage0?.[2].callback_data}"`);

check('bankPage1: ◀️ активна (ac:bp:0)', navPage1?.[0].callback_data === 'ac:bp:0', `got: "${navPage1?.[0].callback_data}"`);

// ─── TEST 1.4 — buildCurrencyPickerText ─────────────────────────
section('1.4 — buildCurrencyPickerText: 3 ветки');

const textNoName   = buildCurrencyPickerText();
const textPreset   = buildCurrencyPickerText('Тинькофф', false);
const textCustom   = buildCurrencyPickerText('Абв', true);

check('Без имени: "В какой валюте"', textNoName.includes('В какой валюте'), textNoName.slice(0, 100));
check('Preset: blockquote «Тинькофф»', textPreset.includes('«Тинькофф»'), textPreset.slice(0, 120));
check('Custom: "свой счёт"', textCustom.includes('свой счёт'), textCustom.slice(0, 120));

// ─── TEST 1.5 — 🔍 Найти валюту кнопка ──────────────────────────
section('1.5 — Кнопка «🔍 Найти валюту»');

const fiatPage0   = buildFiatCurrencyPage(0);
const cryptoPage0 = buildCryptoCurrencyPage(0);

function hasSearchButton(kb) {
  return kb.inline_keyboard.flat().some(b => b.callback_data === 'ac:cur:search');
}

check('buildFiatCurrencyPage(0): кнопка ac:cur:search',   hasSearchButton(fiatPage0));
check('buildCryptoCurrencyPage(0): кнопка ac:cur:search', hasSearchButton(cryptoPage0));

function hasCustomButton(kb) {
  return kb.inline_keyboard.flat().some(b => b.callback_data === 'ac:cur:custom');
}
check('buildFiatCurrencyPage: НЕТ ac:cur:custom',   !hasCustomButton(fiatPage0),   '(legacy button should be removed)');
check('buildCryptoCurrencyPage: НЕТ ac:cur:custom', !hasCustomButton(cryptoPage0), '(legacy button should be removed)');

// ─── TEST 1.6 — searchCurrencies ────────────────────────────────
section('1.6 — searchCurrencies: логика поиска');

const pool = [...FIAT_CURRENCY_PRESETS, ...CRYPTO_CURRENCY_PRESETS];

const r1 = searchCurrencies('rub', pool);
const r2 = searchCurrencies('руб', pool);
const r3 = searchCurrencies('dollar', pool);
const r4 = searchCurrencies('евро', pool);
const r5 = searchCurrencies('btc', pool);
const r6 = searchCurrencies('xyz123', pool);
const r7 = searchCurrencies('', pool);

check("'rub' → RUB в результатах",    r1.includes('RUB'),  `got: [${r1.join(', ')}]`);
check("'руб' → RUB (translit)",        r2.includes('RUB'),  `got: [${r2.join(', ')}]`);
check("'dollar' → USD в результатах",  r3.includes('USD'),  `got: [${r3.join(', ')}]`);
check("'евро' → EUR в результатах",   r4.includes('EUR'),  `got: [${r4.join(', ')}]`);
check("'btc' → BTC первый",           r5[0] === 'BTC',     `got: [${r5.join(', ')}]`);
check("'xyz123' → пусто",             r6.length === 0,     `got: [${r6.join(', ')}]`);
check("'' → пусто",                   r7.length === 0,     'empty query returns []');
check('Результатов не больше 9',       r1.length <= 9,      `got: ${r1.length}`);

// ─── TEST 1.6b — buildCurrencySearch* texts ──────────────────────
section('1.6b — buildCurrencySearch* тексты');

const searchPrompt     = buildCurrencySearchPromptText('Тинькофф', false);
const searchPromptCust = buildCurrencySearchPromptText('Абв', true);
const searchResults    = buildCurrencySearchResultsText('rub', 'Тинькофф', false);
const noResults        = buildCurrencySearchNoResultsText('xyz', 'Тинькофф', false);

check('Prompt содержит "Поиск валюты"',          searchPrompt.includes('Поиск валюты'),   searchPrompt.slice(0, 100));
check('Prompt preset: «Тинькофф»',               searchPrompt.includes('«Тинькофф»'),     searchPrompt.slice(0, 120));
check('Prompt custom: "свой счёт"',               searchPromptCust.includes('свой счёт'), searchPromptCust.slice(0, 120));
check('Results text содержит "Найдено"',          searchResults.includes('Найдено'),       searchResults.slice(0, 100));
check('No-results содержит "Такой валюты нет"',   noResults.includes('Такой валюты нет'), noResults.slice(0, 120));

// Results keyboard
const resKb = buildCurrencySearchResultsKeyboard(['RUB', 'USD', 'EUR'], 'ac:cur:list');
const backBtn = resKb.inline_keyboard.at(-1)?.[0];
check('Results kb: кнопка «Вернуться к списку»',       backBtn?.callback_data === 'ac:cur:list',  `got: "${backBtn?.callback_data}"`);
check('Results kb: RUB button с флагом',               resKb.inline_keyboard[0].some(b => b.text.includes('RUB')));

// ─── TEST 1.7 — buildNoMatchText + buildNoMatchKeyboard ──────────
section('1.7 — buildNoMatchText / buildNoMatchKeyboard');

const noMatchCard  = buildNoMatchText('Абв', 'card');
const noMatchExch  = buildNoMatchText('Binance', 'exchange');
const noMatchWall  = buildNoMatchText('Ledger', 'wallet', 'crypto');
const noMatchKb    = buildNoMatchKeyboard('Абв', 'type');
const noMatchKbSub = buildNoMatchKeyboard('Ledger', 'subtype');

check('noMatchCard содержит "банка"',     noMatchCard.includes('банка'),  noMatchCard.slice(0, 100));
check('noMatchExch содержит "биржи"',     noMatchExch.includes('биржи'), noMatchExch.slice(0, 100));
check('noMatchWall содержит "кошелька"',  noMatchWall.includes('кошелька'), noMatchWall.slice(0, 100));
check('noMatchCard содержит blockquote «Абв»', noMatchCard.includes('«Абв»'));

const saveBtn  = noMatchKb.inline_keyboard[0]?.[0];
const keepBtn  = noMatchKb.inline_keyboard[1]?.[0];
const backBtn1 = noMatchKb.inline_keyboard[1]?.[1];
const backBtnSub = noMatchKbSub.inline_keyboard[1]?.[1];

check("noMatchKb: cus:save button",         saveBtn?.callback_data === 'ac:cus:save',    `got: "${saveBtn?.callback_data}"`);
check("noMatchKb: cus:keep button",         keepBtn?.callback_data === 'ac:cus:keep',    `got: "${keepBtn?.callback_data}"`);
check("noMatchKb (type): ac:type:back",     backBtn1?.callback_data === 'ac:type:back',  `got: "${backBtn1?.callback_data}"`);
check("noMatchKb (subtype): ac:type:wallet",backBtnSub?.callback_data === 'ac:type:wallet', `got: "${backBtnSub?.callback_data}"`);
check("preview обрезается до 22 символов", saveBtn?.text.length <= '✅ Создать «'.length + 22 + 1);

// ─── TEST 3.1 scenario — Card + fuzzy найдёт «Тинькофф» ─────────
section('3.1 scenario — Currency picker после подтверждения имени');

const headerPreset = buildCurrencyPickerText('Тинькофф', false);
const fiatKb       = buildFiatCurrencyPage(0);
const fiatBtns     = fiatKb.inline_keyboard.flat();

check('currency picker header: «Тинькофф»',        headerPreset.includes('«Тинькофф»'));
check('fiat page 0: кнопка с флагом RUB',           fiatBtns.some(b => b.text.includes('RUB') && b.text.includes('🇷🇺')));
check('fiat page 0: кнопка с флагом EUR',           fiatBtns.some(b => b.text.includes('EUR') && b.text.includes('🇪🇺')));
check('fiat page 0: nav row присутствует',          getNavRow(fiatKb) !== null);

// ─── TEST 3.2 scenario — Card + no-match ────────────────────────
section('3.2 scenario — No-match screen «Абв»');

const noMatchText = buildNoMatchText('Абв', 'card');
const noMatchKb32 = buildNoMatchKeyboard('Абв', 'type');

check('no-match текст: «Абв» в blockquote',          noMatchText.includes('«Абв»'));
check('no-match текст: "Похожего банка не нашли"',   noMatchText.includes('Похожего банка не нашли'));
check('no-match kb: ✅ Создать',                      noMatchKb32.inline_keyboard[0][0].text.includes('Создать'));
check('no-match kb: ✏️ Изменить название',            noMatchKb32.inline_keyboard[1][0].text.includes('Изменить'));
check('no-match kb: ◀️ К типу счёта',                noMatchKb32.inline_keyboard[1][1].text.includes('К типу'));

// ─── TEST 3.4 scenario — blockquote prompt ──────────────────────
section('3.4 scenario — Промпт ввода названия');

const cardPrompt = buildInputPromptText('card');
check('card prompt: «Например:»',         cardPrompt.includes('Например:'));
check('card prompt: «Тинькофф»',          cardPrompt.includes('Тинькофф'));
check('card prompt: blockquote тег',      cardPrompt.includes('<blockquote>'));

// ─── TEST 3.5 scenario — Lightning BTC fixed ─────────────────────
section('3.5 scenario — Lightning кошелёк (BTC зафиксирован)');

const lightningBalPrompt = buildBalancePromptText('Phoenix', 'BTC');
const successLightning   = buildSuccessScreenText('Phoenix', 'BTC', undefined, '⚡');

check('balance prompt Lightning: Phoenix · BTC', lightningBalPrompt.includes('Phoenix'));
check('success screen: Phoenix', successLightning.includes('Phoenix'));
check('success screen: BTC',     successLightning.includes('BTC'));
check('success screen: ⚡',      successLightning.includes('⚡'));

// ─── TEST 3.6 scenario — Наличные RUB ───────────────────────────
section('3.6 scenario — Наличные (нет экрана имени)');

const cashCurrencyHeader = buildCurrencyPickerText('Наличные', false);
const successCash        = buildSuccessScreenText('Наличные RUB', 'RUB', undefined, '💵');

check('cash currency header существует', cashCurrencyHeader.length > 0);
check('cash success: "Наличные RUB"',    successCash.includes('Наличные RUB'));
check('cash success: "RUB"',             successCash.includes('RUB'));

// ─── TEST 2.7 — Проверить что buildFinishOnboardKeyboard не нужна ─
section('2.7 — Success screen не требует кнопок (контракт)');

// The success screen text should stand alone; keyboard is { inline_keyboard: [] }
const successText = buildSuccessScreenText('Тинькофф', 'RUB', '15000', '🏦');
check('buildSuccessScreenText возвращает непустую строку', successText.length > 0);
check('buildSuccessScreenText содержит название',          successText.includes('Тинькофф'));
check('buildSuccessScreenText содержит валюту',            successText.includes('RUB'));
check('buildSuccessScreenText содержит баланс 15000',      successText.includes('15000'));

// ─── Итог ────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(60)}`);
console.log(`📊 Результат: ${passed} ✅ прошло / ${failed} ❌ провалено`);

if (failed === 0) {
  console.log('🎉 ВСЕ ТЕСТЫ ПРОШЛИ — Фаза 3 зелёная');
  process.exit(0);
} else {
  console.log('⚠️  Есть провалы — нужна доработка');
  process.exit(1);
}
