# Nébula

Gestor de biblioteca de juegos para tu equipo: reúne en un solo lugar lo que tienes
instalado en distintos lanzadores, mide cuánto juegas y organiza la colección con
carátulas, etiquetas, notas y estadísticas.

Proyecto propio, pensado para uso personal y privado. Funciona **sin dependencias
externas**: solo necesita Node.js. No hay cuentas, ni nube, ni telemetría.

```
Nebula-1.4.0-instalador.exe  →  doble clic; se instala y abre Nébula en su ventana
Nebula-1.4.0-portable.zip    →  descomprimir y abrir Nebula.exe
npm start                    →  http://localhost:4337 (ejecutándolo desde el código)
```

---

## Qué hace

- **Unifica tus lanzadores.** Detecta juegos de Steam, Epic, GOG Galaxy, Heroic y Lutris,
  además de cualquier carpeta tuya con ejecutables o ROMs.
- **Lanza y vigila.** Abre el juego desde la interfaz y registra automáticamente el inicio
  y el fin de la sesión; el tiempo se acumula por juego.
- **Estadísticas reales.** Horas totales, mapa de calor de los últimos 90 días, racha de días
  jugando, tiempo por plataforma, rankings y evolución mensual de la colección.
- **Biblioteca con identidad propia.** Cuadrícula o lista, agrupación por plataforma, estado,
  género, letra o año; filtros por estado, etiquetas y favoritos; búsqueda instantánea.
- **Carátulas siempre presentes.** Usa las imágenes que ya están en la carpeta del juego, las
  descarga (opcional y una sola vez) desde el CDN de la tienda, o genera una carátula SVG
  propia con el nombre y el acento de color del juego. Nunca queda un hueco vacío.
- **ROMs y emuladores.** Detecta ROMs por consola según la extensión y las lanza con el perfil
  de emulador que configures (RetroArch, Dolphin, PCSX2, mGBA, DuckStation…).
- **Sesiones a mano.** Si jugaste en consola o sin la app abierta, registra las horas
  manualmente y el historial se recalcula solo.
- **Todo local.** Tus datos viven en `data/biblioteca.json`, con copia diaria en `data/backups`.

## Requisitos

- **Node.js 18 o superior** (probado en Node 22). No hace falta `npm install`.
- Windows 10 u 11 (la ventana nativa es un programa de Windows).
- Nada más: ni Node, ni navegadores, ni tiempos de ejecución que instalar. En macOS y Linux
  queda el motor (la API sigue disponible con `node server/index.js`).

Nébula es un **programa de Windows con ventana propia**. Está partido en dos piezas, y es a
propósito:

| Archivo | Qué es |
| --- | --- |
| `Nebula.exe` | La **aplicación**, escrita en C# (Windows Forms). Toda la interfaz son controles de Windows —sin WebView2 ni navegador—: arranca el motor, espera a que responda, pinta la biblioteca y vigila que todo se apague al cerrar. |
| `Nebula-nucleo.exe` | El **motor** (Node empaquetado en un archivo): escaneos, fichas, carátulas, biblioteca, medición de tiempo. |

Qué significa en la práctica:

- **Ninguna consola.** `Nebula.exe` está compilado como programa de ventana: no aparece la ventana
  negra, ni al abrirlo con doble clic ni al pasarle órdenes desde una terminal.
- **Nada corriendo por detrás.** Si cierras la ventana, el motor se apaga con ella; si la ventana
  se cayera, el motor lo detecta (se le pasa `--padre <pid>`) y se apaga solo. Si hay un juego en
  marcha, se sigue midiendo el tiempo hasta que termines y entonces se apaga.
- **Sin instalar nada raro.** La aplicación usa .NET Framework 4.8 (viene con Windows) y dibuja
  cada tarjeta y cada botón con controles nativos: no depende de Edge, de Chrome ni de WebView2.
  El motor no necesita Node instalado.
- **Todo queda anotado.** Como no hay consola, lo que cuenta el programa va a `%APPDATA%\Nebula`:
  `Nebula.log` (motor) y `Nebula-ventana.log` (ventana). Es lo primero que hay que mirar si algo
  no funciona.

La dirección `http://localhost:4337` sigue disponible si quieres abrirlo también en el navegador o
desde el celular (`nebula.exe --browser`).

Nada de lo que hace el programa se ve por consola, así que todo queda anotado en
`%APPDATA%\Nebula\Nebula.log`: ahí está el arranque, los análisis de carpetas, las fichas y
carátulas descargadas y el motivo exacto de cualquier error.

## Puesta en marcha

### En Windows: instalador o portable (nada que instalar aparte)

Los dos archivos llevan dentro todo lo necesario: no hace falta instalar Node ni nada más.
Se publican solos en **Releases** en cada cambio.

**Instalador (lo más cómodo).** Descarga `Nebula-<versión>-instalador.exe` y haz doble clic.
Se instala en tu carpeta de usuario, sin pedir permisos de administrador, y además:

- crea los accesos directos en el menú Inicio y en el escritorio;
- aparece en **Aplicaciones instaladas** para quitarlo cuando quieras (o con
  `Nebula.exe --uninstall`, o `--uninstall --silent` para hacerlo sin diálogos);
- al terminar te pregunta si quieres abrirlo.

El instalador y el programa son el mismo archivo: la copia instalada detecta dónde está y arranca
la biblioteca en lugar de instalarse otra vez.

**Portable.** Descarga `Nebula-<versión>-portable.zip`, **descomprímelo entero** y abre
`Nebula.exe` desde donde lo tengas. El ZIP trae la ventana y el motor (`Nebula-nucleo.exe`): van
juntos, si mueves el programa mueve los dos. No se instala nada en el sistema.

En los dos casos los datos van a `%APPDATA%\Nebula` (no junto al programa) y se conservan si
reinstalas o desinstalas. Se abre la ventana de la aplicación en `http://localhost:4337`, y desde
la terminal sirve el mismo ejecutable: `Nebula.exe --port 4400 --demo`.

El instalador copia la ventana y el motor a `%LOCALAPPDATA%\Programs\Nebula` y crea los accesos
directos con el icono del programa, de modo que al abrirlo desde el menú Inicio o el escritorio
**no aparece ninguna ventana de consola**. En la carpeta solo quedan `Nebula.exe`,
`Nebula-nucleo.exe` y un `Nebula.vbs` invisible que usan los accesos directos (no hay lanzadores
`.bat` ni `.cmd`).

### Publicación automática (una sola vez)

Cada `push` pasa las pruebas, construye los dos ejecutables, **los comprueba de verdad** (arranca
el portable; instala, abre y desinstala el instalador, verificando accesos directos y registro) y
**publica una Release** con la etiqueta de la versión, los dos archivos y las notas generadas a
partir de los commits. También quedan como artefactos en la pestaña **Actions**.

Para activarlo hay que copiar el flujo de trabajo a su sitio una vez, porque GitHub exige un
permiso especial (que no todos los accesos tienen) para escribir dentro de `.github/workflows/`:

```bash
mkdir -p .github/workflows
cp ci/build.yml .github/workflows/build.yml
git add .github/workflows/build.yml
git commit -m "Construccion automatica del ejecutable"
git push
```

Si prefieres hacerlo desde la web de GitHub: abre `ci/build.yml`, copia todo el contenido, crea
`.github/workflows/build.yml` con **Add file → Create new file** y pégalo.

### Desde el código (Windows, macOS o Linux)

```bash
npm start                  # inicia en http://localhost:4337
npm start -- --open        # además abre la ventana de la aplicación
npm start -- --port 5000   # otro puerto
npm run demo               # arranca con una biblioteca de ejemplo (40 juegos ficticios)

npm test                   # ejecuta la batería de pruebas (104 pruebas)
```

En macOS y Linux hay además **`iniciar.sh`** como atajo: comprueba que Node esté instalado,
arranca la app y abre la ventana de la aplicación (`./iniciar.sh --demo --port 5000`).
En Windows no hace falta ningún archivo de por medio: es el propio `Nebula.exe`.

### Construir los ejecutables tú mismo

Con el Node del sistema (para Linux, macOS o Windows):

```bash
npm install --no-save esbuild postject resedit
node scripts/build-sea.mjs --modo portable  --runtime "$(command -v node)" --out dist/Nebula.exe
node scripts/build-sea.mjs --modo instalador --runtime "$(command -v node)" --out dist/Nebula-Instalador.exe
```

Para los ejecutables **de Windows desde Linux o macOS** (trae el node.exe oficial a través del
registro de npm, así que no hace falta Windows ni la web de Node):

```bash
npm install --no-save esbuild postject resedit
node scripts/fetch-node-win.mjs
node scripts/build-sea.mjs --modo portable  --runtime dist/node-win/package/bin/node.exe --out dist/Nebula.exe
node scripts/build-sea.mjs --modo instalador --runtime dist/node-win/package/bin/node.exe --out dist/Nebula-Instalador.exe

Al final, la propia compilación comprueba que el ejecutable sirve: que la aplicación está dentro
(el blob completo), que el interruptor de arranque quedó encendido y que el archivo está marcado
como **programa de ventana** (`scripts/pe-subsystem.mjs`). Si algo de eso falla, no se publica.
```

El resultado es un único archivo con el servidor, la interfaz y la documentación dentro. Al
comprobarlo se verifica que el contenido esté incrustado, que la cabecera del ejecutable siga
intacta y que la marca de «ejecutable único» pase de `:0` a `:1`.

Opciones de línea de comandos:

| Opción | Descripción |
| --- | --- |
| `--port`, `-p <n>` | Puerto (por defecto `4337`, o la variable `PORT`) |
| `--host <addr>` | Interfaz de escucha (por defecto `0.0.0.0`, así también entra desde el celular en tu red) |
| `--data-dir <dir>` | Carpeta de datos (por defecto `./data`) |
| `--demo` | Carga la biblioteca de ejemplo al iniciar |
| `--open` | Abre la ventana de la aplicación al iniciar (con `--app=` si hay Chrome o Edge) |
| `--no-open` | No abre nada: solo arranca el servidor |
| `--browser` | Fuerza el navegador de siempre en vez de la ventana propia |
| `--keep-alive` | No se cierra al cerrar la ventana (útil desde la terminal) |
| `--version`, `-v` | Muestra la versión y termina |

Al hacer doble clic en el ejecutable (o abrirlo desde el acceso directo) se abre la ventana de la
aplicación y, al cerrarla, el programa termina solo. Si hay un juego en marcha cuando cierras la
ventana, Nébula espera a que termine para no perder el tiempo jugado.

Variables de entorno: `NEBULA_PORT`, `NEBULA_HOST`, `NEBULA_DATA_DIR` y
`NEBULA_CONSOLE` (ver más abajo).

### Guía rápida (2 minutos)

1. `npm start` y abre `http://localhost:4337`.
2. Pulsa **Buscar juegos** (arriba a la derecha) y ejecuta la detección; revisa la lista de
   resultados, marca lo que quieras y pulsa **Agregar seleccionados**.
3. Si tus juegos no están en ningún lanzador, usa **Agregar una carpeta**: puedes apuntar a una
   carpeta con varios juegos, a la de un juego concreto o a tu carpeta de ROMs.
4. Pulsa **Jugar** en una carátula: la sesión queda abierta y el cronómetro visible.
   Al cerrarla (o al pulsar **Detener**), el tiempo se guarda.
5. Todo lo demás — etiquetas, notas, calificación, carátulas, emuladores — se ajusta desde la
   ficha del juego y desde **Ajustes**.

## Detección automática

La detección lee archivos que los lanzadores ya dejan en el disco (no ejecuta nada de ellos ni
necesita sus SDK).

| Fuente | De dónde lee |
| --- | --- |
| Steam | `steamapps/libraryfolders.vdf` + todos los `appmanifest_*.acf` de cada biblioteca |
| Epic | `ProgramData/Epic/EpicGamesLauncher/Data/Manifests/*.item` |
| GOG | `ProgramData/GOG.com/Games/*/goggame-*.info` y `GOG Galaxy/Games` |
| Heroic | `~/.config/heroic/legendaryConfig/legendary/installed.json` y `gog_store/installed.json` |
| Lutris | `~/.local/share/lutris/games/*.yml` |

Detalles importantes:

- Solo se listan juegos **realmente instalados** (Steam: `StateFlags` con el bit de instalado).
- Los juegos de Steam/Epic se lanzan por su URI oficial (`steam://rungameid/...`,
  `com.epicgames.launcher://...`), así que funcionan igual con overlays y logros.
- En Linux/macOS, un `.exe` de Windows se ofrece lanzar con **Wine** si está disponible; si no,
  la ficha explica qué falta.

### Carpetas propias

Puedes registrar carpetas en **Ajustes → Carpetas vigiladas** con tres modos:

- **Colección**: cada subcarpeta con un ejecutable se convierte en un juego. El ejecutable se
  elige con una heurística (nombre parecido al de la carpeta, poca profundidad, se descartan
  instaladores, redistribuibles, herramientas y ayudas).
- **Juego individual**: se analiza la carpeta y eliges el ejecutable de una lista ordenada por
  confianza.
- **ROMs**: se agrupan por consola según la extensión y se les asigna el perfil de emulador.

### Emuladores

En **Ajustes → Emuladores** defines un perfil con nombre, comando y consolas asociadas. En el
comando puedes usar marcadores:

```
retroarch -L {core} "{rom}"
dolphin-emu -e "{rom}"
dosbox-x -c "{rom}"
```

| Marcador | Valor |
| --- | --- |
| `{rom}` | ruta completa de la ROM |
| `{romDir}` / `{romName}` | carpeta y nombre sin extensión de la ROM |
| `{name}` | nombre del juego en la biblioteca |
| `{dir}` / `{exe}` | carpeta de instalación y ejecutable |
| `{console}` | consola detectada (`snes`, `gba`, `ps1`, …) |
| `{args}` | argumentos guardados en la ficha del juego |

### Medición del tiempo de juego

- Al lanzar, se guarda el PID del proceso y la carpeta de instalación.
- Cada 3 segundos se comprueba si el proceso sigue vivo **o** si hay algún proceso del sistema
  cuya línea de comando apunta a la carpeta del juego. Esto cubre el caso típico de los
  lanzadores intermedios: el proceso que arrancas muere enseguida y el juego real aparece después.
- La sesión se cierra cuando ya no queda ningún proceso asociado; si cierras la app con un juego
  abierto, la sesión se recupera y se cierra al volver a iniciar.
- **Detener** envía la señal al proceso (y a sus hijos) y cierra la sesión en cuanto desaparecen.
- Los juegos de ejemplo usan sesiones simuladas, perfectas para probar la interfaz.

### Carátulas

Orden de prioridad para cada juego:

1. Imagen local (`cover.jpg`, `folder.png`, `hero.jpg`, `banner.png`, `icon.ico`…).
2. Imagen que subas tú (arrastra un archivo sobre la tarjeta o la ficha, o usa **Subir imagen**).
3. Descarga de fuentes reales (**se puede desactivar** en Ajustes): CDN de Steam
   (`library_600x900`, `_2x`, `header`, `capsule_616x353`…) y Wikimedia/Wikipedia
   (`Special:FilePath`, la miniatura del artículo y su `og:image`).
4. Carátula SVG generada: color derivado del nombre, patrón propio, plataforma y título.

La descarga no se fía del código de respuesta: **comprueba que lo que llega sea una imagen de
verdad** (tipo de contenido y primeros bytes). Si la fuente devuelve una página HTML con un 200, se
descarta y se prueba la siguiente dirección; si ninguna sirve, la interfaz dice el motivo concreto
(«la fuente respondió 404», «lo que devolvió la fuente no es una imagen», «la descarga tardó
demasiado») y sigues teniendo la carátula generada.

## Metadatos automáticos

Pensado para lo que no está en ninguna tienda: **Minecraft lanzado con HMCL**, juegos emulados,
programas sueltos, betas, itch.io… En la ficha de cada juego hay una pestaña **Metadatos** con
un buscador que rellena descripción, géneros, etiquetas, desarrollador, editorial, fecha, nota
de crítica y **carátula**.

- Fuentes abiertas y sin cuenta: **Wikipedia** (en tu idioma, con respaldo en inglés),
  **Wikidata** (datos estructurados: desarrollador, editorial, fecha, imagen) y **Steam**.
  Si pegas una clave gratuita de RAWG en Ajustes, también se consulta RAWG.
- No se usa Google: su API es de pago y sus términos no permiten consultas automatizadas; los
  resultados por nombre de juego son ambiguos, mientras que Wikipedia/Wikidata sí distinguen
  videojuegos y ofrecen datos limpios.
- Cada resultado muestra de qué fuente viene y un porcentaje de parecido con el nombre buscado.
  Las coincidencias dudosas (una empresa, un artículo que no es un videojuego) se marcan y bajan
  de puesto.
- **Nunca pisa lo que escribiste** salvo que actives *Sobrescribir*; por defecto solo rellena
  campos vacíos y puedes desmarcar los que no quieras.
- Botones relacionados en **Ajustes → Metadatos**: *Comprobar fuentes* (mide si responden y
  cuánto tardan) y *Rellenar huecos automáticamente* (hasta 8 juegos sin descripción o carátula).
  También se puede pedir el relleno automático al agregar juegos nuevos.
- La ficha y la carátula se descargan por separado: la ficha lleva el texto (descripción,
  géneros, fechas…), que suele estar en Wikipedia/Wikidata, y la carátula se busca en las
  direcciones de imagen de Steam y Wikimedia hasta que una devuelve una imagen válida. Por eso
  puede pasar que lleguen los datos y la carátula no: en la pestaña verás **con imagen** o
  **solo datos**, con el motivo cuando falla, y un botón **Reintentar la carátula** que vuelve a
  intentarlo sin tocar el resto de la ficha.
- Si no hay internet, la búsqueda lo dice y la biblioteca sigue funcionando igual: las fichas
  que ya estaban guardadas no se tocan y el arte generado sigue cubriendo las carátulas.

### Si la consola se ve rara en Windows

La consola de Windows no siempre usa UTF-8, y entonces los acentos y los adornos
(`─`, `ⓘ`, `…`) se ven como símbolos de otra codificación —letras chinas incluidas—. Nébula
lo detecta al arrancar, intenta pasar la consola a UTF-8 y, si no lo consigue, escribe en
texto simple:

```
  *  Biblioteca de demostracion: 40 juegos de ejemplo cargados
  ----------------------------------
```

Puedes forzarlo cuando quieras:

| Valor | Qué hace |
| --- | --- |
| `NEBULA_CONSOLE=ascii` | Escribe sin acentos ni adornos (lo más seguro en cualquier consola) |
| `NEBULA_CONSOLE=utf8` | Escribe con acentos y adornos, sin tocar la configuración de la consola |

En Windows: `set NEBULA_CONSOLE=ascii` antes de abrir el programa.

## Privacidad y datos

- Todo se guarda en `data/`: `biblioteca.json` (biblioteca y ajustes), `media/` (carátulas) y
  `backups/` (una copia por día, se conservan las 5 últimas).
- La app **no envía nada** fuera de tu equipo, con dos excepciones que controlas tú: si dejas
  activada la opción *Descargar carátulas de las tiendas*, se pide la imagen al CDN de Steam y se
  guarda en caché local; y si usas la pestaña *Metadatos*, se consulta Wikipedia, Wikidata o
  Steam con el nombre del juego. Ambas se pueden desactivar y todo se resuelve con tus datos.
- En el ejecutable, los datos viven en `%APPDATA%\Nebula` (o `~/.local/share/nebula` en
  Linux, `~/Library/Application Support/Nébula` en macOS). Desde el código, en `data/`.
- Exporta e importa toda la biblioteca en JSON desde **Ajustes → Datos**.
- El servidor escucha en `0.0.0.0`, así que cualquiera en tu red local puede abrir la interfaz
  con `http://tu-ip:4337`. Si prefieres que no sea accesible, inicia con `--host 127.0.0.1`.

## Atajos de teclado

| Atajo | Acción |
| --- | --- |
| `Ctrl/Cmd + K` | Paleta de comandos: busca juegos o ejecuta acciones |
| `Ctrl/Cmd + F` o `/` | Ir al buscador |
| `Esc` | Cerrar ficha, menú contextual o panel lateral |
| Clic derecho en una tarjeta | Menú: jugar, estado, favorito, carátulas, quitar… |

## API

Toda la interfaz usa esta API local (JSON). Útil para automatizar o integrar con otras cosas.

| Método y ruta | Qué hace |
| --- | --- |
| `GET /api/health` | Estado, versión, plataforma y carpeta de datos |
| `GET /api/state` | Biblioteca filtrada + facetas + estadísticas + ajustes + sesiones activas |
| `GET /api/games` · `POST /api/games` | Lista / alta manual (acepta `allowDuplicates`) |
| `PATCH /api/games/:id` · `DELETE /api/games/:id` | Edición y baja |
| `POST /api/games/:id/launch\|stop\|reveal\|open-store\|detect-art\|analyze` | Acciones sobre un juego |
| `GET\|POST\|DELETE /api/games/:id/cover\|banner\|icon` | Imágenes del juego |
| `GET /api/sessions` · `POST /api/sessions` | Historial y registro manual de sesiones |
| `GET /api/launcher` · `POST /api/launcher/stop-all` | Estado en vivo y parada total |
| `POST /api/scan` | Detección (`{sources, roots}`) o importación (`{import:true, findings, options}`) |
| `GET\|POST\|DELETE /api/roots` | Carpetas vigiladas |
| `POST /api/folders` | Analiza una carpeta concreta (`kind: collection\|single\|rom`) |
| `GET /api/fs?path=` | Explorador de archivos para elegir rutas |
| `GET\|POST\|PATCH\|DELETE /api/emulators` | Perfiles de emulador |
| `GET /api/metadata/search?query=&lang=&providers=` | Busca fichas (Wikipedia, Wikidata, Steam, RAWG) |
| `GET /api/metadata/suggest?name=` | Mejor candidato automático para un nombre |
| `GET /api/metadata/providers` | Comprueba qué fuentes responden |
| `POST /api/metadata/fill` | Rellena huecos de hasta N juegos (`{gameIds, limit, overwrite}`) |
| `POST /api/games/:id/metadata` | Aplica una ficha (`{candidate, fields, overwrite, downloadArt}`) y devuelve `imagenes.{cover,banner}` con el resultado de cada descarga |
| `POST /api/games/:id/metadata-art` | Vuelve a intentar solo las imágenes de una ficha ya guardada (`{candidate, kind}`) |
| `GET\|PATCH /api/settings` | Ajustes |
| `GET /api/export` · `POST /api/import` | Copia de seguridad completa (`mode: merge\|replace`) |
| `POST\|DELETE /api/demo` | Cargar o quitar la biblioteca de ejemplo |

## Estructura del proyecto

```
nativo/
  Nebula.Ventana/  la aplicación (C#/WinForms): interfaz nativa, arranca el núcleo y lo vigila
server/
  index.js     servidor HTTP, API y archivos estáticos
  assets.js    rutas de la app: funcionan igual desde el código y dentro del ejecutable
  console.js   salida por consola legible en cualquier codificación (Windows incluido)
  registro.js  registro en archivo (Nebula.log): el motor no tiene consola donde contar nada
  install.js   instalación y desinstalación en Windows (accesos directos, registro)
  desktop.js   modo navegador opcional del motor (Chrome/Edge en modo aplicación); la aplicación nativa no lo usa
  http.js      cabeceras de las peticiones a las fuentes externas (agente e imagen de referencia)
  version.js   la versión, en un solo sitio
  sea.js       extrae la interfaz incrustada cuando corre como ejecutable único
  metadata.js  búsqueda de fichas: Wikipedia, Wikidata, Steam y RAWG
  store.js     almacén JSON con escritura atómica, respaldos, sesiones y estadísticas
  scanner.js   detección de Steam/Epic/GOG/Heroic/Lutris, carpetas, ROMs y puntuación de ejecutables
  launcher.js  lanzamiento de procesos y vigilancia de sesiones
  art.js       carátulas: descarga desde las fuentes (con comprobación de imagen), generadas (SVG),
               caché y subidas
  demo.js      biblioteca de ejemplo reproducible
  util.js      utilidades: rutas, procesos, permisos, formato
public/
  index.html   estructura de la interfaz
  styles.css   tema oscuro con acento configurable
  js/          app, estado, componentes, vistas (biblioteca, ficha, actividad, estadísticas, buscar, ajustes)
test/          pruebas: almacén, detección, lanzador, arte, metadatos, registro, instalación y API
scripts/
  build-sea.mjs     construye los ejecutables (portable e instalador): compila la ventana en C#,
                    empaqueta el núcleo con Node + esbuild + postject y arma el reparto de los dos
  pe-subsystem.mjs  marca el ejecutable como programa de ventana (sin la ventana de consola)
  brand-exe.mjs     pone el icono y los datos del programa dentro del ejecutable
  installer-main.js arranque del instalador: instala, abre el programa o desinstala
  fetch-node-win.mjs  trae el node.exe oficial de Windows desde el registro de npm
  build-dist.mjs    prepara la carpeta distribuible con el servidor empaquetado
  portable.mjs      ZIP escrito a mano: empaquetado alternativo sin herramientas externas
ci/build.yml   flujo de trabajo listo: copiar a .github/workflows/ para activarlo
data/          tus datos (ignorado por git)
dist/          resultado de las construcciones (ignorado por git)
LEEME.txt      instrucciones para quien recibe el ejecutable
iniciar.sh     arranque de un clic en macOS/Linux
```

## Pruebas

```bash
npm test
```

Cubren el almacén y las estadísticas, la deduplicación (incluido el caso de varias ROMs en la
misma carpeta), la puntuación de ejecutables, la limpieza de nombres, el recorrido de carpetas,
las carátulas generadas, las plantillas del lanzador y una prueba de integración que arranca el
servidor real y recorre la API entera (incluido lanzar y detener un juego). Las 18 pruebas de
metadatos usan respuestas simuladas de las fuentes, así que funcionan sin conexión a internet y
comprueban el análisis de cada proveedor, el orden por parecido, el respaldo entre idiomas, la
tolerancia a fuentes caídas y la regla de "no pisar lo que ya escribiste". Otras ocho
comprueban que la salida por consola queda legible incluso cuando la consola usa una
codificación antigua, ocho cubren la instalación en Windows (rutas, accesos directos al propio
ejecutable, registro, borrado por lotes y detección de "ya instalado"), trece comprueban la
descarga de carátulas contra fuentes simuladas (imagen válida, HTML con respuesta 200, 404,
tiempo agotado, respaldo entre direcciones), ocho el modo ventana (detección de navegador,
argumentos de la ventana, apertura, cierre del programa al cerrar la ventana y `--keep-alive`),
cinco la marca de programa de ventana del ejecutable, cinco el registro en archivo, siete la
ventana nativa (proyecto de C#, reparto entre ventana y motor y recursos del instalador) y tres el
reparto de mando (el motor se apaga solo si desaparece la ventana, atiende la petición de cierre y
no se apaga si nadie se lo pide).

## Limitaciones conocidas

- Xbox/Microsoft Store, EA App, Ubisoft Connect, Battle.net e itch.io aparecen como fuentes
  seleccionables, pero la detección real cubre hoy Steam, Epic, GOG, Heroic, Lutris y carpetas
  propias; los demás se agregan como juego manual con su URI (`com.epicgames.launcher://`,
  `uplay://`, `battlenet://`) o su ejecutable.
- La medición de tiempo se basa en procesos; los juegos con anticheat que ocultan su proceso
  pueden requerir registrar el tiempo a mano.
- Los metadatos vienen de fuentes abiertas (Wikipedia, Wikidata, Steam y, con clave, RAWG); no
  hay catálogos comerciales (IGDB y similares) ni búsqueda en Google. Para juegos muy nuevos o
  poco documentados puede no haber ficha: en ese caso se escribe a mano desde la pestaña Editar.
- La carátula descargada depende de que la fuente tenga imagen del juego: si ninguna la tiene, se
  queda la carátula generada (que siempre existe) y siempre puedes subir una tuya arrastrándola
  sobre la tarjeta.

## Créditos

- **La idea original es de [Playnite](https://playnite.link)** (https://github.com/JosefNemec/Playnite),
  el gestor de biblioteca de juegos libre para Windows: una sola lista con todos tus juegos, su
  ficha, su carátula y sus horas, con una ventana nativa de Windows como única interfaz. Playnite
  está escrito en C# y ese es también el camino de Nébula: la ventana ya es un programa nativo. Nébula es
  una versión propia en español, pensada para juegos que ya tienes instalados en carpetas tuyas
  (sin integraciones de tiendas), y no tendría sentido sin ese precedente. Todo el mérito de la
  idea y de su manera de enseñar la biblioteca es de sus autores y colaboradores.
- El ejecutable único usa el mecanismo oficial de Node (**SEA**), con `esbuild` y `postject`;
  el icono y los datos del programa se escriben con `resedit`.
- Las carátulas y las fichas salen de fuentes abiertas: **Wikipedia**, **Wikidata**, **Steam** y,
  si se configura una clave, **RAWG**.
