/**
 * Coverage, in words.
 *
 * Kept apart from `coverage.ts` on purpose: that module decides what is true,
 * this one decides what we say, and the two have different failure modes. The
 * bug this whole feature exists to kill was a *wording* bug as much as a
 * measurement bug — "Offline ready — elevation for **this area** is stored on
 * this device" was a specific, checkable claim, and it was false for every view
 * except the one the tiles were downloaded for.
 *
 * Every string the user sees about offline state comes from here, so:
 *
 *  - there is exactly one branch that can produce a reassuring word, and it
 *    requires an actual `covered` measurement to reach it;
 *  - "checking" and "unavailable" have their own words rather than borrowing
 *    the last good answer;
 *  - a sampled figure is always marked `≈`, and never rounds to 100%.
 */

import type { CoverageResult, CoverageState } from './coverage';
import { DEM_MAX_ZOOM } from '../map/demTiles';

export interface CoverageDescription {
  /** Short enough for the sheet header chip. */
  chip: string;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
  /** Status is never carried by colour alone — a mark, then the words. */
  glyph: string;
  /** The full sentence, with the caveats the chip has no room for. */
  detail: string;
}

/**
 * Percent for display, pinned off both ends.
 *
 * A partial view that rounds to "100%" reads as covered and is the original lie
 * in a new costume; one that rounds to "0%" hides that some of this ground *is*
 * usable. `covered` and `empty` are separate states and are the only ones
 * allowed to say all or nothing.
 */
export function percentLabel(fraction: number): number {
  return Math.min(99, Math.max(1, Math.round(fraction * 100)));
}

export function describeCoverage(state: CoverageState | null): CoverageDescription {
  if (!state || state.kind === 'checking') {
    return {
      chip: 'Checking…',
      tone: 'neutral',
      glyph: '◌',
      detail: 'Checking which elevation tiles for this view are stored on this device.',
    };
  }

  if (state.kind === 'unavailable') {
    return {
      chip: 'Storage unreadable',
      tone: 'danger',
      glyph: '!',
      detail:
        `This device’s offline tile storage could not be read (${state.reason}), so we cannot ` +
        'tell you what is saved here. Treat this view as not downloaded until it can.',
    };
  }

  return describeResult(state.result);
}

function describeResult(r: CoverageResult): CoverageDescription {
  const volatileNote = r.volatile
    ? ' Stored in memory only — this will be gone after a reload.'
    : '';

  if (r.status === 'empty') {
    return {
      chip: 'Not downloaded',
      tone: 'warn',
      glyph: '○',
      detail:
        'None of this view’s elevation is on this device. Analysis layers here need a ' +
        `connection until you save this area. Checked ${countPhrase(r)} at zoom ${r.tileZoom}.`,
    };
  }

  if (r.status === 'covered') {
    return {
      chip: 'Covered',
      tone: 'ok',
      glyph: '●',
      detail:
        `Every elevation tile this view needs is on this device, so the analysis layers work ` +
        `here with no signal. Checked ${countPhrase(r)} at zoom ${r.tileZoom}` +
        (r.tileZoom >= DEM_MAX_ZOOM
          ? ' — the deepest zoom elevation is stored at, so zooming in needs nothing more.'
          : '; zooming in checks a deeper set of tiles.') +
        volatileNote,
    };
  }

  // status === 'partial'
  if (r.basis === 'detail') {
    return {
      chip: 'Detail missing',
      tone: 'warn',
      glyph: '◐',
      detail:
        `This view is covered at zoom ${r.tileZoom === DEM_MAX_ZOOM ? r.tileZoom : r.tileZoom}, ` +
        `but a sample of the deepest zoom (${DEM_MAX_ZOOM}) found only ${approx(r)}% of it ` +
        'stored. It works as you see it now; zoom in and parts of this ground will be blank.' +
        volatileNote,
    };
  }

  return {
    chip: `Partial — ${approx(r)}%`,
    tone: 'warn',
    glyph: '◐',
    detail:
      `Only ${approx(r)}% of this view’s elevation is on this device. The hatched area on the ` +
      'map is the part that is missing — it will be blank with no signal. ' +
      `Checked ${countPhrase(r)} at zoom ${r.tileZoom}.` +
      volatileNote,
  };
}

/** `≈43` when sampled, `43` when every needed tile was actually looked at. */
function approx(r: CoverageResult): string {
  return `${r.sampled ? '≈' : ''}${percentLabel(r.fraction)}`;
}

/**
 * How the count was arrived at, stated rather than implied.
 *
 * "43% of this view" from a 48-tile sample of 12,000 tiles is a different claim
 * from "43%" of an exhaustive count, and the user is entitled to know which one
 * they are being handed.
 */
function countPhrase(r: CoverageResult): string {
  return r.sampled
    ? `a ${r.probedTiles}-tile sample of ${r.neededTiles.toLocaleString()} tiles`
    : `all ${r.probedTiles} tiles`;
}
