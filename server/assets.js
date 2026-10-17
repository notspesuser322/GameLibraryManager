/**
 * Resolución de rutas de la aplicación.
 *
 * El mismo código debe funcionar de tres formas distintas:
 *   1. Desde el repositorio:  node server/index.js
 *   2. Empaquetado en un ZIP: Nebula.exe con la interfaz en ./app
 *   3. Instalado en Windows:  C:\Program Files\Nébula\Nebula.exe con la interfaz en .\app
 *
 * Los datos del usuario nunca se escriben junto al programa instalado (en
 * Windows eso fallaría por permisos): si la app está empaquetada se guardan en
 * la carpeta de datos del usuario.
 */
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = path.resolve(HERE, '..');

export const APP_NAME = 'Nebula';

function flagValue(argv, name) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === name) return argv[i + 1] || null;
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1) || null;
  }
  return null;
}

/** Carpeta de datos del usuario, según el sistema. */
export function userDataDir({ env = process.env, platform = process.platform, homedir = os.homedir() } = {}) {
  if (platform === 'win32') {
    const base = env.APPDATA || path.join(homedir, 'AppData', 'Roaming');
    return path.join(base, APP_NAME);
  }
  if (platform === 'darwin') {
    return path.join(homedir, 'Library', 'Application Support', APP_NAME);
  }
  const base = env.XDG_DATA_HOME || path.join(homedir, '.local', 'share');
  return path.join(base, APP_NAME.toLowerCase());
}

/**
 * Localiza la carpeta de recursos (public/, docs/).
 * Devuelve también si la app está empaquetada y donde van los datos.
 */
export function resolveAssets({ argv = process.argv.slice(2), execPath = process.execPath, env = process.env } = {}) {
  const candidates = [];
  const fromFlag = flagValue(argv, '--assets');
  if (env.NEBULA_ASSETS) candidates.push(env.NEBULA_ASSETS);
  if (fromFlag) candidates.push(fromFlag);
  const exeDir = path.dirname(execPath);
  candidates.push(path.join(exeDir, 'app'));                 /* zip o instalación */
  candidates.push(path.join(exeDir, 'resources', 'app'));    /* empaquetado estilo electron */
  candidates.push(path.join(exeDir));                        /* ejecutable dentro de la carpeta de la app */
  candidates.push(SOURCE_ROOT);                              /* código fuente */
  candidates.push(process.cwd());

  for (const candidate of candidates) {
    if (!candidate) continue;
    const root = path.resolve(candidate);
    if (existsSync(path.join(root, 'public', 'index.html'))) {
      /* el marcador .packaged lo escriben los scripts de distribución */
      const marked = existsSync(path.join(root, '.packaged'));
      const packaged = marked || root !== SOURCE_ROOT || env.NEBULA_PACKAGED === '1';
      return {
        root,
        publicDir: path.join(root, 'public'),
        docsDir: path.join(root, 'docs'),
        packaged,
        execDir: exeDir,
      };
    }
  }
  return {
    root: SOURCE_ROOT,
    publicDir: path.join(SOURCE_ROOT, 'public'),
    docsDir: path.join(SOURCE_ROOT, 'docs'),
    packaged: false,
    execDir: exeDir,
  };
}

/** Carpeta de datos efectiva, teniendo en cuenta si está empaquetada. */
export function resolveDataDir({ assets, argv = process.argv.slice(2), env = process.env } = {}) {
  const fromFlag = flagValue(argv, '--data-dir');
  if (fromFlag) return path.resolve(fromFlag);
  if (env.NEBULA_DATA_DIR) return path.resolve(env.NEBULA_DATA_DIR);
  if (assets?.packaged) return userDataDir({ env });
  return path.join(assets?.root || SOURCE_ROOT, 'data');
}

export { SOURCE_ROOT };
