/**
 * The conditions block every observation form (full form and the fast blank-
 * sit path) shares.
 *
 * CLAUDE.md's own reason this exists: reconstructing hyperlocal historical
 * weather after the fact is unreliable, and every weather-correlation
 * analytic depends on these being captured at the time. What is captured
 * automatically, and what is not:
 *
 *  - **Wind direction** — read from the app's own `ConditionsBar` state, the
 *    same wind driving every other layer right now. Shown read-only; never a
 *    second, possibly-disagreeing input for the user to fill in by hand.
 *  - **Moon phase** — computed on-device (`moonPhase.ts`), no network needed.
 *  - **Temperature, pressure, pressure trend, wind speed** — no automatic
 *    source exists in this pass's territory (a weather API integration is a
 *    `backend-builder`/`offline-steward` scale piece of work, not
 *    `components/observations/**`'s). These stay optional and collapsed by
 *    default rather than presented as required fields to type — "capture
 *    what you can automatically; do not make the user type them" is honoured
 *    by *not asking* for what cannot be automatic, not by forcing entry.
 */

import { useState } from 'react';
import { Field } from '@hunt-maps/design';
import { moonPhase, moonPhaseLabel } from './moonPhase';
import { octantFromDeg } from './meta';

export interface ConditionsValue {
  temperatureC: number | '';
  pressureHpa: number | '';
  pressureTrend3h: number | '';
  windSpeedKph: number | '';
}

export interface ConditionsFieldsProps {
  windFromDeg: number | null;
  observedAt: Date;
  value: ConditionsValue;
  onChange: (value: ConditionsValue) => void;
  onSetWind?: () => void;
}

export function ConditionsFields({ windFromDeg, observedAt, value, onChange, onSetWind }: ConditionsFieldsProps) {
  const [expanded, setExpanded] = useState(false);
  const phase = moonPhase(observedAt);

  return (
    <div className="obs-conditions">
      <dl className="readout obs-conditions__auto">
        <dt>Wind</dt>
        <dd className={windFromDeg === null ? 'obs-conditions__unset' : undefined}>
          {windFromDeg === null ? (
            <>
              Not set
              {onSetWind && (
                <>
                  {' — '}
                  <button type="button" className="rl-btn rl-btn--link obs-inline-link" onClick={onSetWind}>
                    set it
                  </button>
                </>
              )}
            </>
          ) : (
            `${Math.round(windFromDeg)}° ${octantFromDeg(windFromDeg)}`
          )}
        </dd>
        <dt>Moon</dt>
        <dd>{moonPhaseLabel(phase)}</dd>
      </dl>

      <button
        type="button"
        className="rl-btn rl-btn--link obs-conditions__toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? 'Hide weather fields' : 'Add temperature, pressure or wind speed (optional)'}
      </button>

      {expanded && (
        <div className="obs-conditions__grid">
          <Field id="obs-temp" label="Temp (°C)">
            <input
              id="obs-temp"
              className="rl-input"
              type="number"
              inputMode="decimal"
              value={value.temperatureC}
              onChange={(e) => onChange({ ...value, temperatureC: e.target.value === '' ? '' : Number(e.target.value) })}
            />
          </Field>
          <Field id="obs-wind-speed" label="Wind speed (km/h)">
            <input
              id="obs-wind-speed"
              className="rl-input"
              type="number"
              inputMode="decimal"
              min={0}
              value={value.windSpeedKph}
              onChange={(e) => onChange({ ...value, windSpeedKph: e.target.value === '' ? '' : Number(e.target.value) })}
            />
          </Field>
          <Field id="obs-pressure" label="Pressure (hPa)">
            <input
              id="obs-pressure"
              className="rl-input"
              type="number"
              inputMode="decimal"
              value={value.pressureHpa}
              onChange={(e) => onChange({ ...value, pressureHpa: e.target.value === '' ? '' : Number(e.target.value) })}
            />
          </Field>
          <Field id="obs-pressure-trend" label="3h trend (hPa)" hint="Negative = falling.">
            <input
              id="obs-pressure-trend"
              className="rl-input"
              type="number"
              inputMode="decimal"
              value={value.pressureTrend3h}
              onChange={(e) =>
                onChange({ ...value, pressureTrend3h: e.target.value === '' ? '' : Number(e.target.value) })
              }
            />
          </Field>
        </div>
      )}
    </div>
  );
}

export const EMPTY_CONDITIONS: ConditionsValue = {
  temperatureC: '',
  pressureHpa: '',
  pressureTrend3h: '',
  windSpeedKph: '',
};
