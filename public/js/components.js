/* Componentes reutilizables de la interfaz. */
import { esc, fmtBytes, fmtDate, fmtDuration, relTime, fmtHours } from './util.js';
import { isRunning, liveFor, statusMeta, elapsedSeconds, state } from './store.js';

export function coverImg(game, attrs = {}) {
  const extra = Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
  return `<img src="/api/games/${game.id}/cover" alt="Carátula de ${esc(game.name)}" loading="lazy" decoding="async" ${extra}>`;
}

export function liveClock(gameId) {
  const live = liveFor(gameId);
  if (!live) return '';
  return `<span class="pill running" data-live-game="${gameId}" title="Sesión en curso"><span class="pulse"></span><span data-live-clock>${fmtDuration(elapsedSeconds(live), 'clock')}</span></span>`;
}

export function statusChip(game) {
  const meta = statusMeta(game.status);
  return `<span class="pill status" style="border-color:${meta.color}55;color:${meta.color}">${esc(meta.label)}</span>`;
}

export function gameCard(game) {
  const running = isRunning(game.id);
  const platform = { label: game.platformLabel, color: game.platformColor };
  return `<article class="card ${game.pathExists === false ? 'card-missing' : ''}" data-game="${game.id}" tabindex="0" role="button" aria-label="${esc(game.name)}">
    ${coverImg(game)}
    <div class="card-top">
      ${running ? liveClock(game.id) : ''}
      <span class="spacer"></span>
      ${game.favorite ? '<span class="pill fav" title="Favorito">★</span>' : ''}
      ${state.query.hidden && game.hidden ? '<span class="pill" title="Oculto">oculto</span>' : ''}
    </div>
    <div class="card-body">
      <h3>${esc(game.name)}</h3>
      <div class="sub">
        <span class="plat"><i style="background:${platform.color}"></i>${esc(platform.label)}</span>
        <span class="hours" title="Tiempo de juego">${game.playtimeSeconds ? esc(fmtHours(game.playtimeSeconds)) : '—'}</span>
      </div>
    </div>
    <div class="card-actions">
      <button class="btn ${running ? 'danger' : 'primary'} small" data-action="${running ? 'stop' : 'launch'}">
        ${running ? 'Detener' : 'Jugar'}
      </button>
      <button class="btn ghost small" data-action="details" title="Ver ficha">Ficha</button>
    </div>
  </article>`;
}

export const LIST_COLUMNS = [
  { id: 'name', label: 'Juego' },
  { id: 'platform', label: 'Plataforma', optional: true },
  { id: 'playtime', label: 'Tiempo', numeric: true },
  { id: 'lastPlayed', label: 'Última vez', numeric: true, optional: true },
  { id: 'size', label: 'Tamaño', numeric: true, optional: true },
  { id: 'actions', label: '' },
];

export function listHeader(sort, direction) {
  return `<div class="list-head">
    <span></span>
    ${LIST_COLUMNS.map((col) => {
      if (!col.id || col.id === 'actions') return `<span class="${col.optional ? 'optional' : ''}"></span>`;
      const active = sort === col.id;
      return `<button class="${col.optional ? 'optional' : ''} ${col.numeric ? 'right' : ''} ${active ? 'active' : ''}" data-sort="${col.id}">
        ${esc(col.label)}${active ? (direction === 'asc' ? ' ↑' : ' ↓') : ''}
      </button>`;
    }).join('')}
  </div>`;
}

export function gameRow(game) {
  const running = isRunning(game.id);
  const platform = { label: game.platformLabel, color: game.platformColor };
  const status = statusMeta(game.status);
  return `<div class="row" data-game="${game.id}" role="button" tabindex="0">
    ${coverImg(game)}
    <div class="name">
      <b>${game.favorite ? '<span style="color:var(--warn)">★ </span>' : ''}${esc(game.name)}</b>
      <span>${esc(status.label)}${game.genres?.length ? ` · ${esc(game.genres.slice(0, 2).join(', '))}` : ''}</span>
    </div>
    <div class="cell optional"><span class="plat" style="color:${platform.color}"><i style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${platform.color};margin-right:6px"></i>${esc(platform.label)}</span></div>
    <div class="cell">${running ? `<span data-live-game="${game.id}" style="color:var(--ok)"><span data-live-clock>${fmtDuration(elapsedSeconds(liveFor(game.id)), 'clock')}</span></span>` : esc(game.playtimeSeconds ? fmtHours(game.playtimeSeconds) : '—')}</div>
    <div class="cell optional">${esc(game.lastPlayed ? relTime(game.lastPlayed) : 'nunca')}</div>
    <div class="cell optional">${esc(game.sizeBytes ? fmtBytes(game.sizeBytes) : '—')}</div>
    <div class="cell right">
      <button class="btn ${running ? 'danger' : 'ghost'} small" data-action="${running ? 'stop' : 'launch'}">${running ? 'Detener' : 'Jugar'}</button>
    </div>
  </div>`;
}

export function emptyState(title, message, actionsHtml = '') {
  return `<div class="empty">
    <h3>${esc(title)}</h3>
    <p>${esc(message)}</p>
    <div class="inline-actions">${actionsHtml}</div>
  </div>`;
}

export function statCard(label, value, hint = '') {
  return `<div class="stat"><b>${esc(value)}</b><span>${esc(label)}</span>${hint ? `<em>${esc(hint)}</em>` : ''}</div>`;
}

export function bars(rows, { formatter = (v) => String(v), limit = 8 } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return `<div class="bars">${rows.slice(0, limit).map((row) => `
    <div class="bar-row">
      <span title="${esc(row.label)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(row.label)}</span>
      <span class="track"><span class="fill" style="width:${Math.max(2, (row.value / max) * 100)}%${row.color ? `;background:linear-gradient(90deg,${row.color},${row.color}88)` : ''}"></span></span>
      <span class="val">${esc(formatter(row.value, row))}</span>
    </div>`).join('')}</div>`;
}

export function donut(segments, centerLabel, centerValue) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  let acc = 0;
  const stops = segments.map((seg) => {
    const start = (acc / total) * 360;
    acc += seg.value;
    const end = (acc / total) * 360;
    return `${seg.color} ${start}deg ${end}deg`;
  }).join(', ');
  return `<div class="donut-wrap">
    <div class="donut" style="background:conic-gradient(${stops || '#2a2f45 0deg 360deg'})">
      <div class="center"><div><b>${esc(centerValue)}</b><span>${esc(centerLabel)}</span></div></div>
    </div>
    <div class="legend">
      ${segments.filter((s) => s.value > 0).map((s) => `<div><i style="background:${s.color}"></i><span>${esc(s.label)}</span><span style="margin-left:auto;color:var(--muted-2)">${s.value}</span></div>`).join('')}
    </div>
  </div>`;
}

export function heatmap(days) {
  const max = Math.max(3600, ...days.map((d) => d.seconds));
  const cells = days.map((day) => {
    const ratio = day.seconds / max;
    const level = day.seconds === 0 ? 0 : ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.8 ? 3 : 4;
    return `<i data-level="${level}" title="${esc(day.day)}: ${day.seconds ? fmtDuration(day.seconds, 'long') : 'sin actividad'}"></i>`;
  }).join('');
  return `<div><div class="heatmap">${cells}</div>
    <div class="heatmap-legend"><span>menos</span>
      <i style="width:11px;height:11px;border-radius:3px;background:rgba(255,255,255,0.06);display:inline-block"></i>
      <i style="width:11px;height:11px;border-radius:3px;background:color-mix(in srgb, var(--accent) 40%, transparent);display:inline-block"></i>
      <i style="width:11px;height:11px;border-radius:3px;background:color-mix(in srgb, var(--accent) 70%, transparent);display:inline-block"></i>
      <i style="width:11px;height:11px;border-radius:3px;background:var(--accent);display:inline-block"></i>
      <span>más</span>
      <span style="margin-left:auto">últimos 90 días</span>
    </div>
  </div>`;
}

export function miniList(games, mapper) {
  return `<div class="list">${games.map((game) => `
    <div class="row" data-game="${game.id}" style="grid-template-columns:46px 1fr auto;cursor:pointer">
      ${coverImg(game)}
      <div class="name"><b>${esc(game.name)}</b><span>${esc(game.platformLabel)}</span></div>
      <div class="cell right">${mapper ? mapper(game) : esc(fmtHours(game.playtimeSeconds))}</div>
    </div>`).join('')}</div>`;
}

export function gameCoverThumb(game) {
  return coverImg(game, { style: 'width:34px;height:46px;border-radius:6px;object-fit:cover' });
}

export function sessionRow(session) {
  return `<div class="session-row" data-game="${session.gameId}">
    <img src="/api/games/${session.gameId}/cover" alt="" loading="lazy">
    <div>
      <b style="display:block;font-size:13.5px">${esc(session.game)}</b>
      <span class="when">${esc(fmtDate(session.start, { weekday: 'short', hour: '2-digit', minute: '2-digit' }))}</span>
    </div>
    <div class="tiny muted">${esc(session.detected || 'detectado')}</div>
    <div class="dur">${esc(fmtDuration(session.seconds, 'long'))}</div>
  </div>`;
}
