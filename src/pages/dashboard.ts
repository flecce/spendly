import { budgetCard, currentBudgetStatus, openBudgetEditor } from '../budget';
import { themedColor } from '../defaults';
import { addDays, daysBetween, formatDate, fromIso, money, moneyCompact, today } from '../format';
import { html } from '../html';
import { countLabel, t, type Key } from '../i18n';
import { icon } from '../icons';
import { onRatesChange, toMain } from '../rates';
import { sortByDateDesc, type Expense } from '../schema';
import { store } from '../store';
import { $, categoryBadge, categoryLabel, dayLabel, expenseRow } from '../ui';

type Preset = '7d' | '30d' | 'month' | 'lastMonth' | 'year' | 'custom';

const PRESETS: [Preset, Key][] = [
  ['7d', 'last7'],
  ['30d', 'last30'],
  ['month', 'thisMonth'],
  ['lastMonth', 'lastMonth'],
  ['year', 'thisYear'],
  ['custom', 'custom'],
];

// Kept across page switches during the session; the default period is the last 30 days.
let preset: Preset = '30d';
let custom = { from: addDays(today(), -29), to: today() };
let filter: string | null = null;

function period(): [string, string] {
  const d = today();
  switch (preset) {
    case '7d':
      return [addDays(d, -6), d];
    case '30d':
      return [addDays(d, -29), d];
    case 'month':
      return [d.slice(0, 8) + '01', d];
    case 'lastMonth': {
      const firstOfThis = d.slice(0, 8) + '01';
      const lastOfPrev = addDays(firstOfThis, -1);
      return [lastOfPrev.slice(0, 8) + '01', lastOfPrev];
    }
    case 'year':
      return [d.slice(0, 4) + '-01-01', d];
    case 'custom':
      return custom.from <= custom.to ? [custom.from, custom.to] : [custom.to, custom.from];
  }
}

// ---- Time buckets: days for short periods, then weeks, then months ----

interface Bucket {
  key: string;
  tick: string;
  tip: string;
  value: number;
}

function weekStart(iso: string): string {
  return addDays(iso, -((fromIso(iso).getDay() + 6) % 7));
}

function buckets(items: Expense[], value: (e: Expense) => number, from: string, to: string): Bucket[] {
  const span = daysBetween(from, to) + 1;
  const unit = span <= 45 ? 'day' : span <= 190 ? 'week' : 'month';
  const keyOf = (iso: string) =>
    unit === 'day' ? iso : unit === 'week' ? (weekStart(iso) < from ? from : weekStart(iso)) : iso.slice(0, 7);
  const short = (iso: string) => formatDate(iso, { day: 'numeric', month: 'short' });

  const list: Bucket[] = [];
  const index = new Map<string, Bucket>();
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const key = keyOf(day);
    if (index.has(key)) continue;
    const b: Bucket =
      unit === 'day'
        ? { key, tick: short(day), tip: dayLabel(day), value: 0 }
        : unit === 'week'
          ? { key, tick: short(day), tip: t('weekOf', { d: short(day) }), value: 0 }
          : { key, tick: formatDate(day, { month: 'short' }), tip: formatDate(day, { month: 'long', year: 'numeric' }), value: 0 };
    list.push(b);
    index.set(key, b);
  }
  for (const e of items) {
    const b = index.get(keyOf(e.date));
    if (b) b.value += value(e);
  }
  return list;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((m) => m >= v)!;
}

const CHART = { height: 180, top: 10, bottom: 26, left: 52, right: 6 };

function chartSvg(bs: Bucket[], width: number): string {
  const { height, top, bottom, left, right } = CHART;
  const plotW = Math.max(40, width - left - right);
  const plotH = height - top - bottom;
  const max = niceMax(Math.max(0, ...bs.map((b) => b.value)));
  const band = plotW / bs.length;
  const barW = Math.max(2, Math.min(24, band - 2));
  const base = top + plotH;

  const grid = [0, max / 2, max]
    .map((v) => {
      const y = base - (v / max) * plotH;
      return (
        `<line class="${v === 0 ? 'axis' : 'grid'}" x1="${left}" x2="${left + plotW}" y1="${y}" y2="${y}"/>` +
        html`<text class="tick" x="${left - 8}" y="${y + 4}" text-anchor="end">${moneyCompact(v)}</text>`.value
      );
    })
    .join('');

  const bars = bs
    .map((b, i) => {
      if (b.value <= 0) return '';
      const h = Math.max(2, (b.value / max) * plotH);
      const x = left + i * band + (band - barW) / 2;
      const r = Math.min(4, barW / 2, h);
      // Rounded data end, square at the baseline.
      return `<path class="bar" data-i="${i}" d="M${x},${base}V${base - h + r}a${r},${r} 0 0 1 ${r},${-r}H${x + barW - r}a${r},${r} 0 0 1 ${r},${r}V${base}Z"/>`;
    })
    .join('');

  const tickIdx = [...new Set([0, Math.floor((bs.length - 1) / 2), bs.length - 1])];
  const ticks = tickIdx
    .map((i) => {
      const anchor = i === 0 ? 'start' : i === bs.length - 1 ? 'end' : 'middle';
      const x = anchor === 'start' ? left : anchor === 'end' ? left + plotW : left + (i + 0.5) * band;
      return html`<text class="tick" x="${x}" y="${height - 6}" text-anchor="${anchor}">${bs[i].tick}</text>`.value;
    })
    .join('');

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${html`${t('overTime')}`.value}" tabindex="0">
    ${grid}${bars}${ticks}<line class="cursor" x1="0" x2="0" y1="${top}" y2="${base}" visibility="hidden"/></svg>`;
}

// ---- Page ----

export function mountDashboard(view: HTMLElement): () => void {
  let resizeObserver: ResizeObserver | null = null;

  function render(): void {
    const [from, to] = period();
    const inPeriod = store.expenses.filter((e) => e.date >= from && e.date <= to);
    // Everything is summed in the main currency; amounts whose rate isn't known yet are left out (and flagged).
    const converted = new Map<Expense, number>();
    for (const e of inPeriod) {
      const v = toMain(e.amount, e.currency, e.date);
      if (v !== null) converted.set(e, v);
    }
    const value = (e: Expense) => converted.get(e) ?? 0;
    const items = inPeriod.filter((e) => converted.has(e));
    const missing = inPeriod.length - items.length;
    const total = items.reduce((s, e) => s + value(e), 0);
    const days = Math.max(1, daysBetween(from, to < today() ? to : today()) + 1);

    const byCat = new Map<string, { total: number; count: number }>();
    for (const e of items) {
      const c = byCat.get(e.category) ?? { total: 0, count: 0 };
      c.total += value(e);
      c.count++;
      byCat.set(e.category, c);
    }
    const cats = [...byCat].sort((a, b) => b[1].total - a[1].total);
    const maxCat = Math.max(0, ...cats.map(([, c]) => c.total)) || 1;
    if (filter !== null && !byCat.has(filter)) filter = null;

    const listed = sortByDateDesc(filter === null ? inPeriod : inPeriod.filter((e) => e.category === filter), store.expenses);
    const byDay = new Map<string, Expense[]>();
    for (const e of listed) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);

    // The budget is always about the current month, so it sits above the period filters.
    view.innerHTML = html`
      ${budgetCard(currentBudgetStatus())}
      <div class="filters" role="group" aria-label="${t('period')}">
        ${PRESETS.map(([p, key]) => html`<button type="button" class="chip" data-preset="${p}" aria-pressed="${String(p === preset)}">${t(key)}</button>`)}
      </div>
      ${preset === 'custom'
        ? html`<div class="custom-range card">
            <label class="field"><span class="label">${t('from')}</span><input type="date" name="from" value="${custom.from}" /></label>
            <label class="field"><span class="label">${t('to')}</span><input type="date" name="to" value="${custom.to}" /></label>
          </div>`
        : ''}
      <div class="dash">
        <div class="dash-col">
          <section class="card hero">
            <span class="label">${t('totalSpent')}</span>
            <span class="hero-value">${money(total)}</span>
            <span class="hero-period">${formatDate(from, { day: 'numeric', month: 'short', year: 'numeric' })} – ${formatDate(to, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            <div class="stats">
              <div><span class="label">${t('expensesCount')}</span><strong>${inPeriod.length}</strong></div>
              <div><span class="label">${t('perDay')}</span><strong>${money(total / days)}</strong></div>
            </div>
            ${missing ? html`<p class="notice">${icon('alert')}<span>${t('notConverted', { n: missing })}</span></p>` : ''}
          </section>
          <section class="card chart-card">
            <h2>${t('overTime')}</h2>
            <div class="chart" id="chart"><div class="chart-tip" role="status" hidden></div></div>
          </section>
          <section class="card cats-card">
            <h2>${t('byCategory')}</h2>
            ${cats.length
              ? html`<ul class="catbars">
                  ${cats.map(
                    ([name, c]) => html`<li>
                      <button type="button" data-cat="${name}" aria-pressed="${String(filter === name)}">
                        ${categoryBadge(name)}
                        <span class="catbar-main">
                          <span class="catbar-top">
                            <span class="catbar-name">${categoryLabel(name)}</span>
                            <span class="catbar-value">${money(c.total)}</span>
                          </span>
                          <span class="catbar-track"><span class="catbar-fill" style="width:${Math.max(0, (c.total / maxCat) * 100).toFixed(1)}%;--c:${themedColor(store.category(name)?.color ?? '#898781')}"></span></span>
                          <span class="catbar-meta">${countLabel(c.count)} · ${total > 0 ? Math.round((c.total / total) * 100) : 0}%</span>
                        </span>
                      </button>
                    </li>`,
                  )}
                </ul>`
              : html`<p class="empty">${t('noData')}</p>`}
          </section>
        </div>
        <div class="dash-col">
          <section class="card list-card">
            <div class="section-head">
              <h2>${t('expenses')}</h2>
              ${filter !== null ? html`<button type="button" class="chip removable" data-action="clear">${categoryLabel(filter)}${icon('x')}</button>` : ''}
            </div>
            ${listed.length
              ? [...byDay].map(
                  ([day, list]) => html`<h3 class="day-head"><span>${dayLabel(day)}</span><span>${money(list.reduce((s, e) => s + value(e), 0))}</span></h3>
                    <ul class="list">${list.map((e) => expenseRow(e, { showDate: false }))}</ul>`,
                )
              : html`<p class="empty">${t('noData')}</p>`}
          </section>
        </div>
      </div>
    `.value;

    mountChart(buckets(items, value, from, to));
  }

  function mountChart(bs: Bucket[]): void {
    const box = $('#chart', view);
    const tip = $('.chart-tip', box);
    let active = -1;

    const draw = () => {
      box.querySelector('svg')?.remove();
      box.insertAdjacentHTML('afterbegin', chartSvg(bs, box.clientWidth));
      active = -1;
      tip.hidden = true;
    };

    const show = (i: number) => {
      const svg = box.querySelector('svg')!;
      active = Math.max(0, Math.min(bs.length - 1, i));
      const band = (box.clientWidth - CHART.left - CHART.right) / bs.length;
      const x = CHART.left + (active + 0.5) * band;
      svg.querySelectorAll('.bar').forEach((b) => b.classList.toggle('active', Number((b as SVGElement).dataset.i) === active));
      const cursor = svg.querySelector('.cursor')!;
      cursor.setAttribute('x1', String(x));
      cursor.setAttribute('x2', String(x));
      cursor.setAttribute('visibility', 'visible');
      tip.replaceChildren();
      const value = document.createElement('strong');
      value.textContent = money(bs[active].value);
      const label = document.createElement('span');
      label.textContent = bs[active].tip;
      tip.append(value, label);
      tip.hidden = false;
      tip.style.left = `${Math.min(Math.max(x, 60), box.clientWidth - 60)}px`;
    };

    const hide = () => {
      active = -1;
      tip.hidden = true;
      box.querySelector('.cursor')?.setAttribute('visibility', 'hidden');
      box.querySelectorAll('.bar.active').forEach((b) => b.classList.remove('active'));
    };

    const indexAt = (clientX: number) => {
      const rect = box.getBoundingClientRect();
      const band = (rect.width - CHART.left - CHART.right) / bs.length;
      return Math.floor((clientX - rect.left - CHART.left) / band);
    };

    const onPointer = (e: PointerEvent) => {
      const i = indexAt(e.clientX);
      if (i >= 0 && i < bs.length) show(i);
      else hide();
    };
    box.addEventListener('pointerdown', onPointer);
    box.addEventListener('pointermove', onPointer);
    box.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') hide();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        show(active < 0 ? bs.length - 1 : active + (e.key === 'ArrowLeft' ? -1 : 1));
      } else if (e.key === 'Escape') hide();
    });
    box.addEventListener('focusin', () => active < 0 && show(bs.length - 1));
    box.addEventListener('focusout', hide);

    draw();
    let lastWidth = box.clientWidth;
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(() => {
      if (box.clientWidth !== lastWidth) {
        lastWidth = box.clientWidth;
        draw();
      }
    });
    resizeObserver.observe(box);
  }

  view.addEventListener('click', onClick);
  view.addEventListener('change', onChange);

  function onClick(e: Event): void {
    const target = e.target as Element;
    if (target.closest('[data-action=budget]')) return openBudgetEditor();
    const presetBtn = target.closest<HTMLElement>('[data-preset]');
    if (presetBtn) {
      preset = presetBtn.dataset.preset as Preset;
      filter = null;
      return render();
    }
    const catBtn = target.closest<HTMLElement>('[data-cat]');
    if (catBtn) {
      const name = catBtn.dataset.cat!;
      filter = filter === name ? null : name;
      render();
      $('.list-card', view).scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (target.closest('[data-action=clear]')) {
      filter = null;
      render();
    }
  }

  function onChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    if ((input.name === 'from' || input.name === 'to') && input.value) {
      custom = { ...custom, [input.name]: input.value };
      render();
    }
  }

  render();
  const off = store.on((topic) => topic === 'data' && render());
  const offRates = onRatesChange(render);
  return () => {
    off();
    offRates();
    resizeObserver?.disconnect();
    view.removeEventListener('click', onClick);
    view.removeEventListener('change', onChange);
  };
}
