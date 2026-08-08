import { Link } from 'react-router-dom';
import { Callout, Chip } from '@hunt-maps/design';
import { useProperties } from '../../lib/api';
import type { PropertySummaryDto } from '../../lib/api/types';
import { describePropertiesError, formatArea, formatRut } from './propertyFormat';
import { useOnlineStatus } from './useOnlineStatus';

/**
 * "Your ground" — the list of properties a signed-in hunter belongs to, and
 * the door into drawing a new one (BACKLOG R1).
 *
 * Renders from `data` and treats `error` as an annotation rather than a
 * reason to blank the page, per `lib/api/properties.ts`'s own doc comment —
 * a property list fetched this morning should still be here tonight at camp
 * even if the background refresh has nothing to say.
 */
export function PropertiesListScreen() {
  const { data, error, isLoading } = useProperties();
  const online = useOnlineStatus();

  const errorInfo = error ? describePropertiesError(error) : null;
  const showFullPageError = Boolean(error) && data === undefined;

  return (
    <div className="property-screen">
      <header className="property-screen__head">
        <div>
          <p className="rl-eyebrow">Ridgeline</p>
          <h1 className="property-screen__title">Your ground</h1>
        </div>
        <Link to="/properties/new" className="rl-btn rl-btn--primary">
          Draw a new property
        </Link>
      </header>

      <div className="property-screen__body">
        {!online && (
          <Callout tone="warn" role="status">
            <p>
              You are offline. Existing properties below are what was last loaded — drawing a new
              one needs a live connection, which the next screen will explain before you start.
            </p>
          </Callout>
        )}

        {errorInfo && (
          <Callout tone={errorInfo.tone} role={showFullPageError ? 'alert' : 'status'}>
            <p>{errorInfo.message}</p>
          </Callout>
        )}

        {isLoading && data === undefined && <p className="rl-hint">Loading your properties…</p>}

        {data && data.length === 0 && !isLoading && (
          <div className="property-empty">
            <h2>No ground yet</h2>
            <p className="rl-hint">
              A property is the piece of ground everything else in Ridgeline hangs off — stands,
              sign, saved filters and the terrain analytics all key to its boundary. Draw one to
              get started; it takes a couple of minutes with satellite imagery to trace against.
            </p>
            <Link to="/properties/new" className="rl-btn rl-btn--primary">
              Draw your first property
            </Link>
          </div>
        )}

        {data && data.length > 0 && (
          <ul className="property-list" data-testid="property-list">
            {data.map((property) => (
              <PropertyCard key={property.id} property={property} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PropertyCard({ property }: { property: PropertySummaryDto }) {
  const rut = formatRut(property.rut);
  return (
    <li className="property-card">
      {/*
        No shape preview here — `PropertySummaryDto` (the list endpoint's own
        row shape, `apps/api/src/properties/properties.module.ts`) does not
        carry boundary geometry, only `PropertyDetailDto` does. Fetching the
        full boundary for every row just to draw a thumbnail would turn one
        list request into N, which is the wrong trade for a glance-only
        shape check — the full boundary (and its `PropertyBoundaryPreview`)
        appears once the user opens a property.
      */}
      <Link to={`/properties/${property.id}`} className="property-card__link">
        <div className="property-card__body">
          <span className="property-card__name">{property.name}</span>
          <span className="property-card__meta rl-hint">{formatArea(property.areaHectares)}</span>
          <span className="property-card__meta rl-hint">
            {property._count.waypoints} waypoint{property._count.waypoints === 1 ? '' : 's'} ·{' '}
            {property._count.observations} observation{property._count.observations === 1 ? '' : 's'}
          </span>
          {rut && (
            <span className="property-card__chips">
              <Chip tone="neutral">{rut.phase}</Chip>
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}
