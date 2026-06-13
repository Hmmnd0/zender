import { readFileSync } from 'fs';
import { parse } from 'toml';

export function loadConfig(path) {
  const raw = readFileSync(path, 'utf8');
  const cfg = parse(raw);

  return {
    channel: {
      name: cfg.channel?.name ?? 'My Channel',
      description: cfg.channel?.description ?? '',
      genre: cfg.channel?.genre ?? 'general',
      type: cfg.channel?.type ?? 'tv',
      logo: cfg.channel?.logo ?? null,
    },
    stream: {
      resolution: cfg.stream?.resolution ?? '1280x720',
      videoBitrate: cfg.stream?.video_bitrate ?? '2500k',
      audioBitrate: cfg.stream?.audio_bitrate ?? '128k',
      fps: cfg.stream?.fps ?? 30,
      segmentSeconds: cfg.stream?.segment_seconds ?? 6,
    },
    scheduler: {
      mode: cfg.scheduler?.mode ?? 'shuffle',
      blocks: cfg.scheduler?.blocks ?? [],
      rules: cfg.scheduler?.rules ?? [],
    },
    directory: {
      url: cfg.directory?.url ?? 'http://localhost:3001',
      public: cfg.directory?.public !== false,
    },
    server: {
      port: cfg.server?.port ?? 8047,
      publicUrl: cfg.server?.public_url ?? '',
      mode: cfg.server?.mode ?? 'relay',
      relayUrl: cfg.server?.relay_url ?? '',
    },
  };
}
