enum UpscalingMode { denoised, temporal, spatial, off }

class EngineStatus {
  const EngineStatus({
    required this.textureId,
    required this.upscaling,
    required this.frameInterpolation,
    required this.renderWidth,
    required this.renderHeight,
    required this.outputWidth,
    required this.outputHeight,
    required this.gpuMilliseconds,
    required this.traceMilliseconds,
    required this.deviceName,
    required this.interpolated,
    required this.traced,
    required this.lightCount,
    required this.bounces,
    required this.samples,
    required this.accumulated,
  });

  factory EngineStatus.fromJson(Map<String, dynamic> json) => EngineStatus(
    textureId: json['textureId'] as int?,
    upscaling: UpscalingMode.values.firstWhere(
      (mode) => mode.name == json['upscaling'],
      orElse: () => .off,
    ),
    frameInterpolation: json['frameInterpolation'] as bool? ?? false,
    renderWidth: json['renderWidth'] as int? ?? 0,
    renderHeight: json['renderHeight'] as int? ?? 0,
    outputWidth: json['outputWidth'] as int? ?? 0,
    outputHeight: json['outputHeight'] as int? ?? 0,
    gpuMilliseconds: (json['gpuMilliseconds'] as num? ?? 0).toDouble(),
    traceMilliseconds: (json['traceMilliseconds'] as num? ?? 0).toDouble(),
    deviceName: json['deviceName'] as String? ?? '',
    interpolated: json['interpolated'] as bool? ?? false,
    traced: json['traced'] as bool? ?? true,
    lightCount: json['lightCount'] as int? ?? 0,
    bounces: json['bounces'] as int? ?? 1,
    samples: json['samples'] as int? ?? 1,
    accumulated: json['accumulated'] as int? ?? 0,
  );

  final int? textureId;
  final UpscalingMode upscaling;
  final bool frameInterpolation;
  final int renderWidth;
  final int renderHeight;
  final int outputWidth;
  final int outputHeight;
  final double gpuMilliseconds;

  /// Time for a frame that actually traced, as opposed to one MetalFX
  /// generated — those cost almost nothing and flatter the average.
  final double traceMilliseconds;
  final String deviceName;
  final bool interpolated;
  final bool traced;
  final int lightCount;
  final int bounces;
  final int samples;

  /// Samples of the same still frame averaged so far; zero while anything moves.
  final int accumulated;

  String get resolutionLabel =>
      '${renderWidth}x$renderHeight → ${outputWidth}x$outputHeight';

  /// One camera ray, then per bounce a continuation plus a sun and a lamp
  /// shadow ray — what the trace kernel casts for every pixel it shades.
  int get raysPerFrame =>
      renderWidth * renderHeight * samples * (1 + 3 * (bounces + 1));
}
