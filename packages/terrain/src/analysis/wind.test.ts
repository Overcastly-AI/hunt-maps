import { describe, expect, it } from 'vitest';
import {
  beddingLikelihood,
  coldBlendWeight,
  computeThermals,
  terrainShelter,
  ThermalPhase,
  thermalPhaseAt,
  windExposure,
  BEDDING_MAX_SOLAR_ASPECT_WEIGHT,
} from './wind.js';
import { computeSurface, computeCurvature, NODATA, type SurfaceField } from './surface.js';
import { slopeInsolation, solarPosition } from './solar.js';
import { analyze } from '../pipeline.js';
import {
  benchedHillside,
  centerIndex,
  channel,
  plane,
  ridge,
  syntheticGrid,
} from '../testing/synthetic.js';

const SIZE = 31;
const CENTER = centerIndex(SIZE);
const RAD = Math.PI / 180;
/** Grade (rise/run) of a slope of `deg` degrees — the tests are written in degrees. */
const grade = (deg: number): number => Math.tan(deg * RAD);

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

  it('returns NaN where the surface could not be measured, not crosswind 0 (R49)', () => {
    // Flat and unmeasurable both used to be 0, and only one of them earns it.
    // A void landed in the middle of the exposure ramp, where it reads as
    // ordinary crosswind ground rather than as ground nobody has seen.
    const g = syntheticGrid(plane(0, 0.4), { size: SIZE, halo: 4 });
    g.set(10, 10, NODATA);
    const surface = computeSurface(g);
    const exposure = windExposure(surface, 180);
    expect(exposure[10 * SIZE + 10], 'was 0 — "crosswind"').toBeNaN();
    expect(exposure[11 * SIZE + 11], 'the margin cell, also unmeasurable').toBeNaN();
    expect(exposure[CENTER], 'clean ground is untouched').toBeCloseTo(1, 2);
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

  it('reports NaN strength on unmeasurable ground, and a real 0 on a flat (R69)', () => {
    // Found sweeping for `R69`'s pattern rather than named by it. Both cases
    // used to return strength 0 through the same branch, so "no thermal here"
    // and "no idea" were one number — and this is the layer that tells a hunter
    // which way their scent goes in the first and last hour of light.
    const g = syntheticGrid(plane(0, 0.4), { size: SIZE });
    g.set(10, 10, NODATA);
    const s = computeSurface(g);
    const c = computeCurvature(g);
    const t = computeThermals(s, c, { phase: ThermalPhase.Sinking });
    const i = 10 * SIZE + 10;
    expect(s.aspect[i], 'the sentinel that cannot carry the distinction').toBe(-1);
    expect(t.strength[i], 'was 0 — "your scent will sit still here"').toBeNaN();
    // Anti-over-correction: measured level ground still gets a definite zero,
    // because it genuinely has no fall line for cold air to run down.
    const flatGrid = syntheticGrid(() => 500, { size: SIZE });
    const flat = computeThermals(computeSurface(flatGrid), computeCurvature(flatGrid), {
      phase: ThermalPhase.Sinking,
    });
    expect(flat.strength[CENTER], 'a real answer about real ground').toBe(0);
    expect(flat.scentAzimuth[CENTER]).toBe(-1);
    // And the rest of the plane is untouched.
    expect(t.strength[20 * SIZE + 20]).toBeGreaterThan(0);
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

// ---------------------------------------------------------------------------
// R11 — the slope term's shape and centre
// ---------------------------------------------------------------------------

/** Bedding score at the centre of a hillside with a `padDeg` shelf cut into it. */
function shelfScore(padDeg: number, hillDeg = 24): number {
  const grid = syntheticGrid(benchedHillside(grade(hillDeg), grade(padDeg), -30, 30), {
    size: SIZE,
  });
  return beddingLikelihood(computeSurface(grid), { windFromDeg: 0 })[CENTER];
}

describe('beddingLikelihood — slope response (R11)', () => {
  it('declines monotonically as the pad steepens, with the surround held fixed', () => {
    // Rowland et al. 2018 (Wildlife Monographs 199) measure cervid use declining
    // monotonically with slope, with no interior optimum. The old Gaussian
    // peaked at 22°, so this sequence used to run *upwards* — which is the
    // shape the best-measured slope response in the literature contradicts.
    // Holding the hill at 24° holds the ring term near-constant, isolating
    // the pad term.
    const pads = [2, 6, 10, 14, 18];
    const scores = pads.map((deg) => shelfScore(deg));
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i], `${pads[i]}° vs ${pads[i - 1]}°`).toBeLessThan(scores[i - 1]);
    }
  });

  it('scores a 10° shelf above a 22° sidehill — the user-facing bug, inverted', () => {
    // A shelf inside 24° ground versus a uniform 22° face. Both are fully
    // leeward on this wind, so only the slope terms separate them. The old
    // model put its maximum on the sidehill and walked hunters past the bench.
    const sidehill = computeSurface(syntheticGrid(plane(0, grade(22)), { size: SIZE }));
    const sidehillScore = beddingLikelihood(sidehill, { windFromDeg: 0 })[CENTER];
    expect(shelfScore(10)).toBeGreaterThan(sidehillScore);
  });

  it('still rejects the valley floor: a gentle pad needs steep ground around it', () => {
    // The monotone pad term alone would rank a hayfield as perfect bedding.
    // The ring term is what stops it, and it has to be checked at the same
    // pad grade or it proves nothing.
    const openField = computeSurface(syntheticGrid(plane(0, grade(6)), { size: SIZE }));
    const openScore = beddingLikelihood(openField, { windFromDeg: 0 })[CENTER];
    expect(shelfScore(6)).toBeGreaterThan(openScore * 3);
  });
});

// ---------------------------------------------------------------------------
// R21 — the cover term must not be a second slope term
// ---------------------------------------------------------------------------

describe('beddingLikelihood — cover term (R21)', () => {
  /**
   * Recover the multiplier the cover field contributed, by dividing the
   * pipeline's score by the same score computed without a cover field (where
   * the term is exactly 1). Nothing else differs, so this isolates cover
   * without restating any of the formulas under test.
   */
  function coverMultiplier(slopeDeg: number): number {
    // 2 m cells: at the 10 m cells the old TRI/4 m normalisation saturated for
    // any real slope, which is precisely where the defect hid. On LiDAR-
    // resolution ground it is fully live.
    const grid = syntheticGrid(plane(0, grade(slopeDeg)), {
      size: SIZE,
      halo: 24,
      cellSize: 2,
    });
    const r = analyze(grid, { layers: ['bedding', 'shelter'], windFromDeg: 0 });
    const noCover = beddingLikelihood(r.surface, {
      windFromDeg: 0,
      shelter: r.shelter,
    })[CENTER];
    expect(noCover).toBeGreaterThan(0);
    return r.bedding![CENTER] / noCover;
  }

  it('gives a smooth 31° face no more cover credit than a smooth 11° face', () => {
    // Both planes are perfectly smooth: one surface normal everywhere, nothing
    // to hide behind. With TRI in this slot the steep face scored 0.84 against
    // the gentle face's 0.55 purely because it was steep — the slope term
    // counted twice, biasing the flagship layer toward open steep ground.
    const gentle = coverMultiplier(11);
    const steep = coverMultiplier(31);
    expect(steep).toBeCloseTo(gentle, 6);
    // And both sit on the floor, because smooth is smooth.
    expect(steep).toBeCloseTo(0.4, 6);
  });
});

// ---------------------------------------------------------------------------
// R22 — season-aware aspect
// ---------------------------------------------------------------------------

describe('coldBlendWeight', () => {
  it('is exactly zero through the season a hunter actually hunts', () => {
    for (const t of [30, 20, 15, 10, 5]) expect(coldBlendWeight(t)).toBe(0);
  });

  it('reaches full weight only in severe cold, and ramps monotonically', () => {
    expect(coldBlendWeight(-10)).toBe(BEDDING_MAX_SOLAR_ASPECT_WEIGHT);
    expect(coldBlendWeight(-30)).toBe(BEDDING_MAX_SOLAR_ASPECT_WEIGHT);
    let prev = 0;
    for (const t of [4, 0, -4, -8, -10]) {
      const w = coldBlendWeight(t);
      expect(w).toBeGreaterThan(prev);
      prev = w;
    }
  });

  it('treats a missing temperature as "not cold", never as winter', () => {
    expect(coldBlendWeight(Number.NaN)).toBe(0);
  });
});

describe('beddingLikelihood — season-aware aspect (R22)', () => {
  const LAT = 40;
  const LNG = -84;
  // Mean solar noon, mid-January: the moment the contrast between faces is
  // largest and the one that governs how much snow a slope sheds.
  const JAN_NOON = new Date(Date.UTC(2027, 0, 15, 12) - (LNG / 15) * 3600000);
  const sun = solarPosition(JAN_NOON, LAT, LNG);

  const southFacing = computeSurface(syntheticGrid(plane(0, grade(22)), { size: SIZE }));
  const northFacing = computeSurface(syntheticGrid(plane(0, -grade(22)), { size: SIZE }));
  const insolationOf = (s: SurfaceField): Float32Array => slopeInsolation(s, sun);

  const SOUTH_WIND = 180;

  it('is bit-identical to leeward-only when no season is supplied', () => {
    const base = beddingLikelihood(southFacing, { windFromDeg: SOUTH_WIND });
    const n = base.length;
    // Warm temperature: the solar weight is exactly zero, so even a wildly
    // different insolation field may not move a single bit. Anything less than
    // exact equality means October output silently depends on a season input.
    for (const field of [new Float32Array(n).fill(1), new Float32Array(n)]) {
      const warm = beddingLikelihood(southFacing, {
        windFromDeg: SOUTH_WIND,
        season: { temperatureC: 15, insolation: field },
      });
      for (let i = 0; i < n; i++) {
        expect(Object.is(warm[i], base[i]), `cell ${i}`).toBe(true);
      }
    }
  });

  it('without a season, a south wind still sends the user to the north face', () => {
    // Documenting the pure geometry, not endorsing it: on this wind the north
    // face IS the lee. That answer is right in October and wrong in January.
    const north = beddingLikelihood(northFacing, { windFromDeg: SOUTH_WIND })[CENTER];
    const south = beddingLikelihood(southFacing, { windFromDeg: SOUTH_WIND })[CENTER];
    expect(north).toBeGreaterThan(south);
  });

  it('on a cold January south wind, the south face outscores the north face', () => {
    // Four agencies prescribe south/west aspects for winter range. The snow
    // mechanism is real but modest: Lang & Gates 1985's means are SE face
    // 18.1 cm against NE face 21.7 cm, **1.20×** — not the 2.32× this comment
    // used to quote, which set a mean against the study's deepest single reading
    // (see `BEDDING_MAX_SOLAR_ASPECT_WEIGHT`). This test pins the *direction* of
    // the trade, not its magnitude: sending a hunter to the fully leeward north
    // slope in deep cold points at the coldest cell on the property and calls it
    // the safe pick.
    const cold = -12;
    const north = beddingLikelihood(northFacing, {
      windFromDeg: SOUTH_WIND,
      season: { temperatureC: cold, insolation: insolationOf(northFacing) },
    })[CENTER];
    const south = beddingLikelihood(southFacing, {
      windFromDeg: SOUTH_WIND,
      season: { temperatureC: cold, insolation: insolationOf(southFacing) },
    })[CENTER];
    expect(south).toBeGreaterThan(north);
  });

  it('leaves the October answer alone even when a temperature is supplied', () => {
    const mild = 12;
    const north = beddingLikelihood(northFacing, {
      windFromDeg: SOUTH_WIND,
      season: { temperatureC: mild, insolation: insolationOf(northFacing) },
    })[CENTER];
    const south = beddingLikelihood(southFacing, {
      windFromDeg: SOUTH_WIND,
      season: { temperatureC: mild, insolation: insolationOf(southFacing) },
    })[CENTER];
    expect(north).toBeGreaterThan(south);
  });

  it('rejects an insolation field that does not match the surface', () => {
    expect(() =>
      beddingLikelihood(southFacing, {
        windFromDeg: SOUTH_WIND,
        season: { temperatureC: -12, insolation: new Float32Array(7) },
      }),
    ).toThrow(/insolation/);
  });
});
