/**
 * Auth endpoints — thin wrappers over `apiFetch`. No React here; `AuthContext.tsx`
 * owns the stateful/React half.
 */

import { apiFetch, ApiError, type ApiErrorKind } from './client';
import type { AuthedUser, AuthTokens, LoginInput, RegisterInput } from './types';

export const authApi = {
  register(input: RegisterInput): Promise<AuthTokens> {
    return apiFetch<AuthTokens>('/auth/register', { method: 'POST', json: input, auth: false });
  },

  login(input: LoginInput): Promise<AuthTokens> {
    return apiFetch<AuthTokens>('/auth/login', { method: 'POST', json: input, auth: false });
  },

  /**
   * Best-effort. Called with `auth: false` and a fixed body rather than
   * routed through the normal authenticated path — logging out must still
   * revoke the *presented* refresh token even if the access token has
   * already expired, and it must never itself trigger a refresh (which would
   * rotate the token we are about to revoke out from under the revoke call).
   */
  logout(refreshToken: string): Promise<{ ok: true }> {
    return apiFetch<{ ok: true }>('/auth/logout', { method: 'POST', json: { refreshToken }, auth: false });
  },

  me(): Promise<AuthedUser> {
    return apiFetch<AuthedUser>('/auth/me', { method: 'GET' });
  },
};

/**
 * A message safe to show directly in the login/register form.
 *
 * Deliberately keeps the server's own message for `auth`/`validation` (e.g.
 * "An account with that email already exists.", "Invalid email or
 * password.") — those are already written for a user, not a developer. Only
 * `network` and anything unclassified get a message invented here, and the
 * `network` one is the one load-bearing distinction this whole module exists
 * to preserve: it must never read like "wrong password".
 */
export function describeAuthError(err: unknown): { kind: ApiErrorKind | 'unexpected'; message: string } {
  if (err instanceof ApiError) {
    if (err.kind === 'network') {
      return { kind: 'network', message: 'Could not reach the server. Check your connection and try again.' };
    }
    return { kind: err.kind, message: err.message };
  }
  return { kind: 'unexpected', message: 'Something went wrong. Try again.' };
}
