/**
 * "New filter" — pick a starting point, then land in `FilterEditor`.
 *
 * This is the piece `LayersSheet`'s existing "New filter" button
 * (`onClick={() => undefined}`, a deliberate stub) should open — see this
 * package's `index.ts` for the exact wiring. Two starting points, both
 * doubling as documentation the way `PRESET_FILTERS` already does for the
 * API: **start from a preset** (a working example to tune rather than a
 * blank page) or **start blank**. Editing an *existing* saved filter is a
 * separate flow — mount `FilterEditor` directly with `initial={filterDto}` —
 * because that case never needs this picker.
 */

import { useState } from 'react';
import { Button, Sheet } from '@hunt-maps/design';
import type { BBox } from '@hunt-maps/terrain';
import { useFilterPresets } from '../../lib/api/filters';
import type { SavedFilterDto } from '../../lib/api/types';
import { FilterEditor, type FilterEditorSeed } from './FilterEditor';
import { emptyGroup, parseStoredPredicate } from './predicateUtils';

export interface FilterLibraryProps {
  propertyId?: string;
  windFromDeg: number | null;
  atUtc: Date;
  viewport: { bounds: BBox; zoom: number } | null;
  demSource?: string;
  onClose: () => void;
  onSaved?: (filter: SavedFilterDto) => void;
}

export function FilterLibrary({
  propertyId,
  windFromDeg,
  atUtc,
  viewport,
  demSource,
  onClose,
  onSaved,
}: FilterLibraryProps) {
  const presets = useFilterPresets();
  const [seed, setSeed] = useState<FilterEditorSeed | 'blank' | null>(null);

  if (seed !== null) {
    return (
      <FilterEditor
        seed={seed === 'blank' ? undefined : seed}
        propertyId={propertyId}
        windFromDeg={windFromDeg}
        atUtc={atUtc}
        viewport={viewport}
        demSource={demSource}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  }

  return (
    <Sheet title="New filter" onClose={onClose}>
      <p className="rl-hint">
        A saved filter is your own named terrain query — "12–25°, facing north through east, on a
        bench" — that travels with you offline and can be handed to the corridor solver later.
        Start from one of the built-in filters below, or build from scratch.
      </p>

      <Button variant="primary" block onClick={() => setSeed('blank')}>
        Start blank
      </Button>

      <h3 className="rl-section-heading" style={{ marginTop: 'var(--space-4)' }}>
        <span>Start from a preset</span>
      </h3>

      {presets.isLoading && <p className="rl-hint">Loading presets…</p>}
      {presets.isError && (
        <p className="rl-hint">
          Could not load the built-in presets right now — "Start blank" above still works with no
          connection.
        </p>
      )}

      <ul className="rl-filter-library__list">
        {(presets.data ?? []).map((p) => (
          <li key={p.name} className="rl-filter-library__item">
            <div className="rl-filter-library__item-head">
              <span className="rl-swatch" style={{ background: p.color }} aria-hidden="true" />
              <span className="rl-filter-library__item-name">{p.name}</span>
            </div>
            {p.description && <p className="rl-hint">{p.description}</p>}
            <Button
              variant="ghost"
              onClick={() =>
                setSeed({
                  name: `${p.name} (copy)`,
                  description: p.description ?? undefined,
                  // Presets are served over the same wire every other filter
                  // is — validate rather than trust, exactly like a saved or
                  // imported filter (`predicateUtils.ts`'s doc comment).
                  predicate: parseStoredPredicate(p.predicate) ?? emptyGroup('all'),
                  color: p.color,
                  opacity: p.opacity,
                  outline: p.outline,
                })
              }
            >
              Use as starting point
            </Button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
