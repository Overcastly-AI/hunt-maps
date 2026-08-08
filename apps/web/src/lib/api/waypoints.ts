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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import { queryKeys } from './queryKeys';
import { enqueue, isQueueableFailure, newClientId } from './offlineQueue';
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

export function useWaypoints(propertyId: string | undefined, includeArchived = false) {
  return useQuery({
    queryKey: queryKeys.waypoints.list(propertyId ?? '', includeArchived),
    queryFn: () => waypointsApi.list(propertyId as string, includeArchived),
    enabled: Boolean(propertyId),
  });
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
      try {
        return await waypointsApi.create(withClientId);
      } catch (err) {
        if (!isQueueableFailure(err)) throw err;
        enqueue({ kind: 'waypoint.create', clientId, input: withClientId });
        // Optimistic shape: enough for a list screen to render the new stand
        // immediately. `version`/`elevationM`/timestamps are not known until
        // the queued write actually lands — callers must treat this as
        // provisional (e.g. tag it "syncing") rather than a confirmed record.
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
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1,
          location: input.location,
        } satisfies WaypointDto;
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
      try {
        return await waypointsApi.update(id, input);
      } catch (err) {
        if (!isQueueableFailure(err)) throw err;
        enqueue({ kind: 'waypoint.update', id, input });
        return null; // No optimistic merge here — the caller already has the pre-edit record cached; see the handoff report.
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
