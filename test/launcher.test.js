/**
 * Pruebas del lanzador: plantillas de comando, argumentos y sesiones.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';

import { Launcher, renderTemplate, splitArgs, splitCommand } from '../server/launcher.js';
import { Store } from '../server/store.js';

test('renderTemplate reemplaza marcadores', () => {
  const game = {
    name: 'Chrono Trigger',
    executable: '/juegos/ct/ct.exe',
    installDir: '/juegos/ct',
    launchArgs: '-fullscreen',
    extra: { rom: '/roms/snes/Chrono Trigger.sfc', console: 'snes' },
  };
  assert.equal(renderTemplate('"{exe}" {args}', game), '"/juegos/ct/ct.exe" -fullscreen');
  assert.equal(renderTemplate('{romName}', game), 'Chrono Trigger');
  assert.equal(renderTemplate('{romDir}', game), '/roms/snes');
  assert.equal(renderTemplate('retroarch -L {console} "{rom}"', game), 'retroarch -L snes "/roms/snes/Chrono Trigger.sfc"');
  assert.equal(renderTemplate('{name} en {dir}', game), 'Chrono Trigger en /juegos/ct');
  assert.equal(renderTemplate('', game), '');
});

test('splitArgs respeta comillas y espacios', () => {
  assert.deepEqual(splitArgs('-windowed --skip-intro'), ['-windowed', '--skip-intro']);
  assert.deepEqual(splitArgs('--path "C:\\Program Files\\Juego"'), ['--path', 'C:\\Program Files\\Juego']);
  assert.deepEqual(splitArgs("--nombre 'Mi Juego'"), ['--nombre', 'Mi Juego']);
  assert.deepEqual(splitCommand('/usr/bin/game --modo rapido'), ['/usr/bin/game', '--modo', 'rapido']);
  assert.deepEqual(splitArgs(''), []);
});

test('launcher: las sesiones de ejemplo se abren y cierran registrando tiempo', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ludoteca-launch-'));
  const store = new Store(path.join(dir, 'biblioteca.json'));
  await store.load();
  const { game } = await store.add({ name: 'Juego de ejemplo', demo: true, status: 'backlog' });

  const launcher = new Launcher(store);
  const session = await launcher.launch(game.id);
  assert.ok(session.id, 'devuelve una sesion');

  const status = launcher.status();
  assert.equal(status.count, 1);
  assert.ok(status.sessions[game.id], 'la sesion aparece en el estado en vivo');
  assert.equal(status.sessions[game.id].simulated, true);

  await assert.rejects(() => launcher.launch(game.id), /ya esta en ejecucion/);

  await launcher.stopGame(game.id);
  assert.equal(launcher.status().count, 0);
  assert.equal(store.activeFor(game.id), null);
  assert.equal(game.sessions.length, 1, 'queda una sesion registrada');
  assert.equal(game.status, 'playing');
});

test('launcher: un juego sin ejecutable ni comando informa el motivo', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ludoteca-launch2-'));
  const store = new Store(path.join(dir, 'biblioteca.json'));
  await store.load();
  const { game } = await store.add({ name: 'Sin nada' });

  const launcher = new Launcher(store);
  await assert.rejects(() => launcher.launch(game.id), /no tiene ejecutable ni comando/i);
  assert.equal(store.activeFor(game.id), null);
});

test('launcher: detecta ejecutables inexistentes antes de arrancar', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ludoteca-launch3-'));
  const store = new Store(path.join(dir, 'biblioteca.json'));
  await store.load();
  const { game } = await store.add({ name: 'Ruta rota', executable: path.join(dir, 'no-existe.exe') });

  const launcher = new Launcher(store);
  await assert.rejects(() => launcher.launch(game.id), /No se encuentra el ejecutable/);
});

test('launcher: respeta el perfil de emulador', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ludoteca-launch4-'));
  const store = new Store(path.join(dir, 'biblioteca.json'));
  await store.load();
  const profile = { id: 'emu_test', name: 'Emulador de prueba', command: 'echo "{rom}"', consoles: ['snes'] };
  store.setSettings({ emulatorProfiles: [profile] });
  const { game } = await store.add({
    name: 'Chrono Trigger', platform: 'emulator', emulatorProfileId: 'emu_test',
    extra: { rom: path.join(dir, 'Chrono Trigger.sfc') },
  });
  await fsp.writeFile(path.join(dir, 'Chrono Trigger.sfc'), 'rom');

  const launcher = new Launcher(store);
  /* se lanza un proceso real ("echo"), que termina enseguida */
  const session = await launcher.launch(game.id);
  assert.ok(session.id);
  const status = launcher.status();
  assert.match(status.sessions[game.id].method, /Emulador de prueba/);
  await launcher.stopGame(game.id).catch(() => {});
});
