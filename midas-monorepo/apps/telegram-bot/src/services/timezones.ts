/**
 * Timezones Service — Phase 2.2
 *
 * Smart timezone search supporting:
 *   - IANA timezone name search (e.g. "Europe/Moscow")
 *   - English city/country name search (e.g. "moscow", "dubai")
 *   - Russian city/country name search (e.g. "москва", "дубай")
 *   - Multi-timezone country disambiguation (Russia, USA, etc.)
 *
 * All timezone values validated against Intl.supportedValuesOf('timeZone').
 */

// ─────────────────────────────────────────────────────────────
// IANA timezone validation
// ─────────────────────────────────────────────────────────────

export const ALL_TIMEZONES: ReadonlySet<string> = new Set(
  Intl.supportedValuesOf('timeZone'),
);

// ─────────────────────────────────────────────────────────────
// Country → timezones map (multi-TZ countries disambiguated)
// ─────────────────────────────────────────────────────────────

export interface TzCountry {
  nameEn: string;
  nameRu: string;
  flag: string;
  zones: { iana: string; label: string }[];
}

export const MULTI_TZ_COUNTRIES: TzCountry[] = [
  {
    nameEn: 'Russia', nameRu: 'Россия', flag: '🇷🇺',
    zones: [
      { iana: 'Europe/Kaliningrad',   label: 'Калининград (UTC+2)' },
      { iana: 'Europe/Moscow',        label: 'Москва, СПб, Казань (UTC+3)' },
      { iana: 'Europe/Samara',        label: 'Самара, Удмуртия (UTC+4)' },
      { iana: 'Asia/Yekaterinburg',   label: 'Екатеринбург (UTC+5)' },
      { iana: 'Asia/Omsk',            label: 'Омск (UTC+6)' },
      { iana: 'Asia/Krasnoyarsk',     label: 'Красноярск (UTC+7)' },
      { iana: 'Asia/Irkutsk',         label: 'Иркутск (UTC+8)' },
      { iana: 'Asia/Yakutsk',         label: 'Якутск (UTC+9)' },
      { iana: 'Asia/Vladivostok',     label: 'Владивосток (UTC+10)' },
      { iana: 'Asia/Magadan',         label: 'Магадан (UTC+11)' },
      { iana: 'Asia/Kamchatka',       label: 'Камчатка (UTC+12)' },
    ],
  },
  {
    nameEn: 'USA', nameRu: 'США', flag: '🇺🇸',
    zones: [
      { iana: 'America/New_York',     label: 'Нью-Йорк, Бостон, Майами (UTC-5/-4)' },
      { iana: 'America/Chicago',      label: 'Чикаго, Даллас (UTC-6/-5)' },
      { iana: 'America/Denver',       label: 'Денвер (UTC-7/-6)' },
      { iana: 'America/Los_Angeles',  label: 'Лос-Анджелес, Сан-Франциско (UTC-8/-7)' },
      { iana: 'America/Phoenix',      label: 'Феникс (UTC-7)' },
      { iana: 'America/Anchorage',    label: 'Анкоридж (UTC-9/-8)' },
      { iana: 'Pacific/Honolulu',     label: 'Гонолулу (UTC-10)' },
    ],
  },
  {
    nameEn: 'Canada', nameRu: 'Канада', flag: '🇨🇦',
    zones: [
      { iana: 'America/Toronto',      label: 'Торонто (UTC-5/-4)' },
      { iana: 'America/Winnipeg',     label: 'Виннипег (UTC-6/-5)' },
      { iana: 'America/Edmonton',     label: 'Эдмонтон (UTC-7/-6)' },
      { iana: 'America/Vancouver',    label: 'Ванкувер (UTC-8/-7)' },
      { iana: 'America/Halifax',      label: 'Галифакс (UTC-4/-3)' },
    ],
  },
  {
    nameEn: 'Australia', nameRu: 'Австралия', flag: '🇦🇺',
    zones: [
      { iana: 'Australia/Sydney',     label: 'Сидней, Мельбурн (UTC+10/+11)' },
      { iana: 'Australia/Brisbane',   label: 'Брисбен (UTC+10)' },
      { iana: 'Australia/Adelaide',   label: 'Аделаида (UTC+9:30/+10:30)' },
      { iana: 'Australia/Perth',      label: 'Перт (UTC+8)' },
      { iana: 'Australia/Darwin',     label: 'Дарвин (UTC+9:30)' },
    ],
  },
  {
    nameEn: 'Brazil', nameRu: 'Бразилия', flag: '🇧🇷',
    zones: [
      { iana: 'America/Sao_Paulo',    label: 'Сан-Паулу, Рио (UTC-3/-2)' },
      { iana: 'America/Manaus',       label: 'Манаус (UTC-4)' },
      { iana: 'America/Belem',        label: 'Белен (UTC-3)' },
    ],
  },
  {
    nameEn: 'Mexico', nameRu: 'Мексика', flag: '🇲🇽',
    zones: [
      { iana: 'America/Mexico_City',  label: 'Мехико (UTC-6/-5)' },
      { iana: 'America/Tijuana',      label: 'Тихуана (UTC-8/-7)' },
      { iana: 'America/Cancun',       label: 'Канкун (UTC-5)' },
    ],
  },
  {
    nameEn: 'Indonesia', nameRu: 'Индонезия', flag: '🇮🇩',
    zones: [
      { iana: 'Asia/Jakarta',         label: 'Джакарта (UTC+7)' },
      { iana: 'Asia/Makassar',        label: 'Макасар (UTC+8)' },
      { iana: 'Asia/Jayapura',        label: 'Джаяпура (UTC+9)' },
    ],
  },
  {
    nameEn: 'Kazakhstan', nameRu: 'Казахстан', flag: '🇰🇿',
    zones: [
      { iana: 'Asia/Almaty',          label: 'Алматы, Нур-Султан (UTC+6)' },
      { iana: 'Asia/Aqtau',           label: 'Актау (UTC+5)' },
      { iana: 'Asia/Aqtobe',          label: 'Актобе (UTC+5)' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────
// City/country → single IANA zone direct map (EN + RU)
// ─────────────────────────────────────────────────────────────

interface SingleZoneEntry { iana: string; label: string; flag: string }

export const SINGLE_ZONE_MAP: Record<string, SingleZoneEntry> = {
  // Ukraine / Украина
  'ukraine': { iana: 'Europe/Kiev', label: 'Украина (UTC+2/+3)', flag: '🇺🇦' },
  'украина': { iana: 'Europe/Kiev', label: 'Украина (UTC+2/+3)', flag: '🇺🇦' },
  'киев':    { iana: 'Europe/Kiev', label: 'Киев (UTC+2/+3)', flag: '🇺🇦' },
  'kyiv':    { iana: 'Europe/Kiev', label: 'Kyiv (UTC+2/+3)', flag: '🇺🇦' },
  // Belarus
  'беларусь': { iana: 'Europe/Minsk', label: 'Беларусь (UTC+3)', flag: '🇧🇾' },
  'минск':    { iana: 'Europe/Minsk', label: 'Минск (UTC+3)', flag: '🇧🇾' },
  'belarus':  { iana: 'Europe/Minsk', label: 'Belarus (UTC+3)', flag: '🇧🇾' },
  'minsk':    { iana: 'Europe/Minsk', label: 'Minsk (UTC+3)', flag: '🇧🇾' },
  // Georgia
  'грузия':  { iana: 'Asia/Tbilisi', label: 'Грузия (UTC+4)', flag: '🇬🇪' },
  'тбилиси': { iana: 'Asia/Tbilisi', label: 'Тбилиси (UTC+4)', flag: '🇬🇪' },
  'georgia': { iana: 'Asia/Tbilisi', label: 'Georgia (UTC+4)', flag: '🇬🇪' },
  'tbilisi': { iana: 'Asia/Tbilisi', label: 'Tbilisi (UTC+4)', flag: '🇬🇪' },
  // Armenia
  'армения': { iana: 'Asia/Yerevan', label: 'Армения (UTC+4)', flag: '🇦🇲' },
  'ереван':  { iana: 'Asia/Yerevan', label: 'Ереван (UTC+4)', flag: '🇦🇲' },
  'armenia': { iana: 'Asia/Yerevan', label: 'Armenia (UTC+4)', flag: '🇦🇲' },
  'yerevan': { iana: 'Asia/Yerevan', label: 'Yerevan (UTC+4)', flag: '🇦🇲' },
  // Azerbaijan
  'азербайджан': { iana: 'Asia/Baku', label: 'Азербайджан (UTC+4)', flag: '🇦🇿' },
  'баку':         { iana: 'Asia/Baku', label: 'Баку (UTC+4)', flag: '🇦🇿' },
  'azerbaijan':   { iana: 'Asia/Baku', label: 'Azerbaijan (UTC+4)', flag: '🇦🇿' },
  'baku':         { iana: 'Asia/Baku', label: 'Baku (UTC+4)', flag: '🇦🇿' },
  // Uzbekistan
  'узбекистан': { iana: 'Asia/Tashkent', label: 'Узбекистан (UTC+5)', flag: '🇺🇿' },
  'ташкент':    { iana: 'Asia/Tashkent', label: 'Ташкент (UTC+5)', flag: '🇺🇿' },
  'uzbekistan': { iana: 'Asia/Tashkent', label: 'Uzbekistan (UTC+5)', flag: '🇺🇿' },
  'tashkent':   { iana: 'Asia/Tashkent', label: 'Tashkent (UTC+5)', flag: '🇺🇿' },
  // Turkey
  'турция':  { iana: 'Europe/Istanbul', label: 'Турция (UTC+3)', flag: '🇹🇷' },
  'стамбул': { iana: 'Europe/Istanbul', label: 'Стамбул (UTC+3)', flag: '🇹🇷' },
  'анкара':  { iana: 'Europe/Istanbul', label: 'Анкара (UTC+3)', flag: '🇹🇷' },
  'turkey':  { iana: 'Europe/Istanbul', label: 'Turkey (UTC+3)', flag: '🇹🇷' },
  'istanbul':{ iana: 'Europe/Istanbul', label: 'Istanbul (UTC+3)', flag: '🇹🇷' },
  // UAE
  'эмираты': { iana: 'Asia/Dubai', label: 'ОАЭ (UTC+4)', flag: '🇦🇪' },
  'оаэ':     { iana: 'Asia/Dubai', label: 'ОАЭ (UTC+4)', flag: '🇦🇪' },
  'дубай':   { iana: 'Asia/Dubai', label: 'Дубай (UTC+4)', flag: '🇦🇪' },
  'дубаи':   { iana: 'Asia/Dubai', label: 'Дубай (UTC+4)', flag: '🇦🇪' },
  'dubai':   { iana: 'Asia/Dubai', label: 'Dubai (UTC+4)', flag: '🇦🇪' },
  'uae':     { iana: 'Asia/Dubai', label: 'UAE (UTC+4)', flag: '🇦🇪' },
  // UK
  'лондон':  { iana: 'Europe/London', label: 'Лондон (UTC+0/+1)', flag: '🇬🇧' },
  'britain': { iana: 'Europe/London', label: 'Britain (UTC+0/+1)', flag: '🇬🇧' },
  'england': { iana: 'Europe/London', label: 'England (UTC+0/+1)', flag: '🇬🇧' },
  'london':  { iana: 'Europe/London', label: 'London (UTC+0/+1)', flag: '🇬🇧' },
  'uk':      { iana: 'Europe/London', label: 'UK (UTC+0/+1)', flag: '🇬🇧' },
  // Germany
  'германия': { iana: 'Europe/Berlin', label: 'Германия (UTC+1/+2)', flag: '🇩🇪' },
  'берлин':   { iana: 'Europe/Berlin', label: 'Берлин (UTC+1/+2)', flag: '🇩🇪' },
  'germany':  { iana: 'Europe/Berlin', label: 'Germany (UTC+1/+2)', flag: '🇩🇪' },
  'berlin':   { iana: 'Europe/Berlin', label: 'Berlin (UTC+1/+2)', flag: '🇩🇪' },
  // France
  'франция': { iana: 'Europe/Paris', label: 'Франция (UTC+1/+2)', flag: '🇫🇷' },
  'париж':   { iana: 'Europe/Paris', label: 'Париж (UTC+1/+2)', flag: '🇫🇷' },
  'france':  { iana: 'Europe/Paris', label: 'France (UTC+1/+2)', flag: '🇫🇷' },
  'paris':   { iana: 'Europe/Paris', label: 'Paris (UTC+1/+2)', flag: '🇫🇷' },
  // Poland
  'польша':  { iana: 'Europe/Warsaw', label: 'Польша (UTC+1/+2)', flag: '🇵🇱' },
  'варшава': { iana: 'Europe/Warsaw', label: 'Варшава (UTC+1/+2)', flag: '🇵🇱' },
  'poland':  { iana: 'Europe/Warsaw', label: 'Poland (UTC+1/+2)', flag: '🇵🇱' },
  'warsaw':  { iana: 'Europe/Warsaw', label: 'Warsaw (UTC+1/+2)', flag: '🇵🇱' },
  // India
  'индия':   { iana: 'Asia/Kolkata', label: 'Индия (UTC+5:30)', flag: '🇮🇳' },
  'india':   { iana: 'Asia/Kolkata', label: 'India (UTC+5:30)', flag: '🇮🇳' },
  'mumbai':  { iana: 'Asia/Kolkata', label: 'Mumbai (UTC+5:30)', flag: '🇮🇳' },
  'delhi':   { iana: 'Asia/Kolkata', label: 'Delhi (UTC+5:30)', flag: '🇮🇳' },
  // China
  'китай':   { iana: 'Asia/Shanghai', label: 'Китай (UTC+8)', flag: '🇨🇳' },
  'шанхай':  { iana: 'Asia/Shanghai', label: 'Шанхай (UTC+8)', flag: '🇨🇳' },
  'пекин':   { iana: 'Asia/Shanghai', label: 'Пекин (UTC+8)', flag: '🇨🇳' },
  'china':   { iana: 'Asia/Shanghai', label: 'China (UTC+8)', flag: '🇨🇳' },
  'beijing': { iana: 'Asia/Shanghai', label: 'Beijing (UTC+8)', flag: '🇨🇳' },
  'shanghai':{ iana: 'Asia/Shanghai', label: 'Shanghai (UTC+8)', flag: '🇨🇳' },
  // Japan
  'япония':  { iana: 'Asia/Tokyo', label: 'Япония (UTC+9)', flag: '🇯🇵' },
  'токио':   { iana: 'Asia/Tokyo', label: 'Токио (UTC+9)', flag: '🇯🇵' },
  'japan':   { iana: 'Asia/Tokyo', label: 'Japan (UTC+9)', flag: '🇯🇵' },
  'tokyo':   { iana: 'Asia/Tokyo', label: 'Tokyo (UTC+9)', flag: '🇯🇵' },
  // South Korea
  'корея':   { iana: 'Asia/Seoul', label: 'Корея (UTC+9)', flag: '🇰🇷' },
  'сеул':    { iana: 'Asia/Seoul', label: 'Сеул (UTC+9)', flag: '🇰🇷' },
  'korea':   { iana: 'Asia/Seoul', label: 'Korea (UTC+9)', flag: '🇰🇷' },
  'seoul':   { iana: 'Asia/Seoul', label: 'Seoul (UTC+9)', flag: '🇰🇷' },
  // Thailand
  'таиланд': { iana: 'Asia/Bangkok', label: 'Таиланд (UTC+7)', flag: '🇹🇭' },
  'бангкок': { iana: 'Asia/Bangkok', label: 'Бангкок (UTC+7)', flag: '🇹🇭' },
  'thailand':{ iana: 'Asia/Bangkok', label: 'Thailand (UTC+7)', flag: '🇹🇭' },
  'bangkok': { iana: 'Asia/Bangkok', label: 'Bangkok (UTC+7)', flag: '🇹🇭' },
  // Singapore
  'сингапур':  { iana: 'Asia/Singapore', label: 'Сингапур (UTC+8)', flag: '🇸🇬' },
  'singapore': { iana: 'Asia/Singapore', label: 'Singapore (UTC+8)', flag: '🇸🇬' },
  // Cyprus
  'кипр':    { iana: 'Asia/Nicosia', label: 'Кипр (UTC+2/+3)', flag: '🇨🇾' },
  'никосия': { iana: 'Asia/Nicosia', label: 'Никосия (UTC+2/+3)', flag: '🇨🇾' },
  'cyprus':  { iana: 'Asia/Nicosia', label: 'Cyprus (UTC+2/+3)', flag: '🇨🇾' },
  // Moscow cities direct
  'москва':      { iana: 'Europe/Moscow', label: 'Москва (UTC+3)', flag: '🇷🇺' },
  'питер':       { iana: 'Europe/Moscow', label: 'Санкт-Петербург (UTC+3)', flag: '🇷🇺' },
  'спб':         { iana: 'Europe/Moscow', label: 'Санкт-Петербург (UTC+3)', flag: '🇷🇺' },
  'санктпетербург': { iana: 'Europe/Moscow', label: 'Санкт-Петербург (UTC+3)', flag: '🇷🇺' },
  'moscow':      { iana: 'Europe/Moscow', label: 'Moscow (UTC+3)', flag: '🇷🇺' },
  'novosibirsk': { iana: 'Asia/Novosibirsk', label: 'Новосибирск (UTC+7)', flag: '🇷🇺' },
  'новосибирск': { iana: 'Asia/Novosibirsk', label: 'Новосибирск (UTC+7)', flag: '🇷🇺' },
  'владивосток': { iana: 'Asia/Vladivostok', label: 'Владивосток (UTC+10)', flag: '🇷🇺' },
  'екатеринбург':{ iana: 'Asia/Yekaterinburg', label: 'Екатеринбург (UTC+5)', flag: '🇷🇺' },
  'новйорк':     { iana: 'America/New_York', label: 'Нью-Йорк (UTC-5/-4)', flag: '🇺🇸' },
  'нью-йорк':    { iana: 'America/New_York', label: 'Нью-Йорк (UTC-5/-4)', flag: '🇺🇸' },
  'newyork':     { iana: 'America/New_York', label: 'New York (UTC-5/-4)', flag: '🇺🇸' },
  'new york':    { iana: 'America/New_York', label: 'New York (UTC-5/-4)', flag: '🇺🇸' },
  // UTC direct
  'utc':         { iana: 'UTC', label: 'UTC (Мировое время)', flag: '🌍' },
  'gmt':         { iana: 'UTC', label: 'GMT = UTC', flag: '🌍' },
};

// ─────────────────────────────────────────────────────────────
// Search result types
// ─────────────────────────────────────────────────────────────

export type TzSearchResult =
  | { type: 'single'; iana: string; label: string; flag: string }
  | { type: 'multi_country'; country: TzCountry }
  | { type: 'iana_list'; zones: string[] };

/**
 * Smart timezone search.
 *
 * Priority:
 *   1. Direct city/country alias hit → single result (or multi_country for RU/US etc.)
 *   2. Multi-TZ country fuzzy match (nameEn / nameRu contains query)
 *   3. IANA substring match (e.g. "moscow" → "Europe/Moscow")
 *
 * Returns TzSearchResult or null if nothing found.
 */
export function searchTimezone(raw: string): TzSearchResult | null {
  const q = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (q.length < 2) return null;

  // 1. Direct map lookup (exact then partial)
  const directExact = SINGLE_ZONE_MAP[q];
  if (directExact) {
    return { type: 'single', ...directExact };
  }

  // Partial match in single zone map
  for (const [key, entry] of Object.entries(SINGLE_ZONE_MAP)) {
    if (key.includes(q) || q.includes(key)) {
      return { type: 'single', ...entry };
    }
  }

  // 2. Multi-TZ country match
  const rawSpaced = raw.trim().toLowerCase();
  for (const country of MULTI_TZ_COUNTRIES) {
    if (
      country.nameEn.toLowerCase().includes(rawSpaced) ||
      country.nameRu.toLowerCase().includes(rawSpaced) ||
      rawSpaced.includes(country.nameEn.toLowerCase()) ||
      rawSpaced.includes(country.nameRu.toLowerCase())
    ) {
      return { type: 'multi_country', country };
    }
  }

  // 3. IANA substring match
  const ianaMatches: string[] = [];
  for (const tz of ALL_TIMEZONES) {
    if (tz.toLowerCase().includes(rawSpaced)) {
      ianaMatches.push(tz);
      if (ianaMatches.length >= 8) break;
    }
  }
  if (ianaMatches.length > 0) return { type: 'iana_list', zones: ianaMatches };

  return null;
}

/**
 * Get current UTC offset string for an IANA timezone.
 * e.g. "Europe/Moscow" → "UTC+3"
 */
export function getTzOffset(iana: string): string {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: iana,
      timeZoneName: 'short',
    }).formatToParts(now);
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}
