import { describe, expect, it } from 'vitest';
import { LAYERS, layerById, missingInputs, toggleLayer } from './layers';

describe('toggleLayer', () => {
  it('adds and removes a layer', () => {
    const on = toggleLayer(new Set(), 'bench');
    expect(on.has('bench')).toBe(true);
    expect(toggleLayer(on, 'bench').has('bench')).toBe(false);
  });

  it('keeps only one base map', () => {
    const a = toggleLayer(new Set(), 'satellite');
    const b = toggleLayer(a, 'topo');
    expect(b.has('topo')).toBe(true);
    expect(b.has('satellite')).toBe(false);
  });

  it('keeps only one continuous ramp — two stacked ramps are unreadable', () => {
    const a = toggleLayer(new Set(), 'slope');
    const b = toggleLayer(a, 'aspect');
    expect(b.has('aspect')).toBe(true);
    expect(b.has('slope')).toBe(false);
  });

  it('lets discrete hunting layers stack freely', () => {
    let s = toggleLayer(new Set(), 'bench');
    s = toggleLayer(s, 'wood');
    expect(s.has('bench')).toBe(true);
    expect(s.has('wood')).toBe(true);
  });

  it('does not let a ramp evict a discrete layer', () => {
    let s = toggleLayer(new Set(), 'bench');
    s = toggleLayer(s, 'slope');
    expect(s.has('bench')).toBe(true);
    expect(s.has('slope')).toBe(true);
  });

  it('does not mutate the input set', () => {
    const original = new Set(['bench']);
    toggleLayer(original, 'slope');
    expect([...original]).toEqual(['bench']);
  });

  it('lets relief coexist with everything', () => {
    let s = toggleLayer(new Set(), 'multiHillshade');
    s = toggleLayer(s, 'slope');
    s = toggleLayer(s, 'satellite');
    expect(s.has('multiHillshade')).toBe(true);
    expect(s.has('slope')).toBe(true);
  });
});

describe('missingInputs', () => {
  it('flags a wind-dependent layer with no wind set', () => {
    const msgs = missingInputs(new Set(['bedding']), null);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain('wind direction');
  });

  it('is quiet once the wind is set', () => {
    expect(missingInputs(new Set(['bedding']), 270)).toHaveLength(0);
  });

  it('is quiet for layers that do not need wind', () => {
    expect(missingInputs(new Set(['slope', 'bench']), null)).toHaveLength(0);
  });

  it('treats due north (0°) as a set wind, not as absent', () => {
    // A falsy-check bug here would tell a user their layer is broken on a
    // north wind, which is a very common hunting wind.
    expect(missingInputs(new Set(['bedding']), 0)).toHaveLength(0);
  });
});

describe('layer catalogue', () => {
  it('gives every layer a blurb that explains why it matters', () => {
    for (const l of LAYERS) {
      expect(l.blurb.length, l.id).toBeGreaterThan(40);
    }
  });

  it('has unique ids', () => {
    const ids = LAYERS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps every default opacity in range', () => {
    for (const l of LAYERS) {
      expect(l.defaultOpacity).toBeGreaterThan(0);
      expect(l.defaultOpacity).toBeLessThanOrEqual(1);
    }
  });

  it('leaves imagery visible under every analysis overlay', () => {
    for (const l of LAYERS) {
      if (l.group === 'base') continue;
      expect(l.defaultOpacity, l.id).toBeLessThan(0.7);
    }
  });

  it('resolves layers by id', () => {
    expect(layerById('slope')?.label).toBe('Slope angle');
    expect(layerById('nope')).toBeUndefined();
  });

  // BACKLOG R61 — the regression gate the plan asks for. `Confidence` reached
  // zero real usages last time nothing enforced it, so this is not optional:
  // a layer added with a modelled biological parameter and no `grade` should
  // fail CI, not silently ship ungraded, and a layer built on published,
  // measured geometry should never gain one by accident either.
  describe('evidence grading (BACKLOG R61)', () => {
    // Horn slope, aspect, Weiss landform class, Wood morphometric features and
    // bench detection are peer-reviewed algorithms validated against
    // closed-form analytic surfaces (CLAUDE.md non-negotiable #2) — a `grade`
    // on any of them implies a doubt that does not exist.
    const measuredGeometry = ['slope', 'aspect', 'weiss', 'wood', 'bench', 'multiHillshade'];

    it('never grades measured geometry', () => {
      for (const id of measuredGeometry) {
        expect(layerById(id)?.grade, id).toBeUndefined();
      }
    });

    it('grades bedding — and only bedding — as an assumption', () => {
      for (const l of LAYERS) {
        if (l.id === 'bedding') {
          expect(l.grade).toBe('assumed');
        } else {
          expect(l.grade, l.id).toBeUndefined();
        }
      }
    });
  });
});
