#!/usr/bin/env node
/**
 * Descarga el binario oficial de Node para Windows x64 usando el registro de
 * npm (paquete `node-win-x64`). Sirve para construir Ludoteca.exe desde Linux o
 * macOS, donde no hay node.exe disponible.
 *
 *   node scripts/fetch-node-win.mjs              → versión LTS de referencia
 *   node scripts/fetch-node-win.mjs --version 22.23.3
 *   node scripts/fetch-node-win.mjs --out dist/node-win
 *
 * Después:
 *
 *   node scripts/build-sea.mjs --runtime <carpeta>/package/bin/node.exe --out dist/Ludoteca.exe
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* versión de referencia: la misma que usa la integración continua */
const DEFAULT_VERSION = '22.23.3';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const version = arg('version', DEFAULT_VERSION);
const out = path.resolve(arg('out', path.join(ROOT, 'dist', 'node-win')));
const log = (message) => process.stdout.write(`  ${message}\n`);

const target = path.join(out, 'package', 'bin', 'node.exe');
if (fs.existsSync(target) && !process.argv.includes('--force')) {
  log(`ya estaba descargado: ${target}`);
  process.stdout.write(`${target}\n`);
  process.exit(0);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

log(`descargando Node ${version} para Windows x64 (vía npm)…`);
try {
  execFileSync('npm', ['pack', `node-win-x64@${version}`], { cwd: out, stdio: ['ignore', 'ignore', 'pipe'] });
} catch (err) {
  process.stderr.write(`No se pudo descargar el paquete: ${err.message}\n`);
  process.exit(1);
}

const tarball = fs.readdirSync(out).find((name) => name.endsWith('.tgz'));
if (!tarball) {
  process.stderr.write('La descarga no produjo ningún archivo .tgz\n');
  process.exit(1);
}
execFileSync('tar', ['xzf', tarball], { cwd: out, stdio: ['ignore', 'ignore', 'pipe'] });
fs.rmSync(path.join(out, tarball), { force: true });

if (!fs.existsSync(target)) {
  process.stderr.write('El paquete no contiene bin/node.exe\n');
  process.exit(1);
}

/* comprobación mínima: que sea un ejecutable de Windows con la marca SEA */
const data = fs.readFileSync(target);
const esPE = data.subarray(0, 2).toString() === 'MZ';
const tieneSea = data.includes(Buffer.from('NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'));
log(`node.exe descargado (${(data.length / 1048576).toFixed(1)} MB) · ejecutable de Windows: ${esPE ? 'sí' : 'no'} · admite ejecutable único: ${tieneSea ? 'sí' : 'no'}`);
if (!esPE || !tieneSea) process.exit(1);

process.stdout.write(`${target}\n`);
