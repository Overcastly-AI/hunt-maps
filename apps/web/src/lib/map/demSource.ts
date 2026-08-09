/**
 * Where elevation tiles come from — one template, two consumers.
 *
 * `TerrainProtocol` fetches DEM tiles on demand while you pan; the region
 * downloader fetches the same tiles ahead of time so you can pan with no
 * signal. If those two ever resolved a tile to different URLs, a region could
 * download "successfully" into keys the analysis path never looks at, and the
 * coverage badge — which probes the store by key — would be measuring a cache
 * nobody reads. That is R8's bug wearing a new coat, so the template lives here
 * once and both import it.
 *
 * The value is read from `VITE_DEM_TEMPLATE` at **build** time (Vite inlines
 * `import.meta.env`), which is why a sandboxed run needs the relay URL set on
 * the build command rather than on the preview server.
 */

import type { TileCoord } from '@hunt-maps/terrain';

export const DEM_TEMPLATE: string =
  import.meta.env.VITE_DEM_TEMPLATE ??
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export function demTileUrl(tile: TileCoord, template: string = DEM_TEMPLATE): string {
  return template
    .replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y));
}

/**
 * What the web app tells a hunter about the elevation data under the map.
 *
 * There is exactly one DEM source wired into the browser today — the default
 * `terrarium` entry in `apps/api/src/terrain/dem.service.ts`'s `DEM_SOURCES` —
 * and this mirrors that entry's `label`/`attribution` vocabulary rather than
 * inventing new wording, so the API and the map never describe the same tiles
 * two different ways. `usgs3dep` exists there but ships with an empty
 * `urlTemplate` by default (`DEM_3DEP_TEMPLATE` unset) and the web app has no
 * source selector yet (`BACKLOG R77`), so this is deliberately a constant, not
 * a lookup — claiming a source the app cannot actually serve is the exact
 * defect this object exists to prevent.
 *
 * **Resolution note is load-bearing, not decoration.** Terrarium blends SRTM,
 * NED and others; over CONUS the underlying data is ~10 m (1/3 arc-second),
 * and `DEM_MAX_ZOOM` (`./demTiles.ts`) caps the tile pixel grid at zoom 15 on
 * top of that. That is real, useful shape — ridges, draws, broad benches — and
 * it is *not* LiDAR: the old logging grades and micro-benches a hunter goes
 * looking for are smaller than a single pixel here. Say so, rather than let
 * the layer label imply otherwise (this fixed a real regression — see the
 * `multiHillshade` layer in `../layers.ts`).
 */
export const DEM_SOURCE = {
  id: 'terrarium',
  label: 'AWS Terrain Tiles (Terrarium)',
  resolutionNote: '~10 m blended DEM, zoom 15 max — not LiDAR',
  attribution: 'Mapzen / AWS Terrain Tiles; USGS, SRTM, and others',
} as const;
