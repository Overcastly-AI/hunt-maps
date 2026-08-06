import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PRESET_FILTERS, type TerrainPredicate } from '@hunt-maps/terrain';
import { Button } from '@hunt-maps/design';
import { MapView } from './components/MapView';
import { LayerPanel, type SavedFilterSummary } from './components/LayerPanel';
import { toggleLayer } from './lib/layers';
import { TerrainProtocol } from './lib/map/terrainProtocol';
import { openTileStore, requestPersistentStorage } from './lib/offline/tileStore';

const DEM_TEMPLATE =
  import.meta.env.VITE_DEM_TEMPLATE ??
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

interface FilterEntry extends SavedFilterSummary {
  predicate: TerrainPredicate;
  opacity: number;
  outline: boolean;
}

export default function App() {
  const [active, setActive] = useState<Set<string>>(
    () => new Set(['satellite', 'multiHillshade']),
  );
  const [opacities, setOpacities] = useState<Record<string, number>>({});
  const [windFromDeg, setWindFromDeg] = useState<number | null>(null);
  const [atUtc, setAtUtc] = useState(() => new Date());
  const [offlineReady, setOfflineReady] = useState(false);
  const [inspect, setInspect] = useState<{ lng: number; lat: number } | null>(null);

  // The preset library seeds a new install so the first run is not an empty
  // list of a feature nobody has seen before.
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
    void openTileStore()
      .then((store) => store.stats())
      .then((s) => setOfflineReady(s.tileCount > 0));
    return () => protocol.unregister();
  }, [protocol]);

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
    setFilters((prev) =>
      prev.map((f) => (f.id === id ? { ...f, enabled: !f.enabled } : f)),
    );
  }, []);

  return (
    <div className="app-shell">
      <LayerPanel
        active={active}
        opacities={opacities}
        windFromDeg={windFromDeg}
        atUtc={atUtc}
        savedFilters={filters}
        offlineReady={offlineReady}
        onToggle={handleToggle}
        onOpacity={handleOpacity}
        onWindChange={setWindFromDeg}
        onTimeChange={setAtUtc}
        onToggleFilter={handleToggleFilter}
        onEditFilters={() => undefined}
      />

      <main className="map-area">
        <MapView
          protocol={protocol}
          activeLayers={active}
          opacities={opacities}
          windFromDeg={windFromDeg}
          atUtc={atUtc}
          filterStackId={filterStackId}
          onPointInspect={setInspect}
        />
        {inspect && (
          <div className="inspect-card" role="dialog" aria-label="Terrain readout">
            <Button
              variant="link"
              className="inspect-card__close"
              aria-label="Close terrain readout"
              onClick={() => setInspect(null)}
            >
              ×
            </Button>
            <h3>Terrain at this point</h3>
            <p className="rl-mono">
              {inspect.lat.toFixed(5)}, {inspect.lng.toFixed(5)}
            </p>
            <p className="rl-hint">
              Long-press readouts resolve against the elevation tiles on this device, so they work
              with no signal.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
