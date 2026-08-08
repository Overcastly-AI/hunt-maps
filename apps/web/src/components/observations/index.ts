/**
 * `components/observations` — `R5`, field-optimised observation capture.
 *
 * ## Mounting instruction (one line, for whoever wires `App.tsx`)
 *
 * Render `<ObservationsSheet />` in the same drawer slot as `LayersSheet`/
 * `WaypointsSheet` (mutually exclusive with both). It needs `propertyId`,
 * `windFromDeg` (the same state `ConditionsBar` already tracks — used only to
 * auto-fill the conditions block, never required), and optionally
 * `fallbackLocation={center}` for when GPS is unavailable.
 *
 * To wire `WaypointDetail`'s "Log a sighting/blank sit here" shortcuts
 * (`components/waypoints/index.ts`): when either fires, switch your active
 * panel to Observations and pass the tapped `WaypointDto` as
 * `initialWaypoint`, plus `initialIntent="sighting"` or `"blank-sit"` to skip
 * straight past the home screen.
 *
 * Calls an authenticated endpoint; `<ObservationsSheet>` shows its own
 * "sign in" prompt when `useAuth().status === 'unauthenticated'` rather than
 * requiring the mount site to gate it.
 */

export { ObservationsSheet, type ObservationsSheetProps } from './ObservationsSheet';
export { ObservationForm, type ObservationFormProps } from './ObservationForm';
export { BlankSitQuickLog, type BlankSitQuickLogProps } from './BlankSitQuickLog';
export { ObservationList } from './ObservationList';
export { ConditionsFields, EMPTY_CONDITIONS, type ConditionsValue } from './ConditionsFields';
export {
  OBSERVATION_KIND_META,
  observationKindMeta,
  SPECIES_LABEL,
  SEX_LABEL,
  SIGN_TYPE_LABEL,
  OCTANTS,
  octantFromDeg,
} from './meta';
export type { ObservationKindMeta } from './meta';
export { moonPhase, moonPhaseLabel } from './moonPhase';
export { useHereLocation, type HereLocation, type HereLocationState } from './useHereLocation';
export { useQueuedIds } from './offlineStatus';

import './observations.css';
