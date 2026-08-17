import 'package:flutter/scheduler.dart';

class GameLoop {
  GameLoop(this.onTick);

  final void Function(double deltaSeconds) onTick;

  Ticker? _ticker;
  Duration _last = Duration.zero;

  bool get isRunning => _ticker?.isActive ?? false;

  void start() {
    if (isRunning) return;
    _last = Duration.zero;
    final ticker = _ticker ?? Ticker(_tick);
    _ticker = ticker;
    ticker.start();
  }

  void stop() => _ticker?.stop();

  void dispose() {
    _ticker?.dispose();
    _ticker = null;
  }

  void _tick(Duration elapsed) {
    final delta = _last == Duration.zero
        ? 1 / 60
        : (elapsed - _last).inMicroseconds / Duration.microsecondsPerSecond;
    _last = elapsed;
    onTick(delta.clamp(1 / 240, 1 / 15));
  }
}
