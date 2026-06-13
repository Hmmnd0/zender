import { spawn } from 'child_process';
import { mkdirSync, existsSync } from 'fs';
import { join, basename, extname } from 'path';
import { createHash } from 'crypto';

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.m4v', '.ts', '.webm']);
const AUDIO_EXTS = new Set(['.mp3', '.flac', '.aac', '.ogg', '.wav', '.m4a', '.opus']);

export function isMediaFile(file) {
  const ext = extname(file).toLowerCase();
  return VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext);
}

export function isAudioFile(file) {
  return AUDIO_EXTS.has(extname(file).toLowerCase());
}

export function normCachePath(cacheDir, srcPath) {
  const hash = createHash('md5').update(srcPath).digest('hex').slice(0, 8);
  const base = basename(srcPath, extname(srcPath));
  return join(cacheDir, `${base}.${hash}.norm.ts`);
}

export function probeFile(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams', '-show_format',
      filePath,
    ]);
    let out = '';
    proc.stdout.on('data', d => { out += d; });
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}`));
      try { resolve(JSON.parse(out)); } catch (e) { reject(e); }
    });
  });
}

export function normalizeTo(srcPath, destPath, streamCfg, onProgress) {
  return new Promise((resolve, reject) => {
    const { resolution, videoBitrate, audioBitrate, fps } = streamCfg;
    const [w, h] = resolution.split('x');

    const args = [
      '-i', srcPath,
      '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', videoBitrate,
      '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=${fps}`,
      '-c:a', 'aac', '-b:a', audioBitrate, '-ar', '44100', '-ac', '2',
      '-x264opts', 'keyint=180:min-keyint=180:no-scenecut',
      '-y', destPath,
    ];

    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', d => {
      stderr += d;
      const m = stderr.match(/time=(\d+):(\d+):([\d.]+)/);
      if (m && onProgress) {
        const secs = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
        onProgress(secs);
      }
    });
    proc.on('close', code => {
      if (code === 0) resolve(destPath);
      else reject(new Error(`ffmpeg normalize failed (${code}): ${stderr.slice(-500)}`));
    });
  });
}

export function normalizeAudioTo(srcPath, destPath, streamCfg, onProgress) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', srcPath,
      '-c:a', 'aac', '-b:a', streamCfg.audioBitrate, '-ar', '44100', '-ac', '2',
      '-y', destPath,
    ];
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', code => {
      if (code === 0) resolve(destPath);
      else reject(new Error(`ffmpeg audio normalize failed: ${stderr.slice(-300)}`));
    });
  });
}

export async function ensureNormalized(srcPath, cacheDir, streamCfg, isAudio, onProgress) {
  mkdirSync(cacheDir, { recursive: true });
  const dest = normCachePath(cacheDir, srcPath);
  if (existsSync(dest)) return dest;
  if (isAudio) {
    await normalizeAudioTo(srcPath, dest, streamCfg, onProgress);
  } else {
    await normalizeTo(srcPath, dest, streamCfg, onProgress);
  }
  return dest;
}
