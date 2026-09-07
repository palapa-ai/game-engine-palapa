import 'package:flutter/widgets.dart';

class GameSurface extends StatelessWidget {
  const GameSurface({required this.textureId, this.onResize, super.key});

  final int? textureId;
  final void Function(Size size)? onResize;

  @override
  Widget build(BuildContext context) {
    final id = textureId;
    return LayoutBuilder(
      builder: (context, constraints) {
        final size = constraints.biggest;
        if (onResize != null) {
          WidgetsBinding.instance.addPostFrameCallback(
            (_) => onResize?.call(size),
          );
        }
        return id == null
            ? const SizedBox.expand()
            : Texture(textureId: id, filterQuality: FilterQuality.medium);
      },
    );
  }
}
