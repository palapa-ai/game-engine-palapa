const smooth = (previous, next) => Math.max(next, previous * 0.8 + next * 0.2);

// A GPU draw cannot be preempted. Reserve time for presentation, then use
// previous GPU/CPU timings and frame cadence to decide whether to submit work.
export class FrameBudget {
  constructor({ milliseconds = 16, reserve = 2, tiles = 16 } = {}) {
    this.milliseconds = milliseconds;
    this.reserve = reserve;
    this.tiles = tiles;
    this.paintGpuMs = 0;
    this.rayGpuMs = 2;
    this.rayCpuMs = 0;
    this.previous = null;
    this.cooldown = 0;
    this.traced = false;
    this.skipped = 0;
  }
  begin(timestamp) {
    const interval = this.previous === null ? 0 : timestamp - this.previous;
    this.cooldown = Math.max(0, this.cooldown - 1);
    if (interval > 18 && interval < 250) {
      this.cooldown = Math.max(this.cooldown, 2);
      if (this.traced) this.shrink();
    }
    this.previous = timestamp;
    this.started = timestamp;
    this.traced = false;
  }
  resetCadence() { this.previous = null; this.traced = false; }
  shrink() {
    if (this.tiles < 64) {
      this.tiles *= 2;
      this.rayGpuMs = Math.max(0.25, this.rayGpuMs / 4);
      this.rayCpuMs /= 4;
    }
  }
  paint(gpuMs) {
    if (Number.isFinite(gpuMs) && gpuMs >= 0) this.paintGpuMs = smooth(this.paintGpuMs, gpuMs);
  }
  ray(cpuMs, gpuMs = null, tiles = this.tiles) {
    if (Number.isFinite(cpuMs)) this.rayCpuMs = smooth(this.rayCpuMs, cpuMs);
    if (Number.isFinite(gpuMs)) {
      this.rayGpuMs = smooth(this.rayGpuMs, gpuMs * (tiles / this.tiles) ** 2);
    }
    if (this.rayCpuMs + this.rayGpuMs > 4) this.shrink();
  }
  allows(now, pending = false) {
    this.remaining = Math.max(0, this.milliseconds - (now - this.started) - this.paintGpuMs - this.reserve);
    const allowed = !pending && !this.cooldown && this.remaining >= (this.rayCpuMs + this.rayGpuMs) * 1.25;
    if (!allowed) this.skipped++;
    return allowed;
  }
  submitted() { this.traced = true; }
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
