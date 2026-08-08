/**
 * Moon phase — captured automatically because it is one of the few
 * `Observation` conditions fields (`temperatureC`, `pressureHpa`,
 * `windSpeedKph`, `moonPhase`, ...) this pass can fill in without a weather
 * API integration, which is out of `components/observations/**`'s territory.
 * CLAUDE.md's own rule on capture-at-write-time applies here too:
 * reconstructing what the moon was doing on a given night, months later, is
 * unreliable — capturing it now costs nothing.
 *
 * **This is deterministic astronomy, not a hunting model.** CLAUDE.md is
 * explicit that rut phase is photoperiod, never lunar, and that a lunar
 * *predictor* would make every downstream analytic worse — that rule is about
 * using moon phase to *predict* deer behaviour, which nothing here does. This
 * function only records a fact about the sky so a future, properly
 * evidence-graded analysis can test its own hypothesis against real data
 * instead of nothing. No `Confidence` chip applies to it for the same reason
 * none applies to `temperatureC`: it is a measurement, not a claim.
 *
 * Synodic-month approximation (29.530588853 days) anchored to a known new
 * moon (2000-01-06 18:14 UTC, the reference epoch every popular
 * implementation of this algorithm uses). Accurate to a fraction of a day
 * over centuries, which is far tighter than this field needs.
 */

const SYNODIC_MONTH_DAYS = 29.530588853;
const KNOWN_NEW_MOON_UTC = Date.UTC(2000, 0, 6, 18, 14, 0);

/** Fraction of the way through the current lunar cycle: 0 = new moon, 0.5 = full moon, approaching 1 = waning back to new. */
export function moonPhase(at: Date): number {
  const daysSince = (at.getTime() - KNOWN_NEW_MOON_UTC) / 86_400_000;
  const cycles = daysSince / SYNODIC_MONTH_DAYS;
  const frac = cycles - Math.floor(cycles);
  return frac;
}

const MOON_LABELS = [
  'New moon',
  'Waxing crescent',
  'First quarter',
  'Waxing gibbous',
  'Full moon',
  'Waning gibbous',
  'Last quarter',
  'Waning crescent',
] as const;

export function moonPhaseLabel(phase: number): string {
  const idx = Math.round(phase * 8) % 8;
  return MOON_LABELS[idx];
}
