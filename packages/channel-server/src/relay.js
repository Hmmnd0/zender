import { readFileSync, existsSync } from 'fs';
import { basename } from 'path';

// Approach A: push HLS segments + playlist to operator relay via HTTP PUT.
// Broadcaster uploads once; the relay fans out to all viewers.
// The playlist is always PUT last so viewers never reference a segment not yet uploaded.

export class RelayUploader {
  constructor(relayUrl, secret) {
    // relayUrl: e.g. https://relay1.zender.example/ingest/<channel-id>/
    this.relayUrl = relayUrl.endsWith('/') ? relayUrl : relayUrl + '/';
    this.secret = secret;
    this._pending = new Set();
  }

  async uploadSegment(segPath) {
    const name = basename(segPath);
    if (this._pending.has(name)) return;
    this._pending.add(name);
    try {
      const body = readFileSync(segPath);
      await this._put(name, body, 'video/mp2t');
    } catch (e) {
      console.error(`[relay] segment upload failed: ${e.message}`);
    } finally {
      this._pending.delete(name);
    }
  }

  async uploadPlaylist(m3u8Path) {
    if (!existsSync(m3u8Path)) return;
    try {
      const body = readFileSync(m3u8Path, 'utf8');
      await this._put('live.m3u8', Buffer.from(body), 'application/vnd.apple.mpegurl');
    } catch (e) {
      console.error(`[relay] playlist upload failed: ${e.message}`);
    }
  }

  async deleteSegment(segPath) {
    const name = basename(segPath);
    try {
      await fetch(this.relayUrl + name, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.secret}` },
      });
    } catch { /* best-effort */ }
  }

  _put(name, body, contentType) {
    return fetch(this.relayUrl + name, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${this.secret}`,
        'Content-Type': contentType,
        'Content-Length': String(body.length),
      },
      body,
    });
  }
}
