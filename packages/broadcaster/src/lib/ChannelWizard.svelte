<script>
  import { onMount } from 'svelte';

  let { onDone, onCancel } = $props();

  const isTauri = '__TAURI_INTERNALS__' in window || '__TAURI__' in window;

  let step = $state(1);
  const TOTAL_STEPS = 4;

  // Step 1: Basic info
  let name = $state('');
  let description = $state('');
  let genre = $state('animation');
  let type = $state('tv');

  // Step 2: Media folders
  let folders = $state([]);

  // Step 3: Schedule mode
  let scheduleMode = $state('shuffle');

  // Step 4: Privacy + stream settings
  let privacyMode = $state('relay');
  let relayUrl = $state('');
  let resolution = $state('1280x720');
  let videoBitrate = $state('2500k');
  let audioBitrate = $state('128k');
  let directoryUrl = $state('https://zender-directory.fly.dev');
  let serverPort = $state(8047);

  let saving = $state(false);
  let saveError = $state(null);
  let folderError = $state(null);

  const GENRES = ['animation','comedy','drama','film','music','news','sports','technology','gaming','lifestyle','general'];
  const RESOLUTIONS = [
    { label: '720p (recommended)', value: '1280x720' },
    { label: '480p (bandwidth-friendly)', value: '854x480' },
    { label: '1080p (high quality)', value: '1920x1080' },
  ];

  async function addFolder() {
    folderError = null;
    if (isTauri) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const dir = await open({ directory: true, multiple: true });
        if (dir) {
          const dirs = Array.isArray(dir) ? dir : [dir];
          folders = [...new Set([...folders, ...dirs])];
        }
      } catch (e) {
        folderError = e?.message ?? String(e);
      }
    } else {
      const dir = window.prompt('Enter folder path:');
      if (dir && !folders.includes(dir)) folders = [...folders, dir];
    }
  }

  function removeFolder(f) {
    folders = folders.filter(x => x !== f);
  }

  function folderName(f) {
    return f.split('/').pop() || f;
  }

  async function save() {
    saving = true;
    saveError = null;
    try {
      const toml = buildToml();
      if (isTauri) {
        const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
        const { save: saveDialog } = await import('@tauri-apps/plugin-dialog');
        const path = await saveDialog({
          defaultPath: 'channel.toml',
          filters: [{ name: 'TOML', extensions: ['toml'] }],
        });
        if (!path) { saving = false; return; }
        await writeTextFile(path, toml);
        onDone({ path, toml, folders });
      } else {
        // Web fallback: download the file
        const blob = new Blob([toml], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'channel.toml';
        a.click();
        URL.revokeObjectURL(url);
        onDone({ toml });
      }
    } catch (e) {
      saveError = e.message;
    } finally {
      saving = false;
    }
  }

  function buildToml() {
    const lines = [
      `[channel]`,
      `name        = ${JSON.stringify(name)}`,
      `description = ${JSON.stringify(description)}`,
      `genre       = ${JSON.stringify(genre)}`,
      `type        = ${JSON.stringify(type)}`,
      ``,
      `[stream]`,
      `resolution      = ${JSON.stringify(resolution)}`,
      `video_bitrate   = ${JSON.stringify(videoBitrate)}`,
      `audio_bitrate   = ${JSON.stringify(audioBitrate)}`,
      `fps             = 30`,
      `segment_seconds = 6`,
      ``,
      `[scheduler]`,
      `mode = ${JSON.stringify(scheduleMode)}`,
    ];

    if (folders.length) {
      lines.push('');
      for (const f of folders) {
        lines.push(`[[scheduler.blocks]]`);
        lines.push(`days   = ["mon","tue","wed","thu","fri","sat","sun"]`);
        lines.push(`start  = "00:00"`);
        lines.push(`folder = ${JSON.stringify(f)}`);
        lines.push(`order  = ${JSON.stringify(scheduleMode === 'sequential' ? 'sequential' : 'shuffle')}`);
        lines.push('');
      }
    }

    lines.push(`[directory]`);
    lines.push(`url    = ${JSON.stringify(directoryUrl)}`);
    lines.push(`public = true`);
    lines.push(``);
    lines.push(`[server]`);
    lines.push(`port       = ${serverPort}`);
    lines.push(`mode       = ${JSON.stringify(privacyMode)}`);
    lines.push(`relay_url  = ${JSON.stringify(relayUrl)}`);
    lines.push(`public_url = ""`);

    return lines.join('\n') + '\n';
  }

  const canNext = $derived(
    step === 1 ? name.trim().length > 0 :
    step === 2 ? true :
    step === 3 ? true :
    true
  );
</script>

<div class="wizard-backdrop">
  <div class="wizard">
    <div class="wizard-header">
      <span>New Channel</span>
      <span class="steps">Step {step} of {TOTAL_STEPS}</span>
    </div>

    <div class="progress-bar">
      <div class="progress-fill" style="width: {(step / TOTAL_STEPS) * 100}%"></div>
    </div>

    <div class="wizard-body">

      {#if step === 1}
        <h2>Channel Basics</h2>
        <div class="field">
          <label>Channel name <span class="req">*</span></label>
          <input bind:value={name} placeholder="e.g. Channel 47: Saturday Cartoons" autofocus />
        </div>
        <div class="field">
          <label>Description</label>
          <textarea bind:value={description} rows="2" placeholder="80s cartoons, all day, forever."></textarea>
        </div>
        <div class="row">
          <div class="field">
            <label>Type</label>
            <div class="radio-group">
              <label class="radio" class:selected={type === 'tv'}>
                <input type="radio" bind:group={type} value="tv" /> 📺 TV
              </label>
              <label class="radio" class:selected={type === 'radio'}>
                <input type="radio" bind:group={type} value="radio" /> 🎵 Radio
              </label>
            </div>
          </div>
          <div class="field">
            <label>Genre</label>
            <select bind:value={genre}>
              {#each GENRES as g}
                <option value={g}>{g}</option>
              {/each}
            </select>
          </div>
        </div>

      {:else if step === 2}
        <h2>Media Folders</h2>
        <p class="hint">Point to folders containing your media. Files will be normalized in the background when you first add them.</p>
        <div class="folder-list">
          {#each folders as f}
            <div class="folder-row">
              <span class="folder-icon">📁</span>
              <span class="folder-name" title={f}>{folderName(f)}</span>
              <span class="folder-path">{f}</span>
              <button class="remove" onclick={() => removeFolder(f)}>✕</button>
            </div>
          {/each}
          {#if folders.length === 0}
            <div class="empty-folders">No folders added yet</div>
          {/if}
        </div>
        <button class="add-folder" onclick={addFolder}>+ Add Folder</button>
        {#if folderError}
          <div class="folder-err">Error: {folderError}</div>
        {/if}

      {:else if step === 3}
        <h2>Playback Mode</h2>
        <p class="hint">How should your channel decide what to play?</p>
        <div class="mode-options">
          <label class="mode-opt" class:selected={scheduleMode === 'shuffle'}>
            <input type="radio" bind:group={scheduleMode} value="shuffle" />
            <div>
              <strong>Shuffle</strong>
              <p>Randomly plays through your folders. Uses a bag shuffle so tracks don't repeat until all have played.</p>
            </div>
          </label>
          <label class="mode-opt" class:selected={scheduleMode === 'sequential'}>
            <input type="radio" bind:group={scheduleMode} value="sequential" />
            <div>
              <strong>Sequential</strong>
              <p>Plays files in order, looping back to the beginning when done.</p>
            </div>
          </label>
          <label class="mode-opt" class:selected={scheduleMode === 'schedule'}>
            <input type="radio" bind:group={scheduleMode} value="schedule" />
            <div>
              <strong>Schedule</strong>
              <p>Play different folders at different times of day. Configure dayparts after setup.</p>
            </div>
          </label>
        </div>

      {:else if step === 4}
        <h2>Broadcast Settings</h2>

        <div class="section-label">Privacy</div>
        <div class="privacy-opts">
          <label class="privacy-opt" class:selected={privacyMode === 'relay'}>
            <input type="radio" bind:group={privacyMode} value="relay" />
            <div>
              <strong>🔒 Relay <span class="rec">(recommended)</span></strong>
              <p>Your IP stays private. Stream is pushed to a relay server. No port forwarding needed.</p>
            </div>
          </label>
          {#if privacyMode === 'relay'}
            <div class="field relay-url-field">
              <label for="relay-url">Relay ingest URL</label>
              <input id="relay-url" bind:value={relayUrl} placeholder="https://your-relay.com/ingest/channel-id/" />
              <span class="field-hint">Leave blank to configure later in the Scheduler panel.</span>
            </div>
          {/if}
          <label class="privacy-opt" class:selected={privacyMode === 'direct'}>
            <input type="radio" bind:group={privacyMode} value="direct" />
            <div>
              <strong>⚡ Direct</strong>
              <p>Viewers connect to your machine. Your IP is visible. May need port forwarding.</p>
            </div>
          </label>
        </div>

        {#if type === 'tv'}
          <div class="section-label" style="margin-top:1rem">Video Quality</div>
          <div class="row">
            <div class="field">
              <label>Resolution</label>
              <select bind:value={resolution}>
                {#each RESOLUTIONS as r}
                  <option value={r.value}>{r.label}</option>
                {/each}
              </select>
            </div>
            <div class="field">
              <label>Video bitrate</label>
              <input bind:value={videoBitrate} placeholder="2500k" />
            </div>
          </div>
        {/if}

        <div class="section-label" style="margin-top:1rem">Network</div>
        <div class="row">
          <div class="field">
            <label for="dir-url">Directory URL</label>
            <input id="dir-url" bind:value={directoryUrl} placeholder="http://localhost:3001" />
          </div>
          <div class="field">
            <label for="srv-port">Server port</label>
            <input id="srv-port" type="number" bind:value={serverPort} min="1024" max="65535" />
          </div>
        </div>

        {#if saveError}
          <div class="save-error">Error: {saveError}</div>
        {/if}
      {/if}

    </div>

    <div class="wizard-footer">
      <button class="btn-ghost" onclick={step > 1 ? () => step-- : onCancel}>
        {step > 1 ? '← Back' : 'Cancel'}
      </button>
      <div class="spacer"></div>
      {#if step < TOTAL_STEPS}
        <button class="btn-primary" onclick={() => step++} disabled={!canNext}>
          Next →
        </button>
      {:else}
        <button class="btn-primary" onclick={save} disabled={saving || !name.trim()}>
          {saving ? 'Saving…' : 'Save channel.toml'}
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .wizard-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.88);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    font-family: monospace;
  }

  .wizard {
    background: #111;
    border: 1px solid #333;
    width: 560px;
    max-width: 95vw;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    color: #ddd;
  }

  .wizard-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #222;
    font-weight: bold;
    font-size: 0.9rem;
  }

  .steps { color: #555; font-size: 0.8rem; font-weight: normal; }

  .progress-bar {
    height: 2px;
    background: #1a1a1a;
  }
  .progress-fill {
    height: 100%;
    background: #4a9;
    transition: width 0.3s;
  }

  .wizard-body {
    flex: 1;
    overflow-y: auto;
    padding: 1.25rem 1.25rem 0.5rem;
  }

  h2 { font-size: 1rem; margin-bottom: 0.75rem; }
  .hint { color: #777; font-size: 0.82rem; margin-bottom: 1rem; line-height: 1.4; }

  .field { display: flex; flex-direction: column; gap: 0.3rem; margin-bottom: 0.75rem; }
  .field label { font-size: 0.75rem; color: #888; }
  .req { color: #f84; }

  input, textarea, select {
    background: #0d0d0d;
    border: 1px solid #2a2a2a;
    color: #ddd;
    padding: 0.4rem 0.5rem;
    font-family: monospace;
    font-size: 0.85rem;
    width: 100%;
  }

  input:focus, textarea:focus, select:focus {
    outline: none;
    border-color: #4a9;
  }

  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }

  .radio-group { display: flex; gap: 0.5rem; }
  .radio {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.6rem;
    border: 1px solid #2a2a2a;
    cursor: pointer;
    font-size: 0.85rem;
  }
  .radio.selected { border-color: #4a9; background: #0d1a12; }
  .radio input { display: none; }

  /* Folders */
  .folder-list { border: 1px solid #1e1e1e; margin-bottom: 0.75rem; min-height: 80px; }
  .folder-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid #1a1a1a;
    font-size: 0.82rem;
  }
  .folder-name { font-weight: bold; color: #ccc; }
  .folder-path { flex: 1; color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.72rem; }
  .empty-folders { padding: 1rem; color: #444; text-align: center; font-size: 0.82rem; }
  .remove {
    background: none;
    border: none;
    color: #555;
    cursor: pointer;
    font-size: 0.75rem;
    padding: 0.1rem 0.3rem;
  }
  .remove:hover { color: #f44; }
  .add-folder {
    background: #1a1a1a;
    border: 1px solid #333;
    color: #ccc;
    padding: 0.35rem 0.75rem;
    cursor: pointer;
    font-family: monospace;
    font-size: 0.82rem;
    width: 100%;
  }
  .add-folder:hover { background: #222; }
  .folder-err { color: #f44; font-size: 0.78rem; margin-top: 0.4rem; }

  /* Mode options */
  .mode-options, .privacy-opts { display: flex; flex-direction: column; gap: 0.5rem; }
  .mode-opt, .privacy-opt {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    border: 1px solid #222;
    padding: 0.65rem;
    cursor: pointer;
  }
  .mode-opt.selected, .privacy-opt.selected { border-color: #4a9; background: #0d1a12; }
  .mode-opt input, .privacy-opt input { display: none; }
  .mode-opt strong, .privacy-opt strong { font-size: 0.88rem; display: block; margin-bottom: 0.2rem; }
  .mode-opt p, .privacy-opt p { font-size: 0.78rem; color: #888; margin: 0; line-height: 1.4; }
  .rec { color: #4a9; font-size: 0.78rem; font-weight: normal; }

  .relay-url-field { margin-left: 0.5rem; margin-top: 0.25rem; }
  .field-hint { font-size: 0.7rem; color: #555; margin-top: 0.15rem; }

  .section-label { font-size: 0.7rem; color: #666; letter-spacing: 0.08em; margin-bottom: 0.4rem; }

  .save-error { color: #f44; font-size: 0.82rem; margin-top: 0.75rem; }

  /* Footer */
  .wizard-footer {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-top: 1px solid #222;
  }
  .spacer { flex: 1; }

  .btn-ghost {
    background: none;
    border: 1px solid #333;
    color: #888;
    padding: 0.4rem 0.85rem;
    cursor: pointer;
    font-family: monospace;
    font-size: 0.85rem;
  }
  .btn-ghost:hover { border-color: #555; color: #ccc; }

  .btn-primary {
    background: #1a2a1a;
    border: 1px solid #4a9;
    color: #4f4;
    padding: 0.4rem 1rem;
    cursor: pointer;
    font-family: monospace;
    font-size: 0.85rem;
  }
  .btn-primary:hover:not(:disabled) { background: #1e341e; }
  .btn-primary:disabled { opacity: 0.4; cursor: default; }
</style>
