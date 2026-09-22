import { describe, expect, it } from 'vitest';
import { budgetStatus, suggestedBudget } from '../src/budget';
import { mainCurrency } from '../src/format';
import type { Expense } from '../src/schema';

let n = 0;
const exp = (date: string, amount: number): Expense => ({ id: String(n++), date, amount, currency: mainCurrency, category: '', note: '' });
const budget = (amount: number) => ({ amount, currency: mainCurrency });

describe('budgetStatus', () => {
  it('is on track when spending follows the month pace', () => {
    const s = budgetStatus([exp('2026-09-02', 100), exp('2026-09-09', 200), exp('2026-08-30', 999)], budget(1000), '2026-09-10');
    expect(s.state).toBe('ok');
    expect(s.spent).toBe(300);
    expect(s.remaining).toBe(700);
    expect(s.pace).toBeCloseTo(10 / 30);
    expect(s.daily).toBeCloseTo(700 / 21); // 21 days left, today included
  });

  it('warns when spending runs ahead of the pace, with a projection', () => {
    const s = budgetStatus([exp('2026-09-05', 450)], budget(1000), '2026-09-10');
    expect(s.state).toBe('warn');
    expect(s.projected).toBe(1350);
  });

  it('warns near the limit even late in the month', () => {
    expect(budgetStatus([exp('2026-09-20', 920)], budget(1000), '2026-09-29').state).toBe('warn');
  });

  it('does not alarm for small spending on the first day', () => {
    expect(budgetStatus([exp('2026-09-01', 60)], budget(1500), '2026-09-01').state).toBe('ok');
  });

  it('is over when the budget is exceeded', () => {
    const s = budgetStatus([exp('2026-09-05', 600), exp('2026-09-06', 500)], budget(1000), '2026-09-10');
    expect(s.state).toBe('over');
    expect(s.remaining).toBe(-100);
    expect(s.daily).toBeNull();
  });

  it('handles month lengths (February)', () => {
    expect(budgetStatus([], budget(280), '2027-02-14').pace).toBeCloseTo(14 / 28);
  });
});

describe('suggestedBudget', () => {
  it('averages the last months, rounded, ignoring the current one', () => {
    const list = [exp('2026-06-10', 900), exp('2026-07-10', 1200), exp('2026-08-10', 1110), exp('2026-09-10', 5000), exp('2026-01-10', 10)];
    expect(suggestedBudget(list, '2026-09-22')).toBe(1050);
  });

  it('returns null without history', () => {
    expect(suggestedBudget([exp('2026-09-10', 50)], '2026-09-22')).toBeNull();
  });
});
