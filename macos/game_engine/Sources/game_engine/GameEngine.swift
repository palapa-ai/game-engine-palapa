import CoreVideo
import Foundation
import Metal
import simd

enum GameEngineError: Error {
  case device
  case pipeline
  case targets
}

@available(macOS 15.0, *)
struct FrameSubmission {
  let view: simd_float4x4
  let projection: simd_float4x4
  let transforms: [simd_float4x4]
  let camera: FrameCamera
}

@available(macOS 15.0, *)
final class GameEngine {
  let device: MTLDevice
  private let queue: MTLCommandQueue
  private let textureCache: CVMetalTextureCache
  private let renderer: GameRenderer

  private var targets: RenderTargets?
  private var chain: MetalFXChain?
  private var scene: SceneResources?
  private var sceneJSON: [String: Any]?
  private var settings = RenderSettings()

  private let inflight = DispatchSemaphore(value: SceneResources.slotCount)
  private var frameIndex: UInt32 = 0
  private var previousViewProjection = matrix_identity_float4x4
  private var scaledIndex = 0
  private var lastScaled: MTLTexture?
  private var pendingScaled: MTLTexture?
  private var historyReset = true
  private var gpuMilliseconds = 0.0
  private var elapsed: Float = 0

  init() throws {
    guard let device = MTLCreateSystemDefaultDevice(), device.supportsRaytracing,
      let queue = device.makeCommandQueue()
    else { throw GameEngineError.device }
    var cache: CVMetalTextureCache?
    guard CVMetalTextureCacheCreate(nil, nil, device, nil, &cache) == kCVReturnSuccess,
      let textureCache = cache
    else { throw GameEngineError.device }

    self.device = device
    self.queue = queue
    self.textureCache = textureCache
    self.renderer = try GameRenderer(device: device)
  }

  func configure(width: Int, height: Int, settings: RenderSettings) throws {
    waitForIdle()
    self.settings = settings
    guard
      let targets = RenderTargets(
        device: device, cache: textureCache, output: (width, height), scale: settings.renderScale)
    else { throw GameEngineError.targets }
    self.targets = targets
    chain = MetalFXChain(device: device, targets: targets, settings: settings)
    lastScaled = nil
    pendingScaled = nil
    historyReset = true
    if let json = sceneJSON { load(sceneJSON: json) }
  }

  @discardableResult
  func load(sceneJSON json: [String: Any]) -> Bool {
    waitForIdle()
    sceneJSON = json
    scene = SceneResources(device: device, queue: queue, scene: GameScene(json: json))
    historyReset = true
    return scene != nil
  }

  var status: [String: Any] {
    [
      "upscaling": chain?.upscaling.rawValue ?? MetalFXChain.Upscaling.off.rawValue,
      "frameInterpolation": chain?.interpolates ?? false,
      "renderWidth": targets?.renderWidth ?? 0,
      "renderHeight": targets?.renderHeight ?? 0,
      "outputWidth": targets?.outputWidth ?? 0,
      "outputHeight": targets?.outputHeight ?? 0,
      "gpuMilliseconds": gpuMilliseconds,
      "deviceName": device.name,
    ]
  }

  func render(_ submission: FrameSubmission, onFrame: @escaping (CVPixelBuffer) -> Void)
    -> [String: Any]
  {
    guard let targets, let chain, let scene else { return status }

    inflight.wait()
    let slot = scene.slot(Int(frameIndex))
    scene.update(transforms: submission.transforms, slot: slot)

    let jitter = chain.upscaling == .off ? SIMD2<Float>(0, 0) : haltonJitter(frameIndex)
    let viewProjection = submission.projection * submission.view

    var uniforms = FrameUniforms()
    uniforms.viewProjection = viewProjection
    uniforms.inverseViewProjection = viewProjection.inverse
    uniforms.previousViewProjection = previousViewProjection
    uniforms.cameraPosition = cameraPosition(view: submission.view)
    uniforms.sunDirection = scene.scene.sun.direction
    uniforms.sunColor = scene.scene.sun.color
    uniforms.sunIntensity = scene.scene.sun.intensity
    uniforms.sunAngularRadius = scene.scene.sun.angularRadius
    uniforms.skyZenith = scene.scene.sky.zenith
    uniforms.skyHorizon = scene.scene.sky.horizon
    uniforms.skyGround = scene.scene.sky.ground
    uniforms.fogColor = scene.scene.fog.color
    uniforms.fogDensity = scene.scene.fog.density
    uniforms.renderSize = SIMD2<Float>(Float(targets.renderWidth), Float(targets.renderHeight))
    uniforms.jitter = jitter
    uniforms.exposure = settings.exposure
    uniforms.time = elapsed
    uniforms.frameIndex = frameIndex
    uniforms.bounceRays = max(settings.bounceRays, 1)
    slot.uniforms.contents().copyMemory(
      from: &uniforms, byteCount: MemoryLayout<FrameUniforms>.stride)

    guard let commandBuffer = queue.makeCommandBuffer() else {
      inflight.signal()
      return status
    }

    let holdFrame = chain.interpolates && frameIndex % 2 == 1 && pendingScaled != nil
    var presented = targets.shaded
    var interpolated = false

    if holdFrame, let pending = pendingScaled {
      presented = pending
      pendingScaled = nil
    } else {
      scene.encodeAccelerationBuild(commandBuffer: commandBuffer, slot: slot)
      renderer.encodeTrace(
        commandBuffer: commandBuffer, targets: targets, scene: scene, slot: slot)

      if chain.upscaling != .off {
        let current = scaledIndex == 0 ? targets.scaled : targets.previousScaled
        chain.encodeUpscale(
          commandBuffer: commandBuffer, targets: targets, output: current, jitter: jitter,
          camera: submission.camera, reset: historyReset)
        presented = current
        scaledIndex ^= 1

        if chain.interpolates, let previous = lastScaled {
          interpolated = chain.encodeInterpolation(
            commandBuffer: commandBuffer, targets: targets, current: current, previous: previous,
            output: targets.interpolated, camera: submission.camera, jitter: jitter,
            reset: historyReset)
          if interpolated {
            pendingScaled = current
            presented = targets.interpolated
          }
        }
        lastScaled = current
      }
    }

    let surface = targets.nextSurface()
    renderer.encodePresent(
      commandBuffer: commandBuffer, targets: targets, source: presented, slot: slot,
      surface: surface)
    commandBuffer.addCompletedHandler { [weak self] buffer in
      guard let self else { return }
      self.gpuMilliseconds = (buffer.gpuEndTime - buffer.gpuStartTime) * 1000
      onFrame(surface.pixelBuffer)
      self.inflight.signal()
    }
    commandBuffer.commit()

    previousViewProjection = viewProjection
    elapsed += submission.camera.deltaTime
    frameIndex &+= 1
    historyReset = false

    var stats = status
    stats["interpolated"] = interpolated || holdFrame
    return stats
  }

  private func cameraPosition(view: simd_float4x4) -> SIMD3<Float> {
    let inverse = view.inverse
    return SIMD3<Float>(inverse.columns.3.x, inverse.columns.3.y, inverse.columns.3.z)
  }

  private func haltonJitter(_ index: UInt32) -> SIMD2<Float> {
    func halton(_ index: UInt32, _ base: UInt32) -> Float {
      var result: Float = 0
      var fraction: Float = 1
      var i = index
      while i > 0 {
        fraction /= Float(base)
        result += fraction * Float(i % base)
        i /= base
      }
      return result
    }
    let sample = index % 16 + 1
    return SIMD2<Float>(halton(sample, 2) - 0.5, halton(sample, 3) - 0.5)
  }

  private func waitForIdle() {
    guard let commandBuffer = queue.makeCommandBuffer() else { return }
    commandBuffer.commit()
    commandBuffer.waitUntilCompleted()
  }
}
