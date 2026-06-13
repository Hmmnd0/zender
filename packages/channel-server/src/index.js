#!/usr/bin/env node
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { join, resolve } from 'path';
import { mkdirSync, existsSync, readdirSync, unlinkSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { loadConfig } from './config.js';
import { Scheduler } from './scheduler.js';
import { Broadcaster } from './broadcaster.js';
import { QueueFeeder } from './queue-feeder.js';
import { RelayUploader } from './relay.js';
import { DirectoryClient } from './directory-client.js';
import { ViewerCounter } from './viewer-counter.js';
import { ensureNormalized, generateStandby, isAudioFile, isMediaFile } from './normalizer.js';

const configPath = process.argv[2] ?? 'channel.toml';
const cfg = loadConfig(configPath);

// Operational files (cache, segments, playlist) live in ~/Movies/Zender/<channel>/
// so they never clutter the user's media folder.
const safeName = cfg.channel.name.replace(/[^a-z0-9_-]/gi, '_').slice(0, 64) || 'channel';
const mediaFolder = process.platform === 'darwin' ? 'Movies' : 'Videos';
const workDir = join(homedir(), mediaFolder, 'Zender', safeName);
const cacheDir = join(workDir, 'cache');
const publicDir = join(workDir, 'public');
mkdirSync(cacheDir, { recursive: true });
mkdirSync(publicDir, { recursive: true });

const scheduler = new Scheduler(cfg.scheduler);
const viewers = new ViewerCounter();
const directory = new DirectoryClient(cfg.directory.url, cfg.channel);

let onAir = false;
let nowPlaying = null;
let upcomingQueue = [];
let broadcaster = null;
let feeder = null;
let relay = null;
let _restarting = false;

// --- Normalize queue ---
const normQueue = [];
let normRunning = 0;
const NORM_CONCURRENCY = 2;

function queueNormalize(srcPath, onDone) {
  normQueue.push({ srcPath, onDone });
  drainNorm();
}

function drainNorm() {
  while (normRunning < NORM_CONCURRENCY && normQueue.length) {
    const { srcPath, onDone } = normQueue.shift();
    normRunning++;
    const isAudio = isAudioFile(srcPath);
    ensureNormalized(srcPath, cacheDir, cfg.stream, isAudio, (secs) => {
      broadcast({ type: 'norm_progress', file: srcPath, secs });
    }).then((dest) => {
      onDone?.(null, dest);
      broadcast({ type: 'norm_done', file: srcPath, dest });
    }).catch((err) => {
      onDone?.(err, null);
      broadcast({ type: 'norm_error', file: srcPath, error: err.message });
    }).finally(() => {
      normRunning--;
      drainNorm();
    });
  }
}

// --- WebSocket state broadcasting ---
const wss = new WebSocketServer({ noServer: true });
const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.send(JSON.stringify(getState()));
  ws.on('close', () => wsClients.delete(ws));
});

function broadcast(msg) {
  const raw = JSON.stringify(msg);
  for (const ws of wsClients) {
    if (ws.readyState === 1) ws.send(raw);
  }
}

function getState() {
  return {
    type: 'state',
    onAir,
    nowPlaying,
    upcomingQueue,
    pendingQueue: scheduler.manualQueue.map(f => ({
      path: f,
      name: f.split('/').pop()?.replace(/(\.\w{2,4})?\.norm\.ts$/, '').replace(/\.\w{2,4}$/, '') ?? f,
    })),
    viewers: viewers.count(),
    uptime: broadcaster?.uptime ?? 0,
    mode: cfg.server.mode,
  };
}

// --- Broadcaster lifecycle ---
let _startingUp = false; // sync guard — prevents concurrent goOnAir() calls

async function goOnAir() {
  if (onAir || _startingUp) return;
  _startingUp = true;
  try {
    await _goOnAir();
  } finally {
    _startingUp = false;
  }
}

function broadcastStartup(phase, detail = {}) {
  broadcast({ type: 'startup', phase, ...detail });
}

async function _goOnAir() {
  clearPublicDir();

  const firstSrc = scheduler.next(null);
  if (!firstSrc) throw new Error('No media available in scheduler');

  const firstName = firstSrc.split('/').pop()?.replace(/\.\w{2,4}$/, '') ?? firstSrc;
  broadcastStartup('normalizing', { file: firstName });
  const standbySrc = join(cacheDir, 'standby.ts');
  const [firstNorm] = await Promise.all([
    ensureNormalized(firstSrc, cacheDir, cfg.stream, isAudioFile(firstSrc)),
    existsSync(standbySrc) ? Promise.resolve() : generateStandby(standbySrc, cfg.stream).catch(e => console.error('[standby] gen failed:', e.message)),
  ]);

  if (cfg.server.mode === 'relay' && cfg.server.relayUrl) {
    relay = new RelayUploader(cfg.server.relayUrl, null);
  }

  broadcastStartup('starting_stream');
  broadcaster = new Broadcaster(workDir, cfg, async (segPath) => {
    if (relay) {
      await relay.uploadSegment(segPath);
      await relay.uploadPlaylist(join(publicDir, 'live.m3u8'));
    }
    broadcast({ type: 'segment' });
  }, (err) => {
    console.error('[broadcaster] error:', err.message);
    broadcast({ type: 'error', message: err.message });
    if (onAir && !_restarting) {
      _restarting = true;
      console.log('[broadcaster] auto-restarting in 3s…');
      broadcast({ type: 'ffmpeg_log', level: 'error', line: `ffmpeg crashed — auto-restarting in 3s… (${err.message})` });
      setTimeout(async () => {
        try {
          if (!onAir) return;
          await goOffAir();
          await goOnAir();
        } catch (e) {
          console.error('[broadcaster] auto-restart failed:', e.message);
          broadcast({ type: 'ffmpeg_log', level: 'error', line: `auto-restart failed: ${e.message}` });
        } finally {
          _restarting = false;
        }
      }, 3000);
    }
  }, (logEntry) => {
    broadcast({ type: 'ffmpeg_log', ...logEntry });
  });

  broadcaster.start(firstNorm);

  feeder = new QueueFeeder({
    scheduler,
    cacheDir,
    streamCfg: cfg.stream,
    onEnqueue: (norm) => broadcaster?.enqueue(norm),
    onNowPlaying: (src) => {
      nowPlaying = src.split('/').pop()?.replace(/(\.\w{2,4})?\.norm\.ts$/, '').replace(/\.\w{2,4}$/, '') ?? src;
      broadcast(getState());
    },
    onQueueChange: (items) => {
      upcomingQueue = items;
      broadcast(getState());
    },
  });

  await feeder.start(firstSrc, firstNorm);

  onAir = true;
  setInterval(() => broadcaster?.grabThumb(), 30_000);

  if (cfg.directory.public) {
    const streamUrl = cfg.server.mode === 'relay' ? relayPublicUrl() : localPublicUrl();
    const thumbUrl = streamUrl.replace('live.m3u8', 'thumb.jpg');
    try {
      // Wait up to 30 s for the first HLS playlist to appear before registering.
      // ffmpeg needs at least one segment duration before live.m3u8 is written.
      broadcastStartup('waiting_stream');
      await (async () => {
        const m3u8 = join(publicDir, 'live.m3u8');
        const deadline = Date.now() + 30_000;
        while (!existsSync(m3u8) && Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 500));
        }
      })();
      broadcastStartup('registering');
      const { secret } = await directory.register(streamUrl, thumbUrl, cfg.server.mode === 'relay');
      if (relay) relay.secret = secret;
      directory.startHeartbeat(
        () => nowPlaying,
        () => viewers.count(),
        () => feeder?.upcomingItems.slice(0, 10).map(item => ({
          title: item.src.split('/').pop()?.replace(/\.\w{2,4}\.norm\.ts$/, '') ?? item.src,
          duration: item.duration,
        })) ?? null,
      );
    } catch (e) {
      console.error('[directory] registration error:', e.message);
    }
  }

  broadcast(getState());
}

async function goOffAir() {
  if (!onAir) return;
  feeder?.stop();
  feeder = null;
  broadcaster?.stop();
  broadcaster = null;
  relay = null;
  onAir = false;
  nowPlaying = null;
  upcomingQueue = [];
  await directory.deregister();
  broadcast(getState());
}

function localPublicUrl() {
  if (cfg.server.publicUrl) return `${cfg.server.publicUrl}/stream/live.m3u8`;
  return `http://localhost:${cfg.server.port}/stream/live.m3u8`;
}

function relayPublicUrl() {
  if (!cfg.server.relayUrl) return localPublicUrl();
  return cfg.server.relayUrl.replace('/ingest/', '/ch/') + 'live.m3u8';
}

// --- HTTP server ---
const app = express();
app.use(express.json());

app.use('/stream', (req, res, next) => {
  viewers.record(req.ip);
  next();
}, express.static(publicDir, {
  setHeaders(res, path) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    if (path.endsWith('.m3u8')) res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    if (path.endsWith('.ts')) res.setHeader('Content-Type', 'video/mp2t');
  },
}));

app.get('/channel.json', (_req, res) => {
  res.json({
    ...cfg.channel,
    onAir,
    nowPlaying,
    viewers: viewers.count(),
    uptime: broadcaster?.uptime ?? 0,
    streamUrl: localPublicUrl(),
    mode: cfg.server.mode,
  });
});

app.get('/thumb.jpg', (_req, res) => {
  const p = join(publicDir, 'thumb.jpg');
  if (existsSync(p)) res.sendFile(p);
  else res.status(404).end();
});

// EPG — upcoming schedule derived from scheduler state
app.get('/epg.json', (_req, res) => {
  const now = new Date();
  const items = (feeder?.upcomingItems ?? []).slice(0, 20).map((item, i) => {
    const label = item.src.split('/').pop()?.replace(/\.\w{2,4}\.norm\.ts$/, '').replace(/\.norm\.ts$/, '') ?? item.src;
    return { index: i, title: label, duration: item.duration };
  });
  res.json({
    channel: cfg.channel.name,
    generated: now.toISOString(),
    upcoming: items,
  });
});

// Connectivity probe — directory server fetches this to confirm the port is open
app.get('/connectivity-check', (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/plain');
  res.send('zender-ok');
});

// Control API
app.post('/control/onair', async (req, res) => {
  try {
    if (req.body.on) {
      // Kick off startup in background; progress arrives via WebSocket events.
      res.json({ ok: true, startingUp: true });
      goOnAir().catch(e => {
        console.error('[onair] startup failed:', e.message);
        broadcast({ type: 'startup_error', message: e.message });
      });
    } else {
      await goOffAir();
      res.json(getState());
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/control/enqueue', async (req, res) => {
  const { file } = req.body;
  if (!file) return res.status(400).json({ error: 'file required' });
  if (!isMediaFile(file)) return res.status(400).json({ error: 'not a media file' });
  // Add to manual queue immediately so the UI reflects it; QueueFeeder will
  // call ensureNormalized when it actually needs to buffer the file.
  scheduler.enqueueManual(file);
  queueNormalize(file, null);
  broadcast(getState()); // push updated pendingQueue to UI immediately
  res.json({ ok: true });
});

function makeFeeder() {
  return new QueueFeeder({
    scheduler,
    cacheDir,
    streamCfg: cfg.stream,
    onEnqueue: (n) => broadcaster?.enqueue(n),
    onNowPlaying: (src) => {
      nowPlaying = src
        ? src.split('/').pop()?.replace(/(\.\w{2,4})?\.norm\.ts$/, '').replace(/\.\w{2,4}$/, '') ?? src
        : null;
      broadcast(getState());
    },
    onQueueChange: (items) => { upcomingQueue = items; broadcast(getState()); },
  });
}

// Normalize a file, emitting progress to the Signal Log so the UI shows activity.
function normalizeWithProgress(file) {
  const label = file.split('/').pop()?.replace(/\.\w{2,4}$/, '') ?? file;
  broadcast({ type: 'ffmpeg_log', level: 'info', line: `Encoding ${label} for playback…` });
  return ensureNormalized(file, cacheDir, cfg.stream, isAudioFile(file), (secs) => {
    broadcast({ type: 'norm_progress', file, secs });
  });
}

app.post('/control/playnow', async (req, res) => {
  const { file } = req.body;
  if (!file) return res.status(400).json({ error: 'file required' });
  if (!isMediaFile(file)) return res.status(400).json({ error: 'not a media file' });
  if (!onAir) return res.status(400).json({ error: 'not on air' });
  try {
    // Normalize first (instant if already cached; shows Signal Log progress if not)
    const norm = await normalizeWithProgress(file);

    // Hard-cut to the new file right away
    feeder?.stop();
    feeder = null;
    broadcaster.skip();
    broadcaster.restartFrom(norm);
    nowPlaying = file.split('/').pop()?.replace(/(\.\w{2,4})?\.norm\.ts$/, '').replace(/\.\w{2,4}$/, '') ?? file;
    broadcast(getState());

    // Respond immediately — don't wait for feeder's ffprobe / buffer fill
    res.json(getState());

    // Start the feeder in the background so the queue refills without blocking
    feeder = makeFeeder();
    feeder.start(file, norm).catch(e => console.error('[playnow] feeder error:', e.message));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/control/skip', async (req, res) => {
  if (!broadcaster || !feeder) return res.status(400).json({ error: 'not on air' });
  const next = scheduler.next(nowPlaying);
  if (!next) return res.status(400).json({ error: 'nothing in scheduler' });

  // Normalize (instant if cached)
  const norm = await normalizeWithProgress(next);

  // Hard-cut immediately
  feeder?.stop();
  feeder = null;
  broadcaster.skip();
  broadcaster.restartFrom(norm);
  nowPlaying = next.split('/').pop()?.replace(/(\.\w{2,4})?\.norm\.ts$/, '').replace(/\.\w{2,4}$/, '') ?? next;
  broadcast(getState());

  // Respond right away — feeder setup (ffprobe + buffer fill) runs in background
  res.json(getState());

  feeder = makeFeeder();
  feeder.start(next, norm).catch(e => console.error('[skip] feeder error:', e.message));
});

app.post('/control/standby', async (req, res) => {
  const standbySrc = join(cacheDir, 'standby.ts');
  if (!existsSync(standbySrc)) return res.status(400).json({ error: 'standby.ts not found in cache' });
  if (!broadcaster) return res.status(400).json({ error: 'not on air' });
  feeder?.stop();
  feeder = null;
  broadcaster.skip();
  broadcaster.restartFrom(standbySrc);
  nowPlaying = 'STANDBY';
  broadcast(getState());
  res.json({ ok: true });
});

app.post('/control/resume', async (req, res) => {
  if (!broadcaster) return res.status(400).json({ error: 'not on air' });
  const next = scheduler.next(null);
  if (!next) return res.status(400).json({ error: 'nothing in scheduler' });

  const norm = await normalizeWithProgress(next);

  broadcaster.skip();
  broadcaster.restartFrom(norm);
  nowPlaying = next.split('/').pop()?.replace(/(\.\w{2,4})?\.norm\.ts$/, '').replace(/\.\w{2,4}$/, '') ?? next;
  broadcast(getState());

  res.json(getState());

  feeder = makeFeeder();
  feeder.start(next, norm).catch(e => console.error('[resume] feeder error:', e.message));
});

app.get('/control/state', (_req, res) => res.json(getState()));

app.get('/control/config', (_req, res) => res.json(cfg));

app.get('/control/debug', (_req, res) => {
  let playlistContents = null;
  let segmentCount = 0;
  let latestSegmentMtime = null;
  try { playlistContents = readFileSync(join(workDir, 'playlist.txt'), 'utf8'); } catch {}
  try {
    const segs = readdirSync(publicDir).filter(f => f.endsWith('.ts')).sort();
    segmentCount = segs.length;
    if (segs.length) {
      const last = join(publicDir, segs[segs.length - 1]);
      latestSegmentMtime = statSync(last).mtime;
    }
  } catch {}
  res.json({
    onAir,
    ffmpegPid: broadcaster?.ffmpeg?.pid ?? null,
    ffmpegRestarts: broadcaster?._restartCount ?? 0,
    feederItems: feeder?.upcomingItems ?? [],
    playlistContents,
    segmentCount,
    latestSegmentMtime,
    uptime: broadcaster?.uptime ?? 0,
  });
});

app.post('/control/dequeue', (req, res) => {
  const { file } = req.body;
  if (!file) return res.status(400).json({ error: 'file required' });
  scheduler.dequeueManual(file);
  broadcast(getState());
  res.json({ ok: true });
});

app.post('/control/bumpers', (req, res) => {
  const { playlist = [], everyN = null, intervalMins = null } = req.body;
  scheduler.setBumpers(playlist, { everyN, intervalMins });
  res.json({ ok: true });
});

app.post('/control/normalize', (req, res) => {
  const { file } = req.body;
  if (!file) return res.status(400).json({ error: 'file required' });
  queueNormalize(file);
  res.json({ ok: true, queued: file });
});

// Connectivity check: ask directory server to probe us from outside
app.get('/control/connectivity', async (req, res) => {
  const publicUrl = cfg.server.publicUrl || req.query.publicUrl;
  if (!publicUrl) return res.status(400).json({ error: 'public_url not configured' });
  const testUrl = `${publicUrl.replace(/\/$/, '')}/connectivity-check`;
  const directoryUrl = cfg.directory.url;
  try {
    const r = await fetch(`${directoryUrl}/api/check-reachability?url=${encodeURIComponent(testUrl)}`);
    res.json(await r.json());
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/control/shutdown', async (_req, res) => {
  res.json({ ok: true });
  await shutdown();
  setTimeout(() => process.exit(0), 200);
});

// Update relay URL at runtime (called after directory registration returns the relay endpoint)
app.post('/control/relay-url', (req, res) => {
  const { relayUrl, secret } = req.body;
  if (!relayUrl) return res.status(400).json({ error: 'relayUrl required' });
  cfg.server.relayUrl = relayUrl;
  if (relay) {
    relay.relayUrl = relayUrl.endsWith('/') ? relayUrl : relayUrl + '/';
    if (secret) relay.secret = secret;
  }
  res.json({ ok: true });
});

const server = createServer(app);
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/control/events') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

const PORT = cfg.server.port;
server.listen(PORT, () => {
  console.log(`[channel-server] "${cfg.channel.name}" — :${PORT} — mode: ${cfg.server.mode}`);
  // Clear any stale HLS segments left by a previous crashed session.
  // Normalized cache files (cacheDir) are deliberately kept.
  clearPublicDir();
});

function clearPublicDir() {
  try {
    for (const f of readdirSync(publicDir)) {
      try { unlinkSync(join(publicDir, f)); } catch {}
    }
  } catch {}
  console.log('[channel-server] stale stream files cleared');
}

async function shutdown() {
  await goOffAir();
  clearPublicDir();
}

process.on('SIGTERM', async () => { await shutdown(); process.exit(0); });
process.on('SIGINT',  async () => { await shutdown(); process.exit(0); });
