import 'dart:typed_data';

import 'package:game_engine/src/game_camera.dart';
import 'package:vector_math/vector_math_64.dart';

class GameFrame {
  const GameFrame({
    required this.camera,
    required this.transforms,
    required this.aspectRatio,
    required this.deltaSeconds,
  });

  final GameCamera camera;
  final List<Matrix4> transforms;
  final double aspectRatio;
  final double deltaSeconds;

  Map<String, dynamic> toJson() => {
    'view': Float32List.fromList(camera.view.storage),
    'projection': Float32List.fromList(camera.clipMatrix(aspectRatio).storage),
    'transforms': _packedTransforms,
    'fieldOfView': camera.fieldOfView,
    'near': camera.near,
    'far': camera.far,
    'aspectRatio': aspectRatio,
    'deltaSeconds': deltaSeconds,
  };

  Float32List get _packedTransforms {
    final packed = Float32List(transforms.length * 16);
    transforms.asMap().forEach((index, matrix) {
      packed.setRange(index * 16, index * 16 + 16, matrix.storage);
    });
    return packed;
  }
}
