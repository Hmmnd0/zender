<script>
  import { onMount, onDestroy } from 'svelte';
  import Hls from 'hls.js';

  // Mini-player communicates with the main window via Tauri events.
  // Main window emits 'channel-change' { channel, channelList }
  // Mini-player emits 'miniplayer-up' / 'miniplayer-down' / 'miniplayer-close'

  let channel = $state(null);
  let channelList = $state([]);
  let videoEl = $state(null);
  let hls = null;
  let unlisten = null;

  onMount(async () => {
    const { listen, emit } = await import('@tauri-apps/api/event');
    const { getCurrentWindow } = await import('@tauri-apps/api/window');

    unlisten = await listen('channel-change', (ev) => {
      channel = ev.payload.channel;
      channelList = ev.payload.channelList ?? [];
      if (channel) attachStream(channel.stream_url);
    });

    // Tell the main window we're ready
    emit('miniplayer-ready');

    // Media key support via keyboard
    document.addEventListener('keydown', handleKey);
  });

  onDestroy(() => {
    unlisten?.();
    hls?.destroy();
    document.removeEventListener('keydown', handleKey);
  });

  function attachStream(url) {
    hls?.destroy();
    hls = null;
    if (!videoEl) return;
    if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      videoEl.src = url;
    } else if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true });
      hls.loadSource(url);
      hls.attachMedia(videoEl);
    }
  }

  async function emit(name, payload) {
    const { emit: tauriEmit } = await import('@tauri-apps/api/event');
    tauriEmit(name, payload);
  }

  function handleKey(e) {
    if (e.key === 'ArrowUp') emit('miniplayer-up');
    else if (e.key === 'ArrowDown') emit('miniplayer-down');
    else if (e.key === 'Escape') emit('miniplayer-close');
  }

  function basename(p) {
    if (!p) return '';
    return p.split('/').pop()?.replace(/\.\w{2,4}\.norm\.ts$/, '') ?? p;
  }
</script>

<div class="miniplayer">
  <!-- Drag region — the rest of the window is drag-only -->
  <div class="drag-region" data-tauri-drag-region>
    <div class="channel-name" data-tauri-drag-region>
      {channel?.name ?? 'Zender'}
    </div>
    <div class="now-playing" data-tauri-drag-region>
      {#if channel?.now_playing}
        ▶ {basename(channel.now_playing)}
      {:else if channel}
        On Air
      {:else}
        No channel selected
      {/if}
    </div>
  </div>

  <div class="controls">
    <span class="viewers">{channel?.viewers != null ? `👁 ${channel.viewers}` : ''}</span>
    <button onclick={() => emit('miniplayer-up')} title="Channel Up">▲</button>
    <button onclick={() => emit('miniplayer-down')} title="Channel Down">▼</button>
    <button class="close-btn" onclick={() => emit('miniplayer-close')} title="Close">✕</button>
  </div>
</div>

<!-- Hidden video element for audio playback (radio channels or audio-only use) -->
{#if channel?.type === 'radio'}
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={videoEl} autoplay style="display:none"></video>
{/if}

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(body) {
    background: transparent;
    overflow: hidden;
    font-family: monospace;
    user-select: none;
  }

  .miniplayer {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    height: 72px;
    padding: 0 0.5rem;
    background: #0f0f0f;
    border: 1px solid #333;
    border-radius: 4px;
    color: #ddd;
  }

  .drag-region {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    cursor: move;
    min-width: 0;
    padding: 0.25rem 0.25rem 0.25rem 0.5rem;
  }

  .channel-name {
    font-size: 0.8rem;
    font-weight: bold;
    color: #eee;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .now-playing {
    font-size: 0.7rem;
    color: #888;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .viewers { font-size: 0.68rem; color: #555; margin-right: 0.25rem; }

  button {
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    color: #999;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 0.7rem;
    padding: 0;
    flex-shrink: 0;
  }

  button:hover { background: #222; color: #ddd; }
  .close-btn { color: #555; }
  .close-btn:hover { color: #f44; border-color: #f44; }
</style>
