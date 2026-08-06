/**
 * `HeightGrid` — the single data structure every analysis operator consumes.
 *
 * ## Why the halo matters
 *
 * Every gradient operator here (Horn, Evans, TPI, TRI) reads a neighbourhood
 * around each cell. If we ran them on a bare 256x256 tile, every tile edge
 * would produce garbage, and the user would see a visible grid of seams across
 * the slope-shading layer — the single most common bug in home-grown hillshade
 * implementations.
 *
 * So a grid carries a `halo`: extra rows/cols stitched in from the 8 neighbouring
 * tiles. `width`/`height` describe the *interior* (the part that gets rendered);
 * indexing helpers translate interior coordinates into the padded buffer. A TPI
 * radius of 30 px needs a 30 px halo, which is why `assembleGrid` takes the
 * required radius rather than assuming 1.
 */

import { NODATA } from './encoding.js';
import { pixelSizeMeters, type TileCoord, tileCenter } from './tilemath.js';

export interface HeightGridInit {
  /** Interior width in cells. */
  width: number;
  /** Interior height in cells. */
  height: number;
  /** Halo thickness in cells on every side. */
  halo: number;
  /** Ground size of one cell in metres (isotropic — see tilemath.ts). */
  cellSize: number;
  /** Padded buffer of length `(width + 2*halo) * (height + 2*halo)`. */
  data: Float32Array;
  /** Latitude of the grid centre, for solar/thermal calculations. */
  centerLat?: number;
  centerLng?: number;
}

export class HeightGrid {
  readonly width: number;
  readonly height: number;
  readonly halo: number;
  readonly cellSize: number;
  readonly data: Float32Array;
  readonly stride: number;
  readonly centerLat: number;
  readonly centerLng: number;

  constructor(init: HeightGridInit) {
    this.width = init.width;
    this.height = init.height;
    this.halo = init.halo;
    this.cellSize = init.cellSize;
    this.data = init.data;
    this.stride = init.width + 2 * init.halo;
    this.centerLat = init.centerLat ?? 0;
    this.centerLng = init.centerLng ?? 0;

    const expected = this.stride * (init.height + 2 * init.halo);
    if (init.data.length !== expected) {
      throw new Error(
        `HeightGrid buffer size mismatch: got ${init.data.length}, expected ${expected}`,
      );
    }
  }

  /** Allocate an empty grid filled with NODATA. */
  static empty(
    width: number,
    height: number,
    halo: number,
    cellSize: number,
    centerLat = 0,
    centerLng = 0,
  ): HeightGrid {
    const stride = width + 2 * halo;
    const data = new Float32Array(stride * (height + 2 * halo)).fill(NODATA);
    return new HeightGrid({ width, height, halo, cellSize, data, centerLat, centerLng });
  }

  /**
   * Read an interior coordinate. `x`/`y` may run negative or past the interior
   * bounds by up to `halo` cells — that is exactly what the operators do.
   * Anything beyond that clamps, so a grid assembled without neighbours
   * degrades to edge-replication instead of throwing.
   */
  get(x: number, y: number): number {
    const px = clamp(x + this.halo, 0, this.stride - 1);
    const py = clamp(y + this.halo, 0, this.height + 2 * this.halo - 1);
    return this.data[py * this.stride + px];
  }

  set(x: number, y: number, value: number): void {
    const px = x + this.halo;
    const py = y + this.halo;
    if (px < 0 || py < 0 || px >= this.stride || py >= this.height + 2 * this.halo) return;
    this.data[py * this.stride + px] = value;
  }

  hasData(x: number, y: number): boolean {
    return this.get(x, y) > NODATA + 1;
  }

  /** Bilinear sample at fractional interior coordinates. */
  sample(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const a = this.get(x0, y0);
    const b = this.get(x0 + 1, y0);
    const c = this.get(x0, y0 + 1);
    const d = this.get(x0 + 1, y0 + 1);
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
  }

  /** Copy the 3x3 neighbourhood into `out` in row-major order (z1..z9, NW→SE). */
  window3(x: number, y: number, out: Float32Array): Float32Array {
    let i = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        out[i++] = this.get(x + dx, y + dy);
      }
    }
    return out;
  }

  /** Min/max of the interior, ignoring no-data. */
  range(): { min: number; max: number } {
    let min = Infinity;
    let max = -Infinity;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const v = this.get(x, y);
        if (v <= NODATA + 1) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    return { min: min === Infinity ? 0 : min, max: max === -Infinity ? 0 : max };
  }

  /**
   * Fill no-data cells by iterative neighbour averaging.
   *
   * Void-filling matters more than it sounds: USGS 3DEP bare-earth rasters have
   * holes over water bodies, and an unfilled hole propagates a NaN blast radius
   * through every downstream curvature kernel.
   */
  fillVoids(maxIterations = 8): this {
    const total = this.stride * (this.height + 2 * this.halo);
    for (let iter = 0; iter < maxIterations; iter++) {
      let filled = 0;
      const snapshot = Float32Array.from(this.data);
      for (let i = 0; i < total; i++) {
        if (snapshot[i] > NODATA + 1) continue;
        const px = i % this.stride;
        const py = Math.floor(i / this.stride);
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx;
            const ny = py + dy;
            if (nx < 0 || ny < 0 || nx >= this.stride || ny >= this.height + 2 * this.halo) continue;
            const v = snapshot[ny * this.stride + nx];
            if (v > NODATA + 1) {
              sum += v;
              count++;
            }
          }
        }
        if (count > 0) {
          this.data[i] = sum / count;
          filled++;
        }
      }
      if (filled === 0) break;
    }
    return this;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Stitch a centre tile plus its 8 neighbours into one haloed grid.
 *
 * `neighbours` is keyed `"dx,dy"` with dx/dy in {-1,0,1}; missing neighbours are
 * simply left as no-data and then edge-replicated by `HeightGrid.get`.
 */
export function assembleGrid(
  tile: TileCoord,
  center: Float32Array,
  neighbours: Map<string, Float32Array>,
  tileSize: number,
  halo: number,
): HeightGrid {
  const { lat, lng } = tileCenter(tile);
  const grid = HeightGrid.empty(
    tileSize,
    tileSize,
    halo,
    pixelSizeMeters(tile.z, lat, tileSize),
    lat,
    lng,
  );

  blit(grid, center, tileSize, 0, 0);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const buf = neighbours.get(`${dx},${dy}`);
      if (buf) blit(grid, buf, tileSize, dx * tileSize, dy * tileSize);
    }
  }
  return grid;
}

/** Copy `src` (a tileSize² buffer) into `grid` at interior offset (ox, oy). */
function blit(
  grid: HeightGrid,
  src: Float32Array,
  tileSize: number,
  ox: number,
  oy: number,
): void {
  for (let y = 0; y < tileSize; y++) {
    const ty = oy + y;
    if (ty < -grid.halo || ty >= grid.height + grid.halo) continue;
    for (let x = 0; x < tileSize; x++) {
      const tx = ox + x;
      if (tx < -grid.halo || tx >= grid.width + grid.halo) continue;
      grid.set(tx, ty, src[y * tileSize + x]);
    }
  }
}
