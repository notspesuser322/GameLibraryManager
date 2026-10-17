#!/usr/bin/env node
/**
 * Prepara la carpeta dist/app con todo lo necesario para distribuir:
 * el servidor en un solo archivo (sin dependencias), la interfaz, la
 * documentación y la marca de "empaquetado" para que los datos se guarden en
 * la carpeta del usuario en vez de junto al programa.
 *
 *   node scripts/build-dist.mjs            → dist/app
 *   node scripts/build-dist.mjs --out dir  → otra carpeta
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const OUT = path.resolve(outFlag >= 0 ? args[outFlag + 1] : path.join(ROOT, 'dist', 'app'));

function log(message) {
  process.stdout.write(`  ${message}\n`);
}

async function loadEsbuild() {
  try {
    const module = await import('esbuild');
    return module;
  } catch {
    return null;
  }
}

async function copyDir(from, to, { skip = [] } = {}) {
  if (!fs.existsSync(from)) return 0;
  let count = 0;
  fs.mkdirSync(to, { recursive: true });
  for (const item of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip.includes(item.name)) continue;
    const source = path.join(from, item.name);
    const destination = path.join(to, item.name);
    if (item.isDirectory()) count += await copyDir(source, destination, { skip });
    else {
      fs.copyFileSync(source, destination);
      count++;
    }
  }
  return count;
}

export async function buildDist({ out = OUT, bundle = true, log = () => {} } = {}) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'server'), { recursive: true });
  log('limpiando salida…');

  /* 1. servidor: se empaqueta en un único archivo para que no haya sorpresas */
  const esbuild = bundle ? await loadEsbuild() : null;
  if (esbuild) {
    await esbuild.build({
      entryPoints: [path.join(ROOT, 'server', 'index.js')],
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      outfile: path.join(out, 'server', 'index.js'),
      logLevel: 'silent',
      legalComments: 'none',
      /* en CommonJS no existe import.meta.url: se reconstruye desde __filename */
      define: { 'import.meta.url': 'importMetaUrl' },
      banner: { js: "const importMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
    });
    log('servidor empaquetado (esbuild)');
  } else {
    await copyDir(path.join(ROOT, 'server'), path.join(out, 'server'));
    log('servidor copiado tal cual (esbuild no está instalado)');
  }

  /* 2. interfaz y documentación */
  const publicCount = await copyDir(path.join(ROOT, 'public'), path.join(out, 'public'));
  log(`${publicCount} archivos de interfaz`);
  const docsCount = await copyDir(path.join(ROOT, 'docs'), path.join(out, 'docs'));
  if (docsCount) log(`${docsCount} archivos de documentación`);

  /* 3. textos */
  for (const file of ['README.md', 'LICENSE', 'LEEME.txt']) {
    const source = path.join(ROOT, file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(out, file));
  }

  /* 4. marcas de versión y de empaquetado */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(out, 'VERSION'), `${pkg.version}\n`);
  fs.writeFileSync(path.join(out, '.packaged'), `${new Date().toISOString()}\n`);
  fs.writeFileSync(
    path.join(out, 'package.json'),
    `${JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: 'commonjs', main: 'server/index.js' }, null, 2)}\n`
  );
  log(`dist listo en ${out}`);
  return out;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  buildDist({ out: OUT, log }).catch((err) => {
    process.stderr.write(`Error al preparar la distribución: ${err.message}\n`);
    process.exit(1);
  });
}
