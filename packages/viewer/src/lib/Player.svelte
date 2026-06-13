<script>
  import Hls from 'hls.js';
  import { onDestroy, onMount } from 'svelte';
  import { toggleMiniPlayer, updateTrayTooltip, isTauri } from './desktop.js';
  import { toggleFavorite, isFavorite } from './favorites.js';
  import Epg from './Epg.svelte';
  import Standby from './Standby.svelte';

  let { channel, onUp, onDown, onClose } = $props();

  let videoEl = $state(null);
  let containerEl = $state(null);
  let hls = null;
  let error = $state(null);
  let starred = $state(false);
  let fullscreen = $state(false);
  let volume = $state(parseFloat(localStorage.getItem('zender_volume') ?? '1'));
  let retryTimer = null;

  onMount(async () => {
    starred = await isFavorite(channel?.id);
    if (channel) {
      updateTrayTooltip(`📺 ${channel.name}${channel.now_playing ? ' — ' + channel.now_playing : ''}`);
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  });

  onDestroy(() => {
    hls?.destroy();
    clearTimeout(retryTimer);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
  });

  function onFullscreenChange() {
    fullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function attach(url) {
    error = null;
    clearTimeout(retryTimer);
    if (hls) { hls.destroy(); hls = null; }
    if (!videoEl) return;

    if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      videoEl.src = url;
      videoEl.onerror = () => { error = 'standby'; };
    } else if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hls.loadSource(url);
      hls.attachMedia(videoEl);
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) error = 'standby';
      });
    } else {
      error = 'HLS not supported in this browser';
    }
  }

  function retryAttach() {
    if (channel) attach(channel.stream_url);
  }

  $effect(() => {
    if (channel && videoEl) attach(channel.stream_url);
  });

  $effect(() => {
    if (videoEl) videoEl.volume = volume;
  });

  $effect(() => {
    localStorage.setItem('zender_volume', String(volume));
  });

  onMount(() => {
    if (channel && videoEl) attach(channel.stream_url);
  });

  async function handleStar() {
    const next = await toggleFavorite(channel);
    starred = next.some(f => f.id === channel.id);
  }

  function toggleFullscreen() {
    const inFs = document.fullscreenElement || document.webkitFullscreenElement;
    if (!inFs) {
      const el = containerEl ?? document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
  }

  function handleKey(e) {
    if (e.key === 'ArrowUp') onUp?.();
    else if (e.key === 'ArrowDown') onDown?.();
    else if (e.key === 'Escape' && !document.fullscreenElement && !document.webkitFullscreenElement) onClose?.();
    else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    else if (e.key === 'ArrowLeft') volume = Math.max(0, volume - 0.05);
    else if (e.key === 'ArrowRight') volume = Math.min(1, volume + 0.05);
  }
</script>

<svelte:window onkeydown={handleKey} />

<div class="set" bind:this={containerEl}>
  <div class="screen">
    {#if error === 'standby'}
      <Standby {channel} onRetry={retryAttach} />
    {:else if error}
      <div class="error">{error}</div>
    {:else}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={videoEl} autoplay playsinline></video>
    {/if}
  </div>

  <div class="info-rail">
    <div class="left-controls">
      <button class="back" onclick={onClose}>◀ Guide</button>
      <button class="fs-btn" onclick={toggleFullscreen} title="Fullscreen (F)">{fullscreen ? 'EXIT FULL' : 'FULL'}</button>
    </div>

    <div class="channel-info">
      {#if channel.thumb_url}
        <!-- svelte-ignore a11y_missing_attribute -->
        <img class="thumb" src={channel.thumb_url} onerror={(e) => e.currentTarget.style.display='none'} alt="" />
      {/if}
      <div class="meta-block">
        <div class="name-row">
          <span class="name">{channel.name}</span>
          <button class="star-btn" class:starred onclick={handleStar} title={starred ? 'Remove favorite' : 'Add to favorites'}>★</button>
          {#if channel.masked}<span class="badge">RELAY</span>{/if}
          {#if channel.genre}<span class="genre">{channel.genre}</span>{/if}
          <span class="viewers">{channel.viewers ?? 0} watching</span>
        </div>
        {#if channel.description}
          <div class="description">{channel.description}</div>
        {:else if channel.now_playing}
          <div class="now-playing">▶ {channel.now_playing.split('/').pop()?.replace(/(\.\w{2,4})?\.norm\.ts$/, '').replace(/\.\w{2,4}$/, '') ?? channel.now_playing}</div>
        {/if}
        {#if channel.description && channel.now_playing}
          <div class="now-playing">▶ {channel.now_playing.split('/').pop()?.replace(/(\.\w{2,4})?\.norm\.ts$/, '').replace(/\.\w{2,4}$/, '') ?? channel.now_playing}</div>
        {/if}
      </div>
    </div>

    <div class="volume-control">
      <span class="vol-label">VOL</span>
      <input
        type="range"
        min="0" max="1" step="0.02"
        value={volume}
        oninput={(e) => { volume = parseFloat(e.currentTarget.value); }}
        title="Volume (← →)"
      />
      <span class="vol-pct">{Math.round(volume * 100)}</span>
    </div>

    <div class="surf">
      <button onclick={onUp} title="Channel Up (↑)">CH UP</button>
      <button onclick={onDown} title="Channel Down (↓)">CH DOWN</button>
      {#if isTauri}
        <button onclick={toggleMiniPlayer} title="Mini Player">MINI</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .set {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #000;
    color: #e0e0e0;
  }

  .screen {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
    position: relative;
  }

  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .error {
    color: #ff4444;
    font-family: monospace;
    font-size: 1.2rem;
    padding: 2rem;
    text-align: center;
  }

  /* fills the screen so Standby can stretch to 100% */
  .screen :global(.standby) { width: 100%; height: 100%; }

.info-rail {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0 1rem;
    height: 72px;
    flex-shrink: 0;
    background: #111;
    border-top: 2px solid #333;
    font-family: monospace;
    overflow: hidden;
  }

  .left-controls {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .back, .fs-btn {
    background: #222;
    border: 1px solid #444;
    color: #ccc;
    padding: 0.25rem 0.6rem;
    cursor: pointer;
    font-family: monospace;
    font-size: 0.75rem;
    white-space: nowrap;
  }
  .back:hover, .fs-btn:hover { background: #333; }

  .channel-info {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
  }

  .thumb {
    width: 56px;
    height: 42px;
    object-fit: cover;
    border: 1px solid #333;
    flex-shrink: 0;
  }

  .meta-block {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .name-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: nowrap;
    min-width: 0;
  }

  .name { font-weight: bold; font-size: 0.95rem; white-space: nowrap; }
  .description { font-size: 0.72rem; color: #666; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .now-playing { font-size: 0.78rem; color: #aaa; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .genre { font-size: 0.7rem; color: #555; white-space: nowrap; }
  .viewers { font-size: 0.72rem; color: #777; white-space: nowrap; }

  .badge {
    font-size: 0.68rem;
    padding: 0.1rem 0.3rem;
    border: 1px solid #4af4;
    color: #4af;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .star-btn {
    background: none;
    border: none;
    color: #444;
    cursor: pointer;
    font-size: 0.9rem;
    padding: 0;
    flex-shrink: 0;
  }
  .star-btn.starred { color: #fa4; }
  .star-btn:hover { color: #fa4; }

  .volume-control {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
  }

  .vol-label { font-size: 0.68rem; color: #555; letter-spacing: 0.05em; }
  .vol-pct { font-size: 0.68rem; color: #555; width: 2.5ch; text-align: right; }

  input[type="range"] {
    width: 80px;
    accent-color: #4a9;
    cursor: pointer;
  }

  .surf {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .surf button {
    background: #222;
    border: 1px solid #444;
    color: #ccc;
    padding: 0.25rem 0.6rem;
    cursor: pointer;
    font-family: monospace;
    font-size: 0.75rem;
  }
  .surf button:hover { background: #333; }
</style>
