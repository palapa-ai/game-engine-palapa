enum UpscalingMode { denoised, temporal, off }

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
    required this.deviceName,
    required this.interpolated,
    required this.lightCount,
    required this.bounces,
  });

  factory EngineStatus.fromJson(Map<String, dynamic> json) => EngineStatus(
    textureId: json['textureId'] as int?,
    upscaling: UpscalingMode.values.firstWhere(
      (mode) => mode.name == json['upscaling'],
      orElse: () => UpscalingMode.off,
    ),
    frameInterpolation: json['frameInterpolation'] as bool? ?? false,
    renderWidth: json['renderWidth'] as int? ?? 0,
    renderHeight: json['renderHeight'] as int? ?? 0,
    outputWidth: json['outputWidth'] as int? ?? 0,
    outputHeight: json['outputHeight'] as int? ?? 0,
    gpuMilliseconds: (json['gpuMilliseconds'] as num? ?? 0).toDouble(),
    deviceName: json['deviceName'] as String? ?? '',
    interpolated: json['interpolated'] as bool? ?? false,
    lightCount: json['lightCount'] as int? ?? 0,
    bounces: json['bounces'] as int? ?? 1,
  );

  final int? textureId;
  final UpscalingMode upscaling;
  final bool frameInterpolation;
  final int renderWidth;
  final int renderHeight;
  final int outputWidth;
  final int outputHeight;
  final double gpuMilliseconds;
  final String deviceName;
  final bool interpolated;
  final int lightCount;
  final int bounces;

  String get resolutionLabel =>
      '${renderWidth}x$renderHeight → ${outputWidth}x$outputHeight';

  /// One camera ray, then per bounce a continuation plus a sun and a lamp
  /// shadow ray — what the trace kernel casts for every pixel it shades.
  int get raysPerFrame => renderWidth * renderHeight * (1 + 3 * (bounces + 1));
}
