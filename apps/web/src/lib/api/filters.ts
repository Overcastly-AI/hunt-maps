/**
 * Saved terrain filters — `apps/api/src/filters/filters.module.ts`.
 *
 * This is the product's stated moat (`CLAUDE.md`: "a named, persisted,
 * shareable object"), so create/update are offline-queued the same way
 * waypoints are — a filter tuned while sitting in a stand with no signal
 * must not be lost.
 *
 * Unlike `TerrainController` (`apps/api/src/terrain/terrain.controller.ts`),
 * which guards individual routes and leaves a few genuinely public (map
 * tiles, `sources`), `FiltersController` applies `@UseGuards(JwtAuthGuard)`
 * at the *class* level — every route, `presets()` included, requires a
 * signed-in user. `presets()` is still never offline-queued (it is a read of
 * static server data, not a user write), but it is authenticated like
 * everything else here.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mapColor } from '@hunt-maps/design';
import { apiFetch } from './client';
import { queryKeys } from './queryKeys';
import { enqueue, isKnownOffline, isQueueableFailure, newClientId } from './offlineQueue';
import type { CreateFilterInput, SavedFilterDto, UpdateFilterInput } from './types';

export const filtersApi = {
  list(propertyId?: string): Promise<SavedFilterDto[]> {
    const q = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : '';
    return apiFetch<SavedFilterDto[]>(`/filters${q}`);
  },
  presets(): Promise<SavedFilterDto[]> {
    return apiFetch<SavedFilterDto[]>('/filters/presets');
  },
  create(input: CreateFilterInput): Promise<SavedFilterDto> {
    return apiFetch<SavedFilterDto>('/filters', { method: 'POST', json: input });
  },
  update(id: string, input: UpdateFilterInput): Promise<SavedFilterDto> {
    return apiFetch<SavedFilterDto>(`/filters/${id}`, { method: 'PATCH', json: input });
  },
  remove(id: string): Promise<{ ok: true }> {
    return apiFetch<{ ok: true }>(`/filters/${id}`, { method: 'DELETE' });
  },
  importShared(id: string): Promise<SavedFilterDto> {
    return apiFetch<SavedFilterDto>(`/filters/${id}/import`, { method: 'POST' });
  },
};

export function useSavedFilters(propertyId?: string) {
  return useQuery({
    queryKey: queryKeys.filters.list(propertyId),
    queryFn: () => filtersApi.list(propertyId),
  });
}

export function useFilterPresets() {
  return useQuery({
    queryKey: queryKeys.filters.presets,
    queryFn: filtersApi.presets,
    staleTime: Infinity,
  });
}

export function useCreateFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<CreateFilterInput, 'clientId'>) => {
      const clientId = newClientId();
      const withClientId: CreateFilterInput = { ...input, clientId };
      const queueIt = (): SavedFilterDto => {
        enqueue({ kind: 'filter.create', clientId, input: withClientId });
        return {
          id: clientId,
          ownerId: '',
          propertyId: input.propertyId ?? null,
          name: input.name,
          description: input.description ?? null,
          predicate: input.predicate,
          // The optimistic echo of a queued create must show the *same*
          // default the editor would have applied, or a filter looks one
          // colour offline and another once it syncs. Taken from the design
          // system rather than copied out of it — this was a literal, and
          // CI's no-colour-literals guard was right to fail on it.
          color: input.color ?? mapColor['feature-bench'],
          opacity: input.opacity ?? 0.5,
          outline: input.outline ?? true,
          sharedPublicly: input.sharedPublicly ?? false,
          isPreset: false,
          clientId,
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } satisfies SavedFilterDto;
      };

      // See `useCreateObservation` — the device already told us there is no
      // link, so queue rather than hang.
      if (isKnownOffline()) return queueIt();

      try {
        return await filtersApi.create(withClientId);
      } catch (err) {
        if (!isQueueableFailure(err)) throw err;
        return queueIt();
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.filters.all });
    },
  });
}

export function useUpdateFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateFilterInput }) => {
      const queueIt = (): null => {
        enqueue({ kind: 'filter.update', id, input });
        return null;
      };
      if (isKnownOffline()) return queueIt();

      try {
        return await filtersApi.update(id, input);
      } catch (err) {
        if (!isQueueableFailure(err)) throw err;
        return queueIt();
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.filters.all });
    },
  });
}

export function useDeleteFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: filtersApi.remove,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.filters.all });
    },
  });
}

export function useImportSharedFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: filtersApi.importShared,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.filters.all });
    },
  });
}
