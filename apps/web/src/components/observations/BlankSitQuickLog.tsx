/**
 * The fast path — `R5`'s "isBlankSit is a first-class action, not a checkbox
 * at the bottom of a form."
 *
 * Everything defaults: kind is fixed to `SIT`, `isBlankSit` is always `true`
 * here (a hunter who *did* see something uses the Sighting action instead —
 * this component exists specifically for the zero case), `count` is `0`,
 * time is now, location is here. The only inputs are optional: how long you
 * sat, and a note. One button, and it is reachable from the Observations
 * panel's home screen in a single tap.
 */

import { useState } from 'react';
import { Button, Callout, Field } from '@hunt-maps/design';
import type { CreateObservationInput, WaypointDto } from '../../lib/api/types';
import type { HereLocation } from './useHereLocation';
import { ConditionsFields, EMPTY_CONDITIONS, type ConditionsValue } from './ConditionsFields';
import { moonPhase } from './moonPhase';

export interface BlankSitQuickLogProps {
  waypoint?: WaypointDto | null;
  location: HereLocation | null;
  locationSource: 'gps' | 'fallback' | 'none';
  locating: boolean;
  windFromDeg: number | null;
  onSetWind?: () => void;
  submitting: boolean;
  submitError: string | null;
  onCancel: () => void;
  onSubmit: (input: Omit<CreateObservationInput, 'propertyId' | 'clientId'>) => void;
}

export function BlankSitQuickLog({
  waypoint,
  location,
  locating,
  windFromDeg,
  onSetWind,
  submitting,
  submitError,
  onCancel,
  onSubmit,
}: BlankSitQuickLogProps) {
  const [sitMinutes, setSitMinutes] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [conditions, setConditions] = useState<ConditionsValue>(EMPTY_CONDITIONS);
  const [observedAt] = useState(() => new Date());

  const effectiveLocation = waypoint
    ? { lng: waypoint.location.coordinates[0], lat: waypoint.location.coordinates[1] }
    : location;
  const canSubmit = Boolean(effectiveLocation) && !submitting;

  function handleSubmit() {
    if (!effectiveLocation) return;
    onSubmit({
      kind: 'SIT',
      isBlankSit: true,
      count: 0,
      observedAt: observedAt.toISOString(),
      location: { type: 'Point', coordinates: [effectiveLocation.lng, effectiveLocation.lat] },
      waypointId: waypoint?.id,
      sitMinutes: sitMinutes === '' ? undefined : sitMinutes,
      notes: notes.trim() || undefined,
      windFromDeg: windFromDeg ?? undefined,
      moonPhase: moonPhase(observedAt),
      temperatureC: numOrUndef(conditions.temperatureC),
      pressureHpa: numOrUndef(conditions.pressureHpa),
      pressureTrend3h: numOrUndef(conditions.pressureTrend3h),
      windSpeedKph: numOrUndef(conditions.windSpeedKph),
    });
  }

  return (
    <div className="obs-blank-sit">
      <p className="rl-hint obs-blank-sit__lede">
        Zero sightings, logged. Recording the blanks is what turns "sightings per sit" into a real number instead of
        a measure of how often you went out.
      </p>

      <dl className="readout obs-blank-sit__summary">
        <dt>When</dt>
        <dd>{observedAt.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}</dd>
        <dt>Where</dt>
        <dd>
          {waypoint
            ? waypoint.name
            : effectiveLocation
              ? `${effectiveLocation.lat.toFixed(4)}, ${effectiveLocation.lng.toFixed(4)}`
              : locating
                ? 'Finding you…'
                : 'Location unavailable'}
        </dd>
      </dl>

      <Field id="obs-sit-minutes" label="Sit length" hint="Minutes, optional — how long you were actually on stand.">
        <input
          id="obs-sit-minutes"
          className="rl-input"
          type="number"
          inputMode="numeric"
          min={0}
          max={1440}
          value={sitMinutes}
          onChange={(e) => setSitMinutes(e.target.value === '' ? '' : Number(e.target.value))}
        />
      </Field>

      <ConditionsFields
        windFromDeg={windFromDeg}
        observedAt={observedAt}
        value={conditions}
        onChange={setConditions}
        onSetWind={onSetWind}
      />

      <Field id="obs-blank-notes" label="Notes" hint="Optional.">
        <textarea
          id="obs-blank-notes"
          className="rl-input obs-textarea"
          rows={2}
          maxLength={4000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      {!effectiveLocation && !locating && (
        <Callout tone="warn">
          <p>No location available — allow location access, or open this from a stand's own page.</p>
        </Callout>
      )}

      {submitError && (
        <Callout tone="danger" role="alert">
          <p>{submitError}</p>
        </Callout>
      )}

      <div className="obs-form-actions">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={handleSubmit} disabled={!canSubmit}>
          {submitting ? 'Saving…' : 'Save blank sit'}
        </Button>
      </div>
    </div>
  );
}

function numOrUndef(v: number | ''): number | undefined {
  return v === '' ? undefined : v;
}
