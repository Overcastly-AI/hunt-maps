/**
 * Observation metadata — the data half of `R5`'s type-aware form, mirroring
 * how `components/waypoints/meta.ts` drives `WaypointForm`.
 *
 * Every union here is a `Wire*` type from `lib/api/types.ts` — the Prisma
 * casing, per `R67` — never `@hunt-maps/shared`'s lowercase enums.
 */

import type { WireAnimalSex, WireObservationKind, WireSignType, WireSpecies } from '../../lib/api/types';

export interface ObservationKindMeta {
  kind: WireObservationKind;
  label: string;
  blurb: string;
  /** Which optional fields this kind's form step shows, beyond the shared location/time/notes every kind has. */
  showsSpecies: boolean;
  showsSignType: boolean;
  showsTravelHeading: boolean;
}

export const OBSERVATION_KIND_META: ObservationKindMeta[] = [
  {
    kind: 'SIGHTING',
    label: 'Sighting',
    blurb: 'An animal you saw with your own eyes, right now.',
    showsSpecies: true,
    showsSignType: false,
    showsTravelHeading: true,
  },
  {
    kind: 'TRAIL_CAMERA',
    label: 'Trail cam photo',
    blurb: 'A photo pulled off a card — logged separately from the camera’s own waypoint, so one camera can carry many photos over a season.',
    showsSpecies: true,
    showsSignType: false,
    showsTravelHeading: true,
  },
  {
    kind: 'HARVEST',
    label: 'Harvest',
    blurb: 'An animal taken. The permanent record — get this one right.',
    showsSpecies: true,
    showsSignType: false,
    showsTravelHeading: false,
  },
  {
    kind: 'SIGN',
    label: 'Sign',
    blurb: 'Rubs, scrapes, tracks, beds — evidence an animal was here even though you were not.',
    showsSpecies: false,
    showsSignType: true,
    showsTravelHeading: false,
  },
  {
    kind: 'SIT',
    label: 'Sit',
    blurb: 'A hunting sit, logged whether or not you saw anything — see "Log a blank sit" for the fast path when the answer is nothing.',
    showsSpecies: false,
    showsSignType: false,
    showsTravelHeading: false,
  },
];

export function observationKindMeta(kind: WireObservationKind): ObservationKindMeta {
  const meta = OBSERVATION_KIND_META.find((m) => m.kind === kind);
  if (!meta) throw new Error(`Unknown observation kind: ${kind}`);
  return meta;
}

export const SPECIES_LABEL: Record<WireSpecies, string> = {
  WHITETAIL: 'Whitetail',
  MULE_DEER: 'Mule deer',
  BLACKTAIL: 'Blacktail',
  ELK: 'Elk',
  MOOSE: 'Moose',
  PRONGHORN: 'Pronghorn',
  BEAR: 'Bear',
  TURKEY: 'Turkey',
  HOG: 'Hog',
  OTHER: 'Other',
};

export const SEX_LABEL: Record<WireAnimalSex, string> = {
  BUCK: 'Buck / bull',
  DOE: 'Doe / cow',
  UNKNOWN: 'Unknown',
};

export const SIGN_TYPE_LABEL: Record<WireSignType, string> = {
  RUB: 'Rub',
  SCRAPE: 'Scrape',
  BED: 'Bed',
  TRACK: 'Track',
  SCAT: 'Scat',
  TRAIL: 'Trail',
  BROWSE: 'Browse',
  SHED_ANTLER: 'Shed antler',
  WALLOW: 'Wallow',
};

export const OCTANTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

export function octantFromDeg(deg: number): string {
  return OCTANTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
