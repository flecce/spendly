import { logout, type Account, type Provider } from '../auth/session';
import { openBudgetEditor } from '../budget';
import { CURRENCIES, currencyName, mainCurrency, money, setMainCurrency } from '../format';
import { html } from '../html';
import { lang, LANGS, setLang, t, type Lang } from '../i18n';
import { icon } from '../icons';
import { ensureRatesFor } from '../rates';
import { store } from '../store';
import { $, confirmDialog, openSheet } from '../ui';

const PROVIDER_NAME: Record<Provider, string> = { google: 'Google', microsoft: 'Microsoft', local: '' };
const APP_NAME: Record<Provider, string> = { google: 'Google Sheets', microsoft: 'Excel', local: '' };

export const initials = (a: Account): string =>
  (a.name || a.email || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

/** Settings sheet: account, language, currency, sync, sign out. `onPrefsChange` re-renders the app. */
export function openSettings(account: Account, onPrefsChange: () => void): void {
  const local = account.provider === 'local';
  const pending = store.queue.length;
  const dialog = openSheet(html`
    <div class="sheet-body settings">
      <div class="sheet-head">
        <h2>${t('settings')}</h2>
        <button type="button" class="icon-btn" data-action="close" aria-label="${t('close')}">${icon('x')}</button>
      </div>

      <div class="account">
        <span class="avatar-lg" aria-hidden="true">${local ? icon('wallet') : initials(account)}</span>
        <div>
          ${local
            ? html`<strong>${t('localMode')}</strong>`
            : html`<strong>${account.name}</strong><span>${account.email}</span>
                <span class="muted">${t('signedInWith', { provider: PROVIDER_NAME[account.provider] })}</span>`}
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

      <button type="button" class="btn ghost block" data-action="budget">
        ${icon('target')}${t('monthlyBudget')}
        <span class="muted">${store.budget ? money(store.budget.amount, store.budget.currency) : t('setBudget')}</span>
      </button>

      ${local
        ? ''
        : html`<div class="settings-links">
            ${store.fileUrl
              ? html`<a class="btn ghost block" href="${store.fileUrl}" target="_blank" rel="noopener">
                  ${icon('external')}${t('openIn', { app: APP_NAME[account.provider] })}</a>`
              : ''}
            <button type="button" class="btn ghost block" data-action="sync">
              ${icon('refresh')}${t('syncNow')}
              <span class="muted">${pending ? t('pending', { n: pending }) : store.sync === 'idle' ? t('synced') : ''}</span>
            </button>
          </div>`}

      <button type="button" class="btn ghost block danger-text" data-action="logout">${icon('logout')}${t('logout')}</button>
    </div>
  `);

  const reopen = () => {
    dialog.close();
    onPrefsChange();
    openSettings(account, onPrefsChange);
  };
  $<HTMLSelectElement>('[name=lang]', dialog).addEventListener('change', (e) => {
    setLang((e.target as HTMLSelectElement).value as Lang);
    reopen();
  });
  $<HTMLSelectElement>('[name=currency]', dialog).addEventListener('change', (e) => {
    setMainCurrency((e.target as HTMLSelectElement).value);
    void ensureRatesFor(store.expenses);
    reopen();
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
    if (action === 'logout') {
      if (store.queue.length && !local && !(await confirmDialog(t('unsyncedLogout'), t('logout')))) return;
      logout();
      location.hash = '';
      location.reload();
    }
  });
}
