import { describe, expect, it } from 'vitest';
import { flows } from '../src/sankey';
import { mainCurrency } from '../src/format';
import type { Expense } from '../src/schema';

let n = 0;
const entry = (amount: number, category: string, type: Expense['type'] = 'expense'): [Expense, number] => [
  { id: String(n++), date: '2026-09-10', amount, currency: mainCurrency, category, note: '', type, group: '', tags: [] },
  amount,
];

describe('flows', () => {
  it('sends what is left of the income to "saved"', () => {
    const f = flows([entry(2000, 'Stipendio', 'income'), entry(300, 'Spesa'), entry(500, 'Casa'), entry(200, 'Spesa')]);
    expect(f.left).toEqual([{ kind: 'income', name: 'Stipendio', value: 2000 }]);
    expect(f.right).toEqual([
      { kind: 'spend', name: 'Spesa', value: 500 },
      { kind: 'spend', name: 'Casa', value: 500 },
      { kind: 'saved', name: '', value: 1000 },
    ]);
    expect(f.total).toBe(2000);
  });

  it('brings spending beyond the income in as a shortfall', () => {
    const f = flows([entry(400, 'Stipendio', 'income'), entry(700, 'Casa')]);
    expect(f.left.at(-1)).toEqual({ kind: 'shortfall', name: '', value: 300 });
    expect(f.right).toEqual([{ kind: 'spend', name: 'Casa', value: 700 }]);
    expect(f.total).toBe(700);
  });

  it('merges the smallest categories into "other" and keeps both sides balanced', () => {
    const f = flows([entry(1000, 'A', 'income'), ...Array.from({ length: 10 }, (_, i) => entry(10 * (i + 1), `C${i}`))]);
    expect(f.right.filter((x) => x.kind !== 'saved')).toHaveLength(8);
    expect(f.right[7]).toEqual({ kind: 'other', name: '', value: 10 + 20 + 30 });
    const sum = (xs: { value: number }[]) => xs.reduce((s, x) => s + x.value, 0);
    expect(sum(f.left)).toBe(sum(f.right));
  });
});
