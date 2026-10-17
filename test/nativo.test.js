/**
 * Pruebas de la ventana nativa (C#) y de su contrato con el núcleo.
 *
 * Aquí no se compila C# (eso lo hace la integración continua en Windows): lo que
 * se comprueba es que las piezas estén donde tienen que estar y que el reparto
 * entre la ventana y el núcleo siga teniendo sentido. Son las comprobaciones que
 * evitan que un cambio descuidado deje el programa sin ventana propia.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NATIVO = path.join(ROOT, 'nativo', 'Nebula.Ventana');
const leer = (nombre) => fs.readFileSync(path.join(NATIVO, nombre), 'utf8');

test('el proyecto de la ventana nativa está donde la compilación lo busca', () => {
  assert.ok(fs.existsSync(path.join(NATIVO, 'Nebula.Ventana.csproj')), 'falta el proyecto de C#');
  for (const archivo of ['Program.cs', 'Nucleo.cs', 'Ventana.cs', 'Salida.cs']) {
    assert.ok(fs.existsSync(path.join(NATIVO, archivo)), `falta ${archivo}`);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'branding', 'icono.ico')), 'falta el icono del programa');
});

test('la ventana es un programa de ventana, no de consola', () => {
  const proyecto = leer('Nebula.Ventana.csproj');
  assert.match(proyecto, /<OutputType>WinExe<\/OutputType>/, 'sin WinExe aparecería la ventana negra');
  assert.match(proyecto, /<UseWindowsForms>true<\/UseWindowsForms>/);
  assert.match(proyecto, /ApplicationIcon/, 'el programa lleva su icono');
  assert.match(proyecto, /Microsoft\.Web\.WebView2/, 'la interfaz se dibuja con WebView2');
  assert.match(proyecto, /<TargetFramework>net48<\/TargetFramework>/, 'net48 ya viene con Windows');
  assert.match(proyecto, /ReferenceAssemblies/, 'compila sin depender del paquete de referencia instalado');
});

test('la ventana sabe arrancar el núcleo y vigilarlo', () => {
  const nucleo = leer('Nucleo.cs');
  assert.match(nucleo, /Nebula-nucleo\.exe/, 'busca el motor por su nombre');
  assert.match(nucleo, /--padre/, 'le dice al motor a quién debe vigilar');
  assert.match(nucleo, /--no-open/, 'el motor nunca abre ventana propia si manda la ventana nativa');
  assert.match(nucleo, /\/api\/shutdown/, 'pide el cierre ordenado al cerrarse');
  assert.match(nucleo, /\/api\/health/, 'espera a que el motor responda');
  assert.match(nucleo, /WebView2Disponible/, 'comprueba que se puede dibujar antes de prometer ventana');
  assert.match(nucleo, /EjecutarYEsperar/, 'instalar y desinstalar los atiende el motor');
});

test('la ventana se comporta como un programa, no como un navegador', () => {
  const ventana = leer('Ventana.cs');
  assert.match(ventana, /AreDefaultContextMenusEnabled = false/, 'sin el menú del navegador');
  assert.match(ventana, /IsZoomControlEnabled = false/, 'sin zoom que rompa la interfaz');
  assert.match(ventana, /NewWindowRequested/, 'los enlaces de fuera se abren fuera');
  assert.match(ventana, /OnFormClosed/, 'al cerrar la ventana se apaga el motor');
  assert.match(ventana, /AbrirFuera/, 'abre el navegador de siempre cuando hace falta');
});

test('el programa responde a --version y a --help sin consola', () => {
  const programa = leer('Program.cs');
  assert.match(programa, /"nebula " \+ VersionTexto\(\)/, 'contesta lo mismo que el núcleo');
  assert.match(programa, /--uninstall/, 'entiende la orden de desinstalación');
  assert.match(programa, /--keep-alive/);
  /* la salida va al archivo y, si existe, a la salida heredada: nunca a una consola propia */
  const salida = leer('Salida.cs');
  assert.match(salida, /Nebula-ventana\.log/);
  assert.match(salida, /OpenStandardOutput/);
});

test('la compilación sabe armar el reparto entre ventana y núcleo', async () => {
  const { assetsVentana, hayDotnet, construirVentana } = await import('../scripts/build-sea.mjs');
  assert.equal(typeof hayDotnet, 'function');
  assert.equal(typeof construirVentana, 'function');
  assert.equal(typeof assetsVentana, 'function');

  /* sin carpeta no hay recursos; con archivos, cada uno entra como asset del instalador */
  assert.deepEqual(assetsVentana(null), {});
  assert.deepEqual(assetsVentana(path.join(ROOT, 'no-existe-esta-carpeta')), {});
  const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-ventana-'));
  try {
    fs.writeFileSync(path.join(temporal, 'Nebula.exe'), 'MZ');
    fs.writeFileSync(path.join(temporal, 'WebView2Loader.dll'), 'MZ');
    fs.mkdirSync(path.join(temporal, 'subcarpeta'));
    const recursos = assetsVentana(temporal);
    assert.deepEqual(Object.keys(recursos).sort(), ['ventana/Nebula.exe', 'ventana/WebView2Loader.dll']);
    assert.equal(recursos['ventana/Nebula.exe'], path.join(temporal, 'Nebula.exe'));
  } finally {
    fs.rmSync(temporal, { recursive: true, force: true });
  }
});

test('el instalador coloca la ventana como programa y el núcleo al lado', async () => {
  const { archivosVentana } = await import('../server/install.js');
  const origen = fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-recursos-'));
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-destino-'));
  try {
    fs.writeFileSync(path.join(origen, 'WebView2Loader.dll'), 'MZ');
    fs.writeFileSync(path.join(origen, 'Nebula.exe'), 'MZ');
    const lista = archivosVentana(origen, destino);
    assert.equal(lista.length, 2);
    assert.equal(path.basename(lista[0].origen), 'Nebula.exe', 'el programa va primero');
    for (const archivo of lista) {
      assert.equal(path.dirname(archivo.destino), destino);
      assert.ok(fs.existsSync(archivo.origen));
    }
    assert.deepEqual(archivosVentana(path.join(origen, 'no-existe'), destino), []);
  } finally {
    fs.rmSync(origen, { recursive: true, force: true });
    fs.rmSync(destino, { recursive: true, force: true });
  }
});
