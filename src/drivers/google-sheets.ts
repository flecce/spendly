import { BUDGET_HEADER, CATEGORY_HEADER, EXPENSE_HEADER, rowIds, SETTINGS_HEADER, type Cell, type Row, type SheetName } from '../schema';
import { api, isNotFound, type TokenGetter } from './http';
import type { Driver } from './types';

const EXPENSES = 'Expenses!A2:I';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const TITLE = 'Spendly';
/** Drive appProperty used to find our spreadsheet again (the drive.file scope only sees files this app created). */
const MARKER = { key: 'spendly', value: 'db' };

interface ValueRange {
  values?: unknown[][];
}

/** Google Sheets backend: one spreadsheet named "Spendly" in the user's Drive. */
export class GoogleSheetsDriver implements Driver {
  fileUrl: string | null = null;
  private id = '';
  private sheetIds = new Map<string, number>();
  private readonly cacheKey: string;

  constructor(
    private readonly getToken: TokenGetter,
    account: string,
  ) {
    this.cacheKey = `spendly.gsheet.${account}`;
  }

  private call<T>(url: string, init?: RequestInit) {
    return api<T>(this.getToken, url, init);
  }

  private values(range: string, suffix = '') {
    return `${SHEETS}/${this.id}/values/${encodeURIComponent(range)}${suffix}`;
  }

  async connect(seedCategories: Row[]): Promise<void> {
    const cached = localStorage.getItem(this.cacheKey);
    if (cached) {
      try {
        return await this.open(cached);
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
    }
    const id = (await this.find()) ?? (await this.create(seedCategories));
    await this.open(id);
    localStorage.setItem(this.cacheKey, id);
  }

  private async find(): Promise<string | null> {
    const q = `appProperties has { key='${MARKER.key}' and value='${MARKER.value}' } and trashed=false`;
    const res = await this.call<{ files: { id: string }[] }>(
      `${DRIVE}?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1&spaces=drive`,
    );
    return res.files[0]?.id ?? null;
  }

  private async create(seedCategories: Row[]): Promise<string> {
    const sheet = (title: SheetName, rows: Row[]) => ({
      properties: { title, gridProperties: { frozenRowCount: 1 } },
      data: [
        {
          startRow: 0,
          startColumn: 0,
          rowData: rows.map((row, r) => ({
            values: row.map((v) => ({
              userEnteredValue: typeof v === 'number' ? { numberValue: v } : { stringValue: v },
              ...(r === 0 ? { userEnteredFormat: { textFormat: { bold: true } } } : {}),
            })),
          })),
        },
      ],
    });
    const created = await this.call<{ spreadsheetId: string }>(SHEETS, {
      method: 'POST',
      body: JSON.stringify({
        properties: { title: TITLE },
        sheets: [
          sheet('Expenses', [EXPENSE_HEADER]),
          sheet('Categories', [CATEGORY_HEADER, ...seedCategories]),
          sheet('Budgets', [BUDGET_HEADER]),
          sheet('Settings', [SETTINGS_HEADER]),
        ],
      }),
    });
    await this.call(`${DRIVE}/${created.spreadsheetId}`, {
      method: 'PATCH',
      body: JSON.stringify({ appProperties: { [MARKER.key]: MARKER.value } }),
    });
    return created.spreadsheetId;
  }

  private async open(id: string): Promise<void> {
    const meta = await this.call<{ spreadsheetUrl: string; sheets: { properties: { sheetId: number; title: string } }[] }>(
      `${SHEETS}/${id}?fields=spreadsheetUrl,sheets.properties(sheetId,title)`,
    );
    this.id = id;
    this.fileUrl = meta.spreadsheetUrl;
    this.sheetIds = new Map(meta.sheets.map((s) => [s.properties.title, s.properties.sheetId]));
    // Add sheets missing from older files or deleted by hand, so reads and writes keep working.
    const sheets = [
      ['Expenses', EXPENSE_HEADER],
      ['Categories', CATEGORY_HEADER],
      ['Budgets', BUDGET_HEADER],
      ['Settings', SETTINGS_HEADER],
    ] as const;
    for (const [title, header] of sheets) {
      if (this.sheetIds.has(title)) continue;
      const res = await this.call<{ replies: { addSheet: { properties: { sheetId: number } } }[] }>(`${SHEETS}/${id}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } }] }),
      });
      this.sheetIds.set(title, res.replies[0].addSheet.properties.sheetId);
      await this.put(`${title}!A1`, [header]);
    }
    await this.repairHeader();
  }

  /** Files written by an older version have fewer columns: bring the header row up to date. */
  private async repairHeader(): Promise<void> {
    const res = await this.call<ValueRange>(this.values('Expenses!A1:I1'));
    const current = (res.values?.[0] ?? []).map(String);
    if (EXPENSE_HEADER.some((h, i) => current[i] !== h)) await this.put('Expenses!A1:I1', [EXPENSE_HEADER]);
  }

  async read() {
    const ranges = [EXPENSES, 'Categories!A2:D', 'Budgets!A2:D', 'Settings!A2:B']
      .map((r) => `ranges=${encodeURIComponent(r)}`)
      .join('&');
    const res = await this.call<{ valueRanges: ValueRange[] }>(
      `${SHEETS}/${this.id}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE`,
    );
    return {
      expenses: res.valueRanges[0].values ?? [],
      categories: res.valueRanges[1].values ?? [],
      budgets: res.valueRanges[2].values ?? [],
      settings: res.valueRanges[3].values ?? [],
    };
  }

  private put(range: string, rows: Cell[][]) {
    return this.call(this.values(range, '?valueInputOption=RAW'), { method: 'PUT', body: JSON.stringify({ values: rows }) });
  }

  private async expenseRows(): Promise<unknown[][]> {
    const res = await this.call<ValueRange>(this.values(EXPENSES, '?valueRenderOption=UNFORMATTED_VALUE'));
    return res.values ?? [];
  }

  /** Sheet row number (1-based, header is row 1) of the expense with this id, or -1. */
  private async rowOf(id: string): Promise<number> {
    const i = rowIds(await this.expenseRows()).indexOf(id);
    return i < 0 ? -1 : i + 2;
  }

  async appendExpense(row: Row): Promise<void> {
    // RAW keeps notes like "=1+1" or "1/2" as plain text.
    await this.call(this.values('Expenses!A1:I1', ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS'), {
      method: 'POST',
      body: JSON.stringify({ values: [row] }),
    });
  }

  async upsertExpense(id: string, row: Row): Promise<void> {
    const r = await this.rowOf(id);
    if (r < 0) return this.appendExpense(row);
    await this.put(`Expenses!A${r}:I${r}`, [row]);
  }

  async deleteExpense(id: string): Promise<void> {
    const r = await this.rowOf(id);
    if (r < 0) return;
    await this.call(`${SHEETS}/${this.id}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: [{ deleteDimension: { range: { sheetId: this.sheetIds.get('Expenses'), dimension: 'ROWS', startIndex: r - 1, endIndex: r } } }],
      }),
    });
  }

  async writeCategories(rows: Row[]): Promise<void> {
    // Write first, then clear what's left below: never a moment with an empty sheet.
    if (rows.length) await this.put(`Categories!A2:D${rows.length + 1}`, rows);
    await this.call(this.values(`Categories!A${rows.length + 2}:D`, ':clear'), { method: 'POST' });
  }

  async writeBudgets(rows: Row[]): Promise<void> {
    if (rows.length) await this.put(`Budgets!A2:D${rows.length + 1}`, rows);
    await this.call(this.values(`Budgets!A${rows.length + 2}:D`, ':clear'), { method: 'POST' });
  }

  async writeSettings(rows: Row[]): Promise<void> {
    if (rows.length) await this.put(`Settings!A2:B${rows.length + 1}`, rows);
    await this.call(this.values(`Settings!A${rows.length + 2}:B`, ':clear'), { method: 'POST' });
  }

  async writeExpenseCategories(values: string[]): Promise<void> {
    if (values.length) await this.put(`Expenses!D2:D${values.length + 1}`, values.map((v) => [v]));
  }

  async writeExpenseTags(values: string[]): Promise<void> {
    if (values.length) await this.put(`Expenses!I2:I${values.length + 1}`, values.map((v) => [v]));
  }
}
