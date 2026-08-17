import 'package:flutter/widgets.dart';
import 'package:game_engine/game_engine.dart';

class Readout extends StatelessWidget {
  const Readout({
    required this.status,
    required this.fps,
    required this.settings,
    required this.onScale,
    required this.onUpscaler,
    required this.onFrameGen,
    required this.onBounces,
    super.key,
  });

  final EngineStatus? status;
  final double fps;
  final RenderSettings settings;
  final VoidCallback onScale;
  final VoidCallback onUpscaler;
  final VoidCallback onFrameGen;
  final VoidCallback onBounces;

  @override
  Widget build(BuildContext context) {
    final rays = status?.raysPerFrame ?? 0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        _Line(label: 'FPS', value: fps.toStringAsFixed(0)),
        _Line(
          label: 'FRAME',
          value: '${status?.gpuMilliseconds.toStringAsFixed(2) ?? '—'} ms',
        ),
        _Line(label: 'RAYS', value: '${_millions(rays)} M/frame'),
        _Line(label: 'RAY/S', value: '${_millions((rays * fps).round())} M/s'),
        _Line(label: 'LIGHTS', value: '${status?.lightCount ?? 0}'),
        _Line(
          label: 'BOUNCES',
          value: '${settings.bounceRays}',
          onTap: onBounces,
        ),
        _Line(
          label: 'RES',
          value: status?.resolutionLabel ?? '—',
          onTap: onScale,
        ),
        _Line(
          label: 'UPSCALE',
          value: status?.upscaling.name.toUpperCase() ?? '—',
          onTap: onUpscaler,
        ),
        _Line(
          label: 'FRAMEGEN',
          value: (status?.frameInterpolation ?? false) ? 'METALFX' : 'OFF',
          onTap: onFrameGen,
        ),
      ],
    );
  }

  String _millions(int value) => (value / 1000000).toStringAsFixed(1);
}

class _Line extends StatelessWidget {
  const _Line({required this.label, required this.value, this.onTap});

  final String label;
  final String value;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => GestureDetector(
    onTap: onTap,
    behavior: HitTestBehavior.opaque,
    child: Text(
      '${label.padRight(10)}$value',
      style: TextStyle(
        fontFamily: 'Menlo',
        fontSize: 11,
        height: 1.7,
        color: onTap == null
            ? const Color(0xFF73C991)
            : const Color(0xFF66F5F5),
      ),
      textDirection: TextDirection.ltr,
    ),
  );
}
