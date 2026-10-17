/**
 * Deteccion de juegos instalados.
 * Cada detector devuelve entradas normalizadas que luego el usuario confirma
 * antes de incorporarlas a la biblioteca.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  IS_WIN, IS_MAC, IS_LINUX, exists, existsSync, walk, normalize, titleCase,
  homePath, sizeOfDir, readJson, uniqueBy,
} from './util.js';

/* ------------------------------------------------------------------ consolas */

export const CONSOLES = [
  { id: 'nes', label: 'NES', extensions: ['.nes', '.unf', '.unif', '.fds'] },
  { id: 'snes', label: 'Super Nintendo', extensions: ['.sfc', '.smc', '.fig', '.swc'] },
  { id: 'n64', label: 'Nintendo 64', extensions: ['.n64', '.z64', '.v64'] },
  { id: 'gb', label: 'Game Boy', extensions: ['.gb'] },
  { id: 'gbc', label: 'Game Boy Color', extensions: ['.gbc'] },
  { id: 'gba', label: 'Game Boy Advance', extensions: ['.gba'] },
  { id: 'nds', label: 'Nintendo DS', extensions: ['.nds'] },
  { id: '3ds', label: 'Nintendo 3DS', extensions: ['.3ds', '.cia', '.cci'] },
  { id: 'gamecube', label: 'GameCube', extensions: ['.gcm', '.rvz', '.dol'] },
  { id: 'wii', label: 'Wii', extensions: ['.wbfs', '.wad'] },
  { id: 'genesis', label: 'Mega Drive', extensions: ['.md', '.gen', '.bin', '.smd'] },
  { id: 'mastersystem', label: 'Master System', extensions: ['.sms'] },
  { id: 'gamegear', label: 'Game Gear', extensions: ['.gg'] },
  { id: 'saturn', label: 'Saturn', extensions: ['.chd', '.cue'] },
  { id: 'ps1', label: 'PlayStation', extensions: ['.pbp', '.m3u'] },
  { id: 'psp', label: 'PSP', extensions: ['.cso', '.elf'] },
  { id: 'pce', label: 'PC Engine', extensions: ['.pce'] },
  { id: 'neogeo', label: 'Neo Geo', extensions: ['.neo'] },
  { id: 'atari2600', label: 'Atari 2600', extensions: ['.a26'] },
  { id: 'msx', label: 'MSX', extensions: ['.mx1', '.mx2'] },
  { id: 'arcade', label: 'Recreativa', extensions: ['.zip', '.7z'] },
  { id: 'dreamcast', label: 'Dreamcast', extensions: ['.gdi', '.cdi'] },
  { id: 'dos', label: 'DOS', extensions: ['.bat', '.conf'] },
];

const EXT_TO_CONSOLE = new Map();
for (const console of CONSOLES) {
  for (const ext of console.extensions) EXT_TO_CONSOLE.set(ext, console);
}

/* ------------------------------------------------- heuristicas de ejecutables */

const BAD_EXE_HINTS = [
  'unins', 'uninstall', 'setup', 'installer', 'install', 'redist', 'vcredist', 'vc_redist',
  'dxsetup', 'dxwebsetup', 'directx', 'dotnet', 'oalinst', 'crash', 'report', 'bug',
  'updater', 'update.exe', 'patcher', 'webhelper', 'benchmark', 'register', 'config',
  'settings', 'options', 'readme', 'manual', 'help', 'eula', 'license', 'editor',
  'tool', 'server', 'dedicated', 'modkit', 'sdk', 'sample', 'demo_', 'easyanticheat',
  'battleye', 'eac_', 'be_', 'steamerrorreporter', 'notification', 'activation',
  'launcherhelper', 'python', 'node.exe', 'ffmpeg', 'dxdiag', 'touchup', 'maintenanc',
  'prereq', 'cleanup', 'capture', 'overlay', 'trainer', 'cheat', 'idlemaster',
];

const GOOD_EXE_HINTS = ['game', 'play', 'launcher', 'win64', 'win32', 'x64', 'x86', 'shipping'];

const EXE_GROUPS = [
  { id: 'exe', label: 'Ejecutable de Windows', extensions: ['.exe', '.bat', '.cmd'], platform: 'win32' },
  { id: 'app', label: 'Aplicacion de macOS', extensions: ['.app'], platform: 'darwin' },
  { id: 'linux', label: 'Binario de Linux', extensions: ['.sh', '.appimage', '.x86_64', '.x86', '.run', '.bin', ''], platform: 'linux' },
  { id: 'rom', label: 'ROM', extensions: [...EXT_TO_CONSOLE.keys()], platform: 'any' },
];

export function extensionOf(file) {
  return path.extname(file).toLowerCase();
}

/** Puntua que tan probable es que un archivo sea el ejecutable principal del juego. */
export function scoreExecutable(file, rootDir) {
  const ext = extensionOf(file);
  const base = path.basename(file, ext);
  const lower = file.toLowerCase();
  const nameLower = base.toLowerCase();
  let score = 0;

  if (ext === '.exe') score += 2;
  else if (ext === '.app' || ext === '.appimage' || ext === '.sh' || ext === '.x86_64' || ext === '.x86' || ext === '.run') score += 2;
  else if (ext === '' && base) score += 2; /* binario sin extensión (ya validado como ejecutable) */
  else score -= 4;

  if (BAD_EXE_HINTS.some((h) => nameLower.includes(h))) score -= 12;
  if (GOOD_EXE_HINTS.some((h) => nameLower.includes(h))) score += 1.5;

  const rel = path.relative(rootDir, file);
  const depth = rel.split(path.sep).length - 1;
  score += Math.max(0, 3 - depth);

  const rootName = normalize(path.basename(rootDir));
  const fileName = normalize(base);
  if (rootName && fileName) {
    if (rootName === fileName) score += 6;
    else {
      const a = new Set(rootName.split(' '));
      const b = new Set(fileName.split(' '));
      let shared = 0;
      for (const token of a) if (b.has(token) && token.length > 3) shared++;
      score += Math.min(4, shared * 2);
    }
  }

  if (/[\\/](bin|binaries|bin64|win64|win32|x64|x86|game|gamedata|shipping|release|build)[\\/]/i.test(lower)) score += 1.2;
  if (/[\\/](redist|support|directx|engine|tools)[\\/]/i.test(lower)) score -= 6;
  if (/\d{4}-\d{2}/.test(nameLower)) score -= 2; /* builds con fecha en el nombre */

  return score;
}

/** Caratulas locales tipicas dentro de una carpeta de juego. */
const COVER_CANDIDATES = [
  'cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'boxart.jpg', 'boxart.png',
  'folder.jpg', 'folder.png', 'poster.jpg', 'poster.png', 'library.jpg', 'library_600x900.jpg',
  'grid.jpg', 'art.jpg', 'front.jpg', 'portada.jpg', 'portada.png',
];

const BACKGROUND_CANDIDATES = [
  'background.jpg', 'background.png', 'hero.jpg', 'hero.png', 'banner.jpg', 'banner.png',
  'header.jpg', 'header.png', 'fanart.jpg', 'fanart.png', 'wallpaper.jpg', 'backdrop.jpg',
];

const ICON_CANDIDATES = ['icon.png', 'icon.ico', 'icon.jpg', 'logo.png'];

async function findFirstFile(dirs, names) {
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Analiza una carpeta: ejecutables candidatos, arte local y tamano. */
export async function analyzeFolder(dir, options = {}) {
  const { withSize = false, maxDepth = 3 } = options;
  const { files } = await walk(dir, { maxDepth, maxEntries: 5000, maxMs: 2500 });
  const candidates = files
    .filter((f) => isLaunchableFile(f.path, f.size, f.mode))
    .map((f) => ({ ...f, score: scoreExecutable(f.path, dir) }))
    .sort((a, b) => b.score - a.score);

  const subdirs = [dir, path.join(dir, 'bin'), path.join(dir, 'Binaries', 'Win64'), path.join(dir, 'bin', 'x64')];
  const cover = await findFirstFile(subdirs, COVER_CANDIDATES);
  const background = await findFirstFile(subdirs, BACKGROUND_CANDIDATES);
  const icon = await findFirstFile(subdirs, ICON_CANDIDATES);
  const sizeBytes = withSize ? await sizeOfDir(dir) : 0;

  return { candidates, cover, background, icon, sizeBytes, fileCount: files.length };
}

export function isLaunchableFile(file, size = 0, mode = 0) {
  const ext = extensionOf(file);
  const base = path.basename(file, ext);
  const executableBit = Boolean(mode & 0o111);
  /* los .exe cuentan en cualquier sistema: en Linux/macOS se lanzan con Wine */
  if (ext === '.exe') return true;
  if (ext === '.lnk' || ext === '.url') return true;
  if (IS_MAC) return ext === '.app';
  if (ext === '.bat' || ext === '.cmd') return false;
  if (ext === '.sh' || ext === '.appimage' || ext === '.x86_64' || ext === '.x86' || ext === '.run') return true;
  if (!ext && base && (size > 32 * 1024 || executableBit)) return true;
  return false;
}

/* -------------------------------------------------------------------- Steam */

const STEAM_DIR_CANDIDATES = IS_WIN
  ? [
      'C:\\Program Files (x86)\\Steam',
      'C:\\Program Files\\Steam',
      'C:\\Steam',
      'D:\\Steam',
      'D:\\Program Files (x86)\\Steam',
      'E:\\Steam',
    ]
  : IS_MAC
    ? [homePath('Library/Application Support/Steam'), homePath('Library/Application Support/Steam/Steam.AppBundle/Steam/Contents/MacOS')]
    : [
        homePath('.steam/steam'),
        homePath('.local/share/Steam'),
        homePath('.steam/root'),
        homePath('.var/app/com.valvesoftware.Steam/.local/share/Steam'),
        homePath('snap/steam/common/.local/share/Steam'),
      ];

function unescapeVdf(value) {
  return String(value).replace(/\\\\/g, '\\').replace(/\\"/g, '"');
}

export async function detectSteam() {
  const roots = [];
  for (const candidate of STEAM_DIR_CANDIDATES) {
    if (existsSync(candidate)) roots.push(candidate);
  }
  const findings = [];
  const seenApps = new Set();

  for (const root of uniqueBy(roots, (r) => r.toLowerCase())) {
    const libraryFolders = path.join(root, 'steamapps', 'libraryfolders.vdf');
    const libraries = [root];
    const vdf = await fsp.readFile(libraryFolders, 'utf8').catch(() => null);
    if (vdf) {
      for (const match of vdf.matchAll(/"path"\s*"([^"]+)"/g)) {
        const libPath = unescapeVdf(match[1]);
        if (libPath && !libraries.some((l) => l.toLowerCase() === libPath.toLowerCase())) libraries.push(libPath);
      }
    }
    for (const library of libraries) {
      const steamApps = library.toLowerCase().endsWith('steamapps')
        ? library
        : path.join(library, 'steamapps');
      let entries = [];
      try {
        entries = await fsp.readdir(steamApps);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const m = entry.match(/^appmanifest_(\d+)\.acf$/i);
        if (!m) continue;
        const appId = m[1];
        if (seenApps.has(appId)) continue;
        const raw = await fsp.readFile(path.join(steamApps, entry), 'utf8').catch(() => null);
        if (!raw) continue;
        const get = (key) => {
          const match = raw.match(new RegExp(`"${key}"\\s*"([^"]*)"`, 'i'));
          return match ? unescapeVdf(match[1]) : '';
        };
        const name = get('name');
        const installDir = get('installdir');
        const sizeOnDisk = Number(get('SizeOnDisk')) || 0;
        const stateFlags = Number(get('StateFlags')) || 0;
        const lastUpdated = Number(get('LastUpdated')) || 0;
        /* 4 = Fully Installed */
        if (!name || !installDir || (stateFlags && !(stateFlags & 4))) continue;
        seenApps.add(appId);
        findings.push({
          name,
          platform: 'steam',
          sourceId: appId,
          installDir: path.join(steamApps, 'common', installDir),
          executable: null,
          launchType: 'uri',
          launchCommand: `steam://rungameid/${appId}`,
          coverUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
          backgroundUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
          sizeBytes: sizeOnDisk,
          extra: { appId, library, lastUpdated: lastUpdated ? new Date(lastUpdated * 1000).toISOString() : null },
        });
      }
    }
  }
  return findings;
}

/* --------------------------------------------------------------------- Epic */

const EPIC_MANIFEST_DIRS = IS_WIN
  ? [
      'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests',
      path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests'),
    ]
  : [];

export async function detectEpic() {
  const findings = [];
  const dirs = uniqueBy(EPIC_MANIFEST_DIRS, (d) => d.toLowerCase());
  for (const dir of dirs) {
    let entries = [];
    try {
      entries = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith('.item')) continue;
      const manifest = await readJson(path.join(dir, entry), null);
      if (!manifest || !manifest.DisplayName || !manifest.InstallLocation) continue;
      const exe = manifest.LaunchExecutable
        ? path.join(manifest.InstallLocation, manifest.LaunchExecutable)
        : null;
      findings.push({
        name: manifest.DisplayName,
        platform: 'epic',
        sourceId: manifest.AppName || manifest.CatalogItemId || entry,
        installDir: manifest.InstallLocation,
        executable: exe && existsSync(exe) ? exe : null,
        launchType: 'uri',
        launchCommand: manifest.AppName
          ? `com.epicgames.launcher://apps/${manifest.AppName}?action=launch&silent=true`
          : null,
        sizeBytes: Number(manifest.InstallSize) || 0,
        extra: {
          appName: manifest.AppName || null,
          catalogItemId: manifest.CatalogItemId || null,
          namespace: manifest.CatalogNamespace || null,
        },
      });
    }
  }
  return findings;
}

/* ---------------------------------------------------------------------- GOG */

const GOG_DIRS = IS_WIN
  ? ['C:\\ProgramData\\GOG.com\\Games', 'C:\\Program Files (x86)\\GOG Galaxy\\Games', 'C:\\GOG Games']
  : [homePath('GOG Games'), homePath('.local/share/gog-games')];

export async function detectGog() {
  const findings = [];
  for (const root of uniqueBy(GOG_DIRS, (d) => d.toLowerCase())) {
    let entries = [];
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      let files = [];
      try {
        files = await fsp.readdir(dir);
      } catch {
        continue;
      }
      const infoFile = files.find((f) => /^goggame-.*\.info$/i.test(f));
      if (!infoFile) continue;
      const info = await readJson(path.join(dir, infoFile), null);
      if (!info) continue;
      const tasks = Array.isArray(info.playTasks) ? info.playTasks : [];
      const primary = tasks.find((t) => t.isPrimary) || tasks.find((t) => t.type === 'FileTask') || tasks[0] || null;
      const exe = primary?.path ? path.join(dir, primary.path) : null;
      findings.push({
        name: info.name || entry.name,
        platform: 'gog',
        sourceId: String(info.gameId || entry.name),
        installDir: primary?.workingDir ? path.join(dir, primary.workingDir) : dir,
        executable: exe && existsSync(exe) ? exe : null,
        launchArgs: primary?.arguments || '',
        sizeBytes: Number(info.sizeOnDisk) || 0,
        coverUrl: info.backgroundImage ? null : null,
        extra: { gameId: info.gameId || null, icon: info.icon || null },
      });
    }
  }
  return findings;
}

/* ------------------------------------------------------------------- Heroic */

const HEROIC_CONFIG_DIRS = [
  homePath('.config/heroic'),
  homePath('.var/app/com.heroicgameslauncher.hgl/config/heroic'),
  homePath('snap/heroic/config/heroic'),
];

export async function detectHeroic() {
  const findings = [];
  for (const configDir of HEROIC_CONFIG_DIRS) {
    if (!existsSync(configDir)) continue;
    const legendary = await readJson(path.join(configDir, 'legendaryConfig', 'legendary', 'installed.json'), null);
    if (legendary && typeof legendary === 'object') {
      for (const [appName, data] of Object.entries(legendary)) {
        if (!data || !data.install_path) continue;
        findings.push({
          name: data.title || appName,
          platform: 'heroic',
          sourceId: appName,
          installDir: data.install_path,
          executable: data.executable ? path.join(data.install_path, data.executable) : null,
          launchCommand: `heroic://launch/${appName}`,
          launchType: 'uri',
          extra: { runner: 'legendary', appName },
        });
      }
    }
    const gog = await readJson(path.join(configDir, 'gog_store', 'installed.json'), null);
    const gogList = Array.isArray(gog) ? gog : Array.isArray(gog?.games) ? gog.games : [];
    for (const data of gogList) {
      if (!data || !data.install_path) continue;
      findings.push({
        name: data.title || data.appName,
        platform: 'heroic',
        sourceId: data.appName,
        installDir: data.install_path,
        executable: data.executable ? path.join(data.install_path, data.executable) : null,
        launchCommand: `heroic://launch/${data.appName}`,
        launchType: 'uri',
        extra: { runner: 'gog', appName: data.appName },
      });
    }
  }
  return findings;
}

/* ------------------------------------------------------------------- Lutris */

export async function detectLutris() {
  const findings = [];
  const gamesDir = homePath('.local/share/lutris/games');
  let entries = [];
  try {
    entries = await fsp.readdir(gamesDir);
  } catch {
    return findings;
  }
  for (const entry of entries) {
    if (!/\.ya?ml$/i.test(entry)) continue;
    const raw = await fsp.readFile(path.join(gamesDir, entry), 'utf8').catch(() => null);
    if (!raw) continue;
    const name = raw.match(/^\s*name:\s*['"]?(.+?)['"]?\s*$/m)?.[1];
    const exe = raw.match(/^\s*exe:\s*['"]?(.+?)['"]?\s*$/m)?.[1];
    const id = raw.match(/^\s*id:\s*(\d+)/m)?.[1];
    const slug = raw.match(/^\s*slug:\s*(.+?)\s*$/m)?.[1];
    if (!name) continue;
    findings.push({
      name,
      platform: 'lutris',
      sourceId: id || slug || entry,
      installDir: exe ? path.dirname(exe) : null,
      executable: exe && existsSync(exe) ? exe : null,
      launchCommand: id ? `lutris:rungameid/${id}` : null,
      launchType: 'uri',
      extra: { runner: 'lutris' },
    });
  }
  return findings;
}

/* -------------------------------------------------------- carpetas del usuario */

/** Carpeta contenedora: cada subcarpeta con ejecutable se considera un juego. */
export async function scanCollection(root, options = {}) {
  const { maxGames = 300, withSize = false, deep = true } = options;
  const findings = [];
  let entries = [];
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch (err) {
    throw new Error(`No se puede leer la carpeta: ${err.message}`);
  }

  for (const entry of entries) {
    if (findings.length >= maxGames) break;
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = path.join(root, entry.name);
    const analysis = await analyzeFolder(dir, { withSize, maxDepth: deep ? 3 : 1 });
    const best = analysis.candidates[0];
    if (!best || best.score < 0.5) continue;
    findings.push({
      name: cleanGameName(entry.name),
      platform: 'manual',
      installDir: dir,
      executable: best.path,
      sizeBytes: analysis.sizeBytes,
      coverFile: analysis.cover,
      backgroundFile: analysis.background,
      iconFile: analysis.icon,
      confidence: best.score,
      extra: { detectedFrom: 'collection', root },
    });
  }

  /* ejecutables sueltos en la raiz */
  const loose = (await walk(root, { maxDepth: 1, maxEntries: 300 })).files
    .filter((f) => f.dir === root && isLaunchableFile(f.path, f.size, f.mode))
    .map((f) => ({ ...f, score: scoreExecutable(f.path, root) }))
    .filter((f) => f.score >= 2)
    .slice(0, 50);

  for (const file of loose) {
    if (findings.length >= maxGames) break;
    findings.push({
      name: cleanGameName(path.basename(file.path, extensionOf(file.path))),
      platform: 'manual',
      installDir: root,
      executable: file.path,
      sizeBytes: file.size,
      confidence: file.score,
      extra: { detectedFrom: 'root-executable', root },
    });
  }

  return findings;
}

/** Carpeta unica: se devuelven los candidatos ordenados para que el usuario elija. */
export async function scanSingleFolder(root, options = {}) {
  const analysis = await analyzeFolder(root, { withSize: options.withSize !== false, maxDepth: 4 });
  return {
    name: cleanGameName(path.basename(root)),
    installDir: root,
    coverFile: analysis.cover,
    backgroundFile: analysis.background,
    iconFile: analysis.icon,
    sizeBytes: analysis.sizeBytes,
    candidates: analysis.candidates.slice(0, 12).map((c) => ({
      path: c.path,
      name: path.basename(c.path),
      size: c.size,
      score: Math.round(c.score * 10) / 10,
    })),
  };
}

/** Carpetas de ROM: agrupa por consola segun extension. */
export async function scanRoms(root, options = {}) {
  const { maxGames = 800, recursive = false } = options;
  const { files, truncated } = await walk(root, {
    maxDepth: recursive ? 4 : 2,
    maxEntries: 8000,
    maxMs: 3000,
    skipDirs: new Set(['node_modules', '.git', '$recycle.bin', 'system volume information']),
    skipHints: [],
  });
  const grouped = new Map();
  for (const file of files) {
    const consoleDef = EXT_TO_CONSOLE.get(extensionOf(file.path));
    if (!consoleDef) continue;
    const key = consoleDef.id;
    if (!grouped.has(key)) grouped.set(key, { console: consoleDef, files: [] });
    grouped.get(key).files.push(file);
  }
  const findings = [];
  for (const { console: consoleDef, files: romFiles } of grouped.values()) {
    for (const file of romFiles) {
      if (findings.length >= maxGames) break;
      findings.push({
        name: cleanGameName(path.basename(file.path, extensionOf(file.path))),
        platform: 'emulator',
        console: consoleDef.id,
        consoleLabel: consoleDef.label,
        installDir: path.dirname(file.path),
        executable: null,
        romPath: file.path,
        sizeBytes: file.size,
        emulator: true,
        extra: { console: consoleDef.id, rom: file.path, detectedFrom: 'rom' },
      });
    }
  }
  return { findings, truncated, consoles: [...grouped.values()].map((g) => ({ id: g.console.id, label: g.console.label, count: g.files.length })) };
}

/* ------------------------------------------------------------- orquestacion */

export async function detectInstalled(sources, options = {}) {
  const results = { findings: [], errors: [], scanned: [] };
  const tasks = [];
  if (sources.steam !== false) tasks.push(['steam', detectSteam]);
  if (sources.epic !== false) tasks.push(['epic', detectEpic]);
  if (sources.gog !== false) tasks.push(['gog', detectGog]);
  if (sources.heroic !== false) tasks.push(['heroic', detectHeroic]);
  if (sources.lutris !== false) tasks.push(['lutris', detectLutris]);

  for (const [id, fn] of tasks) {
    const started = Date.now();
    try {
      const found = await fn();
      results.scanned.push({ source: id, found: found.length, ms: Date.now() - started });
      results.findings.push(...found);
    } catch (err) {
      results.errors.push({ source: id, message: err.message });
    }
  }

  for (const root of options.scanRoots || []) {
    const started = Date.now();
    try {
      if (root.kind === 'rom') {
        const { findings, consoles } = await scanRoms(root.path, { recursive: root.recursive });
        results.findings.push(...findings.map((f) => ({ ...f, rootId: root.id, emulatorProfileId: root.emulatorProfileId || null })));
        results.scanned.push({ source: `rom:${root.path}`, found: findings.length, ms: Date.now() - started, consoles });
      } else if (root.kind === 'collection') {
        const found = await scanCollection(root.path, { withSize: false, deep: root.deep !== false });
        results.findings.push(...found.map((f) => ({ ...f, rootId: root.id })));
        results.scanned.push({ source: `carpeta:${root.path}`, found: found.length, ms: Date.now() - started });
      }
    } catch (err) {
      results.errors.push({ source: root.path, message: err.message });
    }
  }
  return results;
}

export function cleanGameName(raw) {
  let name = String(raw || '')
    /* 1. extension del ejecutable */
    .replace(/\.(exe|app|appimage|sh|bat|cmd|lnk|x86_64|x86|run)$/i, '')
    /* 2. anotaciones tipicas de repacks: (2021), [FitGirl], {v2} */
    .replace(/[(\[{][^)\]}]*[)\]}]/g, ' ')
    /* 3. numeros de version, antes de tocar los separadores
       (se exige al menos un punto para no borrar titulos como "Sacred 2") */
    .replace(/(?<![a-z0-9])v?\d+(\.\d+){1,3}(?![0-9])/gi, ' ')
    /* 4. separadores -> espacios */
    .replace(/[._]+/g, ' ')
    /* 5. palabras tecnicas sueltas */
    .replace(/\b(win|win64|win32|x64|x86|shipping|final|release|repack|setup|installer|multi\d*|gog|steam|edition)\b/gi, ' ')
    /* 6. restos de version que quedaron separados por puntos */
    .replace(/\bv\d+(\s\d+){1,3}\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!name) name = String(raw || '').trim();
  if (name === name.toLowerCase() || name === name.toUpperCase()) name = titleCase(name);
  return name;
}

/** Busca caratula y fondo dentro de la carpeta de un juego ya agregado. */
export async function findLocalArt(installDir) {
  if (!installDir || !existsSync(installDir)) return {};
  const dirs = [
    installDir,
    path.join(installDir, 'bin'),
    path.join(installDir, 'Binaries', 'Win64'),
    path.join(installDir, 'data'),
    path.join(installDir, 'assets'),
  ];
  return {
    coverFile: await findFirstFile(dirs, COVER_CANDIDATES),
    backgroundFile: await findFirstFile(dirs, BACKGROUND_CANDIDATES),
    iconFile: await findFirstFile(dirs, ICON_CANDIDATES),
  };
}
