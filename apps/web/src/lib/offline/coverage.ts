/**
 * Per-viewport offline coverage.
 *
 * ## The defect this replaces
 *
 * The Layers sheet used to sample `store.stats().tileCount > 0` **once at
 * mount** and render the result behind the words "Offline ready — elevation for
 * *this area* is stored on this device". One tile anywhere on earth made every
 * view on earth read green, forever, including after panning five hundred
 * miles. A hunter reads that at the trailhead, walks in, and the analysis engine
 * has nothing to compute from — the exact failure CLAUDE.md names as the worst
 * this product has.
 *
 * The fix is not a better boolean. It is asking the real question — *are the
 * tiles this view is drawing from actually on this device* — every time the view
 * changes, and answering with a state that can say "I do not know yet".
 *
 * ## Why five states and not three
 *
 * `covered` / `partial` / `none` are the three answers the user asked for. The
 * other two exist because the alternative to admitting ignorance is defaulting,
 * and a default here is indistinguishable from the bug:
 *
 *  - `checking` — the view changed and the probe has not finished. Showing the
 *    previous view's answer during that window is precisely how a stale green
 *    survives a pan.
 *  - `unavailable` — the store could not be opened at all. There is no honest
 *    percentage to report, and "ready" would be a guess in the one direction
 *    that gets somebody hurt.
 *
 * ## What is counted and what is sampled
 *
 * A viewport needs roughly (width/256 + 1) × (height/256 + 1) tiles *regardless
 * of zoom*, because MapLibre picks the tile zoom to match screen resolution — a
 * phone is ~15 tiles, a 1440×900 desktop ~35, a 4K window ~160. So the normal
 * case is an exact count, every tile probed. {@link MAX_PROBES} caps the
 * pathological case (very large windows, very wide aspect ratios) with a 2D
 * stride sample; when that triggers, `sampled` is set and the UI must say the
 * percentage is approximate rather than pass an estimate off as a count.
 *
 * ## Neighbours are deliberately not counted
 *
 * `terrainProtocol` fetches each tile plus its eight neighbours, because the
 * gradient kernels need a one-pixel apron. A missing *neighbour* costs one seam
 * at the edge of the analysis; a missing *centre* is a blank tile. Coverage
 * reports the tiles the view draws, so it answers "will this view render", not
 * "will every pixel of it be seam-free". Inflating the set by a ring would
 * under-report coverage for every view whose downloaded region ends exactly at
 * the screen edge, which is most of them.
 */

import type { TileCoord } from '@hunt-maps/terrain';
import { demTileKey } from '../map/demTiles';
import type { TileStore, TileStoreStats } from './tileStore';

export type CoverageState = 'checking' | 'covered' | 'partial' | 'none' | 'unavailable';

export interface ViewportCoverage {
  state: CoverageState;
  /** DEM zoom this answer is about. Coverage is per zoom level — see `demTiles.ts`. */
  zoom: number;
  /** Tiles the view needs. */
  neededCount: number;
  /** Tiles actually probed. Equals `neededCount` unless `sampled`. */
  probedCount: number;
  /** Probed tiles found in the store. */
  presentCount: number;
  /** True when `probedCount < neededCount`: the fraction is an estimate. */
  sampled: boolean;
  /** `presentCount / probedCount`, 0 when nothing was probed. */
  fraction: number;
  /** Probed tiles that are stored — the covered extent, for the map overlay. */
  present: TileCoord[];
  /** Probed tiles that are not stored — the gap, for the map overlay. */
  missing: TileCoord[];
  /** Which backend answered, so the UI can warn that memory does not survive a reload. */
  backend: TileStoreStats['backend'] | null;
}

/**
 * Ceiling on per-move existence checks.
 *
 * Each probe is an OPFS directory walk or an IndexedDB read, on the main thread,
 * on a phone that is also rendering a map. 256 covers every realistic viewport
 * exactly (a 4K window needs ~160); past it we stride-sample and say so.
 */
export const MAX_PROBES = 256;

/**
 * Probe the store for a view's tiles.
 *
 * Never throws: a store that fails mid-probe reports `unavailable` rather than
 * bubbling an exception into a render, because the user still needs the rest of
 * the sheet. `store` may be `null` for "the store could not be opened".
 */
export async function queryViewportCoverage(
  store: TileStore | null,
  tiles: TileCoord[],
  options: { maxProbes?: number } = {},
): Promise<ViewportCoverage> {
  const zoom = tiles[0]?.z ?? 0;
  if (!store) {
    return {
      state: 'unavailable',
      zoom,
      neededCount: tiles.length,
      probedCount: 0,
      presentCount: 0,
      sampled: false,
      fraction: 0,
      present: [],
      missing: [],
      backend: null,
    };
  }

  const probes = sampleTiles(tiles, options.maxProbes ?? MAX_PROBES);
  const sampled = probes.length < tiles.length;

  let results: boolean[];
  try {
    results = await Promise.all(probes.map((t) => store.has(demTileKey(t))));
  } catch {
    return {
      state: 'unavailable',
      zoom,
      neededCount: tiles.length,
      probedCount: 0,
      presentCount: 0,
      sampled: false,
      fraction: 0,
      present: [],
      missing: [],
      backend: store.backend,
    };
  }

  const present: TileCoord[] = [];
  const missing: TileCoord[] = [];
  probes.forEach((tile, i) => (results[i] ? present : missing).push(tile));

  const fraction = probes.length === 0 ? 0 : present.length / probes.length;

  return {
    state: coverageState(present.length, probes.length),
    zoom,
    neededCount: tiles.length,
    probedCount: probes.length,
    presentCount: present.length,
    sampled,
    fraction,
    present,
    missing,
    backend: store.backend,
  };
}

/**
 * The three honest answers.
 *
 * `covered` requires *every* probed tile, with no rounding slack: 34 of 35
 * tiles is `partial`, because the one missing tile is a blank square somewhere
 * on the screen and the user is entitled to know which square.
 *
 * An empty view (`probed === 0`, only reachable if the bounds enumerate to
 * nothing) is `none`, never `covered` — "I found no tiles to check" must not
 * read as "everything you need is here".
 */
export function coverageState(present: number, probed: number): CoverageState {
  if (probed === 0) return 'none';
  if (present === 0) return 'none';
  return present === probed ? 'covered' : 'partial';
}

/**
 * Stride-sample a tile list down to at most `max` entries.
 *
 * 2D-aware: stride in x and y separately over the tile rectangle rather than
 * every k-th element of a row-major list, which would alias with the row width
 * and can sample a single column. Always keeps the first tile, so the sample is
 * deterministic and a repeated query over an unchanged view gives an unchanged
 * answer — a percentage that jitters while the map is still would look like a
 * bug and destroy trust in the number.
 */
export function sampleTiles(tiles: TileCoord[], max = MAX_PROBES): TileCoord[] {
  if (tiles.length <= max) return tiles;

  const xs = tiles.map((t) => t.x);
  const ys = tiles.map((t) => t.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const width = Math.max(...xs) - x0 + 1;
  const height = Math.max(...ys) - y0 + 1;

  // Grow the stride until the grid fits under the cap. Starting from the ideal
  // sqrt ratio and stepping up is exact without a solve, and runs a handful of
  // iterations at most.
  let stride = Math.max(1, Math.floor(Math.sqrt(tiles.length / max)));
  for (;;) {
    const cols = Math.ceil(width / stride);
    const rows = Math.ceil(height / stride);
    if (cols * rows <= max) break;
    stride++;
  }

  return tiles.filter((t) => (t.x - x0) % stride === 0 && (t.y - y0) % stride === 0);
}

export interface CoverageDescription {
  /** Short, glanceable, fits the sheet header. */
  chip: string;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
  /** Status is never carried by colour alone. */
  glyph: string;
  /** The full sentence, for the sheet body and the chip's tooltip. */
  detail: string;
}

/**
 * One place that turns coverage into words, so the chip, the body line, the
 * tooltip and the tests cannot drift apart.
 *
 * `null` means "no answer yet" and is described identically to `checking`.
 * There is deliberately no branch that produces an optimistic string from an
 * absent measurement.
 */
export function describeCoverage(coverage: ViewportCoverage | null): CoverageDescription {
  if (!coverage || coverage.state === 'checking') {
    return {
      chip: 'Checking…',
      tone: 'neutral',
      glyph: '◌',
      detail: 'Checking which elevation tiles for this view are stored on this device.',
    };
  }

  if (coverage.state === 'unavailable') {
    return {
      chip: 'Storage unavailable',
      tone: 'danger',
      glyph: '!',
      detail:
        'This device’s offline tile storage could not be read, so we cannot tell you what is ' +
        'saved. Treat this view as not downloaded until it can.',
    };
  }

  const zoomNote = `Checked at zoom ${coverage.zoom} — the zoom this view is drawing from. Zooming in can change this answer.`;

  if (coverage.state === 'covered') {
    return {
      chip: 'Covered',
      tone: 'ok',
      glyph: '●',
      detail:
        `Every elevation tile this view needs (${coverage.probedCount}) is stored on this ` +
        `device, so the analysis layers work here with no signal. ${zoomNote}`,
    };
  }

  if (coverage.state === 'none') {
    return {
      chip: 'Not downloaded',
      tone: 'warn',
      glyph: '○',
      detail:
        'None of this view’s elevation is stored on this device. Analysis layers here need a ' +
        `connection until you save this area. ${zoomNote}`,
    };
  }

  const pct = percentLabel(coverage.fraction);
  const approx = coverage.sampled ? '≈' : '';
  return {
    chip: `Partial — ${approx}${pct}%`,
    tone: 'warn',
    glyph: '◐',
    detail:
      `Partial — ${approx}${pct}% of this view is stored on this device. The hatched area on the ` +
      `map is the part that is missing; it will be blank with no signal. ` +
      (coverage.sampled
        ? `Estimated from ${coverage.probedCount} of ${coverage.neededCount} tiles. `
        : `${coverage.presentCount} of ${coverage.probedCount} tiles. `) +
      zoomNote,
  };
}

/**
 * Percent for display, pinned away from both ends.
 *
 * A partial view that rounds to "100%" reads as covered and is the same lie in
 * a new costume; one that rounds to "0%" hides that some of the ground *is*
 * usable. `covered` and `none` are separate states and are the only things
 * allowed to say all or nothing.
 */
export function percentLabel(fraction: number): number {
  const pct = Math.round(fraction * 100);
  return Math.min(99, Math.max(1, pct));
}
