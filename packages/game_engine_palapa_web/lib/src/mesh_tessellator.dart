import 'dart:math' as math;
import 'dart:typed_data';

import 'package:game_engine_palapa/game_engine_palapa.dart';

class TessellatedMesh {
  const TessellatedMesh({
    required this.positions,
    required this.normals,
    required this.indices,
  });

  final Float32List positions;
  final Float32List normals;
  final Uint32List indices;
}

TessellatedMesh tessellate(MeshDescription mesh) => switch (mesh.shape) {
  .box => _box(mesh.size),
  .plane => _plane(mesh.size),
  .sphere => _sphere(mesh.size.x, mesh.segments),
  .pyramid => _taper(mesh.size, 0),
  .frustum => _taper(mesh.size, mesh.size.z),
  .cylinder => _round(mesh.size, mesh.size.x, mesh.segments),
  .cone => _round(mesh.size, 0, mesh.segments),
  .dish => _dish(mesh.size, mesh.segments),
  .ring => _ring(mesh.size, mesh.segments),
  .sleeve => _sleeve(mesh.size, mesh.segments),
  .mesh => _raw(mesh.vertices, mesh.indices),
};

class _Vertex {
  const _Vertex(this.position, this.normal);

  final Vec3 position;
  final Vec3 normal;
}

const _corners = [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)];

const _boxFaces = [
  (normal: Vec3(0, 0, 1), right: Vec3(1, 0, 0), up: Vec3(0, 1, 0)),
  (normal: Vec3(0, 0, -1), right: Vec3(-1, 0, 0), up: Vec3(0, 1, 0)),
  (normal: Vec3(1, 0, 0), right: Vec3(0, 0, -1), up: Vec3(0, 1, 0)),
  (normal: Vec3(-1, 0, 0), right: Vec3(0, 0, 1), up: Vec3(0, 1, 0)),
  (normal: Vec3(0, 1, 0), right: Vec3(1, 0, 0), up: Vec3(0, 0, -1)),
  (normal: Vec3(0, -1, 0), right: Vec3(1, 0, 0), up: Vec3(0, 0, 1)),
];

Iterable<int> _steps(int count) => Iterable<int>.generate(count);

Vec3 _cross(Vec3 a, Vec3 b) =>
    Vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

Vec3 _scaled(Vec3 value, Vec3 by) =>
    Vec3(value.x * by.x, value.y * by.y, value.z * by.z);

({double x, double y}) _normalized2(double x, double y) {
  final length = math.sqrt(x * x + y * y);

  return (x: x / length, y: y / length);
}

Float32List _floats(Iterable<Vec3> values) =>
    Float32List.fromList(values.expand((value) => value.values).toList());

TessellatedMesh _mesh(Iterable<_Vertex> vertices, Iterable<int> indices) {
  final list = vertices.toList();

  return TessellatedMesh(
    positions: _floats(list.map((vertex) => vertex.position)),
    normals: _floats(list.map((vertex) => vertex.normal)),
    indices: Uint32List.fromList(indices.toList()),
  );
}

Iterable<int> _quadIndices(int quads) => _steps(quads).expand((quad) {
  final base = quad * 4;

  return [base, base + 1, base + 2, base, base + 2, base + 3];
});

Iterable<int> _gridIndices(int rings, int sectors) {
  final stride = sectors + 1;

  return _steps(rings).expand(
    (ring) => _steps(sectors).expand((sector) {
      final current = ring * stride + sector;
      final next = current + stride;

      return [current, next, current + 1, current + 1, next, next + 1];
    }),
  );
}

Iterable<_Vertex> _sphericalVertices({
  required int rings,
  required int sectors,
  required double limit,
  required double radius,
  required Vec3 centre,
}) => _steps(rings + 1).expand((ring) {
  final phi = limit * ring / rings;

  return _steps(sectors + 1).map((sector) {
    final theta = 2 * math.pi * sector / sectors;
    final normal = Vec3(
      math.sin(phi) * math.cos(theta),
      math.cos(phi),
      math.sin(phi) * math.sin(theta),
    );

    return _Vertex(centre + normal * radius, normal);
  });
});

TessellatedMesh _box(Vec3 size) {
  final half = size * 0.5;

  return _mesh(
    _boxFaces.expand(
      (face) => _corners.map(
        (corner) => _Vertex(
          _scaled(
            face.normal + face.right * corner.$1 + face.up * corner.$2,
            half,
          ),
          face.normal,
        ),
      ),
    ),
    _quadIndices(_boxFaces.length),
  );
}

TessellatedMesh _plane(Vec3 size) {
  final halfX = size.x * 0.5;
  final halfZ = size.z * 0.5;

  return _mesh(
    _corners.map(
      (corner) => _Vertex(
        Vec3(corner.$1 * halfX, 0, corner.$2 * halfZ),
        const Vec3(0, 1, 0),
      ),
    ),
    const [0, 2, 1, 0, 3, 2],
  );
}

TessellatedMesh _sphere(double radius, int segments) {
  final rings = math.max(segments ~/ 2, 3);
  final sectors = math.max(segments, 3);

  return _mesh(
    _sphericalVertices(
      rings: rings,
      sectors: sectors,
      limit: math.pi,
      radius: radius,
      centre: Vec3.zero,
    ),
    _gridIndices(rings, sectors),
  );
}

TessellatedMesh _taper(Vec3 size, double top) {
  final half = size.x * 0.5;
  final topHalf = math.max(top, 0.0) * 0.5;
  final height = size.y;

  final sides = _steps(4).expand((side) {
    final a = _corners[side];
    final b = _corners[(side + 1) % 4];
    final bottomA = Vec3(a.$1 * half, 0, a.$2 * half);
    final bottomB = Vec3(b.$1 * half, 0, b.$2 * half);
    final topA = Vec3(a.$1 * topHalf, height, a.$2 * topHalf);
    final topB = Vec3(b.$1 * topHalf, height, b.$2 * topHalf);
    final normal = _cross(bottomB - bottomA, topA - bottomA).normalized;

    return [bottomA, bottomB, topB, topA].map((p) => _Vertex(p, normal));
  });

  final base = _corners.map(
    (corner) => _Vertex(
      Vec3(corner.$1 * half, 0, corner.$2 * half),
      const Vec3(0, -1, 0),
    ),
  );
  final cap = _corners.map(
    (corner) => _Vertex(
      Vec3(corner.$1 * topHalf, height, corner.$2 * topHalf),
      const Vec3(0, 1, 0),
    ),
  );

  return _mesh([...sides, ...base, ...cap], _quadIndices(6));
}

TessellatedMesh _round(Vec3 size, double top, int segments) {
  final sides = math.max(segments, 6);
  final radius = size.x * 0.5;
  final topRadius = math.max(top, 0.0) * 0.5;
  final height = size.y;
  final slope = _normalized2(height, radius - topRadius);

  final wall = _steps(sides).expand((side) {
    final angleA = 2 * math.pi * side / sides;
    final angleB = 2 * math.pi * (side + 1) / sides;

    return [
      (angleA, false),
      (angleB, false),
      (angleB, true),
      (angleA, true),
    ].map((corner) {
      final (angle, isTop) = corner;
      final direction = Vec3(math.cos(angle), 0, math.sin(angle));
      final (ringRadius, y) = switch (isTop) {
        true => (topRadius, height),
        false => (radius, 0.0),
      };

      return _Vertex(
        direction * ringRadius + Vec3(0, y, 0),
        (direction * slope.x + Vec3(0, slope.y, 0)).normalized,
      );
    });
  });

  final capPlanes = [
    (y: 0.0, normal: const Vec3(0, -1, 0), radius: radius),
    (y: height, normal: const Vec3(0, 1, 0), radius: topRadius),
  ];
  final caps = capPlanes.expand(
    (plane) => [
      _Vertex(Vec3(0, plane.y, 0), plane.normal),
      ..._steps(sides + 1).map((side) {
        final angle = 2 * math.pi * side / sides;

        return _Vertex(
          Vec3(
            math.cos(angle) * plane.radius,
            plane.y,
            math.sin(angle) * plane.radius,
          ),
          plane.normal,
        );
      }),
    ],
  );

  final capStride = sides + 2;
  final capBase = sides * 4;
  final capIndices = _steps(2).expand((cap) {
    final centre = capBase + cap * capStride;

    return _steps(sides).expand((side) {
      final first = centre + 1 + side;

      return cap == 0 ? [centre, first + 1, first] : [centre, first, first + 1];
    });
  });

  return _mesh([...wall, ...caps], [..._quadIndices(sides), ...capIndices]);
}

TessellatedMesh _dish(Vec3 size, int segments) {
  final rim = math.max(size.x * 0.5, 0.0001);
  final depth = math.max(size.y, 0.0001);
  final radius = (rim * rim + depth * depth) / (2 * depth);
  final rings = math.max(segments ~/ 3, 3);
  final sectors = math.max(segments, 3);

  // Past a hemisphere the rim sits below the sphere's equator, where asin folds
  // the angle back on itself and the cap comes out floating and small.
  final limit = math.acos(
    math.min(math.max((radius - depth) / radius, -1.0), 1.0),
  );

  return _mesh(
    _sphericalVertices(
      rings: rings,
      sectors: sectors,
      limit: limit,
      radius: radius,
      centre: Vec3(0, depth - radius, 0),
    ),
    _gridIndices(rings, sectors),
  );
}

TessellatedMesh _ring(Vec3 size, int segments) {
  final tube = math.max(size.y * 0.5, 0.0001);
  final major = math.max(size.x * 0.5 - tube, tube);
  final arcs = math.max(segments, 6);
  final sides = math.max(segments ~/ 2, 4);

  return _mesh(
    _steps(arcs + 1).expand((arc) {
      final theta = 2 * math.pi * arc / arcs;
      final around = Vec3(math.cos(theta), 0, math.sin(theta));

      return _steps(sides + 1).map((side) {
        final phi = 2 * math.pi * side / sides;
        final normal = around * math.cos(phi) + Vec3(0, math.sin(phi), 0);

        return _Vertex(around * major + normal * tube, normal);
      });
    }),
    _gridIndices(arcs, sides),
  );
}

TessellatedMesh _sleeve(Vec3 size, int segments) {
  final sides = math.max(segments, 6);
  final radius = size.x * 0.5;
  final sweep = (size.z > 0 ? size.z : 360) * math.pi / 180;

  return _mesh(
    _steps(sides + 1).expand((side) {
      final angle = sweep * (side / sides - 0.5);
      final direction = Vec3(math.sin(angle), 0, -math.cos(angle));

      return [0.0, size.y].map(
        (height) => _Vertex(direction * radius + Vec3(0, height, 0), direction),
      );
    }),
    _steps(sides).expand((side) {
      final base = side * 2;

      return [base, base + 1, base + 3, base, base + 3, base + 2];
    }),
  );
}

TessellatedMesh _raw(Float32List? vertices, Uint32List? indices) {
  const stride = 6;
  if (vertices == null ||
      indices == null ||
      vertices.length < stride ||
      indices.length < 3) {
    return _mesh(const [], const []);
  }

  return _mesh(
    _steps(vertices.length ~/ stride).map((index) {
      final base = index * stride;

      return _Vertex(
        Vec3(vertices[base], vertices[base + 1], vertices[base + 2]),
        Vec3(vertices[base + 3], vertices[base + 4], vertices[base + 5]),
      );
    }),
    indices,
  );
}
