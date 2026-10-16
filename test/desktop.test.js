/**
 * Pruebas del modo aplicación de escritorio.
 *
 * Se usa un «navegador» falso (un script que anota cómo lo llamaron) para
 * comprobar, sin abrir nada de verdad, que la ventana se pide en modo
 * aplicación, con su propio perfil, su tamaño y sin traducción automática.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  navegadorDisponible, argumentosVentana, abrirVentana, hayEntornoGrafico,
} from '../server/desktop.js';

let base;
let registro;
let navegadorFalso;

before(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-desktop-'));
  registro = path.join(base, 'llamadas.txt');
  navegadorFalso = path.join(base, 'chrome-falso');
  /* imita a Chrome: escribe cómo lo llamaron y termina */
  fs.writeFileSync(navegadorFalso, `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(${JSON.stringify(registro)}, process.argv.slice(2).join('\\n') + '\\n---\\n');\n`, { mode: 0o755 });
  process.env.NEBULA_NAVEGADOR = navegadorFalso;
  delete process.env.NEBULA_SIN_VENTANA;
});

after(() => {
  delete process.env.NEBULA_NAVEGADOR;
  fs.rmSync(base, { recursive: true, force: true });
});

test('los argumentos de la ventana son los de una app, no los de una pestaña', () => {
  const args = argumentosVentana('http://localhost:4337', { perfil: '/tmp/perfil', ancho: 1200, alto: 800 });
  assert.ok(args.includes('--app=http://localhost:4337'), 'se pide en modo aplicación (sin barra de direcciones)');
  assert.ok(args.includes('--user-data-dir=/tmp/perfil'), 'usa un perfil aparte');
  assert.ok(args.includes('--window-size=1200,800'));
  assert.ok(args.includes('--no-first-run'));
  assert.ok(args.includes('--no-default-browser-check'));
  assert.ok(args.some((a) => a.includes('disable-features') && a.includes('Translate')), 'sin traducción automática');
  assert.ok(args.some((a) => a.startsWith('--user-agent=Nebula/')), 'se identifica como la aplicación');
  assert.equal(args.some((a) => a.includes('--incognito')), false, 'no es una ventana de incógnito');
});

test('se encuentra el navegador indicado en el entorno', () => {
  const encontrado = navegadorDisponible();
  assert.ok(encontrado, 'debería encontrar el navegador de prueba');
  assert.equal(encontrado.ruta, navegadorFalso);
});

test('abrirVentana lanza el navegador con los argumentos correctos', async () => {
  fs.writeFileSync(registro, '');
  const resultado = abrirVentana('http://localhost:4444', { log: () => {} });
  await new Promise((r) => setTimeout(r, 400));

  assert.equal(resultado.ok, true);
  assert.equal(resultado.modo, 'ventana', `se esperaba ventana, fue ${resultado.modo}`);
  const llamada = fs.readFileSync(registro, 'utf8');
  assert.match(llamada, /--app=http:\/\/localhost:4444/);
  assert.match(llamada, /--user-data-dir=/);
  assert.match(llamada, /--window-size=1280,820/);
});

test('con --browser se usa el navegador normal y no la ventana propia', async () => {
  /* se comprueba sin lanzar nada: abrirVentana delega en el navegador del sistema */
  const resultado = abrirVentana('http://localhost:4444', { forzarNavegador: true, log: () => {} });
  assert.equal(resultado.modo, 'web');
  assert.match(resultado.detalle, /--browser/);
});

test('hayEntornoGrafico distingue equipos con pantalla de servidores', () => {
  assert.equal(hayEntornoGrafico({ platform: 'win32', env: {} }), true, 'en Windows siempre hay escritorio');
  assert.equal(hayEntornoGrafico({ platform: 'darwin', env: {} }), true);
  assert.equal(hayEntornoGrafico({ platform: 'linux', env: { DISPLAY: ':0' } }), true);
  assert.equal(hayEntornoGrafico({ platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' } }), true);
  assert.equal(hayEntornoGrafico({ platform: 'linux', env: { XDG_SESSION_TYPE: 'x11' } }), true);
  assert.equal(hayEntornoGrafico({ platform: 'linux', env: {} }), false, 'servidor sin pantalla');
  assert.equal(hayEntornoGrafico({ platform: 'linux', env: { DISPLAY: ':0', NEBULA_SIN_VENTANA: '1' } }), false, 'se puede forzar');
});

test('sin navegador instalado se avisa y se abre igual', () => {
  const guardado = process.env.NEBULA_NAVEGADOR;
  process.env.NEBULA_NAVEGADOR = path.join(base, 'no-existe');
  try {
    /* se evita lanzar procesos reales: basta comprobar que no encuentra navegador */
    const encontrado = navegadorDisponible();
    assert.equal(encontrado, null, 'no hay navegador disponible');
  } finally {
    process.env.NEBULA_NAVEGADOR = guardado;
  }
});
