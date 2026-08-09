/**
 * The shared frame for `LoginScreen`/`RegisterScreen`.
 *
 * ## On "styled per `docs/design/direction-a-instrument.html`"
 *
 * That file is a static mock of a *different, not-yet-landed* token set —
 * cyan accent, system-stack fonts, zero-radius chrome — described as a plan
 * only in `docs/design/PLAN-direction-a.md` ("plan only, not yet reviewed, no
 * app code written", 2026-08-08). `packages/design/src/tokens.ts` still ships
 * the current scheme (survey-brass accent, Barlow, the existing radius
 * scale), and this task's territory is explicitly `lib/api/**` and
 * `components/auth/**` — **not** `packages/**`, where every visual token
 * lives per `CLAUDE.md`. Landing Direction A's tokens is real, separate work
 * with its own review (`PLAN-direction-a.md` §a-§f), not something to
 * shortcut by hard-coding Direction A's literal colours into one screen while
 * every other surface in the app stays on the current palette — that would
 * both violate "no literal colours outside `packages/design`" and ship two
 * different design languages in the same app.
 *
 * So: this screen is built from the design system that is actually shipped
 * today — the same `rl-glass`/`Panel`/`Field`/`Button` vocabulary
 * `ConditionsBar` and `LayersSheet` already use — for visual consistency with
 * the rest of the live app. Flagged here rather than silently diverging from
 * the brief.
 */

import type { ReactNode } from 'react';
import { ContourIcon } from '@hunt-maps/design';

export function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="auth-shell">
      <div className="auth-card rl-glass">
        <div className="auth-card__brand">
          <ContourIcon width={22} height={22} aria-hidden="true" />
          <span>Ridgeline</span>
        </div>
        <p className="auth-card__eyebrow">{eyebrow}</p>
        <h1 className="auth-card__title">{title}</h1>
        <p className="auth-card__subtitle">{subtitle}</p>
        {children}
        <div className="auth-card__footer">{footer}</div>
      </div>
    </div>
  );
}
