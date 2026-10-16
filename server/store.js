/**
 * Almacen de datos: un unico archivo JSON con escritura atomica,
 * copias de seguridad rotativas y consultas de agregacion para estadisticas.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  uid, nowIso, dayKey, daysAgo, ensureDir, writeFileAtomic, readJson,
  normalize, naturalCompare,
} from './util.js';

export const STATUSES = [
  { id: 'playing', label: 'Jugando', color: '#3ddc97' },
  { id: 'backlog', label: 'Pendiente', color: '#7c9cff' },
  { id: 'completed', label: 'Completado', color: '#c792ea' },
  { id: 'onhold', label: 'En pausa', color: '#ffc857' },
  { id: 'abandoned', label: 'Abandonado', color: '#ff6b81' },
  { id: 'wishlist', label: 'Lista de deseos', color: '#59c2ff' },
];

export const PLATFORMS = {
  steam: { label: 'Steam', color: '#4a9bd1' },
  epic: { label: 'Epic', color: '#b8b8c4' },
  gog: { label: 'GOG', color: '#a06cd5' },
  heroic: { label: 'Heroic', color: '#e0654f' },
  xbox: { label: 'Xbox', color: '#59c65b' },
  battlenet: { label: 'Battle.net', color: '#3b8fe0' },
  ea: { label: 'EA App', color: '#f24c56' },
  ubisoft: { label: 'Ubisoft', color: '#4b9df5' },
  itch: { label: 'itch.io', color: '#fa5c5c' },
  lutris: { label: 'Lutris', color: '#d9a441' },
  emulator: { label: 'Emulador', color: '#57c7c7' },
  manual: { label: 'Manual', color: '#8d93a1' },
};

const MAX_SESSIONS_PER_GAME = 300;
const BACKUPS = 5;

function defaultSettings() {
  return {
    scanRoots: [],
    emulatorProfiles: [],
    sources: {
      steam: true,
      epic: true,
      gog: true,
      heroic: true,
      xbox: true,
      lutris: true,
      itch: false,
    },
    autoScanOnStart: false,
    trackPlaytime: true,
    closeLauncher: false,
    /* descarga (una sola vez) las carátulas oficiales desde el CDN de la tienda */
    fetchRemoteArt: true,
    view: {
      mode: 'grid',
      sort: 'name',
      direction: 'asc',
      coverScale: 1,
      group: 'none',
      status: 'all',
      platform: 'all',
      tag: 'all',
    },
    theme: {
      accent: '#7c5cff',
      density: 'comfortable',
      background: 'aurora',
    },
    demo: false,
  };
}

function defaultDatabase() {
  return {
    version: 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    settings: defaultSettings(),
    games: [],
    activeSessions: [],
  };
}

export class Store extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.db = defaultDatabase();
    this.saveTimer = null;
    this.saving = null;
    this.dirty = false;
  }

  /* ------------------------------------------------------------ ciclo de vida */

  async load() {
    const raw = await readJson(this.file, null);
    if (raw && typeof raw === 'object') {
      this.db = this.#migrate(raw);
    } else {
      this.db = defaultDatabase();
      await this.flush();
    }
    await this.#recoverSessions();
    return this.db;
  }

  #migrate(raw) {
    const base = defaultDatabase();
    const db = {
      ...base,
      ...raw,
      settings: {
        ...base.settings,
        ...(raw.settings || {}),
        sources: { ...base.settings.sources, ...(raw.settings?.sources || {}) },
        view: { ...base.settings.view, ...(raw.settings?.view || {}) },
        theme: { ...base.settings.theme, ...(raw.settings?.theme || {}) },
        scanRoots: Array.isArray(raw.settings?.scanRoots) ? raw.settings.scanRoots : [],
        emulatorProfiles: Array.isArray(raw.settings?.emulatorProfiles) ? raw.settings.emulatorProfiles : [],
      },
      games: Array.isArray(raw.games) ? raw.games.map((g) => normalizeGame(g)) : [],
      activeSessions: Array.isArray(raw.activeSessions) ? raw.activeSessions : [],
    };
    return db;
  }

  /** Cierra sesiones huerfanas que quedaron abiertas tras un cierre inesperado. */
  async #recoverSessions() {
    const { listProcesses } = await import('./util.js');
    const alive = new Set((await listProcesses()).map((p) => p.pid));
    let changed = false;
    for (const session of this.db.activeSessions) {
      const found = alive.has(session.pid);
      if (!found) {
        const game = this.get(session.gameId);
        if (game) {
          const end = session.lastSeen || nowIso();
          const seconds = Math.max(0, Math.round((new Date(end) - new Date(session.start)) / 1000));
          this.#pushSession(game, {
            start: session.start,
            end,
            seconds,
            detected: 'recuperado',
          });
          changed = true;
        }
      }
    }
    this.db.activeSessions = [];
    if (changed) this.scheduleSave();
  }

  scheduleSave(delay = 400) {
    this.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.flush().catch((err) => this.emit('error', err));
    }, delay);
    if (this.saveTimer.unref) this.saveTimer.unref();
  }

  async flush() {
    if (this.saving) {
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => {
        this.flush().catch(() => {});
      }, 200);
      if (this.saveTimer.unref) this.saveTimer.unref();
      return this.saving;
    }
    this.db.updatedAt = nowIso();
    const payload = JSON.stringify(this.db, null, 2);
    this.saving = (async () => {
      await this.#rotateBackup();
      await writeFileAtomic(this.file, payload);
      this.dirty = false;
    })().finally(() => {
      this.saving = null;
    });
    return this.saving;
  }

  async #rotateBackup() {
    try {
      const backupDir = path.join(path.dirname(this.file), 'backups');
      const current = await readJson(this.file, null);
      if (!current) return;
      const games = Array.isArray(current.games) ? current.games.length : 0;
      if (!games) return;
      await ensureDir(backupDir);
      const stamp = dayKey().replace(/-/g, '');
      const target = path.join(backupDir, `biblioteca-${stamp}.json`);
      const exists = await fsp.stat(target).then(() => true).catch(() => false);
      if (!exists) await writeFileAtomic(target, JSON.stringify(current, null, 1));
      const files = (await fsp.readdir(backupDir)).filter((f) => f.startsWith('biblioteca-')).sort();
      while (files.length > BACKUPS) {
        const old = files.shift();
        await fsp.rm(path.join(backupDir, old), { force: true });
      }
    } catch {
      /* los respaldos son best-effort */
    }
  }

  /* ---------------------------------------------------------------- lecturas */

  get settings() {
    return this.db.settings;
  }

  list() {
    return this.db.games;
  }

  get(id) {
    return this.db.games.find((g) => g.id === id) || null;
  }

  findBySource(platform, sourceId) {
    if (!sourceId) return null;
    return this.db.games.find((g) => normalize(g.sourceId) === normalize(sourceId) && (platform ? g.platform === platform : true)) || null;
  }

  findByName(name) {
    const key = normalize(name);
    if (!key) return null;
    return this.db.games.find((g) => normalize(g.name) === key) || null;
  }

  /* --------------------------------------------------------------- escrituras */

  async add(input, { dedupe = true } = {}) {
    const game = normalizeGame({ ...input, id: input.id || uid('g'), addedAt: nowIso() });
    if (dedupe) {
      const rom = game.extra?.rom || null;
      const existing =
        (game.sourceId && this.findBySource(game.platform, game.sourceId)) ||
        (rom && this.db.games.find((g) => g.extra?.rom === rom)) ||
        (game.executable && this.db.games.find((g) => g.executable && g.executable === game.executable)) ||
        /* la carpeta identifica al juego, salvo en ROMs: varias ROMs comparten carpeta */
        (!rom && game.installDir && this.db.games.find((g) => g.installDir && g.installDir === game.installDir && !g.extra?.rom)) ||
        null;
      if (existing) {
        const merged = { ...existing, ...stripEmpty(game), id: existing.id, addedAt: existing.addedAt, sessions: existing.sessions };
        Object.assign(existing, normalizeGame(merged));
        this.scheduleSave();
        return { game: existing, created: false };
      }
    }
    this.db.games.push(game);
    this.scheduleSave();
    return { game, created: true };
  }

  async update(id, patch) {
    const game = this.get(id);
    if (!game) return null;
    const clean = stripProtected(patch);
    Object.assign(game, normalizeGame({ ...game, ...clean, id: game.id }));
    this.scheduleSave();
    return game;
  }

  async remove(id) {
    const index = this.db.games.findIndex((g) => g.id === id);
    if (index === -1) return false;
    this.db.games.splice(index, 1);
    this.db.activeSessions = this.db.activeSessions.filter((s) => s.gameId !== id);
    this.scheduleSave();
    return true;
  }

  async removeMany(ids) {
    const set = new Set(ids);
    const before = this.db.games.length;
    this.db.games = this.db.games.filter((g) => !set.has(g.id));
    this.db.activeSessions = this.db.activeSessions.filter((s) => !set.has(s.gameId));
    this.scheduleSave();
    return before - this.db.games.length;
  }

  setSettings(patch) {
    const s = this.db.settings;
    if (patch.sources) patch.sources = { ...s.sources, ...patch.sources };
    if (patch.view) patch.view = { ...s.view, ...patch.view };
    if (patch.theme) patch.theme = { ...s.theme, ...patch.theme };
    Object.assign(s, patch);
    this.scheduleSave();
    return s;
  }

  /* ---------------------------------------------------------------- sesiones */

  startSession(game, info) {
    const session = {
      id: uid('s'),
      gameId: game.id,
      start: nowIso(),
      lastSeen: nowIso(),
      pid: info.pid || null,
      process: info.process || null,
      match: info.match || null,
      simulated: Boolean(info.simulated),
      seconds: 0,
    };
    this.db.activeSessions = this.db.activeSessions.filter((s) => s.gameId !== game.id);
    this.db.activeSessions.push(session);
    game.playCount = (game.playCount || 0) + 1;
    game.lastPlayed = session.start;
    if (game.status === 'backlog' || game.status === 'wishlist' || !game.status) game.status = 'playing';
    this.scheduleSave(120);
    return session;
  }

  heartBeat(sessionId, patch = {}) {
    const session = this.db.activeSessions.find((s) => s.id === sessionId);
    if (!session) return null;
    Object.assign(session, patch, { lastSeen: nowIso() });
    session.seconds = Math.max(0, Math.round((new Date(session.lastSeen) - new Date(session.start)) / 1000));
    return session;
  }

  endSession(sessionId, { detected = 'proceso finalizado' } = {}) {
    const index = this.db.activeSessions.findIndex((s) => s.id === sessionId);
    if (index === -1) return null;
    const [session] = this.db.activeSessions.splice(index, 1);
    const game = this.get(session.gameId);
    if (!game) return session;
    const end = nowIso();
    const seconds = Math.max(0, Math.round((new Date(end) - new Date(session.start)) / 1000));
    const entry = this.#pushSession(game, { start: session.start, end, seconds, detected, simulated: session.simulated });
    game.lastPlayed = end;
    this.scheduleSave(120);
    this.emit('session:end', { game, session: entry });
    return entry;
  }

  #pushSession(game, entry) {
    game.sessions = Array.isArray(game.sessions) ? game.sessions : [];
    game.sessions.push(entry);
    if (game.sessions.length > MAX_SESSIONS_PER_GAME) {
      game.sessions = game.sessions.slice(-MAX_SESSIONS_PER_GAME);
    }
    game.playtimeSeconds = game.sessions.reduce((sum, s) => sum + (s.seconds || 0), 0) + (game.manualPlaytimeSeconds || 0);
    if (!game.firstPlayed) game.firstPlayed = entry.start;
    return entry;
  }

  activeFor(gameId) {
    return this.db.activeSessions.find((s) => s.gameId === gameId) || null;
  }

  get activeSessions() {
    return this.db.activeSessions;
  }

  /* ------------------------------------------------------------ import/export */

  exportPayload() {
    /* copia profunda: el archivo exportado no debe seguir cambiando con la app */
    return structuredClone({
      app: 'ludoteca',
      version: 1,
      exportedAt: nowIso(),
      settings: this.db.settings,
      games: this.db.games,
    });
  }

  async importPayload(payload, { mode = 'merge' } = {}) {
    if (!payload || !Array.isArray(payload.games)) throw new Error('Formato no reconocido');
    if (mode === 'replace') {
      this.db.games = [];
    }
    let added = 0;
    let updated = 0;
    for (const raw of payload.games) {
      const game = normalizeGame(raw);
      if (!game.name) continue;
      const existing = this.get(game.id) || this.findByName(game.name);
      if (existing) {
        Object.assign(existing, { ...game, id: existing.id, addedAt: existing.addedAt });
        updated++;
      } else {
        game.id = game.id || uid('g');
        this.db.games.push(game);
        added++;
      }
    }
    if (payload.settings) {
      const roots = payload.settings.scanRoots || [];
      const profiles = payload.settings.emulatorProfiles || [];
      const merged = [...this.db.settings.scanRoots];
      for (const root of roots) {
        if (!merged.some((r) => r.path === root.path)) merged.push(root);
      }
      this.setSettings({ scanRoots: merged, emulatorProfiles: [...this.db.settings.emulatorProfiles, ...profiles] });
    }
    await this.flush();
    return { added, updated, total: this.db.games.length };
  }

  /* ------------------------------------------------------------ estadisticas */

  stats() {
    const games = this.db.games.filter((g) => !g.hidden);
    const totalSeconds = games.reduce((sum, g) => sum + (g.playtimeSeconds || 0), 0);
    const byPlatform = {};
    for (const g of games) {
      const key = g.platform || 'manual';
      byPlatform[key] = byPlatform[key] || { count: 0, seconds: 0 };
      byPlatform[key].count++;
      byPlatform[key].seconds += g.playtimeSeconds || 0;
    }
    const byStatus = {};
    for (const s of STATUSES) byStatus[s.id] = 0;
    for (const g of games) byStatus[g.status || 'backlog'] = (byStatus[g.status || 'backlog'] || 0) + 1;

    const byTag = {};
    for (const g of games) {
      for (const tag of g.tags || []) byTag[tag] = (byTag[tag] || 0) + 1;
      for (const genre of g.genres || []) byTag[genre] = (byTag[genre] || 0) + 1;
    }

    const dayMap = new Map();
    for (const g of games) {
      for (const s of g.sessions || []) {
        const key = dayKey(s.start);
        dayMap.set(key, (dayMap.get(key) || 0) + (s.seconds || 0));
      }
    }
    const last90 = [];
    for (let i = 89; i >= 0; i--) {
      const key = dayKey(daysAgo(i));
      last90.push({ day: key, seconds: dayMap.get(key) || 0 });
    }
    const last30 = last90.slice(-30);

    const top = [...games]
      .sort((a, b) => (b.playtimeSeconds || 0) - (a.playtimeSeconds || 0))
      .slice(0, 8)
      .map((g) => ({ id: g.id, name: g.name, platform: g.platform, seconds: g.playtimeSeconds || 0, cover: `/api/games/${g.id}/cover` }));

    const recent = [...games]
      .filter((g) => g.lastPlayed)
      .sort((a, b) => new Date(b.lastPlayed) - new Date(a.lastPlayed))
      .slice(0, 8)
      .map((g) => ({ id: g.id, name: g.name, platform: g.platform, lastPlayed: g.lastPlayed, seconds: g.playtimeSeconds || 0, cover: `/api/games/${g.id}/cover` }));

    /* racha de dias consecutivos jugando */
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const key = dayKey(daysAgo(i));
      const value = dayMap.get(key) || 0;
      if (value > 0) streak++;
      else if (i > 0) break;
    }

    /* juegos agregados por mes (ultimos 12) */
    const addedByMonth = new Map();
    for (const g of games) {
      if (!g.addedAt) continue;
      const key = String(g.addedAt).slice(0, 7);
      addedByMonth.set(key, (addedByMonth.get(key) || 0) + 1);
    }
    const months = [];
    const cursor = new Date();
    cursor.setDate(1);
    for (let i = 11; i >= 0; i--) {
      const d = new Date(cursor);
      d.setMonth(cursor.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push({ month: key, count: addedByMonth.get(key) || 0 });
    }

    return {
      totals: {
        games: games.length,
        hidden: this.db.games.length - games.length,
        favorites: games.filter((g) => g.favorite).length,
        seconds: totalSeconds,
        sessions: games.reduce((sum, g) => sum + (g.sessions?.length || 0), 0),
        completed: byStatus.completed || 0,
        neverPlayed: games.filter((g) => !g.playtimeSeconds).length,
        avgSeconds: games.length ? Math.round(totalSeconds / games.length) : 0,
      },
      byPlatform,
      byStatus,
      byTag: Object.entries(byTag)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 24)
        .map(([tag, count]) => ({ tag, count })),
      activity: { last30, last90, streak },
      top,
      recent,
      months,
      generatedAt: nowIso(),
    };
  }

  /** Agrupa la biblioteca para la vista lateral. */
  facets() {
    const games = this.db.games;
    const platforms = new Map();
    const tags = new Map();
    for (const g of games) {
      platforms.set(g.platform || 'manual', (platforms.get(g.platform || 'manual') || 0) + 1);
      for (const tag of [...(g.tags || []), ...(g.genres || [])]) {
        tags.set(tag, (tags.get(tag) || 0) + 1);
      }
    }
    return {
      total: games.length,
      platforms: [...platforms.entries()]
        .map(([id, count]) => ({ id, label: PLATFORMS[id]?.label || id, color: PLATFORMS[id]?.color || '#8d93a1', count }))
        .sort((a, b) => b.count - a.count),
      tags: [...tags.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || naturalCompare(a.name, b.name)),
      statuses: STATUSES.map((s) => ({ ...s, count: games.filter((g) => (g.status || 'backlog') === s.id).length })),
    };
  }
}

/* ------------------------------------------------------------------ helpers */

function stripEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === '' || v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

function stripProtected(patch) {
  const out = { ...patch };
  delete out.id;
  delete out.sessions;
  delete out.addedAt;
  return out;
}

export function normalizeGame(input = {}) {
  const sessions = Array.isArray(input.sessions)
    ? input.sessions
        .filter((s) => s && s.start)
        .map((s) => ({
          start: s.start,
          end: s.end || s.start,
          seconds: Math.max(0, Math.round(Number(s.seconds) || 0)),
          detected: s.detected || undefined,
          simulated: s.simulated || undefined,
        }))
        .slice(-MAX_SESSIONS_PER_GAME)
    : [];
  const manual = Math.max(0, Math.round(Number(input.manualPlaytimeSeconds) || 0));
  const playtime = sessions.reduce((sum, s) => sum + s.seconds, 0) + manual;
  return {
    id: input.id || uid('g'),
    name: String(input.name || '').trim(),
    platform: input.platform || 'manual',
    sourceId: input.sourceId ? String(input.sourceId) : null,
    installDir: input.installDir || null,
    executable: input.executable || null,
    launchArgs: input.launchArgs ? String(input.launchArgs) : '',
    workDir: input.workDir || null,
    launchCommand: input.launchCommand || null,
    emulatorProfileId: input.emulatorProfileId || null,
    coverFile: input.coverFile || null,
    coverUrl: input.coverUrl || null,
    backgroundFile: input.backgroundFile || null,
    backgroundUrl: input.backgroundUrl || null,
    iconFile: input.iconFile || null,
    description: input.description || '',
    notes: input.notes || '',
    genres: toArray(input.genres),
    tags: toArray(input.tags),
    developers: toArray(input.developers),
    publishers: toArray(input.publishers),
    releaseDate: input.releaseDate || null,
    rating: Number(input.rating) || 0,
    criticScore: Number(input.criticScore) || 0,
    status: STATUSES.some((s) => s.id === input.status) ? input.status : 'backlog',
    favorite: Boolean(input.favorite),
    hidden: Boolean(input.hidden),
    emulator: Boolean(input.emulator),
    demo: Boolean(input.demo),
    manualPlaytimeSeconds: manual,
    playtimeSeconds: playtime,
    playCount: Number(input.playCount) || 0,
    lastPlayed: input.lastPlayed || null,
    firstPlayed: input.firstPlayed || null,
    addedAt: input.addedAt || nowIso(),
    sizeBytes: Number(input.sizeBytes) || 0,
    sessions,
    extra: input.extra && typeof input.extra === 'object' ? input.extra : {},
  };
}

function toArray(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map((v) => v.trim()).filter(Boolean);
  }
  return [];
}
