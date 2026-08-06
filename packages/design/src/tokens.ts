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
 * ## The constraints these values answer to
 *
 * Ridgeline is used in two contexts that pull in opposite directions:
 *
 *  - **Pre-dawn, in a truck or a stand, at minimum screen brightness.** Dark by
 *    default. A white panel at 05:30 destroys night vision and announces your
 *    position from a hundred yards.
 *  - **Midday, gloved, in direct sun.** Large hit targets, high contrast, and
 *    nothing important conveyed by hue alone.
 *
 * The chrome is deliberately desaturated. Map overlays carry all the saturation
 * in this product; chrome that competes with them makes terrain harder to read,
 * which is the one thing this interface must never do.
 */

export interface TokenGroup {
  [name: string]: string;
}

/**
 * Colour.
 *
 * One accent (amber). Semantic colours are used for state only, never as the
 * sole carrier of meaning — roughly 8% of men are red-green colourblind and
 * this is a male-skewed user base.
 */
export const color = {
  'bg': '#0f1216',
  'bg-panel': '#161a20',
  'bg-raised': '#1e242c',
  'bg-overlay': '#0b0e11',
  'line': '#2a323c',
  'line-strong': '#3b4552',
  'text': '#e6e3dc',
  'text-dim': '#9aa3ad',
  'text-faint': '#6b747e',
  'accent': '#e8a33d',
  'accent-dim': '#8a6222',
  'accent-bright': '#f5bd68',
  'ok': '#5fd08a',
  'warn': '#e2be5a',
  'danger': '#d8574b',
  'info': '#3fb6d8',
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
  'slope-flat': '#488cb0',
  'slope-sidehill': '#60ba9a',
  'slope-bedding': '#e2be5a',
  'slope-steep': '#d87642',
  'slope-wall': '#9c303e',
  'feature-saddle': '#40d6e2',
  'feature-channel': '#4c9cc4',
  'feature-ridge': '#e8964e',
  'feature-peak': '#e26054',
  'feature-bench': '#e8a33d',
  'corridor': '#5fd08a',
  'pinch': '#e26054',
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
  'md': '6px',
  'lg': '8px',
  'xl': '12px',
  'pill': '999px',
} as const satisfies TokenGroup;

export const font = {
  'sans': "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  'mono': "ui-monospace, 'SF Mono', 'Cascadia Code', monospace",
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
  'xl': '22px',
} as const satisfies TokenGroup;

export const fontWeight = {
  'normal': '400',
  'medium': '500',
  'bold': '600',
} as const satisfies TokenGroup;

export const lineHeight = {
  'tight': '1.25',
  'normal': '1.45',
  'loose': '1.6',
} as const satisfies TokenGroup;

export const shadow = {
  'card': '0 8px 32px rgb(0 0 0 / 0.5)',
  'raised': '0 2px 8px rgb(0 0 0 / 0.35)',
} as const satisfies TokenGroup;

export const layout = {
  'panel-width': '340px',
  'sheet-max-height': '45vh',
  'panel-breakpoint': '860px',
} as const satisfies TokenGroup;

/** Motion. Every consumer must also honour `prefers-reduced-motion`. */
export const motion = {
  'fast': '120ms',
  'base': '200ms',
  'ease': 'cubic-bezier(0.2, 0, 0, 1)',
} as const satisfies TokenGroup;

/** Every token group, keyed by the CSS custom-property prefix it generates. */
export const TOKEN_GROUPS: Record<string, TokenGroup> = {
  color,
  map: mapColor,
  space,
  radius,
  font,
  text: fontSize,
  weight: fontWeight,
  leading: lineHeight,
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
