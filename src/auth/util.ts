export const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const randomString = (bytes = 32): string => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

/** OAuth redirect target: the folder the app is served from (e.g. https://example.com/spendly/). */
export const redirectUri = (): string => new URL('.', location.origin + location.pathname).href;

export function decodeJwt(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
}

export interface Profile {
  email: string;
  name: string;
}

export type RedirectResult = { ok: true; profile: Profile } | { ok: false; error: string };

export function readJson<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
