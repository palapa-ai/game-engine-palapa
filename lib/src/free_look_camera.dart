import 'dart:math' as math;
import 'dart:ui';

import 'package:game_engine/src/game_camera.dart';
import 'package:game_engine/src/vec3.dart';

enum Movement { forward, back, left, right, up, down, sprint }

class FreeLookCamera {
  static const _walkSpeed = 9.0;
  static const _sprintSpeed = 26.0;
  static const _lookSensitivity = 0.005;
  static const _pitchLimit = math.pi / 2 - 0.05;
  static const _damping = 12.0;

  Vec3 _position = const Vec3(0, 14, 86);
  Vec3 _velocity = Vec3.zero;
  double _yaw = -math.pi / 2;
  double _pitch = -0.12;
  double _fieldOfView = 1.15;

  Vec3 get position => _position;
  double get speed => _velocity.length;

  GameCamera get camera => GameCamera(
    position: _position,
    target: _position + _forward,
    fieldOfView: _fieldOfView,
  );

  Vec3 get _forward => Vec3(
    math.cos(_yaw) * math.cos(_pitch),
    math.sin(_pitch),
    math.sin(_yaw) * math.cos(_pitch),
  );

  Vec3 get _right => Vec3(-math.sin(_yaw), 0, math.cos(_yaw));

  void placeAt(GameCamera start) {
    _position = start.position;
    final forward = (start.target - start.position).normalized;
    _pitch = math.asin(forward.y.clamp(-1.0, 1.0));
    _yaw = math.atan2(forward.z, forward.x);
    _fieldOfView = start.fieldOfView;
  }

  void look(Offset delta) {
    _yaw += delta.dx * _lookSensitivity;
    _pitch = (_pitch - delta.dy * _lookSensitivity).clamp(
      -_pitchLimit,
      _pitchLimit,
    );
  }

  void advance(double deltaSeconds, Set<Movement> held) {
    final target = _target(held);
    final blend = math.min(1.0, deltaSeconds * _damping);
    _velocity = _velocity + (target - _velocity) * blend;
    _position = _position + _velocity * deltaSeconds;
  }

  Vec3 _target(Set<Movement> held) {
    final flat = Vec3(_forward.x, 0, _forward.z).normalized;
    final direction = [
      if (held.contains(Movement.forward)) flat,
      if (held.contains(Movement.back)) flat * -1,
      if (held.contains(Movement.right)) _right,
      if (held.contains(Movement.left)) _right * -1,
      if (held.contains(Movement.up)) const Vec3(0, 1, 0),
      if (held.contains(Movement.down)) const Vec3(0, -1, 0),
    ].fold(Vec3.zero, (sum, axis) => sum + axis);

    if (direction.length == 0) return Vec3.zero;
    final speed = held.contains(Movement.sprint) ? _sprintSpeed : _walkSpeed;
    return direction.normalized * speed;
  }
}
