import 'package:flutter/widgets.dart';
import 'package:flutter_scene/scene.dart';
import 'package:game_engine_palapa/game_engine_palapa.dart';
import 'package:game_engine_palapa_web/src/web_game_engine.dart';

class SceneGameSurface implements GameSurfaceBackend {
  const SceneGameSurface();

  @override
  Widget build(BuildContext context, int? textureId, Size size) {
    final engine = WebGameEngine.forSurface(textureId);
    if (engine == null) return const SizedBox.expand();

    // The view paints whatever size it is handed and does not clip itself, so
    // a stale or window sized ratio spills the scene past the banner.
    return ClipRect(
      child: SceneView(
        engine.scene,
        key: ValueKey(engine.surfaceId),
        cameraBuilder: (_) => engine.camera,
        pixelRatio: engine.pixelRatioFor(size),
      ),
    );
  }
}
