import 'package:flutter/widgets.dart';
import 'package:flutter_scene/scene.dart';
import 'package:game_engine_palapa/src/web/web_game_engine.dart';

class GameSurface extends StatelessWidget {
  const GameSurface({required this.textureId, this.onResize, super.key});

  final int? textureId;
  final void Function(Size size)? onResize;

  @override
  Widget build(BuildContext context) {
    final engine = WebGameEngine.forSurface(textureId);
    return LayoutBuilder(
      builder: (context, constraints) {
        final size = constraints.biggest;
        if (onResize != null) {
          WidgetsBinding.instance.addPostFrameCallback(
            (_) => onResize?.call(size),
          );
        }
        return engine == null
            ? const SizedBox.expand()
            : SceneView(
                engine.scene,
                key: ValueKey(engine.surfaceId),
                cameraBuilder: (_) => engine.camera,
                pixelRatio: engine.pixelRatioFor(size),
              );
      },
    );
  }
}
