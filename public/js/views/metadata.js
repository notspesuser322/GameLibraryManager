/**
 * Panel de metadatos: busca fichas en Wikipedia, Wikidata, Steam y RAWG y las
 * vuelca en el juego. Pensado para títulos que no existen en ninguna tienda
 * (Minecraft lanzado con HMCL, juegos emulados, aplicaciones, betas…).
 */
import { api } from '../api.js';
import { state, refresh } from '../store.js';
import { esc, toast, debounce, fmtBytes } from '../util.js';

const SOURCE_LABELS = {
  wikipedia: { label: 'Wikipedia', color: '#c9c9c9' },
  wikidata: { label: 'Wikidata', color: '#7ea6f0' },
  steam: { label: 'Steam', color: '#4a9bd1' },
  rawg: { label: 'RAWG', color: '#8d93a1' },
};

const FIELD_OPTIONS = [
  ['description', 'Descripción'],
  ['genres', 'Géneros'],
  ['tags', 'Etiquetas'],
  ['developers', 'Desarrollador'],
  ['publishers', 'Editorial'],
  ['releaseDate', 'Fecha'],
  ['criticScore', 'Nota de crítica'],
];

/** Estado local del panel (por juego). */
const panels = new Map();

function panelFor(gameId) {
  if (!panels.has(gameId)) {
    panels.set(gameId, {
      query: null,
      loading: false,
      candidates: [],
      searchErrors: [],
      error: null,
      selected: null,
      fields: Object.fromEntries(FIELD_OPTIONS.map(([id]) => [id, true])),
      overwrite: false,
      searched: false,
      online: null,
    });
  }
  return panels.get(gameId);
}

function sourceBadge(source) {
  const meta = SOURCE_LABELS[source] || { label: source, color: '#8d93a1' };
  return `<span class="pill" style="color:${meta.color};border-color:${meta.color}55">${esc(meta.label)}</span>`;
}

function scoreBar(score) {
  const pct = Math.round(Math.min(1, Math.max(0, score)) * 100);
  const color = pct >= 80 ? 'var(--ok)' : pct >= 55 ? 'var(--warn)' : 'var(--muted-2)';
  return `<span class="meta-score" title="Parecido con el nombre buscado: ${pct} %">
    <span class="track"><i style="width:${pct}%;background:${color}"></i></span>
    <b style="color:${color}">${pct} %</b>
  </span>`;
}

export function renderMetadataPanel(game, rerender) {
  const panel = panelFor(game.id);
  if (panel.query === null) panel.query = game.name;
  const config = state.settings?.metadata || {};
  const providers = { steam: true, wikipedia: true, wikidata: true, rawg: false, ...(config.providers || {}) };
  const applied = game.extra?.metadata || null;

  return `
    <div class="metadata-panel">
      <div class="meta-head">
        <div class="meta-search">
          <label class="field">
            <span>Buscar ficha para</span>
            <span class="inline-actions" style="gap:8px">
              <input class="input" data-meta-query value="${esc(panel.query)}" placeholder="Minecraft">
              <select class="select" data-meta-lang title="Idioma de la búsqueda">
                ${[['es', 'Español'], ['en', 'Inglés'], ['pt', 'Portugués'], ['fr', 'Francés'], ['de', 'Alemán']]
                  .map(([id, label]) => `<option value="${id}" ${(config.language || 'es') === id ? 'selected' : ''}>${label}</option>`).join('')}
              </select>
              <button class="btn primary" data-meta-search>Buscar</button>
              <button class="btn ghost" data-meta-auto title="Usa el mejor resultado disponible">Automático</button>
            </span>
          </label>
          <div class="chips" style="margin-top:8px">
            ${['steam', 'wikipedia', 'rawg'].map((id) => `
              <label class="chip ${providers[id] ? 'active' : ''}" style="cursor:pointer">
                <input type="checkbox" data-meta-provider="${id}" ${providers[id] ? 'checked' : ''} style="margin-right:6px">
                ${esc(SOURCE_LABELS[id]?.label || id)}
              </label>`).join('')}
            <span class="tiny muted" style="align-self:center">Wikidata enriquece los resultados de Wikipedia</span>
          </div>
        </div>
        <div class="meta-current">
          ${applied
            ? `<p class="tiny muted" style="margin:0 0 6px">Ficha actual: <b>${esc(SOURCE_LABELS[applied.source]?.label || applied.source)}</b> · ${esc(applied.title || '')}
                 ${applied.score ? `· ${Math.round(applied.score * 100)} %` : ''}${applied.url ? ` · <a href="${esc(applied.url)}" target="_blank" rel="noopener">ver original</a>` : ''}</p>`
            : '<p class="tiny muted" style="margin:0 0 6px">Este juego todavía no tiene ficha externa. Se puede escribir una a mano o buscarla aquí.</p>'}
          ${applied?.imagenes?.cover
            ? applied.imagenes.cover.ok
              ? '<p class="tiny" style="margin:6px 0 0;color:var(--ok)">Carátula descargada correctamente.</p>'
              : `<p class="tiny" style="margin:6px 0 0;color:var(--warn)">La carátula no se pudo descargar: ${esc(applied.imagenes.cover.error || 'motivo desconocido')}</p>
                 <button class="btn small ghost mt" data-meta-retry-art>Reintentar la carátula</button>`
            : ''}
          <p class="tiny muted" style="margin:6px 0 0">Fuentes abiertas y sin cuenta. Si no hay internet, la búsqueda avisa y la biblioteca sigue igual.</p>
        </div>
      </div>

      ${panel.error ? `<p class="tiny" style="color:var(--warn)">${esc(panel.error)}</p>` : ''}
      ${panel.loading ? '<p class="tiny muted mt">Consultando fuentes…</p>' : ''}
      ${!panel.loading && panel.searchErrors.length
        ? `<p class="tiny muted mt">No respondieron: ${panel.searchErrors.map((e) => `${esc(e.provider)} (${esc(e.message)})`).join(', ')}</p>`
        : ''}

      ${panel.candidates.length ? `
        <div class="meta-results">
          ${panel.candidates.map((candidate, index) => `
            <div class="meta-card ${panel.selected === index ? 'selected' : ''}" data-meta-candidate="${index}">
              <img src="${esc(candidate.coverUrl || `/api/games/${game.id}/cover`)}" alt="" loading="lazy"
                   onerror="this.src='/api/games/${game.id}/cover'">
              <div class="meta-body">
                <div class="meta-title">
                  <b>${esc(candidate.title)}</b>
                  ${sourceBadge(candidate.source)}
                  ${candidate.extra?.dubious ? '<span class="pill" style="color:var(--warn)">poco seguro</span>' : ''}
                  ${candidate.coverUrl || candidate.bannerUrl
                    ? '<span class="pill" style="color:var(--ok)">con imagen</span>'
                    : '<span class="pill" style="color:var(--muted-2)">solo datos</span>'}
                  ${scoreBar(candidate.score || 0)}
                </div>
                <p class="tiny muted meta-line">
                  ${candidate.developers?.length ? `Desarrolla: ${esc(candidate.developers.slice(0, 2).join(', '))}` : ''}
                  ${candidate.publishers?.length ? ` · Publica: ${esc(candidate.publishers.slice(0, 2).join(', '))}` : ''}
                  ${candidate.releaseDate ? ` · ${esc(String(candidate.releaseDate).slice(0, 4))}` : ''}
                  ${candidate.genres?.length ? ` · ${esc(candidate.genres.slice(0, 3).join(', '))}` : ''}
                  ${candidate.criticScore ? ` · crítica ${candidate.criticScore}` : ''}
                </p>
                <p class="tiny meta-desc">${esc((candidate.description || candidate.longDescription || '').slice(0, 260)) || '<span class="muted">Sin descripción disponible</span>'}</p>
                <div class="inline-actions">
                  <button class="btn small ${panel.selected === index ? 'primary' : ''}" data-meta-apply="${index}">
                    ${panel.selected === index ? 'Aplicar a la ficha' : 'Elegir'}
                  </button>
                  ${candidate.url ? `<a class="btn small ghost" href="${esc(candidate.url)}" target="_blank" rel="noopener">Abrir fuente</a>` : ''}
                </div>
              </div>
            </div>`).join('')}
        </div>

        <div class="meta-apply">
          <h3>Aplicar a la ficha</h3>
          <div class="chips">
            ${FIELD_OPTIONS.map(([id, label]) => `
              <label class="chip ${panel.fields[id] ? 'active' : ''}" style="cursor:pointer">
                <input type="checkbox" data-meta-field="${id}" ${panel.fields[id] ? 'checked' : ''} style="margin-right:6px">${esc(label)}
              </label>`).join('')}
          </div>
          <label class="switch mt">
            <input type="checkbox" data-meta-overwrite ${panel.overwrite ? 'checked' : ''}>
            <span class="txt"><b>Sobrescribir lo que ya escribí</b><span>si lo dejas apagado solo se rellenan los campos vacíos</span></span>
          </label>
          <div class="inline-actions mt">
            <button class="btn primary" data-meta-apply-selected>Descargar ficha${panel.selected !== null ? ` de «${esc(panel.candidates[panel.selected]?.title || '')}»` : ''}</button>
            <span class="tiny muted">La carátula y el fondo se guardan en la biblioteca (se puede desactivar en Ajustes).</span>
          </div>
        </div>
      ` : (panel.searched && !panel.loading
          ? `<div class="empty mt" style="padding:26px">
              <h3>Sin coincidencias</h3>
              <p>Prueba con otro nombre (por ejemplo <code>Minecraft: Java Edition</code>) o cambia el idioma de búsqueda. También puedes escribir la ficha a mano en la pestaña <b>Editar</b>.</p>
             </div>`
          : `<div class="empty mt" style="padding:26px">
              <h3>Busca la ficha del juego</h3>
              <p>Ideal para juegos sin tienda: Minecraft con HMCL, emulados, itch.io, aplicaciones o betas. Se consultan Wikipedia, Wikidata y Steam; RAWG si pegas tu clave en Ajustes.</p>
              <div class="inline-actions">
                <button class="btn primary" data-meta-search>Buscar «${esc(panel.query)}»</button>
                <button class="btn ghost" data-meta-auto>Usar el mejor resultado</button>
              </div>
             </div>`)
      }
    </div>`;
}

export function wireMetadataPanel(root, game, rerender) {
  const panel = panelFor(game.id);
  const queryInput = root.querySelector('[data-meta-query]');
  const langSelect = root.querySelector('[data-meta-lang]');

  const collectProviders = () => {
    const picked = {};
    root.querySelectorAll('[data-meta-provider]').forEach((input) => { picked[input.dataset.metaProvider] = input.checked; });
    return picked;
  };

  const runSearch = async () => {
    const query = (queryInput?.value || game.name).trim();
    panel.query = query;
    panel.loading = true;
    panel.error = null;
    panel.selected = null;
    rerender();
    try {
      const result = await api.metadataSearch({
        query,
        lang: langSelect?.value || undefined,
        providers: Object.entries(collectProviders()).filter(([, on]) => on).map(([id]) => id).join(',') || undefined,
      });
      panel.candidates = result.candidates || [];
      panel.searchErrors = result.errors || [];
      panel.online = result.online;
      panel.searched = true;
      if (!panel.candidates.length && !panel.searchErrors.length) panel.error = `No se encontró nada para «${query}»`;
      if (!panel.candidates.length && panel.searchErrors.length && result.online === false) {
        panel.error = 'Parece que no hay conexión a internet o los servicios no responden. La biblioteca sigue funcionando sin esto.';
      }
    } catch (err) {
      panel.error = err.message;
      panel.candidates = [];
    } finally {
      panel.loading = false;
      rerender();
    }
  };

  const runAutomatic = async () => {
    const query = (queryInput?.value || game.name).trim();
    panel.loading = true;
    panel.error = null;
    rerender();
    try {
      const { candidate } = await api.metadataSuggest(query);
      if (!candidate) {
        panel.error = `No hay un resultado lo bastante parecido a «${query}». Prueba a buscar otro nombre.`;
      } else {
        await apply(game, candidate, panel, rerender);
        return;
      }
    } catch (err) {
      panel.error = err.message;
    } finally {
      panel.loading = false;
      rerender();
    }
  };

  const applySelected = async () => {
    const index = panel.selected;
    if (index === null || !panel.candidates[index]) {
      toast('Elige primero un resultado', { type: 'err' });
      return;
    }
    await apply(game, panel.candidates[index], panel, rerender);
  };

  root.querySelectorAll('[data-meta-search]').forEach((button) => button.addEventListener('click', runSearch));
  root.querySelectorAll('[data-meta-auto]').forEach((button) => button.addEventListener('click', runAutomatic));
  root.querySelectorAll('[data-meta-apply]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.metaApply);
      if (panel.selected === index) applySelected();
      else { panel.selected = index; rerender(); }
    });
  });
  root.querySelectorAll('[data-meta-field]').forEach((input) => {
    input.addEventListener('change', () => { panel.fields[input.dataset.metaField] = input.checked; });
  });
  root.querySelector('[data-meta-overwrite]')?.addEventListener('change', (event) => { panel.overwrite = event.target.checked; });
  root.querySelector('[data-meta-apply-selected]')?.addEventListener('click', applySelected);
  root.querySelector('[data-meta-retry-art]')?.addEventListener('click', async (event) => {
    const boton = event.currentTarget;
    boton.disabled = true;
    boton.textContent = 'Descargando…';
    try {
      const resultado = await api.retryMetadataArt(game.id);
      const cover = resultado.cover || {};
      if (cover.file) toast('Carátula descargada', { type: 'ok' });
      else toast(cover.error || 'No se pudo descargar la carátula', { type: 'err', title: 'Sin carátula' });
      await refresh({ quiet: true });
      panels.delete(game.id);
      rerender();
    } catch (err) {
      toast(err.message, { type: 'err' });
      boton.disabled = false;
      boton.textContent = 'Reintentar la carátula';
    }
  });
  queryInput?.addEventListener('keydown', (event) => { if (event.key === 'Enter') runSearch(); });
}

async function apply(game, candidate, panel, rerender) {
  const button = document.querySelector('#modal-root [data-meta-apply-selected]');
  if (button) { button.disabled = true; button.textContent = 'Descargando…'; }
  try {
    const respuesta = await api.applyMetadata(game.id, {
      candidate,
      fields: panel.fields,
      overwrite: panel.overwrite,
      downloadArt: state.settings?.fetchRemoteArt !== false,
    });
    const imagenes = respuesta?.game?.extra?.metadata?.imagenes?.cover;
    if (imagenes && !imagenes.ok) {
      toast(`Ficha aplicada, pero la carátula no: ${imagenes.error || 'motivo desconocido'}`, { type: 'err', title: SOURCE_LABELS[candidate.source]?.label || candidate.source });
    } else {
      toast(`Ficha de «${candidate.title}» aplicada`, { type: 'ok', title: SOURCE_LABELS[candidate.source]?.label || candidate.source });
    }
    await refresh({ quiet: true });
    panels.delete(game.id);
    rerender();
  } catch (err) {
    toast(err.message, { type: 'err', title: 'No se pudo aplicar' });
    if (button) { button.disabled = false; button.textContent = 'Descargar ficha'; }
  }
}

/* ------------------------------------------------------------ ajustes */

/** Informe de la última acción de ajustes: sobrevive al redibujado de la vista. */
let lastReport = '';

function setReport(html) {
  lastReport = html;
  const box = document.querySelector('#view [data-metadata-result]');
  if (box) box.innerHTML = html;
}

export function metadataSettingsHtml(settings, providersEnabled = {}) {
  const config = settings?.metadata || {};
  const providers = { steam: true, wikipedia: true, wikidata: true, rawg: false, ...(config.providers || {}) };
  return `
    <h3>Metadatos automáticos</h3>
    <p class="panel-note">
      Busca descripción, desarrollador, fecha, géneros y carátula en fuentes abiertas.
      Pensado para juegos que no están en ninguna tienda (Minecraft con HMCL, emulados, itch.io…).
      No se usa Google: sus términos prohíben el acceso automatizado; Wikipedia y Wikidata cubren mejor este caso.
    </p>
    <label class="switch"><input type="checkbox" data-setting="metadata.enabled" ${config.enabled !== false ? 'checked' : ''}>
      <span class="txt"><b>Permitir búsqueda de metadatos</b><span>solo cuando la pidas desde una ficha o desde aquí</span></span></label>
    <label class="switch"><input type="checkbox" data-setting="metadata.autoFillOnScan" ${config.autoFillOnScan ? 'checked' : ''}>
      <span class="txt"><b>Buscar fichas al agregar juegos nuevos</b><span>tras un escaneo, intenta rellenar los que entraron sin datos</span></span></label>

    <div class="grid-2 mt">
      <label class="field"><span>Idioma de búsqueda</span>
        <select class="select" data-setting="metadata.language">
          ${[['es', 'Español'], ['en', 'Inglés'], ['pt', 'Portugués'], ['fr', 'Francés'], ['de', 'Alemán']]
            .map(([id, label]) => `<option value="${id}" ${(config.language || 'es') === id ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </label>
      <label class="field"><span>Exigencia de coincidencia: <b data-score-label>${Math.round((config.minScore ?? 0.5) * 100)} %</b></span>
        <input class="slider" type="range" min="0.3" max="0.95" step="0.05" value="${config.minScore ?? 0.5}" data-setting="metadata.minScore">
        <span class="hint">Cuanto más alto, menos resultados automáticos pero más fiables.</span>
      </label>
    </div>

    <div class="mt">
      <p class="tiny muted">Fuentes</p>
      <div class="chips">
        ${['wikipedia', 'wikidata', 'steam', 'rawg'].map((id) => `
          <label class="chip ${providers[id] ? 'active' : ''}" style="cursor:pointer">
            <input type="checkbox" data-meta-provider-setting="${id}" ${providers[id] ? 'checked' : ''} style="margin-right:6px">
            ${esc(SOURCE_LABELS[id]?.label || id)}
          </label>`).join('')}
      </div>
      <label class="field mt"><span>Clave de RAWG (opcional)</span>
        <input class="input" data-setting="metadata.rawgKey" value="${esc(config.rawgKey || '')}" placeholder="pega aquí tu clave gratuita de rawg.io">
        <span class="hint">Solo si activas RAWG. Sin clave, esa fuente se ignora.</span>
      </label>
    </div>

    <hr class="sep">
    <div class="inline-actions">
      <button class="btn" data-action="metadata-probe">Comprobar fuentes</button>
      <button class="btn primary" data-action="metadata-fill">Rellenar huecos automáticamente</button>
      <span class="tiny muted">Revisa las fuentes y rellena hasta 8 juegos que estén sin descripción o sin carátula.</span>
    </div>
    <div data-metadata-result class="mt">${lastReport}</div>`;
}

export function wireMetadataSettings(root) {
  const scoreSlider = root.querySelector('[data-setting="metadata.minScore"]');
  const scoreLabel = root.querySelector('[data-score-label]');
  scoreSlider?.addEventListener('input', () => {
    if (scoreLabel) scoreLabel.textContent = `${Math.round(Number(scoreSlider.value) * 100)} %`;
  });

  root.querySelectorAll('[data-meta-provider-setting]').forEach((input) => {
    input.addEventListener('change', async () => {
      const providers = { ...(state.settings.metadata?.providers || {}) };
      providers[input.dataset.metaProviderSetting] = input.checked;
      input.closest('.chip')?.classList.toggle('active', input.checked);
      await api.saveSettings({ metadata: { providers } });
      state.settings.metadata = { ...(state.settings.metadata || {}), providers };
    });
  });

  root.querySelector('[data-action="metadata-probe"]')?.addEventListener('click', async () => {
    setReport('<p class="tiny muted">Comprobando…</p>');
    try {
      const result = await api.metadataProviders();
      setReport(`
        <table class="meta-table">
          <thead><tr><th>Fuente</th><th>Estado</th><th>Tiempo</th></tr></thead>
          <tbody>
            ${result.results.map((row) => `
              <tr>
                <td>${esc(row.label)}</td>
                <td>${row.ok
                  ? '<span style="color:var(--ok)">disponible</span>'
                  : row.skipped
                    ? `<span class="muted">${esc(row.message || 'omitida')}</span>`
                    : `<span style="color:var(--danger)">sin respuesta</span> <span class="tiny muted">${esc(row.message || '')}</span>`}</td>
                <td class="tiny muted">${row.ms} ms</td>
              </tr>`).join('')}
          </tbody>
        </table>
        ${result.online ? '' : '<p class="tiny muted mt">Ninguna fuente respondió: revisa la conexión a internet. La biblioteca funciona igual sin esto.</p>'}`);
    } catch (err) {
      setReport(`<p class="tiny" style="color:var(--warn)">${esc(err.message)}</p>`);
    }
  });

  root.querySelector('[data-action="metadata-fill"]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Buscando fichas…';
    setReport('<p class="tiny muted">Consultando fuentes, puede tardar un poco…</p>');
    try {
      const result = await api.metadataFill({ onlyMissing: true, limit: 8 });
      {
        setReport(`
          <p class="tiny">${result.filled.length} fichas aplicadas, ${result.skipped.length} sin coincidencia fiable${result.errors.length ? `, ${result.errors.length} con error` : ''}.</p>
          ${result.filled.length ? `<div class="scroll-y" style="max-height:180px">${result.filled.map((row) => `
            <div class="scan-item">
              <span class="meta"><b>${esc(row.name)}</b><span>${esc(SOURCE_LABELS[row.source]?.label || row.source)} · ${esc(row.title)} · ${Math.round((row.score || 0) * 100)} %</span></span>
            </div>`).join('')}</div>` : ''}
          ${result.skipped.length ? `<p class="tiny muted mt">${result.skipped.map((row) => esc(row.name)).join(', ')}</p>` : ''}
          ${result.errors.length ? `<p class="tiny" style="color:var(--warn)">${result.errors.map((row) => `${esc(row.name)}: ${esc(row.message)}`).join('<br>')}</p>` : ''}`);
      }
      await refresh({ quiet: true });
      setReport(lastReport); /* el redibujado de la vista deja el informe a la vista */
      toast(`${result.filled.length} fichas aplicadas`, { type: result.filled.length ? 'ok' : 'err' });
    } catch (err) {
      setReport(`<p class="tiny" style="color:var(--warn)">${esc(err.message)}</p>`);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
}

/** Estilos del panel (se inyectan una sola vez). */
export const METADATA_CSS = `
.metadata-panel { display: flex; flex-direction: column; gap: 14px; }
.meta-head { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.meta-current { background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; }
.meta-results { display: flex; flex-direction: column; gap: 10px; }
.meta-card { display: grid; grid-template-columns: 84px 1fr; gap: 12px; padding: 10px; border: 1px solid var(--border); border-radius: 12px; background: rgba(255,255,255,0.02); }
.meta-card.selected { border-color: var(--accent-line); background: var(--accent-soft); }
.meta-card img { width: 84px; aspect-ratio: 2/3; object-fit: cover; border-radius: 8px; background: var(--panel-2); }
.meta-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
.meta-line { margin: 0 0 4px; }
.meta-desc { margin: 0 0 8px; color: var(--muted); }
.meta-score { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; font-size: 11.5px; }
.meta-score .track { width: 60px; height: 5px; border-radius: 20px; background: rgba(255,255,255,0.12); overflow: hidden; display: inline-block; }
.meta-score .track i { display: block; height: 100%; border-radius: 20px; }
.meta-apply { border-top: 1px solid var(--border); padding-top: 14px; }
.meta-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.meta-table th { text-align: left; color: var(--muted-2); font-weight: 600; padding: 4px 8px 6px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em; }
.meta-table td { padding: 5px 8px 5px 0; border-top: 1px solid var(--border); }
@media (max-width: 860px) { .meta-head { grid-template-columns: 1fr; } }
`;
