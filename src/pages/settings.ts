import { logout, type Account, type Provider } from '../auth/session';
import { download, fromBackup, isEmpty, newInBackup } from '../backup';
import { openBudgetEditor } from '../budget';
import { keywordsInLanguage } from '../defaults';
import { CURRENCIES, currencyName, mainCurrency, money, setMainCurrency } from '../format';
import { html } from '../html';
import { lang, LANGS, setLang, t, type Lang } from '../i18n';
import { icon } from '../icons';
import { canOfferInstall, isIos, promptInstall } from '../install';
import { ensureRatesFor } from '../rates';
import { store } from '../store';
import { setTheme, theme, THEMES, type Theme } from '../theme';
import { $, confirmDialog, openSheet, toast } from '../ui';

const PROVIDER_NAME: Record<Provider, string> = { google: 'Google', microsoft: 'Microsoft' };
const THEME_LABEL = { system: 'themeSystem', light: 'themeLight', dark: 'themeDark' } as const;
const APP_NAME: Record<Provider, string> = { google: 'Google Sheets', microsoft: 'Excel' };

export const initials = (a: Account): string =>
  (a.name || a.email || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

/**
 * Category names follow the language by themselves; the keywords of the standard categories
 * are one list in the file: offer to switch them to the new language.
 */
async function offerKeywordTranslation(lang: Lang): Promise<void> {
  const todo = store.categories
    .map((category) => {
      const keywords = keywordsInLanguage(category, lang);
      return keywords && keywords.join(',') !== category.keywords.join(',') ? { ...category, keywords } : null;
    })
    .filter((x) => x !== null);
  if (!todo.length) return;
  if (!(await confirmDialog(t('translateCategoriesAsk', { lang: LANGS[lang] }), t('translate')))) return;
  for (const category of todo) store.saveCategory(category);
  toast(t('categoriesTranslated'));
}

/** Adds to the current file what a backup (possibly from another account) has and it lacks. */
async function importBackup(text: string): Promise<void> {
  const backup = fromBackup(text);
  if (!backup) return toast(t('importInvalid'), 'error');
  const add = newInBackup(store.data, backup);
  if (isEmpty(add)) return toast(t('importNothing'));
  const counts = { e: add.expenses.length, c: add.categories.length, b: add.budgets.length };
  if (!(await confirmDialog(t('importAsk', counts), t('importConfirm')))) return;
  store.importData(add);
  void ensureRatesFor(store.expenses);
  toast(t('importDone'));
}

/** No install prompt from the browser (always the case on iOS): explain the manual steps. */
function openInstallHelp(): void {
  const dialog = openSheet(html`
    <div class="sheet-body">
      <div class="sheet-head">
        <h2>${t('installTitle')}</h2>
        <button type="button" class="icon-btn" data-action="close" aria-label="${t('close')}">${icon('x')}</button>
      </div>
      <p>${isIos ? t('installIos') : t('installManual')}</p>
    </div>
  `);
  $('[data-action=close]', dialog).addEventListener('click', () => dialog.close());
}

export function openSettings(account: Account, onPrefsChange: () => void): void {
  const pending = store.queue.length;
  const dialog = openSheet(html`
    <div class="sheet-body settings">
      <div class="sheet-head">
        <h2>${t('settings')}</h2>
        <button type="button" class="icon-btn" data-action="close" aria-label="${t('close')}">${icon('x')}</button>
      </div>

      <div class="account">
        <span class="avatar-lg" aria-hidden="true">${initials(account)}</span>
        <div>
          <strong>${account.name}</strong><span>${account.email}</span>
          <span class="muted">${t('signedInWith', { provider: PROVIDER_NAME[account.provider] })}</span>
        </div>
      </div>

      <div class="settings-grid">
        <label class="field">
          <span class="label">${t('language')}</span>
          <select name="lang">
            ${Object.entries(LANGS).map(([code, label]) => html`<option value="${code}" ${code === lang ? html`selected` : ''}>${label}</option>`)}
          </select>
        </label>
        <label class="field">
          <span class="label">${t('mainCurrency')}</span>
          <select name="currency">
            ${CURRENCIES.map((c) => html`<option value="${c}" ${c === mainCurrency ? html`selected` : ''}>${c} · ${currencyName(c)}</option>`)}
          </select>
        </label>
      </div>
      <p class="hint">${t('mainCurrencyHint')}</p>

      <label class="field">
        <span class="label">${t('theme')}</span>
        <select name="theme">
          ${THEMES.map((th) => html`<option value="${th}" ${th === theme ? html`selected` : ''}>${t(THEME_LABEL[th])}</option>`)}
        </select>
      </label>

      <button type="button" class="btn ghost block" data-action="budget">
        ${icon('target')}${t('monthlyBudget')}
        <span class="muted">${store.budget ? money(store.budget.amount, store.budget.currency) : t('setBudget')}</span>
      </button>

      <div class="settings-links">
        ${canOfferInstall()
          ? html`<button type="button" class="btn ghost block" data-action="install">${icon('download')}${t('installApp')}</button>`
          : ''}
        ${store.fileUrl
          ? html`<a class="btn ghost block" href="${store.fileUrl}" target="_blank" rel="noopener">
              ${icon('external')}${t('openIn', { app: APP_NAME[account.provider] })}</a>`
          : ''}
        <button type="button" class="btn ghost block" data-action="sync">
          ${icon('refresh')}${t('syncNow')}
          <span class="muted">${pending ? t('pending', { n: pending }) : store.sync === 'idle' ? t('synced') : ''}</span>
        </button>
        <button type="button" class="btn ghost block" data-action="export">${icon('download')}${t('exportData')}</button>
        <button type="button" class="btn ghost block" data-action="import">${icon('upload')}${t('importData')}</button>
        <input type="file" name="backup" accept=".json,application/json" hidden />
      </div>
      <p class="hint">${t('backupHint')}</p>

      <button type="button" class="btn ghost block danger-text" data-action="logout">${icon('logout')}${t('logout')}</button>
    </div>
  `);

  const reopen = () => {
    dialog.close();
    onPrefsChange();
    openSettings(account, onPrefsChange);
  };
  $<HTMLSelectElement>('[name=lang]', dialog).addEventListener('change', (e) => {
    const next = (e.target as HTMLSelectElement).value as Lang;
    setLang(next);
    reopen();
    void offerKeywordTranslation(next);
  });
  $<HTMLSelectElement>('[name=currency]', dialog).addEventListener('change', (e) => {
    setMainCurrency((e.target as HTMLSelectElement).value);
    void ensureRatesFor(store.expenses);
    reopen();
  });

  $<HTMLSelectElement>('[name=theme]', dialog).addEventListener('change', (e) => {
    setTheme((e.target as HTMLSelectElement).value as Theme);
  });

  $<HTMLInputElement>('[name=backup]', dialog).addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    dialog.close();
    await importBackup(await file.text());
  });

  dialog.addEventListener('click', async (e) => {
    const action = (e.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'close') dialog.close();
    if (action === 'budget') {
      dialog.close();
      openBudgetEditor();
    }
    if (action === 'sync') {
      dialog.close();
      void store.retry();
    }
    if (action === 'export') download(store.data);
    if (action === 'import') $<HTMLInputElement>('[name=backup]', dialog).click();
    if (action === 'install') {
      dialog.close();
      if (!(await promptInstall())) openInstallHelp();
    }
    if (action === 'logout') {
      if (store.queue.length && !(await confirmDialog(t('unsyncedLogout'), t('logout')))) return;
      logout();
      location.hash = '';
      location.reload();
    }
  });
}
