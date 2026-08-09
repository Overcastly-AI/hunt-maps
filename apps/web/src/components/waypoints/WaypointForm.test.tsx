import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WaypointForm } from './WaypointForm';
import type { WaypointDto } from '../../lib/api/types';

// See `TerrainReadout.test.tsx` for why this flag and this mounting pattern
// (no `@testing-library/react` in this repo).
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

function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function click(el: Element) {
  act(() => {
    (el as HTMLElement).click();
  });
}

const HERE = { lng: -82.5, lat: 39.4 };

function baseProps(overrides: Partial<Parameters<typeof WaypointForm>[0]> = {}) {
  return {
    propertyId: 'prop-1',
    existingWaypoints: [] as WaypointDto[],
    location: HERE,
    locationSource: 'gps' as const,
    locating: false,
    submitting: false,
    submitError: null,
    onCancel: vi.fn(),
    onSubmitCreate: vi.fn(),
    ...overrides,
  };
}

describe('WaypointForm — type-aware fields (R3)', () => {
  it('shows only the type picker until a type is chosen', () => {
    const el = mount(<WaypointForm {...baseProps()} />);
    expect(el.querySelector('#wp-name')).toBeNull();
    expect(el.querySelectorAll('.wp-type-btn').length).toBe(10);
  });

  it('a STAND shows height, shooting lanes and huntable winds; a food plot shows none of them', () => {
    const stand = mount(<WaypointForm {...baseProps()} />);
    click(stand.querySelectorAll('.wp-type-btn')[0]); // STAND is first
    expect(stand.querySelector('#wp-height')).not.toBeNull();
    expect(stand.querySelector('#wp-lane-dial')).not.toBeNull();
    expect(stand.querySelector('.wp-octant-grid')).not.toBeNull();
    expect(stand.querySelector('#wp-name')).not.toBeNull();

    const plot = mount(<WaypointForm {...baseProps()} />);
    const plotBtn = Array.from(plot.querySelectorAll('.wp-type-btn')).find((b) => b.textContent === 'Food plot')!;
    click(plotBtn);
    expect(plot.querySelector('#wp-height')).toBeNull();
    expect(plot.querySelector('#wp-lane-dial')).toBeNull();
    expect(plot.querySelector('.wp-octant-grid')).toBeNull();
  });

  it('a trail camera shows a lens-direction dial and nothing else type-specific', () => {
    const el = mount(<WaypointForm {...baseProps()} />);
    const camBtn = Array.from(el.querySelectorAll('.wp-type-btn')).find((b) => b.textContent === 'Trail camera')!;
    click(camBtn);
    expect(el.querySelector('#wp-camera-dir')).not.toBeNull();
    expect(el.querySelector('#wp-height')).toBeNull();
  });

  it('pre-fills the name with the suggested default, counting only same-type waypoints', () => {
    const existing = [
      { type: 'STAND' } as WaypointDto,
      { type: 'STAND' } as WaypointDto,
      { type: 'TRAIL_CAMERA' } as WaypointDto,
    ];
    const el = mount(<WaypointForm {...baseProps({ existingWaypoints: existing })} />);
    click(el.querySelectorAll('.wp-type-btn')[0]); // STAND
    const nameInput = el.querySelector('#wp-name') as HTMLInputElement;
    expect(nameInput.value).toBe('Stand 3');
  });

  it('submits a STAND with lanes and huntable winds set', () => {
    const onSubmitCreate = vi.fn();
    const el = mount(<WaypointForm {...baseProps({ onSubmitCreate })} />);
    click(el.querySelectorAll('.wp-type-btn')[0]); // STAND

    // Add a shooting lane at the default dial value (0°).
    const addLaneBtn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.startsWith('Add 0°'))!;
    click(addLaneBtn);

    // Toggle two huntable winds.
    const windButtons = el.querySelectorAll('.wp-octant-grid .wp-type-btn');
    click(windButtons[0]); // N
    click(windButtons[2]); // E

    const submit = el.querySelector('button[type="submit"]')!;
    click(submit);

    expect(onSubmitCreate).toHaveBeenCalledTimes(1);
    const input = onSubmitCreate.mock.calls[0][0];
    expect(input.type).toBe('STAND');
    expect(input.name).toBe('Stand 1');
    expect(input.shootingLanesDeg).toEqual([0]);
    expect(input.huntableWinds).toEqual(['N', 'E']);
    expect(input.location).toEqual({ type: 'Point', coordinates: [HERE.lng, HERE.lat] });
  });

  it('a type with no extra fields submits without shootingLanesDeg/huntableWinds/cameraDirectionDeg', () => {
    const onSubmitCreate = vi.fn();
    const el = mount(<WaypointForm {...baseProps({ onSubmitCreate })} />);
    const plotBtn = Array.from(el.querySelectorAll('.wp-type-btn')).find((b) => b.textContent === 'Food plot')!;
    click(plotBtn);
    click(el.querySelector('button[type="submit"]')!);

    expect(onSubmitCreate).toHaveBeenCalledTimes(1);
    const input = onSubmitCreate.mock.calls[0][0];
    expect(input.type).toBe('FOOD_PLOT');
    expect(input.shootingLanesDeg).toBeUndefined();
    expect(input.huntableWinds).toBeUndefined();
    expect(input.cameraDirectionDeg).toBeUndefined();
    expect(input.standHeightM).toBeUndefined();
  });

  it('requires manual coordinates when there is no GPS fix and no fallback, and disables submit until they are valid', () => {
    const onSubmitCreate = vi.fn();
    const el = mount(
      <WaypointForm
        {...baseProps({ onSubmitCreate, location: null, locationSource: 'none', locating: false })}
      />,
    );
    click(el.querySelectorAll('.wp-type-btn')[0]); // STAND

    const submit = el.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    const lat = el.querySelector('#wp-location') as HTMLInputElement;
    const lng = el.querySelectorAll('.wp-latlng-row input')[1] as HTMLInputElement;
    setInputValue(lat, '39.4');
    setInputValue(lng, '-82.5');

    expect(submit.disabled).toBe(false);
    click(submit);
    expect(onSubmitCreate).toHaveBeenCalledTimes(1);
    expect(onSubmitCreate.mock.calls[0][0].location).toEqual({ type: 'Point', coordinates: [-82.5, 39.4] });
  });

  it('edit mode locks the type — no type picker is rendered', () => {
    const editing: WaypointDto = {
      id: 'w1',
      propertyId: 'prop-1',
      type: 'STAND',
      name: 'Stand 1',
      notes: null,
      elevationM: null,
      standHeightM: 4,
      shootingLanesDeg: [90],
      huntableWinds: ['N'],
      cameraDirectionDeg: null,
      lastCheckedAt: null,
      archived: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      version: 3,
      location: { type: 'Point', coordinates: [-82.5, 39.4] },
    };
    const onSubmitUpdate = vi.fn();
    const el = mount(
      <WaypointForm
        {...baseProps({ onSubmitCreate: vi.fn(), onSubmitUpdate, editing })}
      />,
    );
    expect(el.querySelectorAll('.wp-type-grid').length).toBe(0);
    expect(el.querySelector('#wp-height')).not.toBeNull();

    click(el.querySelector('button[type="submit"]')!);
    expect(onSubmitUpdate).toHaveBeenCalledTimes(1);
    expect(onSubmitUpdate.mock.calls[0][0].baseVersion).toBe(3);
  });
});
