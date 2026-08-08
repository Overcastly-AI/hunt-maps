/**
 * The observations panel (`R5`) — field-optimised capture in the same
 * `Sheet` drawer slot `LayersSheet`/`WaypointsSheet` use.
 *
 * The home screen leads with exactly two large actions — "Log a sighting"
 * and "Log a blank sit" — because those are the two things a hunter in a
 * stand actually does over and over, and CLAUDE.md is explicit that the
 * second one needs to be fast or it will not get logged, which quietly
 * breaks every sightings-per-sit analytic downstream. Every other kind
 * (trail cam photo, harvest, sign, a sit with something in it) is one tap
 * further, behind "Log something else".
 *
 * Mounting contract: see `index.ts`'s header comment.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Callout, Sheet } from '@hunt-maps/design';
import { useAuth, useCreateObservation, useObservations, useWaypoints } from '../../lib/api';
import type { WaypointDto, WireObservationKind } from '../../lib/api/types';
import { useHereLocation, type HereLocation } from './useHereLocation';
import { useQueuedIds } from './offlineStatus';
import { BlankSitQuickLog } from './BlankSitQuickLog';
import { ObservationForm } from './ObservationForm';
import { ObservationList } from './ObservationList';
import { OBSERVATION_KIND_META } from './meta';

type View = { kind: 'home' } | { kind: 'blank-sit' } | { kind: 'form'; observationKind: WireObservationKind };

export interface ObservationsSheetProps {
  propertyId: string;
  /** The map's current centre — used only if GPS is unavailable. See `useHereLocation`. */
  fallbackLocation?: HereLocation | null;
  windFromDeg: number | null;
  onSetWind?: () => void;
  onClose: () => void;
  /** Pre-fills "logged at" — e.g. `WaypointDetail`'s "Log a sighting/blank sit here" buttons. */
  initialWaypoint?: WaypointDto | null;
  initialIntent?: 'sighting' | 'blank-sit' | null;
}

export function ObservationsSheet({
  propertyId,
  fallbackLocation,
  windFromDeg,
  onSetWind,
  onClose,
  initialWaypoint = null,
  initialIntent = null,
}: ObservationsSheetProps) {
  const { status } = useAuth();
  const [view, setView] = useState<View>(
    initialIntent === 'blank-sit'
      ? { kind: 'blank-sit' }
      : initialIntent === 'sighting'
        ? { kind: 'form', observationKind: 'SIGHTING' }
        : { kind: 'home' },
  );

  const here = useHereLocation(fallbackLocation);
  const { data: waypoints } = useWaypoints(propertyId);
  const { data: observations } = useObservations(propertyId);
  const queuedIds = useQueuedIds('observation.create');
  const create = useCreateObservation(propertyId);

  const title =
    view.kind === 'home'
      ? 'Sightings & sits'
      : view.kind === 'blank-sit'
        ? 'Blank sit'
        : OBSERVATION_KIND_META.find((m) => m.kind === view.observationKind)?.label ?? 'Log observation';

  return (
    <Sheet
      title={title}
      onClose={onClose}
      action={
        view.kind !== 'home' ? (
          // See `WaypointsSheet`'s identical comment: `.rl-btn--link` has no
          // `min-width`, and "Back" alone measured 42px wide — below the
          // 44px gloved-tap floor. `ghost`'s padding clears it.
          <Button variant="ghost" onClick={() => setView({ kind: 'home' })}>
            Back
          </Button>
        ) : undefined
      }
    >
      {status === 'unauthenticated' && (
        <Callout tone="info">
          <p>
            <Link to="/login">Sign in</Link> to log sightings and sits — they feed every selection and effort
            analytic on this property.
          </p>
        </Callout>
      )}

      {status === 'authenticated' && (
        <>
          {view.kind === 'home' && (
            <>
              {initialWaypoint && (
                <p className="rl-hint obs-home__context">
                  Logging at <strong>{initialWaypoint.name}</strong>.
                </p>
              )}
              <div className="obs-home-actions">
                <Button
                  type="button"
                  variant="primary"
                  block
                  onClick={() => setView({ kind: 'form', observationKind: 'SIGHTING' })}
                >
                  Log a sighting
                </Button>
                <Button type="button" variant="ghost" block onClick={() => setView({ kind: 'blank-sit' })}>
                  Log a blank sit
                </Button>
              </div>

              <p className="rl-eyebrow obs-home__more-label">Something else</p>
              <div className="obs-home-more">
                {OBSERVATION_KIND_META.filter((m) => m.kind !== 'SIGHTING').map((m) => (
                  <button
                    key={m.kind}
                    type="button"
                    className="obs-kind-btn"
                    onClick={() => setView({ kind: 'form', observationKind: m.kind })}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <section className="rl-group obs-recent">
                <h4 className="rl-section-heading">
                  <span>Recent</span>
                </h4>
                <ObservationList observations={observations ?? []} queuedIds={queuedIds} />
              </section>
            </>
          )}

          {view.kind === 'blank-sit' && (
            <BlankSitQuickLog
              waypoint={initialWaypoint}
              location={here.location}
              locationSource={here.source}
              locating={here.locating}
              windFromDeg={windFromDeg}
              onSetWind={onSetWind}
              submitting={create.isPending}
              submitError={create.isError ? 'Could not save — try again.' : null}
              onCancel={() => setView({ kind: 'home' })}
              onSubmit={(input) => {
                create.mutate({ ...input, propertyId }, { onSuccess: () => setView({ kind: 'home' }) });
              }}
            />
          )}

          {view.kind === 'form' && (
            <ObservationForm
              waypoints={waypoints ?? []}
              waypoint={initialWaypoint}
              location={here.location}
              locationSource={here.source}
              locating={here.locating}
              windFromDeg={windFromDeg}
              onSetWind={onSetWind}
              initialKind={view.observationKind}
              submitting={create.isPending}
              submitError={create.isError ? 'Could not save — check the fields above and try again.' : null}
              onCancel={() => setView({ kind: 'home' })}
              onSubmit={(input) => {
                create.mutate({ ...input, propertyId }, { onSuccess: () => setView({ kind: 'home' }) });
              }}
            />
          )}
        </>
      )}
    </Sheet>
  );
}
