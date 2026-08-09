import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import maplibregl from 'maplibre-gl';
import type { GeoPolygon } from '@hunt-maps/shared';
import { Button, Callout, LocateIcon, MinusIcon, PlusIcon, Rail, RailButton, color } from '@hunt-maps/design';
import {
  BoundaryDrawLayer,
  INITIAL_BOUNDARY_DRAW_STATE,
  boundaryDrawReducer,
  deriveBoundaryDraw,
  type BoundaryDrawState,
  type DrawableMap,
  type LngLat,
} from '../../lib/map/boundaryDraw';
import { BASE_SOURCES } from '../../lib/map/baseSources';

/**
 * `BoundaryDrawLayer` is written against the narrow `DrawableMap` interface
 * so its own tests never need a real WebGL map (see `boundaryDraw.ts`'s doc
 * comment). A real `maplibregl.Map` satisfies every method that interface
 * needs — `getSource`/`addSource`/`addLayer`/`getLayer`/`removeLayer`/
 * `removeSource`/`setLayoutProperty`/`setPaintProperty` — but its own typings
 * declare `getSource` as returning the general `Source` union rather than
 * the narrower `GeoJSONSource` (with `setData`) this class actually needs;
 * `RegionOutline`/`CoverageOverlay` hit the same gap and resolve it with the
 * same kind of local cast rather than widening `DrawableMap` and losing the
 * compile-time guarantee its own tests rely on.
 */
function toDrawableMap(map: maplibregl.Map): DrawableMap {
  return map as unknown as DrawableMap;
}

/** Same default as the main map dashboard (`App.tsx`) — real whitetail hill country, not farmland where every layer looks the same. Used only when no better centre is known. */
const DEFAULT_CENTER: [number, number] = [-82.54, 39.43];

export interface BoundaryEditorSnapshot {
  ring: LngLat[];
  closed: boolean;
  areaHectares: number;
  areaAcres: number;
  /** Why the ring cannot be finished/saved as drawn, or `null` when it is clean. */
  problem: string | null;
  canFinish: boolean;
  /** Only set once the ring is closed and clean — the value to actually send to the API. */
  polygon: GeoPolygon | null;
}

export interface BoundaryEditorProps {
  /** An existing boundary to preload for a redraw. Open ring — no repeated closing point. Omit for a brand-new property. */
  initialRing?: LngLat[];
  /** Shown as a quiet reference outline during a redraw, so a hunter can see how much they are about to change before committing — never rendered for a new property, where there is nothing yet to compare against. */
  showReference?: boolean;
  /** Where the map opens. Defaults to this device's location, falling back to `DEFAULT_CENTER`. */
  initialCenter?: { lng: number; lat: number };
  initialZoom?: number;
  /**
   * True while drawing and finishing must be refused — this feature's own
   * write is not offline-queued (see `PropertyCreateScreen`'s doc comment),
   * so going offline mid-draw must stop new edits rather than let the user
   * finish a boundary that cannot be saved.
   */
  disabled?: boolean;
  /** Required alongside `disabled` — an offline hunter needs the reason, not just a greyed-out button (`CLAUDE.md`: say when an input is missing). */
  disabledReason?: string;
  /** Fires on every change to the ring — the parent screen holds the latest snapshot and reads `polygon` at save time. */
  onChange: (snapshot: BoundaryEditorSnapshot) => void;
  /**
   * Rendered inside the toolbar plate, below the Undo/Finish/Start-over
   * row — the create/redraw screens use this for the "name it and save"
   * step once the ring closes, rather than a second floating panel. Two
   * overlapping panels is exactly the collision class `App.tsx`'s own R42
   * fix exists to prevent (a sheet covering the one control a flagship
   * interaction needs); one panel that grows to hold the next step keeps
   * Undo/Start-over reachable the whole time instead of hiding them behind
   * a separate overlay.
   */
  footer?: ReactNode;
}

const TAP_THRESHOLD_PX = 6;
/** Keyboard nudge step, in degrees — a fixed, small approximation (~3 m at the equator) rather than zoom-derived, since arrow-key editing is a coarse fallback for pointer dragging, not the primary interaction. */
const NUDGE_DEG = 0.00003;

/**
 * The map + drawing surface, shared by property creation and boundary
 * redraw.
 *
 * ## Why vertices are real DOM buttons, not a canvas layer
 *
 * `BoundaryDrawLayer` (`lib/map/boundaryDraw.ts`) paints the fill and the
 * outline on the map canvas, same as every other overlay in this app. It
 * deliberately does *not* paint the vertices: this is drawn gloved, one-
 * handed, often at arm's length, and a canvas circle has no CSS box for
 * `elementFromPoint` to resolve against no matter how large its paint radius
 * — exactly the class of defect `CLAUDE.md`'s fourth non-negotiable exists
 * to catch ("a bounding box ignores an ancestor's clip, but `elementFromPoint`
 * does not"; the same asymmetry applies to a hit target that only exists in
 * a raster, not the DOM at all). So every vertex is a real `<button>`, sized
 * to the full 44×44 CSS px floor via `--space-touch` even though the visible
 * dot inside it is much smaller.
 *
 * ## Why a vertex handle only drags, and never doubles as "tap to finish"
 *
 * An earlier draft let a tap on the first vertex close the ring, as a
 * convenience alongside the explicit Finish button. That needs the browser's
 * `click` event to tell a tap from the end of a drag — and this task's own
 * brief flags the exact failure that produces: "the browser's synthetic
 * `click` after `pointerup` fired a tap-toggle at the end of a 100px drag"
 * (also documented at `TerrainReadout.tsx`'s `endDrag`, which solves it by
 * routing tap-vs-drag through one pointer-distance measurement). Rather than
 * add a second place with the same race, vertex handles here do exactly one
 * thing — reposition an existing point, via pointer drag or an arrow-key
 * nudge for keyboard use — and closing the ring has exactly one control, the
 * Finish button below the map, which is unambiguous and needs no click-vs-
 * drag arbitration at all.
 */
export function BoundaryEditor({
  initialRing,
  showReference = false,
  initialCenter,
  initialZoom = 15,
  disabled = false,
  disabledReason,
  onChange,
  footer,
}: BoundaryEditorProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const boundaryLayer = useRef<BoundaryDrawLayer | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const [state, dispatch] = useReducer(
    boundaryDrawReducer,
    initialRing && initialRing.length >= 3
      ? { vertices: initialRing, closed: true }
      : INITIAL_BOUNDARY_DRAW_STATE,
  );
  const seededRef = useRef(Boolean(initialRing));
  // Preloading a boundary that arrives after mount (the property is still
  // loading from the API when this component first renders) — seeded once,
  // so it never stomps a redraw already in progress if the parent re-renders
  // with a new array identity for the same, already-applied boundary.
  useEffect(() => {
    if (seededRef.current || !initialRing || initialRing.length < 3) return;
    seededRef.current = true;
    dispatch({ type: 'reset', vertices: initialRing });
  }, [initialRing]);

  const derived = useMemo(() => deriveBoundaryDraw(state), [state]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    onChangeRef.current({
      ring: state.vertices,
      closed: state.closed,
      areaHectares: derived.areaHectares,
      areaAcres: derived.areaAcres,
      problem: derived.problem,
      canFinish: derived.canFinish,
      polygon: derived.polygon,
    });
  }, [state, derived]);

  // --- Map lifecycle -----------------------------------------------------

  useEffect(() => {
    if (!container.current || mapRef.current) return;

    const center = initialCenter
      ? ([initialCenter.lng, initialCenter.lat] as [number, number])
      : DEFAULT_CENTER;

    const instance = new maplibregl.Map({
      container: container.current,
      style: {
        version: 8,
        sources: {
          satellite: {
            type: 'raster',
            tiles: BASE_SOURCES.satellite.tiles,
            tileSize: 256,
            maxzoom: BASE_SOURCES.satellite.maxzoom,
            attribution: BASE_SOURCES.satellite.attribution,
          },
        },
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': color.ground } },
          { id: 'satellite', type: 'raster', source: 'satellite' },
        ],
      },
      center,
      zoom: initialZoom,
      maxZoom: 19,
      // Terrain reading — and drawing a boundary against it — is a north-up
      // task, same reasoning as the main map dashboard.
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: false,
    });

    instance.addControl(new maplibregl.AttributionControl({ compact: true }));
    mapRef.current = instance;
    instance.once('load', () => setMapReady(true));

    return () => {
      boundaryLayer.current?.destroy();
      boundaryLayer.current = null;
      instance.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // Mount-only — `initialCenter`/`initialZoom` only matter for the first
    // frame; changing them later should not tear down and refly the map out
    // from under a hunter mid-draw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Click-to-add-a-vertex. Registered/torn down with `disabled` so an
  // offline tap on the map is inert rather than silently starting a
  // boundary that this feature cannot save (`PropertyCreateScreen`'s own
  // doc comment covers why creation is not offline-queued).
  useEffect(() => {
    const instance = mapRef.current;
    if (!instance || !mapReady) return;
    if (disabled) return;

    const onClick = (e: maplibregl.MapMouseEvent) => {
      dispatch({ type: 'add', point: [e.lngLat.lng, e.lngLat.lat] });
    };
    instance.on('click', onClick);
    return () => {
      instance.off('click', onClick);
    };
  }, [mapReady, disabled]);

  // Draft ring + reference boundary rendering.
  useEffect(() => {
    const instance = mapRef.current;
    if (!instance || !mapReady) return;
    boundaryLayer.current ??= new BoundaryDrawLayer(toDrawableMap(instance));
    boundaryLayer.current.setDraft(state.vertices, state.closed);
  }, [mapReady, state]);

  useEffect(() => {
    const instance = mapRef.current;
    if (!instance || !mapReady) return;
    boundaryLayer.current ??= new BoundaryDrawLayer(toDrawableMap(instance));
    boundaryLayer.current.setReference(showReference && initialRing ? initialRing : null);
    // `initialRing` is only read once for the reference outline's identity —
    // it does not change after mount (drawing never edits the *reference*,
    // only the draft), so it is deliberately not a dependency here beyond
    // the initial value captured by `showReference`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, showReference]);

  // --- Vertex handle positions --------------------------------------------

  const [positions, setPositions] = useState<Array<{ x: number; y: number }>>([]);
  const rafRef = useRef<number | null>(null);

  const recomputePositions = useCallback(() => {
    const instance = mapRef.current;
    if (!instance) return;
    setPositions(state.vertices.map(([lng, lat]) => instance.project([lng, lat])));
  }, [state.vertices]);

  useEffect(() => {
    if (!mapReady) return;
    recomputePositions();
  }, [mapReady, recomputePositions]);

  useEffect(() => {
    const instance = mapRef.current;
    if (!instance || !mapReady) return;
    const scheduled = () => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        recomputePositions();
      });
    };
    instance.on('move', scheduled);
    instance.on('resize', scheduled);
    return () => {
      instance.off('move', scheduled);
      instance.off('resize', scheduled);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [mapReady, recomputePositions]);

  // --- Controls ------------------------------------------------------------

  const handleDragTo = useCallback((index: number, clientX: number, clientY: number) => {
    const instance = mapRef.current;
    const el = container.current;
    if (!instance || !el) return;
    const rect = el.getBoundingClientRect();
    const lngLat = instance.unproject([clientX - rect.left, clientY - rect.top]);
    dispatch({ type: 'move', index, point: [lngLat.lng, lngLat.lat] });
  }, []);

  const handleNudge = useCallback((index: number, dLng: number, dLat: number) => {
    const point = state.vertices[index];
    if (!point) return;
    dispatch({ type: 'move', index, point: [point[0] + dLng, point[1] + dLat] });
  }, [state.vertices]);

  const locate = useCallback(() => {
    navigator.geolocation?.getCurrentPosition((pos) => {
      mapRef.current?.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 16 });
    });
  }, []);

  const helperText = disabled
    ? disabledReason
    : state.closed
      ? 'Boundary closed — drag a point to fine-tune it, or Undo to reopen and keep drawing.'
      : state.vertices.length === 0
        ? 'Tap the map to place the first corner.'
        : state.vertices.length < 3
          ? `${state.vertices.length} point${state.vertices.length === 1 ? '' : 's'} placed — add at least ${3 - state.vertices.length} more.`
          : 'Tap to add another corner, or press Finish to close the boundary.';

  return (
    <div className="boundary-editor">
      {disabled && (
        <Callout tone="danger" role="alert">
          <p>{disabledReason}</p>
        </Callout>
      )}

      <div className="boundary-editor__map-wrap">
        <div
          ref={container}
          className="boundary-editor__map"
          data-testid="boundary-map"
          // A QA seam, not a styling hook: `mapReady` gates when the
          // click-to-add-a-vertex listener is actually attached
          // (`instance.once('load', ...)` can trail the map's own `'load'`
          // event by a render), and a test that starts tapping before then
          // loses its first point — silently, because nothing in the DOM
          // says the map was not ready yet. Same class of seam
          // `data-testid="map-canvas"` and `exposeDevHook` already serve
          // for the main dashboard map (`MapView.tsx`, `App.tsx`).
          data-map-ready={mapReady}
        />

        <div className="boundary-editor__vertices" aria-hidden={state.vertices.length === 0}>
          {positions.map((p, i) => (
            <VertexHandle
              key={i}
              index={i}
              x={p.x}
              y={p.y}
              disabled={disabled}
              onDragTo={handleDragTo}
              onNudge={handleNudge}
            />
          ))}
        </div>

        <div className="boundary-editor__rail">
          <Rail>
            <RailButton label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
              <PlusIcon />
            </RailButton>
            <RailButton label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
              <MinusIcon />
            </RailButton>
            <RailButton label="Go to my location" onClick={locate}>
              <LocateIcon />
            </RailButton>
          </Rail>
        </div>
      </div>

      <div className="boundary-editor__toolbar rl-plate">
        <div className="boundary-editor__readout">
          <span className="boundary-editor__area" data-testid="boundary-area">
            {state.vertices.length >= 3
              ? `About ${derived.areaHectares.toFixed(1)} ha · ${derived.areaAcres.toFixed(1)} ac`
              : 'Area — add at least 3 points'}
          </span>
          <p className="rl-hint">{helperText}</p>
        </div>

        {derived.problem && state.vertices.length >= 3 && (
          <Callout tone="warn" role="status">
            <p>{derived.problem}</p>
          </Callout>
        )}

        <div className="boundary-editor__actions">
          <Button
            variant="ghost"
            onClick={() => dispatch({ type: 'undo' })}
            disabled={disabled || state.vertices.length === 0}
          >
            Undo last point
          </Button>

          {!state.closed && (
            <Button
              variant="primary"
              onClick={() => dispatch({ type: 'finish' })}
              disabled={disabled || !derived.canFinish}
            >
              Finish boundary
            </Button>
          )}

          {state.vertices.length > 0 &&
            (confirmClear ? (
              <>
                <Button variant="danger" onClick={() => { setConfirmClear(false); dispatch({ type: 'clear' }); }}>
                  Clear for good
                </Button>
                <Button variant="link" onClick={() => setConfirmClear(false)}>
                  Keep drawing
                </Button>
              </>
            ) : (
              <Button variant="ghost" disabled={disabled} onClick={() => setConfirmClear(true)}>
                Start over
              </Button>
            ))}
        </div>

        {footer}
      </div>
    </div>
  );
}

function VertexHandle({
  index,
  x,
  y,
  disabled,
  onDragTo,
  onNudge,
}: {
  index: number;
  x: number;
  y: number;
  disabled?: boolean;
  onDragTo: (index: number, clientX: number, clientY: number) => void;
  onNudge: (index: number, dLng: number, dLat: number) => void;
}) {
  const drag = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);

  function onPointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, moved: false };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < TAP_THRESHOLD_PX) return;
    d.moved = true;
    onDragTo(index, e.clientX, e.clientY);
  }

  function endDrag() {
    drag.current = null;
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        onNudge(index, 0, NUDGE_DEG);
        return;
      case 'ArrowDown':
        e.preventDefault();
        onNudge(index, 0, -NUDGE_DEG);
        return;
      case 'ArrowLeft':
        e.preventDefault();
        onNudge(index, -NUDGE_DEG, 0);
        return;
      case 'ArrowRight':
        e.preventDefault();
        onNudge(index, NUDGE_DEG, 0);
        return;
    }
  }

  return (
    <button
      type="button"
      className={index === 0 ? 'boundary-vertex boundary-vertex--first' : 'boundary-vertex'}
      style={{ left: x, top: y }}
      aria-label={`Boundary point ${index + 1} — drag or use arrow keys to move it`}
      disabled={disabled}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    />
  );
}

export type { BoundaryDrawState };
