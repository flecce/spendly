import { budgetStatus, budgetStrip, currentBudgetStatus, openBudgetEditor } from '../budget';
import { detectCategory } from '../categorize';
import { themedColor } from '../defaults';
import { readJson } from '../auth/util';
import { addDays, amountInputValue, CURRENCIES, currencyName, formatDate, isCurrency, mainCurrency, money, parseAmount, toIsoDate, today } from '../format';
import { html } from '../html';
import { t } from '../i18n';
import { icon } from '../icons';
import { ensureRates, onRatesChange, toMain } from '../rates';
import { newId, sortByDateDesc } from '../schema';
import { store } from '../store';
import { $, confirmDialog, expenseRow, toast } from '../ui';

const RECENT = 6;
const finePointer = matchMedia('(pointer: fine)');
const LAST_CURRENCY_KEY = 'spendly.lastCurrency';
const LAST_CURRENCY_TTL = 12 * 3_600_000;

/** A foreign currency stays selected for a while (e.g. while travelling), then it's back to the main one. */
function lastCurrency(): string {
  const last = readJson<{ code: string; at: number }>(LAST_CURRENCY_KEY);
  return last && isCurrency(last.code) && Date.now() - last.at < LAST_CURRENCY_TTL ? last.code : mainCurrency;
}

function rememberCurrency(code: string): void {
  if (code === mainCurrency) localStorage.removeItem(LAST_CURRENCY_KEY);
  else localStorage.setItem(LAST_CURRENCY_KEY, JSON.stringify({ code, at: Date.now() }));
}

function goBack(): void {
  if (history.length > 1) history.back();
  else location.hash = '#/add';
}

/** Main page: note, total and category (auto-detected from the note). Also the editor for an existing expense. */
export function mountAdd(view: HTMLElement, editId?: string): () => void {
  const editing = editId ? store.expenses.find((e) => e.id === editId) : undefined;
  if (editId && !editing) {
    view.innerHTML = html`<div class="empty card"><p>${t('expenseNotFound')}</p><a class="btn" href="#/add">${t('newExpense')}</a></div>`.value;
    return () => {};
  }

  let selected = editing?.category ?? '';
  let manual = Boolean(editing); // once the user picks a category, stop guessing
  let auto = false;
  const initialCurrency = editing?.currency ?? lastCurrency();

  view.innerHTML = html`
    ${editing ? '' : html`<div id="budget-slot"></div>`}
    <form class="card entry" novalidate autocomplete="off">
      <h1 class="entry-title">${editing ? t('editExpense') : t('newExpense')}</h1>
      <label class="field">
        <span class="label">${t('note')}</span>
        <input name="note" type="text" maxlength="200" enterkeyhint="next" placeholder="${t('notePlaceholder')}" value="${editing?.note ?? ''}" />
      </label>
      <div class="field">
        <label class="label" for="amount">${t('amount')}</label>
        <span class="amount-input">
          <select name="currency" class="currency-select" aria-label="${t('currency')}">
            ${CURRENCIES.map((c) => html`<option value="${c}" title="${currencyName(c)}" ${c === initialCurrency ? html`selected` : ''}>${c}</option>`)}
          </select>
          <input id="amount" name="amount" type="text" inputmode="decimal" enterkeyhint="done" placeholder="0" aria-describedby="amount-error amount-converted"
            value="${editing ? amountInputValue(editing.amount) : ''}" />
        </span>
        <span class="amount-converted" id="amount-converted" aria-live="polite"></span>
        <span class="field-error" id="amount-error" aria-live="polite"></span>
      </div>
      <div class="field">
        <span class="label" id="cat-label">${t('category')}
          <span class="auto-badge" title="${t('autoHint')}" hidden>${icon('sparkle')}${t('auto')}</span>
        </span>
        <div class="chips" role="group" aria-labelledby="cat-label"></div>
      </div>
      <div class="field">
        <span class="label" id="date-label">${t('date')}</span>
        <div class="date-picks" role="group" aria-labelledby="date-label">
          <button type="button" class="chip" data-day="0">${t('today')}</button>
          <button type="button" class="chip" data-day="-1">${t('yesterday')}</button>
          <label class="chip date-chip">
            ${icon('calendar')}<span class="date-text"></span>${icon('chevronDown', 'muted')}
            <input type="date" name="date" required value="${editing?.date ?? today()}" aria-label="${t('date')}" />
          </label>
        </div>
      </div>
      <button class="btn primary save" type="submit">${icon('check')}${t('save')}</button>
      ${editing
        ? html`<div class="entry-edit-actions">
            <button type="button" class="btn ghost" data-action="cancel">${t('cancel')}</button>
            <button type="button" class="btn ghost danger-text" data-action="delete">${icon('trash')}${t('delete')}</button>
          </div>`
        : ''}
    </form>
    ${editing
      ? ''
      : html`<section class="recent">
          <div class="section-head"><h2>${t('recent')}</h2><a href="#/expenses">${t('seeAll')}</a></div>
          <ul class="list card" id="recent"></ul>
        </section>`}
  `.value;

  const form = $<HTMLFormElement>('form', view);
  const note = $<HTMLInputElement>('[name=note]', form);
  const amount = $<HTMLInputElement>('[name=amount]', form);
  const currency = $<HTMLSelectElement>('[name=currency]', form);
  const converted = $('#amount-converted', form);
  const date = $<HTMLInputElement>('[name=date]', form);
  const datePicks = $('.date-picks', form);
  const chips = $('.chips', form);
  const autoBadge = $('.auto-badge', form);
  const amountError = $('#amount-error', form);

  function renderChips(): void {
    chips.innerHTML = store.categories
      .map(
        (c) =>
          html`<button type="button" class="chip" data-name="${c.name}" aria-pressed="${String(c.name === selected)}" style="--c:${themedColor(c.color)}">
            <span aria-hidden="true">${c.icon}</span>${c.name}
          </button>`.value,
      )
      .join('');
    autoBadge.hidden = !(auto && selected);
  }

  function guess(): void {
    if (manual) return;
    const found = detectCategory(note.value, store.categories, store.history);
    selected = found ?? '';
    auto = Boolean(found);
    renderChips();
  }

  /** "≈ €22.10" under the amount when paying in another currency. */
  function renderConversion(): void {
    const value = parseAmount(amount.value);
    const day = toIsoDate(date.value) ?? today();
    const main = value === null || currency.value === mainCurrency ? null : toMain(value, currency.value, day);
    converted.textContent = main === null ? '' : `≈ ${money(main)}`;
  }

  /** Today / Yesterday chips, plus a big button showing the chosen date that opens the calendar. */
  function renderDate(): void {
    const value = toIsoDate(date.value) ?? today();
    const offset = [0, -1].find((d) => addDays(today(), d) === value);
    datePicks.querySelectorAll<HTMLElement>('[data-day]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.day) === offset)));
    $('.date-chip', datePicks).classList.toggle('active', offset === undefined);
    const sameYear = value.slice(0, 4) === today().slice(0, 4);
    $('.date-text', datePicks).textContent = formatDate(value, { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
  }

  function onCurrencyOrDate(): void {
    renderDate();
    if (currency.value !== mainCurrency) void ensureRates([currency.value], toIsoDate(date.value) ?? today());
    renderConversion();
  }

  function renderRecent(): void {
    const list = view.querySelector('#recent');
    if (!list) return;
    const recent = sortByDateDesc(store.expenses, store.expenses).slice(0, RECENT);
    list.innerHTML = recent.length
      ? recent.map((e) => expenseRow(e, { showDate: true }).value).join('')
      : html`<li class="empty">${t('noExpenses')}</li>`.value;
  }

  note.addEventListener('input', guess);
  note.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      amount.focus();
    }
  });
  amount.addEventListener('input', () => {
    amountError.textContent = '';
    amount.removeAttribute('aria-invalid');
    renderConversion();
  });
  currency.addEventListener('change', onCurrencyOrDate);
  date.addEventListener('change', onCurrencyOrDate);
  datePicks.addEventListener('click', (e) => {
    const day = (e.target as Element).closest<HTMLElement>('[data-day]')?.dataset.day;
    if (day === undefined) return;
    date.value = addDays(today(), Number(day));
    onCurrencyOrDate();
  });

  chips.addEventListener('click', (e) => {
    const chip = (e.target as Element).closest<HTMLButtonElement>('[data-name]');
    if (!chip) return;
    const name = chip.dataset.name!;
    selected = selected === name ? '' : name;
    manual = true;
    auto = false;
    renderChips();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = parseAmount(amount.value);
    if (value === null || value === 0) {
      amountError.textContent = t('invalidAmount');
      amount.setAttribute('aria-invalid', 'true');
      amount.focus();
      return;
    }
    const data = {
      date: toIsoDate(date.value) ?? today(),
      amount: value,
      currency: currency.value,
      category: selected,
      note: note.value.trim(),
    };
    rememberCurrency(data.currency);

    if (editing) {
      store.updateExpense({ ...editing, ...data });
      toast(t('updated'));
      goBack();
      return;
    }
    store.addExpense({ id: newId(), ...data });
    // Tell right away how this expense affects the month's budget.
    const budget = store.budget;
    const status = budget && data.date.startsWith(today().slice(0, 7)) ? budgetStatus(store.expenses, budget) : null;
    if (status?.state === 'over') toast(t('budgetExceeded', { x: money(-status.remaining) }), 'error');
    else if (status) toast(`${t('saved')} · ${money(value, data.currency)} · ${t('budgetLeft', { x: money(status.remaining) })}`);
    else toast(`${t('saved')} · ${money(value, data.currency)}`);
    form.reset();
    date.value = today();
    renderDate();
    currency.value = data.currency;
    converted.textContent = '';
    selected = '';
    manual = auto = false;
    renderChips();
    // Desktop: ready for the next one. Phone: close the keyboard so the list is visible.
    if (finePointer.matches) note.focus();
    else (document.activeElement as HTMLElement | null)?.blur();
  });

  form.addEventListener('click', async (e) => {
    const action = (e.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'cancel') goBack();
    if (action === 'delete' && editing && (await confirmDialog(t('confirmDeleteExpense'), t('delete')))) {
      store.deleteExpense(editing.id);
      toast(t('deleted'));
      goBack();
    }
  });

  const budgetSlot = view.querySelector<HTMLElement>('#budget-slot');
  const renderBudget = () => {
    if (budgetSlot) budgetSlot.innerHTML = budgetStrip(currentBudgetStatus()).value;
  };
  budgetSlot?.addEventListener('click', (e) => {
    if ((e.target as Element).closest('[data-action=budget]')) openBudgetEditor();
  });

  renderChips();
  renderRecent();
  renderBudget();
  onCurrencyOrDate();
  if (!editing && finePointer.matches) note.focus();

  const offRates = onRatesChange(() => {
    renderConversion();
    renderRecent();
    renderBudget();
  });
  const offStore = store.on((topic) => {
    if (topic !== 'data') return;
    if (manual) renderChips();
    else guess();
    renderRecent();
    renderBudget();
  });
  return () => {
    offRates();
    offStore();
  };
}
