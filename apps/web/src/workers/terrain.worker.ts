/// <reference lib="webworker" />
/**
 * Client-side terrain analysis worker.
 *
 * ## Why the analysis runs on the device at all
 *
 * The API can render every one of these layers, and does. But the two
 * headline features of this product — *interactive* filter editing and *fully
 * offline* operation — both break if the layers only exist server-side:
 *
 *  - Dragging a slope slider from 12° to 14° should repaint immediately. A
 *    round trip per frame does not.
 *  - A hunter a mile from the truck with no signal must still be able to switch
 *    on "leeward benches" for today's wind. That only works if the analysis is
 *    computed from cached *elevation* tiles rather than pre-baked *rendered*
 *    tiles — otherwise every wind direction and every date would have to have
 *    been downloaded in advance, which is combinatorially impossible.
 *
 * Caching the DEM and computing derived layers on demand is what turns "the
 * layers I remembered to download" into "every layer, any wind, any date, no
 * signal". That is the whole architecture in one sentence.
 *
 * The engine here is the *same* `@hunt-maps/terrain` package the API imports,
 * so a filter cannot mean one thing on the server and another in the woods.
 */

import {
  analyze,
  ASPECT_RAMP,
  assembleGrid,
  compositeOver,
  decodeRgbaToHeights,
  evaluateFilter,
  HEAT_RAMP,
  renderCategorical,
  renderHillshade,
  renderMask,
  renderRamp,
  requiredHalo,
  requiredMetrics,
  SLOPE_RAMP,
  SUN_RAMP,
  WEISS_COLORS,
  WOOD_COLORS,
  type AnalysisLayer,
  type AnalysisRequest,
  type DemEncoding,
  type TerrainPredicate,
} from '@hunt-maps/terrain';
import { mapColor, BEDDING_RAMP_DOMAIN_MAX, stretchToUnit } from '@hunt-maps/design';

export interface RenderTileMessage {
  id: number;
  type: 'render';
  tile: { z: number; x: number; y: number };
  /** Centre tile RGBA, then the eight neighbours keyed "dx,dy". */
  center: ArrayBuffer;
  neighbours: Array<{ dx: number; dy: number; data: ArrayBuffer }>;
  tileSize: number;
  encoding: DemEncoding;
  layer: AnalysisLayer | 'filters';
  filters?: Array<{
    predicate: TerrainPredicate;
    color: string;
    opacity: number;
    outline?: boolean;
  }>;
  windFromDeg?: number;
  atUtcMs?: number;
}

export type WorkerRequest = RenderTileMessage;

export interface RenderTileResult {
  id: number;
  ok: true;
  /** RGBA bytes, transferred rather than copied. */
  rgba: ArrayBuffer;
  width: number;
  height: number;
  elapsedMs: number;
}

export interface WorkerError {
  id: number;
  ok: false;
  error: string;
}

export type WorkerResponse = RenderTileResult | WorkerError;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  const started = performance.now();
  try {
    const rgba = renderTile(msg);
    const response: RenderTileResult = {
      id: msg.id,
      ok: true,
      rgba: rgba.buffer as ArrayBuffer,
      width: msg.tileSize,
      height: msg.tileSize,
      elapsedMs: performance.now() - started,
    };
    // Transfer the pixel buffer instead of structured-cloning it. At 256² RGBA
    // that is 256 KB per tile; copying it would dominate the frame budget on a
    // pan across a dozen tiles.
    ctx.postMessage(response, [response.rgba]);
  } catch (err) {
    const response: WorkerError = {
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(response);
  }
};

function renderTile(msg: RenderTileMessage): Uint8ClampedArray {
  const { tileSize, encoding } = msg;

  const neighbours = new Map<string, Float32Array>();
  for (const n of msg.neighbours) {
    neighbours.set(`${n.dx},${n.dy}`, decodeRgbaToHeights(new Uint8Array(n.data), encoding));
  }

  const layers: AnalysisLayer[] =
    msg.layer === 'filters'
      ? ([
          ...new Set(
            (msg.filters ?? []).flatMap((f) => [...requiredMetrics(f.predicate)]),
          ),
        ] as AnalysisLayer[])
      : [msg.layer];

  const request: AnalysisRequest = {
    layers,
    windFromDeg: msg.windFromDeg,
    date: msg.atUtcMs !== undefined ? new Date(msg.atUtcMs) : undefined,
  };

  const grid = assembleGrid(
    msg.tile,
    decodeRgbaToHeights(new Uint8Array(msg.center), encoding),
    neighbours,
    tileSize,
    // Clamp the halo to the tile size: a large-TPI radius can exceed one tile,
    // and reading past the single ring of neighbours we were given would
    // silently produce edge-replicated garbage rather than a visible failure.
    Math.min(requiredHalo(request), tileSize),
  );
  grid.fillVoids();

  const result = analyze(grid, request);
  const n = tileSize * tileSize;

  if (msg.layer === 'filters') {
    const out = new Uint8ClampedArray(n * 4);
    for (const f of msg.filters ?? []) {
      const mask = evaluateFilter(f.predicate, {
        ...result,
        width: tileSize,
        height: tileSize,
      });
      compositeOver(
        out,
        renderMask(mask, tileSize, tileSize, f.color, f.opacity, f.outline ?? true),
      );
    }
    return out;
  }

  switch (msg.layer) {
    case 'slope':
      return renderRamp(result.slope ?? new Float32Array(n), SLOPE_RAMP);
    case 'aspect':
      return renderRamp(result.aspect ?? new Float32Array(n), ASPECT_RAMP);
    case 'insolation':
      return renderRamp(result.insolation ?? new Float32Array(n), SUN_RAMP);
    case 'bedding':
      // `beddingLikelihood` is a product of five imperfect terms and rarely
      // gets near 1.0 on real terrain — feeding it straight into a ramp built
      // for [0, 1] paints nothing (BACKLOG R32). Rescale into the ramp's
      // domain first; see `BEDDING_RAMP_DOMAIN_MAX` for why that domain is a
      // fixed, documented figure rather than a per-tile stretch.
      return renderRamp(
        stretchFieldToUnit(result.bedding ?? new Float32Array(n), BEDDING_RAMP_DOMAIN_MAX),
        HEAT_RAMP,
      );
    case 'weiss':
      return renderCategorical(result.weiss ?? new Uint8Array(n), WEISS_COLORS);
    case 'wood':
      return renderCategorical(result.wood ?? new Uint8Array(n), WOOD_COLORS);
    case 'bench':
      return renderMask(
        result.bench ?? new Uint8Array(n),
        tileSize,
        tileSize,
        mapColor['feature-bench'],
        0.55,
        true,
      );
    case 'hillshade':
    case 'multiHillshade':
      return renderHillshade(result.hillshade ?? new Float32Array(n), 1);
    default:
      return new Uint8ClampedArray(n * 4);
  }
}

/**
 * Rescale a whole field through `stretchToUnit` before it hits a ramp built
 * for `[0, 1]`. Kept local to the render path rather than exported: the
 * per-value transform lives in `@hunt-maps/design` (the visual decision),
 * this loop is just applying it to a tile's worth of cells.
 */
function stretchFieldToUnit(field: Float32Array, domainMax: number): Float32Array {
  const out = new Float32Array(field.length);
  for (let i = 0; i < field.length; i++) {
    out[i] = stretchToUnit(field[i], domainMax);
  }
  return out;
}

export {};
