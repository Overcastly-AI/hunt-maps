/**
 * Test-only surfaces of the engine, behind their own entry point.
 *
 * Exposed as `@hunt-maps/terrain/testing` rather than from the package root on
 * purpose: these build synthetic rasters and reference surfaces, and the root
 * bundle ships into a **service worker**. Anything re-exported from `index.ts`
 * is reachable from that bundle whether or not it is used, so the closed-form
 * fixtures would ride along into every hunter's phone.
 *
 * A separate subpath keeps the main bundle unchanged while letting the API and
 * the web app validate against the same synthetic surfaces the engine's own
 * tests use — which matters, because a fixture that differs between packages
 * is a fixture that can agree with the wrong answer.
 */

export * from './synthetic.js';

// `syntheticTiff.ts` also declares a `SyntheticOptions`, describing a raster
// file rather than a height grid. Re-exported under an unambiguous name rather
// than shadowing either: a caller that picked up the wrong one would be
// configuring a TIFF with grid options, and the failure would be a fixture that
// silently is not the surface the test believes it is.
export type { SyntheticOptions as SyntheticTiffOptions, SyntheticLevel } from './syntheticTiff.js';
export { writeSyntheticTiff } from './syntheticTiff.js';
