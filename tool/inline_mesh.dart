import 'dart:io';
import 'dart:math' as math;

/// Folds a Wavefront OBJ into a scene document's `meshes:` block, so geometry
/// travels as data inside the YAML instead of as a file beside it.
///
///     dart run tool/inline_mesh.dart castle.obj castle > mesh.yaml
///
/// Missing normals are generated per face. Quads and larger faces are fanned
/// into triangles. Pass `--scale` to resize on the way in.
void main(List<String> arguments) {
  final scale = _option(arguments, '--scale') ?? 1.0;
  final positional = arguments
      .where((argument) => !argument.startsWith('--'))
      .toList();
  if (positional.length < 2) {
    stderr.writeln(
      'usage: inline_mesh.dart <file.obj> <mesh-name> [--scale=1.0]',
    );
    exit(64);
  }

  final mesh = _Obj.parse(File(positional.first).readAsLinesSync(), scale);
  final buffer = StringBuffer()
    ..writeln('  ${positional[1]}:')
    ..writeln('    shape: mesh')
    ..writeln(
      '    # ${mesh.vertexCount} vertices, ${mesh.triangleCount} triangles',
    )
    ..writeln('    vertices: [${mesh.vertices.map(_trim).join(', ')}]')
    ..writeln('    indices: [${mesh.indices.join(', ')}]');
  stdout.write(buffer);
}

String _trim(double value) => value
    .toStringAsFixed(4)
    .replaceAll(RegExp(r'0+$'), '')
    .replaceAll(RegExp(r'\.$'), '.0');

double? _option(List<String> arguments, String name) {
  final match = arguments.firstWhere(
    (argument) => argument.startsWith('$name='),
    orElse: () => '',
  );
  return match.isEmpty ? null : double.tryParse(match.split('=').last);
}

class _Obj {
  _Obj(this.vertices, this.indices);

  factory _Obj.parse(List<String> lines, double scale) {
    final positions = <List<double>>[];
    final normals = <List<double>>[];
    final faces = <List<({int position, int normal})>>[];

    for (final line in lines) {
      final parts = line.trim().split(RegExp(r'\s+'));
      switch (parts.first) {
        case 'v':
          positions.add(_triple(parts).map((value) => value * scale).toList());
        case 'vn':
          normals.add(_triple(parts));
        case 'f':
          faces.add(parts.skip(1).map(_corner).toList());
      }
    }

    final vertices = <double>[];
    final indices = <int>[];
    for (final face in faces) {
      final fanned = List.generate(
        math.max(face.length - 2, 0),
        (index) => [face[0], face[index + 1], face[index + 2]],
      );
      for (final triangle in fanned) {
        final generated = _faceNormal(
          triangle.map((c) => positions[c.position]).toList(),
        );
        for (final corner in triangle) {
          final normal = corner.normal >= 0 && corner.normal < normals.length
              ? normals[corner.normal]
              : generated;
          indices.add(vertices.length ~/ 6);
          vertices.addAll(positions[corner.position]);
          vertices.addAll(normal);
        }
      }
    }
    return _Obj(vertices, indices);
  }

  final List<double> vertices;
  final List<int> indices;

  int get vertexCount => vertices.length ~/ 6;
  int get triangleCount => indices.length ~/ 3;

  static List<double> _triple(List<String> parts) => parts
      .skip(1)
      .take(3)
      .map((value) => double.tryParse(value) ?? 0)
      .toList();

  static ({int position, int normal}) _corner(String token) {
    final fields = token.split('/');
    final position = (int.tryParse(fields.first) ?? 1) - 1;
    final normal = fields.length > 2 ? (int.tryParse(fields[2]) ?? 0) - 1 : -1;
    return (position: position, normal: normal);
  }

  static List<double> _faceNormal(List<List<double>> corners) {
    final edge1 = List.generate(3, (i) => corners[1][i] - corners[0][i]);
    final edge2 = List.generate(3, (i) => corners[2][i] - corners[0][i]);
    final cross = [
      edge1[1] * edge2[2] - edge1[2] * edge2[1],
      edge1[2] * edge2[0] - edge1[0] * edge2[2],
      edge1[0] * edge2[1] - edge1[1] * edge2[0],
    ];
    final length = math.sqrt(
      cross.fold(0.0, (sum, value) => sum + value * value),
    );
    return length == 0
        ? [0, 1, 0]
        : cross.map((value) => value / length).toList();
  }
}
