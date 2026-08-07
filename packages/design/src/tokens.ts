/**
 * Ridgeline design tokens — the single source of truth.
 *
 * ## Why tokens live in TypeScript and CSS is generated from them
 *
 * The map needs these values at runtime: MapLibre paint properties, canvas
 * colour ramps, and SVG legends are all set in JavaScript, not CSS. If tokens
 * lived only in a stylesheet, every one of those would hard-code a hex literal,
 * and a palette change would mean hunting duplicated colours through the
 * codebase — which is exactly the coupling this package exists to remove.
 *
 * So: tokens are declared here once, `tokens.css` is *generated* from this file
 * by `scripts/build-tokens.ts`, and a test fails CI if the committed CSS drifts
 * from the TypeScript. Change a value in one place; both consumers follow.
 *
 * ## The visual direction
 *
 * Map-first, like the category leaders — the map is the product and chrome
 * floats over it rather than competing for width. Where we deliberately differ:
 *
 *  - **The ground is blue hour, not neutral black.** Every neutral carries a
 *    cold blue bias, because that is the actual colour of the sky forty minutes
 *    before shooting light, which is when this app gets opened. A neutral grey
 *    would read as unconsidered; this one is chosen.
 *  - **The accent is survey brass, not alert orange.** Warm and instrument-like
 *    — the colour of a USGS benchmark disc — rather than the saturated orange
 *    the category defaults to. Chrome should read as a tool, not a warning.
 *  - **Blaze orange is semantic only.** Hunter-safety orange means *danger* in
 *    this world, and spending it on decoration would waste the one colour whose
 *    meaning every user already knows.
 *
 * ## The constraints these values answer to
 *
 *  - **Pre-dawn, in a truck or a stand, at minimum screen brightness.** Dark by
 *    default. A white panel at 05:30 destroys night vision and announces your
 *    position from a hundred yards.
 *  - **Midday, gloved, in direct sun.** Large hit targets, high contrast, and
 *    nothing important conveyed by hue alone.
 */

export interface TokenGroup {
  [name: string]: string;
}

/**
 * Colour.
 *
 * Neutrals run cold (hue ≈ 210°) so the chrome sits behind the map rather than
 * in front of it. Semantic colours are used for state only, never as the sole
 * carrier of meaning — roughly 8% of men are red-green colourblind and this is
 * a male-skewed user base.
 */
export const color = {
  /** Blue hour. The base the map floats on. */
  'ground': '#0a0f14',
  /** Floating chrome: rails, sheets, bars. */
  'surface': '#121a22',
  /** Raised within a surface: active rows, inputs. */
  'raised': '#1b242e',
  /** Scrim behind an open sheet. */
  'scrim': 'rgb(6 10 14 / 0.62)',
  'line': '#26323d',
  'line-strong': '#374757',
  'text': '#e8edf2',
  /*
   * `text-dim` / `text-faint` were tuned against `color.ground`, a flat swatch
   * — that is what the token test still checks, and it is the wrong surface.
   * Every real consumer (`.rl-toggle__blurb`, `.rl-conditions__label`,
   * `.rl-hint`, `.rl-section-heading__hint`) sits on *glass over a live map*,
   * and `ui-invariants.spec.ts` samples actual rendered pixels there, not
   * computed CSS. Measured against that glass the old values fell as low as
   * 2.55:1 where WCAG AA needs 4.5:1 — a blurb a hunter cannot read at 05:30.
   * Lightened both a full step so they clear 4.5:1 with margin even over the
   * brightest patches of basemap the blur can pull in; paired with raising
   * the glass opacity floor below, which does the other half of the work by
   * capping how much the map can brighten the glass beneath the text.
   */
  'text-dim': '#b2bfcb',
  'text-faint': '#94a3b0',
  /** Survey brass. The single accent. */
  'accent': '#c9a253',
  'accent-dim': '#6f5525',
  'accent-bright': '#e3bd76',
  /** Ink for text sitting on the accent. */
  'accent-ink': '#120d03',
  'ok': '#4fc3a1',
  'warn': '#e0b64a',
  /** Hunter safety orange. Reserved for critical states only. */
  'blaze': '#ff5a1f',
  'info': '#5b9dd9',
} as const satisfies TokenGroup;

/**
 * Map layer colours.
 *
 * Kept in the design system rather than in the terrain engine so a
 * cartographic palette change is a token edit, not a code change in an
 * analytics package that has no business knowing about aesthetics.
 * `@hunt-maps/terrain` ships defaults; the app overrides them from here.
 */
export const mapColor = {
  'slope-flat': '#3d7fa6',
  'slope-sidehill': '#4fae93',
  'slope-bedding': '#dcb455',
  'slope-steep': '#d4703c',
  'slope-wall': '#963040',
  'feature-saddle': '#3fd6e0',
  'feature-channel': '#4894c4',
  'feature-ridge': '#e08d47',
  'feature-peak': '#dd5a4e',
  'feature-bench': '#c9a253',
  'corridor': '#4fc3a1',
  'pinch': '#ff5a1f',
} as const satisfies TokenGroup;

/**
 * Glass. Floating chrome over a map needs to read as *above* the map without
 * hiding it — the imagery underneath is evidence, and a solid panel throws it
 * away.
 */
export const glass = {
  /*
   * Opacity floors raised (0.86 → 0.92, 0.94 → 0.97) alongside the `text-dim`
   * / `text-faint` lightening above. `backdrop-filter: blur() saturate(140%)`
   * means the glass's *effective* colour depends on whatever part of the map
   * sits behind it, and the layers sheet is tall enough that the same label
   * can end up over a bright basemap patch depending on scroll position — the
   * contrast test caught exactly this, sampling one blurb at 2.55:1 while a
   * heading nearby measured 4.10:1 against nominally the same glass. Only
   * lightening the text would have needed near-white values to survive the
   * brightest patch and flattened the hierarchy against primary text; capping
   * how much the map can bleed through is the other half of the fix and lets
   * the text values stay reasonable. Still visibly glass — not opaque.
   */
  'bg': 'rgb(18 26 34 / 0.92)',
  'bg-strong': 'rgb(10 15 20 / 0.97)',
  'blur': 'blur(18px) saturate(140%)',
  'border': 'rgb(255 255 255 / 0.09)',
  'highlight': 'inset 0 1px 0 rgb(255 255 255 / 0.06)',
} as const satisfies TokenGroup;

/**
 * Spacing, on a 4px base.
 *
 * `touch` is the floor for any interactive target — 44px is the platform
 * accessibility minimum and also roughly a gloved fingertip, which is the
 * binding constraint here.
 */
export const space = {
  '0': '0',
  '1': '4px',
  '2': '8px',
  '3': '12px',
  '4': '16px',
  '5': '20px',
  '6': '24px',
  '8': '32px',
  '10': '40px',
  '12': '48px',
  'touch': '44px',
} as const satisfies TokenGroup;

export const radius = {
  'sm': '4px',
  'md': '8px',
  'lg': '12px',
  'xl': '18px',
  'pill': '999px',
} as const satisfies TokenGroup;

/**
 * Typefaces.
 *
 * **Barlow** for the interface: a low-contrast grotesque with slightly squared
 * terminals and transit-signage heritage. Wayfinding is literally this app's
 * job, and Barlow reads as a sign rather than as a website. **Barlow Condensed**
 * for eyebrows and map marginalia, where density is the point. **IBM Plex Mono**
 * for coordinates, elevations and bearings — figures that must align and be
 * read aloud correctly.
 *
 * Self-hosted via `@fontsource` and imported by `fonts.css`. Never a CDN link:
 * a font that silently falls back is a design that silently stops existing, and
 * the production CSP restricts `font-src` to `'self'` anyway.
 */
export const font = {
  'sans': "'Barlow', ui-sans-serif, system-ui, -apple-system, sans-serif",
  'condensed': "'Barlow Condensed', 'Barlow', ui-sans-serif, system-ui, sans-serif",
  'mono': "'IBM Plex Mono', ui-monospace, 'SF Mono', monospace",
} as const satisfies TokenGroup;

/**
 * Type scale.
 *
 * Nothing below 11px. Small type is unreadable at arm's length on a phone
 * clipped to a pack strap, which is where a lot of this gets read.
 */
export const fontSize = {
  'xs': '11px',
  'sm': '12px',
  'base': '14px',
  'md': '15px',
  'lg': '18px',
  'xl': '24px',
  'display': '32px',
} as const satisfies TokenGroup;

export const fontWeight = {
  'normal': '400',
  'medium': '500',
  'semibold': '600',
  'bold': '700',
} as const satisfies TokenGroup;

export const lineHeight = {
  'tight': '1.2',
  'normal': '1.45',
  'loose': '1.6',
} as const satisfies TokenGroup;

/** Letter-spacing. Uppercase labels need air; display sizes need the opposite. */
export const tracking = {
  'display': '-0.02em',
  'normal': '0',
  'label': '0.09em',
  'eyebrow': '0.14em',
} as const satisfies TokenGroup;

export const shadow = {
  'rail': '0 4px 20px rgb(0 0 0 / 0.45)',
  'sheet': '0 16px 48px rgb(0 0 0 / 0.6)',
  'raised': '0 2px 8px rgb(0 0 0 / 0.35)',
} as const satisfies TokenGroup;

export const layout = {
  'sheet-width': '360px',
  'sheet-max-height': '62vh',
  'rail-gap': '12px',
  'breakpoint-compact': '860px',
  /**
   * `ConditionsBar`'s own rendered height on a phone — two stacked lines
   * (label + value) inside `.rl-conditions__cell`'s padding, plus the shared
   * `.rl-glass` border. Measured directly with `getBoundingClientRect` at
   * 390px (~51-52px, both with and without a wind set — the row is always
   * two lines) and padded up to a round number so a font-metrics difference
   * across platforms cannot re-open the gap it exists to guarantee: the
   * mobile Layers/Offline sheet's clearance in `apps/web/src/index.css`,
   * which must stop above this row rather than painting over it (BACKLOG
   * R42) — the wind control has to stay reachable while the sheet is open,
   * or the app's flagship "sweep the wind, watch bedding repaint" move is
   * impossible on the device this product is used on.
   */
  'conditions-bar-height': '56px',
  /**
   * `CommandBar`'s own rendered height (BACKLOG R44) — one row, icon +
   * label, `.rl-command__cell`'s `--space-3` vertical padding plus
   * `.rl-glass`'s 1px border top and bottom. Computed from the same tokens
   * the bar is built from (icon 20px vs. an 11px/1.45 label line both lose
   * to `--space-touch`'s 44px floor, +2px border = 46px) and padded up a
   * couple of pixels the same way `conditions-bar-height` is, so a
   * font-metrics difference across platforms cannot reopen the gap this
   * exists to guarantee.
   *
   * This is the number that replaces the old `--space-touch * N` arithmetic
   * in `apps/web/src/index.css` — the bar's own clearance is now one fixed
   * value regardless of how many cells it holds, which is the entire point
   * of building it as a row instead of a stack.
   */
  'command-bar-height': '48px',
} as const satisfies TokenGroup;

/** Motion. Every consumer must also honour `prefers-reduced-motion`. */
export const motion = {
  'fast': '120ms',
  'base': '220ms',
  'sheet': '280ms',
  'ease': 'cubic-bezier(0.32, 0.72, 0, 1)',
} as const satisfies TokenGroup;

/** Every token group, keyed by the CSS custom-property prefix it generates. */
export const TOKEN_GROUPS: Record<string, TokenGroup> = {
  color,
  map: mapColor,
  glass,
  space,
  radius,
  font,
  text: fontSize,
  weight: fontWeight,
  leading: lineHeight,
  track: tracking,
  shadow,
  layout,
  motion,
};

/** CSS custom-property name for a token, e.g. `--color-accent`. */
export function cssVar(group: string, name: string): string {
  return `--${group}-${name}`;
}

/** `var(--color-accent)` — for use in inline styles and JS-set map paint. */
export function token(group: keyof typeof TOKEN_GROUPS, name: string): string {
  return `var(${cssVar(group, name)})`;
}

/**
 * Render every token as a CSS custom-property block.
 *
 * Used by the build script and by the drift test. Keeping generation in the
 * package (rather than in a build tool config) is what lets the test assert the
 * committed CSS is exactly what this function produces.
 */
export function renderTokensCss(): string {
  const lines: string[] = [
    '/*',
    ' * GENERATED FILE — do not edit.',
    ' *',
    ' * Produced from `src/tokens.ts` by `pnpm --filter @hunt-maps/design build:tokens`.',
    ' * `tokens.test.ts` fails CI if this file drifts from the TypeScript source.',
    ' */',
    '',
    ':root {',
  ];

  for (const [group, tokens] of Object.entries(TOKEN_GROUPS)) {
    lines.push(`  /* ${group} */`);
    for (const [name, value] of Object.entries(tokens)) {
      lines.push(`  ${cssVar(group, name)}: ${value};`);
    }
    lines.push('');
  }

  // Dark is the only theme today, but declaring it explicitly stops the browser
  // rendering form controls and scrollbars in light chrome against a dark page.
  lines.push('  color-scheme: dark;');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}
