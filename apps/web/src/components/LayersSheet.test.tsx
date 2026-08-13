import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LayersSheet } from './LayersSheet';
import { LAYERS } from '../lib/layers';
import type { WireSpecies } from '../lib/api/types';

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
function renderSheet(
  active: Set<string>,
  windFromDeg: number | null,
  targetSpecies?: WireSpecies | null,
): string {
  return renderToStaticMarkup(
    <LayersSheet
      active={active}
      opacities={{}}
      windFromDeg={windFromDeg}
      targetSpecies={targetSpecies}
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

/**
 * R84 (`docs/EVIDENCE.md` Pass 7 §2) — the bedding likelihood layer must
 * grey out with a stated, specific reason for a property whose stated
 * `targetSpecies` is not whitetail, exactly as it already does for a
 * missing wind direction. This is asserted against rendered markup
 * (checkbox `disabled`), not just data — the same posture CLAUDE.md's
 * fourth non-negotiable requires everywhere else in this suite.
 */
describe('LayersSheet — species-invalid layers grey out (R84)', () => {
  it('leaves bedding enabled with wind set and no species stated ("not stated" must not be treated as elk)', () => {
    const html = renderSheet(new Set(), 315, null);
    const row = extractToggleRow(html, 'layer-bedding');
    expect(row).not.toContain('disabled=""');
  });

  it('leaves bedding enabled with wind set and a stated whitetail property', () => {
    const html = renderSheet(new Set(), 315, 'WHITETAIL');
    const row = extractToggleRow(html, 'layer-bedding');
    expect(row).not.toContain('disabled=""');
  });

  it('blocks bedding for a stated elk property even with wind set, and names the actual finding', () => {
    const html = renderSheet(new Set(), 315, 'ELK');
    const row = extractToggleRow(html, 'layer-bedding');
    expect(row).toContain('disabled=""');
    expect(row).toContain('Millspaugh');
    // Never dressed as a graded assumption — this is an absence, not an
    // estimate (see `LayerDefinition.speciesCaveat`'s own doc comment).
    expect(row).not.toContain('Assumption');
  });

  it('blocks bedding for every other non-whitetail species, not just elk', () => {
    const nonWhitetail: WireSpecies[] = [
      'MULE_DEER',
      'BLACKTAIL',
      'MOOSE',
      'PRONGHORN',
      'BEAR',
      'TURKEY',
      'HOG',
      'OTHER',
    ];
    for (const species of nonWhitetail) {
      const html = renderSheet(new Set(), 315, species);
      const row = extractToggleRow(html, 'layer-bedding');
      expect(row, species).toContain('disabled=""');
    }
  });

  it('never blocks a layer with no species caveat, regardless of species', () => {
    const html = renderSheet(new Set(), 315, 'ELK');
    const row = extractToggleRow(html, 'layer-weiss');
    expect(row).not.toContain('disabled=""');
  });

  it('the species reason takes priority over — and replaces — the wind-missing reason', () => {
    const html = renderSheet(new Set(), null, 'ELK');
    const row = extractToggleRow(html, 'layer-bedding');
    expect(row).toContain('Millspaugh');
    expect(row).not.toContain('Set a wind direction first');
  });
});

/**
 * Isolates one layer `ToggleRow`'s markup by its checkbox `id`, for
 * assertions scoped to a single row (`disabled` on the input, the
 * `blockedReason` text in the sibling blurb paragraph).
 *
 * Slices *forward* from the checkbox's own `<input id="…">` to the next
 * row's `<input id="layer-…">` rather than trying to find the row's opening
 * `<div>` — every attribute this test cares about (`disabled`, the blurb
 * text) renders *after* the input's `id` in `ToggleRow`'s JSX, in source
 * order. Matching `<input id="layer-` specifically (not just `id="layer-`)
 * matters: the row's own description paragraph carries `id="layer-X-desc"`,
 * which also starts with `id="layer-` and would otherwise be mistaken for
 * the *next* row, truncating this one before its own blurb text.
 */
function extractToggleRow(html: string, id: string): string {
  const marker = `<input id="${id}"`;
  const start = html.indexOf(marker);
  if (start === -1) throw new Error(`row "${id}" not found in rendered markup`);
  const nextRowStart = html.indexOf('<input id="layer-', start + marker.length);
  return html.slice(start, nextRowStart === -1 ? html.length : nextRowStart);
}
