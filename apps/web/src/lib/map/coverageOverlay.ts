/**
 * The offline-coverage overlay.
 *
 * ## Why the map has to say this, not just the badge
 *
 * "Partial — 43%" tells a hunter they have a problem. It does not tell them
 * *which half of the draw* they are missing, and that is the half of the answer
 * that matters when they are standing in it deciding whether to drop off the
 * ridge. So the extent is drawn.
 *
 * ## Why the hatch marks what is *missing*
 *
 * The brief calls this an overlay of the covered extent, and it is — the covered
 * extent is outlined, in the same green the badge uses, so you can see where the
 * good ground ends. But the *fill* goes on the gap, for three reasons:
 *
 *  1. The good state stays clean. Hatching everything you own would put texture
 *     over the whole screen every time coverage is complete, i.e. punish the
 *     case that is working, and a map you have to look through is a map people
 *     turn off.
 *  2. `none` would otherwise render nothing at all — visually identical to the
 *     overlay being broken. Hatching the gap makes the worst state the loudest
 *     one, which is the rule this whole subsystem is built on.
 *  3. The eye reads texture as "something wrong here". That is the correct
 *     reading for missing elevation.
 *
 * ## Kept out of `MapView` on purpose
 *
 * `map-builder` owns cartography and may well want to retune the hatch, the
 * colours or the geometry. Everything visual about coverage is in this file, and
 * everything about *deciding* coverage is in `lib/offline/coverage.ts`; neither
 * has to be unpicked to change the other. The layer ids deliberately do not
 * start with `rl-`, because `MapView.syncLayers` treats that prefix as "an
 * analysis layer I own" and removes any it does not recognise.
 */

import type maplibregl from 'maplibre-gl';
import { color } from '@hunt-maps/design';
import { tileFootprint, tileId } from './demTiles';
import type { ViewportCoverage } from '../offline/coverage';
import type { TileCoord } from '@hunt-maps/terrain';

const SOURCE_ID = 'coverage-extent';
const MISSING_FILL = 'coverage-missing-fill';
const COVERED_EDGE = 'coverage-covered-edge';
const HATCH_IMAGE = 'coverage-hatch';

/** Anchor from `MapView`'s stack: above analysis, below waypoints and sign. */
const BEFORE_ID = 'anchor-features';

/**
 * GeoJSON types taken from MapLibre's own `setData` signature rather than
 * imported from `@types/geojson`, which is a transitive dependency of
 * `maplibre-gl` and not resolvable from this package. Deriving them keeps the
 * overlay's geometry provably assignable to the source that will receive it.
 */
type CoverageData = Extract<
  Parameters<maplibregl.GeoJSONSource['setData']>[0],
  { type: 'FeatureCollection' }
>;
type CoverageFeature = CoverageData['features'][number];

const EMPTY: CoverageData = { type: 'FeatureCollection', features: [] };

/**
 * Push a coverage answer onto the map.
 *
 * Idempotent and safe to call on every render. `visible: false` or a `null` /
 * indeterminate coverage clears the overlay rather than leaving the last view's
 * geometry painted — a hatch that lags the map by one pan is its own small lie.
 */
export function syncCoverageOverlay(
  map: maplibregl.Map,
  coverage: ViewportCoverage | null,
  visible: boolean,
): void {
  const apply = () => {
    ensureLayers(map);
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData(visible ? buildFeatures(coverage) : EMPTY);
  };

  // Style load is asynchronous and the first coverage answer often beats it.
  if (map.isStyleLoaded()) apply();
  else map.once('load', apply);
}

/** Remove the overlay entirely. */
export function removeCoverageOverlay(map: maplibregl.Map): void {
  for (const id of [MISSING_FILL, COVERED_EDGE]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
}

/**
 * Geometry for one coverage answer.
 *
 * Exported for tests: this is where "which half of the draw" is actually
 * decided, and asserting it against a known tile set is cheaper and far more
 * precise than looking at a screenshot of a hatch.
 *
 * `checking` and `unavailable` draw nothing. We do not know where the gap is,
 * and drawing a guess would be worse than drawing nothing.
 */
export function buildFeatures(coverage: ViewportCoverage | null): CoverageData {
  if (!coverage) return EMPTY;
  if (coverage.state === 'checking' || coverage.state === 'unavailable') return EMPTY;

  const features: CoverageFeature[] = [];

  for (const tile of coverage.missing) {
    features.push({
      type: 'Feature',
      properties: { kind: 'missing' },
      geometry: { type: 'Polygon', coordinates: [ringFor(tile)] },
    });
  }

  for (const line of coveredBoundary(coverage.present)) {
    features.push({
      type: 'Feature',
      properties: { kind: 'covered-edge' },
      geometry: { type: 'LineString', coordinates: line },
    });
  }

  return { type: 'FeatureCollection', features };
}

/**
 * The outline of the covered set: every tile edge not shared with another
 * covered tile.
 *
 * Drawing each covered tile's own box instead would produce a grid of squares —
 * which reads as "here are some tiles", not "here is where your data ends". The
 * boundary is the thing a hunter actually needs to see. O(n) with a set lookup
 * per edge, on at most a few hundred tiles.
 */
export function coveredBoundary(present: TileCoord[]): Array<Array<[number, number]>> {
  const set = new Set(present.map(tileId));
  const has = (t: TileCoord, dx: number, dy: number) =>
    set.has(tileId({ z: t.z, x: t.x + dx, y: t.y + dy }));

  const lines: Array<Array<[number, number]>> = [];
  for (const tile of present) {
    const b = tileFootprint(tile);
    const nw: [number, number] = [b.west, b.north];
    const ne: [number, number] = [b.east, b.north];
    const se: [number, number] = [b.east, b.south];
    const sw: [number, number] = [b.west, b.south];
    // Tile y increases southward, so dy = -1 is the northern neighbour.
    if (!has(tile, 0, -1)) lines.push([nw, ne]);
    if (!has(tile, 0, 1)) lines.push([sw, se]);
    if (!has(tile, -1, 0)) lines.push([nw, sw]);
    if (!has(tile, 1, 0)) lines.push([ne, se]);
  }
  return lines;
}

function ringFor(tile: TileCoord): Array<[number, number]> {
  const b = tileFootprint(tile);
  return [
    [b.west, b.north],
    [b.east, b.north],
    [b.east, b.south],
    [b.west, b.south],
    [b.west, b.north],
  ];
}

function ensureLayers(map: maplibregl.Map): void {
  if (!map.hasImage(HATCH_IMAGE)) {
    const hatch = hatchImage();
    if (hatch) map.addImage(HATCH_IMAGE, hatch, { pixelRatio: 2 });
  }

  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, { type: 'geojson', data: EMPTY });
  }

  const before = map.getLayer(BEFORE_ID) ? BEFORE_ID : undefined;

  if (!map.getLayer(MISSING_FILL)) {
    map.addLayer(
      {
        id: MISSING_FILL,
        type: 'fill',
        source: SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'missing'],
        paint: {
          // Pattern rather than a flat wash: a solid tint over half the screen
          // would compete with the analysis ramps it sits above, and a hunter
          // reading slope colours through it would misread them. Texture says
          // "absence" without claiming a colour of its own.
          'fill-pattern': HATCH_IMAGE,
          'fill-opacity': 0.55,
        },
      },
      before,
    );
  }

  if (!map.getLayer(COVERED_EDGE)) {
    map.addLayer(
      {
        id: COVERED_EDGE,
        type: 'line',
        source: SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'covered-edge'],
        paint: {
          'line-color': color.ok,
          'line-width': 1.5,
          'line-opacity': 0.8,
        },
      },
      before,
    );
  }
}

/**
 * A 45° hatch, drawn at runtime rather than shipped as a PNG so the stripe
 * colour comes from the design tokens like everything else. Two passes (a dark
 * shadow under the warn stripe) so it stays legible over both bright satellite
 * imagery and near-black hillshade.
 */
function hatchImage(): ImageData | null {
  if (typeof document === 'undefined') return null;
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);
  ctx.lineCap = 'square';

  // Three passes so the stripe wraps seamlessly across the tile edges.
  for (const offset of [-size, 0, size]) {
    // Shadow first, then the stripe on top of it.
    ctx.strokeStyle = color.ground;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(offset, size);
    ctx.lineTo(offset + size, 0);
    ctx.stroke();

    ctx.strokeStyle = color.warn;
    ctx.globalAlpha = 1;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(offset, size);
    ctx.lineTo(offset + size, 0);
    ctx.stroke();
  }

  return ctx.getImageData(0, 0, size, size);
}
