/**
 * The box you are about to download, drawn on the map.
 *
 * The picker's area control is a set of buttons ("This view", "+ half again",
 * "Double"). Without something on the map, those are abstract — a hunter has no
 * way to tell whether "Double" reaches the far side of the ridge they care
 * about, and the only feedback they would get is a tile count. Drawing the
 * actual extent makes the choice a spatial one, which is the choice they are
 * really making.
 *
 * Kept out of `coverageOverlay.ts` on purpose: that overlay says what you
 * *have*, this one says what you are *about to get*, and conflating the two
 * cartographically would be the fastest way to make a hunter believe a region
 * is downloaded because they saw a box around it.
 */

import type maplibregl from 'maplibre-gl';
import type { BBox } from '@hunt-maps/terrain';
import { color } from '@hunt-maps/design';

interface BoxFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: Record<string, never>;
    geometry: { type: 'Polygon'; coordinates: number[][][] };
  }>;
}

const SOURCE_ID = 'rl-region-outline';
const FILL_LAYER_ID = 'rl-region-outline-fill';
const LINE_LAYER_ID = 'rl-region-outline-line';

/** Above the coverage hatch, below waypoints: it is a control, not content. */
const BEFORE_ID = 'anchor-features';

function toFeatureCollection(boxes: BBox[]): BoxFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: boxes.map((b) => ({
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [b.west, b.north],
            [b.east, b.north],
            [b.east, b.south],
            [b.west, b.south],
            [b.west, b.north],
          ],
        ],
      },
    })),
  };
}

export class RegionOutline {
  private signature = '';
  private installed = false;
  private destroyed = false;

  constructor(private readonly map: maplibregl.Map) {}

  setBoxes(boxes: BBox[]): void {
    if (this.destroyed) return;
    const signature = boxes.map((b) => `${b.west},${b.south},${b.east},${b.north}`).join('|');
    if (signature === this.signature && this.installed) return;
    this.signature = signature;

    // Same trap as the coverage overlay: `once('load')` has usually already
    // fired by the time a panel opens, so a listener registered here would
    // never run and the box would never appear. `styledata` fires repeatedly.
    if (!this.styleReady()) {
      this.map.once('styledata', () => this.setBoxes(boxes));
      return;
    }

    if (boxes.length === 0) {
      this.setVisible(false);
      return;
    }

    this.install();
    const source = this.map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(toFeatureCollection(boxes));
    this.setVisible(true);
  }

  private styleReady(): boolean {
    try {
      return Boolean(this.map.getLayer(BEFORE_ID));
    } catch {
      return false;
    }
  }

  private setVisible(visible: boolean): void {
    for (const id of [FILL_LAYER_ID, LINE_LAYER_ID]) {
      if (this.map.getLayer(id)) {
        this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    }
  }

  private install(): void {
    if (this.installed) return;
    if (!this.map.getSource(SOURCE_ID)) {
      this.map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    const before = this.map.getLayer(BEFORE_ID) ? BEFORE_ID : undefined;
    if (!this.map.getLayer(FILL_LAYER_ID)) {
      this.map.addLayer(
        {
          id: FILL_LAYER_ID,
          type: 'fill',
          source: SOURCE_ID,
          // Very light: the point is to frame ground, not to tint it. A heavy
          // wash would make the terrain under the box harder to read at exactly
          // the moment the user is deciding whether the box contains the right
          // terrain.
          paint: { 'fill-color': color.info, 'fill-opacity': 0.08 },
        },
        before,
      );
    }
    if (!this.map.getLayer(LINE_LAYER_ID)) {
      this.map.addLayer(
        {
          id: LINE_LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          paint: { 'line-color': color.info, 'line-width': 2, 'line-dasharray': [3, 2] },
        },
        before,
      );
    }
    this.installed = true;
  }

  destroy(): void {
    this.destroyed = true;
    try {
      for (const id of [FILL_LAYER_ID, LINE_LAYER_ID]) {
        if (this.map.getLayer(id)) this.map.removeLayer(id);
      }
      if (this.map.getSource(SOURCE_ID)) this.map.removeSource(SOURCE_ID);
    } catch {
      // The map is going away anyway.
    }
    this.installed = false;
  }
}
