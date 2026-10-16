#!/usr/bin/env node
/**
 * Crea el ejecutable autocontenido de Nébula.
 *
 *   node scripts/build-portable.mjs --runtime node.exe --out dist/Nebula.exe
 *
 * El resultado no necesita Node instalado: lleva dentro el binario y la app.
 * Se usa desde GitHub Actions con el node.exe oficial de Windows, pero sirve
 * igual con el binario de Linux o macOS para probar el mecanismo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPortableExecutable, collectFiles, readZip } from './portable.mjs';
import { buildDist } from './build-dist.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const runtime = arg('runtime');
const out = path.resolve(arg('out', path.join(ROOT, 'dist', process.platform === 'win32' ? 'Nebula.exe' : 'nebula')));
const appDir = path.resolve(arg('app', path.join(ROOT, 'dist', 'app')));
const skipBuild = process.argv.includes('--no-build');

if (!runtime) {
  process.stderr.write('Falta --runtime (ruta del binario de Node, por ejemplo node.exe)\n');
  process.exit(1);
}
if (!fs.existsSync(runtime)) {
  process.stderr.write(`No se encuentra el binario: ${runtime}\n`);
  process.exit(1);
}

if (!skipBuild || !fs.existsSync(path.join(appDir, 'server', 'index.js'))) {
  await buildDist({ out: appDir, log: (message) => process.stdout.write(`  ${message}\n`) });
}

const entries = collectFiles(appDir, { skip: ['.packaged'] });
const result = createPortableExecutable({ runtime, entries });

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, result.buffer);
if (process.platform !== 'win32') fs.chmodSync(out, 0o755);

/* comprobación: el ZIP debe poder releerse de dentro del ejecutable */
const verified = readZip(result.buffer);
const missing = ['server/index.js', 'public/index.html'].filter((name) => !verified.some((entry) => entry.name === name));

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
process.stdout.write(`
  Ejecutable creado: ${out}
  ─────────────────────────────────────────
  runtime de Node : ${mb(result.runtimeSize)}
  aplicación      : ${mb(result.zipSize)} (${entries.length} archivos)
  lanzador        : ${mb(result.launcherSize)}
  total           : ${mb(result.buffer.length)}
  verificación    : ${missing.length ? `FALTAN ${missing.join(', ')}` : 'correcta'}
`);

if (missing.length) process.exit(1);
