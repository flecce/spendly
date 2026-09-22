import { normalize } from '../categorize';
import { formatDate, money } from '../format';
import { html } from '../html';
import { countLabel, t } from '../i18n';
import { icon } from '../icons';
import { onRatesChange, toMain } from '../rates';
import { sortByDateDesc, type Expense } from '../schema';
import { store } from '../store';
import { $, categoryLabel, dayLabel, expenseRow } from '../ui';

/** Rows rendered per step; more load while scrolling, so long histories stay fast. */
const STEP = 150;

// Kept while moving between pages in the same session.
let query = '';

const valueOf = (e: Expense) => toMain(e.amount, e.currency, e.date) ?? 0;

function groupTotals(list: Expense[], key: (e: Expense) => string): Map<string, number> {
  const totals = new Map<string, number>();
  for (const e of list) totals.set(key(e), (totals.get(key(e)) ?? 0) + valueOf(e));
  return totals;
}

/** Every expense ever entered, newest first, grouped by month and day. */
export function mountExpenses(view: HTMLElement): () => void {
  let limit = STEP;
  let observer: IntersectionObserver | null = null;

  view.innerHTML = html`
    <div class="page-head">
      <h1>${t('allExpenses')}</h1>
      <span class="muted" id="expense-count"></span>
    </div>
    <label class="search">
      <span class="sr-only">${t('searchExpenses')}</span>
      ${icon('search')}
      <input type="search" name="q" placeholder="${t('searchExpenses')}" value="${query}" autocomplete="off" enterkeyhint="search" />
    </label>
    <div id="expense-list" class="expense-months"></div>
  `.value;

  const input = $<HTMLInputElement>('[name=q]', view);
  const list = $('#expense-list', view);
  const count = $('#expense-count', view);

  function render(): void {
    observer?.disconnect();
    const q = normalize(query);
    const all = sortByDateDesc(store.expenses, store.expenses);
    const matches = q ? all.filter((e) => normalize(`${e.note} ${categoryLabel(e.category)}`).includes(q)) : all;
    count.textContent = countLabel(matches.length);

    if (!matches.length) {
      list.innerHTML = q
        ? html`<p class="empty card">${t('noResults')}</p>`.value
        : html`<div class="empty card"><p>${t('noExpenses')}</p><a class="btn primary" href="#/add">${icon('plus')}${t('newExpense')}</a></div>`.value;
      return;
    }

    // Totals cover every match, even the rows not rendered yet.
    const monthTotals = groupTotals(matches, (e) => e.date.slice(0, 7));
    const dayTotals = groupTotals(matches, (e) => e.date);
    const months = new Map<string, Map<string, Expense[]>>();
    for (const e of matches.slice(0, limit)) {
      const month = months.get(e.date.slice(0, 7)) ?? new Map<string, Expense[]>();
      month.set(e.date, [...(month.get(e.date) ?? []), e]);
      months.set(e.date.slice(0, 7), month);
    }

    list.innerHTML = html`
      ${[...months].map(
        ([month, days]) => html`<section class="card month-card">
          <div class="month-head">
            <h2>${formatDate(`${month}-01`, { month: 'long', year: 'numeric' })}</h2>
            <strong>${money(monthTotals.get(month) ?? 0)}</strong>
          </div>
          ${[...days].map(
            ([day, items]) => html`<h3 class="day-head"><span>${dayLabel(day)}</span><span>${money(dayTotals.get(day) ?? 0)}</span></h3>
              <ul class="list">${items.map((e) => expenseRow(e, { showDate: false }))}</ul>`,
          )}
        </section>`,
      )}
      ${matches.length > limit ? html`<button type="button" class="btn ghost block show-more" data-action="more">${t('showMore')}</button>` : ''}
    `.value;

    const more = list.querySelector('.show-more');
    if (more) {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((en) => en.isIntersecting)) showMore();
      }, { rootMargin: '400px' });
      observer.observe(more);
    }
  }

  function showMore(): void {
    limit += STEP;
    render();
  }

  input.addEventListener('input', () => {
    query = input.value;
    limit = STEP;
    render();
  });
  list.addEventListener('click', (e) => {
    if ((e.target as Element).closest('[data-action=more]')) showMore();
  });

  render();
  const offStore = store.on((topic) => topic === 'data' && render());
  const offRates = onRatesChange(render);
  return () => {
    observer?.disconnect();
    offStore();
    offRates();
  };
}
