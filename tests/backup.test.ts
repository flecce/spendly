import { describe, expect, it } from 'vitest';
import { fromBackup, isEmpty, newInBackup, toBackup, type Data } from '../src/backup';
import type { Expense } from '../src/schema';

const exp = (id: string, extra: Partial<Expense> = {}): Expense => ({
  id,
  date: '2026-09-10',
  amount: 12.5,
  currency: 'EUR',
  category: 'Food',
  note: 'Pizza',
  type: 'expense',
  group: '',
  tags: [],
  ...extra,
});

const data: Data = {
  expenses: [exp('a'), exp('b', { type: 'income', category: 'Salary', amount: 2000, note: '' }), exp('c', { group: 'g1', tags: ['Trip'] })],
  categories: [
    { name: 'Food', icon: '🍕', color: '#f00', keywords: ['pizza', 'sushi'] },
    { name: 'Salary', icon: '💼', color: '#0f0', keywords: [] },
  ],
  budgets: [
    { month: '2026-01', category: '', amount: 1000, currency: 'EUR' },
    { month: '2026-03', category: 'Food', amount: 300, currency: 'EUR' },
  ],
  settings: { someKey: 'x' },
};

const empty: Data = { expenses: [], categories: [], budgets: [], settings: {} };

describe('backup', () => {
  it('round-trips everything', () => {
    expect(fromBackup(toBackup(data))).toEqual(data);
  });

  it('rejects files that are not a Spendly export', () => {
    expect(fromBackup('not json')).toBeNull();
    expect(fromBackup('{"expenses":[]}')).toBeNull();
    expect(fromBackup('null')).toBeNull();
  });

  it('adds everything to an empty account', () => {
    expect(newInBackup(empty, data)).toEqual(data);
  });

  it('skips what is already there, so importing twice changes nothing', () => {
    const current: Data = {
      expenses: [exp('a')],
      categories: [{ name: 'Food', icon: '🍔', color: '#000', keywords: [] }],
      budgets: [{ month: '2026-01', category: '', amount: 500, currency: 'EUR' }],
      settings: { someKey: 'y' },
    };
    const add = newInBackup(current, data);
    expect(add.expenses.map((e) => e.id)).toEqual(['b', 'c']);
    expect(add.categories.map((c) => c.name)).toEqual(['Salary']);
    expect(add.budgets).toEqual([data.budgets[1]]);
    expect(add.settings).toEqual({});
    expect(isEmpty(newInBackup(data, data))).toBe(true);
  });
});
