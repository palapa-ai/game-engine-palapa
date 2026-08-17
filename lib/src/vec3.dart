import 'dart:math' as math;

class Vec3 {
  const Vec3(this.x, this.y, this.z);
  const Vec3.all(double value) : x = value, y = value, z = value;
  static const zero = Vec3(0, 0, 0);

  final double x;
  final double y;
  final double z;

  Vec3 operator +(Vec3 other) => Vec3(x + other.x, y + other.y, z + other.z);
  Vec3 operator -(Vec3 other) => Vec3(x - other.x, y - other.y, z - other.z);
  Vec3 operator *(double scalar) => Vec3(x * scalar, y * scalar, z * scalar);

  double get length => math.sqrt(x * x + y * y + z * z);
  Vec3 get normalized => length == 0 ? this : this * (1 / length);

  List<double> get values => [x, y, z];
}
