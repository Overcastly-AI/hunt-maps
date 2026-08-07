import { describe, expect, it } from 'vitest';
import type { BBox } from '@hunt-maps/terrain';
import { exclusiveTileCount } from './useOfflineRegions';
import { planZooms } from './regionPlan';
import type { SavedRegion } from './regionStore';

function region(bounds: BBox, clientId: string): SavedRegion {
  return {
    clientId,
    syncState: 'local',
    version: 1,
    name: clientId,
    bounds,
    minZoom: 13,
    maxZoom: 14,
    createdAt: 0,
    updatedAt: 0,
    status: 'ready',
    tileTotal: 0,
    tileDone: 0,
    tileFailed: 0,
    bytes: 0,
    volatile: false,
  };
}

const WEST: BBox = { west: -82.6, south: 39.39, east: -82.52, north: 39.47 };
const EAST: BBox = { west: -82.54, south: 39.39, east: -82.46, north: 39.47 };
const FAR: BBox = { west: -92.6, south: 39.39, east: -92.52, north: 39.47 };

/**
 * The figure on the delete confirmation, and the rule behind the delete itself.
 *
 * Deleting a saved area must not punch a hole in a neighbouring one. Two
 * regions over adjoining ground share tiles along their seam, and
 * `deleteRegion('dem')` — the only bulk delete the tile store had before this
 * feature — would have taken out every region on the device.
 */
describe('exclusiveTileCount', () => {
  it('is the whole region when nothing else is saved', () => {
    const only = region(WEST, 'a');
    expect(exclusiveTileCount(only, [only])).toBe(planZooms(WEST, 13, 14).tileCount);
  });

  it('excludes tiles a neighbouring region still needs', () => {
    const a = region(WEST, 'a');
    const b = region(EAST, 'b');
    const exclusive = exclusiveTileCount(a, [a, b]);
    expect(exclusive).toBeGreaterThan(0);
    // The two boxes overlap, so deleting one frees strictly less than its own
    // size — which is exactly the surprise the confirmation exists to remove.
    expect(exclusive).toBeLessThan(planZooms(WEST, 13, 14).tileCount);
  });

  it('is unaffected by a region on completely different ground', () => {
    const a = region(WEST, 'a');
    const far = region(FAR, 'far');
    expect(exclusiveTileCount(a, [a, far])).toBe(exclusiveTileCount(a, [a]));
  });

  it('can be zero when another saved area completely contains this one', () => {
    const inner = region({ west: -82.58, south: 39.41, east: -82.54, north: 39.45 }, 'inner');
    const outer = region(WEST, 'outer');
    // Nothing is freed. Telling a user "deleted" while their disk usage does
    // not move is confusing; telling them up front is not.
    expect(exclusiveTileCount(inner, [inner, outer])).toBe(0);
  });
});
