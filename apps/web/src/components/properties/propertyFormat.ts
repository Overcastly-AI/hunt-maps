import { GameSpecies, RutPhase } from '@hunt-maps/shared';
import type { ChipTone } from '@hunt-maps/design';
import { ApiError, type ApiErrorKind } from '../../lib/api';
import type { PropertyRutReading } from '../../lib/api/types';

/**
 * Lowercase, mid-sentence species names for the rut refusal ("No rut model
 * for elk"). Deliberately its own small map rather than reusing
 * `components/observations/meta.ts`'s `SPECIES_LABEL` — that one is keyed on
 * `WireSpecies` (Prisma's `SCREAMING_SNAKE_CASE`, per `lib/api/types.ts`'s
 * header comment), while `RutUnsupported.species` is `@hunt-maps/shared`'s
 * `GameSpecies` (lowercase `snake_case`). The two enums are not the same type
 * and mixing their casing at a lookup site is exactly the kind of silent
 * drift that comment warns about.
 */
const GAME_SPECIES_LABEL: Record<GameSpecies, string> = {
  [GameSpecies.Whitetail]: 'whitetail',
  [GameSpecies.Mule]: 'mule deer',
  [GameSpecies.Elk]: 'elk',
  [GameSpecies.Moose]: 'moose',
  [GameSpecies.Blacktail]: 'blacktail',
  [GameSpecies.Pronghorn]: 'pronghorn',
  [GameSpecies.Bear]: 'bear',
  [GameSpecies.Turkey]: 'turkey',
  [GameSpecies.Hog]: 'hog',
  [GameSpecies.Other]: 'that species',
};

const RUT_PHASE_LABEL: Record<RutPhase, string> = {
  [RutPhase.OffSeason]: 'Off-season',
  [RutPhase.PreRut]: 'Pre-rut',
  [RutPhase.Seeking]: 'Seeking',
  [RutPhase.Chasing]: 'Chasing',
  [RutPhase.PeakBreeding]: 'Peak breeding',
  [RutPhase.PostRut]: 'Post-rut',
  [RutPhase.SecondRut]: 'Second rut',
  [RutPhase.LateSeason]: 'Late season',
};

export function rutPhaseLabel(phase: RutPhase): string {
  return RUT_PHASE_LABEL[phase] ?? phase;
}

/**
 * Buckets `@hunt-maps/shared`'s `rutConfidence(latitude)` (0..1) into a
 * qualitative read rather than a raw figure.
 *
 * `readRut`'s own doc comment says this number belongs "next to the phase
 * label" — but a bare "0.65" answers a question nobody watching a rut phase
 * chip asked, and `CLAUDE.md` is explicit that a number never stands alone
 * where a confidence matters. This is deliberately a *different* axis from
 * `packages/design`'s `Confidence` primitive: that one grades whether a
 * *biological parameter* is measured, inferred, doctrine or assumed
 * (`docs/EVIDENCE.md`); this grades how reliable the *phase-timing model* is
 * at this property's latitude (southern herds breed later and over a much
 * flatter window, so the calendar answer itself gets fuzzier, not any less
 * measured). Reusing `Confidence`'s grade vocabulary for a different kind of
 * uncertainty would be the exact category error `CLAUDE.md` calls out.
 */
export function rutConfidenceLabel(confidence: number): { label: string; tone: ChipTone } {
  if (confidence >= 0.8) return { label: 'High confidence', tone: 'ok' };
  if (confidence >= 0.5) return { label: 'Moderate confidence', tone: 'warn' };
  return { label: 'Low confidence — rut timing is more variable this far south', tone: 'warn' };
}

/** A real, renderable rut phase — `RutReading` formatted for display. */
export interface FormattedRutReading {
  supported: true;
  phase: string;
  note: string;
  confidence: { label: string; tone: ChipTone };
}

/**
 * The refusal, formatted for display — `RutUnsupported` (R83, `docs/EVIDENCE.md`
 * Pass 7). Carries no `phase`/`confidence` by construction, matching the wire
 * type it is built from: there is nothing here for a careless render to fall
 * back to.
 */
export interface FormattedRutUnsupported {
  supported: false;
  /** Short heading, safe to render directly — "No rut model for elk." */
  headline: string;
  /** The full, honest reason, from `RutUnsupported.reason`. */
  reason: string;
}

export type FormattedRut = FormattedRutReading | FormattedRutUnsupported;

/**
 * Formats `PropertiesService.propertyRut()`'s result for a screen.
 *
 * The `supported` discriminant on the input (`RutResult`) is preserved on the
 * output on purpose, rather than collapsed into one shape — a caller that
 * reaches for `.phase` on the `supported: false` branch fails to compile,
 * which is the whole point of R83's refusal: there must be no path, careless
 * or otherwise, from "this model has no basis for this species" to a phase
 * label appearing on screen anyway.
 */
export function formatRut(rut: PropertyRutReading | null): FormattedRut | null {
  if (!rut) return null;
  if (!rut.supported) {
    return {
      supported: false,
      headline: `No rut model for ${GAME_SPECIES_LABEL[rut.species] ?? rut.species}`,
      reason: rut.reason,
    };
  }
  return {
    supported: true,
    phase: rutPhaseLabel(rut.phase),
    note: rut.note,
    confidence: rutConfidenceLabel(rut.confidence),
  };
}

/** `123.4 ha · 305.1 ac`, or a plain-language "not yet known" when the server has not computed an area yet (no boundary saved). */
export function formatArea(areaHectares: number | null): string {
  if (areaHectares === null) return 'Area not yet known — no boundary saved.';
  const acres = areaHectares * 2.4710538147;
  return `${areaHectares.toFixed(1)} ha · ${acres.toFixed(1)} ac`;
}

/** A short, honest read of an `ApiError` for a list/detail screen — never "log in again" for a connectivity failure. */
export function describePropertiesError(err: unknown): {
  tone: 'warn' | 'danger';
  message: string;
} {
  if (err instanceof ApiError) {
    const kind: ApiErrorKind = err.kind;
    if (kind === 'network') {
      return {
        tone: 'warn',
        message: 'Could not reach the server. Showing what was last loaded, if anything.',
      };
    }
    if (kind === 'auth') {
      return {
        tone: 'warn',
        message: 'Your session needs refreshing. Sign in again to see your properties.',
      };
    }
    if (kind === 'forbidden') {
      return { tone: 'danger', message: 'You do not have access to this property.' };
    }
    if (kind === 'not_found') {
      return { tone: 'danger', message: 'This property was not found — it may have been deleted.' };
    }
    return { tone: 'danger', message: err.message };
  }
  return { tone: 'danger', message: 'Something went wrong loading your properties.' };
}
