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
 */
wireOfflineQueueRunner(async (op: QueuedOp) => {
  switch (op.kind) {
    case 'waypoint.create':
      await waypointsApi.create(op.input);
      return;
    case 'waypoint.update':
      await waypointsApi.update(op.id, op.input);
      return;
    case 'observation.create':
      await observationsApi.create(op.input);
      return;
    case 'filter.create':
      await filtersApi.create(op.input);
      return;
    case 'filter.update':
      await filtersApi.update(op.id, op.input);
      return;
  }
});
