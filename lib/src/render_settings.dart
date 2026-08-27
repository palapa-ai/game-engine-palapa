enum Upscaler { denoised, temporal, spatial, off }

enum Resolution {
  p320(320, '320p'),
  p480(480, '480p'),
  p640(640, '640p'),
  p720(1280, '720p'),
  p1080(1920, '1080p'),
  k2(2560, '2k'),
  k4(3840, '4k');

  const Resolution(this.width, this.label);

  final int width;
  final String label;
}

class RenderSettings {
  const RenderSettings({
    this.resolution = .p640,
    this.requestedUpscale = .p1080,
    this.bounceRays = 2,
    this.samples = 1,
    this.upscaler = .denoised,
    this.frameInterpolation = false,
    this.exposure = 1.0,
  });

  /// What the tracer renders; MetalFX takes it from here up to [upscaled].
  final Resolution resolution;
  final Resolution requestedUpscale;
  final int bounceRays;
  final int samples;
  final Upscaler upscaler;
  final bool frameInterpolation;
  final double exposure;

  /// Upscaling only ever goes up; MetalFX stages anything past its own 3x
  /// ceiling internally.
  Resolution get upscaled =>
      requestedUpscale.width < resolution.width ? resolution : requestedUpscale;

  /// Native, then the two sizes worth asking MetalFX for.
  Iterable<Resolution> get upscales =>
      <Resolution>{resolution, .p1080, .k4}.where((size) => size.width >= resolution.width);

  RenderSettings copyWith({
    Resolution? resolution,
    Resolution? upscaled,
    int? bounceRays,
    int? samples,
    Upscaler? upscaler,
    bool? frameInterpolation,
    double? exposure,
  }) => RenderSettings(
    resolution: resolution ?? this.resolution,
    requestedUpscale: upscaled ?? requestedUpscale,
    bounceRays: bounceRays ?? this.bounceRays,
    samples: samples ?? this.samples,
    upscaler: upscaler ?? this.upscaler,
    frameInterpolation: frameInterpolation ?? this.frameInterpolation,
    exposure: exposure ?? this.exposure,
  );

  Map<String, dynamic> toJson() => {
    'renderWidth': resolution.width,
    'outputWidth': upscaled.width,
    'bounceRays': bounceRays,
    'samples': samples,
    'upscaler': upscaler.name,
    'frameInterpolation': frameInterpolation,
    'exposure': exposure,
  };
}
