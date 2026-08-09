import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FilterEditor } from './FilterEditor';
import { mapColor } from '@hunt-maps/design';
import type { SavedFilterDto } from '../../lib/api/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(ui: JSX.Element) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  act(() => {
    root!.render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
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

function saveButton(el: HTMLElement): HTMLButtonElement {
  const btn = [...el.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Save filter'),
  );
  if (!btn) throw new Error('Save button not found');
  return btn as HTMLButtonElement;
}

describe('FilterEditor — a blank new filter', () => {
  it('Save is disabled with no name and no condition, and states the (first) reason', () => {
    const el = mount(
      <FilterEditor
        windFromDeg={null}
        atUtc={new Date()}
        viewport={null}
        onClose={() => undefined}
      />,
    );
    expect(saveButton(el).disabled).toBe(true);
    // Name is checked first — the reason shown is the name, and the group's
    // own "nothing to match yet" hint is still visible in the tree above it.
    expect(el.textContent).toContain('Name this filter before saving.');
    expect(el.textContent).toContain('an empty filter has nothing to match');
  });

  it('Save stays disabled on an empty condition tree even once a name is given', () => {
    const el = mount(
      <FilterEditor
        windFromDeg={null}
        atUtc={new Date()}
        viewport={null}
        onClose={() => undefined}
      />,
    );
    const nameInput = el.querySelector('#filter-name') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    act(() => {
      setter.call(nameInput, 'My filter');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(saveButton(el).disabled).toBe(true);
    expect(el.textContent).toContain('Add at least one condition before saving.');
  });

  it('never renders a Confidence-style implication for measured geometry — the editor has no evidence grading UI at all today', () => {
    // A light guard against scope creep in the other direction: this editor
    // must not start inventing evidence chips for slope/aspect/landform,
    // which `docs/design/PLAN-direction-a.md` §d explicitly reserves for
    // modelled parameters only.
    const el = mount(
      <FilterEditor
        windFromDeg={null}
        atUtc={new Date()}
        viewport={null}
        onClose={() => undefined}
      />,
    );
    expect(el.textContent).not.toContain('Measured');
    expect(el.textContent).not.toContain('Assumption');
  });
});

describe('FilterEditor — a saved filter with a predicate that fails validation', () => {
  it('refuses to render the untrusted predicate into an editable tree, and says so', () => {
    const corrupt: SavedFilterDto = {
      id: 'f1',
      ownerId: 'u1',
      propertyId: null,
      name: 'Suspicious import',
      description: null,
      // `kind: 'eval'` is not a real predicate kind — `validatePredicate`
      // must reject it.
      predicate: { kind: 'eval', code: 'process.exit(1)' },
      color: mapColor['feature-bench'],
      opacity: 0.5,
      outline: true,
      sharedPublicly: true,
      isPreset: false,
      clientId: null,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const el = mount(
      <FilterEditor
        initial={corrupt}
        windFromDeg={null}
        atUtc={new Date()}
        viewport={null}
        onClose={() => undefined}
      />,
    );
    expect(el.textContent).toContain('did not pass validation and was not loaded');
    // Starts from an empty group, not a half-rendered guess at the bad shape.
    expect(el.textContent).toContain('Add at least one condition');
  });
});

describe('FilterEditor — starting from a preset', () => {
  it('pre-fills the name, colour and predicate from the seed', () => {
    const el = mount(
      <FilterEditor
        seed={{
          name: 'Sidehill walkable grade (copy)',
          description: 'The 8–20° band deer contour along.',
          predicate: { kind: 'range', metric: 'slope', min: 8, max: 20 },
          color: mapColor['feature-saddle'],
          opacity: 0.4,
        }}
        windFromDeg={null}
        atUtc={new Date()}
        viewport={null}
        onClose={() => undefined}
      />,
    );
    const nameInput = el.querySelector('#filter-name') as HTMLInputElement;
    expect(nameInput.value).toBe('Sidehill walkable grade (copy)');
    // A real condition already exists, so only the (still-empty-name — no,
    // name is filled) — Save should be enabled once name + condition exist.
    expect(saveButton(el).disabled).toBe(false);
  });
});
