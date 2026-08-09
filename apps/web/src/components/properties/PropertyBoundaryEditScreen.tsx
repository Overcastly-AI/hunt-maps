import { useEffect, useId, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Callout } from '@hunt-maps/design';
import { useProperty, useUpdateProperty } from '../../lib/api';
import type { GeoPolygon } from '@hunt-maps/shared';
import { BoundaryEditor, type BoundaryEditorSnapshot } from './BoundaryEditor';
import { polygonToRing, type LngLat } from '../../lib/map/boundaryDraw';
import { describePropertiesError } from './propertyFormat';
import { useOnlineStatus } from './useOnlineStatus';

const EMPTY_SNAPSHOT: BoundaryEditorSnapshot = {
  ring: [],
  closed: false,
  areaHectares: 0,
  areaAcres: 0,
  problem: null,
  canFinish: false,
  polygon: null,
};

const OFFLINE_REASON =
  'You are offline. Saving a redrawn boundary is not queued for later like a stand or a ' +
  'sighting — reconnect, then save. Your in-progress points stay on screen while you wait; ' +
  'closing this tab before you press Save is the only way to lose them.';

/**
 * Redraw an existing property's boundary.
 *
 * ## The side effect this screen exists to warn about
 *
 * `PropertiesService.update` deletes the property's cached `TerrainProfile`
 * the moment a boundary is included in the request — unconditionally, even
 * if the new ring is pixel-identical to the old one, because the server has
 * no cheap way to know it wasn't changed and a stale profile keyed to the
 * wrong ground is worse than an absent one. That profile is the
 * **availability denominator** behind every selection-ratio chart this
 * product shows (`CLAUDE.md`'s fifth non-negotiable) — losing it does not
 * just blank a number, it silently disables the thing that makes this
 * product's analytics honest until the engine recomputes it. `CLAUDE.md` is
 * explicit that this has to be said "before the user commits the edit," so
 * the warning below is not a footnote: it sits above the map, and Save stays
 * disabled until the user has explicitly acknowledged it via the checkbox
 * next to the button, every time — not just the first time this screen is
 * ever opened.
 */
export function PropertyBoundaryEditScreen() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const { data: property, error, isLoading } = useProperty(id);
  const updateProperty = useUpdateProperty(id);
  const [snapshot, setSnapshot] = useState<BoundaryEditorSnapshot>(EMPTY_SNAPSHOT);
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const ackId = useId();

  const existingBoundary = property ? asPolygon(property.boundary) : null;
  const [initialRing, setInitialRing] = useState<LngLat[] | undefined>(undefined);
  useEffect(() => {
    if (existingBoundary && initialRing === undefined) {
      setInitialRing(polygonToRing(existingBoundary));
    }
  }, [existingBoundary, initialRing]);

  if (isLoading && !property) {
    return (
      <div className="property-screen">
        <BoundaryEditHeader propertyId={id} title="Loading…" />
        <div className="property-screen__body">
          <p className="rl-hint">Loading this property…</p>
        </div>
      </div>
    );
  }

  if (!property) {
    const info = error ? describePropertiesError(error) : { tone: 'danger' as const, message: 'This property could not be loaded.' };
    return (
      <div className="property-screen">
        <BoundaryEditHeader propertyId={id} title="Boundary" />
        <div className="property-screen__body">
          <Callout tone={info.tone} role="alert">
            <p>{info.message}</p>
          </Callout>
        </div>
      </div>
    );
  }

  async function handleSave() {
    if (!snapshot.polygon || !acknowledged) return;
    setSubmitError(null);
    try {
      await updateProperty.mutateAsync({ boundary: snapshot.polygon });
      navigate(`/properties/${id}`, { replace: true });
    } catch (err) {
      setSubmitError(describePropertiesError(err).message);
    }
  }

  const canSave = online && acknowledged && snapshot.closed && Boolean(snapshot.polygon);

  return (
    <div className="property-screen property-screen--map">
      <BoundaryEditHeader propertyId={id} title={`Redraw — ${property.name}`} />

      <Callout tone="warn" role="status">
        <p>
          Redrawing and saving clears this property's cached terrain analytics (mean slope,
          bench share, aspect and slope distribution). Every selection chart on this property
          depends on that profile as its denominator, and it stays hidden — never a stale or
          guessed one — until the engine recomputes it for the new boundary.
        </p>
      </Callout>

      <BoundaryEditor
        initialRing={initialRing}
        showReference={Boolean(existingBoundary)}
        initialCenter={
          property.centerLng !== null && property.centerLat !== null
            ? { lng: property.centerLng, lat: property.centerLat }
            : undefined
        }
        disabled={!online}
        disabledReason={online ? undefined : OFFLINE_REASON}
        onChange={setSnapshot}
        footer={
          snapshot.closed && snapshot.polygon ? (
            <div className="boundary-editor__save-form">
              {!online && (
                <Callout tone="danger" role="alert">
                  <p>{OFFLINE_REASON}</p>
                </Callout>
              )}
              {submitError && (
                <Callout tone="danger" role="alert">
                  <p>{submitError}</p>
                </Callout>
              )}
              <label className="boundary-editor__ack" htmlFor={ackId}>
                <input
                  id={ackId}
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <span>I understand this clears the cached terrain profile for this property.</span>
              </label>
              <Button
                type="button"
                variant="primary"
                block
                disabled={!canSave || updateProperty.isPending}
                onClick={() => void handleSave()}
              >
                {updateProperty.isPending ? 'Saving…' : 'Save boundary'}
              </Button>
            </div>
          ) : null
        }
      />
    </div>
  );
}

function BoundaryEditHeader({ propertyId, title }: { propertyId: string; title: string }) {
  return (
    <header className="property-screen__head">
      <div>
        <Link to={`/properties/${propertyId}`} className="property-screen__back">
          ← Back
        </Link>
        <h1 className="property-screen__title">{title}</h1>
      </div>
    </header>
  );
}

function asPolygon(boundary: GeoPolygon | Record<string, unknown> | null): GeoPolygon | null {
  return boundary && (boundary as { type?: string }).type === 'Polygon' ? (boundary as GeoPolygon) : null;
}
