import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter_scene/scene.dart';
import 'package:game_engine_palapa/game_engine_palapa.dart';
import 'package:game_engine_palapa_web/src/json_values.dart';
import 'package:game_engine_palapa_web/src/mesh_tessellator.dart';
import 'package:vector_math/vector_math.dart' as vm;

const _lampThreshold = 0.35;
const _lampLimit = 96;

/// The tracer samples one lamp per bounce, so ninety six of them cost it
/// nothing; a forward renderer shades every fragment against every light, so
/// the web keeps an evenly spread subset and lets the rest glow unlit.
const _lampBudget = 16;
const _lampGain = 8.0;
const _lampReach = 24.0;
const _minimumLampRadius = 0.05;
const _vanished = 1e-4;
const _mirrorRoughness = 0.02;

/// The archived site dropped its environment to a sliver once the wall came
/// in, so the sign lights the brick rather than the sky doing it.
const _environmentIntensity = 0.06;

const _probesPerFrame = 8;
const _refractiveRoughness = 0.05;

final _shapes = {for (final shape in MeshShape.values) shape.name: shape};
final _kinds = {for (final kind in MaterialKind.values) kind.name: kind};

/// An emissive instance turned into a point light. The tracer derives its lamps
/// from the instance transform every frame, so a lamp scaled to nothing goes
/// dark and a breathing one changes how far it reaches.
class SceneLamp {
  const SceneLamp({
    required this.node,
    required this.light,
    required this.emissive,
  });

  final Node node;
  final PointLight light;
  final vm.Vector3 emissive;

  void follow() {
    final transform = node.localTransform;
    final extent = [
      0,
      1,
      2,
    ].map((axis) => transform.getColumn(axis).xyz.length).reduce(math.max);

    light.range = math.max(extent * 0.5, _minimumLampRadius) * _lampReach;
    light.color = extent > _vanished ? emissive : vm.Vector3.zero();
  }
}

class WebScene {
  const WebScene._({
    required this.nodes,
    required this.lamps,
    required this.sun,
    required this.sky,
    required this.fog,
    required this._instances,
    required this._meshes,
  });

  /// Null when there is nothing to draw — no instances, or a mesh library with
  /// no geometry in it — which is what the host reports as a failed `setScene`.
  static WebScene? fromJson(Map<Object?, Object?> json) {
    final meshes = json
        .children('meshes')
        .map(_description)
        .nonNulls
        .map(tessellate)
        .toList();
    final instances = json
        .children('instances')
        .map((entry) => _Instance.fromJson(entry, meshes.length))
        .nonNulls
        .toList();

    final drawable =
        meshes.any((mesh) => mesh.positions.isNotEmpty) &&
        meshes.any((mesh) => mesh.indices.isNotEmpty);
    if (instances.isEmpty || !drawable) return null;

    final geometries = <int, MeshGeometry>{};
    final nodes = instances
        .map(
          (instance) => Node(mesh: _instanceMesh(instance, meshes, geometries)),
        )
        .toList();
    final sun = _sun(json.child('sun'));

    return WebScene._(
      nodes: nodes,
      lamps: _lamps(instances, nodes),
      sun: sun,
      sky: _sky(json.child('sky'), sun),
      fog: _fog(json.child('fog')),
      instances: instances,
      meshes: meshes,
    );
  }

  final List<Node> nodes;
  final List<SceneLamp> lamps;
  final List<_Instance> _instances;
  final List<TessellatedMesh> _meshes;
  final DirectionalLight sun;
  final GradientSkySource sky;
  final ({vm.Vector3 color, double density, double scattering}) fog;

  void applyTo(Scene scene, double exposure) {
    scene.removeAll();
    scene.addAll(nodes);
    for (final lamp in lamps) {
      lamp.node.addComponent(PointLightComponent(lamp.light));
      lamp.follow();
    }

    // Everything the tracer gets from following rays, bought back a pass at a
    // time: a probe grid for the bounce light, ground truth occlusion for the
    // contact darkening, screen space reflections for the gloss, and temporal
    // anti aliasing to settle the noise the way accumulation settles a trace.
    scene.environmentSettings = EnvironmentSettings(
      skybox: Skybox(sky),
      skyEnvironment: SkyEnvironment(sky),
      toneMapping: ToneMappingMode.aces,
      exposure: exposure,
      environmentIntensity: _environmentIntensity,

      globalIlluminationEnabled: true,
      globalIlluminationVolumeMode: IrradianceVolumeMode.fitScene,
      globalIlluminationEmissiveBoost: 2.5,
      globalIlluminationFireflyClamp: 6.0,
      globalIlluminationHysteresis: 0.93,
      globalIlluminationInjectionResolution:
          IrradianceInjectionResolution.eighth,
      // The scene barely moves, so the probes can refresh a few at a time
      // instead of all of them every frame.
      globalIlluminationProbeUpdateBudget: _probesPerFrame,

      ambientOcclusionEnabled: true,
      ambientOcclusionMethod: AmbientOcclusionMethod.groundTruth,
      ambientOcclusionVisibilityBitmask: true,
      ambientOcclusionRadius: 0.6,
      ambientOcclusionIntensity: 1.1,
      ambientOcclusionPower: 1.6,
      ambientOcclusionIndirectLight: 0.6,
      ambientOcclusionMultiBounce: 0.7,
      ambientOcclusionSpecularMode: SpecularAmbientOcclusionMode.simple,
      ambientOcclusionSliceCount: 2,
      ambientOcclusionStepsPerSlice: 2,

      bloomEnabled: true,
      bloomThreshold: 0.8,
      bloomIntensity: 0.35,
      bloomScatter: 0.85,

      vignetteEnabled: true,
      vignetteIntensity: 0.45,
      vignetteRadius: 0.65,

      fogEnabled: fog.density > 0,
      fogMode: FogMode.exponential,
      fogColor: fog.color,
      fogDensity: fog.density,
      fogSunInScatter: fog.scattering,
    );

    scene.directionalLight = sun;
    scene.antiAliasingMode = AntiAliasingMode.taa;
    scene.temporalAntiAliasing
      ..jitterSequenceLength = 16
      ..minimumCurrentWeight = 0.06
      ..sharpness = 0.20
      ..objectMotion = true;
  }

  /// Bakes every instance that has held still into one mesh per material and
  /// drops its node. A wall of six hundred bricks is six hundred draw calls
  /// standing still, which is what a web GPU cannot afford; merged it is one.
  void compact(Scene scene, Set<int> moving, Float32List transforms) {
    final lit = lamps.map((lamp) => lamp.node).toSet();
    final settled = _instances.indexed.where(
      (entry) => !moving.contains(entry.$1) && !lit.contains(nodes[entry.$1]),
    );

    final buckets = <String, List<int>>{};
    for (final (index, instance) in settled) {
      buckets.putIfAbsent(instance.key, () => []).add(index);
    }

    final merged = buckets.values
        .where((indices) => indices.length > 1)
        .map((indices) => _bake(indices, transforms))
        .nonNulls
        .toList();
    if (merged.isEmpty) return;

    for (final indices in buckets.values.where((bucket) => bucket.length > 1)) {
      for (final index in indices) {
        scene.remove(nodes[index]);
      }
    }
    scene.addAll(merged);
  }

  Node? _bake(List<int> indices, Float32List transforms) {
    final positions = <double>[];
    final normals = <double>[];
    final indexed = <int>[];

    for (final index in indices) {
      final mesh = _meshes[_instances[index].mesh];
      final world = _transform(transforms, index * 16);
      final direction = world.getNormalMatrix();
      final base = positions.length ~/ 3;

      for (var vertex = 0; vertex + 2 < mesh.positions.length; vertex += 3) {
        final point = world.transformed3(
          vm.Vector3(
            mesh.positions[vertex],
            mesh.positions[vertex + 1],
            mesh.positions[vertex + 2],
          ),
        );
        final normal =
            (direction *
                    vm.Vector3(
                      mesh.normals[vertex],
                      mesh.normals[vertex + 1],
                      mesh.normals[vertex + 2],
                    ))
                .normalized();

        positions.addAll([point.x, point.y, point.z]);
        normals.addAll([normal.x, normal.y, normal.z]);
      }
      indexed.addAll(mesh.indices.map((value) => value + base));
    }
    if (positions.isEmpty || indexed.isEmpty) return null;

    return Node(
      mesh: Mesh(
        MeshGeometry.fromArrays(
          positions: Float32List.fromList(positions),
          normals: Float32List.fromList(normals),
          indices: _wound(Uint32List.fromList(indexed)),
        ),
        _instances[indices.first].material,
      ),
    );
  }
}

vm.Matrix4 _transform(Float32List floats, int offset) =>
    floats.length < offset + 16
    ? vm.Matrix4.identity()
    : vm.Matrix4.fromFloat32List(floats.sublist(offset, offset + 16));

class _Instance {
  const _Instance({
    required this.mesh,
    required this.material,
    required this.emissive,
    required this.key,
  });

  static _Instance? fromJson(Map<Object?, Object?> json, int meshCount) {
    final index = json['mesh'];
    if (index is! int || meshCount == 0) return null;

    return _Instance(
      mesh: index.clamp(0, meshCount - 1),
      material: _material(json),
      emissive: vm.Vector3.array(
        json.triple('emissive', const [0.0, 0.0, 0.0]),
      ),
      key: _materialKey(json),
    );
  }

  final int mesh;
  final PhysicallyBasedMaterial material;
  final vm.Vector3 emissive;

  /// Instances that shade identically can be baked into one mesh, and the
  /// payload's own material fields are the cheapest way to spot them.
  final String key;
}

String _materialKey(Map<Object?, Object?> json) =>
    (json.keys.whereType<String>().where((name) => name != 'mesh').toList()
          ..sort())
        .map((name) => '$name=${json[name]}')
        .join('|');

Mesh? _instanceMesh(
  _Instance instance,
  List<TessellatedMesh> meshes,
  Map<int, MeshGeometry> geometries,
) {
  final mesh = meshes[instance.mesh];
  if (mesh.positions.isEmpty || mesh.indices.isEmpty) return null;

  return Mesh(
    geometries.putIfAbsent(
      instance.mesh,
      () => MeshGeometry.fromArrays(
        positions: mesh.positions,
        normals: mesh.normals,
        indices: _wound(mesh.indices),
      ),
    ),
    instance.material,
  );
}

/// The tracer's triangles come out wound for its own clip space; left as they
/// are here every camera-facing fragment is a back face, which this renderer
/// shades with a flipped normal.
Uint32List _wound(Uint32List indices) => Uint32List.fromList([
  for (var triangle = 0; triangle + 2 < indices.length; triangle += 3) ...[
    indices[triangle],
    indices[triangle + 2],
    indices[triangle + 1],
  ],
]);

List<SceneLamp> _lamps(List<_Instance> instances, List<Node> nodes) {
  final emitters = instances.indexed
      .where((entry) => _peak(entry.$2.emissive) > _lampThreshold)
      .take(_lampLimit)
      .toList();
  final stride = math.max((emitters.length / _lampBudget).ceil(), 1);

  return emitters.indexed
      .where((entry) => entry.$1 % stride == 0)
      .map((entry) => entry.$2)
      .map(
        (entry) => SceneLamp(
          node: nodes[entry.$1],
          light: PointLight(color: entry.$2.emissive, intensity: _lampGain),
          emissive: entry.$2.emissive,
        ),
      )
      .toList();
}

double _peak(vm.Vector3 value) => math.max(value.x, math.max(value.y, value.z));

MeshDescription? _description(Map<Object?, Object?> json) {
  final size = json.triple('size', const [1.0, 1.0, 1.0]);
  final segments = json.integer('segments', 24);

  return switch (_shapes[json['shape']]) {
    null => null,
    MeshShape.box => MeshDescription.box(Vec3(size[0], size[1], size[2])),
    MeshShape.plane => MeshDescription.plane(size[0], size[2]),
    MeshShape.sphere => MeshDescription.sphere(size[0], segments: segments),
    MeshShape.pyramid => MeshDescription.pyramid(size[0], size[1]),
    MeshShape.frustum => MeshDescription.frustum(size[0], size[1], size[2]),
    MeshShape.cylinder => MeshDescription.cylinder(segments: segments),
    MeshShape.cone => MeshDescription.cone(segments: segments),
    MeshShape.dish => MeshDescription.dish(
      size[0],
      size[1],
      segments: segments,
    ),
    MeshShape.ring => MeshDescription.ring(
      size[0],
      size[1],
      segments: segments,
    ),
    MeshShape.sleeve => MeshDescription.sleeve(
      size[0],
      size[1],
      sweep: size[2],
      segments: segments,
    ),
    MeshShape.mesh => MeshDescription.raw(
      vertices: json.floats('vertices'),
      indices: json.meshIndices('indices'),
    ),
  };
}

PhysicallyBasedMaterial _material(Map<Object?, Object?> json) {
  final tint = _color(json.triple('tint', const [1.0, 1.0, 1.0]));
  final material = PhysicallyBasedMaterial()
    ..baseColorFactor = _color(json.triple('albedo', const [0.8, 0.8, 0.8]))
    ..roughnessFactor = json.number('roughness', 0.5).clamp(0.02, 1.0)
    ..metallicFactor = json.number('metallic', 0.0)
    ..emissiveFactor = _color(json.triple('emissive', const [0.0, 0.0, 0.0]))
    // The tracer shades every surface two-sided, and no mesh here is wound for
    // culling under the frame's own projection.
    ..doubleSided = true;

  return switch (_kinds[json['kind']] ?? MaterialKind.opaque) {
    MaterialKind.opaque || MaterialKind.foliage => material,
    MaterialKind.mirror =>
      material
        ..baseColorFactor = tint
        ..metallicFactor = 1.0
        ..roughnessFactor = _mirrorRoughness,
    // Volume attenuation needs a thickness this scene format never carries, so
    // the tint has to ride on the base colour to show up at all.
    MaterialKind.glass || MaterialKind.water =>
      material
        ..baseColorFactor = tint
        ..transmission = 1.0
        ..ior = json.number('ior', 1.45)
        ..roughnessFactor = _refractiveRoughness,
  };
}

DirectionalLight _sun(Map<Object?, Object?> json) => DirectionalLight(
  direction: _direction(json.triple('direction', const [-0.4, -1.0, -0.35])),
  color: vm.Vector3.array(json.triple('color', const [1.0, 0.96, 0.9])),
  intensity: json.number('intensity', 4.0),
  // Cascades cost a depth pass per cascade, and every scene here is lit by its
  // own emitters with the sun turned almost off.
  castsShadow: false,
  angularRadius: json.number('angularRadius', 0.03),
);

GradientSkySource _sky(Map<Object?, Object?> json, DirectionalLight sun) =>
    GradientSkySource(
      zenithColor: vm.Vector3.array(
        json.triple('zenith', const [0.09, 0.16, 0.32]),
      ),
      horizonColor: vm.Vector3.array(
        json.triple('horizon', const [0.42, 0.48, 0.58]),
      ),
      groundColor: vm.Vector3.array(
        json.triple('ground', const [0.06, 0.06, 0.07]),
      ),
      sunDirection: -sun.direction,
      sunColor: sun.color * sun.intensity,
    );

({vm.Vector3 color, double density, double scattering}) _fog(
  Map<Object?, Object?> json,
) => (
  color: vm.Vector3.array(json.triple('color', const [0.0, 0.0, 0.0])),
  density: json.number('density', 0.0),
  scattering: json.number('scattering', 0.0),
);

vm.Vector3 _direction(List<double> values) {
  final direction = vm.Vector3.array(values);
  final length = direction.length;

  return length == 0 ? DirectionalLight.defaultDirection : direction / length;
}

vm.Vector4 _color(List<double> values) =>
    vm.Vector4(values[0], values[1], values[2], 1.0);
