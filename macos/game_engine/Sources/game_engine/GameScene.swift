import simd

enum MeshShape: String {
  case box
  case sphere
  case plane
}

struct MeshDescription {
  let shape: MeshShape
  let size: SIMD3<Float>
  let segments: Int

  init?(json: [String: Any]) {
    guard let raw = json["shape"] as? String, let shape = MeshShape(rawValue: raw) else {
      return nil
    }
    self.shape = shape
    self.size = SIMD3<Float>(json["size"] as? [Double] ?? [1, 1, 1])
    self.segments = json["segments"] as? Int ?? 24
  }
}

enum MaterialKind: String, CaseIterable {
  case opaque
  case water
  case glass
  case foliage
}

struct InstanceMaterial {
  var albedo: SIMD3<Float>
  var roughness: Float
  var emissive: SIMD3<Float>
  var metallic: Float
  var tint: SIMD3<Float>
  var ior: Float
  var kind: UInt32
}

struct InstanceDescription {
  let meshIndex: Int
  let material: InstanceMaterial

  init?(json: [String: Any]) {
    guard let meshIndex = json["mesh"] as? Int else { return nil }
    self.meshIndex = meshIndex
    let kind = MaterialKind(rawValue: json["kind"] as? String ?? "opaque") ?? .opaque
    self.material = InstanceMaterial(
      albedo: SIMD3<Float>(json["albedo"] as? [Double] ?? [0.8, 0.8, 0.8]),
      roughness: Float(json["roughness"] as? Double ?? 0.5),
      emissive: SIMD3<Float>(json["emissive"] as? [Double] ?? [0, 0, 0]),
      metallic: Float(json["metallic"] as? Double ?? 0),
      tint: SIMD3<Float>(json["tint"] as? [Double] ?? [1, 1, 1]),
      ior: Float(json["ior"] as? Double ?? 1.45),
      kind: UInt32(MaterialKind.allCases.firstIndex(of: kind) ?? 0))
  }
}

struct SunLight {
  var direction: SIMD3<Float>
  var color: SIMD3<Float>
  var intensity: Float
  var angularRadius: Float

  init(json: [String: Any]?) {
    let json = json ?? [:]
    let raw = SIMD3<Float>(json["direction"] as? [Double] ?? [-0.4, -1.0, -0.35])
    direction = simd_normalize(raw)
    color = SIMD3<Float>(json["color"] as? [Double] ?? [1.0, 0.96, 0.9])
    intensity = Float(json["intensity"] as? Double ?? 4.0)
    angularRadius = Float(json["angularRadius"] as? Double ?? 0.03)
  }
}

struct SkyGradient {
  var zenith: SIMD3<Float>
  var horizon: SIMD3<Float>
  var ground: SIMD3<Float>

  init(json: [String: Any]?) {
    let json = json ?? [:]
    zenith = SIMD3<Float>(json["zenith"] as? [Double] ?? [0.09, 0.16, 0.32])
    horizon = SIMD3<Float>(json["horizon"] as? [Double] ?? [0.42, 0.48, 0.58])
    ground = SIMD3<Float>(json["ground"] as? [Double] ?? [0.06, 0.06, 0.07])
  }
}

struct Fog {
  var color: SIMD3<Float>
  var density: Float

  init(json: [String: Any]?) {
    let json = json ?? [:]
    color = SIMD3<Float>(json["color"] as? [Double] ?? [0, 0, 0])
    density = Float(json["density"] as? Double ?? 0)
  }
}

struct GameScene {
  let meshes: [MeshDescription]
  let instances: [InstanceDescription]
  let sun: SunLight
  let sky: SkyGradient
  let fog: Fog

  init(json: [String: Any]) {
    meshes = (json["meshes"] as? [[String: Any]] ?? []).compactMap(MeshDescription.init(json:))
    instances = (json["instances"] as? [[String: Any]] ?? []).compactMap(
      InstanceDescription.init(json:))
    sun = SunLight(json: json["sun"] as? [String: Any])
    sky = SkyGradient(json: json["sky"] as? [String: Any])
    fog = Fog(json: json["fog"] as? [String: Any])
  }
}

extension SIMD3 where Scalar == Float {
  init(_ values: [Double]) {
    self.init(
      Float(values.count > 0 ? values[0] : 0),
      Float(values.count > 1 ? values[1] : 0),
      Float(values.count > 2 ? values[2] : 0))
  }
}
