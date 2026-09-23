import { amountInputValue, formatDate, mainCurrency, money, parseAmount, today } from './format';
import { html, type SafeHtml } from './html';
import { t } from './i18n';
import { icon, type IconName } from './icons';
import { ensureRates, toMain } from './rates';
import type { Budget, Expense } from './schema';
import { store } from './store';
import { $, openSheet, toast } from './ui';

/**
 * Monthly budget for the current month. Besides over/under, spending is compared with
 * the month's pace (day 10 of 30 → a third of the budget), so the warning comes while
 * there is still time to adjust.
 */

export type BudgetState = 'ok' | 'warn' | 'over';

export interface BudgetStatus {
  month: string; // YYYY-MM
  budget: number; // in the main currency
  spent: number;
  /** Income of the month (0 for a category budget): with `spent`, the month's balance. */
  income: number;
  remaining: number;
  /** spent / budget */
  ratio: number;
  /** Share of the month elapsed at the end of today: where spending "should" be. */
  pace: number;
  /** Month total if spending continues at the current daily average. */
  projected: number;
  /** What can be spent per remaining day (today included), or null when nothing is left. */
  daily: number | null;
  /** '' for the overall budget. */
  category: string;
  state: BudgetState;
}

/** Slack over the pace before warning, as a share of the budget (no alarm for a coffee on the 1st). */
const PACE_SLACK = 0.05;
/** Warn anyway past this share of the budget. */
const NEAR_LIMIT = 0.9;

/** Money out only: income never eats into a budget. */
export const isSpending = (e: Expense): boolean => e.type !== 'income';

export function budgetStatus(expenses: Expense[], budget: Budget, day = today(), category = ''): BudgetStatus {
  const month = day.slice(0, 7);
  const [y, m, d] = day.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const amount = toMain(budget.amount, budget.currency, day) ?? budget.amount;
  let spent = 0;
  let income = 0;
  for (const e of expenses) {
    if (!e.date.startsWith(month)) continue;
    if (!isSpending(e)) {
      if (!category) income += toMain(e.amount, e.currency, e.date) ?? 0;
    } else if (!category || e.category === category) {
      spent += toMain(e.amount, e.currency, e.date) ?? 0;
    }
  }
  const pace = d / daysInMonth;
  const remaining = amount - spent;
  const ratio = amount > 0 ? spent / amount : 0;
  const state: BudgetState = ratio > 1 ? 'over' : ratio >= NEAR_LIMIT || ratio > pace + PACE_SLACK ? 'warn' : 'ok';
  return {
    month,
    budget: amount,
    spent,
    income,
    remaining,
    ratio,
    pace,
    projected: (spent / d) * daysInMonth,
    daily: remaining > 0 ? remaining / (daysInMonth - d + 1) : null,
    category,
    state,
  };
}

/** Status of the overall budget (or of one category) for the month that contains `day`. */
export function budgetStatusFor(category = '', day = today()): BudgetStatus | null {
  const budget = store.budgetFor(day.slice(0, 7), category);
  if (!budget) return null;
  if (budget.currency !== mainCurrency) void ensureRates([budget.currency], day);
  return budgetStatus(store.expenses, budget, day, category);
}

export const currentBudgetStatus = (): BudgetStatus | null => budgetStatusFor();

/** Budget status of every category that has one, worst first. */
export function categoryBudgetStatuses(day = today()): BudgetStatus[] {
  return [...store.categoryBudgets(day.slice(0, 7))]
    .map(([category, budget]) => budgetStatus(store.expenses, budget, day, category))
    .sort((a, b) => b.ratio - a.ratio);
}

/** Average spent per month over the (up to) 3 most recent past months with expenses, rounded. */
export function suggestedBudget(expenses: Expense[], day = today()): number | null {
  const thisMonth = day.slice(0, 7);
  const totals = new Map<string, number>();
  for (const e of expenses) {
    const month = e.date.slice(0, 7);
    const v = month < thisMonth && isSpending(e) ? toMain(e.amount, e.currency, e.date) : null;
    if (v !== null) totals.set(month, (totals.get(month) ?? 0) + v);
  }
  const recent = [...totals]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 3)
    .map(([, v]) => v)
    .filter((v) => v > 0);
  if (!recent.length) return null;
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const step = avg >= 1000 ? 50 : 10;
  return Math.max(step, Math.round(avg / step) * step);
}

// ---- Rendering ----

const STATE_ICON: Record<BudgetState, IconName> = { ok: 'check', warn: 'alert', over: 'alert' };

const monthName = (s: BudgetStatus) => formatDate(`${s.month}-01`, { month: 'long' });

function stateLabel(s: BudgetStatus): string {
  if (s.state === 'over') return t('budgetOver', { x: money(-s.remaining) });
  return s.state === 'warn' ? t('budgetWarn') : t('budgetOk');
}

function leftLabel(s: BudgetStatus): string {
  return s.daily === null ? '' : `${t('budgetLeft', { x: money(s.remaining) })} · ${t('budgetDaily', { x: money(s.daily) })}`;
}

/** Progress of the month's spending; the tick marks where spending should be today. */
function meter(s: BudgetStatus): SafeHtml {
  return html`<div class="meter" role="meter" aria-label="${t('budgetTitle', { month: monthName(s) })}"
      aria-valuemin="0" aria-valuemax="${Math.round(s.budget)}" aria-valuenow="${Math.round(Math.min(s.spent, s.budget))}"
      aria-valuetext="${money(s.spent)} ${t('budgetOf', { x: money(s.budget) })}">
    <span class="meter-fill" style="width:${Math.min(100, Math.max(0, s.ratio * 100)).toFixed(1)}%"></span>
    <span class="meter-pace" style="left:${(s.pace * 100).toFixed(1)}%" title="${t('budgetPace')}"></span>
  </div>`;
}

/** Dashboard card (or an invitation to set a budget). */
export function budgetCard(s: BudgetStatus | null): SafeHtml {
  if (!s) {
    return html`<button type="button" class="card budget-cta" data-action="budget">
      <span class="budget-cta-icon">${icon('target')}</span>
      <span class="budget-cta-text"><strong>${t('setBudget')}</strong><span class="hint">${t('setBudgetHint')}</span></span>
      ${icon('chevron', 'muted')}
    </button>`;
  }
  return html`<section class="card budget budget-${s.state}">
    <div class="budget-head">
      <h2>${t('budgetTitle', { month: monthName(s) })}</h2>
      <button type="button" class="icon-btn" data-action="budget" aria-label="${t('monthlyBudget')}">${icon('pencil')}</button>
    </div>
    <div class="budget-figures">
      <strong>${money(s.spent)}</strong>
      <span class="muted">${t('budgetOf', { x: money(s.budget) })}</span>
      <span class="budget-pct">${Math.round(s.ratio * 100)}%</span>
    </div>
    ${meter(s)}
    <p class="budget-state">${icon(STATE_ICON[s.state])}<strong>${stateLabel(s)}</strong></p>
    ${leftLabel(s) ? html`<p class="budget-detail">${leftLabel(s)}</p>` : ''}
    ${s.state !== 'ok' ? html`<p class="budget-detail">${t('budgetProjection', { x: money(s.projected) })}</p>` : ''}
    ${s.income > 0
      ? html`<dl class="budget-balance">
          <div><dt>${t('income')}</dt><dd class="income">${money(s.income)}</dd></div>
          <div><dt>${t('balance')}</dt><dd class="${s.income - s.spent >= 0 ? 'income' : ''}">${money(s.income - s.spent)}</dd></div>
        </dl>`
      : ''}
  </section>`;
}

/** Compact version for the entry page: always in sight while adding expenses. */
export function budgetStrip(s: BudgetStatus | null): SafeHtml {
  if (!s) {
    return html`<button type="button" class="budget-link" data-action="budget">${icon('target')}<span>${t('setBudget')}</span></button>`;
  }
  const detail = s.state === 'ok' ? leftLabel(s) : stateLabel(s);
  return html`<a class="budget-strip budget-${s.state}" href="#/dashboard">
    <span class="budget-strip-top">
      <span class="budget-strip-title">${t('budgetTitle', { month: monthName(s) })}</span>
      <span><strong>${money(s.spent)}</strong> <span class="muted">/ ${money(s.budget)}</span></span>
    </span>
    ${meter(s)}
    <span class="budget-state">${icon(STATE_ICON[s.state])}<span>${detail}</span>${s.income > 0
      ? html`<span class="budget-strip-balance">${t('balance')} <strong class="${s.income - s.spent >= 0 ? 'income' : ''}">${money(s.income - s.spent)}</strong></span>`
      : ''}</span>
  </a>`;
}

// ---- Editor ----

export function openBudgetEditor(category = ''): void {
  const current = store.budgetFor(today().slice(0, 7), category);
  const currentAmount = current ? (toMain(current.amount, current.currency, today()) ?? current.amount) : null;
  const suggestion = category ? null : suggestedBudget(store.expenses);

  const dialog = openSheet(html`
    <form class="sheet-body budget-form" novalidate>
      <div class="sheet-head">
        <h2>${category || t('monthlyBudget')}</h2>
        <button type="button" class="icon-btn" data-action="close" aria-label="${t('close')}">${icon('x')}</button>
      </div>
      <p class="hint">${category ? t('categoryBudgetHint') : t('budgetHint')}</p>
      <p class="hint">${t('budgetFromHint', { month: formatDate(`${today().slice(0, 7)}-01`, { month: 'long', year: 'numeric' }) })}</p>
      <div class="field">
        <label class="label" for="budget-amount">${t('monthlyBudget')}</label>
        <span class="amount-input">
          <span class="currency-code">${mainCurrency}</span>
          <input id="budget-amount" name="amount" type="text" inputmode="decimal" enterkeyhint="done" placeholder="0" autocomplete="off"
            aria-describedby="budget-error" value="${currentAmount !== null ? amountInputValue(Math.round(currentAmount)) : ''}" />
        </span>
        <span class="field-error" id="budget-error" aria-live="polite"></span>
      </div>
      ${suggestion ? html`<button type="button" class="chip suggestion" data-suggest="${suggestion}">${icon('sparkle')}${t('budgetSuggestion', { x: money(suggestion) })}</button>` : ''}
      <div class="actions">
        ${current ? html`<button type="button" class="btn ghost danger-text" data-action="remove">${icon('trash')}${t('removeBudget')}</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn ghost" data-action="close">${t('cancel')}</button>
        <button type="submit" class="btn primary">${t('save')}</button>
      </div>
    </form>
  `);

  const form = $<HTMLFormElement>('form', dialog);
  const input = $<HTMLInputElement>('[name=amount]', form);
  const error = $('#budget-error', form);
  input.focus();
  input.addEventListener('input', () => (error.textContent = ''));

  form.addEventListener('click', (e) => {
    const target = e.target as Element;
    const suggest = target.closest<HTMLElement>('[data-suggest]')?.dataset.suggest;
    if (suggest) {
      input.value = amountInputValue(Number(suggest));
      input.focus();
    }
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'close') dialog.close();
    if (action === 'remove') {
      store.setBudget(0, category);
      toast(t('budgetRemoved'));
      dialog.close();
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = parseAmount(input.value);
    if (amount === null || amount <= 0) {
      error.textContent = t('invalidAmount');
      input.focus();
      return;
    }
    store.setBudget(amount, category);
    toast(t('budgetSaved'));
    dialog.close();
  });
}
