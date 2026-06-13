// Favorites persisted to localStorage (web) or Tauri Store (desktop).
const isTauri = typeof window.__TAURI__ !== 'undefined';

let _store = null;

async function getStore() {
  if (_store) return _store;
  if (isTauri) {
    const { Store } = await import('@tauri-apps/plugin-store');
    _store = await Store.load('favorites.json', { autoSave: true });
  }
  return _store;
}

export async function getFavorites() {
  if (isTauri) {
    const store = await getStore();
    return (await store.get('channels')) ?? [];
  }
  try {
    return JSON.parse(localStorage.getItem('rc_favorites') ?? '[]');
  } catch { return []; }
}

export async function isFavorite(id) {
  const favs = await getFavorites();
  return favs.some(f => f.id === id);
}

export async function toggleFavorite(channel) {
  const favs = await getFavorites();
  const idx = favs.findIndex(f => f.id === channel.id);
  const next = idx >= 0
    ? favs.filter((_, i) => i !== idx)
    : [...favs, { id: channel.id, name: channel.name }];

  if (isTauri) {
    const store = await getStore();
    await store.set('channels', next);
  } else {
    localStorage.setItem('rc_favorites', JSON.stringify(next));
  }
  return next;
}
