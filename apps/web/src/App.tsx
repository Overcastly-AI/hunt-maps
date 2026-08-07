import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import {
  PRESET_FILTERS,
  sunTimes,
  ThermalPhase,
  thermalPhaseAt,
  type TerrainPredicate,
} from '@hunt-maps/terrain';
import {
  ConditionsBar,
  DownloadIcon,
  LayersIcon,
  LocateIcon,
  MinusIcon,
  PinIcon,
  PlusIcon,
  Rail,
  RailButton,
} from '@hunt-maps/design';
import { MapView } from './components/MapView';
import { LayersSheet, type SavedFilterSummary } from './components/LayersSheet';
import { ConditionsEditor } from './components/ConditionsEditors';
import { toggleLayer } from './lib/layers';
import { TerrainProtocol } from './lib/map/terrainProtocol';
import { requestPersistentStorage } from './lib/offline/tileStore';
import { useViewportCoverage } from './lib/offline/useViewportCoverage';

const DEM_TEMPLATE =
  import.meta.env.VITE_DEM_TEMPLATE ??
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

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

export default function App() {
  const [active, setActive] = useState<Set<string>>(
    () => new Set(['satellite', 'multiHillshade']),
  );
  const [opacities, setOpacities] = useState<Record<string, number>>({});
  const [windFromDeg, setWindFromDeg] = useState<number | null>(null);
  const [atUtc, setAtUtc] = useState(() => new Date());
  const [inspect, setInspect] = useState<{ lng: number; lat: number } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [popover, setPopover] = useState<Popover>(null);
  const [center, setCenter] = useState({ lng: -82.54, lat: 39.43 });

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
  const { coverage } = useViewportCoverage(map);

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
    // Ask for persistent storage up front. Without it a large offline region is
    // evictable under storage pressure with no warning, and discovering that in
    // the field is the worst failure this app has.
    void requestPersistentStorage();
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
        coverage={coverage}
        /*
         * Shown whenever the Layers sheet is open — that is the surface making
         * the claim, so the map should be showing its evidence at the same
         * time — and always while coverage is partial, which is the one state
         * where the text alone is actively misleading about *where* the gap is.
         */
        showCoverage={sheetOpen || isPartialCoverage(coverage)}
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
          <Rail>
            <RailButton
              label="Layers"
              active={sheetOpen}
              onClick={() => setSheetOpen((open) => !open)}
            >
              <LayersIcon />
            </RailButton>
            <RailButton label="Add waypoint" onClick={() => undefined}>
              <PinIcon />
            </RailButton>
            <RailButton label="Save this area for offline use" onClick={() => undefined}>
              <DownloadIcon />
            </RailButton>
          </Rail>

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
