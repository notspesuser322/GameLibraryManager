/**
 * Empaquetado en un único ejecutable autocontenido.
 *
 * Idea: se toma el binario de Node (node.exe en Windows) y se le añaden dos cosas:
 *
 *   [ binario de Node ][ ZIP con la app ][ script lanzador (texto JS) ]
 *
 * Node ejecuta el script que encuentra tras el binario, y el script sabe leer el
 * ZIP que tiene justo antes (busca la firma de fin de directorio central), lo
 * extrae en la carpeta temporal y arranca el servidor. Resultado: un solo .exe
 * que no necesita Node instalado y que no escribe nada dentro de sí mismo.
 *
 * El ZIP se escribe a mano (deflate de node:zlib) para no depender de librerías.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

/* ------------------------------------------------------------------ CRC32 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

export function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

/* ------------------------------------------------------------------ ZIP: escritura */

/** Escribe un ZIP en memoria a partir de [{ name, data }]. */
export function writeZip(entries, { level = 9 } = {}) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const dosTime = 0; /* marca de tiempo neutra: hace el binario reproducible */
  const dosDate = (1 << 5) | 1; /* 1980-01-01 */

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const deflated = zlib.deflateRawSync(raw, { level });
    const useDeflate = deflated.length < raw.length;
    const data = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);      /* versión necesaria */
    local.writeUInt16LE(0x0800, 6);  /* nombres en UTF-8 */
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuffer, data);

    const centralEntry = Buffer.alloc(46);
    centralEntry.writeUInt32LE(0x02014b50, 0);
    centralEntry.writeUInt16LE(20, 4);
    centralEntry.writeUInt16LE(20, 6);
    centralEntry.writeUInt16LE(0x0800, 8);
    centralEntry.writeUInt16LE(method, 10);
    centralEntry.writeUInt16LE(dosTime, 12);
    centralEntry.writeUInt16LE(dosDate, 14);
    centralEntry.writeUInt32LE(crc, 16);
    centralEntry.writeUInt32LE(data.length, 20);
    centralEntry.writeUInt32LE(raw.length, 24);
    centralEntry.writeUInt16LE(nameBuffer.length, 28);
    centralEntry.writeUInt16LE(0, 30);
    centralEntry.writeUInt16LE(0, 32);
    centralEntry.writeUInt16LE(0, 34);
    centralEntry.writeUInt16LE(0, 36);
    centralEntry.writeUInt32LE(0, 38);
    centralEntry.writeUInt32LE(offset, 42);
    central.push(centralEntry, nameBuffer);

    offset += local.length + nameBuffer.length + data.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuffer, end]);
}

/* ------------------------------------------------------------------ ZIP: lectura */

/** Lee un ZIP completo desde un Buffer. Devuelve [{ name, data }]. */
export function readZip(buffer) {
  /* se busca la firma de fin de directorio central desde el final */
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 22 - 66_000; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('No se encontró el ZIP dentro del ejecutable');

  const count = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  /* el ZIP va precedido por el binario de Node: las posiciones son relativas
     al inicio del ZIP, que se deduce del propio fin de directorio central */
  const zipStart = eocd - centralSize - centralOffset;
  const entries = [];
  let pointer = zipStart + centralOffset;

  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) throw new Error('Directorio central dañado');
    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = zipStart + buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString('utf8', pointer + 46, pointer + 46 + nameLength);

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    const raw = method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
    entries.push({ name, data: raw });

    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/* --------------------------------------------------------------- lanzador */

/**
 * Script que Node ejecuta al arrancar el .exe. Extrae el ZIP en la caché del
 * usuario y arranca el servidor. Debe ser JS válido sin depender de nada.
 */
export const LAUNCHER_SOURCE = String.raw`/* Ludoteca — lanzador del ejecutable autocontenido */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

function fail(message) {
  process.stderr.write('\n  Ludoteca no pudo iniciar: ' + message + '\n\n');
  process.exit(1);
}

try {
  const self = fs.readFileSync(process.execPath);
  let eocd = -1;
  const limit = Math.max(0, self.length - 22 - 66000);
  for (let i = self.length - 22; i >= limit; i--) {
    if (self.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) fail('no se encontró el archivo interno de la aplicación');

  const count = self.readUInt16LE(eocd + 10);
  const centralOffset = self.readUInt32LE(eocd + 16);
  const centralSize = self.readUInt32LE(eocd + 12);
  /* el ZIP va después del binario de Node: se deduce su inicio del propio EOCD */
  const zipStart = eocd - centralSize - centralOffset;
  let pointer = zipStart + centralOffset;
  const files = [];
  for (let i = 0; i < count; i++) {
    const method = self.readUInt16LE(pointer + 10);
    const compressedSize = self.readUInt32LE(pointer + 20);
    const nameLength = self.readUInt16LE(pointer + 28);
    const extraLength = self.readUInt16LE(pointer + 30);
    const commentLength = self.readUInt16LE(pointer + 32);
    const localOffset = zipStart + self.readUInt32LE(pointer + 42);
    const name = self.toString('utf8', pointer + 46, pointer + 46 + nameLength);
    const localNameLength = self.readUInt16LE(localOffset + 26);
    const localExtraLength = self.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    files.push({ name, method, dataStart, compressedSize });
    pointer += 46 + nameLength + extraLength + commentLength;
  }

  const stamp = crypto.createHash('sha1').update(String(self.length) + ':' + String(count)).digest('hex').slice(0, 12);
  const target = path.join(os.tmpdir(), 'ludoteca-' + stamp);
  const marker = path.join(target, '.listo');

  if (!fs.existsSync(marker)) {
    fs.mkdirSync(target, { recursive: true });
    for (const file of files) {
      const destination = path.join(target, file.name);
      if (!destination.startsWith(target)) continue;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const slice = self.subarray(file.dataStart, file.dataStart + file.compressedSize);
      const raw = file.method === 8 ? zlib.inflateRawSync(slice) : slice;
      fs.writeFileSync(destination, raw);
    }
    fs.writeFileSync(marker, String(Date.now()));
  }

  process.env.LUDOTECA_PACKAGED = '1';
  const entry = path.join(target, 'server', 'index.js');
  if (!fs.existsSync(entry)) fail('falta el archivo principal en el paquete');

  /* argumentos: el primero es la ruta del propio .exe */
  const args = process.argv.slice(1);
  process.argv = [process.execPath, entry, ...args];
  require(entry);
} catch (err) {
  fail(err && err.message ? err.message : String(err));
}
`;

/* --------------------------------------------------------------- binario */

/**
 * Construye el ejecutable final: binario + ZIP + lanzador.
 * @param {object} options
 * @param {string} options.runtime Ruta del binario de Node (node.exe)
 * @param {Array}  options.entries Archivos de la app [{ name, data }]
 * @param {string} [options.launcher] Script lanzador (por defecto LAUNCHER_SOURCE)
 * @returns {{ buffer: Buffer, zipSize: number, launcherSize: number }}
 */
export function createPortableExecutable({ runtime, entries, launcher = LAUNCHER_SOURCE }) {
  const runtimeBuffer = fs.readFileSync(runtime);
  const zip = writeZip(entries);
  const launcherBuffer = Buffer.from(`\n${launcher}`, 'utf8');
  return {
    buffer: Buffer.concat([runtimeBuffer, zip, launcherBuffer]),
    zipSize: zip.length,
    launcherSize: launcherBuffer.length,
    runtimeSize: runtimeBuffer.length,
  };
}

/** Recorre una carpeta y devuelve entradas { name, data } relativas a ella. */
export function collectFiles(root, { skip = [] } = {}) {
  const entries = [];
  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (skip.some((pattern) => rel === pattern || rel.startsWith(`${pattern}/`))) continue;
      if (item.isDirectory()) walk(full);
      else if (item.isFile()) entries.push({ name: rel, data: fs.readFileSync(full) });
    }
  };
  walk(root);
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}
