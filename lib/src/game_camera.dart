import 'dart:math' as math;

import 'package:game_engine_palapa/src/vec3.dart';
import 'package:vector_math/vector_math_64.dart';

/// The two projection families a renderer can draw with — converging rays, or
/// parallel ones, sheared or not. Every mode is one projection matrix; the
/// tracer reads its inverse and never learns which it got.
enum Projection {
  perspective('perspective 46°', fieldOfView: 46),
  wide('perspective 75°', fieldOfView: 75),
  ultraWide('perspective 100°', fieldOfView: 100),
  orthographic('orthographic'),
  cavalier('oblique cavalier', shear: 1.0, shearAngle: 45),
  cabinet('oblique cabinet', shear: 0.5, shearAngle: 63.4);

  const Projection(
    this.label, {
    this.fieldOfView,
    this.shear = 0,
    this.shearAngle = 0,
  });

  final String label;
  final double? fieldOfView;
  final double shear;
  final double shearAngle;
}

class GameCamera {
  const GameCamera({
    required this.position,
    required this.target,
    this.up = const Vec3(0, 1, 0),
    this.fieldOfView = 0.9,
    this.projection = Projection.perspective,
    this.parallelHeight = 34,
    this.near = 0.1,
    this.far = 300.0,
  });

  final Vec3 position;
  final Vec3 target;
  final Vec3 up;
  final double fieldOfView;
  final Projection projection;

  /// How much world a parallel projection frames vertically.
  final double parallelHeight;
  final double near;
  final double far;

  GameCamera copyWith({
    Vec3? position,
    Vec3? target,
    double? fieldOfView,
    Projection? projection,
  }) => GameCamera(
    position: position ?? this.position,
    target: target ?? this.target,
    up: up,
    fieldOfView: fieldOfView ?? this.fieldOfView,
    projection: projection ?? this.projection,
    parallelHeight: parallelHeight,
    near: near,
    far: far,
  );

  Matrix4 get view =>
      makeViewMatrix(position.toVector3(), target.toVector3(), up.toVector3());

  Matrix4 clipMatrix(double aspectRatio) {
    final degrees = projection.fieldOfView;
    return degrees == null
        ? _parallel(aspectRatio)
        : _perspective(aspectRatio, degrees * math.pi / 180);
  }

  // Metal clip space keeps z in [0, 1], unlike vector_math's OpenGL-style [-1, 1].
  Matrix4 _perspective(double aspectRatio, double fieldOfView) {
    final focal = 1 / math.tan(fieldOfView / 2);
    final depth = far / (near - far);
    return Matrix4.zero()
      ..setEntry(0, 0, focal / aspectRatio)
      ..setEntry(1, 1, focal)
      ..setEntry(2, 2, depth)
      ..setEntry(2, 3, depth * near)
      ..setEntry(3, 2, -1);
  }

  /// Parallel rays: no convergence, and an oblique mode leans the whole bundle
  /// over so depth reads as a slide rather than a vanishing point.
  Matrix4 _parallel(double aspectRatio) {
    final height = parallelHeight;
    final width = height * aspectRatio;
    final radians = projection.shearAngle * math.pi / 180;
    return Matrix4.zero()
      ..setEntry(0, 0, 2 / width)
      ..setEntry(1, 1, 2 / height)
      ..setEntry(0, 2, projection.shear * math.cos(radians) * 2 / width)
      ..setEntry(1, 2, projection.shear * math.sin(radians) * 2 / height)
      ..setEntry(2, 2, -1 / (far - near))
      ..setEntry(2, 3, -near / (far - near))
      ..setEntry(3, 3, 1);
  }
}

extension on Vec3 {
  Vector3 toVector3() => Vector3(x, y, z);
}
