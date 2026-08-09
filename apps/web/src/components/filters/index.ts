/**
 * The saved-filter visual editor (`docs/BACKLOG.md` `R2`).
 *
 * Owns `apps/web/src/components/filters/**` end to end: the recursive
 * predicate tree editor, the dual-range band slider, the live match-share
 * readout, and the "new filter" preset picker. Deliberately does **not**
 * touch `App.tsx`, `LayersSheet.tsx`, `main.tsx` or `packages/terrain` — see
 * the mounting instructions below for exactly what the integrating change
 * needs to do in those files.
 *
 * ## Mounting instructions (one screen's worth of wiring, in `App.tsx`)
 *
 * 1. **Add a third state to the single-panel-at-a-time drawer slot.**
 *    `App.tsx` already tracks `sheetOpen`/`pickerOpen` as two booleans with
 *    the comment "One panel at a time in the drawer slot" — replace them (or
 *    add alongside) with room for a `filterEditorTarget: 'new' | SavedFilterDto | null`
 *    state, and render:
 *    ```tsx
 *    {filterEditorTarget === 'new' && (
 *      <FilterLibrary
 *        propertyId={propertyId}
 *        windFromDeg={windFromDeg}
 *        atUtc={atUtc}
 *        viewport={view ? { bounds: view.bounds, zoom: view.zoom } : null}
 *        onClose={() => setFilterEditorTarget(null)}
 *        onSaved={(f) => { /* merge into your filters list, see step 3 *\/ }}
 *      />
 *    )}
 *    {filterEditorTarget && filterEditorTarget !== 'new' && (
 *      <FilterEditor
 *        initial={filterEditorTarget}
 *        propertyId={propertyId}
 *        windFromDeg={windFromDeg}
 *        atUtc={atUtc}
 *        viewport={view ? { bounds: view.bounds, zoom: view.zoom } : null}
 *        onClose={() => setFilterEditorTarget(null)}
 *        onSaved={(f) => { /* merge, see step 3 *\/ }}
 *        onDeleted={(id) => { /* remove from your filters list *\/ }}
 *      />
 *    )}
 *    ```
 *    Setting `filterEditorTarget` must clear `sheetOpen`/`pickerOpen` the
 *    same way toggling between Layers/Offline already does — two `.rl-sheet`s
 *    stacked in that slot overlap exactly (the `elementFromPoint` trap this
 *    repo has already paid for once).
 *
 * 2. **Wire the trigger.** `LayersSheet.tsx`'s "New filter" button
 *    (`Button variant="link" onClick={() => undefined}`, a deliberate stub)
 *    becomes `onClick={onNewFilter}`, threaded down from `App.tsx` as
 *    `() => setFilterEditorTarget('new')`. Editing an *existing* saved filter
 *    needs a small addition to each `ToggleRow` in that same section — an
 *    "Edit" `Button variant="link"` next to the swatch, calling
 *    `onEditFilter(filter.id)` → `setFilterEditorTarget(fullDto)`. That is a
 *    `LayersSheet.tsx` change, outside this territory.
 *
 * 3. **Replace the hard-coded `filters` state with the real API.**
 *    `App.tsx` currently seeds `filters` from `PRESET_FILTERS` directly into
 *    local `useState` — nothing persists, and every reload forgets which
 *    presets were toggled on. Swap that for `useSavedFilters(propertyId)`
 *    (the user's real, persisted library) merged with `useFilterPresets()`
 *    (read-only, `isPreset: true`, never edited/deleted — `FilterEditor`
 *    already refuses to show Delete for a preset). `onSaved`/`onDeleted`
 *    above should call `queryClient.invalidateQueries` — already automatic,
 *    since `useCreateFilter`/`useUpdateFilter`/`useDeleteFilter`
 *    (`lib/api/filters.ts`) invalidate `queryKeys.filters.all` themselves.
 *    Local `enabled`/toggle state (which filters are currently painted on the
 *    map) stays separate client state exactly as `active`/`opacities` already
 *    are for layers — the API has no notion of "currently visible."
 *
 * 4. **The live match share needs the current map viewport.** `App.tsx`
 *    already has this in its `view` state (`view?.bounds`/`view?.zoom`, used
 *    by `RegionPicker` today) — pass it straight through, `null` while the
 *    map has not settled on a view yet. Nothing new to compute.
 *
 * None of the above requires a `packages/terrain` change. If the AST turns
 * out to need one during integration (it should not — every predicate this
 * editor builds validates against the existing `validatePredicate`), stop and
 * file it as a blocker with a proposal rather than editing the engine
 * directly, per this task's territory rules.
 */

export { FilterEditor, type FilterEditorProps, type FilterEditorSeed } from './FilterEditor';
export { FilterLibrary, type FilterLibraryProps } from './FilterLibrary';
export { MatchShare } from './MatchShare';
export { useLiveMatchShare, type MatchShareState, type LiveMatchShareOptions } from './useLiveMatchShare';
export { DualRangeSlider, type DualRangeSliderProps } from './DualRangeSlider';
export { GroupNode } from './PredicateNode';
export { RANGE_METRICS, metricDef, type MetricDef } from './metricRegistry';
export { WEISS_OPTIONS, WOOD_OPTIONS, type EnumOption } from './landformOptions';
export * from './predicateUtils';

import './filters.css';
