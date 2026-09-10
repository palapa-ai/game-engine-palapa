# Browser scene runtime

Optional web modules for `game_engine_palapa`. Applications provide scene definitions, content, asset URLs, and actions. This package owns rendering, path tracing, denoising, geometry ray lighting, text layout, materials, and animated surfaces.

The website depends only on this package. It does not bring the native Metal plugin, physics, the game editor, or `flutter_scene` into its web build. Feature modules load when their surfaces are used; the path tracer, workers, and denoiser are loaded on demand.

Import runtime modules directly from JavaScript, or use `WebRuntime.load('hero/text3d.mjs')` from Dart. The browser runtime does not require Flutter. A custom scene uses `createSceneSurface(canvas, definition, options)` with its own layout and scene builder. Keep product names, download destinations, model catalogs, and comparison data in the consuming application.

Visible surfaces receive rendering priority. Offscreen surfaces continue in throttled batches, and hidden tabs pause work. `downloadAssets` reports actual streamed bytes against a build manifest and suppresses numbers when lengths cannot be verified. `rubber` supplies a matte, nonmetallic material that scene normalization preserves.

`createPageScene` hosts a whole page in one scene, with a merged static tracing
structure and dynamic overlays. `createTextSurface`, launch controls, capacity
tables, and authored scene assets can share that host. Stationary table content
joins the trace; moving content does not reset accumulation. Animation receives
priority under a 16ms frame budget, using asynchronous GPU timings when available
and frame cadence otherwise. Individual GPU draws and initial compilation cannot
be preempted, so this is a performance target rather than a frame-rate guarantee.

Author geometry and materials in OpenUSD in the consuming repository. With the
OpenUSD Python SDK installed, `python tool/compile_usd.py scene.usda scene.scene.json`
from the engine repository produces indexed buffers for `loadSceneAsset`. The
compiler supports polygon meshes, transforms, material subsets, normals/UVs, and
UsdPreviewSurface color, roughness, metalness, emission, opacity, and IOR. Glass
uses physical transmission in the web material. Bake texture connections before
compiling; this is a runtime export subset, not a general USD composition engine.

Run `node --test test/*.mjs` and `dart analyze lib` in this package.
