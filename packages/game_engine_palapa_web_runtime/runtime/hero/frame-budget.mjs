const smooth = (previous, next) => Math.max(next, previous * 0.8 + next * 0.2);

// A GPU draw cannot be preempted. Reserve presentation time and use asynchronous
// measurements to choose small work. Alpha accumulation also blends the entire
// trace target on every tile, so tiles alone cannot bound that cost.
export class FrameBudget {
  constructor({ milliseconds = 16, reserve = 2, tiles = 16, maxTiles = 16, minScale = 1 / 8 } = {}) {
    this.milliseconds = milliseconds;
    this.reserve = reserve;
    this.tiles = tiles;
    this.initialTiles = tiles;
    this.maxTiles = Math.max(tiles, maxTiles);
    this.minScale = minScale;
    this.scale = 1;
    this.paintGpuMs = 0;
    this.rayGpuMs = 2;
    this.rayCpuMs = 0;
    this.previous = null;
    this.cooldown = 0;
    this.traced = false;
    this.skipped = 0;
    this.lateFrames = 0;
    this.fastTiles = 0;
    this.blockedFrames = 0;
    this.lastSubmission = -Infinity;
    this.probes = 0;
    this.lastProbe = -Infinity;
  }
  begin(timestamp) {
    const interval = this.previous === null ? 0 : timestamp - this.previous;
    this.cooldown = Math.max(0, this.cooldown - 1);
    if (interval > 18 && interval < 250) {
      this.cooldown = Math.max(this.cooldown, 2);
      this.lateFrames += this.traced ? 1 : 0;
      if (this.lateFrames >= 3) { this.shrink(); this.lateFrames = 0; }
    } else this.lateFrames = Math.max(0, this.lateFrames - 1);
    this.previous = timestamp;
    this.started = timestamp;
    this.traced = false;
  }
  resetCadence() { this.previous = null; this.traced = false; }
  resetQuality() {
    this.tiles = this.initialTiles;
    this.scale = 1;
    this.rayGpuMs = 2;
    this.rayCpuMs = 0;
    this.fastTiles = 0;
    this.blockedFrames = 0;
    this.cooldown = 0;
    this.resetCadence();
  }
  shrink() {
    this.fastTiles = 0;
    this.blockedFrames = 0;
    if (this.tiles < this.maxTiles) {
      this.tiles = Math.min(this.maxTiles, this.tiles * 2);
      this.rayGpuMs = Math.max(0.25, this.rayGpuMs / 4);
      return true;
    }
    if (this.scale > this.minScale) {
      this.scale = Math.max(this.minScale, this.scale / 2);
      this.rayGpuMs = Math.max(0.25, this.rayGpuMs / 4);
      return true;
    }
    return false;
  }
  paint(gpuMs) {
    if (Number.isFinite(gpuMs) && gpuMs >= 0) this.paintGpuMs = smooth(this.paintGpuMs, gpuMs);
  }
  ray(cpuMs, gpuMs = null, tiles = this.tiles, scale = this.scale) {
    // Submission overhead is not proportional to a tile's pixel count.
    if (Number.isFinite(cpuMs)) this.rayCpuMs = smooth(this.rayCpuMs, cpuMs);
    if (Number.isFinite(gpuMs)) {
      const sameWork = tiles === this.tiles && scale === this.scale;
      this.rayGpuMs = smooth(this.rayGpuMs, gpuMs * (tiles / this.tiles) ** 2 * (this.scale / scale) ** 2);
      const available = this.milliseconds - this.paintGpuMs - this.reserve;
      const predicted = (this.rayCpuMs + this.rayGpuMs) * 1.25;
      if (predicted > available) this.shrink();
      else if (sameWork && predicted * 4 < available && (this.tiles > 2 || this.scale < 1)) {
        // Observe at least a whole sample before changing tiling, and a longer
        // stable window before increasing target resolution and restarting it.
        const observations = this.tiles > 2 ? Math.max(24, this.tiles ** 2) : 120;
        if (++this.fastTiles >= observations) {
          if (this.tiles > 2) this.tiles /= 2;
          else this.scale = Math.min(1, this.scale * 2);
          this.rayGpuMs *= 4;
          this.fastTiles = 0;
        }
      } else this.fastTiles = 0;
    }
  }
  allows(now, pending = false) {
    this.remaining = Math.max(0, this.milliseconds - (now - this.started) - this.paintGpuMs - this.reserve);
    if (pending || this.cooldown) { this.skipped++; return false; }
    if (this.remaining >= (this.rayCpuMs + this.rayGpuMs) * 1.25) {
      this.blockedFrames = 0;
      return true;
    }
    // Without another draw a stale high measurement never changes. First
    // reduce the work, even while submissions are blocked. At the smallest
    // target, one tiny probe per second can detect that GPU contention ended.
    // It still cannot guarantee a deadline when another process owns the GPU.
    if (this.remaining >= 4 && ++this.blockedFrames >= 3) {
      if (!this.shrink() && now - Math.max(this.lastSubmission, this.lastProbe) >= 1000) {
        this.probes++;
        this.lastProbe = now;
        return true;
      }
    }
    this.skipped++;
    return false;
  }
  submitted() { this.traced = true; this.lastSubmission = this.started; }
  finish(now) {
    if (now - this.started > this.milliseconds) {
      this.cooldown = Math.max(this.cooldown, 2);
      if (this.traced) this.shrink();
    }
  }
}

// Poll only in a later animation frame; QUERY_RESULT is never read before
// availability. Unsupported or disjoint GPU clocks fall back to frame cadence.
export function gpuTimer(gl) {
  let extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pending = [];
  let active = null;
  const remove = entry => { gl.deleteQuery(entry.query); };
  const clear = () => { pending.splice(0).forEach(remove); };
  return {
    get supported() { return !!extension; },
    get busy() { return pending.length >= 4 || pending.some(entry => entry.kind === 'ray'); },
    begin(kind, detail = {}) {
      if (!extension || active || pending.length >= 4) return false;
      const query = gl.createQuery();
      if (!query) return false;
      active = { query, kind, ...detail };
      gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      return true;
    },
    end() {
      if (!active) return;
      gl.endQuery(extension.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },
    poll() {
      if (!extension) return [];
      if (gl.getParameter(extension.GPU_DISJOINT_EXT)) { clear(); return []; }
      const results = [];
      for (let index = pending.length - 1; index >= 0; index--) {
        const entry = pending[index];
        if (!gl.getQueryParameter(entry.query, gl.QUERY_RESULT_AVAILABLE)) continue;
        const milliseconds = gl.getQueryParameter(entry.query, gl.QUERY_RESULT) / 1e6;
        pending.splice(index, 1);
        remove(entry);
        if (Number.isFinite(milliseconds)) results.push({ ...entry, milliseconds });
      }
      return results.reverse();
    },
    dispose() {
      if (active) { this.end(); }
      clear();
      extension = null;
    },
  };
}
