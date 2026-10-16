/**
 * Registro de la actividad del programa en un archivo.
 *
 * Nébula para Windows ya no es un programa de consola: es un programa con
 * ventana propia, así que no hay ninguna ventana negra donde leer los mensajes.
 * Todo lo que antes se veía ahí (arranque, escaneos, descargas, errores) se
 * guarda ahora en `<carpeta de datos>/Nebula.log`, que es lo que hay que mirar
 * —o pedir— cuando algo no funcione.
 *
 * Reglas:
 *   · El archivo recibe siempre el texto tal cual (con acentos).
 *   · La salida estándar solo se usa si de verdad existe un destino válido: al
 *     arrancar con doble clic no hay ninguno y escribir ahí haría fallar al
 *     programa. Se comprueba con `fstat`, que es barato y no engaña.
 *   · Si el archivo pasa de cierto tamaño se vacía, para que no crezca sin fin.
 */
import fs from 'node:fs';
import path from 'node:path';

const MAXIMO_POR_DEFECTO = 512 * 1024;
const NIVELES = ['log', 'info', 'warn', 'error', 'debug'];
const NOMBRE_ARCHIVO = 'Nebula.log';

let destino = null;
let propios = null;
let limite = MAXIMO_POR_DEFECTO;

/** ¿Hay dónde escribir de verdad? (terminal, archivo o tubería) */
export function haySalidaEstandar() {
  for (const flujo of [process.stdout, process.stderr]) {
    try {
      if (!flujo || flujo.destroyed) continue;
      const info = fs.fstatSync(flujo.fd);
      if (info.isFIFO() || info.isFile() || info.isCharacterDevice() || info.isSocket()) return true;
    } catch {
      /* sin manejador válido: este flujo no sirve */
    }
  }
  return false;
}

export function rutaRegistro() {
  return destino;
}

function textoDe(valor) {
  if (typeof valor === 'string') return valor;
  if (valor instanceof Error) return valor.stack || valor.message;
  try {
    return JSON.stringify(valor);
  } catch {
    return String(valor);
  }
}

function guardar(nivel, argumentos) {
  const linea = `${new Date().toISOString()} [${nivel}] ${argumentos.map(textoDe).join(' ')}\n`;
  try {
    if (fs.statSync(destino).size > limite) fs.writeFileSync(destino, '');
  } catch { /* el archivo puede no existir todavía */ }
  try {
    fs.appendFileSync(destino, linea, 'utf8');
  } catch { /* si no se puede escribir, no se interrumpe el programa */ }
}

/**
 * Prepara el registro. Devuelve la ruta del archivo o null si no se pudo usar.
 * @param {string} carpeta carpeta de datos del programa
 * @param {object} [opciones]
 * @param {boolean} [opciones.archivo] escribir el archivo (por defecto, sí)
 * @param {boolean} [opciones.consola] usar también la salida estándar si existe
 * @param {number} [opciones.maxBytes] tamaño a partir del cual se vacía
 */
export function prepararRegistro(carpeta, { archivo = true, consola = true, maxBytes = MAXIMO_POR_DEFECTO } = {}) {
  if (destino && propios) return destino; /* ya estaba preparado */

  limite = maxBytes;
  if (archivo) {
    try {
      fs.mkdirSync(carpeta, { recursive: true });
      destino = path.join(carpeta, NOMBRE_ARCHIVO);
      /* se estrena el archivo con una marca de arranque: así se ve cuándo empezó
         esta sesión y se distingue de la anterior */
      fs.appendFileSync(destino, `\n--- Nébula arrancó el ${new Date().toLocaleString('es-ES')} ---\n`, 'utf8');
    } catch {
      destino = null;
    }
  }

  if (!propios) {
    const usarConsola = consola && haySalidaEstandar();
    /* se guardan las funciones tal cual estaban (para devolverlas intactas) y
       aparte una copia atada a `console`, que es la que se usa para escribir */
    propios = { anteriores: {}, llamar: {} };
    for (const nivel of NIVELES) {
      propios.anteriores[nivel] = console[nivel];
      propios.llamar[nivel] = console[nivel].bind(console);
      const original = propios.llamar[nivel];
      console[nivel] = (...argumentos) => {
        if (destino) guardar(nivel, argumentos);
        if (usarConsola) {
          try {
            original(...argumentos);
          } catch { /* consola cerrada a mitad de faena */ }
        }
      };
    }
    /* si alguien escribe directamente en stdout/stderr, que un error de salida
       no tumbe el programa (pasa cuando no hay ventana de consola) */
    for (const flujo of [process.stdout, process.stderr]) {
      try {
        flujo.on('error', () => {});
      } catch { /* flujo de mentira en las pruebas */ }
    }
  }

  return destino;
}

/** Escribe una línea en el registro sin pasar por `console`. */
export function anotar(mensaje) {
  if (destino) guardar('log', [mensaje]);
}

/** Quita el registro: vuelve a dejar `console` como estaba (se usa en pruebas). */
export function detenerRegistro() {
  if (propios) {
    for (const nivel of NIVELES) console[nivel] = propios.anteriores[nivel];
    propios = null;
  }
  destino = null;
}
