import { describe, expect, it } from 'vitest';
import {
  analyzeSelection,
  ASPECT_OCTANTS,
  binIndex,
  bucketRelativeToSolar,
  chiSquareCritical95,
  describeSelection,
  pressureTrendLabel,
  selectionRatioInterval,
  sightingsPerSit,
  SLOPE_BANDS,
} from './selection.js';

describe('binIndex', () => {
  it('assigns values to half-open bins', () => {
    expect(SLOPE_BANDS[binIndex(SLOPE_BANDS, 0)].label).toContain('Flat');
    expect(SLOPE_BANDS[binIndex(SLOPE_BANDS, 8)].label).toContain('Sidehill');
    expect(SLOPE_BANDS[binIndex(SLOPE_BANDS, 25)].label).toContain('Bedding');
    expect(SLOPE_BANDS[binIndex(SLOPE_BANDS, 89)].label).toContain('Very steep');
  });

  it('handles the aspect bin that wraps across north', () => {
    // 350° and 10° are both north; a naive from/from<to check misses one.
    expect(ASPECT_OCTANTS[binIndex(ASPECT_OCTANTS, 350)].label).toBe('N');
    expect(ASPECT_OCTANTS[binIndex(ASPECT_OCTANTS, 10)].label).toBe('N');
    expect(ASPECT_OCTANTS[binIndex(ASPECT_OCTANTS, 180)].label).toBe('S');
  });

  it('returns -1 for out-of-range values', () => {
    expect(binIndex(SLOPE_BANDS, -5)).toBe(-1);
  });
});

describe('analyzeSelection', () => {
  it('does not mistake abundance for preference', () => {
    // The core case. 90% of the property is flat, and 90% of sightings are on
    // flat ground. A raw histogram screams "deer love flat ground"; the
    // selection ratio correctly says they use it exactly as available.
    const used = [
      ...Array(90).fill(4), // flat
      ...Array(10).fill(25), // bedding grade
    ];
    const available = [...Array(900).fill(4), ...Array(100).fill(25)];

    const r = analyzeSelection({
      metric: 'slope',
      bins: SLOPE_BANDS,
      usedValues: used,
      availableValues: available,
    });

    const flat = r.bins.find((b) => b.label.includes('Flat'))!;
    expect(flat.count).toBe(90);
    expect(flat.selectionRatio).toBeCloseTo(1, 2);
    expect(r.significant).toBe(false);
  });

  it('detects genuine preference for a scarce terrain type', () => {
    // Only 10% of the ground is bedding grade, but half the sightings are there.
    const used = [...Array(50).fill(4), ...Array(50).fill(25)];
    const available = [...Array(900).fill(4), ...Array(100).fill(25)];

    const r = analyzeSelection({
      metric: 'slope',
      bins: SLOPE_BANDS,
      usedValues: used,
      availableValues: available,
    });

    const bedding = r.bins.find((b) => b.label.includes('Bedding'))!;
    expect(bedding.selectionRatio).toBeGreaterThan(4);
    expect(r.significant).toBe(true);
  });

  it('accepts pre-computed availability shares', () => {
    const r = analyzeSelection({
      metric: 'slope',
      bins: SLOPE_BANDS,
      usedValues: [...Array(20).fill(25)],
      availableShares: [0.9, 0.05, 0.05, 0, 0],
    });
    const bedding = r.bins.find((b) => b.label.includes('Bedding'))!;
    expect(bedding.selectionRatio).toBeCloseTo(20, 3);
  });

  it('leaves the ratio undefined for bins with no available area', () => {
    const r = analyzeSelection({
      metric: 'slope',
      bins: SLOPE_BANDS,
      usedValues: [4, 4, 4],
      availableShares: [1, 0, 0, 0, 0],
    });
    expect(r.bins[1].selectionRatio).toBeUndefined();
  });

  it('declines to report significance when expected counts are too small', () => {
    // Six observations across five bins: chi-square is not trustworthy here,
    // and claiming significance would mislead the user into acting on noise.
    const r = analyzeSelection({
      metric: 'slope',
      bins: SLOPE_BANDS,
      usedValues: [4, 12, 25, 35, 50, 4],
      availableShares: [0.2, 0.2, 0.2, 0.2, 0.2],
    });
    expect(r.significant).toBeUndefined();
  });

  it('ignores non-finite observations', () => {
    const r = analyzeSelection({
      metric: 'slope',
      bins: SLOPE_BANDS,
      usedValues: [4, NaN, 25, Infinity],
      availableShares: [0.5, 0.2, 0.3, 0, 0],
    });
    expect(r.sampleSize).toBe(2);
  });
});

describe('chiSquareCritical95', () => {
  it('matches published table values', () => {
    expect(chiSquareCritical95(1)).toBeCloseTo(3.841, 3);
    expect(chiSquareCritical95(4)).toBeCloseTo(9.488, 3);
    expect(chiSquareCritical95(10)).toBeCloseTo(18.307, 3);
  });

  it('approximates beyond the table without discontinuity', () => {
    const at30 = chiSquareCritical95(30);
    const at31 = chiSquareCritical95(31);
    expect(at31).toBeGreaterThan(at30);
    expect(at31 - at30).toBeLessThan(3);
  });
});

describe('selectionRatioInterval', () => {
  it('gives a wide interval on a tiny sample', () => {
    const ci = selectionRatioInterval(3, 20, 0.1)!;
    expect(ci.lower).toBeLessThan(1);
    expect(ci.upper).toBeGreaterThan(3);
  });

  it('tightens as the sample grows', () => {
    const small = selectionRatioInterval(3, 20, 0.1)!;
    const large = selectionRatioInterval(150, 1000, 0.1)!;
    expect(large.upper - large.lower).toBeLessThan(small.upper - small.lower);
  });

  it('is undefined with no observations in the bin', () => {
    expect(selectionRatioInterval(0, 20, 0.1)).toBeUndefined();
  });
});

describe('describeSelection', () => {
  it('refuses to read a pattern from a tiny sample', () => {
    const r = analyzeSelection({
      metric: 'slope',
      bins: SLOPE_BANDS,
      usedValues: [4, 25, 25],
      availableShares: [0.5, 0.2, 0.3, 0, 0],
    });
    expect(describeSelection(r)).toMatch(/too few/i);
  });

  it('says so plainly when the pattern is just the terrain mix', () => {
    const r = analyzeSelection({
      metric: 'slope',
      bins: SLOPE_BANDS,
      usedValues: [...Array(90).fill(4), ...Array(10).fill(25)],
      availableShares: [0.9, 0, 0.1, 0, 0],
    });
    expect(describeSelection(r)).toMatch(/no clear pattern/i);
  });

  it('names the most-selected bin when the evidence supports it', () => {
    const r = analyzeSelection({
      metric: 'slope',
      bins: SLOPE_BANDS,
      usedValues: [...Array(50).fill(4), ...Array(50).fill(25)],
      availableValues: [...Array(900).fill(4), ...Array(100).fill(25)],
    });
    expect(describeSelection(r)).toMatch(/Bedding/);
    expect(describeSelection(r)).toMatch(/more than its share/);
  });
});

describe('bucketRelativeToSolar', () => {
  it('bins observations by offset from the solar reference, not clock time', () => {
    const sunrise = new Date('2026-11-15T12:30:00Z');
    const times = [
      new Date('2026-11-15T12:30:00Z'), // at sunrise
      new Date('2026-11-15T12:35:00Z'), // +5 min
      new Date('2026-11-15T13:30:00Z'), // +60 min
      new Date('2026-11-15T11:30:00Z'), // -60 min
    ];
    const out = bucketRelativeToSolar(times, times.map(() => sunrise), 30, 120);
    const at0 = out.find((b) => b.minutesFromSunrise === 0)!;
    expect(at0.count).toBe(2);
    expect(out.find((b) => b.minutesFromSunrise === 60)!.count).toBe(1);
    expect(out.find((b) => b.minutesFromSunrise === -60)!.count).toBe(1);
  });

  it('drops observations outside the span and rows with no solar reference', () => {
    const sunrise = new Date('2026-11-15T12:30:00Z');
    const times = [new Date('2026-11-15T20:00:00Z'), new Date('2026-11-15T12:30:00Z')];
    const out = bucketRelativeToSolar(times, [sunrise, null], 30, 120);
    expect(out.reduce((s, b) => s + b.count, 0)).toBe(0);
  });
});

describe('pressureTrendLabel', () => {
  it('labels the bands the literature distinguishes', () => {
    expect(pressureTrendLabel(-4)).toBe('falling fast');
    expect(pressureTrendLabel(-1.5)).toBe('falling');
    expect(pressureTrendLabel(0)).toBe('steady');
    expect(pressureTrendLabel(2)).toBe('rising');
    expect(pressureTrendLabel(5)).toBe('rising fast');
    expect(pressureTrendLabel(undefined)).toBe('unknown');
  });
});

describe('sightingsPerSit', () => {
  it('normalises by effort rather than reporting raw counts', () => {
    // 6 sightings in 12 sits is a weaker signal than 4 in 4.
    expect(sightingsPerSit(6, 12)).toBe(0.5);
    expect(sightingsPerSit(4, 4)).toBe(1);
  });

  it('is undefined with no sits logged', () => {
    expect(sightingsPerSit(5, 0)).toBeUndefined();
  });
});
