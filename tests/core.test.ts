import { describe, expect, it } from 'vitest';
import { detectCategory, learn } from '../src/categorize';
import { defaultCategories } from '../src/defaults';
import { crc32, buildXlsx, Style } from '../src/drivers/xlsx';
import { isoToSerial, mainCurrency, parseAmount, serialToIso, toIsoDate } from '../src/format';
import { setRatesForTest, toMain } from '../src/rates';
import { budgetAt, rowIds, rowsToBudgets, rowsToCategories, rowsToExpenses, type Expense } from '../src/schema';

const expense = (e: Partial<Expense>): Expense => ({
  id: '1',
  date: '2026-09-01',
  amount: 1,
  currency: mainCurrency,
  category: '',
  note: '',
  type: 'expense',
  group: '',
  tags: [],
  ...e,
});

describe('parseAmount', () => {
  it.each([
    ['12', 12],
    ['12,5', 12.5],
    ['12.50', 12.5],
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['€ 8', 8],
    ['8 €', 8],
    ['-3,20', -3.2],
    ['0,333', 0.33],
    ['1 000,00', 1000],
  ])('%s → %d', (input, expected) => expect(parseAmount(input)).toBe(expected));

  it.each(['', 'abc', '1-2', '..'])('rejects %s', (input) => expect(parseAmount(input)).toBeNull());
});

describe('dates', () => {
  it('round-trips spreadsheet serial numbers', () => {
    expect(isoToSerial('2026-09-22')).toBe(46287);
    expect(serialToIso(46287)).toBe('2026-09-22');
    expect(serialToIso(46287.75)).toBe('2026-09-22');
  });

  it('normalises cell values', () => {
    expect(toIsoDate('2026-09-22')).toBe('2026-09-22');
    expect(toIsoDate('2026-9-2')).toBe('2026-09-02');
    expect(toIsoDate('22/09/2026')).toBe('2026-09-22');
    expect(toIsoDate('22.09.2026')).toBe('2026-09-22');
    expect(toIsoDate(46287)).toBe('2026-09-22');
    expect(toIsoDate('31/02/2026')).toBeNull();
    expect(toIsoDate('hello')).toBeNull();
    expect(toIsoDate('')).toBeNull();
  });
});

describe('schema', () => {
  it('gives hand-typed rows stable fingerprint ids, keeping explicit ids', () => {
    const rows = [
      ['2026-09-01', 5, 'EUR', 'Spesa', 'Lidl', 'abc'],
      ['2026-09-01', 5, 'EUR', 'Spesa', 'Lidl'],
      ['2026-09-01', 5, 'EUR', 'Spesa', 'Lidl', ''],
      [],
    ];
    const ids = rowIds(rows);
    expect(ids[0]).toBe('abc');
    expect(ids[1]).toMatch(/^~/);
    expect(ids[2]).toBe(`${ids[1]}.2`);
    expect(rowIds(rows)).toEqual(ids);
  });

  it('parses expense rows and skips invalid ones, keeping ids aligned with rows', () => {
    const rows = [
      ['2026-09-01', '12,50', 'usd', ' Spesa ', 'Lidl', 'a', '', 'g1', 'Casa, Spesa'],
      [],
      ['nope', 3, '', '', '', 'b'],
      [46287, 7, '', 'Svago', '', 'c', 'INCOME'],
      ['2026-09-02', 1, 'XYZ', '', '', 'd'],
    ];
    const expenses = rowsToExpenses(rows);
    expect(expenses).toEqual([
      // "Spesa" is already the main category, so it is not repeated among the tags.
      { id: 'a', date: '2026-09-01', amount: 12.5, currency: 'USD', category: 'Spesa', note: 'Lidl', type: 'expense', group: 'g1', tags: ['Casa'] },
      { id: 'c', date: '2026-09-22', amount: 7, currency: mainCurrency, category: 'Svago', note: '', type: 'income', group: '', tags: [] },
      { id: 'd', date: '2026-09-02', amount: 1, currency: mainCurrency, category: '', note: '', type: 'expense', group: '', tags: [] },
    ]);
  });

  it('parses category rows, dropping blanks and duplicates', () => {
    const cats = rowsToCategories([['Spesa', '🛒', '#1baf7a', 'lidl, coop;esselunga'], [''], ['Spesa', 'x'], ['Altro']]);
    expect(cats).toEqual([
      { name: 'Spesa', icon: '🛒', color: '#1baf7a', keywords: ['lidl', 'coop', 'esselunga'] },
      { name: 'Altro', icon: '🏷️', color: '#898781', keywords: [] },
    ]);
  });
});

describe('detectCategory', () => {
  const it_ = defaultCategories('it');
  const name = (i: number) => it_[i].name;
  const empty = learn([]);

  it.each([
    ['Esselunga', 0],
    ['spesa settimanale', 0],
    ['Pizza con gli amici', 1],
    ['Caffè al bar', 1],
    ['Uber Eats sushi', 1],
    ['Benzina', 2],
    ['biglietto treno Milano', 2],
    ['Bolletta luce', 3],
    ['Farmacia', 4],
    ['parrucchiere', 4],
    ['Amazon', 5],
    ['Netflix', 6],
    ['Amazon Prime', 6],
    ['Volo Ryanair', 7],
    ['Hôtel à Paris', 7],
    ['Supermarché', 0],
    ['Tankstelle', 2],
    ['Farmacía', 4],
  ])('%s', (note, idx) => expect(detectCategory(note, it_, empty)).toBe(name(idx)));

  it('does not match short keywords inside other words', () => {
    expect(detectCategory('barbiere', it_, empty)).toBe(name(4));
  });

  it('returns null when nothing matches', () => {
    expect(detectCategory('xyz', it_, empty)).toBeNull();
    expect(detectCategory('', it_, empty)).toBeNull();
  });

  it('learns from history', () => {
    const history: Expense[] = [
      expense({ id: '1', date: '2026-09-01', amount: 30, category: name(6), note: 'Calcetto con Marco' }),
      expense({ id: '2', date: '2026-09-08', amount: 30, category: name(6), note: 'Calcetto' }),
      expense({ id: '3', date: '2026-09-10', amount: 12, category: name(3), note: 'Bar sotto casa' }),
    ];
    const model = learn(history);
    expect(detectCategory('calcetto giovedì', it_, model)).toBe(name(6));
    // An exact previous note beats keyword matches.
    expect(detectCategory('bar sotto casa', it_, model)).toBe(name(3));
  });

  it('only suggests categories that still exist', () => {
    const model = learn([expense({ id: '1', date: '2026-09-01', amount: 3, category: 'Deleted', note: 'gizmo' })]);
    expect(detectCategory('gizmo', it_, model)).toBeNull();
  });
});

describe('xlsx', () => {
  it('computes standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('builds a zip with all workbook parts', () => {
    const bytes = buildXlsx([
      { name: 'Expenses', rows: [['Date', 'Amount']], columns: [{ width: 10, style: Style.Date }, { width: 10, style: Style.Amount }] },
      { name: 'Categories', rows: [['Name'], ['Spesa & co <1>']], columns: [{ width: 10, style: Style.Text }] },
    ]);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(7);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('Spesa &amp; co &lt;1&gt;');
    expect(text).toContain('xl/worksheets/sheet2.xml');
  });
});

describe('toMain', () => {
  it('converts with the rate of the day, falling back to the previous business day', () => {
    const other = mainCurrency === 'USD' ? 'EUR' : 'USD';
    setRatesForTest({
      base: mainCurrency,
      from: '2026-09-17',
      symbols: [other],
      fetchedOn: '2026-09-21',
      rates: { '2026-09-17': { [other]: 2 }, '2026-09-18': { [other]: 4 }, '2026-09-21': { [other]: 5 } },
    });
    expect(toMain(10, mainCurrency, '2026-09-18')).toBe(10);
    expect(toMain(10, other, '2026-09-18')).toBe(2.5);
    expect(toMain(10, other, '2026-09-20')).toBe(2.5); // Sunday → Friday's rate
    expect(toMain(10, other, '2026-09-01')).toBe(5); // before the cache → earliest known
    expect(toMain(10, 'JPY', '2026-09-18')).toBeNull();
    setRatesForTest(null);
    expect(toMain(10, other, '2026-09-18')).toBeNull();
  });
});

describe('budgets', () => {
  const rows = [
    ['2026-01', '', 1500, 'EUR'],
    ['2026-09', '', 1200, 'EUR'],
    ['2026-03', 'Spesa', 300, 'EUR'],
    ['nope', '', 100, 'EUR'],
    ['2026-05', '', 'x', 'EUR'],
  ];

  it('reads rows, dropping invalid ones, sorted by month', () => {
    expect(rowsToBudgets(rows).map((b) => [b.month, b.category, b.amount])).toEqual([
      ['2026-01', '', 1500],
      ['2026-03', 'Spesa', 300],
      ['2026-09', '', 1200],
    ]);
  });

  it('uses the budget in force in each month, per category', () => {
    const entries = rowsToBudgets(rows);
    expect(budgetAt(entries, '2026-05')?.amount).toBe(1500);
    expect(budgetAt(entries, '2026-09')?.amount).toBe(1200);
    expect(budgetAt(entries, '2026-12')?.amount).toBe(1200);
    expect(budgetAt(entries, '2025-12')).toBeNull();
    expect(budgetAt(entries, '2026-04', 'Spesa')?.amount).toBe(300);
    expect(budgetAt(entries, '2026-02', 'Spesa')).toBeNull();
  });

  it('treats a zero amount as no budget', () => {
    expect(budgetAt(rowsToBudgets([['2026-01', '', 500, 'EUR'], ['2026-06', '', 0, 'EUR']]), '2026-07')).toBeNull();
  });
});
