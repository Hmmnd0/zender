<script>
  import { onMount } from 'svelte';

  let { channelId, directoryUrl = '/api' } = $props();

  let epg = $state(null);
  let loading = $state(false);
  let error = $state(null);

  async function load() {
    if (!channelId) return;
    loading = true;
    error = null;
    try {
      const res = await fetch(`${directoryUrl}/channels/${channelId}/epg`);
      if (!res.ok) throw new Error('No EPG available');
      epg = await res.json();
    } catch (e) {
      error = e.message;
      epg = null;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (channelId) load();
  });

  function fmtDuration(secs) {
    if (!secs) return '';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }
</script>

{#if loading}
  <div class="epg-loading">Loading schedule…</div>
{:else if epg && epg.upcoming?.length}
  <div class="epg">
    <div class="epg-title">UP NEXT</div>
    {#each epg.upcoming as item, i}
      <div class="epg-row" class:now={i === 0}>
        <span class="epg-bullet">{i === 0 ? '▶' : String(i + 1).padStart(2, ' ')}</span>
        <span class="epg-name">{item.title}</span>
        {#if item.duration}
          <span class="epg-dur">{fmtDuration(item.duration)}</span>
        {/if}
      </div>
    {/each}
  </div>
{:else if error}
  <div class="epg-empty">No schedule available</div>
{/if}

<style>
  .epg { font-family: monospace; font-size: 0.75rem; }
  .epg-loading, .epg-empty { font-family: monospace; font-size: 0.72rem; color: #444; padding: 0.3rem 0; }
  .epg-title { color: #555; font-size: 0.68rem; letter-spacing: 0.08em; padding-bottom: 0.3rem; }

  .epg-row {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    padding: 0.15rem 0;
    border-bottom: 1px solid #0d0d0d;
    color: #777;
  }

  .epg-row.now { color: #bbb; }

  .epg-bullet { color: #4a9; flex-shrink: 0; width: 1.2em; text-align: right; }
  .epg-row:not(.now) .epg-bullet { color: #333; }

  .epg-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .epg-dur { flex-shrink: 0; color: #444; font-size: 0.7rem; }
</style>
