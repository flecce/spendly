import { EMOJIS, PALETTE, themedColor } from '../defaults';
import { amountInputValue, mainCurrency, money, parseAmount, today } from '../format';
import { html } from '../html';
import { countLabel, t } from '../i18n';
import { icon } from '../icons';
import { splitKeywords } from '../schema';
import { store } from '../store';
import { $, categoryBadge, confirmDialog, openSheet, toast } from '../ui';

const PREVIEW_KEYWORDS = 6;

/** First visible character (emoji can be several code points). */
function firstGrapheme(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return '';
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed);
  return seg[Symbol.iterator]().next().value?.segment ?? '';
}

function openEditor(name: string | null): void {
  const cat = name === null ? undefined : store.category(name);
  const budget = cat ? store.budgetFor(today().slice(0, 7), cat.name) : null;
  const used = new Set(store.categories.map((c) => c.color.toLowerCase()));
  const color = cat?.color ?? PALETTE.find(([light]) => !used.has(light))?.[0] ?? PALETTE[0][0];

  const dialog = openSheet(html`
    <form class="sheet-body cat-form" novalidate>
      <div class="sheet-head">
        <h2>${cat ? t('editCategory') : t('newCategory')}</h2>
        <button type="button" class="icon-btn" data-action="close" aria-label="${t('close')}">${icon('x')}</button>
      </div>
      <div class="cat-top">
        <label class="emoji-input">
          <span class="sr-only">${t('icon')}</span>
          <input name="icon" value="${cat?.icon ?? '🏷️'}" maxlength="16" autocomplete="off" />
        </label>
        <label class="field grow">
          <span class="label">${t('name')}</span>
          <input name="name" required maxlength="40" autocomplete="off" value="${cat?.name ?? ''}" aria-describedby="name-error" />
          <span class="field-error" id="name-error" aria-live="polite"></span>
        </label>
      </div>
      <div class="emoji-grid" role="group" aria-label="${t('icon')}">
        ${EMOJIS.map((e) => html`<button type="button" data-emoji="${e}">${e}</button>`)}
      </div>
      <fieldset class="field">
        <legend class="label">${t('color')}</legend>
        <div class="swatches">
          ${PALETTE.map(
            ([light], i) => html`<label class="swatch" style="--c:${themedColor(light)}">
              <input type="radio" name="color" value="${light}" ${light === color.toLowerCase() ? html`checked` : ''} aria-label="${t('color')} ${i + 1}" />
              <span>${icon('check')}</span>
            </label>`,
          )}
        </div>
      </fieldset>
      <label class="field">
        <span class="label">${t('categoryBudget')}</span>
        <span class="amount-input">
          <span class="currency-code">${mainCurrency}</span>
          <input name="budget" type="text" inputmode="decimal" placeholder="0" autocomplete="off"
            value="${budget ? amountInputValue(budget.amount) : ''}" />
        </span>
        <span class="hint">${t('categoryBudgetHint')}</span>
      </label>
      <label class="field">
        <span class="label">${t('keywords')}</span>
        <textarea name="keywords" rows="3" placeholder="${t('keywordsHint')}">${cat?.keywords.join(', ') ?? ''}</textarea>
        <span class="hint">${t('keywordsHint')}</span>
      </label>
      <div class="actions">
        ${cat ? html`<button type="button" class="btn ghost danger-text" data-action="delete">${icon('trash')}${t('delete')}</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn ghost" data-action="close">${t('cancel')}</button>
        <button type="submit" class="btn primary">${t('save')}</button>
      </div>
    </form>
  `);

  const form = $<HTMLFormElement>('form', dialog);
  const nameInput = $<HTMLInputElement>('[name=name]', form);
  const iconInput = $<HTMLInputElement>('[name=icon]', form);
  const nameError = $('#name-error', form);
  if (!cat) nameInput.focus();

  form.addEventListener('click', async (e) => {
    const target = e.target as Element;
    const emoji = target.closest<HTMLElement>('[data-emoji]')?.dataset.emoji;
    if (emoji) iconInput.value = emoji;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'close') dialog.close();
    if (action === 'delete' && cat && (await confirmDialog(t('confirmDeleteCategory', { name: cat.name }), t('delete')))) {
      store.deleteCategory(cat.name);
      toast(t('deleted'));
      dialog.close();
    }
  });

  nameInput.addEventListener('input', () => (nameError.textContent = ''));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const newName = String(data.get('name') ?? '').trim();
    const error = !newName
      ? t('nameRequired')
      : store.categories.some((c) => c.name.toLowerCase() === newName.toLowerCase() && c !== cat)
        ? t('nameTaken')
        : '';
    if (error) {
      nameError.textContent = error;
      nameInput.focus();
      return;
    }
    store.saveCategory(cat?.name ?? null, {
      name: newName,
      icon: firstGrapheme(String(data.get('icon') ?? '')) || '🏷️',
      color: String(data.get('color') ?? color),
      keywords: splitKeywords(String(data.get('keywords') ?? '')),
    });
    const wanted = Math.max(0, parseAmount(String(data.get('budget') ?? '')) ?? 0);
    if (Math.abs(wanted - (budget?.amount ?? 0)) > 0.009) store.setBudget(wanted, newName);
    toast(t('saved'));
    dialog.close();
  });
}

export function mountCategories(view: HTMLElement): () => void {
  function render(): void {
    const counts = new Map<string, number>();
    for (const e of store.expenses) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
    const budgets = store.categoryBudgets(today().slice(0, 7));

    view.innerHTML = html`
      <div class="page-head">
        <h1>${t('categoriesTitle')}</h1>
        <button type="button" class="btn primary small" data-action="new">${icon('plus')}${t('newCategory')}</button>
      </div>
      <p class="hint page-hint">${t('categoriesHint')}</p>
      ${store.categories.length
        ? html`<ul class="list card">
            ${store.categories.map((c) => {
              const preview = c.keywords.slice(0, PREVIEW_KEYWORDS).join(', ') + (c.keywords.length > PREVIEW_KEYWORDS ? '…' : '');
              return html`<li>
                <button type="button" class="row" data-name="${c.name}">
                  ${categoryBadge(c.name)}
                  <span class="row-main">
                    <span class="row-title">${c.name}</span>
                    <span class="row-meta">${preview || t('noKeywords')}</span>
                  </span>
                  <span class="row-side">
                    ${budgets.get(c.name) ? html`<span class="budget-tag">${money(budgets.get(c.name)!.amount, budgets.get(c.name)!.currency)}</span>` : ''}
                    ${countLabel(counts.get(c.name) ?? 0)}
                  </span>
                  ${icon('chevron', 'muted')}
                </button>
              </li>`;
            })}
          </ul>`
        : html`<p class="empty card">${t('noCategories')}</p>`}
    `.value;
  }

  function onClick(e: Event): void {
    const target = e.target as Element;
    if (target.closest('[data-action=new]')) return openEditor(null);
    const row = target.closest<HTMLElement>('[data-name]');
    if (row) openEditor(row.dataset.name!);
  }

  view.addEventListener('click', onClick);
  render();
  const off = store.on((topic) => topic === 'data' && render());
  return () => {
    off();
    view.removeEventListener('click', onClick);
  };
}
