<script>
  import { onMount } from 'svelte';
  import { getFavorites, toggleFavorite } from './favorites.js';
  import { isTauri } from './desktop.js';

  let { channels = [], onTune } = $props();

  let filter = $state('all');
  let sort = $state('viewers');
  let favoriteIds = $state(new Set());

  onMount(async () => {
    const favs = await getFavorites();
    favoriteIds = new Set(favs.map(f => f.id));
  });

  async function handleStar(e, ch) {
    e.stopPropagation();
    const next = await toggleFavorite(ch);
    favoriteIds = new Set(next.map(f => f.id));
  }

  const genres = $derived([...new Set(channels.map(c => c.genre).filter(Boolean))]);

  const filtered = $derived(
    channels
      .filter(c => {
        if (filter === 'favorites') return favoriteIds.has(c.id);
        if (filter === 'tv') return c.type === 'tv';
        if (filter === 'radio') return c.type === 'radio';
        if (filter !== 'all') return c.genre === filter;
        return true;
      })
      .sort((a, b) => sort === 'viewers' ? b.viewers - a.viewers : b.id.localeCompare(a.id))
  );
</script>

<div class="guide">
  <header class="guide-header">
    <h1>Zender</h1>
    <div class="filters">
      <button class:active={filter === 'all'} onclick={() => filter = 'all'}>All</button>
      <button class:active={filter === 'tv'} onclick={() => filter = 'tv'}>TV</button>
      <button class:active={filter === 'radio'} onclick={() => filter = 'radio'}>Radio</button>
      {#if favoriteIds.size > 0}
        <button class:active={filter === 'favorites'} onclick={() => filter = 'favorites'}>★ Favorites</button>
      {/if}
      {#each genres as g}
        <button class:active={filter === g} onclick={() => filter = g}>{g}</button>
      {/each}
    </div>
    <div class="sort">
      Sort:
      <button class:active={sort === 'viewers'} onclick={() => sort = 'viewers'}>viewers</button>
      <button class:active={sort === 'newest'} onclick={() => sort = 'newest'}>newest</button>
    </div>
  </header>

  {#if filtered.length === 0}
    <div class="empty">
      {filter === 'favorites'
        ? 'No favorites yet. Click ★ on a channel to add it.'
        : 'No channels on air right now.'}
    </div>
  {:else}
    <div class="grid">
      {#each filtered as ch (ch.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <div class="card" onclick={() => onTune(ch)} role="button" tabindex="0">
          <div class="thumb-wrap">
            {#if ch.thumb_url}
              <img src={ch.thumb_url} alt="" loading="lazy" />
            {:else}
              <div class="no-thumb">{ch.type === 'radio' ? 'RADIO' : 'TV'}</div>
            {/if}
            <span class="live-dot"></span>
            <button
              class="star-btn"
              class:starred={favoriteIds.has(ch.id)}
              onclick={(e) => handleStar(e, ch)}
              title={favoriteIds.has(ch.id) ? 'Remove from favorites' : 'Add to favorites'}
            >★</button>
          </div>
          <div class="card-info">
            <div class="card-name">{ch.name}</div>
            {#if ch.description}
              <div class="card-desc">{ch.description}</div>
            {/if}
            {#if ch.now_playing}
              <div class="card-np">▶ {ch.now_playing}</div>
            {/if}
            <div class="card-meta">
              {#if ch.genre}<span class="tag">{ch.genre}</span>{/if}
              {#if ch.masked}<span class="tag">RELAY</span>{/if}
              <span class="viewers">{ch.viewers ?? 0} watching</span>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .guide { min-height: 100vh; background: #0a0a0a; color: #e0e0e0; font-family: monospace; }

  .guide-header {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    padding: 0.75rem 1.25rem;
    background: #111;
    border-bottom: 2px solid #222;
    flex-wrap: wrap;
  }

  h1 { font-size: 1.2rem; font-weight: bold; letter-spacing: 0.05em; margin: 0; color: #fff; }

  .filters, .sort { display: flex; gap: 0.4rem; align-items: center; font-size: 0.8rem; }
  .sort { margin-left: auto; color: #888; }

  button {
    background: #1a1a1a;
    border: 1px solid #333;
    color: #bbb;
    padding: 0.25rem 0.6rem;
    cursor: pointer;
    font-family: monospace;
    font-size: 0.8rem;
  }
  button.active { background: #2a2a2a; border-color: #666; color: #fff; }
  button:hover { background: #222; }

  .empty { padding: 4rem 2rem; text-align: center; color: #555; font-size: 1rem; }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 1px;
    background: #1a1a1a;
    padding: 1px;
  }

  .card {
    display: flex;
    flex-direction: column;
    background: #0f0f0f;
    border: none;
    text-align: left;
    cursor: pointer;
    padding: 0;
    transition: background 0.1s;
    outline: none;
  }
  .card:hover { background: #161616; }

  .thumb-wrap {
    position: relative;
    aspect-ratio: 16/9;
    background: #111;
    overflow: hidden;
  }
  .thumb-wrap img { width: 100%; height: 100%; object-fit: cover; }
  .no-thumb {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    font-size: 2rem; color: #333;
  }

  .live-dot {
    position: absolute; top: 6px; right: 6px;
    width: 8px; height: 8px; border-radius: 50%;
    background: #f00; box-shadow: 0 0 4px #f00;
    animation: blink 2s infinite;
  }
  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

  .star-btn {
    position: absolute; bottom: 5px; right: 5px;
    background: rgba(0,0,0,0.6);
    border: 1px solid #333;
    color: #555;
    font-size: 0.85rem;
    padding: 0.1rem 0.3rem;
    line-height: 1;
    z-index: 1;
  }
  .star-btn.starred { color: #fa4; border-color: #fa4; }
  .star-btn:hover { color: #fa4; }

  .card-info {
    padding: 0.5rem 0.6rem;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .card-name { font-size: 0.85rem; font-weight: bold; color: #eee; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-desc { font-size: 0.72rem; color: #666; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-np { font-size: 0.72rem; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-meta { display: flex; gap: 0.5rem; align-items: center; font-size: 0.7rem; color: #666; margin-top: auto; }
  .tag { background: #1e1e1e; border: 1px solid #333; padding: 0 0.3rem; color: #888; }
</style>
