import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BBox } from '@hunt-maps/terrain';
import { Button, Callout, Chip, SectionHeading, Sheet } from '@hunt-maps/design';
import {
  DEM_BYTES_PER_TILE,
  DETAIL_ZOOMS,
  MAX_REGION_TILES,
  PADDING_CHOICES,
  boundsSpanMiles,
  defaultRegionName,
  formatBytes,
  padBounds,
  planCounts,
  planRegion,
  zoomRange,
  type RegionPlan,
} from '../lib/offline/regionPlan';
import { estimateRegion, freeStorageBytes, type RegionEstimate } from '../lib/offline/regionEstimate';
import type { DownloadProgress } from '../lib/offline/regionDownloader';
import type { SavedRegion } from '../lib/offline/regionStore';
import { exclusiveTileCount } from '../lib/offline/useOfflineRegions';
import type { TileStoreStats } from '../lib/offline/tileStore';

/**
 * The sentence that explains the whole product in one line.
 *
 * It is in the UI because it is the single clearest statement of Ridgeline's
 * central advantage, and because it changes what the user thinks they are
 * buying with those megabytes. Every competitor caches *rendered* layers, so a
 * download buys you the four layers you remembered to tick, on the wind you
 * happened to have set. This downloads elevation, and the analysis is computed
 * on the phone — so the same bytes buy every layer, at any wind, on any date,
 * forever.
 */
const ELEVATION_STORY =
  'This saves elevation, not rendered layers — so one download gives you every analysis ' +
  'layer, on any wind, on any date, computed here with no signal.';

export interface RegionPickerProps {
  /** The current viewport, live. `null` before the map is up. */
  viewBounds: BBox | null;
  /** `demSourceZoom(map.getZoom())` — the zoom the coverage badge measures at. */
  viewTileZoom: number;
  regions: SavedRegion[];
  active: { clientId: string; progress: DownloadProgress } | null;
  persisted: boolean | null;
  backend: TileStoreStats['backend'] | null;
  /** The box currently selected, so the map can draw it. `null` clears it. */
  onBoxChange: (box: BBox | null) => void;
  onStart: (input: { name: string; bounds: BBox; plan: RegionPlan }) => void;
  onResume: (clientId: string) => void;
  onCancel: () => void;
  onRemove: (clientId: string) => void;
  onClose: () => void;
}

/**
 * Pick an area, see what it costs, download it, manage what you have.
 *
 * ## Why the estimate is on the button
 *
 * "Show the estimate before committing" is easy to satisfy badly — a
 * confirmation dialog nobody reads. Tile count grows 4× per zoom level, so the
 * number a hunter needs is the one attached to the action they are about to
 * take, at the moment they take it. The primary button therefore reads
 * "Download 6,318 tiles · about 630 MB" rather than "Download", and the
 * server's warnings sit directly above it.
 *
 * ## Why the box follows the viewport
 *
 * The overwhelmingly common case is "save what I am looking at". So the box is
 * the current view, live — pan the map with the panel open and the estimate
 * follows. The area buttons expand it outward from there for the "and a bit
 * beyond the ridge" case, and the dashed outline on the map shows exactly what
 * that bought.
 */
export function RegionPicker({
  viewBounds,
  viewTileZoom,
  regions,
  active,
  persisted,
  backend,
  onBoxChange,
  onStart,
  onResume,
  onCancel,
  onRemove,
  onClose,
}: RegionPickerProps) {
  const [padId, setPadId] = useState<string>(PADDING_CHOICES[0].id);
  const [detailZoom, setDetailZoom] = useState<number>(DETAIL_ZOOMS[DETAIL_ZOOMS.length - 1]);
  const [estimate, setEstimate] = useState<RegionEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const pad = PADDING_CHOICES.find((c) => c.id === padId) ?? PADDING_CHOICES[0];

  const box = useMemo(
    () => (viewBounds ? padBounds(viewBounds, pad.pad) : null),
    [viewBounds, pad.pad],
  );

  const counts = useMemo(
    () => (box ? planCounts(box, viewTileZoom, detailZoom) : null),
    [box, viewTileZoom, detailZoom],
  );

  // Keep the map's dashed outline in step with the choice…
  useEffect(() => {
    onBoxChange(box);
  }, [box, onBoxChange]);

  // …and clear it when the panel closes. Its own effect, so the box is not torn
  // down and re-added on every pan: a box left painted over a map the user has
  // moved on from is chrome claiming something that is no longer true, but a
  // box that blinks on every frame of a pan is just noise.
  useEffect(() => () => onBoxChange(null), [onBoxChange]);

  // --- The estimate ---------------------------------------------------------
  //
  // Debounced, abortable, and it never blocks the panel: an estimate that has
  // not arrived shows the local tile count with the size marked as pending,
  // rather than an empty screen. The server round trip is an *improvement* on
  // the local answer, never a prerequisite for it.
  const estimateToken = useRef(0);
  useEffect(() => {
    if (!box || !counts) {
      setEstimate(null);
      return;
    }
    const mine = ++estimateToken.current;
    const controller = new AbortController();
    setEstimating(true);
    const timer = setTimeout(() => {
      void (async () => {
        const free = await freeStorageBytes();
        const result = await estimateRegion({
          bounds: box,
          minZoom: counts.minZoom,
          maxZoom: counts.maxZoom,
          tileCount: counts.tileCount,
          signal: controller.signal,
          freeBytes: free,
        });
        if (mine !== estimateToken.current) return;
        setEstimate(result);
        setEstimating(false);
      })();
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [box, counts]);

  const span = box ? boundsSpanMiles(box) : null;
  const zooms = zoomRange(viewTileZoom, detailZoom);

  /*
   * Size comes from the *same* synchronous count as the tile figure, never
   * from the async estimate.
   *
   * This was a real defect caught by hand: the tile count updated the instant
   * the detail level changed while the byte figure lagged behind on the
   * previous answer, so the button read "Download 12 tiles · about 11 MB" —
   * two numbers from different moments, one of them ten times wrong, on the
   * control the user is about to press. The server round trip now contributes
   * warnings and provenance only; the arithmetic is local and instantaneous,
   * so the pair cannot drift.
   */
  const estimatedBytes = counts ? counts.tileCount * DEM_BYTES_PER_TILE : 0;

  const busy = active !== null;
  const blocked = !box || !counts || counts.tileCount === 0;
  const overLimit = Boolean(counts && counts.tileCount > MAX_REGION_TILES);

  const handleStart = useCallback(() => {
    if (!box) return;
    const plan = planRegion(box, viewTileZoom, detailZoom);
    onStart({ name: defaultRegionName(box), bounds: box, plan });
  }, [box, viewTileZoom, detailZoom, onStart]);

  return (
    <Sheet
      title="Save for offline"
      onClose={onClose}
      action={
        <span className="region-backend" data-testid="region-storage-chip">
          <Chip {...storageChip(persisted, backend)} />
        </span>
      }
    >
      {/* Advantage #3, said plainly, at the top — before any number. */}
      <p className="rl-hint region-story" data-testid="region-elevation-story">
        {ELEVATION_STORY}
      </p>

      {/*
        Degrade loudly — but the two storage failures are not equally urgent,
        and on a 390px phone the panel above the Download button has about
        437px to play with.

        `memory` means the download will not exist after a reload. That is
        fatal to the whole point of pressing the button, so it stays above it
        and it is an `alert`.

        A refused *persistence* request is different: the download does work,
        it is merely evictable. Its full explanation therefore sits below the
        action, next to the saved regions it is actually about, while the
        always-visible header chip carries the state ("EVICTABLE") on every
        frame — including while the body is scrolled. Putting a 94px callout
        about a survivable condition above the primary action pushed that
        action off the first screen on mobile, which is a worse failure than
        the one it was warning about.
      */}
      {backend === 'memory' && (
        <Callout tone="danger" role="alert">
          <p>
            This device gave us no persistent storage at all, so anything you download is held in
            memory and will be gone when the app reloads. Do not rely on this at the trailhead.
          </p>
        </Callout>
      )}

      <section className="rl-group">
        {/* The measured span lives in the heading's hint rather than in a
            paragraph of its own: same information, one row fewer between the
            user and the button. */}
        <SectionHeading
          hint={
            <span data-testid="region-span">
              {span
                ? `About ${span.width.toFixed(1)} × ${span.height.toFixed(1)} miles — pan the map and this follows.`
                : 'Waiting for the map.'}
            </span>
          }
        >
          Area
        </SectionHeading>
        <div className="region-segments" role="group" aria-label="Area size">
          {PADDING_CHOICES.map((choice) => (
            <Button
              key={choice.id}
              variant={choice.id === padId ? 'primary' : 'ghost'}
              aria-pressed={choice.id === padId}
              disabled={busy}
              onClick={() => setPadId(choice.id)}
            >
              {choice.label}
            </Button>
          ))}
        </div>
      </section>

      <section className="rl-group">
        <SectionHeading hint="Four times the tiles per level. 15 is the deepest stored.">
          Detail
        </SectionHeading>
        <div className="region-segments" role="group" aria-label="Detail level">
          {DETAIL_ZOOMS.map((z) => (
            <Button
              key={z}
              variant={z === detailZoom ? 'primary' : 'ghost'}
              aria-pressed={z === detailZoom}
              aria-label={`Detail to zoom ${z}`}
              disabled={busy}
              onClick={() => setDetailZoom(z)}
            >
              z{z}
            </Button>
          ))}
        </div>
      </section>

      {/*
        The estimate and the action, together and above the saved list.

        Ordering here is a hit-testing decision, not a taste one. The action
        started life pinned to the bottom of the panel with `position: sticky`,
        which put it on top of the Detail buttons on a 390px phone: they
        painted, `getBoundingClientRect` said they were there, and
        `elementFromPoint` at their centres resolved to the bar — visible and
        unclickable, the exact defect class this app has paid for twice
        already. `ui-invariants` section 1 caught it at the mobile viewport.
        Nothing overlaps anything now; the panel is simply short enough above
        this point that the action lands on the first screen at both viewports,
        and the invariant that proves it hit-tests the button *without*
        scrolling.

        The warnings sit immediately above the button, because the sentence
        "About 1.4 GB. Start this on wifi, not the night before a hunt." is
        only worth anything if it is read before the press, not after.
      */}
      <section className="rl-group">
        {/* The server's own words, verbatim. They are already written for a
            hunter and rewording them here would only make them worse. */}
        {estimate && estimate.warnings.length > 0 && (
          <Callout tone={overLimit ? 'danger' : 'warn'} role={overLimit ? 'alert' : 'status'}>
            {estimate.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </Callout>
        )}

        {active ? (
          <div data-testid="region-progress">
            <ProgressReadout progress={active.progress} />
            <Button variant="ghost" block data-testid="region-cancel" onClick={onCancel}>
              Stop — keep what has downloaded
            </Button>
            <p className="rl-hint">
              Stopping keeps every tile already saved. Starting again picks up where this left off
              rather than downloading it all a second time.
            </p>
          </div>
        ) : (
          <>
            <Button
              variant="primary"
              block
              data-testid="region-download"
              disabled={blocked || overLimit}
              onClick={handleStart}
            >
              {counts
                ? `Download ${counts.tileCount.toLocaleString()} tiles · about ${formatBytes(
                    estimatedBytes,
                  )}`
                : 'Download this area'}
            </Button>
            {overLimit && (
              <p className="rl-hint">
                Too large to download as one region. Shrink the area or drop the detail level.
              </p>
            )}
            {/* Below the button, deliberately: the button already carries the
                two numbers that decide the press. This is the provenance and
                the caveat, which matter but must never push the action down
                the panel. */}
            <p className="rl-hint region-summary" data-testid="region-estimate">
              {counts
                ? `${counts.tileCount.toLocaleString()} elevation tiles, about ` +
                  `${formatBytes(estimatedBytes)}, zooms ${zooms.minZoom}–${zooms.maxZoom} — so ` +
                  `zooming out to find the truck still works.`
                : 'Waiting for the map.'}
            </p>
            <p className="rl-hint" data-testid="region-estimate-source">
              {estimating && !estimate
                ? 'Checking this plan against the server…'
                : estimate?.source === 'server'
                  ? 'Confirmed against the server. Size is measured from real elevation tiles.'
                  : 'Estimated on this device — the server could not be reached. Sizes come ' +
                    'from measured elevation tiles, so they are close, not exact.'}
            </p>
          </>
        )}
      </section>

      {/* --- What is already saved ----------------------------------------- */}
      <section className="rl-group">
        <SectionHeading>Saved areas</SectionHeading>

        {backend !== 'memory' && persisted === false && (
          <Callout tone="warn">
            <p>
              The browser did not grant persistent storage. What you download is saved, but the
              browser may evict it without warning if the device runs low on space. Check the
              badge before you leave.
            </p>
          </Callout>
        )}
        {regions.length === 0 ? (
          <p className="rl-hint">
            Nothing saved yet. Everything on this map still needs a connection.
          </p>
        ) : (
          <ul className="region-list" data-testid="region-list">
            {regions.map((region) => (
              <li key={region.clientId} className="region-item">
                <div className="region-item__head">
                  <span className="region-item__name">{region.name}</span>
                  <Chip {...regionChip(region)} />
                </div>
                <p className="rl-hint region-item__meta">
                  {region.tileDone.toLocaleString()} of {region.tileTotal.toLocaleString()} tiles
                  {region.bytes > 0 ? ` · ${formatBytes(region.bytes)} downloaded` : ''}
                  {` · zoom ${region.minZoom}–${region.maxZoom}`}
                  {region.volatile ? ' · in memory only, lost on reload' : ''}
                </p>
                {region.error && (
                  <Callout tone="danger" role="alert">
                    <p>{region.error}</p>
                  </Callout>
                )}
                {region.tileFailed > 0 && (
                  <p className="rl-hint">
                    {region.tileFailed.toLocaleString()} tiles could not be fetched. That ground
                    will be blank with no signal — resume to try them again.
                  </p>
                )}
                <div className="region-actions">
                  {region.status !== 'ready' && (
                    <Button variant="ghost" disabled={busy} onClick={() => onResume(region.clientId)}>
                      {region.status === 'failed' ? 'Try again' : 'Resume'}
                    </Button>
                  )}
                  {confirmDelete === region.clientId ? (
                    <>
                      <Button
                        variant="danger"
                        onClick={() => {
                          setConfirmDelete(null);
                          onRemove(region.clientId);
                        }}
                      >
                        Delete for good
                      </Button>
                      <Button variant="link" onClick={() => setConfirmDelete(null)}>
                        Keep
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() => setConfirmDelete(region.clientId)}
                    >
                      Delete
                    </Button>
                  )}
                </div>
                {confirmDelete === region.clientId && (
                  <p className="rl-hint">
                    {/*
                      A concrete figure, not a vague reassurance. Two saved
                      areas over neighbouring ground share tiles along their
                      seam, so deleting one frees less than its own size — and
                      "this will free 40 tiles" for a 6,000-tile region is a
                      thing a hunter needs to know *before* they press it, not
                      a surprise afterwards. Tiles another saved area still
                      needs are never touched.
                    */}
                    {(() => {
                      const exclusive = exclusiveTileCount(region, regions);
                      return (
                        `Frees about ${exclusive.toLocaleString()} elevation tiles ` +
                        `(${formatBytes(exclusive * DEM_BYTES_PER_TILE)}). Tiles your other ` +
                        `saved areas still need are kept.`
                      );
                    })()}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

    </Sheet>
  );
}

/**
 * Progress, stated in tiles rather than only as a bar.
 *
 * A bar alone cannot distinguish "checking what you already have" from
 * "downloading", and on a resume the first phase can run for a while over tens
 * of thousands of tiles with nothing being fetched. A user watching a bar move
 * with no bytes arriving reasonably concludes it is broken.
 */
function ProgressReadout({ progress }: { progress: DownloadProgress }) {
  const pct = progress.total === 0 ? 0 : Math.round((progress.stored / progress.total) * 100);
  const checking = progress.phase === 'checking';
  return (
    <>
      <div
        className="region-bar"
        role="progressbar"
        aria-label="Download progress"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.stored}
        data-testid="region-progress-bar"
      >
        <div className="region-bar__fill" style={{ width: `${pct}%` }} />
      </div>
      <dl className="region-figures">
        <dt>{checking ? 'Checking what is already here' : 'Saved'}</dt>
        <dd>
          {progress.stored.toLocaleString()} / {progress.total.toLocaleString()}
        </dd>
        <dt>Downloaded this run</dt>
        <dd>
          {progress.fetched.toLocaleString()} tiles · {formatBytes(progress.bytes)}
        </dd>
        {progress.failed > 0 && (
          <>
            <dt>Could not fetch</dt>
            <dd>{progress.failed.toLocaleString()}</dd>
          </>
        )}
      </dl>
    </>
  );
}

/**
 * The storage chip, which never says "fine" unless it is.
 *
 * `null` is genuinely unknown and says so rather than borrowing a reassuring
 * default — the same rule the coverage badge follows, for the same reason.
 */
function storageChip(
  persisted: boolean | null,
  backend: TileStoreStats['backend'] | null,
): { tone: 'ok' | 'warn' | 'danger' | 'neutral'; glyph: string; children: string; title: string } {
  if (backend === 'memory') {
    return {
      tone: 'danger',
      glyph: '!',
      children: 'Memory only',
      title: 'No persistent storage backend is available. Downloads are lost on reload.',
    };
  }
  if (persisted === null) {
    return {
      tone: 'neutral',
      glyph: '◌',
      children: 'Checking storage',
      title: 'Still asking the browser whether it will keep this data.',
    };
  }
  if (!persisted) {
    return {
      tone: 'warn',
      glyph: '○',
      children: 'Evictable',
      title:
        'The browser refused persistent storage, so saved regions can be evicted under storage pressure.',
    };
  }
  return {
    tone: 'ok',
    glyph: '●',
    children: 'Persistent',
    title: 'The browser granted persistent storage — saved regions will not be evicted silently.',
  };
}

function regionChip(region: SavedRegion): {
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
  glyph: string;
  children: string;
} {
  switch (region.status) {
    case 'ready':
      return { tone: 'ok', glyph: '●', children: 'Saved' };
    case 'partial':
      return { tone: 'warn', glyph: '◐', children: 'Gaps' };
    case 'paused':
      return { tone: 'warn', glyph: '◐', children: 'Unfinished' };
    case 'failed':
      return { tone: 'danger', glyph: '!', children: 'Failed' };
    default:
      return { tone: 'neutral', glyph: '◌', children: 'Downloading' };
  }
}
