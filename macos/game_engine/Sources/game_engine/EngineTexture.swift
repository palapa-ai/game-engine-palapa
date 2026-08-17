import CoreVideo
import FlutterMacOS

final class EngineTexture: NSObject, FlutterTexture {
  private var buffer: CVPixelBuffer?
  private let lock = NSLock()

  func update(_ pixelBuffer: CVPixelBuffer) {
    lock.lock()
    buffer = pixelBuffer
    lock.unlock()
  }

  func copyPixelBuffer() -> Unmanaged<CVPixelBuffer>? {
    lock.lock()
    defer { lock.unlock() }
    guard let buffer else { return nil }
    return Unmanaged.passRetained(buffer)
  }
}
