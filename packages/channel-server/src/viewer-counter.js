// Counts unique IPs requesting segments in the last 30 seconds.
// HLS has no persistent connections, so this is the right approximation.
export class ViewerCounter {
  constructor(windowMs = 30_000) {
    this.window = windowMs;
    this._hits = new Map(); // ip → last-seen timestamp
  }

  record(ip) {
    this._hits.set(ip, Date.now());
  }

  count() {
    const cutoff = Date.now() - this.window;
    let n = 0;
    for (const [ip, ts] of this._hits) {
      if (ts < cutoff) this._hits.delete(ip);
      else n++;
    }
    return n;
  }
}
