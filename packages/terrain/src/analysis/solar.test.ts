import { describe, expect, it } from 'vitest';
import { dailyInsolation, slopeInsolation, solarPosition, sunTimes } from './solar.js';
import { computeSurface } from './surface.js';
import { centerIndex, plane, syntheticGrid } from '../testing/synthetic.js';

const SIZE = 21;
const CENTER = centerIndex(SIZE);

describe('solarPosition', () => {
  it('puts the sun overhead at the equator at local solar noon on the equinox', () => {
    // 2026-03-20, longitude 0 → solar noon ≈ 12:00 UTC.
    const sun = solarPosition(new Date('2026-03-20T12:07:00Z'), 0, 0);
    expect(sun.altitude).toBeGreaterThan(88);
  });

  it('puts the sun due south at solar noon in the northern mid-latitudes', () => {
    const sun = solarPosition(new Date('2026-11-15T17:00:00Z'), 40, -84);
    // Solar noon at -84° longitude is ~17:36 UTC; close enough to be near due south.
    expect(sun.altitude).toBeGreaterThan(0);
    expect(Math.abs(sun.azimuth - 180)).toBeLessThan(25);
  });

  it('reports the sun below the horizon at local midnight', () => {
    const sun = solarPosition(new Date('2026-11-15T05:00:00Z'), 40, -84);
    expect(sun.altitude).toBeLessThan(0);
  });

  it('is higher at the summer solstice than the winter solstice at 40°N', () => {
    const summer = solarPosition(new Date('2026-06-21T17:36:00Z'), 40, -84);
    const winter = solarPosition(new Date('2026-12-21T17:36:00Z'), 40, -84);
    expect(summer.altitude).toBeGreaterThan(winter.altitude + 40);
  });

  it('rises in the east and sets in the west', () => {
    const morning = solarPosition(new Date('2026-09-21T12:30:00Z'), 40, -84);
    const evening = solarPosition(new Date('2026-09-21T22:30:00Z'), 40, -84);
    expect(morning.azimuth).toBeGreaterThan(70);
    expect(morning.azimuth).toBeLessThan(130);
    expect(evening.azimuth).toBeGreaterThan(230);
    expect(evening.azimuth).toBeLessThan(290);
  });
});

describe('sunTimes', () => {
  it('finds a sunrise before a sunset, both within the day', () => {
    const { sunrise, sunset } = sunTimes(new Date('2026-11-15T12:00:00Z'), 40, -84);
    expect(sunrise).toBeTruthy();
    expect(sunset).toBeTruthy();
    expect(sunrise!.getTime()).toBeLessThan(sunset!.getTime());
  });

  it('gives a shorter day in December than in June at 40°N', () => {
    const dec = sunTimes(new Date('2026-12-21T12:00:00Z'), 40, -84);
    const jun = sunTimes(new Date('2026-06-21T12:00:00Z'), 40, -84);
    const len = (t: ReturnType<typeof sunTimes>) => t.sunset!.getTime() - t.sunrise!.getTime();
    expect(len(dec)).toBeLessThan(len(jun));
    // Roughly 9h vs 15h at this latitude.
    expect(len(dec) / 3600000).toBeGreaterThan(8);
    expect(len(dec) / 3600000).toBeLessThan(10.5);
  });
});

describe('slopeInsolation', () => {
  it('gives a south-facing slope more sun than a north-facing one at 40°N in November', () => {
    // A plane rising to the north faces south; rising to the south faces north.
    const south = computeSurface(syntheticGrid(plane(0, 0.4), { size: SIZE }));
    const north = computeSurface(syntheticGrid(plane(0, -0.4), { size: SIZE }));
    const sun = solarPosition(new Date('2026-11-15T17:30:00Z'), 40, -84);

    const s = slopeInsolation(south, sun)[CENTER];
    const n = slopeInsolation(north, sun)[CENTER];
    expect(s).toBeGreaterThan(n);
  });

  it('is zero everywhere when the sun is below the horizon', () => {
    const surface = computeSurface(syntheticGrid(plane(0, 0.4), { size: SIZE }));
    const sun = solarPosition(new Date('2026-11-15T05:00:00Z'), 40, -84);
    const inc = slopeInsolation(surface, sun);
    expect(inc.every((v) => v === 0)).toBe(true);
  });

  it('favours east faces in the morning and west faces in the evening', () => {
    const east = computeSurface(syntheticGrid(plane(-0.4, 0), { size: SIZE }));
    const west = computeSurface(syntheticGrid(plane(0.4, 0), { size: SIZE }));

    const morning = solarPosition(new Date('2026-10-15T13:00:00Z'), 40, -84);
    const evening = solarPosition(new Date('2026-10-15T22:00:00Z'), 40, -84);

    expect(slopeInsolation(east, morning)[CENTER]).toBeGreaterThan(
      slopeInsolation(west, morning)[CENTER],
    );
    expect(slopeInsolation(west, evening)[CENTER]).toBeGreaterThan(
      slopeInsolation(east, evening)[CENTER],
    );
  });
});

describe('dailyInsolation', () => {
  it('accumulates more total sun on a south face than a north face in late season', () => {
    const south = computeSurface(syntheticGrid(plane(0, 0.5), { size: SIZE }));
    const north = computeSurface(syntheticGrid(plane(0, -0.5), { size: SIZE }));
    const date = new Date('2026-12-01T12:00:00Z');

    const s = dailyInsolation(south, 40, -84, date, 60)[CENTER];
    const n = dailyInsolation(north, 40, -84, date, 60)[CENTER];
    expect(s).toBeGreaterThan(n * 2);
  });
});
