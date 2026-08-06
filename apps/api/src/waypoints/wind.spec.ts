import { describe, expect, it } from 'vitest';
import { azimuthOctant } from './waypoints.module';

describe('azimuthOctant', () => {
  it('maps cardinal and intercardinal bearings', () => {
    expect(azimuthOctant(0)).toBe('N');
    expect(azimuthOctant(45)).toBe('NE');
    expect(azimuthOctant(90)).toBe('E');
    expect(azimuthOctant(180)).toBe('S');
    expect(azimuthOctant(270)).toBe('W');
    expect(azimuthOctant(315)).toBe('NW');
  });

  it('wraps around north rather than falling off the end', () => {
    // A NNW wind of 350° must read as N, not as an out-of-range index. This is
    // the value compared against a stand's `huntableWinds` list, so a wrong
    // octant here tells a hunter a burned stand is clean.
    expect(azimuthOctant(350)).toBe('N');
    expect(azimuthOctant(359.9)).toBe('N');
    expect(azimuthOctant(360)).toBe('N');
  });

  it('normalises out-of-range and negative bearings', () => {
    expect(azimuthOctant(-45)).toBe('NW');
    expect(azimuthOctant(720)).toBe('N');
    expect(azimuthOctant(405)).toBe('NE');
  });

  it('rounds to the nearest octant at the boundaries', () => {
    expect(azimuthOctant(22)).toBe('N');
    expect(azimuthOctant(23)).toBe('NE');
  });
});
