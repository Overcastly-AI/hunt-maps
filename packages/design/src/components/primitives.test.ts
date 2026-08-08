import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `Button variant="link"` — the 44px floor, pinned at the source.
 *
 * Two agents hit the same defect independently and worked around it locally
 * rather than here: 35×44px on the register screen's "Sign in" link, 42×44px
 * on two unrelated "Back" buttons (`WaypointsSheet`, `ObservationsSheet`).
 * Both were the same root cause — `.rl-btn--link` set a `min-height` but no
 * `min-width`, so a short label's own text measured under the gloved-tap
 * floor. `packages/design` was outside both agents' territory, so both
 * reached for `variant="ghost"` or a hand-rolled fix instead of correcting
 * the primitive, which only guarantees a third workaround at the next short
 * label. This test is a plain read of the committed stylesheet rather than a
 * rendered-DOM measurement — this package has no DOM testing setup and does
 * not need one for a single, static CSS rule — but it pins the exact
 * property this bug hinges on, so a future edit that drops `min-width` again
 * (or the whole rule) fails here before it ships to a third file.
 */
describe('.rl-btn--link meets the 44x44 gloved-tap floor', () => {
  const css = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');
  const rule = css.match(/\.rl-btn--link\s*\{([^}]*)\}/);

  it('the rule exists', () => {
    expect(rule, 'expected a .rl-btn--link rule in styles.css').not.toBeNull();
  });

  const body = rule?.[1] ?? '';

  it('sets min-height to the touch token', () => {
    expect(body).toMatch(/min-height:\s*var\(--space-touch\)/);
  });

  it('sets min-width to the touch token — the half of the fix that was missing', () => {
    expect(body).toMatch(/min-width:\s*var\(--space-touch\)/);
  });

  it('the touch token itself is at least 44px (belt-and-braces with tokens.test.ts)', () => {
    const tokens = readFileSync(resolve(__dirname, '../tokens.css'), 'utf8');
    const match = tokens.match(/--space-touch:\s*(\d+)px/);
    expect(match, 'expected --space-touch in tokens.css').not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(44);
  });
});
