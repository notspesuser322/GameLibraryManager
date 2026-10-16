/**
 * Pruebas de metadatos: análisis de respuestas, puntuación y volcado en la ficha.
 * Se usa un fetch simulado, así las pruebas funcionan sin conexión a internet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MetadataService, buildPatch, similarity, stripHtml, commonsUrl, looksLikeVideoGame,
  parseSteamAppDetails, parseWikipediaSummary, parseWikidataEntity,
} from '../server/metadata.js';

/* ------------------------------------------------------------- respuestas falsas */

const STEAM_SEARCH = [
  { appid: 400, name: 'Portal', icon: 'https://ejemplo/portal.jpg' },
  { appid: 320, name: 'Half-Life 2', icon: 'https://ejemplo/hl2.jpg' },
  { appid: 999999, name: 'Minecraft Story Mode', icon: 'https://ejemplo/mcs.jpg' },
];

const STEAM_APPDETAILS = {
  999999: {
    success: true,
    data: {
      name: 'Minecraft: Story Mode',
      short_description: 'Una aventura episódica. <b>Cinco episodios</b>.',
      developers: ['Telltale Games'],
      publishers: ['Telltale Games'],
      genres: [{ description: 'Adventure' }, { description: 'Point & Click' }],
      release_date: { date: '13 Oct, 2015' },
      metacritic: { score: 70 },
      header_image: 'https://ejemplo/header.jpg',
      screenshots: [{ path_full: 'https://ejemplo/shot1.jpg' }],
      categories: [{ description: 'Single-player' }],
      website: 'https://telltale.com',
    },
  },
};

const WIKI_SEARCH = {
  query: {
    search: [
      { title: 'Minecraft', snippet: 'es un <b>videojuego</b> de construcción' },
      { title: 'Mojang Studios', snippet: 'empresa sueca' },
    ],
  },
};

const WIKI_SUMMARY = {
  Minecraft: {
    type: 'standard',
    title: 'Minecraft',
    pageid: 12345,
    wikibase_item: 'Q49740',
    description: 'videojuego de construcción tipo sandbox',
    extract: 'Minecraft es un videojuego de construcción, de tipo «mundo abierto» o sandbox creado por Markus Persson.',
    content_urls: { desktop: { page: 'https://es.wikipedia.org/wiki/Minecraft' } },
    originalimage: { source: 'https://upload.wikimedia.org/minecraft.png' },
  },
  'Mojang Studios': {
    type: 'standard',
    title: 'Mojang Studios',
    pageid: 999,
    description: 'empresa desarrolladora de videojuegos sueca',
    extract: 'Mojang Studios es una empresa desarrolladora de videojuegos sueca, filial de Microsoft.',
    content_urls: { desktop: { page: 'https://es.wikipedia.org/wiki/Mojang_Studios' } },
  },
};

const WIKIDATA_ENTITY = {
  entities: {
    Q49740: {
      claims: {
        P178: [{ mainsnak: { datavalue: { value: { id: 'Q11297' } } } }],
        P123: [{ mainsnak: { datavalue: { value: { id: 'Q2280' } } } }],
        P136: [{ mainsnak: { datavalue: { value: { id: 'Q1187086' } } } }],
        P400: [{ mainsnak: { datavalue: { value: { id: 'Q1406' } } } }],
        P577: [{ mainsnak: { datavalue: { value: { time: '+2011-11-18T00:00:00Z' } } } }],
        P18: [{ mainsnak: { datavalue: { value: 'Minecraft_cover.png' } } }],
        P856: [{ mainsnak: { datavalue: { value: 'https://www.minecraft.net' } } }],
      },
      descriptions: { es: { value: 'videojuego de construcción' } },
      aliases: { es: [{ value: 'Minecraft Java Edition' }] },
    },
  },
};

const WIKIDATA_LABELS = {
  entities: {
    Q11297: { labels: { es: { value: 'Mojang Studios' } } },
    Q2280: { labels: { es: { value: 'Microsoft' } } },
    Q1187086: { labels: { es: { value: 'sandbox' } } },
    Q1406: { labels: { es: { value: 'Microsoft Windows' } } },
  },
};

/** Fetch simulado que responde según la URL. */
function fakeFetch(url, { fail = [] } = {}) {
  return async (input) => {
    const target = String(input);
    for (const pattern of fail) {
      if (target.includes(pattern)) throw new Error('fetch failed');
    }
    const reply = (payload, ok = true) => ({
      ok,
      status: ok ? 200 : 500,
      json: async () => payload,
    });
    if (target.includes('SearchApps')) return reply(STEAM_SEARCH);
    if (target.includes('appdetails')) {
      const appId = target.match(/appids=(\d+)/)?.[1];
      return reply({ [appId]: STEAM_APPDETAILS[appId] || { success: false, data: null } });
    }
    if (target.includes('list=search')) return reply(WIKI_SEARCH);
    if (target.includes('rest_v1/page/summary/')) {
      const title = decodeURIComponent(target.split('/summary/')[1]).replace(/_/g, ' ');
      return reply(WIKI_SUMMARY[title] || { type: 'not-found' });
    }
    if (target.includes('wbgetentities')) return reply(WIKIDATA_LABELS);
    if (target.includes('Special:EntityData/')) return reply(WIKIDATA_ENTITY);
    throw new Error(`URL no simulada: ${target}`);
  };
}

function service({ metadata = {}, fail = [] } = {}) {
  const config = {
    metadata: {
      enabled: true,
      language: 'es',
      providers: { steam: true, wikipedia: true, wikidata: true, rawg: false },
      minScore: 0.5,
      ...metadata,
      providers: { steam: true, wikipedia: true, wikidata: true, rawg: false, ...(metadata.providers || {}) },
    },
  };
  return new MetadataService({ fetchImpl: fakeFetch('', { fail }), getSettings: () => config });
}

/* ------------------------------------------------------------------ utilidades */

test('stripHtml limpia etiquetas y entidades', () => {
  assert.equal(stripHtml('<p>Hola <b>mundo</b></p><p>Adiós</p>'), 'Hola mundo\nAdiós');
  assert.equal(stripHtml('A &amp; B &quot;c&quot; &#39;d&#39;'), 'A & B "c" \'d\'');
  assert.equal(stripHtml('linea1<br/>linea2'), 'linea1\nlinea2');
  assert.equal(stripHtml(''), '');
});

test('similarity puntúa bien los títulos parecidos', () => {
  assert.equal(similarity('Minecraft', 'Minecraft'), 1);
  assert.ok(similarity('Minecraft', 'Minecraft: Java Edition') > 0.8);
  assert.ok(similarity('Minecraft', 'Minecraft Launcher') > 0.8);
  assert.ok(similarity('The Witcher 3', 'The Witcher 3: Wild Hunt') > 0.75);
  assert.ok(similarity('Hollow Knight', 'Hollow Knight: Silksong') > 0.7);
  assert.ok(similarity('Minecraft', 'Mojang Studios') < 0.4);
  assert.equal(similarity('', 'algo'), 0);
  assert.ok(similarity('S.T.A.L.K.E.R.', 'S T A L K E R Shadow of Chernobyl') > 0.5);
});

test('commonsUrl construye la URL de la imagen de Wikimedia', () => {
  assert.equal(
    commonsUrl('Minecraft_cover.png'),
    'https://commons.wikimedia.org/wiki/Special:FilePath/Minecraft_cover.png?width=1200'
  );
  assert.match(commonsUrl('File:Foto con espacios.jpg'), /Foto%20con%20espacios\.jpg/);
  assert.equal(commonsUrl(''), null);
  assert.equal(commonsUrl(null), null);
});

test('looksLikeVideoGame distingue videojuegos de empresas', () => {
  assert.equal(looksLikeVideoGame('videojuego de construcción tipo sandbox'), true);
  assert.equal(looksLikeVideoGame('empresa desarrolladora de videojuegos sueca'), true);
  assert.equal(looksLikeVideoGame('especie de planta tropical'), false);
  assert.equal(looksLikeVideoGame(undefined, null), false);
});

test('parseSteamAppDetails normaliza la ficha de la tienda', () => {
  const parsed = parseSteamAppDetails(999999, STEAM_APP_DETAILS_DATA);
  assert.equal(parsed.title, 'Minecraft: Story Mode');
  assert.equal(parsed.description, 'Una aventura episódica. Cinco episodios.');
  assert.deepEqual(parsed.developers, ['Telltale Games']);
  assert.deepEqual(parsed.genres, ['Adventure', 'Point & Click']);
  assert.equal(parsed.releaseDate, '2015-10-13', 'reconoce el formato «13 Oct, 2015» de Steam');
  assert.equal(parsed.criticScore, 70);
  assert.match(parsed.coverUrl, /library_600x900\.jpg$/);
  assert.deepEqual(parsed.screenshots, ['https://ejemplo/shot1.jpg']);
  assert.equal(parsed.url, 'https://store.steampowered.com/app/999999');
  assert.equal(parseSteamAppDetails(1, null), null);
});

const STEAM_APP_DETAILS_DATA = STEAM_APPDETAILS[999999].data;

test('parseWikipediaSummary ignora desambiguaciones', () => {
  const parsed = parseWikipediaSummary('es', WIKI_SUMMARY.Minecraft);
  assert.equal(parsed.title, 'Minecraft');
  assert.match(parsed.description, /videojuego de construcción/);
  assert.equal(parsed.extra.wikidataId, 'Q49740');
  assert.equal(parsed.url, 'https://es.wikipedia.org/wiki/Minecraft');
  assert.equal(parseWikipediaSummary('es', { type: 'disambiguation', extract: 'varios' }), null);
  assert.equal(parseWikipediaSummary('es', null), null);
});

test('parseWikidataEntity extrae datos estructurados con etiquetas', () => {
  const nameById = new Map(Object.entries(WIKIDATA_LABELS.entities).map(([id, e]) => [id, e.labels.es.value]));
  const parsed = parseWikidataEntity(WIKIDATA_ENTITY.entities.Q49740, { nameById });
  assert.deepEqual(parsed.developers, ['Mojang Studios']);
  assert.deepEqual(parsed.publishers, ['Microsoft']);
  assert.deepEqual(parsed.genres, ['sandbox']);
  assert.equal(parsed.releaseDate, '2011-11-18');
  assert.match(parsed.coverUrl, /Minecraft_cover\.png/);
  assert.equal(parsed.website, 'https://www.minecraft.net');
  assert.deepEqual(parsed.aliases, ['Minecraft Java Edition']);
});

/* ------------------------------------------------------------------ búsqueda */

test('search combina Steam y Wikipedia y ordena por parecido', async () => {
  const meta = service();
  const result = await meta.search('Minecraft');
  assert.ok(result.candidates.length >= 2);
  const titles = result.candidates.map((c) => c.title);
  assert.ok(titles.includes('Minecraft'), 'aparece el artículo de Wikipedia');
  assert.ok(titles.includes('Minecraft: Story Mode'), 'aparece el juego de Steam');

  const exact = result.candidates[0];
  assert.equal(exact.title, 'Minecraft');
  assert.ok(exact.score > 0.9, `puntuación esperada alta, recibida ${exact.score}`);
  assert.ok(titles.indexOf('Minecraft') < titles.indexOf('Mojang Studios'), 'lo exacto va antes');

  const fromSteam = result.candidates.find((c) => c.source === 'steam');
  assert.equal(fromSteam.score < exact.score, true, 'el juego de Steam no gana a la coincidencia exacta');
});

test('search enriquece Wikipedia con Wikidata (desarrollador, fecha, géneros)', async () => {
  const meta = service();
  const result = await meta.search('Minecraft');
  const { candidates } = result;
  if (process.env.DIAG) console.log('DIAG errores:', JSON.stringify(meta.enrichErrors), JSON.stringify(result.errors), candidates.map((c) => `${c.source}:${c.title}:${c.score}`).join(' | '));
  const wiki = candidates.find((c) => c.source === 'wikipedia' && c.title === 'Minecraft');
  assert.deepEqual(wiki.developers, ['Mojang Studios']);
  assert.deepEqual(wiki.publishers, ['Microsoft']);
  assert.equal(wiki.releaseDate, '2011-11-18');
  assert.deepEqual(wiki.genres, ['sandbox']);
});

test('search penaliza los resultados que no parecen videojuegos', async () => {
  const meta = service();
  const { candidates } = await meta.search('Minecraft');
  const mojang = candidates.find((c) => c.title === 'Mojang Studios');
  const minecraft = candidates.find((c) => c.title === 'Minecraft');
  assert.ok(mojang, 'la empresa aparece como candidato');
  assert.equal(mojang.extra.dubious, undefined, 'una empresa de videojuegos no se marca dudosa');
  assert.ok(mojang.score < minecraft.score);
});

test('search tolera fuentes caídas y lo informa', async () => {
  const meta = service({ fail: ['SearchApps', 'store.steampowered.com'] });
  const result = await meta.search('Minecraft');
  assert.ok(result.candidates.length >= 1, 'Wikipedia sigue respondiendo');
  assert.ok(result.errors.some((e) => e.provider === 'steam'), 'el error de Steam se reporta');
  assert.ok(!result.errors.some((e) => e.provider === 'wikipedia'));
});

test('search respeta los proveedores desactivados y el interruptor general', async () => {
  const onlyWiki = service({ metadata: { providers: { steam: false, wikidata: false } } });
  const result = await onlyWiki.search('Minecraft');
  assert.ok(result.candidates.every((c) => c.source === 'wikipedia'));
  const wiki = result.candidates.find((c) => c.source === 'wikipedia' && c.title === 'Minecraft');
  assert.equal(wiki.developers.length, 0, 'sin Wikidata no hay desarrollador');
  assert.equal(wiki.releaseDate, null, 'sin Wikidata no hay fecha');
  assert.match(wiki.description, /videojuego/, 'el texto de Wikipedia sí se conserva');

  const off = service({ metadata: { enabled: false } });
  await assert.rejects(() => off.search('Minecraft'), /desactivada/);
});

test('bestMatch respeta el umbral de puntuación', async () => {
  const meta = service();
  const match = await meta.bestMatch('Minecraft');
  assert.equal(match.title, 'Minecraft');
  assert.ok(match.score >= 0.5);

  const strict = service({ metadata: { minScore: 0.999 } });
  assert.equal(await strict.bestMatch('Juego que no existe en ninguna fuente'), null);
});

test('búsquedas sin conexión fallan con un mensaje claro', async () => {
  const meta = service({ fail: ['wikipedia.org', 'steamcommunity', 'steampowered'] });
  const result = await meta.search('Minecraft');
  assert.equal(result.candidates.length, 0);
  assert.equal(result.online, false);
  assert.ok(result.errors.length >= 2);
});

/* -------------------------------------------------------- volcado en la ficha */

const CANDIDATE = {
  source: 'wikipedia',
  id: 'Q49740',
  title: 'Minecraft',
  description: 'Minecraft es un videojuego de construcción de tipo sandbox.',
  developers: ['Mojang Studios'],
  publishers: ['Microsoft'],
  genres: ['sandbox'],
  releaseDate: '2011-11-18',
  criticScore: 93,
  coverUrl: 'https://ejemplo/minecraft.png',
  bannerUrl: 'https://ejemplo/minecraft-banner.png',
};

test('buildPatch solo rellena los campos vacíos por defecto', () => {
  const current = { description: 'texto mío', genres: [], tags: ['mano'] };
  const patch = buildPatch(CANDIDATE, {}, { current });
  assert.equal(patch.description, undefined, 'no pisa la descripción existente');
  assert.deepEqual(patch.genres, ['sandbox'], 'rellena los géneros vacíos');
  assert.deepEqual(patch.tags, undefined, 'no toca las etiquetas existentes');
  assert.deepEqual(patch.developers, ['Mojang Studios']);
  assert.equal(patch.releaseDate, '2011-11-18');
});

test('buildPatch con overwrite pisa lo que ya había', () => {
  const current = { description: 'texto mío', genres: ['rpg'], tags: ['mano'] };
  const patch = buildPatch(CANDIDATE, {}, { overwrite: true, current });
  assert.match(patch.description, /sandbox/);
  assert.deepEqual(patch.genres, ['sandbox']);
  assert.deepEqual(patch.tags, ['sandbox']);
});

test('buildPatch rellena también los campos numéricos en cero', () => {
  /* nota de crítica y fecha en 0/vacío cuentan como hueco a rellenar */
  const patch = buildPatch({ ...CANDIDATE, criticScore: 88 }, {}, { current: { criticScore: 0 } });
  assert.equal(patch.criticScore, 88);

  const keep = buildPatch({ ...CANDIDATE, criticScore: 88 }, {}, { current: { criticScore: 70 } });
  assert.equal(keep.criticScore, undefined, 'una nota existente se respeta');
});

test('buildPatch respeta los campos desmarcados', () => {
  const patch = buildPatch(CANDIDATE, { description: false, genres: false }, { overwrite: true, current: {} });
  assert.equal(patch.description, undefined);
  assert.equal(patch.genres, undefined);
  assert.deepEqual(patch.developers, ['Mojang Studios']);
  assert.equal(patch.criticScore, 93);
});
