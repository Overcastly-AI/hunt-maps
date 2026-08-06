# Workflow: terrain-validation-loop

Continuously prove the engine is still right.

## Why this runs on its own schedule

`packages/terrain` is the one part of the system where a defect is both
invisible and consequential. A wrong sign does not crash, does not fail a
smoke test, and produces a map that looks entirely plausible while sending
someone to sit in the wrong place. Every other subsystem fails loudly; this one
fails quietly, so it gets its own standing validation loop rather than relying
on whoever last touched it.

## Each pass

1. **Re-derive, do not re-run.** Pick an operator and independently re-derive
   its expected value on a synthetic surface from first principles. Compare
   against the implementation. Do not simply confirm the existing test passes —
   the existing test could encode the same mistake.
2. **Cross-check against desktop GIS** where a standard exists (slope, aspect,
   hillshade against GDAL/QGIS on the same DEM). Divergence beyond rounding is a
   finding.
3. **Hunt the degenerate cases**: flat cells, uniform fields, no-data voids,
   tile edges without neighbours, poles and the antimeridian, extreme latitudes
   where the `cos(lat)` cell-size term dominates.
4. **Ground-truth against real LiDAR** where a known feature exists — a bench
   somebody has actually walked, a saddle visible on the ground.
5. **Check the seams.** Render a layer across a tile boundary at several zooms
   and confirm no discontinuity. Seams mean an undersized halo.

File findings to `docs/AUDIT-ENGINEERING.md`. A pass that finds nothing is a
real result — record it with what was checked, so coverage accumulates.
