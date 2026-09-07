import 'package:flutter/widgets.dart';

/// A backend that draws the world into the widget tree rather than into a
/// platform texture. Metal has a texture and needs none of this; the web
/// implementation registers itself here when the plugin starts up.
abstract class GameSurfaceBackend {
  static GameSurfaceBackend? instance;

  Widget build(BuildContext context, int? textureId, Size size);
}

class GameSurface extends StatelessWidget {
  const GameSurface({required this.textureId, this.onResize, super.key});

  final int? textureId;
  final void Function(Size size)? onResize;

  @override
  Widget build(BuildContext context) {
    final id = textureId;
    final backend = GameSurfaceBackend.instance;

    return LayoutBuilder(
      builder: (context, constraints) {
        final size = constraints.biggest;
        if (onResize != null) {
          WidgetsBinding.instance.addPostFrameCallback(
            (_) => onResize?.call(size),
          );
        }

        return switch ((backend, id)) {
          (final drawn?, _) => drawn.build(context, id, size),
          (_, null) => const SizedBox.expand(),
          (_, final int texture) => Texture(
            textureId: texture,
            filterQuality: FilterQuality.medium,
          ),
        };
      },
    );
  }
}
