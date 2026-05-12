/**
 * Account Onboard Keyboard Service — Phase 1.30
 *
 * Builds Telegram InlineKeyboardMarkup objects for the smart account
 * onboarding flow triggered from /accounts (empty state) and /start
 * (new user guided setup).
 *
 * Callback_data namespace: "ac:"
 *   ac:type:card      → user picked Банковская карта  (12 bytes)
 *   ac:type:cash      → user picked Наличные          (12 bytes)
 *   ac:type:exchange  → user picked Крипто-биржа      (16 bytes) ← MAX
 *   ac:type:wallet    → user picked Крипто-кошелёк    (14 bytes)
 *   ac:type:custom    → user picked Своё название      (14 bytes)
 *   ac:xch:binance    → exchange preset: Binance       (14 bytes)
 *   ac:xch:bybit      → exchange preset: Bybit         (12 bytes)
 *   ac:xch:okx        → exchange preset: OKX           (10 bytes)
 *   ac:xch:kraken     → exchange preset: Kraken        (13 bytes)
 *   ac:xch:huobi      → exchange preset: Huobi         (12 bytes)
 *   ac:xch:custom     → exchange: free-text name       (13 bytes)
 *   ac:cur:USDT       → currency pick: USDT            (11 bytes)
 *   ac:cur:BTC        → currency pick: BTC             (10 bytes)
 *   ac:cur:ETH        → currency pick: ETH             (10 bytes)
 *   ac:cur:custom     → currency: free-text input      (13 bytes)
 *   ac:skip           → skip onboarding (from /start)  (7 bytes)
 *   ac:more           → add another account            (7 bytes)
 *   ac:done           → finish adding accounts         (7 bytes)
 *
 * All values ≤ 16 bytes — safely within Telegram 64-byte limit.
 * No user-provided data enters callback_data.
 *
 * Redis state key: midas:ac:{telegramUserId}:{chatId}  TTL 300s
 * Value: JSON.stringify(AccountOnboardState)
 *
 * SEC-01: All callback type/action values validated against allowlist.
 * SEC-12: No names or amounts logged.
 */

import type { InlineKeyboardMarkup } from '../services/telegram-api.js';

// ─────────────────────────────────────────────────────────────
// Redis state type
// ─────────────────────────────────────────────────────────────

/**
 * Onboarding flow step.
 *   type_pick      → user taps /accounts or /start guided keyboard
 *   name_input     → bot awaiting free-text account name
 *   smart_confirm  → bot showed fuzzy suggestion, awaiting confirm/reject (Phase 2.3)
 *   cur_pick       → bot showing currency keyboard
 *   cur_input      → bot awaiting free-text currency code
 *   bal_input      → bot awaiting initial balance amount (Phase 2.2)
 */
export type OnboardStep =
  | 'type_pick'
  | 'wallet_subtype'
  | 'name_input'
  | 'smart_confirm'
  | 'name_confirm_custom'  // no-match: waiting user to confirm/reject custom name
  | 'cur_pick'
  | 'cur_search'           // currency free-text search active
  | 'cur_input'
  | 'bal_input';

/** Wallet sub-category — drives currency routing */
export type WalletSubtype = 'crypto' | 'ewallet' | 'ton' | 'lightning';

export interface AccountOnboardState {
  step: OnboardStep;
  /** Account type selected */
  accountType?: 'card' | 'cash' | 'exchange' | 'wallet' | 'custom';
  /** Wallet sub-type — set when accountType === 'wallet' */
  walletSubtype?: WalletSubtype;
  /** When true: next name_input skips fuzzy and accepts text as-is */
  fuzzyDisabled?: boolean;
  /** Account name resolved */
  name?: string;
  /** Account ULID — set after DB insert */
  accountId?: string;
  /** Currency code */
  currency?: string;
  /** Unix ms of account creation — used for 15-sec undo window */
  createdAt?: number;
  /** Display name of successfully created account (for success screen) */
  createdAccountName?: string;
  /** Display currency of created account (for success screen) */
  createdAccountCurrency?: string;
  /** Display balance of created account (for success screen, optional) */
  createdAccountBalance?: string;
  // Phase 2.3: smart name matching
  originalName?: string;
  suggestedName?: string;
  suggestedType?: 'card' | 'cash' | 'exchange' | 'wallet';
  suggestedCurrency?: string;
  // Phase «master_roadmap»: no-match + currency search
  /** Pending unconfirmed custom name (no-match flow) */
  pendingName?: string;
  /** True when account name came via no-match cus_save (custom, not a preset) */
  isCustomName?: boolean;
  /** Currency pool to show after name confirmation */
  currencyPool?: 'fiat' | 'crypto' | 'ton';
}

// ─────────────────────────────────────────────────────────────
// Bank preset allowlist (SEC-01)
// key → { name, defaultCurrency }
// ─────────────────────────────────────────────────────────────

export interface PresetInfo {
  name: string;
  defaultCurrency: string;
}

export const BANK_PRESETS: ReadonlyMap<string, PresetInfo> = new Map([
  // Russia
  ['tinkoff',    { name: 'Тинькофф',      defaultCurrency: 'RUB' }],
  ['sber',       { name: 'Сбербанк',      defaultCurrency: 'RUB' }],
  ['vtb',        { name: 'ВТБ',           defaultCurrency: 'RUB' }],
  ['alfa',       { name: 'Альфа-Банк',    defaultCurrency: 'RUB' }],
  ['ozon',       { name: 'Озон Банк',     defaultCurrency: 'RUB' }],
  ['mkb',        { name: 'МКБ',           defaultCurrency: 'RUB' }],
  ['gazprom',    { name: 'Газпромбанк',   defaultCurrency: 'RUB' }],
  ['psb',        { name: 'Промсвязьбанк', defaultCurrency: 'RUB' }],
  ['uralsib',    { name: 'Уралсиб',       defaultCurrency: 'RUB' }],
  ['sovkombank', { name: 'Совкомбанк',    defaultCurrency: 'RUB' }],
  ['rosselhoz',  { name: 'Россельхоз',    defaultCurrency: 'RUB' }],
  ['mkb2',       { name: 'Открытие',      defaultCurrency: 'RUB' }],
  ['rosbank',     { name: 'Росбанк',           defaultCurrency: 'RUB' }],
  ['raifrus',     { name: 'Райффайзен',         defaultCurrency: 'RUB' }],
  ['pochta',      { name: 'Почта Банк',         defaultCurrency: 'RUB' }],
  ['mtsbank',     { name: 'МТС Банк',           defaultCurrency: 'RUB' }],
  ['domrf',       { name: 'Банк ДОМ.РФ',        defaultCurrency: 'RUB' }],
  ['hcredit',     { name: 'Хоум Кредит',        defaultCurrency: 'RUB' }],
  ['otprus',      { name: 'ОТП Банк',           defaultCurrency: 'RUB' }],
  ['akbars',      { name: 'Ак Барс',            defaultCurrency: 'RUB' }],
  ['spbbank',     { name: 'Банк Санкт-Петербург', defaultCurrency: 'RUB' }],
  ['unicreditrus',{ name: 'ЮниКредит',          defaultCurrency: 'RUB' }],
  ['renaissance', { name: 'Ренессанс Кредит',   defaultCurrency: 'RUB' }],
  ['rnkb',        { name: 'РНКБ',              defaultCurrency: 'RUB' }],
  ['expobank',    { name: 'Экспобанк',          defaultCurrency: 'RUB' }],
  // Ukraine
  ['mono',       { name: 'Монобанк',      defaultCurrency: 'UAH' }],
  ['privat',     { name: 'ПриватБанк',    defaultCurrency: 'UAH' }],
  ['ukrsib',     { name: 'Укрсиббанк',    defaultCurrency: 'UAH' }],
  ['oschad',     { name: 'Ощадбанк',      defaultCurrency: 'UAH' }],
  ['pumb',       { name: 'ПУМБ',          defaultCurrency: 'UAH' }],
  ['abank',      { name: 'A-Банк',        defaultCurrency: 'UAH' }],
  ['sense',       { name: 'Сенс Банк',       defaultCurrency: 'UAH' }],
  ['aval',        { name: 'Райффайзен Аваль',  defaultCurrency: 'UAH' }],
  ['ukrexim',     { name: 'Укрексімбанк',      defaultCurrency: 'UAH' }],
  ['ukrgaz',      { name: 'Укргазбанк',       defaultCurrency: 'UAH' }],
  ['tascom',      { name: 'ТАСкомбанк',       defaultCurrency: 'UAH' }],
  ['kredobank',   { name: 'Кредобанк',        defaultCurrency: 'UAH' }],
  ['pivdenny',    { name: 'Південний',         defaultCurrency: 'UAH' }],
  ['globus',      { name: 'Глобус Банк',     defaultCurrency: 'UAH' }],
  ['skybank',     { name: 'Sky Bank',         defaultCurrency: 'UAH' }],
  ['otpua',       { name: 'ОТП Банк Україна',defaultCurrency: 'UAH' }],
  // Belarus
  ['belinvest',  { name: 'Белинвестбанк', defaultCurrency: 'BYN' }],
  ['priorbank',  { name: 'Приорбанк',     defaultCurrency: 'BYN' }],
  ['mtbank',     { name: 'МТБанк',        defaultCurrency: 'BYN' }],
  ['belarusbank', { name: 'Беларусбанк',     defaultCurrency: 'BYN' }],
  ['bps',         { name: 'БПС-Сбербанк',     defaultCurrency: 'BYN' }],
  ['dabrabyt',    { name: 'Дабрабыт',          defaultCurrency: 'BYN' }],
  ['alfaby',      { name: 'Альфа-Банк BY',    defaultCurrency: 'BYN' }],
  // Kazakhstan
  ['kaspi',      { name: 'Kaspi Bank',    defaultCurrency: 'KZT' }],
  ['halyk',      { name: 'Halyk Bank',    defaultCurrency: 'KZT' }],
  ['jusan',      { name: 'Jusan Bank',    defaultCurrency: 'KZT' }],
  ['centercredit',{ name: 'ЦентрКредит',      defaultCurrency: 'KZT' }],
  ['forte',       { name: 'ForteBank',        defaultCurrency: 'KZT' }],
  ['eurasian',    { name: 'Евразийский банк',  defaultCurrency: 'KZT' }],
  ['rbk',         { name: 'Bank RBK',         defaultCurrency: 'KZT' }],
  ['atfbank',     { name: 'АТФБанк',          defaultCurrency: 'KZT' }],
  // Uzbekistan
  ['kapital',    { name: 'Kapitalbank',   defaultCurrency: 'UZS' }],
  ['click',      { name: 'Click',         defaultCurrency: 'UZS' }],
  ['asaka',       { name: 'Asaka Bank',       defaultCurrency: 'UZS' }],
  ['ipoteka',     { name: 'Ipoteka Bank',     defaultCurrency: 'UZS' }],
  ['hamkor',      { name: 'Hamkorbank',       defaultCurrency: 'UZS' }],
  ['tbcuz',       { name: 'TBC Uzbekistan',   defaultCurrency: 'UZS' }],
  // Georgia
  ['tbc',        { name: 'TBC Bank',      defaultCurrency: 'GEL' }],
  ['bog',        { name: 'Bank of Georgia', defaultCurrency: 'GEL' }],
  ['liberty',     { name: 'Liberty Bank',     defaultCurrency: 'GEL' }],
  // Armenia
  ['ameriabank',  { name: 'Ameriabank',       defaultCurrency: 'AMD' }],
  ['acba',        { name: 'ACBA Bank',        defaultCurrency: 'AMD' }],
  ['ardshin',     { name: 'Ardshinbank',      defaultCurrency: 'AMD' }],
  // Azerbaijan
  ['kapitalaz',   { name: 'Kapital Bank AZ',  defaultCurrency: 'AZN' }],
  ['abb',         { name: 'ABB Bank',         defaultCurrency: 'AZN' }],
  // Moldova
  ['maib',        { name: 'Agroindbank',      defaultCurrency: 'MDL' }],
  ['micb',        { name: 'Moldindconbank',   defaultCurrency: 'MDL' }],
  // Germany
  ['ing',        { name: 'ING',           defaultCurrency: 'EUR' }],
  ['n26',        { name: 'N26',           defaultCurrency: 'EUR' }],
  ['dkb',        { name: 'DKB',           defaultCurrency: 'EUR' }],
  ['commerzbank',{ name: 'Commerzbank',   defaultCurrency: 'EUR' }],
  ['postbank',   { name: 'Postbank',      defaultCurrency: 'EUR' }],
  ['deutsche',    { name: 'Deutsche Bank', defaultCurrency: 'EUR' }],
  ['sparkasse',   { name: 'Sparkasse',    defaultCurrency: 'EUR' }],
  ['volksbank',   { name: 'Volksbank',    defaultCurrency: 'EUR' }],
  ['hvb',         { name: 'HypoVereinsbank', defaultCurrency: 'EUR' }],
  ['comdirect',   { name: 'comdirect',   defaultCurrency: 'EUR' }],
  ['bunq',        { name: 'bunq',         defaultCurrency: 'EUR' }],
  ['rabobank',    { name: 'Rabobank',     defaultCurrency: 'EUR' }],
  ['abnamro',     { name: 'ABN AMRO',    defaultCurrency: 'EUR' }],
  // France / Spain
  ['bnp',        { name: 'BNP Paribas',   defaultCurrency: 'EUR' }],
  ['socgen',     { name: 'SocGen',        defaultCurrency: 'EUR' }],
  ['lcl',        { name: 'LCL',           defaultCurrency: 'EUR' }],
  ['caxia',      { name: 'CaixaBank',     defaultCurrency: 'EUR' }],
  ['bbva',       { name: 'BBVA',          defaultCurrency: 'EUR' }],
  ['santander',  { name: 'Santander',     defaultCurrency: 'EUR' }],
  ['ca',          { name: 'Crédit Agricole', defaultCurrency: 'EUR' }],
  ['laposte',     { name: 'La Banque Postale', defaultCurrency: 'EUR' }],
  ['boursorama',  { name: 'Boursorama',   defaultCurrency: 'EUR' }],
  ['sabadell',    { name: 'Banco Sabadell', defaultCurrency: 'EUR' }],
  ['bankinter',   { name: 'Bankinter',    defaultCurrency: 'EUR' }],
  ['unicaja',     { name: 'Unicaja',      defaultCurrency: 'EUR' }],
  // Italy
  ['intesa',      { name: 'Intesa Sanpaolo', defaultCurrency: 'EUR' }],
  ['unicredit',   { name: 'UniCredit',    defaultCurrency: 'EUR' }],
  ['bnlita',      { name: 'BNL',          defaultCurrency: 'EUR' }],
  ['mediobanca',  { name: 'Mediobanca',   defaultCurrency: 'EUR' }],
  // UK
  ['barclays',   { name: 'Barclays',      defaultCurrency: 'GBP' }],
  ['hsbc',       { name: 'HSBC',          defaultCurrency: 'GBP' }],
  ['lloyds',     { name: 'Lloyds',        defaultCurrency: 'GBP' }],
  ['monzo',      { name: 'Monzo',         defaultCurrency: 'GBP' }],
  ['starling',   { name: 'Starling',      defaultCurrency: 'GBP' }],
  ['natwest',    { name: 'NatWest',       defaultCurrency: 'GBP' }],
  // Poland
  ['pko',        { name: 'PKO BP',        defaultCurrency: 'PLN' }],
  ['mbank',      { name: 'mBank',         defaultCurrency: 'PLN' }],
  ['pekao',      { name: 'Pekao',         defaultCurrency: 'PLN' }],
  ['millennium', { name: 'Millennium',    defaultCurrency: 'PLN' }],
  // Switzerland / Austria
  ['ubs',        { name: 'UBS',           defaultCurrency: 'CHF' }],
  ['csbank',     { name: 'Credit Suisse', defaultCurrency: 'CHF' }],
  ['raiffeisen', { name: 'Raiffeisen',    defaultCurrency: 'EUR' }],
  // Scandinavia
  ['nordea',     { name: 'Nordea',        defaultCurrency: 'SEK' }],
  ['dnb',        { name: 'DNB',           defaultCurrency: 'NOK' }],
  ['seb',        { name: 'SEB',           defaultCurrency: 'SEK' }],
  ['handels',    { name: 'Handelsbanken', defaultCurrency: 'SEK' }],
  ['swedbank',    { name: 'Swedbank',      defaultCurrency: 'SEK' }],
  ['danske',      { name: 'Danske Bank',   defaultCurrency: 'DKK' }],
  ['op',          { name: 'OP Financial',  defaultCurrency: 'EUR' }],
  // Poland
  ['pko',         { name: 'PKO BP',        defaultCurrency: 'PLN' }],
  ['mbank',       { name: 'mBank',         defaultCurrency: 'PLN' }],
  ['pekao',       { name: 'Pekao',         defaultCurrency: 'PLN' }],
  ['millennium',  { name: 'Millennium',    defaultCurrency: 'PLN' }],
  ['alior',       { name: 'Alior Bank',    defaultCurrency: 'PLN' }],
  ['ingpl',       { name: 'ING Bank Śląski', defaultCurrency: 'PLN' }],
  ['santanderpl', { name: 'Santander PL',  defaultCurrency: 'PLN' }],
  // Czech / Slovakia / Hungary
  ['kb',          { name: 'Komerční banka', defaultCurrency: 'CZK' }],
  ['csob',        { name: 'ČSOB',             defaultCurrency: 'CZK' }],
  ['csas',        { name: 'Česká spořitelna',  defaultCurrency: 'CZK' }],
  ['airbank',     { name: 'Air Bank',      defaultCurrency: 'CZK' }],
  ['vub',         { name: 'VÚB banka',       defaultCurrency: 'EUR' }],
  ['tatra',       { name: 'Tatra banka',   defaultCurrency: 'EUR' }],
  ['otp',         { name: 'OTP Bank',      defaultCurrency: 'HUF' }],
  // Romania / Bulgaria / Greece
  ['bt',          { name: 'Banca Transilvania', defaultCurrency: 'RON' }],
  ['bcr',         { name: 'BCR',           defaultCurrency: 'RON' }],
  ['brd',         { name: 'BRD',           defaultCurrency: 'RON' }],
  ['dsk',         { name: 'DSK Bank',      defaultCurrency: 'BGN' }],
  ['piraeus',     { name: 'Piraeus Bank',  defaultCurrency: 'EUR' }],
  ['alphabank',   { name: 'Alpha Bank',    defaultCurrency: 'EUR' }],
  // UK
  // UK
  ['barclays',    { name: 'Barclays',      defaultCurrency: 'GBP' }],
  ['hsbc',        { name: 'HSBC',          defaultCurrency: 'GBP' }],
  ['lloyds',      { name: 'Lloyds',        defaultCurrency: 'GBP' }],
  ['monzo',       { name: 'Monzo',         defaultCurrency: 'GBP' }],
  ['starling',    { name: 'Starling',      defaultCurrency: 'GBP' }],
  ['natwest',     { name: 'NatWest',       defaultCurrency: 'GBP' }],
  ['halifax',     { name: 'Halifax',       defaultCurrency: 'GBP' }],
  ['tsb',         { name: 'TSB',           defaultCurrency: 'GBP' }],
  ['santanderuk', { name: 'Santander UK',  defaultCurrency: 'GBP' }],
  ['metrobank',   { name: 'Metro Bank',    defaultCurrency: 'GBP' }],
  ['virginmoney', { name: 'Virgin Money',  defaultCurrency: 'GBP' }],
  ['tide',        { name: 'Tide',          defaultCurrency: 'GBP' }],
  ['firstdirect', { name: 'First Direct',  defaultCurrency: 'GBP' }],
  // USA
  ['chase',      { name: 'Chase',          defaultCurrency: 'USD' }],
  ['bofa',       { name: 'Bank of America',defaultCurrency: 'USD' }],
  ['wells',      { name: 'Wells Fargo',    defaultCurrency: 'USD' }],
  ['citi',       { name: 'Citibank',       defaultCurrency: 'USD' }],
  ['amex',       { name: 'Amex',           defaultCurrency: 'USD' }],
  ['capitalone',  { name: 'Capital One',   defaultCurrency: 'USD' }],
  ['usbank',      { name: 'U.S. Bank',     defaultCurrency: 'USD' }],
  ['pnc',         { name: 'PNC Bank',      defaultCurrency: 'USD' }],
  ['ally',        { name: 'Ally Bank',     defaultCurrency: 'USD' }],
  ['schwab',      { name: 'Charles Schwab',defaultCurrency: 'USD' }],
  ['discover',    { name: 'Discover',      defaultCurrency: 'USD' }],
  ['chime',       { name: 'Chime',         defaultCurrency: 'USD' }],
  ['sofi',        { name: 'SoFi',          defaultCurrency: 'USD' }],
  ['cashapp',     { name: 'Cash App',      defaultCurrency: 'USD' }],
  ['venmo',       { name: 'Venmo',         defaultCurrency: 'USD' }],
  // Canada
  ['rbc',         { name: 'RBC',           defaultCurrency: 'CAD' }],
  ['tdcanada',    { name: 'TD Canada',     defaultCurrency: 'CAD' }],
  ['scotiabank',  { name: 'Scotiabank',    defaultCurrency: 'CAD' }],
  ['bmo',         { name: 'BMO',           defaultCurrency: 'CAD' }],
  ['cibc',        { name: 'CIBC',          defaultCurrency: 'CAD' }],
  ['eqbank',      { name: 'EQ Bank',       defaultCurrency: 'CAD' }],
  // Australia
  ['cba',         { name: 'CommBank',      defaultCurrency: 'AUD' }],
  ['westpac',     { name: 'Westpac',       defaultCurrency: 'AUD' }],
  ['anz',         { name: 'ANZ',           defaultCurrency: 'AUD' }],
  ['nab',         { name: 'NAB',           defaultCurrency: 'AUD' }],
  ['macquarie',   { name: 'Macquarie',     defaultCurrency: 'AUD' }],
  ['upbank',      { name: 'Up Bank',       defaultCurrency: 'AUD' }],
  // Japan
  ['mufg',        { name: 'MUFG',          defaultCurrency: 'JPY' }],
  ['mizuho',      { name: 'Mizuho',        defaultCurrency: 'JPY' }],
  ['smbc',        { name: 'SMBC',          defaultCurrency: 'JPY' }],
  ['rakutenbank', { name: 'Rakuten Bank',  defaultCurrency: 'JPY' }],
  // Korea
  ['kakaobank',   { name: 'Kakao Bank',    defaultCurrency: 'KRW' }],
  ['kb',          { name: 'KB Bank',       defaultCurrency: 'KRW' }],
  ['shinhan',     { name: 'Shinhan Bank',  defaultCurrency: 'KRW' }],
  ['tossbank',    { name: 'Toss Bank',     defaultCurrency: 'KRW' }],
  // India
  ['hdfc',        { name: 'HDFC Bank',     defaultCurrency: 'INR' }],
  ['icici',       { name: 'ICICI Bank',    defaultCurrency: 'INR' }],
  ['sbi',         { name: 'SBI',           defaultCurrency: 'INR' }],
  ['axis',        { name: 'Axis Bank',     defaultCurrency: 'INR' }],
  ['kotak',       { name: 'Kotak Mahindra',defaultCurrency: 'INR' }],
  // Singapore / SEA
  ['dbs',         { name: 'DBS',           defaultCurrency: 'SGD' }],
  ['ocbc',        { name: 'OCBC',          defaultCurrency: 'SGD' }],
  ['uob',         { name: 'UOB',           defaultCurrency: 'SGD' }],
  ['grabpay',     { name: 'GrabPay',       defaultCurrency: 'SGD' }],
  // Middle East
  ['emiratesnbd', { name: 'Emirates NBD',  defaultCurrency: 'AED' }],
  ['fab',         { name: 'FAB',           defaultCurrency: 'AED' }],
  ['alrajhi',     { name: 'Al Rajhi Bank', defaultCurrency: 'SAR' }],
  ['qnb',         { name: 'QNB',           defaultCurrency: 'QAR' }],
  // Latin America
  ['nubank',      { name: 'Nubank',        defaultCurrency: 'BRL' }],
  ['itau',        { name: 'Itaú',          defaultCurrency: 'BRL' }],
  ['bradesco',    { name: 'Bradesco',      defaultCurrency: 'BRL' }],
  ['mercadopago', { name: 'Mercado Pago',  defaultCurrency: 'BRL' }],
  ['bbvamx',      { name: 'BBVA Mexico',   defaultCurrency: 'MXN' }],
  ['bancolombia', { name: 'Bancolombia',   defaultCurrency: 'COP' }],
  ['nequi',       { name: 'Nequi',         defaultCurrency: 'COP' }],
  // International / Online
  ['revolut',    { name: 'Revolut',       defaultCurrency: 'EUR' }],
  ['wise',       { name: 'Wise',          defaultCurrency: 'EUR' }],
  ['paypal',     { name: 'PayPal',        defaultCurrency: 'USD' }],
  // ── Part 1: Payment systems (type: card) ──
  ['visa',       { name: 'Visa',          defaultCurrency: 'USD' }],
  ['mastercard', { name: 'Mastercard',    defaultCurrency: 'USD' }],
  ['mir',        { name: 'Карта Мир',     defaultCurrency: 'RUB' }],
  ['unionpay',   { name: 'UnionPay',      defaultCurrency: 'CNY' }],
  ['jcb',        { name: 'JCB',           defaultCurrency: 'JPY' }],
  ['dinersclub', { name: 'Diners Club',   defaultCurrency: 'USD' }],
  ['maestro',    { name: 'Maestro',       defaultCurrency: 'EUR' }],
  ['troy',       { name: 'Troy',          defaultCurrency: 'TRY' }],
  ['belkart',    { name: 'Белкарт',      defaultCurrency: 'BYN' }],
  ['prostir',    { name: 'Простір',       defaultCurrency: 'UAH' }],
]);

// ─────────────────────────────────────────────────────────────
// Exchange preset allowlist (SEC-01)
// ─────────────────────────────────────────────────────────────

export const EXCHANGE_PRESETS: ReadonlyMap<string, string> = new Map([
  ['binance',   'Binance'],
  ['bybit',     'Bybit'],
  ['okx',       'OKX'],
  ['coinbase',  'Coinbase'],
  ['kraken',    'Kraken'],
  ['kucoin',    'KuCoin'],
  ['gateio',    'Gate.io'],
  ['htx',       'HTX'],
  ['bitget',    'Bitget'],
  ['mexc',      'MEXC'],
  ['bitfinex',  'Bitfinex'],
  ['gemini',    'Gemini'],
  ['cryptocom', 'Crypto.com'],
  ['bingx',     'BingX'],
  ['phemex',    'Phemex'],
  ['whitebit',  'WhiteBIT'],
  ['bitstamp',  'Bitstamp'],
  ['poloniex',  'Poloniex'],
  ['bitmart',   'BitMart'],
  ['coinex',    'CoinEx'],
  ['lbank',     'LBank'],
  ['deribit',   'Deribit'],
  ['ascendex',  'AscendEX'],
  ['xtcom',     'XT.com'],
  ['probit',    'ProBit'],
  ['upbit',     'Upbit'],
  ['bithumb',   'Bithumb'],
  ['huobi',     'Huobi'],
  ['okcoin',     'OKCoin'],
  ['bitrue',     'Bitrue'],
  ['exmo',       'EXMO'],
  ['stormgain',  'StormGain'],
  ['primexbt',   'PrimeXBT'],
  ['margex',     'Margex'],
  ['bitso',      'Bitso'],
  ['luno',       'Luno'],
  ['paxful',     'Paxful'],
  ['korbit',     'Korbit'],
  ['coinone',    'CoinOne'],
  ['bitflyer',   'bitFlyer'],
  ['coincheck',  'Coincheck'],
  ['zaif',       'Zaif'],
  ['ndax',       'NDAX'],
  ['newton',     'Newton'],
  ['independentreserve', 'Independent Reserve'],
  ['swyftx',     'Swyftx'],
  ['coinspot',   'CoinSpot'],
  ['hashkey',    'HashKey'],
  ['currencycom','Currency.com'],
  ['changelly',  'Changelly'],
  ['changenow',  'ChangeNow'],
  ['simpleswap', 'SimpleSwap'],
  ['uniswap',    'Uniswap'],
  ['pancakeswap','PancakeSwap'],
  ['dydx',       'dYdX'],
  ['hyperliquid','Hyperliquid'],
  ['jupiter',    'Jupiter'],
  ['oneinch',    '1inch'],
  ['p2pb2b',     'P2PB2B'],
  ['latoken',    'LATOKEN'],
  ['garantex',   'Garantex'],
]);

// ─────────────────────────────────────────────────────────────
// Wallet preset allowlist (SEC-01)
// ─────────────────────────────────────────────────────────────

export const WALLET_PRESETS: ReadonlyMap<string, string> = new Map([
  ['metamask',   'MetaMask'],
  ['trust',      'Trust Wallet'],
  ['phantom',    'Phantom'],
  ['exodus',     'Exodus'],
  ['ledger',     'Ledger'],
  ['trezor',     'Trezor'],
  ['atomic',     'Atomic Wallet'],
  ['cbwallet',   'Coinbase Wallet'],
  ['safepal',    'SafePal'],
  ['tangem',     'Tangem'],
  ['keepkey',    'KeepKey'],
  ['coldcard',   'Coldcard'],
  ['keystone',   'Keystone'],
  ['zengo',      'ZenGo'],
  ['argent',     'Argent'],
  ['rainbow',    'Rainbow'],
  ['rabby',      'Rabby'],
  ['okxwallet',  'OKX Wallet'],
  ['bitgetwallet','Bitget Wallet'],
  ['imtoken',    'imToken'],
  ['tokenpocket','TokenPocket'],
  ['electrum',   'Electrum'],
  ['bluewallet', 'Blue Wallet'],
  ['muun',       'Muun'],
  ['sparrow',    'Sparrow'],
  ['gnosis',     'Safe (Gnosis)'],
  ['frame',      'Frame'],
  ['mathwallet', 'Math Wallet'],
  // ── Part 3A: Browser extension wallets ──
  ['bravewallet','Brave Wallet'],
  ['keplr',      'Keplr'],
  ['petra',      'Petra'],
  ['nami',       'Nami'],
  ['yoroi',      'Yoroi'],
  ['eternl',     'Eternl'],
  ['talisman',   'Talisman'],
  ['subwallet',  'SubWallet'],
  ['corewallet', 'Core Wallet'],
  ['xdefi',      'XDEFI'],
  ['glow',       'Glow'],
  ['solflare',   'Solflare'],
  ['backpack',   'Backpack'],
  ['onto',       'ONTO'],
  ['coin98',     'Coin98'],
  ['zerion',     'Zerion'],
  // ── Part 3D: Hardware wallets ──
  ['bitbox',     'BitBox02'],
  ['ellipal',    'Ellipal'],
  ['foundation', 'Foundation Passport'],
  ['jade',       'Blockstream Jade'],
  ['ngrave',     'Ngrave Zero'],
  ['dcent',      "D'CENT"],
  ['secux',      'SecuX'],
  // ── Part 3E: Mobile wallets ──
  ['mycelium',   'Mycelium'],
  ['guarda',     'Guarda'],
  ['unstoppable','Unstoppable Wallet'],
  ['blockchaincom','Blockchain.com'],
  ['cryptodfi',  'Crypto.com DeFi Wallet'],
  ['bybitweb3',  'Bybit Web3'],
  ['alphawallet','Alpha Wallet'],
  ['status',     'Status'],
  ['uniswapwallet','Uniswap Wallet'],
  ['pillar',     'Pillar'],
]);

// ─────────────────────────────────────────────────────────────
// E-Wallet preset allowlist (SEC-01)
// ─────────────────────────────────────────────────────────────

export const EWALLET_PRESETS: ReadonlyMap<string, { name: string; defaultCurrency: string }> = new Map([
  // RU/CIS e-wallets
  ['yoomoney',     { name: 'ЮМoney',          defaultCurrency: 'RUB' }],
  ['qiwi',         { name: 'QIWI',             defaultCurrency: 'RUB' }],
  ['webmoney',     { name: 'WebMoney',         defaultCurrency: 'RUB' }],
  ['payeer',       { name: 'Payeer',           defaultCurrency: 'USD' }],
  ['advcash',      { name: 'AdvCash',          defaultCurrency: 'USD' }],
  ['volet',        { name: 'Volet',            defaultCurrency: 'USD' }],
  ['perfectmoney', { name: 'Perfect Money',    defaultCurrency: 'USD' }],
  ['capitalist',   { name: 'Capitalist',       defaultCurrency: 'USD' }],
  ['epayments',    { name: 'ePayments',        defaultCurrency: 'USD' }],
  // International e-wallets
  ['skrill',       { name: 'Skrill',           defaultCurrency: 'EUR' }],
  ['neteller',     { name: 'Neteller',         defaultCurrency: 'USD' }],
  ['payoneer',     { name: 'Payoneer',         defaultCurrency: 'USD' }],
  ['paysera',      { name: 'Paysera',          defaultCurrency: 'EUR' }],
  ['alipay',       { name: 'Alipay',           defaultCurrency: 'CNY' }],
  ['wechatpay',    { name: 'WeChat Pay',       defaultCurrency: 'CNY' }],
  ['paytm',        { name: 'Paytm',            defaultCurrency: 'INR' }],
  ['gcash',        { name: 'GCash',            defaultCurrency: 'PHP' }],
  ['dana',         { name: 'DANA',             defaultCurrency: 'IDR' }],
  ['ovo',          { name: 'OVO',              defaultCurrency: 'IDR' }],
  ['stripe',       { name: 'Stripe',           defaultCurrency: 'USD' }],
]);

// ─────────────────────────────────────────────────────────────
// TON/Telegram wallet preset allowlist (SEC-01)
// ─────────────────────────────────────────────────────────────

export const TON_WALLET_PRESETS: ReadonlyMap<string, string> = new Map([
  ['telegramwallet', 'Telegram Wallet'],
  ['tonkeeper',      'Tonkeeper'],
  ['tonspace',       'TON Space'],
  ['mytonwallet',    'MyTonWallet'],
  ['tonhub',         'Tonhub'],
  ['tonwallet',      'TON Wallet'],
  ['bitkeep',        'BitKeep TON'],
]);

// ─────────────────────────────────────────────────────────────
// Lightning wallet preset allowlist (SEC-01)
// ─────────────────────────────────────────────────────────────

export const LIGHTNING_PRESETS: ReadonlyMap<string, string> = new Map([
  ['phoenix',          'Phoenix'],
  ['breez',            'Breez'],
  ['zeus',             'Zeus'],
  ['strike',           'Strike'],
  ['alby',             'Alby'],
  ['muun',             'Muun'],
  ['bluewallet',       'Blue Wallet'],
  ['walletofsatoshi',  'Wallet of Satoshi'],
  ['blink',            'Blink'],
  ['river',            'River'],
  ['speed',            'Speed'],
]);

// ─────────────────────────────────────────────────────────────
// Currency flags & names (master_roadmap 1.2)
// ─────────────────────────────────────────────────────────────

/**
 * Flag emoji or symbol per currency code.
 * Fiat: country flags. Crypto: token symbols.
 */
export const CURRENCY_FLAGS: Record<string, string> = {
  // Fiat
  RUB: '🇷🇺', USD: '🇺🇸', EUR: '🇪🇺', UAH: '🇺🇦', GBP: '🇬🇧',
  PLN: '🇵🇱', CHF: '🇨🇭', KZT: '🇰🇿', BYN: '🇧🇾', GEL: '🇬🇪',
  CZK: '🇨🇿', TRY: '🇹🇷', AED: '🇦🇪', CNY: '🇨🇳', JPY: '🇯🇵',
  KRW: '🇰🇷', INR: '🇮🇳', BRL: '🇧🇷', MXN: '🇲🇽', CAD: '🇨🇦',
  AUD: '🇦🇺', SEK: '🇸🇪', NOK: '🇳🇴', DKK: '🇩🇰', HUF: '🇭🇺',
  RON: '🇷🇴', UZS: '🇺🇿', SGD: '🇸🇬', HKD: '🇭🇰', ZAR: '🇿🇦',
  THB: '🇹🇭', PHP: '🇵🇭', IDR: '🇮🇩', MYR: '🇲🇾', SAR: '🇸🇦',
  QAR: '🇶🇦', AMD: '🇦🇲', AZN: '🇦🇿', MDL: '🇲🇩', BGN: '🇧🇬',
  // Crypto
  BTC: '₿', ETH: 'Ξ', USDT: '💵', SOL: '◎', TON: '🔷',
  BNB: '◆', USDC: '💲', XRP: '✕', TRX: '⚡', DOGE: '🐕',
  ADA: '₳', DOT: '●', AVAX: '🔺', NEAR: '🌐', ATOM: '⚛️',
  LTC: 'Ł', MATIC: '🟣', DAI: '◈', NOT: '🎯', DOGS: '🐶',
};

/** Returns flag/symbol for currency code, or empty string if not found. */
export function getCurrencyFlag(code: string): string {
  return CURRENCY_FLAGS[code.toUpperCase()] ?? '';
}

/**
 * CURRENCY_NAMES: code → search tokens (RU + EN).
 * Used by searchCurrencies() for fuzzy matching.
 */
export const CURRENCY_NAMES: Record<string, string> = {
  RUB: 'рубль рублей ruble russia', USD: 'доллар dollar usa america',
  EUR: 'евро euro europe', UAH: 'гривна гривень hryvnia ukraine',
  GBP: 'фунт pound sterling britain uk', PLN: 'злотый zloty poland',
  CHF: 'франк franc switzerland', KZT: 'тенге tenge kazakhstan',
  BYN: 'беларусь belrus ruble', GEL: 'лари lari georgia',
  CZK: 'крона koruna czech', TRY: 'лира lira turkey',
  AED: 'дирхам dirham uae dubai', CNY: 'юань yuan china renminbi',
  JPY: 'иена yen japan', KRW: 'вон won korea',
  INR: 'рупия rupee india', BRL: 'реал real brazil',
  MXN: 'песо peso mexico', CAD: 'канадский доллар canada',
  AUD: 'австралийский доллар australia', SEK: 'крона krone sweden',
  NOK: 'крона krone norway', DKK: 'крона krone denmark',
  SGD: 'доллар dollar singapore', HKD: 'гонконг hong kong',
  BTC: 'биткоин bitcoin btc', ETH: 'эфириум эфир ethereum ether',
  USDT: 'тезер tether stablecoin usdt', SOL: 'солана solana',
  TON: 'тон telegram ton', BNB: 'бинанс binance bnb',
  USDC: 'юсдс usdc stablecoin', XRP: 'рипл ripple xrp',
  TRX: 'трон tron trx', DOGE: 'додж dogecoin doge',
  ADA: 'кардано cardano ada', DOT: 'полкадот polkadot dot',
  AVAX: 'авалянч avalanche avax', NEAR: 'нир near protocol',
  ATOM: 'козм cosmos atom', LTC: 'лайткоин litecoin ltc',
  MATIC: 'матик polygon matic', DAI: 'дай dai stablecoin',
  NOT: 'нотоин notcoin not', DOGS: 'dogs meme token',
};


export const PROVIDER_ICONS: ReadonlyMap<string, string> = new Map([
  // Banks
  ['sber', '🟢'], ['tinkoff', '🟡'], ['alfa', '🔴'], ['vtb', '🔵'],
  ['mono', '⬛'], ['privat', '🟢'], ['oschad', '🔵'],
  ['binance', '🟠'], ['bybit', '🔶'], ['okx', '⚫'], ['coinbase', '🔵'],
  ['kraken', '🟣'], ['kucoin', '🟢'],
  ['metamask', '🦊'], ['ledger', '🔒'], ['trezor', '🛡️'],
  ['phantom', '👻'], ['trust', '🛡️'],
  ['telegramwallet', '📲'], ['tonkeeper', '📲'], ['tonspace', '📲'],
  ['phoenix', '⚡'], ['breez', '⚡'], ['zeus', '⚡'], ['strike', '⚡'],
  ['yoomoney', '🟡'], ['qiwi', '🦃'], ['webmoney', '🟣'],
  ['visa', '💳'], ['mastercard', '💳'], ['mir', '💳'],
]);

/** Returns emoji icon for provider key, fallback to account type default */
export function getProviderIcon(
  providerKey: string | undefined,
  accountType: string,
  walletSubtype?: string,
): string {
  if (providerKey) {
    const icon = PROVIDER_ICONS.get(providerKey.toLowerCase());
    if (icon) return icon;
  }
  // Fallback by type
  if (accountType === 'cash') return '💵';
  if (accountType === 'exchange') return '🔄';
  if (accountType === 'wallet') {
    if (walletSubtype === 'ewallet') return '📱';
    if (walletSubtype === 'ton') return '📲';
    if (walletSubtype === 'lightning') return '⚡';
    return '💎';
  }
  return '💳';
}

/** Capitalize first character of any string */
export function capitalizeFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─────────────────────────────────────────────────────────────
// TON currency presets (TON-ecosystem focused)
// ─────────────────────────────────────────────────────────────

export const TON_CURRENCY_PRESETS = [
  'TON', 'USDT', 'BTC', 'ETH', 'NOT', 'DOGS', 'USDC',
] as const;

// ─────────────────────────────────────────────────────────────
// Currency presets — split by asset class
// Banks/Cash → fiat only. Exchanges/Wallets → crypto only.
// Custom → all common currencies.
// ─────────────────────────────────────────────────────────────

/** Fiat currencies for banks and cash accounts (~30). */
export const FIAT_CURRENCY_PRESETS = [
  'USD', 'EUR', 'RUB', 'UAH', 'GBP', 'PLN',
  'CZK', 'HUF', 'RON', 'TRY', 'KZT', 'BYN',
  'GEL', 'UZS', 'SEK', 'NOK', 'DKK', 'CHF',
  'CAD', 'AUD', 'JPY', 'CNY', 'INR', 'AED',
  'SGD', 'HKD', 'BRL', 'ZAR', 'MXN', 'THB',
] as const;

/** Crypto currencies for exchanges and wallets (~18). */
export const CRYPTO_CURRENCY_PRESETS = [
  'USDT', 'BTC',  'ETH',  'BNB',  'SOL',  'USDC',
  'XRP',  'TRX',  'DOGE', 'ADA',  'DOT',  'AVAX',
  'TON',  'NEAR', 'ATOM', 'LTC',  'MATIC','DAI',
] as const;

/** Mixed currencies for custom account type. */
const CUSTOM_CURRENCY_PRESETS = ['USD', 'EUR', 'RUB', 'USDT', 'BTC', 'ETH'] as const;

// ─────────────────────────────────────────────────────────────
// Callback_data parsed type
// ─────────────────────────────────────────────────────────────

export type AccountOnboardCmd =
  | { cmd: 'type'; accountType: 'card' | 'cash' | 'exchange' | 'wallet' | 'custom' }
  | { cmd: 'bank_preset'; key: string; name: string; defaultCurrency: string }
  | { cmd: 'bank_custom' }
  | { cmd: 'exchange_preset'; key: string; name: string }
  | { cmd: 'exchange_custom' }
  | { cmd: 'wallet_preset'; key: string; name: string }
  | { cmd: 'wallet_custom' }
  | { cmd: 'currency'; code: string }
  | { cmd: 'currency_custom' }
  | { cmd: 'skip' }
  | { cmd: 'more' }
  | { cmd: 'done' }
  | { cmd: 'open' }    // Phase 1.37-UX: open full account type picker from start 2-button keyboard
  | { cmd: 'bank_page';     page: number } // Phase 2.2: pagination
  | { cmd: 'exchange_page'; page: number } // Phase 2.2
  | { cmd: 'fiat_page';     page: number } // Phase 2.2
  | { cmd: 'crypto_page';   page: number } // Phase 2.2
  | { cmd: 'bal_skip' }                    // Phase 2.2: skip initial balance
  | { cmd: 'fin' }                         // Phase 2.3: finish onboarding from type picker
  | { cmd: 'cus_ok' }                      // Phase 2.3: confirm fuzzy-matched name
  | { cmd: 'cus_keep' }                    // Phase 2.3: keep original typed name (reject suggestion)
  | { cmd: 'cus_save' }                    // master_roadmap: confirm custom name from no-match screen
  | { cmd: 'wallet_subtype'; subtype: WalletSubtype } // Phase 2.3: wallet sub-type selection
  | { cmd: 'type_back' }                   // Phase 2.3: back to type picker from wallet subtype
  | { cmd: 'cur_search' }                  // master_roadmap: open currency free-text search
  | { cmd: 'cur_list' };                   // master_roadmap: return to currency list from search

// ─────────────────────────────────────────────────────────────
// Parser — SEC-01 allowlist
// ─────────────────────────────────────────────────────────────

const ACCOUNT_TYPES = new Set(['card', 'cash', 'exchange', 'wallet', 'custom'] as const);
const CURRENCY_CODE_RE = /^[A-Z]{1,10}$/;

/**
 * Parse and validate an account onboarding callback_data string.
 * Returns null for any unrecognised or malformed input (SEC-01 allowlist).
 *
 * All type values validated against hardcoded allowlist.
 * All exchange preset keys validated against EXCHANGE_PRESETS map.
 * Currency codes validated as /^[A-Z]{1,10}$/ (broader than st: to allow custom tokens).
 */
export function parseAccountCallback(data: string): AccountOnboardCmd | null {
  if (!data.startsWith('ac:')) return null;

  const parts = data.split(':');
  // parts[0] = 'ac'
  const sub = parts[1] ?? '';

  if (sub === 'skip') return { cmd: 'skip' };
  if (sub === 'more') return { cmd: 'more' };
  if (sub === 'done') return { cmd: 'done' };
  if (sub === 'fin')  return { cmd: 'fin' };   // Phase 2.3: finish onboarding from type picker
  if (sub === 'open') return { cmd: 'open' };  // Phase 1.37-UX: open type picker
  // Phase 2.3 + master_roadmap: smart name confirm/reject/save
  if (sub === 'cus') {
    const act = parts[2] ?? '';
    if (act === 'ok')   return { cmd: 'cus_ok' };
    if (act === 'keep') return { cmd: 'cus_keep' };
    if (act === 'save') return { cmd: 'cus_save' };  // no-match confirm
    return null;
  }

  if (sub === 'type') {
    // Must check 'back' BEFORE ACCOUNT_TYPES to avoid null-return
    if (parts[2] === 'back') return { cmd: 'type_back' };
    const t = parts[2] ?? '';
    if (!ACCOUNT_TYPES.has(t as 'card')) return null;
    return { cmd: 'type', accountType: t as 'card' | 'cash' | 'exchange' | 'wallet' | 'custom' };
  }

  // Bank presets: ac:bnk:{key}
  if (sub === 'bnk') {
    const key = parts[2] ?? '';
    if (key === 'custom') return { cmd: 'bank_custom' };
    const info = BANK_PRESETS.get(key);
    if (!info) return null;
    return { cmd: 'bank_preset', key, name: info.name, defaultCurrency: info.defaultCurrency };
  }

  // Exchange presets: ac:xch:{key}
  if (sub === 'xch') {
    const key = parts[2] ?? '';
    if (key === 'custom') return { cmd: 'exchange_custom' };
    const name = EXCHANGE_PRESETS.get(key);
    if (!name) return null;
    return { cmd: 'exchange_preset', key, name };
  }

  // Wallet presets: ac:wal:{key}
  if (sub === 'wal') {
    const key = parts[2] ?? '';
    if (key === 'custom') return { cmd: 'wallet_custom' };
    const name = WALLET_PRESETS.get(key);
    if (!name) return null;
    return { cmd: 'wallet_preset', key, name };
  }

  // Wallet sub-type picker: ac:wsub:{subtype}
  if (sub === 'wsub') {
    const subtype = parts[2] ?? '';
    const WSUB_ALLOWLIST = new Set<WalletSubtype>(['crypto', 'ewallet', 'ton', 'lightning']);
    if (!WSUB_ALLOWLIST.has(subtype as WalletSubtype)) return null;
    return { cmd: 'wallet_subtype', subtype: subtype as WalletSubtype };
  }

  if (sub === 'cur') {
    const code = parts[2] ?? '';
    if (code === 'custom') return { cmd: 'currency_custom' };
    if (code === 'search') return { cmd: 'cur_search' }; // master_roadmap 1.8
    if (code === 'list')   return { cmd: 'cur_list' };   // master_roadmap 1.8
    if (!CURRENCY_CODE_RE.test(code)) return null;
    return { cmd: 'currency', code };
  }

  // Phase 2.2: pagination callbacks
  // ac:bp:{N}   → bank_page
  // ac:xp:{N}   → exchange_page
  // ac:cfp:{N}  → fiat_page
  // ac:ccp:{N}  → crypto_page
  // ac:bal:s    → bal_skip
  if (sub === 'bp') {
    const page = parseInt(parts[2] ?? '', 10);
    if (isNaN(page) || page < 0 || page > 99) return null;
    return { cmd: 'bank_page', page };
  }
  if (sub === 'xp') {
    const page = parseInt(parts[2] ?? '', 10);
    if (isNaN(page) || page < 0 || page > 99) return null;
    return { cmd: 'exchange_page', page };
  }
  if (sub === 'cfp') {
    const page = parseInt(parts[2] ?? '', 10);
    if (isNaN(page) || page < 0 || page > 99) return null;
    return { cmd: 'fiat_page', page };
  }
  if (sub === 'ccp') {
    const page = parseInt(parts[2] ?? '', 10);
    if (isNaN(page) || page < 0 || page > 99) return null;
    return { cmd: 'crypto_page', page };
  }
  if (sub === 'bal') {
    const act = parts[2] ?? '';
    if (act === 's') return { cmd: 'bal_skip' };
    return null;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// Start keyboards
// ─────────────────────────────────────────────────────────────


/**
 * Phase 1.37-UX: Minimal 2-button keyboard for /start new user flow.
 * Replaces the 5-button keyboard to eliminate cognitive overload.
 *
 *   [➕ Добавить счёт]    → ac:open  → shows full account type picker (edit in-place)
 *   [▶️ Начать без счёта] → ac:skip  → dismiss, default account is already created
 *
 * ReplyKeyboard is NOT sent here — it activates after account creation or first confirmed tx.
 */
export function buildStartSimpleKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '➕ Добавить счёт',     callback_data: 'ac:open' },
        { text: '▶️ Начать без счёта', callback_data: 'ac:skip' },
      ],
    ],
  };
}

/**
 * Build the guided /start account type keyboard for new users.
 * Updated label: '🔐 Кошелёк' (generic) — sub-type chosen on next screen.
 */
export function buildStartOnboardKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '💳 Банковская карта', callback_data: 'ac:type:card' },
        { text: '💵 Наличные',         callback_data: 'ac:type:cash' },
      ],
      [
        { text: '🔄 Крипто-биржа',  callback_data: 'ac:type:exchange' },
        { text: '🔐 Кошелёк',           callback_data: 'ac:type:wallet' },
      ],
      [{ text: '✏️ Своё название', callback_data: 'ac:type:custom' }],
    ],
  };
}

/**
 * Wallet sub-type picker — Экран 2А.
 * Lets user choose wallet category before entering a name.
 * Each sub-type drives the correct currency pool on Экран 4.
 *
 *   ac:wsub:crypto    → crypto currencies
 *   ac:wsub:ewallet   → fiat currencies
 *   ac:wsub:ton       → TON-ecosystem currencies
 *   ac:wsub:lightning → BTC fixed (no currency picker)
 */
export function buildWalletSubtypeKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '💎 Кошелёк',              callback_data: 'ac:wsub:crypto' },
        { text: '📱 Электронный',            callback_data: 'ac:wsub:ewallet' },
      ],
      [
        { text: '📲 Кошелёк в Telegram',   callback_data: 'ac:wsub:ton' },
        { text: '⚡ Lightning',               callback_data: 'ac:wsub:lightning' },
      ],
      [{ text: '◀️ К типу счёта', callback_data: 'ac:type:back' }],
    ],
  };
}

// ─────────────────────────────────────────────────────────────
// Progress header helper
// ─────────────────────────────────────────────────────────────

/** Total steps by account type + wallet sub-type */
export function getStepTotal(
  accountType: string,
  walletSubtype?: string,
): number {
  if (accountType === 'cash') return 4;      // type → currency → balance → done
  if (accountType === 'wallet') {
    if (walletSubtype === 'lightning') return 5; // type → sub → name → balance → done
    return 6; // type → sub → name → confirm → currency → balance → done
  }
  return 5; // card / exchange: type → name → confirm → currency → balance → done
}

/** Builds header line: «💳 Банковская карта · Шаг 3 из 5» */
export function buildStepHeader(
  accountType: string,
  currentStep: number,
  walletSubtype?: string,
): string {
  const labels: Record<string, string> = {
    card: '💳 Банковская карта',
    cash: '💵 Наличные',
    exchange: '🔄 Крипто-биржа',
    wallet_crypto: '💎 Крипто-кошелёк',
    wallet_ewallet: '📱 Электронный кошелёк',
    wallet_ton: '📲 Кошелёк в Telegram',
    wallet_lightning: '⚡ Lightning',
    custom: '✏️ Свой счёт',
  };
  const key = accountType === 'wallet' && walletSubtype
    ? `wallet_${walletSubtype}`
    : accountType;
  const label = labels[key] ?? accountType;
  const total = getStepTotal(accountType, walletSubtype);
  return `${label} · Шаг ${currentStep} из ${total}`;
}

// ─────────────────────────────────────────────────────────────
// Input prompt builders (Экраны 2Б / re-prompt after «Другой»)
// ─────────────────────────────────────────────────────────────

const INPUT_PROMPT_EXAMPLES: Record<string, string[]> = {
  card:      ['Тинькофф', 'Монобанк', 'Visa', 'Мир'],
  exchange:  ['Binance', 'Bybit', 'OKX', 'WhiteBIT'],
  crypto:    ['MetaMask', 'Ledger', 'Phantom', 'Zerion'],
  ewallet:   ['ЮМoney', 'QIWI', 'Skrill', 'Payoneer'],
  ton:       ['Telegram Wallet', 'Tonkeeper', 'TON Space'],
  lightning: ['Phoenix', 'Breez', 'Zeus', 'Strike'],
};

const REPROMPT_EXAMPLES: Record<string, string[]> = {
  card:      ['Сбербанк', 'Альфа-Банк', 'Mastercard', 'Простір'],
  exchange:  ['KuCoin', 'Kraken', 'MEXC', 'Gate.io'],
  crypto:    ['Trust Wallet', 'Exodus', 'Rabby', 'Backpack'],
  ewallet:   ['WebMoney', 'Payeer', 'Neteller', 'Alipay'],
  ton:       ['MyTonWallet', 'Tonhub', 'TON Wallet'],
  lightning: ['Alby', 'Muun', 'Wallet of Satoshi', 'Blue Wallet'],
};

/** Question label for input prompt */
const INPUT_QUESTIONS: Record<string, string> = {
  card:      '🏦 Как называется ваш банк?',
  exchange:  '📊 Какая биржа?',
  crypto:    '🔐 Какой кошелёк используете?',
  ewallet:   '📱 Какой e-кошелёк используете?',
  ton:       '📲 Какой TON-кошелёк используете?',
  lightning: '⚡ Какой Lightning-кошелёк?',
};

const TYPE_FULL_LABELS: Record<string, string> = {
  card:             '💳 Банковская карта',
  cash:             '💵 Наличные',
  exchange:         '🔄 Крипто-биржа',
  custom:           '✏️ Свой счёт',
  wallet_crypto:    '💎 Кошелёк',
  wallet_ewallet:   '📱 Электронный кошелёк',
  wallet_ton:       '📲 Кошелёк в Telegram',
  wallet_lightning: '⚡ Lightning',
};



/** Builds the initial name-input prompt text (Экран 2Б) — clean, blockquote for examples */
export function buildInputPromptText(
  accountType: string,
  walletSubtype?: string,
  _stepN?: number,
  _stepTotal?: number,
): string {
  const key = walletSubtype ?? accountType;
  const labelKey = accountType === 'wallet' && walletSubtype ? `wallet_${walletSubtype}` : accountType;
  const header   = TYPE_FULL_LABELS[labelKey] ?? accountType;
  const question = INPUT_QUESTIONS[key] ?? 'Введите название:';
  const examples = (INPUT_PROMPT_EXAMPLES[key] ?? []).slice(0, 3).map((e) => `«${e}»`).join(', ');
  return (
    `<b>${header}</b>\n\n` +
    `${question}\n` +
    `<blockquote>Например: ${examples}</blockquote>`
  );
}

/** Builds re-prompt after «✏️ Другое название» — blockquote for examples */
export function buildFreeTextPromptText(
  accountType: string,
  walletSubtype?: string,
): string {
  const key = walletSubtype ?? accountType;
  const labels: Record<string, string> = {
    card: 'банка', exchange: 'биржи', crypto: 'кошелька',
    ewallet: 'кошелька', ton: 'TON-кошелька', lightning: 'Lightning-кошелька',
  };
  const label   = labels[key] ?? 'счёта';
  const examples = (REPROMPT_EXAMPLES[key] ?? []).slice(0, 3).map((e) => `«${e}»`).join(', ');
  return (
    `✏️ <b>Другое название</b>\n\n` +
    `Введите название ${label}:\n` +
    `<blockquote>Например: ${examples}</blockquote>`
  );
}

/** Keyboard for free-text re-prompt (back button only) */
export function buildFreeTextPromptKeyboard(
  backTarget: 'type' | 'subtype',
): InlineKeyboardMarkup {
  const backCb = backTarget === 'subtype' ? 'ac:type:wallet' : 'ac:type:back';
  const backLabel = backTarget === 'subtype' ? '◀️ К типу кошелька' : '◀️ К типу счёта';
  return { inline_keyboard: [[{ text: backLabel, callback_data: backCb }]] };
}

// ─────────────────────────────────────────────────────────────
// Success screen text builder (Экран 6)
// ─────────────────────────────────────────────────────────────

/**
 * Builds the final «Готово. Можно начинать.» message text.
 * Matches the format from the Phase 2.3 success screen.
 * name/currency/balance come from createdAccount* state fields.
 */
export function buildSuccessScreenText(
  name: string,
  currency: string,
  balance?: string,
  icon = '💳',
): string { // eslint-disable-line @typescript-eslint/no-unused-vars — icon used below
  const balanceLine = balance
    ? ` · ${balance}`
    : '';
  return (
    `✅ <b>Готово. Можно начинать.</b>\n\n` +
    `Запишите первую операцию — просто напишите \n` +
    `что потратили или получили:\n` +
    `<i>«кофе 350» · «зарплата 5000» · «перевод Максу 200»</i>\n\n` +
    `Midas распознает сумму, тип и категорию автоматически.\n\n` +
    `<b>Счёт по умолчанию:</b> ${icon} ${name} · ${currency}${balanceLine}\n` +
    `<i>Добавить карты и биржи → 🏦 Баланс</i>`
  );
}

// ─────────────────────────────────────────────────────────────
// Universal paginator (Phase 2.2)
// ─────────────────────────────────────────────────────────────

const DEFAULT_COLS = 3;
const DEFAULT_PER_PAGE = 6;

/**
 * Build a paginated InlineKeyboardMarkup for any list of items.
 *
 * Layout per page:
 *   Row 1..N : cols items each
 *   Nav row  : [◀️ Назад] [N/Total] [Вперёд ▶️]  (hidden if only 1 page)
 *   Last row : customLabel button
 *
 * @param items          Full list of {key, label} items
 * @param page           0-indexed current page
 * @param callbackPrefix Prefix for item callbacks, e.g. 'ac:bnk:'
 * @param pagePrefix     Prefix for page nav callbacks, e.g. 'ac:bp:'
 * @param customLabel    Label of the freeform button, e.g. '✏️ Другой банк'
 * @param customCallback callback_data for freeform button, e.g. 'ac:bnk:custom'
 * @param cols           Items per row (default 3)
 * @param perPage        Items per page (default 6)
 */
function buildPaginatedPicker(
  items: ReadonlyArray<{ key: string; label: string }>,
  page: number,
  callbackPrefix: string,
  pagePrefix: string,
  customLabel: string,
  customCallback: string,
  cols: number = DEFAULT_COLS,
  perPage: number = DEFAULT_PER_PAGE,
): InlineKeyboardMarkup {
  const totalPages = Math.max(1, Math.ceil(items.length / perPage));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const pageItems = items.slice(safePage * perPage, safePage * perPage + perPage);

  // Build item rows
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  for (let i = 0; i < pageItems.length; i += cols) {
    rows.push(
      pageItems.slice(i, i + cols).map((item) => ({
        text: item.label,
        callback_data: `${callbackPrefix}${item.key}`,
      })),
    );
  }

  // Navigation row — always show both arrows (master_roadmap 1.3)
  // At edge pages: arrow still shown but points to ac:noop (no action)
  if (totalPages > 1) {
    const navRow: Array<{ text: string; callback_data: string }> = [];
    navRow.push(
      safePage > 0
        ? { text: '◀️', callback_data: `${pagePrefix}${String(safePage - 1)}` }
        : { text: '◀️', callback_data: 'ac:noop' },
    );
    navRow.push({ text: `${String(safePage + 1)}/${String(totalPages)}`, callback_data: 'ac:noop' });
    navRow.push(
      safePage < totalPages - 1
        ? { text: '▶️', callback_data: `${pagePrefix}${String(safePage + 1)}` }
        : { text: '▶️', callback_data: 'ac:noop' },
    );
    rows.push(navRow);
  }

  // Custom (freeform) button always at the bottom
  rows.push([{ text: customLabel, callback_data: customCallback }]);

  return { inline_keyboard: rows };
}

// ─────────────────────────────────────────────────────────────
// Bank items list (derived from BANK_PRESETS)
// ─────────────────────────────────────────────────────────────

const BANK_ITEMS: ReadonlyArray<{ key: string; label: string }> = Array.from(BANK_PRESETS.entries()).map(
  ([key, info]) => ({ key, label: info.name }),
);

const EXCHANGE_ITEMS: ReadonlyArray<{ key: string; label: string }> = Array.from(EXCHANGE_PRESETS.entries()).map(
  ([key, name]) => ({ key, label: name }),
);


// ─────────────────────────────────────────────────────────────
// Paginated keyboard builders (Phase 2.2)
// ─────────────────────────────────────────────────────────────

/** Bank picker — paginated. page=0 is the first page. */
export function buildBankPickerPage(page: number): InlineKeyboardMarkup {
  return buildPaginatedPicker(
    BANK_ITEMS, page, 'ac:bnk:', 'ac:bp:', '\u270f\ufe0f Другой банк', 'ac:bnk:custom',
  );
}

/** Exchange picker — paginated. */
export function buildExchangePickerPage(page: number): InlineKeyboardMarkup {
  return buildPaginatedPicker(
    EXCHANGE_ITEMS, page, 'ac:xch:', 'ac:xp:', '\u270f\ufe0f Другая биржа', 'ac:xch:custom',
  );
}

/** Fiat currency picker — paginated. */
export function buildFiatCurrencyPage(page: number): InlineKeyboardMarkup {
  const items = FIAT_CURRENCY_PRESETS.map((code) => ({
    key: code,
    label: `${getCurrencyFlag(code)} ${code}`.trim(),
  }));
  return buildPaginatedPicker(
    items, page, 'ac:cur:', 'ac:cfp:', '\uD83D\uDD0D Найти валюту', 'ac:cur:search',
  );
}

/** Crypto currency picker — paginated. */
export function buildCryptoCurrencyPage(page: number): InlineKeyboardMarkup {
  const items = CRYPTO_CURRENCY_PRESETS.map((code) => ({
    key: code,
    label: `${getCurrencyFlag(code)} ${code}`.trim(),
  }));
  return buildPaginatedPicker(
    items, page, 'ac:cur:', 'ac:ccp:', '\uD83D\uDD0D Найти валюту', 'ac:cur:search',
  );
}

/** Bank picker keyboard (Phase 2.2 alias → page 0). */
export function buildBankPickerKeyboard(): InlineKeyboardMarkup {
  return buildBankPickerPage(0);
}

/** Account type keyboard — shown at /accounts empty-state and ac:open (Phase 2.2). */
export function buildAccountTypeKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '💳 Банковская карта', callback_data: 'ac:type:card' },
        { text: '💵 Наличные',         callback_data: 'ac:type:cash' },
      ],
      [
        { text: '🔄 Крипто-биржа',  callback_data: 'ac:type:exchange' },
        { text: '🔐 Кошелёк',         callback_data: 'ac:type:wallet' },
      ],
      [{ text: '✏️ Своё название', callback_data: 'ac:type:custom' }],
    ],
  };
}

/**
 * Phase 2.3: Type picker shown immediately after account creation.
 * Confirms last account and offers to add another or finish.
 */
export function buildFinishOnboardKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '💳 Банковская карта', callback_data: 'ac:type:card' },
        { text: '💵 Наличные',         callback_data: 'ac:type:cash' },
      ],
      [
        { text: '🔄 Крипто-биржа',  callback_data: 'ac:type:exchange' },
        { text: '🔐 Кошелёк',         callback_data: 'ac:type:wallet' },
      ],
      [{ text: '✏️ Своё название', callback_data: 'ac:type:custom' }],
      [{ text: '✅ Завершить',      callback_data: 'ac:fin' }],
    ],
  };
}

/**
 * Phase 2.3: Confirmation text shown after account creation — replaces afterCreate screen.
 * Displayed above buildFinishOnboardKeyboard.
 */
export function accountAddedText(name: string, currency: string): string {
  return `✅ <b>${name}</b> (${currency}) добавлен!\n\nДобавить ещё один счёт:`;
}

/** Exchange picker keyboard (Phase 2.2 alias → page 0). */
export function buildExchangePickerKeyboard(): InlineKeyboardMarkup {
  return buildExchangePickerPage(0);
}

/** Wallet picker keyboard (static — 8 presets, no pagination needed). */
export function buildWalletPickerKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: 'MetaMask',      callback_data: 'ac:wal:metamask' },
        { text: 'Trust Wallet',  callback_data: 'ac:wal:trust' },
        { text: 'Phantom',       callback_data: 'ac:wal:phantom' },
      ],
      [
        { text: 'Exodus',        callback_data: 'ac:wal:exodus' },
        { text: 'Ledger',        callback_data: 'ac:wal:ledger' },
        { text: 'Trezor',        callback_data: 'ac:wal:trezor' },
      ],
      [
        { text: 'Atomic Wallet', callback_data: 'ac:wal:atomic' },
        { text: 'CB Wallet',     callback_data: 'ac:wal:cbwallet' },
      ],
      [{ text: '✏️ Другой кошелёк', callback_data: 'ac:wal:custom' }],
    ],
  };
}

/** Fiat currency keyboard (Phase 2.2 alias → page 0). */
export function buildFiatCurrencyKeyboard(): InlineKeyboardMarkup {
  return buildFiatCurrencyPage(0);
}

/** Crypto currency keyboard (Phase 2.2 alias → page 0). */
export function buildCryptoCurrencyKeyboard(): InlineKeyboardMarkup {
  return buildCryptoCurrencyPage(0);
}

/**
 * Mixed currency picker — for custom account type.
 * Shows both fiat and crypto presets.
 */
export function buildOnboardCurrencyKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      CUSTOM_CURRENCY_PRESETS.slice(0, 3).map((code) => ({
        text: code,
        callback_data: `ac:cur:${code}`,
      })),
      CUSTOM_CURRENCY_PRESETS.slice(3, 6).map((code) => ({
        text: code,
        callback_data: `ac:cur:${code}`,
      })),
      [{ text: '✏️ Другая валюта', callback_data: 'ac:cur:custom' }],
    ],
  };
}

/**
 * Build the post-creation keyboard: add another or finish.
 */
export function buildAfterCreateKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '➕ Добавить ещё счёт', callback_data: 'ac:more' },
        { text: '✅ Готово',             callback_data: 'ac:done' },
      ],
    ],
  };
}

// ─────────────────────────────────────────────────────────────
// Message text helpers
// ─────────────────────────────────────────────────────────────

/** Text for empty /accounts guided prompt (Scenario Д). */
export const ACCOUNTS_EMPTY_TEXT =
  '🏦 <b>У тебя пока нет счетов.</b>\n\n' +
  'Счёт — это место где хранятся деньги:\n' +
  'карта, кошелёк, биржа, наличные.\n\n' +
  'Создай первый счёт:';

/**
 * Phase 1.37-UX: Welcome text for new user /start — single message, no ReplyKeyboard.
 * Professional, product-grade copy. No examples, no instructions.
 */
export const START_WELCOME_TEXT =
  '👋 <b>Добро пожаловать в Midas!</b>\n\n' +
  'Ваш финансовый ассистент на базе ИИ готов к работе.\n\n' +
  '🏦 Укажите, где хранятся ваши деньги — это позволит вести\n' +
  'точный учёт баланса по каждому счёту.';

/** Text for /start new user guided prompt (Scenario Е). */
export const START_ONBOARD_TEXT =
  '🏦 <b>Где хранишь деньги?</b>\n' +
  'Добавь свои счета (можно несколько):';

/**
 * Phase 1.37-UX: Activation message sent with ReplyKeyboard after account creation.
 * Signals to user that setup is complete and navigation is now available.
 */
export const SETUP_COMPLETE_TEXT =
  '✅ <b>Всё готово!</b>\n\n' +
  'Опишите любую операцию — бот распознает сумму, категорию и тип автоматически.';

/**
 * Phase 2.3: Message shown after user taps «▶️ Начать без счёта» (ac:skip).
 * Variant D1 — action-first, mentions the auto-created default account.
 * Sent with ReplyKeyboard (buildMainMenuKeyboard) so nav panel activates.
 */
export const SKIP_COMPLETE_TEXT =
  '✅ <b>Готово. Можно начинать.</b>\n\n' +
  'Запишите первую операцию — просто напишите что потратили или получили:\n' +
  '<i>«кофе 350» · «зарплата 5000» · «перевод Максу 200»</i>\n\n' +
  'Midas распознает сумму, тип и категорию автоматически.\n\n' +
  '<b>Счёт по умолчанию:</b> 💼 Основной · USDT\n' +
  '<i>Добавить карты и биржи → 💰 Баланс</i>';

/** Text for exchange picker step. */
export const EXCHANGE_PICKER_TEXT = 'Какая биржа?';

/** Text for currency picker step. */
export const CURRENCY_PICKER_TEXT = 'В какой валюте?';

/**
 * Context-aware currency picker header — shows account name in blockquote.
 * master_roadmap 1.4: extended signature with isCustom flag.
 *
 * @param name      Account name (preset or custom)
 * @param isCustom  True when name came via no-match / custom save
 */
export function buildCurrencyPickerText(name?: string, isCustom = false): string {
  if (!name) return '\uD83C\uDF0D В какой валюте ведёте счёт?';
  if (isCustom) {
    return `<blockquote>${name}  \u00b7  свой счёт</blockquote>\nВыберите валюту:`;
  }
  return `<blockquote>«${name}»</blockquote>\nВыберите валюту:`;
}

/** Prompt for free-text account name input. */
export function nameInputPrompt(accountType: string): string {
  const labels: Record<string, string> = {
    card:    '💳 Введите название банка:',
    wallet:  '₿ Введите название кошелька:',
    exchange: '🔶 Введите название биржи:',
    custom:  '✏️ Введите название счёта:',
  };
  return labels[accountType] ?? '✏️ Введите название счёта:';
}

/** Text for bank picker step. */
export const BANK_PICKER_TEXT = '💳 Выберите банк:';

/** Text for wallet picker step. */
export const WALLET_PICKER_TEXT = '₿ Выберите кошелёк:';

/** Prompt for free-text currency input. */
export const CURRENCY_INPUT_PROMPT =
  '💱 Введи код валюты (например: <i>SOL</i>, <i>MATIC</i>, <i>UAH</i>):';

// ─────────────────────────────────────────────────────────────
// Balance input step (Phase 2.2)
// ─────────────────────────────────────────────────────────────

/**
 * Prompt shown after account is created — asking for initial balance.
 * Includes ['⏩ Пропустить] button.
 */
export const BAL_INPUT_PROMPT =
  '💰 <b>Сколько сейчас на счёте?</b>\n\n' +
  'Напиши сумму цифрами, например: <i>15000</i>\n' +
  'Или пропусти — баланс можно синхронизировать позже.';

/**
 * Context-aware balance prompt — shows name · CURRENCY in blockquote.
 */
export function buildBalancePromptText(name: string, currency: string): string {
  return (
    `<blockquote>${name} · ${currency}</blockquote>\n` +
    `💰 Какой начальный баланс?\n\n` +
    `<i>Введите сумму или пропустите</i>`
  );
}

/**
 * Keyboard for the bal_input step.
 * Single button to skip balance input.
 * ac:bal:s → bal_skip → 8 bytes ✅
 */
export function buildSkipBalanceKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '⏩ Пропустить', callback_data: 'ac:bal:s' }],
    ],
  };
}

// ─────────────────────────────────────────────────────────────
// Phase 2.3: Smart name matching engine
// ─────────────────────────────────────────────────────────────

/**
 * Result of a fuzzy account name match.
 * Score is 0–1; only matches above FUZZY_THRESHOLD are returned.
 */
export interface FuzzyAccountMatch {
  name: string;
  type: 'card' | 'cash' | 'exchange' | 'wallet';
  defaultCurrency: string;
  score: number;
}

/** Minimum confidence to surface a fuzzy suggestion. */
const FUZZY_THRESHOLD = 0.62;

/** Cyrillic → Latin transliteration table (Russian + Ukrainian). */
const CYR_LAT: Record<string, string> = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo',
  'ж':'zh','з':'z','и':'i','й':'j','к':'k','л':'l','м':'m',
  'н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u',
  'ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch',
  'ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
  // Ukrainian
  'і':'i','ї':'yi','є':'ye','ґ':'g',
};

function transliterate(s: string): string {
  return s.toLowerCase().split('').map((c) => CYR_LAT[c] ?? c).join('');
}

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[\s\-_.,!?'"()]/g, '');
}

/** Levenshtein distance — O(m×n), safe for short strings. */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev_diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j]!;
      prev[j] = a[i - 1] === b[j - 1]
        ? prev_diag
        : 1 + Math.min(prev[j]!, prev[j - 1]!, prev_diag);
      prev_diag = temp;
    }
  }
  return prev[b.length]!;
}

/** Phonetic normalization to handle common Cyrillic -> Latin transliteration quirks */
function phoneticNormalize(s: string): string {
  return s.replace(/z/g, 's').replace(/k/g, 'c').replace(/y/g, 'i').replace(/j/g, 'i').replace(/w/g, 'v');
}

/**
 * Compute match score (0–1) between user input and a preset key/name.
 * Checks: exact → substring → prefix → Levenshtein, with phonetic enhancements.
 */
function computeScore(norm: string, translit: string, key: string, nameLower: string): number {
  let best = 0;

  const check = (a: string, b: string, weight = 1.0) => {
    if (!a || !b) return;
    if (a === b) { if (1.0 * weight > best) best = 1.0 * weight; return; }
    // Substring/prefix: require input ≥ 4 chars AND at least 40% of target length
    // Prevents "ban"(3) matching "sberbank"(8), "бан" → "ban" matching Citibank etc.
    const minSubLen = 4;
    const proportional = a.length >= b.length * 0.40;
    if (a.length >= minSubLen && proportional && b.includes(a)) { if (0.90 * weight > best) best = 0.90 * weight; }
    if (a.length >= minSubLen && proportional && b.startsWith(a)) { if (0.80 * weight > best) best = 0.80 * weight; }
    if (a.length >= minSubLen && a.includes(b)) { if (0.80 * weight > best) best = 0.80 * weight; }
    
    if (a.length >= 3) {
      const d = levenshtein(a, b);
      const s = 1 - d / Math.max(a.length, b.length);
      if (s * weight > best) best = s * weight;
    }
  };

  check(norm, key, 1.0);
  check(translit, key, 0.95);
  check(norm, nameLower, 0.95);
  check(translit, nameLower, 0.90);
  
  const pt = phoneticNormalize(translit);
  const pk = phoneticNormalize(key);
  const pn = phoneticNormalize(nameLower);
  
  if (pt !== translit || pk !== key || pn !== nameLower) {
    check(pt, pk, 0.90);
    check(pt, pn, 0.85);
  }

  return best;
}

/** Cash keyword patterns (RU/UK/EN). */
const CASH_KEYWORDS = [
  'наличн','наличк','налик','нал','готівк','кэш','кеш','кэшь',
  // 'cash' handled separately to avoid matching 'advcash', 'cashapp' etc.
];

/**
 * Russian/CIS aliases: maps a normalised Russian/Ukrainian input
 * (or a common variant) directly to the canonical preset key.
 * This short-circuits fuzzy computation for cases where transliteration
 * is unreliable or ambiguous.
 *
 * Format: 'alias' → 'preset_key' (must exist in a *_PRESETS map)
 * Checked BEFORE Levenshtein scoring.
 */
const RU_PRESET_ALIASES: Record<string, string> = {
  // ── Банковские карты / Payment systems ──
  'виза': 'visa', 'визу': 'visa', 'виз': 'visa',
  'мастеркард': 'mastercard', 'мастер': 'mastercard',
  'мир': 'mir', 'картамир': 'mir',
  'юнионпей': 'unionpay', 'юнион': 'unionpay',
  'маэстро': 'maestro',
  'белкарт': 'belkart',
  'простір': 'prostir',
  // ── Российские банки ──
  'тинькофф': 'tinkoff', 'тинк': 'tinkoff', 'тинькоф': 'tinkoff',
  'сбер': 'sber', 'сбербанк': 'sber',
  'альфа': 'alfa', 'альфабанк': 'alfa', 'алфа': 'alfa',
  'втб': 'vtb',
  'озон': 'ozon', 'озонбанк': 'ozon',
  'газпром': 'gazprom', 'газпромбанк': 'gazprom', 'газ': 'gazprom',
  'промсвязь': 'psb', 'промсвязьбанк': 'psb',
  'совкомбанк': 'sovkombank', 'совком': 'sovkombank',
  'россельхоз': 'rosselhoz', 'россельхозбанк': 'rosselhoz',
  'открытие': 'mkb2',
  'росбанк': 'rosbank',
  'райффайзен': 'raifrus', 'райфф': 'raifrus', 'райф': 'raifrus',
  'почтабанк': 'pochta', 'почта': 'pochta',
  'мтсбанк': 'mtsbank', 'мтс': 'mtsbank',
  'хоумкредит': 'hcredit', 'хоум': 'hcredit',
  'отпбанк': 'otprus',
  'акбарс': 'akbars',
  'ренессанс': 'renaissance', 'ренессанскредит': 'renaissance',
  'рнкб': 'rnkb',
  'экспобанк': 'expobank',
  'уралсиб': 'uralsib',
  'юникредит': 'unicreditrus',
  // ── Украинские банки ──
  'моно': 'mono', 'монобанк': 'mono',
  'приват': 'privat', 'приватбанк': 'privat',
  'укрсиббанк': 'ukrsib', 'укрсиб': 'ukrsib',
  'ощадбанк': 'oschad', 'ощад': 'oschad',
  'пумб': 'pumb',
  'абанк': 'abank',
  'сенсбанк': 'sense', 'сенс': 'sense',
  'укрексімбанк': 'ukrexim', 'укрексім': 'ukrexim',
  'укргазбанк': 'ukrgaz',
  'таскомбанк': 'tascom',
  'кредобанк': 'kredobank',
  'південний': 'pivdenny',
  'глобусбанк': 'globus',
  // ── Беларусь ──
  'белинвестбанк': 'belinvest', 'белинвест': 'belinvest',
  'приорбанк': 'priorbank',
  'беларусбанк': 'belarusbank',
  'дабрабыт': 'dabrabyt',
  'альфабай': 'alfaby',
  // ── Казахстан ──
  'каспи': 'kaspi', 'каспибанк': 'kaspi',
  'халык': 'halyk', 'халыкбанк': 'halyk',
  'жусан': 'jusan', 'жусанбанк': 'jusan',
  'центркредит': 'centercredit',
  'евразийский': 'eurasian', 'евразийскийбанк': 'eurasian',
  'атфбанк': 'atfbank',
  // ── Онлайн-банки ──
  'революст': 'revolut', 'революты': 'revolut', 'револют': 'revolut',
  'вайз': 'wise',
  'пейпал': 'paypal', 'пайпал': 'paypal',
  'н26': 'n26',
  'монзо': 'monzo',
  // ── Биржи (Exchanges) ──
  'бинанс': 'binance', 'байнанс': 'binance',
  'байбит': 'bybit', 'бибит': 'bybit',
  'окс': 'okx',
  'кракен': 'kraken',
  'кукоин': 'kucoin',
  'вайтбит': 'whitebit',
  'гейт': 'gateio', 'гейтио': 'gateio',
  'гемини': 'gemini',
  'эксмо': 'exmo',
  'хуоби': 'huobi',
  'коинбейс': 'coinbase', 'коинбэйс': 'coinbase',
  'криптоком': 'cryptocom',
  'битфинекс': 'bitfinex',
  'полониекс': 'poloniex',
  'битстамп': 'bitstamp',
  'юпитер': 'jupiter',
  'хайперликвид': 'hyperliquid',
  // ── Крипто-кошельки (Wallets) ──
  'метамаск': 'metamask', 'мета': 'metamask',
  'траст': 'trust', 'трастволет': 'trust',
  'фантом': 'phantom',
  'эксодус': 'exodus',
  'леджер': 'ledger',
  'трезор': 'trezor',
  'атомик': 'atomic', 'атомикволет': 'atomic',
  'зерион': 'zerion',
  'зенго': 'zengo',
  'рэбби': 'rabby',
  'рейнбоу': 'rainbow',
  'кеплр': 'keplr',
  'аргент': 'argent',
  'электрум': 'electrum',
  'мицелиум': 'mycelium',
  // ── E-кошельки (EWallets) ──
  'юмани': 'yoomoney', 'юмоней': 'yoomoney', 'юмоні': 'yoomoney',
  'юмони': 'yoomoney',
  'киви': 'qiwi',
  'вебмани': 'webmoney', 'вебмоней': 'webmoney',
  'скрилл': 'skrill',
  'пайонир': 'payoneer', 'пайонер': 'payoneer',
  'нетелер': 'neteller',
  'пайер': 'payeer',
  'адвкэш': 'advcash', 'адвкеш': 'advcash',
  'алипей': 'alipay',
  'вичатпей': 'wechatpay', 'вичат': 'wechatpay',
  'пейтм': 'paytm',
  // ── TON кошельки ──
  'тонкипер': 'tonkeeper',
  'тонхаб': 'tonhub',
  'тонспейс': 'tonspace',
  'тонволет': 'tonwallet',
  'телеграмкошелек': 'telegramwallet', 'телеграмволет': 'telegramwallet',
  'телеграмвалет': 'telegramwallet',
  // ── Lightning кошельки ──
  'феникс': 'phoenix',
  'бриз': 'breez',
  'страйк': 'strike',
  'зевс': 'zeus',
};

/** Minimum input length to allow kw.startsWith(norm) check — prevents 'mon' matching 'moneta' etc. */
const CASH_PREFIX_MIN_LEN = 5;

/** Resolve a preset key → { name, type, defaultCurrency } searching across all preset maps. */
function resolvePresetByKey(key: string): FuzzyAccountMatch | null {
  const bank = BANK_PRESETS.get(key);
  if (bank) return { name: bank.name, type: 'card', defaultCurrency: bank.defaultCurrency, score: 0.97 };
  const xch = EXCHANGE_PRESETS.get(key);
  if (xch) return { name: xch, type: 'exchange', defaultCurrency: 'USDT', score: 0.97 };
  const wal = WALLET_PRESETS.get(key);
  if (wal) return { name: wal, type: 'wallet', defaultCurrency: 'USDT', score: 0.97 };
  const ew = EWALLET_PRESETS.get(key);
  if (ew) return { name: ew.name, type: 'wallet', defaultCurrency: ew.defaultCurrency, score: 0.97 };
  const ton = TON_WALLET_PRESETS.get(key);
  if (ton) return { name: ton, type: 'wallet', defaultCurrency: 'TON', score: 0.97 };
  const ln = LIGHTNING_PRESETS.get(key);
  if (ln) return { name: ln, type: 'wallet', defaultCurrency: 'BTC', score: 0.97 };
  return null;
}

/**
 * Phase 2.3: Fuzzy-match user's free-text input against all known presets.
 * Supports Russian, Ukrainian, English and transliterated input.
 * Returns the best match above FUZZY_THRESHOLD, or null.
 *
 * @param input   Raw text the user typed
 * @param typeFilter  Optional: restrict to one account type (for card/exchange/wallet custom flows)
 */
export function fuzzyMatchAccountName(
  input: string,
  typeFilter?: 'card' | 'exchange' | 'wallet',
): FuzzyAccountMatch | null {
  const norm = normalizeKey(input);
  const translit = transliterate(norm);
  if (norm.length < 2) return null;

  // ── Alias fast-path: check RU_PRESET_ALIASES FIRST (before cash and fuzzy) ──
  const aliasKey = RU_PRESET_ALIASES[norm] ?? RU_PRESET_ALIASES[translit];
  if (aliasKey) {
    const match = resolvePresetByKey(aliasKey);
    if (match) {
      // Respect typeFilter
      if (!typeFilter || match.type === typeFilter ||
          (typeFilter === 'card' && match.type === 'cash')) {
        return match;
      }
    }
  }

  // Cash check — only standalone 'cash' keyword, not when it's part of 'advcash', 'cashapp' etc.
  // We detect: input IS 'cash', starts with 'cash ' (with space), or is a known CIS cash word.
  if (!typeFilter || typeFilter === 'card') {
    const isCashWord = norm === 'cash' || norm.startsWith('cash ');
    const isCisWord = CASH_KEYWORDS.some(
      (kw) =>
        norm.startsWith(kw) ||
        (norm.length >= CASH_PREFIX_MIN_LEN && kw.startsWith(norm)) ||
        norm.includes(kw),
    );
    if (isCashWord || isCisWord) {
      return { name: 'Наличные', type: 'cash', defaultCurrency: 'RUB', score: 0.88 };
    }
  }

  let best: FuzzyAccountMatch | null = null;

  // Banks (card)
  if (!typeFilter || typeFilter === 'card') {
    for (const [key, info] of BANK_PRESETS.entries()) {
      const score = computeScore(norm, translit, key, normalizeKey(info.name));
      if (score > FUZZY_THRESHOLD && score > (best?.score ?? 0)) {
        best = { name: info.name, type: 'card', defaultCurrency: info.defaultCurrency, score };
      }
    }
  }

  // Exchanges
  if (!typeFilter || typeFilter === 'exchange') {
    for (const [key, name] of EXCHANGE_PRESETS.entries()) {
      const score = computeScore(norm, translit, key, normalizeKey(name));
      if (score > FUZZY_THRESHOLD && score > (best?.score ?? 0)) {
        best = { name, type: 'exchange', defaultCurrency: 'USDT', score };
      }
    }
  }

  // Wallets (crypto)
  if (!typeFilter || typeFilter === 'wallet') {
    for (const [key, name] of WALLET_PRESETS.entries()) {
      const score = computeScore(norm, translit, key, normalizeKey(name));
      if (score > FUZZY_THRESHOLD && score > (best?.score ?? 0)) {
        best = { name, type: 'wallet', defaultCurrency: 'USDT', score };
      }
    }
    // E-wallets (fiat): QIWI, ЮМoney, Skrill, Payoneer etc.
    for (const [key, info] of EWALLET_PRESETS.entries()) {
      const score = computeScore(norm, translit, key, normalizeKey(info.name));
      if (score > FUZZY_THRESHOLD && score > (best?.score ?? 0)) {
        best = { name: info.name, type: 'wallet', defaultCurrency: info.defaultCurrency, score };
      }
    }
    // TON ecosystem wallets
    for (const [key, name] of TON_WALLET_PRESETS.entries()) {
      const score = computeScore(norm, translit, key, normalizeKey(name));
      if (score > FUZZY_THRESHOLD && score > (best?.score ?? 0)) {
        best = { name, type: 'wallet', defaultCurrency: 'TON', score };
      }
    }
    // Lightning wallets
    for (const [key, name] of LIGHTNING_PRESETS.entries()) {
      const score = computeScore(norm, translit, key, normalizeKey(name));
      if (score > FUZZY_THRESHOLD && score > (best?.score ?? 0)) {
        best = { name, type: 'wallet', defaultCurrency: 'BTC', score };
      }
    }
  }

  return best;
}

// ─────────────────────────────────────────────────────────────
// Phase 2.3: Smart confirm UI
// ─────────────────────────────────────────────────────────────


/**
 * Message shown when a fuzzy match is found.
 * Professional fintech style — clear, concise, no noise.
 */
export function buildSmartConfirmText(match: FuzzyAccountMatch): string {
  return (
    `💡 <b>Нашли похожее</b>\n` +
    `<blockquote>${match.name}</blockquote>\n` +
    `Это верно?`
  );
}

/**
 * Phase 2.3: Keyboard for the smart confirm step.
 *   [✅ Да, {name}]
 *   [✏️ Другое название]  [◀️ К типу счёта]
 *
 * ac:cus:ok   → 12 bytes ✅
 * ac:cus:keep → 15 bytes ✅
 * ac:open     → 7 bytes  ✅
 */
export function buildSmartConfirmKeyboard(suggestedName: string): InlineKeyboardMarkup {
  const preview = suggestedName.length > 28
    ? `${suggestedName.slice(0, 26)}…`
    : suggestedName;
  return {
    inline_keyboard: [
      [{ text: `✅ Да, ${preview}`, callback_data: 'ac:cus:ok' }],
      [
        { text: '✏️ Другое название', callback_data: 'ac:cus:keep' },
        { text: '◀️ К типу счёта',    callback_data: 'ac:open' },
      ],
    ],
  };
}

// ─────────────────────────────────────────────────────────────
// master_roadmap 1.6 — Currency search
// ─────────────────────────────────────────────────────────────

/** Transliteration table for Cyrillic → Latin (for currency search). */
const CUR_CYR_LAT: Record<string, string> = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo',
  'ж':'zh','з':'z','и':'i','й':'j','к':'k','л':'l','м':'m',
  'н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u',
  'ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch',
  'ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
  'і':'i','ї':'yi','є':'ye','ґ':'g',
};

function translitCurrency(s: string): string {
  return s.toLowerCase().split('').map((c) => CUR_CYR_LAT[c] ?? c).join('');
}

/**
 * master_roadmap 1.6: Search currencies by free-text query.
 * Checks: exact code match, code starts-with, name contains, transliteration.
 * Returns up to 9 matches.
 *
 * @param query  User-typed search text
 * @param pool   Array of currency codes to search within
 */
export function searchCurrencies(query: string, pool: string[]): string[] {
  const q = query.toLowerCase().trim();
  const qt = translitCurrency(q);
  if (q.length === 0) return [];

  const scored: Array<{ code: string; score: number }> = [];

  for (const code of pool) {
    const codeLow = code.toLowerCase();
    const nameTokens = (CURRENCY_NAMES[code] ?? '').toLowerCase();
    let score = 0;

    if (codeLow === q || codeLow === qt) {
      score = 100;
    } else if (codeLow.startsWith(q) || codeLow.startsWith(qt)) {
      score = 90;
    } else if (nameTokens.split(' ').some((t) => t.startsWith(q) || t.startsWith(qt))) {
      score = 80;
    } else if (nameTokens.includes(q) || nameTokens.includes(qt)) {
      score = 70;
    } else if (codeLow.includes(q)) {
      score = 60;
    }

    if (score > 0) scored.push({ code, score });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 9)
    .map((x) => x.code);
}

/**
 * master_roadmap 1.6: Prompt text for currency search mode.
 * Shown when user taps '\uD83D\uDD0D Найти валюту'.
 */
export function buildCurrencySearchPromptText(name: string, isCustom: boolean): string {
  const nameBlock = name
    ? (isCustom ? `<blockquote>${name}  \u00b7  свой счёт</blockquote>\n` : `<blockquote>«${name}»</blockquote>\n`)
    : '';
  return (
    `\uD83D\uDD0D <b>Поиск валюты</b>\n` +
    nameBlock +
    `Введите код или название:\n` +
    `<blockquote>Например: rub, евро, dollar, btc</blockquote>`
  );
}

/**
 * master_roadmap 1.6: Header text for currency search results.
 */
export function buildCurrencySearchResultsText(query: string, name: string, isCustom: boolean): string {
  const nameBlock = name
    ? (isCustom ? `<blockquote>${name}  \u00b7  свой счёт</blockquote>\n` : `<blockquote>«${name}»</blockquote>\n`)
    : '';
  return (
    `\uD83D\uDD0D По запросу «${query}»\n` +
    nameBlock +
    `Найдено:`
  );
}

/**
 * master_roadmap 1.6: Keyboard showing currency search results with flags.
 *
 * @param matches   Array of currency codes matching the query
 * @param backCb    Callback_data for the back button (e.g. 'ac:cur:list')
 */
export function buildCurrencySearchResultsKeyboard(
  matches: string[],
  backCb: string,
): InlineKeyboardMarkup {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  const cols = 3;
  for (let i = 0; i < matches.length; i += cols) {
    rows.push(
      matches.slice(i, i + cols).map((code) => ({
        text: `${getCurrencyFlag(code)} ${code}`.trim(),
        callback_data: `ac:cur:${code}`,
      })),
    );
  }
  rows.push([{ text: '\u25c0️ Вернуться к списку', callback_data: backCb }]);
  return { inline_keyboard: rows };
}

/**
 * master_roadmap 1.6: Text shown when currency search returns no results.
 */
export function buildCurrencySearchNoResultsText(
  query: string,
  name: string,
  isCustom: boolean,
): string {
  const nameBlock = name
    ? (isCustom ? `<blockquote>${name}  \u00b7  свой счёт</blockquote>\n` : `<blockquote>«${name}»</blockquote>\n`)
    : '';
  return (
    `\uD83D\uDD0D По запросу «${query}»\n` +
    nameBlock +
    `Такой валюты нет в списке.\n` +
    `Попробуйте другой запрос:\n` +
    `<blockquote>Например: rub, usd, eur, btc</blockquote>`
  );
}

// ─────────────────────────────────────────────────────────────
// master_roadmap 1.7 — No-match screen
// ─────────────────────────────────────────────────────────────

/**
 * master_roadmap 1.7: Text for the no-match screen — when fuzzy finds nothing.
 * Type-specific heading.
 *
 * @param name           User-entered name
 * @param accountType    Account type ('card'|'exchange'|'wallet'|'custom')
 * @param walletSubtype  Optional wallet sub-type
 */
export function buildNoMatchText(
  name: string,
  accountType: string,
  walletSubtype?: string,
): string {
  const typeLabels: Record<string, string> = {
    card:             'банка',
    exchange:         'биржи',
    custom:           'счёта',
    wallet_crypto:    'кошелька',
    wallet_ewallet:   'е-кошелька',
    wallet_ton:       'TON-кошелька',
    wallet_lightning: 'Lightning-кошелька',
  };
  const key = accountType === 'wallet' && walletSubtype ? `wallet_${walletSubtype}` : accountType;
  const label = typeLabels[key] ?? 'счёта';
  return (
    `\uD83D\uDD0D <b>Похожего ${label} не нашли</b>\n` +
    `<blockquote>«${name}»</blockquote>\n` +
    `Создать счёт с этим названием или попробовать ещё раз?`
  );
}

/**
 * master_roadmap 1.7: Keyboard for the no-match screen.
 * ac:cus:save  → 12 bytes ✅
 * ac:cus:keep  → 15 bytes ✅
 * ac:type:back → 12 bytes ✅
 * ac:type:wallet → 14 bytes ✅
 *
 * @param name        User-entered name (for button label preview)
 * @param backTarget  'subtype' → back to wallet subtype; 'type' → back to type picker
 */
export function buildNoMatchKeyboard(
  name: string,
  backTarget: 'type' | 'subtype',
): InlineKeyboardMarkup {
  const preview = name.length > 22 ? `${name.slice(0, 20)}…` : name;
  const backCb = backTarget === 'subtype' ? 'ac:type:wallet' : 'ac:type:back';
  const backLabel = backTarget === 'subtype' ? '\u25c0️ К подтипу' : '\u25c0️ К типу счёта';
  return {
    inline_keyboard: [
      [{ text: `✅ Создать «${preview}»`, callback_data: 'ac:cus:save' }],
      [
        { text: '✏️ Изменить название', callback_data: 'ac:cus:keep' },
        { text: backLabel,                  callback_data: backCb },
      ],
    ],
  };
}
