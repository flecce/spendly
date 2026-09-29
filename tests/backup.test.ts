import { describe, expect, it } from 'vitest';
import { fromBackup, isEmpty, newInBackup, toBackup } from '../src/backup';
import type { Category, Data, Expense } from '../src/schema';

const exp = (id: string, extra: Partial<Expense> = {}): Expense => ({
  id,
  date: '2026-09-10',
  amount: 12.5,
  currency: 'EUR',
  category: 'food',
  note: 'Pizza',
  type: 'expense',
  group: '',
  tags: [],
  ...extra,
});

const cat = (id: string, name: string, extra: Partial<Category> = {}): Category => ({
  id,
  name,
  names: {},
  icon: '🏷️',
  color: '#898781',
  keywords: [],
  ...extra,
});

const data: Data = {
  expenses: [exp('a'), exp('b', { type: 'income', category: 'salary', amount: 2000, note: '' }), exp('c', { group: 'g1', tags: ['trip'] })],
  categories: [
    cat('food', 'Food', { names: { en: 'Food', it: 'Cibo' }, icon: '🍕', color: '#f00', keywords: ['pizza', 'sushi'] }),
    cat('salary', 'Salary', { icon: '💼' }),
    cat('trip', 'Trip'),
  ],
  budgets: [
    { month: '2026-01', category: '', amount: 1000, currency: 'EUR' },
    { month: '2026-03', category: 'food', amount: 300, currency: 'EUR' },
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

  it('reads version 1 files, which reference categories by name', () => {
    const v1 = JSON.stringify({
      app: 'spendly',
      version: 1,
      expenses: [['2026-09-10', 5, 'EUR', 'Spesa', 'Lidl', 'x1', '', '', 'Barca']],
      categories: [['Spesa', '🛒', '#1baf7a', 'lidl'], ['Barca', '⛵', '#898781', '']],
      budgets: [['2026-01', 'Barca', 50, 'EUR']],
      settings: [],
    });
    const d = fromBackup(v1)!;
    expect(d.categories.map((c) => c.id)).toEqual(['groceries', 'barca']);
    expect(d.expenses[0]).toMatchObject({ category: 'groceries', tags: ['barca'] });
    expect(d.budgets[0].category).toBe('barca');
  });

  it('adds everything to an empty account', () => {
    expect(newInBackup(empty, data)).toEqual(data);
  });

  it('skips what is already there (categories by ID), so importing twice changes nothing', () => {
    const current: Data = {
      expenses: [exp('a')],
      categories: [cat('food', 'Cibo')],
      budgets: [{ month: '2026-01', category: '', amount: 500, currency: 'EUR' }],
      settings: { someKey: 'y' },
    };
    const add = newInBackup(current, data);
    expect(add.expenses.map((e) => e.id)).toEqual(['b', 'c']);
    expect(add.categories.map((c) => c.id)).toEqual(['salary', 'trip']);
    expect(add.budgets).toEqual([data.budgets[1]]);
    expect(add.settings).toEqual({});
    expect(isEmpty(newInBackup(data, data))).toBe(true);
  });
});
