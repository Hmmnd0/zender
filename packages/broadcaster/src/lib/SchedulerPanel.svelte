<script>
  // Scheduler panel: view/edit daypart blocks and interval rules.
  // Edits are written back to channel.toml via the Tauri fs plugin.
  // In web mode, changes are held in memory and a download is offered.

  import { setBumpers } from './channel-server.js';

  let { config = null, configPath = null, onSave, bumpers = [], connected = false } = $props();

  function buildToml(cfg) {
    const c = cfg.channel ?? {};
    const s = cfg.stream ?? {};
    const sc = cfg.scheduler ?? {};
    const d = cfg.directory ?? {};
    const srv = cfg.server ?? {};

    const lines = [
      '[channel]',
      `name        = ${JSON.stringify(c.name ?? '')}`,
      `description = ${JSON.stringify(c.description ?? '')}`,
      `genre       = ${JSON.stringify(c.genre ?? 'general')}`,
      `type        = ${JSON.stringify(c.type ?? 'tv')}`,
      '',
      '[stream]',
      `resolution      = ${JSON.stringify(s.resolution ?? '1280x720')}`,
      `video_bitrate   = ${JSON.stringify(s.videoBitrate ?? '2500k')}`,
      `audio_bitrate   = ${JSON.stringify(s.audioBitrate ?? '128k')}`,
      `fps             = ${s.fps ?? 30}`,
      `segment_seconds = ${s.segmentSeconds ?? 6}`,
      '',
      '[scheduler]',
      `mode = ${JSON.stringify(sc.mode ?? 'shuffle')}`,
      '',
    ];

    for (const blk of (sc.blocks ?? [])) {
      lines.push('[[scheduler.blocks]]');
      lines.push(`days   = [${blk.days.map(d => JSON.stringify(d)).join(',')}]`);
      lines.push(`start  = ${JSON.stringify(blk.start)}`);
      lines.push(`folder = ${JSON.stringify(blk.folder)}`);
      lines.push(`order  = ${JSON.stringify(blk.order ?? 'shuffle')}`);
      lines.push('');
    }

    for (const rule of (sc.rules ?? [])) {
      lines.push('[[scheduler.rules]]');
      lines.push(`every_minutes = ${rule.every_minutes}`);
      lines.push(`folder        = ${JSON.stringify(rule.folder)}`);
      lines.push('');
    }

    lines.push('[directory]');
    lines.push(`url    = ${JSON.stringify(d.url ?? 'http://localhost:3001')}`);
    lines.push(`public = ${d.public !== false}`);
    lines.push('');
    lines.push('[server]');
    lines.push(`port       = ${srv.port ?? 8047}`);
    lines.push(`mode       = ${JSON.stringify(srv.mode ?? 'relay')}`);
    lines.push(`relay_url  = ${JSON.stringify(srv.relayUrl ?? '')}`);
    lines.push(`public_url = ${JSON.stringify(srv.publicUrl ?? '')}`);

    return lines.join('\n') + '\n';
  }

  const isTauri = '__TAURI_INTERNALS__' in window || '__TAURI__' in window;

  // Bumper config
  let bumperEveryN = $state(false);
  let bumperN = $state(3);
  let bumperInterval = $state(false);
  let bumperMins = $state(30);
  let bumperApplying = $state(false);
  let bumperApplied = $state(false);

  async function applyBumpers() {
    bumperApplying = true;
    bumperApplied = false;
    try {
      await setBumpers(bumpers, {
        everyN: bumperEveryN ? bumperN : null,
        intervalMins: bumperInterval ? bumperMins : null,
      });
      bumperApplied = true;
      setTimeout(() => { bumperApplied = false; }, 2000);
    } catch (e) {
      console.error('setBumpers failed', e);
    } finally {
      bumperApplying = false;
    }
  }
  const DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
  const DAY_LABELS = { mon:'M', tue:'T', wed:'W', thu:'T', fri:'F', sat:'S', sun:'S' };

  let blocks = $state([]);
  let rules  = $state([]);
  let mode   = $state('shuffle');

  $effect(() => {
    const cfg = config;
    if (cfg) {
      blocks = cfg.scheduler?.blocks ? [...cfg.scheduler.blocks] : [];
      rules  = cfg.scheduler?.rules  ? [...cfg.scheduler.rules]  : [];
      mode   = cfg.scheduler?.mode   ?? 'shuffle';
    }
  });
  let dirty  = $state(false);
  let saving = $state(false);
  let addingBlock = $state(false);
  let addingRule  = $state(false);

  // New block form
  let nb = $state({ days: [...DAYS], start: '08:00', folder: '', order: 'shuffle' });
  // New rule form
  let nr = $state({ every_minutes: 60, folder: '' });

  function toggleDay(b, day) {
    if (b.days.includes(day)) b.days = b.days.filter(d => d !== day);
    else b.days = [...b.days, day];
    dirty = true;
  }

  function addBlock() {
    if (!nb.folder) return;
    blocks = [...blocks, { ...nb, days: [...nb.days] }];
    nb = { days: [...DAYS], start: '08:00', folder: '', order: 'shuffle' };
    addingBlock = false;
    dirty = true;
  }

  function removeBlock(i) {
    blocks = blocks.filter((_, idx) => idx !== i);
    dirty = true;
  }

  function addRule() {
    if (!nr.folder) return;
    rules = [...rules, { ...nr }];
    nr = { every_minutes: 60, folder: '' };
    addingRule = false;
    dirty = true;
  }

  function removeRule(i) {
    rules = rules.filter((_, idx) => idx !== i);
    dirty = true;
  }

  async function pickFolder(target) {
    if (isTauri) {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const dir = await open({ directory: true });
      if (dir) target.folder = dir;
    } else {
      const dir = prompt('Enter folder path:');
      if (dir) target.folder = dir;
    }
    dirty = true;
  }

  async function save() {
    saving = true;
    try {
      const updated = {
        ...config,
        scheduler: { ...config?.scheduler, mode, blocks, rules },
      };

      if (isTauri && configPath) {
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        await writeTextFile(configPath, buildToml(updated));
      }

      onSave?.(updated);
      dirty = false;
    } catch (e) {
      console.error('save failed', e);
    } finally {
      saving = false;
    }
  }

  function folderName(p) { return p?.split('/').pop() || p || '—'; }
</script>

<div class="scheduler">
  <div class="panel-header">
    <strong>SCHEDULER</strong>
    <div class="mode-select">
      <select bind:value={mode} onchange={() => { dirty = true; }}>
        <option value="shuffle">Shuffle</option>
        <option value="sequential">Sequential</option>
        <option value="schedule">Schedule (dayparts)</option>
      </select>
    </div>
    {#if dirty}
      <button class="save-btn" onclick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    {/if}
  </div>

  <!-- Daypart Blocks -->
  <div class="section">
    <div class="section-title">
      DAYPARTS
      <button class="mini" onclick={() => { addingBlock = !addingBlock; }}>+ Add</button>
    </div>

    {#if addingBlock}
      <div class="add-form">
        <div class="form-row">
          <div class="day-toggles">
            {#each DAYS as day}
              <button
                class="day-btn"
                class:active={nb.days.includes(day)}
                onclick={() => toggleDay(nb, day)}
              >{DAY_LABELS[day]}</button>
            {/each}
          </div>
          <input type="time" bind:value={nb.start} class="time-input" />
        </div>
        <div class="form-row">
          <span class="folder-display">{folderName(nb.folder) || 'No folder'}</span>
          <button class="mini" onclick={() => pickFolder(nb)}>Browse…</button>
          <select bind:value={nb.order} class="order-sel">
            <option value="shuffle">Shuffle</option>
            <option value="sequential">Sequential</option>
          </select>
          <button class="mini primary" onclick={addBlock} disabled={!nb.folder}>Add</button>
          <button class="mini" onclick={() => { addingBlock = false; }}>Cancel</button>
        </div>
      </div>
    {/if}

    {#if blocks.length === 0}
      <div class="empty">No dayparts configured</div>
    {:else}
      {#each blocks as block, i}
        <div class="block-row">
          <div class="day-pills">
            {#each DAYS as day}
              <span class="day-pill" class:active={block.days.includes(day)}>{DAY_LABELS[day]}</span>
            {/each}
          </div>
          <span class="block-time">{block.start}</span>
          <span class="block-folder" title={block.folder}>📁 {folderName(block.folder)}</span>
          <span class="block-order">{block.order ?? 'shuffle'}</span>
          <button class="remove-btn" onclick={() => removeBlock(i)}>✕</button>
        </div>
      {/each}
    {/if}
  </div>

  <!-- Bumpers -->
  <div class="section">
    <div class="section-title">BUMPERS</div>

    {#if bumpers.length === 0}
      <div class="empty">Tag files as 🎬 in the library to build a playlist</div>
    {:else}
      <div class="bumper-list">
        {#each bumpers as path, i}
          <div class="bumper-row">
            <span class="bump-idx">{i + 1}</span>
            <span class="bump-name" title={path}>{path.split('/').pop()?.replace(/\.\w{2,4}$/, '') ?? path}</span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="bump-triggers">
      <label class="trigger-row">
        <input type="checkbox" bind:checked={bumperEveryN} />
        <span>Every</span>
        <input type="number" class="n-input" bind:value={bumperN} min="1" max="99" disabled={!bumperEveryN} />
        <span>items</span>
      </label>
      <label class="trigger-row">
        <input type="checkbox" bind:checked={bumperInterval} />
        <span>Every</span>
        <input type="number" class="n-input" bind:value={bumperMins} min="1" max="1440" disabled={!bumperInterval} />
        <span>min</span>
      </label>
    </div>

    <div class="bump-apply">
      <button
        class="mini primary"
        onclick={applyBumpers}
        disabled={bumperApplying || !connected || (!bumperEveryN && !bumperInterval) || bumpers.length === 0}
      >
        {#if bumperApplying}Applying…{:else if bumperApplied}Applied ✓{:else}Apply{/if}
      </button>
      {#if !connected}
        <span class="bump-hint">connect channel server first</span>
      {:else if bumpers.length === 0}
        <span class="bump-hint">tag bumpers in library</span>
      {:else if !bumperEveryN && !bumperInterval}
        <span class="bump-hint">enable at least one trigger</span>
      {/if}
    </div>
  </div>

  <!-- Interval Rules -->
  <div class="section">
    <div class="section-title">
      RULES
      <button class="mini" onclick={() => { addingRule = !addingRule; }}>+ Add</button>
    </div>

    {#if addingRule}
      <div class="add-form">
        <div class="form-row">
          <span class="inline-label">Every</span>
          <input type="number" bind:value={nr.every_minutes} min="1" max="1440" class="minutes-input" />
          <span class="inline-label">min — </span>
          <span class="folder-display">{folderName(nr.folder) || 'No folder'}</span>
          <button class="mini" onclick={() => pickFolder(nr)}>Browse…</button>
          <button class="mini primary" onclick={addRule} disabled={!nr.folder}>Add</button>
          <button class="mini" onclick={() => { addingRule = false; }}>Cancel</button>
        </div>
      </div>
    {/if}

    {#if rules.length === 0}
      <div class="empty">No interval rules</div>
    {:else}
      {#each rules as rule, i}
        <div class="rule-row">
          <span class="rule-interval">every {rule.every_minutes}min</span>
          <span class="rule-action">→ insert random from</span>
          <span class="rule-folder" title={rule.folder}>📁 {folderName(rule.folder)}</span>
          <button class="remove-btn" onclick={() => removeRule(i)}>✕</button>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .scheduler {
    display: flex;
    flex-direction: column;
    height: 100%;
    font-family: monospace;
    font-size: 0.8rem;
    overflow-y: auto;
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
    border-bottom: 1px solid #1a1a1a;
    background: #0d0d0d;
    flex-wrap: wrap;
  }

  .panel-header strong { color: #888; font-size: 0.7rem; letter-spacing: 0.08em; }

  .mode-select select {
    background: #111;
    border: 1px solid #2a2a2a;
    color: #bbb;
    font-family: monospace;
    font-size: 0.75rem;
    padding: 0.15rem 0.3rem;
  }

  .save-btn {
    background: #1a2a1a;
    border: 1px solid #4a9;
    color: #4f4;
    padding: 0.15rem 0.5rem;
    cursor: pointer;
    font-family: monospace;
    font-size: 0.75rem;
    margin-left: auto;
  }

  .section { border-bottom: 1px solid #111; }

  .section-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.5rem;
    color: #666;
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    background: #0d0d0d;
  }

  .empty { padding: 0.6rem 0.5rem; color: #333; font-size: 0.75rem; }

  .block-row, .rule-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.5rem;
    border-bottom: 1px solid #0d0d0d;
    flex-wrap: wrap;
  }

  .day-pills { display: flex; gap: 1px; }
  .day-pill {
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.65rem;
    background: #111;
    color: #333;
  }
  .day-pill.active { background: #1e2e1e; color: #4a9; }

  .block-time { color: #aaa; font-size: 0.78rem; }
  .block-folder, .rule-folder { color: #888; font-size: 0.75rem; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .block-order { color: #555; font-size: 0.7rem; }
  .rule-interval { color: #aaa; }
  .rule-action { color: #555; }

  .remove-btn {
    background: none;
    border: none;
    color: #333;
    cursor: pointer;
    font-size: 0.7rem;
    padding: 0.1rem 0.2rem;
    flex-shrink: 0;
  }
  .remove-btn:hover { color: #f44; }

  /* Add form */
  .add-form {
    padding: 0.5rem;
    background: #0a0a0a;
    border-bottom: 1px solid #1a1a1a;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .form-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .day-toggles { display: flex; gap: 2px; }
  .day-btn {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #111;
    border: 1px solid #222;
    color: #555;
    cursor: pointer;
    font-size: 0.7rem;
    padding: 0;
  }
  .day-btn.active { background: #1e2e1e; border-color: #4a9; color: #4a9; }

  .time-input {
    background: #111;
    border: 1px solid #222;
    color: #ccc;
    font-family: monospace;
    font-size: 0.78rem;
    padding: 0.2rem 0.3rem;
    width: 80px;
  }

  .folder-display {
    color: #888;
    font-size: 0.75rem;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 60px;
  }

  .order-sel {
    background: #111;
    border: 1px solid #222;
    color: #bbb;
    font-family: monospace;
    font-size: 0.75rem;
    padding: 0.15rem;
  }

  .minutes-input {
    background: #111;
    border: 1px solid #222;
    color: #ccc;
    font-family: monospace;
    font-size: 0.78rem;
    padding: 0.2rem 0.3rem;
    width: 50px;
  }

  .inline-label { color: #666; font-size: 0.75rem; }

  .mini {
    background: #111;
    border: 1px solid #2a2a2a;
    color: #888;
    padding: 0.15rem 0.4rem;
    cursor: pointer;
    font-family: monospace;
    font-size: 0.72rem;
    white-space: nowrap;
  }
  .mini:hover:not(:disabled) { background: #1a1a1a; color: #ccc; }
  .mini.primary { border-color: #4a9; color: #4a9; }
  .mini.primary:hover:not(:disabled) { background: #0d1a12; }
  .mini:disabled { opacity: 0.4; cursor: default; }

  .bumper-list {
    max-height: 120px;
    overflow-y: auto;
  }

  .bumper-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.2rem 0.5rem;
    border-bottom: 1px solid #0d0d0d;
  }

  .bump-idx { color: #333; font-size: 0.7rem; width: 14px; text-align: right; flex-shrink: 0; }
  .bump-name { color: #fa4; font-size: 0.75rem; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .bump-triggers {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.5rem;
    border-top: 1px solid #111;
  }

  .trigger-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: #777;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .trigger-row input[type="checkbox"] { accent-color: #fa4; cursor: pointer; }

  .n-input {
    background: #111;
    border: 1px solid #222;
    color: #ccc;
    font-family: monospace;
    font-size: 0.75rem;
    padding: 0.15rem 0.3rem;
    width: 44px;
    text-align: center;
  }
  .n-input:disabled { opacity: 0.35; }

  .bump-apply {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.5rem;
    border-top: 1px solid #111;
  }

  .bump-hint { color: #444; font-size: 0.7rem; }
</style>
