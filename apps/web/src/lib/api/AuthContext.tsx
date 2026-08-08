/**
 * Auth state for the whole app.
 *
 * ## The boot sequence this exists to get right
 *
 * A hunter reopening the app at 05:30 with no signal must land in the app,
 * not at a login screen (CLAUDE.md's offline non-negotiable). So the initial
 * state is derived **synchronously** from whatever `tokenStore` already has —
 * no network round trip gates the first render. A background `/auth/me` call
 * then either confirms that state or corrects it, and — this is the part that
 * is easy to get backwards — only a *real* auth failure (a 401 that survived
 * a refresh attempt) signs the user out. A network failure during that check
 * leaves them signed in, with `isOffline: true` so the UI can say so honestly
 * instead of pretending the check succeeded.
 *
 * ## What "signed in" means here
 *
 * `status` is only ever `'authenticated'` or `'unauthenticated'` — there is
 * deliberately no `'loading'` that blocks the first paint. Screens that need
 * to know whether the cached `user` has been confirmed yet should read
 * `isOffline`, not add a loading gate; blocking render on a network call is
 * exactly the failure mode this file exists to avoid.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError } from './client';
import { tokenStore, type StoredAuth } from './tokenStore';
import { authApi } from './auth';
import type { AuthedUser, AuthTokens, LoginInput, RegisterInput } from './types';

export interface AuthState {
  status: 'authenticated' | 'unauthenticated';
  user: AuthedUser | null;
  /** True when the last background check of the session failed for lack of signal, not for lack of validity. */
  isOffline: boolean;
}

export interface AuthContextValue extends AuthState {
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function deriveInitialState(): AuthState {
  const stored = tokenStore.get();
  return stored
    ? { status: 'authenticated', user: stored.user, isOffline: false }
    : { status: 'unauthenticated', user: null, isOffline: false };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(deriveInitialState);
  // `me()` is fired once per mount; a second effect run under StrictMode
  // (or a fast remount) must not double up on it.
  const checkedOnce = useRef(false);

  useEffect(() => {
    if (checkedOnce.current) return;
    checkedOnce.current = true;

    const stored = tokenStore.get();
    if (!stored) return;

    let cancelled = false;
    authApi
      .me()
      .then((user) => {
        if (cancelled) return;
        const current = tokenStore.get();
        if (current) tokenStore.set({ ...current, user });
        setState({ status: 'authenticated', user, isOffline: false });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.kind === 'network') {
          // Could not confirm the session — but a hunter with no signal must
          // not be signed out for it. Keep the cached user, say we could not
          // check.
          setState((s) => ({ ...s, isOffline: true }));
          return;
        }
        // `apiFetch` already attempted a refresh before surfacing this, so a
        // `kind: 'auth'` (or anything else) here means the session really is
        // gone.
        tokenStore.clear();
        setState({ status: 'unauthenticated', user: null, isOffline: false });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /** Shared by `login` and `register` — both end with the same tokens-then-user handshake. */
  const completeSignIn = useCallback(async (tokens: AuthTokens) => {
    const provisional: StoredAuth = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: Date.now() + tokens.expiresInSeconds * 1000,
      user: null,
    };
    tokenStore.set(provisional);

    try {
      const user = await authApi.me();
      tokenStore.set({ ...provisional, user });
      setState({ status: 'authenticated', user, isOffline: false });
    } catch {
      // We just successfully authenticated moments ago — a `me()` failure
      // right after is almost certainly the connection dropping between the
      // two calls, not an invalid session. Stay signed in rather than
      // bouncing back to the login form; the background check on next mount
      // (or the next authenticated request's own retry) will fill `user` in.
      setState({ status: 'authenticated', user: null, isOffline: true });
    }
  }, []);

  const login = useCallback(
    async (input: LoginInput) => {
      const tokens = await authApi.login(input);
      await completeSignIn(tokens);
    },
    [completeSignIn],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const tokens = await authApi.register(input);
      await completeSignIn(tokens);
    },
    [completeSignIn],
  );

  const logout = useCallback(() => {
    const stored = tokenStore.get();
    tokenStore.clear();
    setState({ status: 'unauthenticated', user: null, isOffline: false });
    if (stored) {
      // Best effort — revokes the refresh token server-side so a stolen copy
      // stops working immediately, but a failure here (offline logout is a
      // normal thing to do) must not stop the local sign-out that already
      // happened above.
      authApi.logout(stored.refreshToken).catch(() => undefined);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, register, logout }),
    [state, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() must be called inside <AuthProvider>.');
  return ctx;
}
