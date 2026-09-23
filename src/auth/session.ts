import { ExcelDriver } from '../drivers/excel';
import { GoogleSheetsDriver } from '../drivers/google-sheets';
import type { TokenGetter } from '../drivers/http';
import type { Driver } from '../drivers/types';
import { completeGoogleRedirect, googleClientId, googleLogin, googleLogout, googleToken } from './google';
import { completeMsRedirect, msClientId, msLogin, msLogout, msToken } from './microsoft';
import { readJson } from './util';

export type Provider = 'google' | 'microsoft';

export interface Account {
  provider: Provider;
  email: string;
  name: string;
}

const ACCOUNT_KEY = 'spendly.account';

export const isConfigured = (p: Provider): boolean => Boolean(p === 'google' ? googleClientId : msClientId);

/** A stored account from an older version (the removed local mode) counts as signed out. */
export function getAccount(): Account | null {
  const a = readJson<Account>(ACCOUNT_KEY);
  return a && (a.provider === 'google' || a.provider === 'microsoft') ? a : null;
}

function setAccount(a: Account): void {
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(a));
}

/** Sends the user to the provider's sign-in page (full-page redirect). */
export function login(p: Provider, opts: { silent?: boolean; hint?: string } = {}): void {
  if (p === 'google') googleLogin(opts);
  else void msLogin(opts);
}

/**
 * Completes an OAuth redirect if the page was opened by one. On success the account is stored.
 * Returns the error code of a failed sign-in, or null.
 */
export async function completeRedirect(): Promise<string | null> {
  for (const [provider, complete] of [
    ['google', completeGoogleRedirect],
    ['microsoft', completeMsRedirect],
  ] as const) {
    const result = await complete();
    if (!result) continue;
    if (!result.ok) return result.error;
    const previous = getAccount();
    // Signing in with a different account: drop the previous account's cached data.
    if (previous && (previous.provider !== provider || previous.email !== result.profile.email)) clearCache(previous);
    setAccount({ provider, ...result.profile });
    return null;
  }
  return null;
}

export const tokenGetter = (p: Provider): TokenGetter => (p === 'google' ? googleToken : msToken);

export function createDriver(a: Account): Driver {
  const getToken = tokenGetter(a.provider);
  return a.provider === 'google' ? new GoogleSheetsDriver(getToken, a.email) : new ExcelDriver(getToken, a.email);
}

export const cacheKey = (a: Account): string => `spendly.cache.${a.provider}:${a.email}`;

/** Removes the offline copy of an account's data. The file itself is untouched. */
function clearCache(a: Account): void {
  localStorage.removeItem(cacheKey(a));
}

export function logout(): void {
  const a = getAccount();
  if (a) clearCache(a);
  googleLogout();
  msLogout();
  localStorage.removeItem(ACCOUNT_KEY);
}
