import { themedColor } from './defaults';
import { addDays, formatDate, mainCurrency, money, today } from './format';
import { html, type SafeHtml } from './html';
import { t } from './i18n';
import { icon } from './icons';
import { toMain } from './rates';
import type { Expense } from './schema';
import { store } from './store';

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T => root.querySelector<T>(sel)!;

// ---- Toast ----

let toastTimer = 0;

export function toast(message: string, kind: 'ok' | 'error' = 'ok'): void {
  const duration = kind === 'error' ? 4500 : 2600;
  const el = $('#toast');
  el.className = `toast show ${kind}`;
  el.innerHTML = html`${icon(kind === 'ok' ? 'check' : 'alert')}<span>${message}</span>`.value;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), duration);
}

// ---- Dialogs (native <dialog>, styled as a bottom sheet on phones) ----

export function openSheet(content: SafeHtml, onClose?: () => void): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  dialog.className = 'sheet';
  dialog.innerHTML = content.value;
  document.body.append(dialog);
  dialog.addEventListener('close', () => {
    dialog.remove();
    onClose?.();
  });
  // Tap on the backdrop closes the sheet.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.showModal();
  return dialog;
}

export function confirmDialog(message: string, okLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog: HTMLDialogElement = openSheet(
      html`<form method="dialog" class="sheet-body confirm">
        <p>${message}</p>
        <div class="actions">
          <button class="btn ghost" value="cancel">${t('cancel')}</button>
          <button class="btn danger" value="ok" autofocus>${okLabel}</button>
        </div>
      </form>`,
      () => resolve(dialog.returnValue === 'ok'),
    );
  });
}

// ---- Shared bits ----

export function dayLabel(iso: string): string {
  if (iso === today()) return t('today');
  if (iso === addDays(today(), -1)) return t('yesterday');
  const sameYear = iso.slice(0, 4) === today().slice(0, 4);
  return formatDate(iso, { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function categoryBadge(name: string): SafeHtml {
  const c = store.category(name);
  const color = themedColor(c?.color ?? '#898781');
  return html`<span class="avatar" style="--c:${color}" aria-hidden="true">${c?.icon ?? (name ? '🏷️' : '❔')}</span>`;
}

export const categoryLabel = (name: string): string => name || t('uncategorized');

/** One expense in a list; tapping it opens the editor. */
const expenseTitle = (e: Expense): string => e.note || categoryLabel(e.category);

function expenseSummary(e: Expense, opts: { showDate: boolean }): SafeHtml {
  const meta = [e.note ? categoryLabel(e.category) : '', opts.showDate ? dayLabel(e.date) : ''].filter(Boolean).join(' · ');
  const converted = e.currency === mainCurrency ? null : toMain(e.amount, e.currency, e.date);
  return html`${categoryBadge(e.category)}
    <span class="row-main"><span class="row-title">${expenseTitle(e)}</span>${meta ? html`<span class="row-meta">${meta}</span>` : ''}</span>
    <span class="row-amount">${money(e.amount, e.currency)}${converted !== null ? html`<small>≈ ${money(converted)}</small>` : ''}</span>`;
}

/** One expense in a list: tap it to edit, or use ⋯ for edit / delete. */
export function expenseRow(e: Expense, opts: { showDate: boolean }): SafeHtml {
  return html`<li class="expense">
    <a class="row" href="#/edit/${encodeURIComponent(e.id)}">${expenseSummary(e, opts)}</a>
    <button type="button" class="row-more" data-expense-actions="${e.id}" aria-label="${t('actions')}: ${expenseTitle(e)}">${icon('more')}</button>
  </li>`;
}

/** Action sheet for an expense. Deleting takes a second tap on the same button, no extra dialog. */
export function openExpenseActions(id: string): void {
  const e = store.expenses.find((x) => x.id === id);
  if (!e) return;
  let armed = false;
  const dialog = openSheet(html`
    <div class="sheet-body expense-actions">
      <div class="row static">${expenseSummary(e, { showDate: true })}</div>
      <div class="sheet-actions">
        <button type="button" class="btn block" data-action="edit">${icon('pencil')}${t('edit')}</button>
        <button type="button" class="btn block danger-text" data-action="delete">${icon('trash')}<span>${t('delete')}</span></button>
        <button type="button" class="btn ghost block" data-action="close">${t('cancel')}</button>
      </div>
    </div>
  `);
  dialog.addEventListener('click', (ev) => {
    const button = (ev.target as Element).closest<HTMLButtonElement>('[data-action]');
    const action = button?.dataset.action;
    if (action === 'close') dialog.close();
    if (action === 'edit') {
      dialog.close();
      location.hash = `#/edit/${encodeURIComponent(id)}`;
    }
    if (action === 'delete' && button) {
      if (!armed) {
        armed = true;
        button.classList.replace('danger-text', 'danger');
        $('span', button).textContent = t('confirmDelete');
        return;
      }
      store.deleteExpense(id);
      dialog.close();
      toast(t('deleted'));
    }
  });
}
