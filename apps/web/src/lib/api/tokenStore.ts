/**
 * Persisted auth state.
 *
 * Deliberately `localStorage`, not `sessionStorage` or an in-memory variable:
 * a hunter who force-quits the app in a truck at 04:45 and reopens it at the
 * trailhead must land in the app, not at a login screen (CLAUDE.md's offline
 * non-negotiable, applied to auth). `sessionStorage` is cleared on that kind
 * of relaunch on iOS PWAs; an in-memory store is cleared on every reload.
 *
 * Trade-off, stated rather than hidden: `localStorage` is readable by any
 * script on the origin, so a stored refresh token is a real XSS blast-radius
 * concern. Accepted for this pass because (a) there is no first-party
 * third-party script on this origin, and (b) the alternative — an
 * httpOnly-cookie refresh token — needs the API to set cookies and the SPA to
 * be served from the same origin with credentialed fetches, which is a
 * backend contract change outside this pass's territory. Flagged in the
 * handoff report as a follow-up, not silently accepted.
 */

export interface StoredAuthUser {
  id: string;
  email: string;
  displayName: string;
  unitSystem: 'IMPERIAL' | 'METRIC';
  createdAt: string;
}

export interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. Computed from the server's `expiresInSeconds` at issue/refresh time. */
  expiresAt: number;
  /**
   * The signed-in user, cached alongside the tokens.
   *
   * Null only in the narrow window between a fresh login/register succeeding
   * and the follow-up `/auth/me` call resolving — see `AuthContext.tsx`. A
   * cached user is what lets the app show *who* is signed in without a
   * network round trip on every cold start.
   */
  user: StoredAuthUser | null;
}

const KEY = 'ridgeline.auth.v1';

/**
 * `localStorage` throws in Safari private browsing and can throw under some
 * extension/embedding configurations. A hunting app failing to boot because a
 * storage API is unavailable is a worse outcome than falling back to
 * in-memory (session-only) persistence, so every access goes through this
 * guard.
 */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** In-memory fallback, used only when `localStorage` is unavailable. */
let memoryFallback: StoredAuth | null = null;

function isStoredAuth(v: unknown): v is StoredAuth {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.accessToken === 'string' &&
    typeof r.refreshToken === 'string' &&
    typeof r.expiresAt === 'number'
  );
}

export const tokenStore = {
  get(): StoredAuth | null {
    const s = storage();
    if (!s) return memoryFallback;
    try {
      const raw = s.getItem(KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      return isStoredAuth(parsed) ? parsed : null;
    } catch {
      // Corrupted entry. Treat as signed out rather than throwing on every
      // boot — a bad localStorage value must not brick the app.
      return null;
    }
  },

  set(value: StoredAuth): void {
    const s = storage();
    if (!s) {
      memoryFallback = value;
      return;
    }
    try {
      s.setItem(KEY, JSON.stringify(value));
    } catch {
      memoryFallback = value;
    }
  },

  clear(): void {
    memoryFallback = null;
    const s = storage();
    if (!s) return;
    try {
      s.removeItem(KEY);
    } catch {
      // Nothing to do — worst case a stale entry lingers until it is
      // overwritten by the next `set`.
    }
  },
};
