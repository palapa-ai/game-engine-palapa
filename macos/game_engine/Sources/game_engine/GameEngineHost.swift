import FlutterMacOS
import Foundation
import simd

@available(macOS 15.0, *)
final class GameEngineHost {
  private let registry: FlutterTextureRegistry
  private let texture: EngineTexture
  private var engine: GameEngine?
  private var textureId: Int64?

  init(registry: FlutterTextureRegistry, texture: EngineTexture) {
    self.registry = registry
    self.texture = texture
  }

  func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    let arguments = call.arguments as? [String: Any] ?? [:]
    switch call.method {
    case "create":
      create(arguments: arguments, result: result)
    case "configure":
      configure(arguments: arguments, result: result)
    case "setScene":
      guard let engine else { return result(false) }
      result(engine.load(sceneJSON: arguments))
    case "frame":
      renderFrame(arguments: arguments, result: result)
    case "dispose":
      dispose()
      result(nil)
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  private func create(arguments: [String: Any], result: @escaping FlutterResult) {
    do {
      let engine = try self.engine ?? GameEngine()
      self.engine = engine
      try engine.configure(
        width: arguments["width"] as? Int ?? 640, height: arguments["height"] as? Int ?? 480,
        settings: RenderSettings(json: arguments["settings"] as? [String: Any] ?? [:]))
      let textureId = self.textureId ?? registry.register(texture)
      self.textureId = textureId
      var status = engine.status
      status["textureId"] = textureId
      result(status)
    } catch {
      result(FlutterError(code: "ENGINE_UNAVAILABLE", message: "\(error)", details: nil))
    }
  }

  private func configure(arguments: [String: Any], result: @escaping FlutterResult) {
    guard let engine else { return result(nil) }
    do {
      try engine.configure(
        width: arguments["width"] as? Int ?? 640, height: arguments["height"] as? Int ?? 480,
        settings: RenderSettings(json: arguments["settings"] as? [String: Any] ?? [:]))
      result(engine.status)
    } catch {
      result(FlutterError(code: "CONFIGURE_FAILED", message: "\(error)", details: nil))
    }
  }

  private func renderFrame(arguments: [String: Any], result: @escaping FlutterResult) {
    guard let engine, let textureId else { return result(nil) }
    let view = simd_float4x4(columnMajor: floats(arguments["view"]))
    let projection = simd_float4x4(columnMajor: floats(arguments["projection"]))
    let transformValues = floats(arguments["transforms"])
    let transforms = stride(from: 0, to: transformValues.count - 15, by: 16).map {
      simd_float4x4(columnMajor: Array(transformValues[$0..<($0 + 16)]))
    }

    var camera = FrameCamera()
    camera.worldToView = view
    camera.viewToClip = projection
    camera.fieldOfView = Float(arguments["fieldOfView"] as? Double ?? 1.0)
    camera.near = Float(arguments["near"] as? Double ?? 0.1)
    camera.far = Float(arguments["far"] as? Double ?? 200)
    camera.aspectRatio = Float(arguments["aspectRatio"] as? Double ?? 1.6)
    camera.deltaTime = Float(arguments["deltaSeconds"] as? Double ?? 1.0 / 60.0)

    let submission = FrameSubmission(
      view: view, projection: projection, transforms: transforms, camera: camera)
    let stats = engine.render(submission) { [weak self] pixelBuffer in
      guard let self else { return }
      self.texture.update(pixelBuffer)
      DispatchQueue.main.async { self.registry.textureFrameAvailable(textureId) }
    }
    result(stats)
  }

  private func dispose() {
    if let textureId { registry.unregisterTexture(textureId) }
    textureId = nil
    engine = nil
  }

  private func floats(_ value: Any?) -> [Float] {
    guard let typed = value as? FlutterStandardTypedData else { return [] }
    return typed.data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
  }
}
