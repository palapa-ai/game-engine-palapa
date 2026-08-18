import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:game_engine/game_engine.dart';

class CityWalk extends ChangeNotifier {
  static final _bindings = {
    LogicalKeyboardKey.keyW: Movement.forward,
    LogicalKeyboardKey.arrowUp: Movement.forward,
    LogicalKeyboardKey.keyS: Movement.back,
    LogicalKeyboardKey.arrowDown: Movement.back,
    LogicalKeyboardKey.keyA: Movement.left,
    LogicalKeyboardKey.arrowLeft: Movement.left,
    LogicalKeyboardKey.keyD: Movement.right,
    LogicalKeyboardKey.arrowRight: Movement.right,
    LogicalKeyboardKey.space: Movement.up,
    LogicalKeyboardKey.controlLeft: Movement.down,
    LogicalKeyboardKey.controlRight: Movement.down,
    LogicalKeyboardKey.shiftLeft: Movement.sprint,
    LogicalKeyboardKey.shiftRight: Movement.sprint,
  };

  final _engine = GameEngine();
  SceneDocument? _document;
  final _camera = FreeLookCamera();
  final _held = <Movement>{};

  GameLoop? _loop;
  StreamSubscription<Offset>? _mouse;
  bool captured = false;
  Size _size = Size.zero;
  double _pixelRatio = 2;
  bool _configuring = false;

  EngineStatus? status;
  double fps = 0;
  RenderSettings settings = const RenderSettings();

  double _fpsAccumulator = 0;
  int _fpsSamples = 0;
  double _sinceReadout = 0;
  EngineStatus? _pending;

  int? get textureId => _engine.textureId;
  Vec3 get position => _camera.position;

  Future<void> load() async {
    final source = await rootBundle.loadString(
      'packages/game_engine/assets/cornell.yaml',
    );
    final document = SceneDocument.parse(source);
    _document = document;
    settings = document.settings;
    _camera.placeAt(document.camera);
    notifyListeners();
  }

  Future<void> resize(Size size, double pixelRatio) async {
    final unchanged =
        (size.width - _size.width).abs() < 4 &&
        (size.height - _size.height).abs() < 4 &&
        pixelRatio == _pixelRatio;
    if (unchanged || _configuring) return;
    _size = size;
    _pixelRatio = pixelRatio;
    await _start();
  }

  void look(Offset delta) => _camera.look(delta);

  Future<void> setCaptured(bool value) async {
    if (value == captured) return;
    captured = await _engine.setMouseCaptured(value);
    _mouse ??= _engine.mouseDeltas.listen(_camera.look);
    if (!captured) {
      await _mouse?.cancel();
      _mouse = null;
    }
    notifyListeners();
  }

  KeyEventResult handleKey(KeyEvent event) {
    if (event is KeyDownEvent) {
      final shortcut = {
        LogicalKeyboardKey.escape: () => setCaptured(false),
        LogicalKeyboardKey.digit1: cycleResolution,
        LogicalKeyboardKey.digit2: cycleUpscaler,
        LogicalKeyboardKey.digit3: toggleFrameGen,
        LogicalKeyboardKey.digit4: cycleBounces,
        LogicalKeyboardKey.digit5: cycleSamples,
        LogicalKeyboardKey.digit6: toggleVolumetrics,
        LogicalKeyboardKey.digit7: toggleSoftShadows,
      }[event.logicalKey];
      if (shortcut != null) {
        shortcut();
        return KeyEventResult.handled;
      }
    }
    final movement = _bindings[event.logicalKey];
    if (movement == null) return KeyEventResult.ignored;
    event is KeyUpEvent ? _held.remove(movement) : _held.add(movement);
    return KeyEventResult.handled;
  }

  @override
  void dispose() {
    _mouse?.cancel();
    _engine.setMouseCaptured(false);
    _loop?.dispose();
    _engine.stop();
    super.dispose();
  }

  Future<void> _start() async {
    if (_document == null) await load();
    _configuring = true;
    final width = (_size.width * _pixelRatio).round();
    final height = (_size.height * _pixelRatio).round();
    status = _loop == null
        ? await _engine.start(width: width, height: height, settings: settings)
        : await _engine.configure(
            width: width,
            height: height,
            settings: settings,
          );
    final document = _document;
    if (document != null && _loop == null) {
      await _engine.setScene(document.scene);
      _loop = GameLoop(_tick)..start();
    }
    _configuring = false;
    notifyListeners();
  }

  void _tick(double deltaSeconds) {
    _camera.advance(deltaSeconds, _held);
    _engine
        .submit(
          GameFrame(
            camera: _camera.camera,
            transforms: _document?.transforms ?? const [],
            aspectRatio: _size.isEmpty ? 1.6 : _size.width / _size.height,
            deltaSeconds: deltaSeconds,
          ),
        )
        .then((next) {
          if (next != null) _pending = next;
        });

    _fpsAccumulator += 1 / deltaSeconds;
    _fpsSamples++;
    _sinceReadout += deltaSeconds;
    if (_sinceReadout < 0.5) return;
    fps = _fpsAccumulator / _fpsSamples;
    status = _pending ?? status;
    _fpsAccumulator = 0;
    _fpsSamples = 0;
    _sinceReadout = 0;
    notifyListeners();
  }

  static const _resolutions = [320, 640, 1280, 1920];
  static const _sampleCounts = [1, 2, 4, 8];
  static const _bounceCounts = [1, 2, 3, 4, 6, 8];

  T _next<T>(List<T> values, T current) =>
      values[(values.indexOf(current) + 1) % values.length];

  Future<void> cycleResolution() => _apply(
    settings.copyWith(renderWidth: _next(_resolutions, settings.renderWidth)),
  );

  Future<void> cycleUpscaler() => _apply(
    settings.copyWith(upscaler: _next(Upscaler.values, settings.upscaler)),
  );

  Future<void> toggleFrameGen() => _apply(
    settings.copyWith(frameInterpolation: !settings.frameInterpolation),
  );

  Future<void> cycleBounces() => _apply(
    settings.copyWith(bounceRays: _next(_bounceCounts, settings.bounceRays)),
  );

  Future<void> cycleSamples() => _apply(
    settings.copyWith(samples: _next(_sampleCounts, settings.samples)),
  );

  Future<void> toggleVolumetrics() =>
      _apply(settings.copyWith(volumetrics: !settings.volumetrics));

  Future<void> toggleSoftShadows() =>
      _apply(settings.copyWith(softShadows: !settings.softShadows));

  Future<void> _apply(RenderSettings next) async {
    settings = next;
    notifyListeners();
    await _start();
  }
}
