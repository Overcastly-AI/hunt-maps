/**
 * The typed fetch layer every endpoint module in `lib/api/` builds on.
 *
 * Three things this file exists to get right, because getting them wrong is
 * the specific way a hunting app fails someone with no signal:
 *
 *  1. **Network failure and auth failure must never be confused.** A 401 means
 *     "log in again"; a `fetch` throw means "try later, you're offline". A
 *     caller that cannot tell the two apart from the thrown error will do the
 *     wrong thing — usually bouncing an offline user to a login screen, which
 *     CLAUDE.md calls out as the worst thing this app can do. `ApiError.kind`
 *     is how every caller tells them apart without re-deriving the logic.
 *  2. **A refresh is single-flighted.** Two requests that both meet a 401 at
 *     the same moment must trigger exactly one `/auth/refresh` call. Refresh
 *     tokens rotate on use (`apps/api/src/auth/auth.service.ts`), so a naive
 *     "each 401 refreshes independently" client sends the second refresh with
 *     an already-revoked token and logs the user out — precisely the failure
 *     this module exists to prevent.
 *  3. **A refresh that fails over the network must not look like a refresh
 *     that failed because the session is invalid.** Only a real rejection
 *     from the server (the refresh token itself was revoked/expired) clears
 *     stored credentials. A dropped connection mid-refresh leaves the tokens
 *     in place and surfaces `kind: 'network'`, so the caller can keep showing
 *     cached data instead of forcing a login screen in a hollow with no bars.
 */

import { tokenStore, type StoredAuth } from './tokenStore';

/**
 * Relative, not absolute. The Vite dev server proxies `/api` to the Nest
 * backend (`apps/web/vite.config.ts`), and the production Compose stack puts
 * nginx in front of both so the browser only ever sees one origin
 * (`deploy/compose/docker-compose.yml`). A relative base means the same
 * client code is correct in both places with no build-time env var — one
 * fewer thing to get wrong deploying to a new box the night before a season.
 */
const API_BASE = '/api';

/** How every failure from this layer is meant to be told apart. */
export type ApiErrorKind =
  /** `fetch` itself failed — DNS, timeout, no signal. Try later, not "log in again". */
  | 'network'
  /** A 401 that survived a refresh attempt. The session is actually gone. */
  | 'auth'
  /** 400/422 — the request was malformed or failed server-side validation. */
  | 'validation'
  /** 409 — optimistic-concurrency mismatch (a waypoint/observation edited elsewhere). */
  | 'conflict'
  | 'not_found'
  | 'forbidden'
  /** 5xx. The server, not the request, is at fault. */
  | 'server'
  | 'unknown';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  /** Parsed JSON error body, when the server sent one. Conflict responses carry `serverVersion`/`yourVersion` here. */
  readonly body?: unknown;

  constructor(kind: ApiErrorKind, message: string, opts?: { status?: number; body?: unknown; cause?: unknown }) {
    super(message, opts?.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = opts?.status;
    this.body = opts?.body;
  }
}

/** True for the failure classes retrying the exact same request cannot fix. */
export function isTerminalApiError(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    (err.kind === 'auth' ||
      err.kind === 'validation' ||
      err.kind === 'not_found' ||
      err.kind === 'forbidden' ||
      err.kind === 'conflict')
  );
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function messageFrom(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const m = (body as { message?: unknown }).message;
    if (typeof m === 'string') return m;
    if (Array.isArray(m) && m.every((x) => typeof x === 'string')) return m.join(' ');
  }
  return fallback;
}

function classifyHttpError(status: number, body: unknown): ApiError {
  switch (status) {
    case 401:
      return new ApiError('auth', messageFrom(body, 'Sign in again to continue.'), { status, body });
    case 403:
      return new ApiError('forbidden', messageFrom(body, 'You do not have access to this.'), { status, body });
    case 404:
      return new ApiError('not_found', messageFrom(body, 'Not found.'), { status, body });
    case 409:
      return new ApiError('conflict', messageFrom(body, 'This changed elsewhere since you last loaded it.'), {
        status,
        body,
      });
    case 400:
    case 422:
      return new ApiError('validation', messageFrom(body, 'That request was not valid.'), { status, body });
    default:
      if (status >= 500) {
        return new ApiError('server', messageFrom(body, 'The server had a problem. Try again shortly.'), {
          status,
          body,
        });
      }
      return new ApiError('unknown', messageFrom(body, `Request failed (${status}).`), { status, body });
  }
}

// ---------------------------------------------------------------------------
// Refresh — single-flighted, rotation-aware
// ---------------------------------------------------------------------------

/**
 * The one refresh attempt in flight, shared by every concurrent caller.
 *
 * Module-level by design: `apiFetch` calls in flight from unrelated
 * `useQuery`s (properties, waypoints, observations firing on the same mount)
 * must all await the *same* promise rather than each starting their own
 * refresh and stepping on each other's rotated token.
 */
let refreshInFlight: Promise<StoredAuth> | null = null;

/** Response shape of `POST /auth/register|login|refresh` (`apps/api/src/auth/auth.service.ts`'s `AuthTokens`). */
interface RawAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

async function rawRefreshRequest(refreshToken: string): Promise<RawAuthTokens> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch (cause) {
    // The network dropped mid-refresh. The refresh token presented is still
    // unspent server-side (rotation only happens once the server actually
    // processes it), so keep it — do not clear stored credentials here.
    throw new ApiError('network', 'Could not reach the server to refresh your session.', { cause });
  }

  if (!res.ok) {
    const body = await safeJson(res);
    // The server *did* answer, and it rejected the refresh token — it was
    // genuinely revoked, expired, or already spent by a previous refresh.
    // This is the one case where clearing stored credentials is correct.
    tokenStore.clear();
    throw classifyHttpError(res.status, body);
  }

  return (await safeJson(res)) as RawAuthTokens;
}

function performRefresh(): Promise<StoredAuth> {
  const current = tokenStore.get();
  if (!current) {
    return Promise.reject(new ApiError('auth', 'Not signed in.'));
  }
  return rawRefreshRequest(current.refreshToken).then((tokens) => {
    const next: StoredAuth = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: Date.now() + tokens.expiresInSeconds * 1000,
      // Rotation does not change who the user is; carry the cached user
      // forward rather than nulling it out on every refresh.
      user: current.user,
    };
    tokenStore.set(next);
    return next;
  });
}

/**
 * Exchange the stored refresh token for a new pair, sharing one in-flight
 * request across every concurrent caller.
 *
 * Exported (not just used internally) so `AuthContext` can proactively
 * refresh near expiry and so tests can assert the single-flight behaviour
 * directly rather than through two racing `apiFetch` calls only.
 */
export function refreshTokens(): Promise<StoredAuth> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** Proactive refresh margin. Refreshing a few seconds early avoids a guaranteed 401 round trip on a token that is about to expire. */
const REFRESH_MARGIN_MS = 15_000;

// ---------------------------------------------------------------------------
// The request layer every endpoint module calls
// ---------------------------------------------------------------------------

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  /** JSON-serialisable body. Sent with `Content-Type: application/json`. */
  json?: unknown;
  /** Defaults to `true`. Set `false` for the unauthenticated auth endpoints and public terrain tiles. */
  auth?: boolean;
}

async function requestOnce(path: string, init: ApiFetchOptions, attachAuth: boolean): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.json !== undefined) headers.set('Content-Type', 'application/json');
  if (attachAuth) {
    const stored = tokenStore.get();
    if (stored) headers.set('Authorization', `Bearer ${stored.accessToken}`);
  }

  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    });
  } catch (cause) {
    throw new ApiError('network', 'Could not reach the server. Check your connection.', { cause });
  }
}

/**
 * The one function every feature endpoint module calls.
 *
 * Handles proactive and reactive refresh transparently — callers never see a
 * 401 caused by an expired access token, only a real `kind: 'auth'` when the
 * session is genuinely gone (refresh itself was rejected).
 */
export async function apiFetch<T>(path: string, init: ApiFetchOptions = {}): Promise<T> {
  const auth = init.auth ?? true;

  if (auth) {
    const stored = tokenStore.get();
    if (stored && stored.expiresAt - Date.now() < REFRESH_MARGIN_MS) {
      try {
        await refreshTokens();
      } catch (err) {
        // A proactive refresh failing over the network is not fatal — the
        // current (soon-to-expire, maybe already-expired) access token might
        // still work, or the reactive 401 path below will surface the real
        // failure. Only swallow network errors here; a genuine auth failure
        // should stop the request now rather than send a token we know is
        // being rejected.
        if (!(err instanceof ApiError) || err.kind !== 'network') throw err;
      }
    }
  }

  let res = await requestOnce(path, init, auth);

  if (res.status === 401 && auth) {
    const stored = tokenStore.get();
    if (!stored) {
      throw new ApiError('auth', 'Sign in to continue.');
    }
    // Reactive path: the access token we sent was rejected. Refresh
    // (single-flighted) and retry exactly once.
    await refreshTokens();
    res = await requestOnce(path, init, auth);
  }

  if (!res.ok) {
    const body = await safeJson(res);
    throw classifyHttpError(res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return (await safeJson(res)) as T;
}
