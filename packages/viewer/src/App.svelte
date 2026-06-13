<script>
  import { onMount } from 'svelte';
  import Guide from './lib/Guide.svelte';
  import Player from './lib/Player.svelte';
  import { fetchChannels } from './lib/api.js';
  import { watchFavorites, isTauri } from './lib/desktop.js';
  import { getFavorites } from './lib/favorites.js';

  let channels = $state([]);
  let activeIdx = $state(null);
  let loading = $state(true);
  let fetchError = $state(null);

  async function refresh() {
    try {
      channels = await fetchChannels();
      fetchError = null;
    } catch (e) {
      fetchError = e.message;
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    refresh();
    const timer = setInterval(refresh, 30_000);
    const stopWatcher = watchFavorites(() => channels, getFavorites);

    let unlistens = [];
    if (isTauri) {
      setupTauriEvents().then(fns => { unlistens = fns; });
    }

    return () => {
      clearInterval(timer);
      stopWatcher();
      unlistens.forEach(fn => fn());
    };
  });

  async function setupTauriEvents() {
    const { listen, emit } = await import('@tauri-apps/api/event');
    const fns = await Promise.all([
      listen('miniplayer-up',    () => channelUp()),
      listen('miniplayer-down',  () => channelDown()),
      listen('miniplayer-close', async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        invoke('toggle_miniplayer_cmd');
      }),
      listen('miniplayer-ready', () => emitChannelChange()),
    ]);
    return fns.map(f => () => f());
  }

  async function emitChannelChange() {
    if (!isTauri) return;
    const { emit } = await import('@tauri-apps/api/event');
    emit('channel-change', {
      channel: activeIdx !== null ? channels[activeIdx] : null,
      channelList: channels,
    });
  }

  function tune(ch) {
    activeIdx = channels.findIndex(c => c.id === ch.id);
    emitChannelChange();
  }

  function channelUp() {
    if (activeIdx === null) return;
    activeIdx = (activeIdx - 1 + channels.length) % channels.length;
    emitChannelChange();
  }

  function channelDown() {
    if (activeIdx === null) return;
    activeIdx = (activeIdx + 1) % channels.length;
    emitChannelChange();
  }
</script>

<svelte:head>
  <title>{activeIdx !== null ? channels[activeIdx]?.name + ' — Zender' : 'Zender'}</title>
</svelte:head>

{#if activeIdx !== null && channels[activeIdx]}
  <Player
    channel={channels[activeIdx]}
    onUp={channelUp}
    onDown={channelDown}
    onClose={() => { activeIdx = null; }}
  />
{:else}
  {#if loading}
    <div class="loading">Loading guide…</div>
  {:else if fetchError}
    <div class="loading error">Could not load guide: {fetchError}</div>
  {:else}
    <Guide {channels} onTune={tune} />
  {/if}
{/if}

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(body) { background: #0a0a0a; color: #e0e0e0; }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    font-family: monospace;
    color: #555;
    font-size: 1rem;
  }
  .error { color: #f44; }
</style>
