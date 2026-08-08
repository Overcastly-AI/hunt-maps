import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DualRangeSlider } from './DualRangeSlider';

/**
 * Structural/content regression net — see `TerrainReadout.test.tsx`'s own
 * doc comment for why this repo uses `renderToStaticMarkup` here rather than
 * a testing-library render: this component has no async state, so SSR sees
 * everything a mount would. What this file cannot exercise — real drag
 * geometry, thumb hit-testing when two overlap, the 28px rendered height —
 * needs a real browser; see this task's report for that pass.
 */

function render(valueMin: number, valueMax: number) {
  return renderToStaticMarkup(
    <DualRangeSlider
      label="Slope angle"
      min={0}
      max={60}
      step={1}
      decimals={0}
      unit="°"
      valueMin={valueMin}
      valueMax={valueMax}
      onChange={() => undefined}
    />,
  );
}

describe('DualRangeSlider', () => {
  it('renders exactly two native range inputs and two number inputs — no custom pointer handling to race', () => {
    const html = render(8, 20);
    const rangeCount = html.split('type="range"').length - 1;
    const numberCount = html.split('type="number"').length - 1;
    expect(rangeCount).toBe(2);
    expect(numberCount).toBe(2);
    // Never a plain onClick on the slider track/thumbs — see the module's
    // own doc comment on why this avoids the pointerup/synthetic-click race.
    expect(html).not.toContain('onclick');
  });

  it('labels each thumb distinctly for a screen reader', () => {
    const html = render(8, 20);
    expect(html).toContain('Slope angle — minimum');
    expect(html).toContain('Slope angle — maximum');
  });

  it('shows the current band in the header, in display units', () => {
    const html = render(8, 20);
    expect(html).toContain('8°');
    expect(html).toContain('20°');
  });

  it('brings the max thumb to the front when the band sits in the lower half of the range', () => {
    const html = render(2, 5); // both well below the 0..60 midpoint of 30
    // The max input is declared second in the DOM; its z-index should be the
    // higher of the two so it stays reachable when both values are close.
    const zIndices = [...html.matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(zIndices).toHaveLength(2);
    const [minZ, maxZ] = zIndices;
    expect(maxZ).toBeGreaterThan(minZ);
  });

  it('brings the min thumb to the front when the band sits in the upper half of the range', () => {
    const html = render(50, 58);
    const zIndices = [...html.matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1]));
    const [minZ, maxZ] = zIndices;
    expect(minZ).toBeGreaterThan(maxZ);
  });
});
