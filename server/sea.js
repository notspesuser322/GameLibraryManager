/**
 * Soporte del ejecutable único (Node SEA).
 *
 * Cuando la app arranca dentro del ejecutable, la interfaz viene incrustada y
 * aquí se extrae a la carpeta temporal del usuario para que el servidor la
 * sirva como siempre. Fuera del ejecutable este archivo no hace nada.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { prepararConsola } from './console.js';

prepararConsola();

const require = createRequire(import.meta.url);

let sea = null;
try {
  sea = require('node:sea');
} catch {
  sea = null; /* ejecución normal desde el repositorio */
}

if (sea && typeof sea.isSea === 'function' && sea.isSea()) {
  const keys = typeof sea.getAssetKeys === 'function' ? sea.getAssetKeys() : [];
  if (keys.length) {
    const stamp = crypto.createHash('sha1').update(`${keys.length}:${keys.join(',')}`).digest('hex').slice(0, 12);
    const target = path.join(os.tmpdir(), `ludoteca-${stamp}`);
    const marker = path.join(target, '.listo');
    if (!fs.existsSync(marker)) {
      try {
        for (const key of keys) {
          const destination = path.resolve(target, key);
          if (!destination.startsWith(target)) continue;
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          fs.writeFileSync(destination, Buffer.from(sea.getAsset(key)));
        }
        fs.writeFileSync(marker, new Date().toISOString());
      } catch (err) {
        /* si no se puede escribir se avisa y se sigue con lo que haya */
        try {
          console.error(`  No se pudieron preparar los archivos de la aplicación: ${err.message}`);
        } catch { /* sin salida disponible */ }
      }
    }
    process.env.LUDOTECA_ASSETS = target;
  }
  process.env.LUDOTECA_PACKAGED = '1';
}
