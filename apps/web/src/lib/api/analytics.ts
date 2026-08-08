/**
 * Analytics — `apps/api/src/analytics/analytics.module.ts`.
 *
 * Read-only. See `MovementAnalyticsDto`'s doc comment in `types.ts` for which
 * fields are already use-vs-availability corrected (`bySlopeBand`,
 * `byAspectOctant`, `byLandform`) and which are **not**
 * (`byWindDirection`, `byPressureTrend`) — a screen built on
 * `useMovementAnalytics` must not chart the latter two as if they were,
 * per `CLAUDE.md`'s fifth non-negotiable. Route any new chart past
 * `analytics-auditor` before it ships, not after.
 */

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';
import { queryKeys } from './queryKeys';
import type { MovementAnalyticsDto, MovementAnalyticsOptions, TerrainProfileDto } from './types';

export const analyticsApi = {
  movement(propertyId: string, options: MovementAnalyticsOptions = {}): Promise<MovementAnalyticsDto> {
    const params = new URLSearchParams({ propertyId });
    if (options.matureOnly) params.set('matureOnly', 'true');
    if (options.since) params.set('since', options.since);
    return apiFetch<MovementAnalyticsDto>(`/analytics/movement?${params.toString()}`);
  },
  terrainProfile(propertyId: string): Promise<TerrainProfileDto> {
    return apiFetch<TerrainProfileDto>(`/analytics/terrain-profile?propertyId=${encodeURIComponent(propertyId)}`);
  },
};

export function useMovementAnalytics(propertyId: string | undefined, options: MovementAnalyticsOptions = {}) {
  return useQuery({
    queryKey: queryKeys.analytics.movement(propertyId ?? '', options),
    queryFn: () => analyticsApi.movement(propertyId as string, options),
    enabled: Boolean(propertyId),
  });
}

export function useTerrainProfile(propertyId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.analytics.terrainProfile(propertyId ?? ''),
    queryFn: () => analyticsApi.terrainProfile(propertyId as string),
    enabled: Boolean(propertyId),
    // Expensive server-side (a full raster pass) and stable — matches the
    // server's own caching rationale for `TerrainProfile` (recomputed only
    // when the boundary or DEM source changes).
    staleTime: 30 * 60_000,
  });
}
