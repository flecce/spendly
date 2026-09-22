import { readJson } from '../auth/util';
import { budgetStatus, budgetStrip, currentBudgetStatus, openBudgetEditor } from '../budget';
import { detectCategory } from '../categorize';
import { themedColor } from '../defaults';
import {
  addDays,
  amountInputValue,
  CURRENCIES,
  currencyName,
  formatDate,
  isCurrency,
  mainCurrency,
  money,
  parseAmount,
  toIsoDate,
  today,
} from '../format';
import { html } from '../html';
import { t } from '../i18n';
import { icon } from '../icons';
import { ensureRates, onRatesChange, toMain } from '../rates';
import { newId, sortByDateDesc, type ExpenseType } from '../schema';
import { store } from '../store';
import { $, confirmDialog, expenseRow, openSheet, toast } from '../ui';

const RECENT = 6;
const finePointer = matchMedia('(pointer: fine)');
const LAST_CURRENCY_KEY = 'spendly.lastCurrency';
const LAST_CURRENCY_TTL = 12 * 3_600_000;

/** One slice of an expense split across categories. */
interface Part {
  category: string;
  amount: number;
}

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

  /** Chosen categories: the first one carries the amount, the rest are tags. */
  let picked: string[] = editing ? [editing.category, ...editing.tags].filter(Boolean) : [];
  let manual = Boolean(editing); // once the user picks a category, stop guessing
  let auto = false;
  let type: ExpenseType = editing?.type ?? 'expense';
  /** Set when one amount is shared between categories: each part becomes its own row. */
  let split: Part[] | null = null;
  const initialCurrency = editing?.currency ?? lastCurrency();

  view.innerHTML = html`
    ${editing ? '' : html`<div id="budget-slot"></div>`}
    <form class="card entry" novalidate autocomplete="off">
      <h1 class="entry-title">${editing ? t('editExpense') : t('newExpense')}</h1>
      ${editing?.group ? html`<p class="hint split-note">${icon('split')}${t('splitPartOf')}</p>` : ''}
      <div class="type-toggle" role="group" aria-label="${t('typeExpense')} / ${t('typeIncome')}">
        <button type="button" class="chip" data-type="expense" aria-pressed="${String(type === 'expense')}">${t('typeExpense')}</button>
        <button type="button" class="chip" data-type="income" aria-pressed="${String(type === 'income')}">${t('typeIncome')}</button>
      </div>
      <label class="field">
        <span class="label">${t('note')}</span>
        <input name="note" type="text" maxlength="200" required enterkeyhint="next" placeholder="${t('notePlaceholder')}"
          aria-describedby="note-error" value="${editing?.note ?? ''}" />
        <span class="field-error" id="note-error" aria-live="polite"></span>
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
          ${editing ? '' : html`<button type="button" class="link-inline" data-action="split">${icon('split')}${t('split')}</button>`}
        </span>
        <div class="chips" role="group" aria-labelledby="cat-label"></div>
        <p class="hint cat-hint" hidden>${t('mainCategoryHint')}</p>
        <div class="split-summary" hidden></div>
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
  const catHint = $('.cat-hint', form);
  const splitBox = $('.split-summary', form);
  const autoBadge = $('.auto-badge', form);
  const noteError = $('#note-error', form);
  const amountError = $('#amount-error', form);

  /** Difference between the total and what the parts add up to (0 when they match or there's no split). */
  function splitGap(): number {
    if (!split) return 0;
    const total = parseAmount(amount.value);
    if (total === null) return 0;
    return Math.round((total - split.reduce((s, p) => s + p.amount, 0)) * 100) / 100;
  }

  function renderChips(): void {
    chips.hidden = split !== null;
    splitBox.hidden = split === null;
    if (split) {
      const gap = splitGap();
      splitBox.innerHTML = html`
        <ul class="split-list">
          ${split.map(
            (p) => html`<li>
              <span class="avatar" style="--c:${themedColor(store.category(p.category)?.color ?? '#898781')}" aria-hidden="true">${store.category(p.category)?.icon ?? '🏷️'}</span>
              <span class="split-name">${p.category}</span>
              <span class="split-amount">${money(p.amount, currency.value)}</span>
            </li>`,
          )}
        </ul>
        ${Math.abs(gap) > 0.009
          ? html`<p class="split-remainder over">${t('splitMismatch', { x: money(parseAmount(amount.value) ?? 0, currency.value) })}</p>`
          : ''}
        <div class="split-actions">
          <button type="button" class="btn small ghost" data-action="split">${icon('pencil')}${t('edit')}</button>
          <button type="button" class="btn small ghost" data-action="unsplit">${icon('x')}${t('removeSplit')}</button>
        </div>`.value;
      autoBadge.hidden = true;
      return;
    }
    chips.innerHTML = store.categories
      .map((c) => {
        const at = picked.indexOf(c.name);
        return html`<button type="button" class="chip ${at > 0 ? 'tag' : ''}" data-name="${c.name}" aria-pressed="${String(at >= 0)}" style="--c:${themedColor(c.color)}">
          <span aria-hidden="true">${c.icon}</span>${c.name}
        </button>`.value;
      })
      .join('');
    catHint.hidden = picked.length < 2;
    autoBadge.hidden = !(auto && picked.length);
  }

  function renderType(): void {
    form.querySelectorAll<HTMLElement>('[data-type]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === type)));
    form.classList.toggle('is-income', type === 'income');
  }

  function guess(): void {
    if (manual || split) return;
    const found = detectCategory(note.value, store.categories, store.history);
    picked = found ? [found] : [];
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
    if (split) renderChips();
  }

  function renderRecent(): void {
    const list = view.querySelector('#recent');
    if (!list) return;
    const recent = sortByDateDesc(store.expenses, store.expenses).slice(0, RECENT);
    list.innerHTML = recent.length
      ? recent.map((e) => expenseRow(e, { showDate: true }).value).join('')
      : html`<li class="empty">${t('noExpenses')}</li>`.value;
  }

  const budgetSlot = view.querySelector<HTMLElement>('#budget-slot');
  const renderBudget = () => {
    if (budgetSlot) budgetSlot.innerHTML = budgetStrip(currentBudgetStatus()).value;
  };
  budgetSlot?.addEventListener('click', (e) => {
    if ((e.target as Element).closest('[data-action=budget]')) openBudgetEditor();
  });

  note.addEventListener('input', () => {
    noteError.textContent = '';
    note.removeAttribute('aria-invalid');
    guess();
  });
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
    // A total changed after splitting has to be shared out again.
    if (split) renderChips();
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
    // Tap to add, tap again to remove; the first one chosen is the one the amount counts in.
    picked = picked.includes(name) ? picked.filter((c) => c !== name) : [...picked, name];
    manual = true;
    auto = false;
    renderChips();
  });

  /** The amount has to be there before splitting: the parts add up to it. */
  function requireAmount(): number | null {
    const value = parseAmount(amount.value);
    if (value === null || value <= 0) {
      amountError.textContent = t('invalidAmount');
      amount.setAttribute('aria-invalid', 'true');
      amount.focus();
      return null;
    }
    return value;
  }

  /** Confirms the save and says how the month's budget stands afterwards. */
  function announceSaved(value: number, code: string, day: string): void {
    const budget = store.budget;
    const status = budget && type === 'expense' && day.startsWith(today().slice(0, 7)) ? budgetStatus(store.expenses, budget) : null;
    if (status?.state === 'over') toast(t('budgetExceeded', { x: money(-status.remaining) }), 'error');
    else if (status) toast(`${t('saved')} · ${money(value, code)} · ${t('budgetLeft', { x: money(status.remaining) })}`);
    else toast(`${t('saved')} · ${money(value, code)}`);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = note.value.trim();
    if (!text) {
      noteError.textContent = t('noteRequired');
      note.setAttribute('aria-invalid', 'true');
      note.focus();
      return;
    }
    const value = requireAmount();
    if (value === null) return;
    if (split && Math.abs(splitGap()) > 0.009) {
      amountError.textContent = t('splitMismatch', { x: money(value, currency.value) });
      $('[data-action=split]', splitBox).focus();
      return;
    }

    const common = { date: toIsoDate(date.value) ?? today(), currency: currency.value, note: text, type };
    rememberCurrency(common.currency);

    const category = picked[0] ?? '';
    const tags = picked.slice(1);

    if (editing) {
      store.updateExpense({ ...editing, ...common, amount: value, category, tags });
      toast(t('updated'));
      goBack();
      return;
    }

    if (split) {
      const group = newId();
      store.addExpenses(split.map((p) => ({ id: newId(), ...common, group, tags: [], category: p.category, amount: p.amount })));
    } else {
      store.addExpense({ id: newId(), ...common, group: '', tags, amount: value, category });
    }
    announceSaved(value, common.currency, common.date);

    form.reset();
    date.value = today();
    renderDate();
    currency.value = common.currency;
    converted.textContent = '';
    picked = [];
    split = null;
    manual = auto = false;
    renderChips();
    // Desktop: ready for the next one. Phone: close the keyboard so the list is visible.
    if (finePointer.matches) note.focus();
    else (document.activeElement as HTMLElement | null)?.blur();
  });

  form.addEventListener('click', async (e) => {
    const target = e.target as Element;
    const typeBtn = target.closest<HTMLElement>('[data-type]');
    if (typeBtn) {
      type = typeBtn.dataset.type as ExpenseType;
      renderType();
    }
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'split') {
      const total = requireAmount();
      if (total === null) return;
      const parts = await openSplitEditor(total, currency.value, split ?? [{ category: picked[0] ?? '', amount: total }]);
      if (parts) {
        // One part carrying the whole amount is just a normal expense.
        split = parts.length > 1 ? parts : null;
        if (parts.length === 1) picked = [parts[0].category];
        manual = true;
        renderChips();
      }
    }
    if (action === 'unsplit') {
      split = null;
      renderChips();
    }
    if (action === 'cancel') goBack();
    if (action === 'delete' && editing && (await confirmDialog(t('confirmDeleteExpense'), t('delete')))) {
      store.deleteExpense(editing.id);
      toast(t('deleted'));
      goBack();
    }
  });

  renderChips();
  renderType();
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

/** Sheet that shares one amount between categories; resolves with the parts, or null when cancelled. */
function openSplitEditor(total: number, code: string, initial: Part[]): Promise<Part[] | null> {
  return new Promise((resolve) => {
    const parts: Part[] = initial.length >= 2 ? initial.map((p) => ({ ...p })) : [{ ...initial[0] }, { category: '', amount: 0 }];
    let done = false;

    const dialog = openSheet(
      html`<form class="sheet-body split-form" novalidate>
        <div class="sheet-head">
          <h2>${t('splitTitle')}</h2>
          <button type="button" class="icon-btn" data-action="close" aria-label="${t('close')}">${icon('x')}</button>
        </div>
        <p class="hint">${t('splitHint')}</p>
        <div class="split-parts"></div>
        <button type="button" class="btn ghost small" data-action="add">${icon('plus')}${t('addPart')}</button>
        <p class="split-remainder" aria-live="polite"></p>
        <span class="field-error" id="split-error" aria-live="polite"></span>
        <div class="actions">
          <span class="spacer"></span>
          <button type="button" class="btn ghost" data-action="close">${t('cancel')}</button>
          <button type="submit" class="btn primary">${t('save')}</button>
        </div>
      </form>`,
      () => {
        if (!done) resolve(null);
      },
    );

    const form = $<HTMLFormElement>('form', dialog);
    const list = $('.split-parts', form);
    const remainder = $('.split-remainder', form);
    const error = $('#split-error', form);

    const assigned = () => parts.reduce((s, p) => s + p.amount, 0);
    const left = () => Math.round((total - assigned()) * 100) / 100;

    function renderRemainder(): void {
      remainder.textContent = `${t('splitRemainder', { x: money(left(), code) })} · ${t('budgetOf', { x: money(total, code) })}`;
      remainder.classList.toggle('over', Math.abs(left()) > 0.009);
    }

    function renderParts(): void {
      list.innerHTML = parts
        .map(
          (p, i) => html`<div class="split-row">
            <label class="field grow">
              <span class="sr-only">${t('category')}</span>
              <select data-part="${i}" name="category">
                <option value="" ${p.category ? '' : html`selected`}>${t('category')}…</option>
                ${store.categories.map((c) => html`<option value="${c.name}" ${c.name === p.category ? html`selected` : ''}>${c.icon} ${c.name}</option>`)}
              </select>
            </label>
            <label class="field split-amount-field">
              <span class="sr-only">${t('amount')}</span>
              <input data-part="${i}" name="amount" type="text" inputmode="decimal" placeholder="0" value="${p.amount ? amountInputValue(p.amount) : ''}" />
            </label>
            ${parts.length > 2 ? html`<button type="button" class="icon-btn" data-remove="${i}" aria-label="${t('delete')}">${icon('x')}</button>` : ''}
          </div>`.value,
        )
        .join('');
      renderRemainder();
    }

    form.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      const i = Number(input.dataset.part);
      if (input.name === 'amount' && !Number.isNaN(i)) {
        parts[i].amount = parseAmount(input.value) ?? 0;
        error.textContent = '';
        renderRemainder();
      }
    });

    form.addEventListener('change', (e) => {
      const select = e.target as HTMLSelectElement;
      const i = Number(select.dataset.part);
      if (select.name === 'category' && !Number.isNaN(i)) {
        parts[i].category = select.value;
        error.textContent = '';
      }
    });

    form.addEventListener('click', (e) => {
      const target = e.target as Element;
      const remove = target.closest<HTMLElement>('[data-remove]')?.dataset.remove;
      if (remove !== undefined) {
        parts.splice(Number(remove), 1);
        renderParts();
      }
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'add') {
        parts.push({ category: '', amount: Math.max(0, left()) });
        renderParts();
      }
      if (action === 'close') dialog.close();
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      // Parts left at zero are simply not used.
      const used = parts.filter((p) => p.amount > 0);
      if (!used.length || Math.abs(total - used.reduce((s, p) => s + p.amount, 0)) > 0.009) {
        error.textContent = t('splitMismatch', { x: money(total, code) });
        return;
      }
      if (used.some((p) => !p.category)) {
        error.textContent = t('splitNeedsCategory');
        return;
      }
      done = true;
      dialog.close();
      resolve(used);
    });

    renderParts();
  });
}
