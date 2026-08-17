import 'package:flutter/widgets.dart';
import 'package:game_engine/game_engine.dart';

class Readout extends StatelessWidget {
  const Readout({
    required this.status,
    required this.position,
    required this.fps,
    required this.captured,
    super.key,
  });

  final EngineStatus? status;
  final Vec3 position;
  final double fps;
  final bool captured;

  static const _style = TextStyle(
    fontFamily: 'Menlo',
    fontSize: 11,
    height: 1.6,
    color: Color(0xFF73C991),
  );

  @override
  Widget build(BuildContext context) {
    final lines = {
      'GPU': status?.deviceName ?? '—',
      'RES': status?.resolutionLabel ?? '—',
      'FRAME': '${status?.gpuMilliseconds.toStringAsFixed(2) ?? '—'} ms',
      'FPS': fps.toStringAsFixed(0),
      'UPSCALE': status?.upscaling.name.toUpperCase() ?? '—',
      'INTERP': (status?.frameInterpolation ?? false) ? 'METALFX' : 'OFF',
      'POS':
          '${position.x.toStringAsFixed(1)} '
          '${position.y.toStringAsFixed(1)} '
          '${position.z.toStringAsFixed(1)}',
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisAlignment: MainAxisAlignment.start,
      children: [
        ...lines.entries.map(
          (line) => Text(
            '${line.key.padRight(9)}${line.value}',
            style: _style,
            textDirection: TextDirection.ltr,
          ),
        ),
        const SizedBox(height: 12),
        Text(
          captured
              ? 'MOUSE LOOK · WASD MOVE · SPACE/C RISE · SHIFT SPRINT · ESC RELEASE'
              : 'CLICK TO CAPTURE MOUSE · WASD MOVE · SPACE/C RISE · SHIFT SPRINT',
          style: const TextStyle(
            fontFamily: 'Menlo',
            fontSize: 10,
            color: Color(0x8873C991),
          ),
          textDirection: TextDirection.ltr,
        ),
      ],
    );
  }
}
