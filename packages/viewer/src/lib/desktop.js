// Desktop-only features gated behind __TAURI__ detection.
// Safe to import in web builds — all functions become no-ops.

export const isTauri = typeof window.__TAURI__ !== 'undefined';

export async function updateTrayTooltip(text) {
  if (!isTauri) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('update_tray_tooltip', { tooltip: text }).catch(() => {});
}

export async function toggleMiniPlayer() {
  if (!isTauri) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('toggle_miniplayer_cmd').catch(() => {});
}

export async function sendNotification(title, body) {
  if (!isTauri) return;
  const { sendNotification: send } = await import('@tauri-apps/plugin-notification');
  await send({ title, body }).catch(() => {});
}

// Poll favorites for on-air status and fire notifications.
// Returns a cleanup function.
export function watchFavorites(getChannels, getFavs, intervalMs = 60_000) {
  if (!isTauri) return () => {};

  const seenOnAir = new Set();

  const check = async () => {
    const channels = getChannels();
    const favIds = new Set((await getFavs()).map(f => f.id));

    for (const ch of channels) {
      if (favIds.has(ch.id) && !seenOnAir.has(ch.id)) {
        seenOnAir.add(ch.id);
        sendNotification('Zender', `${ch.name} is now on air`);
      }
      if (!favIds.has(ch.id)) seenOnAir.delete(ch.id);
    }
    // Channels that went off air
    for (const id of seenOnAir) {
      if (!channels.find(c => c.id === id)) seenOnAir.delete(id);
    }
  };

  const timer = setInterval(check, intervalMs);
  return () => clearInterval(timer);
}
