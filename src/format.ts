import { locale } from './i18n';

/**
 * Currencies with a daily European Central Bank reference rate, so any expense can be
 * converted to the main currency. Most used first, then alphabetical.
 */
export const CURRENCIES = [
  'EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD',
  'BRL', 'CNY', 'CZK', 'DKK', 'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'KRW', 'MXN', 'MYR',
  'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'ZAR',
];
const CURRENCY_KEY = 'spendly.currency';
const REGION_CURRENCY: Record<string, string> = {
  US: 'USD', GB: 'GBP', CH: 'CHF', LI: 'CHF', JP: 'JPY', CA: 'CAD', AU: 'AUD', BR: 'BRL', CN: 'CNY', CZ: 'CZK',
  DK: 'DKK', HK: 'HKD', HU: 'HUF', ID: 'IDR', IL: 'ILS', IN: 'INR', IS: 'ISK', KR: 'KRW', MX: 'MXN', MY: 'MYR',
  NO: 'NOK', NZ: 'NZD', PH: 'PHP', PL: 'PLN', RO: 'RON', SE: 'SEK', SG: 'SGD', TH: 'THB', TR: 'TRY', ZA: 'ZAR',
};

export const isCurrency = (c: string): boolean => CURRENCIES.includes(c);

function detectCurrency(): string {
  try {
    const saved = localStorage.getItem(CURRENCY_KEY);
    if (saved && isCurrency(saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  const region = (navigator.language ?? '').split('-')[1]?.toUpperCase() ?? '';
  return REGION_CURRENCY[region] ?? 'EUR';
}

/** The currency totals are shown in; new expenses default to it. */
export let mainCurrency = detectCurrency();

export function setMainCurrency(c: string): void {
  mainCurrency = c;
  try {
    localStorage.setItem(CURRENCY_KEY, c);
  } catch {
    /* storage unavailable */
  }
}

export const money = (n: number, currency = mainCurrency): string =>
  new Intl.NumberFormat(locale(), { style: 'currency', currency }).format(n);

/** Short form for chart axes: €1.2K */
export const moneyCompact = (n: number): string =>
  new Intl.NumberFormat(locale(), { style: 'currency', currency: mainCurrency, notation: 'compact', maximumFractionDigits: 1 }).format(n);

/** Localised currency name, e.g. "dollaro statunitense". */
export function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames(locale(), { type: 'currency' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Parses amounts typed with either decimal separator: "12,50", "12.5", "1.234,56", "1,234.56", "€ 8".
 * Returns null when the text is not a number.
 */
export function parseAmount(input: string): number | null {
  let s = input.replace(/[\s '’]/g, '').replace(/[^\d.,-]/g, '');
  if (!/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    s = s.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma >= 0) {
    s = s.split(',').length > 2 ? s.split(',').join('') : s.replace(',', '.');
  } else if (s.split('.').length > 2) {
    s = s.split('.').join('');
  }
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Amount as the user would type it in an input: "12,5" → "12,50" in comma locales. */
export function amountInputValue(n: number): string {
  const decimal = new Intl.NumberFormat(locale()).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.';
  return n.toFixed(2).replace('.', decimal);
}

// ---- Dates: expenses use local calendar days as ISO strings (YYYY-MM-DD) ----

const pad = (n: number): string => String(n).padStart(2, '0');

export const isoDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = (): string => isoDate(new Date());

export function fromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, days: number): string {
  const d = fromIso(iso);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

export const daysBetween = (a: string, b: string): number =>
  Math.round((Date.UTC(...ymd(b)) - Date.UTC(...ymd(a))) / 86_400_000);

function ymd(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m - 1, d];
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/** Spreadsheet serial number (days since 1899-12-30, used by Excel and Google Sheets). */
export const isoToSerial = (iso: string): number => Math.round((Date.UTC(...ymd(iso)) - EXCEL_EPOCH) / 86_400_000);

export function serialToIso(serial: number): string {
  const d = new Date(EXCEL_EPOCH + Math.floor(serial) * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Normalises whatever a spreadsheet cell holds (ISO text, serial number, "22/09/2026") into YYYY-MM-DD. */
export function toIsoDate(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return serialToIso(value);
  const s = String(value ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return valid(+m[3], +m[2], +m[1]);
  return null;
}

function valid(y: number, m: number, d: number): string | null {
  const date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 && date.getDate() === d ? isoDate(date) : null;
}

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale(), opts).format(fromIso(iso));
}
