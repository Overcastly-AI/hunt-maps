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

// Real USGS 3DEP elevation: a zero-dependency Cloud-Optimized GeoTIFF reader,
// the UTM projection its 1 m products need, and the vertical-datum guard that
// stops orthometric and ellipsoidal heights being mixed in one surface.
export * from './dem/geotiff.js';
export * from './dem/projection.js';
export * from './dem/verticalDatum.js';
export * from './dem/cog.js';
export * from './dem/usgs3dep.js';

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
