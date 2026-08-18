import FlutterMacOS
import Foundation

public class GameEnginePlugin: NSObject, FlutterPlugin {
  private let registry: FlutterTextureRegistry
  private let texture = EngineTexture()
  private let mouse = MouseCapture()
  private var host: AnyObject?

  init(registry: FlutterTextureRegistry) {
    self.registry = registry
    super.init()
  }

  public static func register(with registrar: FlutterPluginRegistrar) {
    MetalHUD.enableByDefault()
    let channel = FlutterMethodChannel(
      name: "palapa/game_engine", binaryMessenger: registrar.messenger)
    let instance = GameEnginePlugin(registry: registrar.textures)
    registrar.addMethodCallDelegate(instance, channel: channel)
    FlutterEventChannel(name: "palapa/game_engine/mouse", binaryMessenger: registrar.messenger)
      .setStreamHandler(instance.mouse)
  }

  public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    if call.method == "setMouseCaptured" {
      mouse.setCaptured(call.arguments as? Bool ?? false)
      return result(mouse.isCaptured)
    }
    if #available(macOS 15.0, *) {
      let host =
        self.host as? GameEngineHost ?? GameEngineHost(registry: registry, texture: texture)
      self.host = host
      host.handle(call, result: result)
    } else {
      result(
        FlutterError(code: "UNSUPPORTED_OS", message: "Requires macOS 15 or later", details: nil))
    }
  }
}
