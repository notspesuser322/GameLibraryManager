/**
 * Preparación de la salida por consola.
 *
 * Node escribe siempre en UTF-8, pero la consola de Windows suele usar otra
 * codificación (850, 1252, 936…). Cuando eso pasa, los adornos y los acentos se
 * ven como caracteres chinos o símbolos raros: «demostración» acaba siendo
 * «demostraci├│n» y la línea de guiones parece texto CJK.
 *
 * Aquí se intenta primero pasar la consola a UTF-8 y, si no se consigue, se
 * escribe todo en ASCII simple (sin acentos ni adornos) para que se lea bien
 * en cualquier equipo.
 *
 *   LUDOTECA_CONSOLE=ascii   fuerza el modo ASCII
 *   LUDOTECA_CONSOLE=utf8    fuerza UTF-8 (no intenta cambiar nada)
 */
import { execFileSync } from 'node:child_process';

let estado = null;

function consolaEnUtf8() {
  if (process.platform !== 'win32') {
    /* en sistemas tipo Unix los terminales son UTF-8 salvo locale POSIX */
    const locale = process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || '';
    return locale === '' || /utf-?8/i.test(locale);
  }
  const escribir = (comando) => {
    try {
      return execFileSync('cmd', ['/c', comando], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return '';
    }
  };
  /* se pregunta primero en qué codificación está y, si no es UTF-8, se cambia */
  const antes = escribir('chcp');
  if (/\b65001\b/.test(antes)) return true;
  escribir('chcp 65001');
  const despues = escribir('chcp');
  return /\b65001\b/.test(despues);
}

/** Convierte a ASCII simple: sin acentos, sin adornos ni comillas tipográficas. */
export function aAscii(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2500-\u257f]/g, '-')   /* líneas y cajas */
    .replace(/[ⓘ⏺●○]/g, '*')
    .replace(/[✖✗✘✅✔✓⚠◆■▶►]/g, (m) => ({
      '✖': 'x', '✗': 'x', '✘': 'x', '✅': 'ok', '✔': 'ok', '✓': 'ok', '⚠': '!',
      '◆': '*', '■': '*', '▶': '>', '►': '>',
    }[m] || '*'))
    .replace(/[·•]/g, '-')
    .replace(/…/g, '...')
    .replace(/[«»]/g, '"')
    .replace(/[—–]/g, '-')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ''); /* cualquier resto que no sea ASCII */
}

/**
 * Envuelve un flujo de salida para que todo lo que se le escriba sea ASCII.
 * Se usa con las funciones de `console`; se exporta para poder probarlo con un
 * flujo de mentira sin tocar la salida real del programa.
 */
export function envolverEscritura(flujo) {
  const original = flujo.write.bind(flujo);
  flujo.write = (chunk, ...rest) => {
    if (typeof chunk === 'string') return original(aAscii(chunk), ...rest);
    if (Buffer.isBuffer(chunk)) return original(Buffer.from(aAscii(chunk.toString('utf8')), 'utf8'), ...rest);
    return original(chunk, ...rest);
  };
  return flujo;
}

/**
 * Deja la consola lista para escribir. Devuelve true si se puede usar Unicode
 * (acentos y adornos) y false si se está en modo ASCII.
 */
export function prepararConsola({ forzar = process.env.LUDOTECA_CONSOLE || '' } = {}) {
  /* con un modo forzado se responde siempre igual, sin quedarse con el primero */
  if (estado && !forzar) return estado.unicode;

  let unicode;
  if (forzar === 'ascii') unicode = false;
  else if (forzar === 'utf8') unicode = true;
  else {
    try {
      unicode = consolaEnUtf8();
    } catch {
      unicode = false;
    }
  }

  if (!unicode && !console.__ludotecaAscii) {
    /* se envuelven las funciones de console, no la salida del proceso: así no se
       estorba a otras herramientas que escriban por stdout (por ejemplo, el
       propio ejecutor de pruebas) */
    for (const metodo of ['log', 'info', 'warn', 'error', 'debug']) {
      const original = console[metodo].bind(console);
      console[metodo] = (...args) => original(...args.map((arg) => (typeof arg === 'string' ? aAscii(arg) : arg)));
    }
    console.__ludotecaAscii = true;
  }

  /* se guarda para que las llamadas siguientes no repitan el trabajo; una
     llamada con modo forzado sí puede cambiarlo (útil en las pruebas) */
  estado = { unicode, decidido: true };
  return unicode;
}

/** Texto ya adaptado a la consola actual (para mensajes sueltos). */
export function texto(mensaje) {
  if (!estado) prepararConsola();
  return estado && !estado.unicode ? aAscii(mensaje) : String(mensaje);
}
