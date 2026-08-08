/**
 * Query key factory.
 *
 * Structured so a mutation can invalidate exactly the slice it changed —
 * `queryKeys.waypoints.all(propertyId)` to drop every list/detail for one
 * property after a create, `queryKeys.waypoints.detail(id)` alone after an
 * edit — rather than the common shortcut of invalidating a single flat
 * `['waypoints']` key and refetching everything on every write.
 */

import type { MovementAnalyticsOptions, ObservationListFilters } from './types';

export const queryKeys = {
  auth: {
    me: ['auth', 'me'] as const,
  },

  properties: {
    all: ['properties'] as const,
    list: () => ['properties', 'list'] as const,
    detail: (id: string) => ['properties', 'detail', id] as const,
  },

  waypoints: {
    /** Every waypoint query for one property — the key to invalidate after a create/delete. */
    forProperty: (propertyId: string) => ['waypoints', propertyId] as const,
    list: (propertyId: string, includeArchived = false) =>
      ['waypoints', propertyId, 'list', includeArchived] as const,
    windCheck: (id: string, windFromDeg: number, atUtc?: string) =>
      ['waypoints', 'windCheck', id, windFromDeg, atUtc ?? null] as const,
  },

  observations: {
    forProperty: (propertyId: string) => ['observations', propertyId] as const,
    list: (propertyId: string, filters: ObservationListFilters = {}) =>
      ['observations', propertyId, 'list', filters] as const,
  },

  filters: {
    all: ['filters'] as const,
    list: (propertyId?: string) => ['filters', 'list', propertyId ?? null] as const,
    presets: ['filters', 'presets'] as const,
  },

  analytics: {
    movement: (propertyId: string, options: MovementAnalyticsOptions = {}) =>
      ['analytics', propertyId, 'movement', options] as const,
    terrainProfile: (propertyId: string) => ['analytics', propertyId, 'terrainProfile'] as const,
  },

  offline: {
    regions: ['offline', 'regions'] as const,
  },

  terrain: {
    sources: ['terrain', 'sources'] as const,
    point: (lng: number, lat: number, zoom?: number, source?: string, wind?: number, at?: string) =>
      ['terrain', 'point', lng, lat, zoom ?? null, source ?? null, wind ?? null, at ?? null] as const,
  },
};
