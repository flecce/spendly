/** Tiny tagged-template helper: every interpolated value is HTML-escaped unless it is already SafeHtml. */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

function toHtml(v: unknown): string {
  if (v instanceof SafeHtml) return v.value;
  if (Array.isArray(v)) return v.map(toHtml).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(String(v));
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += toHtml(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/** Mark a trusted, static string (icons, generated SVG) as HTML. */
export const raw = (s: string): SafeHtml => new SafeHtml(s);
