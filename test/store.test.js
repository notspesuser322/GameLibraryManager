/**
 * Pruebas del almacen de datos.
 * Se ejecutan con: npm test  (node --test test/)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';

import { Store, normalizeGame } from '../server/store.js';

async function tempStore() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nebula-store-'));
  const store = new Store(path.join(dir, 'biblioteca.json'));
  await store.load();
  return { store, dir };
}

test('normalizeGame calcula el tiempo total y normaliza campos', () => {
  const game = normalizeGame({
    name: '  Prueba  ',
    genres: 'rpg, aventura',
    tags: 'coop',
    sessions: [
      { start: '2024-01-01T10:00:00.000Z', end: '2024-01-01T11:00:00.000Z', seconds: 3600 },
      { start: '2024-01-02T10:00:00.000Z', end: '2024-01-02T10:30:00.000Z', seconds: 1800 },
    ],
    manualPlaytimeSeconds: 600,
    status: 'inventado',
  });
  assert.equal(game.name, 'Prueba');
  assert.deepEqual(game.genres, ['rpg', 'aventura']);
  assert.deepEqual(game.tags, ['coop']);
  assert.equal(game.playtimeSeconds, 3600 + 1800 + 600);
  assert.equal(game.status, 'backlog', 'un estado invalido cae en backlog');
  assert.ok(game.id.startsWith('g_'));
});

test('add crea el juego y evita duplicados por ejecutable y carpeta', async () => {
  const { store } = await tempStore();
  const first = await store.add({ name: 'Alpha', installDir: '/juegos/alpha', executable: '/juegos/alpha/alpha.exe' });
  assert.equal(first.created, true);

  const sameExe = await store.add({ name: 'Alpha (otra copia)', executable: '/juegos/alpha/alpha.exe' });
  assert.equal(sameExe.created, false, 'mismo ejecutable => se actualiza');
  assert.equal(store.list().length, 1);

  const sameDir = await store.add({ name: 'Alpha extra', installDir: '/juegos/alpha' });
  assert.equal(sameDir.created, false);
  assert.equal(store.list().length, 1);

  const other = await store.add({ name: 'Beta', installDir: '/juegos/beta' });
  assert.equal(other.created, true);
  assert.equal(store.list().length, 2);
});

test('add no fusiona ROMs que comparten carpeta', async () => {
  const { store } = await tempStore();
  const a = await store.add({
    name: 'Chrono Trigger', platform: 'emulator', installDir: '/roms/snes',
    extra: { rom: '/roms/snes/Chrono Trigger.sfc', console: 'snes' },
  });
  const b = await store.add({
    name: 'Super Metroid', platform: 'emulator', installDir: '/roms/snes',
    extra: { rom: '/roms/snes/Super Metroid.sfc', console: 'snes' },
  });
  assert.equal(a.created, true);
  assert.equal(b.created, true);
  assert.equal(store.list().length, 2);

  /* volver a escanear la misma ROM actualiza, no duplica */
  const again = await store.add({ name: 'Chrono Trigger', extra: { rom: '/roms/snes/Chrono Trigger.sfc' } });
  assert.equal(again.created, false);
  assert.equal(store.list().length, 2);
});

test('sesiones: iniciar, latido y cerrar acumulan tiempo', async () => {
  const { store } = await tempStore();
  const { game } = await store.add({ name: 'Sesionable', status: 'backlog', playtimeSeconds: 0 });

  const session = store.startSession(game, { pid: 4321, process: 'juego.exe' });
  assert.ok(store.activeFor(game.id), 'hay una sesion activa');
  assert.equal(store.activeFor(game.id).pid, 4321);
  assert.equal(game.status, 'playing', 'pasa a "jugando" al iniciar');
  assert.equal(game.playCount, 1);

  /* simular que la sesion empezo hace 10 minutos */
  session.start = new Date(Date.now() - 600_000).toISOString();
  store.heartBeat(session.id);
  const ended = store.endSession(session.id, { detected: 'prueba' });
  assert.ok(ended.seconds >= 599 && ended.seconds <= 601, `segundos inesperados: ${ended.seconds}`);
  assert.equal(store.activeFor(game.id), null);
  assert.equal(game.sessions.length, 1);
  assert.ok(game.playtimeSeconds >= 599);
  assert.ok(game.lastPlayed, 'queda registrada la ultima partida');
});

test('stats agrega totales, tiempos por plataforma y racha', async () => {
  const { store } = await tempStore();
  const yesterday = new Date(Date.now() - 86400_000).toISOString();
  const today = new Date().toISOString();
  await store.add({
    name: 'Uno', platform: 'steam', status: 'completed',
    sessions: [
      { start: today, end: today, seconds: 3600 },
      { start: yesterday, end: yesterday, seconds: 1800 },
    ],
  });
  await store.add({ name: 'Dos', platform: 'gog', status: 'backlog' });

  const stats = store.stats();
  assert.equal(stats.totals.games, 2);
  assert.equal(stats.totals.seconds, 5400);
  assert.equal(stats.totals.completed, 1);
  assert.equal(stats.totals.neverPlayed, 1);
  assert.equal(stats.byPlatform.steam.seconds, 5400);
  assert.equal(stats.byPlatform.gog.count, 1);
  assert.equal(stats.activity.last90.length, 90);
  assert.equal(stats.activity.last30.at(-1).day, today.slice(0, 10));
  assert.ok(stats.activity.streak >= 2, 'dos dias seguidos jugando');
  assert.equal(stats.top[0].name, 'Uno');
});

test('facets agrupa plataformas, etiquetas y estados', async () => {
  const { store } = await tempStore();
  await store.add({ name: 'A', platform: 'steam', tags: ['coop'], genres: ['rpg'], status: 'playing' });
  await store.add({ name: 'B', platform: 'steam', tags: ['coop'], status: 'completed' });
  await store.add({ name: 'C', platform: 'epic', status: 'playing' });

  const facets = store.facets();
  assert.equal(facets.total, 3);
  assert.equal(facets.platforms.find((p) => p.id === 'steam').count, 2);
  assert.equal(facets.tags.find((t) => t.name === 'coop').count, 2);
  assert.equal(facets.statuses.find((s) => s.id === 'playing').count, 2);
});

test('update protege id, sesiones y fecha de alta', async () => {
  const { store } = await tempStore();
  const { game } = await store.add({ name: 'Original', sessions: [{ start: '2024-01-01T00:00:00.000Z', end: '2024-01-01T01:00:00.000Z', seconds: 3600 }] });
  const before = { id: game.id, addedAt: game.addedAt, sessions: game.sessions.length };
  const updated = await store.update(game.id, {
    name: 'Renombrado',
    id: 'otro-id',
    addedAt: '1999-01-01T00:00:00.000Z',
    sessions: [],
    playtimeSeconds: 999,
  });
  assert.equal(updated.name, 'Renombrado');
  assert.equal(updated.id, before.id);
  assert.equal(updated.addedAt, before.addedAt);
  assert.equal(updated.sessions.length, before.sessions);
  assert.equal(updated.playtimeSeconds, 3600, 'el tiempo se deriva de las sesiones');
});

test('persistencia: la biblioteca sobrevive a una recarga', async () => {
  const { store, dir } = await tempStore();
  await store.add({ name: 'Persistente', platform: 'steam', tags: ['x'] });
  await store.flush();

  const reloaded = new Store(path.join(dir, 'biblioteca.json'));
  await reloaded.load();
  assert.equal(reloaded.list().length, 1);
  assert.equal(reloaded.list()[0].name, 'Persistente');
  assert.deepEqual(reloaded.list()[0].tags, ['x']);
});

test('import/export: fusionar y reemplazar', async () => {
  const { store } = await tempStore();
  await store.add({ name: 'Uno', platform: 'steam' });
  const payload = store.exportPayload();
  assert.equal(payload.games.length, 1);
  assert.equal(payload.app, 'nebula');

  await store.add({ name: 'Dos', platform: 'gog' });
  const merged = await store.importPayload({ games: [{ name: 'Tres', platform: 'epic' }] });
  assert.equal(merged.added, 1);
  assert.equal(store.list().length, 3);

  const replaced = await store.importPayload(payload, { mode: 'replace' });
  assert.equal(replaced.total, 1);
  assert.equal(store.list()[0].name, 'Uno');
});

test('setSettings combina objetos anidados sin perder claves', async () => {
  const { store } = await tempStore();
  store.setSettings({ sources: { steam: false }, view: { mode: 'list' } });
  assert.equal(store.settings.sources.steam, false);
  assert.equal(store.settings.sources.epic, true, 'las demas fuentes se conservan');
  assert.equal(store.settings.view.mode, 'list');
  assert.equal(store.settings.view.sort, 'name', 'las demás claves de vista se conservan');
});

test('removeMany y remove quitan juegos y sus sesiones activas', async () => {
  const { store } = await tempStore();
  const a = await store.add({ name: 'A' });
  const b = await store.add({ name: 'B' });
  store.startSession(a.game, { pid: 1 });
  assert.equal(store.activeFor(a.game.id) !== null, true);

  assert.equal(await store.remove(a.game.id), true);
  assert.equal(store.activeFor(a.game.id), null);
  assert.equal(await store.removeMany([b.game.id]), 1);
  assert.equal(store.list().length, 0);
});
