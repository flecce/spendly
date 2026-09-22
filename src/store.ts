import { cacheKey, type Account } from './auth/session';
import { readJson } from './auth/util';
import { learn, type Model } from './categorize';
import { AuthError, HttpError } from './drivers/http';
import type { Driver } from './drivers/types';
import { isCurrency, mainCurrency } from './format';
import {
  categoryToRow,
  COL,
  expenseToRow,
  rowsToCategories,
  rowsToExpenses,
  rowsToSettings,
  settingsToRows,
  type Budget,
  type Category,
  type Expense,
  type Row,
  type Settings,
} from './schema';

/**
 * App state with optimistic writes: every change is applied locally at once, then
 * queued and replayed against the spreadsheet in order. The queue and a copy of the
 * data are persisted, so the app opens instantly and survives being offline.
 */

type Op =
  | { t: 'add'; row: Row; tried?: boolean }
  | { t: 'upsert'; id: string; row: Row }
  | { t: 'delete'; id: string }
  | { t: 'categories'; rows: Row[] }
  | { t: 'settings'; rows: Row[] }
  | { t: 'rename'; from: string; to: string };

export type SyncState = 'idle' | 'syncing' | 'offline' | 'auth' | 'error';
type Topic = 'data' | 'sync';

interface Cache {
  expenses: Expense[];
  categories: Category[];
  settings?: Settings;
  queue: Op[];
}

const isNetworkError = (e: unknown) => e instanceof TypeError || !navigator.onLine;

class Store {
  expenses: Expense[] = [];
  categories: Category[] = [];
  settings: Settings = {};
  queue: Op[] = [];
  sync: SyncState = 'idle';
  /** True once there is data to show (from the cache or the file). */
  ready = false;
  fileUrl: string | null = null;

  private key = '';
  private driver: Driver | null = null;
  private connected = false;
  private seed: Category[] = [];
  private flushing: Promise<void> | null = null;
  private version = 0;
  private lastPull = 0;
  private model: Model | null = null;
  private listeners = new Set<(topic: Topic) => void>();

  on(fn: (topic: Topic) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(topic: Topic): void {
    for (const fn of this.listeners) fn(topic);
  }

  private setSync(s: SyncState): void {
    if (this.sync === s) return;
    this.sync = s;
    this.emit('sync');
  }

  /** Categorisation model learned from the user's history (rebuilt lazily after changes). */
  get history(): Model {
    return (this.model ??= learn(this.expenses));
  }

  init(account: Account): void {
    this.key = cacheKey(account);
    const cache = readJson<Cache>(this.key);
    if (cache) {
      this.expenses = cache.expenses;
      this.categories = cache.categories;
      this.settings = cache.settings ?? {};
      this.queue = cache.queue ?? [];
      this.ready = true;
    }
  }

  private persist(): void {
    const cache: Cache = { expenses: this.expenses, categories: this.categories, settings: this.settings, queue: this.queue };
    try {
      localStorage.setItem(this.key, JSON.stringify(cache));
    } catch (e) {
      console.warn('Could not cache data', e);
    }
  }

  private changed(): void {
    this.version++;
    this.model = null;
    this.persist();
    this.emit('data');
  }

  connect(driver: Driver, seedCategories: Category[]): Promise<void> {
    this.driver = driver;
    this.connected = false;
    this.seed = seedCategories;
    return this.retry();
  }

  /** (Re)connects to the file if needed, pushes pending changes and reloads. */
  async retry(): Promise<void> {
    if (!this.driver) return;
    if (!this.connected) {
      this.setSync('syncing');
      try {
        const driver = this.driver;
        await driver.connect(this.seed.map(categoryToRow));
        if (driver !== this.driver) return;
        this.connected = true;
        this.fileUrl = driver.fileUrl;
      } catch (e) {
        return this.fail(e);
      }
    }
    await this.refresh();
  }

  /** Pushes pending changes, then reloads everything from the file. */
  async refresh(): Promise<void> {
    if (!this.driver || !this.connected) return;
    await this.flush();
    if (this.queue.length || this.sync !== 'idle') return;
    const version = this.version;
    this.setSync('syncing');
    try {
      const data = await this.driver.read();
      this.lastPull = Date.now();
      // A local change happened while reading: keep it, the next refresh will catch up.
      if (version === this.version && !this.queue.length) {
        this.expenses = rowsToExpenses(data.expenses);
        this.categories = rowsToCategories(data.categories);
        this.settings = rowsToSettings(data.settings);
        this.ready = true;
        this.changed();
      }
      this.setSync('idle');
    } catch (e) {
      this.fail(e);
    }
  }

  /** Refresh if the data is older than `ms` (e.g. when the app comes back to the foreground). */
  refreshIfStale(ms: number): void {
    if (this.connected && Date.now() - this.lastPull > ms) void this.refresh();
  }

  flush(): Promise<void> {
    this.flushing ??= this.runQueue().finally(() => (this.flushing = null));
    return this.flushing;
  }

  private async runQueue(): Promise<void> {
    const driver = this.driver;
    if (!driver || !this.connected) return;
    while (this.queue.length) {
      this.setSync('syncing');
      const op = this.queue[0];
      try {
        await this.apply(driver, op);
      } catch (e) {
        // A request rejected as malformed will never succeed: drop it rather than block the queue.
        if (e instanceof HttpError && e.status === 400) {
          console.error('Dropping change rejected by the server', op, e);
        } else {
          if (op.t === 'add') op.tried = true;
          this.persist();
          return this.fail(e);
        }
      }
      this.queue.shift();
      this.persist();
      this.emit('sync');
    }
    this.setSync('idle');
  }

  private async apply(d: Driver, op: Op): Promise<void> {
    switch (op.t) {
      case 'add':
        // If a previous attempt may have reached the server, don't append a duplicate.
        return op.tried ? d.upsertExpense(String(op.row[COL.id]), op.row) : d.appendExpense(op.row);
      case 'upsert':
        return d.upsertExpense(op.id, op.row);
      case 'delete':
        return d.deleteExpense(op.id);
      case 'categories':
        return d.writeCategories(op.rows);
      case 'settings':
        return d.writeSettings(op.rows);
      case 'rename': {
        const { expenses } = await d.read();
        const column = expenses.map((r) => {
          const cat = String(r[COL.category] ?? '').trim();
          return cat === op.from ? op.to : cat;
        });
        if (column.includes(op.to)) await d.writeExpenseCategories(column);
      }
    }
  }

  private fail(e: unknown): void {
    if (e instanceof AuthError) this.setSync('auth');
    else if (isNetworkError(e)) this.setSync('offline');
    else {
      console.error(e);
      this.setSync('error');
    }
  }

  private enqueue(op: Op): void {
    this.queue.push(op);
    this.changed();
    void this.flush();
  }

  // ---- Mutations ----

  addExpense(e: Expense): void {
    this.expenses.push(e);
    this.enqueue({ t: 'add', row: expenseToRow(e) });
  }

  updateExpense(e: Expense): void {
    const i = this.expenses.findIndex((x) => x.id === e.id);
    if (i < 0) return;
    this.expenses[i] = e;
    this.enqueue({ t: 'upsert', id: e.id, row: expenseToRow(e) });
  }

  deleteExpense(id: string): void {
    this.expenses = this.expenses.filter((x) => x.id !== id);
    this.enqueue({ t: 'delete', id });
  }

  /** Creates (previous = null) or updates a category; renaming also renames it on existing expenses. */
  saveCategory(previous: string | null, c: Category): void {
    if (previous === null) this.categories.push(c);
    else {
      this.categories = this.categories.map((x) => (x.name === previous ? c : x));
      if (previous !== c.name) {
        this.expenses = this.expenses.map((e) => (e.category === previous ? { ...e, category: c.name } : e));
        this.queue.push({ t: 'rename', from: previous, to: c.name });
      }
    }
    this.enqueue({ t: 'categories', rows: this.categories.map(categoryToRow) });
  }

  deleteCategory(name: string): void {
    this.categories = this.categories.filter((c) => c.name !== name);
    this.enqueue({ t: 'categories', rows: this.categories.map(categoryToRow) });
  }

  /** Monthly budget (the same amount every month), or null when not set. */
  get budget(): Budget | null {
    const amount = Number(this.settings.monthlyBudget);
    const currency = String(this.settings.budgetCurrency ?? '');
    return amount > 0 ? { amount, currency: isCurrency(currency) ? currency : mainCurrency } : null;
  }

  setBudget(budget: Budget | null): void {
    const { monthlyBudget: _a, budgetCurrency: _c, ...rest } = this.settings;
    this.settings = budget ? { ...rest, monthlyBudget: budget.amount, budgetCurrency: budget.currency } : rest;
    this.enqueue({ t: 'settings', rows: settingsToRows(this.settings) });
  }

  category(name: string): Category | undefined {
    return this.categories.find((c) => c.name === name);
  }
}

export const store = new Store();
