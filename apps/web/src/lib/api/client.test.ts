import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, ApiError, refreshTokens } from './client';
import { tokenStore, type StoredAuth } from './tokenStore';

function authFor(accessToken: string, opts: Partial<StoredAuth> = {}): StoredAuth {
  return {
    accessToken,
    refreshToken: 'refresh-1',
    expiresAt: Date.now() + 10 * 60_000, // comfortably not near expiry, so proactive refresh never fires
    user: { id: 'u1', email: 'a@b.com', displayName: 'Scout', unitSystem: 'IMPERIAL', createdAt: '2026-01-01' },
    ...opts,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('client.ts — network vs. auth failure classification', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    tokenStore.clear();
  });

  it('a fetch throw (no signal) surfaces as kind "network", never "auth"', async () => {
    tokenStore.set(authFor('token-1'));
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/properties')).rejects.toMatchObject({ kind: 'network' });
    // A network failure must never clear stored credentials — that is the
    // whole point of distinguishing it from a real auth failure.
    expect(tokenStore.get()).not.toBeNull();
  });

  it('a 401 that survives a refresh attempt surfaces as kind "auth" and clears stored credentials', async () => {
    tokenStore.set(authFor('expired-token'));
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/refresh')) {
        return Promise.resolve(jsonResponse(401, { message: 'Refresh token is invalid or expired.' }));
      }
      return Promise.resolve(jsonResponse(401, { message: 'Unauthorized' }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/properties')).rejects.toMatchObject({ kind: 'auth' });
    expect(tokenStore.get()).toBeNull();
  });

  it('a 409 conflict is classified distinctly from an auth failure and carries the server state', async () => {
    tokenStore.set(authFor('token-1'));
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(409, {
        message: 'This waypoint changed on the server since you last loaded it.',
        serverVersion: 3,
        yourVersion: 2,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const err = (await apiFetch('/waypoints/w1').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe('conflict');
    expect(err.body).toMatchObject({ serverVersion: 3, yourVersion: 2 });
    // Credentials are fine; a conflict is not a session problem.
    expect(tokenStore.get()).not.toBeNull();
  });

  it('a network failure while refreshing is reported as "network", not "auth" — the session is not known to be invalid', async () => {
    tokenStore.set(authFor('expired-token'));
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/refresh')) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(jsonResponse(401, { message: 'Unauthorized' }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/properties')).rejects.toMatchObject({ kind: 'network' });
    // Must NOT have cleared credentials — a dropped connection mid-refresh is
    // not evidence the refresh token itself is bad.
    expect(tokenStore.get()).not.toBeNull();
  });
});

describe('client.ts — refresh is single-flighted', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    tokenStore.clear();
  });

  it('two concurrent 401s trigger exactly one POST /auth/refresh, and both requests succeed after one retry', async () => {
    tokenStore.set(authFor('expired-token'));

    let refreshCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/auth/refresh')) {
        refreshCalls += 1;
        return Promise.resolve(
          jsonResponse(200, { accessToken: 'fresh-token', refreshToken: 'refresh-2', expiresInSeconds: 900 }),
        );
      }
      const auth = new Headers(init?.headers).get('Authorization');
      if (auth === 'Bearer expired-token') {
        return Promise.resolve(jsonResponse(401, { message: 'Unauthorized' }));
      }
      if (auth === 'Bearer fresh-token') {
        return Promise.resolve(jsonResponse(200, { ok: true, from: url }));
      }
      throw new Error(`unexpected Authorization header: ${auth}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([
      apiFetch<{ ok: true; from: string }>('/properties'),
      apiFetch<{ ok: true; from: string }>('/waypoints'),
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(refreshCalls).toBe(1);

    // The rotated pair replaced the old one, and the old (now-revoked)
    // refresh token is gone from storage.
    const stored = tokenStore.get();
    expect(stored?.accessToken).toBe('fresh-token');
    expect(stored?.refreshToken).toBe('refresh-2');
  });

  it('refreshTokens() itself is single-flighted when called directly', async () => {
    tokenStore.set(authFor('token-1'));
    let refreshCalls = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      refreshCalls += 1;
      return Promise.resolve(
        jsonResponse(200, { accessToken: 'next-token', refreshToken: 'next-refresh', expiresInSeconds: 900 }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const [x, y, z] = await Promise.all([refreshTokens(), refreshTokens(), refreshTokens()]);
    expect(refreshCalls).toBe(1);
    expect(x.accessToken).toBe('next-token');
    expect(y.accessToken).toBe('next-token');
    expect(z.accessToken).toBe('next-token');
  });
});

describe('client.ts — success path', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    tokenStore.clear();
  });

  it('attaches the stored access token and returns the parsed JSON body', async () => {
    tokenStore.set(authFor('token-1'));
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-1');
      return Promise.resolve(jsonResponse(200, { hello: 'world' }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/properties')).resolves.toEqual({ hello: 'world' });
  });

  it('an unauthenticated call (auth: false) sends no Authorization header even when tokens are stored', async () => {
    tokenStore.set(authFor('token-1'));
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
      return Promise.resolve(jsonResponse(200, { ok: true }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/filters/presets', { auth: false });
  });
});
