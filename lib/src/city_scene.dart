import 'dart:math' as math;

import 'package:game_engine/src/game_scene.dart';
import 'package:game_engine/src/vec3.dart';
import 'package:vector_math/vector_math_64.dart';

class CityScene {
  static const _plane = 0;
  static const _box = 1;
  static const _sphere = 2;
  static const _grid = 11;
  static const _spacing = 20.0;
  static const _extent = _grid * _spacing;
  static const _shoreline = 34.0;
  static const _islandHeight = 1.6;

  final List<GameInstance> instances = [];
  final List<Matrix4> transforms = [];

  CityScene() {
    _add(
      const GameInstance(
        meshIndex: _plane,
        material: GameMaterial(
          albedo: Vec3(0.006, 0.02, 0.03),
          roughness: 0.02,
          kind: MaterialKind.water,
          tint: Vec3(0.55, 0.82, 0.78),
          ior: 1.333,
        ),
      ),
      Matrix4.identity(),
    );

    _island();

    final random = math.Random(0x5EED1);
    final cells = [
      for (var x = 0; x < _grid; x++)
        for (var z = 0; z < _grid; z++) (x, z),
    ];
    cells.where((cell) => _onLand(cell)).forEach((cell) {
      final center = _position(cell, random);
      final roll = random.nextDouble();
      if (roll < 0.42) {
        _tower(center, random, glass: roll < 0.24);
      } else if (roll < 0.78) {
        _tree(center, random);
      }
      if (random.nextDouble() < 0.3) _tuft(center, random);
    });
  }

  List<MeshDescription> get meshes => [
    MeshDescription.plane(_extent * 6, _extent * 6),
    const MeshDescription.box(Vec3(1, 1, 1)),
    MeshDescription.sphere(0.5, segments: 18),
  ];

  GameScene get scene => GameScene(
    meshes: meshes,
    instances: instances,
    sun: const SunLight(
      direction: Vec3(-0.32, -0.55, -0.42),
      color: Vec3(1.0, 0.86, 0.68),
      intensity: 3.4,
      angularRadius: 0.05,
    ),
    sky: const SkyGradient(
      zenith: Vec3(0.02, 0.05, 0.11),
      horizon: Vec3(0.16, 0.2, 0.26),
      ground: Vec3(0.01, 0.014, 0.018),
    ),
    fog: const Fog(color: Vec3(0.05, 0.08, 0.11), density: 0.0055),
  );

  void _island() {
    _add(
      const GameInstance(
        meshIndex: _box,
        material: GameMaterial(
          albedo: Vec3(0.05, 0.11, 0.05),
          roughness: 0.85,
          kind: MaterialKind.foliage,
        ),
      ),
      Matrix4.translationValues(0, _islandHeight / 2, 0)
        ..scaleByDouble(_shoreline * 2, _islandHeight, _shoreline * 2, 1),
    );
  }

  bool _onLand((int, int) cell) {
    final (column, row) = cell;
    final x = (column - _grid / 2) * _spacing;
    final z = (row - _grid / 2) * _spacing;
    return x.abs() < _shoreline - 6 && z.abs() < _shoreline - 6;
  }

  void _tower(Vec3 center, math.Random random, {required bool glass}) {
    final height = 10 + random.nextDouble() * random.nextDouble() * 52;
    final width = 5 + random.nextDouble() * 5;
    final depth = 5 + random.nextDouble() * 5;

    _add(
      GameInstance(
        meshIndex: _box,
        material: glass
            ? const GameMaterial(
                albedo: Vec3(0.6, 0.78, 0.85),
                roughness: 0.05,
                kind: MaterialKind.glass,
                tint: Vec3(0.72, 0.88, 0.86),
                ior: 1.5,
              )
            : const GameMaterial(
                albedo: Vec3(0.05, 0.055, 0.06),
                roughness: 0.28,
                metallic: 0.4,
              ),
      ),
      Matrix4.translationValues(center.x, _islandHeight + height / 2, center.z)
        ..scaleByDouble(width, height, depth, 1),
    );

    if (!glass && random.nextDouble() < 0.6) {
      _stripe(center, width, depth, height, random);
    }
  }

  void _stripe(
    Vec3 center,
    double width,
    double depth,
    double height,
    math.Random random,
  ) {
    final vertical = random.nextBool();
    _add(
      GameInstance(
        meshIndex: _box,
        material: GameMaterial(
          albedo: Vec3.zero,
          roughness: 1,
          emissive: _glow(random),
        ),
      ),
      vertical
          ? (Matrix4.translationValues(
              center.x,
              _islandHeight + height * 0.5,
              center.z + depth / 2 + 0.08,
            )..scaleByDouble(0.4, height * 0.78, 0.12, 1))
          : (Matrix4.translationValues(
              center.x,
              _islandHeight + height * 0.74,
              center.z + depth / 2 + 0.08,
            )..scaleByDouble(width * 0.84, 0.32, 0.12, 1)),
    );
  }

  void _tree(Vec3 center, math.Random random) {
    final height = 4 + random.nextDouble() * 5;
    _add(
      const GameInstance(
        meshIndex: _box,
        material: GameMaterial(albedo: Vec3(0.07, 0.05, 0.035), roughness: 0.9),
      ),
      Matrix4.translationValues(center.x, _islandHeight + height / 2, center.z)
        ..scaleByDouble(0.5, height, 0.5, 1),
    );

    final canopy = 2 + random.nextInt(2);
    for (var layer = 0; layer < canopy; layer++) {
      final radius = 3.4 - layer * 0.75;
      _add(
        GameInstance(
          meshIndex: _sphere,
          material: GameMaterial(
            albedo: Vec3(0.05 + random.nextDouble() * 0.04, 0.19, 0.07),
            roughness: 0.95,
            kind: MaterialKind.foliage,
          ),
        ),
        Matrix4.translationValues(
          center.x + (random.nextDouble() - 0.5) * 1.2,
          _islandHeight + height + layer * 1.7,
          center.z + (random.nextDouble() - 0.5) * 1.2,
        )..scaleByDouble(radius * 2, radius * 1.5, radius * 2, 1),
      );
    }
  }

  void _tuft(Vec3 center, math.Random random) {
    _add(
      GameInstance(
        meshIndex: _sphere,
        material: GameMaterial(
          albedo: Vec3(0.06, 0.16 + random.nextDouble() * 0.08, 0.05),
          roughness: 1,
          kind: MaterialKind.foliage,
        ),
      ),
      Matrix4.translationValues(
        center.x + (random.nextDouble() - 0.5) * 12,
        _islandHeight + 0.25,
        center.z + (random.nextDouble() - 0.5) * 12,
      )..scaleByDouble(3.2, 0.7, 3.2, 1),
    );
  }

  Vec3 _position((int, int) cell, math.Random random) {
    final (column, row) = cell;
    return Vec3(
      (column - _grid / 2) * _spacing + (random.nextDouble() - 0.5) * 5,
      0,
      (row - _grid / 2) * _spacing + (random.nextDouble() - 0.5) * 5,
    );
  }

  Vec3 _glow(math.Random random) {
    const palette = [
      Vec3(0.45, 0.79, 0.57),
      Vec3(0.4, 0.96, 0.96),
      Vec3(0.8, 0.6, 1.0),
      Vec3(0.97, 0.46, 0.56),
    ];
    return palette[random.nextInt(palette.length)] * 1.5;
  }

  void _add(GameInstance instance, Matrix4 transform) {
    instances.add(instance);
    transforms.add(transform);
  }
}
