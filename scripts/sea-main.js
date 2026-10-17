/**
 * Punto de entrada del ejecutable único.
 *
 * El orden importa: primero se preparan los archivos incrustados (server/sea.js)
 * y solo después arranca el servidor de siempre (server/index.js).
 */
import '../server/sea.js';
import '../server/index.js';
