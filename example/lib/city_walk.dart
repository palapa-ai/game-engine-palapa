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
    LogicalKeyboardKey.keyC: Movement.down,
    LogicalKeyboardKey.shiftLeft: Movement.sprint,
    LogicalKeyboardKey.shiftRight: Movement.sprint,
  };

  final _engine = GameEngine();
  final _city = CityScene();
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

  int? get textureId => _engine.textureId;
  Vec3 get position => _camera.position;

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
    if (_loop == null) {
      await _engine.setScene(_city.scene);
      _loop = GameLoop(_tick)..start();
    }
    _configuring = false;
    notifyListeners();
  }

  void _tick(double deltaSeconds) {
    _camera.advance(deltaSeconds, _held);
    fps = fps * 0.9 + (1 / deltaSeconds) * 0.1;
    _engine
        .submit(
          GameFrame(
            camera: _camera.camera,
            transforms: _city.transforms,
            aspectRatio: _size.isEmpty ? 1.6 : _size.width / _size.height,
            deltaSeconds: deltaSeconds,
          ),
        )
        .then((next) {
          if (next != null) status = next;
        });
    notifyListeners();
  }
}
