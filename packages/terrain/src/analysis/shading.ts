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

import type { SurfaceField } from './surface.js';

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
 * Sky-view factor approximation — the fraction of the hemisphere visible from
 * each cell, 0..1.
 *
 * Doubles as a **canopy-independent thermal proxy**: low sky-view cells (tight
 * draws, benches under a rim) hold cold air longer in the morning and are where
 * sinking evening thermals pool. Computed by ray-marching horizon angles in 16
 * directions, which is the standard Zakšek/Oštir approach.
 */
export function skyViewFactor(
  heights: (x: number, y: number) => number,
  width: number,
  height: number,
  cellSize: number,
  maxRadiusCells = 24,
  directions = 16,
): Float32Array {
  const out = new Float32Array(width * height);
  const dirs: Array<[number, number]> = [];
  for (let k = 0; k < directions; k++) {
    const a = (k / directions) * Math.PI * 2;
    dirs.push([Math.cos(a), Math.sin(a)]);
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const z0 = heights(x, y);
      if (!Number.isFinite(z0)) {
        out[y * width + x] = NaN;
        continue;
      }
      let acc = 0;
      for (const [dx, dy] of dirs) {
        let maxTan = 0;
        for (let r = 1; r <= maxRadiusCells; r++) {
          const zr = heights(Math.round(x + dx * r), Math.round(y + dy * r));
          if (!Number.isFinite(zr)) continue;
          const tan = (zr - z0) / (r * cellSize);
          if (tan > maxTan) maxTan = tan;
        }
        // Contribution of one sector: sin of the free-horizon zenith angle.
        acc += Math.cos(Math.atan(maxTan));
      }
      out[y * width + x] = acc / dirs.length;
    }
  }
  return out;
}
