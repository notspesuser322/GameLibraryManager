/**
 * Arte de la biblioteca: caratulas y fondos.
 * Prioridad: archivo local del juego > imagen descargada > caratula generada (SVG).
 * Las caratulas generadas garantizan que todos los juegos tengan portada,
 * incluso los agregados a mano o sin conexion a internet.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { colorFromText, exists, hash, normalize, titleCase, ensureDir } from './util.js';
import { PLATFORMS } from './store.js';
import { cabecerasImagen, pareceImagen, extensionDeImagen } from './http.js';

export const MIME = {
  /* imagenes */
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  /* interfaz */
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
};

/** Extensiones cuyo contenido es texto y conviene anunciar en UTF-8. */
const TEXT_TYPES = new Set(['text/html', 'text/css', 'text/javascript', 'application/json', 'image/svg+xml', 'text/plain', 'application/manifest+json']);

export function contentTypeFor(file) {
  const type = mimeFor(file);
  return TEXT_TYPES.has(type) ? `${type}; charset=utf-8` : type;
}

export function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function xmlEscape(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Parte un titulo en lineas de longitud maxima aproximada. */
function wrapTitle(name, maxChars = 16, maxLines = 4) {
  const words = String(name).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else if (candidate.length > maxChars * 1.6 && !current) {
      lines.push(candidate.slice(0, maxChars));
      current = candidate.slice(maxChars);
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, maxChars - 1)}…`;
    return kept;
  }
  return lines;
}

function initialsOf(name) {
  const words = String(name).split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function patternFor(seed, color) {
  const variant = parseInt(hash(seed).slice(0, 2), 16) % 4;
  const { h, s, l } = color;
  const stroke = `hsl(${h} ${s}% ${Math.min(92, l + 38)}%)`;
  if (variant === 0) {
    const circles = [];
    for (let i = 0; i < 5; i++) {
      circles.push(
        `<circle cx="${120 + i * 90}" cy="${100 + (i % 3) * 190}" r="${70 + i * 22}" fill="none" stroke="${stroke}" stroke-opacity="0.14" stroke-width="2"/>`
      );
    }
    return circles.join('');
  }
  if (variant === 1) {
    const lines = [];
    for (let i = 0; i < 9; i++) {
      lines.push(
        `<line x1="${-200 + i * 110}" y1="900" x2="${100 + i * 110}" y2="-100" stroke="${stroke}" stroke-opacity="0.12" stroke-width="3"/>`
      );
    }
    return lines.join('');
  }
  if (variant === 2) {
    const rects = [];
    for (let i = 0; i < 12; i++) {
      const size = 24 + ((i * 37) % 60);
      rects.push(
        `<rect x="${40 + ((i * 131) % 520)}" y="${40 + ((i * 197) % 780)}" width="${size}" height="${size}" rx="${size / 4}" fill="${stroke}" fill-opacity="0.1" transform="rotate(${(i * 23) % 60} 300 400)"/>`
      );
    }
    return rects.join('');
  }
  const dots = [];
  for (let i = 0; i < 18; i++) {
    dots.push(
      `<circle cx="${30 + ((i * 97) % 540)}" cy="${60 + ((i * 163) % 780)}" r="${2 + ((i * 7) % 5)}" fill="${stroke}" fill-opacity="0.22"/>`
    );
  }
  return dots.join('');
}

/** Caratula vertical 600x900 generada. */
export function coverSvg(game) {
  const name = game.name || 'Sin titulo';
  const color = colorFromText(name);
  const secondary = colorFromText(`${name}#2`);
  const lines = wrapTitle(name, 15, 4);
  const lineHeight = 56;
  const startY = 520 - ((lines.length - 1) * lineHeight) / 2;
  const platform = PLATFORMS[game.platform] || PLATFORMS.manual;
  const subtitle = [platform.label, (game.genres || [])[0]].filter(Boolean).join(' · ');
  const year = game.releaseDate ? String(game.releaseDate).slice(0, 4) : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900" role="img" aria-label="${xmlEscape(name)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${color.h} ${color.s}% ${Math.min(60, color.l + 14)}%)"/>
      <stop offset="55%" stop-color="hsl(${color.h} ${color.s}% ${color.l}%)"/>
      <stop offset="100%" stop-color="hsl(${secondary.h} ${secondary.s}% ${Math.max(12, color.l - 24)}%)"/>
    </linearGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.62"/>
    </linearGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="16"/></filter>
  </defs>
  <rect width="600" height="900" fill="url(#bg)"/>
  <g>${patternFor(name, color)}</g>
  <circle cx="470" cy="180" r="150" fill="hsl(${secondary.h} ${secondary.s}% ${Math.min(80, secondary.l + 30)}%)" opacity="0.18" filter="url(#soft)"/>
  <rect width="600" height="900" fill="url(#fade)"/>
  <text x="52" y="112" font-family="'Segoe UI', Inter, Roboto, system-ui, sans-serif" font-size="112" font-weight="800" fill="#ffffff" fill-opacity="0.16" letter-spacing="-2">${xmlEscape(initialsOf(name))}</text>
  <g font-family="'Segoe UI', Inter, Roboto, system-ui, sans-serif">
    ${lines
      .map(
        (line, i) =>
          `<text x="52" y="${startY + i * lineHeight}" font-size="46" font-weight="700" fill="#ffffff" letter-spacing="-0.5">${xmlEscape(line)}</text>`
      )
      .join('\n    ')}
    <text x="52" y="${startY + lines.length * lineHeight + 34}" font-size="22" font-weight="500" fill="#ffffff" fill-opacity="0.72">${xmlEscape(subtitle)}${year ? ` · ${year}` : ''}</text>
  </g>
  <rect x="52" y="812" width="${Math.max(38, 12 + platform.label.length * 10.5)}" height="34" rx="17" fill="#ffffff" fill-opacity="0.16"/>
  <text x="${52 + Math.max(38, 12 + platform.label.length * 10.5) / 2}" y="835" text-anchor="middle" font-family="'Segoe UI', Inter, Roboto, system-ui, sans-serif" font-size="16" font-weight="600" fill="#ffffff" fill-opacity="0.9">${xmlEscape(platform.label)}</text>
  ${game.favorite ? '<path d="M520 812l14 28 31 5-22 22 5 31-28-15-28 15 5-31-22-22 31-5z" fill="#ffd166"/>' : ''}
</svg>`;
}

/** Fondo horizontal 1600x520 generado. */
export function bannerSvg(game) {
  const name = game.name || 'Sin titulo';
  const color = colorFromText(name, 48, 34);
  const secondary = colorFromText(`${name}#3`, 60, 26);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="520" viewBox="0 0 1600 520" role="img" aria-label="${xmlEscape(name)}">
  <defs>
    <linearGradient id="b" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${secondary.h} ${secondary.s}% ${Math.max(10, secondary.l - 6)}%)"/>
      <stop offset="60%" stop-color="hsl(${color.h} ${color.s}% ${color.l}%)"/>
      <stop offset="100%" stop-color="hsl(${color.h} ${color.s}% ${Math.min(62, color.l + 20)}%)"/>
    </linearGradient>
    <linearGradient id="f" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="#000" stop-opacity="0.55"/>
      <stop offset="70%" stop-color="#000" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="520" fill="url(#b)"/>
  <g transform="translate(0,-40)">${patternFor(`${name}banner`, color)}</g>
  <rect width="1600" height="520" fill="url(#f)"/>
  <text x="70" y="330" font-family="'Segoe UI', Inter, Roboto, system-ui, sans-serif" font-size="76" font-weight="800" fill="#ffffff" letter-spacing="-1">${xmlEscape(name.slice(0, 34))}</text>
  <text x="72" y="382" font-family="'Segoe UI', Inter, Roboto, system-ui, sans-serif" font-size="24" fill="#ffffff" fill-opacity="0.7">${xmlEscape(PLATFORMS[game.platform]?.label || 'Manual')}</text>
</svg>`;
}

export class MediaStore {
  constructor(dir) {
    this.dir = dir;
    this.covers = path.join(dir, 'covers');
    this.banners = path.join(dir, 'banners');
    this.icons = path.join(dir, 'icons');
    this.downloads = path.join(dir, 'downloads');
    this.pending = new Map();
  }

  async init() {
    await Promise.all([
      ensureDir(this.covers),
      ensureDir(this.banners),
      ensureDir(this.icons),
      ensureDir(this.downloads),
    ]);
  }

  /* ------------------------------------------------------------- generados */

  async generatedCover(game) {
    const file = path.join(this.covers, `${game.id}.svg`);
    if (!(await exists(file))) {
      await fsp.writeFile(file, coverSvg(game), 'utf8');
    }
    return file;
  }

  async generatedBanner(game) {
    const file = path.join(this.banners, `${game.id}.svg`);
    if (!(await exists(file))) {
      await fsp.writeFile(file, bannerSvg(game), 'utf8');
    }
    return file;
  }

  /* --------------------------------------------------------- descarga remota */

  /**
   * Descarga una imagen a la cache local. Devuelve la ruta o null.
   * Se usa para traer caratulas oficiales desde los CDN de las tiendas
   * (una sola vez) y que la biblioteca funcione sin conexion.
   */
  /**
   * Descarga una imagen y la guarda como carátula o fondo del juego.
   * @returns {Promise<string|null>} ruta del archivo guardado
   */
  async download(gameId, url, kind = 'cover', { referer = null, timeout = 15000 } = {}) {
    if (!url || !/^https?:\/\//i.test(url)) return null;
    const folder = kind === 'banner' ? this.banners : this.covers;
    const key = `${gameId}:${kind}:${url}`;
    const cached = this.pending.get(key);
    if (cached) return cached;

    const task = (async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        const res = await fetch(url, {
          signal: controller.signal,
          redirect: 'follow',
          headers: cabecerasImagen({ referer }),
        });
        clearTimeout(timer);
        if (!res.ok) {
          this.ultimoError = `la fuente respondió ${res.status}`;
          return null;
        }
        const tipo = (res.headers.get('content-type') || '').split(';')[0].trim();
        const buffer = Buffer.from(await res.arrayBuffer());
        /* primero se mira el contenido: algunos servicios devuelven una página de
           error con código 200 y el aviso debe decir eso, no «está vacía» */
        if (!pareceImagen(buffer)) {
          this.ultimoError = 'lo que devolvió la fuente no es una imagen';
          return null;
        }
        if (buffer.length < 512) {
          this.ultimoError = 'la imagen llegó vacía o es demasiado pequeña';
          return null;
        }
        if (buffer.length > 15 * 1024 * 1024) {
          this.ultimoError = 'la imagen es demasiado grande (más de 15 MB)';
          return null;
        }
        void tipo;
        const ext = extensionDeImagen(buffer, tipo);
        const file = path.join(folder, `${gameId}${kind === 'banner' ? '-bg' : ''}${ext}`);
        await fsp.writeFile(file, buffer);
        this.ultimoError = null;
        return file;
      } catch (err) {
        this.ultimoError = err.name === 'AbortError' ? 'la descarga tardó demasiado' : `no se pudo conectar (${err.message})`;
        return null;
      } finally {
        this.pending.delete(key);
      }
    })();

    this.pending.set(key, task);
    return task;
  }

  /**
   * Prueba varias direcciones en orden hasta que una funcione.
   * @param {string} gameId
   * @param {Array<{url: string, referer?: string}>} opciones
   * @param {'cover'|'banner'} kind
   * @returns {Promise<{file: string|null, url: string|null, error: string|null, intentos: number}>}
   */
  async downloadBest(gameId, opciones = [], kind = 'cover') {
    const lista = opciones.filter((o) => o && o.url).slice(0, 6);
    const fallos = [];
    for (const opcion of lista) {
      const file = await this.download(gameId, opcion.url, kind, { referer: opcion.referer });
      if (file) return { file, url: opcion.url, error: null, intentos: fallos.length + 1 };
      const motivo = this.ultimoError || 'sin respuesta';
      fallos.push(`${new URL(opcion.url).host}: ${motivo}`);
    }
    return {
      file: null,
      url: lista[0]?.url || null,
      error: lista.length ? fallos.join(' · ') : 'la ficha no traía ninguna imagen',
      intentos: lista.length,
    };
  }

  /* ------------------------------------------------------------- resolucion */

  /**
   * Devuelve el archivo de imagen a servir para un juego y tipo.
   * @param {'cover'|'banner'} kind
   */
  async resolve(game, kind = 'cover', { download = true } = {}) {
    const localField = kind === 'banner' ? game.backgroundFile : game.coverFile;
    if (localField && (await exists(localField))) return localField;

    const remoteUrl = kind === 'banner' ? game.backgroundUrl : game.coverUrl;
    if (remoteUrl && download) {
      const downloaded = await this.download(game.id, remoteUrl, kind);
      if (downloaded) return downloaded;
    }

    /* archivos propios guardados en la carpeta de medios */
    const own = kind === 'banner' ? path.join(this.banners, game.id) : path.join(this.covers, game.id);
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']) {
      if (await exists(own + ext)) return own + ext;
    }
    const uploaded = await this.#findUploaded(game.id, kind);
    if (uploaded) return uploaded;

    return kind === 'banner' ? this.generatedBanner(game) : this.generatedCover(game);
  }

  async #findUploaded(gameId, kind) {
    const folder = kind === 'banner' ? this.banners : this.covers;
    const prefix = kind === 'banner' ? `${gameId}-bg` : gameId;
    let entries = [];
    try {
      entries = await fsp.readdir(folder);
    } catch {
      return null;
    }
    const match = entries.find((f) => path.parse(f).name === prefix && path.extname(f) !== '.svg');
    return match ? path.join(folder, match) : null;
  }

  /** Guarda un archivo subido por el usuario (base64). */
  async saveUpload(gameId, kind, { data, ext }) {
    const folder = kind === 'banner' ? this.banners : this.covers;
    const name = kind === 'banner' ? `${gameId}-bg${ext}` : `${gameId}${ext}`;
    const file = path.join(folder, name);
    await fsp.writeFile(file, Buffer.from(data, 'base64'));
    return file;
  }

  async removeUploaded(gameId, kind) {
    const folder = kind === 'banner' ? this.banners : this.covers;
    const prefix = kind === 'banner' ? `${gameId}-bg` : gameId;
    let entries = [];
    try {
      entries = await fsp.readdir(folder);
    } catch {
      return;
    }
    for (const entry of entries) {
      const parsed = path.parse(entry);
      if (parsed.name === prefix && parsed.ext !== '.svg') {
        await fsp.rm(path.join(folder, entry), { force: true });
      }
    }
  }

  /** Texto corto para etiquetar la caratula generada (utilidad de depuracion). */
  static labelFor(name) {
    return titleCase(normalize(name));
  }
}
