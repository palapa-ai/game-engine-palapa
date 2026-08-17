class RenderSettings {
  const RenderSettings({
    this.renderScale = 0.6,
    this.bounceRays = 1,
    this.upscaling = true,
    this.denoising = true,
    this.frameInterpolation = false,
    this.exposure = 1.0,
  });

  final double renderScale;
  final int bounceRays;
  final bool upscaling;
  final bool denoising;
  final bool frameInterpolation;
  final double exposure;

  RenderSettings copyWith({
    double? renderScale,
    int? bounceRays,
    bool? upscaling,
    bool? denoising,
    bool? frameInterpolation,
    double? exposure,
  }) => RenderSettings(
    renderScale: renderScale ?? this.renderScale,
    bounceRays: bounceRays ?? this.bounceRays,
    upscaling: upscaling ?? this.upscaling,
    denoising: denoising ?? this.denoising,
    frameInterpolation: frameInterpolation ?? this.frameInterpolation,
    exposure: exposure ?? this.exposure,
  );

  Map<String, dynamic> toJson() => {
    'renderScale': renderScale,
    'bounceRays': bounceRays,
    'upscaling': upscaling,
    'denoising': denoising,
    'frameInterpolation': frameInterpolation,
    'exposure': exposure,
  };
}
