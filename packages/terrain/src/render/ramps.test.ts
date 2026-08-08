import { describe, expect, it } from 'vitest';
import {
  ASPECT_RAMP,
  HEAT_RAMP,
  renderCategorical,
  renderHillshade,
  renderMask,
  renderRamp,
  sampleRamp,
  SLOPE_RAMP,
  WOOD_COLORS,
} from './ramps.js';
import { BenchFlag, WoodFeature } from '../analysis/landform.js';

/**
 * These are correctness tests, not cartography tests.
 *
 * Every one of them asserts the same property: **a cell the engine could not
 * measure must not be painted as a definite answer.** The engine now says "I do
 * not know" honestly (`R49`), and that only reaches the user if the last step
 * before the screen preserves it. A ramp that clamps `NaN` or a no-aspect
 * sentinel onto its first stop turns an abstention back into a confident colour
 * at the very last moment, which is the failure this repo ranks worst.
 */
describe('ramps preserve "unknown" all the way to the pixel', () => {
  it('renders a non-finite scalar as fully transparent, on every ramp', () => {
    for (const [name, stops] of [
      ['slope', SLOPE_RAMP],
      ['aspect', ASPECT_RAMP],
      ['heat', HEAT_RAMP],
    ] as const) {
      expect(sampleRamp(stops, NaN), name).toEqual([0, 0, 0, 0]);
    }
  });

  it('does not paint a cell with no aspect as north-facing', () => {
    // `aspect === -1` covers both a dead-flat cell and an unmeasurable one, and
    // `sampleRamp` clamps to its first stop — so before the leading transparent
    // stop, every flat field, every lake and every DEM void came out solid
    // north-facing blue.
    const flat = sampleRamp(ASPECT_RAMP, -1);
    expect(flat[3], 'alpha at the no-aspect sentinel').toBe(0);

    const north = sampleRamp(ASPECT_RAMP, 0);
    expect(north[3], 'a real north-facing cell still paints').toBeGreaterThan(0);
    expect(north.slice(0, 3)).toEqual([90, 122, 190]);

    // The ramp must still be cyclic: 0 and 360 are the same colour, or north
    // shows a hard seam right through the middle of the most-read bearing.
    expect(sampleRamp(ASPECT_RAMP, 360)).toEqual(north);

    // And the transparent stop must not bleed into real southerly aspects.
    for (const az of [45, 90, 180, 270, 359]) {
      expect(sampleRamp(ASPECT_RAMP, az)[3], `azimuth ${az}`).toBeGreaterThan(0);
    }
  });

  it('renders an unknown hillshade as transparent, not as black', () => {
    // A void reaches here as NaN rather than a fabricated zero gradient. Opaque
    // black would swap one confident lie for another — it reads as a shadowed
    // hollow, and it hides the imagery underneath, which is the only evidence
    // left about ground the DEM cannot describe.
    const shade = new Float32Array([0.5, NaN, 1, 0]);
    const buf = renderHillshade(shade, 1);
    expect([buf[0], buf[3]], 'lit cell').toEqual([128, 255]);
    expect([buf[4], buf[5], buf[6], buf[7]], 'unknown cell').toEqual([0, 0, 0, 0]);
    expect(buf[11], 'a genuinely unlit cell is still opaque').toBe(255);
  });

  it('honours opacity on known cells while keeping unknown fully transparent', () => {
    const buf = renderHillshade(new Float32Array([0.5, NaN]), 0.4);
    expect(buf[3]).toBe(102);
    expect(buf[7]).toBe(0);
  });

  it('renders the Wood unknown class transparently, and every other class visibly', () => {
    const field = new Uint8Array([WoodFeature.Planar, WoodFeature.Pass, WoodFeature.Unknown]);
    const buf = renderCategorical(field, WOOD_COLORS);
    expect(buf[3], 'planar is the invisible background case').toBe(0);
    expect(buf[7], 'a saddle is the loudest thing on the map').toBeGreaterThan(200);
    expect([buf[8], buf[9], buf[10], buf[11]], 'unknown').toEqual([0, 0, 0, 0]);
    // The palette must actually cover the enum; `?? [0,0,0,0]` would mask a
    // missing entry as a correct-looking transparent one.
    expect(WOOD_COLORS.length).toBe(WoodFeature.Unknown + 1);
  });

  it('paints only a definite match, so a Unknown bench does not become an orange shelf (R69)', () => {
    // `renderMask` used to test truthiness. The moment `detectBenches` grew a
    // third state (`Unknown = 2`, also truthy) that would have painted every DEM
    // void in solid bench colour — a level shelf drawn over ground the engine
    // never saw, which is the single layer a hunter uses to pick a bed.
    const flags = Uint8Array.from([
      BenchFlag.NotBench,
      BenchFlag.Bench,
      BenchFlag.Unknown,
      BenchFlag.NotBench,
    ]);
    const buf = renderMask(flags, 4, 1, '#e8a33d', 0.55);
    expect(buf[3], 'measured, not a bench').toBe(0);
    expect(buf[7], 'a real bench').toBeGreaterThan(0);
    expect([buf[8], buf[9], buf[10], buf[11]], 'unmeasurable').toEqual([0, 0, 0, 0]);
  });

  it('does not outline against an Unknown as if it were a boundary (R69)', () => {
    // The outline pass has the same truthiness test, so an Unknown neighbour
    // would have read as "inside the mask" and swallowed the edge of a real
    // bench — the boundary is the whole point of the outline.
    const flags = Uint8Array.from([BenchFlag.Bench, BenchFlag.Unknown]);
    const buf = renderMask(flags, 2, 1, '#000000', 1, true);
    expect(buf[3], 'a bench with an unmeasured neighbour is still outlined').toBe(255);
    expect(buf[0], 'and brightened, not left flat').toBe(70);
  });

  it('leaves a field of known values byte-identical through renderRamp', () => {
    // Anti-over-correction: the transparency rules above must not touch data.
    const field = new Float32Array([0, 8, 20, 30, 45, 70]);
    const buf = renderRamp(field, SLOPE_RAMP);
    for (let i = 0; i < field.length; i++) {
      expect(Array.from(buf.slice(i * 4, i * 4 + 4)), `value ${field[i]}`).toEqual(
        sampleRamp(SLOPE_RAMP, field[i]),
      );
    }
  });
});
