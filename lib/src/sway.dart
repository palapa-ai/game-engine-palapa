import 'dart:math' as math;

import 'package:game_engine_palapa/src/instance_animation.dart';
import 'package:game_engine_palapa/src/vec3.dart';
import 'package:vector_math/vector_math_64.dart';

/// Drift and breathing applied to one instance every frame. Two detuned sines
/// per axis is what keeps a candle flame from reading as a metronome.
class Sway extends InstanceAnimation {
  const Sway({
    required this.drift,
    required this.speed,
    required this.pulse,
    required this.pulseSpeed,
  });

  final Vec3 drift;
  final double speed;
  final double pulse;
  final double pulseSpeed;

  @override
  Matrix4 apply(Matrix4 base, double seconds) {
    final wander = Vector3(
      drift.x * _wobble(seconds * speed, 1.73, 1.3),
      drift.y * (0.5 + 0.5 * math.sin(seconds * speed * 0.9 + 2.1)),
      drift.z * _wobble(seconds * speed * 1.31 + 0.7, 2.11, 0.0),
    );
    final breath =
        1 +
        pulse *
            (0.6 * math.sin(seconds * pulseSpeed) +
                0.4 * math.sin(seconds * pulseSpeed * 1.9 + 0.6));
    return Matrix4.translation(wander).multiplied(base)
      ..scaleByDouble(breath, breath, breath, 1);
  }

  double _wobble(double phase, double detune, double offset) =>
      math.sin(phase) * 0.6 + math.sin(phase * detune + offset) * 0.4;
}
