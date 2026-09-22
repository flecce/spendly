import { COL, rowIds, type Row } from '../schema';
import type { Driver } from './types';

const KEY = 'spendly.local.db';

/** Demo / offline-only backend: the "spreadsheet" lives in localStorage. */
export class LocalDriver implements Driver {
  readonly fileUrl = null;
  private db: { expenses: Row[]; categories: Row[]; settings: Row[] } = { expenses: [], categories: [], settings: [] };

  async connect(seedCategories: Row[]): Promise<void> {
    const saved = localStorage.getItem(KEY);
    if (saved) this.db = { settings: [], ...JSON.parse(saved) };
    else {
      this.db = { expenses: [], categories: seedCategories, settings: [] };
      this.save();
    }
  }

  private save(): void {
    localStorage.setItem(KEY, JSON.stringify(this.db));
  }

  async read() {
    return structuredClone(this.db);
  }

  async appendExpense(row: Row): Promise<void> {
    this.db.expenses.push(row);
    this.save();
  }

  async upsertExpense(id: string, row: Row): Promise<void> {
    const i = rowIds(this.db.expenses).indexOf(id);
    if (i < 0) this.db.expenses.push(row);
    else this.db.expenses[i] = row;
    this.save();
  }

  async deleteExpense(id: string): Promise<void> {
    const i = rowIds(this.db.expenses).indexOf(id);
    if (i >= 0) this.db.expenses.splice(i, 1);
    this.save();
  }

  async writeCategories(rows: Row[]): Promise<void> {
    this.db.categories = rows;
    this.save();
  }

  async writeSettings(rows: Row[]): Promise<void> {
    this.db.settings = rows;
    this.save();
  }

  async writeExpenseCategories(values: string[]): Promise<void> {
    values.forEach((v, i) => {
      if (this.db.expenses[i]) this.db.expenses[i][COL.category] = v;
    });
    this.save();
  }
}
