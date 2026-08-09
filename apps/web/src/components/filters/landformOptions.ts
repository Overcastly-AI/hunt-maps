/**
 * Selectable options for `WeissPredicate` / `WoodPredicate`.
 *
 * ## Why `Unknown` is never offered
 *
 * `WeissLandform.Unknown` (0) and `WoodFeature.Unknown` (6) are not landforms
 * — they are the classifier's own "could not measure this cell" state (a DEM
 * void, a lake, a neighbour tile that never arrived; see both enums' doc
 * comments in `@hunt-maps/terrain`). A filter matching `classes: [Unknown]`
 * would confidently highlight exactly the ground the engine has no opinion
 * about — the same shape of defect `BACKLOG R56` describes for negation, one
 * level up the stack: a "found feature" painted along a data gap. Excluding
 * it from the picker is the cheap, permanent fix at the UI layer; nothing
 * stops a hand-crafted or imported predicate from setting it anyway, which is
 * exactly what `predicateUtils.ts`'s validation on import guards against, not
 * this list.
 */

import { WeissLandform, WEISS_LABELS, WoodFeature, WOOD_LABELS } from '@hunt-maps/terrain';

export interface EnumOption {
  value: number;
  label: string;
  blurb: string;
}

export const WEISS_OPTIONS: EnumOption[] = [
  {
    value: WeissLandform.Canyon,
    label: WEISS_LABELS[WeissLandform.Canyon],
    blurb: 'Deeply incised drainage bottom — a thermal sink, and a travel route in dry country.',
  },
  {
    value: WeissLandform.MidslopeDrainage,
    label: WEISS_LABELS[WeissLandform.MidslopeDrainage],
    blurb: 'A shallow valley partway up a hillside — the classic whitetail travel channel.',
  },
  {
    value: WeissLandform.UplandDrainage,
    label: WEISS_LABELS[WeissLandform.UplandDrainage],
    blurb: 'A headwater bowl near the top of a drainage. Good bedding when it holds cover.',
  },
  {
    value: WeissLandform.UShapedValley,
    label: WEISS_LABELS[WeissLandform.UShapedValley],
    blurb: 'A broad valley floor, not a narrow draw.',
  },
  {
    value: WeissLandform.Plain,
    label: WEISS_LABELS[WeissLandform.Plain],
    blurb: 'Low relief, low slope — a field, a bench, or flat bottomland.',
  },
  {
    value: WeissLandform.OpenSlope,
    label: WEISS_LABELS[WeissLandform.OpenSlope],
    blurb: 'The connective tissue between every other landform — an unremarkable open hillside.',
  },
  {
    value: WeissLandform.UpperSlope,
    label: WEISS_LABELS[WeissLandform.UpperSlope],
    blurb: 'The shoulder of a hill, below the summit but above the open midslope.',
  },
  {
    value: WeissLandform.LocalRidgeInValley,
    label: WEISS_LABELS[WeissLandform.LocalRidgeInValley],
    blurb: 'A small ridge or hill sitting inside a larger valley — a high-value bedding island.',
  },
  {
    value: WeissLandform.MidslopeRidge,
    label: WEISS_LABELS[WeissLandform.MidslopeRidge],
    blurb: 'A ridge, spur or point partway down a hillside — prime buck bedding when leeward.',
  },
  {
    value: WeissLandform.MountainTop,
    label: WEISS_LABELS[WeissLandform.MountainTop],
    blurb: 'A summit or the highest ground on a ridgeline.',
  },
];

export const WOOD_OPTIONS: EnumOption[] = [
  {
    value: WoodFeature.Planar,
    label: WOOD_LABELS[WoodFeature.Planar],
    blurb: 'An unremarkable slope — no ridge, channel, pit or peak here.',
  },
  {
    value: WoodFeature.Pit,
    label: WOOD_LABELS[WoodFeature.Pit],
    blurb: 'A closed depression — a sink or pond bottom.',
  },
  {
    value: WoodFeature.Channel,
    label: WOOD_LABELS[WoodFeature.Channel],
    blurb: 'A draw or drainage line — water, and often deer, run through it.',
  },
  {
    value: WoodFeature.Pass,
    label: WOOD_LABELS[WoodFeature.Pass],
    blurb:
      'A saddle: the low point on a ridge where deer cross instead of climbing over the top. ' +
      'The highest-value single feature on a topo map.',
  },
  {
    value: WoodFeature.Ridge,
    label: WOOD_LABELS[WoodFeature.Ridge],
    blurb: 'A ridgeline or spur — a travel route with sight lines down both sides.',
  },
  {
    value: WoodFeature.Peak,
    label: WOOD_LABELS[WoodFeature.Peak],
    blurb: 'A local high point — a knob or summit.',
  },
];
