/**
 * Authenticated terrain endpoints — `apps/api/src/terrain/terrain.controller.ts`.
 *
 * The raster tile endpoints (`/terrain/tiles/:layer/:z/:x/:y.png`) are
 * deliberately **not** wrapped here — they are unauthenticated `<img>`/
 * MapLibre-source URLs consumed directly by `lib/map/terrainProtocol.ts`
 * (`map-builder`'s territory), not JSON calls through this client. This file
 * covers the JSON endpoints only: the point readout, filter-area evaluation,
 * and corridor solving.
 */

import { useMutation, useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';
import { queryKeys } from './queryKeys';
import type {
  CorridorSolveInput,
  CorridorSolveResult,
  DemCoverageDto,
  DemSourceDto,
  EvaluateFilterInput,
  EvaluateFilterResult,
  TerrainPointQuery,
  TerrainSampleDto,
} from './types';

export const terrainApi = {
  sources(): Promise<DemSourceDto[]> {
    return apiFetch<DemSourceDto[]>('/terrain/sources', { auth: false });
  },
  /**
   * Unauthenticated like `sources` — this is a yes/no about public-domain
   * elevation coverage, not anything about the caller, and gating it behind
   * sign-in would make a signed-out hunter's DEM picker unable to tell them
   * "no 1 m data here" before they tap it.
   */
  demCoverage(lng: number, lat: number): Promise<DemCoverageDto> {
    const params = new URLSearchParams({ lng: String(lng), lat: String(lat) });
    return apiFetch<DemCoverageDto>(`/terrain/dem/coverage?${params.toString()}`, { auth: false });
  },
  point(query: TerrainPointQuery): Promise<TerrainSampleDto> {
    const params = new URLSearchParams({ lng: String(query.lng), lat: String(query.lat) });
    if (query.zoom !== undefined) params.set('zoom', String(query.zoom));
    if (query.source) params.set('source', query.source);
    if (query.wind !== undefined) params.set('wind', String(query.wind));
    if (query.at) params.set('at', query.at);
    return apiFetch<TerrainSampleDto>(`/terrain/point?${params.toString()}`);
  },
  evaluateFilter(input: EvaluateFilterInput): Promise<EvaluateFilterResult> {
    return apiFetch<EvaluateFilterResult>('/terrain/filters/evaluate', {
      method: 'POST',
      json: input,
    });
  },
  solveCorridor(input: CorridorSolveInput): Promise<CorridorSolveResult> {
    return apiFetch<CorridorSolveResult>('/terrain/corridors/solve', {
      method: 'POST',
      json: input,
    });
  },
};

export function useDemSources() {
  return useQuery({
    queryKey: queryKeys.terrain.sources,
    queryFn: terrainApi.sources,
    staleTime: Infinity,
  });
}

export function useTerrainPoint(query: TerrainPointQuery | null) {
  return useQuery({
    queryKey: queryKeys.terrain.point(
      query?.lng ?? 0,
      query?.lat ?? 0,
      query?.zoom,
      query?.source,
      query?.wind,
      query?.at,
    ),
    queryFn: () => terrainApi.point(query as TerrainPointQuery),
    enabled: query !== null,
  });
}

/** A filter-area evaluation is run on demand ("how much of this matches?"), not cached against a key a screen would re-visit — a mutation, not a query. */
export function useEvaluateFilter() {
  return useMutation({ mutationFn: terrainApi.evaluateFilter });
}

/** A corridor solve is a heavy, on-demand computation over a whole property — a mutation, not a query, for the same reason `useEvaluateFilter` is. */
export function useSolveCorridor() {
  return useMutation({ mutationFn: terrainApi.solveCorridor });
}
