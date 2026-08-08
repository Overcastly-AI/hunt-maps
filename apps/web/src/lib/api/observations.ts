/**
 * Observations — `apps/api/src/observations/observations.module.ts`.
 *
 * This is the ground-truth log (sightings, sign, sits) `CLAUDE.md`'s
 * analytics non-negotiable depends on, and the record most likely to be
 * created standing in the woods with no signal — so `useCreateObservation`
 * queues on network failure the same way `useCreateWaypoint` does. See
 * `lib/api/offlineQueue.ts` for the contract and what is unfinished.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import { queryKeys } from './queryKeys';
import { enqueue, isQueueableFailure, newClientId } from './offlineQueue';
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

export function useObservations(propertyId: string | undefined, filters: ObservationListFilters = {}) {
  return useQuery({
    queryKey: queryKeys.observations.list(propertyId ?? '', filters),
    queryFn: () => observationsApi.list(propertyId as string, filters),
    enabled: Boolean(propertyId),
  });
}

export function useCreateObservation(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<CreateObservationInput, 'clientId'>) => {
      const clientId = newClientId();
      const withClientId: CreateObservationInput = { ...input, clientId };
      try {
        return await observationsApi.create(withClientId);
      } catch (err) {
        if (!isQueueableFailure(err)) throw err;
        enqueue({ kind: 'observation.create', clientId, input: withClientId });
        // Provisional record for an optimistic list render — terrain is not
        // stamped until the queued write actually reaches the server
        // (`ObservationsService.stampTerrain` runs server-side only), so
        // every terrain field here is honestly null rather than guessed.
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
        } satisfies ObservationDto;
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
