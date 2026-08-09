import { describe, expect, it } from 'vitest';
import { BEDDING_RAMP_DOMAIN_MAX, stretchToUnit } from './rampDomains';

describe('stretchToUnit', () => {
  it('maps 0 to 0 and the domain max to 1', () => {
    expect(stretchToUnit(0, 0.15)).toBe(0);
    expect(stretchToUnit(0.15, 0.15)).toBe(1);
  });

  it('clamps values above the domain rather than exceeding [0, 1]', () => {
    // A future DEM scoring hotter than today's sample must still paint as
    // "fully saturated", not silently break the ramp's contract.
    expect(stretchToUnit(0.3, 0.15)).toBe(1);
  });

  it('clamps negative values to 0', () => {
    expect(stretchToUnit(-0.01, 0.15)).toBe(0);
  });

  it('passes non-finite values through unchanged, so voids stay transparent downstream', () => {
    expect(Number.isNaN(stretchToUnit(NaN, 0.15))).toBe(true);
  });

  it('never divides by a non-positive domain', () => {
    expect(stretchToUnit(0.05, 0)).toBe(0);
    expect(stretchToUnit(0.05, -1)).toBe(0);
  });

  it('the realised distribution measured in BACKLOG R32 lands well inside [0, 1] under the fixed domain', () => {
    // min 0.0000 max 0.1386 mean 0.0464 p50 0.0486 p90 0.0894 p99 0.1217
    expect(stretchToUnit(0.1386, BEDDING_RAMP_DOMAIN_MAX)).toBeCloseTo(0.924, 2);
    expect(stretchToUnit(0.0464, BEDDING_RAMP_DOMAIN_MAX)).toBeCloseTo(0.3093, 3);
    expect(stretchToUnit(0.1217, BEDDING_RAMP_DOMAIN_MAX)).toBeCloseTo(0.8113, 3);
  });
});
