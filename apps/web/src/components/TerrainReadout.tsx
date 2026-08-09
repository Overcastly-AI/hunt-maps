import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { DemEncoding } from '@hunt-maps/terrain';
import { Chip, CloseIcon, Confidence, MinusIcon, PlusIcon, type EvidenceGrade } from '@hunt-maps/design';
import {
  queryTerrainPoint,
  type AspectReading,
  type HeightTileLoader,
  type Reading,
  type TerrainReadoutOutcome,
} from '../lib/map/pointQuery';
import { createDemHeightLoader } from '../lib/map/demHeightLoader';
import { DEM_TEMPLATE } from '../lib/map/demSource';
import { layerById } from '../lib/layers';

/**
 * The terrain readout — a peek-detent bottom sheet, not a floating dialog
 * (BACKLOG R6).
 *
 * ## Why a peek detent, and not the full sheet `LayersSheet` uses
 *
 * A hunter taps a point on the map to answer "what is this ground?" A sheet
 * that opens full-height buries the map it is describing — the exact context
 * that made them tap. The peek detent shows the headline facts (elevation,
 * slope, aspect, landform) while the terrain underneath stays visible, and
 * only grows to a second, taller detent when the user explicitly asks for
 * more (the Wood morphometric feature and the modelled bedding score).
 *
 * ## The content model — this is the part that is load-bearing
 *
 * The peek row is a **fact line**: Horn slope, aspect, elevation and the
 * Weiss landform class. Every one of those is a published, peer-reviewed
 * algorithm validated against closed-form analytic surfaces (see
 * `packages/terrain`'s own test suite) — they carry **no** evidence chip,
 * because a chip there would imply a doubt that does not exist. The expanded
 * detent adds bedding likelihood, which is *modelled* on an assumed slope
 * parameter (`docs/EVIDENCE.md`, 🔴 Assumed) — that, and only that, carries a
 * `Confidence` chip. Grading everything is identical to grading nothing; this
 * component is the second real enforcement of that rule after the bedding row
 * in `LayersSheet`.
 *
 * ## Unknown reads as unknown
 *
 * Several engine operators cannot answer at a given cell — a DEM void, a
 * lake, a neighbour tile that never arrived — and say so with `NaN` or a
 * dedicated `Unknown` class rather than a fabricated value. `pointQuery.ts`'s
 * `Reading<T>` carries that all the way here: every field below renders
 * either a real value, `'flat'` (a genuine measurement — this ground has no
 * downslope face), or a plain-language "not measured here" — never a number,
 * and never a dash that could be misread as zero.
 */
export interface TerrainReadoutProps {
  /** The tapped point, or `null` to close the sheet. */
  point: { lng: number; lat: number } | null;
  windFromDeg: number | null;
  atUtc: Date;
  onClose: () => void;
  /** DEM tile zoom to sample at. Defaults to the finest zoom ever cached, regardless of the map's current zoom. */
  zoom?: number;
  demUrlTemplate?: string;
  demEncoding?: DemEncoding;
  /** Overrides the production offline-first loader — the seam tests and the QA harness use this. */
  loadHeights?: HeightTileLoader;
}

type Detent = 'peek' | 'expanded';
type LoadState = { kind: 'loading' } | TerrainReadoutOutcome;

/** Pull-to-dismiss / pull-to-expand thresholds, in CSS px, for the grip drag. */
const DRAG_DISMISS_PX = 80;
const DRAG_DETENT_PX = 40;

export function TerrainReadout({
  point,
  windFromDeg,
  atUtc,
  onClose,
  zoom,
  demUrlTemplate = DEM_TEMPLATE,
  demEncoding = 'terrarium',
  loadHeights,
}: TerrainReadoutProps) {
  const [detent, setDetent] = useState<Detent>('peek');
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [dragPx, setDragPx] = useState(0);
  const dragOrigin = useRef<{ y: number; detent: Detent } | null>(null);

  // Built once and reused across renders unless the caller overrides it
  // (tests, the QA harness) — a fresh loader per render would still be
  // correct, just a wasted allocation on every keystroke of an unrelated
  // state update.
  const defaultLoader = useMemo(
    () => createDemHeightLoader({ demUrlTemplate, demEncoding }),
    [demUrlTemplate, demEncoding],
  );
  const loader = loadHeights ?? defaultLoader;
  // Read from the effect via a ref rather than the effect depending on
  // `loader` directly, mirroring `MapView.tsx`'s own `viewChangeRef` — a
  // `loadHeights` override (tests, the QA harness) is exactly the kind of
  // inline function prop that gets a fresh identity on every parent
  // re-render, and this effect must not treat "the caller re-rendered for an
  // unrelated reason" as "the query changed" and reset the sheet back to
  // peek underneath the user.
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const lng = point?.lng;
  const lat = point?.lat;

  // `atUtc.getTime()`, not `atUtc` — a caller that builds the `Date` inline
  // (or otherwise hands back a fresh instance representing the same moment)
  // would otherwise re-trigger this effect, and with it a `setDetent('peek')`,
  // on every unrelated parent re-render: exactly the "trigger moves/resets
  // out from under the user" failure class `ui-invariants` Group 2 exists to
  // catch, caught here by the QA harness intentionally re-rendering the
  // parent (a brightness toggle) between screenshots.
  const atUtcMs = atUtc.getTime();

  useEffect(() => {
    if (lng === undefined || lat === undefined) return;
    setDetent('peek');
    setState({ kind: 'loading' });
    const controller = new AbortController();
    queryTerrainPoint(
      { lng, lat },
      loaderRef.current,
      { windFromDeg, atUtc: new Date(atUtcMs), zoom },
      controller.signal,
    )
      .then((outcome) => {
        if (!controller.signal.aborted) setState(outcome);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => controller.abort();
    // `loaderRef`/`loaderRef.current` deliberately excluded — see its own
    // comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lng, lat, windFromDeg, atUtcMs, zoom]);

  if (point === null) return null;

  const beddingLayer = layerById('bedding');

  function onGripPointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragOrigin.current = { y: e.clientY, detent };
  }

  function onGripPointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragOrigin.current) return;
    setDragPx(e.clientY - dragOrigin.current.y);
  }

  function endDrag() {
    const origin = dragOrigin.current;
    dragOrigin.current = null;
    const dy = dragPx;
    setDragPx(0);
    if (!origin) return;

    // A drag that barely moved is a tap — toggle the detent exactly like the
    // explicit +/- button does. Deliberately the *only* place that decides
    // this: the grip used to also carry a plain `onClick`, and a browser
    // fires a synthetic `click` after `pointerup` on the same element
    // regardless of how far the pointer travelled in between, so a 100px
    // dismiss-drag and a tap-toggle were racing on every release. One state
    // machine, driven off the measured distance, removes the race instead of
    // guessing which handler should win it.
    const TAP_THRESHOLD_PX = 6;
    if (Math.abs(dy) < TAP_THRESHOLD_PX) {
      setDetent(origin.detent === 'peek' ? 'expanded' : 'peek');
      return;
    }

    if (origin.detent === 'peek') {
      if (dy > DRAG_DISMISS_PX) onClose();
      else if (dy < -DRAG_DETENT_PX) setDetent('expanded');
    } else if (dy > DRAG_DETENT_PX) {
      setDetent('peek');
    }
  }

  return (
    <div
      className="rl-readout rl-glass"
      data-testid="terrain-readout"
      data-detent={detent}
      role="dialog"
      aria-modal="false"
      aria-label="Terrain readout"
      style={dragPx > 0 ? { transform: `translateY(${dragPx}px)` } : undefined}
    >
      <div className="rl-readout__grip-row">
        <button
          type="button"
          className="rl-readout__grip"
          aria-label={detent === 'peek' ? 'Expand terrain readout' : 'Collapse terrain readout'}
          onPointerDown={onGripPointerDown}
          onPointerMove={onGripPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span className="rl-readout__grip-bar" aria-hidden="true" />
        </button>
      </div>

      <div className="rl-readout__peek">
        <ReadoutHeadline state={state} />
        <div className="rl-readout__peek-actions">
          <button
            type="button"
            className="rl-rail__btn"
            aria-label={detent === 'peek' ? 'Show bedding likelihood and more detail' : 'Show fewer details'}
            aria-pressed={detent === 'expanded'}
            onClick={() => setDetent(detent === 'peek' ? 'expanded' : 'peek')}
          >
            {detent === 'peek' ? <PlusIcon width={16} height={16} /> : <MinusIcon width={16} height={16} />}
          </button>
          <button
            type="button"
            className="rl-rail__btn"
            aria-label="Close terrain readout"
            onClick={onClose}
          >
            <CloseIcon width={16} height={16} />
          </button>
        </div>
      </div>

      {detent === 'expanded' && state.kind === 'ok' && (
        <div className="rl-readout__body">
          <section className="rl-readout__section">
            <h4 className="rl-readout__section-title">More geometry</h4>
            <FactRow label="Feature" reading={state.readout.facts.morphometry} format={(v) => v} />
          </section>

          <section className="rl-readout__section rl-readout__section--judgement">
            <h4 className="rl-readout__section-title">Modelled</h4>
            <div className="rl-readout__judgement-row">
              <span className="rl-readout__judgement-label">Bedding likelihood</span>
              <JudgementValue
                windSet={state.readout.judgement.windSet}
                reading={state.readout.judgement.beddingPercent}
                grade={beddingLayer?.grade}
              />
            </div>
            <p className="rl-hint">
              Leeward aspect, real upwind shelter and a beddable grade, for the wind you set — not a
              measurement, a defensible estimate. Graded against{' '}
              <code>docs/EVIDENCE.md</code>.
            </p>
          </section>
        </div>
      )}

      <p className="rl-hint rl-readout__provenance">
        Resolves against the elevation tiles on this device, so it works with no signal.
      </p>
    </div>
  );
}

/** The fact-line row: elevation · slope · aspect · landform, or a loading/no-data/error state. */
function ReadoutHeadline({ state }: { state: LoadState }) {
  if (state.kind === 'loading') {
    return <p className="rl-readout__status">Reading terrain…</p>;
  }
  if (state.kind === 'no-data') {
    return (
      <p className="rl-readout__status">
        No elevation data here — this ground was never saved for offline use.
      </p>
    );
  }
  if (state.kind === 'error') {
    return (
      <p className="rl-readout__status" title={state.message}>
        Could not read the terrain here.
      </p>
    );
  }

  const { facts } = state.readout;
  return (
    <p className="rl-readout__facts" data-testid="readout-facts">
      <FactToken reading={facts.elevationFt} format={(ft) => `${ft} ft`} />
      <Sep />
      <FactToken reading={facts.slopeDeg} format={(deg) => `Slope ${deg}°`} />
      <Sep />
      <FactToken reading={facts.aspect} format={formatAspect} flatLabel="Flat" />
      <Sep />
      <FactToken reading={facts.landform} format={(v) => v} />
    </p>
  );
}

function formatAspect(a: AspectReading): string {
  return `Aspect ${a.octant} ${String(Math.round(a.deg)).padStart(3, '0')}°`;
}

function Sep() {
  return (
    <span className="rl-readout__sep" aria-hidden="true">
      ·
    </span>
  );
}

/** One fact-line token. Unmeasured never renders as a figure — it drops out of the mono styling entirely. */
function FactToken<T>({
  reading,
  format,
  flatLabel = 'Flat',
}: {
  reading: Reading<T>;
  format: (value: T) => string;
  flatLabel?: string;
}) {
  if (reading.kind === 'value') return <span>{format(reading.value)}</span>;
  if (reading.kind === 'flat') return <span>{flatLabel}</span>;
  return <span className="rl-readout__unmeasured">not measured here</span>;
}

/** A labelled row in the expanded body, for a single published (ungraded) fact. */
function FactRow<T>({
  label,
  reading,
  format,
  flatLabel = 'Flat',
}: {
  label: string;
  reading: Reading<T>;
  format: (value: T) => string;
  flatLabel?: string;
}) {
  return (
    <div className="rl-readout__fact-row">
      <span className="rl-readout__fact-label">{label}</span>
      <span className="rl-readout__fact-value">
        <FactToken reading={reading} format={format} flatLabel={flatLabel} />
      </span>
    </div>
  );
}

/** The one graded value in this panel — bedding likelihood, with its `Confidence` chip. */
function JudgementValue({
  windSet,
  reading,
  grade,
}: {
  windSet: boolean;
  reading: Reading<number>;
  grade?: EvidenceGrade;
}) {
  if (!windSet) {
    return <Chip tone="warn">Set a wind direction to see this</Chip>;
  }
  if (reading.kind !== 'value') {
    return <span className="rl-readout__unmeasured">not measured here</span>;
  }
  return (
    <span className="rl-readout__judgement-value">
      <span className="rl-readout__judgement-figure">{reading.value}%</span>
      {grade && (
        <Confidence
          grade={grade}
          note="Graded against docs/EVIDENCE.md — the slope, ring-radius and cover terms behind this score are defensible estimates, not measured values."
        />
      )}
    </span>
  );
}
