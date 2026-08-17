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
  var time: Float = 0
  var frameIndex: UInt32 = 0
  var bounceRays: UInt32 = 1
  var lightCount: UInt32 = 0
}

struct RenderSettings {
  var renderScale: Float = 0.6
  var bounceRays: UInt32 = 1
  var upscaling = true
  var denoising = true
  var frameInterpolation = false
  var exposure: Float = 1.0

  init(json: [String: Any]) {
    renderScale = Float(json["renderScale"] as? Double ?? 0.6)
    bounceRays = UInt32(json["bounceRays"] as? Int ?? 1)
    upscaling = json["upscaling"] as? Bool ?? true
    denoising = json["denoising"] as? Bool ?? true
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
