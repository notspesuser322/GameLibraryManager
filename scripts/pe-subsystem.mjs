/**
 * Marca de subsistema del ejecutable de Windows.
 *
 * Un ejecutable de Windows declara en su cabecera si es «de consola» (se abre
 * esa ventana negra) o «de ventana» (programa normal, sin consola). Node compila
 * su `node.exe` como programa de consola y el ejecutable que se genera con
 * `postject` hereda esa marca: por eso al abrir Nébula aparecía una ventana de
 * consola, con pinta de programa de Node.
 *
 * Aquí se cambia esa marca a «ventana» sobre el archivo ya terminado, sin tocar
 * nada más del binario. El programa sigue siendo el mismo (Node dentro del
 * ejecutable) pero Windows deja de abrir la consola.
 *
 * Datos del formato PE que se usan:
 *   · 0x3C                → posición de la firma «PE\0\0» (e_lfanew)
 *   · +4 (20 bytes)       → cabecera COFF
 *   · +24 + 0x44          → campo Subsystem de la cabecera opcional (2 bytes)
 *
 * Valores: 2 = ventana (`IMAGE_SUBSYSTEM_WINDOWS_GUI`),
 *          3 = consola (`IMAGE_SUBSYSTEM_WINDOWS_CUI`).
 */
import fs from 'node:fs';

export const SUBSISTEMA_VENTANA = 2;
export const SUBSISTEMA_CONSOLA = 3;

/** ¿Es un ejecutable de Windows? (los de Linux y macOS no tienen esta marca) */
export function esEjecutableDeWindows(buffer) {
  return buffer.length > 0x40 && buffer.readUInt16LE(0) === 0x5a4d; /* «MZ» */
}

/** Lee la marca de subsistema; devuelve null si el archivo no es un PE válido. */
export function leerSubsistema(buffer) {
  if (!esEjecutableDeWindows(buffer)) return null;
  const inicio = buffer.readUInt32LE(0x3c);
  if (inicio + 0x5c + 2 > buffer.length) return null;
  if (buffer.readUInt32LE(inicio) !== 0x00004550) return null; /* «PE\0\0» */
  return buffer.readUInt16LE(inicio + 0x5c);
}

/**
 * Cambia la marca de subsistema dentro del archivo comprimido en memoria.
 * @returns {boolean} true si el archivo quedó marcado como programa de ventana
 */
export function marcarSinConsola(buffer) {
  if (!esEjecutableDeWindows(buffer)) return false;
  const inicio = buffer.readUInt32LE(0x3c);
  if (inicio + 0x5c + 2 > buffer.length) return false;
  if (buffer.readUInt32LE(inicio) !== 0x00004550) return false;
  if (buffer.readUInt16LE(inicio + 0x5c) === SUBSISTEMA_VENTANA) return true;
  buffer.writeUInt16LE(SUBSISTEMA_VENTANA, inicio + 0x5c);
  return true;
}

/**
 * Aplica la marca al archivo en disco (se usa al construir el ejecutable).
 * @returns {boolean} true si se modificó
 */
export function quitarConsolaDelEjecutable(archivo) {
  const buffer = fs.readFileSync(archivo);
  if (!marcarSinConsola(buffer)) return false;
  fs.writeFileSync(archivo, buffer);
  return true;
}

/** Texto para los registros de compilación. */
export function describirSubsistema(valor) {
  if (valor === SUBSISTEMA_VENTANA) return 'programa de ventana (sin consola)';
  if (valor === SUBSISTEMA_CONSOLA) return 'programa de consola (con ventana negra)';
  return `desconocido (${valor})`;
}
