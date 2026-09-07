import 'package:flutter/services.dart';
import 'package:flutter_web_plugins/flutter_web_plugins.dart';
import 'package:game_engine_palapa/src/web/web_game_engine.dart';

class GameEngineWebPlugin {
  static void registerWith(Registrar registrar) {
    const codec = StandardMethodCodec();
    final plugin = GameEngineWebPlugin();

    MethodChannel(
      'palapa/game_engine',
      codec,
      registrar,
    ).setMethodCallHandler(plugin._handle);

    // Raw mouse deltas have no web counterpart, but answering listen and cancel
    // keeps the event channel from reporting a missing plugin.
    MethodChannel(
      'palapa/game_engine/mouse',
      codec,
      registrar,
    ).setMethodCallHandler((call) async => null);
  }

  WebGameEngine? _engine;
  Future<WebGameEngine>? _creating;

  Future<Object?> _handle(MethodCall call) async {
    if (call.method == 'setMouseCaptured') return false;

    final arguments = call.arguments is Map
        ? (call.arguments as Map).cast<Object?, Object?>()
        : const <Object?, Object?>{};
    final engine = _engine;

    return switch (call.method) {
      'create' => await _create(arguments),
      'configure' => engine?.configure(arguments),
      'setScene' => engine?.setScene(arguments) ?? false,
      'frame' => engine?.frame(arguments),
      'dispose' => _dispose(),
      _ => throw MissingPluginException(
        '${call.method} is not implemented on the web',
      ),
    };
  }

  /// Two overlapping creates would each build a Scene and leak the loser's
  /// GPU buffers, so the first one in flight is the one everybody waits on.
  Future<Map<String, Object?>> _create(Map<Object?, Object?> arguments) async {
    final creating = _creating ??= WebGameEngine.create(arguments);
    final engine = _engine ?? await creating;
    _engine = engine;

    return {...engine.configure(arguments), 'textureId': engine.surfaceId};
  }

  Object? _dispose() {
    _engine?.dispose();
    _engine = null;
    _creating = null;

    return null;
  }
}
