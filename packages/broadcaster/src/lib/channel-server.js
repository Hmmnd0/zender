// Client for the local channel server control API.
// The channel server process runs on localhost alongside the broadcaster app.

// Use relative URLs so requests go through Vite's proxy in dev
// (Tauri WebKit blocks direct cross-origin fetches to different localhost ports)
const BASE = '';
let evtWs = null;
const listeners = new Set();

export function subscribeToEvents(fn) {
  listeners.add(fn);
  ensureWs();
  return () => listeners.delete(fn);
}

function ensureWs() {
  if (evtWs && evtWs.readyState <= 1) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  evtWs = new WebSocket(`${proto}//${location.host}/control/events`);
  evtWs.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      listeners.forEach(fn => fn(msg));
    } catch { /* ignore */ }
  };
  evtWs.onclose = () => {
    setTimeout(ensureWs, 3000);
  };
}

export async function getState() {
  const res = await fetch(`${BASE}/control/state`);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export async function setOnAir(on) {
  const res = await fetch(`${BASE}/control/onair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ on }),
  });
  if (!res.ok) {
    let msg = `Server error ${res.status}`;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export async function playNow(file) {
  const res = await fetch(`${BASE}/control/playnow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file }),
  });
  if (!res.ok) {
    let msg = `Server error ${res.status}`;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export async function enqueueFile(file) {
  const res = await fetch(`${BASE}/control/enqueue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file }),
  });
  return res.json();
}

export async function dequeueFile(file) {
  const res = await fetch(`${BASE}/control/dequeue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file }),
  });
  return res.json();
}

export async function skip() {
  const res = await fetch(`${BASE}/control/skip`, { method: 'POST' });
  return res.json();
}

export async function standby() {
  const res = await fetch(`${BASE}/control/standby`, { method: 'POST' });
  return res.json();
}

export async function normalizeFile(file) {
  const res = await fetch(`${BASE}/control/normalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file }),
  });
  return res.json();
}

export async function setBumpers(playlist, { everyN = null, intervalMins = null } = {}) {
  const res = await fetch(`${BASE}/control/bumpers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playlist, everyN, intervalMins }),
  });
  return res.json();
}

export async function shutdownServer() {
  try {
    await fetch(`${BASE}/control/shutdown`, { method: 'POST' });
  } catch { /* server closes connection as it exits — fetch may throw */ }
}

export function formatUptime(secs) {
  const h = Math.floor(secs / 3600).toString().padStart(2, '0');
  const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(secs % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}
