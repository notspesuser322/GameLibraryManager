/* Vista principal: biblioteca. */
import { state, updateQuery, isRunning, liveFor, elapsedSeconds, featuredGame, runningCount } from '../store.js';
import { esc, fmtHours, fmtDuration, relTime, groupGames, contextMenu, toast } from '../util.js';
import { gameCard, gameRow, listHeader, emptyState, coverImg, statusChip } from '../components.js';
import {
  addPlaytime, deleteGame, detectArt, launchGame, openStore, revealGame, setStatus,
  stopGame, toggleFavorite, uploadArt,
} from '../actions.js';
import { openGameDetail } from './game.js';

export function renderLibrary(root) {
  const games = state.games;
  const hero = featuredGame();
  const group = state.query.group;

  const groups = groupGames(games, group, state.statuses);

  root.innerHTML = `
    ${hero && state.query.search === '' && !state.query.favorite && group === 'none' ? renderHero(hero) : ''}
    <div class="filters">
      <div class="chips">
        ${['all', 'running', ...state.statuses.map((s) => s.id)].map((id) => {
          const meta = id === 'running'
            ? { label: 'Jugando ahora', count: runningCount() }
            : id === 'all'
              ? { label: 'Todo', count: state.facets.total }
              : state.statuses.find((s) => s.id === id);
          const active = state.query.status === id;
          return `<button class="chip ${active ? 'active' : ''}" data-filter-status="${id}">
            ${esc(meta?.label || id)} <span class="cnt">${meta?.count ?? ''}</span>
          </button>`;
        }).join('')}
        <button class="chip ${state.query.favorite ? 'active' : ''}" data-filter-favorite>★ Favoritos</button>
        ${state.query.hidden ? '<button class="chip active" data-filter-hidden>Ocultos visibles</button>' : ''}
      </div>
      <div class="spacer" style="flex:1"></div>
      <select class="select" data-sort-select>
        ${[['lastPlayed', 'Última vez jugado'], ['name', 'Nombre'], ['playtime', 'Más jugados'], ['added', 'Recién agregados'], ['rating', 'Calificación'], ['release', 'Año'], ['size', 'Tamaño'], ['status', 'Estado']]
          .map(([id, label]) => `<option value="${id}" ${state.query.sort === id ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
      <button class="btn small ghost" data-toggle-direction title="Cambiar sentido del orden">${state.query.direction === 'asc' ? '↑ Asc' : '↓ Desc'}</button>
      <select class="select" data-group-select>
        ${[['none', 'Sin agrupar'], ['platform', 'Por plataforma'], ['status', 'Por estado'], ['genre', 'Por género'], ['letter', 'Por letra'], ['year', 'Por año']]
          .map(([id, label]) => `<option value="${id}" ${group === id ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
      <label class="field" style="flex-direction:row;align-items:center;gap:10px;color:var(--muted);font-size:12.5px">
        <span>Carátulas</span>
        <input class="slider" type="range" min="0.7" max="1.6" step="0.05" value="${state.query.coverScale}" data-cover-scale style="width:110px">
      </label>
    </div>
    ${games.length ? groups.map((bucket) => `
      ${bucket.label ? `<div class="section-title"><h2>${esc(bucket.label)}</h2><span class="cnt muted tiny">${bucket.games.length}</span></div>` : ''}
      ${state.query.mode === 'list'
        ? `${listHeader(state.query.sort, state.query.direction)}<div class="list">${bucket.games.map(gameRow).join('')}</div>`
        : `<div class="grid">${bucket.games.map(gameCard).join('')}</div>`}
    `).join('') : renderEmpty()}
  `;

  wire(root);
}

function renderHero(game) {
  const running = isRunning(game.id);
  const live = liveFor(game.id);
  const totalHours = state.stats?.totals?.seconds || 0;
  return `<section class="hero">
    <div class="hero-bg" style="background-image:url('${game.banner}')"></div>
    <div class="hero-inner">
      <span class="hero-badge">${running ? '▶ en curso' : 'retomando'}</span>
      <h1>${esc(game.name)}</h1>
      <p>${esc(game.description || `${game.platformLabel} · ${game.playtimeSeconds ? fmtHours(game.playtimeSeconds) + ' jugadas' : 'sin horas registradas'}`)}</p>
      <div class="hero-meta">
        <span class="meta-chip" style="color:${game.platformColor}">${esc(game.platformLabel)}</span>
        ${statusChip(game)}
        <span class="meta-chip">${esc(game.lastPlayed ? relTime(game.lastPlayed) : 'nunca jugado')}</span>
        <span class="meta-chip">${esc(fmtHours(game.playtimeSeconds))}</span>
        ${totalHours ? `<span class="meta-chip">${esc(fmtHours(totalHours))} en total</span>` : ''}
      </div>
      <div class="hero-actions">
        <button class="btn ${running ? 'danger' : 'primary'}" data-game="${game.id}" data-action="${running ? 'stop' : 'launch'}">
          ${running ? `Detener${live ? ` · ${fmtDuration(elapsedSeconds(live), 'clock')}` : ''}` : 'Jugar'}
        </button>
        <button class="btn ghost" data-game="${game.id}" data-action="details">Ver ficha</button>
      </div>
    </div>
  </section>`;
}

function renderEmpty() {
  if (state.query.search) {
    return emptyState('Sin resultados', `Nada coincide con “${state.query.search}”.`, '<button class="btn" data-clear-filters>Limpiar filtros</button>');
  }
  if (state.query.favorite) {
    return emptyState('Todavía no marcaste favoritos', 'Usa ★ en la ficha de un juego para que aparezca aquí.');
  }
  return emptyState(
    'Tu biblioteca está vacía',
    'Busca juegos instalados en este equipo (Steam, Epic, GOG, Heroic, Lutris o carpetas propias) o agrega uno manualmente.',
    '<button class="btn primary" data-action="open-scan">Buscar juegos instalados</button><button class="btn" data-action="open-add">Agregar manualmente</button>'
  );
}

function wire(root) {
  root.querySelectorAll('[data-filter-status]').forEach((button) => {
    button.addEventListener('click', () => updateQuery({ status: button.dataset.filterStatus }));
  });
  root.querySelector('[data-filter-favorite]')?.addEventListener('click', () => updateQuery({ favorite: !state.query.favorite }));
  root.querySelector('[data-filter-hidden]')?.addEventListener('click', () => updateQuery({ hidden: false }));
  root.querySelector('[data-sort-select]')?.addEventListener('change', (event) => updateQuery({ sort: event.target.value }));
  root.querySelector('[data-group-select]')?.addEventListener('change', (event) => updateQuery({ group: event.target.value }));
  root.querySelector('[data-toggle-direction]')?.addEventListener('click', () => updateQuery({ direction: state.query.direction === 'asc' ? 'desc' : 'asc' }));
  root.querySelector('[data-cover-scale]')?.addEventListener('input', (event) => {
    document.documentElement.style.setProperty('--cover-scale', event.target.value);
    localStorage.setItem('ludoteca:cover-scale', event.target.value);
  });
  root.querySelector('[data-clear-filters]')?.addEventListener('click', () => {
    updateQuery({ search: '', status: 'all', platform: 'all', tag: 'all', favorite: false, hidden: false });
  });
  root.querySelector('[data-action="open-scan"]')?.addEventListener('click', () => import('../views/scan.js').then((m) => m.openScanWizard()));
  root.querySelector('[data-action="open-add"]')?.addEventListener('click', () => import('../views/scan.js').then((m) => m.openAddManual()));

  root.querySelectorAll('[data-sort]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.sort;
      updateQuery({ sort: key, direction: state.query.sort === key && state.query.direction === 'asc' ? 'desc' : 'asc' });
    });
  });

  root.querySelectorAll('[data-game]').forEach((node) => {
    const gameId = node.dataset.game;
    node.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'launch') { launchGame(gameId); return; }
      if (action === 'stop') { stopGame(gameId); return; }
      if (action === 'details') { openGameDetail(gameId); return; }
      openGameDetail(gameId);
    });
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') openGameDetail(gameId);
    });
    node.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      openGameMenu(event, gameId);
    });
    node.addEventListener('dragover', (event) => {
      if (event.dataTransfer?.types?.includes('Files')) {
        event.preventDefault();
        node.style.outline = '2px dashed var(--accent)';
      }
    });
    node.addEventListener('dragleave', () => { node.style.outline = ''; });
    node.addEventListener('drop', async (event) => {
      if (!event.dataTransfer?.files?.length) return;
      event.preventDefault();
      node.style.outline = '';
      await uploadArt(gameId, 'cover', event.dataTransfer.files[0]);
    });
  });
}

export function openGameMenu(event, gameId) {
  const game = state.games.find((g) => g.id === gameId);
  if (!game) return;
  const running = isRunning(gameId);
  contextMenu(event.clientX, event.clientY, [
    { labelOnly: game.name },
    running
      ? { label: 'Detener', action: () => stopGame(gameId) }
      : { label: 'Jugar', action: () => launchGame(gameId) },
    { label: 'Ver ficha', action: () => openGameDetail(gameId) },
    { sep: true },
    { label: game.favorite ? 'Quitar de favoritos' : 'Marcar favorito', action: () => toggleFavorite(gameId) },
    { labelOnly: 'Estado' },
    ...state.statuses.map((status) => ({
      label: `${game.status === status.id ? '● ' : '○ '}${status.label}`,
      action: () => setStatus(gameId, status.id),
    })),
    { sep: true },
    { label: 'Registrar tiempo jugado', action: () => addPlaytime(gameId) },
    { label: 'Abrir carpeta', action: () => revealGame(gameId) },
    { label: 'Abrir tienda', action: () => openStore(gameId) },
    { label: 'Buscar imágenes en la carpeta', action: () => detectArt(gameId) },
    { label: 'Subir carátula…', action: async () => {
      const { pickFile } = await import('../util.js');
      const file = await pickFile('image/*');
      if (file) await uploadArt(gameId, 'cover', file);
    } },
    { sep: true },
    { label: game.hidden ? 'Mostrar en la biblioteca' : 'Ocultar de la biblioteca', action: async () => {
      const { api } = await import('../api.js');
      const { refresh } = await import('../store.js');
      await api.updateGame(gameId, { hidden: !game.hidden });
      toast(game.hidden ? 'El juego vuelve a mostrarse' : 'El juego quedó oculto', { type: 'ok' });
      await refresh({ quiet: true });
    } },
    { label: 'Quitar de la biblioteca', danger: true, action: () => deleteGame(gameId) },
  ]);
}
