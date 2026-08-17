import Metal
import simd

struct MeshVertex {
  var position: SIMD3<Float>
  var normal: SIMD3<Float>
}

struct MeshRange {
  let vertexOffset: Int
  let indexOffset: Int
  let indexCount: Int
}

@available(macOS 15.0, *)
final class MeshLibrary {
  let vertexBuffer: MTLBuffer
  let indexBuffer: MTLBuffer
  let ranges: [MeshRange]
  let accelerationStructures: [MTLAccelerationStructure]

  init?(device: MTLDevice, queue: MTLCommandQueue, meshes: [MeshDescription]) {
    let geometry = meshes.map(MeshLibrary.geometry(for:))
    let vertices = geometry.flatMap { $0.vertices }
    let indices = geometry.flatMap { $0.indices }
    guard !vertices.isEmpty, !indices.isEmpty,
      let vertexBuffer = device.makeBuffer(
        bytes: vertices, length: vertices.count * MemoryLayout<MeshVertex>.stride,
        options: .storageModeShared),
      let indexBuffer = device.makeBuffer(
        bytes: indices, length: indices.count * MemoryLayout<UInt32>.stride,
        options: .storageModeShared)
    else { return nil }
    self.vertexBuffer = vertexBuffer
    self.indexBuffer = indexBuffer

    var vertexCursor = 0
    var indexCursor = 0
    let ranges = geometry.map { mesh -> MeshRange in
      let range = MeshRange(
        vertexOffset: vertexCursor, indexOffset: indexCursor, indexCount: mesh.indices.count)
      vertexCursor += mesh.vertices.count
      indexCursor += mesh.indices.count
      return range
    }
    self.ranges = ranges

    guard
      let built = MeshLibrary.buildAccelerationStructures(
        device: device, queue: queue, vertexBuffer: vertexBuffer, indexBuffer: indexBuffer,
        ranges: ranges)
    else { return nil }
    self.accelerationStructures = built
  }

  private static func buildAccelerationStructures(
    device: MTLDevice, queue: MTLCommandQueue, vertexBuffer: MTLBuffer, indexBuffer: MTLBuffer,
    ranges: [MeshRange]
  ) -> [MTLAccelerationStructure]? {
    let descriptors = ranges.map { range -> MTLPrimitiveAccelerationStructureDescriptor in
      let geometry = MTLAccelerationStructureTriangleGeometryDescriptor()
      geometry.vertexBuffer = vertexBuffer
      geometry.vertexBufferOffset = range.vertexOffset * MemoryLayout<MeshVertex>.stride
      geometry.vertexStride = MemoryLayout<MeshVertex>.stride
      geometry.indexBuffer = indexBuffer
      geometry.indexBufferOffset = range.indexOffset * MemoryLayout<UInt32>.stride
      geometry.indexType = .uint32
      geometry.triangleCount = range.indexCount / 3
      geometry.opaque = true
      let descriptor = MTLPrimitiveAccelerationStructureDescriptor()
      descriptor.geometryDescriptors = [geometry]
      return descriptor
    }

    let sizes = descriptors.map(device.accelerationStructureSizes(descriptor:))
    let structures = zip(descriptors, sizes).compactMap { _, size in
      device.makeAccelerationStructure(size: size.accelerationStructureSize)
    }
    guard structures.count == descriptors.count,
      let scratchSize = sizes.map(\.buildScratchBufferSize).max(),
      let scratch = device.makeBuffer(length: max(scratchSize, 32), options: .storageModePrivate),
      let commandBuffer = queue.makeCommandBuffer(),
      let encoder = commandBuffer.makeAccelerationStructureCommandEncoder()
    else { return nil }

    zip(structures, descriptors).forEach { structure, descriptor in
      encoder.build(
        accelerationStructure: structure, descriptor: descriptor, scratchBuffer: scratch,
        scratchBufferOffset: 0)
    }
    encoder.endEncoding()
    commandBuffer.commit()
    commandBuffer.waitUntilCompleted()
    return structures
  }

  private static func geometry(for mesh: MeshDescription)
    -> (vertices: [MeshVertex], indices: [UInt32])
  {
    switch mesh.shape {
    case .box: return box(size: mesh.size)
    case .plane: return plane(size: mesh.size)
    case .sphere: return sphere(radius: mesh.size.x, segments: mesh.segments)
    }
  }

  private static func box(size: SIMD3<Float>) -> (vertices: [MeshVertex], indices: [UInt32]) {
    let half = size * 0.5
    let faces: [(normal: SIMD3<Float>, right: SIMD3<Float>, up: SIMD3<Float>)] = [
      ([0, 0, 1], [1, 0, 0], [0, 1, 0]),
      ([0, 0, -1], [-1, 0, 0], [0, 1, 0]),
      ([1, 0, 0], [0, 0, -1], [0, 1, 0]),
      ([-1, 0, 0], [0, 0, 1], [0, 1, 0]),
      ([0, 1, 0], [1, 0, 0], [0, 0, -1]),
      ([0, -1, 0], [1, 0, 0], [0, 0, 1]),
    ]
    let corners: [SIMD2<Float>] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
    let vertices = faces.flatMap { face in
      corners.map { corner in
        MeshVertex(
          position: (face.normal + face.right * corner.x + face.up * corner.y) * half,
          normal: face.normal)
      }
    }
    let indices = (0..<faces.count).flatMap { face -> [UInt32] in
      let base = UInt32(face * 4)
      return [base, base + 1, base + 2, base, base + 2, base + 3]
    }
    return (vertices, indices)
  }

  private static func plane(size: SIMD3<Float>) -> (vertices: [MeshVertex], indices: [UInt32]) {
    let half = SIMD2<Float>(size.x, size.z) * 0.5
    let corners: [SIMD2<Float>] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
    let vertices = corners.map {
      MeshVertex(position: [$0.x * half.x, 0, $0.y * half.y], normal: [0, 1, 0])
    }
    return (vertices, [0, 2, 1, 0, 3, 2])
  }

  private static func sphere(radius: Float, segments: Int)
    -> (vertices: [MeshVertex], indices: [UInt32])
  {
    let rings = max(segments / 2, 3)
    let sectors = max(segments, 3)
    let vertices = (0...rings).flatMap { ring -> [MeshVertex] in
      let phi = Float.pi * Float(ring) / Float(rings)
      return (0...sectors).map { sector -> MeshVertex in
        let theta = 2 * Float.pi * Float(sector) / Float(sectors)
        let normal = SIMD3<Float>(
          sin(phi) * cos(theta), cos(phi), sin(phi) * sin(theta))
        return MeshVertex(position: normal * radius, normal: normal)
      }
    }
    let stride = UInt32(sectors + 1)
    let indices = (0..<rings).flatMap { ring -> [UInt32] in
      (0..<sectors).flatMap { sector -> [UInt32] in
        let current = UInt32(ring) * stride + UInt32(sector)
        let next = current + stride
        return [current, next, current + 1, current + 1, next, next + 1]
      }
    }
    return (vertices, indices)
  }
}
