enum Upscaler { denoised, temporal, spatial, off }

class RenderSettings {
  const RenderSettings({
    this.renderWidth = 640,
    this.bounceRays = 2,
    this.samples = 1,
    this.upscaler = Upscaler.denoised,
    this.frameInterpolation = false,
    this.volumetrics = true,
    this.softShadows = true,
    this.exposure = 1.0,
  });

  /// Width the tracer actually renders at; MetalFX scales it to the window.
  final int renderWidth;
  final int bounceRays;
  final int samples;
  final Upscaler upscaler;
  final bool frameInterpolation;
  final bool volumetrics;
  final bool softShadows;
  final double exposure;

  RenderSettings copyWith({
    int? renderWidth,
    int? bounceRays,
    int? samples,
    Upscaler? upscaler,
    bool? frameInterpolation,
    bool? volumetrics,
    bool? softShadows,
    double? exposure,
  }) => RenderSettings(
    renderWidth: renderWidth ?? this.renderWidth,
    bounceRays: bounceRays ?? this.bounceRays,
    samples: samples ?? this.samples,
    upscaler: upscaler ?? this.upscaler,
    frameInterpolation: frameInterpolation ?? this.frameInterpolation,
    volumetrics: volumetrics ?? this.volumetrics,
    softShadows: softShadows ?? this.softShadows,
    exposure: exposure ?? this.exposure,
  );

  Map<String, dynamic> toJson() => {
    'renderWidth': renderWidth,
    'bounceRays': bounceRays,
    'samples': samples,
    'upscaler': upscaler.name,
    'frameInterpolation': frameInterpolation,
    'volumetrics': volumetrics,
    'softShadows': softShadows,
    'exposure': exposure,
  };
}
