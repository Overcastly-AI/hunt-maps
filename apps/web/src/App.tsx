import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import type maplibregl from 'maplibre-gl';
import {
  PRESET_FILTERS,
  sunTimes,
  ThermalPhase,
  thermalPhaseAt,
  type TerrainPredicate,
} from '@hunt-maps/terrain';
import {
  Button,
  Callout,
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
  Sheet,
  TabBar,
  TabBarButton,
} from '@hunt-maps/design';
import { MapView } from './components/MapView';
import { LayersSheet, type SavedFilterSummary } from './components/LayersSheet';
import { ConditionsEditor } from './components/ConditionsEditors';
import { RegionPicker } from './components/RegionPicker';
import { WaypointsSheet } from './components/waypoints';
import { ObservationsSheet } from './components/observations';
import { FilterEditor, FilterLibrary, parseStoredPredicate } from './components/filters';
import { toggleLayer } from './lib/layers';
import { TerrainProtocol } from './lib/map/terrainProtocol';
import { openTileStore } from './lib/offline/tileStore';
import { invalidateCoverageCache, type CoverageState } from './lib/offline/coverage';
import { useViewportCoverage } from './lib/offline/useViewportCoverage';
import { useOfflineRegions } from './lib/offline/useOfflineRegions';
import { DEM_TEMPLATE } from './lib/map/demSource';
import { demSourceZoom, demTileKey, demTilesForBounds } from './lib/map/demTiles';
import { exposeDevHook } from './lib/devHook';
import { useAuth, useSavedFilters, type SavedFilterDto, type WaypointDto } from './lib/api';
import { useCurrentProperty } from './lib/currentProperty';
import { LoginScreen, RegisterScreen, RequireAuth } from './components/auth';
import {
  PropertiesListScreen,
  PropertyCreateScreen,
  PropertyDetailScreen,
  PropertyBoundaryEditScreen,
} from './components/properties';
import type { BBox } from '@hunt-maps/terrain';

/**
 * One entry in the merged catalogue behind the "Saved filters" section and
 * the map's filter overlay.
 *
 * Two sources feed it, deliberately kept apart from where they enter
 * (`catalogEntries` below) rather than normalised into one shape upstream:
 *
 *  - **Local presets** (`PRESET_FILTERS`, `@hunt-maps/terrain`) — zero
 *    network, always available, exactly like today. The filters package's
 *    own mounting note (`components/filters/index.ts`) suggests sourcing
 *    presets from `useFilterPresets()` instead, but that endpoint requires a
 *    signed-in user (`FiltersController` guards the whole class,
 *    `lib/api/filters.ts`'s own doc comment says so) — routing the built-in
 *    catalogue through it would mean a signed-out hunter with no backend
 *    (exactly `ui-invariants.spec.ts`'s `vite preview` scenario) sees *zero*
 *    filters at all, which regresses the one thing this pass is required not
 *    to break. Local presets stay local; only the user's own saved filters
 *    go through the network.
 *  - **The user's real saved filters** (`useSavedFilters`, only ever
 *    non-empty when authenticated) — genuinely persisted, editable, deletable.
 *
 * `enabled`/`opacity`/`outline` are **not** server state — the API has no
 * notion of "currently painted on the map" — so they live in this
 * component's own `filterUi` map, keyed by id, exactly the way `active`/
 * `opacities` already work for the built-in analysis layers above.
 */
interface FilterEntry {
  id: string;
  name: string;
  description?: string;
  color: string;
  predicate: TerrainPredicate;
  enabled: boolean;
  opacity: number;
  outline: boolean;
  /** Present only for a real, persisted filter — see `SavedFilterSummary.editable`. */
  editable?: SavedFilterDto;
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
 * The three panels that share the one drawer slot (`docs/AUDIT-PRODUCT.md`
 * rec 20). `null` means the drawer is closed. The Offline region picker is
 * deliberately not a fourth member here — see the `CommandBar` block below
 * for why it stays a sibling toggle rather than a tab.
 */
type DrawerTab = 'layers' | 'stands' | 'observations';

/**
 * Handoff from a stand's "Log a sighting/blank sit here" buttons
 * (`WaypointDetail`, inside `WaypointsSheet`) into the Sightings tab —
 * `components/observations/index.ts`'s mounting note names this exact wire.
 * Cleared whenever the Sightings tab is entered any other way, so a stale
 * stand from an earlier visit can never resurface as "Logging at …" context
 * on an unrelated sighting.
 */
interface ObservationHandoff {
  waypoint: WaypointDto;
  intent: 'sighting' | 'blank-sit';
}

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
 *
 * Stands, Sightings and saved-filter editing (this pass) all call
 * authenticated endpoints, but the *components that do* — `WaypointsSheet`,
 * `ObservationsSheet`, `FilterEditor`/`FilterLibrary` — are mounted from
 * here unconditionally, the same posture `MapView`'s own layers already
 * have. Each one is built to degrade on its own (a sign-in prompt instead of
 * a crash, `isError` instead of a thrown exception), so the map keeps
 * working exactly as before with no sign-in and no backend; only the panels
 * that need identity ask for it, and only once opened.
 */
function MapWorkspace() {
  const [active, setActive] = useState<Set<string>>(() => new Set(['satellite', 'multiHillshade']));
  const [opacities, setOpacities] = useState<Record<string, number>>({});
  const [windFromDeg, setWindFromDeg] = useState<number | null>(null);
  const [atUtc, setAtUtc] = useState(() => new Date());
  const [inspect, setInspect] = useState<{ lng: number; lat: number } | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab | null>('layers');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [popover, setPopover] = useState<Popover>(null);
  const [center, setCenter] = useState({ lng: -82.54, lat: 39.43 });
  const [view, setView] = useState<{ bounds: BBox; zoom: number } | null>(null);
  const [regionBox, setRegionBox] = useState<BBox | null>(null);

  // `'new'` opens `FilterLibrary` (the "start from a preset or blank" picker);
  // a `SavedFilterDto` opens `FilterEditor` directly on that filter. Either
  // way this takes over the whole drawer slot — see the render below for why
  // it is not just another `DrawerTab`.
  const [filterEditorTarget, setFilterEditorTarget] = useState<'new' | SavedFilterDto | null>(null);
  const [obsHandoff, setObsHandoff] = useState<ObservationHandoff | null>(null);

  const mapRef = useRef<maplibregl.Map | null>(null);
  // State, not just a ref: the coverage hook has to re-subscribe when the map
  // instance appears, and a ref assignment does not re-render.
  const [map, setMap] = useState<maplibregl.Map | null>(null);

  const { status: authStatus } = useAuth();
  const currentProperty = useCurrentProperty();
  const propertyId = currentProperty.propertyId;

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

  // The user's own saved filters — genuinely empty (not an error state a
  // screen needs to branch on) whenever signed out or offline; see
  // `FilterEntry`'s doc comment for why presets do not also come from here.
  const savedFiltersQuery = useSavedFilters(propertyId ?? undefined);

  const [filterUi, setFilterUi] = useState<
    Record<string, { enabled: boolean; opacity?: number; outline?: boolean }>
  >({});

  const filters = useMemo<FilterEntry[]>(() => {
    const presets: FilterEntry[] = PRESET_FILTERS.map((p, i) => {
      const id = `preset-${i}`;
      const ui = filterUi[id];
      return {
        id,
        name: p.name,
        description: p.description,
        color: p.color,
        predicate: p.predicate,
        enabled: ui?.enabled ?? false,
        opacity: ui?.opacity ?? p.opacity,
        outline: ui?.outline ?? p.outline ?? true,
      };
    });

    const saved: FilterEntry[] = (savedFiltersQuery.data ?? [])
      .map((f): FilterEntry | null => {
        // Untrusted the moment it arrives over the wire — the server already
        // validates on write, but a corrupt or foreign predicate must never
        // be rendered onto the map as if it were a real, understood query.
        const predicate = parseStoredPredicate(f.predicate);
        if (!predicate) return null;
        const ui = filterUi[f.id];
        return {
          id: f.id,
          name: f.name,
          description: f.description ?? undefined,
          color: f.color,
          predicate,
          enabled: ui?.enabled ?? false,
          opacity: ui?.opacity ?? f.opacity,
          outline: ui?.outline ?? f.outline,
          editable: f,
        };
      })
      .filter((f): f is FilterEntry => f !== null);

    return [...presets, ...saved];
  }, [filterUi, savedFiltersQuery.data]);

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
    setFilterUi((prev) => ({
      ...prev,
      [id]: { ...prev[id], enabled: !(prev[id]?.enabled ?? false) },
    }));
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

  /**
   * Switches which panel occupies the drawer slot.
   *
   * Always the single place that closes the region picker and the filter
   * editor at the same time — two `.rl-sheet`s sharing the drawer's screen
   * position would overlap exactly, and the one underneath becomes an
   * `elementFromPoint` trap for the one on top (the failure class
   * `CommandBar`'s own doc comment names, and the one `docs/AUDIT-
   * PRODUCT.md`'s IA table exists to keep from recurring as tabs are added).
   */
  const switchTab = useCallback((tab: DrawerTab) => {
    setDrawerTab(tab);
    setPickerOpen(false);
    setFilterEditorTarget(null);
  }, []);

  const closeDrawer = useCallback(() => setDrawerTab(null), []);

  const savedFilterRows: SavedFilterSummary[] = useMemo(
    () =>
      filters.map((f) => ({
        id: f.id,
        name: f.name,
        description: f.description,
        color: f.color,
        enabled: f.enabled,
        editable: f.editable,
      })),
    [filters],
  );

  /**
   * Stands and Sightings both need a `propertyId` and neither may fabricate
   * one (`CLAUDE.md`, "never be confidently wrong about identity" applied to
   * *whose ground* a note gets filed against). This is what renders in their
   * place until one is genuinely known: a sign-in prompt if that is the gap,
   * otherwise an explicit property picker — never a silently-chosen first
   * property. See `lib/currentProperty.ts` for the persistence/validation
   * behind `currentProperty`.
   */
  const renderPropertyGate = (title: string, verb: string) => (
    <Sheet title={title} onClose={closeDrawer}>
      {authStatus === 'unauthenticated' ? (
        <Callout tone="info">
          <p>
            <Link to="/login" className="rl-link">
              Sign in
            </Link>{' '}
            to {verb} — they sync across your devices and travel with you offline once you have.
          </p>
        </Callout>
      ) : currentProperty.isLoading ? (
        <p className="rl-hint">Loading your properties…</p>
      ) : currentProperty.propertiesUnverified ? (
        // Not "you have no properties" — we never got an answer. Saying the
        // former to a hunter offline at a trailhead sends them to a
        // create-and-draw-a-boundary flow that cannot work without signal,
        // for a property they probably already own.
        <Callout tone="warn">
          <p>
            Could not check your properties — no connection to your server. Nothing is lost; this
            list will fill in as soon as you have signal. If you had a property selected, it is
            still remembered.
          </p>
        </Callout>
      ) : currentProperty.properties.length === 0 ? (
        <Callout tone="info">
          <p>
            {title} needs a property first —{' '}
            <Link to="/properties/new" className="rl-link">
              create one
            </Link>{' '}
            and draw its boundary once. Every stand, sighting and saved filter you log here is
            scoped to it, and every selection analytic is measured against it.
          </p>
        </Callout>
      ) : (
        <>
          <p className="rl-hint">
            Choose which property this is for. Never assumed — picking the wrong one here would file
            your notes against someone else's ground.
          </p>
          <ul className="rl-property-picker">
            {currentProperty.properties.map((p) => (
              <li key={p.id}>
                <Button variant="ghost" block onClick={() => currentProperty.select(p.id)}>
                  {p.name}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );

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
         * Shown whenever the Layers tab is open — that is the surface making
         * the claim, so the map should be showing its evidence at the same
         * time — and always while coverage is partial, which is the one state
         * where the text alone is actively misleading about *where* the gap is.
         */
        showCoverage={drawerTab === 'layers' || pickerOpen || isPartialCoverage(coverage)}
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
           * Layers is a panel toggle; Offline is a background task with its
           * own picker UI — which is the whole reason this bar's height
           * never has to change: Stands, Sightings and the filter editor
           * (this pass) all became *tabs inside the drawer* the Layers cell
           * opens (`TabBar`, below), not new cells here
           * (`docs/AUDIT-PRODUCT.md` rec's IA table).
           */}
          <CommandBar>
            <CommandBarCell
              label="Layers"
              description="Layers, stands and sightings"
              active={drawerTab === 'layers'}
              onClick={() => {
                // One panel at a time in the drawer slot. Two `.rl-sheet`s
                // stacked there would overlap exactly, and the one underneath
                // becomes an `elementFromPoint` trap for the one on top — the
                // failure class this repo keeps paying for.
                if (drawerTab === 'layers') closeDrawer();
                else switchTab('layers');
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
                setDrawerTab(null);
                setFilterEditorTarget(null);
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

      {drawerTab && !filterEditorTarget && (
        <div className="rl-drawer">
          <TabBar>
            <TabBarButton active={drawerTab === 'layers'} onClick={() => switchTab('layers')}>
              Layers
            </TabBarButton>
            <TabBarButton active={drawerTab === 'stands'} onClick={() => switchTab('stands')}>
              Stands
            </TabBarButton>
            <TabBarButton
              active={drawerTab === 'observations'}
              onClick={() => {
                // A manual tab switch always starts clean — only the
                // "Log a sighting/blank sit here" handoff below should ever
                // seed `initialWaypoint`/`initialIntent`, never a stale one
                // left over from an earlier visit.
                setObsHandoff(null);
                switchTab('observations');
              }}
            >
              Sightings
            </TabBarButton>
          </TabBar>

          <div className="rl-drawer__body">
            {propertyId && drawerTab !== 'layers' && (
              <div className="rl-property-banner">
                <span className="rl-property-banner__name">
                  {/* `rememberedName` is the name cached when the hunter picked
                      this property; offline the list cannot be fetched, so
                      without it this reads "Property — unknown" over ground
                      they chose by name themselves. */}
                  Property —{' '}
                  <strong>{currentProperty.property?.name ?? currentProperty.rememberedName ?? 'unknown'}</strong>
                </span>
                <Button variant="link" onClick={currentProperty.clear}>
                  Change
                </Button>
              </div>
            )}

            {drawerTab === 'layers' && (
              <LayersSheet
                active={active}
                opacities={opacities}
                windFromDeg={windFromDeg}
                savedFilters={savedFilterRows}
                coverage={coverage}
                onToggle={handleToggle}
                onOpacity={handleOpacity}
                onToggleFilter={handleToggleFilter}
                onClose={closeDrawer}
                onNewFilter={() => setFilterEditorTarget('new')}
                onEditFilter={(f) => setFilterEditorTarget(f)}
                canCreateFilters={authStatus === 'authenticated'}
              />
            )}

            {drawerTab === 'stands' &&
              (propertyId ? (
                <WaypointsSheet
                  propertyId={propertyId}
                  fallbackLocation={center}
                  windFromDeg={windFromDeg}
                  atUtc={atUtc}
                  onClose={closeDrawer}
                  onSetWind={() => setPopover('wind')}
                  onLogSighting={(w) => {
                    setObsHandoff({ waypoint: w, intent: 'sighting' });
                    setDrawerTab('observations');
                  }}
                  onLogBlankSit={(w) => {
                    setObsHandoff({ waypoint: w, intent: 'blank-sit' });
                    setDrawerTab('observations');
                  }}
                />
              ) : (
                renderPropertyGate('Stands & markers', 'log stands, cameras and markers')
              ))}

            {drawerTab === 'observations' &&
              (propertyId ? (
                <ObservationsSheet
                  propertyId={propertyId}
                  fallbackLocation={center}
                  windFromDeg={windFromDeg}
                  onSetWind={() => setPopover('wind')}
                  onClose={closeDrawer}
                  initialWaypoint={obsHandoff?.waypoint ?? null}
                  initialIntent={obsHandoff?.intent ?? null}
                />
              ) : (
                renderPropertyGate('Sightings & sits', 'log sightings and sits')
              ))}
          </div>
        </div>
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

      {filterEditorTarget === 'new' && (
        <FilterLibrary
          propertyId={propertyId ?? undefined}
          windFromDeg={windFromDeg}
          atUtc={atUtc}
          viewport={view ? { bounds: view.bounds, zoom: view.zoom } : null}
          onClose={() => setFilterEditorTarget(null)}
          onSaved={() => setFilterEditorTarget(null)}
        />
      )}

      {filterEditorTarget && filterEditorTarget !== 'new' && (
        <FilterEditor
          initial={filterEditorTarget}
          propertyId={propertyId ?? undefined}
          windFromDeg={windFromDeg}
          atUtc={atUtc}
          viewport={view ? { bounds: view.bounds, zoom: view.zoom } : null}
          onClose={() => setFilterEditorTarget(null)}
          onSaved={() => setFilterEditorTarget(null)}
          onDeleted={() => setFilterEditorTarget(null)}
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
