<script>
  import { onMount, onDestroy } from 'svelte';

  let { channel, onRetry } = $props();

  let retryIn = $state(15);
  let interval;

  onMount(() => {
    interval = setInterval(() => {
      retryIn = retryIn - 1;
      if (retryIn <= 0) {
        retryIn = 15;
        onRetry?.();
      }
    }, 1000);
  });

  onDestroy(() => clearInterval(interval));
</script>

<div class="standby">
  <div class="bars">
    <div class="bar" style="background:#c0c0c0"></div>
    <div class="bar" style="background:#c0c000"></div>
    <div class="bar" style="background:#00c0c0"></div>
    <div class="bar" style="background:#00c000"></div>
    <div class="bar" style="background:#c000c0"></div>
    <div class="bar" style="background:#c00000"></div>
    <div class="bar" style="background:#0000c0"></div>
  </div>

  <div class="pluge">
    <div class="pluge-seg" style="background:#0000c0"></div>
    <div class="pluge-seg" style="background:#101010"></div>
    <div class="pluge-seg" style="background:#c000c0"></div>
    <div class="pluge-seg" style="background:#101010"></div>
    <div class="pluge-seg pluge-wide" style="background:#000"></div>
    <div class="pluge-seg" style="background:#080808"></div>
    <div class="pluge-seg" style="background:#111"></div>
    <div class="pluge-seg" style="background:#1e1e1e"></div>
  </div>

  <div class="info">
    <div class="channel-name">{channel?.name ?? 'Channel'}</div>
    <div class="off-air">OFF AIR</div>
    <div class="retry">retrying in {retryIn}s — <button onclick={() => { retryIn = 15; onRetry?.(); }}>retry now</button></div>
  </div>
</div>

<style>
  .standby {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: #000;
    font-family: monospace;
    position: relative;
  }

  .bars {
    flex: 7;
    display: flex;
  }

  .bar {
    flex: 1;
  }

  .pluge {
    flex: 1;
    display: flex;
  }

  .pluge-seg {
    flex: 1;
  }

  .pluge-wide {
    flex: 3;
  }

  .info {
    position: absolute;
    bottom: 20%;
    left: 50%;
    transform: translateX(-50%);
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    background: rgba(0, 0, 0, 0.65);
    padding: 1rem 2rem;
    border: 1px solid #333;
  }

  .channel-name {
    font-size: 1.1rem;
    font-weight: bold;
    color: #eee;
    white-space: nowrap;
  }

  .off-air {
    font-size: 0.75rem;
    letter-spacing: 0.2em;
    color: #c00;
    animation: blink 1.2s step-end infinite;
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }

  .retry {
    font-size: 0.7rem;
    color: #555;
  }

  .retry button {
    background: none;
    border: none;
    color: #666;
    font-family: monospace;
    font-size: 0.7rem;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
  }
  .retry button:hover { color: #aaa; }
</style>
