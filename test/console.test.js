/**
 * Pruebas de la salida por consola.
 *
 * En Windows la consola no siempre usa UTF-8 y el texto con acentos o adornos se
 * ve como caracteres de otra codificación (chino incluido). Estas pruebas
 * garantizan que el modo ASCII deja siempre texto legible.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { aAscii, prepararConsola, texto, envolverEscritura } from '../server/console.js';

test('aAscii quita acentos y eñes', () => {
  assert.equal(aAscii('aplicación'), 'aplicacion');
  assert.equal(aAscii('España'), 'Espana');
  assert.equal(aAscii('días · sesión'), 'dias - sesion');
  assert.equal(aAscii('ÁÉÍÓÚÜÑáéíóúüñ'), 'AEIOUUNaeiouun');
});

test('aAscii cambia adornos y comillas por equivalentes sencillos', () => {
  assert.equal(aAscii('───────────'), '-----------');
  assert.equal(aAscii('  ⓘ  aviso'), '  *  aviso');
  assert.equal(aAscii('✖ error'), 'x error');
  assert.equal(aAscii('✅ listo'), 'ok listo');
  assert.equal(aAscii('⚠ cuidado'), '! cuidado');
  assert.equal(aAscii('▶ jugar'), '> jugar');
  assert.equal(aAscii('3 · 2'), '3 - 2');
  assert.equal(aAscii('espera…'), 'espera...');
  assert.equal(aAscii('«texto»'), '"texto"');
  assert.equal(aAscii('—guion—'), '-guion-');
});

test('aAscii deja intacto el texto que ya es ASCII', () => {
  const original = '  Biblioteca: 40 juegos - datos en /home/user/data\n';
  assert.equal(aAscii(original), original);
  assert.equal(aAscii(aAscii('aplicación ──')), aAscii('aplicación ──'), 'es idempotente');
});

test('aAscii no deja pasar caracteres de otros alfabetos', () => {
  assert.equal(aAscii('错误'), '');
  assert.equal(aAscii('juego 错误 de 中文'), 'juego  de ');
  assert.equal(aAscii('ludoteca ✓ jeu'), 'ludoteca ok jeu');
  assert.match(aAscii('Ludoteca 1.0.0 ── ⓘ demostración'), /^[\x20-\x7e\n]*$/);
});

test('prepararConsola respeta el modo forzado', () => {
  assert.equal(prepararConsola({ forzar: 'utf8' }), true, 'forzado utf8 devuelve true');
  assert.equal(prepararConsola({ forzar: 'ascii' }), false, 'forzado ascii devuelve false');
  assert.equal(prepararConsola({ forzar: 'utf8' }), true, 'se puede volver a preguntar por utf8');
});

test('el envoltorio deja en ASCII todo lo que se le escribe', () => {
  const capturado = [];
  const flujo = envolverEscritura({ write: (chunk) => { capturado.push(String(chunk)); return true; } });

  flujo.write('  ⓘ  Biblioteca de demostración: 40 juegos · sesión de prueba\n');
  flujo.write('  ──────────────────────────────────\n');
  flujo.write('  ✖ No se pudo abrir «Juego» — reintenta…\n');
  flujo.write(Buffer.from('acentos: sesión, España\n', 'utf8'));

  const salida = capturado.join('');
  assert.match(salida, /^[\x20-\x7e\n]*$/, `la salida debe ser ASCII legible: ${JSON.stringify(salida)}`);
  assert.match(salida, /demostracion: 40 juegos - sesion de prueba/);
  assert.match(salida, /---/);
  assert.match(salida, /x No se pudo abrir "Juego" - reintenta\.\.\./);
  assert.match(salida, /acentos: sesion, Espana/);
});

test('en modo ASCII se envuelven las funciones de console (una sola vez)', () => {
  prepararConsola({ forzar: 'ascii' });
  assert.equal(console.__ludotecaAscii, true, 'la consola queda marcada como envuelta');
  const vez = console.log;
  prepararConsola({ forzar: 'ascii' });
  assert.equal(console.log, vez, 'no se envuelve dos veces');
});

test('texto() adapta mensajes sueltos según el modo', () => {
  prepararConsola({ forzar: 'ascii' });
  assert.equal(texto('sesión'), 'sesion');
  assert.equal(texto('sesión'), aAscii('sesión'));
});
