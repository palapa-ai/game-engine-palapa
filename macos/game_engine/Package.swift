// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "game_engine",
  platforms: [.macOS("10.15")],
  products: [
    .library(name: "game-engine", targets: ["game_engine"])
  ],
  dependencies: [],
  targets: [
    .target(name: "game_engine")
  ],
  swiftLanguageModes: [.v5]
)
