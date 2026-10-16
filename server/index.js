/**
 * Nébula — gestor de biblioteca de juegos.
 * Servidor HTTP sin dependencias externas: API + interfaz web.
 *
 *   node server/index.js                 inicia en http://localhost:4337
 *   node server/index.js --demo          carga una biblioteca de ejemplo
 *   node server/index.js --port 5000     puerto personalizado
 *   node server/index.js --open          abre el navegador al iniciar
 */
import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import url from 'node:url';
import { fileURLToPath } from 'node:url';
import { Store, PLATFORMS, STATUSES, normalizeGame } from './store.js';
import { Launcher, renderTemplate } from './launcher.js';
import { MediaStore, mimeFor, contentTypeFor } from './art.js';
import {
  detectInstalled, scanCollection, scanSingleFolder, scanRoms, findLocalArt,
  analyzeFolder, isLaunchableFile, CONSOLES, cleanGameName,
} from './scanner.js';
import { buildDemoGames, touchToday } from './demo.js';
import { MetadataService, buildPatch } from './metadata.js';
import { VERSION as VERSION_APP } from './version.js';
import { resolveAssets, resolveDataDir } from './assets.js';
import { prepararConsola } from './console.js';
import { abrirVentana, hayEntornoGrafico, navegadorDisponible, ventanaAbierta, avisar } from './desktop.js';

/* lo primero: dejar la consola en condiciones (en Windows evita que los acentos
   y los adornos se vean como caracteres de otra codificación) */
prepararConsola();
import { nowIso, uid, ensureDir, exists, isInside, formatDuration } from './util.js';
import * as util from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = VERSION_APP;

/* rutas: funcionan igual en el repositorio y empaquetado como ejecutable */
const assets = resolveAssets();
const ROOT_DIR = assets.root;
const PUBLIC_DIR = assets.publicDir;
const DOCS_DIR = assets.docsDir;

/* --------------------------------------------------------------- argumentos */

function parseArgs(argv) {
  const args = {
    port: Number(process.env.NEBULA_PORT || process.env.PORT) || 4337,
    host: process.env.NEBULA_HOST || process.env.HOST || '0.0.0.0',
    demo: false,
    open: false,
    browser: false,
    keepAlive: false,
    dataDir: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p') args.port = Number(argv[++i]) || args.port;
    else if (arg === '--host') args.host = argv[++i] || args.host;
    else if (arg === '--demo') args.demo = true;
    else if (arg === '--open') args.open = true;
    else if (arg === '--no-open') args.open = false;
    else if (arg === '--browser' || arg === '--navegador') args.browser = true;
    else if (arg === '--keep-alive') args.keepAlive = true;
    else if (arg === '--data-dir') args.dataDir = argv[++i];
    else if (arg === '--version' || arg === '-v') args.version = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
/* doble clic en el ejecutable: sin argumentos se abre la ventana de la app */
const SIN_ARGUMENTOS = process.argv.slice(2).length === 0;
if (SIN_ARGUMENTOS && process.env.NEBULA_PACKAGED === '1' && !process.argv.includes('--no-open')) args.open = true;
/* al arrancar sin consola visible tampoco tiene sentido esperar nada del teclado */
if (args.version) {
  /* útil para comprobar una compilación desde la integración continua */
  console.log(`nebula ${VERSION}`);
  process.exit(0);
}
if (args.help) {
  console.log(`Nébula ${VERSION}

Uso: node server/index.js [opciones]

  --port, -p <n>    puerto (por defecto 4337)
  --host <addr>     interfaz de escucha (por defecto 0.0.0.0)
  --data-dir <dir>  carpeta de datos (por defecto ./data)
  --demo            carga la biblioteca de ejemplo al iniciar
  --open            abre la aplicacion en su ventana al iniciar
  --browser         abre en el navegador en vez de en la ventana propia
  --keep-alive      no se cierra al cerrar la ventana
  --version, -v     muestra la version y termina

Variables de entorno:
  NEBULA_PORT     puerto (igual que --port)
  NEBULA_HOST     interfaz de escucha (igual que --host)
  NEBULA_DATA_DIR carpeta de datos (igual que --data-dir)
`);
  process.exit(0);
}

/* ------------------------------------------------------------------ arranque */

const DATA_DIR = resolveDataDir({ assets });
const store = new Store(path.join(DATA_DIR, 'biblioteca.json'));
const media = new MediaStore(path.join(DATA_DIR, 'media'));
const metadata = new MetadataService({ getSettings: () => store.settings });
let peticionesCliente = 0;      /* peticiones recibidas desde que arrancó */
let ventanaAbiertaEn = 0;       /* cuándo se abrió la ventana de la aplicación */

/* tiempos de la vigilancia de la ventana (ajustables para las pruebas) */
const ESPERA_MINIMA_VENTANA = Number(process.env.NEBULA_VENTANA_ESPERA) || 20000;
const INTERVALO_VIGILANCIA = Number(process.env.NEBULA_VENTANA_INTERVALO) || 3000;
let launcher = null;

async function bootstrap() {
  await ensureDir(DATA_DIR);
  await media.init();
  await store.load();

  if (args.demo || process.env.NEBULA_DEMO === '1') {
    await loadDemo();
  }

  if (store.settings.autoScanOnStart) {
    runScan({ sources: store.settings.sources, roots: store.settings.scanRoots, silent: true }).catch(() => {});
  }

  launcher = new Launcher(store);
  launcher.on('session:end', ({ game, session }) => {
    console.log(`  ⏹  ${game?.name}: ${formatDuration(session.seconds, 'long')}`);
  });
  launcher.on('session:start', ({ game }) => console.log(`  ▶  ${game.name}`));
  launcher.start();
}

/* -------------------------------------------------------------- demo helpers */

async function loadDemo() {
  const games = touchToday(buildDemoGames());
  const existing = new Set(store.list().filter((g) => g.demo).map((g) => g.name));
  let added = 0;
  for (const game of games) {
    if (existing.has(game.name)) continue;
    store.db.games.push(game);
    added++;
  }
  store.setSettings({ demo: true });
  await store.flush();
  console.log(`  ⓘ  Biblioteca de demostracion: ${added} juegos de ejemplo cargados`);
  return added;
}

/* -------------------------------------------------------------------- API */

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function error(res, status, message, extra = {}) {
  json(res, status, { error: message, ...extra });
}

async function readBody(req, limit = 40 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Cuerpo de la peticion demasiado grande');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('JSON invalido');
  }
}

function publicGame(game) {
  const active = store.activeFor(game.id);
  const live = active ? launcher?.status().sessions[game.id] : null;
  return {
    id: game.id,
    name: game.name,
    platform: game.platform,
    platformLabel: PLATFORMS[game.platform]?.label || game.platform,
    platformColor: PLATFORMS[game.platform]?.color || '#8d93a1',
    status: game.status,
    favorite: game.favorite,
    hidden: game.hidden,
    emulator: game.emulator,
    demo: game.demo,
    genres: game.genres,
    tags: game.tags,
    developers: game.developers,
    publishers: game.publishers,
    releaseDate: game.releaseDate,
    rating: game.rating,
    criticScore: game.criticScore,
    description: game.description,
    notes: game.notes,
    installDir: game.installDir,
    executable: game.executable,
    launchArgs: game.launchArgs,
    workDir: game.workDir,
    launchCommand: game.launchCommand,
    emulatorProfileId: game.emulatorProfileId,
    emulatorProfileName: store.settings.emulatorProfiles.find((p) => p.id === game.emulatorProfileId)?.name || null,
    sizeBytes: game.sizeBytes,
    playtimeSeconds: (game.playtimeSeconds || 0) + (live?.elapsedSeconds || 0),
    storedPlaytimeSeconds: game.playtimeSeconds || 0,
    sessionCount: game.sessions?.length || 0,
    playCount: game.playCount,
    lastPlayed: game.lastPlayed,
    firstPlayed: game.firstPlayed,
    addedAt: game.addedAt,
    sourceId: game.sourceId,
    extra: game.extra,
    pathExists: game.installDir ? util.existsSync(game.installDir) : game.executable ? util.existsSync(game.executable) : true,
    running: Boolean(active),
    live: live || null,
    cover: `/api/games/${game.id}/cover`,
    banner: `/api/games/${game.id}/banner`,
    icon: `/api/games/${game.id}/icon`,
    sessions: (game.sessions || []).slice(-30).reverse(),
  };
}

function filteredGames(query) {
  let games = store.list().slice();
  const q = util.normalize(query.get('query') || '');
  const status = query.get('status');
  const platform = query.get('platform');
  const tag = query.get('tag');
  const favorite = query.get('favorite');
  const showHidden = query.get('hidden') === '1';

  if (!showHidden) games = games.filter((g) => !g.hidden);
  if (query.get('demo') === 'only') games = games.filter((g) => g.demo);
  else if (query.get('demo') === 'hide') games = games.filter((g) => !g.demo);

  if (q) {
    games = games.filter((g) =>
      [g.name, g.platform, (g.tags || []).join(' '), (g.genres || []).join(' '), (g.developers || []).join(' '), g.installDir || '']
        .some((field) => util.normalize(field).includes(q))
    );
  }
  if (status && status !== 'all') {
    if (status === 'running') games = games.filter((g) => store.activeFor(g.id));
    else games = games.filter((g) => (g.status || 'backlog') === status);
  }
  if (platform && platform !== 'all') games = games.filter((g) => g.platform === platform);
  if (tag && tag !== 'all') games = games.filter((g) => (g.tags || []).includes(tag) || (g.genres || []).includes(tag));
  if (favorite === '1') games = games.filter((g) => g.favorite);

  const sort = query.get('sort') || 'name';
  const direction = query.get('direction') === 'desc' ? -1 : 1;
  const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
  const sorters = {
    name: (a, b) => collator.compare(a.name, b.name),
    playtime: (a, b) => (a.playtimeSeconds || 0) - (b.playtimeSeconds || 0),
    lastPlayed: (a, b) => new Date(a.lastPlayed || 0) - new Date(b.lastPlayed || 0),
    added: (a, b) => new Date(a.addedAt || 0) - new Date(b.addedAt || 0),
    rating: (a, b) => (a.rating || 0) - (b.rating || 0),
    release: (a, b) => new Date(a.releaseDate || 0) - new Date(b.releaseDate || 0),
    size: (a, b) => (a.sizeBytes || 0) - (b.sizeBytes || 0),
    status: (a, b) => STATUSES.findIndex((s) => s.id === a.status) - STATUSES.findIndex((s) => s.id === b.status),
  };
  const sorter = sorters[sort] || sorters.name;
  games.sort((a, b) => {
    if (Boolean(store.activeFor(b.id)) !== Boolean(store.activeFor(a.id))) return store.activeFor(a.id) ? -1 : 1;
    if (Boolean(b.favorite) !== Boolean(a.favorite)) return b.favorite ? 1 : -1;
    return sorter(a, b) * direction;
  });
  return games;
}

/* -------------------------------------------------------------- apertura */

/**
 * Abre la interfaz: en su propia ventana si se puede, en el navegador si no.
 * Se informa por consola de cuál se usó para que no haya sorpresas.
 */
function abrirAplicacion(url) {
  if (!args.open) return;
  if (!hayEntornoGrafico()) {
    console.log('  (sin entorno grafico: abre la interfaz en un navegador)');
    return;
  }
  const resultado = abrirVentana(url, { forzarNavegador: Boolean(args.browser), log: (m) => console.log(`  ${m}`) });
  if (resultado.modo === 'ventana') {
    console.log(`  Ventana:    ${resultado.detalle}${resultado.pid ? ` (proceso ${resultado.pid})` : ''}`);
    vigilarVentana(resultado.pid);
  } else if (resultado.modo === 'web') {
    console.log(`  Aviso:      no se encontro Chrome ni Edge; se abre ${resultado.detalle}`);
    console.log('              para tener ventana propia instala Chrome o Edge');
  }
}

/**
 * Se cierra cuando el usuario cierra la ventana, como cualquier aplicación.
 * Si hay un juego en marcha se espera a que termine para no perder el tiempo
 * jugado; el resto de las veces se sale en unos segundos.
 * Se puede desactivar con --keep-alive (útil al usarlo desde la terminal).
 */
function vigilarVentana(pid) {
  if (!pid || args.keepAlive) return;
  ventanaAbiertaEn = Date.now();
  let ausencias = 0;
  let avisado = false;
  let esperandoJuegos = false;   /* la ventana ya se cerró, pero hay un juego en marcha */
  const reloj = setInterval(() => {
    /* márgenes de seguridad: no se cierra el programa si la ventana todavía no
       cargó la interfaz (el proceso del navegador puede desaparecer al delegar
       en otra instancia) ni en los primeros segundos de vida */
    if (Date.now() - ventanaAbiertaEn < ESPERA_MINIMA_VENTANA || peticionesCliente === 0) return;

    const abierta = ventanaAbierta(pid);
    if (abierta === null || abierta === true) {
      ausencias = 0;
      return;
    }
    ausencias++;
    /* tres comprobaciones seguidas (unos 9 s): un recargado no cierra el programa */
    if (ausencias < 3) return;

    const activos = launcher ? Object.keys(launcher.status().sessions || {}).length : 0;
    if (activos > 0) {
      esperandoJuegos = true;
      if (!avisado) {
        console.log(`\n  La ventana se cerro, pero hay ${activos} juego(s) en marcha: se sigue contando el tiempo.`);
        avisado = true;
      }
      return; /* se espera a que termine el juego */
    }

    console.log(esperandoJuegos
      ? '\n  Los juegos terminaron: cerrando el programa.'
      : '\n  La ventana se cerro: cerrando el programa.');
    cerrarYsalir().catch(() => {});
  }, INTERVALO_VIGILANCIA);
  reloj.unref?.();
}

/** Cierra el servidor y termina el proceso con orden. */
async function cerrarYsalir(codigo = 0) {
  /* se cierran las sesiones siguiendo el mismo camino que el botón «Detener todo» */
  try {
    for (const gameId of [...(launcher?.running?.keys() || [])]) {
      await launcher.stopGame(gameId).catch(() => {});
    }
  } catch { /* sin sesiones que parar */ }
  try {
    serverInstance?.close(() => process.exit(codigo));
    setTimeout(() => process.exit(codigo), 1500).unref?.();
  } catch {
    process.exit(codigo);
  }
}

/* --------------------------------------------------------------- metadatos */

/**
 * Vuelca un candidato de metadatos en la ficha de un juego.
 * No pisa lo que el usuario ya escribió salvo que se pida expresamente.
 */
async function applyMetadata(game, candidate, { fields = {}, overwrite = false, downloadArt = true } = {}) {
  const patch = buildPatch(candidate, fields, { overwrite, current: game });
  const arte = { cover: null, banner: null };

  const puedeDescargar = downloadArt && store.settings.fetchRemoteArt !== false
    && store.settings.metadata?.enabled !== false;

  if (puedeDescargar) {
    /* se prueban varias direcciones por ficha: si una falla, se intenta la siguiente */
    const caratulas = await metadata.coverOptions(candidate, { kind: 'cover' }).catch(() => []);
    if (caratulas.length) {
      const resultado = await media.downloadBest(game.id, caratulas, 'cover');
      arte.cover = { ok: Boolean(resultado.file), url: resultado.url, error: resultado.error, intentos: resultado.intentos };
      if (resultado.file) patch.coverFile = resultado.file;
      else patch.coverUrl = resultado.url;
    } else {
      arte.cover = { ok: false, url: null, error: 'la ficha no traía ninguna imagen', intentos: 0 };
    }

    const fondos = await metadata.coverOptions(candidate, { kind: 'banner' }).catch(() => []);
    if (fondos.length) {
      const resultado = await media.downloadBest(game.id, fondos, 'banner');
      arte.banner = { ok: Boolean(resultado.file), url: resultado.url, error: resultado.error, intentos: resultado.intentos };
      if (resultado.file) patch.backgroundFile = resultado.file;
      else patch.backgroundUrl = resultado.url;
    }
  } else {
    /* descargas desactivadas: se guarda la dirección para que se pueda usar luego */
    if (candidate.coverUrl) patch.coverUrl = candidate.coverUrl;
    if (candidate.bannerUrl) patch.backgroundUrl = candidate.bannerUrl;
    arte.cover = { ok: false, url: candidate.coverUrl || null, error: 'las descargas están desactivadas en Ajustes', intentos: 0 };
  }

  patch.extra = {
    ...(game.extra || {}),
    metadata: {
      source: candidate.source,
      id: candidate.id || null,
      title: candidate.title || game.name,
      url: candidate.url || null,
      website: candidate.website || null,
      score: candidate.score ?? null,
      screenshots: candidate.screenshots || [],
      imagenes: arte,
      candidate: {
        source: candidate.source,
        id: candidate.id || null,
        title: candidate.title,
        coverUrl: candidate.coverUrl || null,
        bannerUrl: candidate.bannerUrl || null,
        url: candidate.url || null,
        extra: candidate.extra || {},
      },
      fetchedAt: nowIso(),
    },
  };
  return store.update(game.id, patch);
}

/* ------------------------------------------------------------------ escaneo */

const scanState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  progress: null,
  last: null,
};

async function runScan({ sources, roots, silent = false }) {
  if (scanState.running) throw new Error('Ya hay un escaneo en curso');
  scanState.running = true;
  scanState.startedAt = nowIso();
  try {
    const result = await detectInstalled(sources || store.settings.sources, { scanRoots: roots || store.settings.scanRoots });
    const findings = [];
    for (const raw of result.findings) {
      const enriched = { ...raw };
      if (!enriched.coverFile && enriched.installDir) {
        const art = await findLocalArt(enriched.installDir);
        enriched.coverFile = art.coverFile;
        enriched.backgroundFile = art.backgroundFile;
        enriched.iconFile = art.iconFile;
      }
      const existing =
        (enriched.sourceId && store.findBySource(enriched.platform, enriched.sourceId)) ||
        store.findByName(enriched.name) ||
        (enriched.executable && store.list().find((g) => g.executable === enriched.executable)) ||
        null;
      findings.push({
        candidate: enriched,
        existingId: existing?.id || null,
        existingName: existing?.name || null,
      });
    }
    scanState.last = {
      at: nowIso(),
      scanned: result.scanned,
      errors: result.errors,
      counts: {
        steam: findings.filter((f) => f.candidate.platform === 'steam').length,
        epic: findings.filter((f) => f.candidate.platform === 'epic').length,
        gog: findings.filter((f) => f.candidate.platform === 'gog').length,
        heroic: findings.filter((f) => f.candidate.platform === 'heroic').length,
        lutris: findings.filter((f) => f.candidate.platform === 'lutris').length,
        manual: findings.filter((f) => f.candidate.platform === 'manual').length,
        emulator: findings.filter((f) => f.candidate.platform === 'emulator').length,
        new: findings.filter((f) => !f.existingId).length,
        known: findings.filter((f) => f.existingId).length,
      },
      findings: findings.slice(0, 1200),
    };
    if (!silent) console.log(`  ⓘ  Escaneo: ${findings.length} juegos detectados (${scanState.last.counts.new} nuevos)`);
    return scanState.last;
  } finally {
    scanState.running = false;
    scanState.finishedAt = nowIso();
  }
}

async function importFindings(findings, options = {}) {
  let added = 0;
  let updated = 0;
  const errors = [];
  const created = [];
  for (const item of findings) {
    const raw = item.candidate || item;
    if (!raw || !raw.name) continue;
    try {
      const payload = {
        name: cleanGameName(raw.name),
        platform: raw.platform || 'manual',
        sourceId: raw.sourceId || null,
        installDir: raw.installDir || null,
        executable: raw.executable || null,
        launchArgs: raw.launchArgs || '',
        workDir: raw.workDir || null,
        launchCommand: raw.launchCommand || null,
        coverFile: raw.coverFile || null,
        backgroundFile: raw.backgroundFile || null,
        iconFile: raw.iconFile || null,
        coverUrl: raw.coverUrl || null,
        backgroundUrl: raw.backgroundUrl || null,
        sizeBytes: raw.sizeBytes || 0,
        emulator: Boolean(raw.emulator),
        emulatorProfileId: raw.emulatorProfileId || options.emulatorProfileId || null,
        tags: options.tags || raw.tags || [],
        status: options.status || raw.status || 'backlog',
        extra: { ...(raw.extra || {}), ...(raw.romPath ? { rom: raw.romPath } : {}), ...(raw.console ? { console: raw.console } : {}) },
      };
      const existing = item.existingId ? store.get(item.existingId) : null;
      if (existing) {
        if (options.updateExisting === false) continue;
        await store.update(existing.id, payload);
        updated++;
      } else {
        const { game } = await store.add(payload, { dedupe: true });
        created.push(game);
        added++;
      }
    } catch (err) {
      errors.push({ name: raw.name, message: err.message });
    }
  }
  await store.flush();

  /* fichas automáticas para lo que acaba de entrar sin datos (opcional, con límite) */
  const metadataReport = { filled: 0, skipped: 0 };
  const autoFill = options.fetchMetadata !== false && store.settings.metadata?.enabled !== false
    && (options.fetchMetadata === true || store.settings.metadata?.autoFillOnScan === true);
  if (autoFill && created.length) {
    for (const game of created.slice(0, 10)) {
      try {
        const candidate = await metadata.bestMatch(game.name);
        if (!candidate) {
          metadataReport.skipped++;
          continue;
        }
        await applyMetadata(game, candidate, { overwrite: false });
        metadataReport.filled++;
      } catch {
        metadataReport.skipped++;
      }
    }
    await store.flush();
  }

  return { added, updated, errors, metadata: metadataReport };
}

/* -------------------------------------------------------------- enrutamiento */

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  /* sirve para saber si la ventana llegó a cargar la interfaz (ver vigilarVentana) */
  peticionesCliente++;
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname || '/');
  const query = new URLSearchParams(parsed.query);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    return res.end();
  }

  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, query);
      return;
    }
    await serveStatic(req, res, pathname);
  } catch (err) {
    console.error('  ✖ ', err.message);
    if (!res.headersSent) error(res, 500, err.message || 'Error interno');
    else res.end();
  } finally {
    if (process.env.NEBULA_LOG === '1') {
      console.log(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms`);
    }
  }
});

async function handleApi(req, res, pathname, query) {
  const method = req.method;
  const seg = pathname.split('/').filter(Boolean); /* ['api', ...] */
  const [, resource, id, action] = seg;

  /* ---------------------------------------------------------------- estado */
  if (resource === 'health') {
    return json(res, 200, {
      ok: true,
      app: 'nebula',
      version: VERSION,
      platform: process.platform,
      hostname: os.hostname(),
      mode: store.settings.demo ? 'demo' : 'normal',
      dataDir: DATA_DIR,
      packaged: assets.packaged,
      assetsRoot: ROOT_DIR,
      now: nowIso(),
    });
  }

  if (resource === 'state') {
    const games = filteredGames(query).map(publicGame);
    return json(res, 200, {
      app: {
        version: VERSION,
        platform: process.platform,
        dataDir: DATA_DIR,
        startedAt: bootTime,
        packaged: assets.packaged,
        ventana: hayEntornoGrafico() && Boolean(navegadorDisponible()) && !args.browser ? 'aplicacion' : 'navegador',
      },
      games,
      facets: store.facets(),
      stats: store.stats(),
      settings: store.settings,
      platforms: Object.entries(PLATFORMS).map(([id, def]) => ({ id, ...def })),
      statuses: STATUSES,
      consoles: CONSOLES.map((c) => ({ id: c.id, label: c.label, extensions: c.extensions })),
      emulatorPresets: emulatorPresets(),
      metadataProviders: metadata.config.providers,
      launcher: launcher?.status() || { sessions: {}, count: 0, log: [] },
      scan: { running: scanState.running, startedAt: scanState.startedAt, finishedAt: scanState.finishedAt, summary: scanState.last ? { at: scanState.last.at, counts: scanState.last.counts, scanned: scanState.last.scanned, errors: scanState.last.errors } : null },
      count: games.length,
    });
  }

  if (resource === 'stats') return json(res, 200, store.stats());
  if (resource === 'facets') return json(res, 200, store.facets());

  /* ----------------------------------------------------------- juegos (CRUD) */
  if (resource === 'games') {
    if (!id) {
      if (method === 'GET') {
        return json(res, 200, { games: filteredGames(query).map(publicGame), count: filteredGames(query).length });
      }
      if (method === 'POST') {
        const body = await readBody(req);
        if (!body.name) return error(res, 400, 'El nombre es obligatorio');
        const { game, created } = await store.add(body, { dedupe: body.allowDuplicates ? false : true });
        await store.flush();
        return json(res, created ? 201 : 200, { game: publicGame(game), created });
      }
      if (method === 'DELETE') {
        const body = await readBody(req);
        const ids = Array.isArray(body.ids) ? body.ids : [];
        if (body.demoOnly) {
          const demoIds = store.list().filter((g) => g.demo).map((g) => g.id);
          const removed = await store.removeMany(demoIds);
          if (!store.list().some((g) => g.demo)) store.setSettings({ demo: false });
          await store.flush();
          return json(res, 200, { removed });
        }
        const removed = await store.removeMany(ids);
        await store.flush();
        return json(res, 200, { removed });
      }
    }

    const game = store.get(id);
    if (!game) return error(res, 404, 'Juego no encontrado');

    if (!action && method === 'GET') return json(res, 200, { game: publicGame(game) });

    if (!action && method === 'PATCH') {
      const body = await readBody(req);
      if (body.playtimeSeconds != null) {
        const value = Math.max(0, Number(body.playtimeSeconds) || 0);
        body.manualPlaytimeSeconds = value;
        delete body.playtimeSeconds;
      }
      const updated = await store.update(id, body);
      await store.flush();
      return json(res, 200, { game: publicGame(updated) });
    }

    if (!action && method === 'DELETE') {
      await store.remove(id);
      await store.flush();
      return json(res, 200, { ok: true });
    }

    if (action === 'launch' && method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      try {
        const session = await launcher.launch(id, body || {});
        await store.flush();
        return json(res, 200, { ok: true, session });
      } catch (err) {
        return error(res, 400, err.message);
      }
    }

    if (action === 'stop' && method === 'POST') {
      try {
        const result = await launcher.stopGame(id);
        await store.flush();
        return json(res, 200, { ok: true, ...result });
      } catch (err) {
        return error(res, 400, err.message);
      }
    }

    if (action === 'reveal' && method === 'POST') {
      try {
        await launcher.revealGame(id);
        return json(res, 200, { ok: true });
      } catch (err) {
        return error(res, 400, err.message);
      }
    }

    if (action === 'open-store' && method === 'POST') {
      const uri = storeUri(game);
      if (!uri) return error(res, 400, 'No hay tienda asociada');
      await util.openExternal(uri);
      return json(res, 200, { ok: true, uri });
    }

    if (action === 'metadata' && method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      try {
        let candidate = body.candidate || null;
        if (!candidate) {
          candidate = await metadata.bestMatch(body.query || game.name, { language: body.language });
          if (!candidate) return error(res, 404, `Sin coincidencias para «${body.query || game.name}»`);
        }
        const updated = await applyMetadata(game, candidate, {
          fields: body.fields || {},
          overwrite: body.overwrite === true,
          downloadArt: body.downloadArt !== false,
        });
        await store.flush();
        return json(res, 200, { game: publicGame(updated), applied: candidate.source });
      } catch (err) {
        return error(res, 400, err.message);
      }
    }

    if (action === 'metadata-art' && method === 'POST') {
      /* reintenta la descarga de carátula y fondo con la ficha ya guardada */
      const guardado = game.extra?.metadata?.candidate || null;
      const candidato = guardado || {
        source: game.extra?.metadata?.source || 'manual',
        title: game.extra?.metadata?.title || game.name,
        coverUrl: game.coverUrl || null,
        bannerUrl: game.backgroundUrl || null,
        url: game.extra?.metadata?.url || null,
        extra: {},
      };
      const caratulas = await metadata.coverOptions(candidato, { kind: 'cover' }).catch(() => []);
      const fondos = await metadata.coverOptions(candidato, { kind: 'banner' }).catch(() => []);
      const cover = caratulas.length ? await media.downloadBest(game.id, caratulas, 'cover') : { file: null, url: null, error: 'no hay direcciones que probar', intentos: 0 };
      const banner = fondos.length ? await media.downloadBest(game.id, fondos, 'banner') : { file: null, url: null, error: 'no hay direcciones que probar', intentos: 0 };
      const patch = {
        extra: {
          ...(game.extra || {}),
          metadata: {
            ...(game.extra?.metadata || {}),
            candidate: candidato,
            imagenes: { cover: { ok: Boolean(cover.file), url: cover.url, error: cover.error, intentos: cover.intentos },
                        banner: { ok: Boolean(banner.file), url: banner.url, error: banner.error, intentos: banner.intentos } },
          },
        },
      };
      if (cover.file) patch.coverFile = cover.file;
      if (banner.file) patch.backgroundFile = banner.file;
      const actualizado = await store.update(game.id, patch);
      await store.flush();
      return json(res, 200, { game: publicGame(actualizado), cover, banner });
    }

    if (action === 'detect-art' && method === 'POST') {
      const art = await findLocalArt(game.installDir);
      const found = Object.values(art).filter(Boolean).length;
      if (found) {
        await store.update(id, { coverFile: art.coverFile || game.coverFile, backgroundFile: art.backgroundFile || game.backgroundFile, iconFile: art.iconFile || game.iconFile });
        await store.flush();
      }
      return json(res, 200, { found, art });
    }

    if (action === 'analyze' && method === 'POST') {
      let dir = game.installDir || game.executable;
      if (!dir) return error(res, 400, 'El juego no tiene carpeta instalada');
      /* si apunta a un archivo, se analiza la carpeta que lo contiene */
      const stat = await fsp.stat(dir).catch(() => null);
      if (stat && stat.isFile()) dir = path.dirname(dir);
      const info = await analyzeFolder(dir, { withSize: true, maxDepth: 2 });
      return json(res, 200, { ...info, analyzedDir: dir });
    }

    /* ------------------------------------------------------------- imagenes */
    if (action === 'cover' || action === 'banner' || action === 'icon') {
      if (method === 'GET') return serveImage(res, req, game, action);
      if (method === 'POST' || method === 'PUT') {
        const body = await readBody(req);
        if (!body.data) return error(res, 400, 'Falta el contenido de la imagen');
        const match = String(body.data).match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
        const base64 = match ? match[2] : String(body.data);
        const mime = match ? match[1] : body.mime || 'image/png';
        const ext = mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : mime.includes('gif') ? '.gif' : mime.includes('svg') ? '.svg' : '.jpg';
        const kind = action === 'banner' ? 'banner' : 'cover';
        const file = await media.saveUpload(game.id, kind, { data: base64, ext });
        if (action === 'banner') await store.update(id, { backgroundFile: file });
        else if (action === 'icon') await store.update(id, { iconFile: file });
        else await store.update(id, { coverFile: file, coverUrl: null });
        await store.flush();
        return json(res, 200, { ok: true, file: path.basename(file) });
      }
      if (method === 'DELETE') {
        if (action === 'cover') {
          await media.removeUploaded(game.id, 'cover');
          await store.update(id, { coverFile: null, coverUrl: null });
          await media.generatedCover(game).then((f) => fsp.rm(f, { force: true })).catch(() => {});
        } else if (action === 'banner') {
          await media.removeUploaded(game.id, 'banner');
          await store.update(id, { backgroundFile: null, backgroundUrl: null });
        } else {
          await store.update(id, { iconFile: null });
        }
        await store.flush();
        return json(res, 200, { ok: true });
      }
    }
    return error(res, 405, 'Metodo no permitido');
  }

  /* ------------------------------------------------------------- sesiones */
  if (resource === 'sessions') {
    if (method === 'GET') {
      const all = [];
      for (const game of store.list()) {
        for (const session of game.sessions || []) {
          all.push({ gameId: game.id, game: game.name, cover: `/api/games/${game.id}/cover`, platform: game.platform, ...session });
        }
      }
      all.sort((a, b) => new Date(b.start) - new Date(a.start));
      const limit = Number(query.get('limit')) || 60;
      return json(res, 200, { sessions: all.slice(0, limit), total: all.length, live: launcher?.status() || null });
    }
    if (method === 'POST') {
      const body = await readBody(req);
      const game = store.get(body.gameId);
      if (!game) return error(res, 404, 'Juego no encontrado');
      const seconds = Math.max(0, Math.round(Number(body.seconds) || 0));
      if (!seconds) return error(res, 400, 'La duracion debe ser mayor que cero');
      const end = body.end ? new Date(body.end) : new Date();
      const start = body.start ? new Date(body.start) : new Date(end.getTime() - seconds * 1000);
      game.sessions = game.sessions || [];
      game.sessions.push({ start: start.toISOString(), end: end.toISOString(), seconds, detected: 'manual' });
      game.sessions.sort((a, b) => new Date(a.start) - new Date(b.start));
      game.playtimeSeconds = game.sessions.reduce((sum, s) => sum + s.seconds, 0) + (game.manualPlaytimeSeconds || 0);
      game.playCount = (game.playCount || 0) + 1;
      game.lastPlayed = end.toISOString();
      if (!game.firstPlayed) game.firstPlayed = start.toISOString();
      store.scheduleSave();
      await store.flush();
      return json(res, 200, { game: publicGame(game) });
    }
    if (method === 'DELETE') {
      const gid = query.get('gameId');
      const game = store.get(gid);
      if (!game) return error(res, 404, 'Juego no encontrado');
      const rawIndex = query.get('index');
      const index = rawIndex === null || rawIndex === '' ? Number.NaN : Number(rawIndex);
      if (Number.isInteger(index) && index >= 0) {
        const list = game.sessions || [];
        list.splice(list.length - 1 - index, 1);
      } else if (query.get('all') === '1') {
        game.sessions = [];
      }
      game.playtimeSeconds = (game.sessions || []).reduce((sum, s) => sum + s.seconds, 0) + (game.manualPlaytimeSeconds || 0);
      await store.flush();
      return json(res, 200, { game: publicGame(game) });
    }
  }

  /* ----------------------------------------------------------- lanzadera */
  if (resource === 'launcher') {
    if (id === 'log' || (!id && method === 'GET')) return json(res, 200, launcher.status());
    if (id === 'stop-all' && method === 'POST') {
      const results = [];
      for (const gameId of [...launcher.running.keys()]) {
        try {
          results.push({ gameId, ...(await launcher.stopGame(gameId)) });
        } catch (err) {
          results.push({ gameId, error: err.message });
        }
      }
      return json(res, 200, { stopped: results });
    }
  }

  /* -------------------------------------------------------------- escaneo */
  if (resource === 'scan') {
    if (method === 'GET') return json(res, 200, { running: scanState.running, last: scanState.last });
    if (method === 'POST') {
      const body = await readBody(req);
      if (body.import) {
        const result = await importFindings(body.findings || [], body.options || {});
        return json(res, 200, result);
      }
      const result = await runScan({
        sources: body.sources || store.settings.sources,
        roots: body.roots || store.settings.scanRoots,
      });
      return json(res, 200, result);
    }
  }

  if (resource === 'detect') {
    if (method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      const result = await runScan({ sources: body.sources || store.settings.sources, roots: store.settings.scanRoots });
      return json(res, 200, result);
    }
  }

  /* ----------------------------------------------------- carpetas de escaneo */
  if (resource === 'roots') {
    if (method === 'GET') {
      return json(res, 200, { roots: store.settings.scanRoots, emulatorProfiles: store.settings.emulatorProfiles });
    }
    if (method === 'POST') {
      const body = await readBody(req);
      if (!body.path) return error(res, 400, 'Falta la ruta');
      const root = {
        id: uid('root'),
        path: path.resolve(body.path),
        kind: body.kind === 'rom' ? 'rom' : body.kind === 'single' ? 'single' : 'collection',
        label: body.label || path.basename(path.resolve(body.path)),
        recursive: Boolean(body.recursive),
        deep: body.deep !== false,
        emulatorProfileId: body.emulatorProfileId || null,
        addedAt: nowIso(),
      };
      store.setSettings({ scanRoots: [...store.settings.scanRoots, root] });
      await store.flush();
      return json(res, 201, { root });
    }
    if (method === 'DELETE') {
      const target = id || query.get('id');
      const roots = store.settings.scanRoots.filter((r) => r.id !== target);
      store.setSettings({ scanRoots: roots });
      await store.flush();
      return json(res, 200, { roots });
    }
  }

  /* -------------------------------------------------------------- carpetas */
  if (resource === 'folders') {
    /* escanear una carpeta concreta y devolver candidatos */
    if (method === 'POST') {
      const body = await readBody(req);
      if (!body.path) return error(res, 400, 'Falta la ruta');
      const target = path.resolve(body.path);
      if (!(await exists(target))) return error(res, 400, 'La ruta no existe');
      if (body.kind === 'rom') {
        const { findings, consoles, truncated } = await scanRoms(target, { recursive: body.recursive });
        return json(res, 200, { kind: 'rom', findings, consoles, truncated });
      }
      if (body.kind === 'collection' || body.asList) {
        const findings = await scanCollection(target, { withSize: body.withSize, deep: body.deep !== false });
        return json(res, 200, { kind: 'collection', findings });
      }
      const info = await scanSingleFolder(target, { withSize: body.withSize });
      return json(res, 200, { kind: 'single', ...info });
    }
  }

  /* ------------------------------------------------------ explorador simple */
  if (resource === 'fs') {
    const target = query.get('path') ? path.resolve(query.get('path')) : os.homedir();
    let entries = [];
    try {
      entries = await fsp.readdir(target, { withFileTypes: true });
    } catch (err) {
      return error(res, 400, `No se puede leer la carpeta: ${err.message}`);
    }
    const dirs = [];
    const files = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(target, entry.name);
      if (entry.isDirectory()) {
        dirs.push({ name: entry.name, path: full, type: 'dir' });
      } else if (entry.isFile() && isLaunchableFile(full, 1024)) {
        let stat = null;
        try {
          stat = await fsp.stat(full);
        } catch {
          continue;
        }
        files.push({ name: entry.name, path: full, type: 'file', size: stat.size });
      }
    }
    dirs.sort((a, b) => util.naturalCompare(a.name, b.name));
    files.sort((a, b) => util.naturalCompare(a.name, b.name));
    const parent = path.dirname(target);
    return json(res, 200, {
      path: target,
      parent: parent === target ? null : parent,
      home: os.homedir(),
      roots: drives(),
      entries: [...dirs.slice(0, 400), ...files.slice(0, 200)],
    });
  }

  /* ------------------------------------------------------------ emuladores */
  if (resource === 'emulators') {
    if (method === 'GET') return json(res, 200, { profiles: store.settings.emulatorProfiles, presets: emulatorPresets(), consoles: CONSOLES });
    if (method === 'POST') {
      const body = await readBody(req);
      if (!body.name || !body.command) return error(res, 400, 'Nombre y comando son obligatorios');
      const profile = {
        id: uid('emu'),
        name: body.name,
        command: body.command,
        consoles: Array.isArray(body.consoles) ? body.consoles : [],
        workDir: body.workDir || null,
        addedAt: nowIso(),
      };
      store.setSettings({ emulatorProfiles: [...store.settings.emulatorProfiles, profile] });
      await store.flush();
      return json(res, 201, { profile });
    }
    if (method === 'PATCH') {
      const body = await readBody(req);
      const profiles = store.settings.emulatorProfiles.map((p) => (p.id === id ? { ...p, ...body, id: p.id } : p));
      store.setSettings({ emulatorProfiles: profiles });
      await store.flush();
      return json(res, 200, { profiles });
    }
    if (method === 'DELETE') {
      store.setSettings({ emulatorProfiles: store.settings.emulatorProfiles.filter((p) => p.id !== id) });
      await store.flush();
      return json(res, 200, { ok: true });
    }
  }

  /* ------------------------------------------------------------ metadatos */
  if (resource === 'metadata') {
    if (id === 'search' && method === 'GET') {
      const queryText = query.get('query') || query.get('q') || '';
      const providers = query.get('providers') ? Object.fromEntries(query.get('providers').split(',').map((p) => [p.trim(), true])) : undefined;
      try {
        const result = await metadata.search(queryText, { language: query.get('lang') || undefined, providers });
        return json(res, 200, result);
      } catch (err) {
        return error(res, 400, err.message);
      }
    }
    if (id === 'providers' && method === 'GET') {
      return json(res, 200, await metadata.probeProviders());
    }
    if (id === 'suggest' && method === 'GET') {
      try {
        return json(res, 200, { candidate: await metadata.bestMatch(query.get('name') || '') });
      } catch (err) {
        return error(res, 400, err.message);
      }
    }
    if (id === 'fill' && method === 'POST') {
      const body = await readBody(req);
      const onlyMissing = body.onlyMissing !== false;
      const limit = Math.min(30, Math.max(1, Number(body.limit) || 8));
      const pool = body.gameIds?.length ? body.gameIds.map((gid) => store.get(gid)).filter(Boolean) : store.list().filter((g) => !g.demo);
      const targets = pool.filter((g) => (onlyMissing ? (!g.description || !g.coverFile || !(g.genres || []).length) : true)).slice(0, limit);
      const filled = [];
      const skipped = [];
      const errors = [];
      for (const game of targets) {
        try {
          const candidate = await metadata.bestMatch(game.name);
          if (!candidate) {
            skipped.push({ id: game.id, name: game.name, reason: 'sin coincidencias fiables' });
            continue;
          }
          await applyMetadata(game, candidate, { overwrite: body.overwrite === true });
          filled.push({ id: game.id, name: game.name, source: candidate.source, title: candidate.title, score: candidate.score });
        } catch (err) {
          errors.push({ id: game.id, name: game.name, message: err.message });
        }
      }
      await store.flush();
      return json(res, 200, { filled, skipped, errors, total: targets.length });
    }
    return error(res, 404, 'Ruta de metadatos no encontrada');
  }

  /* ------------------------------------------------------------- ajustes */
  if (resource === 'settings') {
    if (method === 'GET') return json(res, 200, store.settings);
    if (method === 'PATCH' || method === 'POST') {
      const body = await readBody(req);
      store.setSettings(body);
      await store.flush();
      return json(res, 200, store.settings);
    }
  }

  /* ------------------------------------------------------- importar/exportar */
  if (resource === 'export') {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="nebula-${new Date().toISOString().slice(0, 10)}.json"`,
    });
    return res.end(JSON.stringify(store.exportPayload(), null, 2));
  }

  if (resource === 'import' && method === 'POST') {
    const body = await readBody(req);
    const result = await store.importPayload(body.payload || body, { mode: body.mode || 'merge' });
    return json(res, 200, result);
  }

  /* ----------------------------------------------------------------- demo */
  if (resource === 'demo') {
    if (method === 'POST') {
      const added = await loadDemo();
      return json(res, 200, { added, demo: true });
    }
    if (method === 'DELETE') {
      const demoIds = store.list().filter((g) => g.demo).map((g) => g.id);
      const removed = await store.removeMany(demoIds);
      store.setSettings({ demo: false });
      await store.flush();
      return json(res, 200, { removed });
    }
  }

  return error(res, 404, `Ruta no encontrada: ${pathname}`);
}

/* --------------------------------------------------------------- imagenes */

async function serveImage(res, req, game, kind) {
  let file;
  if (kind === 'icon') {
    file = game.iconFile && (await exists(game.iconFile)) ? game.iconFile : null;
    if (!file) {
      /* se usa la caratula generada como icono */
      file = await media.generatedCover(game);
    }
  } else {
    const useRemote = store.settings.fetchRemoteArt !== false;
    file = await media.resolve(game, kind === 'banner' ? 'banner' : 'cover', { download: useRemote });
  }
  let buffer;
  try {
    buffer = await fsp.readFile(file);
  } catch {
    return error(res, 404, 'Imagen no disponible');
  }
  const headers = {
    'content-type': mimeFor(file),
    'content-length': buffer.length,
    'cache-control': 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
  };
  if (file.endsWith('.svg')) headers['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'";
  res.writeHead(200, headers);
  res.end(buffer);
}

/* ------------------------------------------------------------------ estatico */

async function serveStatic(req, res, pathname) {
  /* /docs y lo que siga se sirve desde la carpeta de documentación */
  if (pathname === '/docs' || pathname.startsWith('/docs/')) {
    const rest = pathname.replace(/^\/docs\/?/, '');
    const docsTarget = path.join(DOCS_DIR, rest || 'capturas.html');
    if (!isInside(DOCS_DIR, docsTarget)) return error(res, 403, 'Ruta no permitida');
    return sendFile(res, docsTarget);
  }

  /* el navegador pide /favicon.ico aunque el icono se declare en el HTML */
  if (pathname === '/favicon.ico') {
    const icono = path.join(PUBLIC_DIR, 'img', 'icono.ico');
    if (await fsp.stat(icono).catch(() => null)) return sendFile(res, icono);
  }

  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.join(PUBLIC_DIR, relative);
  if (!isInside(PUBLIC_DIR, target)) return error(res, 403, 'Ruta no permitida');
  let file = target;
  try {
    const stat = await fsp.stat(file);
    if (stat.isDirectory()) file = path.join(file, 'index.html');
  } catch {
    /* sin extension -> devuelve la app (rutas del cliente) */
    if (!path.extname(relative)) file = path.join(PUBLIC_DIR, 'index.html');
    else return error(res, 404, 'Archivo no encontrado');
  }
  return sendFile(res, file);
}

async function sendFile(res, file) {
  try {
    const buffer = await fsp.readFile(file);
    const ext = path.extname(file);
    res.writeHead(200, {
      'content-type': contentTypeFor(file),
      'content-length': buffer.length,
      'cache-control': ext === '.html' ? 'no-store' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    return res.end(buffer);
  } catch {
    return error(res, 404, 'Archivo no encontrado');
  }
}

function drives() {
  if (process.platform !== 'win32') return [{ name: 'Inicio', path: os.homedir() }, { name: 'Raiz', path: '/' }];
  const out = [];
  for (const letter of 'CDEFGHIJ') out.push({ name: `${letter}:`, path: `${letter}:\\` });
  return out;
}

function storeUri(game) {
  if (game.platform === 'steam' && game.sourceId) return `steam://store/${game.sourceId}`;
  if (game.platform === 'epic' && game.extra?.appName) return `com.epicgames.launcher://apps/${game.extra.appName}?action=launch&silent=true`;
  if (game.platform === 'gog' && game.sourceId) return `goggalaxy://openStorePage/${game.sourceId}`;
  return null;
}

function emulatorPresets() {
  const presets = [];
  const candidates = [
    { name: 'RetroArch', command: 'retroarch -L {core} "{rom}"', consoles: CONSOLES.map((c) => c.id), linux: 'retroarch' },
    { name: 'Dolphin', command: 'dolphin-emu -e "{rom}"', consoles: ['gamecube', 'wii'] },
    { name: 'PCSX2', command: 'pcsx2 "{rom}"', consoles: ['ps2'] },
    { name: 'DuckStation', command: 'duckstation-qt "{rom}"', consoles: ['ps1'] },
    { name: 'PPSSPP', command: 'ppsspp "{rom}"', consoles: ['psp'] },
    { name: 'mGBA', command: 'mgba-qt "{rom}"', consoles: ['gba', 'gb', 'gbc'] },
    { name: 'Mesen', command: 'mesen "{rom}"', consoles: ['nes', 'snes', 'gb', 'gba'] },
    { name: 'Snes9x', command: 'snes9x-gtk "{rom}"', consoles: ['snes'] },
    { name: 'Mupen64Plus', command: 'mupen64plus "{rom}"', consoles: ['n64'] },
    { name: 'Flycast', command: 'flycast "{rom}"', consoles: ['dreamcast'] },
    { name: 'DOSBox-X', command: 'dosbox-x -c "{rom}"', consoles: ['dos'] },
    { name: 'melonds', command: 'melonDS "{rom}"', consoles: ['nds'] },
  ];
  for (const candidate of candidates) presets.push(candidate);
  return presets;
}

/* ------------------------------------------------------------------ arranque */

const bootTime = nowIso();
let serverInstance = null;

async function main() {
  await bootstrap();
  serverInstance = server.listen(args.port, args.host, () => {
    const shown = args.host === '0.0.0.0' ? 'localhost' : args.host;
    console.log(`\n  Nébula ${VERSION}`);
    console.log(`  ──────────────────────────────────`);
    console.log(`  Biblioteca: ${store.list().length} juegos · datos en ${DATA_DIR}`);
    console.log(`  Interfaz:   http://${shown}:${args.port}`);
    if (args.host === '0.0.0.0') console.log(`  Red local:  http://<tu-ip>:${args.port}`);
    console.log(`  Detener:    Ctrl+C\n`);
    if (args.open) abrirAplicacion(`http://localhost:${args.port}`);
  });

  serverInstance.on('error', (err) => {
    /* si la consola está oculta hay que avisar con una ventana del sistema */
    if (err.code === 'EADDRINUSE') {
      avisar('Nébula', `El puerto ${args.port} está ocupado por otro programa.\n\n` +
        'Puedes abrir Nébula con otro puerto desde una terminal:\n' +
        `    Nebula.exe --port ${args.port + 1}\n\n` +
        'Si ya tienes Nébula abierto, cierra esa ventana antes de volver a abrirlo.', { forzar: true });
    }
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  ✖ El puerto ${args.port} esta ocupado. Prueba: node server/index.js --port ${args.port + 1}\n`);
    } else {
      console.error(`\n  ✖ ${err.message}\n`);
    }
    process.exit(1);
  });
}

async function shutdown(signal) {
  console.log(`\n  Cerrando (${signal})...`);
  launcher?.stop();
  try {
    const running = launcher ? [...launcher.running.keys()] : [];
    for (const gameId of running) {
      await launcher.stopGame(gameId).catch(() => {});
    }
    await store.flush();
  } catch {
    /* no bloquear el cierre */
  }
  serverInstance?.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => console.error('  ✖ promesa rechazada:', err?.message || err));
process.on('uncaughtException', (err) => console.error('  ✖ excepcion:', err?.stack || err));

main().catch((err) => {
  console.error('No se pudo iniciar:', err);
  process.exit(1);
});
