# game-engine-palapa

A small real-time ray-traced Flutter game engine, Metal-native on Apple
hardware, running at 120 fps with MetalFX frame generation. A raster G-buffer
feeds hardware ray tracing, MetalFX upscales and denoises, and the frame
interpolator generates every other frame — straight into a Flutter `Texture`.
Scene, camera and simulation stay in Dart; Swift owns Metal and nothing else.

## Pipeline

```
Dart tick ─ camera + instance transforms
   │
   ├─ G-buffer raster        albedo · normal · roughness · motion · specular · depth
   ├─ Ray tracing (compute)  sun shadow ray + cosine-hemisphere sky rays
   ├─ MetalFX                MTLFXTemporalDenoisedScaler (macOS 26+)
   │                         MTLFXTemporalScaler otherwise
   ├─ MetalFX                MTLFXFrameInterpolator (macOS 26+, optional)
   └─ Tonemap → BGRA IOSurface → Flutter texture
```

Ray tracing uses `MTLAccelerationStructure` with an instance structure rebuilt
each frame, so every object can move freely. Requires a device where
`MTLDevice.supportsRaytracing` is true (Apple silicon; hardware-accelerated on
M3 and later).

## Use

```sh
flutter pub add game_engine_palapa
```

```dart
import 'package:game_engine_palapa/game_engine_palapa.dart';

final engine = GameEngine();
final status = await engine.start(width: 1600, height: 1000);
await engine.setScene(GameScene(
  meshes: [MeshDescription.plane(80, 80), MeshDescription.sphere(1)],
  instances: [
    const GameInstance(meshIndex: 0, material: GameMaterial(albedo: Vec3(0.2, 0.2, 0.2))),
    const GameInstance(meshIndex: 1, material: GameMaterial(albedo: Vec3(0.8, 0.3, 0.2))),
  ],
  sun: const SunLight(direction: Vec3(-0.4, -1, -0.3)),
));

GameLoop((delta) => engine.submit(GameFrame(
  camera: GameCamera(position: Vec3(0, 4, 12), target: Vec3.zero),
  transforms: [Matrix4.identity(), Matrix4.translationValues(0, 1, 0)],
  aspectRatio: 16 / 10,
  deltaSeconds: delta,
))).start();

// In the widget tree:
GameSurface(textureId: engine.textureId);
```

`RenderSettings` controls render scale, ray budget, upscaling, denoising and
frame interpolation; `EngineStatus` reports back what the device actually gave
you (upscaler in use, render/output resolution, GPU milliseconds).

## Platforms

macOS only today. iOS is next — the Metal path is shared, only the plugin
registration and texture bridge differ.
