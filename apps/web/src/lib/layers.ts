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
    label: 'LiDAR relief',
    group: 'relief',
    blurb:
      'Multi-directional shaded relief. Reveals benches, old logging grades and micro-terrain ' +
      'that single-direction hillshade flattens out.',
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

/** Anything the current selection needs but the user has not supplied yet. */
export function missingInputs(active: Set<string>, windFromDeg: number | null): string[] {
  const missing: string[] = [];
  for (const id of active) {
    const def = layerById(id);
    if (def?.requiresWind && windFromDeg === null) {
      missing.push(`"${def.label}" needs a wind direction to mean anything.`);
    }
  }
  return missing;
}
