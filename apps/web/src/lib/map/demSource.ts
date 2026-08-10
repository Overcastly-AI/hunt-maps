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

/** Where elevation comes from when nothing overrides it. */
export const DEFAULT_DEM_TEMPLATE =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

/**
 * This was `?? DEFAULT_DEM_TEMPLATE`, and that shipped a product with no
 * terrain layers at all for every containerised build.
 *
 * `apps/web/Dockerfile` declares `ARG VITE_DEM_TEMPLATE=""`, so unless a
 * template is passed on the build command the variable is defined and **empty**.
 * `??` falls back only on null/undefined — an empty string is neither — so Vite
 * inlined `""`, `demTileUrl()` returned `""` for every tile, and every layer
 * that needs elevation (hillshade, slope, aspect, landform, bedding, corridors)
 * silently rendered nothing. Locally the variable is simply unset, so
 * `import.meta.env.VITE_DEM_TEMPLATE` is `undefined`, the fallback applies, and
 * the bug is invisible in dev and in every test. It only exists in the image.
 *
 * Empty and whitespace are treated as "not configured", which is what a person
 * writing `--build-arg VITE_DEM_TEMPLATE=` means. A value that is present but
 * unusable is a different failure and must not be silently rewritten — see
 * `assertUsableDemTemplate`.
 */
const configured = import.meta.env.VITE_DEM_TEMPLATE;
export const DEM_TEMPLATE: string =
  typeof configured === 'string' && configured.trim() !== ''
    ? configured.trim()
    : DEFAULT_DEM_TEMPLATE;

/**
 * Fails loudly on a template that cannot address a tile.
 *
 * The original bug was survivable-looking: no exception, no console error, just
 * a map with every terrain layer blank and no way to tell whether the ground is
 * flat or the data never arrived. That is precisely the "confidently wrong
 * about terrain" failure this codebase ranks worst, so a template that is
 * present but missing its placeholders is refused rather than fetched.
 */
export function assertUsableDemTemplate(template: string = DEM_TEMPLATE): void {
  const missing = (['{z}', '{x}', '{y}'] as const).filter((p) => !template.includes(p));
  if (missing.length > 0) {
    throw new Error(
      `DEM tile template cannot address a tile — missing ${missing.join(', ')}. ` +
        `Got ${JSON.stringify(template)}. Set VITE_DEM_TEMPLATE at build time, ` +
        `or leave it unset to use ${DEFAULT_DEM_TEMPLATE}.`,
    );
  }
}

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
