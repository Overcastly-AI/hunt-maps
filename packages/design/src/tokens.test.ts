import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  color,
  cssVar,
  mapColor,
  renderTokensCss,
  space,
  token,
  TOKEN_GROUPS,
} from './tokens';

describe('token → CSS generation', () => {
  it('the committed tokens.css matches what tokens.ts produces', () => {
    // The drift guard. Tokens are consumed from BOTH TypeScript (MapLibre paint
    // properties, canvas ramps) and CSS, so a stylesheet that silently
    // disagrees with the values the map draws with is a real, invisible defect.
    const committed = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');
    expect(committed).toBe(renderTokensCss());
  });

  it('emits a custom property for every token in every group', () => {
    const css = renderTokensCss();
    for (const [group, tokens] of Object.entries(TOKEN_GROUPS)) {
      for (const [name, value] of Object.entries(tokens)) {
        expect(css, `${group}.${name}`).toContain(`${cssVar(group, name)}: ${value};`);
      }
    }
  });

  it('builds var() references usable in inline styles and map paint', () => {
    expect(token('color', 'accent')).toBe('var(--color-accent)');
    expect(cssVar('map', 'feature-saddle')).toBe('--map-feature-saddle');
  });

  it('declares a colour scheme so form controls do not render light on a dark page', () => {
    expect(renderTokensCss()).toContain('color-scheme: dark;');
  });
});

describe('token values honour the field constraints', () => {
  it('keeps the touch target at or above the gloved-fingertip floor', () => {
    // 44px is the platform accessibility minimum and roughly a gloved
    // fingertip, which is the binding constraint in this product.
    expect(parseInt(space.touch, 10)).toBeGreaterThanOrEqual(44);
  });

  it('keeps the base surface dark — a white panel at 05:30 kills night vision', () => {
    expect(luminance(color.ground)).toBeLessThan(0.05);
    expect(luminance(color.surface)).toBeLessThan(0.08);
  });

  it('biases the neutrals cold rather than defaulting to grey', () => {
    // The ground is the sky forty minutes before shooting light, not a neutral
    // near-black. Blue must lead red on every neutral surface, or the palette
    // has drifted back to an unconsidered grey.
    for (const neutral of [color.ground, color.surface, color.raised, color.line]) {
      const [r, , b] = rgb(neutral);
      expect(b, neutral).toBeGreaterThan(r);
    }
  });

  it('meets WCAG AA contrast for body text on every surface', () => {
    for (const surface of [color.ground, color.surface, color.raised]) {
      expect(contrast(color.text, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('meets WCAG AA large-text contrast for dimmed text', () => {
    expect(contrast(color['text-dim'], color.ground)).toBeGreaterThanOrEqual(3);
    expect(contrast(color['text-faint'], color.ground)).toBeGreaterThanOrEqual(3);
  });

  it('keeps text on the accent legible — brass is light enough to need dark ink', () => {
    expect(contrast(color['accent-ink'], color.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the accent distinguishable from the blaze it must never be confused with', () => {
    // Blaze is hunter-safety orange and means danger. If the everyday accent
    // reads as the same colour, the one signal every user already understands
    // stops meaning anything.
    const [ar, ag, ab] = rgb(color.accent);
    const [br, bg, bb] = rgb(color.blaze);
    expect(Math.hypot(ar - br, ag - bg, ab - bb)).toBeGreaterThan(90);
  });

  it('separates map feature colours by luminance, not just hue', () => {
    // ~8% of men are red-green colourblind and this is a male-skewed user base.
    // Slope bands must stay ordered when hue is stripped out.
    const bands = [
      mapColor['slope-flat'],
      mapColor['slope-sidehill'],
      mapColor['slope-bedding'],
      mapColor['slope-steep'],
      mapColor['slope-wall'],
    ].map(luminance);

    for (let i = 1; i < bands.length; i++) {
      expect(Math.abs(bands[i] - bands[i - 1]), `band ${i}`).toBeGreaterThan(0.02);
    }
  });

  it('uses no literal colours in the component stylesheet', () => {
    // Every rule must read a token. A hard-coded hex is how a design system
    // quietly stops being the source of truth.
    const css = readFileSync(resolve(__dirname, 'styles.css'), 'utf8');
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const hexes = withoutComments.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexes).toEqual([]);
  });
});

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = srgbToLinear(parseInt(h.slice(0, 2), 16));
  const g = srgbToLinear(parseInt(h.slice(2, 4), 16));
  const b = srgbToLinear(parseInt(h.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
