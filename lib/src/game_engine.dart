import 'package:flutter/services.dart';
import 'package:game_engine/src/engine_status.dart';
import 'package:game_engine/src/game_frame.dart';
import 'package:game_engine/src/game_scene.dart';
import 'package:game_engine/src/render_settings.dart';

class GameEngine {
  static const _channel = MethodChannel('palapa/game_engine');
  static const _mouse = EventChannel('palapa/game_engine/mouse');

  /// Raw pointer deltas while the mouse is captured; Flutter's own pointer
  /// stream goes still because the cursor is unpinned from the display.
  Stream<Offset> get mouseDeltas => _mouse.receiveBroadcastStream().map((event) {
    final delta = (event as List).cast<double>();
    return Offset(delta[0], delta[1]);
  });

  Future<bool> setMouseCaptured(bool captured) async =>
      await _channel.invokeMethod<bool>('setMouseCaptured', captured) ?? false;

  int? _textureId;
  bool _submitting = false;

  int? get textureId => _textureId;

  Future<EngineStatus?> start({
    required int width,
    required int height,
    RenderSettings settings = const RenderSettings(),
  }) async {
    final status = await _invoke('create', {
      'width': width,
      'height': height,
      'settings': settings.toJson(),
    });
    _textureId = status?.textureId ?? _textureId;
    return status;
  }

  Future<EngineStatus?> configure({
    required int width,
    required int height,
    required RenderSettings settings,
  }) => _invoke('configure', {
    'width': width,
    'height': height,
    'settings': settings.toJson(),
  });

  Future<bool> setScene(GameScene scene) async =>
      await _channel.invokeMethod<bool>('setScene', scene.toJson()) ?? false;

  /// Drops the frame when the previous one is still in flight — the renderer
  /// paces itself and a queued backlog would only add latency.
  Future<EngineStatus?> submit(GameFrame frame) async {
    if (_submitting) return null;
    _submitting = true;
    try {
      return await _invoke('frame', frame.toJson());
    } finally {
      _submitting = false;
    }
  }

  Future<void> stop() async {
    _textureId = null;
    await _channel.invokeMethod<void>('dispose');
  }

  Future<EngineStatus?> _invoke(
    String method,
    Map<String, dynamic> arguments,
  ) async {
    final response = await _channel.invokeMapMethod<String, dynamic>(
      method,
      arguments,
    );
    return response == null ? null : EngineStatus.fromJson(response);
  }
}
