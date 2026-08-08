/**
 * Offline region bookkeeping — `apps/api/src/offline/offline.module.ts`.
 *
 * This is the *server's* record of a region (used for cross-device visibility
 * and the size estimate before a download starts) — not the tile bytes
 * themselves, which `apps/web/src/lib/offline/` (owned by
 * `map-builder`/`offline-steward`, out of this pass's territory) downloads
 * and stores in OPFS/IndexedDB directly from the device. Not offline-queued:
 * starting a *new* download while offline is incoherent (there is nothing to
 * fetch), so a network failure here should surface to the user as-is rather
 * than queue silently.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import { queryKeys } from './queryKeys';
import type { OfflineEstimateDto, OfflineRegionCreateResponse, OfflineRegionDto, OfflineRegionRequestInput } from './types';

export const offlineRegionsApi = {
  list(): Promise<OfflineRegionDto[]> {
    return apiFetch<OfflineRegionDto[]>('/offline/regions');
  },
  estimate(input: OfflineRegionRequestInput): Promise<OfflineEstimateDto> {
    return apiFetch<OfflineEstimateDto>('/offline/regions/estimate', { method: 'POST', json: input });
  },
  create(input: OfflineRegionRequestInput): Promise<OfflineRegionCreateResponse> {
    return apiFetch<OfflineRegionCreateResponse>('/offline/regions', { method: 'POST', json: input });
  },
  complete(id: string, tileCount: number, sizeBytes: number): Promise<OfflineRegionDto> {
    return apiFetch<OfflineRegionDto>(`/offline/regions/${id}/complete`, {
      method: 'POST',
      json: { tileCount, sizeBytes },
    });
  },
  remove(id: string): Promise<{ ok: true }> {
    return apiFetch<{ ok: true }>(`/offline/regions/${id}`, { method: 'DELETE' });
  },
};

export function useOfflineRegions() {
  return useQuery({ queryKey: queryKeys.offline.regions, queryFn: offlineRegionsApi.list });
}

export function useCreateOfflineRegion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: offlineRegionsApi.create,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.offline.regions });
    },
  });
}

export function useCompleteOfflineRegion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, tileCount, sizeBytes }: { id: string; tileCount: number; sizeBytes: number }) =>
      offlineRegionsApi.complete(id, tileCount, sizeBytes),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.offline.regions });
    },
  });
}

export function useDeleteOfflineRegion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: offlineRegionsApi.remove,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.offline.regions });
    },
  });
}
