import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import type maplibregl from 'maplibre-gl';
import {
  PRESET_FILTERS,
  sunTimes,
  ThermalPhase,
  thermalPhaseAt,
  type TerrainPredicate,
} from '@hunt-maps/terrain';
import {
  CommandBar,
  CommandBarCell,
  ConditionsBar,
  DownloadIcon,
  LayersIcon,
  LocateIcon,
  MinusIcon,
  PlusIcon,
  Rail,
  RailButton,
} from '@hunt-maps/design';
import { MapView } from './components/MapView';
import { LayersSheet, type SavedFilterSummary } from './components/LayersSheet';
import { ConditionsEditor } from './components/ConditionsEditors';
import { RegionPicker } from './components/RegionPicker';
import { toggleLayer } from './lib/layers';
import { TerrainProtocol } from './lib/map/terrainProtocol';
import { openTileStore } from './lib/offline/tileStore';
import { invalidateCoverageCache, type CoverageState } from './lib/offline/coverage';
import { useViewportCoverage } from './lib/offline/useViewportCoverage';
import { useOfflineRegions } from './lib/offline/useOfflineRegions';
import { DEM_TEMPLATE } from './lib/map/demSource';
import { demSourceZoom, demTileKey, demTilesForBounds } from './lib/map/demTiles';
import { exposeDevHook } from './lib/devHook';
import { LoginScreen, RegisterScreen, RequireAuth } from './components/auth';
import {
  PropertiesListScreen,
  PropertyCreateScreen,
  PropertyDetailScreen,
  PropertyBoundaryEditScreen,
} from './components/properties';
import type { BBox } from '@hunt-maps/terrain';

interface FilterEntry extends SavedFilterSummary {
  predicate: TerrainPredicate;
  opacity: number;
  outline: boolean;
}

/**
 * The wind/time editors, independently of the Layers sheet.
 *
 * Was folded into one `Panel` union with `'layers'`, which made the sheet and
 * a popover mutually exclusive: opening the wind editor force-closed the
 * layers list. That is actively hostile to this product's flagship move —
 * sweeping the wind dial and watching leeward bedding likelihood repaint
 * live — which needs the layer toggle and the wind editor open at once. The
 * popovers are self-sized and anchored (`packages/design`'s `Popover`), so
 * there is no longer a layout reason to force them apart; the sheet's own
 * open/closed state is tracked separately below.
 */
type Popover = 'wind' | 'time' | null;

/**
 * The map dashboard — everything this app did before `lib/api`/auth existed.
 *
 * Deliberately not gated behind `RequireAuth`: nothing this component renders
 * calls an authenticated endpoint yet (satellite/terrain layers, offline
 * regions and the point readout are all unauthenticated or on-device), and
 * `apps/web/e2e/ui-invariants.spec.ts` navigates straight here against a
 * `vite preview` server with no backend running at all — gating this route
 * would fail the entire suite at the front door rather than testing the
 * chrome it exists to check. The property/waypoint/observation/filter/
 * analytics screens the next agents build *do* need `RequireAuth`
 * (`components/auth/RequireAuth.tsx`) around their own routes.
 */
function MapWorkspace() {
  const [active, setActive] = useState<Set<string>>(() => new Set(['satellite', 'multiHillshade']));
  const [opacities, setOpacities] = useState<Record<string, number>>({});
  const [windFromDeg, setWindFromDeg] = useState<number | null>(null);
  const [atUtc, setAtUtc] = useState(() => new Date());
  const [inspect, setInspect] = useState<{ lng: number; lat: number } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [popover, setPopover] = useState<Popover>(null);
  const [center, setCenter] = useState({ lng: -82.54, lat: 39.43 });
  const [view, setView] = useState<{ bounds: BBox; zoom: number } | null>(null);
  const [regionBox, setRegionBox] = useState<BBox | null>(null);

  const mapRef = useRef<maplibregl.Map | null>(null);
  // State, not just a ref: the coverage hook has to re-subscribe when the map
  // instance appears, and a ref assignment does not re-render.
  const [map, setMap] = useState<maplibregl.Map | null>(null);

  /**
   * Offline coverage for the view on screen, recomputed as the map moves.
   *
   * Deliberately not a boolean and deliberately not sampled once: the previous
   * implementation read `store.stats().tileCount > 0` at mount, which made a
   * single stored tile anywhere on earth render "Offline ready — elevation for
   * this area is stored on this device" for every view, forever. That sentence
   * is the one a hunter believes at the trailhead at 04:30.
   */
  const { coverage, refresh: refreshCoverage } = useViewportCoverage(map);

  /**
   * Saved offline regions, and the download running right now.
   *
   * `onStoreChanged` is the wire that closes R8's loop: a finished download
   * changes what is on the device, and without an explicit re-measure the
   * coverage badge would keep answering from its memo for up to twenty seconds
   * — so a hunter who just watched a download finish would still be told the
   * ground is not saved. The chip going to "Covered" is the confirmation that
   * the download did what it said.
   */
  const regions = useOfflineRegions({ onStoreChanged: refreshCoverage });

  const [filters, setFilters] = useState<FilterEntry[]>(() =>
    PRESET_FILTERS.map((p, i) => ({
      id: `preset-${i}`,
      name: p.name,
      description: p.description,
      color: p.color,
      opacity: p.opacity,
      outline: p.outline ?? true,
      predicate: p.predicate,
      enabled: false,
    })),
  );

  const protocolRef = useRef<TerrainProtocol | null>(null);
  if (!protocolRef.current) {
    protocolRef.current = new TerrainProtocol({
      demUrlTemplate: DEM_TEMPLATE,
      demEncoding: 'terrarium',
      tileSize: 256,
      filterStacks: new Map(),
    });
  }
  const protocol = protocolRef.current;

  useEffect(() => {
    protocol.register();
    // Persistent storage is requested by `useOfflineRegions`, which also keeps
    // the answer and shows it. Asking here as well and throwing the result away
    // was the old shape — it satisfied "ask" while failing "report what you
    // actually got", which is the half that matters.
    // The QA seam. `field-qa` and the offline invariants need to set up real
    // store state — "seed this view, then pan five hundred miles" — against the
    // actual OPFS/IndexedDB backend rather than a mock, because the mock is not
    // the thing that fails in the field.
    exposeDevHook({
      offline: {
        store: openTileStore,
        tilesForView: (bounds, mapZoom) => demTilesForBounds(bounds, demSourceZoom(mapZoom)),
        tileKey: demTileKey,
        invalidate: invalidateCoverageCache,
      },
    });
    return () => protocol.unregister();
  }, [protocol]);

  /**
   * Thermal phase for the conditions bar.
   *
   * Computed from the map centre rather than a fixed location, because a hunter
   * scouting ground three states away needs that ground's sun times, not their
   * own. Runs on-device with no network, like everything else here.
   */
  const thermal = useMemo(() => {
    const { sunrise, sunset } = sunTimes(atUtc, center.lat, center.lng);
    const phase = thermalPhaseAt(atUtc, sunrise, sunset);
    const notes: Record<ThermalPhase, string> = {
      [ThermalPhase.Rising]: 'Warming — air is moving upslope. Your scent goes uphill.',
      [ThermalPhase.Sinking]: 'Cooling — air is sinking and pooling in the draws.',
      [ThermalPhase.Transition]:
        'Switching within the hour. Direction is unreliable right now — the worst window to be moving.',
    };
    const label: Record<ThermalPhase, string> = {
      [ThermalPhase.Rising]: 'Rising',
      [ThermalPhase.Sinking]: 'Sinking',
      [ThermalPhase.Transition]: 'Switching',
    };
    return { phase: label[phase], note: notes[phase] };
  }, [atUtc, center]);

  const enabledFilters = useMemo(() => filters.filter((f) => f.enabled), [filters]);

  // Republish the enabled stack under a key that changes with its contents, so
  // MapLibre re-requests tiles when a filter is toggled or recoloured.
  const filterStackId = useMemo(() => {
    if (enabledFilters.length === 0) return undefined;
    const id = enabledFilters.map((f) => `${f.id}:${f.color}:${f.opacity}`).join('|');
    protocol.updateConfig({
      filterStacks: new Map([
        [
          id,
          enabledFilters.map((f) => ({
            predicate: f.predicate,
            color: f.color,
            opacity: f.opacity,
            outline: f.outline,
          })),
        ],
      ]),
    });
    return id;
  }, [enabledFilters, protocol]);

  const handleToggle = useCallback((id: string) => {
    setActive((prev) => toggleLayer(prev, id));
  }, []);

  const handleOpacity = useCallback((id: string, value: number) => {
    setOpacities((prev) => ({ ...prev, [id]: value }));
  }, []);

  const handleToggleFilter = useCallback((id: string) => {
    setFilters((prev) => prev.map((f) => (f.id === id ? { ...f, enabled: !f.enabled } : f)));
  }, []);

  const editor = (mode: 'wind' | 'time') => (
    <ConditionsEditor
      mode={mode}
      windFromDeg={windFromDeg}
      atUtc={atUtc}
      onWindChange={setWindFromDeg}
      onTimeChange={setAtUtc}
      onClose={() => setPopover(null)}
    />
  );

  const locate = useCallback(() => {
    navigator.geolocation?.getCurrentPosition((pos) => {
      mapRef.current?.flyTo({
        center: [pos.coords.longitude, pos.coords.latitude],
        zoom: 15,
      });
    });
  }, []);

  return (
    <div className="app-shell">
      <MapView
        protocol={protocol}
        activeLayers={active}
        opacities={opacities}
        windFromDeg={windFromDeg}
        atUtc={atUtc}
        filterStackId={filterStackId}
        onPointInspect={setInspect}
        onReady={(instance) => {
          mapRef.current = instance;
          setMap(instance);
        }}
        onMove={setCenter}
        onViewChange={setView}
        regionBox={pickerOpen ? regionBox : null}
        coverage={coverage}
        /*
         * Shown whenever the Layers sheet is open — that is the surface making
         * the claim, so the map should be showing its evidence at the same
         * time — and always while coverage is partial, which is the one state
         * where the text alone is actively misleading about *where* the gap is.
         */
        showCoverage={sheetOpen || pickerOpen || isPartialCoverage(coverage)}
      />

      <div className="map-chrome">
        <div className="chrome-topright">
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

        <div className="chrome-bottomleft">
          {/*
           * `CommandBar` (BACKLOG R44) replaces the old `.rl-rail` stack.
           * Both cells here are panel toggles — Layers and the region
           * picker (labelled "Offline") — which is the whole reason this
           * bar's height never has to change: adding Filters or Property
           * later (`docs/AUDIT-PRODUCT.md` rec's IA table) means adding a
           * tab inside the one drawer slot, not a third cell here.
           */}
          <CommandBar>
            <CommandBarCell
              label="Layers"
              active={sheetOpen}
              onClick={() => {
                setSheetOpen((open) => !open);
                // One panel at a time in the drawer slot. Two `.rl-sheet`s
                // stacked there would overlap exactly, and the one underneath
                // becomes an `elementFromPoint` trap for the one on top — the
                // failure class this repo keeps paying for.
                setPickerOpen(false);
              }}
            >
              <LayersIcon />
            </CommandBarCell>
            <CommandBarCell
              label="Offline"
              description="Save this area for offline use"
              active={pickerOpen}
              onClick={() => {
                setPickerOpen((open) => !open);
                setSheetOpen(false);
              }}
            >
              <DownloadIcon />
            </CommandBarCell>
          </CommandBar>

          <ConditionsBar
            windFromDeg={windFromDeg}
            windOctant={windFromDeg === null ? null : octant(windFromDeg)}
            atLabel={formatWhen(atUtc)}
            thermal={thermal}
            onWindClick={() => setPopover(popover === 'wind' ? null : 'wind')}
            onTimeClick={() => setPopover(popover === 'time' ? null : 'time')}
            windEditor={popover === 'wind' ? editor('wind') : null}
            timeEditor={popover === 'time' ? editor('time') : null}
          />
        </div>
      </div>

      {sheetOpen && (
        <LayersSheet
          active={active}
          opacities={opacities}
          windFromDeg={windFromDeg}
          savedFilters={filters}
          coverage={coverage}
          onToggle={handleToggle}
          onOpacity={handleOpacity}
          onToggleFilter={handleToggleFilter}
          onClose={() => setSheetOpen(false)}
        />
      )}

      {pickerOpen && (
        <RegionPicker
          viewBounds={view?.bounds ?? null}
          viewTileZoom={demSourceZoom(view?.zoom ?? 13)}
          regions={regions.regions}
          active={regions.active}
          persisted={regions.persisted}
          backend={regions.backend}
          onBoxChange={setRegionBox}
          onStart={(input) => void regions.start(input)}
          onResume={(id) => void regions.resume(id)}
          onCancel={regions.cancel}
          onRemove={(id) => void regions.remove(id)}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {inspect && (
        <div className="inspect-card rl-glass" role="dialog" aria-label="Terrain readout">
          <div className="inspect-card__head">
            <h3>Terrain here</h3>
            <button
              type="button"
              className="rl-btn rl-btn--link"
              onClick={() => setInspect(null)}
              aria-label="Close terrain readout"
            >
              Close
            </button>
          </div>
          <dl className="readout">
            <dt>Latitude</dt>
            <dd>{inspect.lat.toFixed(5)}</dd>
            <dt>Longitude</dt>
            <dd>{inspect.lng.toFixed(5)}</dd>
          </dl>
          <p className="rl-hint">
            Readouts resolve against the elevation tiles on this device, so they work with no
            signal.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Routes. `/login` and `/register` are the two screens this pass adds
 * (`components/auth/**`); everything else falls through to the map, which
 * stays reachable with no sign-in — see `MapWorkspace`'s own doc comment for
 * why. Next agents adding a route that touches a user-owned resource should
 * wrap it in `RequireAuth` here, not gate the whole router.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/register" element={<RegisterScreen />} />
      {/*
       * Property routes (`BACKLOG R1`). Each is wrapped individually rather
       * than gating the router, because the map itself must stay reachable
       * with no sign-in and no backend — `ui-invariants.spec.ts` navigates
       * straight to `/` against a backend-less `vite preview`, and gating
       * the whole tree would fail that suite at the door.
       *
       * Literal segments before `:id` so `/properties/new` cannot be
       * swallowed by the detail route.
       */}
      <Route
        path="/properties"
        element={
          <RequireAuth>
            <PropertiesListScreen />
          </RequireAuth>
        }
      />
      <Route
        path="/properties/new"
        element={
          <RequireAuth>
            <PropertyCreateScreen />
          </RequireAuth>
        }
      />
      <Route
        path="/properties/:id"
        element={
          <RequireAuth>
            <PropertyDetailScreen />
          </RequireAuth>
        }
      />
      <Route
        path="/properties/:id/boundary"
        element={
          <RequireAuth>
            <PropertyBoundaryEditScreen />
          </RequireAuth>
        }
      />
      <Route path="*" element={<MapWorkspace />} />
    </Routes>
  );
}

/**
 * Only a measured `partial` result forces the overlay on with the sheet shut.
 *
 * Written as a guard rather than inline so "checking" and "unavailable" cannot
 * be accidentally folded into the same branch as a real verdict — the whole
 * point of this feature is that not-yet-known never behaves like an answer.
 */
function isPartialCoverage(state: CoverageState): boolean {
  return state.kind === 'result' && state.result.status === 'partial';
}

function octant(deg: number): string {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** Short, glanceable date-time. The bar is read, not studied. */
function formatWhen(date: Date): string {
  return date
    .toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    .replace(',', '');
}
