import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' show Size;

import 'package:flutter_scene/scene.dart';
import 'package:game_engine_palapa/src/web/json_values.dart';
import 'package:game_engine_palapa/src/web/web_scene_builder.dart';
import 'package:vector_math/vector_math.dart' as vm;

const _deviceName = 'flutter_scene WebGL2';
const _minimumSize = 16;
const _minimumPixelRatio = 0.25;
const _maximumPixelRatio = 2.0;

/// Frames to watch before deciding which instances are scenery. Anything with
/// a sway or a blink has moved several times over by then.
const _settleFrames = 20;

class WebGameEngine {
  WebGameEngine._(this.surfaceId, this.scene, this._configuration) {
    scene.toneMapping = ToneMappingMode.aces;
    scene.exposure = _configuration.exposure;
    _engines[surfaceId] = this;
  }

  static final Map<int, WebGameEngine> _engines = {};
  static int _nextSurfaceId = 1;

  static Future<WebGameEngine> create(Map<Object?, Object?> arguments) async {
    await Scene.initializeStaticResources();

    return WebGameEngine._(
      _nextSurfaceId++,
      Scene(),
      _Configuration.fromJson(arguments),
    );
  }

  static WebGameEngine? forSurface(int? surfaceId) =>
      surfaceId == null ? null : _engines[surfaceId];

  final int surfaceId;
  final Scene scene;

  final _clock = Stopwatch()..start();
  _Configuration _configuration;
  WebScene? _built;
  Float32List? _previousTransforms;
  final _moving = <int>{};
  var _framesSeen = 0;
  var _compacted = false;
  Camera _camera = PerspectiveCamera();
  double _frameMilliseconds = 0;
  Size? _logical;

  Camera get camera => _camera;

  /// Renders at the tracer resolution the settings asked for and lets the
  /// compositor stretch it, which is what `renderWidth` buys on the web.
  double pixelRatioFor(Size logical) {
    _logical = logical;

    return _renderScale(logical.width);
  }

  double _renderScale(double logicalWidth) =>
      (_configuration.renderWidth / math.max(logicalWidth, 1)).clamp(
        _minimumPixelRatio,
        _maximumPixelRatio,
      );

  Map<String, Object?> configure(Map<Object?, Object?> arguments) {
    _configuration = _Configuration.fromJson(arguments);
    scene.exposure = _configuration.exposure;

    return status;
  }

  bool setScene(Map<Object?, Object?> json) {
    final built = WebScene.fromJson(json);
    _built = built;
    _previousTransforms = null;
    _moving.clear();
    _framesSeen = 0;
    _compacted = false;

    if (built == null) {
      scene.removeAll();
      return false;
    }
    built.applyTo(scene);

    return true;
  }

  Map<String, Object?> frame(Map<Object?, Object?> json) {
    _frameMilliseconds = _clock.elapsedMicroseconds / 1000;
    _clock.reset();

    _camera = _FrameCamera(
      _matrix(json.floats('view'), 0),
      _matrix(json.floats('projection'), 0),
      json.number('near', 0.1),
      json.number('far', 300.0),
    );
    _applyTransforms(json.floats('transforms'));

    return {...status, 'interpolated': false, 'traced': true};
  }

  void dispose() {
    _engines.remove(surfaceId);
    scene.removeAll();
    _built = null;
  }

  /// What the canvas is actually asked for, which the render scale clamp can
  /// pull away from the resolution the settings named.
  Size get _rendered {
    final logical = _logical;
    if (logical == null) {
      return Size(
        _configuration.renderWidth.toDouble(),
        _configuration.renderHeight.toDouble(),
      );
    }
    final scale = _renderScale(logical.width);

    return Size(logical.width * scale, logical.height * scale);
  }

  Map<String, Object?> get status => {
    'upscaling': 'off',
    'frameInterpolation': false,
    'renderWidth': math.max(_rendered.width.round(), _minimumSize),
    'renderHeight': math.max(_rendered.height.round(), _minimumSize),
    'outputWidth': _configuration.outputWidth,
    'outputHeight': _configuration.outputHeight,
    'gpuMilliseconds': _frameMilliseconds,
    'traceMilliseconds': _frameMilliseconds,
    'lightCount': _built?.lamps.length ?? 0,
    'bounces': _configuration.bounces,
    'samples': _configuration.samples,
    'accumulated': 0,
    'drawCalls': scene.root.children.length,
    'deviceName': _deviceName,
  };

  /// A transform array that does not match the instance count is ignored and
  /// the scene keeps the transforms it had, as the host does.
  void _applyTransforms(Float32List packed) {
    final nodes = _built?.nodes ?? const <Node>[];
    if (packed.length ~/ 16 != nodes.length) return;

    for (final (index, node) in nodes.indexed) {
      node.localTransform = _matrix(packed, index * 16);
    }
    for (final lamp in _built?.lamps ?? const <SceneLamp>[]) {
      lamp.follow();
    }

    _noteMovement(packed);
  }

  void _noteMovement(Float32List packed) {
    final previous = _previousTransforms;
    _previousTransforms = Float32List.fromList(packed);
    if (previous == null || previous.length != packed.length) return;

    for (var index = 0; index * 16 < packed.length; index++) {
      if (_moving.contains(index)) continue;
      final base = index * 16;
      final held = [
        for (var slot = 0; slot < 16; slot++)
          packed[base + slot] == previous[base + slot],
      ].every((same) => same);
      if (!held) _moving.add(index);
    }

    _framesSeen++;
    if (_compacted || _framesSeen < _settleFrames) return;

    _compacted = true;
    _built?.compact(scene, _moving, packed);
  }
}

vm.Matrix4 _matrix(Float32List floats, int offset) =>
    floats.length < offset + 16
    ? vm.Matrix4.identity()
    : vm.Matrix4.fromFloat32List(floats.sublist(offset, offset + 16));

/// The frame's own view and projection, handed to flutter_scene verbatim so the
/// web image frames exactly what the traced one does.
class _FrameCamera extends Camera {
  _FrameCamera(vm.Matrix4 view, vm.Matrix4 clip, double near, double far)
    : _view = view,
      _pose = _inverted(view),
      projection = _FrameProjection(clip, near, far);

  final vm.Matrix4 _view;
  final vm.Matrix4 _pose;

  @override
  final CameraProjection projection;

  @override
  vm.Matrix4 getViewMatrix() => _view;

  @override
  vm.Vector3 get position => _pose.getTranslation();

  @override
  vm.Vector3 get forward => -_pose.getColumn(2).xyz.normalized();

  @override
  vm.Vector3 get up => _pose.getColumn(1).xyz.normalized();
}

/// Perspective by inheritance, not just by shape: cascaded shadows, the depth
/// prepass, SSAO, SSR and TAA are all gated on `is PerspectiveProjection`.
class _FrameProjection extends PerspectiveProjection {
  _FrameProjection(this._clip, double near, double far)
    : super(fovRadiansY: _verticalField(_clip), near: near, far: far);

  final vm.Matrix4 _clip;

  /// The matrix already carries the aspect ratio the app framed with, and its
  /// depth range is the host's [0, 1] rather than the jittered lens built here.
  @override
  vm.Matrix4 getProjectionMatrix(double aspectRatio, {vm.Vector2? jitter}) =>
      _clip;
}

/// Read back off the focal length the host baked in, so the lens the shadow
/// cascades are fitted to is the one actually being drawn through.
double _verticalField(vm.Matrix4 clip) {
  final focal = clip.entry(1, 1);

  return focal.abs() < 1e-6
      ? 45 * vm.degrees2Radians
      : 2 * math.atan(1 / focal.abs());
}

vm.Matrix4 _inverted(vm.Matrix4 matrix) {
  final inverse = vm.Matrix4.zero();
  inverse.copyInverse(matrix);

  return inverse;
}

class _Configuration {
  const _Configuration._({
    required this.renderWidth,
    required this.renderHeight,
    required this.outputWidth,
    required this.outputHeight,
    required this.bounces,
    required this.samples,
    required this.exposure,
  });

  factory _Configuration.fromJson(Map<Object?, Object?> json) {
    final settings = json.child('settings');
    final surfaceWidth = math.max(json.integer('width', 640), _minimumSize);
    final surfaceHeight = math.max(json.integer('height', 480), _minimumSize);

    final outputWidth = math.max(
      settings.integer('outputWidth', 1920),
      _minimumSize,
    );
    final outputHeight = math.max(
      (outputWidth * surfaceHeight / surfaceWidth).round(),
      _minimumSize,
    );
    final scale = math.min(
      settings.integer('renderWidth', 640) / outputWidth,
      1.0,
    );

    return _Configuration._(
      renderWidth: math.max((outputWidth * scale).round(), _minimumSize),
      renderHeight: math.max((outputHeight * scale).round(), _minimumSize),
      outputWidth: outputWidth,
      outputHeight: outputHeight,
      bounces: settings.integer('bounceRays', 2),
      samples: math.max(settings.integer('samples', 1), 1),
      exposure: settings.number('exposure', 1.0),
    );
  }

  final int renderWidth;
  final int renderHeight;
  final int outputWidth;
  final int outputHeight;
  final int bounces;
  final int samples;
  final double exposure;
}
