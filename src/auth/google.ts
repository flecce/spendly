import { AuthError } from '../drivers/http';
import { readJson, randomString, redirectUri, type RedirectResult } from './util';

/**
 * Google OAuth 2.0 for client-side apps (token via redirect): no backend, no popup,
 * works in installed PWAs on mobile. Tokens last ~1 hour; on expiry the app does a
 * silent redirect (prompt=none) which returns immediately when consent is already given.
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SCOPE = `openid email profile ${DRIVE_SCOPE}`;
const TOKEN_KEY = 'spendly.google.token';
const STATE_KEY = 'spendly.google.state';

export const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

interface Token {
  access_token: string;
  expires_at: number;
}

export function googleLogin(opts: { silent?: boolean; hint?: string } = {}): void {
  const state = randomString(16);
  localStorage.setItem(STATE_KEY, state);
  const params = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPE,
    state,
    include_granted_scopes: 'true',
  });
  if (opts.silent) params.set('prompt', 'none');
  else if (!opts.hint) params.set('prompt', 'select_account');
  if (opts.hint) params.set('login_hint', opts.hint);
  location.assign(`${AUTH_URL}?${params}`);
}

/** Handles the redirect back from Google (#access_token=… or #error=…). Returns null if this isn't one. */
export async function completeGoogleRedirect(): Promise<RedirectResult | null> {
  const p = new URLSearchParams(location.hash.slice(1));
  if (!p.has('state') || !(p.has('access_token') || p.has('error'))) return null;
  history.replaceState(null, '', location.pathname + location.search);

  const expected = localStorage.getItem(STATE_KEY);
  localStorage.removeItem(STATE_KEY);
  if (!expected || p.get('state') !== expected) return { ok: false, error: 'state_mismatch' };
  if (p.has('error')) return { ok: false, error: p.get('error')! };
  if (!(p.get('scope') ?? '').split(' ').includes(DRIVE_SCOPE)) return { ok: false, error: 'permission_denied' };

  const token: Token = {
    access_token: p.get('access_token')!,
    expires_at: Date.now() + (Number(p.get('expires_in') ?? 3600) - 60) * 1000,
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));

  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!res.ok) return { ok: false, error: 'userinfo_failed' };
  const info = (await res.json()) as { email?: string; name?: string };
  return { ok: true, profile: { email: info.email ?? '', name: info.name ?? info.email ?? '' } };
}

export async function googleToken(): Promise<string> {
  const token = readJson<Token>(TOKEN_KEY);
  if (!token || token.expires_at < Date.now()) throw new AuthError();
  return token.access_token;
}

export function googleLogout(): void {
  localStorage.removeItem(TOKEN_KEY);
}
