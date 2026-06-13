# Zender

Self-hosted internet TV and radio broadcasting. Point it at a folder of videos or music, hit **ON AIR**, and your channel appears in a public guide where anyone can tune in — from a browser or a desktop app.

Inspired by SHOUTcast and Winamp TV. No accounts, no platform, no algorithm.

<table>
  <tr>
    <td><img src="docs/viewer-guide.png" alt="Viewer — channel guide" /></td>
    <td><img src="docs/viewer-player.png" alt="Viewer — watching a channel" /></td>
    <td><img src="docs/broadcaster.png" alt="Broadcaster — on air" /></td>
  </tr>
  <tr>
    <td align="center"><em>Channel guide</em></td>
    <td align="center"><em>Watching live</em></td>
    <td align="center"><em>Broadcasting</em></td>
  </tr>
</table>

---

## How it works

```
 YOUR MACHINE                        ZENDER                    AUDIENCE
┌───────────────────────┐       ┌──────────────────┐     ┌──────────────────┐
│  Broadcaster App      │       │ Channel Directory │     │ Viewer App       │
│  (playlist, scheduler,│─reg──▶│ (channel guide,  │◀────│ (guide + player) │
│   ON AIR button)      │       │  heartbeats)      │     └──────────────────┘
│          │            │       └──────────────────┘              │
│          ▼            │                                         │
│  Channel Server       │◀────────── HLS stream (.m3u8) ─────────┘
│  (ffmpeg + HTTP)      │
└───────────────────────┘
```

When you go ON AIR, the Broadcaster registers your channel with the Zender directory. Viewers open the Viewer app, see your channel in the guide, and stream directly from your machine. No middleman.

---

## Prerequisites

| Tool | Required for |
|---|---|
| **ffmpeg** | All media — normalize, segment, thumbnail |
| **Node.js 20+** | Headless channel server (VPS / 24-7 use) |
| **Rust + Cargo** | Building the desktop apps from source |

Install ffmpeg via your package manager (`brew install ffmpeg`, `apt install ffmpeg`, etc.). Rust via [rustup](https://rustup.rs).

---

## channel.toml Reference

Every channel is configured with a single TOML file. See `channel.example.toml` for a full example.

```toml
[channel]
name        = "Channel 47: Saturday Cartoons"
description = "80s cartoons, all day, forever."
genre       = "animation"
type        = "tv"       # "tv" or "radio"

[stream]
resolution      = "1280x720"
video_bitrate   = "2500k"
audio_bitrate   = "128k"
fps             = 30
segment_seconds = 6

[scheduler]
mode = "shuffle"         # "sequential" | "shuffle" | "schedule"

# Optional: time-based schedule blocks
[[scheduler.blocks]]
days   = ["mon","tue","wed","thu","fri"]
start  = "06:00"
folder = "/path/to/cartoons"
order  = "shuffle"

# Optional: insert a clip from a folder on a repeating interval
[[scheduler.rules]]
every_minutes = 60
folder        = "/path/to/station-ids"

[directory]
url    = "https://zender.tv"   # Zender channel directory
public = true                  # false = unlisted (stream still works, just hidden from guide)

[server]
port       = 8047
mode       = "relay"           # "relay" (IP private) or "direct" (lower latency)
relay_url  = ""                # relay ingest URL if using relay mode
public_url = ""                # leave blank for auto-detect
```

**Scheduler modes:**
- `sequential` — plays files in folder order, loops
- `shuffle` — Winamp-style bag shuffle (never repeats until the whole folder is exhausted)
- `schedule` — uses `[[scheduler.blocks]]` for daypart-based programming

---

## Stream pipeline

Two-stage architecture that keeps broadcast-time CPU near zero:

**Stage 1 — normalize on ingest** (happens once per file, cached):
```bash
ffmpeg -i input.avi \
  -c:v libx264 -preset veryfast -b:v 2500k \
  -vf "scale=1280:720,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -c:a aac -b:a 128k -ar 44100 -ac 2 \
  -x264opts keyint=180:min-keyint=180:no-scenecut \
  cache/input.norm.ts
```

**Stage 2 — concat + segment at broadcast time** (`-c copy`, no re-encoding):
```bash
ffmpeg -re -f concat -safe 0 -i playlist.txt \
  -c copy \
  -f hls -hls_time 6 -hls_list_size 10 \
  -hls_flags delete_segments+append_list+omit_endlist \
  -hls_segment_filename 'public/seg_%05d.ts' \
  public/live.m3u8
```

A Raspberry Pi can run a channel. Normalization is the expensive step; it happens in the background before files ever reach the queue.

---

## Relay mode

For broadcasters who can't port-forward or want to keep their home IP private: the channel server pushes HLS segments to a relay server, which serves them to viewers.

Set in `channel.toml`:
```toml
[server]
mode      = "relay"
relay_url = "https://your-relay.example.com/ingest/<channel-id>/"
```

The relay is a plain HTTP server that accepts PUT requests and serves files statically (nginx or Caddy with a few config lines).

---

## Bandwidth

Every viewer streams directly from your machine (or relay). At the default 2.5 Mbps profile:

| Upload | Comfortable viewers |
|---|---|
| 10 Mbps typical home | ~3 |
| 35 Mbps | ~12 |
| 1 Gbps VPS | 300+ |

Radio at 128 kbps handles ~70 listeners on a modest home connection. Run the channel server on a VPS for serious viewer counts.

---

## Releases

Pre-built installers for macOS (Apple Silicon), Linux, and Windows are published to [GitHub Releases](https://github.com/Hmmnd0/zender/releases) when a version tag is pushed:

```bash
git tag v0.2.0
git push --tags
```

GitHub Actions builds all three platforms in parallel. Each release includes:

- **Zender** (viewer) — `.dmg` for macOS, `.AppImage` + `.deb` for Linux, `.exe` + `.msi` for Windows
- **Zender Broadcaster** — same platforms, channel server bundled inside

---

## Building from source

You need: **ffmpeg**, **Node 20+**, **Rust** (via [rustup](https://rustup.rs)), and your platform's native build tools.

### macOS

```bash
xcode-select --install
brew install ffmpeg

git clone https://github.com/Hmmnd0/zender.git
cd zender
npm install

# Viewer
cd packages/viewer
npm run tauri build
# → src-tauri/target/release/bundle/dmg/Zender_*.dmg

# Broadcaster (sidecar is built automatically as part of npm run build)
cd ../broadcaster
npm run tauri build
# → src-tauri/target/release/bundle/dmg/Zender\ Broadcaster_*.dmg
```

macOS will block unsigned apps with "unidentified developer." Right-click → Open to bypass, or:
```bash
xattr -dr com.apple.quarantine /Applications/Zender.app
```

### Linux

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf ffmpeg

git clone https://github.com/Hmmnd0/zender.git
cd zender && npm install

cd packages/viewer && npm run tauri build
cd ../broadcaster && npm run tauri build
```

### Windows

Install [Node](https://nodejs.org), [Rust](https://rustup.rs), [ffmpeg](https://ffmpeg.org/download.html) (add to PATH), and the [WebView2 runtime](https://developer.microsoft.com/microsoft-edge/webview2/).

```powershell
git clone https://github.com/Hmmnd0/zender.git
cd zender
npm install

cd packages\viewer
npm run tauri build

cd ..\broadcaster
npm run tauri build
```

---

## Headless / 24-7 Channels

The Broadcaster app manages the channel server automatically, but you can also run it headless on a VPS so your channel stays on air without your home machine being on.

```bash
cd packages/channel-server
npm install
node src/index.js /path/to/channel.toml
```

Working files (HLS segments, cache, playlist) are written to `~/Movies/Zender/<channel-name>/` on macOS and `~/Videos/Zender/<channel-name>/` on Windows/Linux.

**Keeping it running with systemd:**

```ini
# /etc/systemd/system/zender-channel.service
[Unit]
Description=Zender Channel Server
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/zender/packages/channel-server/src/index.js /opt/zender/channel.toml
WorkingDirectory=/opt/zender
Restart=on-failure
User=zender
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now zender-channel
```

---

## Development

From the repo root:

```bash
npm install

# Terminal 1 — viewer dev server
npm run viewer

# Terminal 2 — broadcaster app (launches channel server automatically in dev)
cd packages/broadcaster && npm run tauri dev
```

---

## Legal

Zender is content-neutral software. You are responsible for ensuring you have the rights to broadcast any content you put on air.

---

See `ZENDER.md` for the full architecture deep-dive, design decisions, and roadmap.
