export class FrameCadence {
  frames = 0;
  next = null;
  constructor(fps = 60) { this.interval = 1000 / fps; }
  accept(time) {
    if (this.next !== null && time + 0.001 < this.next) return false;
    this.next = this.next === null || time - this.next >= this.interval
      ? time + this.interval : this.next + this.interval;
    this.frames++;
    return true;
  }
  reset() { this.next = null; }
}
