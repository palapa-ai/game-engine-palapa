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
  RenderSettings settings = const RenderSettings(
    renderScale: 0.55,
    frameInterpolation: true,
    bounceRays: 2,
  );

  double _fpsAccumulator = 0;
  int _fpsSamples = 0;
  double _sinceReadout = 0;
  EngineStatus? _pending;

  int? get textureId => _engine.textureId;
  Vec3 get position => _camera.position;

  Future<void> load() async {
    final source = await rootBundle.loadString('packages/game_engine/assets/castle.yaml');
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
    if (event.logicalKey == LogicalKeyboardKey.escape) {
      setCaptured(false);
      return KeyEventResult.handled;
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
    const settings = RenderSettings(
      renderScale: 0.55,
      frameInterpolation: true,
    );

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

  Future<void> cycleScale() => _apply(
    settings.copyWith(
      renderScale: settings.renderScale >= 0.95 ? 0.4 : settings.renderScale + 0.15,
    ),
  );

  Future<void> cycleUpscaler() {
    if (settings.upscaling && settings.denoising) {
      return _apply(settings.copyWith(denoising: false));
    }
    if (settings.upscaling) {
      return _apply(settings.copyWith(upscaling: false, denoising: false));
    }
    return _apply(settings.copyWith(upscaling: true, denoising: true));
  }

  Future<void> toggleFrameGen() =>
      _apply(settings.copyWith(frameInterpolation: !settings.frameInterpolation));

  Future<void> cycleBounces() => _apply(
    settings.copyWith(bounceRays: settings.bounceRays >= 4 ? 1 : settings.bounceRays + 1),
  );

  Future<void> _apply(RenderSettings next) async {
    settings = next;
    notifyListeners();
    await _start();
  }
}
