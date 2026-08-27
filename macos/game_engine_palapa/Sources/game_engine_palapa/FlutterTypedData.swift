import FlutterMacOS
import Foundation

typealias FlutterFloats = FlutterStandardTypedData
typealias FlutterInts = FlutterStandardTypedData

extension FlutterStandardTypedData {
  var floats: [Float] {
    data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
  }

  var ints: [UInt32] {
    data.withUnsafeBytes { $0.bindMemory(to: Int32.self).map { UInt32(max($0, 0)) } }
  }
}
