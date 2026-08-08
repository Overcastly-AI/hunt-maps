/**
 * The saved-filter visual editor — the centrepiece `BACKLOG R2` asks for.
 *
 * Turns a `TerrainPredicate` AST into something a hunter builds by tapping
 * bands and checkboxes rather than writing JSON, names and saves it through
 * the same offline-queued mutations every other write in this app uses
 * (`useCreateFilter`/`useUpdateFilter`, `lib/api/filters.ts` — already queued
 * per `CLAUDE.md`'s "every write is queued and idempotent"), and shows a live
 * match share for the view on screen (`useLiveMatchShare.ts`) without ever
 * rendering a number it cannot stand behind.
 */

import { useMemo, useState } from 'react';
import { Button, Callout, Sheet } from '@hunt-maps/design';
import type { BBox, TerrainPredicate, GroupPredicate } from '@hunt-maps/terrain';
import {
  useCreateFilter,
  useDeleteFilter,
  useUpdateFilter,
} from '../../lib/api/filters';
import type { SavedFilterDto } from '../../lib/api/types';
import { GroupNode } from './PredicateNode';
import { FilterMetaFields, isValidHexColor, type FilterMeta } from './FilterMetaFields';
import { MatchShare } from './MatchShare';
import { useLiveMatchShare } from './useLiveMatchShare';
import {
  containsNegation,
  emptyGroup,
  hasAnyCondition,
  isGroup,
  limitViolation,
  parseStoredPredicate,
} from './predicateUtils';

export interface FilterEditorSeed {
  name: string;
  description?: string;
  predicate: TerrainPredicate;
  color: string;
  opacity: number;
  outline?: boolean;
}

export interface FilterEditorProps {
  /** Editing an existing saved filter. Takes priority over `seed`. */
  initial?: SavedFilterDto;
  /** Starting point for a brand-new filter — typically a preset the user picked "start from". */
  seed?: FilterEditorSeed;
  propertyId?: string;
  windFromDeg: number | null;
  atUtc: Date;
  /** Current map viewport — the extent the live match share measures against. `null` if the map has not settled on a view yet. */
  viewport: { bounds: BBox; zoom: number } | null;
  demSource?: string;
  onClose: () => void;
  onSaved?: (filter: SavedFilterDto) => void;
  onDeleted?: (id: string) => void;
}

function normalizeRoot(predicate: TerrainPredicate): GroupPredicate {
  return isGroup(predicate) ? predicate : { kind: 'all', operands: [predicate] };
}

function initialMeta(source?: { name: string; description?: string | null; color: string; opacity: number; outline?: boolean }): FilterMeta {
  return {
    name: source?.name ?? '',
    description: source?.description ?? '',
    color: source?.color ?? '#c9a253',
    opacity: source?.opacity ?? 0.5,
    outline: source?.outline ?? true,
  };
}

export function FilterEditor({
  initial,
  seed,
  propertyId,
  windFromDeg,
  atUtc,
  viewport,
  demSource,
  onClose,
  onSaved,
  onDeleted,
}: FilterEditorProps) {
  const createFilter = useCreateFilter();
  const updateFilter = useUpdateFilter();
  const deleteFilter = useDeleteFilter();

  const startingPredicate = useMemo<GroupPredicate>(() => {
    if (initial) {
      const parsed = parseStoredPredicate(initial.predicate);
      // A predicate that fails validation here is untrusted/corrupt data —
      // never render it into an editable tree; start from an empty group and
      // let the callout below explain why, rather than silently coercing a
      // possibly-hostile payload into something that looks editable.
      return normalizeRoot(parsed ?? emptyGroup('all'));
    }
    if (seed) return normalizeRoot(seed.predicate);
    return emptyGroup('all');
  }, [initial, seed]);

  const invalidStoredPredicate = Boolean(initial) && parseStoredPredicate(initial!.predicate) === null;

  const [predicate, setPredicate] = useState<GroupPredicate>(startingPredicate);
  const [meta, setMeta] = useState<FilterMeta>(() => initialMeta(initial ?? seed));

  const matchShareState = useLiveMatchShare({
    predicate,
    viewport,
    windFromDeg,
    atUtc,
    demSource,
  });

  const nameError = meta.name.trim().length === 0 ? 'Name this filter before saving.' : null;
  const conditionError = hasAnyCondition(predicate) ? null : 'Add at least one condition before saving.';
  const colorError = isValidHexColor(meta.color) ? null : 'Fill colour needs a full 6-digit hex value.';
  const nestingError = limitViolation(predicate);
  const saveBlockedReason = nameError ?? conditionError ?? colorError ?? nestingError;

  const isEditingExisting = Boolean(initial) && !initial?.isPreset;
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (saveBlockedReason) return;
    setSaving(true);
    setSaveError(null);
    try {
      const input = {
        name: meta.name.trim(),
        description: meta.description.trim() || undefined,
        predicate: predicate as unknown as Record<string, unknown>,
        color: meta.color,
        opacity: meta.opacity,
        outline: meta.outline,
        propertyId,
      };
      const saved = isEditingExisting
        ? await updateFilter.mutateAsync({ id: initial!.id, input })
        : await createFilter.mutateAsync(input);
      if (saved) onSaved?.(saved as SavedFilterDto);
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save this filter.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!isEditingExisting || !initial) return;
    setSaving(true);
    try {
      await deleteFilter.mutateAsync(initial.id);
      onDeleted?.(initial.id);
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not delete this filter.');
    } finally {
      setSaving(false);
    }
  }

  const hasNegation = containsNegation(predicate);

  return (
    <Sheet
      title={isEditingExisting ? 'Edit filter' : 'New filter'}
      onClose={onClose}
    >
      <p className="rl-hint">
        A saved filter is a terrain query you name and keep — "12–25°, facing north through east,
        on a bench" — and it travels with you offline, exactly like every other layer here.
      </p>

      {invalidStoredPredicate && (
        <Callout tone="warn">
          <p>
            The saved predicate for this filter did not pass validation and was not loaded — it may
            have been corrupted, or shared from a source this app does not trust. Starting from an
            empty filter instead; saving will replace whatever was stored.
          </p>
        </Callout>
      )}

      <FilterMetaFields value={meta} onChange={setMeta} />

      <section className="rl-group">
        <h3 className="rl-section-heading">
          <span>Conditions</span>
        </h3>
        <GroupNode value={predicate} onChange={setPredicate} windFromDeg={windFromDeg} depth={0} />
      </section>

      <section className="rl-group">
        <h3 className="rl-section-heading">
          <span>Live match share</span>
        </h3>
        <MatchShare state={matchShareState} />
      </section>

      {hasNegation && (
        <p className="rl-hint">
          This filter contains a "Not" condition — see the warning inline above wherever it
          appears. Saving is still allowed; the risk is in how it renders, not in the save itself.
        </p>
      )}

      {saveError && (
        <Callout tone="warn" role="alert">
          <p>{saveError}</p>
        </Callout>
      )}

      <div className="rl-filter-editor__actions">
        {isEditingExisting && (
          <Button variant="danger" onClick={handleDelete} disabled={saving}>
            Delete
          </Button>
        )}
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={saving || Boolean(saveBlockedReason)}
          title={saveBlockedReason ?? undefined}
        >
          {saving ? 'Saving…' : 'Save filter'}
        </Button>
      </div>
      {saveBlockedReason && <p className="rl-hint">{saveBlockedReason}</p>}
    </Sheet>
  );
}
