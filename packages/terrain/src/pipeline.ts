/**
 * The analysis pipeline — one entry point that turns a haloed DEM grid into
 * every derived field, computing only what was asked for.
 *
 * ## Why lazy, and why it matters here
 *
 * This runs per map tile, inside a render loop, on a phone, sometimes offline
 * with no server to fall back on. A full field bundle (two TPI scales, sky-view
 * factor, shelter ray-marching, daily insolation) is tens of milliseconds per
 * tile; the fields the user actually has switched on are usually two or three of
 * them. `analyze` therefore takes an explicit request set — normally derived
 * from the active layers plus `requiredMetrics()` of the enabled saved filters —
 * and memoises within a single call so shared dependencies (`surface` feeds
 * slope, aspect, hillshade, wind, insolation and the cost surface) are computed
 * once.
 */

import { HeightGrid } from './dem/grid.js';
import {
  computeCurvature,
  computeRuggedness,
  computeSurface,
  type CurvatureField,
  type SurfaceField,
} from './analysis/surface.js';
import {
  classifyWeiss,
  classifyWood,
  computeTpi,
  detectBenches,
  standardize,
  type BenchOptions,
  type WeissOptions,
  type WoodOptions,
} from './analysis/landform.js';
import {
  hillshade,
  multidirectionalHillshade,
  skyViewFactor,
  type HillshadeOptions,
} from './analysis/shading.js';
import { slopeInsolation, solarPosition, type SolarPosition } from './analysis/solar.js';
import {
  beddingLikelihood,
  terrainShelter,
  windExposure,
  type BeddingOptions,
} from './analysis/wind.js';
import type { TerrainFields } from './filters/terrainFilter.js';

export type AnalysisLayer =
  | 'elevation'
  | 'slope'
  | 'aspect'
  | 'hillshade'
  | 'multiHillshade'
  | 'curvatureProfile'
  | 'curvaturePlan'
  | 'tpiSmall'
  | 'tpiLarge'
  | 'ruggedness'
  | 'weiss'
  | 'wood'
  | 'bench'
  | 'insolation'
  | 'skyView'
  | 'windExposure'
  | 'shelter'
  | 'bedding';

export interface AnalysisRequest {
  layers: AnalysisLayer[];
  /** Wind direction (FROM), degrees clockwise from north. */
  windFromDeg?: number;
  /** Moment used for solar layers. Defaults to now. */
  date?: Date;
  /** Overrides the grid's own centre latitude/longitude for solar geometry. */
  latitude?: number;
  longitude?: number;
  hillshade?: HillshadeOptions;
  weiss?: WeissOptions;
  wood?: WoodOptions;
  bench?: BenchOptions;
  bedding?: Omit<BeddingOptions, 'windFromDeg'>;
  /** Radii in cells for the two TPI scales. */
  tpiSmallRadius?: number;
  tpiLargeRadius?: number;
}

export interface AnalysisResult extends TerrainFields {
  surface: SurfaceField;
  curvature?: CurvatureField;
  hillshade?: Float32Array;
  sun?: SolarPosition;
  cellSize: number;
}

/**
 * Run the pipeline. Every field is computed at most once per call regardless of
 * how many requested layers depend on it.
 */
export function analyze(grid: HeightGrid, request: AnalysisRequest): AnalysisResult {
  const want = new Set<string>(request.layers);
  const { width, height, cellSize } = grid;
  const heightAt = (x: number, y: number): number =>
    x < -grid.halo || y < -grid.halo || x >= width + grid.halo || y >= height + grid.halo
      ? NaN
      : grid.get(x, y);

  // `surface` is the root dependency of nearly everything, so it is
  // unconditional — every other branch below reads from it.
  const surface = computeSurface(grid);
  const result: AnalysisResult = { width, height, surface, cellSize };

  if (want.has('elevation')) {
    const elev = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) elev[y * width + x] = grid.get(x, y);
    }
    result.elevation = elev;
  }

  if (want.has('slope')) result.slope = surface.slope;
  if (want.has('aspect')) result.aspect = surface.aspect;

  const needsCurvature =
    want.has('curvatureProfile') ||
    want.has('curvaturePlan') ||
    want.has('wood');
  let curvature: CurvatureField | undefined;
  if (needsCurvature) {
    curvature = computeCurvature(grid);
    result.curvature = curvature;
    if (want.has('curvatureProfile')) result.curvatureProfile = curvature.profile;
    if (want.has('curvaturePlan')) result.curvaturePlan = curvature.plan;
  }

  if (want.has('tpiSmall')) {
    result.tpiSmall = standardize(
      computeTpi(grid, { radius: request.tpiSmallRadius ?? 3 }),
    );
  }
  if (want.has('tpiLarge')) {
    result.tpiLarge = standardize(
      computeTpi(grid, { radius: request.tpiLargeRadius ?? 20 }),
    );
  }

  const needsRuggedness = want.has('ruggedness') || want.has('bedding');
  let ruggedness: Float32Array | undefined;
  if (needsRuggedness) {
    ruggedness = computeRuggedness(grid);
    if (want.has('ruggedness')) result.ruggedness = ruggedness;
  }

  if (want.has('weiss')) result.weiss = classifyWeiss(grid, surface, request.weiss);
  if (want.has('wood') && curvature) {
    // Pass the grid resolution so the classifier's threshold is scale-aware.
    // Without it the same terrain classifies differently at every zoom level.
    result.wood = classifyWood(surface, curvature, {
      cellSize: grid.cellSize,
      ...request.wood,
    });
  }
  if (want.has('bench')) result.bench = detectBenches(grid, surface, request.bench);

  if (want.has('hillshade')) {
    result.hillshade = hillshade(surface, request.hillshade);
  } else if (want.has('multiHillshade')) {
    result.hillshade = multidirectionalHillshade(surface, request.hillshade);
  }

  if (want.has('insolation')) {
    const lat = request.latitude ?? grid.centerLat;
    const lng = request.longitude ?? grid.centerLng;
    const sun = solarPosition(request.date ?? new Date(), lat, lng);
    result.sun = sun;
    result.insolation = slopeInsolation(surface, sun);
  }

  if (want.has('skyView')) {
    result.skyView = skyViewFactor(heightAt, width, height, cellSize);
  }

  const windFrom = request.windFromDeg;
  const needsShelter = want.has('shelter') || want.has('bedding');
  let shelter: Float32Array | undefined;
  if (needsShelter && windFrom !== undefined) {
    shelter = terrainShelter(heightAt, width, height, cellSize, windFrom);
    if (want.has('shelter')) result.shelter = shelter;
  }

  if (want.has('windExposure') && windFrom !== undefined) {
    result.windExposure = windExposure(surface, windFrom);
  }

  if (want.has('bedding') && windFrom !== undefined) {
    result.bedding = beddingLikelihood(surface, {
      windFromDeg: windFrom,
      shelter,
      ruggedness,
      ...request.bedding,
    });
  }

  return result;
}

/**
 * Halo thickness a request needs, in cells.
 *
 * Undersizing this is the seam bug described in `grid.ts`; oversizing it means
 * fetching neighbour tiles nobody needed. The caller uses this to decide how
 * many neighbouring DEM tiles to fetch *before* doing any work, which is the
 * only ordering that lets the fetch and the compute overlap.
 */
export function requiredHalo(request: AnalysisRequest): number {
  let halo = 1; // Every 3x3 kernel needs at least one.
  const want = new Set<string>(request.layers);
  if (want.has('tpiSmall') || want.has('weiss')) {
    halo = Math.max(halo, request.tpiSmallRadius ?? 3, request.weiss?.smallRadius ?? 3);
  }
  if (want.has('tpiLarge') || want.has('weiss')) {
    halo = Math.max(halo, request.tpiLargeRadius ?? 20, request.weiss?.largeRadius ?? 20);
  }
  if (want.has('bench')) halo = Math.max(halo, (request.bench?.ringRadius ?? 8) + 1);
  if (want.has('skyView')) halo = Math.max(halo, 24);
  if (want.has('shelter') || want.has('bedding')) halo = Math.max(halo, 20);
  return halo;
}
