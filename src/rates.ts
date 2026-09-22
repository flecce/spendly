import { readJson } from './auth/util';
import { mainCurrency, today } from './format';
import type { Expense } from './schema';

/**
 * Daily ECB reference rates (via frankfurter.dev: free, no key, CORS enabled).
 * Each expense is converted to the main currency with the rate of its own date
 * (or the closest earlier business day). Rates are cached for offline use.
 */

const API = 'https://api.frankfurter.dev/v1';
const KEY = 'spendly.rates';
const RETRY_AFTER_MS = 5 * 60_000;

interface Cache {
  base: string;
  from: string;
  symbols: string[];
  fetchedOn: string;
  /** date → currency → units of that currency per 1 base */
  rates: Record<string, Record<string, number>>;
}

let cache: Cache | null = readJson<Cache>(KEY);
let dates: string[] = cache ? Object.keys(cache.rates).sort() : [];
let loading: Promise<void> | null = null;
let lastFailure = 0;
const listeners = new Set<() => void>();

export const onRatesChange = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function covers(c: Cache | null, base: string, symbols: string[], from: string): boolean {
  return Boolean(c && c.base === base && c.from <= from && symbols.every((s) => c.symbols.includes(s)) && c.fetchedOn === today());
}

/** Makes sure rates are available for these currencies since `from` (fetches in the background). */
export function ensureRates(currencies: string[], from: string): Promise<void> {
  const base = mainCurrency;
  const symbols = [...new Set(currencies)].filter((c) => c !== base).sort();
  if (!symbols.length || covers(cache, base, symbols, from)) return Promise.resolve();
  // One request at a time; whatever this call needs beyond the running one is fetched right after.
  if (loading) return loading.then(() => ensureRates(currencies, from));
  if (Date.now() - lastFailure < RETRY_AFTER_MS) return Promise.resolve();

  // Widen to what's already cached so switching periods doesn't refetch.
  const all = cache?.base === base ? [...new Set([...symbols, ...cache.symbols])].sort() : symbols;
  const start = cache?.base === base && cache.from < from ? cache.from : from;
  loading = fetch(`${API}/${start}..?base=${base}&symbols=${all.join(',')}`)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`Rates: HTTP ${res.status}`))))
    .then((data: { rates: Cache['rates'] }) => {
      cache = { base, from: start, symbols: all, fetchedOn: today(), rates: data.rates };
      dates = Object.keys(data.rates).sort();
      try {
        localStorage.setItem(KEY, JSON.stringify(cache));
      } catch {
        /* storage full: keep in memory */
      }
      for (const fn of listeners) fn();
    })
    .catch((e) => {
      lastFailure = Date.now();
      console.warn('Exchange rates unavailable', e);
    })
    .finally(() => (loading = null));
  return loading;
}

/** Rates for every foreign currency used in these expenses. */
export function ensureRatesFor(expenses: Expense[]): Promise<void> {
  const foreign = expenses.filter((e) => e.currency !== mainCurrency);
  if (!foreign.length) return Promise.resolve();
  const from = foreign.reduce((min, e) => (e.date < min ? e.date : min), today());
  return ensureRates(
    foreign.map((e) => e.currency),
    from,
  );
}

/** Rate on `date` or the closest earlier day (weekends, holidays); the earliest known one otherwise. */
function rateOn(currency: string, date: string): number | null {
  if (!cache || cache.base !== mainCurrency || !dates.length) return null;
  let lo = 0;
  let hi = dates.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= date) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  for (let i = Math.max(found, 0); i >= 0 && i < dates.length; found < 0 ? i++ : i--) {
    const r = cache.rates[dates[i]]?.[currency];
    if (r) return r;
  }
  return null;
}

/** Amount in the main currency, or null when the rate isn't known (yet). */
export function toMain(amount: number, currency: string, date: string): number | null {
  if (currency === mainCurrency) return amount;
  const rate = rateOn(currency, date);
  return rate ? amount / rate : null;
}

/** Test hook. */
export function setRatesForTest(c: Cache | null): void {
  cache = c;
  dates = c ? Object.keys(c.rates).sort() : [];
}
