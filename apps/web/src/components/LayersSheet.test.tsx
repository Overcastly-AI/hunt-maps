import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LayersSheet } from './LayersSheet';
import { LAYERS } from '../lib/layers';

/**
 * BACKLOG R61 — the regression gate the adoption plan asks for.
 *
 * `Confidence` shipped with zero real usages the first time, because nothing
 * enforced that a layer carrying a `grade` actually rendered one, or that a
 * layer without one never did. `lib/layers.test.ts` covers the data
 * (`LayerDefinition.grade`); this covers the render — a future layer with a
 * `grade` set and a broken wire-up to `ToggleRow`'s `children` slot should
 * fail here, not ship silently ungraded.
 */
function renderSheet(active: Set<string>, windFromDeg: number | null): string {
  return renderToStaticMarkup(
    <LayersSheet
      active={active}
      opacities={{}}
      windFromDeg={windFromDeg}
      savedFilters={[]}
      coverage={null}
      onToggle={() => undefined}
      onOpacity={() => undefined}
      onToggleFilter={() => undefined}
      onClose={() => undefined}
      onNewFilter={() => undefined}
      onEditFilter={() => undefined}
    />,
  );
}

describe('LayersSheet — Confidence adoption (BACKLOG R61)', () => {
  it('renders exactly one Confidence chip once every layer is active, and it sits on the bedding row', () => {
    const active = new Set(LAYERS.map((l) => l.id));
    const html = renderSheet(active, 315);

    const gradedIds = LAYERS.filter((l) => l.grade).map((l) => l.id);
    expect(gradedIds).toEqual(['bedding']);

    // `Confidence`'s label for the `assumed` grade — see
    // `packages/design/src/components/primitives.tsx`. One occurrence per
    // graded layer; today that is exactly one.
    const occurrences = html.split('Assumption').length - 1;
    expect(occurrences).toBe(gradedIds.length);

    const beddingIndex = html.indexOf('Bedding likelihood');
    const chipIndex = html.indexOf('Assumption');
    expect(beddingIndex).toBeGreaterThan(-1);
    expect(chipIndex).toBeGreaterThan(beddingIndex);
  });

  it('never renders a Confidence chip for an ungraded layer, even when active', () => {
    const active = new Set(LAYERS.filter((l) => l.id !== 'bedding').map((l) => l.id));
    const html = renderSheet(active, 315);
    expect(html).not.toContain('Assumption');
  });

  it('does not render the bedding Confidence chip while bedding is blocked on a missing wind', () => {
    // `ToggleRow` only renders `children` when `checked && !blocked` — a
    // disabled row is not "the active bedding layer" the chip is meant to
    // sit next to, and rendering it there would contradict the disabled
    // state (a confidence grade for a layer that is not even running).
    const active = new Set(['bedding']);
    const html = renderSheet(active, null);
    expect(html).not.toContain('Assumption');
  });
});
