/**
 * Basemap tile sources, and the rule for which map layers this app owns.
 *
 * Split out of `MapView` so the ownership predicate can be asserted without
 * dragging MapLibre (and its worker blob) into a unit test — and because the
 * predicate is load-bearing: `syncLayers` removes any `rl-*` layer it does not
 * recognise, and the offline coverage overlay lives under the same prefix. A
 * prefix-only test tore the coverage hatch off the map on the next layer
 * toggle, leaving the badge saying "Partial" with nothing on the map to say
 * *which half*.
 */

import { layerById } from '../layers';

export interface BaseSource {
  tiles: string[];
  attribution: string;
  maxzoom: number;
}

export const BASE_SOURCES: Record<string, BaseSource> = {
  satellite: {
    tiles: [
      'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: 'Imagery: Esri, Maxar, Earthstar Geographics',
    maxzoom: 19,
  },
  topo: {
    tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
    attribution: '© OpenTopoMap, © OpenStreetMap contributors',
    maxzoom: 17,
  },
};

/**
 * True for the ids `syncLayers` created and is therefore allowed to remove: a
 * registered analysis layer, a basemap, or the saved-filter stack.
 */
export function isSyncedLayer(id: string): boolean {
  return id === '__filters' || Boolean(BASE_SOURCES[id]) || Boolean(layerById(id));
}
