/**
 * Structural guards for the DEM source becoming *dynamic*.
 *
 * The existing guard in `../layers.test.ts` pins that no layer label names an
 * elevation technology and that any resolution claim in a blurb is quoted from
 * `DEM_SOURCE.resolutionNote`. That guard was written when there was exactly
 * one source and `DEM_SOURCE` was a frozen constant, so "the note is honest"
 * was true by inspection.
 *
 * There are three sources now and a build-time switch between them. Every
 * assertion below exists because making the source selectable creates a way for
 * the app to describe data it is not serving — which is the same defect
 * `a02793d` fixed, arriving through a new door.
 *
 * Deliberately structural, and deliberately over the whole registry rather than
 * over whichever source happens to be active in this test run: the failing
 * configuration must not be the one nothing tests. That is the exact reason the
 * empty-`VITE_DEM_TEMPLATE` bug survived to production.
 */

import { describe, expect, it } from 'vitest';
import {
  assertUsableDemTemplate,
  DEM_SOURCE,
  DEM_SOURCES,
  DEM_TEMPLATE,
  demTileUrl,
} from './demSource';
import { DEM_LAYER, DEM_MAX_ZOOM, demTileKey } from './demTiles';
import { LAYERS } from '../layers';

const allSources = Object.values(DEM_SOURCES);

describe('every DEM source can actually address a tile', () => {
  it.each(allSources.map((s) => [s.id, s] as const))('%s has a usable template', (_id, source) => {
    expect(() => assertUsableDemTemplate(source.urlTemplate)).not.toThrow();
    const url = demTileUrl({ z: 14, x: 4370, y: 6323 }, source.urlTemplate);
    expect(url).not.toContain('{');
    expect(url).not.toBe('');
  });

  it('keys the registry by the id each source reports', () => {
    // A mismatch here means `demTileKey` namespaces the store under one name
    // while the API is asked for another — a downloaded region the analysis
    // never finds.
    for (const [key, source] of Object.entries(DEM_SOURCES)) {
      expect(source.id).toBe(key);
    }
  });
});

describe('resolution claims stay honest across the registry', () => {
  it('gives every source a non-empty resolution note', () => {
    for (const s of allSources) {
      expect(s.resolutionNote.trim(), s.id).not.toBe('');
    }
  });

  /**
   * The core of it. `usgs3dep-13` is 3DEP data and is *not* LiDAR resolution —
   * it is ~10 m, the same nominal grid as Terrarium. The temptation to call
   * anything from 3DEP "LiDAR" is exactly how the mislabel happened, so a
   * source that says LiDAR without negating it must be flagged `isLidar`.
   */
  it('only lets a genuinely LiDAR source make an unqualified LiDAR claim', () => {
    for (const s of allSources) {
      const note = s.resolutionNote.toLowerCase();
      if (!note.includes('lidar')) continue;
      const negated = /\bnot\b[^.]*lidar|lidar[^.]*\bnot\b/.test(note);
      if (negated) {
        expect(s.isLidar, `${s.id} disclaims LiDAR but is flagged isLidar`).toBe(false);
      } else {
        expect(s.isLidar, `${s.id} claims LiDAR but is not flagged isLidar`).toBe(true);
      }
    }
  });

  it('requires a non-LiDAR source to say so, not merely omit it', () => {
    // Silence reads as assent on a map. A ~10 m source that simply does not
    // mention resolution lets the hunter assume the finest thing they have
    // heard of, which is the overclaim by omission.
    for (const s of allSources) {
      if (s.isLidar) continue;
      expect(s.resolutionNote.toLowerCase(), s.id).toMatch(/not lidar|blended|bare-earth dem/);
    }
  });

  it('marks a partially-covered source as not nationwide', () => {
    // 3DEP 1 m does not cover the whole US. A caller that assumes it does has
    // no reason to handle the "no 1 m data here" answer, and the fallback
    // stops being visible.
    expect(DEM_SOURCES['usgs3dep-1m'].nationwide).toBe(false);
    expect(DEM_SOURCES['usgs3dep-1m'].isLidar).toBe(true);
    expect(DEM_SOURCES['usgs3dep-13'].isLidar).toBe(false);
    expect(DEM_SOURCES.terrarium.isLidar).toBe(false);
  });

  /**
   * `layers.ts` hardcodes "...not old logging grades or skid roads, which need
   * finer LiDAR data this map does not yet serve." That sentence is true while
   * the active source is Terrarium or 3DEP 1/3 arc-second, and **false** the
   * moment `VITE_DEM_SOURCE=usgs3dep-1m`.
   *
   * Green today (the default source is Terrarium). It goes red the moment
   * someone switches the build to 1 m without updating that blurb, which is the
   * point: the claim and the data must move together.
   */
  it('does not let a layer deny serving LiDAR while a LiDAR source is active', () => {
    if (!DEM_SOURCE.isLidar) return;
    const deniesLidar = /(does not|doesn't|not)\s+(yet\s+)?(serve|have|ship)/i;
    for (const l of LAYERS) {
      if (!/lidar/i.test(l.blurb)) continue;
      expect(
        deniesLidar.test(l.blurb),
        `${l.id} says the map does not serve LiDAR, but the active DEM source ` +
          `(${DEM_SOURCE.id}) is LiDAR. Update the blurb in lib/layers.ts.`,
      ).toBe(false);
    }
  });

  it('keeps the active source consistent with the template actually fetched', () => {
    // If these drift, the attribution names one dataset and the tiles come
    // from another — the failure the two-variable coupling was designed out of.
    const overridden = DEM_TEMPLATE !== DEM_SOURCE.urlTemplate;
    if (!overridden) expect(DEM_TEMPLATE).toBe(DEM_SOURCE.urlTemplate);
  });
});

describe('tile identity carries the source (R8)', () => {
  const tile = { z: 15, x: 8741, y: 12646 };

  it('keeps the legacy namespace for the default source', () => {
    // A hunter who downloaded a region last week must not find it silently
    // empty because the key format moved under them.
    expect(demTileKey(tile, 'terrarium')).toEqual({ layer: DEM_LAYER, ...tile });
    expect(demTileKey(tile)).toEqual(demTileKey(tile, DEM_SOURCE.id));
  });

  it('gives each source a distinct store key for the same ground', () => {
    // A z15 Terrarium tile and a z15 3DEP 1 m tile describe the same square of
    // Kentucky with different numbers — one is canopy, one is bare earth.
    // Sharing a key means whichever was cached first wins, silently.
    const keys = allSources.map((s) => JSON.stringify(demTileKey(tile, s.id)));
    expect(new Set(keys).size).toBe(allSources.length);
  });

  it('follows the active source for max zoom rather than a fixed 15', () => {
    // Pinning 15 for 1 m would never request a tile fine enough to contain the
    // sub-metre structure that is the entire reason to use 1 m.
    expect(DEM_MAX_ZOOM).toBe(DEM_SOURCE.maxZoom);
    expect(DEM_SOURCES['usgs3dep-1m'].maxZoom).toBeGreaterThan(DEM_SOURCES.terrarium.maxZoom);
  });
});
