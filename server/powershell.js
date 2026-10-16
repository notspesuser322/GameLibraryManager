/**
 * Ayudas para ejecutar órdenes de PowerShell y de Windows Script Host.
 *
 * Los scripts van codificados con `-EncodedCommand` (el texto en Base64 de
 * UTF-16LE). Pasar el código con `-Command` funciona en casos sencillos, pero
 * cuando dentro hay comillas dobles —y aquí las hay, para las rutas— Windows
 * compone la línea de órdenes de una forma que PowerShell interpreta mal: el
 * script falla, los accesos directos no se crean y no hay ningún mensaje claro.
 * Codificado no hay nada que interpretar.
 */

/** Script de PowerShell tal y como espera -EncodedCommand. */
export function codificar(script) {
  return Buffer.from(String(script), 'utf16le').toString('base64');
}

/** Argumentos para ejecutar un script de PowerShell sin ventanas. */
export function argumentos(script) {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', codificar(script)];
}

/** Argumentos para ejecutar un archivo .vbs sin ventanas ni diálogos. */
export function argumentosVbs(archivo) {
  return ['//B', '//NoLogo', archivo];
}

/** Cabecera de un script de VBScript con las utilidades que se usan aquí. */
export function cabeceraVbs() {
  return [
    'Option Explicit',
    'Dim shell, fso',
    'Set shell = CreateObject("WScript.Shell")',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
  ].join('\r\n');
}
