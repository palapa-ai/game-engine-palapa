const smooth = (previous, next) => Math.max(next, previous * 0.8 + next * 0.2);

// A GPU draw cannot be preempted. Reserve presentation time and use asynchronous
// measurements to choose small work. Each sample copies its previous image once;
// later bands only trace and blend their own pixels.
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
    this.measurementEpoch = 0;
    this.resetBatchMeasurements();
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
  resetBatchMeasurements() {
    this.measurementEpoch++;
    this.batchGpuQueries = 0;
    this.batchGpuWork = null;
    this.batchCpuWork = null;
  }
  resetCadence() {
    this.previous = null;
    this.traced = false;
    this.resetBatchMeasurements();
  }
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
      this.resetBatchMeasurements();
      return true;
    }
    if (this.scale > this.minScale) {
      this.scale = Math.max(this.minScale, this.scale / 2);
      this.rayGpuMs = Math.max(0.25, this.rayGpuMs / 4);
      this.resetBatchMeasurements();
      return true;
    }
    return false;
  }
  paint(gpuMs) {
    if (Number.isFinite(gpuMs) && gpuMs >= 0) this.paintGpuMs = smooth(this.paintGpuMs, gpuMs);
  }
  ray(cpuMs, gpuMs = null, tiles = this.tiles, scale = this.scale, bands = 1, epoch = this.measurementEpoch) {
    if (epoch !== this.measurementEpoch || !Number.isInteger(bands) || bands < 1) return;
    const sameWork = tiles === this.tiles && scale === this.scale;
    // CPU and GPU measurements cover the complete submitted batch. Keep estimates
    // per band, including CPU overhead, before extrapolating to other tile sizes.
    if (Number.isFinite(cpuMs) && cpuMs >= 0) {
      this.rayCpuMs = smooth(this.rayCpuMs, cpuMs / bands);
      if (sameWork) this.batchCpuWork = { tiles, scale };
    }
    if (Number.isFinite(gpuMs) && gpuMs >= 0) {
      if (sameWork) {
        if (this.batchGpuWork?.tiles !== tiles || this.batchGpuWork?.scale !== scale) this.batchGpuQueries = 0;
        this.batchGpuWork = { tiles, scale };
        this.batchGpuQueries++;
      }
      this.rayGpuMs = smooth(this.rayGpuMs, gpuMs / bands * (tiles / this.tiles) ** 2 * (this.scale / scale) ** 2);
      const available = this.milliseconds - this.paintGpuMs - this.reserve;
      const predicted = (this.rayCpuMs + this.rayGpuMs) * 1.25;
      if (predicted > available) this.shrink();
      else if (sameWork && predicted * 4 < available && (this.tiles > 2 || this.scale < 1)) {
        // Observe at least a whole sample before changing tiling, and a longer
        // stable window before increasing target resolution and restarting it.
        const observations = this.tiles > 2 ? Math.max(24, this.tiles ** 2) : 120;
        this.fastTiles += bands;
        if (this.fastTiles >= observations) {
          if (this.tiles > 2) this.tiles /= 2;
          else this.scale = Math.min(1, this.scale * 2);
          this.rayGpuMs *= 4;
          this.fastTiles = 0;
          this.resetBatchMeasurements();
        }
      } else this.fastTiles = 0;
    }
  }
  batch(now, pending = false) {
    if (!this.allows(now, pending)) return 0;
    const current = work => work?.tiles === this.tiles && work?.scale === this.scale;
    if (this.probeAllowed || this.batchGpuQueries < 2 || !current(this.batchGpuWork) || !current(this.batchCpuWork)) return 1;
    const perBand = Math.max(0.25, (this.rayCpuMs + this.rayGpuMs) * 1.25);
    return Math.max(1, Math.min(4, Math.floor(this.remaining / perBand)));
  }
  allows(now, pending = false) {
    this.probeAllowed = false;
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
        this.probeAllowed = true;
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
      if (!extension || active || pending.length >= 4 || (kind === 'ray' && pending.some(entry => entry.kind === 'ray'))) return false;
      const query = gl.createQuery();
      if (!query) return false;
      active = { query, kind, ...detail };
      gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      return true;
    },
    end(detail = {}) {
      if (!active) return;
      gl.endQuery(extension.TIME_ELAPSED_EXT);
      Object.assign(active, detail);
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
