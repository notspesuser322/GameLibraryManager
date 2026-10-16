/**
 * Punto de entrada del instalador.
 *
 * El mismo archivo hace tres cosas, según cómo se ejecute:
 *
 *   1. Recién descargado  → instala (copia, accesos directos y registro).
 *   2. Ya instalado       → arranca la biblioteca.
 *   3. Con --uninstall    → se quita del equipo.
 *
 * Así el instalador y el programa son el mismo archivo: no hay dos cosas que
 * mantener ni versiones que se descuadren.
 */
import '../server/sea.js'; /* primero se preparan los archivos incrustados */
import { instalar, desinstalar, esModoInstalado, rutasInstalacion, version } from '../server/install.js';

const args = process.argv.slice(2);
const tiene = (nombre) => args.includes(nombre);
const silencioso = tiene('--silent') || tiene('-s') || tiene('--silencioso');

async function principal() {
  if (tiene('--version') || tiene('-v')) {
    console.log(`nebula ${version()}`);
    return;
  }
  if (tiene('--help') || tiene('-h')) {
    console.log(`Nébula ${version()} — instalador

Uso:
  Nebula-Instalador.exe              instala el programa y lo abre
  Nebula-Instalador.exe --silent     instala sin dialogos
  Nebula-Instalador.exe --uninstall  quita el programa del equipo

Una vez instalado, se usa el programa desde el menu Inicio o el escritorio.`);
    return;
  }
  if (tiene('--uninstall') || tiene('--desinstalar')) {
    await desinstalar({ silencioso, borrarDatos: tiene('--borrar-datos') });
    return;
  }

  const instalado = esModoInstalado();
  if (instalado && !tiene('--instalar') && !tiene('--reinstalar')) {
    /* ya instalado: se comporta como el programa normal */
    await import('../server/index.js');
    return;
  }

  if (process.platform !== 'win32') {
    console.error(`\n  Este instalador es para Windows. En este sistema ejecuta el programa directamente.\n`);
    process.exitCode = 1;
    return;
  }

  await instalar({ silencioso, origen: process.execPath, abrirAlTerminar: !silencioso });
}

principal().catch((err) => {
  console.error(`\n  No se pudo completar: ${err.message}\n`);
  process.exitCode = 1;
});

export { version, rutasInstalacion };
