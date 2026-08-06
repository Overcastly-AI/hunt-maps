import { Button, Popover, RangeField, WindNeedle } from '@hunt-maps/design';

export interface ConditionsEditorProps {
  mode: 'wind' | 'time';
  windFromDeg: number | null;
  atUtc: Date;
  onWindChange: (deg: number | null) => void;
  onTimeChange: (at: Date) => void;
  onClose: () => void;
}

/**
 * Wind and time editors.
 *
 * These are popovers anchored to the conditions bar, not drawers. Setting them
 * is occasional; *seeing* them is constant. The bar answers "what am I looking
 * at", this answers "change it", and it appears attached to the cell that
 * opened it so the relationship is obvious.
 */
export function ConditionsEditor({
  mode,
  windFromDeg,
  atUtc,
  onWindChange,
  onTimeChange,
  onClose,
}: ConditionsEditorProps) {
  if (mode === 'time') {
    return (
      <Popover title="Date & time" onClose={onClose}>
        <label className="rl-field__label" htmlFor="time-input">
          When
        </label>
        <input
          id="time-input"
          className="rl-input"
          type="datetime-local"
          value={toLocalInput(atUtc)}
          onChange={(e) => {
            const next = new Date(e.target.value);
            if (!Number.isNaN(next.getTime())) onTimeChange(next);
          }}
        />
        <div className="rl-cardinals" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Button onClick={() => onTimeChange(new Date())}>Now</Button>
          <Button onClick={() => onTimeChange(nextFirstLight(atUtc))}>First light</Button>
        </div>
        <p className="rl-hint">
          Sun and thermal layers move through the day and through the season. Scrub this to see
          where light lands on opening morning.
        </p>
      </Popover>
    );
  }

  return (
    <Popover title="Wind" onClose={onClose}>
      <div className="rl-compass">
        <WindNeedle fromDeg={windFromDeg} width={92} height={92} />
      </div>

      <RangeField
        id="wind-dial"
        label="From"
        min={0}
        max={359}
        step={5}
        value={windFromDeg ?? 0}
        onValueChange={onWindChange}
        display={
          windFromDeg === null ? 'Not set' : `${Math.round(windFromDeg)}° ${octant(windFromDeg)}`
        }
        aria-label="Wind direction in degrees the wind is coming from"
      />

      {/* Cardinal shortcuts. Nobody drags a slider to exactly 270. */}
      <div className="rl-cardinals">
        {(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const).map((name, i) => (
          <Button
            key={name}
            variant={windFromDeg !== null && octant(windFromDeg) === name ? 'primary' : 'ghost'}
            onClick={() => onWindChange(i * 45)}
          >
            {name}
          </Button>
        ))}
      </div>

      <p className="rl-hint">The direction the wind comes FROM, the way a forecast states it.</p>

      {windFromDeg !== null && (
        <Button
          variant="link"
          onClick={() => onWindChange(null)}
          style={{ marginTop: 'var(--space-2)' }}
        >
          Clear wind
        </Button>
      )}
    </Popover>
  );
}

function octant(deg: number): string {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** `datetime-local` wants local wall time with no zone suffix. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * Jump to roughly half an hour before sunrise tomorrow — the moment a hunter is
 * actually planning for. Approximated at 06:00 local rather than solved exactly,
 * because the time scrub is for exploration and the solar layers recompute from
 * whatever it lands on.
 */
function nextFirstLight(from: Date): Date {
  const next = new Date(from);
  next.setDate(next.getDate() + 1);
  next.setHours(6, 0, 0, 0);
  return next;
}
