/**
 * Utilidades compartidas: rutas, cadenas, hashing, sistema de archivos y procesos.
 * Sin dependencias externas.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';

export const IS_WIN = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';
export const IS_LINUX = process.platform === 'linux';

/* ------------------------------------------------------------------ ids */

export function uid(prefix = '') {
  const raw = crypto.randomBytes(8).toString('hex');
  return prefix ? `${prefix}_${raw}` : raw;
}

export function hash(str) {
  return crypto.createHash('sha1').update(String(str)).digest('hex');
}

/** Color estable derivado de un texto (para caratulas generadas). */
export function colorFromText(text, sat = 55, light = 42) {
  const h = parseInt(hash(text).slice(0, 8), 16) % 360;
  const s = sat + (parseInt(hash(text).slice(8, 10), 16) % 18) - 9;
  const l = light + (parseInt(hash(text).slice(10, 12), 16) % 12) - 6;
  return { h, s: clamp(s, 20, 85), l: clamp(l, 25, 60) };
}

export function hsl({ h, s, l }, alpha = 1) {
  return alpha >= 1 ? `hsl(${h} ${s}% ${l}%)` : `hsl(${h} ${s}% ${l}% / ${alpha})`;
}

/* --------------------------------------------------------------- numbers */

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function round(n, decimals = 2) {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${round(bytes / 1024 ** i, i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(seconds, style = 'short') {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (style === 'clock') {
    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  if (style === 'long') {
    if (h > 0) return `${h} h ${m} min`;
    if (m > 0) return `${m} min`;
    return `${s} s`;
  }
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/* ---------------------------------------------------------------- fechas */

export function nowIso() {
  return new Date().toISOString();
}

export function dayKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function daysAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

/* --------------------------------------------------------------- cadenas */

export function normalize(str) {
  return String(str ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Comparacion natural: "Juego 2" antes que "Juego 10". */
export function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' });
}

export function titleCase(str) {
  return String(str ?? '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

export function truncate(str, max = 90) {
  const s = String(str ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/* --------------------------------------------------- archivos y carpetas */

export async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export function existsSync(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

/** Escritura atomica con reintentos (evita corromper la base si el proceso muere). */
export async function writeFileAtomic(file, contents) {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, contents, 'utf8');
  try {
    await fsp.rename(tmp, file);
  } catch (err) {
    if (err.code === 'EEXIST' || err.code === 'EPERM') {
      await fsp.rm(file, { force: true });
      await fsp.rename(tmp, file);
    } else {
      await fsp.rm(tmp, { force: true });
      throw err;
    }
  }
  return file;
}

export async function readJson(file, fallback = null) {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export const SKIP_DIRS = new Set([
  'node_modules', '.git', '$recycle.bin', 'system volume information', 'windows',
  'windowsapps', 'winsxs', 'driverstore', 'temp', 'tmp', '__pycache__', '.cache',
  'redist', 'redistributables', '_commonredist', 'directx', 'dotnet', 'support',
  'crashreports', 'crashdumps', 'shadercache', 'logs', 'binaries' /* se evalua aparte */,
]);

export const SKIP_DIR_HINTS = [
  '_commonredist', 'redist', 'directx', 'dotnet', 'vcredist', 'crashpad',
  'crashreport', 'savedata', 'savegames', 'screenshots', 'cache', 'shadercache',
  'easyanticheat', 'battleye', 'overlay', 'bgm', 'soundtrack', 'artbook'
];

/**
 * Recorre un arbol de carpetas con limites de profundidad y cantidad.
 * Devuelve entradas de archivo (sin seguir links simbolicos).
 */
export async function walk(root, options = {}) {
  const {
    maxDepth = 3,
    maxEntries = 6000,
    maxMs = 2500,
    skipDirs = SKIP_DIRS,
    skipHints = SKIP_DIR_HINTS,
    includeHidden = false,
  } = options;

  const started = Date.now();
  const results = [];
  const queue = [{ dir: root, depth: 0 }];
  let truncated = false;

  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (results.length >= maxEntries || Date.now() - started > maxMs) {
      truncated = true;
      break;
    }
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (results.length >= maxEntries) {
        truncated = true;
        break;
      }
      const name = entry.name;
      if (!includeHidden && (name.startsWith('.') || name.startsWith('$'))) continue;
      const full = path.join(dir, name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        const lower = name.toLowerCase();
        if (depth + 1 > maxDepth) continue;
        if (skipDirs.has(lower)) continue;
        if (skipHints.some((h) => lower.includes(h))) continue;
        queue.push({ dir: full, depth: depth + 1 });
      } else if (entry.isFile()) {
        let stat = null;
        try {
          stat = await fsp.stat(full);
        } catch {
          continue;
        }
        results.push({ path: full, name, dir, size: stat.size, mtime: stat.mtimeMs, mode: stat.mode });
      }
    }
  }
  return { files: results, truncated, elapsedMs: Date.now() - started };
}

export async function dirExistsNonEmpty(dir) {
  try {
    const entries = await fsp.readdir(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

export async function sizeOfDir(dir, maxEntries = 4000) {
  let total = 0;
  let seen = 0;
  const queue = [dir];
  while (queue.length && seen < maxEntries) {
    const cur = queue.shift();
    let entries = [];
    try {
      entries = await fsp.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      seen++;
      if (seen > maxEntries) break;
      const full = path.join(cur, e.name);
      try {
        if (e.isDirectory()) queue.push(full);
        else if (e.isFile()) total += (await fsp.stat(full)).size;
      } catch {
        /* ignorar */
      }
    }
  }
  return total;
}

/** Evita salir de la raiz permitida al usar rutas del cliente. */
export function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/* ------------------------------------------------------------ procesos */

export function execFileAsync(cmd, args = [], options = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000, windowsHide: true, ...options }, (error, stdout, stderr) => {
      resolve({ error, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

/** Lista de procesos en ejecucion: [{ pid, name, cmd }]. */
export async function listProcesses() {
  try {
    if (IS_WIN) {
      const { stdout } = await execFileAsync('tasklist', ['/FO', 'CSV', '/NH']);
      return stdout
        .split(/\r?\n/)
        .map((line) => line.match(/^"([^"]+)","(\d+)"/))
        .filter(Boolean)
        .map((m) => ({ name: m[1], pid: Number(m[2]), cmd: m[1] }));
    }
    const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,comm=,args=']);
    return stdout
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [pid, comm, ...rest] = line.split(/\s+/);
        return { pid: Number(pid), name: comm || '', cmd: rest.join(' ') };
      })
      .filter((p) => Number.isFinite(p.pid) && p.pid > 0);
  } catch {
    return [];
  }
}

export function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** Termina un proceso y su arbol de hijos. */
export async function killTree(pid, { force = false } = {}) {
  if (!pid) return false;
  if (IS_WIN) {
    const args = ['/PID', String(pid), '/T'];
    if (force) args.push('/F');
    const { error } = await execFileAsync('taskkill', args);
    return !error;
  }
  try {
    process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM');
    return true;
  } catch {
    try {
      process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
      return true;
    } catch {
      return false;
    }
  }
}

/** Abre una ruta en el explorador de archivos del sistema. */
export async function revealInFileManager(target) {
  if (IS_WIN) return execFileAsync('explorer', [target]);
  if (IS_MAC) return execFileAsync('open', ['-R', target]);
  return execFileAsync('xdg-open', [path.dirname(target)]);
}

/** Abre una URL en el navegador predeterminado. */
export async function openExternal(url) {
  if (IS_WIN) return execFileAsync('cmd', ['/c', 'start', '', url], { shell: false });
  if (IS_MAC) return execFileAsync('open', [url]);
  return execFileAsync('xdg-open', [url]);
}

/** Ejecuta un comando del sistema en segundo plano y devuelve el hijo. */
export function spawnDetached(command, args, options = {}) {
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    ...options,
  });
  child.unref();
  return child;
}

/* --------------------------------------------------- rutas del sistema */

export function homePath(...parts) {
  return path.join(os.homedir(), ...parts);
}

export function uniqueBy(list, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
