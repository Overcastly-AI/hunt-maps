import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { AnalysisLayer, BBox } from '@hunt-maps/terrain';
import { color } from '@hunt-maps/design';
import { LAYERS, layerById } from '../lib/layers';
import { BASE_SOURCES, isSyncedLayer } from '../lib/map/baseSources';
import { terrainTileUrl, TerrainProtocol } from '../lib/map/terrainProtocol';
import { boundsToBBox, DEM_MAX_ZOOM, DEM_TILE_SIZE } from '../lib/map/demTiles';
import { DEM_SOURCE } from '../lib/map/demSource';
import { exposeDevHook } from '../lib/devHook';
import { CoverageOverlay, coverageExtentToDraw } from '../lib/map/coverageOverlay';
import { RegionOutline } from '../lib/map/regionOutline';
import type { CoverageState } from '../lib/offline/coverage';

export interface MapViewProps {
  activeLayers: Set<string>;
  opacities: Record<string, number>;
  windFromDeg: number | null;
  atUtc: Date;
  /** Id of the saved-filter stack registered on the protocol, if any. */
  filterStackId?: string;
  onPointInspect?: (lngLat: { lng: number; lat: number }) => void;
  /** Hands the map instance to the app so the floating rail can drive it. */
  onReady?: (map: maplibregl.Map) => void;
  /** Map centre, so solar and thermal readouts follow the ground being viewed. */
  onMove?: (center: { lng: number; lat: number }) => void;
  /**
   * Viewport extent and zoom, for the offline region picker.
   *
   * Separate from `onMove` because it answers a different question and has a
   * different cost: the picker re-plans a tile list from this, and folding it
   * into the centre callback would re-run the solar model every time the
   * picker wanted a bounding box.
   */
  onViewChange?: (view: { bounds: BBox; zoom: number }) => void;
  protocol: TerrainProtocol;
  /**
   * Current offline coverage for this view, drawn as the hatched stored-extent
   * overlay. An indeterminate or unmeasured answer draws nothing — the decision
   * of *when* there is an extent worth drawing belongs to
   * `coverageExtentToDraw`, not to this component.
   */
  coverage?: CoverageState | null;
  /**
   * The area the region picker is about to download, drawn as a dashed box.
   *
   * Deliberately a different mark from the coverage hatch: one says what you
   * are *about* to have, the other what you *do* have, and a hunter who
   * confuses the two walks in on a region that was never downloaded.
   */
  regionBox?: BBox | null;
  /**
   * Whether the user wants the coverage extent drawn at all.
   *
   * Separate from `coverage` because they answer different questions: what is
   * true (`coverage`) versus whether the map should be carrying that truth
   * right now. Off while the Layers sheet is closed keeps the map clean; the
   * *text* verdict is never suppressed this way.
   */
  showCoverage?: boolean;
}

/**
 * The map.
 *
 * Layer ordering is the fiddly part and it is enforced here rather than left to
 * insertion order: base imagery at the bottom, relief above it, then the
 * analysis ramp, then discrete hunting layers, then saved filters, then
 * waypoints and sign on top. MapLibre inserts before a named layer, so every
 * `addLayer` call passes an explicit `beforeId` anchor. Without that, toggling
 * a layer off and on again quietly moves it to the top of the stack and the map
 * reorders itself under the user.
 */
export function MapView({
  activeLayers,
  opacities,
  windFromDeg,
  atUtc,
  filterStackId,
  onPointInspect,
  onReady,
  onMove,
  protocol,
  coverage,
  showCoverage = false,
  onViewChange,
  regionBox = null,
}: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const overlay = useRef<CoverageOverlay | null>(null);
  const regionOutline = useRef<RegionOutline | null>(null);
  // Held in a ref and read from the listener, so the mount-only effect below
  // never has to be re-run to pick up a new callback identity — re-running it
  // would tear down and rebuild the map.
  const viewChangeRef = useRef(onViewChange);
  viewChangeRef.current = onViewChange;
  // Set once the style has loaded for the first time. `isStyleLoaded()`
  // answers a different question than its name suggests: MapLibre also folds
  // in-flight tile activity for *already-added* sources into it, so it can
  // flip back to `false` well after the initial style is up (this app's own
  // satellite source retries indefinitely against a network that will not
  // resolve, which is exactly the condition that exposed this). The sync
  // effect below used to re-check `isStyleLoaded()` on every dependency
  // change and fall back to `map.once('load', apply)` when it read false —
  // but MapLibre's `'load'` event fires exactly once per style, so any sync
  // that happened to land during a transient `false` attached a listener
  // that would never fire again, silently stranding every later layer toggle
  // (BACKLOG R32: this is why the bedding layer never painted in CI — the
  // toggle never reached `map.addSource` at all, before the ramp domain was
  // even in play). Tracked with a ref rather than re-deriving it from the map
  // each time, because the map has no public "has loaded at least once" query.
  const styleLoadedOnce = useRef(false);

  useEffect(() => {
    if (!container.current || map.current) return;

    const instance = new maplibregl.Map({
      container: container.current,
      style: {
        version: 8,
        sources: {},
        layers: [
          // Token, not a literal — the map canvas and the app chrome must be the
          // same black, and a drifted pair is very visible at low brightness.
          { id: 'background', type: 'background', paint: { 'background-color': color.ground } },
          // Anchor layers. Empty placeholders that never render but give every
          // real layer a stable `beforeId` to insert against.
          ...ANCHORS.map((id) => ({
            id,
            type: 'background' as const,
            paint: { 'background-opacity': 0 },
          })),
        ],
      },
      // Hocking Hills, Ohio — real whitetail hill country. Sharp relief means a
      // new user's first view actually shows what the analysis layers do,
      // rather than opening on farmland where every layer looks the same.
      center: [-82.54, 39.43],
      zoom: 13,
      maxZoom: 18,
      // `#zoom/lat/lng` in the address bar. Makes a map position shareable and
      // deep-linkable — "meet me at this saddle" is a message hunters send —
      // and survives a reload, which matters when the app is a PWA that may be
      // resumed hours later in the field.
      hash: true,
      // Terrain reading is a north-up activity; free rotation mostly produces
      // disoriented users and screenshots nobody can interpret.
      dragRotate: false,
      pitchWithRotate: false,
    });

    // Zoom and locate live in our own rail, so MapLibre's default controls are
    // deliberately not added — two stacks of buttons doing the same job is how
    // a map UI starts feeling unowned. Scale and attribution stay: one is a
    // reading aid, the other a licence requirement.
    instance.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-right');

    instance.on('contextmenu', (e) => onPointInspect?.(e.lngLat));
    const publishView = (): void => {
      const c = instance.getCenter();
      onMove?.({ lng: c.lng, lat: c.lat });
      viewChangeRef.current?.({
        bounds: boundsToBBox(instance.getBounds()),
        zoom: instance.getZoom(),
      });
    };
    instance.on('moveend', publishView);
    // The first publish, so the picker has a box before the user touches
    // anything. `idle` as well as `load` for the same reason the coverage hook
    // needs both: offline, `load` may already have fired or may never settle.
    instance.once('load', publishView);
    instance.once('idle', publishView);
    map.current = instance;

    // E2E / debugging hook. Screenshot and QA runs need a reliable "tiles have
    // settled" signal, and MapLibre's own `areTilesLoaded()` is the honest one —
    // sniffing the GL framebuffer gives false negatives because the drawing
    // buffer is cleared between frames unless preserveDrawingBuffer is set,
    // which would cost real performance in production.
    exposeDevHook({ map: instance });
    onReady?.(instance);

    return () => {
      overlay.current?.destroy();
      overlay.current = null;
      regionOutline.current?.destroy();
      regionOutline.current = null;
      instance.remove();
      map.current = null;
    };
    // Mount-only: the map instance outlives prop changes, which are applied by
    // the sync effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the protocol's notion of "now" and "wind" in step with the UI, and
  // re-sync the rendered layers.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    const apply = () => syncLayers(instance, activeLayers, opacities, windFromDeg, atUtc, filterStackId);

    // Once the style has loaded for the first time, every later dependency
    // change (a layer toggle, a wind scrub, a date change) applies straight
    // away — see `styleLoadedOnce` above for why re-checking
    // `isStyleLoaded()` here is the bug this replaced.
    if (styleLoadedOnce.current) {
      apply();
    } else if (instance.isStyleLoaded()) {
      styleLoadedOnce.current = true;
      apply();
    } else {
      instance.once('load', () => {
        styleLoadedOnce.current = true;
        apply();
      });
    }
  }, [activeLayers, opacities, windFromDeg, atUtc, filterStackId, protocol]);

  // Coverage gets its own effect and its own module: it is not an analysis
  // layer, it changes on a different cadence (every move), and `map-builder`
  // should be able to retune its cartography without touching the layer stack
  // above. What is *drawable* is decided by `coverageExtentToDraw`, not here —
  // an indeterminate or sampled answer has no honest extent and draws nothing.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    overlay.current ??= new CoverageOverlay(instance);
    overlay.current.setTiles(showCoverage ? coverageExtentToDraw(coverage ?? null) : []);
  }, [coverage, showCoverage]);

  // The region picker's pending box. Its own overlay and its own effect: it
  // changes as the user pans with the picker open, which is a different cadence
  // again from either the layer stack or the coverage hatch.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    regionOutline.current ??= new RegionOutline(instance);
    regionOutline.current.setBoxes(regionBox ? [regionBox] : []);
  }, [regionBox]);

  return <div ref={container} className="map-canvas" data-testid="map-canvas" />;
}

/** Bottom-to-top insertion anchors. */
const ANCHORS = [
  'anchor-base',
  'anchor-relief',
  'anchor-analysis',
  'anchor-hunting',
  'anchor-saved',
  'anchor-features',
] as const;

const GROUP_ANCHOR: Record<string, string> = {
  base: 'anchor-relief',
  relief: 'anchor-analysis',
  analysis: 'anchor-hunting',
  hunting: 'anchor-saved',
  saved: 'anchor-features',
};

function syncLayers(
  map: maplibregl.Map,
  active: Set<string>,
  opacities: Record<string, number>,
  windFromDeg: number | null,
  atUtc: Date,
  filterStackId?: string,
): void {
  const wanted = new Set(active);
  if (filterStackId) wanted.add('__filters');

  // Remove layers that are no longer wanted.
  //
  // Only ones this function created. The `rl-` prefix alone is not enough: the
  // coverage overlay (`lib/map/coverageOverlay.ts`) also lives under it, and a
  // prefix-only test tore it off the map on the next layer toggle — the badge
  // still said "Partial", the hatch showing *which half* silently vanished.
  // Matching against the known layer registry keeps ownership explicit, and
  // survives the overlay being renamed.
  for (const layer of map.getStyle().layers ?? []) {
    if (!layer.id.startsWith('rl-')) continue;
    const id = layer.id.slice(3);
    if (!isSyncedLayer(id)) continue;
    if (!wanted.has(id)) {
      map.removeLayer(layer.id);
      if (map.getSource(layer.id)) map.removeSource(layer.id);
    }
  }

  for (const id of wanted) {
    const sourceId = `rl-${id}`;
    const def = id === '__filters' ? undefined : layerById(id);
    const group = id === '__filters' ? 'saved' : (def?.group ?? 'analysis');

    const tiles = [
      id === '__filters'
        ? terrainTileUrl('filters', {
            windFromDeg: windFromDeg ?? undefined,
            atUtc,
            stackId: filterStackId,
          })
        : BASE_SOURCES[id]
          ? BASE_SOURCES[id].tiles[0]
          : terrainTileUrl(id as AnalysisLayer, {
              windFromDeg: windFromDeg ?? undefined,
              atUtc: def?.requiresTime ? atUtc : undefined,
            }),
    ];

    const existing = map.getSource(sourceId) as maplibregl.RasterTileSource | undefined;
    if (existing) {
      // Wind or date changed → the tile URL changed. `setTiles` re-requests
      // without tearing the layer out of the stack, which is what keeps the
      // ordering stable when the user scrubs a wind dial.
      const current = (existing as unknown as { tiles?: string[] }).tiles?.[0];
      if (current !== tiles[0]) existing.setTiles(tiles);
    } else {
      map.addSource(sourceId, {
        type: 'raster',
        tiles,
        // Shared constants, not literals: `lib/map/demTiles.ts` derives the
        // zoom the offline coverage check probes at from exactly these two
        // values. A local `256`/`15` here is how the badge and the fetch would
        // silently start disagreeing about which tiles a view needs.
        tileSize: DEM_TILE_SIZE,
        maxzoom: BASE_SOURCES[id]?.maxzoom ?? DEM_MAX_ZOOM,
        attribution: BASE_SOURCES[id]?.attribution ?? `Elevation: ${DEM_SOURCE.attribution}`,
      });
      map.addLayer(
        {
          id: sourceId,
          type: 'raster',
          source: sourceId,
          paint: { 'raster-opacity': opacities[id] ?? def?.defaultOpacity ?? 0.6 },
        },
        GROUP_ANCHOR[group],
      );
    }

    map.setPaintProperty(
      sourceId,
      'raster-opacity',
      opacities[id] ?? def?.defaultOpacity ?? 0.6,
    );
  }
}

export { LAYERS };
