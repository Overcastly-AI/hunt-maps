import { BadRequestException, Injectable } from '@nestjs/common';
import {
  analyze,
  buildCostSurface,
  computeCorridor,
  findPinchPoints,
  requiredHalo,
  traceCorridorLines,
  type AnalysisRequest,
  type TileCoord,
} from '@hunt-maps/terrain';
import type { BoundingBox, GeoLineString, GeoPoint, GeoPolygon } from '@hunt-maps/shared';
import { DemService, type DemSource } from './dem.service';

export interface CorridorRequest {
  bbox: BoundingBox;
  zoom: number;
  source: DemSource;
  /** Areas the corridor connects — typically bedding and food. */
  from: GeoPolygon | GeoPoint;
  to: GeoPolygon | GeoPoint;
  toleranceFraction?: number;
  /** When set, terrain deer prefer is discounted so routes favour it. */
  useBeddingAttraction?: boolean;
  windFromDeg?: number;
  maxLines?: number;
}

export interface CorridorResponse {
  band: GeoPolygon | null;
  centerlines: GeoLineString[];
  pinchPoints: Array<{ point: GeoPoint; score: number }>;
  optimalCost: number | null;
  areaShare: number;
  cellSizeM: number;
  parameters: Record<string, unknown>;
}

@Injectable()
export class CorridorService {
  constructor(private readonly dem: DemService) {}

  /**
   * Solve a movement corridor between two areas.
   *
   * ## Why this is a whole-property computation
   *
   * Least-cost routing cannot be tiled. The cheapest way from a bedding area to
   * a food source is a global property of the surface between them — a route
   * that looks optimal within one tile may be a dead end two tiles over. So
   * unlike the shading layers, this assembles one contiguous mosaic and solves
   * across it, and the tile ceiling in `DemService` is what keeps that honest.
   */
  async solve(request: CorridorRequest): Promise<CorridorResponse> {
    const {
      bbox,
      zoom,
      source,
      toleranceFraction = 0.15,
      useBeddingAttraction = true,
      windFromDeg,
    } = request;

    const layers: AnalysisRequest['layers'] = ['slope', 'aspect'];
    if (useBeddingAttraction && windFromDeg !== undefined) layers.push('bedding', 'shelter');
    const analysisRequest: AnalysisRequest = { layers, windFromDeg };

    const { grid, originTile } = await this.dem.gridForBBox(
      bbox,
      zoom,
      source,
      requiredHalo(analysisRequest),
    );
    const result = analyze(grid, analysisRequest);

    const cost = buildCostSurface(result.surface, grid.cellSize, {
      attraction: useBeddingAttraction ? result.bedding : undefined,
      attractionWeight: 0.5,
    });

    const sources = this.cellsFor(request.from, originTile, source.tileSize, grid.width, grid.height);
    const targets = this.cellsFor(request.to, originTile, source.tileSize, grid.width, grid.height);

    if (sources.length === 0 || targets.length === 0) {
      throw new BadRequestException(
        'The start or end area falls outside the analysis bounds. Widen the bounding box.',
      );
    }

    const corridor = computeCorridor(cost, sources, targets, { toleranceFraction });

    if (!Number.isFinite(corridor.optimalCost)) {
      // Genuinely disconnected — a cliff band, a lake, or an impassable
      // resistance ring. Reporting an empty corridor is more useful than an
      // error, because seeing *that* there is no route is itself information.
      return {
        band: null,
        centerlines: [],
        pinchPoints: [],
        optimalCost: null,
        areaShare: 0,
        cellSizeM: grid.cellSize,
        parameters: { toleranceFraction, useBeddingAttraction, windFromDeg, zoom },
      };
    }

    const pinch = findPinchPoints(corridor, grid.width, grid.height);
    const lines = traceCorridorLines(corridor, grid.width, grid.height, request.maxLines ?? 5);

    const toLngLat = (i: number): [number, number] => {
      const p = this.dem.lngLatOfPixel(
        i % grid.width,
        Math.floor(i / grid.width),
        originTile,
        source.tileSize,
      );
      return [p.lng, p.lat];
    };

    let matched = 0;
    for (let i = 0; i < corridor.mask.length; i++) matched += corridor.mask[i];

    return {
      band: this.maskToPolygon(corridor.mask, grid.width, grid.height, toLngLat),
      centerlines: lines
        .map((line: number[]) => ({
          type: 'LineString' as const,
          coordinates: simplify(line.map(toLngLat)),
        }))
        .filter((l: { coordinates: unknown[] }) => l.coordinates.length >= 2),
      pinchPoints: topPinchPoints(pinch, grid.width, 12, toLngLat),
      optimalCost: corridor.optimalCost,
      areaShare: matched / corridor.mask.length,
      cellSizeM: grid.cellSize,
      parameters: {
        toleranceFraction,
        useBeddingAttraction,
        windFromDeg,
        zoom,
        demSource: source.id,
      },
    };
  }

  /** Map an input geometry to the mosaic cell indices it covers. */
  private cellsFor(
    geometry: GeoPolygon | GeoPoint,
    originTile: TileCoord,
    tileSize: number,
    width: number,
    height: number,
  ): number[] {
    const coords: Array<[number, number]> =
      geometry.type === 'Point' ? [geometry.coordinates] : geometry.coordinates[0];

    const cells = new Set<number>();
    for (const [lng, lat] of coords) {
      const p = this.dem.pixelInMosaic(lng, lat, originTile, tileSize);
      // A single-pixel source makes the solve brittle at the boundary; seed a
      // small disc so the route can leave the area from any side.
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = p.x + dx;
          const y = p.y + dy;
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          cells.add(y * width + x);
        }
      }
    }
    return [...cells];
  }

  /**
   * Trace a mask to a polygon outline.
   *
   * A marching-squares contour would give smoother edges, but the corridor band
   * is a *fuzzy* object — its boundary is a tolerance threshold, not a real
   * feature — so an honest blocky outline is arguably better than a smooth one
   * that implies precision the model does not have. We emit the cell-boundary
   * hull and let the client soften it visually.
   */
  private maskToPolygon(
    mask: Uint8Array,
    width: number,
    height: number,
    toLngLat: (i: number) => [number, number],
  ): GeoPolygon | null {
    const edges: Array<[number, number]> = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!mask[i]) continue;
        const boundary =
          x === 0 ||
          y === 0 ||
          x === width - 1 ||
          y === height - 1 ||
          !mask[i - 1] ||
          !mask[i + 1] ||
          !mask[i - width] ||
          !mask[i + width];
        if (boundary) edges.push(toLngLat(i));
      }
    }
    if (edges.length < 3) return null;

    const hull = convexHull(edges);
    if (hull.length < 3) return null;
    hull.push(hull[0]);
    return { type: 'Polygon', coordinates: [hull] };
  }
}

/** Andrew's monotone chain. */
function convexHull(points: Array<[number, number]>): Array<[number, number]> {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;

  const cross = (
    o: [number, number],
    a: [number, number],
    b: [number, number],
  ): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: Array<[number, number]> = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Array<[number, number]> = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Keep every Nth vertex — corridor centrelines are cell-resolution and noisy. */
function simplify(coords: Array<[number, number]>, step = 3): Array<[number, number]> {
  if (coords.length <= 2) return coords;
  const out = coords.filter((_, i) => i % step === 0);
  const last = coords[coords.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function topPinchPoints(
  pinch: Float32Array,
  width: number,
  limit: number,
  toLngLat: (i: number) => [number, number],
): Array<{ point: GeoPoint; score: number }> {
  const candidates: Array<{ i: number; score: number }> = [];
  for (let i = 0; i < pinch.length; i++) {
    if (pinch[i] > 0.35) candidates.push({ i, score: pinch[i] });
  }
  candidates.sort((a, b) => b.score - a.score);

  // Thin the list so twelve pinch points are not twelve adjacent cells of the
  // same neck — a hunter wants twelve *places*, not twelve pixels.
  const chosen: Array<{ i: number; score: number }> = [];
  const minSeparation = 24;
  for (const c of candidates) {
    const cx = c.i % width;
    const cy = Math.floor(c.i / width);
    const tooClose = chosen.some((o) => {
      const ox = o.i % width;
      const oy = Math.floor(o.i / width);
      return Math.hypot(cx - ox, cy - oy) < minSeparation;
    });
    if (!tooClose) chosen.push(c);
    if (chosen.length >= limit) break;
  }

  return chosen.map((c) => ({
    point: { type: 'Point' as const, coordinates: toLngLat(c.i) },
    score: c.score,
  }));
}
