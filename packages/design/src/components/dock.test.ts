import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Dock, DockBody, DockFooter, DockHeader, DockSection, EvidenceLegend } from './dock';
import {
  EVIDENCE_GLOSS,
  EVIDENCE_GLYPH,
  EVIDENCE_GRADES,
  EVIDENCE_LABEL,
  EVIDENCE_TONE,
} from './primitives';

/**
 * `Dock` — the desktop chrome (`BACKLOG R63`, `docs/design/PLAN-direction-a.md`
 * §c).
 *
 * This package has no DOM testing setup (see `primitives.test.ts`'s own
 * comment) — real rendered-geometry assertions for the dock (collapse
 * animation, width holding at 300px, the reserved `.chrome-bottomleft`
 * margin, hit-testability) live in `apps/web/e2e/ui-invariants.spec.ts`,
 * against the real browser. What belongs here is what a real browser cannot
 * prove any faster than a plain read: the primitive exports the shape the
 * app needs, and the stylesheet backs every field-critical property this
 * component's own doc comments promise.
 */
describe('Dock — component shape', () => {
  it('exports every piece App.tsx composes', () => {
    expect(typeof Dock).toBe('function');
    expect(typeof DockHeader).toBe('function');
    expect(typeof DockBody).toBe('function');
    expect(typeof DockSection).toBe('function');
    expect(typeof DockFooter).toBe('function');
    expect(typeof EvidenceLegend).toBe('function');
  });
});

describe('Dock — evidence legend sources from Confidence, never a re-typed copy', () => {
  it('every grade has a label, tone, glyph and gloss', () => {
    for (const grade of EVIDENCE_GRADES) {
      expect(EVIDENCE_LABEL[grade], `label for "${grade}"`).toBeTruthy();
      expect(EVIDENCE_TONE[grade], `tone for "${grade}"`).toBeTruthy();
      expect(EVIDENCE_GLYPH[grade], `glyph for "${grade}"`).toBeTruthy();
      expect(EVIDENCE_GLOSS[grade], `gloss for "${grade}"`).toBeTruthy();
    }
  });

  it('is exactly the four grades docs/EVIDENCE.md defines, no more, no fewer', () => {
    expect([...EVIDENCE_GRADES].sort()).toEqual(['assumed', 'doctrine', 'inferred', 'measured']);
  });

  it('never grades "assumed" with the hunter-safety-orange tone reserved for real alerts', () => {
    // `docs/design/PLAN-direction-a.md` §a: an "Assumed" evidence chip and a
    // real device-storage alert sharing a colour is the exact
    // coincidence-becomes-confusion case this system exists to prevent.
    expect(EVIDENCE_TONE.assumed).not.toBe('danger');
  });
});

describe('Dock — the stylesheet backs what the doc comments promise', () => {
  const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');

  /**
   * A plain read of the committed stylesheet, the same technique
   * `primitives.test.ts` already uses for the same reason (no DOM testing
   * setup in this package). The negative lookahead is what keeps `.rl-dock`
   * from also matching `.rl-dock__body`, `.rl-dock--collapsed` etc. — every
   * one of those is a real, separate rule this file also reads.
   */
  function ruleBody(selector: string): string {
    const escaped = selector.replace(/[.#[\]]/g, (c) => `\\${c}`);
    const match = css.match(new RegExp(`${escaped}(?![\\w-])\\s*\\{([^}]*)\\}`));
    expect(match, `expected a "${selector}" rule in styles.css`).not.toBeNull();
    return match?.[1] ?? '';
  }

  it('.rl-dock is the plate material, not glass — no blur', () => {
    const body = ruleBody('.rl-dock');
    expect(body).toMatch(/background:\s*var\(--plate-bg\)/);
    expect(body).not.toMatch(/backdrop-filter/);
  });

  it('.rl-dock animates width — the collapse control has something to transition', () => {
    const body = ruleBody('.rl-dock');
    expect(body).toMatch(/transition:\s*width/);
  });

  it('.rl-dock--collapsed collapses to the collapsed-width token, not a hand literal', () => {
    const body = ruleBody('.rl-dock--collapsed');
    expect(body).toMatch(/width:\s*var\(--layout-dock-collapsed-width\)/);
  });

  it('.rl-dock__body is a real scrollable region — overflow-y: auto from day one', () => {
    const body = ruleBody('.rl-dock__body');
    expect(body).toMatch(/overflow-y:\s*auto/);
    expect(body).toMatch(/overscroll-behavior:\s*contain/);
  });

  it('.rl-dock__collapse holds the 44px gloved touch-target floor', () => {
    const body = ruleBody('.rl-dock__collapse');
    expect(body).toMatch(/min-height:\s*var\(--space-touch\)/);
  });
});

describe('Dock — tokens', () => {
  const tokensCss = readFileSync(resolve(__dirname, '../tokens.css'), 'utf8');

  it('layout.dock-width is declared and at least the plan-specified 300px', () => {
    const match = tokensCss.match(/--layout-dock-width:\s*(\d+)px/);
    expect(match, 'expected --layout-dock-width in tokens.css').not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(300);
  });

  it('layout.dock-collapsed-width is declared', () => {
    expect(tokensCss).toMatch(/--layout-dock-collapsed-width:\s*0/);
  });
});
