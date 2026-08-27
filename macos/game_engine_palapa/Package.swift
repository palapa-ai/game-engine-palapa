// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "game_engine_palapa",
  platforms: [.macOS("10.15")],
  products: [
    .library(name: "game-engine-palapa", targets: ["game_engine_palapa"])
  ],
  dependencies: [],
  targets: [
    .target(name: "game_engine_palapa")
  ],
  swiftLanguageModes: [.v5]
)
