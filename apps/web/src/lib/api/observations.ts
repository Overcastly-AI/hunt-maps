/**
 * Observations — `apps/api/src/observations/observations.module.ts`.
 *
 * This is the ground-truth log (sightings, sign, sits) `CLAUDE.md`'s
 * analytics non-negotiable depends on, and the record most likely to be
 * created standing in the woods with no signal — so `useCreateObservation`
 * queues on network failure the same way `useCreateWaypoint` does. See
 * `lib/api/offlineQueue.ts` for the contract and what is unfinished.
 */

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import { queryKeys } from './queryKeys';
import { enqueue, isKnownOffline, isQueueableFailure, newClientId, useQueueSnapshot } from './offlineQueue';
import type { CreateObservationInput, ObservationDto, ObservationListFilters } from './types';

function toQuery(propertyId: string, filters: ObservationListFilters): string {
  const params = new URLSearchParams({ propertyId });
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.species) params.set('species', filters.species);
  if (filters.sex) params.set('sex', filters.sex);
  if (filters.since) params.set('since', filters.since);
  return params.toString();
}

export const observationsApi = {
  list(propertyId: string, filters: ObservationListFilters = {}): Promise<ObservationDto[]> {
    return apiFetch<ObservationDto[]>(`/observations?${toQuery(propertyId, filters)}`);
  },
  create(input: CreateObservationInput): Promise<ObservationDto> {
    return apiFetch<ObservationDto>('/observations', { method: 'POST', json: input });
  },
  remove(id: string): Promise<{ ok: true }> {
    return apiFetch<{ ok: true }>(`/observations/${id}`, { method: 'DELETE' });
  },
};

/**
 * The provisional record a queued create stands for.
 *
 * Every terrain field is honestly `null`: `ObservationsService.stampTerrain`
 * runs server-side only, so until the queued write actually lands there is no
 * slope, aspect or landform for this sighting and guessing one would be the
 * "confidently wrong" failure applied to the analytics denominator.
 */
function provisionalObservation(clientId: string, input: CreateObservationInput): ObservationDto {
  return {
    id: clientId,
    propertyId: input.propertyId,
    userId: '',
    waypointId: input.waypointId ?? null,
    kind: input.kind,
    species: input.species ?? null,
    sex: input.sex ?? null,
    estimatedAge: input.estimatedAge ?? null,
    count: input.count ?? 1,
    signType: input.signType ?? null,
    travelHeadingDeg: input.travelHeadingDeg ?? null,
    observedAt: input.observedAt,
    rutPhase: null,
    temperatureC: input.temperatureC ?? null,
    pressureHpa: input.pressureHpa ?? null,
    pressureTrend3h: input.pressureTrend3h ?? null,
    windSpeedKph: input.windSpeedKph ?? null,
    windFromDeg: input.windFromDeg ?? null,
    moonPhase: input.moonPhase ?? null,
    isBlankSit: input.isBlankSit ?? false,
    sitMinutes: input.sitMinutes ?? null,
    elevationM: null,
    slopeDeg: null,
    aspectDeg: null,
    landformClass: null,
    morphometry: null,
    isBench: null,
    ruggedness: null,
    windExposure: null,
    insolation: null,
    notes: input.notes ?? null,
    createdAt: new Date().toISOString(),
    version: 1,
    location: input.location,
  };
}

/** The same narrowing the server applies, so a queued record does not appear in a list it does not belong to. */
function matchesFilters(o: ObservationDto, filters: ObservationListFilters): boolean {
  if (filters.kind && o.kind !== filters.kind) return false;
  if (filters.species && o.species !== filters.species) return false;
  if (filters.sex && o.sex !== filters.sex) return false;
  if (filters.since && new Date(o.observedAt) < new Date(filters.since)) return false;
  return true;
}

/**
 * Observations for a property, **including the ones still waiting to sync**.
 *
 * The merge is the difference between a queued write that a hunter can see and
 * one they have to take on faith. `onSuccess`-invalidation cannot help here:
 * offline there is nothing to refetch, and the optimistic record the mutation
 * returns lives only in the in-memory query cache, which a reload throws away.
 * Reading the durable queue directly is the only version of this that survives
 * the app being killed in a pocket at 05:00.
 *
 * No duplicate risk on reconnect: `flushQueue` removes an item synchronously
 * the moment its replay resolves, before the invalidated refetch that brings
 * back the server's own copy can land.
 */
export function useObservations(propertyId: string | undefined, filters: ObservationListFilters = {}) {
  const query = useQuery({
    queryKey: queryKeys.observations.list(propertyId ?? '', filters),
    queryFn: () => observationsApi.list(propertyId as string, filters),
    enabled: Boolean(propertyId),
  });

  const queue = useQueueSnapshot();
  const data = useMemo(() => {
    if (!propertyId) return query.data;
    const pending = queue
      .filter((i) => i.op.kind === 'observation.create')
      .map((i) => provisionalObservation((i.op as { clientId: string }).clientId, (i.op as { input: CreateObservationInput }).input))
      .filter((o) => o.propertyId === propertyId && matchesFilters(o, filters));
    if (pending.length === 0) return query.data;
    return [...(query.data ?? []), ...pending];
    // `filters` is a fresh object literal at most call sites; key the memo on
    // its contents rather than its identity or this recomputes every render.
  }, [query.data, queue, propertyId, JSON.stringify(filters)]);

  return { ...query, data };
}

export function useCreateObservation(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<CreateObservationInput, 'clientId'>) => {
      const clientId = newClientId();
      const withClientId: CreateObservationInput = { ...input, clientId };
      const queueIt = (): ObservationDto => {
        enqueue({ kind: 'observation.create', clientId, input: withClientId });
        return provisionalObservation(clientId, withClientId);
      };

      // The device already knows there is no link — do not spend thirty
      // seconds on a request that cannot leave the handset while the hunter
      // watches a "Saving…" spinner they have no reason to distrust.
      if (isKnownOffline()) return queueIt();

      try {
        return await observationsApi.create(withClientId);
      } catch (err) {
        if (!isQueueableFailure(err)) throw err;
        return queueIt();
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.observations.forProperty(propertyId) });
    },
  });
}

export function useDeleteObservation(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: observationsApi.remove,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.observations.forProperty(propertyId) });
    },
  });
}
