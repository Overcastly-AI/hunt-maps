import { afterEach, describe, expect, it } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GroupPredicate } from '@hunt-maps/terrain';
import { GroupNode } from './PredicateNode';
import { emptyGroup } from './predicateUtils';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** A tiny controlled-component harness — owns the predicate state exactly the way `FilterEditor`'s own `useState` + `setPredicate` does in the app. */
function Harness({ initial, windFromDeg }: { initial: GroupPredicate; windFromDeg: number | null }) {
  const [value, setValue] = useState(initial);
  return <GroupNode value={value} onChange={setValue} windFromDeg={windFromDeg} depth={0} />;
}

function mount(value: GroupPredicate, windFromDeg: number | null = 315) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<Harness initial={value} windFromDeg={windFromDeg} />);
  });
  return { get container() { return container!; } };
}

function click(el: Element | null) {
  if (!el) throw new Error('element not found');
  act(() => {
    (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
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

describe('GroupNode — an empty group', () => {
  it('says there is nothing to match yet, at the root', () => {
    const { container } = mount(emptyGroup('all'));
    expect(container.textContent).toContain('Add at least one condition below');
  });

  it('offers a button for every addable leaf kind', () => {
    const { container } = mount(emptyGroup('all'));
    const labels = ['+ Terrain value', '+ Facing', '+ Landform', '+ Feature', '+ Bench', '+ Group'];
    for (const label of labels) {
      expect(container.textContent).toContain(label);
    }
  });
});

describe('GroupNode — adding a condition', () => {
  it('adding "+ Terrain value" renders a metric picker and a band slider', () => {
    const { container } = mount(emptyGroup('all'));
    const addButton = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === '+ Terrain value',
    );
    click(addButton ?? null);

    expect(container.querySelector('.rl-filter-node__select')).not.toBeNull();
    expect(container.querySelectorAll('.rl-filter-band__input')).toHaveLength(2);
  });
});

describe('GroupNode — negation, BACKLOG R56', () => {
  it('is not shown by default for a plain condition', () => {
    const { container } = mount({
      kind: 'all',
      operands: [{ kind: 'bench', isBench: true }],
    });
    expect(container.textContent).not.toContain('Negating a condition is unreliable');
  });

  it('shows the R56 warning, in the same screen, the moment "Not" is checked', () => {
    const { container } = mount({
      kind: 'all',
      operands: [{ kind: 'bench', isBench: true }],
    });
    const negateCheckbox = container.querySelector('.rl-filter-row__negate input') as HTMLInputElement;
    expect(negateCheckbox).not.toBeNull();
    click(negateCheckbox);

    expect(container.textContent).toContain('Negating a condition is unreliable at the edge');
    // Written reason, not a tooltip — the text must actually be in the DOM,
    // not just in a `title` attribute a gloved thumb will never hover.
    const callout = container.querySelector('.rl-callout--warn');
    expect(callout?.textContent).toContain('unmeasurable cell as a match');
  });
});

describe('GroupNode — landform/feature pickers never offer "Unknown"', () => {
  it('Landform checklist has no Unknown option', () => {
    const { container } = mount({ kind: 'all', operands: [{ kind: 'weiss', classes: [] }] });
    expect(container.textContent).not.toContain('Unknown');
  });

  it('Feature checklist has no "Not measurable" option', () => {
    const { container } = mount({ kind: 'all', operands: [{ kind: 'wood', features: [] }] });
    expect(container.textContent).not.toContain('Not measurable');
  });
});

describe('GroupNode — a wind-dependent metric with no wind set', () => {
  it('greys out with a stated reason rather than silently evaluating against a default', () => {
    const { container } = mount(
      { kind: 'all', operands: [{ kind: 'range', metric: 'bedding', min: 0, max: 0.1 }] },
      null,
    );
    expect(container.textContent).toContain('needs a wind direction to mean anything');
  });

  it('says nothing extra once a wind direction is set', () => {
    const { container } = mount(
      { kind: 'all', operands: [{ kind: 'range', metric: 'bedding', min: 0, max: 0.1 }] },
      45,
    );
    expect(container.textContent).not.toContain('needs a wind direction to mean anything');
  });
});
