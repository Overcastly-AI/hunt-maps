/**
 * The waypoints panel (`R3`) — list, create (type-aware), and per-stand
 * detail with the wind check, in one `Sheet` occupying the same drawer slot
 * `LayersSheet`/`RegionPicker` already use.
 *
 * Mounting contract: see `index.ts`'s header comment for the one line this
 * needs in `App.tsx`.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Callout, Sheet } from '@hunt-maps/design';
import {
  useAuth,
  useCreateWaypoint,
  useDeleteWaypoint,
  useUpdateWaypoint,
  useWaypoints,
  type WaypointDto,
} from '../../lib/api';
import { useQueuedIds } from './offlineStatus';
import { useHereLocation, type HereLocation } from './useHereLocation';
import { WaypointForm } from './WaypointForm';
import { WaypointList } from './WaypointList';
import { WaypointDetail } from './WaypointDetail';
import { waypointTypeMeta } from './meta';
import type { WireWaypointType } from '../../lib/api/types';

type View =
  | { kind: 'list' }
  | { kind: 'new'; initialType?: WireWaypointType }
  | { kind: 'detail'; id: string }
  | { kind: 'edit'; id: string };

export interface WaypointsSheetProps {
  propertyId: string;
  /** The map's current centre (or last tapped point) — used only if GPS is unavailable. See `useHereLocation`. */
  fallbackLocation?: HereLocation | null;
  windFromDeg: number | null;
  atUtc: Date;
  onClose: () => void;
  /** Opens the conditions bar's wind editor — surfaced from a wind-check row with no wind set. */
  onSetWind?: () => void;
  onLogSighting?: (waypoint: WaypointDto) => void;
  onLogBlankSit?: (waypoint: WaypointDto) => void;
  /** Opens directly on a specific stand rather than the list — e.g. tapping a marker on the map. */
  openWaypointId?: string;
}

export function WaypointsSheet({
  propertyId,
  fallbackLocation,
  windFromDeg,
  atUtc,
  onClose,
  onSetWind,
  onLogSighting,
  onLogBlankSit,
  openWaypointId,
}: WaypointsSheetProps) {
  const { status } = useAuth();
  const [view, setView] = useState<View>(
    openWaypointId ? { kind: 'detail', id: openWaypointId } : { kind: 'list' },
  );
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { data: waypoints, isLoading, isError } = useWaypoints(propertyId);
  const queuedIds = useQueuedIds('waypoint.create');
  const create = useCreateWaypoint(propertyId);
  const update = useUpdateWaypoint(propertyId);
  const remove = useDeleteWaypoint(propertyId);

  const here = useHereLocation(fallbackLocation);

  const current = useMemo(
    () => (view.kind === 'detail' || view.kind === 'edit' ? waypoints?.find((w) => w.id === view.id) ?? null : null),
    [waypoints, view],
  );

  const title =
    view.kind === 'list'
      ? 'Stands & markers'
      : view.kind === 'new'
        ? 'New waypoint'
        : view.kind === 'edit'
          ? `Edit ${current ? waypointTypeMeta(current.type).label.toLowerCase() : ''}`
          : (current?.name ?? 'Waypoint');

  return (
    <Sheet
      title={title}
      onClose={onClose}
      action={
        view.kind === 'list' ? (
          <Button variant="link" onClick={() => setView({ kind: 'new' })}>
            + New
          </Button>
        ) : view.kind !== 'new' ? (
          // `variant="ghost"`, not `"link"`: `.rl-btn--link` has no
          // `min-width`, and "Back" is short enough that its own text alone
          // measured 42px wide — a real gloved-tap floor miss, the same
          // shape of defect `.auth-card__switch a` was fixed for elsewhere.
          // Out of this pass's territory to fix in `packages/design` itself
          // (see the handoff report); `ghost`'s horizontal padding clears
          // the floor for any label this short.
          <Button variant="ghost" onClick={() => setView({ kind: 'list' })}>
            Back
          </Button>
        ) : undefined
      }
    >
      {status === 'unauthenticated' && (
        <Callout tone="info">
          <p>
            <Link to="/login">Sign in</Link> to log stands, cameras and markers — they sync across your devices and
            travel with you offline once you have.
          </p>
        </Callout>
      )}

      {status === 'authenticated' && (
        <>
          {view.kind === 'list' && (
            <>
              {isLoading && <p className="rl-hint">Loading…</p>}
              {isError && <p className="rl-hint">Could not load waypoints. Showing what is cached, if anything.</p>}
              <WaypointList
                waypoints={waypoints ?? []}
                queuedIds={queuedIds}
                onSelect={(w) => setView({ kind: 'detail', id: w.id })}
              />
            </>
          )}

          {view.kind === 'new' && (
            <WaypointForm
              propertyId={propertyId}
              existingWaypoints={waypoints ?? []}
              location={here.location}
              locationSource={here.source}
              locating={here.locating}
              submitting={create.isPending}
              submitError={create.isError ? 'Could not save — check the fields above and try again.' : null}
              initialType={view.initialType}
              onCancel={() => setView({ kind: 'list' })}
              onSubmitCreate={(input) => {
                create.mutate(
                  { ...input, propertyId },
                  { onSuccess: (w) => setView({ kind: 'detail', id: w.id }) },
                );
              }}
            />
          )}

          {view.kind === 'edit' && current && (
            <WaypointForm
              propertyId={propertyId}
              existingWaypoints={waypoints ?? []}
              location={here.location}
              locationSource={here.source}
              locating={here.locating}
              submitting={update.isPending}
              submitError={update.isError ? 'Could not save changes — try again.' : null}
              editing={current}
              onCancel={() => setView({ kind: 'detail', id: current.id })}
              onSubmitCreate={() => undefined}
              onSubmitUpdate={(input) => {
                update.mutate(
                  { id: current.id, input },
                  { onSuccess: () => setView({ kind: 'detail', id: current.id }) },
                );
              }}
            />
          )}

          {view.kind === 'detail' && (
            <>
              {!current && !isLoading && <p className="rl-hint">This waypoint could not be found.</p>}
              {current && (
                <WaypointDetail
                  waypoint={current}
                  queued={queuedIds.has(current.id)}
                  windFromDeg={windFromDeg}
                  atUtc={atUtc}
                  onSetWind={onSetWind}
                  onEdit={() => setView({ kind: 'edit', id: current.id })}
                  onToggleArchive={() =>
                    update.mutate({ id: current.id, input: { archived: !current.archived, baseVersion: current.version } })
                  }
                  busy={update.isPending || remove.isPending}
                  deleteConfirming={deleteConfirmId === current.id}
                  onRequestDelete={() => setDeleteConfirmId(current.id)}
                  onCancelDelete={() => setDeleteConfirmId(null)}
                  onDelete={() =>
                    remove.mutate(current.id, {
                      onSuccess: () => {
                        setDeleteConfirmId(null);
                        setView({ kind: 'list' });
                      },
                    })
                  }
                  onLogSighting={onLogSighting}
                  onLogBlankSit={onLogBlankSit}
                />
              )}
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
