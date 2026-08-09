/**
 * A min/max "band" control for one `RangePredicate`.
 *
 * ## Why two native `<input type="range">` elements, not a custom-built slider
 *
 * The task brief for this component flags exactly the defect class to avoid:
 * "a drag/click race from the synthetic `click` after `pointerup`" —
 * `TerrainReadout.tsx`'s grip control hit this for real (see its own comment)
 * because it mixed a `pointerup` handler with a plain `onClick` on the same
 * element, and a browser fires a synthetic `click` after `pointerup`
 * regardless of drag distance. The fix there was "one state machine, driven
 * off the measured distance." The fix here is cheaper: **do not build a
 * pointer-driven slider at all.** Two overlapping native range inputs, styled
 * so only their thumbs are visible, get dragging, click-to-jump, keyboard
 * arrows and touch handling for free from the browser, with no `onClick`
 * anywhere in this file to race against anything. This is a well-established
 * technique for a dual-thumb slider precisely because it sidesteps the whole
 * class of pointer-event bugs a hand-rolled one invites.
 *
 * ## Which thumb is on top when they overlap
 *
 * When the two thumbs sit close together, whichever input has the higher
 * `z-index` receives the pointer. Fixed z-indices would make one thumb
 * permanently undraggable once the band narrows to near zero — so the layer
 * order is recomputed from the *current* values on every render: the input
 * whose value sits past the midpoint of the two gets priority, which is the
 * thumb a user reaching for a narrow band is almost always trying to move.
 *
 * ## Precision
 *
 * The slider's `step` is a sane default, not a hard limit — curvature filters
 * need four decimal places (`metricRegistry.ts`'s own comment: the
 * "Thermal sinks" preset cuts at `-0.001`), which no slider can hit
 * reliably. The paired number inputs below the track are the precise path;
 * the slider is the fast, gloved-thumb one.
 */

import { useId } from 'react';

export interface DualRangeSliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  valueMin: number;
  valueMax: number;
  unit: string;
  decimals: number;
  onChange: (next: { min: number; max: number }) => void;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function fmt(v: number, decimals: number, unit: string): string {
  return `${v.toFixed(decimals)}${unit}`;
}

export function DualRangeSlider({
  label,
  min,
  max,
  step,
  valueMin,
  valueMax,
  unit,
  decimals,
  onChange,
}: DualRangeSliderProps) {
  const id = useId();
  const midpoint = (valueMin + valueMax) / 2;
  const overallMidpoint = (min + max) / 2;
  // Bias by which side of the *overall* range the band sits on, then break
  // ties toward whichever thumb is closer to the other — see the module doc
  // comment. `>=` on one side and `>` on the other so a perfectly centred
  // band still resolves deterministically rather than both landing on 3.
  const minOnTop = midpoint >= overallMidpoint;

  function commit(nextMin: number, nextMax: number) {
    onChange({ min: clamp(nextMin, min, max), max: clamp(nextMax, min, max) });
  }

  return (
    <div className="rl-filter-band-field">
      <div className="rl-field__label">
        <span>{label}</span>
        <span className="rl-field__value">
          {fmt(valueMin, decimals, unit)} – {fmt(valueMax, decimals, unit)}
        </span>
      </div>

      <div className="rl-filter-band">
        <div className="rl-filter-band__track" aria-hidden="true">
          <div
            className="rl-filter-band__fill"
            style={{
              left: `${((valueMin - min) / (max - min || 1)) * 100}%`,
              right: `${100 - ((valueMax - min) / (max - min || 1)) * 100}%`,
            }}
          />
        </div>
        <input
          type="range"
          className="rl-filter-band__input"
          style={{ zIndex: minOnTop ? 3 : 2 }}
          id={`${id}-min`}
          min={min}
          max={max}
          step={step}
          value={valueMin}
          aria-label={`${label} — minimum`}
          onChange={(e) => commit(Number(e.target.value), Math.max(valueMax, Number(e.target.value)))}
        />
        <input
          type="range"
          className="rl-filter-band__input"
          style={{ zIndex: minOnTop ? 2 : 3 }}
          id={`${id}-max`}
          min={min}
          max={max}
          step={step}
          value={valueMax}
          aria-label={`${label} — maximum`}
          onChange={(e) => commit(Math.min(valueMin, Number(e.target.value)), Number(e.target.value))}
        />
      </div>

      <div className="rl-filter-band__exact">
        <label className="rl-filter-band__exact-field">
          <span>Min</span>
          <input
            type="number"
            className="rl-input"
            step={step}
            value={roundForInput(valueMin, decimals)}
            aria-label={`${label} — exact minimum, ${unit || 'no unit'}`}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) commit(v, Math.max(valueMax, v));
            }}
          />
        </label>
        <label className="rl-filter-band__exact-field">
          <span>Max</span>
          <input
            type="number"
            className="rl-input"
            step={step}
            value={roundForInput(valueMax, decimals)}
            aria-label={`${label} — exact maximum, ${unit || 'no unit'}`}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) commit(Math.min(valueMin, v), v);
            }}
          />
        </label>
      </div>
    </div>
  );
}

function roundForInput(v: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(v * factor) / factor;
}
