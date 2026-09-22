import type { Row } from '../schema';

/**
 * A storage backend for the two sheets. All row arrays exclude the header row.
 * Expense rows are addressed by their ID column (see rowIds), so edits made
 * directly in the spreadsheet don't break updates and deletes.
 */
export interface Driver {
  /** Link to open the file in its native app (null for local storage). */
  readonly fileUrl: string | null;
  /** Finds the data file, creating it (seeded with these category rows) on first use. */
  connect(seedCategories: Row[]): Promise<void>;
  read(): Promise<{ expenses: unknown[][]; categories: unknown[][]; budgets: unknown[][]; settings: unknown[][] }>;
  appendExpense(row: Row): Promise<void>;
  /** Updates the row with this id, or appends it when it is not in the sheet (anymore). */
  upsertExpense(id: string, row: Row): Promise<void>;
  /** Deletes the row with this id; no-op when it's already gone. */
  deleteExpense(id: string): Promise<void>;
  /** Replaces all category rows. */
  writeCategories(rows: Row[]): Promise<void>;
  /** Replaces all budget rows (the sheet is created if an older file lacks it). */
  writeBudgets(rows: Row[]): Promise<void>;
  /** Replaces all settings rows (the Settings sheet is created if an older file lacks it). */
  writeSettings(rows: Row[]): Promise<void>;
  /** Rewrites the Category and Tags columns of the expense rows, top to bottom (used when renaming). */
  writeExpenseCategories(values: string[]): Promise<void>;
  writeExpenseTags(values: string[]): Promise<void>;
}
