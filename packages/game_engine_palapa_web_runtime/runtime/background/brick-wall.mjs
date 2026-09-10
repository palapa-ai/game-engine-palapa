import { Scanlines, visibleBuffer } from './brick-scanlines.mjs';

import { brickProjection } from './brick-material.mjs';
import { ATLAS_WIDTH, ATLAS_HEIGHT, CLAY, brickSurface, paintBricks } from './brick-surface.mjs';
const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const TRACE = `#version 300 es
precision highp float;
uniform sampler2D previous;
uniform vec2 resolution;
uniform vec2 cssSize;
uniform vec3 projection;
uniform sampler2D surface;
uniform float sampleIndex;
out vec4 color;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float random(inout vec2 seed) { seed += vec2(0.754877, 0.56984); return hash(seed); }
uint cellHash(ivec2 id) {
  uint value = uint(id.x) * 374761393u + uint(id.y) * 668265263u + 7u;
  value = (value ^ (value >> 13u)) * 1274126177u;
  return value ^ (value >> 16u);
}
ivec2 cell(vec2 p) {
  float row = floor(p.y);
  return ivec2(floor((p.x - mod(row, 2.0) * 1.25) / 2.5), row);
}
vec4 surfaceAt(vec2 p) {
  ivec2 id = cell(p);
  uint value = cellHash(id);
  if (value % 1000u < 15u) return vec4(0, 0, 0, 1);
  vec2 local = vec2((p.x - mod(float(id.y), 2.0) * 1.25) / 2.5, p.y) - vec2(id);
  ivec2 pixel = ivec2(clamp(local, vec2(0), vec2(0.99999)) * vec2(128, 64));
  pixel.x += int(value % 8u) * 128;
  return texelFetch(surface, pixel, 0);
}
float trace(vec3 origin, vec3 direction, float limit) {
  float distance = 0.012;
  for (int i = 0; i < 96; i++) {
    vec3 p = origin + direction * distance;
    if (p.z > 0.8 && direction.z > 0.0) return -1.0;
    float clearance = p.z - surfaceAt(p.xy).x;
    if (clearance < 0.002) return distance;
    distance += max(0.012, clearance * 0.15);
    if (distance > limit) break;
  }
  return -1.0;
}
const vec3 clay[6] = vec3[6](
  ${CLAY.map(({rgb}) => `vec3(${rgb.map(v => v.toFixed(8)).join(',')})`).join(',\n  ')}
);
const float roughness[6] = float[6](${CLAY.map(({roughness}) => roughness.toFixed(4)).join(',')});
vec3 albedo(vec3 p) {
  if (p.z < 0.018) return vec3(0.004025);
  return clay[int((cellHash(cell(p.xy)) >> 8u) % 6u)];
}
vec3 hemisphere(vec3 n, inout vec2 seed) {
  float angle = random(seed) * 6.2831853;
  float radius = sqrt(random(seed));
  vec3 tangent = normalize(cross(n, abs(n.z) < 0.99 ? vec3(0,0,1) : vec3(0,1,0)));
  return normalize(tangent * cos(angle) * radius + cross(n, tangent) * sin(angle) * radius
    + n * sqrt(1.0 - radius * radius));
}
void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  vec2 seed = gl_FragCoord.xy + sampleIndex * vec2(37.7, 91.3);
  vec2 pixel = vec2(uv.x * cssSize.x, (1.0 - uv.y) * cssSize.y)
    + (vec2(random(seed), random(seed)) - 0.5) * cssSize / resolution;
  vec2 xy = vec2(pixel.x - projection.x, projection.y - pixel.y) / projection.z;
  vec4 face = surfaceAt(xy);
  vec3 p = vec3(xy, face.x);
  vec3 n = normalize(face.yzw);
  vec3 bounce = hemisphere(n, seed);
  float obstruction = trace(p + n * 0.008, bounce, 2.0);
  vec3 indirect = obstruction < 0.0 ? vec3(0.2) : albedo(p + bounce * obstruction) * 0.16;
  // A fixed wash extends the hero lighting without coupling either tracer to logo input.
  vec3 direction = normalize(vec3(-0.31, 0.47, 0.826) +
    vec3(random(seed) - 0.5, random(seed) - 0.5, 0) * 0.16);
  float shadow = trace(p + n * 0.008, direction, 5.0);
  float diffuse = shadow < 0.0 ? max(dot(n, direction), 0.0) : 0.0;
  float wash = 0.78 + 0.22 * exp(-pow((pixel.x / cssSize.x - 0.5) * 2.0, 2.0));
  float materialRoughness = roughness[int((cellHash(cell(p.xy)) >> 8u) % 6u)];
  float halfDot = max(dot(n, normalize(direction + vec3(0,0,1))), 0.0);
  float specular = 0.022 * pow(halfDot, 4.0 + (1.0 - materialRoughness) * 18.0);
  float mortarGlow = 0.006 + 0.006 * exp(-pow((pixel.x / cssSize.x - 0.5) * 5.0, 2.0));
  vec3 reflection = face.x < 0.018 ? mortarGlow * vec3(0.95,0.92,0.88) : specular * vec3(0.69,0.78,1.0);
  vec3 radiance = albedo(p) * (indirect + vec3(1.0,0.88,0.76) * 1.65 * diffuse * wash) * 0.38
    + reflection;
  vec3 old = texelFetch(previous, ivec2(gl_FragCoord.xy), 0).rgb;
  color = vec4(mix(old, radiance, 1.0 / (sampleIndex + 1.0)), 1.0);
}`;
const DISPLAY = `#version 300 es
precision highp float;
uniform sampler2D picture;
uniform vec2 resolution;
out vec4 color;
void main() {
  vec4 p = texelFetch(picture, ivec2(gl_FragCoord.xy), 0);
  vec3 linear = max(p.rgb, 0.0);
  color = vec4(mix(1.055 * pow(linear, vec3(1.0 / 2.4)) - 0.055, linear * 12.92,
    lessThanEqual(linear, vec3(0.0031308))), p.a);
}`;

function program(gl, fragment) {
  const result = gl.createProgram();
  const shaders = [];
  try {
    for (const [kind, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(kind);
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
      gl.attachShader(result, shader);
    }
    gl.linkProgram(result);
    if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(result));
    return result;
  } catch (error) { gl.deleteProgram(result); throw error; }
  finally { shaders.forEach(shader => gl.deleteShader(shader)); }
}

class Tracer {
  constructor(canvas) {
    this.gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false,
      stencil: false, premultipliedAlpha: false, powerPreference: 'low-power' });
    if (!this.gl) throw Error('WebGL2 unavailable');
    const gl = this.gl;
    if (!gl.getExtension('EXT_color_buffer_float')) throw Error('Float targets unavailable');
    try {
      this.traceProgram = program(gl, TRACE);
      this.displayProgram = program(gl, DISPLAY);
    } catch (error) {
      if (this.traceProgram) gl.deleteProgram(this.traceProgram);
      throw error;
    }
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.targets = [];
    this.fence = null;
    this.surface = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.surface);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, ATLAS_WIDTH, ATLAS_HEIGHT, 0,
      gl.RGBA, gl.FLOAT, brickSurface().pixels);
  }

  reset(width, height, cssSize, projection) {
    const gl = this.gl;
    this.width = width; this.height = height; this.cssSize = cssSize; this.projection = projection;
    if (this.fence) { gl.deleteSync(this.fence); this.fence = null; }
    this.targets.forEach(({ texture, framebuffer }) => {
      gl.deleteTexture(texture); gl.deleteFramebuffer(framebuffer);
    });
    this.targets = [];
    for (let i = 0; i < 2; i++) {
      const texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
      this.targets.push({ texture, framebuffer });
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error('Incomplete target');
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  get ready() {
    if (!this.fence) return true;
    const gl = this.gl;
    const status = gl.clientWaitSync(this.fence, 0, 0);
    if (status === gl.TIMEOUT_EXPIRED) return false;
    if (status === gl.WAIT_FAILED) throw Error('GPU synchronization failed');
    gl.deleteSync(this.fence); this.fence = null;
    return true;
  }

  draw(band) {
    const gl = this.gl, [output, previous] = this.targets;
    gl.viewport(0, 0, this.width, this.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(band.x, band.y, band.width, band.height);
    gl.useProgram(this.traceProgram);
    const uniform = name => gl.getUniformLocation(this.traceProgram, name);
    gl.uniform2f(uniform('resolution'), this.width, this.height);
    gl.uniform2f(uniform('cssSize'), ...this.cssSize);
    gl.uniform3f(uniform('projection'), this.projection.x, this.projection.y, this.projection.course);
    gl.uniform1f(uniform('sampleIndex'), band.sample);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, previous.texture);
    gl.uniform1i(uniform('previous'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.surface);
    gl.uniform1i(uniform('surface'), 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // Copy only the changed scanline: both accumulation targets stay identical.
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, output.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previous.framebuffer);
    const { x, y, width, height } = band;
    gl.blitFramebuffer(x, y, x + width, y + height, x, y, x + width, y + height,
      gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(this.displayProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, output.texture);
    gl.uniform1i(gl.getUniformLocation(this.displayProgram, 'picture'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  }

  dispose() {
    const gl = this.gl;
    if (this.fence) gl.deleteSync(this.fence);
    this.targets.forEach(({ texture, framebuffer }) => {
      gl.deleteTexture(texture); gl.deleteFramebuffer(framebuffer);
    });
    gl.deleteProgram(this.traceProgram); gl.deleteProgram(this.displayProgram);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.surface);
    this.targets = []; this.fence = null;
  }
}

export function mountBrickWall(host) {
  const raster = document.createElement('canvas'), traced = document.createElement('canvas');
  let tracer = null, queue = null, frame = 0, timer = 0, disposed = false, visible = true;
  let pending = null, dimensions = null, observer = null, intersection = null;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const events = new AbortController();

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
  }
  function pause() {
    stop();
    clearTimeout(timer);
    timer = 0;
  }
  function release() {
    try { tracer?.dispose(); } catch (_) {}
    tracer = null;
  }
  function fail() {
    pause();
    pending = null;
    release();
    queue = null;
    traced.style.visibility = 'hidden';
    host.dataset.render = 'fallback';
  }
  function run() {
    frame = 0;
    if (disposed || document.hidden || !visible || !tracer || !queue || queue.done) return;
    try {
      if (!tracer.ready) { frame = requestAnimationFrame(run); return; }
      const band = queue.next();
      if (band) {
        tracer.draw(band);
        host.dataset.render = 'tracing';
        host.dataset.scanline = String(band.top);
      }
      if (queue.done) {
        traced.style.visibility = '';
        host.dataset.render = 'complete';
      }
      else {
        const bounds = host.getBoundingClientRect();
        const nextTop = bounds.top + queue.top * bounds.height / queue.height;
        if (nextTop > innerHeight || nextTop + queue.bandHeight * bounds.height / queue.height < 0)
          timer = setTimeout(() => { timer = 0; frame = requestAnimationFrame(run); }, 120);
        else frame = requestAnimationFrame(run);
      }
    } catch (_) { fail(); }
  }
  function resume() {
    clearTimeout(timer);
    timer = 0;
    if (disposed || document.hidden || !visible || frame) return;
    if (pending) {
      const { width, height, ratio } = pending;
      try {
        tracer ||= new Tracer(traced);
        const gl = tracer.gl;
        const limit = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE),
          gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
        const buffer = visibleBuffer(width, height, ratio, 900000, limit);
        traced.width = buffer.width;
        traced.height = buffer.height;
        tracer.reset(buffer.width, buffer.height, [width, height], brickProjection(width));
        queue = new Scanlines(buffer.width, buffer.height);
        pending = null;
      } catch (_) {
        pending = null;
        fail();
      }
    }
    if (!tracer || !queue) return;
    traced.style.visibility = reduced.matches && !queue.done ? 'hidden' : '';
    host.dataset.render = queue.done ? 'complete' : 'tracing';
    if (!queue.done) frame = requestAnimationFrame(run);
  }
  function reset(force = false) {
    if (disposed) return;
    const bounds = host.getBoundingClientRect();
    const width = bounds.width;
    const height = bounds.height;
    const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
    if (width <= 0 || height <= 0) {
      dimensions = null;
      fail();
      return;
    }
    if (!force && dimensions?.width === width && dimensions?.height === height &&
        dimensions?.ratio === ratio) return;
    dimensions = { width, height, ratio };
    pause();
    try { paintBricks(raster, width, height, brickProjection(width)); }
    catch (_) { fail(); dispose(); return; }
    host.dataset.render = 'raster';
    host.dataset.scanline = '0';
    traced.style.visibility = 'hidden';
    pending = dimensions;
    timer = setTimeout(resume, 180);
  }
  function motionChanged() {
    traced.style.visibility = queue && !pending && (!reduced.matches || queue.done) ? '' : 'hidden';
    resume();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    pause();
    events.abort();
    observer?.disconnect();
    intersection?.disconnect();
    release();
    raster.remove();
    traced.remove();
  }
  try {
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.style.width = '100%';
    host.style.height = '100%';
    host.style.overflow = 'hidden';
    host.style.contain = 'strict';
    host.style.pointerEvents = 'none';
    host.setAttribute('aria-hidden', 'true');
    [raster, traced].forEach(canvas => {
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
      canvas.setAttribute('aria-hidden', 'true');
    });
    traced.style.imageRendering = 'auto';
    traced.style.visibility = 'hidden';
    host.replaceChildren(raster, traced);
    observer = new ResizeObserver(() => reset());
    observer.observe(host);
    intersection = new IntersectionObserver(entries => {
      visible = entries.at(-1)?.isIntersecting ?? false;
      if (visible) resume(); else pause();
    });
    intersection.observe(host);
    document.addEventListener('visibilitychange', () => document.hidden ? pause() : resume(),
      { signal: events.signal });
    reduced.addEventListener('change', motionChanged, { signal: events.signal });
    traced.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      fail();
    }, { signal: events.signal });
    traced.addEventListener('webglcontextrestored', () => reset(true), { signal: events.signal });
    addEventListener('pagehide', event => event.persisted ? pause() : dispose(), { signal: events.signal });
    addEventListener('pageshow', resume, { signal: events.signal });
    reset();
  } catch (_) {
    fail();
    dispose();
  }
  return { dispose };
}
