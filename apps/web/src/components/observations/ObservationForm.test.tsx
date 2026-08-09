import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ObservationForm } from './ObservationForm';

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

function pickKind(el: HTMLElement, label: string) {
  const btn = Array.from(el.querySelectorAll('.obs-kind-btn')).find((b) => b.textContent === label)!;
  click(btn);
}

const HERE = { lng: -82.5, lat: 39.4 };

function baseProps(overrides: Partial<Parameters<typeof ObservationForm>[0]> = {}) {
  return {
    waypoints: [],
    location: HERE,
    locationSource: 'gps' as const,
    locating: false,
    windFromDeg: 90,
    submitting: false,
    submitError: null,
    onCancel: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
}

describe('ObservationForm — kind-aware fields (R5)', () => {
  it('defaults to Sighting with species, sex, count and travel direction', () => {
    const el = mount(<ObservationForm {...baseProps()} />);
    expect(el.querySelector('#obs-species')).not.toBeNull();
    expect(el.querySelector('#obs-sex')).not.toBeNull();
    expect(el.querySelector('#obs-count')).not.toBeNull();
    expect(el.querySelector('#obs-travel-heading')).not.toBeNull();
    expect(el.querySelector('#obs-sign-type')).toBeNull();
  });

  it('Sign shows a sign-type picker and no species grid', () => {
    const el = mount(<ObservationForm {...baseProps()} />);
    pickKind(el, 'Sign');
    expect(el.querySelector('#obs-sign-type')).not.toBeNull();
    expect(el.querySelector('#obs-species')).toBeNull();
    expect(el.querySelector('#obs-travel-heading')).toBeNull();
  });

  it('Harvest shows species but no travel-direction dial', () => {
    const el = mount(<ObservationForm {...baseProps()} />);
    pickKind(el, 'Harvest');
    expect(el.querySelector('#obs-species')).not.toBeNull();
    expect(el.querySelector('#obs-travel-heading')).toBeNull();
  });

  it('Sit shows the blank-sit toggle and defaults to showing "what you saw" fields (not-blank)', () => {
    const el = mount(<ObservationForm {...baseProps()} />);
    pickKind(el, 'Sit');
    const checkbox = el.querySelector('.obs-blank-toggle input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(false);
    expect(el.querySelector('#obs-species')).not.toBeNull();

    click(checkbox);
    expect(el.querySelector('#obs-species')).toBeNull();
  });

  it('submits a Sign observation with signType and no species/sex', () => {
    const onSubmit = vi.fn();
    const el = mount(<ObservationForm {...baseProps({ onSubmit })} />);
    pickKind(el, 'Sign');
    click(el.querySelector('button[type="submit"]')!);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const input = onSubmit.mock.calls[0][0];
    expect(input.kind).toBe('SIGN');
    expect(input.signType).toBe('RUB');
    expect(input.species).toBeUndefined();
    expect(input.location).toEqual({ type: 'Point', coordinates: [HERE.lng, HERE.lat] });
    expect(input.windFromDeg).toBe(90);
  });

  it('submits a Sighting with species, sex and count', () => {
    const onSubmit = vi.fn();
    const el = mount(<ObservationForm {...baseProps({ onSubmit })} />);
    click(el.querySelector('button[type="submit"]')!);

    const input = onSubmit.mock.calls[0][0];
    expect(input.kind).toBe('SIGHTING');
    expect(input.species).toBe('WHITETAIL');
    expect(input.sex).toBe('UNKNOWN');
    expect(input.count).toBe(1);
  });

  it('a blank Sit submits count 0 and no species/sex', () => {
    const onSubmit = vi.fn();
    const el = mount(<ObservationForm {...baseProps({ onSubmit })} />);
    pickKind(el, 'Sit');
    click(el.querySelector('.obs-blank-toggle input[type="checkbox"]')!);
    click(el.querySelector('button[type="submit"]')!);

    const input = onSubmit.mock.calls[0][0];
    expect(input.kind).toBe('SIT');
    expect(input.isBlankSit).toBe(true);
    expect(input.count).toBe(0);
    expect(input.species).toBeUndefined();
  });

  it('disables submit when there is no location available', () => {
    const el = mount(<ObservationForm {...baseProps({ location: null, locationSource: 'none' })} />);
    const submit = el.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });
});
