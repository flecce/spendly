import type { Category, Expense } from './schema';

/**
 * Guesses the category of a note by combining:
 *  1. history: the same note used before (strongest signal), and words seen with a category before;
 *  2. the category keywords (multilingual defaults, editable by the user).
 */

export const normalize = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const STOPWORDS = new Set(
  'the and for with from una uno con per del della dei dal alla allo agli nel sul tra fra los las por para con del les des pour avec dans sur une der die das und mit fur von zum zur beim'.split(' '),
);

const tokens = (normalized: string): string[] =>
  normalized.split(' ').filter((w) => w.length >= 3 && !/^\d/.test(w) && !STOPWORDS.has(w));

type Counts = Map<string, number>;

export interface Model {
  notes: Map<string, Counts>;
  words: Map<string, Counts>;
}

function bump(map: Map<string, Counts>, key: string, category: string): void {
  let counts = map.get(key);
  if (!counts) map.set(key, (counts = new Map()));
  counts.set(category, (counts.get(category) ?? 0) + 1);
}

export function learn(expenses: Expense[]): Model {
  const model: Model = { notes: new Map(), words: new Map() };
  for (const e of expenses) {
    if (!e.category) continue;
    const n = normalize(e.note);
    if (!n) continue;
    bump(model.notes, n, e.category);
    for (const w of new Set(tokens(n))) bump(model.words, w, e.category);
  }
  return model;
}

function keywordHits(note: string, words: string[], keyword: string): boolean {
  if (keyword.includes(' ')) return ` ${note} `.includes(` ${keyword}`);
  // Short keywords must match a whole word ("bar" ≠ "barber"); longer ones also match as a prefix ("farmaci" → "farmacia").
  return words.some((w) => w === keyword || (keyword.length >= 5 && w.startsWith(keyword)));
}

export function detectCategory(note: string, categories: Category[], model: Model): string | null {
  const n = normalize(note);
  if (!n) return null;
  const words = n.split(' ');
  const known = new Set(categories.map((c) => c.name));
  const scores = new Map<string, number>();
  const add = (cat: string, points: number) => {
    if (known.has(cat)) scores.set(cat, (scores.get(cat) ?? 0) + points);
  };

  for (const [cat, count] of model.notes.get(n) ?? []) add(cat, 100 + count * 10);

  for (const c of categories) {
    for (const raw of c.keywords) {
      const k = normalize(raw);
      if (k && keywordHits(n, words, k)) add(c.name, 3 * k.length);
    }
  }

  for (const w of tokens(n)) {
    const counts = model.words.get(w);
    if (!counts) continue;
    let total = 0;
    for (const v of counts.values()) total += v;
    // Share of this word's uses per category, weighted by how often we've seen it (capped).
    for (const [cat, v] of counts) add(cat, (12 * v * Math.min(total, 5)) / total);
  }

  let best: string | null = null;
  let bestScore = 0;
  for (const [cat, score] of scores) {
    if (score > bestScore) [best, bestScore] = [cat, score];
  }
  return best;
}
