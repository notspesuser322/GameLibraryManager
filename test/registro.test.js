/**
 * Pruebas del registro en archivo.
 *
 * El programa de Windows no tiene consola, así que este archivo es la única
 * forma de saber qué pasó. Se comprueba que se escribe en UTF-8, que respeta el
 * tamaño máximo y que al terminar deja `console` como estaba.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { detenerRegistro, haySalidaEstandar, prepararRegistro, rutaRegistro } from '../server/registro.js';

const temporal = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-registro-'));

test('el registro se escribe en el archivo de la carpeta de datos', () => {
  const carpeta = temporal();
  try {
    const archivo = prepararRegistro(carpeta, { consola: false });
    assert.equal(archivo, path.join(carpeta, 'Nebula.log'));
    assert.equal(rutaRegistro(), archivo);
    console.log('arranque de prueba con acentos: Nébula, análisis, carátula');
    const texto = fs.readFileSync(archivo, 'utf8');
    assert.match(texto, /Nébula arrancó el/);
    assert.match(texto, /arranque de prueba con acentos: Nébula, análisis, carátula/);
    assert.match(texto, /\[log\]/);
  } finally {
    detenerRegistro();
  }
});

test('los errores y los avisos se distinguen por su nivel', () => {
  const carpeta = temporal();
  try {
    const archivo = prepararRegistro(carpeta, { consola: false });
    console.warn('aviso de prueba');
    console.error(new Error('fallo de prueba'));
    const texto = fs.readFileSync(archivo, 'utf8');
    assert.match(texto, /\[warn\] aviso de prueba/);
    assert.match(texto, /\[error\].*fallo de prueba/);
  } finally {
    detenerRegistro();
  }
});

test('el archivo no crece sin fin: al pasarse de tamaño se vacía', () => {
  const carpeta = temporal();
  try {
    const archivo = prepararRegistro(carpeta, { consola: false, maxBytes: 200 });
    for (let i = 0; i < 40; i++) console.log(`linea larga de relleno numero ${i} con acentos: Nébula`);
    const tamano = fs.statSync(archivo).size;
    assert.ok(tamano < 200 + 200, `el archivo debería haberse vaciado (mide ${tamano})`);
    assert.match(fs.readFileSync(archivo, 'utf8'), /linea larga de relleno numero 39/);
  } finally {
    detenerRegistro();
  }
});

test('al terminar, la consola vuelve a comportarse como siempre', () => {
  const carpeta = temporal();
  const original = console.log;
  prepararRegistro(carpeta, { consola: false });
  assert.notEqual(console.log, original);
  detenerRegistro();
  assert.equal(console.log, original);
  assert.equal(rutaRegistro(), null);
});

test('se sabe si hay una salida estándar de verdad', () => {
  assert.equal(typeof haySalidaEstandar(), 'boolean');
});
