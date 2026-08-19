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
    final clip = camera.clipMatrix(1.5).transform3(Vector3(0, 0, viewZ));
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

  (Vector3 origin, Vector3 direction) ray(Projection mode, double x) {
    final shot = camera.copyWith(projection: mode);
    final inverse = Matrix4.inverted(shot.clipMatrix(1.5) * shot.view);
    final near = inverse.perspectiveTransform(Vector3(x, 0, 0));
    final far = inverse.perspectiveTransform(Vector3(x, 0, 1));
    return (near, (far - near).normalized());
  }

  double spread(Projection mode) =>
      (ray(mode, -0.8).$2 - ray(mode, 0.8).$2).length;

  double footprint(Projection mode) =>
      (ray(mode, -0.8).$1 - ray(mode, 0.8).$1).length;

  test('perspective rays leave a tiny film and fan out', () {
    expect(footprint(Projection.perspective), lessThan(2));
    expect(spread(Projection.perspective), greaterThan(0.5));
    expect(
      spread(Projection.ultraWide),
      greaterThan(spread(Projection.perspective)),
    );
  });

  test('parallel rays stay parallel and spread across the film', () {
    expect(spread(Projection.orthographic), closeTo(0, 1e-6));
    expect(footprint(Projection.orthographic), greaterThan(10));
  });

  test('oblique leans the bundle without converging it', () {
    expect(spread(Projection.cavalier), closeTo(0, 1e-6));
    final straight = ray(Projection.orthographic, 0).$2;
    final leaned = ray(Projection.cavalier, 0).$2;
    expect((leaned - straight).length, greaterThan(0.4));
    final gentler = ray(Projection.cabinet, 0).$2;
    expect((gentler - straight).length, lessThan((leaned - straight).length));
  });
}
