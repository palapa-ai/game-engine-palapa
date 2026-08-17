enum GameShaders {
  static let source = """
    #include <metal_stdlib>
    #include <metal_raytracing>
    using namespace metal;
    using namespace raytracing;

    constant uint kindOpaque = 0;
    constant uint kindWater = 1;
    constant uint kindGlass = 2;
    constant uint kindFoliage = 3;

    struct FrameUniforms {
      float4x4 viewProjection;
      float4x4 inverseViewProjection;
      float4x4 previousViewProjection;
      float3 cameraPosition;
      float3 sunDirection;
      float3 sunColor;
      float3 skyZenith;
      float3 skyHorizon;
      float3 skyGround;
      float3 fogColor;
      float2 renderSize;
      float2 jitter;
      float sunIntensity;
      float sunAngularRadius;
      float exposure;
      float fogDensity;
      float time;
      uint frameIndex;
      uint bounceRays;
    };

    struct InstanceMaterial {
      float3 albedo;
      float roughness;
      float3 emissive;
      float metallic;
      float3 tint;
      float ior;
      uint kind;
    };

    struct Vertex {
      float3 position;
      float3 normal;
    };

    struct MeshRange {
      uint vertexOffset;
      uint indexOffset;
    };

    struct Scene {
      instance_acceleration_structure structure;
      device const Vertex *vertices;
      device const uint *indices;
      device const MeshRange *ranges;
      device const InstanceMaterial *materials;
      device const float4x4 *transforms;
      device const float4x4 *previousTransforms;
      device const float4x4 *inverseTransforms;
    };

    static inline float2 clipToPixel(float4 clip, float2 size) {
      float2 ndc = clip.xy / max(clip.w, 1e-6);
      float2 uv = float2(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
      return uv * size;
    }

    static inline uint hash(uint x) {
      x ^= x >> 16; x *= 0x7feb352du;
      x ^= x >> 15; x *= 0x846ca68bu;
      x ^= x >> 16;
      return x;
    }

    static inline float randomFloat(thread uint &state) {
      state = state * 747796405u + 2891336453u;
      uint result = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
      result = (result >> 22u) ^ result;
      return float(result) * (1.0 / 4294967296.0);
    }

    static inline float valueNoise(float2 position) {
      float2 cell = floor(position);
      float2 fraction = fract(position);
      fraction = fraction * fraction * (3.0 - 2.0 * fraction);
      float corner00 = float(hash(uint(cell.x) * 374761393u + uint(cell.y) * 668265263u)) / 4294967296.0;
      float corner10 = float(hash(uint(cell.x + 1) * 374761393u + uint(cell.y) * 668265263u)) / 4294967296.0;
      float corner01 = float(hash(uint(cell.x) * 374761393u + uint(cell.y + 1) * 668265263u)) / 4294967296.0;
      float corner11 = float(hash(uint(cell.x + 1) * 374761393u + uint(cell.y + 1) * 668265263u)) / 4294967296.0;
      return mix(mix(corner00, corner10, fraction.x), mix(corner01, corner11, fraction.x), fraction.y);
    }

    // Three crossing gerstner-ish ripples; also drives the fake caustic gain.
    static inline float3 waterNormal(float3 position, float time) {
      float2 p = position.xz;
      float wave = 0.0;
      float2 gradient = float2(0.0);
      float amplitude = 0.09;
      float frequency = 0.22;
      float2 directions[3] = { float2(1.0, 0.35), float2(-0.6, 1.0), float2(0.35, -0.9) };
      for (uint i = 0; i < 3; ++i) {
        float2 direction = normalize(directions[i]);
        float phase = dot(p, direction) * frequency + time * (0.9 + float(i) * 0.35);
        wave += sin(phase) * amplitude;
        gradient += direction * cos(phase) * amplitude * frequency;
        amplitude *= 0.55;
        frequency *= 1.9;
      }
      return normalize(float3(-gradient.x, 1.0, -gradient.y));
    }

    static inline float causticGain(float3 position, float3 sunDirection, float time) {
      float3 normal = waterNormal(position, time);
      float focus = saturate(dot(normal, -sunDirection));
      float shimmer = valueNoise(position.xz * 0.6 + time * 0.35);
      return 0.35 + 2.6 * pow(focus, 24.0) + 0.5 * shimmer * pow(focus, 6.0);
    }

    static inline float3 sampleSky(float3 direction, constant FrameUniforms &uniforms) {
      float height = direction.y;
      float3 sky = mix(uniforms.skyHorizon, uniforms.skyZenith, saturate(height));
      float3 color = mix(uniforms.skyGround, sky, smoothstep(-0.08, 0.02, height));
      float sunCosine = dot(direction, -uniforms.sunDirection);
      float disc = smoothstep(cos(uniforms.sunAngularRadius * 3.0),
                              cos(uniforms.sunAngularRadius), sunCosine);
      return color + uniforms.sunColor * uniforms.sunIntensity * disc;
    }

    static inline float3 orthonormal(float3 normal) {
      float3 helper = abs(normal.y) < 0.99 ? float3(0.0, 1.0, 0.0) : float3(1.0, 0.0, 0.0);
      return normalize(cross(helper, normal));
    }

    static inline float3 cosineHemisphere(float3 normal, thread uint &state) {
      float u1 = randomFloat(state);
      float u2 = randomFloat(state);
      float radius = sqrt(u1);
      float phi = 2.0 * M_PI_F * u2;
      float3 tangent = orthonormal(normal);
      float3 bitangent = cross(normal, tangent);
      return normalize(tangent * (radius * cos(phi)) + bitangent * (radius * sin(phi))
                     + normal * sqrt(max(0.0, 1.0 - u1)));
    }

    static inline float3 coneSample(float3 direction, float angle, thread uint &state) {
      float3 tangent = orthonormal(direction);
      float3 bitangent = cross(direction, tangent);
      float u1 = randomFloat(state);
      float u2 = randomFloat(state);
      float radius = angle * sqrt(u1);
      float phi = 2.0 * M_PI_F * u2;
      return normalize(direction + tangent * (radius * cos(phi)) + bitangent * (radius * sin(phi)));
    }

    static inline float ggx(float3 normal, float3 view, float3 light, float roughness) {
      float3 halfway = normalize(view + light);
      float alpha = roughness * roughness;
      float alphaSquared = alpha * alpha;
      float nh = saturate(dot(normal, halfway));
      float denominator = nh * nh * (alphaSquared - 1.0) + 1.0;
      float distribution = alphaSquared / max(M_PI_F * denominator * denominator, 1e-5);
      float k = alpha * 0.5;
      float nv = saturate(dot(normal, view));
      float nl = saturate(dot(normal, light));
      float visibility = 1.0 / max((nv * (1.0 - k) + k) * (nl * (1.0 - k) + k) * 4.0, 1e-5);
      return distribution * visibility * nl;
    }

    static inline float schlick(float cosine, float reflectance) {
      return reflectance + (1.0 - reflectance) * pow(saturate(1.0 - cosine), 5.0);
    }

    struct SurfaceHit {
      float3 position;
      float3 normal;
      float4 clip;
      float4 previousClip;
      InstanceMaterial material;
    };

    static inline SurfaceHit resolveHit(
        intersector<instancing, triangle_data>::result_type hit,
        float3 origin, float3 direction,
        constant FrameUniforms &uniforms, Scene scene) {
      uint instance = hit.instance_id;
      MeshRange range = scene.ranges[instance];
      uint base = range.indexOffset + hit.primitive_id * 3;
      Vertex v0 = scene.vertices[range.vertexOffset + scene.indices[base + 0]];
      Vertex v1 = scene.vertices[range.vertexOffset + scene.indices[base + 1]];
      Vertex v2 = scene.vertices[range.vertexOffset + scene.indices[base + 2]];

      float2 uv = hit.triangle_barycentric_coord;
      float3 weights = float3(1.0 - uv.x - uv.y, uv.x, uv.y);
      float3 objectNormal = normalize(
          v0.normal * weights.x + v1.normal * weights.y + v2.normal * weights.z);

      float4x4 inverseModel = scene.inverseTransforms[instance];
      float3 world = origin + direction * hit.distance;
      float4 objectPosition = inverseModel * float4(world, 1.0);
      float3 previousWorld = (scene.previousTransforms[instance] * objectPosition).xyz;

      SurfaceHit surface;
      surface.position = world;
      surface.normal = normalize((float4(objectNormal, 0.0) * inverseModel).xyz);
      surface.clip = uniforms.viewProjection * float4(world, 1.0);
      surface.previousClip = uniforms.previousViewProjection * float4(previousWorld, 1.0);
      surface.material = scene.materials[instance];
      return surface;
    }

    // Shadow rays pass through water and glass, tinted, so the sun still reaches
    // the sea floor and shorelines — this is where the caustic gain enters.
    static inline float3 sunVisibility(Scene scene, float3 origin, float3 direction,
                                       constant FrameUniforms &uniforms) {
      float3 attenuation = float3(1.0);
      float3 position = origin;
      for (uint step = 0; step < 3u; ++step) {
        intersector<instancing, triangle_data> occlusion;
        occlusion.assume_geometry_type(geometry_type::triangle);
        occlusion.force_opacity(forced_opacity::opaque);
        ray shadowRay;
        shadowRay.origin = position;
        shadowRay.direction = direction;
        shadowRay.min_distance = 1e-3;
        shadowRay.max_distance = 1e5;
        auto hit = occlusion.intersect(shadowRay, scene.structure);
        if (hit.type == intersection_type::none) return attenuation;

        InstanceMaterial material = scene.materials[hit.instance_id];
        if (material.kind != kindWater && material.kind != kindGlass) return float3(0.0);

        position = position + direction * (hit.distance + 1e-3);
        attenuation *= material.tint;
        if (material.kind == kindWater) {
          attenuation *= causticGain(position, uniforms.sunDirection, uniforms.time);
        }
      }
      return attenuation;
    }

    static inline float3 shadeSurface(Scene scene, SurfaceHit surface, float3 normal,
                                      float3 view, constant FrameUniforms &uniforms,
                                      thread uint &state) {
      InstanceMaterial material = surface.material;
      float3 albedo = material.albedo * (1.0 - material.metallic);
      float3 specularColor = mix(float3(0.04), material.albedo, material.metallic);
      float roughness = clamp(material.roughness, 0.03, 1.0);

      if (material.kind == kindFoliage) {
        float noise = valueNoise(surface.position.xz * 1.7);
        albedo *= 0.65 + 0.7 * noise;
      }

      float3 origin = surface.position + normal * 2e-3;
      float3 sunDirection = -uniforms.sunDirection;
      float3 sample = coneSample(sunDirection, uniforms.sunAngularRadius, state);
      float3 visibility = sunVisibility(scene, origin, sample, uniforms);
      float3 sunRadiance = uniforms.sunColor * uniforms.sunIntensity * visibility;

      float ndotl = saturate(dot(normal, sunDirection));
      if (material.kind == kindFoliage) {
        ndotl = saturate((dot(normal, sunDirection) + 0.45) / 1.45);
      }

      float3 ambient = float3(0.0);
      for (uint i = 0; i < uniforms.bounceRays; ++i) {
        float3 bounceDirection = cosineHemisphere(normal, state);
        intersector<instancing, triangle_data> bounce;
        bounce.assume_geometry_type(geometry_type::triangle);
        bounce.force_opacity(forced_opacity::opaque);
        ray bounceRay;
        bounceRay.origin = origin;
        bounceRay.direction = bounceDirection;
        bounceRay.min_distance = 1e-3;
        bounceRay.max_distance = 1e5;
        auto bounceHit = bounce.intersect(bounceRay, scene.structure);
        if (bounceHit.type == intersection_type::none) {
          ambient += sampleSky(bounceDirection, uniforms);
        } else {
          InstanceMaterial bounced = scene.materials[bounceHit.instance_id];
          ambient += bounced.emissive * 0.3 + bounced.albedo * 0.05;
        }
      }
      ambient /= float(max(uniforms.bounceRays, 1u));

      float3 diffuse = albedo * (sunRadiance * ndotl + ambient);
      float3 specular = specularColor * sunRadiance * ggx(normal, view, sunDirection, roughness);
      return diffuse + specular + material.emissive;
    }

    kernel void traceScene(
        texture2d<float, access::write> colorTexture [[texture(0)]],
        texture2d<float, access::write> albedoTexture [[texture(1)]],
        texture2d<float, access::write> specularTexture [[texture(2)]],
        texture2d<float, access::write> normalTexture [[texture(3)]],
        texture2d<float, access::write> roughnessTexture [[texture(4)]],
        texture2d<float, access::write> motionTexture [[texture(5)]],
        texture2d<float, access::write> depthTexture [[texture(6)]],
        constant FrameUniforms &uniforms [[buffer(0)]],
        instance_acceleration_structure structure [[buffer(1)]],
        device const Vertex *vertices [[buffer(2)]],
        device const uint *indices [[buffer(3)]],
        device const MeshRange *ranges [[buffer(4)]],
        device const InstanceMaterial *materials [[buffer(5)]],
        device const float4x4 *transforms [[buffer(6)]],
        device const float4x4 *previousTransforms [[buffer(7)]],
        device const float4x4 *inverseTransforms [[buffer(8)]],
        uint2 pixel [[thread_position_in_grid]]) {
      if (pixel.x >= uint(uniforms.renderSize.x) || pixel.y >= uint(uniforms.renderSize.y)) {
        return;
      }

      Scene scene;
      scene.structure = structure;
      scene.vertices = vertices;
      scene.indices = indices;
      scene.ranges = ranges;
      scene.materials = materials;
      scene.transforms = transforms;
      scene.previousTransforms = previousTransforms;
      scene.inverseTransforms = inverseTransforms;

      float2 uv = (float2(pixel) + 0.5 + uniforms.jitter) / uniforms.renderSize;
      float2 ndc = float2(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
      float4 target = uniforms.inverseViewProjection * float4(ndc, 1.0, 1.0);
      float3 origin = uniforms.cameraPosition;
      float3 direction = normalize(target.xyz / target.w - origin);

      uint state = hash(pixel.x * 1973u + pixel.y * 9277u + uniforms.frameIndex * 26699u);
      float3 radiance = float3(0.0);
      float3 throughput = float3(1.0);
      float primaryDistance = 0.0;
      bool wroteSurface = false;

      for (uint depth = 0; depth < 4u; ++depth) {
        intersector<instancing, triangle_data> tracer;
        tracer.assume_geometry_type(geometry_type::triangle);
        tracer.force_opacity(forced_opacity::opaque);
        ray current;
        current.origin = origin;
        current.direction = direction;
        current.min_distance = 1e-3;
        current.max_distance = 1e5;
        auto hit = tracer.intersect(current, scene.structure);

        if (hit.type == intersection_type::none) {
          radiance += throughput * sampleSky(direction, uniforms);
          if (!wroteSurface) {
            albedoTexture.write(float4(0.0), pixel);
            specularTexture.write(float4(0.0), pixel);
            normalTexture.write(float4(-direction, 0.0), pixel);
            roughnessTexture.write(float4(1.0), pixel);
            motionTexture.write(float4(0.0), pixel);
            depthTexture.write(float4(1.0), pixel);
            wroteSurface = true;
          }
          break;
        }

        SurfaceHit surface = resolveHit(hit, origin, direction, uniforms, scene);
        InstanceMaterial material = surface.material;
        float3 normal = surface.normal;
        if (material.kind == kindWater) {
          normal = waterNormal(surface.position, uniforms.time);
        }
        bool inside = dot(normal, direction) > 0.0;
        if (inside) normal = -normal;
        float3 view = -direction;

        if (!wroteSurface) {
          primaryDistance = hit.distance;
          float3 gbufferAlbedo = material.kind == kindOpaque || material.kind == kindFoliage
                               ? material.albedo * (1.0 - material.metallic)
                               : float3(0.0);
          albedoTexture.write(float4(gbufferAlbedo, 1.0), pixel);
          specularTexture.write(float4(mix(float3(0.04), material.albedo, material.metallic), 1.0),
                                pixel);
          normalTexture.write(float4(normal, 0.0), pixel);
          roughnessTexture.write(float4(clamp(material.roughness, 0.03, 1.0)), pixel);
          motionTexture.write(
              float4(clipToPixel(surface.previousClip, uniforms.renderSize)
                   - clipToPixel(surface.clip, uniforms.renderSize), 0.0, 0.0), pixel);
          depthTexture.write(float4(saturate(surface.clip.z / max(surface.clip.w, 1e-6))), pixel);
          wroteSurface = true;
        }

        if (material.kind == kindWater || material.kind == kindGlass) {
          float reflectance = material.kind == kindWater ? 0.02 : 0.06;
          float fresnel = schlick(saturate(dot(view, normal)), reflectance);
          float eta = inside ? material.ior : 1.0 / material.ior;
          float3 refracted = refract(direction, normal, eta);
          bool totalInternal = length_squared(refracted) < 1e-6;

          if (randomFloat(state) < fresnel || totalInternal) {
            direction = reflect(direction, normal);
            origin = surface.position + normal * 2e-3;
          } else {
            throughput *= material.tint;
            direction = normalize(refracted);
            origin = surface.position - normal * 2e-3;
          }
          radiance += throughput * material.emissive;
          continue;
        }

        radiance += throughput * shadeSurface(scene, surface, normal, view, uniforms, state);
        break;
      }

      float fog = exp(-primaryDistance * uniforms.fogDensity);
      colorTexture.write(float4(mix(uniforms.fogColor, radiance, fog), 1.0), pixel);
    }

    static inline float3 tonemap(float3 color) {
      color = max(color, 0.0);
      float3 mapped = (color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14);
      return saturate(mapped);
    }

    static inline float3 encodeSRGB(float3 color) {
      return select(12.92 * color, 1.055 * pow(color, 1.0 / 2.4) - 0.055, color > 0.0031308);
    }

    kernel void present(
        texture2d<float, access::sample> source [[texture(0)]],
        texture2d<float, access::write> output [[texture(1)]],
        constant FrameUniforms &uniforms [[buffer(0)]],
        uint2 pixel [[thread_position_in_grid]]) {
      uint width = output.get_width();
      uint height = output.get_height();
      if (pixel.x >= width || pixel.y >= height) return;
      constexpr sampler linearSampler(filter::linear, address::clamp_to_edge);
      float2 uv = (float2(pixel) + 0.5) / float2(width, height);
      float3 color = source.sample(linearSampler, uv).rgb;
      output.write(float4(encodeSRGB(tonemap(color * uniforms.exposure)), 1.0), pixel);
    }
    """
}
