/**
 * Pruebas de la marca de subsistema del ejecutable de Windows.
 *
 * Se construye un ejecutable PE mínimo a mano (solo hacen falta las cabeceras)
 * para comprobar que se lee y se cambia el campo correcto, y se revisa el
 * ejecutable de verdad cuando está compilado en esta máquina.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  SUBSISTEMA_CONSOLA, SUBSISTEMA_VENTANA, describirSubsistema, esEjecutableDeWindows,
  leerSubsistema, marcarSinConsola,
} from '../scripts/pe-subsystem.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Ejecutable PE de mentira: «MZ», firma «PE\0\0» y cabecera opcional. */
function peDeMentira(subsistema = SUBSISTEMA_CONSOLA) {
  const buffer = Buffer.alloc(0x200);
  buffer.writeUInt16LE(0x5a4d, 0);            /* MZ */
  buffer.writeUInt32LE(0x80, 0x3c);           /* e_lfanew */
  buffer.writeUInt32LE(0x00004550, 0x80);     /* PE\0\0 */
  buffer.writeUInt16LE(subsistema, 0x80 + 0x5c);
  return buffer;
}

test('un ejecutable de Windows se reconoce por su cabecera', () => {
  assert.equal(esEjecutableDeWindows(peDeMentira()), true);
  assert.equal(esEjecutableDeWindows(Buffer.from('#!/bin/sh\necho hola\n')), false);
  assert.equal(esEjecutableDeWindows(Buffer.alloc(10)), false);
});

test('la marca de consola se lee y se cambia a programa de ventana', () => {
  const buffer = peDeMentira(SUBSISTEMA_CONSOLA);
  assert.equal(leerSubsistema(buffer), SUBSISTEMA_CONSOLA);
  assert.equal(marcarSinConsola(buffer), true);
  assert.equal(leerSubsistema(buffer), SUBSISTEMA_VENTANA);
  /* marcar dos veces no rompe nada */
  assert.equal(marcarSinConsola(buffer), true);
  assert.equal(leerSubsistema(buffer), SUBSISTEMA_VENTANA);
});

test('los archivos que no son ejecutables de Windows se dejan en paz', () => {
  const texto = Buffer.from('esto no es un ejecutable');
  assert.equal(marcarSinConsola(texto), false);
  assert.equal(leerSubsistema(texto), null);
});

test('un ejecutable truncado no se toca', () => {
  const corto = peDeMentira().subarray(0, 0x90);
  assert.equal(leerSubsistema(corto), null);
  assert.equal(marcarSinConsola(corto), false);
});

test('la descripción de la marca se entiende', () => {
  assert.match(describirSubsistema(SUBSISTEMA_VENTANA), /sin consola/);
  assert.match(describirSubsistema(SUBSISTEMA_CONSOLA), /consola/);
  assert.match(describirSubsistema(99), /desconocido/);
});

test('el ejecutable compilado es un programa de ventana', (t) => {
  const archivo = path.join(ROOT, 'dist', 'Nebula.exe');
  if (!fs.existsSync(archivo)) {
    t.skip('todavía no se compiló dist/Nebula.exe');
    return;
  }
  assert.equal(leerSubsistema(fs.readFileSync(archivo)), SUBSISTEMA_VENTANA);
});
