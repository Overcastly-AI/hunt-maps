/**
 * The runtime DEM-source picker (`LayersSheet`'s "Elevation source" section)
 * writes a choice here and reloads; `demSource.ts` reads it back on the next
 * module evaluation, which is what makes the choice actually take effect
 * across the whole app (`DEM_SOURCE`, `DEM_TEMPLATE`, `DEM_MAX_ZOOM`,
 * `demTileKey`'s default parameter all derive from it — see that file's own
 * header comment for why a reload, not a live update, is the right shape
 * here).
 *
 * `vi.resetModules()` + a dynamic re-import is required throughout: the
 * override and the build-time env var are both read once, at module
 * evaluation, and the whole point under test is "does a *fresh* evaluation
 * pick up a stored choice" — importing the already-evaluated module at the
 * top of this file the way every other test does would prove nothing.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

async function freshDemSource() {
  vi.resetModules();
  return import('./demSource');
}

async function freshDemTiles() {
  vi.resetModules();
  return import('./demTiles');
}

describe('getDemSourceOverride / setDemSourceOverride', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('reads null when nothing has been chosen', async () => {
    const { getDemSourceOverride } = await freshDemSource();
    expect(getDemSourceOverride()).toBeNull();
  });

  it('round-trips a chosen id, and clears it with null', async () => {
    const { getDemSourceOverride, setDemSourceOverride } = await freshDemSource();
    setDemSourceOverride('usgs3dep-1m');
    expect(getDemSourceOverride()).toBe('usgs3dep-1m');
    setDemSourceOverride(null);
    expect(getDemSourceOverride()).toBeNull();
  });
});

describe('DEM_SOURCE resolution order: runtime override > build-time default > terrarium', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
  });

  it('defaults to terrarium with nothing configured or chosen', async () => {
    const { DEM_SOURCE } = await freshDemSource();
    expect(DEM_SOURCE.id).toBe('terrarium');
  });

  it('a stored override wins on the next module evaluation, without a build-time var', async () => {
    localStorage.setItem('ridgeline.demSourceOverride', 'usgs3dep-1m');
    const { DEM_SOURCE } = await freshDemSource();
    expect(DEM_SOURCE.id).toBe('usgs3dep-1m');
    // `DEM_MAX_ZOOM` (`demTiles.ts`) derives from `DEM_SOURCE` — this is the
    // exact "does everything downstream agree" property a reload exists to
    // guarantee for free, so it is worth pinning here rather than only in
    // `demSource.ts`. Re-fetched fresh too: it must see the same override.
    const { DEM_MAX_ZOOM } = await freshDemTiles();
    expect(DEM_MAX_ZOOM).toBe(17);
  });

  it('a stored override beats the build-time default', async () => {
    vi.stubEnv('VITE_DEM_SOURCE', 'usgs3dep-13');
    localStorage.setItem('ridgeline.demSourceOverride', 'usgs3dep-1m');
    const { DEM_SOURCE } = await freshDemSource();
    expect(DEM_SOURCE.id).toBe('usgs3dep-1m');
  });

  it('an unrecognised stored override degrades to the build-time default rather than throwing', async () => {
    vi.stubEnv('VITE_DEM_SOURCE', 'usgs3dep-13');
    localStorage.setItem('ridgeline.demSourceOverride', 'not-a-real-source-id');
    const { DEM_SOURCE } = await freshDemSource();
    expect(DEM_SOURCE.id).toBe('usgs3dep-13');
  });
});

describe('VITE_DEM_TEMPLATE only overrides the terrarium template (R8 arriving through a second door)', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
  });

  /**
   * The bug this pins: a self-hoster sets `VITE_DEM_TEMPLATE` to mirror AWS
   * Terrarium tiles for their default deployment. A hunter on that
   * deployment then taps "USGS 3DEP 1 m" in the picker. Before this fix,
   * `DEM_TEMPLATE` kept following the explicit env var regardless of which
   * source was active, so every "1 m LiDAR" tile request would silently
   * fetch the operator's Terrarium mirror instead — a map labelled LiDAR
   * serving a ~10 m blend, the exact overclaim `a02793d` removed.
   */
  it('ignores an explicit VITE_DEM_TEMPLATE once a non-terrarium source is active', async () => {
    vi.stubEnv('VITE_DEM_TEMPLATE', 'https://mirror.example/{z}/{x}/{y}.png');
    localStorage.setItem('ridgeline.demSourceOverride', 'usgs3dep-1m');
    const { DEM_SOURCE, DEM_TEMPLATE } = await freshDemSource();
    expect(DEM_SOURCE.id).toBe('usgs3dep-1m');
    expect(DEM_TEMPLATE).toBe(DEM_SOURCE.urlTemplate);
    expect(DEM_TEMPLATE).not.toContain('mirror.example');
  });

  it('still honours VITE_DEM_TEMPLATE while terrarium (the default) is active', async () => {
    vi.stubEnv('VITE_DEM_TEMPLATE', 'https://mirror.example/{z}/{x}/{y}.png');
    const { DEM_SOURCE, DEM_TEMPLATE } = await freshDemSource();
    expect(DEM_SOURCE.id).toBe('terrarium');
    expect(DEM_TEMPLATE).toBe('https://mirror.example/{z}/{x}/{y}.png');
  });
});
