import 'package:game_engine/src/vec3.dart';

enum MeshShape { box, sphere, plane }

class MeshDescription {
  const MeshDescription._(this.shape, this.size, this.segments);
  const MeshDescription.box(Vec3 size) : this._(MeshShape.box, size, 0);
  MeshDescription.plane(double width, double depth)
    : this._(MeshShape.plane, Vec3(width, 0, depth), 0);
  MeshDescription.sphere(double radius, {int segments = 28})
    : this._(MeshShape.sphere, Vec3(radius, radius, radius), segments);

  final MeshShape shape;
  final Vec3 size;
  final int segments;

  Map<String, dynamic> toJson() => {
    'shape': shape.name,
    'size': size.values,
    'segments': segments,
  };
}

enum MaterialKind { opaque, water, glass, foliage }

class GameMaterial {
  const GameMaterial({
    required this.albedo,
    this.roughness = 0.5,
    this.metallic = 0.0,
    this.emissive = Vec3.zero,
    this.kind = MaterialKind.opaque,
    this.tint = const Vec3(1, 1, 1),
    this.ior = 1.45,
  });

  final Vec3 albedo;
  final double roughness;
  final double metallic;
  final Vec3 emissive;
  final MaterialKind kind;
  final Vec3 tint;
  final double ior;

  Map<String, dynamic> toJson() => {
    'albedo': albedo.values,
    'roughness': roughness,
    'metallic': metallic,
    'emissive': emissive.values,
    'kind': kind.name,
    'tint': tint.values,
    'ior': ior,
  };
}

class GameInstance {
  const GameInstance({required this.meshIndex, required this.material});

  final int meshIndex;
  final GameMaterial material;

  Map<String, dynamic> toJson() => {'mesh': meshIndex, ...material.toJson()};
}

class SunLight {
  const SunLight({
    required this.direction,
    this.color = const Vec3(1.0, 0.96, 0.9),
    this.intensity = 4.0,
    this.angularRadius = 0.03,
  });

  final Vec3 direction;
  final Vec3 color;
  final double intensity;
  final double angularRadius;

  Map<String, dynamic> toJson() => {
    'direction': direction.values,
    'color': color.values,
    'intensity': intensity,
    'angularRadius': angularRadius,
  };
}

class SkyGradient {
  const SkyGradient({
    this.zenith = const Vec3(0.09, 0.16, 0.32),
    this.horizon = const Vec3(0.42, 0.48, 0.58),
    this.ground = const Vec3(0.06, 0.06, 0.07),
  });

  final Vec3 zenith;
  final Vec3 horizon;
  final Vec3 ground;

  Map<String, dynamic> toJson() => {
    'zenith': zenith.values,
    'horizon': horizon.values,
    'ground': ground.values,
  };
}

class Fog {
  const Fog({this.color = Vec3.zero, this.density = 0.0});

  final Vec3 color;
  final double density;

  Map<String, dynamic> toJson() => {'color': color.values, 'density': density};
}

class GameScene {
  const GameScene({
    required this.meshes,
    required this.instances,
    required this.sun,
    this.sky = const SkyGradient(),
    this.fog = const Fog(),
  });

  final List<MeshDescription> meshes;
  final List<GameInstance> instances;
  final SunLight sun;
  final SkyGradient sky;
  final Fog fog;

  Map<String, dynamic> toJson() => {
    'meshes': meshes.map((mesh) => mesh.toJson()).toList(),
    'instances': instances.map((instance) => instance.toJson()).toList(),
    'sun': sun.toJson(),
    'sky': sky.toJson(),
    'fog': fog.toJson(),
  };
}
