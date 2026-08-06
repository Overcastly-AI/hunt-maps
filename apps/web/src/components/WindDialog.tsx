import { Button, RangeField, Sheet, WindNeedle } from '@hunt-maps/design';

export interface WindDialogProps {
  mode: 'wind' | 'time';
  windFromDeg: number | null;
  atUtc: Date;
  onWindChange: (deg: number | null) => void;
  onTimeChange: (at: Date) => void;
  onClose: () => void;
}

/**
 * Wind and time editors, opened from the conditions bar.
 *
 * These live behind the bar rather than inside it because setting them is
 * occasional while *seeing* them is constant. The bar answers "what am I looking
 * at"; this answers "change it".
 *
 * The wind editor shows a live needle rather than only a number, because a
 * hunter thinks in compass directions read against the ground, not in degrees.
 */
export function WindDialog({
  mode,
  windFromDeg,
  atUtc,
  onWindChange,
  onTimeChange,
  onClose,
}: WindDialogProps) {
  if (mode === 'time') {
    return (
      <Sheet title="Date & time" onClose={onClose}>
        <p className="rl-hint" style={{ marginTop: 0 }}>
          Sun and thermal layers move through the day and through the season. Scrub this to see
          where light lands at first light on opening morning.
        </p>
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
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
          <Button onClick={() => onTimeChange(new Date())}>Now</Button>
          <Button onClick={() => onTimeChange(nextFirstLight(atUtc))}>Next first light</Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Wind" onClose={onClose}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: 'var(--space-4) 0 var(--space-5)',
        }}
      >
        <WindNeedle
          fromDeg={windFromDeg}
          width={132}
          height={132}
          style={{ color: 'var(--color-accent)' }}
        />
      </div>

      <RangeField
        id="wind-dial"
        label="Wind from"
        min={0}
        max={359}
        step={5}
        value={windFromDeg ?? 0}
        onValueChange={onWindChange}
        display={
          windFromDeg === null ? 'Not set' : `${Math.round(windFromDeg)}° ${octant(windFromDeg)}`
        }
        aria-label="Wind direction in degrees the wind is coming from"
        hint="The direction the wind is coming FROM, the way a forecast states it."
      />

      {/* Cardinal shortcuts. Nobody drags a slider to exactly 270. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 'var(--space-2)',
        }}
      >
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

      {windFromDeg !== null && (
        <Button variant="link" onClick={() => onWindChange(null)} style={{ marginTop: 'var(--space-3)' }}>
          Clear wind
        </Button>
      )}
    </Sheet>
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
