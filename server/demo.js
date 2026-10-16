/**
 * Biblioteca de demostracion.
 * Permite ver y probar la aplicacion (estadisticas, sesiones, filtros) sin
 * depender de que el equipo tenga juegos instalados.
 * Los datos son ficticios y se marcan con demo: true.
 */
import { uid, dayKey, nowIso } from './util.js';
import { normalizeGame } from './store.js';

/** PRNG determinista para que la demo se vea igual en cada equipo. */
function makeRandom(seed = 20240516) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const DEMO_GAMES = [
  ['Hollow Depths', 'steam', ['metroidvania', 'soulslike'], 'completed', 84, 7.6],
  ['Starlight Drifter', 'steam', ['espacial', 'supervivencia'], 'playing', 61, 5.3],
  ['Paper Kingdoms', 'epic', ['estrategia', 'turnos'], 'backlog', 0, 0],
  ['Neon Circuit Racer', 'steam', ['carreras', 'arcade'], 'playing', 23, 8.1],
  ['The Quiet Orchard', 'gog', ['relajante', 'granja'], 'completed', 47, 8.8],
  ['Ironclad Tactics', 'steam', ['estrategia', 'tactico'], 'onhold', 12, 6.4],
  ['Echoes of Vantyr', 'steam', ['rpg', 'mundo abierto'], 'playing', 132, 7.9],
  ['Pocket Dungeon ++', 'itch', ['roguelike', 'pixel'], 'completed', 19, 8.4],
  ['Harbor Lines', 'gog', ['logistica', 'simulacion'], 'backlog', 0, 0],
  ['Crimson Verdant', 'steam', ['accion', 'cooperativo'], 'abandoned', 4, 6.2],
  ['Skybound Cartographers', 'epic', ['exploracion', 'aventura'], 'backlog', 0, 0],
  ['Metro 17', 'steam', ['terror', 'narrativo'], 'completed', 9.1, 8.6],
  ['Grain & Grit', 'gog', ['construccion', 'gestion'], 'playing', 41, 7.1],
  ['Autumn Luthier', 'steam', ['musica', 'relajante'], 'onhold', 3, 5.8],
  ['Voidbound Courier', 'steam', ['espacial', 'exploracion'], 'playing', 28, 7.4],
  ['Terraform Blues', 'epic', ['terraformacion', 'simulacion'], 'backlog', 0, 0],
  ['Chrome Wasteland', 'steam', ['shooter', 'post apocaliptico'], 'completed', 33, 8.2],
  ['Small Hours Detective', 'itch', ['misterio', 'narrativo'], 'completed', 6.2, 9],
  ['Foundry of Kings', 'steam', ['automatizacion', 'gestion'], 'playing', 187, 8.9],
  ['Lantern Pass', 'gog', ['puzzle', 'aventura'], 'backlog', 0, 0],
  ['Rustbelt Rally', 'steam', ['carreras', 'multijugador'], 'onhold', 15, 5.5],
  ['Mycelium Network', 'steam', ['estrategia', 'biologico'], 'playing', 22, 7.2],
  ['Sunless Bazaar', 'epic', ['roguelike', 'comercio'], 'backlog', 0, 0],
  ['Deep Freeze Protocol', 'steam', ['supervivencia', 'cooperativo'], 'playing', 54, 7.7],
  ['Pixel Smith', 'itch', ['gestion', 'pixel'], 'completed', 11, 8],
  ['Glacier Line', 'steam', ['trenes', 'simulacion'], 'onhold', 8.4, 6.9],
  ['Nomad Fleet', 'epic', ['flota', 'exploracion'], 'wishlist', 0, 0],
  ['Bitter Harvest', 'gog', ['terror', 'granja'], 'completed', 7.3, 7.8],
  ['Orbital Cartel', 'steam', ['espacial', 'economia'], 'playing', 76, 8.1],
  ['Papercraft Skies', 'steam', ['aventura', 'cooperativo'], 'backlog', 0, 0],
  ['Deadlight Arcade', 'steam', ['arcade', 'retro'], 'completed', 13, 7],
  ['Mossgate', 'epic', ['metroidvania', 'pixel'], 'playing', 18, 7.5],
  ['Tidal Engineer', 'steam', ['ingenieria', 'puzzle'], 'backlog', 0, 0],
  ['Copper Canyon', 'gog', ['western', 'accion'], 'onhold', 5.6, 6.1],
  ['Signal & Static', 'itch', ['terror', 'psicologico'], 'completed', 4.4, 8.3],
  ['Grand Bazaar Tycoon', 'steam', ['gestion', 'economia'], 'playing', 96, 7.3],
  ['Winterlight', 'epic', ['narrativo', 'relajante'], 'backlog', 0, 0],
  ['Rusty Submarine', 'steam', ['supervivencia', 'cooperativo'], 'playing', 31, 6.8],
  ['Verdant Protocol', 'steam', ['estrategia', 'ciencia ficcion'], 'completed', 26, 8.5],
  ['Midnight Alley Cats', 'itch', ['exploracion', 'relajante'], 'completed', 2.8, 8.8],
];

const PLAY_STYLE = {
  binge: (rnd) => 1.5 + rnd() * 2.5,
  steady: (rnd) => 0.6 + rnd() * 1.2,
};

export function buildDemoGames() {
  const rnd = makeRandom();
  const games = [];

  DEMO_GAMES.forEach(([name, platform, genres, status, hours, rating], index) => {
    const game = normalizeGame({
      id: uid('demo'),
      name,
      platform,
      status,
      rating: hours, /* se sobrescribe abajo */
      genres,
      tags: genres.slice(0, 2),
      developers: [],
      releaseDate: `${2016 + (index % 9)}-${String(((index * 3) % 12) + 1).padStart(2, '0')}-15`,
      favorite: index % 7 === 0,
      demo: true,
      addedAt: new Date(Date.now() - (index + 2) * 86400000 * (1 + (index % 5))).toISOString(),
      description: `Entrada de ejemplo: ${name}. Los datos de demostracion se pueden borrar desde Ajustes.`,
      extra: { demoNote: 'Datos ficticios para probar la aplicacion' },
    });
    game.rating = rating;
    game.playtimeSeconds = Math.round(hours * 3600);

    /* sesiones coherentes con el total de horas */
    const totalSeconds = game.playtimeSeconds;
    if (totalSeconds > 0) {
      const sessionCount = Math.max(1, Math.min(24, Math.round(totalSeconds / 5400)));
      const style = PLAY_STYLE[index % 2 === 0 ? 'binge' : 'steady'];
      let remaining = totalSeconds;
      const sessions = [];
      let daysBack = 3 + (index % 12) * 4;
      for (let i = 0; i < sessionCount; i++) {
        const isLast = i === sessionCount - 1;
        const raw = style(rnd) * 3600;
        const seconds = isLast ? remaining : Math.min(remaining - 600, Math.round(raw));
        if (seconds <= 0) break;
        remaining -= seconds;
        const start = new Date();
        start.setHours(18 + (index % 4), (index * 13) % 60, 0, 0);
        start.setDate(start.getDate() - daysBack - (i % 3));
        const end = new Date(start.getTime() + seconds * 1000);
        sessions.push({ start: start.toISOString(), end: end.toISOString(), seconds: Math.round(seconds), simulated: true });
        daysBack += 2 + (i % 4);
      }
      game.sessions = sessions.sort((a, b) => new Date(a.start) - new Date(b.start));
      const last = game.sessions[game.sessions.length - 1];
      game.lastPlayed = last ? last.end : null;
      game.firstPlayed = game.sessions[0]?.start || null;
      game.playCount = game.sessions.length;
      game.playtimeSeconds = game.sessions.reduce((sum, s) => sum + s.seconds, 0);
    }
    games.push(game);
  });

  return games;
}

/** Cierra la ultima sesion de demo para que Activity tenga datos de hoy. */
export function touchToday(games) {
  const today = dayKey();
  const target = games.find((g) => g.status === 'playing' && g.playtimeSeconds > 3600);
  if (!target) return games;
  const hasToday = (target.sessions || []).some((s) => dayKey(s.start) === today);
  if (hasToday) return games;
  const start = new Date();
  start.setHours(Math.max(0, start.getHours() - 2), 0, 0, 0);
  target.sessions.push({
    start: start.toISOString(),
    end: nowIso(),
    seconds: 5400,
    simulated: true,
  });
  target.playtimeSeconds = target.sessions.reduce((sum, s) => sum + s.seconds, 0);
  target.lastPlayed = nowIso();
  return games;
}
