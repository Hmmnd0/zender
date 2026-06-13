<script>
  import { onMount } from 'svelte';
  import TransmitterBar from './lib/TransmitterBar.svelte';
  import Library from './lib/Library.svelte';
  import Queue from './lib/Queue.svelte';
  import SchedulerPanel from './lib/SchedulerPanel.svelte';
  import ChannelWizard from './lib/ChannelWizard.svelte';
  import ConnectivityCheck from './lib/ConnectivityCheck.svelte';
  import { getState, setOnAir, subscribeToEvents, shutdownServer } from './lib/channel-server.js';

  const DEFAULT_STATE = { onAir: false, nowPlaying: null, upcomingQueue: [], viewers: 0, uptime: 0, mode: 'relay' };

  const isTauri = '__TAURI_INTERNALS__' in window || '__TAURI__' in window;

  let serverState = $state({ ...DEFAULT_STATE });
  let connected = $state(false);
  let normEvents = $state([]);

  let channelConfig = $state(null);  // parsed channel.toml config
  let channelName = $state('My Channel');

  let showWizard = $state(false);
  let showConnectivity = $state(false);
  let serverError = $state(null);

  let bumpers = $state([]);
  let serverPid = $state(null);
  let initialFolders = $state([]);

  onMount(async () => {
    // Try to connect to an already-running server first
    await tryConnect();

    // If nothing's running, relaunch the last-used channel automatically
    if (!connected && isTauri) {
      const lastPath = localStorage.getItem('zender_last_toml');
      if (lastPath) await loadChannelFromToml(lastPath).catch(() => {});
    }

    const unsub = subscribeToEvents((msg) => {
      if (msg.type === 'state') {
        serverState = { ...DEFAULT_STATE, ...msg };
        connected = true;
        serverError = null;
      } else if (msg.type?.startsWith('norm_')) {
        normEvents = [...normEvents.slice(-50), msg];
      }
    });


    return unsub;
  });

  async function tryConnect() {
    try {
      serverState = await getState();
      connected = true;
    } catch {
      connected = false;
    }
  }

  async function launchServer(configPath) {
    if (!configPath) return;
    localStorage.setItem('zender_last_toml', configPath);
    // Kill any stale server that may be holding the port from a previous crash.
    await shutdownServer().catch(() => {});
    await new Promise(r => setTimeout(r, 600));
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const projectRoot = import.meta.env.VITE_PROJECT_ROOT;
      const nodeBin = import.meta.env.VITE_NODE_BIN;
      const serverScript = `${projectRoot}/packages/channel-server/src/index.js`;
      const configDir = configPath.substring(0, configPath.lastIndexOf('/')) || projectRoot;
      console.log('[broadcaster] launching', nodeBin, serverScript, configPath, 'cwd:', configDir);
      const pid = await invoke('launch_channel_server', {
        nodeBin, script: serverScript, config: configPath, cwd: configDir,
      });
      serverPid = pid;
      console.log('[broadcaster] channel server PID:', pid);
      await new Promise(r => setTimeout(r, 2500));
      await tryConnect();
    } catch (e) {
      serverError = `Could not launch: ${e.message}`;
    }
  }

  async function handleOnAirToggle() {
    serverError = null;
    if (serverState.onAir) {
      try {
        const st = await setOnAir(false);
        serverState = { ...DEFAULT_STATE, ...st };
      } catch (e) {
        serverError = e.message;
      }
    } else {
      try {
        const st = await setOnAir(true);
        serverState = { ...DEFAULT_STATE, ...st };
      } catch (e) {
        serverError = e.message;
      }
    }
  }

  async function handleConnectivityPass() {
    showConnectivity = false;
    try {
      await setOnAir(true);
    } catch (e) {
      serverError = `Could not go on air: ${e.message}`;
    }
  }

  function handleUseRelay() {
    showConnectivity = false;
    // In a full impl, update channel.toml mode=relay here
    // For now, proceed — channel server will use its existing config
    handleConnectivityPass();
  }

  async function handleWizardDone({ path, folders }) {
    showWizard = false;
    if (folders?.length) initialFolders = folders;
    if (path) await launchServer(path);
  }

  async function openExistingChannel() {
    if (isTauri) {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const file = await open({ filters: [{ name: 'Channel Config', extensions: ['toml'] }], multiple: false });
      if (!file) return;
      await loadChannelFromToml(file);
    } else {
      const path = prompt('Enter path to channel.toml:');
      if (path) await loadChannelFromToml(path);
    }
  }

  async function loadChannelFromToml(path) {
    // Extract name and folder paths from the toml before launching.
    if (isTauri) {
      try {
        const { readTextFile } = await import('@tauri-apps/plugin-fs');
        const toml = await readTextFile(path);
        const nameMatch = toml.match(/^name\s*=\s*"([^"]+)"/m);
        if (nameMatch) channelName = nameMatch[1];
        const folders = [...toml.matchAll(/^folder\s*=\s*"([^"]+)"/gm)].map(m => m[1]);
        if (folders.length) initialFolders = folders;
      } catch (e) {
        console.error('[broadcaster] could not read toml:', e);
      }
    }
    await launchServer(path);
  }

  async function handleStopServer() {
    try {
      // Ask the server to shut itself down cleanly (works regardless of how it was started)
      await shutdownServer().catch(() => {});
      // Fallback: kill by PID if we launched it ourselves via Tauri
      if (isTauri && serverPid) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('kill_channel_server', { pid: serverPid }).catch(() => {});
      }
    } finally {
      serverPid = null;
      connected = false;
      serverState = { ...DEFAULT_STATE };
    }
  }

  function handleSchedulerSave(updatedConfig) {
    channelConfig = updatedConfig;
    // In a full impl, write back to channel.toml via Tauri fs
  }
</script>

<div class="app">
  {#if showWizard}
    <ChannelWizard onDone={handleWizardDone} onCancel={() => { showWizard = false; }} />
  {/if}

  {#if showConnectivity}
    <ConnectivityCheck
      mode={serverState.mode}
      onPass={handleConnectivityPass}
      onUseRelay={handleUseRelay}
      onCancel={() => { showConnectivity = false; }}
    />
  {/if}

  <TransmitterBar
    state={serverState}
    {channelName}
    {connected}
    onToggleOnAir={handleOnAirToggle}
    onStopServer={handleStopServer}
  />

  {#if !connected}
    <div class="no-server">
      <div class="no-server-msg">
        Channel server not running.
      </div>
      <div class="no-server-actions">
        <button class="btn-primary" onclick={() => { showWizard = true; }}>
          + Create New Channel
        </button>
        <button class="btn-secondary" onclick={openExistingChannel}>
          ▶ Open Existing Channel
        </button>
        {#if !isTauri}
          <div class="hint">
            Or start the server manually:<br />
            <code>node packages/channel-server/src/index.js channel.toml</code>
          </div>
        {/if}
        <button class="btn-ghost" onclick={tryConnect}>↻ Retry Connection</button>
      </div>
      {#if serverError}
        <div class="server-error">{serverError}</div>
      {/if}
    </div>
  {:else}
    <div class="workspace">
      <aside class="pane library-pane">
        <Library {normEvents} {connected} {initialFolders} onBumpersChange={(list) => { bumpers = list; }} />
      </aside>

      <main class="pane queue-pane">
        <Queue state={serverState} />
      </main>

      <aside class="pane scheduler-pane">
        <SchedulerPanel config={channelConfig} onSave={handleSchedulerSave} {bumpers} {connected} />
      </aside>
    </div>
  {/if}
</div>

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(body) { background: #0a0a0a; color: #e0e0e0; overflow: hidden; }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-family: monospace;
  }

  .no-server {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.25rem;
    color: #555;
  }

  .no-server-msg { font-size: 0.9rem; }

  .no-server-actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
  }

  .hint {
    font-size: 0.8rem;
    color: #444;
    text-align: center;
    line-height: 1.6;
  }

  code {
    background: #111;
    border: 1px solid #222;
    padding: 0.2rem 0.5rem;
    color: #aaa;
    font-size: 0.82rem;
  }

  .server-error {
    color: #f44;
    font-size: 0.82rem;
    max-width: 400px;
    text-align: center;
  }

  .workspace {
    flex: 1;
    display: grid;
    grid-template-columns: 240px 1fr 220px;
    overflow: hidden;
    border-top: 1px solid #1a1a1a;
  }

  .pane {
    overflow-y: auto;
    border-right: 1px solid #1a1a1a;
  }

  .scheduler-pane { border-right: none; }

  .btn-primary {
    background: #1a2a1a;
    border: 1px solid #4a9;
    color: #4f4;
    padding: 0.5rem 1.25rem;
    cursor: pointer;
    font-family: monospace;
    font-size: 0.9rem;
  }
  .btn-primary:hover { background: #1e341e; }

  .btn-secondary {
    background: #1a1a2a;
    border: 1px solid #446;
    color: #88b;
    padding: 0.5rem 1.25rem;
    cursor: pointer;
    font-family: monospace;
    font-size: 0.9rem;
  }
  .btn-secondary:hover { background: #1e1e34; color: #aac; }

  .btn-ghost {
    background: none;
    border: 1px solid #333;
    color: #666;
    padding: 0.4rem 1rem;
    cursor: pointer;
    font-family: monospace;
    font-size: 0.85rem;
  }
  .btn-ghost:hover { border-color: #555; color: #aaa; }
</style>
