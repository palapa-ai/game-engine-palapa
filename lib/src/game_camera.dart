import 'dart:math' as math;

import 'package:game_engine/src/vec3.dart';
import 'package:vector_math/vector_math_64.dart';

class GameCamera {
  const GameCamera({
    required this.position,
    required this.target,
    this.up = const Vec3(0, 1, 0),
    this.fieldOfView = 0.9,
    this.near = 0.1,
    this.far = 300.0,
  });

  final Vec3 position;
  final Vec3 target;
  final Vec3 up;
  final double fieldOfView;
  final double near;
  final double far;

  GameCamera copyWith({Vec3? position, Vec3? target, double? fieldOfView}) =>
      GameCamera(
        position: position ?? this.position,
        target: target ?? this.target,
        up: up,
        fieldOfView: fieldOfView ?? this.fieldOfView,
        near: near,
        far: far,
      );

  Matrix4 get view =>
      makeViewMatrix(position.toVector3(), target.toVector3(), up.toVector3());

  // Metal clip space keeps z in [0, 1], unlike vector_math's OpenGL-style [-1, 1].
  Matrix4 projection(double aspectRatio) {
    final focal = 1 / math.tan(fieldOfView / 2);
    final depth = far / (near - far);
    return Matrix4.zero()
      ..setEntry(0, 0, focal / aspectRatio)
      ..setEntry(1, 1, focal)
      ..setEntry(2, 2, depth)
      ..setEntry(2, 3, depth * near)
      ..setEntry(3, 2, -1);
  }
}

extension on Vec3 {
  Vector3 toVector3() => Vector3(x, y, z);
}
