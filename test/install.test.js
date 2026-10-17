/**
 * Pruebas de la instalación (Windows).
 *
 * Lo que se puede comprobar sin Windows: las rutas, los scripts de PowerShell,
 * los argumentos de reg.exe y la detección de "ya instalado". El flujo real se
 * prueba en la integración continua sobre Windows.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  NOMBRE, NOMBRE_VISIBLE, rutasInstalacion, scriptAccesosDirectos, scriptBorrarAccesosDirectos,
  argumentosRegistro, argumentosBorrarRegistro, esModoInstalado, instalar, desinstalar, version,
  lanzadorOculto, loteBorrado,
} from '../server/install.js';

const WIN_ENV = { LOCALAPPDATA: 'C:\\Users\\Ana\\AppData\\Local', APPDATA: 'C:\\Users\\Ana\\AppData\\Roaming' };
const WIN_HOME = 'C:\\Users\\Ana';

const rutasWin = () => rutasInstalacion({ platform: 'win32', env: WIN_ENV, homedir: WIN_HOME });
const normalizar = (ruta) => path.normalize(ruta).split(/[\\/]/).join('/');

test('las rutas de instalación van a la carpeta del usuario, sin pedir permisos', () => {
  const rutas = rutasWin();
  assert.equal(normalizar(rutas.dir), 'C:/Users/Ana/AppData/Local/Programs/Nebula');
  assert.equal(normalizar(rutas.exe), 'C:/Users/Ana/AppData/Local/Programs/Nebula/Nebula.exe');
  assert.equal(normalizar(rutas.datos), 'C:/Users/Ana/AppData/Roaming/Nebula', 'los datos van a %APPDATA%');
  assert.match(normalizar(rutas.menu), /Roaming\/Microsoft\/Windows\/Start Menu\/Programs$/);
  assert.equal(rutas.clave, 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Nebula');
  assert.equal(rutas.platform, 'win32');
});

test('los accesos directos se crean en el menú Inicio y en el escritorio', () => {
  const script = scriptAccesosDirectos(rutasWin());
  assert.match(script, /WScript\.Shell/);
  assert.match(script, /GetFolderPath\("Programs"\)/);
  assert.match(script, /GetFolderPath\("Desktop"\)/);
  assert.match(script, new RegExp(`${NOMBRE}\\.lnk`));
  assert.match(script, /Nebula\.vbs/, 'usa el lanzador oculto, sin ventana de consola');
  assert.match(script, /wscript\.exe/, 'lo abre con el intérprete de Windows');
  assert.match(script, /Nebula\.exe,0/, 'toma el icono del programa');
  assert.match(script, /IconLocation/);
  assert.match(script, /\$lnk\.Save\(\)/);
});

test('el acceso directo abre Nébula sin la ventana negra de la consola', () => {
  const vbs = lanzadorOculto();
  assert.match(vbs, /WScript\.Shell/, 'usa el intérprete de Windows');
  assert.match(vbs, /GetParentFolderName\(WScript\.ScriptFullName\)/, 'encuentra su propia carpeta');
  const linea = vbs.split('\r\n').find((l) => l.startsWith('shell.Run'));
  /* 0 = ventana oculta, False = no esperar a que termine */
  assert.equal(linea, 'shell.Run """" & carpeta & "\\Nebula.exe""", 0, False');
});

test('el borrado de accesos directos es tolerante: solo quita lo que existe', () => {
  const script = scriptBorrarAccesosDirectos();
  assert.match(script, /Test-Path \$lnk/);
  assert.match(script, /Remove-Item \$lnk -Force/);
});

test('el registro deja el programa en «Aplicaciones instaladas»', () => {
  const ordenes = argumentosRegistro(rutasWin(), { version: '1.1.0', tamanoKb: 87000 });
  const args = ordenes.flat().join(' ');
  assert.match(args, /^add "?HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Nebula/);
  assert.match(args, new RegExp(`/v DisplayName /t REG_SZ /d ${NOMBRE_VISIBLE}`), 'el nombre visible lleva tilde');
  assert.match(args, /\/v DisplayVersion \/t REG_SZ \/d 1\.1\.0/);
  assert.match(args, /\/v UninstallString \/t REG_SZ \/d .*Nebula\.exe --uninstall/, 'la orden de desinstalación apunta al programa');
  assert.match(args, /\/v QuietUninstallString \/t REG_SZ \/d .*Nebula\.exe --uninstall --silent/);
  assert.match(args, /\/v EstimatedSize \/t REG_DWORD \/d 87000/);
  assert.match(args, /\/v InstallLocation/);
  assert.match(args, /\/f/, 'sobrescribe si ya existía');
});

test('cada valor del registro se escribe en su propia orden de reg.exe', () => {
  /* con una sola orden para todo, un valor con comillas (la ruta al programa)
     descuadraba el análisis de reg.exe y no se escribía nada; además, así la
     primera orden crea la clave y un fallo suelto no se lleva por delante el resto */
  const ordenes = argumentosRegistro(rutasWin(), { version: '1.1.0', tamanoKb: 87000 });
  assert.ok(ordenes.length >= 9);
  for (const orden of ordenes) {
    assert.equal(orden[0], 'add');
    assert.equal(orden[1], rutasWin().clave);
    assert.equal(orden.filter((a) => a === '/v').length, 1, 'un solo valor por orden');
    assert.equal(orden.filter((a) => a === '/d').length, 1);
    assert.equal(orden[orden.length - 1], '/f');
  }
  assert.equal(ordenes[0][3], 'DisplayName', 'lo primero es lo que crea la clave');
  /* sin espacios en la ruta no hacen falta comillas dentro del valor */
  const conComillas = argumentosRegistro(rutasInstalacion({
    platform: 'win32',
    env: { LOCALAPPDATA: 'C:\\Users\\Ana María\\AppData\\Local', APPDATA: 'x' },
    homedir: 'C:\\Users\\Ana María',
  }), { version: '1.1.0' }).find((o) => o[3] === 'UninstallString');
  assert.equal(normalizar(conComillas[7]), '"C:/Users/Ana María/AppData/Local/Programs/Nebula/Nebula.exe" --uninstall');
});

test('la carpeta del programa se borra con un archivo por lotes', () => {
  /* una orden suelta con comillas dentro no vale: cmd.exe no entiende \" como
     comilla escapada y el borrado se quedaba a medias */
  const guardado = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = 'C:\\Users\\Ana María\\AppData\\Local';
  try {
    const lote = loteBorrado(rutasWin());
    assert.ok(lote.startsWith('@echo off'), 'es un archivo por lotes');
    assert.match(lote, /rmdir \/s \/q "%LOCALAPPDATA%\\Programs\\Nebula"/, 'usa la variable de entorno');
    assert.equal((lote.match(/rmdir/g) || []).length, 2, 'se intenta dos veces, por si el ejecutable aún se está cerrando');
    assert.equal((lote.match(/ping -n 3 127\.0\.0\.1 >nul/g) || []).length, 2, 'espera con ping, que funciona sin consola');
    assert.match(lote, /del \/f \/q "%~f0"/, 'se borra a sí mismo');
    assert.ok(/^[\x20-\x7e\r\n]*$/.test(lote), 'todo ASCII: así da igual la página de códigos');
    assert.ok(!lote.includes('María'), 'no escribe la ruta del usuario');
  } finally {
    if (guardado === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = guardado;
  }
});

test('el borrado de la carpeta no se ejecuta desde dentro de ella', () => {
  /* Windows no deja quitar el directorio de trabajo de un proceso: si cmd.exe
     arranca con la carpeta del programa como directorio actual, rmdir falla y
     la desinstalación deja la carpeta ahí. */
  const fuente = fs.readFileSync(new URL('../server/install.js', import.meta.url), 'utf8');
  assert.match(fuente, /cwd:\s*os\.tmpdir\(\)/, 'cmd.exe tiene que trabajar desde la carpeta temporal');
});

test('la desinstalación borra la clave del registro', () => {
  const args = argumentosBorrarRegistro(rutasWin());
  assert.deepEqual(args, ['delete', rutasWin().clave, '/f']);
});

test('esModoInstalado distingue la copia instalada de la descargada', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-inst-'));
  try {
    const dir = path.join(base, 'Programs', 'Nebula');
    fs.mkdirSync(dir, { recursive: true });
    const rutas = { dir };
    assert.equal(esModoInstalado({ execPath: path.join(dir, 'Nebula.exe'), rutas }), true);
    assert.equal(esModoInstalado({ execPath: path.join(base, 'Descargas', 'Nebula-Instalador.exe'), rutas }), false);
    assert.equal(esModoInstalado({ execPath: path.join(dir, 'sub', 'x.exe'), rutas }), false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('instalar y desinstalar avisan en vez de romper fuera de Windows', async () => {
  if (process.platform === 'win32') return; /* en Windows se prueban de verdad en la integración continua */
  await assert.rejects(() => instalar({ origen: process.execPath }), /es para Windows/);
  await assert.rejects(() => desinstalar({}), /es para Windows/);
});

test('la versión del instalador es la del programa', async () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(version(), pkg.version);
});
