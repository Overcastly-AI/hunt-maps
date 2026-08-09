import { describe, expect, it } from 'vitest';
import { HEAT_RAMP, renderRamp, sampleRamp } from '@hunt-maps/terrain';
import { renderBeddingLayer } from './terrain.service';

/**
 * `R36` — the server-rendered bedding tile has the same paints-nothing bug
 * `R32` fixed in the browser worker: `beddingLikelihood` maxes near 0.14 on
 * real terrain (a product of five imperfect terms — see
 * `packages/terrain/src/analysis/wind.ts`), but `HEAT_RAMP` expects an
 * absolute `[0, 1]` domain. The browser path rescales through
 * `stretchToUnit(v, BEDDING_RAMP_DOMAIN_MAX)` from `@hunt-maps/design` before
 * hitting the ramp; this endpoint cannot reach that constant without pulling
 * a React/UI package into a headless NestJS service (see the doc comment on
 * `renderBeddingLayer` in `terrain.service.ts`), so the rescale is not
 * applied here yet. Filed as a blocker on BACKLOG `R36`: move
 * `rampDomains.ts` into `@hunt-maps/shared`, which is pure TypeScript and
 * already a dependency of both `apps/api` and `apps/web`.
 */

/** Fraction of pixels whose alpha exceeds a visibility floor. */
function saturatedFraction(rgba: Uint8ClampedArray, alphaFloor = 25): number {
  let hit = 0;
  let total = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    total++;
    if (rgba[i] > alphaFloor) hit++;
  }
  return total === 0 ? 0 : hit / total;
}

function meanAlpha(rgba: Uint8ClampedArray): number {
  let sum = 0;
  let total = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    sum += rgba[i];
    total++;
  }
  return total === 0 ? 0 : sum / total;
}

/**
 * A synthetic field reproducing the distribution documented on real terrain
 * (`packages/design/src/rampDomains.ts`, Hocking Hills, OH):
 *   min 0.0000  max 0.1386  mean 0.0464  p50 0.0486  p90 0.0894  p99 0.1217
 *
 * Built deterministically (a 2-D triangular wave, peaking near the DEM's
 * observed max) rather than sampled from a real DEM, so the test is not
 * coupled to a DEM fixture and stays reproducible. Verified below against
 * the documented min/max/mean before it is used for anything else.
 */
function realisticBeddingField(size: number): Float32Array {
  const n = size * size;
  const out = new Float32Array(n);
  const max = 0.1386;
  const tri = (t: number) => 1 - Math.abs(2 * t - 1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / (size - 1);
      const v = y / (size - 1);
      out[i] = max * tri(u) * tri(v) * 0.85 + max * 0.1;
    }
  }
  return out;
}

function fieldStats(field: Float32Array) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of field) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, mean: sum / field.length };
}

describe('realisticBeddingField (fixture sanity)', () => {
  it('matches the documented real-terrain distribution shape', () => {
    const { min, max, mean } = fieldStats(realisticBeddingField(32));
    expect(min).toBeGreaterThan(0);
    expect(max).toBeLessThan(0.15); // under the documented real-world max
    expect(max).toBeGreaterThan(0.1); // but not trivially small either
    expect(mean).toBeLessThan(0.06); // right-skewed, like the real distribution
  });
});

describe('renderBeddingLayer — R36 domain-rescale bug', () => {
  /**
   * This test pins *present* (buggy) behaviour, not desired behaviour — see
   * the module doc comment. It exists so the day someone wires the rescale
   * this assertion flips from green to red and forces them to replace it
   * with the fixed assertion in the `.todo` below, rather than the endpoint
   * silently starting to work with nothing announcing it.
   *
   * Measured against this fixture: mean alpha ≈ 9.9/255, ~2% of pixels
   * exceed the visibility floor — i.e. the tile is very nearly blank.
   */
  it('a realistic field renders almost no visible saturation without the domain rescale', () => {
    const size = 32;
    const field = realisticBeddingField(size);

    const rgba = renderBeddingLayer(field, size * size);

    expect(saturatedFraction(rgba)).toBeLessThan(0.05);
    expect(meanAlpha(rgba)).toBeLessThan(20);
  });

  /**
   * Reference-only: shows what *is* achievable once the field is rescaled
   * into the ramp's domain, using a per-tile max stretch computed locally in
   * this test — deliberately NOT `BEDDING_RAMP_DOMAIN_MAX`, which apps/api
   * cannot import (see the blocker note). A per-tile stretch is the wrong
   * fix for production (`rampDomains.ts` explains why: it breaks colour
   * consistency across tile edges), but it is a fine way to demonstrate,
   * without duplicating the real constant, that the *shape* of the bug is a
   * missing rescale and not something else (e.g. a broken ramp).
   */
  it('rescaling the same field into the ramp domain produces non-trivial saturation (target shape of the fix)', () => {
    const size = 32;
    const field = realisticBeddingField(size);
    const { max } = fieldStats(field);
    const rescaled = Float32Array.from(field, (v) => Math.min(1, Math.max(0, v / max)));

    const rgba = renderRamp(rescaled, HEAT_RAMP);

    expect(saturatedFraction(rgba)).toBeGreaterThan(0.9);
    expect(meanAlpha(rgba)).toBeGreaterThan(70);
  });

  it.todo(
    'once BEDDING_RAMP_DOMAIN_MAX/stretchToUnit is reachable from apps/api ' +
      '(proposed: move rampDomains.ts into @hunt-maps/shared), renderBeddingLayer ' +
      'itself — not just a locally-rescaled reference — should assert ' +
      'saturatedFraction > 0.5 and meanAlpha > 60 for realisticBeddingField(32)',
  );
});

describe('renderBeddingLayer — absent field vs. measured zero', () => {
  it('renders an absent field (no wind supplied) as fully transparent, not a confident zero', () => {
    const size = 8;
    const n = size * size;
    const rgba = renderBeddingLayer(undefined, n);

    for (let i = 0; i < rgba.length; i++) {
      expect(rgba[i]).toBe(0);
    }
  });

  it('renders a present all-zero field (every cell measured and scored 0) the same as an absent one', () => {
    const size = 8;
    const n = size * size;
    const zeroField = new Float32Array(n);

    expect(renderBeddingLayer(zeroField, n)).toEqual(renderBeddingLayer(undefined, n));
  });

  it('matches sampleRamp directly for a known value, as a sanity check on the render path', () => {
    const rgba = renderBeddingLayer(new Float32Array([0.5]), 1);
    const expected = sampleRamp(HEAT_RAMP, 0.5);
    expect(Array.from(rgba)).toEqual(expected);
  });
});
