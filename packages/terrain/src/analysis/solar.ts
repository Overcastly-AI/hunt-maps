/**
 * Solar geometry and slope insolation.
 *
 * ## Why a hunting app needs a solar model
 *
 * Two hard behavioural facts drive stand placement, and both are solar:
 *
 * 1. **Cold-weather bedding follows the sun.** Once temperatures drop, deer bed
 *    on slopes that catch early and sustained sun — in the northern hemisphere
 *    that means south-through-southeast faces, and *which* face wins shifts
 *    through the season as declination changes. A static "south-facing" layer is
 *    wrong by November; a date-aware insolation layer is not.
 * 2. **Thermals are driven by differential heating.** A slope that goes into sun
 *    at 07:10 starts its upslope thermal then, while the shaded face across the
 *    draw is still sinking. That timing difference is what blows a morning sit,
 *    and it is computable.
 *
 * The solar position routine is NOAA's, accurate to well under a degree for any
 * date this century — far tighter than the terrain data it is applied to.
 */

import type { SurfaceField } from './surface.js';

export interface SolarPosition {
  /** Degrees above the horizon; negative when the sun is down. */
  altitude: number;
  /** Degrees clockwise from north. */
  azimuth: number;
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Julian day from a JS Date (UTC). */
export function julianDay(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/**
 * NOAA solar position for a moment and place.
 * `date` is absolute time (UTC); longitude is signed east-positive.
 */
export function solarPosition(date: Date, latitude: number, longitude: number): SolarPosition {
  const jd = julianDay(date);
  const n = jd - 2451545.0;
  const T = n / 36525;

  // Geometric mean longitude and anomaly.
  const L0 = mod360(280.46646 + T * (36000.76983 + T * 0.0003032));
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const Mrad = M * RAD;

  // Equation of centre → true longitude → apparent longitude.
  const C =
    Math.sin(Mrad) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mrad) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * Mrad) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);

  // Obliquity of the ecliptic.
  const seconds = 21.448 - T * (46.815 + T * (0.00059 - T * 0.001813));
  const e0 = 23 + (26 + seconds / 60) / 60;
  const eps = e0 + 0.00256 * Math.cos(omega * RAD);

  const declination = Math.asin(Math.sin(eps * RAD) * Math.sin(appLong * RAD)) * DEG;

  // Equation of time (minutes).
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eccent = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const eqTime =
    4 *
    DEG *
    (y * Math.sin(2 * L0 * RAD) -
      2 * eccent * Math.sin(Mrad) +
      4 * eccent * y * Math.sin(Mrad) * Math.cos(2 * L0 * RAD) -
      0.5 * y * y * Math.sin(4 * L0 * RAD) -
      1.25 * eccent * eccent * Math.sin(2 * Mrad));

  // True solar time → hour angle.
  const utcMinutes =
    date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolarTime = mod(utcMinutes + eqTime + 4 * longitude, 1440);
  const hourAngle = trueSolarTime / 4 < 0 ? trueSolarTime / 4 + 180 : trueSolarTime / 4 - 180;

  const latRad = latitude * RAD;
  const decRad = declination * RAD;
  const haRad = hourAngle * RAD;

  const cosZenith =
    Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZenith))) * DEG;
  const altitude = 90 - zenith;

  let azimuth: number;
  const denom = Math.cos(latRad) * Math.sin(zenith * RAD);
  if (Math.abs(denom) > 1e-9) {
    const cosAz =
      (Math.sin(latRad) * Math.cos(zenith * RAD) - Math.sin(decRad)) / denom;
    azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz))) * DEG;
    azimuth = hourAngle > 0 ? mod360(azimuth + 180) : mod360(540 - azimuth);
  } else {
    azimuth = latitude > 0 ? 180 : 0;
  }

  return { altitude, azimuth };
}

/**
 * Direct-beam incidence on each cell for a given sun position, 0..1.
 *
 * `cos(i) = cos(slope)·sin(alt) + sin(slope)·cos(alt)·cos(azSun − aspect)`
 *
 * Self-shadowing (a ridge blocking the low sun from the bench behind it) is
 * handled separately by `castShadows` — a slope can face the sun perfectly and
 * still be in shade at 07:00, which is exactly the case that matters.
 */
export function slopeInsolation(surface: SurfaceField, sun: SolarPosition): Float32Array {
  const n = surface.slope.length;
  const out = new Float32Array(n);
  if (sun.altitude <= 0) return out;

  const altRad = sun.altitude * RAD;
  const sinAlt = Math.sin(altRad);
  const cosAlt = Math.cos(altRad);

  for (let i = 0; i < n; i++) {
    const slopeDeg = surface.slope[i];
    if (!Number.isFinite(slopeDeg)) {
      out[i] = NaN;
      continue;
    }
    const slopeRad = slopeDeg * RAD;
    const aspect = surface.aspect[i];
    // A flat cell has no aspect; incidence collapses to sin(altitude).
    const cosDelta = aspect < 0 ? 1 : Math.cos((sun.azimuth - aspect) * RAD);
    const cosI = Math.cos(slopeRad) * sinAlt + Math.sin(slopeRad) * cosAlt * cosDelta;
    out[i] = Math.max(0, cosI);
  }
  return out;
}

/**
 * Cast terrain shadows for a sun position. Returns 1 where lit, 0 where shaded.
 *
 * Ray-marches toward the sun accumulating the horizon angle. Early low-sun
 * shadow is the single biggest driver of where a cold-front morning's first
 * warmth lands, so this is not a cosmetic layer.
 */
export function castShadows(
  heightAt: (x: number, y: number) => number,
  width: number,
  height: number,
  cellSize: number,
  sun: SolarPosition,
  maxRadiusCells = 64,
): Uint8Array {
  const out = new Uint8Array(width * height);
  if (sun.altitude <= 0) return out;

  const azRad = sun.azimuth * RAD;
  // Step toward the sun: east = sin(az), north = cos(az); rows increase south.
  const dx = Math.sin(azRad);
  const dy = -Math.cos(azRad);
  const tanAlt = Math.tan(sun.altitude * RAD);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const z0 = heightAt(x, y);
      if (!Number.isFinite(z0)) continue;
      let lit = 1;
      for (let r = 1; r <= maxRadiusCells; r++) {
        const zr = heightAt(Math.round(x + dx * r), Math.round(y + dy * r));
        if (!Number.isFinite(zr)) continue;
        if (zr - z0 > r * cellSize * tanAlt) {
          lit = 0;
          break;
        }
      }
      out[y * width + x] = lit;
    }
  }
  return out;
}

/**
 * Accumulated insolation across a day, sampled every `stepMinutes`.
 *
 * This is the layer that answers "which bench gets sun longest in late
 * season" — the question that actually predicts December bedding.
 */
export function dailyInsolation(
  surface: SurfaceField,
  latitude: number,
  longitude: number,
  date: Date,
  stepMinutes = 30,
): Float32Array {
  const n = surface.slope.length;
  const acc = new Float32Array(n);
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0),
  );
  const steps = Math.floor(1440 / stepMinutes);

  for (let s = 0; s < steps; s++) {
    const t = new Date(start.getTime() + s * stepMinutes * 60000);
    const sun = solarPosition(t, latitude, longitude);
    if (sun.altitude <= 0) continue;
    const inc = slopeInsolation(surface, sun);
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(inc[i])) acc[i] += inc[i] * (stepMinutes / 60);
    }
  }
  return acc;
}

/**
 * Sunrise and sunset (as absolute UTC instants) for the **local** day
 * containing `date`.
 *
 * The window has to be anchored on local midnight, not UTC midnight. Scanning
 * a UTC day at, say, −84° longitude picks up the *previous* local evening's
 * sunset at 00:57 UTC before that morning's 12:10 UTC sunrise, and returns a
 * negative day length. Every North American hunting property is far enough from
 * Greenwich for that to bite, and the thermal-phase model consumes these times
 * directly — a flipped pair would tell a user their evening sit has rising
 * thermals.
 *
 * Local midnight in UTC is offset by `−longitude / 15` hours (mean solar time,
 * not civil time — deliberately, since thermals track the sun, not the tz
 * database).
 */
export function sunTimes(
  date: Date,
  latitude: number,
  longitude: number,
): { sunrise: Date | null; sunset: Date | null } {
  const utcMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const dayStart = utcMidnight - (longitude / 15) * 3600000;

  let sunrise: Date | null = null;
  let sunset: Date | null = null;
  let prev = solarPosition(new Date(dayStart), latitude, longitude).altitude;

  for (let m = 10; m <= 1440; m += 10) {
    const t = new Date(dayStart + m * 60000);
    const alt = solarPosition(t, latitude, longitude).altitude;
    if (prev < 0 && alt >= 0 && !sunrise) sunrise = refine(dayStart, m - 10, m, true);
    if (prev >= 0 && alt < 0 && !sunset) sunset = refine(dayStart, m - 10, m, false);
    prev = alt;
  }
  return { sunrise, sunset };

  function refine(base: number, lo: number, hi: number, rising: boolean): Date {
    for (let k = 0; k < 20; k++) {
      const mid = (lo + hi) / 2;
      const alt = solarPosition(new Date(base + mid * 60000), latitude, longitude).altitude;
      const above = alt >= 0;
      if (above === rising) hi = mid;
      else lo = mid;
    }
    return new Date(base + ((lo + hi) / 2) * 60000);
  }
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}
function mod360(a: number): number {
  return mod(a, 360);
}
