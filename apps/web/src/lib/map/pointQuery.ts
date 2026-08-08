/**
 * On-device terrain readout for a single tapped point (BACKLOG R6).
 *
 * This is the same pipeline `terrain.worker.ts` runs per rendered tile —
 * `assembleGrid` → `fillVoids` → `analyze` — run once for the single pixel a
 * hunter tapped, rather than for a whole 256x256 tile. Reusing the identical
 * pipeline (not a cheaper per-point approximation) matters for one concrete
 * reason: a hunter who taps a pixel the bedding layer painted bright must read
 * back the exact number that pixel means, not a slightly different one from a
 * second code path that happened to compute slope differently at an edge.
 *
 * ## The correctness property this file exists to protect
 *
 * Several engine operators legitimately cannot answer at a given cell — a DEM
 * void, a lake, a neighbour tile that never arrived — and encode that by
 * returning `NaN` (or, for `weiss`/`wood`, a dedicated `Unknown` class) rather
 * than a fabricated number. `SurfaceField.aspect` additionally overloads `-1`
 * to mean *either* "flat" *or* "unmeasured" — `slope`, not `aspect`, is the
 * field that tells the two apart (see `analysis/surface.ts`). Every extractor
 * below is written to preserve that distinction all the way to the UI: a
 * `Reading` is tagged `'value' | 'flat' | 'unmeasured'` specifically so
 * `TerrainReadout.tsx` never has a code path that turns "could not measure"
 * into a number, a dash, or a silent default.
 *
 * `elevation` is the one field that needed its own check rather than
 * `Number.isFinite`, and a QA harness run against a real browser (not a DOM
 * assertion) is what caught it: a cell that stays void through `fillVoids`
 * keeps the raw `NODATA` sentinel (`-32768`), which *is* finite, so a bare
 * `Number.isFinite` read it as "33 km below sea level" and rendered
 * "-107507 ft" instead of "not measured here" — precisely the failure mode
 * `isElevation`'s own doc comment warns about. Use `isElevation`, never
 * `Number.isFinite`, for anything that touches raw elevation.
 */

import {
  analyze,
  assembleGrid,
  isElevation,
  lngLatToTile,
  requiredHalo,
  WeissLandform,
  WEISS_LABELS,
  WoodFeature,
  WOOD_LABELS,
  type AnalysisRequest,
  type AnalysisResult,
  type TileCoord,
} from '@hunt-maps/terrain';
import { BEDDING_RAMP_DOMAIN_MAX, stretchToUnit } from '@hunt-maps/design';
import { DEM_MAX_ZOOM, DEM_TILE_SIZE } from './demTiles';

/**
 * One measured or modelled value, tagged with *why* it might not be a number.
 *
 *  - `'value'` — measured (or modelled) successfully.
 *  - `'flat'` — **aspect only.** A real, measured finding: the ground here has
 *    no downslope direction. Distinct from `'unmeasured'` on purpose — a flat
 *    bench is not a data gap, and rendering it as one would make "unmeasured"
 *    mean nothing.
 *  - `'unmeasured'` — the engine looked and could not answer at this cell.
 *    Must never render as a number, a dash, or any value that could be read as
 *    zero.
 */
export type Reading<T> = { kind: 'value'; value: T } | { kind: 'flat' } | { kind: 'unmeasured' };

export interface AspectReading {
  deg: number;
  octant: string;
}

export interface TerrainReadoutFacts {
  /** Ground elevation, feet. Published USGS/LiDAR geometry — no evidence grade. */
  elevationFt: Reading<number>;
  /** Horn slope, degrees. Published geometry — no evidence grade. */
  slopeDeg: Reading<number>;
  /** Downslope compass direction. Published geometry — no evidence grade. */
  aspect: Reading<AspectReading>;
  /**
   * Weiss (1996) 10-class landform position, composed with `detectBenches`
   * when the tapped cell is a detected bench. Both are published, deterministic
   * geometry operators validated against closed-form analytic surfaces — see
   * `docs/design/direction-a-instrument.html`'s readout plate: "the
   * classification is published, not modelled." No evidence grade.
   */
  landform: Reading<string>;
  /** Wood morphometric feature — saddle, ridge, channel, peak, pit, planar. Published geometry — no evidence grade. */
  morphometry: Reading<string>;
}

export interface TerrainReadoutJudgement {
  /**
   * Whether a wind direction is set at all. Bedding is never computed without
   * one — `false` here means "not modelled yet", a different state from
   * `beddingPercent` reading `'unmeasured'` (modelled, but this exact cell
   * could not be answered).
   */
  windSet: boolean;
  /**
   * `beddingLikelihood`, rescaled 0–100 through the same domain the rendered
   * ramp uses (`BEDDING_RAMP_DOMAIN_MAX`), so the number in this panel never
   * disagrees with the colour painted on the map for the same pixel. Modelled,
   * not measured — carries an evidence grade in the UI (`docs/EVIDENCE.md`,
   * 🔴 Assumed).
   */
  beddingPercent: Reading<number>;
}

export interface TerrainReadout {
  lng: number;
  lat: number;
  facts: TerrainReadoutFacts;
  judgement: TerrainReadoutJudgement;
}

export type TerrainReadoutOutcome =
  | { kind: 'ok'; readout: TerrainReadout }
  /** No DEM tile at all for this ground — never downloaded, and no signal to fetch it now. */
  | { kind: 'no-data' }
  | { kind: 'error'; message: string };

/**
 * Loads one DEM tile's decoded heights, offline cache first.
 *
 * Resolves `null` for a tile that is genuinely unavailable (never downloaded,
 * 404, no signal) — that is a normal, expected outcome the caller turns into
 * `'no-data'` or tolerates as a missing neighbour, never a thrown error.
 * Rejects only on `signal` abort, so a superseded query (the user tapped
 * somewhere else before this one resolved) can be told apart from a real
 * failure. Implemented in `demHeightLoader.ts` for production use; tests
 * supply a synthetic one so this whole file can be exercised without a DOM,
 * a canvas, or a PNG.
 */
export type HeightTileLoader = (
  tile: TileCoord,
  signal?: AbortSignal,
) => Promise<Float32Array | null>;

const NEIGHBOUR_OFFSETS: Array<[number, number]> = [];
for (let dy = -1; dy <= 1; dy++) {
  for (let dx = -1; dx <= 1; dx++) {
    if (dx !== 0 || dy !== 0) NEIGHBOUR_OFFSETS.push([dx, dy]);
  }
}

export interface QueryTerrainPointOptions {
  windFromDeg: number | null;
  atUtc?: Date;
  /**
   * DEM tile zoom to query at. Defaults to `DEM_MAX_ZOOM` — the finest
   * resolution ever cached — rather than the zoom the map happens to be
   * sitting at, so the readout gives the sharpest honest answer regardless of
   * how far out the user is currently zoomed.
   */
  zoom?: number;
}

/**
 * Sample every readout field at one tapped point.
 *
 * Fetches the DEM tile under the point plus its eight neighbours (the same
 * halo `TerrainProtocol` fetches per rendered tile), assembles a `HeightGrid`,
 * fills small voids exactly as the render path does, runs the shared analysis
 * pipeline, and reads back the single cell the point landed on.
 */
export async function queryTerrainPoint(
  lngLat: { lng: number; lat: number },
  loadHeights: HeightTileLoader,
  options: QueryTerrainPointOptions,
  signal?: AbortSignal,
): Promise<TerrainReadoutOutcome> {
  const zoom = Math.max(0, Math.round(options.zoom ?? DEM_MAX_ZOOM));
  const tileSize = DEM_TILE_SIZE;
  const frac = lngLatToTile(lngLat.lng, lngLat.lat, zoom);
  const tileX = Math.floor(frac.x);
  const tileY = Math.floor(frac.y);
  const px = clampPixel(Math.floor((frac.x - tileX) * tileSize), tileSize);
  const py = clampPixel(Math.floor((frac.y - tileY) * tileSize), tileSize);
  const tile: TileCoord = { z: zoom, x: tileX, y: tileY };

  let loaded: Array<Float32Array | null>;
  try {
    loaded = await Promise.all([
      loadHeights(tile, signal),
      ...NEIGHBOUR_OFFSETS.map(([dx, dy]) =>
        loadHeights({ z: zoom, x: tileX + dx, y: tileY + dy }, signal).catch(() => null),
      ),
    ]);
  } catch (err) {
    if (signal?.aborted) throw err;
    return { kind: 'error', message: describeError(err) };
  }

  const [center, ...neighbourHeights] = loaded;
  if (!center) return { kind: 'no-data' };

  const neighbours = new Map<string, Float32Array>();
  neighbourHeights.forEach((heights, i) => {
    if (heights) neighbours.set(`${NEIGHBOUR_OFFSETS[i][0]},${NEIGHBOUR_OFFSETS[i][1]}`, heights);
  });

  const windFromDeg = options.windFromDeg ?? undefined;
  const request: AnalysisRequest = {
    layers: [
      'elevation',
      'slope',
      'aspect',
      'weiss',
      'wood',
      'bench',
      ...(windFromDeg !== undefined ? (['bedding'] as const) : []),
    ],
    windFromDeg,
    date: options.atUtc,
  };

  // Clamped exactly like `terrain.worker.ts`'s render path: a 3x3 tile fetch
  // cannot supply more halo than one tile, so anything past that is a
  // configuration bug, not a per-query failure to surface to the user.
  const halo = Math.min(requiredHalo(request), tileSize);

  try {
    const grid = assembleGrid(tile, center, neighbours, tileSize, halo);
    grid.fillVoids();
    const result = analyze(grid, request);
    const index = py * tileSize + px;
    return {
      kind: 'ok',
      readout: {
        lng: lngLat.lng,
        lat: lngLat.lat,
        facts: extractFacts(result, index),
        judgement: extractJudgement(result, index, windFromDeg !== undefined),
      },
    };
  } catch (err) {
    return { kind: 'error', message: describeError(err) };
  }
}

const METERS_TO_FEET = 3.28084;

/** Pure extraction — every `AnalysisResult` field for one cell, tagged per `Reading`. Exported for direct testing against synthetic surfaces. */
export function extractFacts(result: AnalysisResult, index: number): TerrainReadoutFacts {
  const elevM = result.elevation?.[index];
  // `isElevation`, not `isFinite` — see the module doc comment. The `NODATA`
  // sentinel a voided cell keeps after `fillVoids` is a perfectly finite
  // JavaScript number.
  const elevationFt: Reading<number> =
    elevM !== undefined && isElevation(elevM)
      ? { kind: 'value', value: Math.round(elevM * METERS_TO_FEET) }
      : { kind: 'unmeasured' };

  const slopeVal = result.slope?.[index];
  const slopeDeg: Reading<number> = isFinite(slopeVal)
    ? { kind: 'value', value: Math.round(slopeVal) }
    : { kind: 'unmeasured' };

  // `SurfaceField.aspect` is `-1` for *both* "flat" and "unmeasured" by
  // design (see `analysis/surface.ts`) — `slope` is the field that
  // disambiguates, so it must be checked first here, never `aspect` alone.
  let aspect: Reading<AspectReading>;
  if (slopeDeg.kind === 'unmeasured') {
    aspect = { kind: 'unmeasured' };
  } else {
    const aspectVal = result.aspect?.[index] ?? -1;
    aspect =
      aspectVal < 0
        ? { kind: 'flat' }
        : { kind: 'value', value: { deg: Math.round(aspectVal), octant: octant(aspectVal) } };
  }

  const weissClass = result.weiss?.[index] as WeissLandform | undefined;
  const isBench = result.bench?.[index] === 1;
  const landform: Reading<string> =
    weissClass === undefined || weissClass === WeissLandform.Unknown
      ? { kind: 'unmeasured' }
      : {
          kind: 'value',
          value: isBench ? `${WEISS_LABELS[weissClass]} — bench` : WEISS_LABELS[weissClass],
        };

  const woodClass = result.wood?.[index] as WoodFeature | undefined;
  const morphometry: Reading<string> =
    woodClass === undefined || woodClass === WoodFeature.Unknown
      ? { kind: 'unmeasured' }
      : { kind: 'value', value: WOOD_LABELS[woodClass] };

  return { elevationFt, slopeDeg, aspect, landform, morphometry };
}

/** Pure extraction of the one modelled field. Exported for direct testing. */
export function extractJudgement(
  result: AnalysisResult,
  index: number,
  windSet: boolean,
): TerrainReadoutJudgement {
  if (!windSet) return { windSet: false, beddingPercent: { kind: 'unmeasured' } };
  const raw = result.bedding?.[index];
  if (!isFinite(raw)) return { windSet: true, beddingPercent: { kind: 'unmeasured' } };
  const pct = Math.round(stretchToUnit(raw, BEDDING_RAMP_DOMAIN_MAX) * 100);
  return { windSet: true, beddingPercent: { kind: 'value', value: pct } };
}

function isFinite(v: number | undefined): v is number {
  return v !== undefined && Number.isFinite(v);
}

function octant(deg: number): string {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

function clampPixel(v: number, size: number): number {
  return Math.min(size - 1, Math.max(0, v));
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
