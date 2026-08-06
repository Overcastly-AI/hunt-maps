import { describe, expect, it } from 'vitest';
import {
  beddingLikelihood,
  computeThermals,
  terrainShelter,
  ThermalPhase,
  thermalPhaseAt,
  windExposure,
} from './wind.js';
import { computeCurvature, computeSurface } from './surface.js';
import { centerIndex, channel, plane, ridge, syntheticGrid } from '../testing/synthetic.js';

const SIZE = 31;
const CENTER = centerIndex(SIZE);

describe('windExposure', () => {
  it('scores a face pointing into the wind as windward (+1)', () => {
    // Ground rising to the north faces south (aspect 180). A wind FROM 180
    // blows straight onto it.
    const surface = computeSurface(syntheticGrid(plane(0, 0.4), { size: SIZE }));
    expect(windExposure(surface, 180)[CENTER]).toBeCloseTo(1, 2);
  });

  it('scores the back side of the hill as leeward (-1)', () => {
    const surface = computeSurface(syntheticGrid(plane(0, 0.4), { size: SIZE }));
    // Same south-facing slope, wind now out of the north.
    expect(windExposure(surface, 0)[CENTER]).toBeCloseTo(-1, 2);
  });

  it('scores a cross-wind face as neutral', () => {
    const surface = computeSurface(syntheticGrid(plane(0, 0.4), { size: SIZE }));
    expect(Math.abs(windExposure(surface, 90)[CENTER])).toBeLessThan(0.05);
  });

  it('returns 0 on flat ground, which has no aspect', () => {
    const surface = computeSurface(syntheticGrid(() => 500, { size: SIZE }));
    expect(windExposure(surface, 270)[CENTER]).toBe(0);
  });
});

describe('terrainShelter', () => {
  it('finds shelter below a rise that lies upwind', () => {
    // Ground rising to the north. With wind FROM the north, the terrain upwind
    // is higher, so this cell is sheltered.
    const grid = syntheticGrid(plane(0, 0.5), { size: SIZE, halo: 24, cellSize: 10 });
    const heightAt = (x: number, y: number) => grid.get(x, y);
    const sheltered = terrainShelter(heightAt, SIZE, SIZE, 10, 0, 20)[CENTER];
    // With the wind out of the south, upwind ground falls away — exposed.
    const exposed = terrainShelter(heightAt, SIZE, SIZE, 10, 180, 20)[CENTER];

    expect(sheltered).toBeGreaterThan(0.5);
    expect(exposed).toBeCloseTo(0, 5);
  });

  it('reports no shelter anywhere on a plain', () => {
    const grid = syntheticGrid(() => 500, { size: SIZE, halo: 24, cellSize: 10 });
    const s = terrainShelter((x, y) => grid.get(x, y), SIZE, SIZE, 10, 270, 20);
    expect(s[CENTER]).toBeCloseTo(0, 5);
  });
});

describe('computeThermals', () => {
  const grid = syntheticGrid(plane(0, 0.4), { size: SIZE }); // south-facing
  const surface = computeSurface(grid);
  const curvature = computeCurvature(grid);

  it('sends scent uphill on a rising (morning) thermal', () => {
    const t = computeThermals(surface, curvature, { phase: ThermalPhase.Rising });
    // Aspect is 180 (downslope south); rising thermals travel north (0/360).
    const az = t.scentAzimuth[CENTER];
    expect(Math.min(az, 360 - az)).toBeLessThan(2);
  });

  it('sends scent downhill on a sinking (evening) thermal', () => {
    const t = computeThermals(surface, curvature, { phase: ThermalPhase.Sinking });
    expect(t.scentAzimuth[CENTER]).toBeCloseTo(180, 0);
  });

  it('strengthens sinking thermals in convergent draws', () => {
    const drawGrid = syntheticGrid(channel(0.004, 0.3), { size: SIZE });
    const drawSurface = computeSurface(drawGrid);
    const drawCurv = computeCurvature(drawGrid);
    const spurGrid = syntheticGrid(ridge(0.004, 0.3), { size: SIZE });
    const spurSurface = computeSurface(spurGrid);
    const spurCurv = computeCurvature(spurGrid);

    const draw = computeThermals(drawSurface, drawCurv, { phase: ThermalPhase.Sinking });
    const spur = computeThermals(spurSurface, spurCurv, { phase: ThermalPhase.Sinking });
    expect(draw.strength[CENTER]).toBeGreaterThan(spur.strength[CENTER]);
  });

  it('damps thermals during the transition window', () => {
    const rising = computeThermals(surface, curvature, { phase: ThermalPhase.Rising });
    const trans = computeThermals(surface, curvature, { phase: ThermalPhase.Transition });
    expect(trans.strength[CENTER]).toBeLessThan(rising.strength[CENTER]);
  });
});

describe('thermalPhaseAt', () => {
  const sunrise = new Date('2026-11-15T12:30:00Z');
  const sunset = new Date('2026-11-15T22:20:00Z');

  it('is rising through the middle of the day', () => {
    expect(thermalPhaseAt(new Date('2026-11-15T17:00:00Z'), sunrise, sunset)).toBe(
      ThermalPhase.Rising,
    );
  });

  it('is sinking overnight', () => {
    expect(thermalPhaseAt(new Date('2026-11-15T03:00:00Z'), sunrise, sunset)).toBe(
      ThermalPhase.Sinking,
    );
  });

  it('is transitional around sunrise and sunset', () => {
    expect(thermalPhaseAt(new Date('2026-11-15T12:40:00Z'), sunrise, sunset)).toBe(
      ThermalPhase.Transition,
    );
    expect(thermalPhaseAt(new Date('2026-11-15T22:00:00Z'), sunrise, sunset)).toBe(
      ThermalPhase.Transition,
    );
  });
});

describe('beddingLikelihood', () => {
  it('prefers the leeward side of a hill over the windward side', () => {
    // South-facing slope at a beddable grade.
    const surface = computeSurface(syntheticGrid(plane(0, 0.4), { size: SIZE }));
    const lee = beddingLikelihood(surface, { windFromDeg: 0 })[CENTER];
    const windward = beddingLikelihood(surface, { windFromDeg: 180 })[CENTER];
    expect(lee).toBeGreaterThan(windward);
    expect(windward).toBeLessThan(0.1);
  });

  it('prefers a beddable grade over a cliff or a flat', () => {
    const gentle = computeSurface(syntheticGrid(plane(0, 0.02), { size: SIZE }));
    const beddable = computeSurface(syntheticGrid(plane(0, 0.4), { size: SIZE }));
    const cliff = computeSurface(syntheticGrid(plane(0, 1.6), { size: SIZE }));

    const score = (s: ReturnType<typeof computeSurface>) =>
      beddingLikelihood(s, { windFromDeg: 0 })[CENTER];

    expect(score(beddable)).toBeGreaterThan(score(gentle));
    expect(score(beddable)).toBeGreaterThan(score(cliff));
  });

  it('is multiplicative: no shelter drags an otherwise-perfect cell down', () => {
    const surface = computeSurface(syntheticGrid(plane(0, 0.4), { size: SIZE }));
    const n = surface.slope.length;
    const withShelter = beddingLikelihood(surface, {
      windFromDeg: 0,
      shelter: new Float32Array(n).fill(1),
    })[CENTER];
    const without = beddingLikelihood(surface, {
      windFromDeg: 0,
      shelter: new Float32Array(n).fill(0),
    })[CENTER];
    expect(without).toBeLessThan(withShelter);
    expect(without / withShelter).toBeCloseTo(0.25, 2);
  });

  it('stays within [0, 1]', () => {
    const surface = computeSurface(syntheticGrid(plane(0.3, 0.4), { size: SIZE }));
    const out = beddingLikelihood(surface, { windFromDeg: 45 });
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
