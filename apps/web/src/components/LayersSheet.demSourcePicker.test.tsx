/**
 * The DEM source picker inside `LayersSheet` — CLAUDE.md's fourth
 * non-negotiable applied to this specific control: a picker that renders and
 * cannot be tapped, or that lets a hunter turn on "1 m LiDAR" over ground it
 * does not cover, is the exact failure class this repo has a suite for.
 *
 * `LayersSheet.test.tsx` (BACKLOG R61) already covers the `Confidence`-chip
 * wiring with `renderToStaticMarkup`; this file needs real interaction
 * (clicking a row, confirming a switch) and follows
 * `observations/BlankSitQuickLog.test.tsx`'s `createRoot` + `act` pattern for
 * that reason, matching this repo's stated posture of having no
 * `@testing-library/react` dependency.
 *
 * What this file proves — DOM structure, disabled state, click wiring — and
 * what it does not — real hit-testing, overlap, computed contrast, whether an
 * ancestor's `overflow: hidden` clips the confirmation callout — are
 * deliberately different, per `CLAUDE.md`'s "assert against rendered state,
 * not DOM state". The geometry class of assertion belongs in
 * `apps/web/e2e/ui-invariants.spec.ts` against a real Chromium instance; this
 * is the fast, CI-resident net for behaviour and copy.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LayersSheet } from './LayersSheet';
import { LAYERS } from '../lib/layers';
import { DEM_SOURCE, getDemSourceOverride, setDemSourceOverride } from '../lib/map/demSource';
import type { DemSourceCoverageState } from '../lib/map/demSourceCoverage';
import { reloadApp } from '../lib/reloadApp';

// `window.location.reload` cannot be intercepted directly in jsdom — see
// `lib/reloadApp.ts`'s own doc comment — so the picker's "confirm" action is
// verified through this module boundary instead.
vi.mock('../lib/reloadApp', () => ({ reloadApp: vi.fn() }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  setDemSourceOverride(null);
  vi.restoreAllMocks();
});

function click(el: Element) {
  act(() => {
    (el as HTMLElement).click();
  });
}

function renderPicker(demCoverage: DemSourceCoverageState) {
  return mount(
    <LayersSheet
      active={new Set(LAYERS.map((l) => l.id))}
      opacities={{}}
      windFromDeg={315}
      savedFilters={[]}
      coverage={null}
      demCoverage={demCoverage}
      onToggle={() => undefined}
      onOpacity={() => undefined}
      onToggleFilter={() => undefined}
      onClose={() => undefined}
      onNewFilter={() => undefined}
      onEditFilter={() => undefined}
    />,
  );
}

describe('LayersSheet — elevation source picker', () => {
  it('renders one row per registered DEM source, with the active one checked', () => {
    const el = renderPicker({ kind: 'checking' });
    // This test suite runs with no `VITE_DEM_SOURCE`, so terrarium is active.
    expect(DEM_SOURCE.id).toBe('terrarium');
    const terrariumCheckbox = el.querySelector<HTMLInputElement>('#dem-source-terrarium');
    const oneMeterCheckbox = el.querySelector<HTMLInputElement>('#dem-source-usgs3dep-1m');
    expect(terrariumCheckbox?.checked).toBe(true);
    expect(oneMeterCheckbox?.checked).toBe(false);
  });

  it('never claims 1 m coverage while the answer is still "checking"', () => {
    // The row must neither say it covers this ground nor say it does not —
    // CLAUDE.md's "say when you do not know" applied to a control, not just a
    // layer. A checking answer is not a "no".
    const el = renderPicker({ kind: 'checking' });
    const oneMeterCheckbox = el.querySelector<HTMLInputElement>('#dem-source-usgs3dep-1m');
    expect(oneMeterCheckbox?.disabled).toBe(false);
    expect(el.textContent).not.toContain('No 1 m data here');
  });

  it('disables the 1 m row and says so, on a definite "not covered here"', () => {
    const el = renderPicker({
      kind: 'result',
      result: {
        lng: -110,
        lat: 45,
        oneMeter: { available: false, project: null, elevationMeters: null, utmZone: null },
        recommendedSource: 'usgs3dep-13',
        resolutionNote: '~10 m bare-earth DEM, zoom 15 max — not LiDAR',
      },
    });
    const oneMeterCheckbox = el.querySelector<HTMLInputElement>('#dem-source-usgs3dep-1m');
    expect(oneMeterCheckbox?.disabled).toBe(true);
    expect(el.textContent).toContain('No 1 m data here');
  });

  it('a disabled row cannot be tapped into a pending switch — the block is real, not cosmetic', () => {
    const el = renderPicker({
      kind: 'result',
      result: {
        lng: -110,
        lat: 45,
        oneMeter: { available: false, project: null, elevationMeters: null, utmZone: null },
        recommendedSource: 'usgs3dep-13',
        resolutionNote: '~10 m bare-earth DEM, zoom 15 max — not LiDAR',
      },
    });
    click(el.querySelector('#dem-source-usgs3dep-1m')!);
    // A native `disabled` checkbox does not fire `onChange` on click, in a
    // real browser or in jsdom — this pins that the row actually relies on
    // that rather than only *looking* blocked (CLAUDE.md's "assert against
    // rendered state" cuts both ways: a control that looks disabled but still
    // responds to input is the same failure class as one that looks fine and
    // is not clickable).
    expect(el.textContent).not.toContain('This reloads the map');
    expect(getDemSourceOverride()).toBeNull();
  });

  it('names the acquisition project once coverage is confirmed available', () => {
    const el = renderPicker({
      kind: 'result',
      result: {
        lng: -110,
        lat: 45,
        oneMeter: {
          available: true,
          project: 'MT_TobaccoRoot_2020',
          elevationMeters: 2143.2,
          utmZone: 12,
        },
        recommendedSource: 'usgs3dep-1m',
        resolutionNote: '1 m bare-earth LiDAR, zoom 17 max — partial US coverage',
      },
    });
    const oneMeterCheckbox = el.querySelector<HTMLInputElement>('#dem-source-usgs3dep-1m');
    expect(oneMeterCheckbox?.disabled).toBe(false);
    expect(el.textContent).toContain('MT_TobaccoRoot_2020');
  });

  it('an "unavailable" (could not reach the server) answer neither blocks nor claims coverage', () => {
    const el = renderPicker({ kind: 'unavailable', reason: 'network' });
    const oneMeterCheckbox = el.querySelector<HTMLInputElement>('#dem-source-usgs3dep-1m');
    expect(oneMeterCheckbox?.disabled).toBe(false);
    expect(el.textContent).not.toContain('No 1 m data here');
  });

  it('tapping a different, unblocked source asks for confirmation before doing anything irreversible', () => {
    const el = renderPicker({ kind: 'checking' });
    expect(getDemSourceOverride()).toBeNull();
    expect(el.textContent).not.toContain('This reloads the map');

    click(el.querySelector('#dem-source-usgs3dep-13')!);

    expect(el.textContent).toContain('This reloads the map');
    // Nothing committed yet — the whole point of asking first.
    expect(getDemSourceOverride()).toBeNull();
  });

  it('warns that offline regions do not carry over between sources, before the switch', () => {
    const el = renderPicker({ kind: 'checking' });
    click(el.querySelector('#dem-source-usgs3dep-13')!);
    expect(el.textContent).toMatch(/download this area again/i);
  });

  it('Cancel dismisses the confirmation and changes nothing', () => {
    const el = renderPicker({ kind: 'checking' });
    click(el.querySelector('#dem-source-usgs3dep-13')!);
    expect(el.textContent).toContain('This reloads the map');

    const cancel = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent === 'Cancel',
    );
    expect(cancel).toBeDefined();
    click(cancel!);

    expect(el.textContent).not.toContain('This reloads the map');
    expect(getDemSourceOverride()).toBeNull();
  });

  it('confirming persists the override and reloads', () => {
    const el = renderPicker({ kind: 'checking' });
    click(el.querySelector('#dem-source-usgs3dep-13')!);

    const confirm = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent === 'Switch and reload',
    );
    expect(confirm).toBeDefined();
    click(confirm!);

    expect(getDemSourceOverride()).toBe('usgs3dep-13');
    expect(reloadApp).toHaveBeenCalledTimes(1);
  });

  it('tapping the already-active source is a no-op — no confirmation, nothing written', () => {
    const el = renderPicker({ kind: 'checking' });
    click(el.querySelector(`#dem-source-${DEM_SOURCE.id}`)!);
    expect(el.textContent).not.toContain('This reloads the map');
    expect(getDemSourceOverride()).toBeNull();
  });
});
