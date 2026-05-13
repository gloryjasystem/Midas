/**
 * Item Category Detector — Phase 2.5
 *
 * Maps item_name / brand keywords to canonical workspace category names.
 * Called before showing the preview card to auto-assign obvious categories
 * (e.g., "майбах" → "Транспорт", "starbucks" → "Кафе и рестораны").
 *
 * Algorithm:
 *   1. Normalize item_name to lowercase.
 *   2. Try full-phrase match first (longest key wins).
 *   3. Try token-level match (each word in item_name).
 *   4. Return { category, confidence } or null.
 *
 * confidence:
 *   'high'   — exact brand (майбах, iphone, netflix) → auto-assign silently.
 *   'medium' — generic term (такси, доставка) → auto-assign, visible in preview.
 *
 * SEC-12: item_name NOT logged.
 * No DB / AI calls — pure local TypeScript.
 */

export type DetectorResult = {
  category: string;   // canonical category name (e.g. "Транспорт")
  confidence: 'high' | 'medium';
};

// ─────────────────────────────────────────────────────────────
// Keyword → category map
// Keys: lowercase. Longer phrases checked before shorter tokens.
// ─────────────────────────────────────────────────────────────

const ITEM_CATEGORY_MAP: ReadonlyMap<string, DetectorResult> = new Map([
  // ── 🚗 Транспорт — авто-бренды ───────────────────────────
  ['майбах',       { category: 'Транспорт', confidence: 'high' }],
  ['maybach',      { category: 'Транспорт', confidence: 'high' }],
  ['ferrari',      { category: 'Транспорт', confidence: 'high' }],
  ['lamborghini',  { category: 'Транспорт', confidence: 'high' }],
  ['bentley',      { category: 'Транспорт', confidence: 'high' }],
  ['rolls-royce',  { category: 'Транспорт', confidence: 'high' }],
  ['rolls royce',  { category: 'Транспорт', confidence: 'high' }],
  ['bugatti',      { category: 'Транспорт', confidence: 'high' }],
  ['porsche',      { category: 'Транспорт', confidence: 'high' }],
  ['tesla',        { category: 'Транспорт', confidence: 'high' }],
  ['maserati',     { category: 'Транспорт', confidence: 'high' }],
  ['aston martin', { category: 'Транспорт', confidence: 'high' }],
  ['bmw',          { category: 'Транспорт', confidence: 'high' }],
  ['mercedes',     { category: 'Транспорт', confidence: 'high' }],
  ['audi',         { category: 'Транспорт', confidence: 'high' }],
  ['lexus',        { category: 'Транспорт', confidence: 'high' }],
  ['toyota',       { category: 'Транспорт', confidence: 'high' }],
  ['honda',        { category: 'Транспорт', confidence: 'high' }],
  ['ford',         { category: 'Транспорт', confidence: 'high' }],
  ['volvo',        { category: 'Транспорт', confidence: 'high' }],
  ['volkswagen',   { category: 'Транспорт', confidence: 'high' }],
  ['hyundai',      { category: 'Транспорт', confidence: 'high' }],
  ['kia',          { category: 'Транспорт', confidence: 'high' }],
  ['land rover',   { category: 'Транспорт', confidence: 'high' }],
  ['range rover',  { category: 'Транспорт', confidence: 'high' }],
  ['chevrolet',    { category: 'Транспорт', confidence: 'high' }],
  ['nissan',       { category: 'Транспорт', confidence: 'high' }],
  ['mazda',        { category: 'Транспорт', confidence: 'high' }],
  ['subaru',       { category: 'Транспорт', confidence: 'high' }],
  ['mitsubishi',   { category: 'Транспорт', confidence: 'high' }],
  ['jeep',         { category: 'Транспорт', confidence: 'high' }],
  ['dodge',        { category: 'Транспорт', confidence: 'high' }],
  ['cadillac',     { category: 'Транспорт', confidence: 'high' }],
  ['lincoln',      { category: 'Транспорт', confidence: 'high' }],
  ['infiniti',     { category: 'Транспорт', confidence: 'high' }],
  ['genesis',      { category: 'Транспорт', confidence: 'high' }],
  ['skoda',        { category: 'Транспорт', confidence: 'high' }],
  ['seat',         { category: 'Транспорт', confidence: 'high' }],
  ['peugeot',      { category: 'Транспорт', confidence: 'high' }],
  ['renault',      { category: 'Транспорт', confidence: 'high' }],
  ['citroen',      { category: 'Транспорт', confidence: 'high' }],
  ['fiat',         { category: 'Транспорт', confidence: 'high' }],
  ['alfa romeo',   { category: 'Транспорт', confidence: 'high' }],
  ['lada',         { category: 'Транспорт', confidence: 'high' }],
  // Такси / авто-сервисы
  ['яндекс такси', { category: 'Транспорт', confidence: 'high' }],
  ['uber',         { category: 'Транспорт', confidence: 'medium' }],
  ['bolt',         { category: 'Транспорт', confidence: 'medium' }],
  ['gett',         { category: 'Транспорт', confidence: 'high' }],
  ['indriver',     { category: 'Транспорт', confidence: 'high' }],
  ['maxim',        { category: 'Транспорт', confidence: 'medium' }],
  // Авиа
  ['аэрофлот',     { category: 'Путешествия', confidence: 'high' }],
  ['ryanair',      { category: 'Путешествия', confidence: 'high' }],
  ['wizzair',      { category: 'Путешествия', confidence: 'high' }],
  ['wizz air',     { category: 'Путешествия', confidence: 'high' }],
  ['flydubai',     { category: 'Путешествия', confidence: 'high' }],
  ['s7',           { category: 'Путешествия', confidence: 'high' }],
  ['turkish airlines', { category: 'Путешествия', confidence: 'high' }],
  ['emirates',     { category: 'Путешествия', confidence: 'high' }],
  ['lufthansa',    { category: 'Путешествия', confidence: 'high' }],
  ['авиабилет',    { category: 'Путешествия', confidence: 'high' }],

  // ── 🍔 Кафе и рестораны ──────────────────────────────────
  ['starbucks',    { category: 'Кафе и рестораны', confidence: 'high' }],
  ['mcdonalds',    { category: 'Кафе и рестораны', confidence: 'high' }],
  ["mcdonald's",   { category: 'Кафе и рестораны', confidence: 'high' }],
  ['kfc',          { category: 'Кафе и рестораны', confidence: 'high' }],
  ['burger king',  { category: 'Кафе и рестораны', confidence: 'high' }],
  ['subway',       { category: 'Кафе и рестораны', confidence: 'high' }],
  ['pizza hut',    { category: 'Кафе и рестораны', confidence: 'high' }],
  ["domino's",     { category: 'Кафе и рестораны', confidence: 'high' }],
  ['dominos',      { category: 'Кафе и рестораны', confidence: 'high' }],
  ['costa coffee', { category: 'Кафе и рестораны', confidence: 'high' }],
  ['costa',        { category: 'Кафе и рестораны', confidence: 'high' }],
  ['papa johns',   { category: 'Кафе и рестораны', confidence: 'high' }],
  ['papa john',    { category: 'Кафе и рестораны', confidence: 'high' }],
  ['wolt',         { category: 'Кафе и рестораны', confidence: 'high' }],
  ['glovo',        { category: 'Кафе и рестораны', confidence: 'high' }],
  ['яндекс еда',   { category: 'Кафе и рестораны', confidence: 'high' }],
  ['delivery club',{ category: 'Кафе и рестораны', confidence: 'high' }],
  ['сушия',        { category: 'Кафе и рестораны', confidence: 'high' }],
  ['пузата хата',  { category: 'Кафе и рестораны', confidence: 'high' }],
  ['шоколадница',  { category: 'Кафе и рестораны', confidence: 'high' }],
  ['кофе хаус',    { category: 'Кафе и рестораны', confidence: 'high' }],

  // ── 💻 Оборудование / Электроника ───────────────────────
  ['iphone',       { category: 'Оборудование', confidence: 'high' }],
  ['ipad',         { category: 'Оборудование', confidence: 'high' }],
  ['macbook',      { category: 'Оборудование', confidence: 'high' }],
  ['airpods',      { category: 'Оборудование', confidence: 'high' }],
  ['apple watch',  { category: 'Оборудование', confidence: 'high' }],
  ['samsung',      { category: 'Оборудование', confidence: 'high' }],
  ['galaxy',       { category: 'Оборудование', confidence: 'high' }],
  ['xiaomi',       { category: 'Оборудование', confidence: 'high' }],
  ['huawei',       { category: 'Оборудование', confidence: 'high' }],
  ['playstation',  { category: 'Оборудование', confidence: 'high' }],
  ['ps5',          { category: 'Оборудование', confidence: 'high' }],
  ['ps4',          { category: 'Оборудование', confidence: 'high' }],
  ['xbox',         { category: 'Оборудование', confidence: 'high' }],
  ['nintendo',     { category: 'Оборудование', confidence: 'high' }],
  ['gopro',        { category: 'Оборудование', confidence: 'high' }],
  ['dyson',        { category: 'Оборудование', confidence: 'high' }],
  ['sony',         { category: 'Оборудование', confidence: 'high' }],
  ['lg',           { category: 'Оборудование', confidence: 'high' }],

  // ── 👗 Одежда ────────────────────────────────────────────
  ['gucci',        { category: 'Одежда', confidence: 'high' }],
  ['prada',        { category: 'Одежда', confidence: 'high' }],
  ['louis vuitton',{ category: 'Одежда', confidence: 'high' }],
  ['chanel',       { category: 'Одежда', confidence: 'high' }],
  ['balenciaga',   { category: 'Одежда', confidence: 'high' }],
  ['versace',      { category: 'Одежда', confidence: 'high' }],
  ['burberry',     { category: 'Одежда', confidence: 'high' }],
  ['dior',         { category: 'Одежда', confidence: 'high' }],
  ['zara',         { category: 'Одежда', confidence: 'high' }],
  ['h&m',          { category: 'Одежда', confidence: 'high' }],
  ['adidas',       { category: 'Одежда', confidence: 'high' }],
  ['nike',         { category: 'Одежда', confidence: 'high' }],
  ['puma',         { category: 'Одежда', confidence: 'high' }],
  ['new balance',  { category: 'Одежда', confidence: 'high' }],
  ['mango',        { category: 'Одежда', confidence: 'high' }],
  ['massimo dutti',{ category: 'Одежда', confidence: 'high' }],
  ['calvin klein', { category: 'Одежда', confidence: 'high' }],
  ['ralph lauren', { category: 'Одежда', confidence: 'high' }],
  ['tommy hilfiger',{ category: 'Одежда', confidence: 'high' }],
  ['uniqlo',       { category: 'Одежда', confidence: 'high' }],

  // ── 🏥 Здоровье ──────────────────────────────────────────
  ['аптека',       { category: 'Здоровье', confidence: 'high' }],
  ['apteka',       { category: 'Здоровье', confidence: 'high' }],
  ['pharmacy',     { category: 'Здоровье', confidence: 'high' }],
  ['farmacia',     { category: 'Здоровье', confidence: 'high' }],

  // ── 🏨 Путешествия — отели ───────────────────────────────
  ['hilton',       { category: 'Путешествия', confidence: 'high' }],
  ['marriott',     { category: 'Путешествия', confidence: 'high' }],
  ['airbnb',       { category: 'Путешествия', confidence: 'high' }],
  ['booking',      { category: 'Путешествия', confidence: 'high' }],
  ['hyatt',        { category: 'Путешествия', confidence: 'high' }],
  ['отель',        { category: 'Путешествия', confidence: 'high' }],

  // ── 🎮 Подписки ──────────────────────────────────────────
  ['netflix',      { category: 'Подписки', confidence: 'high' }],
  ['spotify',      { category: 'Подписки', confidence: 'high' }],
  ['apple music',  { category: 'Подписки', confidence: 'high' }],
  ['youtube premium', { category: 'Подписки', confidence: 'high' }],
  ['icloud',       { category: 'Подписки', confidence: 'high' }],
  ['яндекс плюс',  { category: 'Подписки', confidence: 'high' }],
  ['яндекс+',      { category: 'Подписки', confidence: 'high' }],
  ['hbo',          { category: 'Подписки', confidence: 'high' }],
  ['disney+',      { category: 'Подписки', confidence: 'high' }],
  ['disney plus',  { category: 'Подписки', confidence: 'high' }],
  ['chatgpt',      { category: 'Подписки', confidence: 'high' }],
  ['openai',       { category: 'Подписки', confidence: 'high' }],
  ['claude',       { category: 'Подписки', confidence: 'high' }],
  ['steam',        { category: 'Подписки', confidence: 'high' }],

  // ── 🏠 Дом / IKEA ────────────────────────────────────────
  ['ikea',         { category: 'Дом', confidence: 'high' }],
  ['леруа мерлен', { category: 'Дом', confidence: 'high' }],
  ['leroy merlin', { category: 'Дом', confidence: 'high' }],
  ['оби',          { category: 'Дом', confidence: 'high' }],

  // ── 🛒 Продукты ──────────────────────────────────────────
  ['пятёрочка',    { category: 'Продукты', confidence: 'high' }],
  ['магнит',       { category: 'Продукты', confidence: 'high' }],
  ['ашан',         { category: 'Продукты', confidence: 'high' }],
  ['carrefour',    { category: 'Продукты', confidence: 'high' }],
  ['lidl',         { category: 'Продукты', confidence: 'high' }],
  ['aldi',         { category: 'Продукты', confidence: 'high' }],
  ['сильпо',       { category: 'Продукты', confidence: 'high' }],
  ['novus',        { category: 'Продукты', confidence: 'high' }],
  ['атб',          { category: 'Продукты', confidence: 'high' }],
  ['метро',        { category: 'Продукты', confidence: 'medium' }],
]);

// Sorted keys by length descending — longer phrases match first
const SORTED_KEYS: readonly string[] = [...ITEM_CATEGORY_MAP.keys()]
  .sort((a, b) => b.length - a.length);

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Detect a category from an item/product/brand name.
 *
 * @param itemName - raw item_name from transaction draft (user-controlled)
 * @returns DetectorResult or null if no match
 *
 * SEC-12: itemName NOT logged.
 */
export function detectCategoryFromItem(itemName: string | null | undefined): DetectorResult | null {
  if (!itemName || itemName.trim().length === 0) return null;

  const norm = itemName.trim().toLowerCase();

  // Pass 1: try full normalized string against each key (longest first)
  for (const key of SORTED_KEYS) {
    if (norm.includes(key)) {
      return ITEM_CATEGORY_MAP.get(key) ?? null;
    }
  }

  return null;
}
