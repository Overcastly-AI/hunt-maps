import { Link, useNavigate, useParams } from 'react-router-dom';
import { useState } from 'react';
import { Button, Callout, Chip, Field, SectionHeading } from '@hunt-maps/design';
import { useAuth, useDeleteProperty, useProperty, useUpdateProperty } from '../../lib/api';
import type { GeoPolygon } from '@hunt-maps/shared';
import type { PropertyDetailDto, WireSpecies } from '../../lib/api/types';
import { SPECIES_LABEL } from '../observations/meta';
import { PropertyBoundaryPreview } from './PropertyBoundaryPreview';
import { describePropertiesError, formatArea, formatRut } from './propertyFormat';

/** `PropertyDetailDto.boundary` is typed as `GeoPolygon | Record<string, unknown> | null` — see its own doc comment for the MultiPolygon gap. Only a real `Polygon` has a preview and an edit flow today. */
function asPolygon(boundary: GeoPolygon | Record<string, unknown> | null): GeoPolygon | null {
  return boundary && (boundary as { type?: string }).type === 'Polygon'
    ? (boundary as GeoPolygon)
    : null;
}

/**
 * One property — its boundary, its rut reading, who has access, and the
 * doors into redrawing the boundary or deleting the property.
 */
export function PropertyDetailScreen() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: property, error, isLoading } = useProperty(id);
  const deleteProperty = useDeleteProperty();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (isLoading && !property) {
    return (
      <div className="property-screen">
        <PropertyDetailHeader title="Loading…" />
        <div className="property-screen__body">
          <p className="rl-hint">Loading this property…</p>
        </div>
      </div>
    );
  }

  if (!property) {
    const info = error
      ? describePropertiesError(error)
      : { tone: 'danger' as const, message: 'This property could not be loaded.' };
    return (
      <div className="property-screen">
        <PropertyDetailHeader title="Property" />
        <div className="property-screen__body">
          <Callout tone={info.tone} role="alert">
            <p>{info.message}</p>
          </Callout>
          <Link to="/properties" className="rl-btn rl-btn--ghost">
            Back to your properties
          </Link>
        </div>
      </div>
    );
  }

  const myMembership = property.memberships.find((m) => m.user.id === user?.id);
  const canEdit = myMembership?.role === 'OWNER' || myMembership?.role === 'MANAGER';
  const canDelete = myMembership?.role === 'OWNER';
  const rut = formatRut(property.rut);
  const boundary = asPolygon(property.boundary);

  async function handleDelete() {
    // Re-checked rather than relying on the narrowing above: TypeScript does
    // not carry a `const`'s narrowed type across a nested function-
    // declaration boundary, and this closure only ever runs after the
    // component has already rendered past the `!property` early return, so
    // this can never actually be null in practice.
    if (!property) return;
    setDeleteError(null);
    try {
      await deleteProperty.mutateAsync(property.id);
      navigate('/properties', { replace: true });
    } catch (err) {
      setDeleteError(describePropertiesError(err).message);
    }
  }

  return (
    <div className="property-screen">
      <PropertyDetailHeader title={property.name} />

      <div className="property-screen__body">
        {error && (
          <Callout tone="warn" role="status">
            <p>Showing what was last loaded — could not refresh just now.</p>
          </Callout>
        )}

        <section className="property-detail__hero">
          <PropertyBoundaryPreview boundary={boundary} size={120} />
          <dl className="readout property-detail__facts">
            <dt>Area</dt>
            <dd>{formatArea(property.areaHectares)}</dd>
            {property.centerLat !== null && property.centerLng !== null && (
              <>
                <dt>Centre</dt>
                <dd>
                  {property.centerLat.toFixed(4)}, {property.centerLng.toFixed(4)}
                </dd>
              </>
            )}
            <dt>Timezone</dt>
            <dd>{property.timezone}</dd>
          </dl>
        </section>

        {property.description && (
          <p className="property-detail__description">{property.description}</p>
        )}

        <TargetSpeciesField property={property} canEdit={canEdit} />

        {rut && rut.supported && (
          <section className="rl-group">
            <SectionHeading>Rut phase</SectionHeading>
            <p className="property-detail__rut-phase">{rut.phase}</p>
            <Chip tone={rut.confidence.tone}>{rut.confidence.label}</Chip>
            <p className="rl-hint">{rut.note}</p>
          </section>
        )}

        {/*
          R83's refusal, rendered rather than silently dropped (`docs/EVIDENCE.md`
          Pass 7): a stated non-whitetail species gets an explicit "no model",
          never a phase borrowed from whitetail photoperiod. `rut.reason` is
          `RutUnsupported.reason` verbatim — written to be safe to surface
          directly, per its own doc comment in `packages/shared/src/rut.ts`.
        */}
        {rut && !rut.supported && (
          <section className="rl-group">
            <SectionHeading>Rut phase</SectionHeading>
            <Callout tone="warn" role="status">
              <p>{rut.headline}</p>
              <p className="rl-hint">{rut.reason}</p>
            </Callout>
          </section>
        )}

        <section className="rl-group">
          <SectionHeading>Terrain analytics</SectionHeading>
          {property.terrainProfile ? (
            <p className="rl-hint">
              Computed from a {property.terrainProfile.cellSizeM} m DEM — mean slope{' '}
              {property.terrainProfile.meanSlopeDeg.toFixed(1)}°,{' '}
              {(property.terrainProfile.benchShare * 100).toFixed(0)}% bench.
            </p>
          ) : (
            <Callout tone="warn" role="status">
              <p>
                Not computed yet. This fills in once the terrain engine has processed this
                property's boundary — every selection analytic (BACKLOG's use-vs-availability rule)
                needs it as the denominator, so charts stay hidden rather than guess at it.
              </p>
            </Callout>
          )}
        </section>

        {!boundary && (
          <Callout tone="warn" role="status">
            <p>No boundary saved on this property yet.</p>
          </Callout>
        )}

        <section className="rl-group property-detail__actions">
          {canEdit && (
            <Link to={`/properties/${property.id}/boundary`} className="rl-btn rl-btn--primary">
              {boundary ? 'Edit boundary' : 'Draw boundary'}
            </Link>
          )}
          {!canEdit && (
            <p className="rl-hint">
              You have {roleLabel(myMembership?.role)} access — ask an owner or manager to change
              the boundary.
            </p>
          )}
        </section>

        <section className="rl-group">
          <SectionHeading>Who has access</SectionHeading>
          <ul className="property-members">
            {property.memberships.map((m) => (
              <li key={m.user.id} className="property-members__row">
                <span>{m.user.displayName}</span>
                <Chip tone="neutral">{roleLabel(m.role)}</Chip>
              </li>
            ))}
          </ul>
        </section>

        {canDelete && (
          <section className="rl-group">
            {deleteError && (
              <Callout tone="danger" role="alert">
                <p>{deleteError}</p>
              </Callout>
            )}
            {confirmDelete ? (
              <div className="property-detail__actions">
                <Button
                  variant="danger"
                  disabled={deleteProperty.isPending}
                  onClick={() => void handleDelete()}
                >
                  Delete property for good
                </Button>
                <Button variant="link" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </Button>
              </div>
            ) : (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete this property
              </Button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * The R83 control the rut refusal and R84/R85's layer greying both depend
 * on — `Property.targetSpecies` was nullable and stated (`93a29ca`,
 * `20260811000000_property_target_species`) but had no way for a hunter to
 * actually set it, which left the field unreachable and the elk refusal with
 * nowhere to be triggered from except a database edit. "Not stated" is kept
 * as a real, selectable, un-nagged option here — a hunter who has not yet
 * decided what they are chasing on a piece of ground is not making a
 * mistake, and CLAUDE.md is explicit that a missing input gets said out
 * loud, not treated as a validation error.
 *
 * Once a species is stated it cannot be reset to "Not stated" through this
 * screen — `UpdatePropertyDto` has no path back (see the comment on
 * `PropertiesService.update` in `apps/api/src/properties/properties.module.ts`),
 * so the option is removed from the list entirely rather than offered and
 * silently doing nothing.
 */
function TargetSpeciesField({
  property,
  canEdit,
}: {
  property: PropertyDetailDto;
  canEdit: boolean;
}) {
  const updateProperty = useUpdateProperty(property.id);
  const [saveError, setSaveError] = useState<string | null>(null);
  const current = property.targetSpecies;

  async function handleChange(value: string) {
    if (value === '') return;
    setSaveError(null);
    try {
      await updateProperty.mutateAsync({ targetSpecies: value as WireSpecies });
    } catch (err) {
      setSaveError(describePropertiesError(err).message);
    }
  }

  return (
    <section className="rl-group">
      <SectionHeading hint="Drives the rut section below, and (once set) the bedding and corridor layers on the map">
        Target species
      </SectionHeading>
      <p className="rl-hint">
        Every biological model on this map — the rut calendar most of all — is fitted to one
        species, not a generic "deer". Stating yours here is what lets those sections tell you
        honestly whether they apply to your hunt, instead of quietly assuming whitetail.
      </p>
      {canEdit ? (
        <>
          <Field id="target-species" label="Species">
            <select
              id="target-species"
              className="rl-input"
              value={current ?? ''}
              disabled={updateProperty.isPending}
              onChange={(e) => void handleChange(e.target.value)}
            >
              {current === null && <option value="">Not stated</option>}
              {Object.entries(SPECIES_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          {current === null && (
            <p className="rl-hint">
              You can leave this unset for now — but once you pick a species here it cannot be
              changed back to "Not stated" on this screen.
            </p>
          )}
          {saveError && (
            <Callout tone="danger" role="alert">
              <p>{saveError}</p>
            </Callout>
          )}
        </>
      ) : (
        <p className="rl-hint">{current ? SPECIES_LABEL[current] : 'Not stated.'}</p>
      )}
    </section>
  );
}

function PropertyDetailHeader({ title }: { title: string }) {
  return (
    <header className="property-screen__head">
      <div>
        <Link to="/properties" className="property-screen__back">
          ← Your ground
        </Link>
        <h1 className="property-screen__title">{title}</h1>
      </div>
    </header>
  );
}

function roleLabel(role: string | undefined): string {
  switch (role) {
    case 'OWNER':
      return 'Owner';
    case 'MANAGER':
      return 'Manager';
    case 'HUNTER':
      return 'Hunter';
    case 'OBSERVER':
      return 'Observer';
    default:
      return 'No';
  }
}
