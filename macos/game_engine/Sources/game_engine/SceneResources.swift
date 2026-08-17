import Metal
import simd

@available(macOS 15.0, *)
private func packed(_ matrix: simd_float4x4) -> MTLPackedFloat4x3 {
  var result = MTLPackedFloat4x3()
  let columns = [matrix.columns.0, matrix.columns.1, matrix.columns.2, matrix.columns.3]
  result.columns.0 = MTLPackedFloat3Make(columns[0].x, columns[0].y, columns[0].z)
  result.columns.1 = MTLPackedFloat3Make(columns[1].x, columns[1].y, columns[1].z)
  result.columns.2 = MTLPackedFloat3Make(columns[2].x, columns[2].y, columns[2].z)
  result.columns.3 = MTLPackedFloat3Make(columns[3].x, columns[3].y, columns[3].z)
  return result
}

@available(macOS 15.0, *)
final class FrameSlot {
  let uniforms: MTLBuffer
  let transforms: MTLBuffer
  let previousTransforms: MTLBuffer
  let inverseTransforms: MTLBuffer
  let instanceDescriptors: MTLBuffer
  let scratch: MTLBuffer
  let accelerationStructure: MTLAccelerationStructure

  init?(
    device: MTLDevice, instanceCount: Int, descriptor: MTLInstanceAccelerationStructureDescriptor
  ) {
    let sizes = device.accelerationStructureSizes(descriptor: descriptor)
    guard
      let uniforms = device.makeBuffer(
        length: MemoryLayout<FrameUniforms>.stride, options: .storageModeShared),
      let transforms = device.makeBuffer(
        length: MemoryLayout<simd_float4x4>.stride * instanceCount, options: .storageModeShared),
      let previousTransforms = device.makeBuffer(
        length: MemoryLayout<simd_float4x4>.stride * instanceCount, options: .storageModeShared),
      let inverseTransforms = device.makeBuffer(
        length: MemoryLayout<simd_float4x4>.stride * instanceCount, options: .storageModeShared),
      let instanceDescriptors = device.makeBuffer(
        length: MemoryLayout<MTLAccelerationStructureInstanceDescriptor>.stride * instanceCount,
        options: .storageModeShared),
      let scratch = device.makeBuffer(
        length: max(sizes.buildScratchBufferSize, 32), options: .storageModePrivate),
      let accelerationStructure = device.makeAccelerationStructure(
        size: sizes.accelerationStructureSize)
    else { return nil }
    self.uniforms = uniforms
    self.transforms = transforms
    self.previousTransforms = previousTransforms
    self.inverseTransforms = inverseTransforms
    self.instanceDescriptors = instanceDescriptors
    self.scratch = scratch
    self.accelerationStructure = accelerationStructure
  }
}

@available(macOS 15.0, *)
final class SceneResources {
  static let slotCount = 3

  let scene: GameScene
  let meshes: MeshLibrary
  let materials: MTLBuffer
  let meshRanges: MTLBuffer
  let instanceCount: Int
  private let slots: [FrameSlot]
  private let accelerationDescriptor: MTLInstanceAccelerationStructureDescriptor
  private var transforms: [simd_float4x4]
  private var previousTransforms: [simd_float4x4]

  init?(device: MTLDevice, queue: MTLCommandQueue, scene: GameScene) {
    guard !scene.instances.isEmpty,
      let meshes = MeshLibrary(device: device, queue: queue, meshes: scene.meshes)
    else { return nil }
    self.scene = scene
    self.meshes = meshes
    self.instanceCount = scene.instances.count

    let materialValues = scene.instances.map(\.material)
    guard
      let materials = device.makeBuffer(
        bytes: materialValues, length: materialValues.count * MemoryLayout<InstanceMaterial>.stride,
        options: .storageModeShared)
    else { return nil }
    self.materials = materials

    let ranges = scene.instances.map { instance -> SIMD2<UInt32> in
      let range = meshes.ranges[min(instance.meshIndex, meshes.ranges.count - 1)]
      return SIMD2<UInt32>(UInt32(range.vertexOffset), UInt32(range.indexOffset))
    }
    guard
      let meshRanges = device.makeBuffer(
        bytes: ranges, length: ranges.count * MemoryLayout<SIMD2<UInt32>>.stride,
        options: .storageModeShared)
    else { return nil }
    self.meshRanges = meshRanges

    let descriptor = MTLInstanceAccelerationStructureDescriptor()
    descriptor.instancedAccelerationStructures = meshes.accelerationStructures
    descriptor.instanceCount = scene.instances.count
    accelerationDescriptor = descriptor

    transforms = Array(repeating: matrix_identity_float4x4, count: scene.instances.count)
    previousTransforms = transforms

    let slots = (0..<Self.slotCount).compactMap { _ in
      FrameSlot(device: device, instanceCount: scene.instances.count, descriptor: descriptor)
    }
    guard slots.count == Self.slotCount else { return nil }
    self.slots = slots
  }

  func slot(_ index: Int) -> FrameSlot { slots[index % slots.count] }

  func update(transforms newTransforms: [simd_float4x4], slot: FrameSlot) {
    previousTransforms = transforms
    transforms = newTransforms.count == instanceCount ? newTransforms : transforms

    slot.transforms.contents().copyMemory(
      from: transforms, byteCount: MemoryLayout<simd_float4x4>.stride * instanceCount)
    slot.previousTransforms.contents().copyMemory(
      from: previousTransforms, byteCount: MemoryLayout<simd_float4x4>.stride * instanceCount)
    let inverses = transforms.map { $0.inverse }
    slot.inverseTransforms.contents().copyMemory(
      from: inverses, byteCount: MemoryLayout<simd_float4x4>.stride * instanceCount)

    let descriptors = slot.instanceDescriptors.contents().bindMemory(
      to: MTLAccelerationStructureInstanceDescriptor.self, capacity: instanceCount)
    scene.instances.enumerated().forEach { index, instance in
      descriptors[index].transformationMatrix = packed(transforms[index])
      descriptors[index].options = .opaque
      descriptors[index].mask = 0xFF
      descriptors[index].intersectionFunctionTableOffset = 0
      descriptors[index].accelerationStructureIndex = UInt32(instance.meshIndex)
    }
  }

  func encodeAccelerationBuild(commandBuffer: MTLCommandBuffer, slot: FrameSlot) {
    guard let encoder = commandBuffer.makeAccelerationStructureCommandEncoder() else { return }
    accelerationDescriptor.instanceDescriptorBuffer = slot.instanceDescriptors
    encoder.build(
      accelerationStructure: slot.accelerationStructure, descriptor: accelerationDescriptor,
      scratchBuffer: slot.scratch, scratchBufferOffset: 0)
    encoder.endEncoding()
  }
}
