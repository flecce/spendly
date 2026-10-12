import { describe, expect, it } from 'vitest';
import { dueOccurrences, isFinished, lastDate, nextDate, occurrenceDate } from '../src/recurring';
import { recurringToRow, rowsToRecurring, type Recurring } from '../src/schema';

const recurring = (r: Partial<Recurring> = {}): Recurring => ({
  id: 'm',
  note: 'Rata mutuo',
  amount: 650,
  currency: 'EUR',
  category: 'home',
  tags: ['bank'],
  type: 'expense',
  start: '2026-01-15',
  every: 1,
  unit: 'month',
  count: 0,
  done: 0,
  ...r,
});

const dates = (r: Recurring, n: number) => Array.from({ length: n }, (_, i) => occurrenceDate(r, i));

describe('occurrenceDate', () => {
  it('keeps the day of the month, or the last day when the month is shorter', () => {
    expect(dates(recurring({ start: '2026-01-31' }), 4)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(occurrenceDate(recurring({ start: '2027-12-31' }), 2)).toBe('2028-02-29');
  });

  it('steps by several months across the year', () => {
    expect(dates(recurring({ start: '2026-11-15', every: 3 }), 3)).toEqual(['2026-11-15', '2027-02-15', '2027-05-15']);
    expect(occurrenceDate(recurring({ start: '2026-01-15' }), 239)).toBe('2045-12-15');
  });

  it('handles weeks, days and years', () => {
    expect(dates(recurring({ start: '2026-10-12', unit: 'week', every: 2 }), 3)).toEqual(['2026-10-12', '2026-10-26', '2026-11-09']);
    // Across the switch to winter time.
    expect(occurrenceDate(recurring({ start: '2026-10-24', unit: 'day' }), 2)).toBe('2026-10-26');
    expect(dates(recurring({ start: '2028-02-29', unit: 'year' }), 2)).toEqual(['2028-02-29', '2029-02-28']);
    expect(occurrenceDate(recurring({ start: '2028-02-29', unit: 'year' }), 4)).toBe('2032-02-29');
  });
});

describe('dueOccurrences', () => {
  it('adds the occurrences whose day has come, linked to the recurrence', () => {
    const due = dueOccurrences(recurring(), '2026-03-15');
    expect(due.map((e) => [e.id, e.date])).toEqual([
      ['m-1', '2026-01-15'],
      ['m-2', '2026-02-15'],
      ['m-3', '2026-03-15'],
    ]);
    expect(due[0]).toMatchObject({ amount: 650, currency: 'EUR', category: 'home', tags: ['bank'], note: 'Rata mutuo', type: 'expense', group: '', recurring: 'm' });
  });

  it('skips what was already added and stops at the number of times', () => {
    expect(dueOccurrences(recurring({ done: 2 }), '2026-03-20').map((e) => e.id)).toEqual(['m-3']);
    expect(dueOccurrences(recurring({ done: 3 }), '2026-03-20')).toEqual([]);
    expect(dueOccurrences(recurring({ count: 2 }), '2027-01-01').map((e) => e.id)).toEqual(['m-1', 'm-2']);
    expect(dueOccurrences(recurring({ start: '2026-12-01' }), '2026-11-30')).toEqual([]);
  });

  it('caps a start far in the past, the rest come next time', () => {
    expect(dueOccurrences(recurring({ start: '2000-01-01', unit: 'day' }), '2026-10-12')).toHaveLength(500);
  });
});

describe('next and last occurrence', () => {
  it('knows where a recurrence stands', () => {
    expect(nextDate(recurring({ done: 2 }))).toBe('2026-03-15');
    expect(lastDate(recurring({ count: 240 }))).toBe('2045-12-15');
    expect(lastDate(recurring())).toBeNull();
    expect(isFinished(recurring({ count: 3, done: 3 }))).toBe(true);
    expect(nextDate(recurring({ count: 3, done: 3 }))).toBeNull();
    expect(isFinished(recurring({ done: 300 }))).toBe(false);
  });
});

describe('Recurring sheet', () => {
  it('round-trips rows', () => {
    const list = [recurring({ count: 240, done: 9 }), recurring({ id: 's', type: 'income', tags: [], unit: 'week', every: 2 })];
    expect(rowsToRecurring(list.map(recurringToRow))).toEqual(list);
    // No end is a blank cell, not 0.
    expect(recurringToRow(list[1])[9]).toBe('');
  });

  it('forgives rows typed by hand', () => {
    const [r] = rowsToRecurring([['Netflix', '12,99', '', 'fun', '', '', '15/01/2026', '', 'Months', '', '', '']]);
    expect(r).toMatchObject({ id: '', amount: 12.99, start: '2026-01-15', every: 1, unit: 'month', count: 0, done: 0 });
    expect(rowsToRecurring([['Gym', 30, 'EUR', '', '', '', 46037, 1, 'week', 10, 2, 'g']])[0].start).toBe('2026-01-15');
  });

  it('skips rows that cannot repeat', () => {
    const rows = [
      ['No date', 10, 'EUR', '', '', '', '', 1, 'month', '', 0, 'a'],
      ['No amount', '', 'EUR', '', '', '', '2026-01-01', 1, 'month', '', 0, 'b'],
      ['Every 0', 10, 'EUR', '', '', '', '2026-01-01', 0, 'month', '', 0, 'c'],
      ['Half times', 10, 'EUR', '', '', '', '2026-01-01', 1, 'month', 2.5, 0, 'd'],
    ];
    expect(rowsToRecurring(rows)).toEqual([]);
  });
});
