/**
 * The map workspace's "current property" — which property Stands, Sightings
 * and (when scoped) saved filters write against.
 *
 * ## Why this exists rather than picking one automatically
 *
 * `WaypointsSheet`/`ObservationsSheet` both require a `propertyId`, and there
 * is no property picker inside the map workspace today — `components/
 * properties/**` are full standalone screens behind `/properties`, not
 * something the drawer mounts. The tempting shortcut is to default to the
 * user's first property, or to whatever property was open last on this
 * device. Both are the exact "never be confidently wrong" failure
 * `CLAUDE.md` calls out by name applied to *identity* rather than terrain: a
 * wrong guess here does not mis-colour a slope, it files a hunter's stand or
 * sighting against someone else's ground. So nothing here is ever chosen
 * *for* the user — `select()` is the only thing that can set `propertyId`,
 * and it is always a direct response to the user tapping a specific
 * property's name.
 *
 * What *is* automatic is remembering an explicit choice across reloads (a
 * hunter reopening the app at the trailhead should not have to reselect
 * their own property every time) — but only after re-checking it is still
 * good: still for the *signed-in* account (keyed by user id, so a second
 * account signing in on the same device never inherits the first account's
 * choice) and still one of that account's properties (a deleted property, or
 * a stale value from before this pass existed, falls back to "ask again,"
 * never to a silently-wrong id).
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { propertiesApi, queryKeys, useAuth, type PropertySummaryDto } from './api';

const STORAGE_PREFIX = 'ridgeline.currentPropertyId.';

function readPersisted(userId: string): string | null {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + userId);
  } catch {
    // Private browsing / storage disabled — degrade to "ask every time"
    // rather than throwing, the same posture `tokenStore` takes for the same
    // reason.
    return null;
  }
}

function writePersisted(userId: string, propertyId: string | null): void {
  try {
    if (propertyId) window.localStorage.setItem(STORAGE_PREFIX + userId, propertyId);
    else window.localStorage.removeItem(STORAGE_PREFIX + userId);
  } catch {
    /* see `readPersisted` above */
  }
}

export interface CurrentPropertyState {
  /** `null` until the user has explicitly chosen one — never a fabricated default. */
  propertyId: string | null;
  property: PropertySummaryDto | null;
  /** The signed-in user's properties, for a picker. Always empty while unauthenticated. */
  properties: PropertySummaryDto[];
  /** True while the first fetch of `properties` is in flight and authenticated — a picker should say "loading", not "you have none yet". */
  isLoading: boolean;
  /** The only way `propertyId` is ever set — always a direct user choice. */
  select: (id: string) => void;
  /** Forgets the choice, e.g. a "change property" control. */
  clear: () => void;
}

export function useCurrentProperty(): CurrentPropertyState {
  const { status, user } = useAuth();

  // Gated on `status` rather than the barrel `useProperties()` hook: this
  // runs on every map-workspace mount, including signed-out and with no
  // backend at all (`ui-invariants.spec.ts`'s `vite preview` server), and an
  // unauthenticated request here would only ever come back a guaranteed 401
  // — worth skipping outright rather than firing it and discarding the
  // answer.
  const propertiesQuery = useQuery({
    queryKey: queryKeys.properties.list(),
    queryFn: propertiesApi.list,
    enabled: status === 'authenticated',
  });

  const properties = useMemo(
    () => (status === 'authenticated' ? (propertiesQuery.data ?? []) : []),
    [status, propertiesQuery.data],
  );

  const [propertyId, setPropertyId] = useState<string | null>(null);

  // Re-derive whenever the account or the fetched list changes. Never trust
  // a persisted id across an account swap on the same device, and never
  // trust one that no longer names a property this account can see.
  useEffect(() => {
    if (status !== 'authenticated' || !user) {
      setPropertyId(null);
      return;
    }
    const persisted = readPersisted(user.id);
    if (!persisted) {
      setPropertyId(null);
      return;
    }
    if (propertiesQuery.isLoading) return; // wait for the real list before trusting anything
    const stillExists = properties.some((p) => p.id === persisted);
    if (stillExists) {
      setPropertyId(persisted);
    } else {
      // Deleted, or left over from a build before this existed — clear it
      // rather than silently keep re-checking a dead id.
      writePersisted(user.id, null);
      setPropertyId(null);
    }
  }, [status, user, properties, propertiesQuery.isLoading]);

  const select = useCallback(
    (id: string) => {
      if (status !== 'authenticated' || !user) return;
      writePersisted(user.id, id);
      setPropertyId(id);
    },
    [status, user],
  );

  const clear = useCallback(() => {
    if (!user) return;
    writePersisted(user.id, null);
    setPropertyId(null);
  }, [user]);

  return {
    propertyId,
    property: properties.find((p) => p.id === propertyId) ?? null,
    properties,
    isLoading: status === 'authenticated' && propertiesQuery.isLoading,
    select,
    clear,
  };
}
