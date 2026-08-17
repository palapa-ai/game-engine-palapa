import 'package:flutter_test/flutter_test.dart';
import 'package:game_engine/game_engine.dart';
import 'package:vector_math/vector_math_64.dart';

void main() {
  const camera = GameCamera(
    position: Vec3(0, 0, 10),
    target: Vec3.zero,
    near: 1,
    far: 100,
  );

  double clipDepth(double viewZ) {
    final clip = camera.projection(1.5).transform3(Vector3(0, 0, viewZ));
    return clip.z / -viewZ;
  }

  test('maps the near plane to 0 and the far plane to 1', () {
    expect(clipDepth(-1), closeTo(0, 1e-6));
    expect(clipDepth(-100), closeTo(1, 1e-6));
  });

  test('view matrix places the camera at the origin looking down -z', () {
    final eye = camera.view.transform3(Vector3(0, 0, 10));
    expect(eye.z, closeTo(0, 1e-6));
  });
}
