/**
 * The layer catalogue.
 *
 * Ordering, grouping and default opacity are product decisions, not cosmetics.
 * The whole app is a stack of translucent rasters over imagery, and a stack
 * that is wrong reads as mud. Rules applied here:
 *
 *  - **Imagery stays visible.** It is the evidence; every analysis layer is an
 *    interpretation of it. Defaults are chosen so you can always see the ground.
 *  - **Hillshade sits directly on imagery**, under everything else, because its
 *    job is to give the other layers something to sit on.
 *  - **At most one "continuous" layer should be on at a time** (slope, aspect,
 *    insolation, bedding). Two ramps stacked is unreadable, so the UI enforces
 *    it rather than trusting the user to notice.
 *  - **Discrete layers stack freely** (benches, saddles, saved filters) — they
 *    are sparse by construction, which is exactly what makes them usable
 *    together.
 */

import type { AnalysisLayer } from '@hunt-maps/terrain';
import { mapColor, type EvidenceGrade } from '@hunt-maps/design';
import { DEM_SOURCE } from './map/demSource';
import type { WireSpecies } from './api/types';

export type LayerGroup = 'base' | 'relief' | 'analysis' | 'hunting' | 'saved';

export interface LayerDefinition {
  id: AnalysisLayer | 'satellite' | 'topo' | 'contours';
  label: string;
  group: LayerGroup;
  /** One-line explanation of what it shows and why it matters. */
  blurb: string;
  defaultOpacity: number;
  /** Continuous ramps are mutually exclusive — see above. */
  exclusive?: boolean;
  /** Needs a wind direction before it means anything. */
  requiresWind?: boolean;
  /** Depends on the selected date/time. */
  requiresTime?: boolean;
  legend?: Array<{ swatch: string; label: string }>;
  /**
   * How well-supported the layer's underlying parameter is, per
   * `docs/EVIDENCE.md`. Renders as a `Confidence` chip once the layer is
   * active (`BACKLOG R61`).
   *
   * **Never set this for measured geometry** — Horn slope, aspect, a Weiss
   * landform class, a Wood morphometric feature. Those are published,
   * peer-reviewed algorithms validated against closed-form analytic surfaces;
   * a grade chip on one implies a doubt that does not exist, and grading
   * everything is identical to grading nothing. This exists for the layers
   * built on a *modelled* biological parameter instead — today, only
   * `bedding`'s `idealSlopeDeg: 22°`, which `docs/EVIDENCE.md` grades 🔴
   * Assumed. A test in `LayersSheet.test.tsx` iterates this array and fails
   * CI if a future layer's `Confidence` chip drifts from what is set here.
   */
  grade?: EvidenceGrade;
  /**
   * Set when this layer's underlying *model* — not its terrain inputs, the
   * model itself — has no evidentiary basis for anything but whitetail
   * (`docs/EVIDENCE.md` Pass 7, R84/R85). Once the active property states a
   * `targetSpecies` other than whitetail, the layer is disabled with this
   * exact text via `ToggleRow`'s `blockedReason` — the same mechanism, and
   * the same product rule, `requiresWind` already uses: CLAUDE.md's "grey
   * out layers whose inputs are unset rather than rendering a default"
   * applies just as much when what is missing is a valid *model* for the
   * declared species as when it is a wind direction. This is deliberately
   * **not** a `Confidence`/`grade` chip — `assumed` means "a defensible
   * estimate exists and here is how weak it is", and for elk the honest
   * state is that no estimate exists at all. Dressing an absence as a graded
   * assumption would itself be the overclaim `docs/EVIDENCE.md` exists to
   * catch.
   */
  speciesCaveat?: string;
}

/**
 * Whether `species` (a property's stated `Property.targetSpecies`, wire
 * casing) is a value this layer's model actually transfers to.
 *
 * `null`/`undefined` ("not stated") is treated as **not** blocked — a
 * property that has never been asked what it targets keeps exactly today's
 * behaviour (implicitly whitetail-shaped, the only model that has ever
 * existed here), per CLAUDE.md's "whitetail behaviour must be unchanged".
 * Only an explicit, stated non-whitetail species trips the caveat — R84/R85
 * are about a *declared* elk hunt, not an unanswered question.
 */
export function speciesBlockedReason(
  layer: LayerDefinition,
  targetSpecies: WireSpecies | null | undefined,
): string | undefined {
  if (!layer.speciesCaveat) return undefined;
  if (!targetSpecies || targetSpecies === 'WHITETAIL') return undefined;
  return layer.speciesCaveat;
}

export const LAYERS: LayerDefinition[] = [
  {
    id: 'satellite',
    label: 'Satellite',
    group: 'base',
    blurb: 'Leaf-off aerial imagery. The ground truth every other layer interprets.',
    defaultOpacity: 1,
  },
  {
    id: 'topo',
    label: 'Topo',
    group: 'base',
    blurb: 'Classic contour topo. Best for reading elevation numbers off the map.',
    defaultOpacity: 1,
  },
  {
    id: 'multiHillshade',
    label: 'Shaded relief',
    group: 'relief',
    blurb:
      `Multi-directional shading over ${DEM_SOURCE.label} (${DEM_SOURCE.resolutionNote}). Lit ` +
      'from several directions at once so a ridge never reads as a draw. ' +
      // Whether this map can show old logging grades and skid roads is a fact
      // about the *active* elevation source, not a fixed claim — the source
      // is now something a hunter can switch in the Layers sheet
      // (`lib/map/demSource.ts`'s `DEM_SOURCE`), and `demSourceHonesty.test.ts`
      // fails CI the moment this stops matching `DEM_SOURCE.isLidar`. Keep the
      // two branches negated/affirmed rather than editing the prose in place —
      // that guard checks for a negation word precisely because a rewrite
      // that drops one is how the original mislabel shipped.
      (DEM_SOURCE.isLidar
        ? 'Fine enough at this source to also pick out old logging grades and skid roads — the ' +
          'kind of micro-terrain a 10 m blend cannot resolve.'
        : 'Shows broad shape — drainages, benches wide enough to matter, ridge lines — not old ' +
          'logging grades or skid roads, which need finer LiDAR data this map does not yet serve.'),
    defaultOpacity: 0.55,
  },
  {
    id: 'slope',
    label: 'Slope angle',
    group: 'analysis',
    blurb:
      'Steepness, banded at the breaks that matter: the 8–20° sidehill deer contour along, the ' +
      '20–30° bedding grade, and the 45°+ ground nothing crosses.',
    defaultOpacity: 0.6,
    exclusive: true,
    legend: [
      { swatch: mapColor['slope-flat'], label: '0–8° flat / field / bench' },
      { swatch: mapColor['slope-sidehill'], label: '8–20° sidehill travel' },
      { swatch: mapColor['slope-bedding'], label: '20–30° bedding grade' },
      { swatch: mapColor['slope-steep'], label: '30–45° steep' },
      { swatch: mapColor['slope-wall'], label: '45°+ effectively a wall' },
    ],
  },
  {
    id: 'aspect',
    label: 'Aspect',
    group: 'analysis',
    blurb:
      'Which way each slope faces. Drives sun, thermals and which side of a ridge holds deer on ' +
      'a given wind.',
    defaultOpacity: 0.5,
    exclusive: true,
  },
  {
    id: 'weiss',
    label: 'Landform',
    group: 'analysis',
    blurb:
      'Landscape position: canyon, midslope drainage, bench, midslope ridge, summit. Answers ' +
      '"where does this sit in the hill", not "how steep is it".',
    defaultOpacity: 0.5,
    exclusive: true,
  },
  {
    id: 'wood',
    label: 'Saddles & draws',
    group: 'hunting',
    blurb:
      'Morphometric features. Saddles are highlighted hardest — deer cross ridges through them ' +
      'because it costs less than going over the top.',
    defaultOpacity: 0.65,
    legend: [
      { swatch: mapColor['feature-saddle'], label: 'Saddle (pass)' },
      { swatch: mapColor['feature-channel'], label: 'Channel / draw' },
      { swatch: mapColor['feature-ridge'], label: 'Ridge / spur' },
      { swatch: mapColor['feature-peak'], label: 'Peak / knob' },
    ],
  },
  {
    id: 'bench',
    label: 'Benches',
    group: 'hunting',
    blurb:
      'Level shelves cut into steep ground. Mark them, connect them, and you have the travel ' +
      'skeleton of a hill-country property.',
    defaultOpacity: 0.55,
  },
  {
    id: 'insolation',
    label: 'Sun exposure',
    group: 'hunting',
    blurb:
      'Direct sun for the selected date and time. Late season, deer bed where the sun lands — ' +
      'and that moves through the season.',
    defaultOpacity: 0.5,
    exclusive: true,
    requiresTime: true,
  },
  {
    id: 'bedding',
    label: 'Bedding likelihood',
    group: 'hunting',
    blurb:
      'Leeward aspect + real upwind shelter + a beddable grade + broken cover, for the wind you ' +
      'set. All four have to line up, so this is deliberately sparse.',
    defaultOpacity: 0.6,
    exclusive: true,
    requiresWind: true,
    // Leeward aspect and upwind shelter are geometry, but the terms that turn
    // slope into a bedding score are not: `docs/EVIDENCE.md`'s "Bedding-model
    // parameters shipped by R11/R21/R22" grades most of the live constants
    // (BEDDING_RING_MIN_SLOPE_DEG, BEDDING_VRM_FULL_COVER, the cover/shelter
    // term floors, the ring radius) 🔴 Assumed — no source nominates a value,
    // only a defensible scale argument. Only the pad half-max is 🔵 Inferred.
    // The layer's grade is the weaker of the two, per the same rule
    // `Confidence` applies everywhere else: a claim is only as strong as its
    // weakest input.
    grade: 'assumed',
    // R84, `docs/EVIDENCE.md` Pass 7 §2. The score is carried almost entirely
    // by two slope terms (`padTerm` × `ringTerm`) plus a VRM term standing in
    // for cover — and the one peer-reviewed measurement of elk bed sites
    // found slope did not discriminate beds from random ground at all.
    speciesCaveat:
      'Not modelled for this species. The one peer-reviewed study of elk bed sites (Millspaugh ' +
      'et al. 1998, Custer State Park) found slope did not separate beds from random ground — ' +
      'overstory canopy closure and microsite temperature did, and neither is visible in ' +
      'elevation data. Re-tuning this layer’s slope terms for elk would not fix that; it ' +
      'would just be confident about the wrong thing again.',
  },
];

export const LAYER_GROUPS: Array<{ id: LayerGroup; label: string; hint: string }> = [
  { id: 'base', label: 'Base map', hint: 'Pick one' },
  { id: 'relief', label: 'Relief', hint: 'Shading under everything else' },
  { id: 'analysis', label: 'Terrain analysis', hint: 'One at a time — ramps do not stack' },
  { id: 'hunting', label: 'Hunting layers', hint: 'Stack these freely' },
  { id: 'saved', label: 'Saved filters', hint: 'Your own terrain queries' },
];

/**
 * Apply the mutual-exclusion rule when a layer is switched on.
 *
 * Enforced in code rather than left to the user: two continuous colour ramps
 * composited together produce a picture that looks like data and means nothing,
 * and that is a worse outcome than silently turning one off.
 */
export function toggleLayer(active: Set<string>, id: string): Set<string> {
  const next = new Set(active);
  if (next.has(id)) {
    next.delete(id);
    return next;
  }

  const def = LAYERS.find((l) => l.id === id);
  if (def?.group === 'base') {
    for (const l of LAYERS) if (l.group === 'base') next.delete(l.id);
  }
  if (def?.exclusive) {
    for (const l of LAYERS) if (l.exclusive) next.delete(l.id);
  }
  next.add(id);
  return next;
}

export function layerById(id: string): LayerDefinition | undefined {
  return LAYERS.find((l) => l.id === id);
}

/**
 * Anything the current selection needs but the user has not supplied yet —
 * a missing wind direction, or (R84/R85) a layer whose model does not
 * transfer to the active property's stated target species.
 *
 * `targetSpecies` is optional so every existing caller (and every existing
 * test) keeps working unchanged: omitting it is "not stated", which never
 * blocks anything — see `speciesBlockedReason`.
 */
export function missingInputs(
  active: Set<string>,
  windFromDeg: number | null,
  targetSpecies?: WireSpecies | null,
): string[] {
  const missing: string[] = [];
  for (const id of active) {
    const def = layerById(id);
    if (!def) continue;
    const speciesReason = speciesBlockedReason(def, targetSpecies);
    if (speciesReason) {
      missing.push(`"${def.label}" — ${speciesReason}`);
      continue;
    }
    if (def.requiresWind && windFromDeg === null) {
      missing.push(`"${def.label}" needs a wind direction to mean anything.`);
    }
  }
  return missing;
}
