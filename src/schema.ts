import { isCurrency, mainCurrency, parseAmount, toIsoDate } from './format';

/**
 * The spreadsheet is the database. Two sheets, first row is the header:
 *   Expenses:   Date | Amount | Currency | Category | Note | ID | Type | Group | Tags
 *   Categories: Name  | Icon     | Color    | Keywords (comma separated)
 *   Budgets:    Month | Category | Amount   | Currency
 *   Settings:   Key   | Value
 * Expenses reference categories by name so the file stays readable by humans.
 * Amounts are stored in the currency they were paid in (ISO code, blank = main currency).
 * Type is blank for a normal expense and "income" for money coming in; Group ties
 * together the parts of one expense split across categories. Tags are further categories
 * an expense belongs to: they are searchable, while the amount counts in Category alone.
 * A Budgets row applies from its month on (blank category = the overall budget), so
 * changing the budget never rewrites the past.
 */
export type SheetName = 'Expenses' | 'Categories' | 'Budgets' | 'Settings';
export type Cell = string | number;
export type Row = Cell[];

// Type and Group were added after ID so that files created earlier keep working as they are.
export const EXPENSE_HEADER: Row = ['Date', 'Amount', 'Currency', 'Category', 'Note', 'ID', 'Type', 'Group', 'Tags'];
/** Column positions in the Expenses sheet. */
export const COL = { date: 0, amount: 1, currency: 2, category: 3, note: 4, id: 5, type: 6, group: 7, tags: 8 } as const;
export const CATEGORY_HEADER: Row = ['Name', 'Icon', 'Color', 'Keywords'];
export const BUDGET_HEADER: Row = ['Month', 'Category', 'Amount', 'Currency'];
export const SETTINGS_HEADER: Row = ['Key', 'Value'];

export type ExpenseType = 'expense' | 'income';

export interface Expense {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  currency: string; // ISO 4217
  category: string;
  note: string;
  type: ExpenseType;
  /** Shared by the parts of one expense split across categories ('' when not split). */
  group: string;
  /** Further categories this expense belongs to; the amount still counts in `category`. */
  tags: string[];
}

export interface Category {
  name: string;
  icon: string;
  color: string;
  keywords: string[];
}

/** Key/value preferences shared by every device using the file. */
export type Settings = Record<string, Cell>;

export interface Budget {
  amount: number;
  currency: string;
}

/** A budget that applies from `month` on; `category` is '' for the overall budget. */
export interface BudgetEntry extends Budget {
  month: string; // YYYY-MM
  category: string;
}

export const newId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

export const expenseToRow = (e: Expense): Row => [
  e.date,
  e.amount,
  e.currency,
  e.category,
  e.note,
  e.id,
  e.type === 'income' ? 'income' : '',
  e.group,
  e.tags.join(', '),
];

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/**
 * Stable id for every data row. Rows typed by hand in the spreadsheet have no ID,
 * so they get a content fingerprint ("~…") that the drivers can find again.
 */
export function rowIds(rows: unknown[][]): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const id = text(row[COL.id]);
    if (id) return id;
    const base = '~' + hash(row.slice(0, COL.id).map(text).join('|'));
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}.${n}`;
  });
}

export function rowsToExpenses(rows: unknown[][]): Expense[] {
  const ids = rowIds(rows);
  const out: Expense[] = [];
  rows.forEach((row, i) => {
    const date = toIsoDate(row[COL.date]);
    const raw = row[COL.amount];
    const amount = typeof raw === 'number' ? raw : parseAmount(text(raw));
    if (!date || amount === null) return;
    const code = text(row[COL.currency]).toUpperCase();
    out.push({
      id: ids[i],
      date,
      amount,
      currency: isCurrency(code) ? code : mainCurrency,
      category: text(row[COL.category]),
      note: text(row[COL.note]),
      type: text(row[COL.type]).toLowerCase() === 'income' ? 'income' : 'expense',
      group: text(row[COL.group]),
      tags: splitKeywords(text(row[COL.tags])).filter((tag) => tag !== text(row[COL.category])),
    });
  });
  return out;
}

/** Every category an expense touches: the one that counts first, then its tags. */
export const allCategories = (e: Expense): string[] => [e.category, ...e.tags].filter(Boolean);

export const splitKeywords = (s: string): string[] =>
  s.split(/[,;\n]/).map((k) => k.trim()).filter(Boolean);

export const categoryToRow = (c: Category): Row => [c.name, c.icon, c.color, c.keywords.join(', ')];

export function rowsToCategories(rows: unknown[][]): Category[] {
  const out: Category[] = [];
  for (const row of rows) {
    const name = text(row[0]);
    if (!name || out.some((c) => c.name === name)) continue;
    out.push({ name, icon: text(row[1]) || '🏷️', color: text(row[2]) || '#898781', keywords: splitKeywords(text(row[3])) });
  }
  return out;
}

export const budgetToRow = (b: BudgetEntry): Row => [b.month, b.category, b.amount, b.currency];

export function rowsToBudgets(rows: unknown[][]): BudgetEntry[] {
  const out: BudgetEntry[] = [];
  for (const row of rows) {
    const month = text(row[0]).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const raw = row[2];
    const amount = typeof raw === 'number' ? raw : parseAmount(text(raw));
    if (amount === null || amount < 0) continue;
    const currency = text(row[3]).toUpperCase();
    out.push({ month, category: text(row[1]), amount, currency: isCurrency(currency) ? currency : mainCurrency });
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}

/** The budget in force for a category ('' = overall) in that month: the latest entry up to it. */
export function budgetAt(entries: BudgetEntry[], month: string, category = ''): Budget | null {
  let found: BudgetEntry | undefined;
  for (const e of entries) {
    if (e.category === category && e.month <= month) found = e; // entries are sorted by month
  }
  return found && found.amount > 0 ? { amount: found.amount, currency: found.currency } : null;
}

export function rowsToSettings(rows: unknown[][]): Settings {
  const out: Settings = {};
  for (const row of rows) {
    const key = text(row[0]);
    if (key) out[key] = typeof row[1] === 'number' ? row[1] : text(row[1]);
  }
  return out;
}

export const settingsToRows = (s: Settings): Row[] => Object.entries(s).map(([k, v]) => [k, v]);

/** Newest first; within the same day, the last one entered first. */
export function sortByDateDesc(list: Expense[], order: Expense[]): Expense[] {
  const index = new Map(order.map((e, i) => [e, i]));
  return [...list].sort((a, b) => b.date.localeCompare(a.date) || index.get(b)! - index.get(a)!);
}
