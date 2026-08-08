/**
 * A single waypoint's detail view: its type-specific facts, the wind check,
 * and the jump into logging an observation *here* — R5's "an observation is
 * usually logged at a stand" made concrete as a two-tap path instead of
 * requiring the hunter to reopen a separate panel and hunt for the same pin.
 */

import { Button, Callout, Chip } from '@hunt-maps/design';
import type { WaypointDto } from '../../lib/api/types';
import { octantFromDeg, waypointTypeMeta } from './meta';
import { WindCheckCard } from './WindCheckCard';

export interface WaypointDetailProps {
  waypoint: WaypointDto;
  queued: boolean;
  windFromDeg: number | null;
  atUtc: Date;
  onSetWind?: () => void;
  onEdit: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
  busy: boolean;
  deleteConfirming: boolean;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  /** Opens the Observations panel pre-filled at this stand. Omitted when the host has not wired the two panels together yet. */
  onLogSighting?: (waypoint: WaypointDto) => void;
  onLogBlankSit?: (waypoint: WaypointDto) => void;
}

export function WaypointDetail({
  waypoint,
  queued,
  windFromDeg,
  atUtc,
  onSetWind,
  onEdit,
  onToggleArchive,
  onDelete,
  busy,
  deleteConfirming,
  onRequestDelete,
  onCancelDelete,
  onLogSighting,
  onLogBlankSit,
}: WaypointDetailProps) {
  const meta = waypointTypeMeta(waypoint.type);
  const showsWindCheck = waypoint.type === 'STAND' || waypoint.type === 'BLIND';

  return (
    <div className="wp-detail">
      <div className="wp-detail__head">
        <span className="rl-eyebrow">{meta.label}</span>
        {queued && (
          <Chip tone="info" glyph="◐" title="Saved on this device — will sync once you have signal.">
            Queued — not yet synced
          </Chip>
        )}
      </div>

      {waypoint.notes && <p className="wp-detail__notes">{waypoint.notes}</p>}

      <dl className="readout wp-detail__facts">
        <dt>Location</dt>
        <dd>
          {waypoint.location.coordinates[1].toFixed(5)}, {waypoint.location.coordinates[0].toFixed(5)}
        </dd>
        {waypoint.elevationM !== null && (
          <>
            <dt>Elevation</dt>
            <dd>{Math.round(waypoint.elevationM)} m</dd>
          </>
        )}
        {waypoint.standHeightM !== null && (
          <>
            <dt>Stand height</dt>
            <dd>{waypoint.standHeightM} m</dd>
          </>
        )}
        {waypoint.cameraDirectionDeg !== null && (
          <>
            <dt>Lens direction</dt>
            <dd>
              {Math.round(waypoint.cameraDirectionDeg)}° {octantFromDeg(waypoint.cameraDirectionDeg)}
            </dd>
          </>
        )}
        {waypoint.shootingLanesDeg.length > 0 && (
          <>
            <dt>Shooting lanes</dt>
            <dd>{waypoint.shootingLanesDeg.map((d) => `${d}°`).join(', ')}</dd>
          </>
        )}
        {waypoint.huntableWinds.length > 0 && (
          <>
            <dt>Hunts clean on</dt>
            <dd>{waypoint.huntableWinds.join(', ')}</dd>
          </>
        )}
        {waypoint.lastCheckedAt && (
          <>
            <dt>Last checked</dt>
            <dd>{new Date(waypoint.lastCheckedAt).toLocaleDateString()}</dd>
          </>
        )}
      </dl>

      {(onLogSighting || onLogBlankSit) && (
        <div className="wp-detail__log-actions">
          {onLogSighting && (
            <Button type="button" variant="primary" block onClick={() => onLogSighting(waypoint)}>
              Log a sighting here
            </Button>
          )}
          {onLogBlankSit && (
            <Button type="button" variant="ghost" block onClick={() => onLogBlankSit(waypoint)}>
              Log a blank sit here
            </Button>
          )}
        </div>
      )}

      {showsWindCheck && (
        <WindCheckCard waypointId={waypoint.id} windFromDeg={windFromDeg} atUtc={atUtc} onSetWind={onSetWind} />
      )}

      <div className="wp-detail__actions">
        <Button type="button" variant="ghost" onClick={onEdit} disabled={busy}>
          Edit
        </Button>
        <Button type="button" variant="ghost" onClick={onToggleArchive} disabled={busy}>
          {waypoint.archived ? 'Unarchive' : 'Archive'}
        </Button>
        {!deleteConfirming ? (
          <Button type="button" variant="danger" onClick={onRequestDelete} disabled={busy}>
            Delete
          </Button>
        ) : null}
      </div>

      {deleteConfirming && (
        <Callout tone="danger" role="alert">
          <p>Delete "{waypoint.name}"? This cannot be undone.</p>
          <div className="wp-detail__confirm-row">
            <Button type="button" variant="ghost" onClick={onCancelDelete} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" variant="danger" onClick={onDelete} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete for good'}
            </Button>
          </div>
        </Callout>
      )}
    </div>
  );
}
