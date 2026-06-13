import { spawn } from 'child_process';
import { writeFileSync, appendFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { watch } from 'chokidar';

export class Broadcaster {
  constructor(workDir, cfg, onSegment, onError) {
    this.workDir = workDir;
    this.cfg = cfg;
    this.onSegment = onSegment;
    this.onError = onError;
    this.playlistTxt = join(workDir, 'playlist.txt');
    this.publicDir = join(workDir, 'public');
    this.ffmpeg = null;
    this.watcher = null;
    this.uptime = 0;
    this._uptimeInterval = null;
    mkdirSync(this.publicDir, { recursive: true });
  }

  start(firstFile) {
    if (this.ffmpeg) return;
    writeFileSync(this.playlistTxt, `file '${firstFile}'\n`);
    this._launchFfmpeg();
    this._uptimeInterval = setInterval(() => { this.uptime++; }, 1000);
    this._watchSegments();
  }

  enqueue(normPath) {
    appendFileSync(this.playlistTxt, `file '${normPath}'\n`);
  }

  _launchFfmpeg() {
    const { segmentSeconds } = this.cfg.stream;
    const m3u8 = join(this.publicDir, 'live.m3u8');
    const segPattern = join(this.publicDir, 'seg_%05d.ts');

    const args = [
      '-re', '-f', 'concat', '-safe', '0', '-i', this.playlistTxt,
      '-c', 'copy',
      '-f', 'hls',
      '-hls_time', String(segmentSeconds),
      '-hls_list_size', '10',
      '-hls_flags', 'delete_segments+append_list+omit_endlist',
      '-hls_segment_filename', segPattern,
      m3u8,
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', () => {});
    this.ffmpeg = proc;

    proc.on('exit', (code) => {
      // If a newer process is already running, this exit is from a killed-and-replaced
      // process — ignore it entirely so we don't wipe the current reference or trigger
      // a spurious auto-restart.
      if (this.ffmpeg !== proc) return;
      this.ffmpeg = null;
      if (code !== 0 && code !== null) {
        this.onError?.(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  }

  // Kill current ffmpeg without triggering onError. Caller must call restartFrom().
  skip() {
    if (!this.ffmpeg) return;
    const proc = this.ffmpeg;
    this.ffmpeg = null; // clear before kill so the exit handler sees mismatch and no-ops
    proc.kill('SIGTERM');
  }

  restartFrom(normPath) {
    writeFileSync(this.playlistTxt, `file '${normPath}'\n`);
    this._launchFfmpeg();
  }

  stop() {
    clearInterval(this._uptimeInterval);
    this.watcher?.close();
    if (this.ffmpeg) {
      const proc = this.ffmpeg;
      this.ffmpeg = null; // clear before kill so exit handler no-ops
      proc.kill('SIGTERM');
    }
    this.uptime = 0;
  }

  _watchSegments() {
    this.watcher = watch(this.publicDir, { ignoreInitial: true });
    this.watcher.on('add', (path) => {
      if (path.endsWith('.ts')) this.onSegment?.(path);
    });
  }

  async grabThumb() {
    const m3u8 = join(this.publicDir, 'live.m3u8');
    if (!existsSync(m3u8)) return;
    const lines = readFileSync(m3u8, 'utf8').split('\n');
    const segs = lines.filter(l => l.endsWith('.ts') && !l.startsWith('#'));
    if (!segs.length) return;
    const lastSeg = segs[segs.length - 1];
    const segPath = join(this.publicDir, lastSeg);
    const thumbPath = join(this.publicDir, 'thumb.jpg');

    return new Promise((resolve) => {
      spawn('ffmpeg', [
        '-ss', '1', '-i', segPath,
        '-vframes', '1', '-q:v', '5',
        '-y', thumbPath,
      ]).on('exit', resolve);
    });
  }
}
