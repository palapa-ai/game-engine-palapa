import 'dart:typed_data';

/// Channel payloads arrive as `Map<Object?, Object?>` with every key optional;
/// a missing or wrongly typed entry takes the fallback rather than throwing.
extension JsonValues on Map<Object?, Object?> {
  int integer(Object key, int fallback) {
    final value = this[key];
    return value is int ? value : fallback;
  }

  double number(Object key, double fallback) {
    final value = this[key];
    return value is num ? value.toDouble() : fallback;
  }

  /// Shorter lists zero-fill, matching `SIMD3<Float>([Double])` on the host.
  List<double> triple(Object key, List<double> fallback) {
    final value = this[key];
    if (value is! List) return fallback;

    double at(int index) {
      final entry = index < value.length ? value[index] : null;
      return entry is num ? entry.toDouble() : 0.0;
    }

    return [at(0), at(1), at(2)];
  }

  Map<Object?, Object?> child(Object key) {
    final value = this[key];
    return value is Map ? value.cast<Object?, Object?>() : const {};
  }

  Iterable<Map<Object?, Object?>> children(Object key) {
    final value = this[key];
    return value is List
        ? value.whereType<Map<Object?, Object?>>()
        : const <Map<Object?, Object?>>[];
  }

  Float32List floats(Object key) {
    final value = this[key];
    return value is Float32List ? value : Float32List(0);
  }

  Uint32List meshIndices(Object key) {
    final value = this[key];
    return value is Int32List
        ? Uint32List.fromList([
            for (final index in value) index < 0 ? 0 : index,
          ])
        : Uint32List(0);
  }
}
