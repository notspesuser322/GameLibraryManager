/* Cliente de la API local. */

async function request(path, { method = 'GET', body, timeout = 240000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const type = response.headers.get('content-type') || '';
    if (!response.ok) {
      let message = `Error ${response.status}`;
      if (type.includes('json')) {
        const payload = await response.json().catch(() => null);
        message = payload?.error || message;
      }
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    if (type.includes('json')) return response.json();
    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

function toQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === 'all') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  health: () => request('/api/health'),
  state: (params) => request(`/api/state${toQuery(params)}`),
  games: (params) => request(`/api/games${toQuery(params)}`),
  game: (id) => request(`/api/games/${id}`),
  createGame: (payload) => request('/api/games', { method: 'POST', body: payload }),
  updateGame: (id, payload) => request(`/api/games/${id}`, { method: 'PATCH', body: payload }),
  deleteGame: (id) => request(`/api/games/${id}`, { method: 'DELETE' }),
  deleteGames: (ids) => request('/api/games', { method: 'DELETE', body: { ids } }),
  launch: (id) => request(`/api/games/${id}/launch`, { method: 'POST', body: {} }),
  stop: (id) => request(`/api/games/${id}/stop`, { method: 'POST', body: {} }),
  reveal: (id) => request(`/api/games/${id}/reveal`, { method: 'POST', body: {} }),
  openStore: (id) => request(`/api/games/${id}/open-store`, { method: 'POST', body: {} }),
  detectArt: (id) => request(`/api/games/${id}/detect-art`, { method: 'POST', body: {} }),
  analyze: (id) => request(`/api/games/${id}/analyze`, { method: 'POST', body: {} }),
  uploadArt: (id, kind, data) => request(`/api/games/${id}/${kind}`, { method: 'POST', body: { data } }),
  resetArt: (id, kind) => request(`/api/games/${id}/${kind}`, { method: 'DELETE' }),

  /* metadatos: búsqueda en Wikipedia, Wikidata, Steam y RAWG */
  metadataSearch: (params) => request(`/api/metadata/search${toQuery(params)}`),
  metadataProviders: () => request('/api/metadata/providers'),
  metadataSuggest: (name) => request(`/api/metadata/suggest${toQuery({ name })}`),
  metadataFill: (payload = {}) => request('/api/metadata/fill', { method: 'POST', body: payload }),
  applyMetadata: (gameId, payload) => request(`/api/games/${gameId}/metadata`, { method: 'POST', body: payload }),
  retryMetadataArt: (gameId) => request(`/api/games/${gameId}/metadata-art`, { method: 'POST', body: {} }),

  sessions: (limit = 80) => request(`/api/sessions?limit=${limit}`),
  addSession: (payload) => request('/api/sessions', { method: 'POST', body: payload }),
  removeSession: (gameId, index) => request(`/api/sessions?gameId=${gameId}&index=${index}`, { method: 'DELETE' }),
  clearSessions: (gameId) => request(`/api/sessions?gameId=${gameId}&all=1`, { method: 'DELETE' }),

  launcherStatus: () => request('/api/launcher'),
  stopAll: () => request('/api/launcher/stop-all', { method: 'POST', body: {} }),

  scan: (payload = {}) => request('/api/scan', { method: 'POST', body: payload }),
  scanLast: () => request('/api/scan'),
  importFindings: (findings, options) => request('/api/scan', { method: 'POST', body: { import: true, findings, options } }),

  roots: () => request('/api/roots'),
  addRoot: (payload) => request('/api/roots', { method: 'POST', body: payload }),
  removeRoot: (id) => request(`/api/roots?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),

  folders: (payload) => request('/api/folders', { method: 'POST', body: payload }),
  fs: (path) => request(`/api/fs${toQuery({ path })}`),

  emulators: () => request('/api/emulators'),
  addEmulator: (payload) => request('/api/emulators', { method: 'POST', body: payload }),
  updateEmulator: (id, payload) => request(`/api/emulators/${id}`, { method: 'PATCH', body: payload }),
  deleteEmulator: (id) => request(`/api/emulators/${id}`, { method: 'DELETE' }),

  settings: () => request('/api/settings'),
  saveSettings: (patch) => request('/api/settings', { method: 'PATCH', body: patch }),

  exportAll: () => request('/api/export'),
  importAll: (payload, mode = 'merge') => request('/api/import', { method: 'POST', body: { payload, mode } }),

  loadDemo: () => request('/api/demo', { method: 'POST', body: {} }),
  clearDemo: () => request('/api/demo', { method: 'DELETE' }),

  coverUrl: (id) => `/api/games/${id}/cover`,
  bannerUrl: (id) => `/api/games/${id}/banner`,
};
