import CoreVideo
import Metal

@available(macOS 15.0, *)
struct OutputSurface {
  let pixelBuffer: CVPixelBuffer
  let texture: MTLTexture
  private let cvTexture: CVMetalTexture

  init?(device: MTLDevice, cache: CVMetalTextureCache, width: Int, height: Int) {
    let attributes: CFDictionary =
      [
        kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary,
        kCVPixelBufferMetalCompatibilityKey: true,
      ] as CFDictionary
    var buffer: CVPixelBuffer?
    guard
      CVPixelBufferCreate(nil, width, height, kCVPixelFormatType_32BGRA, attributes, &buffer)
        == kCVReturnSuccess, let pixelBuffer = buffer
    else { return nil }

    var created: CVMetalTexture?
    guard
      CVMetalTextureCacheCreateTextureFromImage(
        nil, cache, pixelBuffer, nil, .bgra8Unorm, width, height, 0, &created) == kCVReturnSuccess,
      let cvTexture = created, let texture = CVMetalTextureGetTexture(cvTexture)
    else { return nil }

    self.pixelBuffer = pixelBuffer
    self.cvTexture = cvTexture
    self.texture = texture
  }
}

@available(macOS 15.0, *)
final class RenderTargets {
  static let colorFormat = MTLPixelFormat.rgba16Float
  static let normalFormat = MTLPixelFormat.rgba16Float
  static let roughnessFormat = MTLPixelFormat.r16Float
  static let motionFormat = MTLPixelFormat.rg16Float
  static let depthFormat = MTLPixelFormat.r32Float
  static let presentFormat = MTLPixelFormat.bgra8Unorm

  let renderWidth: Int
  let renderHeight: Int
  let outputWidth: Int
  let outputHeight: Int

  let albedo: MTLTexture
  let normal: MTLTexture
  let roughness: MTLTexture
  let motion: MTLTexture
  let specularAlbedo: MTLTexture
  let emissive: MTLTexture
  let depth: MTLTexture
  let shaded: MTLTexture
  let scaled: MTLTexture
  let previousScaled: MTLTexture
  let interpolated: MTLTexture
  let presented: MTLTexture

  private let surfaces: [OutputSurface]
  private var surfaceIndex = 0

  init?(
    device: MTLDevice, cache: CVMetalTextureCache, output: (width: Int, height: Int), scale: Float
  ) {
    let outputWidth = max(output.width, 16)
    let outputHeight = max(output.height, 16)
    let renderWidth = max(Int((Float(outputWidth) * scale).rounded()), 16)
    let renderHeight = max(Int((Float(outputHeight) * scale).rounded()), 16)
    self.outputWidth = outputWidth
    self.outputHeight = outputHeight
    self.renderWidth = renderWidth
    self.renderHeight = renderHeight

    func make(_ format: MTLPixelFormat, _ width: Int, _ height: Int) -> MTLTexture? {
      let descriptor = MTLTextureDescriptor.texture2DDescriptor(
        pixelFormat: format, width: width, height: height, mipmapped: false)
      descriptor.usage = [.shaderRead, .shaderWrite, .renderTarget]
      descriptor.storageMode = .private
      return device.makeTexture(descriptor: descriptor)
    }

    guard let albedo = make(Self.colorFormat, renderWidth, renderHeight),
      let normal = make(Self.normalFormat, renderWidth, renderHeight),
      let roughness = make(Self.roughnessFormat, renderWidth, renderHeight),
      let motion = make(Self.motionFormat, renderWidth, renderHeight),
      let specularAlbedo = make(Self.colorFormat, renderWidth, renderHeight),
      let emissive = make(Self.colorFormat, renderWidth, renderHeight),
      let depth = make(Self.depthFormat, renderWidth, renderHeight),
      let shaded = make(Self.colorFormat, renderWidth, renderHeight),
      let scaled = make(Self.colorFormat, outputWidth, outputHeight),
      let previousScaled = make(Self.colorFormat, outputWidth, outputHeight),
      let interpolated = make(Self.colorFormat, outputWidth, outputHeight),
      let presented = make(Self.presentFormat, outputWidth, outputHeight)
    else { return nil }

    self.albedo = albedo
    self.normal = normal
    self.roughness = roughness
    self.motion = motion
    self.specularAlbedo = specularAlbedo
    self.emissive = emissive
    self.depth = depth
    self.shaded = shaded
    self.scaled = scaled
    self.previousScaled = previousScaled
    self.interpolated = interpolated
    self.presented = presented

    let surfaces = (0..<3).compactMap {
      _ in OutputSurface(device: device, cache: cache, width: outputWidth, height: outputHeight)
    }
    guard surfaces.count == 3 else { return nil }
    self.surfaces = surfaces
  }

  func nextSurface() -> OutputSurface {
    surfaceIndex = (surfaceIndex + 1) % surfaces.count
    return surfaces[surfaceIndex]
  }
}
