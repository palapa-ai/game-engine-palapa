import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector2, Vector4 } from '../runtime/hero/vendor/three.module.min.js';
import { PathTracingRenderer } from '../runtime/hero/vendor/three-gpu-pathtracer.module.js';

// Run the vendor's actual tile scheduler without creating a WebGL context.
// The fake draw calls evaluate the shader's weighted-alpha operation on pixels.
function harness({ width = 5, height = 7, columns = 1, rows = 4, subframe, alpha = true, stableTiles = true, pixelRatio = 1 } = {}) {
  const target = () => ({
    width, height, viewport: new Vector4(0, 0, width, height),
    scissor: new Vector4(0, 0, width, height), scissorTest: false,
    texture: { data: new Float64Array(width * height * 4) },
  });
  const screen = target();
  screen.viewport.set(2, 3, 17, 19);
  screen.scissor.set(3, 4, 11, 13);
  screen.scissorTest = true;
  const renderer = {
    target: screen, autoClear: true,
    viewport: screen.viewport.clone(), scissor: screen.scissor.clone(), scissorTest: true,
    globalViewport: new Vector4(1, 2, 12, 14), globalScissor: new Vector4(1, 1, 10, 11),
    getRenderTarget() { return this.target; },
    setRenderTarget(value) {
      this.target = value;
      this.viewport.copy(value.viewport);
      this.scissor.copy(value.scissor);
      this.scissorTest = value.scissorTest;
    },
    getViewport(value) { return value.copy(this.globalViewport); },
    setViewport(...values) {
      typeof values[0] === 'object' ? this.globalViewport.copy(values[0]) : this.globalViewport.set(...values);
      this.viewport.copy(this.globalViewport).multiplyScalar(pixelRatio).round();
    },
    getScissor(value) { return value.copy(this.globalScissor); },
    setScissor(...values) {
      typeof values[0] === 'object' ? this.globalScissor.copy(values[0]) : this.globalScissor.set(...values);
      this.scissor.copy(this.globalScissor).multiplyScalar(pixelRatio).round();
    },
    getScissorTest() { return this.scissorTest; },
    setScissorTest(value) { this.scissorTest = value; },
  };
  const visitPixels = callback => {
    const bounds = renderer.scissorTest ? renderer.scissor : new Vector4(0, 0, width, height);
    let pixels = 0;
    for (let y = Math.max(0, bounds.y); y < Math.min(height, bounds.y + bounds.w); y++) {
      for (let x = Math.max(0, bounds.x); x < Math.min(width, bounds.x + bounds.z); x++) {
        if (x < renderer.viewport.x || x >= renderer.viewport.x + renderer.viewport.z ||
            y < renderer.viewport.y || y >= renderer.viewport.y + renderer.viewport.w) continue;
        callback(x, y, (y * width + x) * 4);
        pixels++;
      }
    }
    return pixels;
  };
  const material = {
    onBeforeRender() {}, resolution: new Vector2(), seed: 0,
    bounces: 4, transmissiveBounces: 10,
    stratifiedTexture: { init() {}, next() {} },
  };
  const blendMaterial = {};
  const draws = [];
  const tracer = Object.assign(Object.create(PathTracingRenderer.prototype), {
    _renderer: renderer, _primaryTarget: target(), _blendTargets: [target(), target()],
    _sobolTarget: { texture: {} }, _subframe: subframe ?? new Vector4(0, 0, 1, 1),
    _opacityFactor: 1, _alpha: alpha, tiles: new Vector2(columns, rows), stableTiles,
    samples: 0, _compilePromise: null, _task: null, _currentTile: stableTiles ? 0 : 2,
    _fsQuad: {
      material,
      render() {
        visitPixels((x, y, index) => {
          renderer.target.texture.data.set(sample(material.seed, x, y), index);
        });
      },
    },
    _blendQuad: {
      material: blendMaterial,
      render() {
        const { target1, target2, opacity } = blendMaterial;
        assert.notEqual(renderer.target.texture, target1, 'cannot read and write the same texture');
        assert.notEqual(renderer.target.texture, target2, 'cannot read and write the same texture');
        const pixels = visitPixels((x, y, index) => {
          // Full-screen quad UVs are relative to its viewport, not its scissor.
          const sx = Math.floor((x + 0.5 - renderer.viewport.x) / renderer.viewport.z * width);
          const sy = Math.floor((y + 0.5 - renderer.viewport.y) / renderer.viewport.w * height);
          const source = (sy * width + sx) * 4;
          const a = target1.data[source + 3] * (1 - opacity);
          const b = target2.data[source + 3] * opacity;
          for (let channel = 0; channel < 3; channel++) {
            renderer.target.texture.data[index + channel] = a + b === 0 ? 0 :
              (target1.data[source + channel] * a + target2.data[source + channel] * b) / (a + b);
          }
          renderer.target.texture.data[index + 3] = a + b;
        });
        draws.push({ opacity, pixels });
      },
    },
  });
  function update() {
    tracer.update();
    assert.equal(renderer.getRenderTarget(), screen);
    assert.deepEqual(renderer.viewport, screen.viewport, 'restore viewport');
    assert.deepEqual(renderer.scissor, screen.scissor, 'restore scissor');
    assert.equal(renderer.scissorTest, true);
    assert.equal(renderer.autoClear, true);
    assert.deepEqual(renderer.globalViewport, new Vector4(1, 2, 12, 14));
    assert.deepEqual(renderer.globalScissor, new Vector4(1, 1, 10, 11));
    assert.ok(tracer._blendTargets.every(target => !target.scissorTest), 'reset must still clear complete targets');
  }
  return { tracer, update, draws, width, height };
}

function sample(pass, x, y) {
  const alpha = (x + y) % 5 === 0 ? 0 : ((pass + x + y) % 3 + 1) / 3;
  return [pass * 0.13 + x * 0.07, pass * 0.19 + y * 0.03, 0.1 * pass, alpha];
}

// Independent expected result: sum premultiplied radiance and coverage over N samples.
function expected(passes, x, y) {
  const values = Array.from({ length: passes }, (_, pass) => sample(pass + 1, x, y));
  const coverage = values.reduce((sum, rgba) => sum + rgba[3], 0);
  return [0, 1, 2].map(channel => coverage === 0 ? 0 :
    values.reduce((sum, rgba) => sum + rgba[channel] * rgba[3], 0) / coverage,
  ).concat(coverage / passes);
}

function close(actual, expected, context) {
  expected.forEach((value, channel) => {
    assert.ok(Math.abs(actual[channel] - value) < 1e-12, `${context}: channel ${channel}, ${actual[channel]} != ${value}`);
  });
}

for (const stableTiles of [true, false]) {
  test(`alpha samples retain exact weighted coverage across uneven tiles (stable=${stableTiles})`, () => {
    const h = harness({ columns: 2, rows: 4, stableTiles, pixelRatio: 2 });
    for (let pass = 1; pass <= 4; pass++) {
      for (let tile = 0; tile < 8; tile++) h.update();
      assert.equal(h.tracer.samples, pass);
      for (let y = 0; y < h.height; y++) for (let x = 0; x < h.width; x++) {
        const pixel = h.tracer.target.texture.data.subarray((y * h.width + x) * 4, (y * h.width + x + 1) * 4);
        close(pixel, expected(pass, x, y), `pass ${pass}, pixel ${x},${y}`);
      }
    }
  });
}

test('partial passes expose the current buffer and preserve untouched bands', () => {
  const h = harness({ width: 4, height: 4 });
  for (let pass = 1; pass <= 4; pass++) {
    const previous = h.tracer.target;
    h.update();
    if (pass > 1) assert.notEqual(h.tracer.target, previous, 'active target switches at every new pass');
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const count = y === 3 ? pass : pass - 1;
      close(h.tracer.target.texture.data.subarray((y * 4 + x) * 4), count ? expected(count, x, y) : [0, 0, 0, 0], `partial pass ${pass}, pixel ${x},${y}`);
    }
    for (let tile = 1; tile < 4; tile++) h.update();
  }
});

test('64 bands blend only two target areas per completed sample', () => {
  const h = harness({ width: 8, height: 64, rows: 64 });
  for (let tile = 0; tile < 128; tile++) h.update();
  assert.equal(h.draws.filter(draw => draw.opacity === 0).length, 2, 'one carry-forward copy per pass');
  assert.equal(h.draws.reduce((sum, draw) => sum + draw.pixels, 0), 4 * 8 * 64);
  assert.ok(h.draws.filter(draw => draw.opacity !== 0).every(draw => draw.pixels === 8));
});

test('subframe blending samples the same full-target texture coordinates', () => {
  const h = harness({ width: 8, height: 8, rows: 2, subframe: new Vector4(0.25, 0.25, 0.5, 0.5) });
  for (let tile = 0; tile < 6; tile++) h.update();
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const inside = x >= 2 && x < 6 && y >= 2 && y < 6;
    close(h.tracer.target.texture.data.subarray((y * 8 + x) * 4), inside ? expected(3, x, y) : [0, 0, 0, 0], `subframe pixel ${x},${y}`);
  }
});

test('opaque renderer retains primary target and skips alpha copies', () => {
  const h = harness({ alpha: false });
  for (let tile = 0; tile < 4; tile++) h.update();
  assert.equal(h.tracer.target, h.tracer._primaryTarget);
  assert.equal(h.tracer.samples, 1);
  assert.deepEqual(h.draws, []);
});
