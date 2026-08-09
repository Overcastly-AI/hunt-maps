/**
 * "Is this the record I just created still sitting in the offline queue?"
 *
 * `useCreateWaypoint`/`useCreateObservation` (`lib/api/waypoints.ts`,
 * `lib/api/observations.ts`) already queue on a network failure and resolve
 * with a provisional record — but the resolved value alone does not say
 * *which* path was taken. It does not need to: when a create is queued, the
 * optimistic record's `id` is set to the `clientId` that was also handed to
 * `enqueue()` (see both hooks' doc comments), and a live save's `id` is
 * always the server's own generated uuid, which can never collide with a
 * client-generated one. So membership in the queue, keyed by that id, is
 * itself the answer — no new field needed on the DTO, and nothing added to
 * `offlineQueue.ts`, which is out of this pass's territory.
 *
 * A queued write must be visibly queued, not indistinguishable from a saved
 * one (the brief's own words) — this is what a list row/detail view reads to
 * show "Queued — will sync" instead of pretending the record already landed.
 */

import { useEffect, useState } from 'react';
import { listQueue, subscribeQueue, type QueuedOp } from '../../lib/api';

export function useQueuedIds(kind: QueuedOp['kind']): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => idsFor(kind));

  useEffect(() => {
    setIds(idsFor(kind));
    return subscribeQueue(() => setIds(idsFor(kind)));
  }, [kind]);

  return ids;
}

function idsFor(kind: QueuedOp['kind']): Set<string> {
  const ids = new Set<string>();
  for (const item of listQueue()) {
    if (item.op.kind === kind && 'clientId' in item.op) ids.add(item.op.clientId);
  }
  return ids;
}
