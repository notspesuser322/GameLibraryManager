/**
 * Instalación y desinstalación en Windows.
 *
 * El instalador es el propio programa: al ejecutarlo desde la carpeta de
 * descargas copia una versión suya en la carpeta del usuario, crea los accesos
 * directos y lo registra en "Aplicaciones instaladas". Esa copia, al abrirse,
 * detecta que ya está instalada y arranca la biblioteca; con `--uninstall` se
 * borra sola.
 *
 * Todo es por usuario (no pide permisos de administrador):
 *   programa   %LOCALAPPDATA%\Programs\Nebula
 *   menú       %APPDATA%\Microsoft\Windows\Start Menu\Programs
 *   registro   HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Nébula
 *   datos      %APPDATA%\Nébula  (se conservan al desinstalar)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { VERSION } from './version.js';

export const NOMBRE = 'Nebula';          /* carpeta y ejecutable, sin tildes */
export const NOMBRE_VISIBLE = 'Nébula';  /* lo que se ve en Windows */
export const CLAVE_REGISTRO = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${NOMBRE}`;

export function version() {
  return VERSION;
}

/** Rutas que usa la instalación. Función pura: sirve para cualquiera, no solo Windows. */
export function rutasInstalacion({
  env = process.env,
  homedir = os.homedir(),
  platform = process.platform,
} = {}) {
  const base = env.LOCALAPPDATA || path.join(homedir, 'AppData', 'Local');
  const roaming = env.APPDATA || path.join(homedir, 'AppData', 'Roaming');
  const dir = path.join(base, 'Programs', NOMBRE);
  return {
    dir,
    exe: path.join(dir, `${NOMBRE}.exe`),
    lanzador: path.join(dir, `${NOMBRE}.cmd`),
    lanzadorOculto: path.join(dir, `${NOMBRE}.vbs`),
    menu: path.join(roaming, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    escritorio: path.join(homedir, 'Desktop'),
    datos: path.join(roaming, NOMBRE),
    clave: CLAVE_REGISTRO,
    platform,
  };
}

/**
 * Contenido del lanzador oculto (VBS).
 * Sirve para que al abrir Nébula desde el acceso directo no aparezca la ventana
 * negra de la consola: el programa se abre como cualquier aplicación de Windows.
 */
export function lanzadorOculto() {
  /* las comillas dobles dentro de una cadena de VBS se escriben duplicadas */
  const orden = 'shell.Run """" & carpeta & "\\Nebula.exe""", 0, False';
  return [
    "' Abre Nebula sin mostrar la ventana de consola.",
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'carpeta = fso.GetParentFolderName(WScript.ScriptFullName)',
    'Set shell = CreateObject("WScript.Shell")',
    'shell.CurrentDirectory = carpeta',
    orden,
    '',
  ].join('\r\n');
}

/** Devuelve el script de PowerShell que crea los dos accesos directos. */
export function scriptAccesosDirectos(rutas) {
  /* el acceso directo apunta al lanzador oculto, con el icono del programa */
  const wscript = '%SystemRoot%\\System32\\wscript.exe';
  return [
    '$ErrorActionPreference = "Stop"',
    '$shell = New-Object -ComObject WScript.Shell',
    'foreach ($base in @([Environment]::GetFolderPath("Programs"), [Environment]::GetFolderPath("Desktop"))) {',
    '  if (-not $base) { continue }',
    `  $lnk = $shell.CreateShortcut((Join-Path $base "${NOMBRE}.lnk"))`,
    `  $lnk.TargetPath = "${wscript}"`,
    `  $lnk.Arguments = '"${rutas.lanzadorOculto}"'`,
    `  $lnk.WorkingDirectory = "${rutas.dir}"`,
    `  $lnk.IconLocation = "${rutas.exe},0"`,
    `  $lnk.Description = "Biblioteca de juegos"`,
    '  $lnk.Save()',
    '}',
  ].join('\n');
}

/** Script de PowerShell que borra los accesos directos. */
export function scriptBorrarAccesosDirectos() {
  return [
    '$shell = New-Object -ComObject WScript.Shell',
    'foreach ($base in @([Environment]::GetFolderPath("Programs"), [Environment]::GetFolderPath("Desktop"))) {',
    '  if (-not $base) { continue }',
    `  $lnk = Join-Path $base "${NOMBRE}.lnk"`,
    '  if (Test-Path $lnk) { Remove-Item $lnk -Force }',
    '}',
  ].join('\n');
}

/** Argumentos de reg.exe para registrar el programa en "Aplicaciones instaladas". */
export function argumentosRegistro(rutas, datos = {}) {
  const v = datos.version || version();
  const tamanoKb = datos.tamanoKb || null;
  const pares = [
    ['DisplayName', NOMBRE_VISIBLE],
    ['DisplayVersion', v],
    ['Publisher', 'Nebula'],
    ['DisplayIcon', `${rutas.exe},0`],
    ['InstallLocation', rutas.dir],
    ['UninstallString', `"${rutas.exe}" --uninstall`],
    ['QuietUninstallString', `"${rutas.exe}" --uninstall --silent`],
    ['NoModify', '1'],
    ['NoRepair', '1'],
    ['EstimatedSize', tamanoKb ? String(Math.round(tamanoKb)) : null],
  ].filter(([, valor]) => valor !== null && valor !== undefined);

  const args = ['add', rutas.clave, '/f'];
  for (const [nombre, valor] of pares) args.push('/v', nombre, '/t', nombre === 'EstimatedSize' ? 'REG_DWORD' : 'REG_SZ', '/d', valor);
  return args;
}

/** Argumentos de reg.exe para quitar el registro. */
export function argumentosBorrarRegistro(rutas) {
  return ['delete', rutas.clave, '/f'];
}

/** ¿El ejecutable actual es la copia instalada? */
export function esModoInstalado({ execPath = process.execPath, rutas = rutasInstalacion() } = {}) {
  const aqui = path.resolve(path.dirname(execPath)).toLowerCase();
  const destino = path.resolve(rutas.dir).toLowerCase();
  return aqui === destino;
}

function ejecutar(comando, args, { silencioso = false } = {}) {
  const resultado = spawnSync(comando, args, {
    windowsHide: true,
    stdio: silencioso ? 'ignore' : 'inherit',
    encoding: 'utf8',
  });
  if (resultado.error) throw resultado.error;
  if (typeof resultado.status === 'number' && resultado.status !== 0) {
    throw new Error(`${comando} terminó con código ${resultado.status}`);
  }
  return resultado;
}

function powershell(script) {
  ejecutar('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { silencioso: true });
}

function carpetaSizeKb(dir) {
  let total = 0;
  const recorrer = (actual) => {
    for (const item of fs.readdirSync(actual, { withFileTypes: true })) {
      const completo = path.join(actual, item.name);
      if (item.isDirectory()) recorrer(completo);
      else {
        try {
          total += fs.statSync(completo).size;
        } catch { /* archivo en uso */ }
      }
    }
  };
  try {
    recorrer(dir);
  } catch { /* sin carpeta */ }
  return total / 1024;
}

/** Cuadro de diálogo de Windows (devuelve true si se pulsó Aceptar). */
function preguntar(titulo, texto) {
  const script = `
    Add-Type -AssemblyName PresentationFramework
    $r = [System.Windows.MessageBox]::Show("${texto.replace(/"/g, '`"')}", "${titulo}", "YesNo", "Information")
    if ($r -eq "Yes") { exit 0 } else { exit 1 }`;
  const resultado = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
  return resultado.status === 0;
}

function mostrarAviso(titulo, texto) {
  const script = `
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("${texto.replace(/"/g, '`"')}", "${titulo}", "OK", "Information") | Out-Null`;
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
}

/** Abre la aplicación ya instalada, sin ventana de consola propia. */
function abrir(rutas) {
  spawn(rutas.exe, ['--open'], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
}

const escribir = (texto) => process.stdout.write(`${texto}\n`);

/**
 * Instala el programa a partir del ejecutable que se está ejecutando.
 * @param {object} opciones
 * @param {string} opciones.origen  Ruta del ejecutable actual (el instalador)
 * @param {boolean} opciones.silencioso  Sin diálogos (para pruebas automáticas)
 * @param {boolean} opciones.abrirAlTerminar  Abrir la app cuando termine
 */
export async function instalar({ origen = process.execPath, silencioso = false, abrirAlTerminar = true, rutas = rutasInstalacion() } = {}) {
  if (rutas.platform !== 'win32' || process.platform !== 'win32') {
    throw new Error('El instalador es para Windows. En este sistema usa el programa directamente.');
  }
  if (!fs.existsSync(origen)) throw new Error(`No se encuentra el instalador: ${origen}`);

  if (!silencioso) escribir(`\n  Instalando ${NOMBRE} ${version()}…\n`);
  fs.mkdirSync(rutas.dir, { recursive: true });

  /* 1. el programa: una copia del propio instalador */
  const destino = rutas.exe;
  if (path.resolve(origen).toLowerCase() !== path.resolve(destino).toLowerCase()) {
    fs.copyFileSync(origen, destino);
    if (!silencioso) escribir(`  Programa:  ${rutas.dir}`);
  }

  /* 2. lanzador de consola (opcional) y lanzador oculto que usan los accesos directos */
  const lanzador = `@echo off\r\ntitle ${NOMBRE_VISIBLE}\r\ncd /d "%~dp0"\r\n${NOMBRE}.exe %*\r\n`;
  fs.writeFileSync(rutas.lanzador, lanzador, 'latin1');
  fs.writeFileSync(rutas.lanzadorOculto, lanzadorOculto(), 'latin1');

  /* 3. accesos directos en el menú Inicio y en el escritorio */
  try {
    powershell(scriptAccesosDirectos(rutas));
    if (!silencioso) escribir('  Accesos directos: menú Inicio y escritorio');
  } catch (err) {
    if (!silencioso) escribir(`  Aviso: no se pudieron crear los accesos directos (${err.message})`);
  }

  /* 4. registro en "Aplicaciones instaladas" */
  try {
    ejecutar('reg.exe', argumentosRegistro(rutas, { version: version(), tamanoKb: carpetaSizeKb(rutas.dir) }), { silencioso: true });
    if (!silencioso) escribir('  Aparecerá en Aplicaciones instaladas para poder quitarlo');
  } catch (err) {
    if (!silencioso) escribir(`  Aviso: no se pudo registrar la desinstalación (${err.message})`);
  }

  if (!silencioso) {
    escribir(`  Datos:     ${rutas.datos}`);
    escribir(`\n  Listo. Abre «${NOMBRE_VISIBLE}» desde el menú Inicio o el escritorio.\n`);
  }

  if (abrirAlTerminar && !silencioso) {
    if (preguntar(NOMBRE_VISIBLE, `${NOMBRE_VISIBLE} ${version()} se instaló correctamente.\\n\\n¿Quieres abrirla ahora?`)) abrir(rutas);
  } else if (abrirAlTerminar) {
    abrir(rutas);
  }
  return rutas;
}

/**
 * Desinstala: quita accesos, registro y carpeta del programa.
 * Los datos del usuario (%APPDATA%\Nébula) se conservan salvo que se pida lo contrario.
 */
export async function desinstalar({ silencioso = false, borrarDatos = false, rutas = rutasInstalacion() } = {}) {
  if (rutas.platform !== 'win32' || process.platform !== 'win32') {
    throw new Error('La desinstalación es para Windows.');
  }
  if (!silencioso) escribir(`\n  Quitando ${NOMBRE_VISIBLE}…\n`);

  try {
    powershell(scriptBorrarAccesosDirectos());
    if (!silencioso) escribir('  Accesos directos eliminados');
  } catch { /* si no estaban, da igual */ }

  try {
    fs.rmSync(rutas.lanzadorOculto, { force: true });
  } catch { /* ya no estaba */ }

  try {
    ejecutar('reg.exe', argumentosBorrarRegistro(rutas), { silencioso: true });
    if (!silencioso) escribir('  Registro de desinstalación eliminado');
  } catch { /* si no estaba, da igual */ }

  if (borrarDatos && fs.existsSync(rutas.datos)) {
    try {
      fs.rmSync(rutas.datos, { recursive: true, force: true });
      if (!silencioso) escribir('  Datos de la biblioteca eliminados');
    } catch { /* archivos en uso */ }
  }

  /* la carpeta del programa se borra después de cerrar: Windows no deja
     eliminar un ejecutable en marcha, así que se deja encargado a cmd.exe */
  const carpeta = rutas.dir;
  /* se espera con ping (funciona sin consola, timeout no) y se intenta dos veces */
  const orden = `ping -n 3 127.0.0.1 >nul & rmdir /s /q "${carpeta}" & ping -n 3 127.0.0.1 >nul & rmdir /s /q "${carpeta}"`;
  try {
    spawn('cmd.exe', ['/d', '/s', '/c', orden], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    if (!silencioso) escribir('  Programa eliminado (la carpeta se borra al cerrar)');
  } catch (err) {
    if (!silencioso) escribir(`  Aviso: no se pudo programar el borrado (${err.message})`);
  }

  if (!silencioso) {
    escribir(`\n  ${NOMBRE_VISIBLE} se quitó del equipo.`);
    if (!borrarDatos) escribir(`  Tu biblioteca sigue en ${rutas.datos} por si quieres volver a instalarlo.\n`);
  }
  return true;
}

export { mostrarAviso };
