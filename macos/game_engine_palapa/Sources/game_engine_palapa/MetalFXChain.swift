import Metal
import MetalFX
import simd

struct FrameCamera {
  var worldToView = matrix_identity_float4x4
  var viewToClip = matrix_identity_float4x4
  var fieldOfView: Float = 1.0
  var near: Float = 0.1
  var far: Float = 200
  var aspectRatio: Float = 1.6
  var deltaTime: Float = 1.0 / 60.0
}

@available(macOS 26.0, *)
private final class DenoisedUpscaler {
  let scaler: any MTLFXTemporalDenoisedScaler

  init?(device: MTLDevice, targets: RenderTargets) {
    let descriptor = MTLFXTemporalDenoisedScalerDescriptor()
    descriptor.colorTextureFormat = RenderTargets.colorFormat
    descriptor.depthTextureFormat = RenderTargets.depthFormat
    descriptor.motionTextureFormat = RenderTargets.motionFormat
    descriptor.diffuseAlbedoTextureFormat = RenderTargets.colorFormat
    descriptor.specularAlbedoTextureFormat = RenderTargets.colorFormat
    descriptor.normalTextureFormat = RenderTargets.normalFormat
    descriptor.roughnessTextureFormat = RenderTargets.roughnessFormat
    descriptor.outputTextureFormat = RenderTargets.colorFormat
    descriptor.inputWidth = targets.renderWidth
    descriptor.inputHeight = targets.renderHeight
    descriptor.outputWidth = targets.stageWidth
    descriptor.outputHeight = targets.stageHeight
    descriptor.isAutoExposureEnabled = true
    guard let scaler = descriptor.makeTemporalDenoisedScaler(device: device) else { return nil }
    self.scaler = scaler
  }

  func encode(
    commandBuffer: MTLCommandBuffer, targets: RenderTargets, output: MTLTexture,
    jitter: SIMD2<Float>, camera: FrameCamera, reset: Bool
  ) {
    scaler.colorTexture = targets.shaded
    scaler.depthTexture = targets.depth
    scaler.motionTexture = targets.motion
    scaler.diffuseAlbedoTexture = targets.albedo
    scaler.specularAlbedoTexture = targets.specularAlbedo
    scaler.normalTexture = targets.normal
    scaler.roughnessTexture = targets.roughness
    scaler.outputTexture = output
    scaler.jitterOffsetX = -jitter.x
    scaler.jitterOffsetY = -jitter.y
    scaler.motionVectorScaleX = 1
    scaler.motionVectorScaleY = 1
    scaler.shouldResetHistory = reset
    scaler.isDepthReversed = false
    scaler.worldToViewMatrix = camera.worldToView
    scaler.viewToClipMatrix = camera.viewToClip
    scaler.encode(commandBuffer: commandBuffer)
  }
}

@available(macOS 26.0, *)
private final class FrameInterpolator {
  let interpolator: any MTLFXFrameInterpolator

  init?(device: MTLDevice, targets: RenderTargets, scaler: (any MTLFXFrameInterpolatableScaler)?) {
    let descriptor = MTLFXFrameInterpolatorDescriptor()
    descriptor.colorTextureFormat = RenderTargets.colorFormat
    descriptor.outputTextureFormat = RenderTargets.colorFormat
    descriptor.depthTextureFormat = RenderTargets.depthFormat
    descriptor.motionTextureFormat = RenderTargets.motionFormat
    descriptor.inputWidth = targets.outputWidth
    descriptor.inputHeight = targets.outputHeight
    descriptor.outputWidth = targets.outputWidth
    descriptor.outputHeight = targets.outputHeight
    descriptor.scaler = scaler
    guard let interpolator = descriptor.makeFrameInterpolator(device: device) else { return nil }
    self.interpolator = interpolator
  }

  func encode(
    commandBuffer: MTLCommandBuffer, targets: RenderTargets, current: MTLTexture,
    previous: MTLTexture, output: MTLTexture, camera: FrameCamera, jitter: SIMD2<Float>,
    reset: Bool
  ) {
    interpolator.colorTexture = current
    interpolator.prevColorTexture = previous
    interpolator.depthTexture = targets.depth
    interpolator.motionTexture = targets.motion
    interpolator.outputTexture = output
    interpolator.motionVectorScaleX = Float(targets.outputWidth) / Float(targets.renderWidth)
    interpolator.motionVectorScaleY = Float(targets.outputHeight) / Float(targets.renderHeight)
    interpolator.jitterOffsetX = -jitter.x
    interpolator.jitterOffsetY = -jitter.y
    interpolator.deltaTime = camera.deltaTime
    interpolator.nearPlane = camera.near
    interpolator.farPlane = camera.far
    interpolator.fieldOfView = camera.fieldOfView
    interpolator.aspectRatio = camera.aspectRatio
    interpolator.isDepthReversed = false
    interpolator.shouldResetHistory = reset
    interpolator.encode(commandBuffer: commandBuffer)
  }
}

@available(macOS 15.0, *)
final class MetalFXChain {
  enum Upscaling: String {
    case denoised
    case temporal
    case spatial
    case off
  }

  private let device: MTLDevice
  private var denoised: AnyObject?
  private var temporal: (any MTLFXTemporalScaler)?
  private var spatial: (any MTLFXSpatialScaler)?
  private var interpolatorBox: AnyObject?
  private var finisher: (any MTLFXSpatialScaler)?

  private(set) var upscaling: Upscaling = .off
  private(set) var interpolates = false

  init(device: MTLDevice, targets: RenderTargets, settings: RenderSettings) {
    self.device = device
    switch settings.upscaler {
    case .off:
      break
    case .spatial:
      if let scaler = MetalFXChain.makeSpatialScaler(device: device, targets: targets) {
        spatial = scaler
        upscaling = .spatial
      }
    case .temporal:
      if let scaler = MetalFXChain.makeTemporalScaler(device: device, targets: targets) {
        temporal = scaler
        upscaling = .temporal
      }
    case .denoised:
      if #available(macOS 26.0, *), let upscaler = DenoisedUpscaler(device: device, targets: targets) {
        denoised = upscaler
        upscaling = .denoised
      } else if let scaler = MetalFXChain.makeTemporalScaler(device: device, targets: targets) {
        temporal = scaler
        upscaling = .temporal
      }
    }

    if upscaling != .off,
      targets.stageWidth != targets.outputWidth || targets.stageHeight != targets.outputHeight
    {
      finisher = MetalFXChain.makeFinisher(device: device, targets: targets)
    }

    guard settings.frameInterpolation, upscaling != .off else { return }
    if #available(macOS 26.0, *) {
      let scaler = (denoised as? DenoisedUpscaler)?.scaler as? any MTLFXFrameInterpolatableScaler
      if let interpolator = FrameInterpolator(device: device, targets: targets, scaler: scaler) {
        interpolatorBox = interpolator
        interpolates = true
      }
    }
  }

  private static func makeFinisher(device: MTLDevice, targets: RenderTargets)
    -> (any MTLFXSpatialScaler)?
  {
    let descriptor = MTLFXSpatialScalerDescriptor()
    descriptor.colorTextureFormat = RenderTargets.colorFormat
    descriptor.outputTextureFormat = RenderTargets.colorFormat
    descriptor.inputWidth = targets.stageWidth
    descriptor.inputHeight = targets.stageHeight
    descriptor.outputWidth = targets.outputWidth
    descriptor.outputHeight = targets.outputHeight
    descriptor.colorProcessingMode = .perceptual
    return descriptor.makeSpatialScaler(device: device)
  }

  private static func makeSpatialScaler(device: MTLDevice, targets: RenderTargets)
    -> (any MTLFXSpatialScaler)?
  {
    let descriptor = MTLFXSpatialScalerDescriptor()
    descriptor.colorTextureFormat = RenderTargets.colorFormat
    descriptor.outputTextureFormat = RenderTargets.colorFormat
    descriptor.inputWidth = targets.renderWidth
    descriptor.inputHeight = targets.renderHeight
    descriptor.outputWidth = targets.stageWidth
    descriptor.outputHeight = targets.stageHeight
    descriptor.colorProcessingMode = .perceptual
    return descriptor.makeSpatialScaler(device: device)
  }

  private static func makeTemporalScaler(device: MTLDevice, targets: RenderTargets)
    -> (any MTLFXTemporalScaler)?
  {
    let descriptor = MTLFXTemporalScalerDescriptor()
    descriptor.colorTextureFormat = RenderTargets.colorFormat
    descriptor.depthTextureFormat = RenderTargets.depthFormat
    descriptor.motionTextureFormat = RenderTargets.motionFormat
    descriptor.outputTextureFormat = RenderTargets.colorFormat
    descriptor.inputWidth = targets.renderWidth
    descriptor.inputHeight = targets.renderHeight
    descriptor.outputWidth = targets.stageWidth
    descriptor.outputHeight = targets.stageHeight
    descriptor.isAutoExposureEnabled = true
    return descriptor.makeTemporalScaler(device: device)
  }

  func encodeUpscale(
    commandBuffer: MTLCommandBuffer, targets: RenderTargets, output: MTLTexture,
    jitter: SIMD2<Float>, camera: FrameCamera, reset: Bool
  ) {
    let staged = finisher == nil ? output : targets.staged
    encodeScaler(
      commandBuffer: commandBuffer, targets: targets, output: staged, jitter: jitter,
      camera: camera, reset: reset)
    guard let finisher else { return }
    finisher.colorTexture = targets.staged
    finisher.outputTexture = output
    finisher.encode(commandBuffer: commandBuffer)
  }

  private func encodeScaler(
    commandBuffer: MTLCommandBuffer, targets: RenderTargets, output: MTLTexture,
    jitter: SIMD2<Float>, camera: FrameCamera, reset: Bool
  ) {
    if #available(macOS 26.0, *), let upscaler = denoised as? DenoisedUpscaler {
      upscaler.encode(
        commandBuffer: commandBuffer, targets: targets, output: output, jitter: jitter,
        camera: camera, reset: reset)
      return
    }
    if let spatial {
      spatial.colorTexture = targets.shaded
      spatial.outputTexture = output
      spatial.encode(commandBuffer: commandBuffer)
      return
    }
    guard let temporal else { return }
    temporal.colorTexture = targets.shaded
    temporal.depthTexture = targets.depth
    temporal.motionTexture = targets.motion
    temporal.outputTexture = output
    temporal.inputContentWidth = targets.renderWidth
    temporal.inputContentHeight = targets.renderHeight
    temporal.jitterOffsetX = -jitter.x
    temporal.jitterOffsetY = -jitter.y
    temporal.motionVectorScaleX = 1
    temporal.motionVectorScaleY = 1
    temporal.isDepthReversed = false
    temporal.reset = reset
    temporal.encode(commandBuffer: commandBuffer)
  }

  func encodeInterpolation(
    commandBuffer: MTLCommandBuffer, targets: RenderTargets, current: MTLTexture,
    previous: MTLTexture, output: MTLTexture, camera: FrameCamera, jitter: SIMD2<Float>,
    reset: Bool
  ) -> Bool {
    if #available(macOS 26.0, *), let interpolator = interpolatorBox as? FrameInterpolator {
      interpolator.encode(
        commandBuffer: commandBuffer, targets: targets, current: current, previous: previous,
        output: output, camera: camera, jitter: jitter, reset: reset)
      return true
    }
    return false
  }
}
