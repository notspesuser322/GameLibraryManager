/**
 * Pruebas del puente con Windows (PowerShell y VBScript).
 *
 * Lo importante aquí es que los scripts viajen enteros: se comprueba que al
 * codificarlos y decodificarlos llegan tal cual, sin que las comillas dobles de
 * dentro (las de las rutas) se rompan por el camino.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { codificar, argumentos, argumentosVbs } from '../server/powershell.js';
import { scriptAccesosDirectos, scriptAccesosDirectosVbs, scriptBorrarAccesosDirectosVbs, rutasInstalacion, anotar, RUTA_REGISTRO } from '../server/install.js';

const rutas = () => rutasInstalacion({
  platform: 'win32',
  env: { LOCALAPPDATA: 'C:\\Users\\Ana\\AppData\\Local', APPDATA: 'C:\\Users\\Ana\\AppData\\Roaming' },
  homedir: 'C:\\Users\\Ana',
});

test('el script de PowerShell viaja codificado y llega entero', () => {
  const script = scriptAccesosDirectos(rutas());
  const args = argumentos(script);
  assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy']);
  assert.equal(args[3], 'Bypass');
  assert.equal(args[4], '-EncodedCommand', 'nada de -Command con comillas sueltas');
  assert.equal(Buffer.from(args[5], 'base64').toString('utf16le'), script, 'llega igual que salió');
  assert.match(decodificado(args[5]), /WScript\.Shell/);
  assert.match(decodificado(args[5]), /Nebula\.vbs/);
});

test('codificar usa UTF-16, que es lo que espera Windows', () => {
  const original = 'Write-Host "acentos: Nébula"';
  assert.equal(Buffer.from(codificar(original), 'base64').toString('utf16le'), original);
  assert.equal(Buffer.from(codificar(original), 'base64').length, original.length * 2);
});

test('los archivos .vbs se ejecutan sin ventanas ni diálogos', () => {
  assert.deepEqual(argumentosVbs('C:\\Temp\\x.vbs'), ['//B', '//NoLogo', 'C:\\Temp\\x.vbs']);
});

test('el respaldo en VBScript crea los mismos accesos directos', () => {
  const r = rutas();
  const vbs = scriptAccesosDirectosVbs(r);
  assert.match(vbs, /CreateObject\("WScript\.Shell"\)/);
  assert.match(vbs, /Option Explicit/, 'declara las variables');
  assert.match(vbs, /Nebula\.vbs/);
  /* las comillas de la ruta se escriben con Chr(34) para no escapar nada */
  assert.match(vbs, /lnk\.Arguments = Chr\(34\) & ".*Nebula\.vbs" & Chr\(34\)/);
  assert.match(vbs, /lnk\.TargetPath = "%SystemRoot%\\System32\\wscript\.exe"/);
  assert.match(vbs, /lnk\.IconLocation = ".*Nebula\.exe,0"/);
  assert.match(vbs, /FolderExists/, 'no crea el acceso si la carpeta no existe');
  assert.ok(vbs.includes('Programs'), 'menú Inicio');
  assert.ok(vbs.includes('Desktop'), 'escritorio');
});

test('el borrado en VBScript quita los accesos sin fallar si no están', () => {
  const vbs = scriptBorrarAccesosDirectosVbs();
  assert.match(vbs, /FileExists\(lnk\)/);
  assert.match(vbs, /DeleteFile lnk, True/);
  assert.match(vbs, /Nebula\.lnk/);
});

test('la instalación deja un registro en texto de lo que va haciendo', () => {
  const antes = fs.existsSync(RUTA_REGISTRO) ? fs.statSync(RUTA_REGISTRO).size : 0;
  anotar('prueba: paso cualquiera');
  assert.ok(fs.existsSync(RUTA_REGISTRO), 'se crea el archivo');
  const contenido = fs.readFileSync(RUTA_REGISTRO, 'utf8');
  assert.match(contenido, /prueba: paso cualquiera/);
  assert.ok(fs.statSync(RUTA_REGISTRO).size > antes);
  assert.match(RUTA_REGISTRO, /Nebula-instalacion\.log$/, 'siempre en la carpeta temporal');
});

function decodificado(base64) {
  return Buffer.from(base64, 'base64').toString('utf16le');
}
