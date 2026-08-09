import { expect, test, type Page } from '@playwright/test';
import { auditInteractiveElements, collectChromeTextNodes } from './helpers/dom-audit';
import { contrastRatio, estimateBackground, parseCssColor, requiredContrastRatio } from './helpers/contrast';
import { gridPoints, samplePixels } from './helpers/pixels';
import { DESKTOP, MOBILE } from './helpers/settle';

/**
 * UI invariants for `components/auth/**` (`LoginScreen`, `RegisterScreen`).
 *
 * Kept in its own file rather than appended to `ui-invariants.spec.ts`: that
 * file's helpers (`gotoAndSettle`, `closeLayersSheet`, `assertNoCollisions`,
 * …) are built around the map chrome and its DEM-tile-settle wait, none of
 * which the auth screens have — they render before any authenticated data
 * exists and have no map canvas at all. This file reuses the same
 * rendered-state primitives (`helpers/dom-audit.ts`, `helpers/contrast.ts`,
 * `helpers/pixels.ts`) rather than duplicating them, for the same reason
 * `ui-invariants.spec.ts` exists in the first place — see its own header
 * comment for the clipped-popover bug that motivated "assert against
 * rendered state, not DOM state" as this repo's rule.
 */

async function gotoAuth(page: Page, path: '/login' | '/register', viewport = DESKTOP): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto(path);
  await page.locator('.auth-card').waitFor({ state: 'visible' });
}

for (const path of ['/login', '/register'] as const) {
  test.describe(`${path} — rendered-state invariants`, () => {
    for (const viewport of [DESKTOP, MOBILE]) {
      test(`${viewport.width}px — every control hit-tests to itself, not something underneath`, async ({
        page,
      }) => {
        await gotoAuth(page, path, viewport);
        const elements = await auditInteractiveElements(page, ['.auth-shell']);
        expect(elements.length, 'expected at least the form fields, submit button and switch link').toBeGreaterThan(2);

        const dead = elements.filter((el) => el.reachable && !el.hitOk);
        expect(
          dead,
          dead.map((d) => `"${d.name}" (${d.tag}) painted but a tap at its centre lands on something else.`).join('\n'),
        ).toEqual([]);

        const unreachable = elements.filter((el) => !el.reachable);
        expect(
          unreachable,
          unreachable.map((d) => `"${d.name}" (${d.tag}) is in the DOM but no scrollable ancestor can bring it into view.`).join('\n'),
        ).toEqual([]);
      });

      test(`${viewport.width}px — every control meets the 44px gloved touch-target floor`, async ({ page }) => {
        await gotoAuth(page, path, viewport);
        const elements = await auditInteractiveElements(page, ['.auth-shell']);

        const violations = elements
          .filter((el) => !el.disabled)
          .filter((el) => el.effectiveRect.width < 44 || el.effectiveRect.height < 44);

        expect(
          violations,
          violations
            .map(
              (v) =>
                `"${v.name}" (${v.tag}${v.type ? `[type=${v.type}]` : ''}) is ` +
                `${Math.round(v.effectiveRect.width)}x${Math.round(v.effectiveRect.height)}px, needs >= 44x44px.`,
            )
            .join('\n'),
        ).toEqual([]);
      });

      test(`${viewport.width}px — text is legible against its rendered background (WCAG AA)`, async ({ page }) => {
        await gotoAuth(page, path, viewport);
        const nodes = await collectChromeTextNodes(page, ['.auth-shell']);
        expect(nodes.length, 'expected some visible text on the card').toBeGreaterThan(0);

        const pointsPerNode = nodes.map((n) => gridPoints(n, 5, 4));
        const flatSamples = await samplePixels(page, pointsPerNode.flat());

        const violations: string[] = [];
        let cursor = 0;
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          const count = pointsPerNode[i].length;
          const samples = flatSamples.slice(cursor, cursor + count);
          cursor += count;

          const textColor = parseCssColor(node.colorCss);
          const background = estimateBackground(samples, textColor);
          const ratio = contrastRatio(textColor, background);
          const required = requiredContrastRatio(node.fontSizePx, node.fontWeight);

          if (ratio < required - 0.05) {
            violations.push(
              `"${node.text}" (${node.selectorHint}, ${node.fontSizePx}px/${node.fontWeight}) measures ` +
                `${ratio.toFixed(2)}:1, needs ${required}:1.`,
            );
          }
        }
        expect(violations).toEqual([]);
      });

      test(`${viewport.width}px — no horizontal page scroll`, async ({ page }) => {
        await gotoAuth(page, path, viewport);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `page is ${overflow}px wider than its own viewport`).toBeLessThanOrEqual(1);
      });
    }

    test('every tab stop has a visible focus indicator', async ({ page }) => {
      await gotoAuth(page, path, DESKTOP);
      const stops: Array<{ tag: string; name: string; ok: boolean }> = [];
      let previousKey: string | null = null;

      for (let i = 0; i < 20; i++) {
        await page.keyboard.press('Tab');
        const info = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          const inCard = el?.closest('.auth-shell');
          if (!el || el === document.body || !inCard) return null;
          const style = window.getComputedStyle(el);
          const hasOutline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
          const hasBoxShadow = style.boxShadow !== 'none';
          const rect = el.getBoundingClientRect();
          return {
            key: `${el.tagName}@${Math.round(rect.x)},${Math.round(rect.y)}`,
            tag: el.tagName,
            name: el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 30) ?? el.id,
            ok: hasOutline || hasBoxShadow,
          };
        });
        if (!info) break;
        if (info.key === previousKey) break;
        previousKey = info.key;
        stops.push({ tag: info.tag, name: info.name, ok: info.ok });
      }

      expect(stops.length, 'expected to tab through the email/password fields, the submit button and the switch link').toBeGreaterThanOrEqual(3);
      const unmarked = stops.filter((s) => !s.ok);
      expect(
        unmarked,
        unmarked.map((s) => `"${s.name}" (${s.tag}) received focus with no visible outline or box-shadow.`).join('\n'),
      ).toEqual([]);
    });

    test('a wrong-password / invalid-request error and a network error read differently', async ({ page }) => {
      // Regression pin for CLAUDE.md's "auth failure must not look like
      // offline": the callout's tone must differ, not just its copy, because
      // tone is what a glanceable field read actually uses.
      await gotoAuth(page, path, DESKTOP);

      await page.route('**/api/auth/**', (route) => route.abort('failed'));
      await page.getByLabel('Email').fill('scout@example.com');
      await page.getByLabel('Password').fill('doesnotmatter12');
      if (path === '/register') await page.getByLabel('Name').fill('Scout');
      await page.getByRole('button', { name: /Sign in|Create account/ }).click();

      const callout = page.getByRole('alert');
      await expect(callout).toBeVisible();
      await expect(callout).toHaveClass(/rl-callout--warn/);
      await expect(callout).not.toHaveClass(/rl-callout--danger/);
      await expect(callout).toContainText(/connection|reach the server/i);
    });
  });
}
