import Metal

@available(macOS 15.0, *)
final class GameRenderer {
  private let tracePipeline: MTLComputePipelineState
  private let presentPipeline: MTLComputePipelineState

  init(device: MTLDevice) throws {
    let options = MTLCompileOptions()
    options.languageVersion = .version3_1
    let library = try device.makeLibrary(source: GameShaders.source, options: options)
    guard let trace = library.makeFunction(name: "traceScene"),
      let present = library.makeFunction(name: "present")
    else { throw GameEngineError.pipeline }
    tracePipeline = try device.makeComputePipelineState(function: trace)
    presentPipeline = try device.makeComputePipelineState(function: present)
  }

  func encodeTrace(
    commandBuffer: MTLCommandBuffer, targets: RenderTargets, scene: SceneResources, slot: FrameSlot
  ) {
    guard let encoder = commandBuffer.makeComputeCommandEncoder() else { return }
    encoder.setComputePipelineState(tracePipeline)
    let textures = [
      targets.shaded, targets.albedo, targets.specularAlbedo, targets.normal, targets.roughness,
      targets.motion, targets.depth,
    ]
    encoder.setTextures(textures, range: 0..<textures.count)
    encoder.setBuffer(slot.uniforms, offset: 0, index: 0)
    encoder.setAccelerationStructure(slot.accelerationStructure, bufferIndex: 1)
    encoder.setBuffer(scene.meshes.vertexBuffer, offset: 0, index: 2)
    encoder.setBuffer(scene.meshes.indexBuffer, offset: 0, index: 3)
    encoder.setBuffer(scene.meshRanges, offset: 0, index: 4)
    encoder.setBuffer(scene.materials, offset: 0, index: 5)
    encoder.setBuffer(slot.transforms, offset: 0, index: 6)
    encoder.setBuffer(slot.previousTransforms, offset: 0, index: 7)
    encoder.setBuffer(slot.inverseTransforms, offset: 0, index: 8)
    encoder.setBuffer(scene.lights, offset: 0, index: 9)
    scene.meshes.accelerationStructures.forEach { encoder.useResource($0, usage: .read) }
    dispatch(
      encoder: encoder, pipeline: tracePipeline, width: targets.renderWidth,
      height: targets.renderHeight)
    encoder.endEncoding()
  }

  func encodePresent(
    commandBuffer: MTLCommandBuffer, targets: RenderTargets, source: MTLTexture, slot: FrameSlot,
    surface: OutputSurface
  ) {
    guard let encoder = commandBuffer.makeComputeCommandEncoder() else { return }
    encoder.setComputePipelineState(presentPipeline)
    encoder.setTexture(source, index: 0)
    encoder.setTexture(targets.presented, index: 1)
    encoder.setBuffer(slot.uniforms, offset: 0, index: 0)
    dispatch(
      encoder: encoder, pipeline: presentPipeline, width: targets.outputWidth,
      height: targets.outputHeight)
    encoder.endEncoding()

    guard let blit = commandBuffer.makeBlitCommandEncoder() else { return }
    blit.copy(from: targets.presented, to: surface.texture)
    blit.endEncoding()
  }

  private func dispatch(
    encoder: MTLComputeCommandEncoder, pipeline: MTLComputePipelineState, width: Int, height: Int
  ) {
    let threadWidth = pipeline.threadExecutionWidth
    let threadHeight = max(pipeline.maxTotalThreadsPerThreadgroup / threadWidth, 1)
    encoder.dispatchThreads(
      MTLSize(width: width, height: height, depth: 1),
      threadsPerThreadgroup: MTLSize(width: threadWidth, height: threadHeight, depth: 1))
  }
}
