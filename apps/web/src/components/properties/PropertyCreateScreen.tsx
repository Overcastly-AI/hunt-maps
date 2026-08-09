import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Callout, Field } from '@hunt-maps/design';
import { useCreateProperty } from '../../lib/api';
import { BoundaryEditor, type BoundaryEditorSnapshot } from './BoundaryEditor';
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
  'You are offline. Creating a property is not queued for later like a stand or a sighting — ' +
  '`PropertiesService.create` also has to validate the boundary against the server and stamp a ' +
  'starting terrain profile, so it needs a live connection right now. Reconnect, then draw — ' +
  'nothing here is saved until you press Save, so there is nothing to lose by waiting.';

/**
 * Draw a new property, then name and save it (BACKLOG R1's primary door).
 *
 * ## Why this is one screen with a growing panel, not a two-page wizard
 *
 * The "name it and save" step appears inside `BoundaryEditor`'s own toolbar
 * (its `footer` slot) once the ring closes, rather than as a second route or
 * a floating panel over the map. A second overlay stacked on the boundary
 * toolbar is exactly the collision class `App.tsx`'s R42 fix exists to
 * prevent — this screen would otherwise risk reintroducing it the moment
 * mobile viewport arithmetic disagrees between two independently-built
 * panels. One panel that grows keeps Undo and Start-over reachable the
 * entire time, including after the name/description form appears.
 *
 * ## Why creation is gated on `navigator.onLine` before drawing starts
 *
 * `useCreateProperty` does not queue offline (BACKLOG R68, deliberate — see
 * `lib/api/properties.ts`'s own doc comment). Letting a hunter spend minutes
 * placing corners and only discovering the save cannot happen at the very
 * end is the specific failure `CLAUDE.md` calls the worst this product can
 * commit: "losing a region the user waited twenty minutes for... is the
 * worst failure this product has." Saying so up front, before a single point
 * is placed, is cheap; recovering a lost boundary is not possible at all.
 */
export function PropertyCreateScreen() {
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const createProperty = useCreateProperty();
  const [snapshot, setSnapshot] = useState<BoundaryEditorSnapshot>(EMPTY_SNAPSHOT);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const nameId = useId();
  const descriptionId = useId();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!snapshot.polygon) return;
    setSubmitError(null);
    try {
      const created = await createProperty.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        boundary: snapshot.polygon,
      });
      navigate(`/properties/${created.id}`, { replace: true });
    } catch (err) {
      // `PropertiesService.create` runs `validateExtent` server-side and
      // rejects a boundary that fails it (out-of-range coordinates, or over
      // the 200,000 ha ceiling) with a `BadRequestException` naming exactly
      // why. `describePropertiesError` passes a `validation`-kind message
      // through verbatim rather than replacing it with a generic failure —
      // the brief for this screen is explicit that the server's reason must
      // reach the user, not get swallowed behind "something went wrong".
      setSubmitError(describePropertiesError(err).message);
    }
  }

  return (
    <div className="property-screen property-screen--map">
      <header className="property-screen__head">
        <div>
          <Link to="/properties" className="property-screen__back">
            ← Your ground
          </Link>
          <h1 className="property-screen__title">Draw a new property</h1>
        </div>
      </header>

      <BoundaryEditor
        disabled={!online}
        disabledReason={online ? undefined : OFFLINE_REASON}
        onChange={setSnapshot}
        footer={
          snapshot.closed && snapshot.polygon ? (
            <form className="boundary-editor__save-form" onSubmit={(e) => void handleSubmit(e)}>
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
              <Field id={nameId} label="Property name">
                <input
                  id={nameId}
                  className="rl-input"
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Home 80, Grandpa's back forty"
                  autoFocus
                />
              </Field>
              <Field id={descriptionId} label="Notes (optional)">
                <textarea
                  id={descriptionId}
                  className="rl-input boundary-editor__description"
                  maxLength={2000}
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Access notes, who else hunts it, whatever helps later"
                />
              </Field>
              <Button
                type="submit"
                variant="primary"
                block
                disabled={!online || !name.trim() || createProperty.isPending}
              >
                {createProperty.isPending ? 'Saving…' : 'Save property'}
              </Button>
            </form>
          ) : null
        }
      />
    </div>
  );
}
