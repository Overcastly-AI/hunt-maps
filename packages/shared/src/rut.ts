/**
 * Rut phase modelling.
 *
 * ## Why this is a calendar function and not a moon function
 *
 * Whitetail breeding is triggered by **photoperiod**, and the research is
 * unusually consistent: peak breeding across the northern whitetail range falls
 * in a narrow window in mid-November, year after year, essentially regardless of
 * temperature, barometric pressure, or moon phase. Popular "rut predictor"
 * features keyed to lunar cycles are not supported by the data, and building one
 * would make every downstream analytic worse — an app that tells a hunter to
 * burn a vacation day on the wrong week has done real harm.
 *
 * What *does* move is latitude (southern herds breed later and over a longer,
 * flatter window) and, for a hunter, which *behaviour* is on display — seeking
 * and chasing are what put mature bucks on their feet in daylight, and those
 * precede peak breeding rather than coinciding with it.
 *
 * So: phase is a function of date and latitude, with a per-property offset a
 * user can calibrate from their own harvest and sighting history.
 */

import { GameSpecies, RutPhase } from './domain.js';

export interface RutModelOptions {
  /** Property latitude. Southern herds shift later and flatter. */
  latitude: number;
  /**
   * Per-property calibration in days, learned from the user's own logged
   * chasing/breeding observations. Local herds genuinely vary by several days.
   */
  offsetDays?: number;
  /** Southern hemisphere properties shift by six months. */
  southernHemisphere?: boolean;
  /**
   * Which species this reading is for. Defaults to `Whitetail` when omitted —
   * every existing caller that predates species-awareness (a property with no
   * declared target species, an observation logged before this field existed)
   * gets exactly today's behaviour, because today's behaviour *is* the
   * whitetail model.
   *
   * The calendar windows below (`WINDOWS`, `peakBreedingDayOfYear`) are a
   * photoperiod curve fitted to whitetail breeding data and nothing else —
   * see `docs/EVIDENCE.md` Pass 7. R83: at 45.5°N this model returns
   * `OffSeason` for the elk archery opener and peak bugling, and returns
   * `Chasing`/`PeakBreeding` five to nine weeks *after* elk actually finish
   * breeding — it is not merely uncalibrated for elk, it is inverted. Elk
   * rut is roughly a month earlier and materially shorter than whitetail's;
   * shifting this curve by a fixed offset and calling it "the elk model"
   * would fabricate a citation `docs/EVIDENCE.md` does not support. So any
   * species other than `Whitetail` gets a refusal (`RutUnsupported`), not a
   * guess.
   */
  species?: GameSpecies;
}

interface PhaseWindow {
  phase: RutPhase;
  /** Days relative to peak breeding. */
  from: number;
  to: number;
}

/**
 * Phase windows relative to peak breeding day.
 *
 * Seeking and chasing get the widest windows because they are the phases that
 * matter operationally: peak breeding is famously the *lockdown*, when mature
 * bucks are tending a doe in cover and daylight movement drops. Hunters
 * routinely misread "peak rut" as "best hunting", and the labels here are
 * chosen to push back on that.
 */
const WINDOWS: PhaseWindow[] = [
  { phase: RutPhase.OffSeason, from: -365, to: -60 },
  { phase: RutPhase.PreRut, from: -60, to: -21 },
  { phase: RutPhase.Seeking, from: -21, to: -10 },
  { phase: RutPhase.Chasing, from: -10, to: -2 },
  { phase: RutPhase.PeakBreeding, from: -2, to: 8 },
  { phase: RutPhase.PostRut, from: 8, to: 24 },
  { phase: RutPhase.SecondRut, from: 24, to: 38 },
  { phase: RutPhase.LateSeason, from: 38, to: 75 },
  { phase: RutPhase.OffSeason, from: 75, to: 365 },
];

/**
 * Day-of-year of peak breeding for a latitude.
 *
 * ~15 November (DOY 319) across the northern range, sliding later toward the
 * south. Below roughly 30°N the concept degrades — south Texas and Florida herds
 * breed over months rather than weeks — and callers should treat the phase as
 * low-confidence there. `rutConfidence` reports that.
 */
export function peakBreedingDayOfYear(latitude: number): number {
  const lat = Math.abs(latitude);
  if (lat >= 40) return 319; // ~15 Nov
  if (lat >= 34) return 319 + Math.round((40 - lat) * 1.2);
  // Southern herds: later and far more variable.
  return 326 + Math.round((34 - lat) * 3.5);
}

/**
 * How much to trust the phase at this latitude, 0..1.
 *
 * Surfaced in the UI next to the phase label. A confident "chasing" and a
 * low-confidence "chasing" should not look the same to someone deciding whether
 * to take the week off.
 */
export function rutConfidence(latitude: number): number {
  const lat = Math.abs(latitude);
  if (lat >= 38) return 0.9;
  if (lat >= 32) return 0.65;
  if (lat >= 28) return 0.4;
  return 0.2;
}

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((date.getTime() - start) / 86400000) + 1;
}

/** Days from `date` to peak breeding, signed, wrapped to [-182, 183]. */
export function daysFromPeak(date: Date, options: RutModelOptions): number {
  let peak = peakBreedingDayOfYear(options.latitude) + (options.offsetDays ?? 0);
  if (options.southernHemisphere) peak = ((peak + 182 - 1) % 365) + 1;

  let delta = dayOfYear(date) - peak;
  if (delta > 182) delta -= 365;
  if (delta < -182) delta += 365;
  return delta;
}

export function rutPhaseFor(date: Date, options: RutModelOptions): RutPhase {
  const delta = daysFromPeak(date, options);
  for (const w of WINDOWS) {
    if (delta >= w.from && delta < w.to) return w.phase;
  }
  return RutPhase.OffSeason;
}

export interface RutReading {
  /** Discriminant — always `true` here. See `RutUnsupported` for the other branch. */
  supported: true;
  phase: RutPhase;
  daysFromPeak: number;
  confidence: number;
  /** Short, honest guidance. */
  note: string;
}

/**
 * Returned instead of a `RutReading` for a species this model has no
 * evidentiary basis for (R83, `docs/EVIDENCE.md` Pass 7). Callers must
 * render this as "no rut model for {species}", never fall back to a phase.
 */
export interface RutUnsupported {
  supported: false;
  species: GameSpecies;
  /** Short, honest explanation, safe to surface directly. */
  reason: string;
}

export type RutResult = RutReading | RutUnsupported;

/**
 * Species this photoperiod curve is fitted to. See `RutModelOptions.species`
 * for why every other species refuses rather than guesses.
 */
const MODELLED_SPECIES = GameSpecies.Whitetail;

// Overload 1: no species, or the literal `GameSpecies.Whitetail`, resolves at
// compile time to a concrete `RutReading` — this is the shape every caller
// written before species-awareness existed already assumes, and it must stay
// bit-identical (R83).
export function readRut(
  date: Date,
  options: RutModelOptions & { species?: GameSpecies.Whitetail },
): RutReading;
// Overload 2: any other (or dynamically-typed) species must handle the
// refusal branch — the type system forces the `.supported` check.
export function readRut(date: Date, options: RutModelOptions): RutResult;
export function readRut(date: Date, options: RutModelOptions): RutResult {
  const species = options.species ?? GameSpecies.Whitetail;
  if (species !== MODELLED_SPECIES) {
    return {
      supported: false,
      species,
      reason: `No rut model for ${species} — this photoperiod curve is fitted to whitetail breeding data only (docs/EVIDENCE.md Pass 7). Shifting it by an offset would fabricate a citation, not model a different species.`,
    };
  }
  const delta = daysFromPeak(date, options);
  const phase = rutPhaseFor(date, options);
  return {
    supported: true,
    phase,
    daysFromPeak: delta,
    confidence: rutConfidence(options.latitude),
    note: PHASE_NOTES[phase],
  };
}

export const PHASE_NOTES: Record<RutPhase, string> = {
  [RutPhase.OffSeason]:
    'Patterns are food-driven and repeatable. The best time to scout, hang stands, and log sign — not to burn sits.',
  [RutPhase.PreRut]:
    'Bucks are still on a bed-to-feed pattern but expanding. Rubs and scrapes go in. Hunt the food-side entry, stay out of bedding.',
  [RutPhase.Seeking]:
    'Mature bucks start covering ground in daylight. Saddles, benches and pinch points between doe bedding areas are the play.',
  [RutPhase.Chasing]:
    'The highest-odds daylight window of the year. Sit all day near doe bedding; downwind of a saddle connecting two bedding areas is the classic setup.',
  [RutPhase.PeakBreeding]:
    'Lockdown. Bucks are tending does in cover and daylight movement drops — this is often the *worst* week to sit despite the name. Hunt thick cover, expect slow.',
  [RutPhase.PostRut]:
    'Bucks are worn down and returning to food. Shift back toward high-quality feed, hunt the afternoon.',
  [RutPhase.SecondRut]:
    'A short, weaker flurry as unbred does and fawns cycle. Watch doe groups on food; brief but real.',
  [RutPhase.LateSeason]:
    'Pure survival: food and thermal cover. South-facing slopes with sun and standing feed. Wind and pressure matter most now.',
};

/**
 * Calibrate the per-property offset from the user's own observations.
 *
 * Takes dates of logged chasing/breeding behaviour and returns the offset that
 * best centres the model on them. This is the feature that makes the rut model
 * *theirs* rather than a generic almanac — and it improves every season they
 * keep logging.
 */
export function calibrateOffset(
  chasingObservationDates: Date[],
  latitude: number,
): number | undefined {
  // Chasing is modelled as centred ~6 days before peak; align the median.
  if (chasingObservationDates.length < 3) return undefined;
  const CHASING_CENTER = -6;
  const deltas = chasingObservationDates
    .map((d) => dayOfYear(d) - peakBreedingDayOfYear(latitude))
    .map((d) => (d > 182 ? d - 365 : d < -182 ? d + 365 : d))
    .sort((a, b) => a - b);
  const mid = Math.floor(deltas.length / 2);
  const median = deltas.length % 2 === 0 ? (deltas[mid - 1] + deltas[mid]) / 2 : deltas[mid];
  const offset = Math.round(median - CHASING_CENTER);
  // Refuse implausible calibrations — more likely mislabelled observations
  // than a herd that breeds three weeks off the regional norm.
  return Math.abs(offset) > 14 ? undefined : offset;
}
