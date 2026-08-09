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
 *
 * ## "Still one of that account's properties" needs an actual answer
 *
 * That re-check is only meaningful against a *successful* fetch. Field QA
 * found the version that gated on `isLoading` instead: offline, the properties
 * query is paused or errored rather than loading, so an absent list read as a
 * confirmed-empty list, the remembered id was deleted, and the drawer told a
 * hunter with a real property that they needed to "create one and draw its
 * boundary" — a flow that cannot complete without the connection they do not
 * have, and which risks a duplicate property with a fresh (wrong)
 * `TerrainProfile` denominator for every future analytic if they try. See
 * `answered` below.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { propertiesApi, queryKeys, useAuth, type PropertySummaryDto } from './api';

const STORAGE_PREFIX = 'ridgeline.currentPropertyId.';
const NAME_PREFIX = 'ridgeline.currentPropertyName.';

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

/**
 * The remembered property's *name*, cached beside its id.
 *
 * Not redundant: offline the properties list cannot be fetched, so the id
 * alone leaves the banner reading "Property — unknown" over a property the
 * hunter chose by name twenty minutes ago. A name they picked themselves is
 * not a guess about their ground, and showing it is strictly more honest than
 * "unknown". It is only ever written by `select()`, from a property object the
 * server actually returned.
 */
function readPersistedName(userId: string): string | null {
  try {
    return window.localStorage.getItem(NAME_PREFIX + userId);
  } catch {
    return null;
  }
}

function writePersisted(userId: string, propertyId: string | null, name?: string | null): void {
  try {
    if (propertyId) window.localStorage.setItem(STORAGE_PREFIX + userId, propertyId);
    else window.localStorage.removeItem(STORAGE_PREFIX + userId);
    if (propertyId && name) window.localStorage.setItem(NAME_PREFIX + userId, name);
    else if (!propertyId) window.localStorage.removeItem(NAME_PREFIX + userId);
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
  /**
   * True when `properties` is empty because the list could not be fetched —
   * offline, paused, or a server error — rather than because the account
   * genuinely has none.
   *
   * A picker MUST branch on this before saying "you have no properties yet".
   * The two states look identical in the data and could not be further apart
   * on the ground: one is a first-run prompt, the other is telling a hunter
   * standing in the dark to go create and draw a property they already own,
   * via a flow that needs the connection they do not have.
   */
  propertiesUnverified: boolean;
  /**
   * The remembered property's name when the list itself is unavailable, so an
   * offline banner can say which ground this is instead of "unknown".
   */
  rememberedName: string | null;
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

  /**
   * Did we actually get an answer?
   *
   * `isLoading` alone cannot tell "the list came back and this property is not
   * in it" from "the list never came back". In TanStack Query v5 `isLoading`
   * is `isPending && isFetching`, so it is **false** for a query paused
   * offline (`fetchStatus: 'paused'`, not `'fetching'`) *and* false for one
   * that has exhausted its retries into an error state. Gating on it therefore
   * treated "no answer" as a confirmed "no such property" and deleted the
   * hunter's own remembered choice — R8's lesson exactly, applied to identity
   * instead of tile coverage: an absent answer rendered as a confident
   * negative. Only `isSuccess` is evidence.
   */
  const answered = propertiesQuery.isSuccess;

  // Re-derive whenever the account or the fetched list changes. Never trust
  // a persisted id across an account swap on the same device, and never
  // trust one that a *successful* fetch says is gone.
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
    if (!answered) {
      // No confirmation either way. Restore what the hunter explicitly chose
      // and keep it persisted: this is their own last direct choice, not a
      // default picked for them, and dropping it strands them at a property
      // picker that also cannot load. If the property really was deleted, the
      // next successful fetch clears it below.
      setPropertyId(persisted);
      return;
    }
    const match = properties.find((p) => p.id === persisted);
    if (match) {
      setPropertyId(persisted);
      // Refresh the cached name in case it was renamed on another device.
      writePersisted(user.id, persisted, match.name);
    } else {
      // Confirmed gone: the server answered, and this id is not in the answer.
      writePersisted(user.id, null);
      setPropertyId(null);
    }
  }, [status, user, properties, answered]);

  const select = useCallback(
    (id: string) => {
      if (status !== 'authenticated' || !user) return;
      writePersisted(user.id, id, properties.find((p) => p.id === id)?.name ?? null);
      setPropertyId(id);
    },
    [status, user, properties],
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
    propertiesUnverified: status === 'authenticated' && !answered,
    rememberedName: user ? readPersistedName(user.id) : null,
    select,
    clear,
  };
}
