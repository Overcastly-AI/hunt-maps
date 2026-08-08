import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BlankSitQuickLog } from './BlankSitQuickLog';
import type { WaypointDto } from '../../lib/api/types';

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
});

function click(el: Element) {
  act(() => {
    (el as HTMLElement).click();
  });
}

const HERE = { lng: -82.5, lat: 39.4 };

describe('BlankSitQuickLog — the fast path (R5)', () => {
  it('submits kind SIT, isBlankSit true, count 0, with no required fields beyond location', () => {
    const onSubmit = vi.fn();
    const el = mount(
      <BlankSitQuickLog
        location={HERE}
        locationSource="gps"
        locating={false}
        windFromDeg={225}
        submitting={false}
        submitError={null}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const save = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Save blank sit')!;
    click(save);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const input = onSubmit.mock.calls[0][0];
    expect(input.kind).toBe('SIT');
    expect(input.isBlankSit).toBe(true);
    expect(input.count).toBe(0);
    expect(input.location).toEqual({ type: 'Point', coordinates: [HERE.lng, HERE.lat] });
    expect(input.windFromDeg).toBe(225);
    expect(typeof input.moonPhase).toBe('number');
  });

  it('is disabled while there is no location and no waypoint context', () => {
    const el = mount(
      <BlankSitQuickLog
        location={null}
        locationSource="none"
        locating={false}
        windFromDeg={null}
        submitting={false}
        submitError={null}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    const save = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Save blank sit') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('uses the waypoint’s own location when logging "here" at a stand', () => {
    const onSubmit = vi.fn();
    const waypoint = { id: 'w1', name: 'Stand 3', location: { type: 'Point', coordinates: [-83, 40] } } as WaypointDto;
    const el = mount(
      <BlankSitQuickLog
        waypoint={waypoint}
        location={null}
        locationSource="none"
        locating={false}
        windFromDeg={null}
        submitting={false}
        submitError={null}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    expect(el.textContent).toContain('Stand 3');
    const save = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Save blank sit')!;
    click(save);
    const input = onSubmit.mock.calls[0][0];
    expect(input.location).toEqual({ type: 'Point', coordinates: [-83, 40] });
    expect(input.waypointId).toBe('w1');
  });
});
