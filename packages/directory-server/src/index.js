import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, 'directory.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS channels (
    id          TEXT PRIMARY KEY,
    secret      TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    genre       TEXT,
    type        TEXT CHECK(type IN ('tv','radio')),
    stream_url  TEXT NOT NULL,
    thumb_url   TEXT,
    now_playing TEXT,
    viewers     INTEGER DEFAULT 0,
    masked      INTEGER DEFAULT 1,
    flagged     INTEGER DEFAULT 0,
    banned      INTEGER DEFAULT 0,
    reg_ip      TEXT,
    last_seen   INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS relay_tokens (
    channel_id  TEXT PRIMARY KEY,
    token       TEXT NOT NULL,
    relay_url   TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    FOREIGN KEY(channel_id) REFERENCES channels(id)
  );

  CREATE TABLE IF NOT EXISTS channel_epg (
    channel_id  TEXT PRIMARY KEY,
    epg_json    TEXT NOT NULL,
    updated_at  INTEGER NOT NULL,
    FOREIGN KEY(channel_id) REFERENCES channels(id)
  );

  CREATE TABLE IF NOT EXISTS banned_ips (
    ip          TEXT PRIMARY KEY,
    reason      TEXT,
    created_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_channels_last_seen ON channels(last_seen);
  CREATE INDEX IF NOT EXISTS idx_channels_type ON channels(type);
  CREATE INDEX IF NOT EXISTS idx_channels_genre ON channels(genre);
`);

const HEARTBEAT_TTL = 90;

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const registerLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { error: 'Too many registrations from this IP' },
});

function getIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() ?? req.socket.remoteAddress;
}

function requireBearer(req, res) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing bearer token' });
    return null;
  }
  return auth.slice(7);
}

function channelFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    genre: row.genre,
    type: row.type,
    stream_url: row.stream_url,
    thumb_url: row.thumb_url,
    now_playing: row.now_playing,
    viewers: row.viewers,
    masked: row.masked === 1,
  };
}

// Verify a stream URL is a reachable HLS playlist
async function verifyStream(url) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const body = await res.text();
    return body.includes('#EXTM3U');
  } catch {
    return false;
  }
}

// POST /api/register
app.post('/api/register', registerLimit, async (req, res) => {
  const ip = getIp(req);
  const banned = db.prepare('SELECT 1 FROM banned_ips WHERE ip = ?').get(ip);
  if (banned) return res.status(403).json({ error: 'Banned' });

  const { name, description, genre, type, stream_url, thumb_url, masked } = req.body;
  if (!name || !type || !stream_url) {
    return res.status(400).json({ error: 'name, type, and stream_url are required' });
  }
  if (!['tv', 'radio'].includes(type)) {
    return res.status(400).json({ error: 'type must be tv or radio' });
  }

  const ok = await verifyStream(stream_url);
  if (!ok) {
    return res.status(400).json({ error: 'stream_url is not a reachable HLS playlist' });
  }

  const id = uuidv4();
  const secret = uuidv4();
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO channels (id, secret, name, description, genre, type, stream_url,
      thumb_url, masked, reg_ip, last_seen, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, secret, name, description ?? null, genre ?? null, type,
    stream_url, thumb_url ?? null, masked === false ? 0 : 1, ip, now, now);

  res.status(201).json({ id, secret });
});

// POST /api/heartbeat
app.post('/api/heartbeat', (req, res) => {
  const secret = requireBearer(req, res);
  if (!secret) return;

  const { id, now_playing, viewers, epg } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });

  const channel = db.prepare('SELECT id, secret, banned FROM channels WHERE id = ?').get(id);
  if (!channel || channel.secret !== secret) return res.status(403).json({ error: 'Forbidden' });
  if (channel.banned) return res.status(403).json({ error: 'Channel banned' });

  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    UPDATE channels SET last_seen = ?, now_playing = ?, viewers = ?
    WHERE id = ?
  `).run(now, now_playing ?? null, viewers ?? 0, id);

  if (epg) {
    db.prepare(`
      INSERT INTO channel_epg (channel_id, epg_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET epg_json = excluded.epg_json, updated_at = excluded.updated_at
    `).run(id, JSON.stringify(epg), now);
  }

  res.json({ ok: true });
});

// GET /api/channels/:id/epg
app.get('/api/channels/:id/epg', (req, res) => {
  const cutoff = Math.floor(Date.now() / 1000) - HEARTBEAT_TTL;
  const ch = db.prepare('SELECT last_seen, banned FROM channels WHERE id = ?').get(req.params.id);
  if (!ch || ch.banned || ch.last_seen < cutoff) return res.status(404).json({ error: 'Channel not found or offline' });
  const row = db.prepare('SELECT epg_json FROM channel_epg WHERE channel_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No EPG available' });
  res.json(JSON.parse(row.epg_json));
});

// GET /api/channels
app.get('/api/channels', (req, res) => {
  const { type, genre, sort = 'viewers' } = req.query;
  const cutoff = Math.floor(Date.now() / 1000) - HEARTBEAT_TTL;

  const conditions = ['last_seen > ?', 'banned = 0', 'flagged = 0'];
  const params = [cutoff];

  if (type) { conditions.push('type = ?'); params.push(type); }
  if (genre) { conditions.push('genre = ?'); params.push(genre); }

  const orderCol = sort === 'newest' ? 'created_at' : 'viewers';
  const rows = db.prepare(
    `SELECT * FROM channels WHERE ${conditions.join(' AND ')} ORDER BY ${orderCol} DESC`
  ).all(...params);

  res.json(rows.map(channelFromRow));
});

// DELETE /api/channels/:id
app.delete('/api/channels/:id', (req, res) => {
  const secret = requireBearer(req, res);
  if (!secret) return;

  const channel = db.prepare('SELECT secret FROM channels WHERE id = ?').get(req.params.id);
  if (!channel || channel.secret !== secret) return res.status(403).json({ error: 'Forbidden' });

  db.prepare('DELETE FROM channels WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM relay_tokens WHERE channel_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/report
app.post('/api/report', rateLimit({ windowMs: 60_000, max: 5 }), (req, res) => {
  const { id, reason } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  db.prepare('UPDATE channels SET flagged = 1 WHERE id = ?').run(id);
  console.log(`[report] channel=${id} reason="${reason}"`);
  res.json({ ok: true });
});

// --- Relay auth (called by nginx auth_request) ---
// GET /api/relay-auth  (headers: Authorization, X-Channel-Id)
app.get('/api/relay-auth', (req, res) => {
  const secret = requireBearer(req, res);
  if (!secret) return;
  const channelId = req.headers['x-channel-id'];
  if (!channelId) return res.status(400).end();

  const row = db.prepare('SELECT secret, banned FROM channels WHERE id = ?').get(channelId);
  if (!row || row.secret !== secret || row.banned) return res.status(403).end();
  res.status(200).end();
});

// --- Admin endpoints (require ADMIN_SECRET env var) ---
function requireAdmin(req, res) {
  const secret = requireBearer(req, res);
  if (!secret) return false;
  if (secret !== process.env.ADMIN_SECRET) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

app.post('/api/admin/ban', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { id, ip, reason } = req.body;
  if (id) {
    db.prepare('UPDATE channels SET banned = 1 WHERE id = ?').run(id);
  }
  if (ip) {
    db.prepare('INSERT OR REPLACE INTO banned_ips (ip, reason, created_at) VALUES (?, ?, ?)')
      .run(ip, reason ?? null, Math.floor(Date.now() / 1000));
  }
  res.json({ ok: true });
});

app.post('/api/admin/unflag', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { id } = req.body;
  db.prepare('UPDATE channels SET flagged = 0 WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.get('/api/admin/flagged', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const rows = db.prepare('SELECT * FROM channels WHERE flagged = 1').all();
  res.json(rows.map(channelFromRow));
});

// Health check
app.get('/health', (req, res) => res.json({ ok: true, channels: db.prepare('SELECT COUNT(*) as n FROM channels WHERE banned=0').get().n }));

// Connectivity probe — broadcaster asks us to fetch their test URL from the outside.
// This tells them whether their port is publicly reachable.
app.get('/api/check-reachability', rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ ok: false, error: 'url required' });
  try {
    new URL(url); // validate it's a real URL
  } catch {
    return res.status(400).json({ ok: false, error: 'invalid url' });
  }
  // Block probing private/local addresses
  const { hostname } = new URL(url);
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)) {
    return res.status(400).json({ ok: false, error: 'private addresses not allowed' });
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const probe = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    const text = await probe.text().catch(() => '');
    res.json({ ok: probe.ok && text.includes('zender-ok'), status: probe.status });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT ?? 3001;
createServer(app).listen(PORT, () => {
  console.log(`[directory] listening on :${PORT}`);
});
