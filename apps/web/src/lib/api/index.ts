/**
 * `lib/api` — the typed client, auth and query layer.
 *
 * Barrel export for consumers, and the composition root that wires the
 * offline queue's runner (`offlineQueue.ts` cannot import the feature
 * modules itself without a dependency cycle, since they import it for
 * `enqueue`/`isQueueableFailure`).
 */

export * from './client';
export * from './tokenStore';
export * from './types';
export * from './auth';
export { AuthProvider, useAuth, type AuthState, type AuthContextValue } from './AuthContext';
export * from './queryClient';
export { queryKeys } from './queryKeys';
export * from './offlineQueue';

export * from './properties';
export * from './waypoints';
export * from './observations';
export * from './filters';
export * from './analytics';
export * from './offlineRegions';
export * from './terrain';

import { wireOfflineQueueRunner, type QueuedOp } from './offlineQueue';
import { queryClient } from './queryClient';
import { queryKeys } from './queryKeys';
import { waypointsApi } from './waypoints';
import { observationsApi } from './observations';
import { filtersApi } from './filters';

/**
 * Replays one queued write against the real endpoint it was queued for.
 *
 * Registered once, at import time, rather than requiring every app entry
 * point to remember to call it — `initOfflineQueue()` (called from
 * `main.tsx`) only registers the `online` listener; the runner needs to exist
 * before that listener can ever fire.
 *
 * Each successful replay invalidates the list it belongs to. Without that, a
 * record that syncs on reconnect leaves the queue (so `useObservations`/
 * `useWaypoints` stop folding it in) while nothing refetches the server's own
 * copy — the row a hunter was watching would simply disappear, which looks
 * exactly like the loss this whole queue exists to prevent. Invalidation is
 * fired *before* `flushQueue` removes the item, so the refetch can only land
 * after the removal and cannot render the same record twice.
 */
wireOfflineQueueRunner(async (op: QueuedOp) => {
  switch (op.kind) {
    case 'waypoint.create':
      await waypointsApi.create(op.input);
      void queryClient.invalidateQueries({ queryKey: queryKeys.waypoints.forProperty(op.input.propertyId) });
      return;
    case 'waypoint.update':
      await waypointsApi.update(op.id, op.input);
      void queryClient.invalidateQueries({ queryKey: ['waypoints'] });
      return;
    case 'observation.create':
      await observationsApi.create(op.input);
      void queryClient.invalidateQueries({ queryKey: queryKeys.observations.forProperty(op.input.propertyId) });
      return;
    case 'filter.create':
      await filtersApi.create(op.input);
      void queryClient.invalidateQueries({ queryKey: queryKeys.filters.all });
      return;
    case 'filter.update':
      await filtersApi.update(op.id, op.input);
      void queryClient.invalidateQueries({ queryKey: queryKeys.filters.all });
      return;
  }
});
