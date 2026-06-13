<script>
  import { skip, standby, resume, dequeueFile } from './channel-server.js';

  let { state: s, logs = [] } = $props();

  function basename(p) {
    if (!p) return '';
    return p.split('/').pop()
      ?.replace(/(\.\w{2,4})?\.norm\.ts$/, '')
      .replace(/\.\w{2,4}$/, '') ?? p;
  }

  function fmtDuration(secs) {
    if (!secs) return '';
    const m = Math.floor(secs / 60);
    const sec = Math.floor(secs % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  // Skip index 0 (now playing) and filter out loop placeholders
  const upcoming = $derived(
    (s.upcomingQueue ?? []).slice(1).filter(i => !i.isLoop)
  );
  // pendingQueue items are now { path, name } objects
  const pending = $derived(s.pendingQueue ?? []);

  const isStandby = $derived(s.nowPlaying === 'STANDBY');

  let standbyError = $state(null);
  async function handleStandbyToggle() {
    standbyError = null;
    try {
      if (isStandby) await resume();
      else await standby();
    } catch (e) {
      standbyError = e.message;
      setTimeout(() => { standbyError = null; }, 4000);
    }
  }
</script>

<div class="queue">
  <div class="section-header">NOW PLAYING</div>
  {#if s.nowPlaying && s.nowPlaying !== 'STANDBY'}
    <div class="now-playing-row">
      <span class="play-icon">▶</span>
      <span class="title">{basename(s.nowPlaying)}</span>
    </div>
  {:else if s.nowPlaying === 'STANDBY'}
    <div class="now-playing-row standby">
      <span class="play-icon">⚠</span>
      <span class="title">STANDBY — Technical Difficulties</span>
    </div>
  {:else}
    <div class="idle">Off air</div>
  {/if}

  <div class="section-header">UP NEXT</div>
  <div class="upcoming-list">
    {#if pending.length === 0 && upcoming.length === 0}
      <div class="empty-queue">
        {#if s.onAir}
          Looping current item — use <strong>+ Queue</strong> in the library to add more
        {:else}
          Nothing queued
        {/if}
      </div>
    {:else}
      {#each pending as item}
        <div class="upcoming-row pending-row">
          <span class="idx">·</span>
          <span class="up-title">{item.name}</span>
          <span class="up-tag">queued</span>
          <button class="remove-btn" onclick={() => dequeueFile(item.path)} title="Remove from queue">✕</button>
        </div>
      {/each}
      {#each upcoming.slice(0, 10) as item, i}
        <div class="upcoming-row">
          <span class="idx">{i + 1}</span>
          <span class="up-title">{basename(item.src)}</span>
          <span class="up-dur">{fmtDuration(item.duration)}</span>
        </div>
      {/each}
      {#if upcoming.length > 10}
        <div class="more">+ {upcoming.length - 10} more buffered</div>
      {/if}
    {/if}
  </div>

  <div class="section-header" style="margin-top:auto">CONTROLS</div>
  <div class="actions">
    <button onclick={() => skip()} disabled={!s.onAir || isStandby} title="Skip to next item in queue">⏭ Skip</button>
    <button
      onclick={handleStandbyToggle}
      disabled={!s.onAir}
      class:danger={!isStandby}
      class:resume={isStandby}
      title={isStandby ? 'Resume broadcast' : 'Cut to standby screen'}
    >{isStandby ? '▶ Resume' : '⚠ Standby'}</button>
  </div>
  {#if standbyError}
    <div class="standby-error">{standbyError}</div>
  {/if}
  <div class="hint">
    Use <strong>▶ Now</strong> in the library to jump to any file.<br/>
    Use <strong>+ Queue</strong> to add to the end of the line.
  </div>

  {#if logs.length > 0}
    <div class="section-header log-header">SIGNAL LOG</div>
    <div class="log-list">
      {#each [...logs.slice(-12)].reverse() as entry}
        <div class="log-row log-{entry.level}">
          <span class="log-time">{new Date(entry.ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          <span class="log-line">{entry.line}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .queue {
    display: flex;
    flex-direction: column;
    height: 100%;
    font-family: monospace;
    font-size: 0.8rem;
  }

  .section-header {
    padding: 0.35rem 0.5rem;
    background: #0d0d0d;
    color: #555;
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    border-bottom: 1px solid #111;
    flex-shrink: 0;
  }

  .now-playing-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.5rem;
    color: #ddd;
  }

  .now-playing-row.standby { color: #f84; }
  .play-icon { color: #4a9; flex-shrink: 0; }
  .now-playing-row.standby .play-icon { color: #f84; }

  .title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .idle { padding: 0.5rem; color: #333; }

  .upcoming-list { overflow-y: auto; flex: 1; }

  .upcoming-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.2rem 0.5rem;
    border-bottom: 1px solid #0d0d0d;
    color: #888;
  }

  .upcoming-row:hover { background: #0d0d0d; }
  .upcoming-row:hover .remove-btn { opacity: 1; }

  .idx { color: #333; font-size: 0.72rem; width: 14px; flex-shrink: 0; text-align: right; }
  .up-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #999; }
  .up-dur { color: #444; font-size: 0.72rem; flex-shrink: 0; }

  .more { padding: 0.3rem 0.5rem; color: #444; font-size: 0.72rem; }

  .empty-queue {
    padding: 0.6rem 0.5rem;
    color: #333;
    font-size: 0.72rem;
    line-height: 1.5;
  }
  .empty-queue strong { color: #555; }

  .pending-row { opacity: 0.7; }
  .up-tag { color: #555; font-size: 0.68rem; flex-shrink: 0; font-style: italic; }

  .remove-btn {
    background: none;
    border: none;
    color: #555;
    cursor: pointer;
    font-size: 0.7rem;
    padding: 0 0.2rem;
    opacity: 0;
    transition: opacity 0.1s, color 0.1s;
    flex-shrink: 0;
  }
  .remove-btn:hover { color: #f44; }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    padding: 0.5rem;
    flex-shrink: 0;
  }

  button {
    background: #1a1a1a;
    border: 1px solid #333;
    color: #bbb;
    padding: 0.3rem 0.6rem;
    cursor: pointer;
    font-family: monospace;
    font-size: 0.75rem;
  }
  button:disabled { opacity: 0.4; cursor: default; }
  button:not(:disabled):hover { background: #222; }
  button.danger { border-color: #a00; color: #f88; }
  button.danger:not(:disabled):hover { background: #1a0000; }
  button.resume { border-color: #4a9; color: #4f4; }
  button.resume:not(:disabled):hover { background: #0d1a12; }

  .standby-error {
    padding: 0.3rem 0.5rem;
    font-size: 0.7rem;
    color: #f84;
    background: #1a0800;
    border-top: 1px solid #5a2000;
  }

  .hint {
    padding: 0.5rem;
    color: #333;
    font-size: 0.7rem;
    line-height: 1.6;
    border-top: 1px solid #111;
  }
  .hint strong { color: #555; }

  .log-header { color: #444; }
  .log-list {
    max-height: 120px;
    overflow-y: auto;
    flex-shrink: 0;
    border-top: 1px solid #111;
  }
  .log-row {
    display: flex;
    gap: 0.4rem;
    padding: 0.15rem 0.5rem;
    font-size: 0.68rem;
    line-height: 1.4;
    border-bottom: 1px solid #0a0a0a;
    color: #555;
  }
  .log-time { flex-shrink: 0; color: #333; }
  .log-line { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .log-error { color: #f64; }
  .log-error .log-time { color: #a33; }
  .log-warn  { color: #ca4; }
  .log-warn  .log-time { color: #765; }
</style>
