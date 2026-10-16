/**
 * Pruebas de deteccion de juegos: nombres, ejecutables, ROMs y carpetas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';

import {
  scoreExecutable, cleanGameName, isLaunchableFile, scanCollection, scanSingleFolder,
  scanRoms, findLocalArt, analyzeFolder,
} from '../server/scanner.js';
import { walk } from '../server/util.js';

async function fixture() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nebula-scan-'));
  return dir;
}

async function write(file, contents = 'x') {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, contents);
  return file;
}

test('scoreExecutable prefiere el juego sobre instaladores y ayudas', () => {
  const root = '/juegos/MiJuego';
  const juego = scoreExecutable('/juegos/MiJuego/MiJuego.exe', root);
  const uninstall = scoreExecutable('/juegos/MiJuego/unins000.exe', root);
  const redist = scoreExecutable('/juegos/MiJuego/_CommonRedist/DirectX/dxsetup.exe', root);
  const ayuda = scoreExecutable('/juegos/MiJuego/readme.exe', root);

  assert.ok(juego > uninstall, 'el ejecutable principal gana');
  assert.ok(juego > redist, 'los redistribuibles pierden');
  assert.ok(juego > ayuda, 'los archivos de ayuda pierden');
  assert.ok(uninstall < 0 && redist < 0);
});

test('scoreExecutable premia coincidir con el nombre de la carpeta y la poca profundidad', () => {
  const root = '/juegos/Skybound';
  const dentro = scoreExecutable('/juegos/Skybound/Skybound.exe', root);
  const profundo = scoreExecutable('/juegos/Skybound/a/b/c/otra_cosa.exe', root);
  assert.ok(dentro > profundo);
});

test('cleanGameName limpia extensiones y sufijos tecnicos', () => {
  assert.equal(cleanGameName('MiJuego.exe'), 'MiJuego');
  assert.equal(cleanGameName('mi_juego_genial'), 'Mi Juego Genial');
  assert.equal(cleanGameName('Game.x86_64'), 'Game');
  assert.match(cleanGameName('Juego v1.0.3 Win64 Final'), /^Juego$/);
});

test('isLaunchableFile acepta ejecutables y descarta texto', () => {
  assert.equal(isLaunchableFile('/x/juego.exe'), true);
  assert.equal(isLaunchableFile('/x/juego.AppImage'), true);
  assert.equal(isLaunchableFile('/x/juego.sh'), true);
  assert.equal(isLaunchableFile('/x/notas.txt'), false);
  assert.equal(isLaunchableFile('/x/video.mp4'), false);
  assert.equal(isLaunchableFile('/x/binario', 100, 0o755), true, 'binario con permiso de ejecucion');
  assert.equal(isLaunchableFile('/x/binario', 100, 0o644), false);
});

test('walk respeta la profundidad y salta carpetas de sistema', async () => {
  const dir = await fixture();
  await write(path.join(dir, 'a.txt'));
  await write(path.join(dir, 'nivel1', 'b.txt'));
  await write(path.join(dir, 'nivel1', 'nivel2', 'nivel3', 'profundo.txt'));
  await write(path.join(dir, 'node_modules', 'ignorado.txt'));
  await write(path.join(dir, '_CommonRedist', 'DirectX', 'setup.exe'));

  const shallow = await walk(dir, { maxDepth: 1 });
  const names = shallow.files.map((f) => f.name).sort();
  assert.deepEqual(names, ['a.txt', 'b.txt']);

  const deep = await walk(dir, { maxDepth: 4 });
  assert.ok(deep.files.some((f) => f.name === 'profundo.txt'));
  assert.ok(!deep.files.some((f) => f.name === 'ignorado.txt'), 'node_modules se salta');
  assert.ok(!deep.files.some((f) => f.name === 'setup.exe'), 'los redistribuibles se saltan');
});

test('scanCollection detecta una carpeta por juego y su ejecutable principal', async () => {
  const dir = await fixture();
  await write(path.join(dir, 'Hollow Depths', 'HollowDepths.exe'));
  await write(path.join(dir, 'Hollow Depths', 'unins000.exe'));
  await write(path.join(dir, 'Hollow Depths', 'cover.jpg'));
  await write(path.join(dir, 'Otra Cosa', 'bin', 'OtraCosa'));
  await fsp.chmod(path.join(dir, 'Otra Cosa', 'bin', 'OtraCosa'), 0o755);
  await write(path.join(dir, 'carpeta sin juego', 'notas.txt'));

  const findings = await scanCollection(dir, { deep: true });
  const names = findings.map((f) => f.name).sort();
  assert.deepEqual(names, ['Hollow Depths', 'Otra Cosa'], 'solo carpetas con ejecutable');

  const hollow = findings.find((f) => f.name === 'Hollow Depths');
  assert.match(hollow.executable, /HollowDepths\.exe$/);
  assert.match(hollow.coverFile, /cover\.jpg$/);

  const otra = findings.find((f) => f.name === 'Otra Cosa');
  assert.match(otra.executable, /bin[/\\]OtraCosa$/);
});

test('scanSingleFolder devuelve candidatos ordenados por confianza', async () => {
  const dir = await fixture();
  await write(path.join(dir, 'Skybound', 'Skybound.exe'));
  await write(path.join(dir, 'Skybound', 'unins000.exe'));
  await write(path.join(dir, 'Skybound', 'hero.jpg'));

  const info = await scanSingleFolder(path.join(dir, 'Skybound'), { withSize: true });
  assert.equal(info.name, 'Skybound');
  assert.equal(info.candidates[0].name, 'Skybound.exe');
  assert.ok(info.candidates[0].score > info.candidates[1].score);
  assert.ok(info.coverFile === null || info.coverFile.endsWith('.jpg'));
  assert.equal(typeof info.sizeBytes, 'number');

  const analysis = await analyzeFolder(path.join(dir, 'Skybound'));
  assert.ok(analysis.candidates.length >= 2);
  assert.ok(analysis.fileCount >= 3);
});

test('scanRoms agrupa por consola y descarta archivos ajenos', async () => {
  const dir = await fixture();
  await write(path.join(dir, 'snes', 'Chrono Trigger.sfc'));
  await write(path.join(dir, 'snes', 'Super Metroid.smc'));
  await write(path.join(dir, 'gba', 'Golden Sun.gba'));
  await write(path.join(dir, 'snes', 'caratula.png'));

  const { findings, consoles } = await scanRoms(dir);
  assert.equal(findings.length, 3);
  const snes = consoles.find((c) => c.id === 'snes');
  assert.equal(snes.count, 2);
  assert.equal(consoles.find((c) => c.id === 'gba').count, 1);

  const chrono = findings.find((f) => f.name === 'Chrono Trigger');
  assert.equal(chrono.emulator, true);
  assert.equal(chrono.consoleLabel, 'Super Nintendo');
  assert.match(chrono.extra.rom, /Chrono Trigger\.sfc$/);
});

test('findLocalArt encuentra caratula, fondo e icono', async () => {
  const dir = await fixture();
  await write(path.join(dir, 'juego', 'folder.png'));
  await write(path.join(dir, 'juego', 'hero.jpg'));
  await write(path.join(dir, 'juego', 'icon.ico'));
  const art = await findLocalArt(path.join(dir, 'juego'));
  assert.match(art.coverFile, /folder\.png$/);
  assert.match(art.backgroundFile, /hero\.jpg$/);
  assert.match(art.iconFile, /icon\.ico$/);

  const vacio = await findLocalArt(path.join(dir, 'no-existe'));
  assert.deepEqual(vacio, {});
});
