## 0.1.0

First public release.

- Hybrid renderer: a raster G-buffer feeds hardware ray tracing for shadows and
  sky-lit indirect light, with the instance acceleration structure rebuilt every
  frame so everything can move.
- MetalFX temporal upscaling and denoising, and MetalFX frame interpolation for
  generated frames.
- Scenes, cameras, materials and per-frame transforms in Dart, or loaded from
  YAML with `SceneDocument`.
- Draws into a Flutter `Texture`, so the viewport composites with ordinary
  widgets.
- Stand still and the engine stops re-drawing the frame and starts refining it.
