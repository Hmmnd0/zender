<script>
  // Runs when the broadcaster is about to go ON AIR.
  // Checks port reachability and estimates max viewers from upload speed.

  let { onPass, onUseRelay, onCancel, mode = 'direct', port = 8047 } = $props();

  // Steps: idle → checking → pass | fail
  let status = $state('idle');
  let uploadMbps = $state(null);
  let reachable = $state(null);
  let errorMsg = $state(null);
  let publicIp = $state(null);
  let publicUrl = $state('');

  const MAX_VIEWERS = $derived(
    uploadMbps == null ? null : Math.floor((uploadMbps * 1000) / 2500)
  );

  async function run() {
    status = 'checking';
    errorMsg = null;

    // 1. Get public IP
    try {
      const r = await fetch('https://api.ipify.org?format=json');
      const d = await r.json();
      publicIp = d.ip;
      publicUrl = `http://${publicIp}:${port}`;
    } catch {
      publicIp = null;
      publicUrl = '';
    }

    // 2. Speed test — download a 1 MB chunk and measure throughput
    try {
      const start = Date.now();
      // Use a reliable public endpoint for speed testing
      const r = await fetch('https://speed.cloudflare.com/__down?bytes=2000000', { cache: 'no-store' });
      const buf = await r.arrayBuffer();
      const elapsed = (Date.now() - start) / 1000;
      const bytes = buf.byteLength;
      uploadMbps = parseFloat(((bytes * 8) / elapsed / 1_000_000).toFixed(1));
    } catch {
      uploadMbps = null;
    }

    // 3. Reachability probe (only relevant for direct mode)
    if (mode === 'direct' && publicUrl) {
      try {
        const r = await fetch(
          `/api/check-reachability?url=${encodeURIComponent(publicUrl + '/connectivity-check')}`
        );
        const d = await r.json();
        reachable = d.ok;
        if (!d.ok) errorMsg = d.error ?? 'Port unreachable';
      } catch (e) {
        reachable = false;
        errorMsg = e.message;
      }
    } else {
      reachable = null; // not applicable in relay mode
    }

    status = 'done';
  }

  const canProceed = $derived(
    mode === 'relay' || reachable === true
  );
</script>

<div class="modal-backdrop">
  <div class="modal">
    <h2>Connectivity Check</h2>

    {#if status === 'idle'}
      <p class="desc">
        Before going on air, we'll verify your connection and estimate how many viewers you can support.
      </p>
      <div class="mode-note">
        Mode: <strong>{mode === 'relay' ? '🔒 Relay' : '⚡ Direct'}</strong>
        {#if mode === 'direct' && publicIp}
          — checking port {port} on {publicIp}
        {/if}
      </div>
      <div class="actions">
        <button class="btn-primary" onclick={run}>Run Check</button>
        <button class="btn-ghost" onclick={onCancel}>Cancel</button>
      </div>

    {:else if status === 'checking'}
      <div class="checking">
        <div class="spinner"></div>
        <span>Checking…</span>
      </div>

    {:else}
      <!-- Results -->
      <div class="results">

        {#if uploadMbps !== null}
          <div class="result-row">
            <span class="result-label">Upload speed</span>
            <span class="result-val">{uploadMbps} Mbps</span>
            {#if MAX_VIEWERS !== null}
              <span class="result-note">≈ {MAX_VIEWERS} concurrent viewers at 2.5 Mbps</span>
            {/if}
          </div>
        {/if}

        {#if mode === 'direct'}
          <div class="result-row" class:ok={reachable} class:fail={reachable === false}>
            <span class="result-label">Port {port} reachable</span>
            <span class="result-val">{reachable ? '✓ Yes' : '✗ No'}</span>
            {#if publicIp}
              <span class="result-note">{publicIp}:{port}</span>
            {/if}
          </div>

          {#if reachable === false}
            <div class="port-guide">
              <strong>Port not reachable from outside.</strong> Options:
              <ol>
                <li>
                  <strong>Switch to Relay mode</strong> — no port forwarding needed, IP stays private.
                  <button class="link-btn" onclick={onUseRelay}>Switch to Relay →</button>
                </li>
                <li>
                  <strong>Port forward</strong> port {port} TCP on your router to this machine.
                  Most routers: Admin panel → Port Forwarding → Add rule for TCP {port}.
                </li>
              </ol>
            </div>
          {/if}
        {:else}
          <div class="result-row ok">
            <span class="result-label">Relay mode</span>
            <span class="result-val">✓ No port forwarding needed</span>
            <span class="result-note">Your IP stays private</span>
          </div>
        {/if}

        {#if MAX_VIEWERS !== null && MAX_VIEWERS < 3}
          <div class="bandwidth-warn">
            ⚠ Your upload speed supports ~{MAX_VIEWERS} viewer{MAX_VIEWERS === 1 ? '' : 's'} in direct mode.
            Relay mode offloads fan-out to the relay server — consider switching.
          </div>
        {/if}
      </div>

      <div class="actions">
        {#if canProceed}
          <button class="btn-primary" onclick={onPass}>Go On Air →</button>
        {:else}
          <button class="btn-ghost" onclick={onUseRelay}>Switch to Relay →</button>
        {/if}
        <button class="btn-ghost" onclick={onCancel}>Cancel</button>
        <button class="btn-ghost small" onclick={run}>Re-run</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.88);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 150;
    font-family: monospace;
  }

  .modal {
    background: #111;
    border: 1px solid #333;
    padding: 1.75rem;
    max-width: 500px;
    width: 100%;
    color: #ddd;
  }

  h2 { font-size: 1rem; margin-bottom: 0.75rem; }
  .desc { color: #888; font-size: 0.84rem; line-height: 1.5; margin-bottom: 1rem; }
  .mode-note { font-size: 0.8rem; color: #666; margin-bottom: 1.25rem; }

  .checking {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1.5rem 0;
    color: #888;
  }

  .spinner {
    width: 16px; height: 16px;
    border: 2px solid #333;
    border-top-color: #4a9;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .results { display: flex; flex-direction: column; gap: 0.6rem; margin-bottom: 1.25rem; }

  .result-row {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.5rem 0.6rem;
    border: 1px solid #1e1e1e;
    font-size: 0.84rem;
    flex-wrap: wrap;
  }
  .result-row.ok { border-color: #2a4a2a; background: #0a110a; }
  .result-row.fail { border-color: #4a1a1a; background: #110a0a; }

  .result-label { color: #888; }
  .result-val { font-weight: bold; }
  .result-row.ok .result-val { color: #4f4; }
  .result-row.fail .result-val { color: #f44; }
  .result-note { color: #555; font-size: 0.75rem; margin-left: auto; }

  .port-guide {
    background: #0d0d0d;
    border: 1px solid #2a2a2a;
    padding: 0.75rem;
    font-size: 0.82rem;
    line-height: 1.6;
    color: #999;
  }
  .port-guide ol { margin: 0.5rem 0 0 1.2rem; }
  .port-guide li { margin-bottom: 0.5rem; }

  .link-btn {
    background: none;
    border: none;
    color: #4a9;
    cursor: pointer;
    font-family: monospace;
    font-size: 0.82rem;
    padding: 0;
    text-decoration: underline;
  }

  .bandwidth-warn {
    font-size: 0.8rem;
    color: #f84;
    background: #1a0e00;
    border: 1px solid #f844;
    padding: 0.5rem 0.6rem;
    line-height: 1.4;
  }

  .actions { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }

  .btn-primary {
    background: #1a2a1a;
    border: 1px solid #4a9;
    color: #4f4;
    padding: 0.4rem 1rem;
    cursor: pointer;
    font-family: monospace;
    font-size: 0.88rem;
  }
  .btn-primary:hover { background: #1e341e; }

  .btn-ghost {
    background: none;
    border: 1px solid #333;
    color: #777;
    padding: 0.4rem 0.85rem;
    cursor: pointer;
    font-family: monospace;
    font-size: 0.88rem;
  }
  .btn-ghost:hover { border-color: #555; color: #bbb; }
  .btn-ghost.small { font-size: 0.78rem; padding: 0.3rem 0.6rem; }
</style>
