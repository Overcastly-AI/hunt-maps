import { describe, expect, it } from 'vitest';
import {
  calibrateOffset,
  daysFromPeak,
  peakBreedingDayOfYear,
  readRut,
  rutConfidence,
  rutPhaseFor,
} from './rut.js';
import { RutPhase } from './domain.js';

const OHIO = { latitude: 39.7 };

describe('peakBreedingDayOfYear', () => {
  it('lands in mid-November across the northern range', () => {
    // DOY 319 is 15 November in a non-leap year.
    expect(peakBreedingDayOfYear(45)).toBe(319);
    expect(peakBreedingDayOfYear(42)).toBe(319);
  });

  it('shifts later toward the south', () => {
    expect(peakBreedingDayOfYear(30)).toBeGreaterThan(peakBreedingDayOfYear(42));
  });
});

describe('rutPhaseFor', () => {
  it('is peak breeding in mid-November in the Midwest', () => {
    expect(rutPhaseFor(new Date('2026-11-15T12:00:00Z'), OHIO)).toBe(RutPhase.PeakBreeding);
  });

  it('is chasing in the first week of November', () => {
    expect(rutPhaseFor(new Date('2026-11-07T12:00:00Z'), OHIO)).toBe(RutPhase.Chasing);
  });

  it('is seeking in late October', () => {
    expect(rutPhaseFor(new Date('2026-10-28T12:00:00Z'), OHIO)).toBe(RutPhase.Seeking);
  });

  it('is late season around Christmas', () => {
    expect(rutPhaseFor(new Date('2026-12-27T12:00:00Z'), OHIO)).toBe(RutPhase.LateSeason);
  });

  it('is off season in summer', () => {
    expect(rutPhaseFor(new Date('2026-07-04T12:00:00Z'), OHIO)).toBe(RutPhase.OffSeason);
  });

  it('does not move with the moon — same phase across a full lunar cycle offset', () => {
    // The whole point. If this ever starts varying, someone has wired a lunar
    // predictor into a photoperiod-driven process.
    const a = rutPhaseFor(new Date('2025-11-15T12:00:00Z'), OHIO);
    const b = rutPhaseFor(new Date('2026-11-15T12:00:00Z'), OHIO);
    const c = rutPhaseFor(new Date('2027-11-15T12:00:00Z'), OHIO);
    expect(a).toBe(RutPhase.PeakBreeding);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('respects a per-property calibration offset', () => {
    const early = rutPhaseFor(new Date('2026-11-08T12:00:00Z'), {
      ...OHIO,
      offsetDays: -7,
    });
    expect(early).toBe(RutPhase.PeakBreeding);
  });

  it('shifts six months for southern-hemisphere properties', () => {
    // 35°S peaks at DOY 325 mirrored six months → DOY 142 ≈ 22 May.
    const southern = { latitude: -35, southernHemisphere: true };
    expect(rutPhaseFor(new Date('2026-05-22T12:00:00Z'), southern)).toBe(
      RutPhase.PeakBreeding,
    );
    // ...and the equivalent northern date is firmly off-season there.
    expect(rutPhaseFor(new Date('2026-11-15T12:00:00Z'), southern)).toBe(RutPhase.OffSeason);
  });
});

describe('daysFromPeak', () => {
  it('is zero at peak and wraps across the year boundary', () => {
    expect(daysFromPeak(new Date('2026-11-15T12:00:00Z'), OHIO)).toBe(0);
    // Early January is ~50 days *after* the previous November's peak, not 315
    // days before the next one.
    const jan = daysFromPeak(new Date('2026-01-05T12:00:00Z'), OHIO);
    expect(jan).toBeGreaterThan(40);
    expect(jan).toBeLessThan(60);
  });
});

describe('rutConfidence', () => {
  it('is high in the north and low in the deep south', () => {
    expect(rutConfidence(44)).toBeGreaterThan(0.8);
    expect(rutConfidence(26)).toBeLessThan(0.3);
  });
});

describe('readRut', () => {
  it('warns that peak breeding is often the worst week to sit', () => {
    const r = readRut(new Date('2026-11-15T12:00:00Z'), OHIO);
    expect(r.phase).toBe(RutPhase.PeakBreeding);
    expect(r.note.toLowerCase()).toContain('lockdown');
  });

  it('calls chasing the highest-odds window', () => {
    const r = readRut(new Date('2026-11-07T12:00:00Z'), OHIO);
    expect(r.note.toLowerCase()).toContain('highest-odds');
  });

  it('carries confidence alongside the phase', () => {
    expect(readRut(new Date('2026-11-15T12:00:00Z'), { latitude: 27 }).confidence).toBeLessThan(
      0.5,
    );
  });
});

describe('calibrateOffset', () => {
  it('needs at least three observations', () => {
    expect(calibrateOffset([new Date('2026-11-05T12:00:00Z')], 39.7)).toBeUndefined();
  });

  it('returns ~0 when the user’s chasing observations match the regional model', () => {
    // Model centres chasing at 6 days before peak (DOY 319) → DOY 313 ≈ 9 Nov.
    const dates = ['2026-11-08', '2026-11-09', '2026-11-10'].map((d) => new Date(`${d}T12:00:00Z`));
    const offset = calibrateOffset(dates, 39.7)!;
    expect(Math.abs(offset)).toBeLessThanOrEqual(1);
  });

  it('detects a herd that genuinely runs early', () => {
    const dates = ['2026-11-01', '2026-11-02', '2026-11-03'].map((d) => new Date(`${d}T12:00:00Z`));
    const offset = calibrateOffset(dates, 39.7)!;
    expect(offset).toBeLessThan(-5);
  });

  it('refuses an implausible calibration rather than trusting bad labels', () => {
    const dates = ['2026-09-01', '2026-09-02', '2026-09-03'].map((d) => new Date(`${d}T12:00:00Z`));
    expect(calibrateOffset(dates, 39.7)).toBeUndefined();
  });
});
