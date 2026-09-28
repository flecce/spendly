import { today } from './format';
import {
  budgetToRow,
  categoryToRow,
  expenseToRow,
  rowsToBudgets,
  rowsToCategories,
  rowsToExpenses,
  rowsToSettings,
  settingsToRows,
  type BudgetEntry,
  type Category,
  type Expense,
  type Row,
  type Settings,
} from './schema';

/**
 * A backup file carries the same rows as the spreadsheet, so importing it goes through
 * the same parsing (and forgiveness) as reading the file, whichever account made it.
 */
const APP = 'spendly';
const VERSION = 1;

export interface Data {
  expenses: Expense[];
  categories: Category[];
  budgets: BudgetEntry[];
  settings: Settings;
}

interface BackupFile {
  app: typeof APP;
  version: number;
  exportedAt: string;
  expenses: Row[];
  categories: Row[];
  budgets: Row[];
  settings: Row[];
}

export function toBackup(d: Data): string {
  const file: BackupFile = {
    app: APP,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    expenses: d.expenses.map(expenseToRow),
    categories: d.categories.map(categoryToRow),
    budgets: d.budgets.map(budgetToRow),
    settings: settingsToRows(d.settings),
  };
  return JSON.stringify(file);
}

const rows = (v: unknown): unknown[][] => (Array.isArray(v) ? v.filter(Array.isArray) : []);

/** Parses a backup file; null when it isn't one. */
export function fromBackup(text: string): Data | null {
  let file: Partial<BackupFile>;
  try {
    file = JSON.parse(text);
  } catch {
    return null;
  }
  if (!file || typeof file !== 'object' || file.app !== APP) return null;
  return {
    expenses: rowsToExpenses(rows(file.expenses)),
    categories: rowsToCategories(rows(file.categories)),
    budgets: rowsToBudgets(rows(file.budgets)),
    settings: rowsToSettings(rows(file.settings)),
  };
}

/**
 * What a backup adds to the current data: expenses, categories, budget entries and
 * settings that aren't there yet. Nothing already present is overwritten, so importing
 * the same file twice changes nothing.
 */
export function newInBackup(current: Data, backup: Data): Data {
  const ids = new Set(current.expenses.map((e) => e.id));
  const names = new Set(current.categories.map((c) => c.name));
  const budgetKey = (b: BudgetEntry) => `${b.month}|${b.category}`;
  const budgets = new Set(current.budgets.map(budgetKey));
  return {
    expenses: backup.expenses.filter((e) => !ids.has(e.id)),
    categories: backup.categories.filter((c) => !names.has(c.name)),
    budgets: backup.budgets.filter((b) => !budgets.has(budgetKey(b))),
    settings: Object.fromEntries(Object.entries(backup.settings).filter(([k]) => !(k in current.settings))),
  };
}

export const isEmpty = (d: Data): boolean =>
  !d.expenses.length && !d.categories.length && !d.budgets.length && !Object.keys(d.settings).length;

/** Saves the data as a file in the browser's downloads. */
export function download(d: Data): void {
  const url = URL.createObjectURL(new Blob([toBackup(d)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `spendly-${today()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
