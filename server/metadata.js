/**
 * Metadatos automáticos para la biblioteca.
 *
 * Muchos juegos no existen en ninguna tienda (Minecraft lanzado con HMCL, juegos
 * de itch.io, emulados, aplicaciones, betas…) y por eso no hay ficha que traer.
 * Para esos casos se consultan fuentes abiertas y sin clave de API:
 *
 *   - Wikipedia   → descripción, imagen principal, enlace al artículo.
 *   - Wikidata    → desarrollador, editorial, fecha, géneros, plataformas, imagen.
 *   - Steam       → búsqueda + ficha de la tienda (arte oficial en alta resolución).
 *   - RAWG        → opcional, solo si el usuario pega su clave.
 *
 * Todo es opcional y desactivable. Si no hay internet, la biblioteca sigue
 * funcionando con las carátulas generadas y los datos locales.
 *
 * Nota de diseño: no se hace scraping de Google. Su API no es gratuita, prohíbe
 * el uso automatizado en sus términos y devuelve resultados ambiguos para
 * nombres de juegos. Wikipedia/Wikidata son abiertas, multilingües, tienen API
 * documentada y cubren exactamente el caso de juegos que no están en tiendas.
 */
import { normalize, truncate } from './util.js';

const DEFAULT_TIMEOUT = 9000;
const MIN_INTERVAL_MS = 300; /* cortesía entre peticiones al mismo servicio */
const CACHE_TTL_MS = 10 * 60 * 1000;

/* ------------------------------------------------------------------ utilidades */

export function stripHtml(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Similitud 0..1 entre lo que se buscó y el título encontrado. */
export function similarity(query, title) {
  const a = normalize(query);
  const b = normalize(title);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.startsWith(a) || a.startsWith(b)) return 0.92;
  if (b.includes(a) || a.includes(b)) return 0.85;

  const tokensA = new Set(a.split(' ').filter((t) => t.length > 1));
  const tokensB = new Set(b.split(' ').filter((t) => t.length > 1));
  if (!tokensA.size || !tokensB.size) return 0;
  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared++;
  const union = new Set([...tokensA, ...tokensB]).size;
  const jaccard = shared / union;
  /* "Minecraft", "Minecraft: Java Edition" y "Minecraft Launcher" comparten tokens */
  const coverage = shared / tokensA.size;
  return Math.max(jaccard, coverage * 0.8);
}

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  ene: '01', abr: '04', ago: '08', dic: '12',
};

function cleanDate(value) {
  const text = String(value ?? '');
  /* ISO: 2011-11-18 */
  const iso = text.match(/(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3] || '01'}`;
  /* Steam y otros: "13 Oct, 2015" o "Oct 13, 2015" */
  const dayFirst = text.match(/(\d{1,2})\s+([A-Za-zÁÉÍÓÚáéíóú]{3,})\.?,?\s+(\d{4})/);
  const monthFirst = text.match(/([A-Za-zÁÉÍÓÚáéíóú]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  const monthOf = (word) => MONTHS[normalize(word).slice(0, 3)] || null;
  if (dayFirst) {
    const month = monthOf(dayFirst[2]);
    if (month) return `${dayFirst[3]}-${month}-${String(dayFirst[1]).padStart(2, '0')}`;
  }
  if (monthFirst) {
    const month = monthOf(monthFirst[1]);
    if (month) return `${monthFirst[3]}-${month}-${String(monthFirst[2]).padStart(2, '0')}`;
  }
  const year = text.match(/(19|20)\d{2}/);
  return year ? `${year[0]}-01-01` : null;
}

function uniqueStrings(list) {
  const seen = new Set();
  const out = [];
  for (const item of (list || []).flat()) {
    const value = String(item ?? '').trim();
    if (!value) continue;
    const key = normalize(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Convierte nombres de archivo de Commons en URLs de imagen. */
export function commonsUrl(fileName, width = 1200) {
  const name = String(fileName || '').replace(/^File:/i, '').trim();
  if (!name) return null;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=${width}`;
}

/* --------------------------------------------------------------- parseadores */

/** Convierte la respuesta de la tienda de Steam en una ficha normalizada. */
export function parseSteamAppDetails(appId, data) {
  if (!data || typeof data !== 'object') return null;
  const image = (name) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/${name}`;
  return {
    source: 'steam',
    id: String(appId),
    title: data.name || '',
    description: stripHtml(data.short_description || data.detailed_description || ''),
    longDescription: truncate(stripHtml(data.detailed_description || ''), 1200),
    developers: uniqueStrings(data.developers || []),
    publishers: uniqueStrings(data.publishers || []),
    genres: uniqueStrings((data.genres || []).map((g) => g?.description)),
    releaseDate: data.release_date?.date ? cleanDate(data.release_date.date) : null,
    criticScore: Number(data.metacritic?.score) || 0,
    website: data.website || null,
    url: `https://store.steampowered.com/app/${appId}`,
    coverUrl: image('library_600x900.jpg'),
    bannerUrl: data.header_image || image('header.jpg'),
    screenshots: (data.screenshots || []).map((s) => s?.path_full).filter(Boolean).slice(0, 6),
    extra: { appId: String(appId), categories: uniqueStrings((data.categories || []).map((c) => c?.description)) },
  };
}

/** Normaliza un resumen de la API REST de Wikipedia. */
export function parseWikipediaSummary(lang, payload) {
  if (!payload || payload.type === 'disambiguation' || !payload.extract) return null;
  return {
    source: 'wikipedia',
    id: payload.wikibase_item || payload.pageid || payload.title,
    title: payload.title || '',
    description: truncate(String(payload.extract || '').replace(/\s+/g, ' '), 700),
    longDescription: truncate(String(payload.extract || '').replace(/\s+/g, ' '), 1600),
    developers: [],
    publishers: [],
    genres: [],
    releaseDate: null,
    criticScore: 0,
    website: payload.content_urls?.desktop?.page || null,
    url: payload.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(payload.title || '')}`,
    coverUrl: payload.originalimage?.source || payload.thumbnail?.source || null,
    bannerUrl: payload.originalimage?.source || null,
    screenshots: [],
    extra: { wikipedia: true, lang, shortDescription: payload.description || '', wikidataId: payload.wikibase_item || null },
  };
}

const VIDEOGAME_HINTS = ['videojuego', 'video game', 'juego de', 'juego electrónico', 'joc de', 'videogame', 'juego de rol', 'juego de acción', 'juego de estrategia', 'sandbox', 'moba', 'videojuegos'];

/** ¿El texto parece describir un videojuego? */
export function looksLikeVideoGame(...texts) {
  const haystack = normalize(texts.filter(Boolean).join(' '));
  return VIDEOGAME_HINTS.some((hint) => haystack.includes(normalize(hint)));
}

/** Convierte una entidad de Wikidata en datos estructurados. */
export function parseWikidataEntity(entity, { labels = new Map(), nameById = new Map() } = {}) {
  if (!entity) return null;
  const claimValues = (property) => (entity.claims?.[property] || []).map((claim) => {
    const value = claim?.mainsnak?.datavalue?.value;
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (value.id) return value.id;
    if (value.time) return value.time;
    return null;
  }).filter(Boolean);

  const resolve = (id) => nameById.get(id) || labels.get(id) || null;
  const dates = claimValues('P577').map((time) => cleanDate(time)).filter(Boolean).sort();

  return {
    developers: uniqueStrings(claimValues('P178').map(resolve)),
    publishers: uniqueStrings([...claimValues('P123'), ...claimValues('P162')].map(resolve)),
    genres: uniqueStrings(claimValues('P136').map(resolve)),
    platforms: uniqueStrings(claimValues('P400').map(resolve)),
    releaseDate: dates[0] || null,
    coverUrl: commonsUrl(claimValues('P18')[0] || ''),
    website: claimValues('P856')[0] || null,
    description: entity.descriptions?.es?.value || entity.descriptions?.en?.value || '',
    aliases: (entity.aliases?.es || []).map((a) => a.value),
  };
}

/* --------------------------------------------------------------- servicio */

export class MetadataService {
  /**
   * @param {object} options
   * @param {Function} [options.fetchImpl] fetch inyectable (pruebas)
   * @param {object}   [options.settings] proveedor de ajustes (función o servicio)
   */
  constructor({ fetchImpl = globalThis.fetch, getSettings = () => ({}), log = () => {} } = {}) {
    this.fetch = fetchImpl;
    this.getSettings = getSettings;
    this.log = log;
    this.cache = new Map();
    this.lastCall = new Map();
    this.online = null;
    this.onlineCheckedAt = 0;
  }

  get config() {
    const metadata = this.getSettings()?.metadata || {};
    return {
      enabled: metadata.enabled !== false,
      language: metadata.language || 'es',
      providers: { steam: true, wikipedia: true, wikidata: true, rawg: false, ...(metadata.providers || {}) },
      rawgKey: metadata.rawgKey || '',
      minScore: typeof metadata.minScore === 'number' ? metadata.minScore : 0.5,
    };
  }

  /** Espera lo mínimo entre llamadas al mismo servicio. */
  async #throttle(host) {
    const now = Date.now();
    const last = this.lastCall.get(host) || 0;
    const wait = MIN_INTERVAL_MS - (now - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCall.set(host, Date.now());
  }

  async #fetchJson(url, { headers = {}, timeout = DEFAULT_TIMEOUT, host } = {}) {
    const key = `json:${url}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
    await this.#throttle(host || new URL(url).host);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await this.fetch(url, {
        signal: controller.signal,
        headers: {
          'user-agent': 'Ludoteca/1.0 (gestor de biblioteca local)',
          accept: 'application/json',
          ...headers,
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const value = await response.json();
      this.cache.set(key, { at: Date.now(), value });
      this.online = true;
      this.onlineCheckedAt = Date.now();
      return value;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('La consulta tardó demasiado (sin conexión o servicio lento)');
      this.online = false;
      this.onlineCheckedAt = Date.now();
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ------------------------------------------------------------ proveedores */

  /** Búsqueda en el buscador público de Steam + ficha de la tienda. */
  async steamCandidates(query, { language, limit = 6 } = {}) {
    const searchUrl = `https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(query)}`;
    const results = await this.#fetchJson(searchUrl, { host: 'steamcommunity.com' });
    if (!Array.isArray(results)) return [];
    const picked = results.slice(0, limit);
    const langParam = language === 'es' ? 'spanish' : language === 'en' ? 'english' : 'english';
    const candidates = [];
    for (const item of picked) {
      if (!item?.appid) continue;
      const appId = String(item.appid);
      const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=${langParam}&cc=us`;
      let details = null;
      try {
        const payload = await this.#fetchJson(url, { host: 'store.steampowered.com' });
        details = payload?.[appId]?.success ? payload[appId].data : null;
      } catch {
        /* si la ficha falla se usa lo que dio el buscador */
      }
      const candidate = parseSteamAppDetails(appId, details) || {
        source: 'steam',
        id: appId,
        title: item.name || '',
        description: '',
        coverUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
        bannerUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
        url: `https://store.steampowered.com/app/${appId}`,
        developers: [], publishers: [], genres: [], screenshots: [], extra: { appId },
      };
      candidate.extra = { ...(candidate.extra || {}), searchIcon: item.icon || null };
      candidates.push(candidate);
      if (candidates.length >= 4) break;
    }
    return candidates;
  }

  /** Búsqueda en Wikipedia (multilingüe) con enriquecido desde Wikidata. */
  async wikipediaCandidates(query, { language = 'es', limit = 6 } = {}) {
    const searchUrl = `https://${language}.wikipedia.org/w/api.php?action=query&format=json&list=search&srlimit=${limit}&origin=*&srsearch=${encodeURIComponent(query)}`;
    let search;
    try {
      search = await this.#fetchJson(searchUrl, { host: `${language}.wikipedia.org` });
    } catch (err) {
      /* si el idioma configurado falla se intenta en inglés; si tampoco, se informa */
      if (language === 'en') throw err;
      this.log(`Wikipedia (${language}) falló, se intenta en inglés`);
      return this.wikipediaCandidates(query, { language: 'en', limit });
    }
    const hits = search.query?.search || [];
    const candidates = [];
    for (const hit of hits.slice(0, limit)) {
      if (!hit?.title) continue;
      const summaryUrl = `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`;
      let summary;
      try {
        summary = await this.#fetchJson(summaryUrl, { host: `${language}.wikipedia.org` });
      } catch {
        continue;
      }
      const candidate = parseWikipediaSummary(language, summary);
      if (!candidate) continue;
      const isGame = looksLikeVideoGame(candidate.extra.shortDescription, candidate.description, hit.snippet);
      if (!isGame) {
        /* se marca para que la interfaz lo muestre aparte y no puntúe alto */
        candidate.extra.dubious = true;
      }
      candidates.push(candidate);
      if (candidates.length >= 4) break;
    }
    return candidates;
  }

  /** Completa una ficha de Wikipedia con los datos estructurados de Wikidata. */
  async enrichWithWikidata(candidate, { language = 'es' } = {}) {
    const id = candidate?.extra?.wikidataId;
    if (!id) return candidate;
    const url = `https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(id)}.json`;
    let payload;
    try {
      payload = await this.#fetchJson(url, { host: 'www.wikidata.org' });
    } catch (err) {
      /* el enriquecido es opcional: se registra y se sigue con lo que haya */
      this.enrichErrors = this.enrichErrors || [];
      this.enrichErrors.push({ id, message: err.message });
      return candidate;
    }
    const entity = payload?.entities?.[id];
    if (!entity) return candidate;

    /* etiquetas de los identificadores (desarrollador, género, plataforma…) */
    const ids = new Set();
    for (const property of ['P178', 'P123', 'P162', 'P136', 'P400']) {
      for (const claim of entity.claims?.[property] || []) {
        const value = claim?.mainsnak?.datavalue?.value?.id;
        if (value) ids.add(value);
      }
    }
    const nameById = await this.wikidataLabels([...ids], { language });
    const structured = parseWikidataEntity(entity, { nameById });
    if (!structured) return candidate;

    return {
      ...candidate,
      developers: structured.developers.length ? structured.developers : candidate.developers,
      publishers: structured.publishers.length ? structured.publishers : candidate.publishers,
      genres: structured.genres.length ? structured.genres : candidate.genres,
      releaseDate: structured.releaseDate || candidate.releaseDate,
      website: candidate.website || structured.website,
      coverUrl: candidate.coverUrl || structured.coverUrl,
      bannerUrl: candidate.bannerUrl || structured.coverUrl,
      extra: {
        ...(candidate.extra || {}),
        platforms: structured.platforms,
        aliases: structured.aliases,
        wikidataDescription: structured.description,
      },
    };
  }

  /** Nombres legibles para un conjunto de identificadores de Wikidata. */
  async wikidataLabels(ids, { language = 'es' } = {}) {
    const wanted = ids.filter(Boolean).slice(0, 60);
    const map = new Map();
    if (!wanted.length) return map;
    const languages = uniqueStrings([language, 'en']).join('|');
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=${languages}&ids=${wanted.join('|')}`;
    try {
      const payload = await this.#fetchJson(url, { host: 'www.wikidata.org' });
      for (const [id, entity] of Object.entries(payload?.entities || {})) {
        const label = entity.labels?.[language]?.value || entity.labels?.en?.value;
        if (label) map.set(id, label);
      }
    } catch {
      /* sin etiquetas: se usan los identificadores */
    }
    return map;
  }

  /** RAWG (opcional, requiere clave propia). */
  async rawgCandidates(query, { key, language = 'es', limit = 6 } = {}) {
    if (!key) return [];
    const url = `https://api.rawg.io/api/games?key=${encodeURIComponent(key)}&search=${encodeURIComponent(query)}&page_size=${limit}`;
    const payload = await this.#fetchJson(url, { host: 'api.rawg.io' });
    return (payload?.results || []).slice(0, 4).map((game) => ({
      source: 'rawg',
      id: String(game.id),
      title: game.name || '',
      description: '',
      longDescription: '',
      developers: [],
      publishers: [],
      genres: uniqueStrings((game.genres || []).map((g) => g?.name)),
      releaseDate: game.released || null,
      criticScore: Math.round(Number(game.metacritic) || 0),
      rating: Number(game.rating) || 0,
      website: game.website || null,
      url: `https://rawg.io/games/${game.slug || game.id}`,
      coverUrl: game.background_image || null,
      bannerUrl: game.background_image_additional || game.background_image || null,
      screenshots: [],
      extra: { rawg: true, slug: game.slug || null },
    }));
  }

  /* -------------------------------------------------------------- búsqueda */

  /**
   * Busca fichas para un nombre de juego en todas las fuentes activas.
   * Devuelve candidatos ordenados por similitud, con la fuente indicada.
   */
  async search(query, { language, providers, limit = 12 } = {}) {
    const config = this.config;
    if (!config.enabled) throw new Error('La búsqueda de metadatos está desactivada en Ajustes');
    const text = String(query || '').trim();
    if (text.length < 2) return { candidates: [], errors: [] };

    const active = providers || config.providers;
    const lang = language || config.language;
    const errors = [];
    const collected = [];

    const tasks = [];
    if (active.steam) tasks.push(['steam', () => this.steamCandidates(text, { language: lang })]);
    if (active.wikipedia) tasks.push(['wikipedia', () => this.wikipediaCandidates(text, { language: lang })]);
    if (active.rawg && config.rawgKey) tasks.push(['rawg', () => this.rawgCandidates(text, { key: config.rawgKey, language: lang })]);

    const settled = await Promise.all(tasks.map(async ([name, run]) => {
      try {
        return { name, items: await run() };
      } catch (err) {
        errors.push({ provider: name, message: err.message });
        return { name, items: [] };
      }
    }));

    for (const { name, items } of settled) {
      let list = items;
      if (name === 'wikipedia' && active.wikidata !== false) {
        list = await Promise.all(items.slice(0, 3).map((candidate) => this.enrichWithWikidata(candidate, { language: lang })));
      }
      collected.push(...list);
    }

    /* La similitud del título pesa el 90 %: los extras (descripción, imágenes,
       desarrollador) afinan el orden pero nunca adelantan a un título exacto. */
    const scored = collected.map((candidate) => {
      const base = similarity(text, candidate.title);
      let score = base * 0.9;
      if (candidate.description) score += 0.03;
      if (candidate.developers?.length) score += 0.02;
      if (candidate.coverUrl) score += 0.02;
      if (candidate.source === 'steam') score += 0.01;
      if (candidate.extra?.dubious) score *= 0.45;
      return { ...candidate, score: Math.min(1, Math.round(score * 1000) / 1000) };
    });

    scored.sort((a, b) => b.score - a.score || (a.title || '').localeCompare(b.title || '', 'es'));

    /* se conserva el mejor resultado por título normalizado */
    const seen = new Set();
    const candidates = [];
    for (const candidate of scored) {
      const key = normalize(candidate.title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
      if (candidates.length >= limit) break;
    }

    return {
      candidates,
      errors,
      query: text,
      online: this.online,
      providers: settled.filter((s) => s.items.length || !errors.some((e) => e.provider === s.name)).map((s) => s.name),
    };
  }

  /** Mejor candidato por encima del umbral configurado. */
  async bestMatch(query, options = {}) {
    const { candidates } = await this.search(query, options);
    const min = options.minScore ?? this.config.minScore;
    return candidates.find((candidate) => candidate.score >= min) || null;
  }

  /** Comprobación rápida de conectividad para la pantalla de ajustes. */
  async probeProviders() {
    const config = this.config;
    const results = [];
    const lang = config.language;
    const check = async (id, label, run) => {
      const started = Date.now();
      try {
        await run();
        results.push({ id, label, ok: true, ms: Date.now() - started });
      } catch (err) {
        results.push({ id, label, ok: false, ms: Date.now() - started, message: err.message });
      }
    };

    if (config.providers.wikipedia) {
      await check('wikipedia', 'Wikipedia', () => this.#fetchJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/Minecraft`, { host: `${lang}.wikipedia.org` }));
    } else {
      results.push({ id: 'wikipedia', label: 'Wikipedia', ok: false, skipped: true, message: 'desactivado' });
    }
    if (config.providers.steam) {
      await check('steam', 'Steam', () => this.#fetchJson('https://store.steampowered.com/api/appdetails?appids=400&l=english', { host: 'store.steampowered.com' }));
    } else {
      results.push({ id: 'steam', label: 'Steam', ok: false, skipped: true, message: 'desactivado' });
    }
    if (config.providers.wikidata) {
      await check('wikidata', 'Wikidata', () => this.#fetchJson('https://www.wikidata.org/wiki/Special:EntityData/Q49740.json', { host: 'www.wikidata.org' }));
    } else {
      results.push({ id: 'wikidata', label: 'Wikidata', ok: false, skipped: true, message: 'desactivado' });
    }
    if (config.providers.rawg) {
      await check('rawg', 'RAWG', () => this.rawgCandidates('minecraft', { key: config.rawgKey }));
    } else {
      results.push({ id: 'rawg', label: 'RAWG', ok: false, skipped: true, message: config.rawgKey ? 'desactivado' : 'sin clave' });
    }

    return { results, online: results.some((r) => r.ok) };
  }
}

/* ----------------------------------------------------- aplicación a un juego */

/**
 * Campos que se pueden volcar desde un candidato a la ficha del juego.
 * Se conserva lo que el usuario ya haya escrito salvo que se indique lo contrario.
 */
export function buildPatch(candidate, fields = {}, { overwrite = false, current = {} } = {}) {
  const patch = {};
  const want = (field) => fields[field] !== false;
  const keep = (value) => value !== undefined && value !== null && value !== '';
  const isEmpty = (field) => {
    const value = current[field];
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'number') return !value; /* 0 cuenta como vacío (nota, crítica) */
    return value === undefined || value === null || value === '';
  };
  const canSet = (field) => want(field) && (overwrite || isEmpty(field));

  if (canSet('description') && keep(candidate.description)) patch.description = candidate.description;
  if (canSet('genres') && candidate.genres?.length) patch.genres = candidate.genres;
  if (canSet('developers') && candidate.developers?.length) patch.developers = candidate.developers;
  if (canSet('publishers') && candidate.publishers?.length) patch.publishers = candidate.publishers;
  if (canSet('releaseDate') && keep(candidate.releaseDate)) patch.releaseDate = candidate.releaseDate;
  if (canSet('criticScore') && candidate.criticScore > 0) patch.criticScore = candidate.criticScore;
  if (want('tags') && candidate.genres?.length && (overwrite || isEmpty('tags'))) patch.tags = candidate.genres.slice(0, 4);
  return patch;
}
