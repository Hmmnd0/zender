const DIRECTORY = import.meta.env.VITE_DIRECTORY_URL ?? '/api';

export async function fetchChannels({ type, genre, sort } = {}) {
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (genre) params.set('genre', genre);
  if (sort) params.set('sort', sort);
  const res = await fetch(`${DIRECTORY}/channels?${params}`);
  if (!res.ok) throw new Error('Failed to fetch channels');
  return res.json();
}
