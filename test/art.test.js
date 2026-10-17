/**
 * Pruebas del arte de la biblioteca: caratulas generadas y resolucion de imagenes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';

import { MediaStore, coverSvg, bannerSvg, mimeFor } from '../server/art.js';

test('la caratula generada es un SVG valido con el nombre del juego', () => {
  const svg = coverSvg({ name: 'Hollow Depths & Cia', platform: 'steam', genres: ['metroidvania'], favorite: true });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<\/svg>$/);
  assert.match(svg, /Hollow/);
  assert.match(svg, /&amp;/);
  assert.ok(!svg.includes('&&'), 'escapa los caracteres especiales');
  assert.match(svg, /Steam/);
});

test('los nombres largos se reparten en varias lineas', () => {
  const svg = coverSvg({ name: 'Skybound Cartographers of the Endless Verge', platform: 'manual' });
  const lines = svg.match(/<text[^>]*font-weight="700"[^>]*>/g) || [];
  assert.ok(lines.length >= 2, 'se dibuja mas de una linea de titulo');
});

test('el fondo generado tiene formato horizontal', () => {
  const svg = bannerSvg({ name: 'Neon Circuit Racer', platform: 'epic' });
  assert.match(svg, /width="1600" height="520"/);
  assert.match(svg, /Neon Circuit Racer/);
  assert.match(svg, /Epic/);
});

test('dos juegos distintos generan caratulas distintas y estables', () => {
  const a = coverSvg({ name: 'Alfa' });
  const b = coverSvg({ name: 'Beta' });
  assert.notEqual(a, b);
  assert.equal(coverSvg({ name: 'Alfa' }), a, 'el mismo juego produce el mismo SVG');
});

test('MediaStore resuelve archivos locales, genera SVG y aplica subidas', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nebula-art-'));
  const media = new MediaStore(dir);
  await media.init();

  /* sin nada configurado => caratula generada */
  const game = { id: 'g_test', name: 'Juego de prueba', platform: 'manual' };
  const generated = await media.resolve(game, 'cover');
  assert.match(generated, /g_test\.svg$/);
  assert.equal(mimeFor(generated), 'image/svg+xml');
  const contents = await fsp.readFile(generated, 'utf8');
  assert.match(contents, /Juego de prueba/);

  /* archivo local tiene prioridad */
  const localCover = path.join(dir, 'local.png');
  await fsp.writeFile(localCover, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const fromLocal = await media.resolve({ ...game, coverFile: localCover }, 'cover');
  assert.equal(fromLocal, localCover);

  /* subida del usuario por encima del SVG generado */
  await media.saveUpload('g_test', 'cover', { data: Buffer.from('png-falso').toString('base64'), ext: '.png' });
  const uploaded = await media.resolve(game, 'cover');
  assert.match(uploaded, /g_test\.png$/);
  assert.equal(mimeFor(uploaded), 'image/png');

  /* al quitarla se vuelve a la generada */
  await media.removeUploaded('g_test', 'cover');
  const back = await media.resolve(game, 'cover');
  assert.match(back, /g_test\.svg$/);
});

test('MediaStore respeta la opcion de no descargar arte remoto', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nebula-art3-'));
  const media = new MediaStore(dir);
  await media.init();
  const game = { id: 'g_off', name: 'Sin red', coverUrl: 'https://cdn.invalido/cover.jpg' };
  const resolved = await media.resolve(game, 'cover', { download: false });
  assert.match(resolved, /g_off\.svg$/, 'sin descarga se usa la caratula generada');
});

test('MediaStore ignora URLs remotas invalidas sin romper', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nebula-art2-'));
  const media = new MediaStore(dir);
  await media.init();
  const result = await media.download('g_x', 'no-es-una-url');
  assert.equal(result, null);
  const game = { id: 'g_x', name: 'X', coverUrl: 'https://ejemplo.invalido/cover.jpg' };
  const resolved = await media.resolve(game, 'cover');
  assert.match(resolved, /g_x\.svg$/, 'si la descarga falla queda la caratula generada');
});

test('mimeFor reconoce los formatos habituales', () => {
  assert.equal(mimeFor('/x/a.png'), 'image/png');
  assert.equal(mimeFor('/x/a.JPG'), 'image/jpeg');
  assert.equal(mimeFor('/x/a.webp'), 'image/webp');
  assert.equal(mimeFor('/x/a.ico'), 'image/x-icon');
  assert.equal(mimeFor('/x/a.unknown'), 'application/octet-stream');
});
