import { describe, expect, it, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TerrainReadout } from './TerrainReadout';
import type { HeightTileLoader } from '../lib/map/pointQuery';
import { DEM_TILE_SIZE } from '../lib/map/demTiles';
import { layerById } from '../lib/layers';

// React 18's `act` only suppresses its "not wrapped in act" warnings when it
// can see this flag — normally set by a testing-library environment, which
// this repo does not depend on (see the file's own doc comment for why).
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Mounted with `react-dom/client` + `act` rather than a testing-library
 * render — this repo has no `@testing-library/react` dependency, and this
 * component is async and stateful (it fetches on tap), which
 * `renderToStaticMarkup` (the pattern `LayersSheet.test.tsx` uses) cannot
 * exercise: SSR never runs `useEffect`, so it can only ever see the initial
 * `'loading'` render.
 *
 * What this file asserts (DOM text/class/structure) and what it does not
 * (real geometry — hit-testing, overlap, computed contrast, touch-target
 * size, the pointer-drag interaction) are deliberately different: jsdom has
 * no layout engine, so `getBoundingClientRect`/`elementFromPoint` are not
 * trustworthy here — see `CLAUDE.md`'s "assert against rendered state, not
 * DOM state". That class of assertion was run against a real Chromium
 * instance instead (see this task's report for the harness and results);
 * this file is the fast, CI-resident regression net for content and
 * structure.
 */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(ui: JSX.Element) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(ui);
  });
  return container;
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
});

/** Flush the microtask queue so a resolved loader's `.then()` chain lands before assertions run. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function planeLoader(gradePerPixel: number): HeightTileLoader {
  return async (tile) => {
    const heights = new Float32Array(DEM_TILE_SIZE * DEM_TILE_SIZE);
    for (let y = 0; y < DEM_TILE_SIZE; y++) {
      for (let x = 0; x < DEM_TILE_SIZE; x++) {
        const gx = tile.x * DEM_TILE_SIZE + x;
        heights[y * DEM_TILE_SIZE + x] = 500 + gx * gradePerPixel;
      }
    }
    return heights;
  };
}

function voidLoader(): HeightTileLoader {
  return async () => new Float32Array(DEM_TILE_SIZE * DEM_TILE_SIZE).fill(-32768);
}

function missingLoader(): HeightTileLoader {
  return async () => null;
}

const POINT = { lng: -82.54, lat: 39.43 };

describe('TerrainReadout — mounting and the peek/expanded content model', () => {
  it('renders nothing when there is no tapped point', () => {
    const el = mount(
      <TerrainReadout point={null} windFromDeg={315} atUtc={new Date()} onClose={() => {}} loadHeights={planeLoader(0.2)} />,
    );
    expect(el.textContent).toBe('');
  });

  it('shows a loading state immediately, before the query resolves', async () => {
    const el = mount(
      <TerrainReadout point={POINT} windFromDeg={315} atUtc={new Date()} onClose={() => {}} loadHeights={planeLoader(0.2)} />,
    );
    expect(el.textContent).toContain('Reading terrain');
    // Drain the pending resolution inside `act` rather than letting it land
    // after the test (and its `afterEach` unmount) has already moved on.
    await flush();
  });

  it('renders the fact line with real figures once resolved, and no evidence chip on it', async () => {
    const el = mount(
      <TerrainReadout point={POINT} windFromDeg={315} atUtc={new Date()} onClose={() => {}} loadHeights={planeLoader(0.2)} />,
    );
    await flush();
    const facts = el.querySelector('[data-testid="readout-facts"]');
    expect(facts?.textContent).toMatch(/ft/);
    expect(facts?.textContent).toMatch(/Slope \d/);
    // The grade rule: measured geometry carries no `Confidence` chip.
    expect(facts?.textContent).not.toMatch(/Assumption|Measured|Inferred|Doctrine/);
  });

  it('expands to show the Wood feature and the graded bedding judgement only on tap', async () => {
    const el = mount(
      <TerrainReadout point={POINT} windFromDeg={315} atUtc={new Date()} onClose={() => {}} loadHeights={planeLoader(0.2)} />,
    );
    await flush();
    expect(el.querySelector('.rl-readout__body')).toBeNull();

    const expandButton = Array.from(el.querySelectorAll('button')).find((b) =>
      /show bedding likelihood/i.test(b.getAttribute('aria-label') ?? ''),
    );
    expect(expandButton).toBeTruthy();
    act(() => {
      expandButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const body = el.querySelector('.rl-readout__body');
    expect(body).not.toBeNull();
    expect(body?.textContent).toMatch(/Feature/);
    // The one graded value in the whole panel.
    expect(body?.textContent).toMatch(/Assumption/);
    expect(layerById('bedding')?.grade).toBe('assumed');
  });

  it('never renders bedding as a number when no wind is set — asks for one instead', async () => {
    const el = mount(
      <TerrainReadout point={POINT} windFromDeg={null} atUtc={new Date()} onClose={() => {}} loadHeights={planeLoader(0.2)} />,
    );
    await flush();
    const expandButton = Array.from(el.querySelectorAll('button')).find((b) =>
      /show bedding likelihood/i.test(b.getAttribute('aria-label') ?? ''),
    );
    act(() => {
      expandButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const body = el.querySelector('.rl-readout__body');
    expect(body?.textContent).toMatch(/Set a wind direction/i);
    expect(body?.textContent).not.toMatch(/%/);
  });

  it('renders a DEM void as "not measured here" on every fact, never a number', async () => {
    const el = mount(
      <TerrainReadout point={POINT} windFromDeg={315} atUtc={new Date()} onClose={() => {}} loadHeights={voidLoader()} />,
    );
    await flush();
    const facts = el.querySelector('[data-testid="readout-facts"]');
    expect(facts?.textContent).toMatch(/not measured here/);
    expect(facts?.textContent).not.toMatch(/\d/);
    const unmeasured = el.querySelectorAll('.rl-readout__unmeasured');
    expect(unmeasured.length).toBeGreaterThan(0);
  });

  it('reports an explicit "never saved for offline use" message when the tile was never downloaded', async () => {
    const el = mount(
      <TerrainReadout point={POINT} windFromDeg={315} atUtc={new Date()} onClose={() => {}} loadHeights={missingLoader()} />,
    );
    await flush();
    expect(el.textContent).toMatch(/never saved for offline use/i);
  });

  it('calls onClose from the close control', async () => {
    let closed = false;
    const el = mount(
      <TerrainReadout
        point={POINT}
        windFromDeg={315}
        atUtc={new Date()}
        onClose={() => {
          closed = true;
        }}
        loadHeights={planeLoader(0.2)}
      />,
    );
    await flush();
    const closeButton = Array.from(el.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === 'Close terrain readout',
    );
    act(() => {
      closeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(closed).toBe(true);
  });

  it('resets to the peek detent on a fresh tap, even while expanded', async () => {
    let point = POINT;
    const el = mount(
      <TerrainReadout point={point} windFromDeg={315} atUtc={new Date()} onClose={() => {}} loadHeights={planeLoader(0.2)} />,
    );
    await flush();
    const expandButton = () =>
      Array.from(el.querySelectorAll('button')).find((b) =>
        /(show bedding likelihood|show fewer details)/i.test(b.getAttribute('aria-label') ?? ''),
      )!;
    act(() => expandButton().dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(el.querySelector('.rl-readout__body')).not.toBeNull();

    // A new point — same component instance, new coordinates.
    point = { lng: -82.55, lat: 39.44 };
    act(() => {
      root!.render(
        <TerrainReadout point={point} windFromDeg={315} atUtc={new Date()} onClose={() => {}} loadHeights={planeLoader(0.2)} />,
      );
    });
    expect(el.querySelector('.rl-readout__body')).toBeNull();
    await flush();
    expect(el.querySelector('.rl-readout__body')).toBeNull();
  });
});
