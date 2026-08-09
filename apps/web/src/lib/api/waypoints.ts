/**
 * Waypoints — `apps/api/src/waypoints/waypoints.module.ts`.
 *
 * Create and update are offline-queued: see `lib/api/offlineQueue.ts` for the
 * contract. `useCreateWaypoint` always generates a `clientId` up front (before
 * the request is even attempted) so the record has a stable identity whether
 * it saves immediately or queues — `WaypointsService.create` looks records up
 * by `clientId` before inserting, so replaying a queued create after a delay
 * can never duplicate the stand.
 */

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import { queryKeys } from './queryKeys';
import { enqueue, isKnownOffline, isQueueableFailure, newClientId, useQueueSnapshot } from './offlineQueue';
import type { CreateWaypointInput, UpdateWaypointInput, WaypointDto, WaypointWindCheckDto } from './types';

export const waypointsApi = {
  list(propertyId: string, includeArchived = false): Promise<WaypointDto[]> {
    const q = includeArchived ? '&includeArchived=true' : '';
    return apiFetch<WaypointDto[]>(`/waypoints?propertyId=${encodeURIComponent(propertyId)}${q}`);
  },
  create(input: CreateWaypointInput): Promise<WaypointDto> {
    return apiFetch<WaypointDto>('/waypoints', { method: 'POST', json: input });
  },
  update(id: string, input: UpdateWaypointInput): Promise<WaypointDto> {
    return apiFetch<WaypointDto>(`/waypoints/${id}`, { method: 'PATCH', json: input });
  },
  remove(id: string): Promise<{ ok: true }> {
    return apiFetch<{ ok: true }>(`/waypoints/${id}`, { method: 'DELETE' });
  },
  windCheck(id: string, windFromDeg: number, atUtc?: string): Promise<WaypointWindCheckDto> {
    const at = atUtc ? `&at=${encodeURIComponent(atUtc)}` : '';
    return apiFetch<WaypointWindCheckDto>(`/waypoints/${id}/wind-check?wind=${windFromDeg}${at}`);
  },
};

/**
 * The provisional stand a queued create stands for.
 *
 * `version`, `elevationM` and the server timestamps are not known until the
 * write lands, so they stay null/1 and callers must treat the record as
 * provisional (`useQueuedIds` tags it "Queued") rather than confirmed.
 */
function provisionalWaypoint(clientId: string, input: CreateWaypointInput): WaypointDto {
  const now = new Date().toISOString();
  return {
    id: clientId,
    propertyId: input.propertyId,
    type: input.type,
    name: input.name,
    notes: input.notes ?? null,
    elevationM: null,
    standHeightM: input.standHeightM ?? null,
    shootingLanesDeg: input.shootingLanesDeg ?? [],
    huntableWinds: input.huntableWinds ?? [],
    cameraDirectionDeg: input.cameraDirectionDeg ?? null,
    lastCheckedAt: null,
    archived: false,
    createdAt: now,
    updatedAt: now,
    version: 1,
    location: input.location,
  };
}

/**
 * Waypoints for a property, **including the ones still waiting to sync**.
 *
 * Same reasoning as `useObservations`: a stand marked at the bottom of a draw
 * has to still be on the list after the phone is force-quit and relaunched,
 * and the in-memory query cache does not survive that. See that hook's comment
 * for why the durable queue is read directly.
 */
export function useWaypoints(propertyId: string | undefined, includeArchived = false) {
  const query = useQuery({
    queryKey: queryKeys.waypoints.list(propertyId ?? '', includeArchived),
    queryFn: () => waypointsApi.list(propertyId as string, includeArchived),
    enabled: Boolean(propertyId),
  });

  const queue = useQueueSnapshot();
  const data = useMemo(() => {
    if (!propertyId) return query.data;
    const pending = queue
      .filter((i) => i.op.kind === 'waypoint.create')
      .map((i) => provisionalWaypoint((i.op as { clientId: string }).clientId, (i.op as { input: CreateWaypointInput }).input))
      .filter((w) => w.propertyId === propertyId);
    if (pending.length === 0) return query.data;
    return [...(query.data ?? []), ...pending];
  }, [query.data, queue, propertyId]);

  return { ...query, data };
}

export function useWaypointWindCheck(id: string | undefined, windFromDeg: number | null, atUtc?: string) {
  return useQuery({
    queryKey: queryKeys.waypoints.windCheck(id ?? '', windFromDeg ?? 0, atUtc),
    queryFn: () => waypointsApi.windCheck(id as string, windFromDeg as number, atUtc),
    // A wind-dependent readout with no wind set has nothing honest to show —
    // never fetch it against a made-up default direction.
    enabled: Boolean(id) && windFromDeg !== null,
  });
}

/**
 * Create a waypoint, queueing it if (and only if) the failure was a lack of
 * signal. Any other failure (validation, a permissions error) rejects
 * normally — those are not things retrying later can fix.
 */
export function useCreateWaypoint(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<CreateWaypointInput, 'clientId'>) => {
      const clientId = newClientId();
      const withClientId: CreateWaypointInput = { ...input, clientId };
      const queueIt = (): WaypointDto => {
        enqueue({ kind: 'waypoint.create', clientId, input: withClientId });
        return provisionalWaypoint(clientId, withClientId);
      };

      // See `useCreateObservation` — queue immediately rather than hanging on
      // a request the device has already told us cannot be sent.
      if (isKnownOffline()) return queueIt();

      try {
        return await waypointsApi.create(withClientId);
      } catch (err) {
        if (!isQueueableFailure(err)) throw err;
        return queueIt();
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.waypoints.forProperty(propertyId) });
    },
  });
}

/**
 * Update a waypoint. `baseVersion` should always be the version the caller
 * last loaded — omitting it opts out of conflict detection entirely, which
 * is almost never what a screen editing a specific stand wants (see
 * `UpdateWaypointInput`'s doc comment).
 */
export function useUpdateWaypoint(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateWaypointInput }) => {
      // No optimistic merge on either path — the caller already has the
      // pre-edit record cached, and `baseVersion` means the replay can still
      // come back a 409 rather than an applied edit.
      const queueIt = (): null => {
        enqueue({ kind: 'waypoint.update', id, input });
        return null;
      };
      if (isKnownOffline()) return queueIt();

      try {
        return await waypointsApi.update(id, input);
      } catch (err) {
        if (!isQueueableFailure(err)) throw err;
        return queueIt();
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.waypoints.forProperty(propertyId) });
    },
  });
}

export function useDeleteWaypoint(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: waypointsApi.remove,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.waypoints.forProperty(propertyId) });
    },
  });
}
