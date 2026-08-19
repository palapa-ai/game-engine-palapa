import 'package:flutter/scheduler.dart';

class GameLoop {
  GameLoop(this.onTick);

  final void Function(double deltaSeconds) onTick;

  /// Frames per second to aim for, or zero to run at the display's rate.
  /// Capping hands the spare milliseconds back to the tracer, which is how
  /// you trade frame rate for samples.
  int targetRate = 0;

  Ticker? _ticker;
  Duration _last = Duration.zero;
  double _pending = 0;

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

    if (targetRate <= 0) {
      onTick(delta.clamp(1 / 240, 1 / 15));
      return;
    }
    _pending += delta;
    if (_pending < 1 / targetRate) return;
    final accumulated = _pending;
    _pending = 0;
    onTick(accumulated.clamp(1 / 240, 1 / 15));
  }
}
