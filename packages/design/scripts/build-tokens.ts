/**
 * Emit `src/tokens.css` from `src/tokens.ts`.
 *
 * Run by `pnpm build`. The committed output is checked by `tokens.test.ts`, so
 * forgetting to re-run this fails CI rather than shipping a stylesheet that
 * silently disagrees with the values the map is drawing with.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderTokensCss } from '../src/tokens';

const out = resolve(__dirname, '../src/tokens.css');
writeFileSync(out, renderTokensCss(), 'utf8');
console.log(`Wrote ${out}`);
