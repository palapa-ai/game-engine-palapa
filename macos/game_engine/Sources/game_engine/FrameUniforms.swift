import simd

// Field order and padding mirror `FrameUniforms` in GameShaders.source.
struct FrameUniforms {
  var viewProjection = matrix_identity_float4x4
  var inverseViewProjection = matrix_identity_float4x4
  var previousViewProjection = matrix_identity_float4x4
  var cameraPosition = SIMD3<Float>(0, 0, 0)
  var sunDirection = SIMD3<Float>(0, -1, 0)
  var sunColor = SIMD3<Float>(1, 1, 1)
  var skyZenith = SIMD3<Float>(0, 0, 0)
  var skyHorizon = SIMD3<Float>(0, 0, 0)
  var skyGround = SIMD3<Float>(0, 0, 0)
  var fogColor = SIMD3<Float>(0, 0, 0)
  var renderSize = SIMD2<Float>(1, 1)
  var jitter = SIMD2<Float>(0, 0)
  var sunIntensity: Float = 1
  var sunAngularRadius: Float = 0.03
  var exposure: Float = 1
  var fogDensity: Float = 0
  var scattering: Float = 0
  var time: Float = 0
  var frameIndex: UInt32 = 0
  var bounceRays: UInt32 = 1
  var samples: UInt32 = 1
  var lightCount: UInt32 = 0
}

enum Upscaler: String {
  case denoised
  case temporal
  case spatial
  case off
}

struct RenderSettings {
  var renderWidth = 640
  var outputWidth = 1920
  var bounceRays: UInt32 = 2
  var samples: UInt32 = 1
  var upscaler = Upscaler.denoised
  var frameInterpolation = false
  var exposure: Float = 1.0

  init(json: [String: Any]) {
    renderWidth = json["renderWidth"] as? Int ?? 640
    outputWidth = json["outputWidth"] as? Int ?? 1920
    bounceRays = UInt32(json["bounceRays"] as? Int ?? 2)
    samples = UInt32(max(json["samples"] as? Int ?? 1, 1))
    upscaler = Upscaler(rawValue: json["upscaler"] as? String ?? "denoised") ?? .denoised
    frameInterpolation = json["frameInterpolation"] as? Bool ?? false
    exposure = Float(json["exposure"] as? Double ?? 1.0)
  }

  init() {}
}

extension simd_float4x4 {
  init(columnMajor values: [Float]) {
    guard values.count >= 16 else {
      self = matrix_identity_float4x4
      return
    }
    self.init(
      SIMD4<Float>(values[0], values[1], values[2], values[3]),
      SIMD4<Float>(values[4], values[5], values[6], values[7]),
      SIMD4<Float>(values[8], values[9], values[10], values[11]),
      SIMD4<Float>(values[12], values[13], values[14], values[15]))
  }
}
