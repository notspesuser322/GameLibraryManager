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
import { leerSubsistema, quitarConsolaDelEjecutable, describirSubsistema, SUBSISTEMA_VENTANA } from './pe-subsystem.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
/* ventana nativa (C#): el programa que ve el usuario. Toda la interfaz esta
   dibujada con controles de Windows (sin navegador); el nucleo de Node es el
   motor que sirve la biblioteca y la ventana solo lo arranca y lo vigila. */
const PROYECTO_VENTANA = path.join(ROOT, 'nativo', 'Nebula.Ventana', 'Nebula.Ventana.csproj');
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

/**
 * Comprueba que el ejecutable terminado sirve de verdad: que la aplicación está
 * dentro (el blob completo), que el interruptor de arranque quedó encendido y,
 * en Windows, que no abre la ventana de consola. Si algo de esto falla, la
 * compilación se detiene: es mejor no publicar nada que publicar un archivo roto.
 */
function comprobarSalida(archivo, blob, log = write) {
  const datos = fs.readFileSync(archivo);
  if (!datos.includes(blob)) {
    throw new Error(`la aplicación no quedó dentro de ${path.basename(archivo)} (blob incompleto)`);
  }
  const indice = datos.indexOf(SENTINEL);
  if (indice < 0 || datos[indice + SENTINEL.length + 1] !== 0x31 /* «1» */) {
    throw new Error(`el interruptor de arranque de ${path.basename(archivo)} no quedó encendido`);
  }
  const subsistema = leerSubsistema(datos);
  if (archivo.toLowerCase().endsWith('.exe')) {
    if (subsistema !== SUBSISTEMA_VENTANA) {
      throw new Error(`el ejecutable de Windows quedó como programa de consola (${subsistema})`);
    }
    log(`sin consola: ${describirSubsistema(subsistema)}`);
  }
  return true;
}

/**
 * Comprueba que la ventana nativa salió como programa de ventana (sin consola).
 * Se lee la marca del propio ejecutable: si el compilador la dejara como consola,
 * aparecería la ventana negra otra vez.
 */
function comprobarVentana(archivo, log = write) {
  const subsistema = leerSubsistema(fs.readFileSync(archivo));
  if (subsistema !== SUBSISTEMA_VENTANA) {
    throw new Error(`la ventana nativa quedó como programa de consola (${subsistema})`);
  }
  log(`ventana nativa sin consola: ${describirSubsistema(subsistema)}`);
  return true;
}

/** ¿Hay compilador de .NET disponible en este equipo? */
export function hayDotnet() {
  try {
    execFileSync('dotnet', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Compila la ventana nativa (C#) y devuelve la carpeta con el resultado, o null
 * si en este equipo no se puede (sin .NET o sin Windows). Que no se pueda no
 * rompe la compilación: en ese caso queda solo el núcleo, que ya se abre en su
 * ventana propia como hasta ahora.
 */
export async function construirVentana({ log = write, forzar = false } = {}) {
  if (!forzar && process.platform !== 'win32') {
    log('aviso: la ventana nativa solo se compila en Windows; se sigue sin ella');
    return null;
  }
  if (!hayDotnet()) {
    log('aviso: no hay .NET instalado; se compila solo el nucleo (ventana de siempre)');
    return null;
  }
  const salida = path.join(ROOT, 'dist', 'ventana');
  fs.rmSync(salida, { recursive: true, force: true });
  log('compilando la ventana nativa (C#)...');
  execFileSync('dotnet', [
    'build', PROYECTO_VENTANA,
    '-c', 'Release',
    '--nologo',
    '-v', 'minimal',
    `-p:Version=${VERSION_PAQUETE}`,
    '-o', salida,
  ], { stdio: 'inherit', cwd: ROOT });

  const exe = path.join(salida, 'Nebula.exe');
  if (!fs.existsSync(exe)) throw new Error('la compilación de la ventana nativa no produjo Nebula.exe');
  comprobarVentana(exe, log);
  return salida;
}

/** Recursos que se incrustan en el instalador para poder copiar la ventana. */
export function assetsVentana(dirVentana) {
  const mapa = {};
  if (!dirVentana || !fs.existsSync(dirVentana)) return mapa;
  for (const item of fs.readdirSync(dirVentana, { withFileTypes: true })) {
    if (!item.isFile()) continue;
    mapa[`ventana/${item.name}`] = path.join(dirVentana, item.name);
  }
  return mapa;
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

  /* 6. programa de ventana: sin la ventana negra de consola delante del usuario */
  if (path.extname(out).toLowerCase() === '.exe' && !quitarConsolaDelEjecutable(out)) {
    throw new Error('no se pudo marcar el ejecutable como programa de ventana');
  }

  /* 7. comprobación final: que todo lo anterior esté de verdad dentro del archivo */
  comprobarSalida(out, blob, log);
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
    /* 1. la ventana nativa (C#), si este equipo puede compilarla */
    const dirVentana = await construirVentana({ log: write, forzar: arg('ventana', '') === 'forzar' });

    /* 2. el nucleo: el motor de siempre, con la biblioteca dentro */
    const nucleoOut = modo === 'portable' && dirVentana
      ? path.join(ROOT, 'dist', 'Nebula-nucleo.exe')
      : out;
    const result = await buildSea({
      runtime,
      out: nucleoOut,
      modo,
      assets: modo === 'instalador' ? assetsVentana(dirVentana) : {},
    });

    /* 3. reparto: el programa que se abre es la ventana; el nucleo va al lado */
    if (modo === 'portable' && dirVentana) {
      const carpeta = path.join(ROOT, 'dist', 'Nebula');
      fs.mkdirSync(carpeta, { recursive: true });
      for (const [clave, origen] of Object.entries(assetsVentana(dirVentana))) {
        const nombre = clave.replace('ventana/', '');
        fs.copyFileSync(origen, path.join(carpeta, nombre));
      }
      fs.copyFileSync(nucleoOut, path.join(carpeta, 'Nebula-nucleo.exe'));
      fs.copyFileSync(path.join(dirVentana, 'Nebula.exe'), out);
      /* el programa suelto en dist/ tambien necesita sus piezas al lado:
         sin Newtonsoft.Json.dll no arrancaria al probarlo desde ahi */
      for (const [clave, origen] of Object.entries(assetsVentana(dirVentana))) {
        const nombre = clave.replace('ventana/', '');
        if (nombre === path.basename(out)) continue;
        const destino = path.join(path.dirname(out), nombre);
        if (!fs.existsSync(destino)) fs.copyFileSync(origen, destino);
      }
      /* y el núcleo también en la raíz de dist, para poder probarlo suelto */
      write(`carpeta lista: ${path.relative(ROOT, carpeta)} (ventana + nucleo + LEEME)`);
      write(`programa: ${path.basename(out)} abre su ventana; motor: ${path.basename(nucleoOut)}`);
    } else if (dirVentana) {
      write(`ventana incrustada en el instalador (${Object.keys(assetsVentana(dirVentana)).length} archivos)`);
    }
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
