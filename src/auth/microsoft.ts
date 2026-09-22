import { AuthError } from '../drivers/http';
import { base64url, decodeJwt, randomString, readJson, redirectUri, type RedirectResult } from './util';

/**
 * Microsoft identity platform, authorization code flow with PKCE (the flow for SPAs).
 * Needs an app registration with a "Single-page application" redirect URI.
 * The refresh token keeps the session alive (up to 24h for SPAs); after that a
 * silent redirect (prompt=none) gets a new one without user interaction.
 */

const TENANT = import.meta.env.VITE_MS_TENANT || 'common';
const AUTHORITY = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0`;
const SCOPE = 'openid profile email offline_access User.Read Files.ReadWrite';
const TOKEN_KEY = 'spendly.ms.token';
const PKCE_KEY = 'spendly.ms.pkce';

export const msClientId = import.meta.env.VITE_MS_CLIENT_ID ?? '';

interface Token {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
}

export async function msLogin(opts: { silent?: boolean; hint?: string } = {}): Promise<void> {
  const verifier = randomString(48);
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = randomString(16);
  localStorage.setItem(PKCE_KEY, JSON.stringify({ state, verifier }));
  const params = new URLSearchParams({
    client_id: msClientId,
    response_type: 'code',
    response_mode: 'query',
    redirect_uri: redirectUri(),
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  if (opts.silent) params.set('prompt', 'none');
  else if (!opts.hint) params.set('prompt', 'select_account');
  if (opts.hint) params.set('login_hint', opts.hint);
  location.assign(`${AUTHORITY}/authorize?${params}`);
}

async function requestToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: msClientId, scope: SCOPE, ...body }),
  });
  if (res.status === 400 || res.status === 401) throw new AuthError(await res.text());
  if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
  return res.json();
}

function store(res: TokenResponse, previousRefresh?: string): void {
  const token: Token = {
    access_token: res.access_token,
    refresh_token: res.refresh_token ?? previousRefresh,
    expires_at: Date.now() + (res.expires_in - 60) * 1000,
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
}

/** Handles the redirect back from Microsoft (?code=… or ?error=…). Returns null if this isn't one. */
export async function completeMsRedirect(): Promise<RedirectResult | null> {
  const p = new URLSearchParams(location.search);
  if (!p.has('state') || !(p.has('code') || p.has('error'))) return null;
  history.replaceState(null, '', location.pathname + location.hash);

  const pkce = readJson<{ state: string; verifier: string }>(PKCE_KEY);
  localStorage.removeItem(PKCE_KEY);
  if (!pkce || p.get('state') !== pkce.state) return { ok: false, error: 'state_mismatch' };
  if (p.has('error')) return { ok: false, error: p.get('error')! };

  try {
    const res = await requestToken({
      grant_type: 'authorization_code',
      code: p.get('code')!,
      redirect_uri: redirectUri(),
      code_verifier: pkce.verifier,
    });
    store(res);
    const claims = decodeJwt(res.id_token ?? '');
    const email = String(claims.email ?? claims.preferred_username ?? '');
    return { ok: true, profile: { email, name: String(claims.name ?? email) } };
  } catch (e) {
    console.error(e);
    return { ok: false, error: 'token_failed' };
  }
}

let refreshing: Promise<string> | null = null;

export async function msToken(): Promise<string> {
  const token = readJson<Token>(TOKEN_KEY);
  if (!token) throw new AuthError();
  if (token.expires_at > Date.now()) return token.access_token;
  if (!token.refresh_token) throw new AuthError();
  refreshing ??= requestToken({ grant_type: 'refresh_token', refresh_token: token.refresh_token })
    .then((res) => {
      store(res, token.refresh_token);
      return res.access_token;
    })
    .catch((e) => {
      if (e instanceof AuthError) localStorage.removeItem(TOKEN_KEY);
      throw e;
    })
    .finally(() => (refreshing = null));
  return refreshing;
}

export function msLogout(): void {
  localStorage.removeItem(TOKEN_KEY);
}
