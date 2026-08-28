import Metal
import simd

extension SIMD4 where Scalar == Float {
  var xyz: SIMD3<Float> { SIMD3<Float>(x, y, z) }
}

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
  let lights: MTLBuffer
  let instanceCount: Int
  private(set) var lightCount = 0
  private let emissiveInstances: [Int]
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
      let range = meshes.ranges[Self.meshIndex(instance.meshIndex, of: meshes.ranges.count)]
      return SIMD2<UInt32>(UInt32(range.vertexOffset), UInt32(range.indexOffset))
    }
    guard
      let meshRanges = device.makeBuffer(
        bytes: ranges, length: ranges.count * MemoryLayout<SIMD2<UInt32>>.stride,
        options: .storageModeShared)
    else { return nil }
    self.meshRanges = meshRanges

    emissiveInstances = scene.instances.enumerated()
      .filter { simd_reduce_max($0.element.material.emissive) > 0.35 }
      .map(\.offset)
      .prefix(96)
      .map { $0 }
    guard
      let lights = device.makeBuffer(
        length: max(MemoryLayout<SceneLight>.stride * emissiveInstances.count, 16),
        options: .storageModeShared)
    else { return nil }
    self.lights = lights

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

  // A scene names its meshes by index; out of range would read past the
  // acceleration structures, and negative traps converting to UInt32.
  static func meshIndex(_ raw: Int, of count: Int) -> Int {
    min(max(raw, 0), max(count - 1, 0))
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

    let lightValues = lights.contents().bindMemory(
      to: SceneLight.self, capacity: max(emissiveInstances.count, 1))
    emissiveInstances.enumerated().forEach { slot, instance in
      let transform = transforms[instance]
      let scale = SIMD3<Float>(
        length(transform.columns.0.xyz), length(transform.columns.1.xyz),
        length(transform.columns.2.xyz))
      // An emitter animated down to nothing has to stop lighting the room as
      // well as stop being drawn, or a dark signal aspect still tints its corner.
      let extent = simd_reduce_max(scale)
      lightValues[slot] = SceneLight(
        position: transform.columns.3.xyz,
        radius: max(extent * 0.5, 0.05),
        color: extent > 1e-4 ? scene.instances[instance].material.emissive : .zero)
    }
    lightCount = emissiveInstances.count

    let descriptors = slot.instanceDescriptors.contents().bindMemory(
      to: MTLAccelerationStructureInstanceDescriptor.self, capacity: instanceCount)
    scene.instances.enumerated().forEach { index, instance in
      descriptors[index].transformationMatrix = packed(transforms[index])
      descriptors[index].options = .opaque
      descriptors[index].mask = 0xFF
      descriptors[index].intersectionFunctionTableOffset = 0
      descriptors[index].accelerationStructureIndex =
        UInt32(Self.meshIndex(instance.meshIndex, of: meshes.accelerationStructures.count))
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
