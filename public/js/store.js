/* Estado del cliente: datos, filtros, suscripciones y reloj en vivo. */
import { api } from './api.js';

const listeners = new Set();

export const state = {
  ready: false,
  loading: false,
  games: [],
  facets: { platforms: [], tags: [], statuses: [], total: 0 },
  stats: null,
  settings: null,
  platforms: [],
  statuses: [],
  consoles: [],
  emulatorPresets: [],
  launcher: { sessions: {}, count: 0, log: [] },
  scan: { running: false, summary: null },
  app: { version: '1.1.0', platform: 'linux', dataDir: '' },
  view: 'library',
  query: {
    search: '',
    status: 'all',
    platform: 'all',
    tag: 'all',
    favorite: false,
    hidden: false,
    sort: 'lastPlayed',
    direction: 'desc',
    group: 'none',
    mode: 'grid',
    coverScale: 1,
  },
  fetchedAt: Date.now(),
  /* juegos que el usuario acaba de detener: se ocultan hasta que el servidor confirma el cierre */
  stopping: {},
  selectedId: null,
  activity: null,
  error: null,
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(event = 'change') {
  for (const fn of listeners) fn(event, state);
}

export function setView(view) {
  state.view = view;
  emit('view');
}

export function updateQuery(patch) {
  Object.assign(state.query, patch);
  persistQuery();
  refresh({ quiet: true });
  emit('query');
}

export function toggleFavoriteFilter() {
  state.query.favorite = !state.query.favorite;
  persistQuery();
  refresh({ quiet: true });
  emit('query');
}

function persistQuery() {
  try {
    localStorage.setItem('ludoteca:query', JSON.stringify(state.query));
  } catch {
    /* almacenamiento no disponible */
  }
}

export function restoreQuery() {
  try {
    const raw = localStorage.getItem('ludoteca:query');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    Object.assign(state.query, parsed, { search: '' });
  } catch {
    /* ignorar */
  }
}

let inflight = null;

/** Carga el estado completo (o solo la lista, si quiet = true). */
export async function refresh({ quiet = false } = {}) {
  if (inflight) return inflight;
  state.loading = true;
  if (!quiet) emit('loading');
  const params = {
    status: state.query.status,
    platform: state.query.platform,
    tag: state.query.tag,
    favorite: state.query.favorite ? '1' : '',
    hidden: state.query.hidden ? '1' : '',
    sort: state.query.sort,
    direction: state.query.direction,
    query: state.query.search,
  };
  inflight = (async () => {
    try {
      const data = await api.state(params);
      state.games = data.games;
      state.facets = data.facets;
      state.stats = data.stats;
      state.settings = data.settings;
      state.platforms = data.platforms;
      state.statuses = data.statuses;
      state.consoles = data.consoles;
      state.emulatorPresets = data.emulatorPresets;
      state.scan = data.scan;
      state.app = data.app;
      applyLauncherStatus(data.launcher);
      state.ready = true;
      state.error = null;
    } catch (err) {
      state.error = err.message;
      if (!quiet) throw err;
    } finally {
      state.loading = false;
      inflight = null;
      emit('change');
    }
  })();
  return inflight;
}

/** Sincroniza solo la lista con los filtros actuales (sin recargar estadísticas). */
export async function refreshGames() {
  const params = {
    status: state.query.status,
    platform: state.query.platform,
    tag: state.query.tag,
    favorite: state.query.favorite ? '1' : '',
    hidden: state.query.hidden ? '1' : '',
    sort: state.query.sort,
    direction: state.query.direction,
    query: state.query.search,
  };
  const data = await api.games(params);
  state.games = data.games;
  state.fetchedAt = Date.now();
  emit('change');
}

export async function refreshStats() {
  const stats = await api.state({});
  state.stats = stats.stats;
  state.facets = stats.facets;
  applyLauncherStatus(stats.launcher);
  emit('change');
}

export async function loadActivity() {
  state.activity = await api.sessions(120);
  emit('activity');
  return state.activity;
}

/* -------------------------------------------------------------- en vivo */

/**
 * Aplica el estado del lanzador que llega del servidor, respetando las paradas
 * recientes hechas por el usuario (el proceso puede tardar unos segundos en morir).
 */
export function applyLauncherStatus(status) {
  const sessions = { ...(status?.sessions || {}) };
  const now = Date.now();
  for (const [gameId, at] of Object.entries(state.stopping)) {
    if (now - at > 25000) {
      delete state.stopping[gameId];
      continue;
    }
    if (sessions[gameId]) delete sessions[gameId];
  }
  state.launcher = { ...(status || { count: 0, log: [] }), sessions, count: Object.keys(sessions).length };
  state.fetchedAt = now;
  return state.launcher;
}

export function markStopping(gameId) {
  state.stopping[gameId] = Date.now();
}

export function clearStopping(gameId) {
  delete state.stopping[gameId];
}

export function liveFor(gameId) {
  return state.launcher?.sessions?.[gameId] || null;
}

export function isRunning(gameId) {
  return Boolean(liveFor(gameId));
}

/** Segundos transcurridos de una sesión en curso, contando desde la última carga. */
export function elapsedSeconds(live) {
  if (!live) return 0;
  return Math.max(0, Math.round((live.elapsedSeconds || 0) + (Date.now() - state.fetchedAt) / 1000));
}

export function liveEntries() {
  const entries = [];
  for (const [gameId, live] of Object.entries(state.launcher?.sessions || {})) {
    const game = state.games.find((g) => g.id === gameId) || null;
    entries.push({ gameId, live, game });
  }
  return entries;
}

export function runningCount() {
  return Object.keys(state.launcher?.sessions || {}).length;
}

/* ------------------------------------------------------------- utilidades */

export function statusMeta(id) {
  return state.statuses.find((s) => s.id === id) || { id, label: id, color: '#8d93a1' };
}

export function platformMeta(id) {
  return state.platforms.find((p) => p.id === id) || { id, label: id, color: '#8d93a1' };
}

export function gameById(id) {
  return state.games.find((g) => g.id === id) || null;
}

export function totalPlaytime() {
  return state.games.reduce((sum, g) => sum + (g.playtimeSeconds || 0), 0);
}

export function featuredGame() {
  const running = liveEntries()[0]?.game;
  if (running) return running;
  const recent = state.games.filter((g) => g.lastPlayed).sort((a, b) => new Date(b.lastPlayed) - new Date(a.lastPlayed))[0];
  return recent || state.games[0] || null;
}

export function allTags() {
  return state.facets.tags || [];
}
