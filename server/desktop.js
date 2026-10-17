/**
 * Modo aplicación de escritorio.
 *
 * Nébula arranca su servidor y abre una ventana propia (sin barra de direcciones,
 * sin pestañas, con el icono del programa) en vez de una pestaña del navegador.
 * Si no hay ninguna ventana disponible —por ejemplo al arrancar sin entorno
 * gráfico, en un servidor o cuando el usuario lo pide con --browser—, se abre el
 * navegador de siempre, que es el comportamiento anterior.
 *
 * La ventana se elige en este orden:
 *   1. Chrome, Edge, Brave u Opera en «modo aplicación» (--app=…)
 *   2. WebView de Windows por PowerShell
 *   3. el navegador predeterminado (modo web)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { USER_AGENT } from './http.js';
import { argumentos } from './powershell.js';

/** Perfil propio de la ventana: al cerrarla no queda nada abierto. */
function perfilVentana() {
  return path.join(os.tmpdir(), 'Nebula', 'ventana');
}

/**
 * Rutas habituales de los navegadores basados en Chromium, por sistema.
 * Se puede indicar otro entorno y otro sistema para poder comprobarlo en las
 * pruebas sin depender de lo que haya instalado en el equipo.
 */
function candidatos({ env = process.env, platform = process.platform } = {}) {
  const lista = [];
  const agregar = (ruta, nombre) => { if (ruta) lista.push({ ruta, nombre }); };

  if (platform === 'win32') {
    const pf = env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    agregar(path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'), 'Chrome');
    agregar(path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'), 'Chrome');
    agregar(path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'), 'Chrome');
    agregar(path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), 'Edge');
    agregar(path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), 'Edge');
    agregar(path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), 'Brave');
    agregar(path.join(pf, 'Opera', 'launcher.exe'), 'Opera');
  } else if (platform === 'darwin') {
    agregar('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'Chrome');
    agregar('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', 'Edge');
    agregar('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', 'Brave');
    agregar('/Applications/Chromium.app/Contents/MacOS/Chromium', 'Chromium');
  } else {
    for (const nombre of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser']) {
      const encontrado = buscarEnPath(nombre, env.PATH);
      agregar(encontrado, nombre);
    }
  }

  /* se admite indicar uno concreto con NEBULA_NAVEGADOR */
  const propio = env.NEBULA_NAVEGADOR;
  if (propio) lista.unshift({ ruta: propio, nombre: 'indicado' });

  return lista.filter((c, i, todos) => todos.findIndex((o) => o.ruta === c.ruta) === i);
}

function buscarEnPath(nombre, ruta = process.env.PATH) {
  const rutas = String(ruta || '').split(path.delimiter);
  for (const carpeta of rutas) {
    const completo = path.join(carpeta, nombre);
    try {
      if (fs.existsSync(completo)) return completo;
    } catch { /* sin permiso */ }
  }
  return null;
}

/** Primer navegador disponible que exista de verdad. */
export function navegadorDisponible({ env = process.env, platform = process.platform } = {}) {
  for (const candidato of candidatos({ env, platform })) {
    try {
      if (fs.statSync(candidato.ruta).isFile()) return candidato;
    } catch { /* no está */ }
  }
  return null;
}

/** Argumentos para abrirlo como aplicación (sin barra de direcciones). */
export function argumentosVentana(url, { perfil = perfilVentana(), ancho = 1280, alto = 820 } = {}) {
  return [
    `--app=${url}`,
    `--user-data-dir=${perfil}`,
    `--window-size=${ancho},${alto}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,TranslateUI',
    '--disable-translate',
    '--noerrdialogs',
    '--disable-session-crashed-bubble',
    `--user-agent=${USER_AGENT}`,
  ];
}

/**
 * Abre la ventana de la aplicación.
 * @returns {{ok: boolean, modo: 'ventana'|'web'|'ninguno', detalle: string}}
 */
export function abrirVentana(url, { forzarNavegador = false, log = () => {} } = {}) {
  if (forzarNavegador) {
    abrirNavegador(url);
    return { ok: true, modo: 'web', detalle: 'el navegador predeterminado (pedido con --browser)' };
  }

  const navegador = navegadorDisponible();
  if (navegador) {
    const resultado = lanzar(navegador.ruta, argumentosVentana(url), { windowsHide: false });
    if (resultado.ok) {
      return {
        ok: true,
        modo: 'ventana',
        detalle: `${navegador.nombre} en modo aplicación`,
        pid: resultado.proceso?.pid || null,
      };
    }
    log(`No se pudo abrir la ventana con ${navegador.nombre}: ${resultado.problema?.message || 'error desconocido'}`);
  }

  /* Windows sin Chrome/Edge: WebView por PowerShell */
  if (process.platform === 'win32') {
    const resultado = abrirWebViewWindows(url);
    if (resultado.ok) return resultado;
  }

  abrirNavegador(url);
  return {
    ok: true,
    modo: 'web',
    detalle: navegador ? 'el navegador predeterminado' : 'el navegador predeterminado (no se encontró Chrome ni Edge)',
  };
}

/** Ventana nativa usando el WebView del sistema (solo Windows). */
function abrirWebViewWindows(url) {
  const script = `
    try {
      Add-Type -AssemblyName PresentationFramework, PresentationCore
      $w = New-Object System.Windows.Window
      $w.Title = 'Nébula'
      $w.Width = 1280; $w.Height = 820
      $w.WindowStartupLocation = 'CenterScreen'
      $b = New-Object System.Windows.Controls.WebBrowser
      $b.Navigate('${url}')
      $w.Content = $b
      $w.ShowDialog() | Out-Null
    } catch { exit 1 }`;
  const resultado = lanzar('powershell.exe', argumentos(script), { windowsHide: true });
  if (resultado.ok) return { ok: true, modo: 'ventana', detalle: 'ventana de Windows (WebView)' };
  return { ok: false, modo: 'ninguno', detalle: resultado.problema?.message || 'sin WebView' };
}

/**
 * Lanza un programa sin quedarse esperándolo y sin reventar si no existe:
 * el error se recoge en el propio proceso, que es lo que evita que la
 * aplicación se cierre cuando falta xdg-open o el navegador.
 */
function lanzar(comando, args, opciones = {}) {
  let problema = null;
  try {
    const proceso = spawn(comando, args, { detached: true, stdio: 'ignore', ...opciones });
    proceso.on('error', (err) => { problema = err; });
    proceso.unref();
    return { ok: true, proceso, get problema() { return problema; } };
  } catch (err) {
    return { ok: false, proceso: null, problema: err };
  }
}

/** Abre el navegador predeterminado del sistema. */
export function abrirNavegador(url) {
  const comandos = {
    win32: ['cmd', ['/d', '/s', '/c', 'start', '', url]],
    darwin: ['open', [url]],
  };
  const [comando, args] = comandos[process.platform] || ['xdg-open', [url]];
  const resultado = lanzar(comando, args, { windowsHide: true });
  return resultado.ok;
}

/**
 * ¿Hay dónde mostrar una ventana? Permite decidir entre ventana y navegador
 * sin intentarlo a ciegas (útil para las pruebas y para servidores sin pantalla).
 */
export function hayEntornoGrafico({ env = process.env, platform = process.platform } = {}) {
  if (env.NEBULA_SIN_VENTANA === '1') return false;
  if (platform === 'win32') return true;                 /* en Windows siempre hay escritorio */
  if (platform === 'darwin') return true;
  const sesion = env.XDG_SESSION_TYPE || '';
  if (env.DISPLAY || env.WAYLAND_DISPLAY) return true;
  return /x11|wayland|mir/i.test(sesion);
}

export { spawnSync };

/**
 * ¿Sigue abierta la ventana? Se pregunta por el proceso, así el programa puede
 * cerrarse solo cuando el usuario cierra la ventana (como cualquier aplicación).
 */
export function ventanaAbierta(pid) {
  if (!pid) return null; /* no se sabe */
  try {
    process.kill(pid, 0);
    return true; /* existe y sigue viva */
  } catch (err) {
    if (err.code === 'ESRCH') return false; /* ya no existe: se cerró */
    return true; /* sin permiso para preguntar: se asume que sigue */
  }
}

/**
 * Avisa al usuario con una ventana del sistema.
 * Se usa cuando la consola está oculta (por ejemplo al abrir desde el acceso
 * directo del instalador), porque si no, un error pasaría desapercibido.
 */
export function avisar(titulo, texto, { forzar = false } = {}) {
  if (process.platform === 'win32') {
    const limpiar = (t) => String(t).replace(/"/g, '`"');
    const script = `
      Add-Type -AssemblyName PresentationFramework
      [System.Windows.MessageBox]::Show("${limpiar(texto)}", "${limpiar(titulo)}", "OK", "Information") | Out-Null`;
    const resultado = lanzar('powershell.exe', argumentos(script), { windowsHide: true });
    if (resultado.ok) return true;
  }
  if (forzar || process.stdout.isTTY) process.stderr.write(`\n  ${titulo}: ${texto}\n`);
  return false;
}
