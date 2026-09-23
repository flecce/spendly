import { isSpending } from './budget';
import { themedColor } from './defaults';
import { formatDate, money } from './format';
import { html, type SafeHtml } from './html';
import { t } from './i18n';
import { icon } from './icons';
import type { Expense } from './schema';
import { store } from './store';
import { categoryLabel, openSheet } from './ui';

/**
 * Where the money of a period went: income (by category) flows into one pot, which
 * flows out to the spending categories. What is left over goes to "saved"; spending
 * beyond the income comes in as a "shortfall", so both sides always balance.
 */

export type FlowKind = 'income' | 'spend' | 'saved' | 'shortfall' | 'other';

export interface FlowNode {
  kind: FlowKind;
  /** Category name ('' = uncategorized); empty for the synthetic nodes. */
  name: string;
  value: number;
}

export interface Flows {
  left: FlowNode[];
  right: FlowNode[];
  income: number;
  spent: number;
  /** Size of the pot in the middle: the larger of income and spending. */
  total: number;
}

/** Past this many categories on a side, the smallest are merged into "other". */
const MAX_LEFT = 4;
const MAX_RIGHT = 8;

function byCategory(items: [Expense, number][], kind: 'income' | 'spend', max: number): FlowNode[] {
  const sums = new Map<string, number>();
  for (const [e, v] of items) sums.set(e.category, (sums.get(e.category) ?? 0) + v);
  const nodes = [...sums]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]): FlowNode => ({ kind, name, value }));
  if (nodes.length <= max) return nodes;
  const rest = nodes.slice(max - 1).reduce((s, n) => s + n.value, 0);
  return [...nodes.slice(0, max - 1), { kind: 'other', name: '', value: rest }];
}

/** `items` are the period's entries with their value in the main currency. */
export function flows(items: [Expense, number][]): Flows {
  const left = byCategory(items.filter(([e]) => !isSpending(e)), 'income', MAX_LEFT);
  const right = byCategory(items.filter(([e]) => isSpending(e)), 'spend', MAX_RIGHT);
  const income = left.reduce((s, n) => s + n.value, 0);
  const spent = right.reduce((s, n) => s + n.value, 0);
  if (income > spent) right.push({ kind: 'saved', name: '', value: income - spent });
  if (spent > income) left.push({ kind: 'shortfall', name: '', value: spent - income });
  return { left, right, income, spent, total: Math.max(income, spent) };
}

// ---- Rendering ----

const BAR = 10;
/** Height of the pot in the middle; the other columns may grow past it to fit their labels. */
const POT = 260;
/** Room for one label (name over amount): small nodes still get this much vertical space. */
const SLOT = 32;
const GAP = 6;
const TOP = 28;
/** Rough width of a label character, to fit labels in half the chart. */
const CHAR = 6.5;

function nodeLabel(n: FlowNode): string {
  if (n.kind === 'saved') return t('flowSaved');
  if (n.kind === 'shortfall') return t('shortfall');
  if (n.kind === 'other') return t('other');
  const c = n.name ? store.category(n.name) : undefined;
  const name = n.name ? n.name : n.kind === 'income' ? t('income') : categoryLabel('');
  return c?.icon ? `${c.icon} ${name}` : name;
}

function nodeColor(n: FlowNode): string {
  if (n.kind === 'income' || n.kind === 'saved') return 'var(--good)';
  if (n.kind === 'shortfall') return 'var(--danger)';
  if (n.kind === 'other') return '#898781';
  return themedColor(store.category(n.name)?.color ?? '#898781');
}

const clip = (s: string, max: number): string => ([...s].length > max ? [...s].slice(0, max - 1).join('') + '…' : s);

interface Placed {
  node: FlowNode;
  /** Top of the bar and its height. */
  y: number;
  h: number;
  /** Centre of the label slot. */
  mid: number;
}

function place(nodes: FlowNode[], k: number, top: number): Placed[] {
  let y = top;
  return nodes.map((node) => {
    const h = Math.max(2, node.value * k);
    const slot = Math.max(h, SLOT);
    const p = { node, y: y + (slot - h) / 2, h, mid: y + slot / 2 };
    y += slot + GAP;
    return p;
  });
}

const columnHeight = (nodes: FlowNode[], k: number): number =>
  nodes.reduce((s, n) => s + Math.max(Math.max(2, n.value * k), SLOT), 0) + GAP * Math.max(0, nodes.length - 1);

/** A band between two vertical spans, curving through the middle. */
function band(x0: number, a0: number, b0: number, x1: number, a1: number, b1: number): string {
  const xm = (x0 + x1) / 2;
  return `M${x0},${a0}C${xm},${a0} ${xm},${a1} ${x1},${a1}L${x1},${b1}C${xm},${b1} ${xm},${b0} ${x0},${b0}Z`;
}

export function sankeySvg(f: Flows, width: number): string {
  const k = POT / f.total;
  const inner = Math.max(POT, columnHeight(f.left, k), columnHeight(f.right, k));
  const colTop = (h: number) => TOP + (inner - h) / 2;
  const left = place(f.left, k, colTop(columnHeight(f.left, k)));
  const right = place(f.right, k, colTop(columnHeight(f.right, k)));
  const potY = colTop(POT);
  const xL = 0;
  const xM = (width - BAR) / 2;
  const xR = width - BAR;
  const maxLabel = Math.max(8, Math.floor((width / 2 - BAR - 12) / CHAR));
  const pct = (v: number) => (f.total > 0 ? Math.round((v / f.total) * 100) : 0);

  const links: SafeHtml[] = [];
  let inY = potY;
  for (const p of left) {
    const h = p.node.value * k;
    links.push(html`<path class="sankey-link" d="${band(xL + BAR, p.y, p.y + p.h, xM, inY, inY + h)}" style="--c:${nodeColor(p.node)}"><title>${nodeLabel(p.node)}: ${money(p.node.value)} (${pct(p.node.value)}%)</title></path>`);
    inY += h;
  }
  let outY = potY;
  for (const p of right) {
    const h = p.node.value * k;
    links.push(html`<path class="sankey-link" d="${band(xM + BAR, outY, outY + h, xR, p.y, p.y + p.h)}" style="--c:${nodeColor(p.node)}"><title>${nodeLabel(p.node)}: ${money(p.node.value)} (${pct(p.node.value)}%)</title></path>`);
    outY += h;
  }

  const bar = (x: number, p: Placed) => html`<rect class="sankey-node" x="${x}" y="${p.y}" width="${BAR}" height="${p.h}" rx="2" style="--c:${nodeColor(p.node)}"/>`;
  const label = (x: number, p: Placed, anchor: 'start' | 'end') =>
    html`<text class="sankey-label" x="${x}" y="${p.mid - 7}" text-anchor="${anchor}" dominant-baseline="middle">${clip(nodeLabel(p.node), maxLabel)}<tspan class="sankey-amount" x="${x}" dy="15">${money(p.node.value)}</tspan></text>`;

  return html`<svg class="sankey" viewBox="0 0 ${width} ${inner + TOP + 4}" width="${width}" height="${inner + TOP + 4}" role="img" aria-label="${t('flowTitle')}">
    ${links}
    ${left.map((p) => bar(xL, p))}
    ${right.map((p) => bar(xR, p))}
    <rect class="sankey-node sankey-pot" x="${xM}" y="${potY}" width="${BAR}" height="${POT}" rx="2"/>
    <text class="sankey-label sankey-amount" x="${xM + BAR / 2}" y="${potY - 10}" text-anchor="middle">${money(f.total)}</text>
    ${left.map((p) => label(xL + BAR + 6, p, 'start'))}
    ${right.map((p) => label(xR - 6, p, 'end'))}
  </svg>`.value;
}

export function openSankey(items: [Expense, number][], from: string, to: string): void {
  const f = flows(items);
  const range = `${formatDate(from, { day: 'numeric', month: 'short', year: 'numeric' })} – ${formatDate(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const balance = f.income - f.spent;
  const dialog = openSheet(html`
    <div class="sheet-body sankey-sheet">
      <div class="sheet-head">
        <div>
          <h2>${t('flowTitle')}</h2>
          <span class="hint">${range}</span>
        </div>
        <button type="button" class="icon-btn" data-action="close" aria-label="${t('close')}">${icon('x')}</button>
      </div>
      <div class="stats sankey-stats">
        <div><span class="label">${t('income')}</span><strong class="income">${money(f.income)}</strong></div>
        <div><span class="label">${t('totalSpent')}</span><strong>${money(f.spent)}</strong></div>
        <div><span class="label">${t('balance')}</span><strong class="${balance >= 0 ? 'income' : ''}">${money(balance)}</strong></div>
      </div>
      ${f.total > 0 ? html`<div class="sankey-box"></div>` : html`<p class="empty">${t('noData')}</p>`}
    </div>
  `);
  dialog.addEventListener('click', (e) => {
    if ((e.target as Element).closest('[data-action=close]')) dialog.close();
  });
  const box = dialog.querySelector<HTMLElement>('.sankey-box');
  if (box) box.innerHTML = sankeySvg(f, box.clientWidth);
}
