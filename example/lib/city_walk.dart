import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:game_engine/game_engine.dart';
import 'package:palapa_game_engine/toggles.dart';

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
  double generatedFps = 0;
  RenderSettings settings = const RenderSettings();

  int _traced = 0;
  int _presented = 0;
  double _sinceReadout = 0;
  double _elapsed = 0;

  /// A resize that landed mid-configure; dropping it strands the engine at the
  /// old surface size and the window renders letterboxed.
  Size? _requestedSize;
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
    _camera.constrainTo(document.minimum, document.maximum);
    notifyListeners();
  }

  Future<void> resize(Size size, double pixelRatio) async {
    final unchanged =
        (size.width - _size.width).abs() < 4 &&
        (size.height - _size.height).abs() < 4 &&
        pixelRatio == _pixelRatio;
    if (unchanged) return;
    if (_configuring) {
      _requestedSize = size;
      return;
    }
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
        LogicalKeyboardKey.digit1: () => cycleResolution(1),
        LogicalKeyboardKey.digit2: () => cycleUpscaled(1),
        LogicalKeyboardKey.digit3: () => cycleUpscaler(1),
        LogicalKeyboardKey.digit4: toggleFrameGen,
        LogicalKeyboardKey.digit5: () => cycleBounces(1),
        LogicalKeyboardKey.digit6: () => cycleSamples(1),
        LogicalKeyboardKey.digit7: () => cycleFrameRate(1),
        LogicalKeyboardKey.digit8: () => cycleProjection(1),
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
    final requested = _requestedSize;
    _requestedSize = null;
    if (requested != null) await resize(requested, _pixelRatio);
  }

  void _tick(double deltaSeconds) {
    _camera.advance(deltaSeconds, _held);
    _engine
        .submit(
          GameFrame(
            camera: _camera.camera,
            transforms: _document?.transformsAt(_elapsed) ?? const [],
            aspectRatio: _size.isEmpty ? 1.6 : _size.width / _size.height,
            deltaSeconds: deltaSeconds,
          ),
        )
        .then((next) {
          if (next == null) return;
          _pending = next;
          _presented++;
          if (next.traced) {
            _traced++;
            totalRays += next.raysPerFrame.toDouble();
          }
        });

    // Standing still leaves the scene where it is, so every further frame is
    // another sample of one picture rather than the next picture.
    if (_camera.moved) _elapsed += deltaSeconds;
    _sinceReadout += deltaSeconds;
    if (_sinceReadout < 0.5) return;
    fps = _traced / _sinceReadout;
    generatedFps = _presented / _sinceReadout;
    status = _pending ?? status;
    _traced = 0;
    _presented = 0;
    _sinceReadout = 0;
    notifyListeners();
  }

  static const _sampleCounts = [1, 2, 4, 8, 16, 32, 64];
  static const _frameRates = [0, 120, 60, 30];
  static const _bounceCounts = [1, 2, 4, 8, 16];

  T _next<T>(List<T> values, T current, int step) =>
      values[(values.indexOf(current) + step) % values.length];

  Future<void> cycleResolution(int step) => _apply(
    settings.copyWith(
      resolution: _next(Resolution.values, settings.resolution, step),
    ),
  );

  Projection get projection => _camera.projection;

  void cycleProjection(int step) {
    _camera.projection = _next(Projection.values, _camera.projection, step);
    notifyListeners();
  }

  Future<void> cycleUpscaled(int step) => _apply(
    settings.copyWith(
      upscaled: _next(settings.upscales.toList(), settings.upscaled, step),
    ),
  );

  Future<void> cycleUpscaler(int step) => _apply(
    settings.copyWith(
      upscaler: _next(Upscaler.values, settings.upscaler, step),
    ),
  );

  Future<void> toggleFrameGen() => _apply(
    settings.copyWith(frameInterpolation: !settings.frameInterpolation),
  );

  Future<void> cycleBounces(int step) => _apply(
    settings.copyWith(
      bounceRays: _next(_bounceCounts, settings.bounceRays, step),
    ),
  );

  int targetRate = 0;
  RayMode rayMode = RayMode.perFrame;
  double totalRays = 0;

  void cycleRayMode(int step) {
    rayMode = _next(RayMode.values, rayMode, step);
    notifyListeners();
  }

  void cycleFrameRate(int step) {
    targetRate = _next(_frameRates, targetRate, step);
    _loop?.targetRate = targetRate;
    notifyListeners();
  }

  Future<void> cycleSamples(int step) => _apply(
    settings.copyWith(samples: _next(_sampleCounts, settings.samples, step)),
  );

  Future<void> _apply(RenderSettings next) async {
    if (_configuring) return;
    settings = next;
    notifyListeners();
    await _start();
  }
}
