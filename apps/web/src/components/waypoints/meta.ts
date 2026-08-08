/**
 * Waypoint type metadata — the data half of `R3`'s "type-aware forms".
 *
 * One row per `WireWaypointType` (`lib/api/types.ts` — the Prisma casing, per
 * `R67`; never `@hunt-maps/shared`'s `WaypointType`). `fields` names which
 * type-specific inputs `WaypointForm` shows for that type — a treestand and a
 * parking spot do not share a form, and this table is what keeps that a data
 * change instead of a chain of `if (type === ...)` scattered through the
 * component. `blurb` is the sentence CLAUDE.md's "explain, don't just expose"
 * rule asks for: a hunter deciding whether to log a "Mineral site" or a "Food
 * plot" should not have to guess which one this app means.
 */

import type { WireWaypointType } from '../../lib/api/types';

export type WaypointField = 'standHeight' | 'shootingLanes' | 'huntableWinds' | 'cameraDirection';

export interface WaypointTypeMeta {
  type: WireWaypointType;
  label: string;
  /** Short plural, used for list group headers and default-name generation. */
  namePrefix: string;
  blurb: string;
  fields: WaypointField[];
}

export const WAYPOINT_TYPE_META: WaypointTypeMeta[] = [
  {
    type: 'STAND',
    label: 'Treestand',
    namePrefix: 'Stand',
    blurb:
      'A fixed hang-on or ladder stand. Log shooting lanes and which winds it hunts clean on so the wind check can tell you whether to sit it today.',
    fields: ['standHeight', 'shootingLanes', 'huntableWinds'],
  },
  {
    type: 'BLIND',
    label: 'Ground blind',
    namePrefix: 'Blind',
    blurb:
      'A ground blind or box stand. Same wind logic as a treestand — log the winds it hunts clean on.',
    fields: ['standHeight', 'shootingLanes', 'huntableWinds'],
  },
  {
    type: 'TRAIL_CAMERA',
    label: 'Trail camera',
    namePrefix: 'Camera',
    blurb: 'Where a camera is mounted and which way its lens points, for cross-referencing photos with travel direction.',
    fields: ['cameraDirection'],
  },
  {
    type: 'FOOD_PLOT',
    label: 'Food plot',
    namePrefix: 'Plot',
    blurb: 'A planted feeding area — deer come here to eat, not to bed. An anchor point for movement analysis.',
    fields: [],
  },
  {
    type: 'MINERAL_SITE',
    label: 'Mineral site',
    namePrefix: 'Mineral site',
    blurb: 'A mineral lick or supplemental feed site.',
    fields: [],
  },
  {
    type: 'WATER_SOURCE',
    label: 'Water source',
    namePrefix: 'Water',
    blurb: 'A pond, creek crossing or trough deer rely on — especially worth marking in a dry stretch.',
    fields: [],
  },
  {
    type: 'PARKING',
    label: 'Parking',
    namePrefix: 'Parking',
    blurb: 'Where you leave the truck — the start of every access route.',
    fields: [],
  },
  {
    type: 'ACCESS_ROUTE',
    label: 'Access point',
    namePrefix: 'Access',
    blurb: 'A gate, trailhead or path you use to get in and out without blowing the property out.',
    fields: [],
  },
  {
    type: 'PROPERTY_MARKER',
    label: 'Property marker',
    namePrefix: 'Marker',
    blurb: 'A boundary corner, sign or survey pin — for staying inside the line, not for hunting.',
    fields: [],
  },
  {
    type: 'NOTE',
    label: 'Note',
    namePrefix: 'Note',
    blurb: 'A plain pin for anything else worth marking — a rub line, a downed tree, a spot to check later.',
    fields: [],
  },
];

export function waypointTypeMeta(type: WireWaypointType): WaypointTypeMeta {
  const meta = WAYPOINT_TYPE_META.find((m) => m.type === type);
  if (!meta) throw new Error(`Unknown waypoint type: ${type}`);
  return meta;
}

/** The eight compass octants `huntableWinds` is stored as — matches `ConditionsBar`'s own vocabulary. */
export const OCTANTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type Octant = (typeof OCTANTS)[number];

export function octantFromDeg(deg: number): Octant {
  return OCTANTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/**
 * A default name for a new waypoint of this type — "Stand 3" for the third
 * treestand on the property. Counting only same-type waypoints so a property
 * with two stands and one camera still offers "Stand 3", not "Waypoint 4" —
 * CLAUDE.md's "default everything that can be defaulted" applies to naming,
 * not just location and time.
 */
export function suggestedWaypointName(type: WireWaypointType, existingOfType: number): string {
  return `${waypointTypeMeta(type).namePrefix} ${existingOfType + 1}`;
}
