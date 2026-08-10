/**
 * The bug: every containerised build shipped with no terrain layers at all.
 *
 * `apps/web/Dockerfile` declared `ARG VITE_DEM_TEMPLATE=""`, so the variable was
 * *defined and empty* in every image. `demSource.ts` resolved it with
 * `?? DEFAULT_DEM_TEMPLATE`, and `??` falls back only on null/undefined — an
 * empty string is neither. Vite inlined `""`, `demTileUrl()` produced `""` for
 * every tile, no elevation ever arrived, and hillshade, slope, aspect, landform,
 * bedding and corridors all rendered blank.
 *
 * Nothing threw. The map looked like a map. It just had no terrain on it.
 *
 * It survived because the failing configuration exists *only* in the image:
 * locally and in CI the variable is unset, `import.meta.env.VITE_DEM_TEMPLATE`
 * is `undefined`, the fallback fires, and every test passes. The environment
 * that was broken was the only environment nothing tested.
 *
 * Two things are pinned here, and they are different:
 *  - "not configured" (unset, empty, whitespace) must resolve to the public
 *    default, because that is what the operator meant;
 *  - "configured but unusable" must fail loudly rather than be quietly
 *    rewritten — a template that cannot address a tile is a deployment mistake,
 *    and silently substituting a different data source hides it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_DEM_TEMPLATE,
  DEM_TEMPLATE,
  assertUsableDemTemplate,
  demTileUrl,
} from './demSource';

/** The exact resolution `demSource.ts` performs, applied to an arbitrary input. */
function resolveTemplate(configured: unknown): string {
  return typeof configured === 'string' && configured.trim() !== ''
    ? configured.trim()
    : DEFAULT_DEM_TEMPLATE;
}

describe('DEM template resolution', () => {
  it.each([
    ['undefined (dev and CI)', undefined],
    ['empty string (what the Dockerfile produced)', ''],
    ['whitespace', '   '],
    ['not a string', null],
  ])('treats %s as not configured and uses the public default', (_label, value) => {
    expect(resolveTemplate(value)).toBe(DEFAULT_DEM_TEMPLATE);
  });

  it('honours a real override', () => {
    expect(resolveTemplate('http://localhost:8099/{z}/{x}/{y}.png')).toBe(
      'http://localhost:8099/{z}/{x}/{y}.png',
    );
  });

  it('resolves a tile to a fetchable absolute URL, never the empty string', () => {
    const url = demTileUrl({ z: 12, x: 1140, y: 1580 });
    expect(url).not.toBe('');
    expect(url).toMatch(/^https?:\/\//);
    expect(url).not.toContain('{z}');
    expect(url).not.toContain('{x}');
    expect(url).not.toContain('{y}');
  });

  it('refuses a template that cannot address a tile rather than fetching it', () => {
    expect(() => assertUsableDemTemplate('')).toThrow(/missing/);
    expect(() => assertUsableDemTemplate('https://example.com/tiles.png')).toThrow(/\{z\}/);
    expect(() => assertUsableDemTemplate(DEM_TEMPLATE)).not.toThrow();
  });
});

describe('the Dockerfile cannot reintroduce an empty template', () => {
  // Comment lines are stripped first. The Dockerfile documents the broken form
  // verbatim so nobody reintroduces it by accident, and an assertion that
  // cannot tell a directive from the prose warning about it would fail on the
  // very comment that exists to prevent the bug.
  const dockerfile = readFileSync(resolve(__dirname, '../../../Dockerfile'), 'utf8')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n');

  it('never gives VITE_DEM_TEMPLATE an empty default', () => {
    // `ARG VITE_DEM_TEMPLATE=""` / `=''` / `=` is the precise shape that broke
    // production. A bare `ARG VITE_DEM_TEMPLATE` is what we want.
    expect(dockerfile).not.toMatch(/ARG\s+VITE_DEM_TEMPLATE\s*=\s*(""|''|\s*$)/m);
    expect(dockerfile).toMatch(/ARG\s+VITE_DEM_TEMPLATE\s*$/m);
  });

  it('does not unconditionally export the variable into the build', () => {
    // An unconditional `ENV VITE_DEM_TEMPLATE=$VITE_DEM_TEMPLATE` defines it as
    // empty whenever the build arg was not passed, which is the whole bug.
    expect(dockerfile).not.toMatch(/^\s*ENV\s+VITE_DEM_TEMPLATE=/m);
  });
});
