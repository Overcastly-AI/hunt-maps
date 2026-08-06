/**
 * UI primitives.
 *
 * Every one encodes a field constraint that is easy to lose when writing a
 * component ad hoc in an app:
 *
 *  - interactive targets never fall below the gloved-fingertip floor
 *  - state is never carried by colour alone
 *  - a control whose input is missing says *why* rather than rendering a
 *    plausible default
 *  - anything floating over the map uses the shared glass material, so the
 *    imagery underneath — which is the evidence — stays visible
 *
 * Keeping them here rather than in `apps/web` means a second surface (a native
 * shell, a print view, an embedded share page) inherits those constraints
 * instead of re-deriving them badly.
 */

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { CloseIcon, WindNeedle } from './icons';

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Control rail
// ---------------------------------------------------------------------------

export function Rail({ children }: { children: ReactNode }) {
  return <div className="rl-rail rl-glass">{children}</div>;
}

export interface RailButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required — the rail is icon-only, so every control needs a name. */
  label: string;
  active?: boolean;
  children: ReactNode;
}

export function RailButton({ label, active, children, ...rest }: RailButtonProps) {
  return (
    <button
      type="button"
      className="rl-rail__btn"
      // Icon-only controls are invisible to a screen reader without this, and
      // the tooltip is what makes them learnable for everyone else.
      aria-label={label}
      title={label}
      aria-pressed={active}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

export interface SheetProps {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  action?: ReactNode;
}

/**
 * The layers panel: a drawer on desktop, a bottom sheet on mobile.
 *
 * It overlays the map rather than sitting beside it. A permanent sidebar would
 * cost a third of the screen forever to show controls that are touched for a
 * few seconds at a time — and the map is the product.
 */
export function Sheet({ title, onClose, children, action }: SheetProps) {
  return (
    <aside
      className="rl-sheet rl-sheet--drawer"
      role="dialog"
      aria-label={typeof title === 'string' ? title : 'Panel'}
    >
      <div className="rl-sheet__grip" />
      <header className="rl-sheet__head">
        <h2 className="rl-sheet__title">{title}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {action}
          <RailButton label="Close panel" onClick={onClose}>
            <CloseIcon width={18} height={18} />
          </RailButton>
        </div>
      </header>
      <div className="rl-sheet__body">{children}</div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Conditions bar
// ---------------------------------------------------------------------------

export interface ConditionsBarProps {
  /** Direction the wind comes FROM, degrees clockwise from north. */
  windFromDeg: number | null;
  windOctant: string | null;
  atLabel: string;
  /** Modelled thermal phase, when a time and place are known. */
  thermal?: { phase: string; note: string } | null;
  onWindClick: () => void;
  onTimeClick: () => void;
}

/**
 * The signature element.
 *
 * Wind, time and thermal phase live here permanently rather than inside the
 * layers sheet, because in this product they are not settings — they change
 * what every layer *means*. A bedding map on a west wind and the same map on an
 * east wind are different claims about the ground, and a user must never be
 * unsure which one is on screen. Burying that in a panel would make the map
 * quietly ambiguous.
 */
export function ConditionsBar({
  windFromDeg,
  windOctant,
  atLabel,
  thermal,
  onWindClick,
  onTimeClick,
}: ConditionsBarProps) {
  return (
    <div className="rl-conditions rl-glass">
      <button type="button" className="rl-conditions__cell" onClick={onWindClick}>
        <WindNeedle
          fromDeg={windFromDeg}
          className={cx('rl-needle', windFromDeg === null && 'rl-needle--unset')}
        />
        <span>
          <span className="rl-conditions__label">Wind from</span>
          <span
            className={cx(
              'rl-conditions__value',
              windFromDeg === null && 'rl-conditions__value--unset',
            )}
          >
            {windFromDeg === null ? 'Not set' : `${Math.round(windFromDeg)}° ${windOctant}`}
          </span>
        </span>
      </button>

      <button type="button" className="rl-conditions__cell" onClick={onTimeClick}>
        <span>
          <span className="rl-conditions__label">Date &amp; time</span>
          <span className="rl-conditions__value">{atLabel}</span>
        </span>
      </button>

      {thermal && (
        <div className="rl-conditions__cell" title={thermal.note}>
          <span>
            <span className="rl-conditions__label">Thermals</span>
            <span className="rl-conditions__value">{thermal.phase}</span>
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chip
// ---------------------------------------------------------------------------

export type ChipTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info';

export interface ChipProps {
  tone?: ChipTone;
  children: ReactNode;
  title?: string;
  /**
   * Optional leading glyph. Present so status is never carried by colour
   * alone — a colourblind user reads the mark, everyone reads the text.
   */
  glyph?: string;
}

export function Chip({ tone = 'neutral', children, title, glyph }: ChipProps) {
  return (
    <span className={cx('rl-chip', `rl-chip--${tone}`)} title={title}>
      {glyph && (
        <span className="rl-chip__glyph" aria-hidden="true">
          {glyph}
        </span>
      )}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Callout
// ---------------------------------------------------------------------------

export interface CalloutProps {
  tone?: 'info' | 'warn' | 'danger';
  children: ReactNode;
  /** `status` for advisory content, `alert` for something that blocks the user. */
  role?: 'status' | 'alert';
}

export function Callout({ tone = 'info', children, role = 'status' }: CalloutProps) {
  return (
    <div className={cx('rl-callout', `rl-callout--${tone}`)} role={role}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'link' | 'danger';
  block?: boolean;
}

export function Button({
  variant = 'ghost',
  block,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('rl-btn', `rl-btn--${variant}`, block && 'rl-btn--block', className)}
      {...rest}
    />
  );
}

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------

export interface FieldProps {
  id: string;
  label: ReactNode;
  value?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}

export function Field({ id, label, value, hint, children }: FieldProps) {
  return (
    <div className="rl-field">
      <label className="rl-field__label" htmlFor={id}>
        <span>{label}</span>
        {value !== undefined && <span className="rl-field__value">{value}</span>}
      </label>
      {children}
      {hint && <p className="rl-hint">{hint}</p>}
    </div>
  );
}

export interface RangeFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  id: string;
  label: ReactNode;
  value: number;
  onValueChange: (value: number) => void;
  display?: ReactNode;
  hint?: ReactNode;
}

export function RangeField({
  id,
  label,
  value,
  onValueChange,
  display,
  hint,
  ...rest
}: RangeFieldProps) {
  return (
    <Field id={id} label={label} value={display ?? value} hint={hint}>
      <input
        id={id}
        type="range"
        className="rl-range"
        value={value}
        onChange={(e) => onValueChange(Number(e.target.value))}
        {...rest}
      />
    </Field>
  );
}

// ---------------------------------------------------------------------------
// ToggleRow
// ---------------------------------------------------------------------------

export interface ToggleRowProps {
  id: string;
  label: ReactNode;
  checked: boolean;
  onToggle: () => void;
  /** One sentence on what this shows and why it matters. */
  blurb?: ReactNode;
  swatch?: string;
  /**
   * When set, the row is disabled and this explains what is missing.
   *
   * Load-bearing: a wind-dependent layer with no wind set renders *something*,
   * and that something is misleading. Disabling with a stated reason is the
   * honest behaviour, and making it a required part of the disabled state is
   * how the design system enforces it rather than hoping each screen remembers.
   */
  blockedReason?: string;
  children?: ReactNode;
}

export function ToggleRow({
  id,
  label,
  checked,
  onToggle,
  blurb,
  swatch,
  blockedReason,
  children,
}: ToggleRowProps) {
  const blocked = Boolean(blockedReason);
  const describedBy = blurb || blockedReason ? `${id}-desc` : undefined;

  return (
    <div className={cx('rl-toggle', checked && 'rl-toggle--on', blocked && 'rl-toggle--blocked')}>
      <label className="rl-toggle__main" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={blocked}
          onChange={onToggle}
          aria-describedby={describedBy}
        />
        {swatch && (
          <span className="rl-swatch" style={{ background: swatch }} aria-hidden="true" />
        )}
        <span className="rl-toggle__label">{label}</span>
      </label>
      {(blurb || blockedReason) && (
        <p id={describedBy} className={cx('rl-toggle__blurb', blocked && 'rl-toggle__blurb--warn')}>
          {blockedReason ?? blurb}
        </p>
      )}
      {checked && !blocked && children && <div className="rl-toggle__extra">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

export interface LegendEntry {
  swatch: string;
  label: string;
}

export function Legend({ entries }: { entries: LegendEntry[] }) {
  return (
    <ul className="rl-legend">
      {entries.map((entry) => (
        <li key={entry.label}>
          <span className="rl-swatch" style={{ background: entry.swatch }} aria-hidden="true" />
          {entry.label}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// SectionHeading
// ---------------------------------------------------------------------------

export function SectionHeading({
  children,
  hint,
  action,
}: {
  children: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <h3 className="rl-section-heading">
      <span>{children}</span>
      {hint && <span className="rl-section-heading__hint">{hint}</span>}
      {action}
    </h3>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
  label,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <section className={cx('rl-panel', className)} aria-label={label}>
      {(title || action) && (
        <header className="rl-panel__head">
          {title && <h3 className="rl-panel__title">{title}</h3>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

export type EvidenceGrade = 'measured' | 'inferred' | 'doctrine' | 'assumed';

/**
 * Marks how well-supported a displayed value is.
 *
 * A design-system primitive rather than an app component on purpose.
 * Ridgeline's credibility rests on never claiming more than it knows, and the
 * only way that survives contact with a growing UI is if showing the evidence
 * grade is the path of least resistance. See `docs/EVIDENCE.md` for what each
 * grade means and `.claude/agents/game-biologist.md` for who assigns them.
 */
export function Confidence({ grade, note }: { grade: EvidenceGrade; note?: string }) {
  const label: Record<EvidenceGrade, string> = {
    measured: 'Measured',
    inferred: 'Inferred',
    doctrine: 'Field doctrine',
    assumed: 'Assumption',
  };
  const tone: Record<EvidenceGrade, ChipTone> = {
    measured: 'ok',
    inferred: 'info',
    doctrine: 'warn',
    assumed: 'danger',
  };
  const glyph: Record<EvidenceGrade, string> = {
    measured: '●',
    inferred: '◐',
    doctrine: '○',
    assumed: '?',
  };

  return (
    <Chip tone={tone[grade]} glyph={glyph[grade]} title={note}>
      {label[grade]}
    </Chip>
  );
}
