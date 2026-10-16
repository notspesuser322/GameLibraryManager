#!/usr/bin/env node
/**
 * Crea el ejecutable único de Nébula con el mecanismo oficial de Node (SEA).
 *
 *   node scripts/build-sea.mjs --runtime /ruta/a/node.exe --out dist/Nebula.exe
 *
 * Pasos:
 *   1. se empaqueta todo el servidor en un solo archivo (esbuild);
 *   2. se incrustan la interfaz y la documentación como recursos;
 *   3. Node genera el blob de la aplicación;
 *   4. se inyecta el blob dentro de una copia del binario de Node (postject).
 *
 * El resultado es un único archivo que no necesita Node instalado y que acepta
 * los mismos argumentos que el programa normal (--port, --demo, --open…).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const VERSION_PAQUETE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const write = (message) => process.stdout.write(`  ${message}\n`);
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Pone el icono y los datos del programa dentro del ejecutable de Windows.
 * Se hace con resedit (JavaScript puro) para que funcione desde cualquier
 * sistema, no solo desde Windows. Va ANTES de inyectar la aplicación, porque el
 * marcado reescribe el archivo.
 */
async function marcar(ejecutable, log = write) {
  const { marcarEjecutable } = await import('./brand-exe.mjs');
  const resultado = marcarEjecutable(ejecutable, {
    icono: path.join(ROOT, 'branding', 'icono.ico'),
    version: VERSION_PAQUETE,
    log,
  });
  if (!resultado.ok) log(`aviso: el ejecutable queda sin icono propio (${resultado.motivo})`);
  return resultado.ok;
}

/* los dos sabores del ejecutable: solo el programa, o instalable */
export const MODOS = {
  portable: {
    entry: path.join(ROOT, 'scripts', 'sea-main.js'),
    nombre: 'Nebula.exe',
    descripcion: 'version portable (el programa solo)',
  },
  instalador: {
    entry: path.join(ROOT, 'scripts', 'installer-main.js'),
    nombre: 'Nebula-Instalador.exe',
    descripcion: 'instalador (instala, arranca y se desinstala)',
  },
};

export async function buildSea({ runtime, out, log = write, prelude = [], assets = {}, modo = 'portable' } = {}) {
  const work = path.join(ROOT, 'dist', 'sea');
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });

  let esbuild;
  try {
    esbuild = await import('esbuild');
  } catch {
    throw new Error('Falta esbuild: ejecuta «npm install --no-save esbuild postject» antes de construir.');
  }
  let postject;
  try {
    postject = require('postject');
  } catch {
    throw new Error('Falta postject: ejecuta «npm install --no-save esbuild postject» antes de construir.');
  }

  /* 1. servidor + preludio en un solo archivo */
  const entrada = MODOS[modo] || MODOS.portable;
  const entry = entrada.entry;
  const version = VERSION_PAQUETE;
  const bundlePath = path.join(work, 'main.js');
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: bundlePath,
    logLevel: 'silent',
    legalComments: 'none',
    define: {
      'import.meta.url': 'importMetaUrl',
      __NEBULA_VERSION__: JSON.stringify(version),
    },
    banner: { js: "const importMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
    inject: prelude.length ? prelude : undefined,
  });
  log(`servidor empaquetado (${mb(fs.statSync(bundlePath).size)}) · ${entrada.descripcion}`);

  /* 2. recursos incrustados: interfaz y documentación */
  const assetList = { ...assets };
  for (const folder of ['public', 'docs']) {
    const base = path.join(ROOT, folder);
    if (!fs.existsSync(base)) continue;
    const walk = (dir) => {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) walk(full);
        else {
          const key = path.relative(ROOT, full).split(path.sep).join('/');
          assetList[key] = full;
        }
      }
    };
    walk(base);
  }
  log(`${Object.keys(assetList).length} recursos incrustados`);

  /* 3. blob de la aplicación */
  const configPath = path.join(work, 'sea-config.json');
  const blobPath = path.join(work, 'app.blob');
  fs.writeFileSync(configPath, `${JSON.stringify({
    main: bundlePath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets: assetList,
  }, null, 2)}\n`);
  execFileSync(process.execPath, ['--experimental-sea-config', configPath], { stdio: 'inherit' });
  const blob = fs.readFileSync(blobPath);
  log(`blob generado (${mb(blob.length)})`);

  /* 4. copia del binario de Node e inyección de la aplicación.
     El orden importa: postject primero, sobre el binario original de Node, y el
     icono y los datos del programa después. Al revés, postject avisa de que las
     tablas del ejecutable no cuadran y el archivo sale incompleto. */
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(runtime, out);
  if (process.platform !== 'win32') fs.chmodSync(out, 0o755);

  await postject.inject(out, 'NODE_SEA_BLOB', blob, {
    sentinelFuse: SENTINEL,
    machoSegmentName: 'NODE_SEA',
  });
  log(`aplicación inyectada (${mb(fs.statSync(out).size)})`);

  /* 5. icono propio y datos del programa (nombre, versión, autor) */
  if (path.extname(out).toLowerCase() === '.exe') await marcar(out, log);
  log(`ejecutable listo (${mb(fs.statSync(out).size)})`);
  return out;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const modo = arg('modo', 'portable');
  const definicion = MODOS[modo] || MODOS.portable;
  const runtime = arg('runtime', process.execPath);
  const porDefecto = process.platform === 'win32'
    ? definicion.nombre
    : definicion.nombre.replace(/\.exe$/, '').toLowerCase();
  const out = path.resolve(arg('out', path.join(ROOT, 'dist', porDefecto)));
  try {
    const result = await buildSea({ runtime, out, modo });
    process.stdout.write(`
  Ejecutable único: ${result}
  Doble clic para abrir la biblioteca, o desde la terminal:
     ${path.basename(result)} --port 4337 --open
`);
  } catch (err) {
    process.stderr.write(`\n  Error al construir: ${err.message}\n\n`);
    process.exit(1);
  }
}
