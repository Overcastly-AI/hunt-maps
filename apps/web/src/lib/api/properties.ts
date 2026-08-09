/**
 * Properties — `apps/api/src/properties/properties.module.ts`.
 *
 * Reads degrade the way `queryClient.ts` documents: a screen built on these
 * hooks should render from `data` and treat `error` as an annotation, never
 * as a reason to blank the page.
 *
 * Writes here are **not** offline-queued (see `lib/api/offlineQueue.ts` for
 * what is): creating/editing a property means drawing or redrawing a
 * boundary, a heavier flow than logging a stand or a sighting, and it is
 * reasonable for that specific action to require a live connection rather
 * than queueing a boundary edit that also invalidates the property's cached
 * `TerrainProfile` server-side. If a future pass wants to queue these too,
 * `offlineQueue.ts`'s shape extends the same way waypoints/observations/
 * filters already do.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import { queryKeys } from './queryKeys';
import type {
  AddPropertyMemberInput,
  CreatePropertyInput,
  PropertyDetailDto,
  PropertySummaryDto,
  UpdatePropertyInput,
} from './types';

export const propertiesApi = {
  list(): Promise<PropertySummaryDto[]> {
    return apiFetch<PropertySummaryDto[]>('/properties');
  },
  get(id: string): Promise<PropertyDetailDto> {
    return apiFetch<PropertyDetailDto>(`/properties/${id}`);
  },
  create(input: CreatePropertyInput): Promise<PropertyDetailDto> {
    return apiFetch<PropertyDetailDto>('/properties', { method: 'POST', json: input });
  },
  update(id: string, input: UpdatePropertyInput): Promise<PropertyDetailDto> {
    return apiFetch<PropertyDetailDto>(`/properties/${id}`, { method: 'PATCH', json: input });
  },
  remove(id: string): Promise<{ ok: true }> {
    return apiFetch<{ ok: true }>(`/properties/${id}`, { method: 'DELETE' });
  },
  addMember(id: string, input: AddPropertyMemberInput): Promise<PropertyDetailDto> {
    return apiFetch<PropertyDetailDto>(`/properties/${id}/members`, { method: 'POST', json: input });
  },
  removeMember(id: string, memberId: string): Promise<PropertyDetailDto> {
    return apiFetch<PropertyDetailDto>(`/properties/${id}/members/${memberId}`, { method: 'DELETE' });
  },
};

export function useProperties() {
  return useQuery({ queryKey: queryKeys.properties.list(), queryFn: propertiesApi.list });
}

export function useProperty(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.properties.detail(id ?? ''),
    queryFn: () => propertiesApi.get(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: propertiesApi.create,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.properties.list() });
    },
  });
}

export function useUpdateProperty(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePropertyInput) => propertiesApi.update(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.properties.detail(id) });
      void qc.invalidateQueries({ queryKey: queryKeys.properties.list() });
    },
  });
}

export function useDeleteProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: propertiesApi.remove,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.properties.list() });
    },
  });
}
