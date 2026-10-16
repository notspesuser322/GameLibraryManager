/* Vista de actividad: racha, mapa de calor, sesiones recientes. */
import { state, loadActivity, liveEntries, elapsedSeconds } from '../store.js';
import { esc, fmtDuration, fmtHours, fmtDate, relTime, humanizeDay, fmtDateTime } from '../util.js';
import { heatmap, statCard, emptyState, coverImg, miniList } from '../components.js';
import { stopGame } from '../actions.js';
import { openGameDetail } from './game.js';

export function renderActivity(root) {
  const stats = state.stats;
  const activity = state.activity;
  const days = stats?.activity?.last90 || [];
  const last30 = stats?.activity?.last30 || [];
  const total30 = last30.reduce((sum, d) => sum + d.seconds, 0);
  const today = last30[last30.length - 1]?.seconds || 0;
  const week = last30.slice(-7).reduce((sum, d) => sum + d.seconds, 0);
  const running = liveEntries();
  const maxDay = Math.max(1, ...last30.map((d) => d.seconds));

  root.innerHTML = `
    <div class="view-head">
      <div>
        <h1>Actividad</h1>
        <p>Tu ritmo de juego de los últimos tres meses</p>
      </div>
    </div>

    <div class="grid-3">
      ${statCard('Hoy', today ? fmtDuration(today, 'long') : 'sin jugar', today ? 'sesión registrada' : 'ningún juego abierto hoy')}
      ${statCard('Últimos 7 días', week ? fmtDuration(week, 'long') : '—')}
      ${statCard('Últimos 30 días', total30 ? fmtDuration(total30, 'long') : '—')}
      ${statCard('Racha', `${stats?.activity?.streak || 0} días`, 'días consecutivos jugando')}
    </div>

    ${running.length ? `
      <div class="section-title"><h2>Jugando ahora</h2></div>
      <div class="list">
        ${running.map(({ gameId, game, live }) => `
          <div class="row" data-game="${gameId}" style="grid-template-columns:46px 1fr 120px 120px">
            ${game ? coverImg(game) : '<span></span>'}
            <div class="name"><b>${esc(game?.name || gameId)}</b><span>${esc(live.method || 'sesión')}</span></div>
            <div class="cell" data-live-game="${gameId}"><span data-live-clock>${fmtDuration(elapsedSeconds(live), 'clock')}</span></div>
            <div class="cell right"><button class="btn danger small" data-action="stop" data-game="${gameId}">Detener</button></div>
          </div>`).join('')}
      </div>` : ''}

    <div class="section-title"><h2>Mapa de calor</h2><span class="tiny muted">cada cuadro es un día</span></div>
    <div class="panel">${heatmap(days)}</div>

    <div class="section-title"><h2>Últimos 30 días</h2></div>
    <div class="panel">
      <div class="spark">${last30.map((day) => `<i style="height:${Math.max(4, (day.seconds / maxDay) * 100)}%" title="${esc(day.day)}: ${esc(fmtDuration(day.seconds, 'long'))}"></i>`).join('')}</div>
      <div class="inline-actions mt tiny muted">
        <span>${esc(humanizeDay(last30[0]?.day || ''))}</span>
        <span style="flex:1"></span>
        <span>${esc(humanizeDay(last30[last30.length - 1]?.day || ''))}</span>
      </div>
    </div>

    <div class="section-title">
      <h2>Sesiones recientes</h2>
      <span class="spacer" style="flex:1"></span>
      <button class="btn small ghost" data-action="reload-activity">Actualizar</button>
    </div>
    ${activity?.sessions?.length
      ? `<div class="panel" style="padding:8px">
          ${activity.sessions.slice(0, 40).map((session) => `
            <div class="session-row" data-game="${session.gameId}">
              <img src="${session.cover}" alt="" loading="lazy">
              <div>
                <b style="display:block;font-size:13.5px">${esc(session.game)}</b>
                <span class="when">${esc(fmtDateTime(session.start))} · ${esc(relTime(session.start))}</span>
              </div>
              <div class="tiny muted">${esc(session.detected || (session.simulated ? 'ejemplo' : 'detectado'))}</div>
              <div class="dur">${esc(fmtDuration(session.seconds, 'long'))}</div>
            </div>`).join('')}
        </div>`
      : emptyState('Sin sesiones todavía', 'Cuando abras un juego desde Ludoteca, la sesión se registra automáticamente aquí.')}

    <div class="section-title"><h2>Más jugados</h2></div>
    ${(stats?.top || []).length
      ? miniList(stats.top.slice(0, 5), (game) => esc(fmtHours(game.seconds)))
      : '<p class="muted tiny">Sin datos de tiempo todavía.</p>'}
  `;

  root.querySelector('[data-action="reload-activity"]')?.addEventListener('click', () => loadActivity());
  root.querySelectorAll('[data-action="stop"]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      stopGame(button.dataset.game);
    });
  });
  root.querySelectorAll('[data-game]').forEach((node) => {
    node.addEventListener('click', (event) => {
      if (event.target.closest('[data-action]')) return;
      openGameDetail(node.dataset.game);
    });
  });
}
