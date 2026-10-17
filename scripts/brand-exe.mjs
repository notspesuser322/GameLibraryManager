#!/usr/bin/env node
/**
 * Graba el icono y los datos del programa dentro de un .exe de Windows.
 *
 * Windows guarda el icono en un recurso del propio ejecutable: sin esto, el
 * explorador, la barra de tareas y el instalador muestran el icono genérico de
 * Node. Se hace con resedit, que está escrito en JavaScript y funciona igual en
 * Linux, macOS y Windows (así el .exe se puede preparar desde cualquier sistema,
 * sin depender de Windows ni de Wine).
 *
 *   node scripts/brand-exe.mjs --exe dist/Nebula.exe --icono branding/icono.ico
 *
 * Se ejecuta ANTES de inyectar la aplicación con postject: resedit reescribe el
 * archivo y hay que grabar el icono primero para no perder lo que venga después.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(nombre, porDefecto = null) {
  const indice = process.argv.indexOf(`--${nombre}`);
  return indice >= 0 ? process.argv[indice + 1] : porDefecto;
}

export function versionDelPaquete() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
}

/**
 * Marca un ejecutable de Windows: icono propio y datos de versión.
 * @returns {{ok: boolean, motivo?: string}}
 */
export function marcarEjecutable(rutaExe, {
  icono = path.join(ROOT, 'branding', 'icono.ico'),
  version = versionDelPaquete(),
  nombre = 'Nébula',
  log = (m) => process.stdout.write(`  ${m}\n`),
} = {}) {
  let resedit;
  try {
    resedit = require('resedit');
  } catch {
    return { ok: false, motivo: 'falta resedit (npm install --no-save resedit)' };
  }
  const { NtExecutable, NtExecutableResource, Resource, Data } = resedit;

  if (!fs.existsSync(rutaExe)) return { ok: false, motivo: `no existe ${rutaExe}` };

  const ejecutable = NtExecutable.from(fs.readFileSync(rutaExe), { ignoreCert: true });
  const recursos = NtExecutableResource.from(ejecutable);

  /* 1. icono: se leen todos los tamaños del .ico y se sustituye el grupo */
  if (fs.existsSync(icono)) {
    /* IconFile lee el .ico y separa cada tamaño; cada elemento trae su propio
       IconItem (mapa de bits) o RawIconItem (PNG), que es lo que espera el grupo */
    const archivoIcono = Data.IconFile.from(fs.readFileSync(icono));
    const items = archivoIcono.icons.map((entrada) => entrada.data);
    Resource.IconGroupEntry.replaceIconsForResource(recursos.entries, 1, 1033, items);
    log(`icono grabado (${items.length} tamaños: ${items.map((i) => `${i.width}px`).join(', ')})`);
  } else {
    log(`aviso: no se encontró ${icono}`);
  }

  /* 2. datos de versión que Windows muestra en las propiedades del archivo */
  const [mayor, menor, parche] = String(version).split('.').map((n) => Number(n) || 0);
  const info = Resource.VersionInfo.createEmpty();
  info.lang = 1033;  /* inglés (Estados Unidos), el idioma que Windows espera aquí */
  info.setFileVersion(mayor, menor, parche, 0);
  info.setProductVersion(mayor, menor, parche, 0);
  info.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      ProductName: nombre,
      FileDescription: `${nombre} - biblioteca de juegos`,
      CompanyName: nombre,
      LegalCopyright: nombre,
      OriginalFilename: path.basename(rutaExe),
      FileVersion: version,
      ProductVersion: version,
      InternalName: path.basename(rutaExe, '.exe'),
    },
  );
  /* el binario de Node ya traía sus propios datos de versión: se quitan para
     que Windows muestre los de Nébula y no los suyos */
  const ajenos = recursos.entries.filter((e) => e.type === 16);
  for (const ajeno of ajenos) recursos.entries.splice(recursos.entries.indexOf(ajeno), 1);
  info.outputToResourceEntries(recursos.entries);
  log(`datos del programa grabados (${nombre} ${version}${ajenos.length ? `; se quitaron ${ajenos.length} del binario de Node` : ''})`);

  recursos.outputResource(ejecutable);
  fs.writeFileSync(rutaExe, Buffer.from(ejecutable.generate()));
  log(`ejecutable preparado: ${path.basename(rutaExe)} (${(fs.statSync(rutaExe).size / 1048576).toFixed(1)} MB)`);
  return { ok: true };
}

const esMain = process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (esMain) {
  const ruta = arg('exe');
  if (!ruta) {
    process.stderr.write('Falta --exe (ruta del ejecutable a marcar)\n');
    process.exit(1);
  }
  const resultado = marcarEjecutable(path.resolve(ruta), {
    icono: path.resolve(arg('icono', path.join(ROOT, 'branding', 'icono.ico'))),
    version: arg('version', versionDelPaquete()),
    nombre: arg('nombre', 'Nébula'),
  });
  if (!resultado.ok) {
    process.stderr.write(`  ${resultado.motivo}\n`);
    process.exit(1);
  }
}

