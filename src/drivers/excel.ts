import { isoToSerial } from '../format';
import { CATEGORY_HEADER, COL, EXPENSE_HEADER, rowIds, SETTINGS_HEADER, type Cell, type Row, type SheetName } from '../schema';
import { api, HttpError, isNotFound, type TokenGetter } from './http';
import type { Driver } from './types';
import { buildXlsx, Style } from './xlsx';

const DRIVE = 'https://graph.microsoft.com/v1.0/me/drive';
const FILE = 'Spendly.xlsx';
const EXPENSE_FORMATS = ['yyyy-mm-dd', '#,##0.00', '@', '@', '@', '@'];
const CATEGORY_FORMATS = ['@', '@', '@', '@'];
const SETTINGS_FORMATS = ['@', 'General'];

interface DriveItem {
  id: string;
  webUrl: string;
}

const colIndex = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** Excel backend: Spendly.xlsx in the root of the user's OneDrive, edited through the Graph workbook API. */
export class ExcelDriver implements Driver {
  fileUrl: string | null = null;
  private book = '';
  private readonly cacheKey: string;

  constructor(
    private readonly getToken: TokenGetter,
    account: string,
  ) {
    this.cacheKey = `spendly.excel.${account}`;
  }

  private call<T>(url: string, init?: RequestInit) {
    return api<T>(this.getToken, url, init);
  }

  async connect(seedCategories: Row[]): Promise<void> {
    const item = (await this.cachedItem()) ?? (await this.itemByPath()) ?? (await this.upload(seedCategories));
    this.book = `${DRIVE}/items/${item.id}/workbook`;
    this.fileUrl = item.webUrl;
    localStorage.setItem(this.cacheKey, item.id);
  }

  private async cachedItem(): Promise<DriveItem | null> {
    const id = localStorage.getItem(this.cacheKey);
    return id ? this.getOrNull(`${DRIVE}/items/${id}?$select=id,webUrl`) : null;
  }

  private itemByPath(): Promise<DriveItem | null> {
    return this.getOrNull(`${DRIVE}/root:/${FILE}?$select=id,webUrl`);
  }

  private async getOrNull(url: string): Promise<DriveItem | null> {
    try {
      return await this.call<DriveItem>(url);
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  private async upload(seedCategories: Row[]): Promise<DriveItem> {
    const bytes = buildXlsx([
      {
        name: 'Expenses',
        rows: [EXPENSE_HEADER],
        columns: [
          { width: 12, style: Style.Date },
          { width: 12, style: Style.Amount },
          { width: 9, style: Style.Text },
          { width: 22, style: Style.Text },
          { width: 40, style: Style.Text },
          { width: 14, style: Style.Text },
        ],
      },
      {
        name: 'Categories',
        rows: [CATEGORY_HEADER, ...seedCategories],
        columns: [
          { width: 24, style: Style.Text },
          { width: 8, style: Style.Text },
          { width: 10, style: Style.Text },
          { width: 80, style: Style.Text },
        ],
      },
      {
        name: 'Settings',
        rows: [SETTINGS_HEADER],
        columns: [
          { width: 18, style: Style.Text },
          { width: 14, style: Style.Text },
        ],
      },
    ]);
    try {
      return await this.call<DriveItem>(`${DRIVE}/root:/${FILE}:/content?@microsoft.graph.conflictBehavior=fail`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
        body: new Blob([bytes]),
      });
    } catch (e) {
      // Created meanwhile by another device: use that one.
      if (e instanceof HttpError && e.status === 409) return (await this.itemByPath())!;
      throw e;
    }
  }

  private ws(sheet: SheetName): string {
    return `${this.book}/worksheets('${sheet}')`;
  }

  /** Data rows (header excluded): index i is sheet row i + 2, column 0 is column A. */
  private async dataRows(sheet: SheetName): Promise<unknown[][]> {
    const used = await this.call<{ address: string; values: unknown[][] }>(
      `${this.ws(sheet)}/usedRange(valuesOnly=true)?$select=address,values`,
    );
    const m = /!\$?([A-Z]+)\$?(\d+)/.exec(used.address);
    const firstCol = m ? colIndex(m[1]) : 0;
    const firstRow = m ? Number(m[2]) : 1;
    const rows = used.values.map((r) => [...Array(firstCol).fill(''), ...r]);
    return [...Array.from({ length: firstRow - 1 }, () => []), ...rows].slice(1);
  }

  /** Settings rows; files created before the Settings sheet existed simply have none. */
  private async settingsRows(): Promise<unknown[][] | null> {
    try {
      return await this.dataRows('Settings');
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async read() {
    const [expenses, categories, settings] = await Promise.all([
      this.dataRows('Expenses'),
      this.dataRows('Categories'),
      this.settingsRows(),
    ]);
    return { expenses, categories, settings: settings ?? [] };
  }

  private write(sheet: SheetName, address: string, rows: Cell[][], formats: string[]) {
    return this.call(`${this.ws(sheet)}/range(address='${address}')`, {
      method: 'PATCH',
      body: JSON.stringify({ values: rows, numberFormat: rows.map(() => formats) }),
    });
  }

  private writeExpense(r: number, row: Row) {
    // Dates go in as serial numbers so Excel stores real dates regardless of locale.
    const cells = row.map((v, i) => (i === COL.date ? isoToSerial(String(v)) : i === COL.amount ? v : String(v)));
    return this.write('Expenses', `A${r}:F${r}`, [cells], EXPENSE_FORMATS);
  }

  async appendExpense(row: Row): Promise<void> {
    const rows = await this.dataRows('Expenses');
    await this.writeExpense(rows.length + 2, row);
  }

  async upsertExpense(id: string, row: Row): Promise<void> {
    const rows = await this.dataRows('Expenses');
    const i = rowIds(rows).indexOf(id);
    await this.writeExpense(i < 0 ? rows.length + 2 : i + 2, row);
  }

  async deleteExpense(id: string): Promise<void> {
    const i = rowIds(await this.dataRows('Expenses')).indexOf(id);
    if (i < 0) return;
    const r = i + 2;
    await this.call(`${this.ws('Expenses')}/range(address='${r}:${r}')/delete`, {
      method: 'POST',
      body: JSON.stringify({ shift: 'Up' }),
    });
  }

  /** Writes all data rows of a sheet, then clears leftovers below (never a moment with an empty sheet). */
  private async replaceRows(sheet: SheetName, lastCol: string, before: unknown[][], rows: Cell[][], formats: string[]) {
    if (rows.length) await this.write(sheet, `A2:${lastCol}${rows.length + 1}`, rows, formats);
    const last = before.length + 1;
    if (last >= rows.length + 2) {
      await this.call(`${this.ws(sheet)}/range(address='A${rows.length + 2}:${lastCol}${last}')/clear`, {
        method: 'POST',
        body: JSON.stringify({ applyTo: 'Contents' }),
      });
    }
  }

  async writeCategories(rows: Row[]): Promise<void> {
    const before = await this.dataRows('Categories');
    await this.replaceRows('Categories', 'D', before, rows.map((r) => r.map(String)), CATEGORY_FORMATS);
  }

  async writeSettings(rows: Row[]): Promise<void> {
    let before = await this.settingsRows();
    if (!before) {
      await this.call(`${this.book}/worksheets/add`, { method: 'POST', body: JSON.stringify({ name: 'Settings' }) });
      await this.write('Settings', 'A1:B1', [SETTINGS_HEADER], ['@', '@']);
      before = [];
    }
    await this.replaceRows('Settings', 'B', before, rows, SETTINGS_FORMATS);
  }

  async writeExpenseCategories(values: string[]): Promise<void> {
    if (!values.length) return;
    await this.write('Expenses', `D2:D${values.length + 1}`, values.map((v) => [v]), ['@']);
  }
}
