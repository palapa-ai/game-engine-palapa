# Browser scene runtime

Optional web modules for `game_engine_palapa`. Applications provide scene definitions, content, asset URLs, and actions. This package owns rendering, path tracing, denoising, geometry ray lighting, text layout, materials, and animated surfaces.

The website depends only on this package. It does not bring the native Metal plugin, physics, the game editor, or `flutter_scene` into its web build. Feature modules load when their surfaces are used; the path tracer, workers, and denoiser are loaded on demand.

Import runtime modules directly from JavaScript, or use `WebRuntime.load('hero/text3d.mjs')` from Dart. The browser runtime does not require Flutter. A custom scene uses `createSceneSurface(canvas, definition, options)` with its own layout and scene builder. Keep product names, download destinations, model catalogs, and comparison data in the consuming application.

Visible surfaces receive rendering priority. Offscreen surfaces continue in throttled batches, and hidden tabs pause work. `downloadAssets` reports actual streamed bytes against a build manifest and suppresses numbers when lengths cannot be verified. `rubber` supplies a matte, nonmetallic material that scene normalization preserves.

Run `node --test test/*.mjs` and `dart analyze lib` in this package.
