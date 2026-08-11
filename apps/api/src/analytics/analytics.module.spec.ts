import { afterEach, describe, expect, it, vi } from 'vitest';
import { PNG } from 'pngjs';
import { analyze, encodePixel, pixelSizeMeters, tileToLngLat } from '@hunt-maps/terrain';
import { binIndex, SLOPE_BANDS } from '@hunt-maps/shared';
import type { GeoGeometry } from '@hunt-maps/shared';
import { AnalyticsService } from './analytics.module';
import { DemService, type DemSource } from '../terrain/dem.service';
import { Dem3depService } from '../terrain/dem3dep.service';
import { GeometryService } from '../prisma/geometry.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PropertyAccessService } from '../auth/property-access.service';

/**
 * `R70` — `TerrainProfile`'s availability distribution used to be computed
 * over `boundsOf(boundary)`, an axis-aligned envelope, rather than the
 * boundary polygon itself. On a non-rectangular parcel that silently folds
 * in neighbouring ground and biases every Manly selection ratio downstream
 * (`packages/shared/src/analytics/selection.ts`).
 *
 * This builds a deliberately L-shaped property over a synthetic DEM with two
 * sharply different terrain regions — the whole envelope is flat except a
 * steep 2x1-tile block in the notch the "L" excludes — so a correct
 * (polygon-clipped) availability share and the old (envelope) share provably
 * disagree by a large, predictable margin. A test that merely asserted
 * "shares sum to 1" would have passed throughout the life of this bug.
 */

const TILE = 32; // must be >= the 24-cell halo `terrainProfile` requests
// A high zoom keeps the synthetic cell size (and so the ramp's total
// elevation change across the mosaic) realistic — a low zoom with a small
// custom tile size gives a cell the size of a small town, which pushes a
// 35 degree ramp's elevation past what the terrarium encoding can represent
// and silently clips it, flattening exactly the region this fixture needs
// to stay steep.
const ZOOM = 17;
const TX = 65536;
const TY = 65536;
const FLAT_M = 500;
const STEEP_DEG = 35; // lands cleanly inside SLOPE_BANDS' "Steep 30-45°"

const SOURCE: DemSource = {
  id: 'test-l-shape',
  label: 'synthetic L-shaped fixture',
  urlTemplate: 'https://example.test/{z}/{x}/{y}.png',
  encoding: 'terrarium',
  tileSize: TILE,
  maxZoom: 18,
  attribution: '',
  kind: 'tiles',
  resolutionNote: 'synthetic fixture',
};

/**
 * Elevation as a pure function of position: flat everywhere, except a ramp
 * of `rise` metres per pixel in the block `x in [TILE, 3*TILE)`,
 * `y in [0, 2*TILE)` — the top-right two tiles of a 3x3 mosaic. Defined for
 * any (x, y), including tiles in the one-tile halo ring outside the 3x3
 * interior, so there is no seam at the interior/halo boundary.
 */
function elevationAt(globalX: number, globalY: number, rise: number): number {
  const steep = globalX >= TILE && globalY < 2 * TILE;
  return steep ? FLAT_M + (globalX - TILE) * rise : FLAT_M;
}

function tilePng(tx: number, ty: number, rise: number): Buffer {
  const png = new PNG({ width: TILE, height: TILE });
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const globalX = (tx - TX) * TILE + x;
      const globalY = (ty - TY) * TILE + y;
      const [r, g, b] = encodePixel(elevationAt(globalX, globalY, rise), 'terrarium');
      const o = (y * TILE + x) * 4;
      png.data[o] = r;
      png.data[o + 1] = g;
      png.data[o + 2] = b;
      png.data[o + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function stubFetch(rise: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const m = /\/(\d+)\/(-?\d+)\/(-?\d+)\.png$/.exec(url);
      if (!m) throw new Error(`unexpected DEM url ${url}`);
      const [, , x, y] = m;
      const buf = tilePng(Number(x), Number(y), rise);
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      };
    }),
  );
}

function fakePrisma(): PrismaService {
  return {
    demTile: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
    },
    terrainProfile: {
      findUnique: vi.fn(async () => null),
      // Mirrors a real upsert closely enough for assertions: return exactly
      // what the service tried to persist.
      upsert: vi.fn(async ({ create }: { create: unknown }) => create),
    },
  } as unknown as PrismaService;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AnalyticsService.terrainProfile — availability is clipped to the boundary (R70)', () => {
  it('an L-shaped boundary whose envelope is ~1.8x its true area gets provably different shares', async () => {
    // A 3x3-tile bbox, chosen so gridForBBox floors to exactly tiles
    // (TX..TX+2, TY..TY+2) with no floating-point edge ambiguity.
    const nw = tileToLngLat(TX + 0.02, TY + 0.02, ZOOM);
    const se = tileToLngLat(TX + 2.98, TY + 2.98, ZOOM);
    const bbox = { west: nw.lng, north: nw.lat, east: se.lng, south: se.lat };
    const centerLat = (bbox.north + bbox.south) / 2;
    const rise = pixelSizeMeters(ZOOM, centerLat, TILE) * Math.tan((STEEP_DEG * Math.PI) / 180);

    stubFetch(rise);

    const prisma = fakePrisma();
    const dem = new DemService(prisma, new Dem3depService());
    vi.spyOn(dem, 'resolveSource').mockReturnValue(SOURCE);

    const geometry = new GeometryService(prisma);
    // The L: left column (x in [0, TILE)) union bottom row (y in
    // [2*TILE, 3*TILE)) of the 3x3-tile envelope — exactly the flat region,
    // excluding the steep top-right 2x1-tile block. True area = 5 tile-units
    // of the 9 tile-unit envelope (ratio 9/5 = 1.8x).
    const originTile = { z: ZOOM, x: TX, y: TY };
    const toLngLat = (x: number, y: number) => dem.lngLatOfPixel(x, y, originTile, TILE);
    const T = TILE;
    const ring: Array<[number, number]> = [
      [0, 0],
      [T, 0],
      [T, 2 * T],
      [3 * T, 2 * T],
      [3 * T, 3 * T],
      [0, 3 * T],
      [0, 0],
    ].map(([x, y]) => {
      const p = toLngLat(x, y);
      return [p.lng, p.lat];
    });
    const boundary: GeoGeometry = { type: 'Polygon', coordinates: [ring] };

    vi.spyOn(geometry, 'boundsOf').mockResolvedValue(bbox);
    vi.spyOn(geometry, 'readGeoJson').mockResolvedValue(boundary);

    const access = {} as PropertyAccessService;
    const service = new AnalyticsService(prisma, geometry, access, dem);

    const profile = await service.terrainProfile('property-l-shaped', ZOOM);
    const slopeShares = profile.slopeShares as number[];
    const clippedFlatShare = slopeShares[binIndex(SLOPE_BANDS, 0)];

    // Independently recompute the pre-fix (envelope) share via the same
    // public DEM + engine pipeline, with no boundary clip at all — this is
    // exactly what `shareOf` used to do before the mask was threaded through.
    const { grid: envelopeGrid } = await dem.gridForBBox(bbox, ZOOM, SOURCE, 24);
    const envelopeResult = analyze(envelopeGrid, { layers: ['slope'] });
    let flat = 0;
    let finite = 0;
    for (const s of envelopeResult.slope!) {
      if (!Number.isFinite(s)) continue;
      finite++;
      if (binIndex(SLOPE_BANDS, s) === 0) flat++;
    }
    const envelopeFlatShare = flat / finite;

    // Envelope: flat region is 5/9 of the whole bounding box ~= 0.556.
    expect(envelopeFlatShare).toBeGreaterThan(0.5);
    expect(envelopeFlatShare).toBeLessThan(0.62);

    // Clipped to the true L: almost entirely flat by construction.
    expect(clippedFlatShare).toBeGreaterThan(0.9);

    // The falsifiable assertion: fixing R70 must move the number by a large,
    // stated margin, not just keep the shares summing to 1.
    expect(clippedFlatShare - envelopeFlatShare).toBeGreaterThan(0.3);
  });
});
