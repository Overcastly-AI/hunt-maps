/**
 * Relief shading.
 *
 * We compute hillshade from the surface **normal** rather than the ESRI
 * trigonometric identity. Same result, but the vector form degrades gracefully
 * on flat cells (where aspect is undefined and the trig form produces a seam of
 * NaN) and makes the multi-directional variant trivial.
 *
 * Multi-directional shading matters here more than in general cartography:
 * single-azimuth hillshade suffers from *terrain inversion*, where ridges read
 * as gullies depending on which way the reader's brain resolves the lighting.
 * On a map whose entire job is telling a ridge from a draw, that is a
 * correctness bug, not an aesthetic one.
 */

import { isElevation } from '../dem/encoding.js';
import { emptyRingScan, scanHorizonRing } from './horizon.js';
import type { SurfaceField } from './surface.js';

/**
 * Module-local alias, deliberately — see the note in `horizon.ts`. Under the
 * CommonJS build a cross-module call is a property load V8 will not inline.
 * This one is cheap (once per cell, not once per sample) but is kept for the
 * same reason and consistency.
 */
const isElev = isElevation;

export interface HillshadeOptions {
  /** Light azimuth, degrees clockwise from north. Default 315 (NW). */
  azimuthDeg?: number;
  /** Light altitude above the horizon, degrees. Default 45. */
  altitudeDeg?: number;
  /** Vertical exaggeration applied to the gradient. Default 1. */
  zFactor?: number;
}

/** Single-azimuth hillshade, 0..1. */
export function hillshade(surface: SurfaceField, options: HillshadeOptions = {}): Float32Array {
  const az = ((options.azimuthDeg ?? 315) * Math.PI) / 180;
  const alt = ((options.altitudeDeg ?? 45) * Math.PI) / 180;
  const z = options.zFactor ?? 1;

  // Light direction in (east, north, up).
  const lx = Math.sin(az) * Math.cos(alt);
  const ly = Math.cos(az) * Math.cos(alt);
  const lz = Math.sin(alt);

  const n = surface.slope.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const dzdx = surface.dzdx[i] * z;
    const dzdy = surface.dzdy[i] * z;
    if (!Number.isFinite(dzdx)) {
      out[i] = NaN;
      continue;
    }
    // Normal = (-dz/dEast, -dz/dNorth, 1); dz/dNorth = -dzdy.
    const nx = -dzdx;
    const ny = dzdy;
    const nz = 1;
    const len = Math.sqrt(nx * nx + ny * ny + 1);
    out[i] = Math.max(0, (nx * lx + ny * ly + nz * lz) / len);
  }
  return out;
}

/**
 * Multi-directional hillshade (four weighted azimuths, after the USGS/Swiss
 * style). Reads far better on LiDAR-derived micro-relief — old logging grades,
 * benches, and hand-dug ditches show up that a single azimuth flattens out.
 */
export function multidirectionalHillshade(
  surface: SurfaceField,
  options: HillshadeOptions = {},
): Float32Array {
  const alt = options.altitudeDeg ?? 45;
  const z = options.zFactor ?? 1;
  const azimuths = [225, 270, 315, 360];
  const weights = [0.2, 0.25, 0.35, 0.2];

  const n = surface.slope.length;
  const out = new Float32Array(n);
  for (let k = 0; k < azimuths.length; k++) {
    const layer = hillshade(surface, { azimuthDeg: azimuths[k], altitudeDeg: alt, zFactor: z });
    const w = weights[k];
    for (let i = 0; i < n; i++) out[i] += layer[i] * w;
  }
  return out;
}

/**
 * Ray-march radius for `skyViewFactor`, in cells.
 *
 * Exported so `requiredHalo()` sizes the halo from the *same* number the
 * operator marches with. They used to be two independent literals, which is a
 * standing invitation to the seam-grid bug in `grid.ts`: raise one, forget the
 * other, and every tile edge grows a visible line.
 */
export const DEFAULT_SKY_VIEW_RADIUS_CELLS = 24;

/**
 * Sky-view factor approximation — a relief-openness index in 0..1, `NaN` where
 * the terrain needed to answer is not in the grid.
 *
 * Doubles as a **canopy-independent thermal proxy**: low sky-view cells (tight
 * draws, benches under a rim) hold cold air longer in the morning and are where
 * sinking evening thermals pool. Computed by ray-marching horizon angles in 16
 * directions, which is the standard Zakšek/Oštir approach.
 *
 * **Convention caveat, filed as `R30`'s neighbour `R29`:** this accumulates
 * `mean(cos h)` over the bearings, which is neither of the two standard
 * definitions (geometric `mean(1 − sin h)`, radiative `mean(cos² h)`). All
 * three agree at h=0° and h=90°; in between this one reads more open. It is
 * being treated as a monotone relief index pending a decision — do **not**
 * "correct" the formula here without reading `R29` first.
 *
 * ## Missing data
 *
 * Unlike shelter and shadow, sky-view has no ceiling: every extra metre of
 * horizon lowers it, so terrain hiding in a gap can always change the answer.
 * A single unreadable cell on any of the 16 bearings therefore makes the cell
 * `NaN` rather than the open-sky 1.0 it used to report. See `horizon.ts`.
 */
export function skyViewFactor(
  heights: (x: number, y: number) => number,
  width: number,
  height: number,
  cellSize: number,
  maxRadiusCells = DEFAULT_SKY_VIEW_RADIUS_CELLS,
  directions = 16,
): Float32Array {
  const out = new Float32Array(width * height);
  const dirs: Array<[number, number]> = [];
  for (let k = 0; k < directions; k++) {
    const a = (k / directions) * Math.PI * 2;
    dirs.push([Math.cos(a), Math.sin(a)]);
  }
  const ring = emptyRingScan(directions);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const z0 = heights(x, y);
      if (!isElev(z0)) {
        out[y * width + x] = NaN;
        continue;
      }
      scanHorizonRing(heights, x, y, dirs, z0, cellSize, maxRadiusCells, ring);
      if (ring.incomplete) {
        // A gap on any bearing: this quantity has no ceiling, so terrain hiding
        // in it can always change the answer. Say so instead of returning the
        // open-sky 1.0 the old code did.
        out[y * width + x] = NaN;
        continue;
      }
      let acc = 0;
      // Contribution of one sector: sin of the free-horizon zenith angle.
      for (let k = 0; k < directions; k++) acc += Math.cos(Math.atan(ring.maxTan[k]));
      out[y * width + x] = acc / directions;
    }
  }
  return out;
}
