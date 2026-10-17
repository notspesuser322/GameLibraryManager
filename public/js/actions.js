/* Acciones sobre los juegos: lanzar, detener, favoritos, estado, carátulas… */
import { api } from './api.js';
import { state, emit, refresh, refreshGames, isRunning, liveFor, statusMeta, markStopping } from './store.js';
import { toast, confirmDialog, readAsDataUrl, esc, fmtDuration, relTime } from './util.js';

export async function launchGame(gameId) {
  const game = state.games.find((g) => g.id === gameId);
  if (!game) return;
  if (isRunning(gameId)) return stopGame(gameId);
  try {
    const result = await api.launch(gameId);
    const now = Date.now();
    state.launcher.sessions[gameId] = {
      sessionId: result.session?.id || 'local',
      startedAt: new Date(now).toISOString(),
      elapsedSeconds: 0,
      method: 'iniciando',
      pid: result.session?.pid || null,
      simulated: Boolean(result.session?.simulated),
    };
    state.fetchedAt = now;
    if (game.status === 'backlog' || game.status === 'wishlist') game.status = 'playing';
    emit('change');
    toast(`Iniciando ${game.name}`, { type: 'ok', title: 'Sesión abierta' });
  } catch (err) {
    toast(err.message, { type: 'err', title: 'No se pudo iniciar' });
  }
}

export async function stopGame(gameId) {
  const game = state.games.find((g) => g.id === gameId);
  const live = liveFor(gameId);
  markStopping(gameId); /* el juego desaparece al instante, aunque el proceso tarde en morir */
  try {
    await api.stop(gameId);
  } catch (err) {
    toast(err.message, { type: 'err', title: 'No se pudo detener' });
    return;
  }
  const elapsed = live ? Math.round((live.elapsedSeconds || 0) + (Date.now() - state.fetchedAt) / 1000) : 0;
  delete state.launcher.sessions[gameId];
  state.fetchedAt = Date.now();
  emit('change');
  toast(`${game?.name || 'Juego'} · ${fmtDuration(elapsed, 'long')}`, { type: 'ok', title: 'Sesión cerrada' });
  refresh({ quiet: true });
}

export async function toggleFavorite(gameId) {
  const game = state.games.find((g) => g.id === gameId);
  if (!game) return;
  game.favorite = !game.favorite;
  emit('change');
  await api.updateGame(gameId, { favorite: game.favorite });
}

export async function setStatus(gameId, status) {
  const game = state.games.find((g) => g.id === gameId);
  if (!game) return;
  game.status = status;
  emit('change');
  await api.updateGame(gameId, { status });
  toast(`${game.name}: ${statusMeta(status).label}`, { type: 'ok' });
  refresh({ quiet: true });
}

export async function adjustPlaytime(gameId, seconds) {
  const game = state.games.find((g) => g.id === gameId);
  if (!game) return;
  const value = Math.max(0, (game.storedPlaytimeSeconds || 0) + seconds);
  await api.updateGame(gameId, { playtimeSeconds: value });
  await refresh({ quiet: true });
}

export async function deleteGame(gameId, { skipConfirm = false } = {}) {
  const game = state.games.find((g) => g.id === gameId);
  if (!skipConfirm) {
    const ok = await confirmDialog(`¿Quitar “${game?.name}” de la biblioteca? No se borran archivos del disco.`, {
      title: 'Quitar juego', confirmLabel: 'Quitar', danger: true,
    });
    if (!ok) return;
  }
  const wasFavorite = game?.favorite;
  try {
    await api.deleteGame(gameId);
    if (wasFavorite) emit('favorite-removed');
    toast(`“${game?.name}” salió de la biblioteca`, { type: 'ok' });
    await refresh({ quiet: true });
  } catch (err) {
    toast(err.message, { type: 'err', title: 'No se pudo quitar' });
  }
}

export async function revealGame(gameId) {
  try {
    await api.reveal(gameId);
    toast('Carpeta abierta en el explorador', { type: 'ok' });
  } catch (err) {
    toast(err.message, { type: 'err', title: 'No se pudo abrir la carpeta' });
  }
}

export async function openStore(gameId) {
  try {
    await api.openStore(gameId);
    toast('Abriendo la tienda…', { type: 'ok' });
  } catch (err) {
    toast(err.message, { type: 'err', title: 'Sin tienda asociada' });
  }
}

export async function detectArt(gameId) {
  try {
    const result = await api.detectArt(gameId);
    if (!result.found) toast('No se encontraron imágenes en la carpeta del juego', { type: 'err', title: 'Sin resultados' });
    else {
      toast(`${result.found} imagen(es) aplicadas`, { type: 'ok' });
      await refresh({ quiet: true });
    }
  } catch (err) {
    toast(err.message, { type: 'err' });
  }
}

export async function uploadArt(gameId, kind, file) {
  try {
    const dataUrl = await readAsDataUrl(file);
    await api.uploadArt(gameId, kind, dataUrl);
    toast('Imagen actualizada', { type: 'ok' });
    await refresh({ quiet: true });
  } catch (err) {
    toast(err.message, { type: 'err', title: 'No se pudo subir la imagen' });
  }
}

export async function resetArt(gameId, kind) {
  try {
    await api.resetArt(gameId, kind);
    toast('Se restauró la imagen generada', { type: 'ok' });
    await refresh({ quiet: true });
  } catch (err) {
    toast(err.message, { type: 'err' });
  }
}

export async function addPlaytime(gameId) {
  const game = state.games.find((g) => g.id === gameId);
  if (!game) return;
  const { promptDialog } = await import('./util.js');
  const raw = await promptDialog('Horas jugadas para esta sesión', { title: `Registrar sesión · ${game.name}`, value: '1', confirmLabel: 'Registrar' });
  if (raw === null) return;
  const hours = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(hours) || hours <= 0) {
    toast('Cantidad de horas inválida', { type: 'err' });
    return;
  }
  const seconds = Math.round(hours * 3600);
  const end = new Date();
  const start = new Date(end.getTime() - seconds * 1000);
  try {
    await api.addSession({ gameId, seconds, start: start.toISOString(), end: end.toISOString() });
    toast(`${hours} h registradas en ${game.name}`, { type: 'ok' });
    await refresh({ quiet: true });
  } catch (err) {
    toast(err.message, { type: 'err' });
  }
}
