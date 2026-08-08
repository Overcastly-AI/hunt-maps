/**
 * "Is this the observation I just logged still sitting in the offline
 * queue?" — identical contract to `components/waypoints/offlineStatus.ts`;
 * see its doc comment for the full reasoning. Duplicated for the same
 * per-folder-independence reason as `useHereLocation.ts`.
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
