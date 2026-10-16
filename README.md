# Ludoteca

Gestor de biblioteca de juegos para tu equipo: reúne en un solo lugar lo que tienes
instalado en distintos lanzadores, mide cuánto juegas y organiza la colección con
carátulas, etiquetas, notas y estadísticas.

Proyecto propio, pensado para uso personal y privado. Funciona **sin dependencias
externas**: solo necesita Node.js. No hay cuentas, ni nube, ni telemetría.

```
Ludoteca.exe       →  doble clic; abre el navegador con tu biblioteca
npm start          →  http://localhost:4337 (si prefieres ejecutarlo desde el código)
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
- Windows, macOS o Linux.
- Un navegador moderno (la interfaz se sirve como app web local).

## Puesta en marcha

### En Windows, con el ejecutable (nada que instalar)

Descarga **`Ludoteca.exe`** (o el ZIP con el LEEME) y haz doble clic. Lleva dentro todo lo
necesario: no hace falta instalar Node ni nada más.

- Los ejecutables se generan solos en cada `push` mediante GitHub Actions: abre la pestaña
  **Actions → Construir ejecutable → última ejecución → Artifacts** y descarga
  `ludoteca-windows.zip` (también hay una versión para Linux).

  Para activar esa construcción hay que instalar una vez el flujo de trabajo (está listo en
  `ci/build.yml`), porque GitHub exige un permiso especial para escribir dentro de
  `.github/workflows/`:

  ```bash
  mkdir -p .github/workflows
  cp ci/build.yml .github/workflows/build.yml
  git add .github/workflows/build.yml
  git commit -m "Construccion automatica del ejecutable"
  git push
  ```

  A partir de ahí, cada push construye los ejecutables y pasa la batería de pruebas. Si el
  programa que sube los cambios tiene el permiso `workflows`, se puede dejar directamente en
  `.github/workflows/build.yml`.
- Al abrirlo por primera vez se crea la carpeta de datos en tu usuario
  (`%APPDATA%\Ludoteca`) y se abre el navegador en `http://localhost:4337`.
- Sirve el mismo comando para la terminal: `Ludoteca.exe --port 4400 --demo`.

### Desde el código (Windows, macOS o Linux)

```bash
npm start                  # inicia en http://localhost:4337
npm start -- --open        # además abre el navegador
npm start -- --port 5000   # otro puerto
npm run demo               # arranca con una biblioteca de ejemplo (40 juegos ficticios)

npm test                   # ejecuta la batería de pruebas (66 pruebas)
```

También están **`iniciar.bat`** (Windows) e **`iniciar.sh`** (macOS/Linux) como atajo:
comprueban que Node esté instalado, arrancan la app y abren el navegador
(`./iniciar.sh --demo --port 5000`).

### Construir el ejecutable tú mismo

```bash
npm install --no-save esbuild postject
node scripts/build-sea.mjs --runtime "$(command -v node)" --out dist/Ludoteca.exe
```

El resultado es un único archivo con el servidor, la interfaz y la documentación dentro.

Opciones de línea de comandos:

| Opción | Descripción |
| --- | --- |
| `--port`, `-p <n>` | Puerto (por defecto `4337`, o la variable `PORT`) |
| `--host <addr>` | Interfaz de escucha (por defecto `0.0.0.0`, así también entra desde el celular en tu red) |
| `--data-dir <dir>` | Carpeta de datos (por defecto `./data`) |
| `--demo` | Carga la biblioteca de ejemplo al iniciar |
| `--open` | Abre el navegador automáticamente |
| `--no-open` | No abre el navegador |
| `--version`, `-v` | Muestra la versión y termina |

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
3. Descarga desde el CDN de la tienda (solo Steam; **se puede desactivar** en Ajustes).
4. Carátula SVG generada: color derivado del nombre, patrón propio, plataforma y título.

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
- Si no hay internet, la búsqueda lo dice y la biblioteca sigue funcionando igual: las fichas
  que ya estaban guardadas no se tocan y el arte generado sigue cubriendo las carátulas.

## Privacidad y datos

- Todo se guarda en `data/`: `biblioteca.json` (biblioteca y ajustes), `media/` (carátulas) y
  `backups/` (una copia por día, se conservan las 5 últimas).
- La app **no envía nada** fuera de tu equipo, con dos excepciones que controlas tú: si dejas
  activada la opción *Descargar carátulas de las tiendas*, se pide la imagen al CDN de Steam y se
  guarda en caché local; y si usas la pestaña *Metadatos*, se consulta Wikipedia, Wikidata o
  Steam con el nombre del juego. Ambas se pueden desactivar y todo se resuelve con tus datos.
- En el ejecutable, los datos viven en `%APPDATA%\Ludoteca` (o `~/.local/share/ludoteca` en
  Linux, `~/Library/Application Support/Ludoteca` en macOS). Desde el código, en `data/`.
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
| `POST /api/games/:id/metadata` | Aplica una ficha (`{candidate, fields, overwrite, downloadArt}`) |
| `GET\|PATCH /api/settings` | Ajustes |
| `GET /api/export` · `POST /api/import` | Copia de seguridad completa (`mode: merge\|replace`) |
| `POST\|DELETE /api/demo` | Cargar o quitar la biblioteca de ejemplo |

## Estructura del proyecto

```
server/
  index.js     servidor HTTP, API y archivos estáticos
  assets.js    rutas de la app: funcionan igual desde el código y dentro del ejecutable
  sea.js       extrae la interfaz incrustada cuando corre como ejecutable único
  metadata.js  búsqueda de fichas: Wikipedia, Wikidata, Steam y RAWG
  store.js     almacén JSON con escritura atómica, respaldos, sesiones y estadísticas
  scanner.js   detección de Steam/Epic/GOG/Heroic/Lutris, carpetas, ROMs y puntuación de ejecutables
  launcher.js  lanzamiento de procesos y vigilancia de sesiones
  art.js       carátulas generadas (SVG), caché de descargas y subidas
  demo.js      biblioteca de ejemplo reproducible
  util.js      utilidades: rutas, procesos, permisos, formato
public/
  index.html   estructura de la interfaz
  styles.css   tema oscuro con acento configurable
  js/          app, estado, componentes, vistas (biblioteca, ficha, actividad, estadísticas, buscar, ajustes)
test/          66 pruebas: almacén, detección, lanzador, arte, metadatos y API completa
scripts/
  build-sea.mjs     construye el ejecutable único (Node + esbuild + postject)
  build-dist.mjs    prepara la carpeta distribuible con el servidor empaquetado
  portable.mjs      ZIP escrito a mano: empaquetado alternativo sin herramientas externas
ci/build.yml   flujo de trabajo listo: copiar a .github/workflows/ para activarlo
data/          tus datos (ignorado por git)
dist/          resultado de las construcciones (ignorado por git)
LEEME.txt      instrucciones para quien recibe el ejecutable
iniciar.bat    arranque de un clic en Windows (alternativa al ejecutable)
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
tolerancia a fuentes caídas y la regla de "no pisar lo que ya escribiste".

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
