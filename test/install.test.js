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
  lanzadorOculto,
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
  const args = argumentosRegistro(rutasWin(), { version: '1.1.0', tamanoKb: 87000 }).join(' ');
  assert.match(args, /^add "?HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Nebula/);
  assert.match(args, new RegExp(`/v DisplayName /t REG_SZ /d ${NOMBRE_VISIBLE}`), 'el nombre visible lleva tilde');
  assert.match(args, /\/v DisplayVersion \/t REG_SZ \/d 1\.1\.0/);
  assert.match(args, /\/v UninstallString \/t REG_SZ \/d ".*Nebula\.exe" --uninstall/);
  assert.match(args, /\/v QuietUninstallString \/t REG_SZ \/d ".*Nebula\.exe" --uninstall --silent/);
  assert.match(args, /\/v EstimatedSize \/t REG_DWORD \/d 87000/);
  assert.match(args, /\/v InstallLocation/);
  assert.match(args, /\/f /, 'sobrescribe si ya existía');
  assert.match(args, /87000$/, 'el tamaño estimado va al final');
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
