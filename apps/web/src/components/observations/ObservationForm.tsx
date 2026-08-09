/**
 * The full, type-aware observation form (`R5`) — every kind beyond the fast
 * blank-sit path (`BlankSitQuickLog.tsx`). Field visibility is driven by
 * `OBSERVATION_KIND_META` the same way `WaypointForm` reads
 * `WAYPOINT_TYPE_META`: a Sign entry shows a sign-type picker and no species
 * grid, a Harvest shows the full species/sex/age grid and no travel heading.
 *
 * `SIT` is the one kind with a wrinkle: whether it shows the species grid
 * depends on `isBlankSit`, not on the kind alone — a non-blank sit is really
 * "a sit during which I also saw something", so the same fields a Sighting
 * uses apply once the hunter says the sit was not blank. `OBSERVATION_KIND_
 * META` intentionally leaves `SIT`'s `showsSpecies` `false`; this component
 * overrides it for that one case rather than modelling a data table entry
 * that only sometimes means what it says.
 */

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Callout, Field, RangeField } from '@hunt-maps/design';
import type {
  CreateObservationInput,
  WaypointDto,
  WireAnimalSex,
  WireObservationKind,
  WireSignType,
  WireSpecies,
} from '../../lib/api/types';
import {
  OBSERVATION_KIND_META,
  SEX_LABEL,
  SIGN_TYPE_LABEL,
  SPECIES_LABEL,
  observationKindMeta,
} from './meta';
import { ConditionsFields, EMPTY_CONDITIONS, type ConditionsValue } from './ConditionsFields';
import { moonPhase } from './moonPhase';
import type { HereLocation } from './useHereLocation';

export interface ObservationFormProps {
  waypoints: WaypointDto[];
  /** Pre-selected "logged at" context — e.g. opened from a stand's own detail view. */
  waypoint?: WaypointDto | null;
  location: HereLocation | null;
  locationSource: 'gps' | 'fallback' | 'none';
  locating: boolean;
  windFromDeg: number | null;
  onSetWind?: () => void;
  initialKind?: WireObservationKind;
  submitting: boolean;
  submitError: string | null;
  onCancel: () => void;
  onSubmit: (input: Omit<CreateObservationInput, 'propertyId' | 'clientId'>) => void;
}

export function ObservationForm({
  waypoints,
  waypoint,
  location,
  locationSource,
  locating,
  windFromDeg,
  onSetWind,
  initialKind,
  submitting,
  submitError,
  onCancel,
  onSubmit,
}: ObservationFormProps) {
  const [kind, setKind] = useState<WireObservationKind>(initialKind ?? 'SIGHTING');
  const meta = observationKindMeta(kind);

  const [species, setSpecies] = useState<WireSpecies>('WHITETAIL');
  const [sex, setSex] = useState<WireAnimalSex>('UNKNOWN');
  const [estimatedAge, setEstimatedAge] = useState<number | ''>('');
  const [count, setCount] = useState<number | ''>(1);
  const [signType, setSignType] = useState<WireSignType>('RUB');
  const [travelHeadingDeg, setTravelHeadingDeg] = useState<number | ''>('');
  const [isBlankSit, setIsBlankSit] = useState(false);
  const [sitMinutes, setSitMinutes] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [conditions, setConditions] = useState<ConditionsValue>(EMPTY_CONDITIONS);
  const [observedAt, setObservedAt] = useState(() => new Date());
  const [linkedWaypointId, setLinkedWaypointId] = useState<string | ''>(waypoint?.id ?? '');
  const [useWaypointLocation, setUseWaypointLocation] = useState(Boolean(waypoint));

  const linkedWaypoint = useMemo(
    () => waypoints.find((w) => w.id === linkedWaypointId) ?? waypoint ?? null,
    [waypoints, linkedWaypointId, waypoint],
  );

  const sitShowsSpecies = kind === 'SIT' && !isBlankSit;
  const showSpeciesGrid = meta.showsSpecies || sitShowsSpecies;

  const effectiveLocation =
    useWaypointLocation && linkedWaypoint
      ? { lng: linkedWaypoint.location.coordinates[0], lat: linkedWaypoint.location.coordinates[1] }
      : location;

  const canSubmit = Boolean(effectiveLocation) && !submitting;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!effectiveLocation) return;

    const base = {
      kind,
      observedAt: observedAt.toISOString(),
      location: { type: 'Point' as const, coordinates: [effectiveLocation.lng, effectiveLocation.lat] as [number, number] },
      waypointId: linkedWaypointId || undefined,
      notes: notes.trim() || undefined,
      windFromDeg: windFromDeg ?? undefined,
      moonPhase: moonPhase(observedAt),
      temperatureC: numOrUndef(conditions.temperatureC),
      pressureHpa: numOrUndef(conditions.pressureHpa),
      pressureTrend3h: numOrUndef(conditions.pressureTrend3h),
      windSpeedKph: numOrUndef(conditions.windSpeedKph),
    };

    if (kind === 'SIT') {
      onSubmit({
        ...base,
        isBlankSit,
        sitMinutes: sitMinutes === '' ? undefined : sitMinutes,
        species: showSpeciesGrid ? species : undefined,
        sex: showSpeciesGrid ? sex : undefined,
        count: showSpeciesGrid ? (count === '' ? undefined : count) : 0,
        estimatedAge: showSpeciesGrid && estimatedAge !== '' ? estimatedAge : undefined,
      });
      return;
    }

    onSubmit({
      ...base,
      species: meta.showsSpecies ? species : undefined,
      sex: meta.showsSpecies ? sex : undefined,
      count: meta.showsSpecies && count !== '' ? count : undefined,
      estimatedAge: meta.showsSpecies && estimatedAge !== '' ? estimatedAge : undefined,
      signType: meta.showsSignType ? signType : undefined,
      travelHeadingDeg: meta.showsTravelHeading && travelHeadingDeg !== '' ? travelHeadingDeg : undefined,
    });
  }

  return (
    <form className="obs-form" onSubmit={handleSubmit}>
      <div className="obs-kind-grid" role="group" aria-label="Observation type">
        {OBSERVATION_KIND_META.map((m) => (
          <button
            key={m.kind}
            type="button"
            className={`obs-kind-btn${kind === m.kind ? ' obs-kind-btn--active' : ''}`}
            aria-pressed={kind === m.kind}
            onClick={() => setKind(m.kind)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="rl-hint obs-kind-blurb">{meta.blurb}</p>

      {kind === 'SIT' && (
        <div className="obs-blank-toggle">
          <label className="obs-blank-toggle__label">
            <input type="checkbox" checked={isBlankSit} onChange={(e) => setIsBlankSit(e.target.checked)} />
            <span>Blank sit — saw nothing</span>
          </label>
          <Field id="obs-sit-min" label="Sit length" hint="Minutes, optional.">
            <input
              id="obs-sit-min"
              className="rl-input"
              type="number"
              inputMode="numeric"
              min={0}
              max={1440}
              value={sitMinutes}
              onChange={(e) => setSitMinutes(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </Field>
        </div>
      )}

      {showSpeciesGrid && (
        <>
          <Field id="obs-species" label="Species">
            <select
              id="obs-species"
              className="rl-input"
              value={species}
              onChange={(e) => setSpecies(e.target.value as WireSpecies)}
            >
              {Object.entries(SPECIES_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="obs-sex" label="Sex">
            <select id="obs-sex" className="rl-input" value={sex} onChange={(e) => setSex(e.target.value as WireAnimalSex)}>
              {Object.entries(SEX_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <div className="obs-two-col">
            <Field id="obs-count" label="Count">
              <input
                id="obs-count"
                className="rl-input"
                type="number"
                inputMode="numeric"
                min={0}
                value={count}
                onChange={(e) => setCount(e.target.value === '' ? '' : Number(e.target.value))}
              />
            </Field>
            <Field id="obs-age" label="Est. age (yrs)" hint="Optional.">
              <input
                id="obs-age"
                className="rl-input"
                type="number"
                inputMode="decimal"
                min={0}
                max={20}
                step={0.5}
                value={estimatedAge}
                onChange={(e) => setEstimatedAge(e.target.value === '' ? '' : Number(e.target.value))}
              />
            </Field>
          </div>
        </>
      )}

      {meta.showsSignType && (
        <Field id="obs-sign-type" label="Sign type">
          <select
            id="obs-sign-type"
            className="rl-input"
            value={signType}
            onChange={(e) => setSignType(e.target.value as WireSignType)}
          >
            {Object.entries(SIGN_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {meta.showsTravelHeading && (
        <RangeField
          id="obs-travel-heading"
          label="Travel direction"
          min={0}
          max={359}
          step={5}
          value={travelHeadingDeg === '' ? 0 : travelHeadingDeg}
          onValueChange={setTravelHeadingDeg}
          display={travelHeadingDeg === '' ? 'Not recorded' : `${Math.round(travelHeadingDeg)}°`}
          hint="Which way it was moving, optional."
        />
      )}

      <Field id="obs-when" label="When">
        <input
          id="obs-when"
          className="rl-input"
          type="datetime-local"
          value={toLocalInput(observedAt)}
          onChange={(e) => {
            const next = new Date(e.target.value);
            if (!Number.isNaN(next.getTime())) setObservedAt(next);
          }}
        />
      </Field>

      {waypoints.length > 0 && (
        <Field id="obs-waypoint" label="Logged at" hint="Optional — link this to one of your stands or cameras.">
          <select
            id="obs-waypoint"
            className="rl-input"
            value={linkedWaypointId}
            onChange={(e) => {
              setLinkedWaypointId(e.target.value);
              if (e.target.value) setUseWaypointLocation(true);
            }}
          >
            <option value="">Not linked to a waypoint</option>
            {waypoints
              .filter((w) => !w.archived)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
          </select>
        </Field>
      )}

      <Field
        id="obs-location"
        label="Location"
        value={
          effectiveLocation
            ? `${effectiveLocation.lat.toFixed(5)}, ${effectiveLocation.lng.toFixed(5)}`
            : locating
              ? 'Finding you…'
              : 'Not set'
        }
      >
        {linkedWaypoint ? (
          <p className="rl-hint">
            {useWaypointLocation ? `Using ${linkedWaypoint.name}'s location.` : 'Using your current location instead.'}{' '}
            <button
              type="button"
              className="rl-btn rl-btn--link obs-inline-link"
              onClick={() => setUseWaypointLocation((v) => !v)}
            >
              {useWaypointLocation ? 'Use my location instead' : `Use ${linkedWaypoint.name}'s location`}
            </button>
          </p>
        ) : (
          <p className="rl-hint">
            {locationSource === 'gps' ? 'Using your current GPS position.' : 'Using the map’s current view.'}
          </p>
        )}
      </Field>

      <ConditionsFields
        windFromDeg={windFromDeg}
        observedAt={observedAt}
        value={conditions}
        onChange={setConditions}
        onSetWind={onSetWind}
      />

      <Field id="obs-notes" label="Notes" hint="Optional.">
        <textarea
          id="obs-notes"
          className="rl-input obs-textarea"
          rows={3}
          maxLength={4000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      {!effectiveLocation && !locating && (
        <Callout tone="warn">
          <p>No location available — allow location access, or link this to a stand above.</p>
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
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {submitting ? 'Saving…' : `Save ${meta.label.toLowerCase()}`}
        </Button>
      </div>
    </form>
  );
}

function numOrUndef(v: number | ''): number | undefined {
  return v === '' ? undefined : v;
}

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
