import { describe, expect, it } from 'vitest';
import { LAYERS, layerById, missingInputs, toggleLayer } from './layers';
import { DEM_SOURCE } from './map/demSource';

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

  // Regression guard for the "LiDAR relief" mislabel this fix corrects
  // (CLAUDE.md non-negotiable #2 — "never be confidently wrong about
  // terrain"). The map's actual DEM (`DEM_SOURCE`, `lib/map/demSource.ts`) is
  // a ~10 m global blend capped at zoom 15 — nothing here has ever served
  // real LiDAR — and nothing caught a layer label promising otherwise. These
  // three checks are deliberately structural rather than a one-off assertion
  // on `multiHillshade`, so the same defect shipping under a different label
  // or a different resolution number fails here too.
  describe('elevation-source honesty (regression guard for R77 / the LiDAR mislabel)', () => {
    it('never names a specific elevation-data technology in a layer label', () => {
      // Labels are short and get read in isolation — exactly the field that
      // said "LiDAR" while a 10 m blend sat behind it. A label should say
      // what a layer does; which dataset happens to power it today belongs
      // in the blurb, sourced from `DEM_SOURCE`, not baked into the label.
      const technologyTerms = /\b(lidar|3dep|ifsar|photogrammetry)\b/i;
      for (const l of LAYERS) {
        expect(l.label, l.id).not.toMatch(technologyTerms);
      }
    });

    it('routes any metre-resolution claim in a blurb through DEM_SOURCE, never a hardcoded number', () => {
      // A blurb may say how fine the elevation data is, but only by quoting
      // `DEM_SOURCE.resolutionNote` — the one place that number is allowed to
      // live. A literal "1 m" typed into a blurb is exactly how this bug
      // shipped: true of 3DEP, false of the terrarium blend this app actually
      // serves, and nothing tied the two together.
      const metreResolutionClaim = /\b\d+(\.\d+)?\s?m\b/i;
      for (const l of LAYERS) {
        if (metreResolutionClaim.test(l.blurb)) {
          expect(l.blurb, l.id).toContain(DEM_SOURCE.resolutionNote);
        }
      }
    });

    it('only mentions logging grades, skid roads or micro-terrain in the relief blurb to say the DEM cannot resolve them', () => {
      // Old logging grades, skid roads and micro-benches are narrower than a
      // single pixel of a ~10 m blend — the precise overclaim the mislabelled
      // layer made ("Reveals benches, old logging grades and micro-terrain
      // ..."). It is fine, and expected, to name these features to explain
      // what the layer *cannot* show; a blurb that names them with no
      // negation anywhere is claiming the opposite, which is the regression.
      const relief = layerById('multiHillshade');
      expect(relief, 'multiHillshade must stay registered for this guard to mean anything').toBeDefined();
      const featureTerms = /(logging grade|skid road|micro-?terrain|micro-?bench)/i;
      if (featureTerms.test(relief?.blurb ?? '')) {
        expect(relief?.blurb).toMatch(/\b(not|cannot|does not|doesn't|need (a )?(finer|real))\b/i);
      }
    });
  });
});
