/* Ficha de juego: detalle, sesiones, edición e imágenes. */
import { api } from '../api.js';
import { state, refresh, isRunning, liveFor, elapsedSeconds } from '../store.js';
import {
  esc, fmtBytes, fmtDate, fmtDateTime, fmtDuration, fmtHours, openModal, relTime,
  toast, confirmDialog, pickFile,
} from '../util.js';
import { coverImg, sessionRow } from '../components.js';
import {
  addPlaytime, deleteGame, detectArt, launchGame, openStore, resetArt, revealGame,
  setStatus, stopGame, toggleFavorite, uploadArt,
} from '../actions.js';

let currentTab = 'resumen';

export function openGameDetail(gameId, { tab = 'resumen' } = {}) {
  currentTab = tab;
  const game = state.games.find((g) => g.id === gameId);
  if (!game) {
    toast('El juego ya no está en la vista actual', { type: 'err' });
    return;
  }

  const modal = openModal({
    title: game.name,
    size: 'wide',
    body: renderDetail(game),
    footer: renderFooter(game),
  });

  const rerender = () => {
    const fresh = state.games.find((g) => g.id === gameId);
    if (!fresh) {
      modal.close();
      return;
    }
    modal.head.querySelector('h2').textContent = fresh.name;
    modal.body.innerHTML = renderDetail(fresh);
    modal.footer.innerHTML = renderFooter(fresh);
    wire(modal, fresh);
  };

  function wire(scope, current) {
    scope.body.querySelectorAll('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        currentTab = button.dataset.tab;
        rerender();
      });
    });

    /* los botones pueden estar en el cuerpo o en el pie de la ventana */
    for (const area of [scope.body, scope.footer]) {
      area?.querySelectorAll('[data-act]').forEach((button) => {
        button.addEventListener('click', () => handleAction(button.dataset.act, current, rerender, modal, button.dataset));
      });
    }

    scope.body.querySelector('[data-field="notes"]')?.addEventListener('blur', async (event) => {
      await api.updateGame(current.id, { notes: event.target.value });
      toast('Notas guardadas', { type: 'ok' });
    });

    scope.body.querySelector('[data-field="save-notes"]')?.addEventListener('click', async () => {
      const text = scope.body.querySelector('[data-field="notes"]')?.value || '';
      await api.updateGame(current.id, { notes: text });
      toast('Notas guardadas', { type: 'ok' });
    });

    const form = scope.body.querySelector('[data-edit-form]');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const payload = {
        name: data.name,
        platform: data.platform,
        status: data.status,
        executable: data.executable || null,
        launchArgs: data.launchArgs || '',
        workDir: data.workDir || null,
        installDir: data.installDir || null,
        launchCommand: data.launchCommand || null,
        emulatorProfileId: data.emulatorProfileId || null,
        genres: data.genres,
        tags: data.tags,
        developers: data.developers,
        publishers: data.publishers,
        releaseDate: data.releaseDate || null,
        rating: Number(data.rating) || 0,
        criticScore: Number(data.criticScore) || 0,
        description: data.description || '',
        favorite: form.querySelector('[name="favorite"]').checked,
        hidden: form.querySelector('[name="hidden"]').checked,
      };
      try {
        await api.updateGame(current.id, payload);
        toast('Cambios guardados', { type: 'ok' });
        await refresh({ quiet: true });
        rerender();
      } catch (err) {
        toast(err.message, { type: 'err', title: 'No se pudo guardar' });
      }
    });

    scope.body.querySelector('[data-act="upload-cover"]')?.addEventListener('click', async () => {
      const file = await pickFile('image/*');
      if (file) { await uploadArt(current.id, 'cover', file); rerender(); }
    });
    scope.body.querySelector('[data-act="upload-banner"]')?.addEventListener('click', async () => {
      const file = await pickFile('image/*');
      if (file) { await uploadArt(current.id, 'banner', file); rerender(); }
    });

    /* soltar una imagen sobre la ficha la usa como carátula */
    scope.body.addEventListener('dragover', (event) => {
      if (event.dataTransfer?.types?.includes('Files')) {
        event.preventDefault();
        scope.body.style.outline = '2px dashed var(--accent)';
      }
    });
    scope.body.addEventListener('dragleave', () => { scope.body.style.outline = ''; });
    scope.body.addEventListener('drop', async (event) => {
      if (!event.dataTransfer?.files?.length) return;
      event.preventDefault();
      scope.body.style.outline = '';
      await uploadArt(current.id, 'cover', event.dataTransfer.files[0]);
      rerender();
    });
  }

  wire(modal, game);
  return modal;
}

function renderFooter(game) {
  const running = isRunning(game.id);
  return `
    <button class="btn ${running ? 'danger' : 'primary'}" data-act="${running ? 'stop' : 'launch'}">
      ${running ? 'Detener' : 'Jugar ahora'}
    </button>
    <button class="btn ghost" data-act="favorite">${game.favorite ? 'Quitar de favoritos' : 'Marcar favorito'}</button>
    <button class="btn ghost" data-act="playtime">Registrar tiempo</button>
    <div style="flex:1"></div>
    <button class="btn ghost" data-act="close">Cerrar</button>`;
}

function renderDetail(game) {
  const running = isRunning(game.id);
  const live = liveFor(game.id);
  const status = state.statuses.find((s) => s.id === game.status) || { label: game.status, color: '#8d93a1' };
  return `
    <div class="detail-hero" style="background-image:url('${game.banner}')"></div>
    <div class="detail-head">
      ${coverImg(game, { class: 'cover' })}
      <div class="info">
        <h2>${esc(game.name)}</h2>
        <div class="hero-meta">
          <span class="meta-chip" style="color:${game.platformColor}">${esc(game.platformLabel)}</span>
          <span class="meta-chip" style="color:${status.color}">${esc(status.label)}</span>
          ${game.releaseDate ? `<span class="meta-chip">${esc(String(game.releaseDate).slice(0, 4))}</span>` : ''}
          ${game.rating ? `<span class="meta-chip">★ ${esc(String(game.rating))}</span>` : ''}
          ${game.pathExists === false ? '<span class="meta-chip" style="color:var(--warn)">ruta no encontrada</span>' : ''}
          ${game.demo ? '<span class="meta-chip">ejemplo</span>' : ''}
        </div>
        <div class="detail-actions">
          <button class="btn ${running ? 'danger' : 'primary'}" data-act="${running ? 'stop' : 'launch'}">
            ${running ? `Detener${live ? ` · ${fmtDuration(elapsedSeconds(live), 'clock')}` : ''}` : 'Jugar'}
          </button>
          <button class="btn ghost" data-act="favorite">${game.favorite ? '★ Favorito' : '☆ Favorito'}</button>
          <button class="btn ghost" data-act="reveal" ${game.installDir ? '' : 'disabled'}>Abrir carpeta</button>
          <button class="btn ghost" data-act="store">Tienda</button>
          <button class="btn ghost" data-act="detect-art">Buscar imágenes</button>
          <button class="btn ghost" data-act="delete">Quitar</button>
        </div>
      </div>
    </div>
    <div class="tabs">
      ${['resumen', 'sesiones', 'editar', 'imagenes'].map((tab) => `
        <button data-tab="${tab}" class="${currentTab === tab ? 'active' : ''}">${tab === 'resumen' ? 'Resumen' : tab === 'sesiones' ? 'Sesiones' : tab === 'editar' ? 'Editar' : 'Imágenes'}</button>`).join('')}
    </div>
    <div class="tab-panel">${renderTab(game, running)}</div>`;
}

function renderTab(game, running) {
  if (currentTab === 'sesiones') return renderSessions(game);
  if (currentTab === 'editar') return renderEdit(game);
  if (currentTab === 'imagenes') return renderImages(game);
  return renderSummary(game, running);
}

function renderSummary(game, running) {
  const rows = [
    ['Tiempo total', game.playtimeSeconds ? `${fmtHours(game.playtimeSeconds)} (${fmtDuration(game.playtimeSeconds, 'long')})` : 'sin registrar'],
    ['Sesiones', `${game.sessionCount}`],
    ['Última vez', game.lastPlayed ? `${relTime(game.lastPlayed)} · ${fmtDateTime(game.lastPlayed)}` : 'nunca'],
    ['Primera vez', game.firstPlayed ? fmtDate(game.firstPlayed) : '—'],
    ['Agregado', fmtDate(game.addedAt)],
    ['Tamaño', game.sizeBytes ? fmtBytes(game.sizeBytes) : '—'],
    ['Plataforma', `${game.platformLabel}${game.sourceId ? ` · id ${game.sourceId}` : ''}`],
    ['Carpeta', game.installDir ? `<code>${esc(game.installDir)}</code>` : '—'],
    ['Ejecutable', game.executable ? `<code>${esc(game.executable)}</code>` : '—'],
    ['Argumentos', game.launchArgs ? `<code>${esc(game.launchArgs)}</code>` : '—'],
    ['Comando', game.launchCommand ? `<code>${esc(game.launchCommand)}</code>` : '—'],
    ['Emulador', game.emulatorProfileName ? esc(game.emulatorProfileName) : '—'],
    ['Géneros', esc((game.genres || []).join(', ') || '—')],
    ['Etiquetas', esc((game.tags || []).join(', ') || '—')],
    ['Desarrollador', esc((game.developers || []).join(', ') || '—')],
    ['Editorial', esc((game.publishers || []).join(', ') || '—')],
  ];
  return `
    <div class="grid-2" style="align-items:start">
      <div>
        <dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
      </div>
      <div>
        <h3 style="margin:0 0 8px">Notas</h3>
        <textarea class="textarea" data-field="notes" placeholder="Progreso, pendientes, mods, códigos…">${esc(game.notes || '')}</textarea>
        <div class="inline-actions mt">
          <button class="btn small primary" data-field="save-notes">Guardar notas</button>
        </div>
        ${game.description ? `<h3 style="margin:20px 0 8px">Descripción</h3><p class="muted tiny" style="margin:0">${esc(game.description)}</p>` : ''}
        <div class="inline-actions mt">
          <button class="btn small" data-act="status-playing">Jugando</button>
          <button class="btn small" data-act="status-completed">Completado</button>
          <button class="btn small" data-act="status-backlog">Pendiente</button>
          <button class="btn small" data-act="status-onhold">En pausa</button>
          <button class="btn small" data-act="status-abandoned">Abandonado</button>
        </div>
      </div>
    </div>
    <hr class="sep">
    <h3 style="margin:0 0 10px">Últimas sesiones</h3>
    ${(game.sessions || []).length
      ? `<div class="timeline">${(game.sessions || []).slice(0, 6).map((s) => `
          <div class="timeline-day">
            <span class="day">${esc(fmtDate(s.start, { weekday: 'short', day: '2-digit', month: 'short' }))}</span>
            <span class="timeline-track"><i style="width:${Math.min(100, Math.max(6, (s.seconds / 14400) * 100))}%"></i>
              <span class="tiny muted" style="margin-left:8px">${esc(fmtDuration(s.seconds, 'long'))}</span>
            </span>
          </div>`).join('')}</div>`
      : '<p class="muted tiny">Todavía no hay sesiones registradas.</p>'}`;
}

function renderSessions(game) {
  const sessions = game.sessions || [];
  return `
    <div class="inline-actions" style="margin-bottom:14px">
      <button class="btn primary small" data-act="playtime">Registrar tiempo jugado</button>
      ${sessions.length ? '<button class="btn small danger" data-act="clear-sessions">Borrar historial</button>' : ''}
      <span class="tiny muted">Se muestran las últimas 30 sesiones.</span>
    </div>
    ${sessions.length
      ? `<div class="scroll-y">${sessions.map((session, index) => `
          <div class="session-row" style="grid-template-columns:1fr 150px 90px 34px">
            <div>
              <b style="font-size:13.5px">${esc(fmtDate(session.start, { weekday: 'long', day: '2-digit', month: 'long' }))}</b>
              <span class="when">${esc(fmtDateTime(session.start))} → ${esc(String(session.end || '').slice(11, 16))}${session.detected ? ` · ${esc(session.detected)}` : ''}</span>
            </div>
            <div class="tiny muted">${session.simulated ? 'sesión de ejemplo' : ''}</div>
            <div class="dur">${esc(fmtDuration(session.seconds, 'long'))}</div>
            <button class="icon-btn" data-act="remove-session" data-index="${index}" title="Borrar sesión">✕</button>
          </div>`).join('')}</div>`
      : '<p class="muted">Sin sesiones registradas. Todavía puedes registrar horas manualmente.</p>'}`;
}

function renderEdit(game) {
  const platformOptions = state.platforms.map((p) => `<option value="${p.id}" ${game.platform === p.id ? 'selected' : ''}>${esc(p.label)}</option>`).join('');
  const statusOptions = state.statuses.map((s) => `<option value="${s.id}" ${game.status === s.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('');
  const emulatorOptions = ['<option value="">— ninguno —</option>']
    .concat(state.settings?.emulatorProfiles?.map((p) => `<option value="${p.id}" ${game.emulatorProfileId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`) || [])
    .join('');
  return `
    <form data-edit-form class="form-grid">
      <label class="field full"><span>Nombre</span><input class="input" name="name" value="${esc(game.name)}" required></label>
      <label class="field"><span>Plataforma</span><select class="select" name="platform">${platformOptions}</select></label>
      <label class="field"><span>Estado</span><select class="select" name="status">${statusOptions}</select></label>
      <label class="field full"><span>Ejecutable</span><input class="input" name="executable" value="${esc(game.executable || '')}" placeholder="C:\\Juegos\\MiJuego\\juego.exe"></label>
      <label class="field full"><span>Argumentos de lanzamiento</span><input class="input" name="launchArgs" value="${esc(game.launchArgs || '')}" placeholder="-windowed --skip-intro"></label>
      <label class="field"><span>Carpeta de trabajo</span><input class="input" name="workDir" value="${esc(game.workDir || '')}"></label>
      <label class="field"><span>Carpeta de instalación</span><input class="input" name="installDir" value="${esc(game.installDir || '')}"></label>
      <label class="field full"><span>Comando o URI alternativo</span><input class="input" name="launchCommand" value="${esc(game.launchCommand || '')}" placeholder="steam://rungameid/123"><span class="hint">Se usa si no hay ejecutable. Marcadores: {exe} {dir} {name} {rom}</span></label>
      <label class="field"><span>Perfil de emulador</span><select class="select" name="emulatorProfileId">${emulatorOptions}</select></label>
      <label class="field"><span>Calificación personal</span><input class="input" name="rating" type="number" step="0.1" min="0" max="10" value="${esc(game.rating || 0)}"></label>
      <label class="field"><span>Géneros</span><input class="input" name="genres" value="${esc((game.genres || []).join(', '))}" placeholder="rpg, aventura"></label>
      <label class="field"><span>Etiquetas</span><input class="input" name="tags" value="${esc((game.tags || []).join(', '))}" placeholder="cooperativo, pendiente"></label>
      <label class="field"><span>Desarrollador</span><input class="input" name="developers" value="${esc((game.developers || []).join(', '))}"></label>
      <label class="field"><span>Editorial</span><input class="input" name="publishers" value="${esc((game.publishers || []).join(', '))}"></label>
      <label class="field"><span>Lanzamiento</span><input class="input" name="releaseDate" type="date" value="${esc((game.releaseDate || '').slice(0, 10))}"></label>
      <label class="field full"><span>Descripción</span><textarea class="textarea" name="description">${esc(game.description || '')}</textarea></label>
      <div class="field full">
        <label class="switch"><input type="checkbox" name="favorite" ${game.favorite ? 'checked' : ''}><span class="txt"><b>Favorito</b><span>Aparece primero en la biblioteca</span></span></label>
        <label class="switch"><input type="checkbox" name="hidden" ${game.hidden ? 'checked' : ''}><span class="txt"><b>Oculto</b><span>No se muestra salvo que actives “mostrar ocultos”</span></span></label>
      </div>
      <div class="full inline-actions">
        <button class="btn primary" type="submit">Guardar cambios</button>
        <span class="tiny muted">El tiempo de juego se guarda aparte, en la pestaña Sesiones.</span>
      </div>
    </form>`;
}

function renderImages(game) {
  return `
    <div class="grid-2">
      <div>
        <h3>Carátula</h3>
        ${coverImg(game, { style: 'width:100%;max-width:260px;border-radius:12px;border:1px solid var(--border)' })}
        <div class="inline-actions mt">
          <button class="btn small" data-act="upload-cover">Subir imagen</button>
          <button class="btn small ghost" data-act="reset-cover">Volver a la generada</button>
        </div>
        <p class="tiny muted">También puedes soltar un archivo de imagen sobre esta ventana.</p>
      </div>
      <div>
        <h3>Fondo de la ficha</h3>
        <img src="${game.banner}" alt="Fondo de ${esc(game.name)}" style="width:100%;border-radius:12px;border:1px solid var(--border)">
        <div class="inline-actions mt">
          <button class="btn small" data-act="upload-banner">Subir fondo</button>
          <button class="btn small ghost" data-act="reset-banner">Volver al generado</button>
        </div>
      </div>
    </div>
    <hr class="sep">
    <h3>Buscar automáticamente</h3>
    <p class="tiny muted">Busca cover.jpg, folder.png, hero.jpg y otros nombres habituales dentro de la carpeta del juego.</p>
    <div class="inline-actions">
      <button class="btn small primary" data-act="detect-art">Buscar imágenes en la carpeta</button>
      <button class="btn small ghost" data-act="analyze">Analizar carpeta (peso y ejecutables)</button>
    </div>
    <div data-analyze-result></div>`;
}

async function handleAction(action, game, rerender, modal, data = {}) {
  switch (action) {
    case 'launch':
      await launchGame(game.id);
      rerender();
      break;
    case 'stop':
      await stopGame(game.id);
      rerender();
      break;
    case 'favorite':
      await toggleFavorite(game.id);
      rerender();
      break;
    case 'reveal':
      await revealGame(game.id);
      break;
    case 'store':
      await openStore(game.id);
      break;
    case 'detect-art':
      await detectArt(game.id);
      rerender();
      break;
    case 'playtime':
      await addPlaytime(game.id);
      rerender();
      break;
    case 'upload-cover': {
      const file = await pickFile('image/*');
      if (file) await uploadArt(game.id, 'cover', file);
      rerender();
      break;
    }
    case 'upload-banner': {
      const file = await pickFile('image/*');
      if (file) await uploadArt(game.id, 'banner', file);
      rerender();
      break;
    }
    case 'reset-cover':
      await resetArt(game.id, 'cover');
      rerender();
      break;
    case 'reset-banner':
      await resetArt(game.id, 'banner');
      rerender();
      break;
    case 'analyze': {
      const target = modal.body.querySelector('[data-analyze-result]');
      if (target) target.innerHTML = '<p class="tiny muted mt">Analizando…</p>';
      try {
        const result = await api.analyze(game.id);
        if (target) {
          target.innerHTML = `
            <dl class="kv mt">
              <dt>Tamaño</dt><dd>${esc(fmtBytes(result.sizeBytes))}</dd>
              <dt>Archivos</dt><dd>${result.fileCount}</dd>
              <dt>Ejecutables</dt><dd>${result.candidates.slice(0, 5).map((c) => `<code>${esc(c.name)}</code> (${c.score})`).join('<br>') || '—'}</dd>
            </dl>`;
        }
      } catch (err) {
        toast(err.message, { type: 'err' });
      }
      break;
    }
    case 'delete': {
      modal.close();
      await deleteGame(game.id);
      break;
    }
    case 'close':
      modal.close();
      break;
    case 'clear-sessions': {
      const ok = await confirmDialog('Se borrarán todas las sesiones registradas de este juego.', { title: 'Borrar historial', confirmLabel: 'Borrar', danger: true });
      if (ok) {
        await api.clearSessions(game.id);
        await refresh({ quiet: true });
        rerender();
      }
      break;
    }
    case 'remove-session': {
      await api.removeSession(game.id, Number(data.index) || 0);
      await refresh({ quiet: true });
      rerender();
      break;
    }
    case 'status-playing':
    case 'status-completed':
    case 'status-backlog':
    case 'status-onhold':
    case 'status-abandoned':
      await setStatus(game.id, action.replace('status-', ''));
      rerender();
      break;
    default:
      break;
  }
}

export { renderSessions };
