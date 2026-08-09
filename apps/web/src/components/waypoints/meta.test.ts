import { describe, expect, it } from 'vitest';
import { OCTANTS, octantFromDeg, suggestedWaypointName, waypointTypeMeta, WAYPOINT_TYPE_META } from './meta';

describe('WAYPOINT_TYPE_META', () => {
  it('has one row per Prisma WaypointType label, no more, no fewer', () => {
    const expected = [
      'STAND',
      'BLIND',
      'TRAIL_CAMERA',
      'FOOD_PLOT',
      'MINERAL_SITE',
      'WATER_SOURCE',
      'PARKING',
      'ACCESS_ROUTE',
      'PROPERTY_MARKER',
      'NOTE',
    ];
    expect(WAYPOINT_TYPE_META.map((m) => m.type).sort()).toEqual([...expected].sort());
  });

  it('every row carries a non-empty blurb — CLAUDE.md’s "explain, don’t just expose"', () => {
    for (const m of WAYPOINT_TYPE_META) {
      expect(m.blurb.length).toBeGreaterThan(10);
    }
  });

  it('only stands and blinds carry the wind-dependent fields', () => {
    for (const m of WAYPOINT_TYPE_META) {
      const hasWindFields = m.fields.includes('huntableWinds') || m.fields.includes('shootingLanes');
      expect(hasWindFields).toBe(m.type === 'STAND' || m.type === 'BLIND');
    }
  });

  it('only a trail camera carries a lens direction', () => {
    for (const m of WAYPOINT_TYPE_META) {
      expect(m.fields.includes('cameraDirection')).toBe(m.type === 'TRAIL_CAMERA');
    }
  });
});

describe('octantFromDeg', () => {
  it('maps the eight cardinal/intercardinal bearings', () => {
    expect(octantFromDeg(0)).toBe('N');
    expect(octantFromDeg(45)).toBe('NE');
    expect(octantFromDeg(90)).toBe('E');
    expect(octantFromDeg(180)).toBe('S');
    expect(octantFromDeg(315)).toBe('NW');
  });

  it('wraps a negative or >360 bearing correctly', () => {
    expect(octantFromDeg(-10)).toBe('N');
    expect(octantFromDeg(370)).toBe('N');
  });

  it('never produces anything outside the eight-member set', () => {
    for (let d = 0; d < 360; d += 7) {
      expect(OCTANTS).toContain(octantFromDeg(d));
    }
  });
});

describe('suggestedWaypointName', () => {
  it('counts only same-type waypoints, per-type numbering', () => {
    expect(suggestedWaypointName('STAND', 0)).toBe('Stand 1');
    expect(suggestedWaypointName('STAND', 2)).toBe('Stand 3');
    expect(suggestedWaypointName('TRAIL_CAMERA', 0)).toBe('Camera 1');
  });
});

describe('waypointTypeMeta', () => {
  it('throws on an unknown type rather than silently returning nothing', () => {
    // @ts-expect-error deliberately invalid for the test
    expect(() => waypointTypeMeta('NOT_A_TYPE')).toThrow();
  });
});
