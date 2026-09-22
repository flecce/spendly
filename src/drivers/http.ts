/** The access token is missing or rejected: the user has to sign in again. */
export class AuthError extends Error {
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'AuthError';
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = 'HttpError';
  }
}

export type TokenGetter = () => Promise<string>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Authenticated JSON request with retries on throttling and transient server errors. */
export async function api<T = unknown>(getToken: TokenGetter, url: string, init: RequestInit = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const token = await getToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    const res = await fetch(url, { ...init, headers });
    if (res.status === 401) throw new AuthError();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const retryAfter = Number(res.headers.get('Retry-After'));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 400 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new HttpError(res.status, await res.text());
    const type = res.headers.get('Content-Type') ?? '';
    return (type.includes('json') ? await res.json() : null) as T;
  }
}

export const isNotFound = (e: unknown): boolean => e instanceof HttpError && (e.status === 404 || e.status === 403);
