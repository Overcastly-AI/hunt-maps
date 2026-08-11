/**
 * The desktop dock — persistent chrome replacing the old drawer-on-desktop
 * (`docs/design/PLAN-direction-a.md` §c, `BACKLOG R63`).
 *
 * Structural only. `Dock` supplies the chassis (header / scrollable body /
 * footer, the `plate` material, the collapse mechanics) and never decides
 * *what* fills it — the app composes its own content (today: the existing
 * tabbed drawer, an Offline Coverage section, this footer) inside. That
 * split is deliberate: the tabbed drawer (Layers / Stands / Sightings)
 * shipped after this plan was written and lives in `apps/web`, outside this
 * package, and `Dock` has no business knowing its internals — it only needs
 * to give it a scrollable place to sit.
 */

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { ChevronLeftIcon } from './icons';
import {
  EVIDENCE_GLOSS,
  EVIDENCE_GRADES,
  EVIDENCE_GLYPH,
  EVIDENCE_LABEL,
  EVIDENCE_TONE,
} from './primitives';

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export interface DockProps {
  /**
   * When `true`, the dock animates to zero width (`layout.dock-collapsed-
   * width`) rather than unmounting. Unmounting-on-collapse would mean the
   * width transition has nothing to animate *from* on the frame collapse is
   * requested; staying mounted at `width: 0` keeps the transition real.
   *
   * A `width: 0` container with focusable content inside it is a genuine
   * defect on its own, though — invisible on screen, but still a tab stop
   * (`catching-ui-defects`, failure class 2, "present but unreachable").
   * `Dock` sets the DOM `inert` property on its own root exactly when
   * `collapsed` is true, which removes it from both the tab order and
   * pointer hit-testing without touching `display` (which would kill the
   * transition it exists to run).
   */
  collapsed: boolean;
  children: ReactNode;
}

/**
 * The dock chassis: fixed-width, full chassis height, `plate` material, a
 * hard structural edge (`border-right`) rather than `glass`'s soft blurred
 * one — Direction A's own reasoning applies here exactly as it does to
 * `ConditionsBar`: "a hard edge on an unblurred plate reads as an instrument
 * bezel."
 *
 * The width transition lives on this root element; `.rl-dock__inner` stays a
 * fixed `layout.dock-width` regardless of the root's animated width, so text
 * inside never reflows mid-transition — it is revealed/hidden by the root's
 * clip, not resized.
 */
export function Dock({ collapsed, children }: DockProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.inert = collapsed;
  }, [collapsed]);

  return (
    <aside
      ref={ref}
      className={cx('rl-dock', collapsed && 'rl-dock--collapsed')}
      aria-label="Map dock"
      // Redundant with `inert` for a browser that supports it, and the only
      // signal at all for one that does not yet — `aria-hidden` costs
      // nothing to also set.
      aria-hidden={collapsed}
    >
      <div className="rl-dock__inner">{children}</div>
    </aside>
  );
}

export interface DockHeaderProps {
  title: ReactNode;
  /** Property name, or a stated reason none is selected — never blank. */
  subtitle?: ReactNode;
  /** Map-centre coordinates, tabular mono. */
  coords?: ReactNode;
}

export function DockHeader({ title, subtitle, coords }: DockHeaderProps) {
  return (
    <header className="rl-dock__header">
      <div className="rl-dock__wordmark">{title}</div>
      {subtitle && <div className="rl-dock__locale">{subtitle}</div>}
      {coords && <div className="rl-dock__coords rl-mono">{coords}</div>}
    </header>
  );
}

/**
 * The one real scrollable region (`docs/design/PLAN-direction-a.md` §c gap
 * 2) — built that way from day one even though today's content does not yet
 * overflow it, because a saved-filter list, saved queries and property
 * boundaries are all on `docs/ROADMAP.md` and will make it overflow soon.
 */
export function DockBody({ children }: { children: ReactNode }) {
  return <div className="rl-dock__body">{children}</div>;
}

export interface DockSectionProps {
  title: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}

/** A titled section inside the dock body — e.g. Offline Coverage. */
export function DockSection({ title, hint, children }: DockSectionProps) {
  return (
    <section className="rl-dock__section">
      <h3 className="rl-dock__section-title">
        <span>{title}</span>
        {hint && <span className="rl-section-heading__hint">{hint}</span>}
      </h3>
      {children}
    </section>
  );
}

/**
 * The evidence-grade legend — every grade, always, sourced directly from
 * `Confidence`'s own label/tone/glyph maps (`primitives.tsx`), never a
 * re-typed copy that could silently drift from what the chip itself renders
 * (`docs/design/PLAN-direction-a.md` §d, and the 2026-08-06 product audit's
 * "the register's content ships as data, not just prose in `docs/`").
 */
export function EvidenceLegend() {
  return (
    <div className="rl-dock__legend">
      <span className="rl-eyebrow rl-dock__legend-title">Evidence grade</span>
      <ul className="rl-dock__legend-list">
        {EVIDENCE_GRADES.map((grade) => (
          <li key={grade} className="rl-dock__legend-row">
            {/* `Chip`'s tones (`ok`/`warn`/`info`/`critical`) are already the
                class suffix `.rl-chip--*` uses — reusing the same suffix here
                keeps the legend's swatch colours tied to the one place
                tone-to-colour is decided, rather than a second mapping that
                could disagree with it. */}
            <span
              className={cx(
                'rl-dock__legend-swatch',
                `rl-dock__legend-swatch--${EVIDENCE_TONE[grade]}`,
              )}
              aria-hidden="true"
            />
            <span className="rl-dock__legend-glyph" aria-hidden="true">
              {EVIDENCE_GLYPH[grade]}
            </span>
            <span className="rl-dock__legend-label">{EVIDENCE_LABEL[grade]}</span>
            <span className="rl-dock__legend-gloss">{EVIDENCE_GLOSS[grade]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface DockFooterProps {
  onCollapse: () => void;
  children?: ReactNode;
}

/**
 * The evidence legend plus the collapse control.
 *
 * The collapse control is a labelled `<button>` reading "Collapse dock", not
 * an icon alone — the icon-only lesson from `docs/AUDIT-PRODUCT.md` F4
 * applies here exactly as it did to the old rail, and a permanent, always-on
 * piece of chrome earns the extra width a word costs far more than a
 * transient control would.
 */
export function DockFooter({ onCollapse, children }: DockFooterProps) {
  return (
    <footer className="rl-dock__footer">
      {children}
      <EvidenceLegend />
      <div className="rl-dock__collapse-row">
        <button type="button" className="rl-dock__collapse" onClick={onCollapse}>
          <ChevronLeftIcon width={14} height={14} />
          Collapse dock
        </button>
      </div>
    </footer>
  );
}
