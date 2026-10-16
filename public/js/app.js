/* Arranque de la aplicación: navegación, estado en vivo y atajos. */
import { api } from './api.js';
import {
  state, subscribe, refresh, setView, updateQuery, restoreQuery, loadActivity,
  liveEntries, runningCount, elapsedSeconds, liveFor, isRunning, applyLauncherStatus, emit,
} from './store.js';
import {
  $, $$, esc, debounce, fmtDuration, toast, hideContextMenu, anyModalOpen, closeTopModal, fmtHours,
} from './util.js';
import { renderLibrary, openGameMenu } from './views/library.js';
import { renderActivity } from './views/activity.js';
import { renderStats } from './views/stats.js';
import { renderSettings, applyThemeToDocument } from './views/settings.js';
import { renderScan, openScanWizard, openAddManual } from './views/scan.js';
import { openGameDetail } from './views/game.js';
import { launchGame, stopGame } from './actions.js';

const views = {
  library: renderLibrary,
  activity: renderActivity,
  stats: renderStats,
  scan: renderScan,
  settings: renderSettings,
};

const viewEl = $('#view');
let lastRunning = -1;

/* --------------------------------------------------------------------- render */

function renderView() {
  const renderer = views[state.view] || renderLibrary;
  if (state.view === 'activity' && !state.activity) loadActivity().catch(() => {});
  renderer(viewEl);
  $$('#nav .nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === state.view));
  document.body.dataset.view = state.view;
  if (state.view === 'settings' || state.view === 'scan') renderSidebar();
}

function renderSidebar() {
  const facets = state.facets;
  $('#count-all').textContent = String(facets.total ?? 0);
  $('#brand-sub').textContent = runningCount() ? `${runningCount()} en ejecución` : `${facets.total} juegos`;

  $('#side-statuses').innerHTML = facets.statuses.map((status) => `
    <button class="side-item ${state.query.status === status.id ? 'active' : ''}" data-status="${status.id}">
      <span class="dot" style="background:${status.color}"></span>
      <span class="label">${esc(status.label)}</span>
      <span class="num">${status.count}</span>
    </button>`).join('') + `
    <button class="side-item ${state.query.status === 'all' ? 'active' : ''}" data-status="all">
      <span class="dot" style="background:#6f7691"></span><span class="label">Todo</span><span class="num">${facets.total}</span>
    </button>`;

  $('#side-platforms').innerHTML = facets.platforms.map((platform) => `
    <button class="side-item ${state.query.platform === platform.id ? 'active' : ''}" data-platform="${platform.id}">
      <span class="dot" style="background:${platform.color}"></span>
      <span class="label">${esc(platform.label)}</span>
      <span class="num">${platform.count}</span>
    </button>`).join('') || '<p class="tiny muted" style="padding:0 8px">Sin plataformas todavía.</p>';

  const tags = facets.tags.slice(0, 22);
  $('#side-tags').innerHTML = tags.map((tag) => `
    <button class="${state.query.tag === tag.name ? 'active' : ''}" data-tag="${esc(tag.name)}">${esc(tag.name)}<b>${tag.count}</b></button>`).join('')
    || '<p class="tiny muted" style="padding:0 8px">Sin etiquetas.</p>';

  const running = liveEntries();
  const sideRunning = $('#side-running');
  sideRunning.hidden = running.length === 0;
  $('#running-list').innerHTML = running.map(({ gameId, game, live }) => `
    <div class="running-item" data-game="${gameId}">
      <img src="/api/games/${gameId}/cover" alt="" loading="lazy">
      <span class="meta">
        <b>${esc(game?.name || 'Sesión')}</b>
        <span data-live-game="${gameId}"><span data-live-clock>${fmtDuration(elapsedSeconds(live), 'clock')}</span></span>
      </span>
      <button data-stop="${gameId}" title="Detener">■</button>
    </div>`).join('');

  $('#running-list').querySelectorAll('[data-game]').forEach((node) => {
    node.addEventListener('click', (event) => {
      if (event.target.closest('[data-stop]')) return;
      openGameDetail(node.dataset.game);
    });
  });
  $('#running-list').querySelectorAll('[data-stop]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      stopGame(button.dataset.stop);
    });
  });

  const stats = state.stats;
  $('#foot-summary').textContent = stats
    ? `${stats.totals.games} juegos · ${fmtHours(stats.totals.seconds)} jugadas`
    : '—';

  renderLiveStrip();
}

function renderLiveStrip() {
  const strip = $('#live-strip');
  const running = liveEntries();
  strip.hidden = running.length === 0;
  strip.innerHTML = running.slice(0, 3).map(({ gameId, game, live }) => `
    <button class="live-pill" data-game="${gameId}" title="${esc(game?.name || '')}">
      <span class="pulse"></span>
      <span>${esc((game?.name || 'Juego').slice(0, 18))}</span>
      <b data-live-game="${gameId}"><span data-live-clock>${fmtDuration(elapsedSeconds(live), 'clock')}</span></b>
    </button>`).join('') + (running.length > 3 ? `<span class="tiny muted">+${running.length - 3}</span>` : '');

  strip.querySelectorAll('[data-game]').forEach((button) => {
    button.addEventListener('click', () => openGameDetail(button.dataset.game));
  });
}

/* ---------------------------------------------------------------- reloj vivo */

setInterval(() => {
  const nodes = $$('[data-live-game]');
  if (!nodes.length) return;
  for (const node of nodes) {
    const live = liveFor(node.dataset.liveGame);
    if (!live) continue;
    const clock = node.querySelector('[data-live-clock]') || node;
    clock.textContent = fmtDuration(elapsedSeconds(live), 'clock');
  }
}, 1000);

/* ---------------------------------------------------------- sondeo del servidor */

async function poll() {
  try {
    const status = await api.launcherStatus();
    const ids = Object.keys(status.sessions || {});
    const previous = Object.keys(state.launcher?.sessions || {});
    const changed = ids.length !== previous.length || ids.some((id) => !previous.includes(id));
    applyLauncherStatus(status);
    if (changed) {
      if (ids.length < previous.length) {
        /* una sesión terminó: refrescar horas y estadísticas */
        await refresh({ quiet: true });
        if (state.view === 'activity') await loadActivity().catch(() => {});
        renderSidebar();
      } else {
        renderSidebar();
        if (state.view === 'library') renderView();
      }
    }
  } catch {
    /* servidor ocupado; se reintenta en el próximo ciclo */
  }
}

setInterval(() => {
  if (document.hidden) return;
  poll();
}, 5000);

/* ------------------------------------------------------------------ navegación */

$$('#nav .nav-item').forEach((button) => {
  button.addEventListener('click', () => {
    setView(button.dataset.view);
    document.body.classList.remove('sidebar-open');
  });
});

$('#btn-menu')?.addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
$('#btn-collapse')?.addEventListener('click', () => {
  document.body.classList.toggle('sidebar-collapsed');
  localStorage.setItem('nebula:sidebar', document.body.classList.contains('sidebar-collapsed') ? '1' : '0');
});

$('#side-statuses').addEventListener('click', (event) => {
  const button = event.target.closest('[data-status]');
  if (button) updateQuery({ status: button.dataset.status });
});
$('#side-platforms').addEventListener('click', (event) => {
  const button = event.target.closest('[data-platform]');
  if (button) updateQuery({ platform: state.query.platform === button.dataset.platform ? 'all' : button.dataset.platform });
});
$('#side-tags').addEventListener('click', (event) => {
  const button = event.target.closest('[data-tag]');
  if (button) updateQuery({ tag: state.query.tag === button.dataset.tag ? 'all' : button.dataset.tag });
});

const searchInput = $('#search-input');
searchInput?.addEventListener('input', debounce(() => updateQuery({ search: searchInput.value.trim() }), 200));

$('#btn-view-mode')?.addEventListener('click', () => {
  const mode = state.query.mode === 'grid' ? 'list' : 'grid';
  updateQuery({ mode });
  syncViewModeButton();
});

function syncViewModeButton() {
  const button = $('#btn-view-mode');
  if (!button) return;
  button.textContent = state.query.mode === 'grid' ? '▦' : '☰';
  button.title = state.query.mode === 'grid' ? 'Ver como lista' : 'Ver como cuadrícula';
}

$('#btn-refresh')?.addEventListener('click', async () => {
  await refresh();
  toast('Datos actualizados', { type: 'ok' });
});

$('#btn-scan')?.addEventListener('click', () => openScanWizard());
$('#btn-quick-scan')?.addEventListener('click', () => openScanWizard());
$('#btn-add-game')?.addEventListener('click', () => openAddManual());

document.addEventListener('click', (event) => {
  if (!event.target.closest('#ctx-menu')) hideContextMenu();
});
window.addEventListener('blur', hideContextMenu);
document.addEventListener('scroll', hideContextMenu, true);

/* --------------------------------------------------------------- atajos */

document.addEventListener('keydown', (event) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openPalette();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    searchInput?.focus();
    searchInput?.select();
    return;
  }
  if (event.key === 'Escape') {
    if (!$('#ctx-menu').hidden) { hideContextMenu(); return; }
    if (!$('#palette').hidden) { closePalette(); return; }
    if (document.body.classList.contains('sidebar-open')) { document.body.classList.remove('sidebar-open'); return; }
    if (anyModalOpen()) { closeTopModal(); return; }
    if (typing) { searchInput.blur(); return; }
  }
  if (event.key === '/' && !typing) {
    event.preventDefault();
    searchInput?.focus();
  }
});

/* ------------------------------------------------------- paleta de comandos */

let paletteIndex = 0;
let paletteItems = [];

export function openPalette() {
  const palette = $('#palette');
  palette.hidden = false;
  palette.innerHTML = `
    <div class="box">
      <input type="text" placeholder="Buscar juegos o ejecutar una acción…" data-palette-input autocomplete="off">
      <div class="results" data-results></div>
    </div>`;
  const input = palette.querySelector('[data-palette-input]');
  input.value = '';
  input.addEventListener('input', () => updatePalette(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); paletteIndex = Math.min(paletteItems.length - 1, paletteIndex + 1); paintPalette(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); paletteIndex = Math.max(0, paletteIndex - 1); paintPalette(); }
    else if (event.key === 'Enter') { event.preventDefault(); paletteItems[paletteIndex]?.action(); }
    else if (event.key === 'Escape') { event.preventDefault(); closePalette(); }
  });
  palette.addEventListener('click', (event) => { if (event.target === palette) closePalette(); });
  updatePalette('');
  setTimeout(() => input.focus(), 30);
}

function closePalette() {
  $('#palette').hidden = true;
  $('#palette').innerHTML = '';
}

function commands() {
  return [
    { label: 'Buscar juegos instalados', kind: 'acción', action: () => { closePalette(); openScanWizard(); } },
    { label: 'Agregar juego manualmente', kind: 'acción', action: () => { closePalette(); openAddManual(); } },
    { label: 'Ir a Biblioteca', kind: 'vista', action: () => { closePalette(); setView('library'); } },
    { label: 'Ir a Actividad', kind: 'vista', action: () => { closePalette(); setView('activity'); } },
    { label: 'Ir a Estadísticas', kind: 'vista', action: () => { closePalette(); setView('stats'); } },
    { label: 'Ir a Buscar juegos', kind: 'vista', action: () => { closePalette(); setView('scan'); } },
    { label: 'Ir a Ajustes', kind: 'vista', action: () => { closePalette(); setView('settings'); } },
    { label: 'Alternar cuadrícula / lista', kind: 'acción', action: () => { closePalette(); updateQuery({ mode: state.query.mode === 'grid' ? 'list' : 'grid' }); syncViewModeButton(); } },
    { label: 'Detener todos los juegos', kind: 'acción', action: async () => { closePalette(); await api.stopAll(); toast('Sesiones detenidas', { type: 'ok' }); await refresh({ quiet: true }); } },
    { label: 'Mostrar juegos ocultos', kind: 'filtro', action: () => { closePalette(); updateQuery({ hidden: true }); } },
    { label: 'Quitar filtros', kind: 'filtro', action: () => { closePalette(); updateQuery({ search: '', status: 'all', platform: 'all', tag: 'all', favorite: false, hidden: false }); } },
  ];
}

function updatePalette(text) {
  const query = text.trim().toLowerCase();
  const list = [];
  for (const command of commands()) {
    if (!query || command.label.toLowerCase().includes(query)) list.push({ ...command, icon: '›' });
  }
  if (query) {
    const games = state.games
      .filter((game) => game.name.toLowerCase().includes(query))
      .slice(0, 12);
    for (const game of games) {
      list.push({
        label: game.name,
        kind: isRunning(game.id) ? 'detener' : 'jugar',
        image: `/api/games/${game.id}/cover`,
        action: () => { closePalette(); launchGame(game.id); },
        alt: () => openGameDetail(game.id),
      });
    }
  }
  paletteItems = list.slice(0, 24);
  paletteIndex = 0;
  paintPalette();
}

function paintPalette() {
  const results = $('#palette [data-results]');
  if (!results) return;
  results.innerHTML = paletteItems.length
    ? paletteItems.map((item, index) => `
        <button class="${index === paletteIndex ? 'active' : ''}" data-index="${index}">
          ${item.image ? `<img src="${item.image}" alt="">` : '<span style="opacity:.6">›</span>'}
          <span>${esc(item.label)}</span>
          <span class="k">${esc(item.kind)}</span>
        </button>`).join('')
    : '<p class="panel-note" style="padding:12px">Sin coincidencias.</p>';
  results.querySelectorAll('[data-index]').forEach((button) => {
    const item = paletteItems[Number(button.dataset.index)];
    button.addEventListener('click', (event) => {
      if (event.shiftKey && item.alt) item.alt();
      else item.action();
    });
  });
  results.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
}

/* -------------------------------------------------- arrastrar imágenes encima */

let dragDepth = 0;
window.addEventListener('dragover', (event) => {
  if (!event.dataTransfer?.types?.includes('Files')) return;
  if (event.target.closest('.card, .modal-body')) return;
  event.preventDefault();
  $('#drop-veil').hidden = false;
});
window.addEventListener('dragleave', (event) => {
  if (event.relatedTarget) return;
  $('#drop-veil').hidden = true;
});
window.addEventListener('drop', () => { $('#drop-veil').hidden = true; });

/* --------------------------------------------------------------- suscripciones */

subscribe((event) => {
  if (event === 'activity') {
    if (state.view === 'activity') renderActivity(viewEl);
    return;
  }
  if (event === 'view') {
    renderView();
    return;
  }
  renderView();
  renderSidebar();
  syncViewModeButton();
});

/* ------------------------------------------------------------------- arranque */

async function boot() {
  restoreQuery();
  document.body.dataset.background = 'aurora';
  syncViewModeButton();

  const savedScale = localStorage.getItem('nebula:cover-scale');
  if (savedScale) {
    state.query.coverScale = Number(savedScale);
    document.documentElement.style.setProperty('--cover-scale', savedScale);
  }
  if (localStorage.getItem('nebula:sidebar') === '1') document.body.classList.add('sidebar-collapsed');

  try {
    await refresh();
  } catch (err) {
    viewEl.innerHTML = `<div class="empty">
      <h3>No se pudo conectar con el servidor</h3>
      <p>${esc(err.message)}. Verifica que <code>node server/index.js</code> siga en ejecución y recarga la página.</p>
      <button class="btn primary" onclick="location.reload()">Reintentar</button>
    </div>`;
    return;
  }

  const settings = state.settings || {};
  state.query.mode = settings.view?.mode || state.query.mode;
  state.query.sort = settings.view?.sort || state.query.sort;
  state.query.direction = settings.view?.direction || state.query.direction;
  state.query.group = settings.view?.group || 'none';
  applyThemeToDocument(settings.theme || {});
  syncViewModeButton();

  renderView();
  renderSidebar();
  setInterval(renderSidebar, 20000);

  if (!state.games.length) {
    setTimeout(() => {
      toast('La biblioteca está vacía. Prueba “Buscar juegos”, o carga la biblioteca de ejemplo desde Ajustes.', {
        title: 'Bienvenido a Nébula', timeout: 9000,
      });
    }, 700);
  }

  /* guardar preferencias de vista en el servidor (con retraso, sin bloquear) */
  const persistView = debounce(() => {
    api.saveSettings({
      view: {
        mode: state.query.mode,
        sort: state.query.sort,
        direction: state.query.direction,
        group: state.query.group,
        coverScale: state.query.coverScale,
      },
    }).catch(() => {});
  }, 1200);
  subscribe((event) => { if (event === 'query') persistView(); });
}

boot();
