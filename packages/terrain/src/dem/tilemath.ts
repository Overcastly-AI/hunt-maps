/**
 * Web-Mercator slippy-tile math.
 *
 * Everything downstream assumes a **conformal** projection, which Web Mercator
 * is: at any given point the scale factor is identical in x and y, so a single
 * isotropic `cellSize` is correct for gradient operators. That is the whole
 * reason we can run Horn/Evans kernels straight on the tile grid without
 * reprojecting to UTM first.
 */

/** Equatorial ground resolution of one 256px tile pixel at z=0, in metres. */
export const EQUATORIAL_RESOLUTION = 156543.03392804097;

export const EARTH_RADIUS = 6378137;

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

/**
 * Ground size of one pixel, in metres, at a given zoom and latitude.
 *
 * This is the `cellSize` every gradient operator needs. Note it shrinks with
 * `cos(lat)` — a slope computed at 60°N with the equatorial resolution would be
 * understated by 2x.
 */
export function pixelSizeMeters(zoom: number, latitude: number, tileSize = 256): number {
  const scale = tileSize / 256;
  return (EQUATORIAL_RESOLUTION * Math.cos((latitude * Math.PI) / 180)) / (2 ** zoom * scale);
}

export function lngLatToTile(lng: number, lat: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  };
}

export function tileToLngLat(x: number, y: number, zoom: number): { lng: number; lat: number } {
  const n = 2 ** zoom;
  const lng = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return { lng, lat: (latRad * 180) / Math.PI };
}

/** North-west corner of a tile. */
export function tileOrigin(tile: TileCoord): { lng: number; lat: number } {
  return tileToLngLat(tile.x, tile.y, tile.z);
}

/** Centre of a tile — the latitude we evaluate `pixelSizeMeters` at. */
export function tileCenter(tile: TileCoord): { lng: number; lat: number } {
  return tileToLngLat(tile.x + 0.5, tile.y + 0.5, tile.z);
}

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function tileBBox(tile: TileCoord): BBox {
  const nw = tileToLngLat(tile.x, tile.y, tile.z);
  const se = tileToLngLat(tile.x + 1, tile.y + 1, tile.z);
  return { west: nw.lng, north: nw.lat, east: se.lng, south: se.lat };
}

/** Every tile at `zoom` covering `bbox`. Used to plan an offline region download. */
export function tilesForBBox(bbox: BBox, zoom: number): TileCoord[] {
  const nw = lngLatToTile(bbox.west, bbox.north, zoom);
  const se = lngLatToTile(bbox.east, bbox.south, zoom);
  const x0 = Math.floor(nw.x);
  const x1 = Math.floor(se.x);
  const y0 = Math.floor(nw.y);
  const y1 = Math.floor(se.y);
  const out: TileCoord[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      out.push({ z: zoom, x, y });
    }
  }
  return out;
}

/** Great-circle distance in metres — used by corridor scoring and track stats. */
export function haversine(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
): number {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(s));
}
