<script>
  let { onChoose } = $props();

  let choice = $state('relay');
  let publicIp = $state(null);

  async function fetchIp() {
    try {
      const res = await fetch('https://api.ipify.org?format=json');
      const d = await res.json();
      publicIp = d.ip;
    } catch { publicIp = 'unknown'; }
  }

  $effect(() => {
    if (choice === 'direct') fetchIp();
  });
</script>

<div class="modal-backdrop">
  <div class="modal">
    <h2>How do you want to broadcast?</h2>
    <p class="subtitle">This controls whether your IP address is visible to viewers.</p>

    <div class="options">
      <label class="option" class:selected={choice === 'relay'}>
        <input type="radio" bind:group={choice} value="relay" />
        <div class="option-content">
          <div class="option-title">🔒 Broadcast via relay <span class="rec">(recommended)</span></div>
          <div class="option-desc">
            Your IP address stays private. Your stream is uploaded once to the network relay,
            which fans it out to viewers. Works behind any NAT or firewall — no port forwarding needed.
          </div>
        </div>
      </label>

      <label class="option" class:selected={choice === 'direct'}>
        <input type="radio" bind:group={choice} value="direct" />
        <div class="option-content">
          <div class="option-title">⚡ Broadcast directly</div>
          <div class="option-desc">
            Lower latency, no middleman. Viewers connect to your machine directly.
            {#if publicIp}
              <span class="ip-warning">
                ⚠ Your IP address <strong>{publicIp}</strong> will be visible to every viewer
                and anyone who looks up your channel in the guide.
              </span>
            {:else}
              Fetching your public IP…
            {/if}
            You may also need to configure port forwarding on your router.
          </div>
        </div>
      </label>
    </div>

    <div class="actions">
      <button onclick={() => onChoose(choice)} class="primary">
        Continue with {choice === 'relay' ? 'Relay Mode' : 'Direct Mode'} →
      </button>
    </div>

    <p class="footnote">
      You can change this later in channel settings.
    </p>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    font-family: monospace;
  }

  .modal {
    background: #111;
    border: 1px solid #333;
    padding: 2rem;
    max-width: 560px;
    width: 100%;
    color: #ddd;
  }

  h2 { font-size: 1.1rem; margin-bottom: 0.4rem; }
  .subtitle { color: #888; font-size: 0.85rem; margin-bottom: 1.5rem; }

  .options { display: flex; flex-direction: column; gap: 0.75rem; }

  .option {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    border: 1px solid #2a2a2a;
    padding: 0.75rem;
    cursor: pointer;
  }

  .option.selected { border-color: #555; background: #161616; }
  .option input { margin-top: 0.2rem; flex-shrink: 0; }

  .option-title { font-weight: bold; margin-bottom: 0.3rem; }
  .rec { color: #4a9; font-size: 0.8rem; font-weight: normal; }
  .option-desc { font-size: 0.82rem; color: #999; line-height: 1.4; }

  .ip-warning {
    display: block;
    margin: 0.5rem 0;
    color: #f84;
    background: #1a0e00;
    border: 1px solid #f844;
    padding: 0.4rem 0.6rem;
  }

  .actions { margin-top: 1.5rem; }

  .primary {
    background: #1a2a1a;
    border: 1px solid #4a9;
    color: #4f4;
    padding: 0.5rem 1.25rem;
    cursor: pointer;
    font-family: monospace;
    font-size: 0.9rem;
  }

  .primary:hover { background: #1e341e; }

  .footnote { margin-top: 0.75rem; font-size: 0.75rem; color: #555; }
</style>
