import { readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { isMediaFile } from './normalizer.js';

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function scanFolder(folder) {
  try {
    return readdirSync(folder)
      .filter(f => isMediaFile(f))
      .map(f => join(folder, f))
      .filter(f => { try { return statSync(f).isFile(); } catch { return false; } });
  } catch {
    return [];
  }
}

export class Scheduler {
  constructor(cfg) {
    this.cfg = cfg;
    this.manualQueue = [];
    this._bags = {};         // folder → shuffled remaining items
    this._seqCursors = {};   // folder → index
    this._lastRuleFire = {}; // ruleIdx → last fire time (minutes)

    // Bumper state
    this._bumperPlaylist = [];
    this._bumperIndex = 0;
    this._bumperEveryN = null;      // play bumper every N content items
    this._bumperIntervalMs = null;  // play bumper every X ms
    this._contentSinceBump = 0;
    this._lastBumpMs = Date.now();
  }

  setBumpers(playlist, { everyN = null, intervalMins = null } = {}) {
    this._bumperPlaylist = [...playlist];
    this._bumperIndex = 0;
    this._bumperEveryN = everyN && everyN > 0 ? everyN : null;
    this._bumperIntervalMs = intervalMins && intervalMins > 0 ? intervalMins * 60 * 1000 : null;
    this._contentSinceBump = 0;
    this._lastBumpMs = Date.now();
  }

  _shouldBump() {
    if (!this._bumperPlaylist.length) return false;
    if (this._bumperEveryN !== null && this._contentSinceBump >= this._bumperEveryN) return true;
    if (this._bumperIntervalMs !== null && (Date.now() - this._lastBumpMs) >= this._bumperIntervalMs) return true;
    return false;
  }

  _nextBumper() {
    const b = this._bumperPlaylist[this._bumperIndex % this._bumperPlaylist.length];
    this._bumperIndex++;
    this._contentSinceBump = 0;
    this._lastBumpMs = Date.now();
    return b;
  }

  enqueueManual(normPath) {
    this.manualQueue.push(normPath);
  }

  dequeueManual(normPath) {
    const idx = this.manualQueue.indexOf(normPath);
    if (idx !== -1) this.manualQueue.splice(idx, 1);
  }

  // Returns the next path to play (bumper or content)
  next(nowPlaying) {
    // 1. Manual queue (skip bumper logic while manually queued items are pending)
    if (this.manualQueue.length) return this.manualQueue.shift();

    // 2. Bumper check
    if (this._shouldBump()) return this._nextBumper();

    // 3. Interval rules
    const nowMin = Math.floor(Date.now() / 60000);
    for (let i = 0; i < this.cfg.rules.length; i++) {
      const rule = this.cfg.rules[i];
      const last = this._lastRuleFire[i] ?? 0;
      if (nowMin - last >= rule.every_minutes) {
        this._lastRuleFire[i] = nowMin;
        const files = scanFolder(rule.folder);
        if (files.length) {
          this._contentSinceBump++;
          return files[Math.floor(Math.random() * files.length)];
        }
      }
    }

    // 4. Active schedule block (mode=schedule)
    if (this.cfg.mode === 'schedule') {
      const block = this._activeBlock();
      if (block) {
        const f = this._pickFromFolder(block.folder, block.order ?? 'shuffle');
        if (f) this._contentSinceBump++;
        return f;
      }
    }

    // 5. Global mode (sequential or shuffle across all block folders, or first block)
    const allFolders = this.cfg.blocks.map(b => b.folder);
    const folder = allFolders[0];
    if (!folder) return null;
    const result = this._pickFromFolder(folder, this.cfg.mode);
    if (result) this._contentSinceBump++;
    return result;
  }

  _activeBlock() {
    const now = new Date();
    const dayName = ['sun','mon','tue','wed','thu','fri','sat'][now.getDay()];
    const nowMin = now.getHours() * 60 + now.getMinutes();

    let best = null;
    let bestStart = -1;
    for (const block of this.cfg.blocks) {
      if (!block.days.includes(dayName)) continue;
      const [h, m] = block.start.split(':').map(Number);
      const blockMin = h * 60 + m;
      if (blockMin <= nowMin && blockMin > bestStart) {
        bestStart = blockMin;
        best = block;
      }
    }
    return best;
  }

  _pickFromFolder(folder, order) {
    if (order === 'sequential') {
      const files = scanFolder(folder);
      if (!files.length) return null;
      const cur = this._seqCursors[folder] ?? 0;
      this._seqCursors[folder] = (cur + 1) % files.length;
      return files[cur];
    }

    // Winamp-style shuffle bag
    if (!this._bags[folder] || !this._bags[folder].length) {
      const files = scanFolder(folder);
      this._bags[folder] = shuffle(files);
    }
    return this._bags[folder].pop() ?? null;
  }
}
