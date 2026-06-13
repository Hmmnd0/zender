<script>
  let { state, onToggleOnAir, onStopServer, channelName, connected = false } = $props();
  import { formatUptime } from './channel-server.js';
</script>

<div class="transmitter" class:on-air={state.onAir}>
  <button
    class="on-air-btn"
    class:active={state.onAir}
    onclick={onToggleOnAir}
    disabled={!connected && !state.onAir}
    title={!connected && !state.onAir ? 'Create a channel first' : state.onAir ? 'Click to go OFF AIR' : 'Click to go ON AIR'}
  >
    <span class="led" class:lit={state.onAir}></span>
    {state.onAir ? '⦿ ON AIR' : '○ OFF AIR'}
  </button>

  <span class="channel-name">{channelName ?? 'Unnamed Channel'}</span>

  {#if state.onAir}
    <span class="viewers">👁 {state.viewers ?? 0}</span>
    <span class="uptime">⏱ {formatUptime(state.uptime ?? 0)}</span>
    <span class="mode-badge mode-{state.mode ?? 'direct'}">
      {state.mode === 'relay' ? '🔒 RELAY' : state.mode === 'tunnel' ? '🌐 TUNNEL' : '⚡ DIRECT'}
    </span>
  {/if}

  {#if connected}
    <button class="stop-btn" onclick={onStopServer} title="Stop channel server">■ STOP</button>
  {/if}
</div>

<style>
  .transmitter {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 0.75rem;
    background: #111;
    border-bottom: 2px solid #222;
    font-family: monospace;
    font-size: 0.85rem;
    color: #aaa;
  }

  .transmitter.on-air {
    border-bottom-color: #c00;
    background: #150000;
  }

  .on-air-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: #1a1a1a;
    border: 1px solid #333;
    color: #aaa;
    padding: 0.3rem 0.75rem;
    cursor: pointer;
    font-family: monospace;
    font-size: 0.85rem;
    font-weight: bold;
    letter-spacing: 0.05em;
  }

  .on-air-btn.active {
    border-color: #c00;
    color: #f44;
  }
  .on-air-btn:disabled { opacity: 0.35; cursor: not-allowed; }

  .led {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #333;
  }

  .led.lit {
    background: #f00;
    box-shadow: 0 0 6px #f00;
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  .channel-name { font-weight: bold; color: #eee; }
  .viewers, .uptime { color: #777; }

  .mode-badge {
    font-size: 0.75rem;
    padding: 0.1rem 0.4rem;
    border: 1px solid #333;
  }
  .mode-relay { color: #4af; border-color: #4af4; }
  .mode-direct { color: #fa4; border-color: #fa44; }
  .mode-tunnel { color: #4f4; border-color: #4f44; }

  .stop-btn {
    margin-left: auto;
    background: none;
    border: 1px solid #4a2222;
    color: #844;
    padding: 0.2rem 0.6rem;
    cursor: pointer;
    font-family: monospace;
    font-size: 0.75rem;
    letter-spacing: 0.05em;
    transition: border-color 0.15s, color 0.15s;
  }
  .stop-btn:hover { border-color: #c00; color: #f44; }
</style>
