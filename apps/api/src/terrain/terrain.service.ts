import { Injectable } from '@nestjs/common';
import { PNG } from 'pngjs';
import {
  analyze,
  ASPECT_RAMP,
  compositeOver,
  evaluateFilter,
  HEAT_RAMP,
  matchFraction,
  renderCategorical,
  renderHillshade,
  renderMask,
  renderRamp,
  requiredHalo,
  requiredMetrics,
  SLOPE_RAMP,
  SUN_RAMP,
  validatePredicate,
  WEISS_COLORS,
  WOOD_COLORS,
  type AnalysisLayer,
  type AnalysisRequest,
  type TerrainPredicate,
  type TileCoord,
} from '@hunt-maps/terrain';
import { DemService, type DemSource } from './dem.service';

export interface TileRenderRequest {
  tile: TileCoord;
  layer: AnalysisLayer | 'filter';
  source: DemSource;
  windFromDeg?: number;
  date?: Date;
  /** Only for `layer: 'filter'`. */
  predicate?: TerrainPredicate;
  color?: string;
  opacity?: number;
  outline?: boolean;
}

@Injectable()
export class TerrainService {
  constructor(private readonly dem: DemService) {}

  /**
   * Render one analysis tile as a PNG.
   *
   * ## Why the server renders these at all
   *
   * The web client computes these same layers locally — same engine, same code
   * path — and that is the primary route, because it keeps the interaction
   * instant and works with no signal. The server-side renderer exists for three
   * cases the client cannot cover:
   *
   *  1. **Baking offline packages.** A region download needs finished raster
   *     tiles; making the phone compute and store them costs battery in the one
   *     place battery matters most.
   *  2. **Sharing.** A filter shared to someone without the app, or embedded in
   *     a printed map, needs a server-rendered image.
   *  3. **Low-end devices.** A five-year-old phone should still get the layer,
   *     just over the network.
   *
   * The engine is shared precisely so these two paths cannot drift.
   */
  async renderTile(request: TileRenderRequest): Promise<Buffer> {
    const { tile, source } = request;
    const layers = this.layersFor(request);
    const analysisRequest: AnalysisRequest = {
      layers,
      windFromDeg: request.windFromDeg,
      date: request.date,
    };

    const grid = await this.dem.gridForTile(tile, source, requiredHalo(analysisRequest));
    const result = analyze(grid, analysisRequest);
    const size = source.tileSize;
    const n = size * size;

    let rgba: Uint8ClampedArray;

    if (request.layer === 'filter') {
      const predicate = request.predicate;
      if (!predicate) throw new Error('A filter tile needs a predicate.');
      const mask = evaluateFilter(predicate, { ...result, width: size, height: size });
      rgba = renderMask(
        mask,
        size,
        size,
        request.color ?? '#e8a33d',
        request.opacity ?? 0.5,
        request.outline ?? true,
      );
    } else {
      rgba = this.renderLayer(request.layer, result, n);
    }

    return this.toPng(rgba, size, size);
  }

  /** Composite several filters into one tile, so N saved filters cost one request. */
  async renderFilterStack(
    tile: TileCoord,
    source: DemSource,
    filters: Array<{
      predicate: TerrainPredicate;
      color: string;
      opacity: number;
      outline?: boolean;
    }>,
    windFromDeg?: number,
    date?: Date,
  ): Promise<Buffer> {
    const metrics = new Set<string>();
    for (const f of filters) for (const m of requiredMetrics(f.predicate)) metrics.add(m);

    const analysisRequest: AnalysisRequest = {
      layers: [...metrics] as AnalysisLayer[],
      windFromDeg,
      date,
    };
    const grid = await this.dem.gridForTile(tile, source, requiredHalo(analysisRequest));
    const result = analyze(grid, analysisRequest);
    const size = source.tileSize;

    const out = new Uint8ClampedArray(size * size * 4);
    for (const f of filters) {
      const mask = evaluateFilter(f.predicate, { ...result, width: size, height: size });
      const layer = renderMask(mask, size, size, f.color, f.opacity, f.outline ?? true);
      compositeOver(out, layer);
    }
    return this.toPng(out, size, size);
  }

  /**
   * Evaluate a predicate over an area and report how much of it matches.
   *
   * The share is the number that makes a saved filter actionable: "leeward
   * benches" covering 2% of a property is a shortlist worth walking; the same
   * filter covering 40% has not narrowed anything and the user should tighten
   * it. Surfacing that stops filters from silently becoming decoration.
   */
  async evaluateArea(
    bbox: { west: number; south: number; east: number; north: number },
    zoom: number,
    source: DemSource,
    predicate: TerrainPredicate,
    windFromDeg?: number,
    date?: Date,
  ): Promise<{ matchShare: number; cellCount: number; cellSizeM: number }> {
    if (!validatePredicate(predicate)) {
      throw new Error('Predicate failed validation.');
    }
    const layers = [...requiredMetrics(predicate)] as AnalysisLayer[];
    const request: AnalysisRequest = { layers, windFromDeg, date };
    const { grid } = await this.dem.gridForBBox(bbox, zoom, source, requiredHalo(request));
    const result = analyze(grid, request);
    const mask = evaluateFilter(predicate, {
      ...result,
      width: grid.width,
      height: grid.height,
    });
    return {
      matchShare: matchFraction(mask),
      cellCount: mask.length,
      cellSizeM: grid.cellSize,
    };
  }

  /**
   * Point query — everything the engine knows about one spot.
   *
   * Powers the map's long-press readout. Deliberately returns the *interpreted*
   * values (landform name, aspect octant) alongside the raw numbers, because
   * "SE, 22°, midslope bench" is what a hunter reasons with and "aspect 137.4"
   * is not.
   */
  async samplePoint(
    lng: number,
    lat: number,
    zoom: number,
    source: DemSource,
    windFromDeg?: number,
    date?: Date,
  ) {
    const pad = 0.004; // ~450 m, enough for the large-TPI neighbourhood
    const bbox = { west: lng - pad, east: lng + pad, south: lat - pad, north: lat + pad };
    const layers: AnalysisLayer[] = [
      'elevation',
      'slope',
      'aspect',
      'weiss',
      'wood',
      'bench',
      'ruggedness',
      'insolation',
      ...(windFromDeg !== undefined ? (['windExposure', 'shelter'] as AnalysisLayer[]) : []),
    ];
    const request: AnalysisRequest = { layers, windFromDeg, date, latitude: lat, longitude: lng };
    const { grid, originTile } = await this.dem.gridForBBox(
      bbox,
      zoom,
      source,
      requiredHalo(request),
    );
    const result = analyze(grid, request);
    const p = this.dem.pixelInMosaic(lng, lat, originTile, source.tileSize);
    const i = Math.min(grid.width * grid.height - 1, Math.max(0, p.y * grid.width + p.x));

    return {
      elevationM: result.elevation?.[i],
      slopeDeg: result.slope?.[i],
      aspectDeg: result.aspect?.[i],
      landform: result.weiss?.[i],
      morphometry: result.wood?.[i],
      isBench: result.bench?.[i] === 1,
      ruggedness: result.ruggedness?.[i],
      insolation: result.insolation?.[i],
      windExposure: result.windExposure?.[i],
      shelter: result.shelter?.[i],
      cellSizeM: grid.cellSize,
      demSource: source.id,
    };
  }

  private layersFor(request: TileRenderRequest): AnalysisLayer[] {
    if (request.layer === 'filter') {
      return request.predicate ? ([...requiredMetrics(request.predicate)] as AnalysisLayer[]) : [];
    }
    return [request.layer];
  }

  private renderLayer(
    layer: AnalysisLayer,
    result: ReturnType<typeof analyze>,
    n: number,
  ): Uint8ClampedArray {
    switch (layer) {
      case 'slope':
        return renderRamp(result.slope ?? new Float32Array(n), SLOPE_RAMP);
      case 'aspect':
        return renderRamp(result.aspect ?? new Float32Array(n), ASPECT_RAMP);
      case 'insolation':
        return renderRamp(result.insolation ?? new Float32Array(n), SUN_RAMP);
      case 'bedding':
        return renderBeddingLayer(result.bedding, n);
      case 'weiss':
        return renderCategorical(result.weiss ?? new Uint8Array(n), WEISS_COLORS);
      case 'wood':
        return renderCategorical(result.wood ?? new Uint8Array(n), WOOD_COLORS);
      case 'bench':
        return renderMask(
          result.bench ?? new Uint8Array(n),
          result.width,
          result.height,
          '#e8a33d',
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

  private toPng(rgba: Uint8ClampedArray, width: number, height: number): Buffer {
    const png = new PNG({ width, height });
    png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    return PNG.sync.write(png);
  }
}

/**
 * Render the bedding layer.
 *
 * ## Absent field vs. measured zero
 *
 * `result.bedding` is only populated when the caller supplies a wind
 * direction — `beddingLikelihood` needs one to score leeward shelter (see
 * `packages/terrain/src/pipeline.ts`). `GET /terrain/tiles/bedding/:z/:x/:y.png`
 * makes `?wind=` optional, so a client can legally request the bedding layer
 * with none supplied, and `result.bedding` comes back `undefined`.
 *
 * Falling back to a zero-filled field there used to render fully transparent,
 * but only because `HEAT_RAMP`'s zero stop happens to carry alpha 0 — the
 * right answer for the wrong reason, and one ramp edit away from painting a
 * *measured* zero across ground the engine never scored at all (the same
 * confusion `R49` removed from six terrain operators). Filling with `NaN`
 * instead routes an absent field through the same "unknown is transparent"
 * path every other layer already uses — `sampleRamp` treats any non-finite
 * value as fully transparent regardless of a given ramp's stop colours, so
 * this stays correct even if `HEAT_RAMP`'s palette changes.
 *
 * ## R36 — domain rescale still missing here
 *
 * `beddingLikelihood` maxes near 0.14 on real terrain (product of five
 * imperfect terms); `HEAT_RAMP` expects an absolute `[0, 1]` domain. The
 * browser worker (`apps/web/src/workers/terrain.worker.ts`) rescales through
 * `stretchToUnit(v, BEDDING_RAMP_DOMAIN_MAX)` from `@hunt-maps/design` before
 * the ramp; this endpoint still does not, so a *present* bedding field still
 * renders nearly blank. Wiring the same rescale here needs
 * `BEDDING_RAMP_DOMAIN_MAX` / `stretchToUnit` reachable from `apps/api`,
 * which today means pulling the whole `@hunt-maps/design` barrel — React
 * components, icons, `@fontsource` assets — into a headless NestJS service
 * that has no other reason to carry a UI framework. That import is exactly
 * the kind of thing that deferred this row twice; see BACKLOG `R36` for the
 * proposed fix (move `rampDomains.ts` into `@hunt-maps/shared`, already
 * depended on by both apps and free of runtime dependencies). Do not
 * duplicate `BEDDING_RAMP_DOMAIN_MAX` in this file to work around that — a
 * second copy of the constant is exactly the divergence the shared-engine
 * rule exists to prevent.
 */
export function renderBeddingLayer(
  bedding: Float32Array | undefined,
  n: number,
): Uint8ClampedArray {
  const field = bedding ?? new Float32Array(n).fill(NaN);
  return renderRamp(field, HEAT_RAMP);
}
