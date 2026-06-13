# Zender

**Self-hosted internet TV channels and radio stations, in the spirit of SHOUTcast and Winamp TV.**

Anyone can run a channel. Point the software at a folder of videos or music, hit ON AIR, and your channel appears in a public channel guide where anyone can tune in — from a browser or a lightweight desktop app.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [The Source Client (Broadcaster App)](#2-the-source-client)
3. [The Channel Server (Stream Engine)](#3-the-channel-server)
4. [The Directory Server (Channel Guide API)](#4-the-directory-server)
5. [The Audience Client (Web + Desktop)](#5-the-audience-client)
6. [The Publishing Workflow](#6-the-publishing-workflow)
7. [Deployment Notes](#7-deployment-notes)
8. [Roadmap Ideas](#8-roadmap-ideas)

---

## 1. Architecture Overview

Zender is a series of tools, not a single app. Five components, three audiences:

```
 BROADCASTER'S MACHINE                YOUR INFRASTRUCTURE          AUDIENCE
┌─────────────────────────┐         ┌──────────────────┐     ┌──────────────────┐
│  SOURCE CLIENT          │         │ DIRECTORY SERVER │     │ AUDIENCE CLIENT  │
│  (playlist, scheduler,  │ register│ (channel guide   │ list│ (web app +       │
│   ON AIR button)        │────────▶│  API, heartbeats)│◀────│  desktop app)    │
│           │             │         └──────────────────┘     │        │         │
│           ▼ feeds       │                                  │        │ tunes in│
│  CHANNEL SERVER         │   HLS stream (.m3u8 + .ts)       │        │         │
│  (ffmpeg → HLS,         │◀─────────────────────────────────│────────┘         │
│   HTTP segment server)  │                                  └──────────────────┘
└─────────────────────────┘
```

| Component | Who runs it | What it does |
|---|---|---|
| **Source Client** | Broadcaster | Desktop app: media library, playlist queue, scheduler, ON AIR toggle. The brain. |
| **Channel Server** | Broadcaster (bundled with source client) | ffmpeg pipeline + HTTP server. Turns the queue into a continuous HLS stream. The pipes. |
| **Directory Server** | Network operator (you) | Central API. Channels register and heartbeat; clients fetch the channel list. The guide. |
| **Audience Client** | Audience | One codebase, two builds: zero-install web app and a Tauri desktop app. The dial. |
| **Publishing Workflow** | — | The documented start-to-finish broadcaster experience tying it together. |

**Key design decisions:**

- **HLS, not NSV.** Streams are plain `.ts` segments + an `.m3u8` playlist served over HTTP. Dumb, simple, cacheable, plays everywhere (hls.js in browsers, natively on Apple devices). The retro aesthetic lives in the UI, not the wire format.
- **Custom scheduler, not liquidsoap.** The scheduler is a queue manager written in Node; ffmpeg does all the hard media work. Keeps the whole brain in one hackable codebase and ships as one clean bundle (ffmpeg is a single static binary).
- **The directory is the product.** Servers and players exist elsewhere. The channel-surfing experience — one guide, every channel, click to tune — is what made SHOUTcast feel alive and is the thing Zender resurrects.

---

## 2. The Source Client

The broadcaster's cockpit. Spiritual child of Winamp's main window and its Media Library.

### 2.1 Stack

- **Tauri** app (Rust shell, web UI) — same toolchain as the audience desktop client, so you learn it once.
- UI in plain HTML/CSS/JS or a light framework (Svelte recommended — small output suits the retro ethos).
- Talks to the Channel Server process over a local WebSocket/HTTP control API (see §3.4).

### 2.2 UI Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ ⦿ ON AIR   "Channel 47: Saturday Cartoons"   👁 23   ⏱ 04:12:55  │  ← Transmitter bar
├────────────┬─────────────────────────────────┬───────────────────┤
│ LIBRARY    │ NOW PLAYING                     │ SCHEDULER         │
│            │ ▶ thundercats-s01e04.mp4        │                   │
│ 📁 cartoons│ ▓▓▓▓▓▓▓░░░░░░  12:33 / 22:10    │ Mon–Fri           │
│ 📁 movies  │                                 │ 06:00 /cartoons   │
│ 📁 ids     │ UP NEXT                         │ 10:00 /movies     │
│ 📁 bumpers │ 1. station-id-03.mp4   0:15     │ Sat               │
│            │ 2. he-man-s02e11.mp4  21:45     │ 08:00 /cartoons   │
│ (drag to   │ 3. gi-joe-s01e01.mp4  22:02     │                   │
│  queue →)  │ 4. ...                          │ RULES             │
│            │ (drag to reorder,               │ every 60min:      │
│            │  right-click for actions)       │  insert /ids rand │
├────────────┴─────────────────────────────────┴───────────────────┤
│ [Insert Station ID] [Skip ▶▶] [Standby Loop ⚠] [Crossfade: ON]   │  ← Quick actions
└──────────────────────────────────────────────────────────────────┘
```

- **Transmitter bar:** station name, ON AIR/OFF AIR toggle with status LED, viewer count (from channel server), uptime, bitrate, and a small live preview thumbnail.
- **Library (left):** scanned media folders with duration/codec info surfaced. Files that will need re-encoding (codec mismatch with channel profile) get a warning badge *before* they hit the queue.
- **Now Playing + Queue (center):** current item with progress; reorderable up-next list. A visible "locked" line marks items already handed to ffmpeg vs. still editable.
- **Scheduler (right):** time blocks mapping folders to dayparts, plus interval rules ("every 60 min insert a random file from /ids"). Weekly grid view as an alternate tab.
- **Quick actions (bottom):** insert station ID now, skip current, panic-cut to a standby loop ("Technical Difficulties" card — very public-access), crossfade toggle for audio channels.

Design language: dense, functional, slightly nerdy. Dark by default. Real borders and buttons — Winamp/foobar2000, not Spotify. CSS structured for skinning later.

### 2.3 Channel Configuration

One file per channel, `channel.toml`, lives in the channel's working directory:

```toml
[channel]
name        = "Channel 47: Saturday Cartoons"
description = "80s cartoons, all day, forever."
genre       = "animation"
type        = "tv"            # "tv" or "radio"
logo        = "logo.png"

[stream]
resolution  = "1280x720"      # ignored for radio
video_bitrate = "2500k"
audio_bitrate = "128k"
fps         = 30
segment_seconds = 6

[scheduler]
mode = "schedule"             # "sequential" | "shuffle" | "schedule"

[[scheduler.blocks]]
days   = ["mon","tue","wed","thu","fri"]
start  = "06:00"
folder = "media/cartoons"
order  = "shuffle"

[[scheduler.blocks]]
days   = ["mon","tue","wed","thu","fri"]
start  = "10:00"
folder = "media/movies"
order  = "sequential"

[[scheduler.rules]]
every_minutes = 60
folder = "media/ids"
pick   = "random"

[directory]
url     = "https://guide.zender.example"
public  = true                # set false to broadcast unlisted

[server]
port        = 8047
public_url  = ""              # autodetected if blank; set if behind a relay/VPS
```

### 2.4 Scheduler Logic

The scheduler is a simple state machine that owns one piece of truth: **the queue**.

1. On tick (item ending soon, or block boundary approaching), resolve "what's next":
   - If a manual queue item exists → it wins.
   - Else if an interval rule fires → pick from rule folder.
   - Else → next item per the active schedule block's order (sequential cursor or shuffle bag).
2. Hand the resolved file path to the Channel Server's `enqueue` endpoint (§3.4).
3. Emit state to the UI over WebSocket: now playing, up next, time remaining.

Shuffle uses a "bag" (shuffle the folder, deal items out, reshuffle when empty) so you never get the same episode twice in a row — same trick Winamp used.

---

## 3. The Channel Server

The stream engine. A small Node service + ffmpeg, bundled inside the source client install (but runnable headless via CLI for VPS broadcasters).

### 3.1 How a folder becomes a TV channel

The core problem: play file after file as **one continuous stream** that never drops between items. Two-stage pipeline:

**Stage 1 — Normalize on ingest.** Mixed sources (different codecs, resolutions, audio layouts) break naive concatenation. When a file first enters the library, transcode it once to the channel profile and cache it:

```bash
ffmpeg -i input.avi \
  -c:v libx264 -preset veryfast -b:v 2500k \
  -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:a aac -b:a 128k -ar 44100 -ac 2 \
  -x264opts keyint=180:min-keyint=180:no-scenecut \
  cache/input.norm.ts
```

Normalized files share identical codec parameters and fixed GOPs, making them safely concat-able. Ingest happens in the background when files are added (the library shows a progress badge); CPU cost is paid once, not at broadcast time.

**Stage 2 — Concat + segment at broadcast time.** A long-running ffmpeg reads a growing concat list and emits HLS:

```bash
ffmpeg -re -f concat -safe 0 -i playlist.txt \
  -c copy \
  -f hls -hls_time 6 -hls_list_size 10 \
  -hls_flags delete_segments+append_list+omit_endlist \
  -hls_segment_filename 'public/seg_%05d.ts' \
  public/live.m3u8
```

- `-re` paces output at realtime (this is broadcasting, not file conversion).
- `-c copy` — no re-encoding at broadcast time, because Stage 1 already normalized. A Raspberry Pi can run a channel.
- `omit_endlist` keeps the playlist "live" forever.
- The scheduler appends lines to `playlist.txt`; ffmpeg's concat demuxer reads ahead, so as long as the next entry lands before the current file ends, transitions are gapless.

**Radio channels** are the same pipeline minus video: normalize to AAC `.ts`, concat, HLS audio playlist. Optional crossfade is applied at ingest time (trim/fade the cached files' tails) to keep the broadcast stage pure `-c copy`.

### 3.2 Serving the stream

A minimal HTTP server (Express/static) serves `public/`:

```
GET /live.m3u8        → the live playlist
GET /seg_00123.ts     → segments
GET /channel.json     → channel metadata + now-playing (for rich player UI)
GET /thumb.jpg        → periodic snapshot of the current frame (guide thumbnails)
```

CORS open (`Access-Control-Allow-Origin: *`) so the web client can play from any origin. The thumbnail is generated every 30s with a one-shot ffmpeg grab from the newest segment.

### 3.3 Viewer counting

HLS has no persistent connections, so count **unique IPs requesting segments in the last 30 seconds**. Good enough for a dopamine number in the transmitter bar; don't overthink it.

### 3.4 Local control API

The source client drives the channel server over localhost:

```
POST /control/enqueue      { "file": "cache/heman-s02e11.norm.ts" }
POST /control/skip         (truncate current item: restart concat from next entry)
POST /control/standby      (cut to standby loop)
GET  /control/state        { nowPlaying, queue, viewers, uptime, onAir }
WS   /control/events       (push state changes to the UI)
POST /control/onair        { "on": true }   → starts ffmpeg + directory registration
```

"Skip" is the one fiddly operation: the cleanest implementation kills the broadcast ffmpeg and restarts it instantly from the next playlist entry — viewers see ~1–2s of buffering, which is acceptable and honestly period-accurate.

---

## 4. The Directory Server

The channel guide. The smallest component, and the most important one — this is what turns scattered servers into a network. Node + Express + SQLite. One file of code, basically.

### 4.1 Data model

```sql
CREATE TABLE channels (
  id            TEXT PRIMARY KEY,   -- uuid issued at first registration
  secret        TEXT NOT NULL,      -- bearer token for heartbeats/updates
  name          TEXT NOT NULL,
  description   TEXT,
  genre         TEXT,
  type          TEXT CHECK(type IN ('tv','radio')),
  stream_url    TEXT NOT NULL,      -- public .m3u8 URL
  thumb_url     TEXT,
  now_playing   TEXT,
  viewers       INTEGER DEFAULT 0,
  last_seen     INTEGER NOT NULL,   -- unix time; expiry = last_seen + 90s
  created_at    INTEGER NOT NULL
);
```

### 4.2 API

```
POST /api/register
  body: { name, description, genre, type, stream_url, thumb_url }
  → { id, secret }
  The directory fetches stream_url once to verify it's a live, reachable
  HLS playlist before listing. Channels failing verification are rejected.

POST /api/heartbeat            (Authorization: Bearer <secret>)
  body: { id, now_playing, viewers }
  → 200. Sent every 30s by the channel server while ON AIR.

GET /api/channels?type=tv&genre=animation&sort=viewers
  → [ { id, name, description, genre, type, stream_url, thumb_url,
        now_playing, viewers } ]
  Only channels with last_seen within 90s. No heartbeat → you fall off
  the guide. Self-cleaning, exactly like the SHOUTcast directory.

DELETE /api/channels/:id       (Authorization: Bearer <secret>)
  → graceful sign-off when broadcaster clicks OFF AIR.
```

### 4.3 Policy hooks (build these in from day one)

- **Verification on register** (above) keeps dead links out of the guide.
- A `flagged` column + `POST /api/report` endpoint, even if moderation is manual at first.
- Rate-limit registration by IP.
- An admin endpoint to ban a channel id/IP. You are running a public directory; you will eventually need the ban hammer. SHOUTcast learned this the hard way.

---

## 5. The Audience Client

One codebase, two targets: a zero-install **web app** (the front door) and a **Tauri desktop app** (for the people who fall in love with it).

### 5.1 Stack

- Svelte (or plain JS) + **hls.js** for playback. On Safari/iOS/Tauri-on-macOS, use native HLS (`video.src = m3u8`) since WebKit supports it natively — feature-detect:

```js
const video = document.querySelector('video');
if (video.canPlayType('application/vnd.apple.mpegurl')) {
  video.src = channel.stream_url;            // native HLS (Safari/WebKit)
} else if (Hls.isSupported()) {
  const hls = new Hls();
  hls.loadSource(channel.stream_url);
  hls.attachMedia(video);                    // everywhere else
}
```

- Tauri wraps the same build. Desktop-only features are feature-flagged behind `window.__TAURI__` detection.

### 5.2 UI

Two views:

**The Guide.** A dense channel grid — thumbnail (the channel server's `thumb.jpg`), name, genre, now-playing, viewer count. Filter tabs: TV / Radio / genre. Sort by viewers or newest. This should feel like flipping open TV Guide, not browsing a SaaS dashboard.

**The Set.** Click a channel → full player. Channel info rail, now-playing, viewer count, and — crucially — **channel up/down buttons** that move through the guide list in order. Channel surfing is the whole point; make ⬆/⬇ keys work.

There is deliberately **no seek bar**. It's live TV. You tune in to whatever's on. This single constraint is what makes it feel like broadcasting instead of a video site.

### 5.3 Desktop-only features (Tauri)

- Compact **mini-player mode** (always-on-top, very Winamp).
- System tray with now-playing; media keys.
- Notifications when a favorited channel comes ON AIR (poll the directory in the background).
- Local favorites and, eventually, skins.

Tauri build notes: `npm create tauri-app`, point it at the web build output, `tauri build` produces ~10MB installers for macOS/Windows/Linux. Mac signing/notarization needed for distribution beyond "right-click → Open" (Apple Developer ID, $99/yr — defer until people actually want it).

---

## 6. The Publishing Workflow

The whole broadcaster story, start to finish. This is the experience to obsess over — if this takes more than ten minutes, the network never grows.

1. **Install** the Zender Broadcaster app (source client + channel server in one installer).
2. **Create a channel:** name, description, genre, TV or radio. This writes `channel.toml`.
3. **Add media:** drag folders into the library. Ingest normalizes files in the background; badges show progress. (First batch takes a while — say so in the UI.)
4. **Pick a mode:** Sequential / Shuffle for "just play my stuff," or open the Scheduler for dayparts and station-ID rules.
5. **Connectivity check:** the app tests whether your stream port is reachable from outside (asks the directory server to fetch a test URL). If not, it walks you through port forwarding — or offers relay mode (§7.2).
6. **Hit ON AIR.** ffmpeg spins up, the channel registers with the directory, heartbeats begin, and within 30 seconds your channel is in the guide.
7. **Close the laptop?** Channel goes off air and drops from the guide in 90s. Want 24/7? See VPS deployment (§7.3). Honest framing: a channel is *on* when its broadcaster machine is on — also period-accurate.

---

## 7. Deployment Notes

### 7.1 Bandwidth reality check

Every viewer streams directly from the broadcaster. At 2.5 Mbps video:

| Upload speed | Max comfortable viewers |
|---|---|
| 10 Mbps (typical home) | ~3 |
| 35 Mbps | ~12 |
| 1 Gbps fiber / VPS | 300+ |

Radio at 128 kbps: ~70 listeners even on modest home upload. This is why SHOUTcast was radio-first — same physics, twenty years later. Surface a "max viewers" estimate in the source client based on a speed test.

### 7.2 Relay mode (the home-broadcaster escape hatch)

For broadcasters who can't port-forward or lack upload bandwidth: the channel server pushes its HLS output to a relay you operate (simple: HTTP PUT segments to an nginx/Caddy box, or rsync-over-ssh them), and the relay's URL is what gets registered in the directory. One $5–10 VPS relay can front many low-traffic channels. This is also your future scaling story — relays are just dumb HTTP file servers.

### 7.3 24/7 channels on a VPS

The channel server runs headless: `zender-server --config channel.toml` under systemd. The source client can connect to it remotely (point the control API at the VPS over an SSH tunnel or token-authed HTTPS) to manage the queue from your desk. Cheapest viable: a $5 VPS runs one `-c copy` channel without breaking a sweat, since broadcast-time CPU is near zero — ingest/normalization is the only heavy step, and you can do that locally and rsync the cache up.

### 7.4 Directory server hosting

Tiny: Node + SQLite handles thousands of channels on the smallest VPS tier. Put Caddy in front for automatic HTTPS. Back up the SQLite file; it's the only state in the whole network.

### 7.5 The legal paragraph

The original SHOUTcast TV scene was a copyright minefield, and that's part of why it died. Zender the *software* is content-neutral, but Zender the *directory* is yours: a takedown policy, a DMCA contact, and the ban tooling from §4.3 are not optional if the guide is public. Steer the launch culture toward original content, public domain material, licensed indie stuff, and personal radio — the tooling is identical, the liability is not.

---

## 8. Roadmap Ideas

- **Live input:** let the source client accept an RTMP push or screen/mic capture as an interruption source ("we now go live…"), falling back to the schedule after.
- **EPG:** the scheduler already knows the future — publish "up next / tonight" to the directory so the guide shows actual TV listings.
- **Skins:** both clients, CSS-based. The community will make better ones than you will.
- **Federation:** multiple directory servers that peer-exchange channel lists, so no single guide is a point of failure.
- **NSV easter egg:** an optional legacy output so a real Winamp 5 can tune in to a Zender channel. Zero practical value, maximum soul.
