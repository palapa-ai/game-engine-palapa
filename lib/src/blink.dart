import 'package:game_engine_palapa/src/instance_animation.dart';
import 'package:vector_math/vector_math_64.dart';

/// On for its slice of the cycle, shrunk to nothing for the rest. Scaling it
/// away takes its light with it, which is what makes a signal read as switched
/// off rather than dimmed.
class Blink extends InstanceAnimation {
  const Blink({required this.period, required this.from, required this.to});

  final double period;
  final double from;
  final double to;

  @override
  Matrix4 apply(Matrix4 base, double seconds) {
    final phase = seconds % period;
    final lit = phase >= from && phase < to;
    return lit ? base : (base.clone()..scaleByDouble(0, 0, 0, 1));
  }
}
