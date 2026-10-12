import { addDays, formatDate, isoDate, today } from './format';
import { t, type Key } from './i18n';
import type { Expense, Recurring, RepeatUnit } from './schema';

/**
 * Recurring expenses (a mortgage instalment, a subscription, the salary). Nothing is written
 * ahead of time: each occurrence is added as a normal expense when its day comes (see
 * Store.addDue), so totals, budgets and charts only ever see what has actually happened.
 * An occurrence's ID is the recurrence's ID plus its number, so two devices adding the same
 * occurrence end up with a single row.
 */

/** Safety net: occurrences added in one go at most (a start far in the past); the rest follow next time. */
const MAX_AT_ONCE = 500;

/** The frequencies offered in the form; any other one typed in the file is shown as well. */
export const REPEAT_PRESETS: [every: number, unit: RepeatUnit][] = [
  [1, 'week'],
  [2, 'week'],
  [1, 'month'],
  [2, 'month'],
  [3, 'month'],
  [6, 'month'],
  [1, 'year'],
];

/**
 * The day of occurrence n (0 = the first). Months and years keep the start's day, or the
 * month's last day when it is shorter: from 31 January, then 28 February, then 31 March.
 */
export function occurrenceDate(r: Pick<Recurring, 'start' | 'every' | 'unit'>, n: number): string {
  const steps = n * r.every;
  if (r.unit === 'day') return addDays(r.start, steps);
  if (r.unit === 'week') return addDays(r.start, steps * 7);
  const [y, m, d] = r.start.split('-').map(Number);
  const months = m - 1 + (r.unit === 'year' ? steps * 12 : steps);
  const year = y + Math.floor(months / 12);
  const month = months % 12;
  const last = new Date(year, month + 1, 0).getDate();
  return isoDate(new Date(year, month, Math.min(d, last)));
}

export const isFinished = (r: Recurring): boolean => r.count > 0 && r.done >= r.count;

/** The day of the next occurrence still to add, or null when all of them have been added. */
export const nextDate = (r: Recurring): string | null => (isFinished(r) ? null : occurrenceDate(r, r.done));

/** The day of the last occurrence, or null when it repeats until deleted. */
export const lastDate = (r: Recurring): string | null => (r.count > 0 ? occurrenceDate(r, r.count - 1) : null);

/** Occurrence n as an expense. */
export const occurrence = (r: Recurring, n: number): Expense => ({
  id: `${r.id}-${n + 1}`,
  date: occurrenceDate(r, n),
  amount: r.amount,
  currency: r.currency,
  category: r.category,
  note: r.note,
  type: r.type,
  group: '',
  tags: [...r.tags],
  recurring: r.id,
});

/** The occurrences not added yet whose day has come (by `day`, included). */
export function dueOccurrences(r: Recurring, day = today()): Expense[] {
  const out: Expense[] = [];
  for (let n = r.done; (r.count === 0 || n < r.count) && out.length < MAX_AT_ONCE && occurrenceDate(r, n) <= day; n++) {
    out.push(occurrence(r, n));
  }
  return out;
}

// ---- Labels ----

const UNIT_LABELS: Record<RepeatUnit, [one: Key, many: Key]> = {
  day: ['repeatEveryDay', 'repeatEveryNDays'],
  week: ['repeatEveryWeek', 'repeatEveryNWeeks'],
  month: ['repeatEveryMonth', 'repeatEveryNMonths'],
  year: ['repeatEveryYear', 'repeatEveryNYears'],
};

/** "Every month", "Every 2 weeks". */
export const repeatLabel = (every: number, unit: RepeatUnit): string =>
  every === 1 ? t(UNIT_LABELS[unit][0]) : t(UNIT_LABELS[unit][1], { n: every });

/** "15 Nov", with the year when it isn't this one. */
export function shortDate(iso: string): string {
  const sameYear = iso.slice(0, 4) === today().slice(0, 4);
  return formatDate(iso, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** The parts that have something, joined by " · ", starting with a capital letter. */
export function sentence(parts: string[]): string {
  const s = parts.filter(Boolean).join(' · ');
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

/** "3 of 240 recorded", or "3 recorded" when it has no end. */
export const progressLabel = (r: Recurring): string =>
  r.count ? t('recurringProgress', { done: r.done, count: r.count }) : t('recurringProgressOpen', { done: r.done });

/** "Every month · next 15 Nov · 3 of 240 recorded". */
export function recurringSummary(r: Recurring): string {
  const next = nextDate(r);
  return sentence([repeatLabel(r.every, r.unit), next ? t('recurringNext', { d: shortDate(next) }) : t('recurringEnded'), progressLabel(r)]);
}
