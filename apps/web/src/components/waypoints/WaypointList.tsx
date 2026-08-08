/**
 * The waypoint list — one row per stand/camera/marker on the property.
 *
 * Grouped by type rather than a flat alphabetical list: a hunter opening this
 * mid-scout is usually thinking "where are my stands", not "where is the
 * thing named exactly this" — grouping answers the question they actually
 * have.
 */

import { Chip } from '@hunt-maps/design';
import type { WaypointDto } from '../../lib/api/types';
import { WAYPOINT_TYPE_META, waypointTypeMeta } from './meta';

export interface WaypointListProps {
  waypoints: WaypointDto[];
  queuedIds: Set<string>;
  onSelect: (waypoint: WaypointDto) => void;
}

export function WaypointList({ waypoints, queuedIds, onSelect }: WaypointListProps) {
  if (waypoints.length === 0) {
    return (
      <p className="rl-hint">
        No waypoints yet. Mark your stands, cameras and access points and they show up here — every one carries a
        location that works with no signal.
      </p>
    );
  }

  const groups = WAYPOINT_TYPE_META.map((meta) => ({
    meta,
    items: waypoints.filter((w) => w.type === meta.type && !w.archived),
  })).filter((g) => g.items.length > 0);

  const archived = waypoints.filter((w) => w.archived);

  return (
    <div className="wp-list">
      {groups.map((g) => (
        <section key={g.meta.type} className="rl-group">
          <h4 className="rl-section-heading">
            <span>
              {g.meta.label}
              {g.items.length > 1 ? 's' : ''}
            </span>
          </h4>
          <ul className="wp-list__items">
            {g.items.map((w) => (
              <WaypointRow key={w.id} waypoint={w} queued={queuedIds.has(w.id)} onSelect={onSelect} />
            ))}
          </ul>
        </section>
      ))}

      {archived.length > 0 && (
        <section className="rl-group">
          <h4 className="rl-section-heading">
            <span>Archived</span>
          </h4>
          <ul className="wp-list__items">
            {archived.map((w) => (
              <WaypointRow key={w.id} waypoint={w} queued={queuedIds.has(w.id)} onSelect={onSelect} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function WaypointRow({
  waypoint,
  queued,
  onSelect,
}: {
  waypoint: WaypointDto;
  queued: boolean;
  onSelect: (w: WaypointDto) => void;
}) {
  return (
    <li>
      <button type="button" className="wp-row" onClick={() => onSelect(waypoint)}>
        <span className="wp-row__name">{waypoint.name}</span>
        {queued && (
          <Chip tone="info" glyph="◐" title="Saved on this device — will sync once you have signal.">
            Queued
          </Chip>
        )}
        {waypoint.archived && <Chip tone="neutral">Archived</Chip>}
      </button>
    </li>
  );
}

/** Short label used by pickers elsewhere ("Log at this stand") — kept here since it reads the same metadata table. */
export function waypointTypeLabel(waypoint: WaypointDto): string {
  return waypointTypeMeta(waypoint.type).label;
}
