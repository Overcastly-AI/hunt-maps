import { afterEach, describe, expect, it, vi } from 'vitest';
import { PNG } from 'pngjs';
import {
  analyze,
  encodePixel,
  isElevation,
  isInsufficientHaloError,
  tileToLngLat,
  type BBox,
} from '@hunt-maps/terrain';
import { DemService, type DemSource } from './dem.service';
import { Dem3depService } from './dem3dep.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * `R41` — `gridForBBox` used to allocate a halo it never filled, so the
 * mosaic edge read as `NODATA` for as far past `fillVoids`'s ~8-cell reach as
 * the caller's halo requested. These tests build a synthetic, perfectly flat
 * DEM (every tile — interior and neighbour ring alike — reports the same
 * elevation) so any cell that is *not* that elevation is proof the fetch
 * never reached it, not an artefact of real terrain variance.
 */

/** Build a `size`x`size` Terrarium PNG where every pixel is `heightM`. */
function flatTilePng(size: number, heightM: number): Buffer {
  const png = new PNG({ width: size, height: size });
  const [r, g, b] = encodePixel(heightM, 'terrarium');
  for (let i = 0; i < size * size; i++) {
    const o = i * 4;
    png.data[o] = r;
    png.data[o + 1] = g;
    png.data[o + 2] = b;
    png.data[o + 3] = 255;
  }
  return PNG.sync.write(png);
}

/** Every DEM request — centre tile or ring neighbour — resolves to the same flat tile. */
function stubFlatFetch(buf: Buffer): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** `demTile` cache that always misses, so every fetch goes through `fetch`. */
function fakePrisma(): PrismaService {
  return {
    demTile: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
    },
  } as unknown as PrismaService;
}

const TILE_SIZE = 24;
const ZOOM = 10;
const TX = 512;
const TY = 512;

const SOURCE: DemSource = {
  id: 'test',
  label: 'synthetic flat DEM',
  urlTemplate: 'https://example.test/{z}/{x}/{y}.png',
  encoding: 'terrarium',
  tileSize: TILE_SIZE,
  maxZoom: 18,
  attribution: '',
  kind: 'tiles',
  resolutionNote: 'synthetic fixture',
};

/** A bbox strictly inside tile (TX, TY) — no floating-point edge ambiguity. */
function singleTileBBox(): BBox {
  const nw = tileToLngLat(TX + 0.25, TY + 0.25, ZOOM);
  const se = tileToLngLat(TX + 0.75, TY + 0.75, ZOOM);
  return { west: nw.lng, north: nw.lat, east: se.lng, south: se.lat };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DemService.gridForBBox — mosaic halo (R41)', () => {
  it('fills the halo with real neighbour terrain instead of leaving it NODATA', async () => {
    const HEIGHT_M = 500;
    const fetchSpy = stubFlatFetch(flatTilePng(TILE_SIZE, HEIGHT_M));
    const dem = new DemService(fakePrisma(), new Dem3depService());

    const { grid } = await dem.gridForBBox(singleTileBBox(), ZOOM, SOURCE, 20);

    // One centre tile plus the full one-tile ring around it (8 neighbours) —
    // the same 3x3 fetch `gridForTile` already does for a single tile.
    expect(fetchSpy.mock.calls.length).toBe(9);

    let checked = 0;
    for (let y = -grid.halo; y < grid.height + grid.halo; y++) {
      for (let x = -grid.halo; x < grid.width + grid.halo; x++) {
        const z = grid.get(x, y);
        expect(isElevation(z)).toBe(true);
        expect(z).toBeCloseTo(HEIGHT_M, 0);
        checked++;
      }
    }
    expect(checked).toBe((grid.width + 2 * grid.halo) * (grid.height + 2 * grid.halo));
  });

  it('refuses (InsufficientHaloError) rather than allocate a halo deeper than one tile can supply', async () => {
    stubFlatFetch(flatTilePng(TILE_SIZE, 500));
    const dem = new DemService(fakePrisma(), new Dem3depService());

    let caught: unknown;
    try {
      await dem.gridForBBox(singleTileBBox(), ZOOM, SOURCE, TILE_SIZE + 6);
    } catch (err) {
      caught = err;
    }

    expect(isInsufficientHaloError(caught)).toBe(true);
    if (isInsufficientHaloError(caught)) {
      expect(caught.required).toBe(TILE_SIZE + 6);
      expect(caught.available).toBe(TILE_SIZE);
    }
  });

  it('a real operator reading the mosaic edge (terrainShelter) is no longer NaN there', async () => {
    // Halo sized to exactly `DEFAULT_SHELTER_RADIUS_CELLS` (20) — big enough that
    // `terrainShelter`'s north-facing ray march from the top interior rows walks
    // straight into the halo this test is about.
    const HALO = 20;
    stubFlatFetch(flatTilePng(TILE_SIZE, 500));
    const dem = new DemService(fakePrisma(), new Dem3depService());
    const { grid } = await dem.gridForBBox(singleTileBBox(), ZOOM, SOURCE, HALO);

    // Wind from the north: the ray for every cell marches toward decreasing y,
    // straight into the halo this test exists to prove is now real terrain.
    const result = analyze(grid, { layers: ['shelter'], windFromDeg: 0 });
    const shelter = result.shelter!;

    let nanCount = 0;
    for (let i = 0; i < shelter.length; i++) {
      if (Number.isNaN(shelter[i])) nanCount++;
    }
    expect(nanCount).toBe(0);
  });
});
