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
  for (const archivo of ['Program.cs', 'Nucleo.cs', 'VentanaPrincipal.cs', 'VistaBiblioteca.cs',
    'DialogoJuego.cs', 'VistaBuscar.cs', 'VistaActividad.cs', 'VistaEstadisticas.cs',
    'VistaAjustes.cs', 'Controles.cs', 'Tema.cs', 'Api.cs', 'Modelos.cs', 'Salida.cs']) {
    assert.ok(fs.existsSync(path.join(NATIVO, archivo)), `falta ${archivo}`);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'branding', 'icono.ico')), 'falta el icono del programa');
});

test('la ventana es un programa de ventana, no de consola', () => {
  const proyecto = leer('Nebula.Ventana.csproj');
  assert.match(proyecto, /<OutputType>WinExe<\/OutputType>/, 'sin WinExe aparecería la ventana negra');
  assert.match(proyecto, /<UseWindowsForms>true<\/UseWindowsForms>/, 'la interfaz es nativa (WinForms)');
  assert.match(proyecto, /ApplicationIcon/, 'el programa lleva su icono');
  assert.match(proyecto, /<TargetFramework>net48<\/TargetFramework>/, 'net48 ya viene con Windows');
  assert.match(proyecto, /ReferenceAssemblies/, 'compila sin depender del paquete de referencia instalado');
  assert.match(proyecto, /Newtonsoft\.Json/, 'lee el JSON de la API');
  assert.ok(!/PackageReference Include="Microsoft\.Web\.WebView2"/.test(proyecto), 'ya no hay navegador dentro del programa');
});

test('la interfaz es nativa: no queda ninguna vista web', () => {
  const archivos = fs.readdirSync(NATIVO).filter((n) => n.endsWith('.cs'));
  for (const archivo of archivos) {
    const texto = leer(archivo);
    assert.ok(!/CoreWebView2|EnsureCoreWebView2Async|Source = new Uri\("http/.test(texto), `${archivo} todavía carga una vista web`);
  }
  const biblioteca = leer('VistaBiblioteca.cs');
  assert.match(biblioteca, /FlowLayoutPanel/, 'la rejilla es un control de Windows');
  assert.match(biblioteca, /TarjetaJuego/, 'cada juego es una tarjeta nativa');
  assert.match(biblioteca, /TextBox/, 'la búsqueda es un cuadro de texto de Windows');
  const ventana = leer('VentanaPrincipal.cs');
  assert.match(ventana, /Form/, 'la ventana es un formulario de Windows');
  assert.match(ventana, /BotonLateral/, 'la navegación son botones nativos');
  assert.match(ventana, /api\.LauncherAsync\(\)/, 'habla con el motor por su API');
});

test('la ventana sabe arrancar el núcleo y vigilarlo', () => {
  const nucleo = leer('Nucleo.cs');
  assert.match(nucleo, /Nebula-nucleo\.exe/, 'busca el motor por su nombre');
  assert.match(nucleo, /--padre/, 'le dice al motor a quién debe vigilar');
  assert.match(nucleo, /--no-open/, 'el motor nunca abre ventana propia si manda la ventana nativa');
  assert.match(nucleo, /\/api\/shutdown/, 'pide el cierre ordenado al cerrarse');
  assert.match(nucleo, /\/api\/health/, 'espera a que el motor responda');
  assert.match(nucleo, /EjecutarYEsperar/, 'instalar y desinstalar los atiende el motor');
  assert.match(nucleo, /class Argumentos/, 'compone la línea de órdenes con el citado de Windows');
});

test('el motor no arranca dentro de la carpeta del programa', () => {
  /* al desinstalar, la carpeta se borra desde fuera: si el motor (o el proceso
     que borra) trabaja dentro de ella, Windows no deja eliminarla */
  const nucleo = leer('Nucleo.cs');
  assert.match(nucleo, /WorkingDirectory = Path\.GetTempPath\(\)/, 'el motor trabaja desde la carpeta temporal');
  assert.ok(!/WorkingDirectory = Path\.GetDirectoryName/.test(nucleo), 'nadie arranca desde la carpeta del programa');
});

test('la ventana contesta en la terminal cuando la hay', () => {
  const programa = leer('Program.cs');
  assert.match(programa, /Salida\.Enganchar\(\)/, 'se engancha a la consola de quien lo llama');
  assert.match(programa, /Salida\.Inmediata\(/, 'la versión y la ayuda responden sin ensuciar el registro');
  const salida = leer('Salida.cs');
  assert.match(salida, /AttachConsole/, 'un programa de ventana no trae consola: se engancha a la del padre');
  const flujo = fs.readFileSync(new URL('../ci/build.yml', import.meta.url), 'utf8');
  assert.match(flujo, /RedirectStandardOutput \$archivoVersion/, 'la integración continua lee la respuesta de verdad');
});

test('al cerrar la ventana se apaga el motor', () => {
  const ventana = leer('VentanaPrincipal.cs');
  assert.match(ventana, /OnFormClosed/, 'la ventana sabe cuándo se cierra');
  assert.match(ventana, /vigilancia\.Stop\(\)/, 'deja de vigilar al cerrarse');
  const programa = leer('Program.cs');
  assert.match(programa, /nucleo\.Cerrar\(/, 'el programa pide el cierre del motor al salir');
  assert.match(programa, /--keep-alive/, 'se puede dejar el motor en marcha a propósito');
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

test('el Código de la ventana se queda en C# 7.3 (lo que compila net48)', () => {
  /* aquí no hay compilador: la única defensa es no escribir sintaxis más nueva */
  const proyecto = leer('Nebula.Ventana.csproj');
  assert.match(proyecto, /<LangVersion>7\.3<\/LangVersion>/, 'el proyecto fija el lenguaje');
  const archivos = fs.readdirSync(NATIVO).filter((n) => n.endsWith('.cs'));
  for (const archivo of archivos) {
    const texto = leer(archivo);
    assert.ok(!/\?\?=/.test(texto), `${archivo} usa «??=» (C# 8)`);
    assert.ok(!/\busing var\b/.test(texto), `${archivo} usa «using var» (C# 8)`);
    assert.ok(!/\bswitch\s*\{/.test(texto), `${archivo} usa una expresión switch (C# 8)`);
    assert.ok(!/\bis not\b/.test(texto), `${archivo} usa «is not» (C# 9)`);
    assert.ok(!/\bnew\(\)/.test(texto), `${archivo} usa «new()» sin tipo (C# 9)`);
    assert.ok(!/\brecord\s+\w+\s*\(/.test(texto), `${archivo} declara un record (C# 9)`);
    assert.ok(!/\binit\s*;/.test(texto), `${archivo} usa «init» (C# 9)`);
  }
});

test('las fichas largas no empujan los botones: los datos van con barra', () => {
  const dialogo = leer('DialogoJuego.cs');
  assert.match(dialogo, /AutoScroll = true/, 'la ficha del juego se desplaza por dentro');
  assert.match(dialogo, /MaximumSize/, 'el texto largo se parte en varias líneas');
  const biblioteca = leer('VistaBiblioteca.cs');
  assert.match(biblioteca, /AutoScroll = true/, 'la rejilla de juegos se desplaza');
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
    fs.writeFileSync(path.join(temporal, 'Newtonsoft.Json.dll'), 'MZ');
    fs.mkdirSync(path.join(temporal, 'subcarpeta'));
    const recursos = assetsVentana(temporal);
    assert.deepEqual(Object.keys(recursos).sort(), ['ventana/Nebula.exe', 'ventana/Newtonsoft.Json.dll']);
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
    fs.writeFileSync(path.join(origen, 'Newtonsoft.Json.dll'), 'MZ');
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
