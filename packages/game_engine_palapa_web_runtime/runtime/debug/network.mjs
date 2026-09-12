export const networkProfiles = Object.freeze({
  fast: { label: 'Broadband', bitsPerSecond: Infinity, latency: 0 },
  dialup: { label: 'Dial-up', bitsPerSecond: 56000, latency: 350 },
  '3g': { label: '3G', bitsPerSecond: 750000, latency: 200 },
  intermittent: { label: 'Intermittent 3G', bitsPerSecond: 350000, latency: 450, jitter: 300, failure: 0.08, stall: 0.12 },
});

export function networkProfile(url) {
  const key = new URL(url).searchParams.get('network');
  return Object.hasOwn(networkProfiles, key) ? key : 'fast';
}

// All response streams from a page share one budget instead of each receiving
// the full connection speed. This models download delivery, not TCP packets.
export class NetworkBudget {
  constructor({ now = () => performance.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), random = Math.random } = {}) {
    this.now = now;
    this.sleep = sleep;
    this.random = random;
    this.available = 0;
  }
  async request(profile) {
    const delay = profile.latency + (this.random() * 2 - 1) * (profile.jitter || 0);
    if (delay > 0) await this.sleep(delay);
    if (this.random() < (profile.failure || 0)) throw TypeError('Simulated connection interruption');
  }
  async chunk(bytes, profile) {
    const now = this.now();
    const stall = this.random() < (profile.stall || 0) ? 1500 : 0;
    this.available = Math.max(now, this.available) + bytes * 8000 / profile.bitsPerSecond + stall;
    await this.sleep(Math.max(0, this.available - now));
  }
}
