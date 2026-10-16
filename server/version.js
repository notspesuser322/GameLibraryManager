/**
 * Versión de la aplicación: una sola fuente para el programa, el instalador y
 * el servidor. Al construir el ejecutable, la versión de package.json queda
 * incrustada como __LUDOTECA_VERSION__.
 */
import fs from 'node:fs';

export const VERSION = (() => {
  try {
    return __LUDOTECA_VERSION__;
  } catch {
    try {
      const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
      return pkg.version;
    } catch {
      return '0.0.0';
    }
  }
})();
