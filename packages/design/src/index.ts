/**
 * `@hunt-maps/design` — the Ridgeline design system.
 *
 * Decoupled from `apps/web` on purpose. A UI change should be a token edit or a
 * primitive edit in one package, not a hunt through app components — and a
 * second surface (native shell, print view, embedded share page) should inherit
 * the field constraints rather than re-deriving them badly.
 *
 * Consumers import styles once:
 *
 *   import '@hunt-maps/design/tokens.css';
 *   import '@hunt-maps/design/styles.css';
 *
 * and pull tokens into JavaScript where the map needs them:
 *
 *   import { mapColor } from '@hunt-maps/design';
 */

export * from './tokens';
export * from './components/primitives';
export * from './components/icons';
