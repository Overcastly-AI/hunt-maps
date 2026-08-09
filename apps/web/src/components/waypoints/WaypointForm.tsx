/**
 * The type-aware waypoint form (`R3`).
 *
 * One screen, not a wizard: the type picker sits at the top and the rest of
 * the form (name, type-specific fields, location, notes) appears the instant
 * a type is chosen. A wizard would cost an extra tap-and-wait for the common
 * case of "I know what I'm marking" — a hunter standing at the base of a tree
 * they are about to hang a stand in has already decided it is a stand before
 * opening the app.
 *
 * Field visibility is driven entirely by `WAYPOINT_TYPE_META` (`meta.ts`) —
 * a treestand shows shooting lanes and huntable winds, a parking spot shows
 * neither, and the difference is a data lookup, not a chain of conditionals
 * that drift out of sync with the type list.
 */

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Callout, Field, RangeField } from '@hunt-maps/design';
import type { CreateWaypointInput, UpdateWaypointInput, WaypointDto, WireWaypointType } from '../../lib/api/types';
import { OCTANTS, WAYPOINT_TYPE_META, octantFromDeg, suggestedWaypointName, type Octant } from './meta';
import type { HereLocation } from './useHereLocation';

export interface WaypointFormProps {
  propertyId: string;
  /** Existing waypoints for this property — used only to count same-type waypoints for the suggested name ("Stand 3"). */
  existingWaypoints: WaypointDto[];
  location: HereLocation | null;
  locationSource: 'gps' | 'fallback' | 'none';
  locating: boolean;
  submitting: boolean;
  submitError: string | null;
  onCancel: () => void;
  /** Create mode when omitted; edit mode when set — the type field locks (see body). */
  editing?: WaypointDto;
  onSubmitCreate: (input: Omit<CreateWaypointInput, 'propertyId' | 'clientId'>) => void;
  onSubmitUpdate?: (input: UpdateWaypointInput) => void;
  /** Preselects a type in create mode — e.g. launched from a "New stand" shortcut rather than the generic "+ New". */
  initialType?: WireWaypointType;
}

export function WaypointForm({
  propertyId: _propertyId,
  existingWaypoints,
  location,
  locationSource,
  locating,
  submitting,
  submitError,
  onCancel,
  editing,
  onSubmitCreate,
  onSubmitUpdate,
  initialType,
}: WaypointFormProps) {
  const [type, setType] = useState<WireWaypointType | null>(editing?.type ?? initialType ?? null);
  const meta = type ? WAYPOINT_TYPE_META.find((m) => m.type === type) ?? null : null;

  const countOfType = useMemo(
    () => (type ? existingWaypoints.filter((w) => w.type === type).length : 0),
    [existingWaypoints, type],
  );

  const [name, setName] = useState(editing?.name ?? '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [standHeightM, setStandHeightM] = useState<number | ''>(editing?.standHeightM ?? '');
  const [lanes, setLanes] = useState<number[]>(editing?.shootingLanesDeg ?? []);
  const [laneDraft, setLaneDraft] = useState(0);
  const [winds, setWinds] = useState<Set<Octant>>(
    () => new Set((editing?.huntableWinds ?? []) as Octant[]),
  );
  const [cameraDirectionDeg, setCameraDirectionDeg] = useState<number | ''>(
    editing?.cameraDirectionDeg ?? '',
  );
  const [manualLng, setManualLng] = useState(editing ? String(editing.location.coordinates[0]) : '');
  const [manualLat, setManualLat] = useState(editing ? String(editing.location.coordinates[1]) : '');

  // Name has never been touched by the user — keep it synced to the
  // suggested default as the type changes, so picking a type fills the field
  // instead of leaving it blank for the user to type themselves.
  const [nameTouched, setNameTouched] = useState(Boolean(editing));
  const effectiveName =
    !nameTouched && type ? suggestedWaypointName(type, countOfType) : name;

  function pickType(next: WireWaypointType) {
    setType(next);
    if (!nameTouched) setName('');
  }

  const resolvedLocation: HereLocation | null = editing
    ? { lng: editing.location.coordinates[0], lat: editing.location.coordinates[1] }
    : location;

  const manualLocationNeeded = !editing && locationSource === 'none' && !locating;
  const manualLng_num = Number(manualLng);
  const manualLat_num = Number(manualLat);
  const manualLocationValid =
    manualLng.trim() !== '' &&
    manualLat.trim() !== '' &&
    Number.isFinite(manualLng_num) &&
    Number.isFinite(manualLat_num) &&
    manualLng_num >= -180 &&
    manualLng_num <= 180 &&
    manualLat_num >= -90 &&
    manualLat_num <= 90;

  const finalLocation: HereLocation | null = manualLocationNeeded
    ? manualLocationValid
      ? { lng: manualLng_num, lat: manualLat_num }
      : null
    : resolvedLocation;

  const canSubmit = Boolean(type) && effectiveName.trim().length > 0 && Boolean(finalLocation) && !submitting;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!type || !finalLocation) return;

    const fields = meta?.fields ?? [];
    const shared = {
      name: effectiveName.trim(),
      notes: notes.trim() || undefined,
      standHeightM: fields.includes('standHeight') && standHeightM !== '' ? Number(standHeightM) : undefined,
      shootingLanesDeg: fields.includes('shootingLanes') && lanes.length > 0 ? lanes : undefined,
      huntableWinds: fields.includes('huntableWinds') && winds.size > 0 ? Array.from(winds) : undefined,
      cameraDirectionDeg:
        fields.includes('cameraDirection') && cameraDirectionDeg !== '' ? Number(cameraDirectionDeg) : undefined,
    };

    if (editing) {
      onSubmitUpdate?.({
        ...shared,
        location: { type: 'Point', coordinates: [finalLocation.lng, finalLocation.lat] },
        baseVersion: editing.version,
      });
    } else {
      onSubmitCreate({
        type,
        ...shared,
        location: { type: 'Point', coordinates: [finalLocation.lng, finalLocation.lat] },
      });
    }
  }

  return (
    <form className="wp-form" onSubmit={handleSubmit}>
      {!editing && (
        <div className="wp-type-grid" role="group" aria-label="Waypoint type">
          {WAYPOINT_TYPE_META.map((m) => (
            <button
              key={m.type}
              type="button"
              className={`wp-type-btn${type === m.type ? ' wp-type-btn--active' : ''}`}
              aria-pressed={type === m.type}
              onClick={() => pickType(m.type)}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      {type && meta && (
        <>
          {!editing && <p className="rl-hint wp-type-blurb">{meta.blurb}</p>}

          <Field id="wp-name" label="Name">
            <input
              id="wp-name"
              className="rl-input"
              type="text"
              value={effectiveName}
              placeholder={suggestedWaypointName(type, countOfType)}
              maxLength={120}
              onChange={(e) => {
                setNameTouched(true);
                setName(e.target.value);
              }}
            />
          </Field>

          {meta.fields.includes('standHeight') && (
            <Field id="wp-height" label="Stand height" hint="How high off the ground, in meters — helps judge shot angle and visibility.">
              <input
                id="wp-height"
                className="rl-input"
                type="number"
                inputMode="decimal"
                min={0}
                max={30}
                step={0.1}
                value={standHeightM}
                onChange={(e) => setStandHeightM(e.target.value === '' ? '' : Number(e.target.value))}
              />
            </Field>
          )}

          {meta.fields.includes('cameraDirection') && (
            <RangeField
              id="wp-camera-dir"
              label="Lens direction"
              min={0}
              max={359}
              step={5}
              value={cameraDirectionDeg === '' ? 0 : cameraDirectionDeg}
              onValueChange={(v) => setCameraDirectionDeg(v)}
              display={
                cameraDirectionDeg === ''
                  ? 'Not set'
                  : `${Math.round(cameraDirectionDeg)}° ${octantFromDeg(cameraDirectionDeg)}`
              }
              hint="The compass bearing the camera's lens points, so a photo's travel direction can be read against the map."
            />
          )}

          {meta.fields.includes('shootingLanes') && (
            <div className="rl-field">
              <label className="rl-field__label" htmlFor="wp-lane-dial">
                <span>Shooting lanes</span>
              </label>
              <div className="wp-lane-row">
                <input
                  id="wp-lane-dial"
                  type="range"
                  className="rl-range"
                  min={0}
                  max={359}
                  step={5}
                  value={laneDraft}
                  onChange={(e) => setLaneDraft(Number(e.target.value))}
                  aria-label="Lane bearing to add, in degrees"
                />
                <Button
                  type="button"
                  onClick={() => setLanes((prev) => (prev.includes(laneDraft) ? prev : [...prev, laneDraft].sort((a, b) => a - b)))}
                >
                  Add {laneDraft}° {octantFromDeg(laneDraft)}
                </Button>
              </div>
              {lanes.length > 0 && (
                <ul className="wp-lane-list">
                  {lanes.map((deg) => (
                    <li key={deg} className="wp-lane-chip">
                      <span>
                        {deg}° {octantFromDeg(deg)}
                      </span>
                      <Button
                        type="button"
                        variant="link"
                        aria-label={`Remove lane at ${deg} degrees`}
                        onClick={() => setLanes((prev) => prev.filter((d) => d !== deg))}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="rl-hint">Bearings of cleared shots from this stand. Add each lane you have brushed out.</p>
            </div>
          )}

          {meta.fields.includes('huntableWinds') && (
            <div className="rl-field">
              <label className="rl-field__label" htmlFor="wp-wind-N">
                <span>Winds this stand hunts clean on</span>
              </label>
              <div className="wp-octant-grid" role="group" aria-label="Huntable winds">
                {OCTANTS.map((o) => (
                  <button
                    key={o}
                    id={o === 'N' ? 'wp-wind-N' : undefined}
                    type="button"
                    className={`wp-type-btn${winds.has(o) ? ' wp-type-btn--active' : ''}`}
                    aria-pressed={winds.has(o)}
                    onClick={() =>
                      setWinds((prev) => {
                        const next = new Set(prev);
                        if (next.has(o)) next.delete(o);
                        else next.add(o);
                        return next;
                      })
                    }
                  >
                    {o}
                  </button>
                ))}
              </div>
              <p className="rl-hint">
                The wind directions your scent clears away from where deer approach this stand — feeds the wind check
                on this stand's own page.
              </p>
            </div>
          )}

          <Field
            id="wp-location"
            label="Location"
            value={
              finalLocation
                ? `${finalLocation.lat.toFixed(5)}, ${finalLocation.lng.toFixed(5)}`
                : locating
                  ? 'Finding you…'
                  : 'Not set'
            }
          >
            {!editing && !manualLocationNeeded && (
              <p className="rl-hint">
                {locationSource === 'gps'
                  ? 'Using your current GPS position.'
                  : 'Using the map’s current view — enable location for a more exact pin.'}
              </p>
            )}
            {manualLocationNeeded && (
              <div className="wp-latlng-row">
                <input
                  id="wp-location"
                  className="rl-input"
                  type="text"
                  inputMode="decimal"
                  placeholder="Latitude"
                  aria-label="Latitude"
                  value={manualLat}
                  onChange={(e) => setManualLat(e.target.value)}
                />
                <input
                  className="rl-input"
                  type="text"
                  inputMode="decimal"
                  placeholder="Longitude"
                  aria-label="Longitude"
                  value={manualLng}
                  onChange={(e) => setManualLng(e.target.value)}
                />
              </div>
            )}
          </Field>
          {manualLocationNeeded && (
            <Callout tone="warn">
              <p>
                No GPS fix and no map position to fall back on — enter coordinates by hand, or close this and try
                again once location is available.
              </p>
            </Callout>
          )}

          <Field id="wp-notes" label="Notes" hint="Optional — anything worth remembering next time you're here.">
            <textarea
              id="wp-notes"
              className="rl-input wp-textarea"
              rows={3}
              maxLength={4000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>

          {submitError && (
            <Callout tone="danger" role="alert">
              <p>{submitError}</p>
            </Callout>
          )}

          <div className="wp-form-actions">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {submitting ? 'Saving…' : editing ? 'Save changes' : `Save ${meta.label.toLowerCase()}`}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
