# Lite 6 observation laboratory

[Open the hosted 3D experiment](https://abizbright1.github.io/lite6-observation-lab/).

This repository contains only the reviewed static teaching website: a nominal Lite 6 visual experiment, pinhole camera/timing lessons, synthetic data, technical equipment guidance and a weekday study plan. The full unpublished research draft, personal histories and raw review records are not included.

The 3D view runs in the browser. GitHub Pages serves assets, so no laptop web server is required; browser CPU/GPU resources are still used. Reduced GPU mode is enabled by default; paused/hidden playback stops. No physical robot or camera API exists.

## Study schedule

3–4 hours each day Monday–Friday, 15–20 scheduled hours weekly. Saturday and Sunday are fully off. The core is 180 minutes/day including 30 minutes of breaks, with an optional 60-minute weekday extension. [Complete study plan](starter_pack/16_Week_Plan.html).

## Provenance and updates

The site is generated from an allowlist in the private research source repository. Updates must be rebuilt, checked and copied here; private source is never published wholesale. `SITE_MANIFEST.json` records the artifact's file hashes. `.nojekyll` preserves the static module and mesh files. The site is published from the main branch root.

UFACTORY meshes retain their BSD license and Three.js its MIT license. [Detailed asset provenance](simulation/scene3d/ASSET_SOURCES.html). The camera mount and laboratory arrangement are illustrative, not calibrated physical measurements. No dynamics/contact, collision-safety or doctoral novelty claim is made.
