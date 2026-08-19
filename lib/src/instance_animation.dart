import 'package:vector_math/vector_math_64.dart';

/// What one instance does over time. The document holds these per instance and
/// the scene asks for a matrix each frame.
abstract class InstanceAnimation {
  const InstanceAnimation();

  Matrix4 apply(Matrix4 base, double seconds);
}
