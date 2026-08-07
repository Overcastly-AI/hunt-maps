/**
 * `@hunt-maps/terrain` — the terrain analytics engine.
 *
 * Pure TypeScript with zero runtime dependencies, by design: the *same* code
 * path runs on the API (batch analysis, corridor solving, tile baking) and in
 * the browser's Web Worker (live layers, and the entire feature set while the
 * user is offline in the woods with no signal). A hunter's saved filter must
 * produce byte-identical output on the truck's laptop and on the phone at the
 * bottom of a hollow — one implementation is the only way to guarantee that.
 */

export * from './dem/encoding.js';
export * from './dem/tilemath.js';
export * from './dem/grid.js';
export * from './dem/halo.js';

export * from './analysis/horizon.js';
export * from './analysis/surface.js';
export * from './analysis/landform.js';
export * from './analysis/shading.js';
export * from './analysis/solar.js';
export * from './analysis/wind.js';

export * from './corridor/cost.js';
export * from './corridor/leastcost.js';

export * from './filters/terrainFilter.js';
export * from './render/ramps.js';

export * from './pipeline.js';
