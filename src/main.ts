import './styles.css';
import { completeRedirect, createDriver, getAccount, isConfigured, login, tokenGetter, type Account, type Provider } from './auth/session';
import { defaultCategories } from './defaults';
import { AuthError } from './drivers/http';
import { html, type SafeHtml } from './html';
import { lang, LANGS, setLang, t, type Lang } from './i18n';
import { googleLogo, icon, logoMark, microsoftLogo, type IconName } from './icons';
import { mountAdd } from './pages/add';
import { mountCategories } from './pages/categories';
import { mountDashboard } from './pages/dashboard';
import { mountExpenses } from './pages/expenses';
import { initials, openSettings } from './pages/settings';
import { ensureRatesFor } from './rates';
import { store } from './store';
import { applyTheme, onThemeChange } from './theme';
import { $, openExpenseActions } from './ui';

applyTheme();

const app = $('#app');
/** Set while a silent sign-in redirect is in flight, so a failure can't loop. */
const SILENT_KEY = 'spendly.silentAuth';

let account: Account;
let unmount: (() => void) | null = null;
let shownReady = false;

// ---- Login ----

function providerButton(p: Provider, logo: SafeHtml, label: string, hint: string): SafeHtml {
  const ok = isConfigured(p);
  return html`<button type="button" class="provider" data-provider="${p}" ${ok ? '' : html`disabled`}>
    ${logo}<span><strong>${label}</strong><small>${ok ? hint : t('notConfigured')}</small></span>
  </button>`;
}

function renderLogin(error: string | null): void {
  app.innerHTML = html`
    <main class="login">
      <div class="login-card">
        <div class="logo">${logoMark}</div>
        <h1>Spendly</h1>
        <p class="tagline">${t('tagline')}</p>
        ${error
          ? html`<p class="alert" role="alert">${icon('alert')}<span>${error === 'permission_denied' ? t('permissionDenied') : t('loginFailed')}</span></p>`
          : ''}
        <div class="providers">
          ${providerButton('google', googleLogo, t('loginGoogle'), t('loginGoogleHint'))}
          ${providerButton('microsoft', microsoftLogo, t('loginMicrosoft'), t('loginMicrosoftHint'))}
        </div>
        <p class="fineprint">${t('privacyNote')}</p>
        <label class="lang-select">
          <span class="sr-only">${t('language')}</span>
          <select>${Object.entries(LANGS).map(([code, label]) => html`<option value="${code}" ${code === lang ? html`selected` : ''}>${label}</option>`)}</select>
        </label>
      </div>
    </main>`.value;

  const page = $('.login', app);
  $('select', page).addEventListener('change', (e) => {
    setLang((e.target as HTMLSelectElement).value as Lang);
    renderLogin(error);
  });
  page.addEventListener('click', (e) => {
    const p = (e.target as Element).closest<HTMLElement>('[data-provider]')?.dataset.provider;
    if (p) login(p as Provider);
  });
}

// ---- App shell ----

const TABS: [route: string, icon: IconName, label: () => string][] = [
  ['add', 'plus', () => t('navAdd')],
  ['expenses', 'list', () => t('navExpenses')],
  ['dashboard', 'chart', () => t('navDashboard')],
  ['categories', 'tag', () => t('navCategories')],
];

function renderShell(): void {
  app.innerHTML = html`
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="#/add">${logoMark}<span>Spendly</span></a>
        <nav class="tabs" aria-label="Spendly">
          ${TABS.map(([route, ic, label]) => html`<a href="#/${route}" data-route="${route}">${icon(ic)}<span>${label()}</span></a>`)}
        </nav>
        <button type="button" class="sync-btn" id="sync"></button>
        <button type="button" class="avatar-btn" id="me" aria-label="${t('settings')}">${initials(account)}</button>
      </div>
    </header>
    <div id="banner"></div>
    <main id="view" class="view"></main>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>`.value;

  $('#me').addEventListener('click', () => openSettings(account, rerender));
  $('#sync').addEventListener('click', () => (store.sync === 'auth' ? reconnect() : void store.retry()));
  $('#banner').addEventListener('click', (e) => {
    const action = (e.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'reconnect') reconnect();
    if (action === 'retry') void store.retry();
  });
  renderSync();
}

function rerender(): void {
  renderShell();
  route();
}

function reconnect(): void {
  login(account.provider, { hint: account.email });
}

function renderSync(): void {
  const btn = $('#sync');
  const banner = $('#banner');
  if (!btn) return;
  const n = store.queue.length;
  const [ic, label, cls]: [IconName, string, string] =
    store.sync === 'syncing'
      ? ['refresh', t('syncing'), 'spin']
      : store.sync === 'offline'
        ? ['cloudOff', t('offline'), 'warn']
        : store.sync === 'auth'
          ? ['alert', t('sessionExpired'), 'warn']
          : store.sync === 'error'
            ? ['alert', t('syncError'), 'warn']
            : n
              ? ['cloudOff', t('pending', { n }), 'warn']
              : ['cloud', t('synced'), ''];
  btn.className = `sync-btn ${cls}`;
  btn.title = label;
  btn.setAttribute('aria-label', n ? `${label} (${t('pending', { n })})` : label);
  btn.innerHTML = html`${icon(ic)}${n ? html`<span class="badge">${n}</span>` : ''}`.value;

  const bannerHtml =
    store.sync === 'auth'
      ? html`<div class="banner">${icon('alert')}<span>${t('sessionExpired')}</span><button type="button" class="btn small" data-action="reconnect">${t('reconnect')}</button></div>`
      : store.sync === 'error'
        ? html`<div class="banner">${icon('alert')}<span>${t('syncError')}</span><button type="button" class="btn small" data-action="retry">${t('retry')}</button></div>`
        : store.sync === 'offline' && n
          ? html`<div class="banner">${icon('cloudOff')}<span>${t('offline')}</span></div>`
          : html``;
  banner.innerHTML = bannerHtml.value;
}

// ---- Routing: #/add, #/dashboard, #/categories, #/edit/<id> ----

function route(): void {
  unmount?.();
  unmount = null;
  const [, name = 'add', arg = ''] = /^#\/?([^/]*)\/?(.*)$/.exec(location.hash) ?? [];
  const page = ['expenses', 'dashboard', 'categories', 'edit'].includes(name) ? name : 'add';
  const view = $('#view');
  view.className = `view page-${page}`;
  document.querySelectorAll<HTMLElement>('[data-route]').forEach((a) => {
    if (a.dataset.route === (page === 'edit' ? 'add' : page)) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  shownReady = store.ready;
  if (!store.ready) {
    const failed = store.sync === 'error' || store.sync === 'offline' || store.sync === 'auth';
    view.innerHTML = html`<div class="loading card">
      ${failed
        ? html`${icon('alert')}<p>${store.sync === 'auth' ? t('sessionExpired') : store.sync === 'offline' ? t('offline') : t('syncError')}</p>
            <button type="button" class="btn primary" id="retry">${store.sync === 'auth' ? t('reconnect') : t('retry')}</button>`
        : html`<span class="spinner" aria-hidden="true"></span><p>${t('connecting')}</p>`}
    </div>`.value;
    view.querySelector('#retry')?.addEventListener('click', () => (store.sync === 'auth' ? reconnect() : void store.retry()));
    return;
  }

  if (page === 'expenses') unmount = mountExpenses(view);
  else if (page === 'dashboard') unmount = mountDashboard(view);
  else if (page === 'categories') unmount = mountCategories(view);
  else unmount = mountAdd(view, page === 'edit' ? decodeURIComponent(arg) : undefined);
}

// ---- Startup ----

/**
 * Makes sure there is a usable access token. When it has expired, tries one silent
 * redirect to the provider (no UI when the user is still signed in there).
 * Returns false when the page is navigating away.
 */
async function ensureToken(redirectError: string | null): Promise<boolean> {
  try {
    await tokenGetter(account.provider)();
    sessionStorage.removeItem(SILENT_KEY);
  } catch (e) {
    if (e instanceof AuthError && !redirectError && navigator.onLine && !sessionStorage.getItem(SILENT_KEY)) {
      sessionStorage.setItem(SILENT_KEY, '1');
      login(account.provider, { silent: true, hint: account.email });
      return false;
    }
    // Otherwise the store reports it (reconnect banner or offline).
  }
  return true;
}

// The ⋯ button on any expense row, in any list.
document.addEventListener('click', (e) => {
  const id = (e.target as Element).closest<HTMLElement>('[data-expense-actions]')?.dataset.expenseActions;
  if (id) openExpenseActions(id);
});

// Clicking anywhere on a date field opens the calendar (not only the tiny icon on desktop).
document.addEventListener('click', (e) => {
  const input = e.target;
  if (input instanceof HTMLInputElement && input.type === 'date') {
    try {
      input.showPicker();
    } catch {
      /* not supported: the browser's own behaviour applies */
    }
  }
});

function start(a: Account, redirectError: string | null): void {
  account = a;
  store.init(a);
  renderShell();
  window.addEventListener('hashchange', route);
  route();

  void ensureRatesFor(store.expenses);
  store.on((topic) => {
    if (topic === 'sync') renderSync();
    if (topic === 'data') void ensureRatesFor(store.expenses);
    if (!shownReady && (store.ready || topic === 'sync')) route();
  });
  onThemeChange(route);
  window.addEventListener('online', () => void store.retry());
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && (await ensureToken(null))) store.refreshIfStale(60_000);
  });

  void ensureToken(redirectError).then((ok) => {
    if (ok) void store.connect(createDriver(a), defaultCategories(lang));
  });
}

async function boot(): Promise<void> {
  setLang(lang);
  let error: string | null = null;
  try {
    error = await completeRedirect();
  } catch (e) {
    console.error(e);
    error = 'failed';
  }
  const a = getAccount();
  if (a) start(a, error);
  else renderLogin(error);
}

void boot();
