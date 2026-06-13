# Zender — Broadcaster Privacy & Origin Masking

Companion to `ZENDER.md`. Covers how to keep a broadcaster's IP address and origin server hidden from viewers, the directory, and the public internet.

---

## Table of Contents

1. [The Problem](#1-the-problem)
2. [Threat Model](#2-threat-model)
3. [Approach A: Operator Relay Mode (recommended default)](#3-approach-a-operator-relay-mode)
4. [Approach B: Tunnel Services](#4-approach-b-tunnel-services)
5. [Approach C: Personal VPS Reverse Tunnel](#5-approach-c-personal-vps-reverse-tunnel)
6. [Directory-Side Privacy Rules](#6-directory-side-privacy-rules)
7. [Source Client UX](#7-source-client-ux)
8. [Comparison Table](#8-comparison-table)
9. [What This Does NOT Protect Against](#9-what-this-does-not-protect-against)

---

## 1. The Problem

In the direct-broadcast architecture, viewers' players fetch `.m3u8` and `.ts` segments straight from the broadcaster's machine. Two consequences:

1. **Every viewer learns the broadcaster's IP address.** It's right there in the network tab. A home IP geolocates to roughly a city/neighborhood and is a stable target for DDoS, port scanning, and harassment. This is precisely why every commercial streaming platform sits between viewer and broadcaster.
2. **The directory publishes `stream_url` publicly.** Even people who never tune in can harvest broadcaster IPs from one API call to `/api/channels`.

The fix in all cases is the same shape: put a middlebox between the viewer and the origin, and make the broadcaster's connection to that middlebox **outbound-only** (which also eliminates port forwarding).

```
WITHOUT MASKING                          WITH MASKING
viewer ──────────▶ broadcaster IP        viewer ──▶ relay/edge ◀── outbound push ── broadcaster
        (IP exposed to everyone)                  (only the relay's IP is public)
```

---

## 2. Threat Model

What we're protecting, and from whom:

| Asset | Adversary | Mitigated by this doc? |
|---|---|---|
| Broadcaster's home IP | Viewers, directory scrapers | ✅ Yes — all three approaches |
| Broadcaster's home IP | The relay/tunnel operator | ⚠️ Partially — the middlebox always sees the origin. Choose who you trust (yourself in Approach C, the network operator in A, Cloudflare/Tailscale in B). |
| Broadcaster's identity | Legal process / subpoena | ❌ No — see §9 |
| Stream content privacy | Anyone | ❌ Out of scope — Zender streams are public by design |

---

## 3. Approach A: Operator Relay Mode

**The recommended default.** The network operator (the person running the directory) also runs one or more relay servers. Broadcasters push segments outbound to the relay; viewers only ever talk to the relay.

### 3.1 How it works

```
broadcaster (channel server)            relay (VPS)                 viewers
ffmpeg writes seg_00123.ts ──HTTP PUT──▶ nginx (WebDAV PUT) ──GET──▶ hls.js
                                         serves /ch/<id>/live.m3u8
```

The channel server gains a relay output mode: instead of (or in addition to) serving `public/` locally, it PUTs each finished segment and the updated playlist to the relay. HLS makes this trivial — it's just files.

### 3.2 Relay server setup (nginx)

A relay is a dumb authenticated file server. One $5–10 VPS can front many low-traffic channels.

```nginx
# /etc/nginx/conf.d/zender-relay.conf
server {
    listen 443 ssl;
    server_name relay1.zender.example;
    # (certbot/Caddy handles TLS)

    # Broadcasters PUT here (authenticated)
    location ~ ^/ingest/(?<chan>[a-f0-9-]+)/ {
        auth_request /auth;           # validates bearer token against directory
        dav_methods PUT DELETE;
        create_full_put_path on;
        client_max_body_size 20m;
        root /var/zender;
        # rewrites /ingest/<chan>/x.ts → /var/zender/ingest/<chan>/x.ts
    }

    # Viewers GET here (public, CORS open)
    location ~ ^/ch/(?<chan>[a-f0-9-]+)/ {
        alias /var/zender/ingest/$chan/;
        add_header Access-Control-Allow-Origin *;
        add_header Cache-Control "no-cache";
        types { application/vnd.apple.mpegurl m3u8; video/mp2t ts; }
    }

    location = /auth {
        internal;
        proxy_pass https://guide.zender.example/api/relay-auth;
        proxy_set_header X-Channel-Id $chan;
        proxy_set_header Authorization $http_authorization;
    }
}
```

The `auth_request` hook lets the directory issue and revoke relay credentials — a banned channel loses relay access in the same stroke.

### 3.3 Channel server changes

```
[server]
mode       = "relay"                       # "direct" | "relay"
relay_url  = "https://relay1.zender.example/ingest/<channel-id>/"
# public_url becomes the relay's /ch/ URL automatically
```

Implementation: after ffmpeg finishes each segment (watch the directory with chokidar, or use `-hls_segment_filename` plus a post-write hook), PUT it with the channel's bearer token, then PUT the refreshed `live.m3u8` *last* (playlist must never reference a segment that hasn't landed). Delete old segments with DELETE to match `delete_segments` behavior. Total added code: ~80 lines.

### 3.4 Properties

- Broadcaster IP visible to: **the relay only.**
- Port forwarding: **not needed** (outbound HTTPS only — works behind CGNAT, hotel Wi-Fi, anything).
- Bandwidth: broadcaster uploads the stream **once** regardless of viewer count; the relay pays the fan-out. This flips the §7.1 bandwidth table — a home connection can suddenly serve hundreds of viewers.
- Cost/trust: concentrated on the network operator. Relays are stateless and horizontally scalable (they're just file servers); add `relay2`, `relay3` as the network grows.

---

## 4. Approach B: Tunnel Services

Zero infrastructure for anyone. The broadcaster runs a tunnel client that opens an **outbound** connection to a provider's edge; the provider gives back a public HTTPS URL that proxies to the local channel server.

### 4.1 Cloudflare Tunnel

```bash
# one-time
cloudflared tunnel login
cloudflared tunnel create channel47
cloudflared tunnel route dns channel47 ch47.yourdomain.com

# config: ~/.cloudflared/config.yml
# tunnel: <tunnel-id>
# ingress:
#   - hostname: ch47.yourdomain.com
#     service: http://localhost:8047
#   - service: http_status:404

cloudflared tunnel run channel47
```

Register `https://ch47.yourdomain.com/live.m3u8` with the directory. Viewers see Cloudflare's edge IPs; the broadcaster's IP appears nowhere. The source client can automate all of this — bundle `cloudflared`, manage the tunnel lifecycle on ON AIR/OFF AIR, surface the URL.

**Caveats:** requires a domain on Cloudflare (or use ephemeral `trycloudflare.com` quick tunnels — no account, but URLs are random and rotate, so re-register on each ON AIR). Cloudflare's ToS around proxying video on free plans has historically been ambiguous; HLS over Tunnel is common in the self-hosting community, but a popular video channel on a free plan is operating at the provider's pleasure. Fine for radio and small TV channels; not a foundation for a big one.

### 4.2 Tailscale Funnel

```bash
tailscale funnel --bg --set-path / http://localhost:8047
```

Gives `https://<machine>.<tailnet>.ts.net/live.m3u8`. Simpler than Cloudflare, no domain needed, but Funnel bandwidth is modest and tailnet hostnames are clunky for a public guide. Good for personal/unlisted channels.

### 4.3 Properties

- Broadcaster IP visible to: **the tunnel provider only.**
- Cost: free tiers; zero servers for anyone to run.
- Risk: third-party ToS and free-tier limits. Treat as the easy on-ramp, with relay mode as the grown-up path.

---

## 5. Approach C: Personal VPS Reverse Tunnel

For self-reliant broadcasters: rent a $5 VPS, reverse-tunnel into it, let the VPS face the world. Same outbound-only property, but the broadcaster trusts only a box they control.

### 5.1 Plain SSH

```bash
# on the broadcaster machine — forwards VPS:8047 → localhost:8047, outbound only
ssh -N -R 127.0.0.1:8047:localhost:8047 zender@vps.example.com
```

With `autossh` for reconnection, plus nginx on the VPS proxying `https://ch.example.com → 127.0.0.1:8047`. Register the VPS URL with the directory.

A more robust variant: skip the live tunnel and **rsync/push segments to the VPS** (same pattern as relay mode §3.3, target is just your own box) — then a dropped home connection mid-segment doesn't stall viewers on a half-proxied request, and the VPS keeps serving the last good playlist.

### 5.2 Properties

- Broadcaster IP visible to: **their own VPS** (and their VPS provider).
- Cost: ~$5/mo per broadcaster; full control, no ToS surprises.
- Bonus: the same VPS can run the channel 24/7 headless (ZENDER.md §7.3), at which point the home IP isn't involved at all — the strongest privacy posture available.

---

## 6. Directory-Side Privacy Rules

Masking at the stream layer is undone if the directory leaks. Hard rules:

1. **Never expose registration IPs.** Log them server-side for abuse handling if you must, with a retention window (e.g. 14 days), but no API response, admin page screenshotted into Discord, or backup dump should ever surface them publicly.
2. **`stream_url` is the only address published**, and it should be the *masked* URL. The directory has no business knowing the true origin in relay/tunnel modes — and in relay mode it genuinely doesn't.
3. **Verification fetches respect the mask.** The registration-time HLS check (ZENDER.md §4.2) hits `stream_url` as given — it must not attempt origin discovery, follow redirects to private hosts, or store resolved IPs.
4. **No WHOIS-style history.** Don't keep or expose historical `stream_url` values after a channel updates them; a broadcaster moving from direct to relay mode shouldn't have their old direct URL lingering in an API.
5. **Heartbeats carry no network info.** `{ id, now_playing, viewers }` — nothing else. Viewer counts are computed broadcaster-side and self-reported precisely so the directory never needs viewer or origin network data.
6. Optional: a `masked: true/false` flag per channel so the guide can show a small shield badge — gentle social pressure toward the private default.

---

## 7. Source Client UX

Privacy that lives in a settings page nobody opens is privacy nobody has. Bake it into the ON AIR flow:

- **First ON AIR for a channel**, one screen, one choice:
  - 🔒 **Broadcast via relay (recommended)** — "Your IP address stays private. Stream is uploaded once to the network relay." *(preselected)*
  - ⚡ **Broadcast directly** — "Lower latency, no middleman — but every viewer can see your IP address, and you may need to configure port forwarding."
- If direct is chosen, show the IP that will be exposed (fetch from a what's-my-ip endpoint) so the choice is informed, not abstract.
- Tunnel and personal-VPS modes live in channel settings as "Advanced" options with the setup walkthroughs from §4–5; the client automates the Cloudflare quick-tunnel path entirely.
- The transmitter bar shows the active mode: `🔒 RELAY` / `⚡ DIRECT` / `🌐 TUNNEL`, always visible while ON AIR.

---

## 8. Comparison Table

| | A: Operator relay | B: Tunnel service | C: Personal VPS |
|---|---|---|---|
| Broadcaster IP hidden from viewers | ✅ | ✅ | ✅ |
| Hidden from directory | ✅ | ✅ | ✅ |
| Who sees the origin | Network operator | Cloudflare/Tailscale | Broadcaster's own VPS |
| Port forwarding needed | No | No | No |
| Broadcaster cost | Free | Free | ~$5/mo |
| Operator cost | Relay VPS(s) | Nothing | Nothing |
| Bandwidth fan-out paid by | Relay | Provider edge | The VPS |
| ToS / third-party risk | None | Real (free tiers) | None |
| Setup friction | One toggle | Low (automatable) | Medium (SSH literacy) |
| Best for | The default | Quick start, radio | Power users, 24/7 channels |

---

## 9. What This Does NOT Protect Against

Honesty section. Origin masking is harassment/DDoS protection, not anonymity:

- **The middlebox always knows.** Relay, Cloudflare, or your VPS provider sees the origin IP. Pick the trust model, don't pretend it away.
- **Legal process.** A subpoena to the relay operator or tunnel provider reveals the origin. Zender's masking is not a tool for broadcasting things that attract subpoenas — see the legal paragraph in ZENDER.md §7.5; the directory's takedown policy applies equally to masked channels.
- **Content-based identification.** A broadcaster who says their own name on stream has no network-layer solution.
- **Payment trails.** A personal VPS or domain registered with your real name is attributable regardless of tunneling.

The design goal is simple and worth stating in the guide's FAQ: *running a TV channel from your living room shouldn't mean publishing your living room's IP address.* That's the promise; the above is the fine print.
