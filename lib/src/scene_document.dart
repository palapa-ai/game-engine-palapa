import 'dart:math' as math;
import 'dart:typed_data';

import 'package:game_engine_palapa/src/game_camera.dart';
import 'package:game_engine_palapa/src/game_scene.dart';
import 'package:game_engine_palapa/src/blink.dart';
import 'package:game_engine_palapa/src/instance_animation.dart';
import 'package:game_engine_palapa/src/render_settings.dart';
import 'package:game_engine_palapa/src/sway.dart';
import 'package:game_engine_palapa/src/vec3.dart';
import 'package:vector_math/vector_math_64.dart';
import 'package:yaml/yaml.dart';

/// A whole world — geometry, materials, lighting, camera and render defaults —
/// read from one YAML document. `groups` are reusable sub-assemblies and
/// `mirror` stamps a placement across the x and z axes, which is what keeps a
/// symmetric building a few lines instead of a few hundred.
class SceneDocument {
  SceneDocument.parse(String source) : this._(loadYaml(source) as YamlMap);

  SceneDocument._(YamlMap root)
    : name = root['name'] as String? ?? 'scene',
      camera = _camera(root['camera'] as YamlMap?),
      settings = _settings(root['render'] as YamlMap?),
      _minimum = _color((root['camera'] as YamlMap?)?['minimum']),
      _maximum = _color((root['camera'] as YamlMap?)?['maximum']) {
    final meshNames = <String>[];
    (root['meshes'] as YamlMap?)?.forEach((key, value) {
      meshNames.add(key as String);
      meshes.add(_mesh(value as YamlMap));
    });
    _meshIndex.addAll(
      meshNames.asMap().map((index, name) => MapEntry(name, index)),
    );

    (root['materials'] as YamlMap?)?.forEach(
      (key, value) => _materials[key as String] = _material(value as YamlMap),
    );
    (root['groups'] as YamlMap?)?.forEach(
      (key, value) =>
          _groups[key as String] = (value as YamlList).cast<YamlMap>(),
    );

    _scene = GameScene(
      meshes: meshes,
      instances: instances,
      sun: _sun(root['sun'] as YamlMap?),
      sky: _sky(root['sky'] as YamlMap?),
      fog: _fog(root['fog'] as YamlMap?),
    );

    (root['objects'] as YamlList? ?? YamlList()).cast<YamlMap>().forEach(
      (object) => _place(object, Matrix4.identity()),
    );
  }

  final String name;
  final GameCamera camera;
  Vec3? get minimum => _minimum;
  Vec3? get maximum => _maximum;
  final RenderSettings settings;
  final List<MeshDescription> meshes = [];
  final List<GameInstance> instances = [];
  final List<Matrix4> transforms = [];
  final Map<int, InstanceAnimation> _animations = {};

  /// Instance transforms for one moment; anything without a `sway` is the
  /// matrix the document was parsed with.
  List<Matrix4> transformsAt(double seconds) => _animations.isEmpty
      ? transforms
      : transforms
            .asMap()
            .entries
            .map(
              (entry) =>
                  _animations[entry.key]?.apply(entry.value, seconds) ??
                  entry.value,
            )
            .toList(growable: false);

  final Vec3? _minimum;
  final Vec3? _maximum;
  final Map<String, int> _meshIndex = {};
  final Map<String, GameMaterial> _materials = {};
  final Map<String, List<YamlMap>> _groups = {};
  late final GameScene _scene;

  GameScene get scene => _scene;

  void _place(YamlMap object, Matrix4 parent) {
    final mirror =
        (object['mirror'] as YamlList?)?.cast<String>() ?? const <String>[];
    final signsX = mirror.contains('x') ? const [1.0, -1.0] : const [1.0];
    final signsZ = mirror.contains('z') ? const [1.0, -1.0] : const [1.0];

    for (final signX in signsX) {
      for (final signZ in signsZ) {
        final position = _vector(object['position']) ?? Vector3.zero();
        final rotation = _vector(object['rotation']) ?? Vector3.zero();
        final scale = _vector(object['scale']) ?? Vector3.all(1);
        final local =
            Matrix4.translationValues(
                position.x * signX,
                position.y,
                position.z * signZ,
              )
              ..rotateY(_radians(rotation.y) * signX * signZ)
              ..rotateX(_radians(rotation.x))
              ..rotateZ(_radians(rotation.z));
        final world = parent.multiplied(local);

        final group = object['group'] as String?;
        if (group != null) {
          _groups[group]?.forEach((child) => _place(child, world));
          continue;
        }

        final mesh = _meshIndex[object['mesh'] as String? ?? ''];
        final material = _materials[object['material'] as String? ?? ''];
        if (mesh == null || material == null) continue;
        final animation =
            _sway(object['sway'] as YamlMap?) ??
            _blink(object['blink'] as YamlMap?);
        if (animation != null) _animations[instances.length] = animation;
        instances.add(GameInstance(meshIndex: mesh, material: material));
        transforms.add(world..scaleByDouble(scale.x, scale.y, scale.z, 1));
      }
    }
  }

  static MeshDescription _mesh(YamlMap json) {
    final segments = json['segments'] as int? ?? 24;
    return switch (json['shape'] as String? ?? 'box') {
      'plane' => MeshDescription.plane(
        _number(json['width']) ?? 1,
        _number(json['depth']) ?? 1,
      ),
      'sphere' => MeshDescription.sphere(
        _number(json['radius']) ?? 0.5,
        segments: segments,
      ),
      'pyramid' => MeshDescription.pyramid(1, 1),
      'frustum' => MeshDescription.frustum(1, 1, _number(json['top']) ?? 0.6),
      'cylinder' => MeshDescription.cylinder(segments: segments),
      'cone' => MeshDescription.cone(segments: segments),
      'dish' => MeshDescription.dish(
        _number(json['diameter']) ?? 1,
        _number(json['depth']) ?? 0.3,
        segments: segments,
      ),
      'sleeve' => MeshDescription.sleeve(
        _number(json['diameter']) ?? 1,
        _number(json['height']) ?? 1,
        sweep: _number(json['sweep']) ?? 360,
        segments: segments,
      ),
      'ring' => MeshDescription.ring(
        _number(json['diameter']) ?? 1,
        _number(json['tube']) ?? 0.2,
        segments: segments,
      ),
      'mesh' => MeshDescription.raw(
        vertices: Float32List.fromList(_numbers(json['vertices'])),
        indices: Uint32List.fromList(
          _numbers(json['indices']).map((value) => value.round()).toList(),
        ),
      ),
      _ => const MeshDescription.box(Vec3(1, 1, 1)),
    };
  }

  static GameMaterial _material(YamlMap json) => GameMaterial(
    albedo: _color(json['albedo']) ?? const Vec3(0.8, 0.8, 0.8),
    roughness: _number(json['roughness']) ?? 0.7,
    metallic: _number(json['metallic']) ?? 0,
    emissive: _color(json['emissive']) ?? Vec3.zero,
    kind: MaterialKind.values.firstWhere(
      (kind) => kind.name == json['kind'],
      orElse: () => .opaque,
    ),
    tint: _color(json['tint']) ?? const Vec3(1, 1, 1),
    ior: _number(json['ior']) ?? 1.45,
    animated: json['animated'] as bool? ?? false,
  );

  static SunLight _sun(YamlMap? json) => SunLight(
    direction: _color(json?['direction']) ?? const Vec3(-0.35, -0.7, -0.3),
    color: _color(json?['color']) ?? const Vec3(1, 0.96, 0.9),
    intensity: _number(json?['intensity']) ?? 4,
    angularRadius: _number(json?['angularRadius']) ?? 0.03,
  );

  static SkyGradient _sky(YamlMap? json) => SkyGradient(
    zenith: _color(json?['zenith']) ?? const Vec3(0.09, 0.16, 0.32),
    horizon: _color(json?['horizon']) ?? const Vec3(0.42, 0.48, 0.58),
    ground: _color(json?['ground']) ?? const Vec3(0.06, 0.06, 0.07),
  );

  static Fog _fog(YamlMap? json) => Fog(
    color: _color(json?['color']) ?? Vec3.zero,
    density: _number(json?['density']) ?? 0,
    scattering: _number(json?['scattering']) ?? 0,
  );

  static GameCamera _camera(YamlMap? json) {
    final position = _color(json?['position']) ?? const Vec3(0, 6, 60);
    final yaw = _radians(_number(json?['yaw']) ?? -90);
    final pitch = _radians(_number(json?['pitch']) ?? 0);
    final forward = Vec3(
      math.cos(yaw) * math.cos(pitch),
      math.sin(pitch),
      math.sin(yaw) * math.cos(pitch),
    );
    return GameCamera(
      position: position,
      target: position + forward,
      fieldOfView: _radians(_number(json?['fieldOfView']) ?? 66),
    );
  }

  static RenderSettings _settings(YamlMap? json) => RenderSettings(
    resolution: _resolution(json?['resolution'], .p640),
    requestedUpscale: _resolution(json?['upscaled'], .p1080),
    bounceRays: json?['bounces'] as int? ?? 2,
    samples: json?['samples'] as int? ?? 1,
    upscaler: Upscaler.values.firstWhere(
      (mode) => mode.name == json?['upscaler'],
      orElse: () => .denoised,
    ),
    frameInterpolation: json?['frameGeneration'] as bool? ?? true,
    exposure: _number(json?['exposure']) ?? 1,
  );

  static Sway? _sway(YamlMap? json) => json == null
      ? null
      : Sway(
          drift: _color(json['drift']) ?? Vec3.zero,
          speed: _number(json['speed']) ?? 5,
          pulse: _number(json['pulse']) ?? 0,
          pulseSpeed: _number(json['pulseSpeed']) ?? 9,
        );

  static Blink? _blink(YamlMap? json) => json == null
      ? null
      : Blink(
          period: _number(json['period']) ?? 6,
          from: _number(json['from']) ?? 0,
          to: _number(json['to']) ?? 1,
        );

  static Resolution _resolution(dynamic value, Resolution fallback) =>
      Resolution.values.firstWhere(
        (size) => size.label.toLowerCase() == '$value'.toLowerCase(),
        orElse: () => fallback,
      );

  static double _radians(double degrees) => degrees * math.pi / 180;

  static double? _number(Object? value) => (value as num?)?.toDouble();

  static List<double> _numbers(Object? value) => value is YamlList
      ? value.cast<num>().map((number) => number.toDouble()).toList()
      : const [];

  static Vec3? _color(Object? value) {
    if (value is! YamlList) return null;
    final values = value
        .cast<num>()
        .map((number) => number.toDouble())
        .toList();
    return Vec3(values[0], values[1], values[2]);
  }

  static Vector3? _vector(Object? value) {
    final color = _color(value);
    return color == null ? null : Vector3(color.x, color.y, color.z);
  }
}
