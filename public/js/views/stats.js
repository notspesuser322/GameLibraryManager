/* Vista de estadísticas: totales, distribución y rankings. */
import { state } from '../store.js';
import { esc, fmtDuration, fmtHours, fmtBytes } from '../util.js';
import { bars, donut, statCard, miniList, emptyState } from '../components.js';
import { openGameDetail } from './game.js';
import { updateQuery, setView } from '../store.js';

export function renderStats(root) {
  const stats = state.stats;
  if (!stats) {
    root.innerHTML = emptyState('Cargando estadísticas…', 'Un momento.');
    return;
  }
  const totals = stats.totals;
  const platformRows = Object.entries(stats.byPlatform)
    .map(([id, data]) => {
      const meta = state.platforms.find((p) => p.id === id) || { label: id, color: '#8d93a1' };
      return { id, label: meta.label, color: meta.color, value: data.seconds, count: data.count };
    })
    .sort((a, b) => b.value - a.value);

  const statusSegments = state.statuses.map((status) => ({
    label: status.label,
    color: status.color,
    value: stats.byStatus[status.id] || 0,
  })).filter((s) => s.value > 0);

  const months = stats.months || [];
  const maxMonth = Math.max(1, ...months.map((m) => m.count));

  root.innerHTML = `
    <div class="view-head">
      <div>
        <h1>Estadísticas</h1>
        <p>Resumen de la colección y del tiempo invertido</p>
      </div>
    </div>

    <div class="grid-3">
      ${statCard('Juegos', String(totals.games), totals.hidden ? `${totals.hidden} ocultos` : 'en la biblioteca')}
      ${statCard('Tiempo total', fmtDuration(totals.seconds, 'long'), `media ${fmtDuration(totals.avgSeconds, 'long')} por juego`)}
      ${statCard('Sesiones', String(totals.sessions))}
      ${statCard('Completados', String(totals.completed))}
      ${statCard('Sin jugar', String(totals.neverPlayed), 'pendientes de estreno')}
      ${statCard('Favoritos', String(totals.favorites))}
    </div>

    <div class="grid-2 mt">
      <div class="panel">
        <h3>Distribución por estado</h3>
        ${statusSegments.length
          ? donut(statusSegments, 'juegos', String(totals.games))
          : '<p class="muted tiny">Sin datos.</p>'}
      </div>
      <div class="panel">
        <h3>Tiempo por plataforma</h3>
        ${platformRows.length
          ? bars(platformRows, { formatter: (value, row) => fmtHours(value) })
          : '<p class="muted tiny">Sin datos.</p>'}
      </div>
    </div>

    <div class="grid-2 mt">
      <div class="panel">
        <h3>Juegos por plataforma</h3>
        ${bars(platformRows.map((row) => ({ ...row, value: row.count })), { formatter: (value) => `${value}` })}
      </div>
      <div class="panel">
        <h3>Incorporaciones por mes</h3>
        <div class="spark" style="height:96px">
          ${months.map((month) => `<i style="height:${Math.max(3, (month.count / maxMonth) * 100)}%" title="${esc(month.month)}: ${month.count}"></i>`).join('')}
        </div>
        <div class="inline-actions mt tiny muted">
          <span>${esc(months[0]?.month || '')}</span><span style="flex:1"></span><span>${esc(months[months.length - 1]?.month || '')}</span>
        </div>
      </div>
    </div>

    <div class="section-title"><h2>Ranking de tiempo jugado</h2></div>
    ${stats.top.length ? miniListInteractive(stats.top) : '<p class="muted tiny">Sin datos.</p>'}

    <div class="section-title"><h2>Etiquetas y géneros más usados</h2></div>
    <div class="panel">
      ${stats.byTag.length
        ? `<div class="tag-cloud">${stats.byTag.map((tag) => `<button data-tag="${esc(tag.tag)}">${esc(tag.tag)}<b>${tag.count}</b></button>`).join('')}</div>`
        : '<p class="muted tiny">Agrega etiquetas o géneros a tus juegos para verlos aquí.</p>'}
    </div>

    <div class="section-title"><h2>Almacenamiento</h2></div>
    <div class="panel">
      <p class="muted tiny">El tamaño se calcula cuando se escanea la carpeta de un juego (arranque, escaneo profundo o “Analizar carpeta” en la ficha).</p>
      <p><b>${esc(fmtBytes(Object.values(stats.byPlatform).reduce((sum, p) => sum + (p.bytes || 0), 0)))}</b>
      <span class="muted tiny">registrados en ${Object.keys(stats.byPlatform).length} plataformas</span></p>
    </div>
  `;

  root.querySelectorAll('[data-tag]').forEach((button) => {
    button.addEventListener('click', () => {
      updateQuery({ tag: button.dataset.tag });
      setView('library');
    });
  });
}

function miniListInteractive(items) {
  const games = items.map((item) => {
    const full = state.games.find((g) => g.id === item.id);
    return full || { id: item.id, name: item.name, platformLabel: item.platform, cover: item.cover, playtimeSeconds: item.seconds };
  });
  return `<div class="list">${games.map((game, index) => `
    <div class="row" data-game="${game.id}" style="grid-template-columns:46px 1fr 120px 120px;cursor:pointer">
      <img src="/api/games/${game.id}/cover" alt="" loading="lazy">
      <div class="name"><b>${index + 1}. ${esc(game.name)}</b><span>${esc(game.platformLabel || game.platform || '')}</span></div>
      <div class="cell">${esc(fmtHours(game.playtimeSeconds || game.seconds || 0))}</div>
      <div class="cell right">${game.pathExists === false ? '<span class="muted tiny">ruta faltante</span>' : ''}</div>
    </div>`).join('')}</div>`;
}
