/**
 * Route guard for screens that need a signed-in user — the property,
 * waypoint, observation, filter and analytics screens the next agents build,
 * per the brief. **Not** wrapped around the map route itself
 * (`apps/web/src/App.tsx`): the map is exploratory and does not touch any
 * user-owned resource today, and gating it here would send every one of the
 * ~1400 lines of `apps/web/e2e/ui-invariants.spec.ts` — which navigate
 * straight to `/` with no backend running — to a login screen they have no
 * way to get past. Use this on the routes that actually call an
 * authenticated endpoint; leave the map route alone.
 */

import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/api';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
