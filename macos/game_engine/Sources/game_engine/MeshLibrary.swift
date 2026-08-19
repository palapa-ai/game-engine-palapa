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
    case .pyramid: return taper(size: mesh.size, top: 0)
    case .frustum: return taper(size: mesh.size, top: mesh.size.z)
    case .cylinder: return round(size: mesh.size, top: mesh.size.x, segments: mesh.segments)
    case .cone: return round(size: mesh.size, top: 0, segments: mesh.segments)
    case .dish: return dish(size: mesh.size, segments: mesh.segments)
    case .ring: return ring(size: mesh.size, segments: mesh.segments)
    case .sleeve: return sleeve(size: mesh.size, segments: mesh.segments)
    case .mesh: return raw(vertices: mesh.vertices, indices: mesh.indices)
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

  private static func raw(vertices: [Float], indices: [UInt32])
    -> (vertices: [MeshVertex], indices: [UInt32])
  {
    let stride = 6
    guard vertices.count >= stride, indices.count >= 3 else { return ([], []) }
    let unpacked = (0..<(vertices.count / stride)).map { index -> MeshVertex in
      let base = index * stride
      return MeshVertex(
        position: SIMD3<Float>(vertices[base], vertices[base + 1], vertices[base + 2]),
        normal: SIMD3<Float>(vertices[base + 3], vertices[base + 4], vertices[base + 5]))
    }
    return (unpacked, indices)
  }

  /// Circular base at y=0 with radius size.x/2, tapering to `top` diameter at
  /// y=size.y — a cone when `top` is zero.
  private static func round(size: SIMD3<Float>, top: Float, segments: Int)
    -> (vertices: [MeshVertex], indices: [UInt32])
  {
    let sides = max(segments, 6)
    let radius = size.x * 0.5
    let topRadius = max(top, 0) * 0.5
    let height = size.y
    let slope = normalize(SIMD2<Float>(height, radius - topRadius))

    let ring = (0..<sides).flatMap { side -> [MeshVertex] in
      let angleA = 2 * Float.pi * Float(side) / Float(sides)
      let angleB = 2 * Float.pi * Float(side + 1) / Float(sides)
      return [(angleA, false), (angleB, false), (angleB, true), (angleA, true)].map {
        angle, isTop in
        let direction = SIMD3<Float>(cos(angle), 0, sin(angle))
        let position =
          direction * (isTop ? topRadius : radius) + SIMD3<Float>(0, isTop ? height : 0, 0)
        return MeshVertex(
          position: position,
          normal: normalize(direction * slope.x + SIMD3<Float>(0, slope.y, 0)))
      }
    }
    let capPlanes: [(y: Float, normal: SIMD3<Float>, radius: Float)] = [
      (0, SIMD3<Float>(0, -1, 0), radius), (height, SIMD3<Float>(0, 1, 0), topRadius),
    ]
    let caps =
      capPlanes
      .flatMap { y, normal, capRadius -> [MeshVertex] in
        [MeshVertex(position: [0, y, 0], normal: normal)]
          + (0...sides).map { side -> MeshVertex in
            let angle = 2 * Float.pi * Float(side) / Float(sides)
            return MeshVertex(
              position: SIMD3<Float>(cos(angle) * capRadius, y, sin(angle) * capRadius),
              normal: normal)
          }
      }
    let sideIndices = (0..<sides).flatMap { side -> [UInt32] in
      let offset = UInt32(side * 4)
      return [offset, offset + 1, offset + 2, offset, offset + 2, offset + 3]
    }
    let capStride = UInt32(sides + 2)
    let capBase = UInt32(sides * 4)
    let capIndices = (0..<2).flatMap { cap -> [UInt32] in
      let center = capBase + UInt32(cap) * capStride
      return (0..<sides).flatMap { side -> [UInt32] in
        let first = center + 1 + UInt32(side)
        return cap == 0
          ? [center, first + 1, first] : [center, first, first + 1]
      }
    }
    return (ring + caps, sideIndices + capIndices)
  }

  /// Square base at y=0 tapering to `top` (0 gives a pyramid) at y=size.y.
  private static func taper(size: SIMD3<Float>, top: Float)
    -> (vertices: [MeshVertex], indices: [UInt32])
  {
    let half = size.x * 0.5
    let topHalf = max(top, 0) * 0.5
    let height = size.y
    let corners: [SIMD2<Float>] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
    let sides = (0..<4).flatMap { side -> [MeshVertex] in
      let a = corners[side]
      let b = corners[(side + 1) % 4]
      let bottomA = SIMD3<Float>(a.x * half, 0, a.y * half)
      let bottomB = SIMD3<Float>(b.x * half, 0, b.y * half)
      let topA = SIMD3<Float>(a.x * topHalf, height, a.y * topHalf)
      let topB = SIMD3<Float>(b.x * topHalf, height, b.y * topHalf)
      let normal = normalize(cross(bottomB - bottomA, topA - bottomA))
      return [bottomA, bottomB, topB, topA].map { MeshVertex(position: $0, normal: normal) }
    }
    let base = corners.map {
      MeshVertex(position: SIMD3<Float>($0.x * half, 0, $0.y * half), normal: [0, -1, 0])
    }
    let cap = corners.map {
      MeshVertex(position: SIMD3<Float>($0.x * topHalf, height, $0.y * topHalf), normal: [0, 1, 0])
    }
    let quads = (0..<6).flatMap { quad -> [UInt32] in
      let offset = UInt32(quad * 4)
      return [offset, offset + 1, offset + 2, offset, offset + 2, offset + 3]
    }
    return (sides + base + cap, quads)
  }

  private static func plane(size: SIMD3<Float>) -> (vertices: [MeshVertex], indices: [UInt32]) {
    let half = SIMD2<Float>(size.x, size.z) * 0.5
    let corners: [SIMD2<Float>] = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
    let vertices = corners.map {
      MeshVertex(position: [$0.x * half.x, 0, $0.y * half.y], normal: [0, 1, 0])
    }
    return (vertices, [0, 2, 1, 0, 3, 2])
  }

  /// An open tube — no caps, and `size.z` degrees of it, so a partial sweep
  /// leaves a slot down one side. The wall is centred on -z, which puts it on
  /// top and the slot underneath once the tube is laid down by a quarter turn.
  private static func sleeve(size: SIMD3<Float>, segments: Int)
    -> (vertices: [MeshVertex], indices: [UInt32])
  {
    let sides = max(segments, 6)
    let radius = size.x * 0.5
    let sweep = (size.z > 0 ? size.z : 360) * Float.pi / 180
    let vertices = (0...sides).flatMap { side -> [MeshVertex] in
      let angle = sweep * (Float(side) / Float(sides) - 0.5)
      let direction = SIMD3<Float>(sin(angle), 0, -cos(angle))
      return [0, size.y].map { height in
        MeshVertex(
          position: direction * radius + SIMD3<Float>(0, height, 0), normal: direction)
      }
    }
    let indices = (0..<sides).flatMap { side -> [UInt32] in
      let base = UInt32(side * 2)
      return [base, base + 1, base + 3, base, base + 3, base + 2]
    }
    return (vertices, indices)
  }

  /// A spherical cap: rim circle at y=0, bulging to `size.y` at the apex —
  /// the shape of a road mirror, not a ball cut in half.
  private static func dish(size: SIMD3<Float>, segments: Int)
    -> (vertices: [MeshVertex], indices: [UInt32])
  {
    let rim = max(size.x * 0.5, 0.0001)
    let depth = max(size.y, 0.0001)
    let radius = (rim * rim + depth * depth) / (2 * depth)
    let centre = SIMD3<Float>(0, depth - radius, 0)
    // Past a hemisphere the rim sits below the sphere's equator, where asin
    // folds the angle back on itself and the cap comes out floating and small.
    let limit = acos(max(min((radius - depth) / radius, 1), -1))
    let rings = max(segments / 3, 3)
    let sectors = max(segments, 3)
    let vertices = (0...rings).flatMap { ring -> [MeshVertex] in
      let phi = limit * Float(ring) / Float(rings)
      return (0...sectors).map { sector -> MeshVertex in
        let theta = 2 * Float.pi * Float(sector) / Float(sectors)
        let normal = SIMD3<Float>(sin(phi) * cos(theta), cos(phi), sin(phi) * sin(theta))
        return MeshVertex(position: centre + normal * radius, normal: normal)
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

  /// A torus lying in the xz plane: `size.x` across, `size.y` of tube.
  private static func ring(size: SIMD3<Float>, segments: Int)
    -> (vertices: [MeshVertex], indices: [UInt32])
  {
    let tube = max(size.y * 0.5, 0.0001)
    let major = max(size.x * 0.5 - tube, tube)
    let arcs = max(segments, 6)
    let sides = max(segments / 2, 4)
    let vertices = (0...arcs).flatMap { arc -> [MeshVertex] in
      let theta = 2 * Float.pi * Float(arc) / Float(arcs)
      let around = SIMD3<Float>(cos(theta), 0, sin(theta))
      return (0...sides).map { side -> MeshVertex in
        let phi = 2 * Float.pi * Float(side) / Float(sides)
        let normal = around * cos(phi) + SIMD3<Float>(0, sin(phi), 0)
        return MeshVertex(position: around * major + normal * tube, normal: normal)
      }
    }
    let stride = UInt32(sides + 1)
    let indices = (0..<arcs).flatMap { arc -> [UInt32] in
      (0..<sides).flatMap { side -> [UInt32] in
        let current = UInt32(arc) * stride + UInt32(side)
        let next = current + stride
        return [current, next, current + 1, current + 1, next, next + 1]
      }
    }
    return (vertices, indices)
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
