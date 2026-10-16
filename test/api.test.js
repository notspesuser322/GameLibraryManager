/**
 * Prueba de integracion: arranca el servidor real en un puerto libre con datos
 * temporales y recorre la API completa, incluido el lanzamiento de ejemplo.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let child = null;
let base = '';
let dataDir = '';
let fixtureDir = '';

async function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function api(pathname, { method = 'GET', body, raw = false } = {}) {
  const response = await fetch(base + pathname, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return response;
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nebula-api-'));
  fixtureDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nebula-games-'));
  await fsp.mkdir(path.join(fixtureDir, 'Juego de Prueba'), { recursive: true });
  await fsp.writeFile(path.join(fixtureDir, 'Juego de Prueba', 'JuegoDePrueba.exe'), 'MZ');
  await fsp.writeFile(path.join(fixtureDir, 'Juego de Prueba', 'unins000.exe'), 'MZ');
  await fsp.writeFile(path.join(fixtureDir, 'Juego de Prueba', 'cover.jpg'), 'jpg');

  child = spawn(process.execPath, ['server/index.js', '--port', String(port), '--host', '127.0.0.1', '--data-dir', dataDir], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) break;
    } catch {
      /* todavía no escucha */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
});

after(async () => {
  if (child) {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 400));
    if (!child.killed) child.kill('SIGKILL');
  }
  await fsp.rm(dataDir, { recursive: true, force: true });
  await fsp.rm(fixtureDir, { recursive: true, force: true });
});

test('salud del servicio y datos básicos', async () => {
  const { status, payload } = await api('/api/health');
  assert.equal(status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.app, 'nebula');
  assert.equal(payload.platform, process.platform);
  assert.equal(payload.mode, 'normal');
});

test('sirve la interfaz y no deja salir de public/', async () => {
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /<title>Nébula/);
  assert.match(html, /\/js\/app\.js/);

  const css = await fetch(`${base}/styles.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);

  const traversal = await fetch(`${base}/..%2Fserver%2Findex.js`);
  assert.ok([403, 404].includes(traversal.status), `código inesperado: ${traversal.status}`);

  const missingApi = await api('/api/no-existe');
  assert.equal(missingApi.status, 404);
  assert.match(missingApi.payload.error, /no encontrada/i);
});

test('alta, edición y borrado de un juego', async () => {
  const created = await api('/api/games', { method: 'POST', body: { name: 'Probado', platform: 'manual', tags: ['test'] } });
  assert.equal(created.status, 201);
  const id = created.payload.game.id;
  assert.equal(created.payload.created, true);

  /* deduplicación por identidad real: mismo ejecutable o carpeta */
  await api(`/api/games/${id}`, { method: 'PATCH', body: { executable: '/juegos/probado/probado.exe', installDir: '/juegos/probado' } });
  const duplicated = await api('/api/games', { method: 'POST', body: { name: 'Otra cosa', executable: '/juegos/probado/probado.exe' } });
  assert.equal(duplicated.payload.created, false, 'mismo ejecutable => se actualiza');
  assert.equal(duplicated.payload.game.id, id);

  const other = await api('/api/games', { method: 'POST', body: { name: 'Probado', platform: 'manual' } });
  assert.equal(other.payload.created, true, 'un nombre repetido sin ruta puede convivir');
  await api(`/api/games/${other.payload.game.id}`, { method: 'DELETE' });

  const patched = await api(`/api/games/${id}`, { method: 'PATCH', body: { status: 'playing', rating: 7.5, playtimeSeconds: 5400 } });
  assert.equal(patched.payload.game.status, 'playing');
  assert.equal(patched.payload.game.rating, 7.5);
  assert.equal(patched.payload.game.playtimeSeconds, 5400);
  assert.equal(patched.payload.game.storedPlaytimeSeconds, 5400);

  const list = await api('/api/state');
  assert.ok(list.payload.games.some((g) => g.id === id));
  assert.equal(list.payload.facets.total, 1);
  assert.equal(list.payload.stats.totals.seconds, 5400);
  assert.equal(list.payload.platforms.length > 0, true);
  assert.equal(list.payload.statuses.length, 6);

  const removed = await api(`/api/games/${id}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  const empty = await api('/api/state');
  assert.equal(empty.payload.games.length, 0);
});

test('lanzamiento de un juego de ejemplo con seguimiento en vivo', async () => {
  const created = await api('/api/games', { method: 'POST', body: { name: 'Demostración', demo: true, status: 'backlog' } });
  const id = created.payload.game.id;

  const launched = await api(`/api/games/${id}/launch`, { method: 'POST', body: {} });
  assert.equal(launched.status, 200);
  assert.ok(launched.payload.session.id);

  const running = await api('/api/launcher');
  assert.equal(running.payload.count, 1);
  assert.equal(running.payload.sessions[id].simulated, true);

  const during = await api('/api/state');
  const game = during.payload.games.find((g) => g.id === id);
  assert.equal(game.running, true);
  assert.equal(game.status, 'playing', 'pasa a "jugando" automáticamente');
  assert.ok(game.live);

  const again = await api(`/api/games/${id}/launch`, { method: 'POST', body: {} });
  assert.equal(again.status, 400);

  const stopped = await api(`/api/games/${id}/stop`, { method: 'POST', body: {} });
  assert.equal(stopped.status, 200);

  const sessions = await api('/api/sessions?limit=10');
  assert.ok(sessions.payload.sessions.length >= 1);
  assert.equal(sessions.payload.sessions[0].gameId, id);
  assert.equal(typeof sessions.payload.sessions[0].seconds, 'number');
});

test('registro manual de sesiones y borrado del historial', async () => {
  const created = await api('/api/games', { method: 'POST', body: { name: 'Con historial' } });
  const id = created.payload.game.id;

  const added = await api('/api/sessions', { method: 'POST', body: { gameId: id, seconds: 1800 } });
  assert.equal(added.status, 200);
  assert.equal(added.payload.game.playtimeSeconds, 1800);
  assert.equal(added.payload.game.sessionCount, 1);

  await api('/api/sessions', { method: 'POST', body: { gameId: id, seconds: 1200 } });
  const two = await api(`/api/games/${id}`);
  assert.equal(two.payload.game.playtimeSeconds, 3000);
  assert.equal(two.payload.game.sessionCount, 2);

  const erased = await api(`/api/sessions?gameId=${id}&all=1`, { method: 'DELETE' });
  assert.equal(erased.payload.game.sessionCount, 0);
  assert.equal(erased.payload.game.playtimeSeconds, 0);

  const invalid = await api('/api/sessions', { method: 'POST', body: { gameId: id, seconds: 0 } });
  assert.equal(invalid.status, 400);
});

test('escaneo de una carpeta y alta de lo detectado', async () => {
  const scan = await api('/api/folders', { method: 'POST', body: { path: fixtureDir, kind: 'collection', withSize: true } });
  assert.equal(scan.status, 200);
  assert.equal(scan.payload.kind, 'collection');
  const findings = scan.payload.findings;
  assert.equal(findings.length, 1);
  assert.equal(findings[0].name, 'Juego de Prueba');
  assert.match(findings[0].executable, /JuegoDePrueba\.exe$/);
  assert.ok(findings[0].sizeBytes > 0);

  const imported = await api('/api/scan', { method: 'POST', body: { import: true, findings: findings.map((candidate) => ({ candidate })), options: { status: 'backlog', tags: ['detectado'] } } });
  assert.equal(imported.payload.added, 1);

  const state = await api('/api/state');
  const game = state.payload.games.find((g) => g.name === 'Juego de Prueba');
  assert.ok(game, 'el juego aparece en la biblioteca');
  assert.deepEqual(game.tags, ['detectado']);
  assert.match(game.cover, /cover$/);
  assert.equal(game.pathExists, true, 'la ruta existe');

  /* volver a importar actualiza en lugar de duplicar */
  const again = await api('/api/scan', { method: 'POST', body: { import: true, findings: [{ candidate: findings[0], existingId: game.id }], options: {} } });
  assert.equal(again.payload.added, 0);
  assert.equal(again.payload.updated, 1);
  const after = await api('/api/state');
  assert.equal(after.payload.games.filter((g) => g.name === 'Juego de Prueba').length, 1);
});

test('carpetas vigiladas y escaneo completo', async () => {
  const created = await api('/api/roots', { method: 'POST', body: { path: fixtureDir, kind: 'collection', label: 'Pruebas' } });
  assert.equal(created.status, 201);
  const rootId = created.payload.root.id;

  const listed = await api('/api/roots');
  assert.equal(listed.payload.roots.length, 1);

  const scan = await api('/api/scan', { method: 'POST', body: { sources: { steam: false, epic: false, gog: false, heroic: false, lutris: false }, roots: listed.payload.roots } });
  assert.equal(scan.status, 200);
  assert.ok(scan.payload.scanned.some((s) => s.source.startsWith('carpeta:')));
  assert.ok(scan.payload.findings.some((f) => f.candidate.name === 'Juego de Prueba'));

  const removed = await api(`/api/roots?id=${rootId}`, { method: 'DELETE' });
  assert.equal(removed.payload.roots.length, 0);
});

test('perfiles de emulador', async () => {
  const created = await api('/api/emulators', { method: 'POST', body: { name: 'RetroArch', command: 'retroarch -L {core} "{rom}"', consoles: ['snes', 'nes'] } });
  assert.equal(created.status, 201);
  const id = created.payload.profile.id;

  const list = await api('/api/emulators');
  assert.equal(list.payload.profiles.length, 1);
  assert.ok(list.payload.presets.length > 0, 'hay plantillas sugeridas');
  assert.ok(list.payload.consoles.some((c) => c.id === 'snes'));

  const updated = await api(`/api/emulators/${id}`, { method: 'PATCH', body: { name: 'RetroArch 2' } });
  assert.equal(updated.payload.profiles[0].name, 'RetroArch 2');

  await api(`/api/emulators/${id}`, { method: 'DELETE' });
  const after = await api('/api/emulators');
  assert.equal(after.payload.profiles.length, 0);

  const invalid = await api('/api/emulators', { method: 'POST', body: { name: 'Sin comando' } });
  assert.equal(invalid.status, 400);
});

test('ajustes persistentes', async () => {
  const patched = await api('/api/settings', { method: 'PATCH', body: { autoScanOnStart: true, sources: { steam: false }, theme: { accent: '#22c1a5' } } });
  assert.equal(patched.payload.autoScanOnStart, true);
  assert.equal(patched.payload.sources.steam, false);
  assert.equal(patched.payload.sources.epic, true, 'el resto de fuentes se conserva');
  assert.equal(patched.payload.theme.accent, '#22c1a5');

  const current = await api('/api/settings');
  assert.equal(current.payload.theme.accent, '#22c1a5');
});

test('carátulas: subida, servicio y vuelta a la generada', async () => {
  const created = await api('/api/games', { method: 'POST', body: { name: 'Con carátula' } });
  const id = created.payload.game.id;

  const generated = await fetch(`${base}/api/games/${id}/cover`);
  assert.equal(generated.status, 200);
  assert.equal(generated.headers.get('content-type'), 'image/svg+xml');
  assert.match(await generated.text(), /<svg/);

  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
  const uploaded = await api(`/api/games/${id}/cover`, { method: 'POST', body: { data: `data:image/png;base64,${png}` } });
  assert.equal(uploaded.status, 200);

  const served = await fetch(`${base}/api/games/${id}/cover`);
  assert.equal(served.headers.get('content-type'), 'image/png');

  const reset = await api(`/api/games/${id}/cover`, { method: 'DELETE' });
  assert.equal(reset.status, 200);
  const afterReset = await fetch(`${base}/api/games/${id}/cover`);
  assert.equal(afterReset.headers.get('content-type'), 'image/svg+xml');

  const banner = await fetch(`${base}/api/games/${id}/banner`);
  assert.equal(banner.status, 200);
  assert.match(await banner.text(), /width="1600"/);
});

test('exportar e importar la biblioteca', async () => {
  const exported = await api('/api/export', { raw: true });
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-disposition') || '', /nebula/);
  const payload = await exported.json();
  assert.equal(payload.app, 'nebula');
  assert.ok(Array.isArray(payload.games));
  const count = payload.games.length;
  assert.ok(count >= 2);

  const wipe = await api('/api/games', { method: 'DELETE', body: { ids: payload.games.map((g) => g.id) } });
  assert.equal(wipe.payload.removed, count);
  assert.equal((await api('/api/state')).payload.games.length, 0);

  const imported = await api('/api/import', { method: 'POST', body: { payload, mode: 'merge' } });
  assert.equal(imported.payload.added, count);
  const restored = await api('/api/state');
  assert.equal(restored.payload.games.length, count);

  const invalid = await api('/api/import', { method: 'POST', body: { payload: { games: 'no' } } });
  assert.equal(invalid.status, 500);
});

test('biblioteca de ejemplo y estadísticas', async () => {
  const before = (await api('/api/state')).payload.games.filter((g) => g.demo).length;
  const added = await api('/api/demo', { method: 'POST', body: {} });
  assert.ok(added.payload.added > 0, 'se cargan juegos de ejemplo');

  const state = await api('/api/state');
  const demoGames = state.payload.games.filter((g) => g.demo);
  assert.equal(demoGames.length, before + added.payload.added);
  assert.ok(state.payload.stats.totals.seconds > 0);
  assert.equal(state.payload.stats.activity.last90.length, 90);
  assert.ok(state.payload.stats.top.length > 0);
  assert.ok(state.payload.stats.months.length, 12);

  const cleared = await api('/api/demo', { method: 'DELETE' });
  assert.equal(cleared.payload.removed, demoGames.length, 'se quitan todos los juegos de ejemplo');
  assert.equal((await api('/api/state')).payload.games.filter((g) => g.demo).length, 0);
});

test('explorador de archivos y errores controlados', async () => {
  const listing = await api(`/api/fs?path=${encodeURIComponent(fixtureDir)}`);
  assert.equal(listing.status, 200);
  assert.ok(listing.payload.entries.some((e) => e.name === 'Juego de Prueba' && e.type === 'dir'));

  const missing = await api('/api/fs?path=/ruta/que/no/existe/jamas');
  assert.equal(missing.status, 400);

  const badFolder = await api('/api/folders', { method: 'POST', body: { path: '/ruta/inexistente' } });
  assert.equal(badFolder.status, 400);

  const noName = await api('/api/games', { method: 'POST', body: { platform: 'manual' } });
  assert.equal(noName.status, 400);

  const unknown = await api('/api/games/id-inventado');
  assert.equal(unknown.status, 404);
});

test('el explorador solo lista carpetas y ejecutables', async () => {
  const listing = await api(`/api/fs?path=${encodeURIComponent(fixtureDir + '/Juego de Prueba')}`);
  assert.equal(listing.status, 200);
  const names = listing.payload.entries.map((e) => e.name);
  assert.ok(names.includes('JuegoDePrueba.exe'), 'los ejecutables se listan');
  assert.ok(names.includes('unins000.exe'), 'los instaladores también (se filtran al puntuar)');
  assert.ok(!names.includes('cover.jpg'), 'las imágenes no se listan como lanzables');
  assert.equal(listing.payload.entries.filter((e) => e.type === 'file').every((e) => /\.exe$/i.test(e.name)), true);
});
