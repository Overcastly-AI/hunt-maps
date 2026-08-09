/**
 * `components/waypoints` — `R3`, waypoint placement + type-aware forms.
 *
 * ## Mounting instruction (one line, for whoever wires `App.tsx`)
 *
 * Render `<WaypointsSheet />` in the same drawer slot `LayersSheet`/
 * `RegionPicker` already occupy, behind a new `open` boolean that is mutually
 * exclusive with `sheetOpen`/`pickerOpen` (a `CommandBar` cell, "Stands", is
 * the natural trigger — `CommandBar`'s own doc comment already reserves room
 * for one more cell). It needs `propertyId` (the current property — no picker
 * exists yet; see the handoff report), `windFromDeg`/`atUtc` (the same state
 * `ConditionsBar` already tracks, passed straight through), and optionally
 * `fallbackLocation={center}` (the map's current centre, used only if GPS is
 * unavailable — see `useHereLocation`'s doc comment).
 *
 * To wire the "log a sighting/blank sit here" jump from a stand's detail into
 * the Observations panel: pass `onLogSighting`/`onLogBlankSit` callbacks that
 * switch your active-panel state to Observations and hand the tapped
 * `WaypointDto` to `ObservationsSheet`'s `initialWaypoint` prop
 * (`components/observations/index.ts`).
 *
 * Everything here calls an authenticated endpoint, so gate the *trigger* (the
 * `CommandBar` cell) or simply always render `<WaypointsSheet>` — it already
 * shows a "sign in" prompt itself rather than crashing when
 * `useAuth().status === 'unauthenticated'`.
 */

export { WaypointsSheet, type WaypointsSheetProps } from './WaypointsSheet';
export { WaypointForm, type WaypointFormProps } from './WaypointForm';
export { WaypointDetail, type WaypointDetailProps } from './WaypointDetail';
export { WaypointList, waypointTypeLabel } from './WaypointList';
export { WindCheckCard } from './WindCheckCard';
export { WAYPOINT_TYPE_META, waypointTypeMeta, suggestedWaypointName, OCTANTS, octantFromDeg } from './meta';
export type { WaypointTypeMeta, WaypointField, Octant } from './meta';
export { useHereLocation, type HereLocation, type HereLocationState } from './useHereLocation';
export { useQueuedIds } from './offlineStatus';

import './waypoints.css';
