/**
 * The hatched "this is what you actually have" overlay.
 *
 * ## Why it exists separately from the text
 *
 * "Partial — 41% of this view" tells a hunter they have a problem. It does not
 * tell them *which half of the draw* they are missing, and that is the part
 * that matters when they are standing in it deciding whether to keep walking.
 * The hatching draws the stored extent, so the un-hatched ground is exactly the
 * ground that will be blank with no signal.
 *
 * ## Why it is its own module
 *
 * The cartography here — hatch angle, spacing, opacity, whether the missing
 * side should be the one marked instead — is `map-builder`'s call to refine.
 * Keeping it behind one small class means that refinement never has to touch
 * the coverage logic, and the coverage logic never has to know MapLibre's
 * layer-ordering rules.
 *
 * ## What is deliberately *not* drawn
 *
 * Nothing is drawn unless the measurement was exact and the verdict was
 * partial:
 *
 *  - **Covered** would hatch the entire viewport — pure noise over the map,
 *    and the map is the product.
 *  - **Not downloaded** has no stored extent to draw.
 *  - **A sampled measurement** knows a scatter of probed tiles, not an extent.
 *    Drawing the sample as though it were the extent would replace an honest
 *    percentage with a dishonest picture.
 */

import type maplibregl from 'maplibre-gl';
import type { TileCoord } from '@hunt-maps/terrain';
import { color } from '@hunt-maps/design';
import type { CoverageState } from '../offline/coverage';
import { tileFootprint, tileSetSignature } from './demTiles';

/**
 * Minimal GeoJSON shape.
 *
 * `@types/geojson` reaches this project only as a UMD global via maplibre-gl,
 * which a module file cannot reference. Declaring the three fields actually
 * used is cheaper than pulling a dependency into the app for one type.
 */
interface TileFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: Record<string, never>;
    geometry: { type: 'Polygon'; coordinates: number[][][] };
  }>;
}

const SOURCE_ID = 'rl-offline-coverage';
const FILL_LAYER_ID = 'rl-offline-coverage-fill';
const LINE_LAYER_ID = 'rl-offline-coverage-line';
const PATTERN_ID = 'rl-offline-hatch';

/**
 * Inserted below the feature anchor so waypoints and sign still draw on top of
 * it — coverage is context, not content.
 */
const BEFORE_ID = 'anchor-features';

const HATCH_SIZE = 8;

/**
 * A 45° hatch, generated rather than shipped as an asset.
 *
 * `fill-pattern` needs a raster image, and generating it from the design token
 * keeps the one rule this repo has about colour: no literal hex outside
 * `packages/design`. Returns `null` if 2D canvas is unavailable, and the caller
 * falls back to a flat translucent fill rather than dropping the overlay —
 * losing the shape of the gap is worse than losing the texture.
 */
function hatchImage(): ImageData | null {
  const canvas = document.createElement('canvas');
  canvas.width = HATCH_SIZE;
  canvas.height = HATCH_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.clearRect(0, 0, HATCH_SIZE, HATCH_SIZE);
  ctx.strokeStyle = color.accent;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.85;
  // Draw the stripe three times so it tiles seamlessly across the wrap.
  for (const offset of [-HATCH_SIZE, 0, HATCH_SIZE]) {
    ctx.beginPath();
    ctx.moveTo(offset, HATCH_SIZE);
    ctx.lineTo(offset + HATCH_SIZE, 0);
    ctx.stroke();
  }
  return ctx.getImageData(0, 0, HATCH_SIZE, HATCH_SIZE);
}

function toFeatureCollection(tiles: TileCoord[]): TileFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: tiles.map((tile) => {
      const b = tileFootprint(tile);
      return {
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
      };
    }),
  };
}

export class CoverageOverlay {
  private signature = '';
  private installed = false;
  private destroyed = false;

  constructor(private readonly map: maplibregl.Map) {}

  /**
   * Show `tiles` as the stored extent, or hide the overlay when empty.
   *
   * Cheap to call on every coverage result: the tile set is fingerprinted and
   * an unchanged set is a no-op, so panning within one downloaded region does
   * not rebuild GeoJSON on every `moveend`.
   */
  setTiles(tiles: TileCoord[]): void {
    if (this.destroyed) return;
    const signature = tiles.length === 0 ? '' : tileSetSignature(tiles);
    if (signature === this.signature && this.installed) return;
    this.signature = signature;

    if (!this.styleReady()) {
      // Retry on `styledata`, which fires repeatedly as the style changes.
      // `once('load')` looks like the obvious choice and is a trap: `load` has
      // usually already fired by the time the first coverage answer lands, so a
      // listener registered here would never run and the overlay would never
      // appear — silently, with the badge still correctly saying "Partial".
      this.map.once('styledata', () => this.setTiles(tiles));
      return;
    }

    if (tiles.length === 0) {
      this.setVisible(false);
      return;
    }

    this.install();
    const source = this.map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(toFeatureCollection(tiles));
    this.setVisible(true);
  }

  /**
   * Can the style accept a source and a layer right now?
   *
   * Deliberately **not** `map.isStyleLoaded()`. That returns false while *any*
   * source still has tiles in flight, and this app's normal condition is a map
   * whose DEM and imagery requests are failing or slow — a mile from the truck
   * with no bars, which is the entire point of the feature this overlay serves.
   * Gating on it meant the coverage hatch never installed in exactly the
   * situation a hunter needs it, while the badge still read "Partial" and
   * nothing on screen said *where*.
   *
   * `addLayer` only requires the style to have been parsed. This app's own
   * anchor layers are declared in the initial style object, so their presence
   * tests precisely that and nothing more.
   */
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

    if (!this.map.hasImage(PATTERN_ID)) {
      const image = hatchImage();
      if (image) this.map.addImage(PATTERN_ID, image, { pixelRatio: 1 });
    }

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
          paint: this.map.hasImage(PATTERN_ID)
            ? { 'fill-pattern': PATTERN_ID, 'fill-opacity': 0.5 }
            : { 'fill-color': color.accent, 'fill-opacity': 0.16 },
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
          paint: { 'line-color': color.accent, 'line-width': 1, 'line-opacity': 0.45 },
        },
        before,
      );
    }

    this.installed = true;
  }

  destroy(): void {
    this.destroyed = true;
    // Same reasoning as `styleReady`: gating teardown on `isStyleLoaded()`
    // would skip it on a map that is still fetching tiles, which is most of
    // them. Guarded instead, because teardown races a map that may already be
    // removing itself.
    try {
      for (const id of [FILL_LAYER_ID, LINE_LAYER_ID]) {
        if (this.map.getLayer(id)) this.map.removeLayer(id);
      }
      if (this.map.getSource(SOURCE_ID)) this.map.removeSource(SOURCE_ID);
    } catch {
      // The map is going away anyway; nothing to leak.
    }
    this.installed = false;
  }
}

/**
 * The one rule for when the overlay is allowed on screen.
 *
 * Exported so it can be asserted directly — the states it excludes are excluded
 * for reasons (see this file's header), not by accident of wiring.
 */
export function coverageExtentToDraw(state: CoverageState | null): TileCoord[] {
  if (!state) return [];
  if (state.kind !== 'result') return [];
  const { result } = state;
  if (result.status !== 'partial' || result.basis !== 'view' || result.sampled) return [];
  return result.coveredExtent;
}
