import 'package:flutter/widgets.dart';
import 'package:game_engine/game_engine.dart';

enum RayMode { perFrame, perSecond, total }

/// One line per reading, label then value. The readings cycle too: tap the
/// rate to swap frames per second for milliseconds, tap the rays to swap
/// per-frame for per-second or the running total.
class Toggles extends StatelessWidget {
  const Toggles({
    required this.settings,
    required this.status,
    required this.fps,
    required this.generatedFps,
    required this.rayMode,
    required this.totalRays,
    required this.onRays,
    required this.onScale,
    required this.projection,
    required this.onProjection,
    required this.onUpscaled,
    required this.onUpscaler,
    required this.onFrameGen,
    required this.onBounces,
    required this.onSamples,
    required this.targetRate,
    required this.onFrameRate,
    super.key,
  });

  final RenderSettings settings;
  final EngineStatus? status;
  final double fps;
  final double generatedFps;
  final RayMode rayMode;
  final double totalRays;
  final void Function(int step) onRays;
  final void Function(int step) onScale;
  final Projection projection;
  final void Function(int step) onProjection;
  final void Function(int step) onUpscaled;
  final void Function(int step) onUpscaler;
  final void Function(int step) onFrameGen;
  final void Function(int step) onBounces;
  final void Function(int step) onSamples;
  final int targetRate;
  final void Function(int step) onFrameRate;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: const Color(0xB8000000),
      borderRadius: BorderRadius.circular(7),
    ),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      // Zero-padded readings hold their width, so the panel can wrap its
      // widest row without twitching frame to frame.
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          _Line(label: 'frame', value: _frameTime, reading: true),
          _Line(label: 'fps', value: _number(fps), reading: true),
          _Line(
            label: 'generated fps',
            value: _number(generatedFps),
            reading: true,
          ),
          _Line(label: 'rays', value: _rayValue, onStep: onRays, reading: true),
          _Line(
            label: 'ray tracing',
            value: '${_padded(status?.traceMilliseconds ?? 0, 2)} ms',
            reading: true,
          ),
          const SizedBox(height: 7),
          _Line(label: '', value: projection.label, onStep: onProjection),
          _Line(
            label: 'render',
            value: settings.resolution.label,
            onStep: onScale,
            leading: true,
          ),
          _Line(
            label: 'upscaled',
            value: settings.upscaled == settings.resolution
                ? 'none'
                : settings.upscaled.label,
            onStep: onUpscaled,
            leading: true,
          ),
          _Line(
            label: 'upscaler',
            value: _titled(settings.upscaler.name),
            onStep: onUpscaler,
            leading: true,
          ),
          _Line(
            label: 'frame generation',
            value: settings.frameInterpolation ? '2x' : '1x',
            onStep: onFrameGen,
            leading: true,
          ),
          _Line(
            label: 'frame cap',
            value: targetRate == 0 ? 'display' : '$targetRate fps',
            onStep: onFrameRate,
            leading: true,
          ),
          _Line(
            label: 'samples',
            value: '${settings.samples}',
            onStep: onSamples,
            leading: true,
          ),
          _Line(
            label: 'bounces',
            value: '${settings.bounceRays}',
            onStep: onBounces,
            leading: true,
          ),
        ],
      ),
    ),
  );

  String get _frameTime => '${_padded(fps <= 0 ? 0 : 1000 / fps, 2)} ms';

  String get _rayValue {
    final perFrame = (status?.raysPerFrame ?? 0).toDouble();
    return switch (rayMode) {
      RayMode.perFrame => '${_scaled(perFrame)}/frame',
      RayMode.perSecond => '${_scaled(perFrame * fps)}/sec',
      RayMode.total => _scaled(totalRays),
    };
  }

  String _scaled(double value) {
    if (value >= 1000000000000) return '${_padded(value / 1000000000000, 2)} T';
    if (value >= 1000000000) return '${_padded(value / 1000000000, 2)} B';
    return '${_padded(value / 1000000, 2)} M';
  }

  /// Zero-padded so a reading never changes width mid-flight; only values
  /// below one earn decimals.
  String _number(double value) =>
      value >= 1 ? value.toStringAsFixed(0) : value.toStringAsFixed(2);

  String _padded(double value, int digits) => value >= 1
      ? value.toStringAsFixed(0).padLeft(digits, '0')
      : value.toStringAsFixed(2);

  String _titled(String value) => value[0].toUpperCase() + value.substring(1);
}

class _Line extends StatelessWidget {
  const _Line({
    required this.label,
    required this.value,
    this.onStep,
    this.reading = false,
    this.leading = false,
  });

  final String label;
  final String value;
  final void Function(int step)? onStep;

  /// A measurement reads white; a setting stays in the palette.
  final bool reading;

  /// Value first, name after — every row that carries a number.
  final bool leading;

  TextSpan get _label => TextSpan(
    text: label.isEmpty
        ? ''
        : reading || leading
        ? ' $label'
        : '$label ',
    style: const TextStyle(
      fontFamily: 'Menlo',
      fontSize: 11,
      color: Color(0x8873C991),
    ),
  );

  TextSpan get _value => TextSpan(
    text: value,
    style: TextStyle(
      fontFamily: 'Menlo',
      fontSize: 11,
      color: reading
          ? const Color(0xFFFFFFFF)
          : onStep == null
          ? const Color(0xFF73C991)
          : const Color(0xFF66F5F5),
    ),
  );

  @override
  Widget build(BuildContext context) => GestureDetector(
    onTap: onStep == null ? null : () => onStep?.call(1),
    onSecondaryTap: onStep == null ? null : () => onStep?.call(-1),
    behavior: HitTestBehavior.opaque,
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: 2.5),
      child: Text.rich(
        TextSpan(
          children: reading || leading ? [_value, _label] : [_label, _value],
        ),
        textDirection: TextDirection.ltr,
      ),
    ),
  );
}
