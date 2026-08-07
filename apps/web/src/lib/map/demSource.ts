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
