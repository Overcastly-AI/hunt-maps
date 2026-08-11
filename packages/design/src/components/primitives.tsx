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

import { useEffect, useRef } from 'react';
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
// Command bar
// ---------------------------------------------------------------------------

export interface CommandBarCellProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * A short, always-visible word naming the control — e.g. "Layers",
   * "Offline". Required, and rendered as text, not just an `aria-label`:
   * `title` never fires on a touchscreen, so an icon with only a hover
   * tooltip is inert in the field (`docs/AUDIT-PRODUCT.md` F4). The word is
   * the affordance.
   */
  label: string;
  active?: boolean;
  /**
   * A fuller accessible name, for when the visible word under-states the
   * action — e.g. the visible word "Offline" behind the description "Save
   * this area for offline use". Optional; when set it replaces the
   * accessible name entirely, so it must contain `label` (a substring match
   * is enough) or a screen-reader user and a sighted user end up being told
   * two unrelated things about the same control — WCAG 2.5.3 Label in Name.
   */
  description?: string;
  /** The icon. Decorative — `label` already carries the name, so this is `aria-hidden`. */
  children: ReactNode;
}

export function CommandBarCell({
  label,
  active,
  description,
  children,
  className,
  ...rest
}: CommandBarCellProps) {
  return (
    <button
      type="button"
      className={cx('rl-command__cell', className)}
      aria-label={description}
      title={description ?? label}
      aria-pressed={active}
      {...rest}
    >
      <span className="rl-command__icon" aria-hidden="true">
        {children}
      </span>
      <span className="rl-command__label">{label}</span>
    </button>
  );
}

/**
 * A horizontal bar of labelled cells whose height does not depend on how many
 * cells it holds.
 *
 * Replaces `.rl-rail` in the bottom-left corner (`docs/AUDIT-PRODUCT.md`
 * recs #17-#18, BACKLOG R44). `.rl-rail` stacked buttons in a column, so its
 * container had to reserve `--space-touch * N` of clearance for whatever *N*
 * happened to be that week — a constant hand-computed in a different file
 * from the buttons it counted (F7), and it had already produced a real
 * defect (F6, the dead middle button nobody could tell apart from the two
 * live ones) before the roadmap even reached its planned nine controls. A
 * row does not have this problem: cells lay out side by side and the bar's
 * own height is fixed by its tallest cell, never by how many there are.
 *
 * Every cell is built the way `.rl-conditions__cell` is — no explicit width,
 * sized by its own flex share of the row rather than pinned inside a
 * container that stretches around it. That is not a style choice; it is the
 * field audit's hard constraint (`docs/QA-FIELD.md`, "Note to the sibling
 * audit"): a fixed-width child inside a stretched container is exactly the
 * shape that left ~85% of `.rl-rail`'s painted glass belonging to no button
 * at all on a phone (BACKLOG R43). Here the button *is* the flex item that
 * grows to fill its share of the row, so the painted surface and the
 * interactive surface can never disagree, at any cell count.
 */
export function CommandBar({ children }: { children: ReactNode }) {
  return <div className="rl-command rl-glass">{children}</div>;
}

// ---------------------------------------------------------------------------
// TabBar — switches which panel occupies the one drawer slot
// ---------------------------------------------------------------------------

/**
 * A row of tabs deciding which panel currently occupies the drawer slot
 * (Layers / Stands / Sightings — `docs/AUDIT-PRODUCT.md` rec 20).
 *
 * Not a fourth `CommandBarCell`: the command bar's whole point is that its
 * height never depends on how many controls it has, and a persistent panel
 * (as opposed to the drawer, an offline download, or a conditions reading)
 * is meant to live *inside* the one drawer slot rather than add a new bar.
 * `TabBar` is that inside-the-drawer control — visually smaller and text-only
 * (no icon column) so it reads as a sub-navigation strip belonging to the
 * panel beneath it, not a second command bar competing with the real one.
 */
export function TabBar({ children }: { children: ReactNode }) {
  return (
    <div className="rl-tabbar rl-glass" role="tablist">
      {children}
    </div>
  );
}

export interface TabBarButtonProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}

export function TabBarButton({ active, onClick, children }: TabBarButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cx('rl-tabbar__tab', active && 'rl-tabbar__tab--active')}
      onClick={onClick}
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
  /**
   * Editors render inside their own cell, so each popover's caret points at the
   * control that opened it. Anchoring to the bar as a whole would leave the
   * time editor's caret pointing at the wind cell — a small lie about which
   * control you are editing.
   */
  windEditor?: ReactNode;
  timeEditor?: ReactNode;
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
  windEditor,
  timeEditor,
}: ConditionsBarProps) {
  return (
    <div className="rl-conditions rl-plate">
      <div className="rl-popover-anchor">
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
        {windEditor}
      </div>

      <div className="rl-popover-anchor">
        <button type="button" className="rl-conditions__cell" onClick={onTimeClick}>
          <span>
            <span className="rl-conditions__label">Date &amp; time</span>
            <span className="rl-conditions__value">{atLabel}</span>
          </span>
        </button>
        {timeEditor}
      </div>

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

export type ChipTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'critical';

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

export interface RangeFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange'
> {
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
  /**
   * An action rendered beside the label, always visible regardless of
   * checked state — e.g. an "Edit" link on a saved filter row. Deliberately
   * separate from `children`, which only appears once the row is switched
   * on: an edit affordance has to work on a filter the user has *not* turned
   * on yet, so it cannot share that gate.
   */
  action?: ReactNode;
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
  action,
  children,
}: ToggleRowProps) {
  const blocked = Boolean(blockedReason);
  const describedBy = blurb || blockedReason ? `${id}-desc` : undefined;

  return (
    <div className={cx('rl-toggle', checked && 'rl-toggle--on', blocked && 'rl-toggle--blocked')}>
      <div className="rl-toggle__head">
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
        {action && <span className="rl-toggle__action">{action}</span>}
      </div>
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
 * Every grade, worst-to-best evidence... no — **best-to-worst**, matching the
 * order `docs/EVIDENCE.md` and the dock's own footer legend both use. Exported
 * so a legend (`Dock`'s footer, `packages/design/src/components/dock.tsx`) can
 * enumerate every grade without re-typing the list and risking it drift from
 * this type.
 */
export const EVIDENCE_GRADES: readonly EvidenceGrade[] = [
  'measured',
  'inferred',
  'doctrine',
  'assumed',
];

/**
 * `Confidence`'s own label/tone/glyph, at module scope so a legend can read
 * the same source of truth the chip itself renders from — never a second,
 * independently-typed copy that can silently drift from what the chip
 * actually says (`docs/design/PLAN-direction-a.md` §d).
 */
export const EVIDENCE_LABEL: Record<EvidenceGrade, string> = {
  measured: 'Measured',
  inferred: 'Inferred',
  doctrine: 'Field doctrine',
  assumed: 'Assumption',
};

export const EVIDENCE_TONE: Record<EvidenceGrade, ChipTone> = {
  measured: 'ok',
  inferred: 'info',
  doctrine: 'warn',
  // Not `danger` — that tone renders in hunter-safety orange
  // (`--color-blaze`), reserved for real alerts, and an "Assumed" evidence
  // grade sharing it with "your storage is not persisting" is the exact
  // coincidence `docs/design/PLAN-direction-a.md` §a warns becomes a real
  // confusion the day both appear on the same screen — which they do, in
  // `LayersSheet`.
  assumed: 'critical',
};

export const EVIDENCE_GLYPH: Record<EvidenceGrade, string> = {
  measured: '●',
  inferred: '◐',
  doctrine: '○',
  assumed: '?',
};

/**
 * One line of what the grade means — the dock footer's legend gloss column.
 * Paraphrased from `docs/EVIDENCE.md`'s own four-row table (its wording is
 * a full sentence written for that doc, not a ~24-character legend cell), so
 * this is kept short deliberately rather than copied verbatim — but it must
 * never say something `docs/EVIDENCE.md` itself would disagree with, so a
 * change to the grading language belongs in that doc first.
 */
export const EVIDENCE_GLOSS: Record<EvidenceGrade, string> = {
  measured: 'Direct, peer-reviewed measurement',
  inferred: 'Derived from measured findings',
  doctrine: 'Field practice, not measured',
  assumed: 'A number the model needed',
};

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
  return (
    <Chip tone={EVIDENCE_TONE[grade]} glyph={EVIDENCE_GLYPH[grade]} title={note}>
      {EVIDENCE_LABEL[grade]}
    </Chip>
  );
}

// ---------------------------------------------------------------------------
// Popover
// ---------------------------------------------------------------------------

export interface PopoverProps {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A small editor anchored to the control that opened it.
 *
 * ## Why this exists separately from `Sheet`
 *
 * The wind and time editors were originally full-height drawers, and that was
 * wrong three ways:
 *
 *  1. **Scale.** ~300px of content in a 1200px chassis. A drawer is built for a
 *     long scrolling list; these are four controls.
 *  2. **It moved its own trigger.** The drawer pushes the bottom chrome aside,
 *     so opening the wind editor slid the conditions bar — the thing the user
 *     had just clicked — out from under their cursor.
 *  3. **No spatial relationship.** A control launched from the bottom of the
 *     screen appeared as a panel on the far left.
 *
 * A popover fixes all three: sized to its content, anchored above its trigger,
 * and it moves nothing. `Sheet` stays for the layer list, which really is long.
 *
 * Positioning is CSS-only — the popover renders inside a `position: relative`
 * anchor next to the trigger, so it follows the trigger wherever the layout puts
 * it. No measuring, no reflow on resize, nothing to get stale.
 */
export function Popover({ title, onClose, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onPointer = (e: PointerEvent) => {
      const el = ref.current;
      if (!el || el.contains(e.target as Node)) return;
      // The trigger toggles on click; closing here too would immediately
      // reopen it. Ignore pointer events that landed on a conditions cell.
      if ((e.target as HTMLElement).closest?.('.rl-conditions__cell')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="rl-popover rl-glass"
      role="dialog"
      aria-label={typeof title === 'string' ? title : 'Editor'}
    >
      <header className="rl-popover__head">
        <h2 className="rl-popover__title">{title}</h2>
        <RailButton label="Close" onClick={onClose}>
          <CloseIcon width={16} height={16} />
        </RailButton>
      </header>
      <div className="rl-popover__body">{children}</div>
    </div>
  );
}

/** Wraps a trigger so a `Popover` can anchor above it with no JS positioning. */
export function PopoverAnchor({ children }: { children: ReactNode }) {
  return <div className="rl-popover-anchor">{children}</div>;
}
