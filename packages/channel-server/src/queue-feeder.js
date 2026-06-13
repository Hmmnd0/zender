import { spawn } from 'child_process';
import { ensureNormalized, isAudioFile } from './normalizer.js';

// Probes duration of a (normalized) .ts file via ffprobe.
function probeDuration(path) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      path,
    ]);
    let out = '';
    proc.stdout.on('data', d => { out += d; });
    proc.on('close', () => {
      try {
        const d = parseFloat(JSON.parse(out).format?.duration ?? '0');
        resolve(isFinite(d) ? d : 0);
      } catch {
        resolve(0);
      }
    });
  });
}

// Keeps a rolling buffer of pre-normalized items fed to the ffmpeg concat list.
// Ensures there are always ≥ MIN_BUFFER_SECS of content queued ahead.
// Tracks elapsed playback time to maintain an accurate nowPlaying pointer.
export class QueueFeeder {
  constructor({ scheduler, cacheDir, streamCfg, onEnqueue, onNowPlaying, onQueueChange }) {
    this.scheduler = scheduler;
    this.cacheDir = cacheDir;
    this.streamCfg = streamCfg;
    this.onEnqueue = onEnqueue;       // (normPath) → called to append to playlist.txt
    this.onNowPlaying = onNowPlaying; // (srcPath) → called when track changes
    this.onQueueChange = onQueueChange; // (items[]) → UI update

    // Each item: { src, norm, duration, startSec }
    this._items = [];
    this._totalQueued = 0;  // cumulative seconds handed to ffmpeg
    this._startTime = null;
    this._interval = null;
    this._filling = false;
  }

  // Start from a file that is already normalized and handed to ffmpeg.
  async start(firstSrc, firstNorm) {
    const duration = await probeDuration(firstNorm);
    this._items = [{ src: firstSrc, norm: firstNorm, duration, startSec: 0 }];
    this._totalQueued = duration;
    this._startTime = Date.now();

    this.onNowPlaying?.(firstSrc);
    this._emitQueue();

    await this._fill();
    this._interval = setInterval(() => this._tick(), 5_000);
  }

  stop() {
    clearInterval(this._interval);
    this._interval = null;
    this._items = [];
    this._totalQueued = 0;
    this._startTime = null;
  }

  // Returns upcoming items for queue display: [{ src, duration }]
  get upcomingItems() {
    return this._items.map(i => ({ src: i.src, duration: i.duration, isLoop: i.isLoop ?? false }));
  }

  get nowPlaying() {
    return this._items[0]?.src ?? null;
  }

  _elapsedSecs() {
    if (!this._startTime) return 0;
    return (Date.now() - this._startTime) / 1000;
  }

  async _tick() {
    const elapsed = this._elapsedSecs();

    // Advance the now-playing pointer past items that have finished.
    let changed = false;
    while (this._items.length > 1 && (this._items[0].startSec + this._items[0].duration) <= elapsed) {
      this._items.shift();
      changed = true;
    }

    if (changed) {
      this.onNowPlaying?.(this._items[0]?.src ?? null);
      this._emitQueue();
    }

    // Remaining buffered time = total queued minus elapsed
    const remaining = this._totalQueued - elapsed;
    if (remaining < MIN_BUFFER_SECS) {
      await this._fill();
    }
  }

  async _fill() {
    if (this._filling) return;
    this._filling = true;
    try {
      while (true) {
        const remaining = this._totalQueued - this._elapsedSecs();
        if (remaining >= TARGET_BUFFER_SECS) break;

        const src = this.scheduler.next(this.nowPlaying);
        if (!src) {
          // Nothing scheduled — loop the last item so ffmpeg never exhausts the
          // playlist and exits. Real content will displace the loop on next _fill.
          const last = this._items.at(-1);
          if (last && !last.isLoop) {
            const startSec = this._totalQueued;
            this._items.push({ src: last.src, norm: last.norm, duration: last.duration, startSec, isLoop: true });
            this._totalQueued += last.duration;
            this.onEnqueue(last.norm);
          }
          break;
        }

        const norm = await ensureNormalized(src, this.cacheDir, this.streamCfg, isAudioFile(src));
        const duration = await probeDuration(norm);
        if (!duration) continue;

        // Real content arrived — drop any pending loop items and replace them.
        const loopIdx = this._items.findIndex(i => i.isLoop);
        if (loopIdx !== -1) {
          this._items.splice(loopIdx);
          this._totalQueued = this._items.at(-1)
            ? this._items.at(-1).startSec + this._items.at(-1).duration
            : this._elapsedSecs();
        }

        const startSec = this._totalQueued;
        this._items.push({ src, norm, duration, startSec });
        this._totalQueued += duration;

        this.onEnqueue(norm);
        this._emitQueue();
      }
    } finally {
      this._filling = false;
    }
  }

  _emitQueue() {
    this.onQueueChange?.(this.upcomingItems);
  }
}

const MIN_BUFFER_SECS = 90;    // refill when less than 90s buffered
const TARGET_BUFFER_SECS = 300; // aim for 5 min ahead
