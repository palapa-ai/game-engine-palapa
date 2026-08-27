import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:game_engine_palapa/game_engine_palapa.dart';

void main() {
  test('cornell scene parses with its raw mesh intact', () {
    final doc = SceneDocument.parse(
      File('assets/cornell.yaml').readAsStringSync(),
    );
    expect(doc.instances.length, doc.transforms.length);
    final teapot = doc.meshes.firstWhere((m) => m.shape == MeshShape.mesh);
    expect(teapot.vertices, isNotNull);
    expect(teapot.vertices!.length, greaterThan(1000));
    expect(teapot.indices!.length, greaterThan(1000));
  });
}
