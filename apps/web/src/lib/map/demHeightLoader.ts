/**
 * Production `HeightTileLoader` for `pointQuery.ts` — offline cache first,
 * network second, same order `TerrainProtocol` uses for rendered tiles.
 *
 * Deliberately its own small adapter rather than reusing `TerrainProtocol`
 * directly: that class hands back `ImageData` for raster compositing, and a
 * single point query only ever needs the decoded height field for one tile —
 * routing it through a whole ImageData/canvas round trip just to read nine
 * pixels back out would cost real allocation for no benefit. The two do
 * duplicate the same offline-cache-then-network fetch order
 * (`TerrainProtocol.fetchDem`); that duplication is intentional for this
 * change (see `TerrainReadout.tsx`'s mounting note) rather than refactoring a
 * class other in-flight work also touches.
 */

import type { DemEncoding, TileCoord } from '@hunt-maps/terrain';
import { decodeRgbaToHeights } from '@hunt-maps/terrain';
import { openTileStore } from '../offline/tileStore';
import { demTileKey } from './demTiles';
import type { HeightTileLoader } from './pointQuery';

export interface DemHeightLoaderConfig {
  demUrlTemplate: string;
  demEncoding: DemEncoding;
}

/**
 * Build a `HeightTileLoader` reading the persistent tile store first, then
 * falling back to the network and persisting what it fetches. A tile that is
 * genuinely absent (never downloaded, 404, no signal) resolves `null` —
 * `queryTerrainPoint` turns a missing *centre* tile into the `'no-data'`
 * outcome; a missing neighbour just costs one seam, exactly as it does for
 * rendered tiles.
 */
export function createDemHeightLoader(config: DemHeightLoaderConfig): HeightTileLoader {
  return async (tile: TileCoord, signal?: AbortSignal) => {
    const store = await openTileStore();
    const key = demTileKey(tile);

    const cached = await store.get(key);
    if (cached) return decodeDemBuffer(cached, config.demEncoding);

    const url = config.demUrlTemplate
      .replace('{z}', String(tile.z))
      .replace('{x}', String(tile.x))
      .replace('{y}', String(tile.y));

    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();

    // Persist for offline use, same as the rendering path. A quota failure
    // must not fail the query — the user still gets their answer.
    await store.put(key, buf).catch(() => undefined);
    return decodeDemBuffer(buf, config.demEncoding);
  };
}

async function decodeDemBuffer(buf: ArrayBuffer, encoding: DemEncoding): Promise<Float32Array> {
  const blob = new Blob([buf], { type: 'image/png' });
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable — cannot decode elevation tiles.');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return decodeRgbaToHeights(image.data, encoding);
}
