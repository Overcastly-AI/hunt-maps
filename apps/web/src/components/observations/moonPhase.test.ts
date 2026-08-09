import { describe, expect, it } from 'vitest';
import { moonPhase, moonPhaseLabel } from './moonPhase';

describe('moonPhase', () => {
  it('reads ~0 at the reference new moon', () => {
    const phase = moonPhase(new Date(Date.UTC(2000, 0, 6, 18, 14, 0)));
    expect(phase).toBeCloseTo(0, 2);
  });

  it('reads ~0.5 at a known historical full moon', () => {
    // 2000-01-21 04:41 UTC was a documented full moon — roughly half a
    // synodic month after the reference new moon above.
    const phase = moonPhase(new Date(Date.UTC(2000, 0, 21, 4, 41, 0)));
    expect(phase).toBeGreaterThan(0.47);
    expect(phase).toBeLessThan(0.53);
  });

  it('wraps back toward 0 a full synodic month later', () => {
    const start = new Date(Date.UTC(2024, 5, 1));
    const later = new Date(start.getTime() + 29.530588853 * 86_400_000);
    expect(moonPhase(later)).toBeCloseTo(moonPhase(start), 1);
  });

  it('stays within [0, 1) for a range of dates', () => {
    for (let i = 0; i < 400; i += 17) {
      const p = moonPhase(new Date(Date.UTC(2026, 0, 1 + i)));
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(1);
    }
  });
});

describe('moonPhaseLabel', () => {
  it('labels the extremes and midpoint', () => {
    expect(moonPhaseLabel(0)).toBe('New moon');
    expect(moonPhaseLabel(0.5)).toBe('Full moon');
  });
});
