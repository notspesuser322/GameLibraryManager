/**
 * Pruebas de la descarga de carátulas.
 *
 * Se levanta un servidor local que imita el comportamiento real de las fuentes:
 *  - como Wikimedia, responde 403 si la petición no se identifica bien y
 *    redirige las direcciones «Special:FilePath»;
 *  - como el CDN de Steam, devuelve 404 en las imágenes que no existen;
 *  - como algunos servicios, devuelve una página HTML con código 200.
 *
 * Así se comprueba, sin depender de internet, que la descarga elige la primera
 * dirección que funciona, verifica que sea una imagen de verdad y avisa del
 * motivo cuando todas fallan.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MediaStore } from '../server/art.js';
import { MetadataService, wikimediaVariants } from '../server/metadata.js';
import { pareceImagen, extensionDeImagen, cabecerasImagen } from '../server/http.js';

/* ------------------------------------------------------------------ servidor */

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(2048, 7),
]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1500, 3)]);

let servidor;
let base;
const peticiones = [];

before(async () => {
  servidor = http.createServer((req, res) => {
    const ruta = new URL(req.url, 'http://localhost').pathname;
    const ua = req.headers['user-agent'] || '';
    peticiones.push({ ruta, ua });

    /* imita a Wikimedia: exige identificación y redirige las direcciones bonitas */
    if (ruta.startsWith('/wiki/Special:FilePath')) {
      if (!ua.includes('Nébula/')) {
        res.writeHead(403, { 'content-type': 'text/plain' });
        res.end('Debes identificarte');
        return;
      }
      const nombre = ruta.split('/').pop();
      res.writeHead(302, { location: `/imagenes/${nombre}` });
      res.end();
      return;
    }

    if (ruta === '/imagenes/caratula.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG);
      return;
    }
    if (ruta === '/imagenes/fondo.jpg') {
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      res.end(JPG);
      return;
    }

    /* imita a un CDN de tienda: la imagen que falta da 404 */
    if (ruta.startsWith('/steam/apps/')) {
      if (ruta.endsWith('header.jpg') || ruta.endsWith('library_600x900.jpg')) {
        res.writeHead(200, { 'content-type': 'image/jpeg' });
        res.end(JPG);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }

    /* devuelve HTML con código 200: no se puede guardar como carátula */
    if (ruta === '/pagina-de-error.png') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body>Ups, no hay imagen</body></html>');
      return;
    }

    /* sin agente de usuario válido: como los servicios que bloquean */
    if (ruta === '/solo-navegadores.png') {
      if (!/Mozilla/.test(ua)) {
        res.writeHead(403, { 'content-type': 'text/plain' });
        res.end('Prohibido');
        return;
      }
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG);
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('No encontrado');
  });

  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor?.close());

/* ---------------------------------------------------------------- utilidades */

const directorio = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-art-'));

test('pareceImagen distingue imágenes de páginas web', () => {
  assert.equal(pareceImagen(PNG), true, 'PNG');
  assert.equal(pareceImagen(JPG), true, 'JPEG');
  assert.equal(pareceImagen(Buffer.from('GIF89a' + 'x'.repeat(200))), true, 'GIF');
  assert.equal(pareceImagen(Buffer.from('RIFF' + 'x'.repeat(4) + 'WEBP' + 'x'.repeat(200))), true, 'WEBP');
  assert.equal(pareceImagen(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), false, 'sin relleno suficiente');
  assert.equal(pareceImagen(Buffer.from('<!doctype html><html>' + 'x'.repeat(300))), false, 'HTML no es imagen');
  assert.equal(pareceImagen(Buffer.alloc(10)), false, 'demasiado pequeño');
});

test('extensionDeImagen acierta con el tipo y con el contenido', () => {
  assert.equal(extensionDeImagen(PNG, 'image/png'), '.png');
  assert.equal(extensionDeImagen(JPG, 'image/jpeg'), '.jpg');
  assert.equal(extensionDeImagen(JPG, ''), '.jpg');
  assert.equal(extensionDeImagen(PNG, 'application/octet-stream'), '.png', 'se fía del contenido');
  assert.equal(extensionDeImagen(Buffer.from('GIF89a' + 'x'.repeat(200)), ''), '.gif');
  assert.equal(extensionDeImagen(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">' + 'x'.repeat(200)), ''), '.svg');
});

test('las peticiones de imagen se identifican (Wikimedia lo exige)', () => {
  const cabeceras = cabecerasImagen();
  assert.match(cabeceras['user-agent'], /^Nébula\//);
  assert.match(cabeceras['user-agent'], /\(.+\)$/, 'lleva descripción y forma de contacto');
  assert.match(cabeceras.accept, /image\//);
  assert.equal(cabecerasImagen({ referer: 'https://store.steampowered.com/' }).referer, 'https://store.steampowered.com/');
});

/* ------------------------------------------------------------------ descarga */

test('descarga una carátula que exige identificación y pasa por una redirección', async () => {
  const media = new MediaStore(directorio());
  await media.init();
  const url = `${base}/wiki/Special:FilePath/caratula.png`;
  const archivo = await media.download('g_1', url, 'cover');

  assert.ok(archivo, 'la descarga debería funcionar');
  assert.equal(archivo.endsWith('.png'), true, 'se guarda con la extensión correcta');
  const datos = fs.readFileSync(archivo);
  assert.equal(datos.subarray(0, 4).toString('hex'), '89504e47', 'es el PNG de verdad');
  assert.ok(peticiones.some((p) => p.ruta.includes('Special:FilePath') && p.ua.includes('Nébula/')), 'se identificó como Nébula');
});

test('descargaBest prueba en orden hasta que una dirección responde', async () => {
  const media = new MediaStore(directorio());
  await media.init();
  const opciones = [
    { url: `${base}/steam/apps/1/no-existe.jpg` },
    { url: `${base}/steam/apps/1/header.jpg` },
    { url: `${base}/steam/apps/1/library_600x900.jpg` },
  ];
  const resultado = await media.downloadBest('g_2', opciones, 'cover');

  assert.ok(resultado.file, 'encuentra la que sí existe');
  assert.equal(resultado.url, opciones[1].url, 'se queda con la segunda, que es la primera válida');
  assert.equal(resultado.intentos, 2);
  assert.equal(resultado.error, null);
});

test('descargaBest se niega a guardar una página web como carátula', async () => {
  const media = new MediaStore(directorio());
  await media.init();
  const resultado = await media.downloadBest('g_3', [{ url: `${base}/pagina-de-error.png` }], 'cover');

  assert.equal(resultado.file, null, 'no guarda nada');
  assert.match(resultado.error, /no es una imagen/, `motivo: ${resultado.error}`);
});

test('si la fuente rechaza la petición, se explica el motivo', async () => {
  const media = new MediaStore(directorio());
  await media.init();
  const resultado = await media.downloadBest('g_4', [{ url: `${base}/no-existe-en-absoluto.png` }], 'cover');

  assert.equal(resultado.file, null);
  assert.match(resultado.error, /404/, `motivo: ${resultado.error}`);
});

test('cuando todas fallan se informa de cada intento', async () => {
  const media = new MediaStore(directorio());
  await media.init();
  const resultado = await media.downloadBest('g_5', [
    { url: `${base}/steam/apps/9/nada.jpg` },
    { url: `${base}/pagina-de-error.png` },
  ], 'cover');

  assert.equal(resultado.file, null);
  assert.equal(resultado.intentos, 2);
  assert.match(resultado.error, /404/);
  assert.match(resultado.error, /no es una imagen/);
  assert.equal(resultado.url, `${base}/steam/apps/9/nada.jpg`, 'guarda la primera dirección por si se quiere reintentar');
});

/* ------------------------------------------------------- direcciones de la ficha */

test('wikimediaVariants ofrece la original y la reducida', () => {
  const conAncho = wikimediaVariants('https://commons.wikimedia.org/wiki/Special:FilePath/Juego.png?width=1200');
  assert.equal(conAncho.length, 2);
  assert.equal(conAncho[0].includes('width='), false, 'primero la original, que casi nunca falla');
  assert.equal(conAncho[1].includes('width=1200'), true);

  const miniatura = wikimediaVariants('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Juego.png/800px-Juego.png');
  assert.equal(miniatura[0], 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Juego.png');
  assert.equal(miniatura.length, 2);

  assert.deepEqual(wikimediaVariants('https://upload.wikimedia.org/wikipedia/commons/a/ab/Juego.png'), [
    'https://upload.wikimedia.org/wikipedia/commons/a/ab/Juego.png',
  ]);
  assert.deepEqual(wikimediaVariants(''), []);
});

test('las fichas de Steam traen varias direcciones de carátula en orden', async () => {
  const meta = new MetadataService({ fetchImpl: async () => { throw new Error('sin red'); }, getSettings: () => ({ metadata: {} }) });
  const opciones = await meta.coverOptions({ source: 'steam', id: '400', extra: { appId: '400' } }, { kind: 'cover' });

  assert.ok(opciones.length >= 4, `se esperaban varias direcciones, hay ${opciones.length}`);
  assert.match(opciones[0].url, /library_600x900\.jpg$/, 'se empieza por la carátula vertical');
  assert.ok(opciones.some((o) => o.url.endsWith('header.jpg')), 'y se sigue por la horizontal');
  assert.ok(opciones.some((o) => o.url.includes('akamai')), 'se prueban varios servidores de Steam');
  assert.ok(opciones.every((o) => o.referer), 'las imágenes de Steam llevan referencia de la tienda');
  assert.equal(new Set(opciones.map((o) => o.url)).size, opciones.length, 'sin direcciones repetidas');
});

test('el fondo de Steam usa imágenes horizontales', async () => {
  const meta = new MetadataService({ fetchImpl: async () => { throw new Error('sin red'); }, getSettings: () => ({ metadata: {} }) });
  const opciones = await meta.coverOptions({ source: 'steam', id: '400', extra: { appId: '400' } }, { kind: 'banner' });
  assert.match(opciones[0].url, /library_hero\.jpg$/);
  assert.ok(!opciones[0].url.includes('library_600x900'), 'no usa la vertical como fondo');
});

test('si el artículo no trae imagen, se busca en la propia página', async () => {
  const vistas = [];
  const meta = new MetadataService({
    getSettings: () => ({ metadata: { language: 'es' } }),
    fetchImpl: async (url) => {
      vistas.push(String(url));
      if (String(url).includes('/wiki/Minecraft')) {
        return {
          ok: true,
          headers: { get: () => 'text/html' },
          text: async () => '<html><head><meta property="og:image" content="https://upload.wikimedia.org/wikipedia/commons/a/ab/Minecraft.png"></head></html>',
        };
      }
      throw new Error('sin red');
    },
  });

  const opciones = await meta.coverOptions({ source: 'wikipedia', title: 'Minecraft', extra: { language: 'es' } }, { kind: 'cover' });
  assert.ok(vistas.some((u) => u.includes('es.wikipedia.org/wiki/Minecraft')), 'consulta la página del artículo');
  assert.equal(opciones.length, 1);
  assert.match(opciones[0].url, /Minecraft\.png$/);
});

test('una ficha con imagen propia no consulta la página', async () => {
  let consultas = 0;
  const meta = new MetadataService({
    getSettings: () => ({ metadata: {} }),
    fetchImpl: async () => { consultas++; throw new Error('sin red'); },
  });
  const opciones = await meta.coverOptions({
    source: 'wikipedia',
    title: 'Minecraft',
    coverUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Minecraft.png?width=1200',
  }, { kind: 'cover' });

  assert.equal(consultas, 0, 'no hace peticiones de más');
  assert.equal(opciones.length, 2, 'usa la imagen que ya traía la ficha');
});
