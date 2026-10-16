/**
 * Lanzamiento de juegos y medicion de tiempo de juego.
 *
 * Estrategia: se arranca el proceso en segundo plano y se vigila su ciclo de vida.
 * Muchos juegos arrancan a traves de un lanzador intermedio (Steam, Epic, Heroic)
 * que muere enseguida, por eso ademas del PID se compara la lista de procesos
 * del sistema contra la carpeta de instalacion del juego.
 */
import path from 'node:path';
import fsp from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import {
  IS_WIN, IS_MAC, normalize, existsSync, isPidAlive, killTree, listProcesses,
  openExternal, spawnDetached, execFileAsync, revealInFileManager,
} from './util.js';

const POLL_MS = 3000;
const LAUNCHER_GRACE_MS = 45_000;

export class Launcher extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.timers = new Map();
    this.log = [];
    this.running = new Map(); /* gameId -> { sessionId, startedAt, pid, method } */
    this.clock = null;
  }

  start() {
    this.stop();
    this.clock = setInterval(() => this.tick().catch(() => {}), POLL_MS);
    if (this.clock.unref) this.clock.unref();
  }

  stop() {
    if (this.clock) clearInterval(this.clock);
    this.clock = null;
  }

  /* ------------------------------------------------------------- lanzamiento */

  async launch(gameId, options = {}) {
    const game = this.store.get(gameId);
    if (!game) throw new Error('Juego no encontrado');
    if (this.store.activeFor(gameId)) throw new Error('El juego ya esta en ejecucion');

    if (game.demo || options.simulate) {
      return this.#startSimulated(game);
    }

    const plan = await this.#buildCommand(game);
    if (!plan.ok) throw new Error(plan.error);

    const session = this.store.startSession(game, {
      pid: plan.pid || null,
      process: plan.processName || null,
      match: plan.match || null,
    });

    this.running.set(game.id, {
      sessionId: session.id,
      startedAt: Date.now(),
      pid: plan.pid || null,
      method: plan.method,
      processName: plan.processName || null,
      match: plan.match || null,
      sawMatch: Boolean(plan.match),
    });

    this.#log(game, `Lanzado (${plan.method})${plan.pid ? ` pid ${plan.pid}` : ''}`);
    this.emit('session:start', { game, session });
    return session;
  }

  async #buildCommand(game) {
    const profile = this.#profileFor(game);

    /* Comando explicito del usuario */
    if (game.launchCommand && !game.executable) {
      const rendered = renderTemplate(game.launchCommand, game);
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rendered) || rendered.startsWith('lutris:') || rendered.startsWith('heroic:')) {
        this.#openUri(rendered);
        return { ok: true, method: 'uri', processName: null, match: this.#matchFor(game), uri: rendered };
      }
      const [cmd, ...args] = splitCommand(rendered);
      try {
        const child = spawnDetached(cmd, args, { cwd: game.workDir || game.installDir || undefined });
        return { ok: true, method: 'comando', pid: child.pid, processName: path.basename(cmd), match: this.#matchFor(game) };
      } catch (err) {
        return { ok: false, error: `No se pudo ejecutar el comando: ${err.message}` };
      }
    }

    /* Emulador: se arma la linea de comandos desde el perfil */
    if (profile) {
      const rendered = renderTemplate(profile.command, game);
      const [cmd, ...args] = splitCommand(rendered);
      try {
        const child = spawnDetached(cmd, args, { cwd: profile.workDir || undefined });
        return { ok: true, method: `emulador: ${profile.name}`, pid: child.pid, processName: path.basename(cmd), match: null };
      } catch (err) {
        return { ok: false, error: `No se pudo iniciar el emulador: ${err.message}` };
      }
    }

    /* Ejecutable directo */
    if (game.executable) {
      const target = renderTemplate(game.executable, game);
      if (!existsSync(target)) {
        /* puede ser un comando del sistema, no una ruta */
        if (!target.includes(path.sep) && !target.includes('/')) {
          const [cmd, ...args] = splitCommand([target, game.launchArgs].filter(Boolean).join(' '));
          try {
            const child = spawnDetached(cmd, args, { cwd: game.workDir || undefined });
            return { ok: true, method: 'comando', pid: child.pid, processName: path.basename(cmd), match: this.#matchFor(game) };
          } catch (err) {
            return { ok: false, error: `No se pudo ejecutar: ${err.message}` };
          }
        }
        return { ok: false, error: `No se encuentra el ejecutable: ${target}` };
      }

      const workDir = game.workDir || path.dirname(target);
      const args = splitArgs(game.launchArgs || '');
      try {
        /* juegos de Windows en Linux/macOS: se intenta con Wine */
        if (!IS_WIN && target.toLowerCase().endsWith('.exe')) {
          const wine = await execFileAsync('wine', ['--version']);
          if (wine.error) {
            return { ok: false, error: 'Este juego es un .exe de Windows. Instala Wine, o configura un comando/URI (por ejemplo Proton o Steam) para lanzarlo.' };
          }
          const child = spawnDetached('wine', [target, ...args], { cwd: workDir });
          return { ok: true, method: 'wine', pid: child.pid, processName: path.basename(target), match: this.#matchFor(game) };
        }
        if (IS_WIN) {
          const child = spawnDetached(target, splitArgs(game.launchArgs || ''), { cwd: workDir });
          return { ok: true, method: 'ejecutable', pid: child.pid, processName: path.basename(target), match: this.#matchFor(game) };
        }
        if (IS_MAC && target.endsWith('.app')) {
          const child = spawnDetached('open', [target, '--args', ...splitArgs(game.launchArgs || '')]);
          return { ok: true, method: 'paquete .app', pid: child.pid, processName: path.basename(target), match: this.#matchFor(game) };
        }
        await fsp.chmod(target, 0o755).catch(() => {});
        const child = spawnDetached(target, splitArgs(game.launchArgs || ''), { cwd: workDir });
        return { ok: true, method: 'ejecutable', pid: child.pid, processName: path.basename(target), match: this.#matchFor(game) };
      } catch (err) {
        return { ok: false, error: `No se pudo iniciar el juego: ${err.message}` };
      }
    }

    if (game.launchCommand) {
      const rendered = renderTemplate(game.launchCommand, game);
      this.#openUri(rendered);
      return { ok: true, method: 'uri', processName: null, match: this.#matchFor(game), uri: rendered };
    }

    return { ok: false, error: 'El juego no tiene ejecutable ni comando configurado' };
  }

  #profileFor(game) {
    if (!game.emulatorProfileId) return null;
    return this.store.settings.emulatorProfiles.find((p) => p.id === game.emulatorProfileId) || null;
  }

  #matchFor(game) {
    const source = game.installDir || game.workDir || game.executable || '';
    return source ? normalize(source).replace(/\s+/g, ' ').slice(0, 60) : null;
  }

  #openUri(uri) {
    if (IS_WIN) {
      execFileAsync('cmd', ['/c', 'start', '', uri]).catch(() => {});
    } else {
      openExternal(uri).catch(() => {});
    }
  }

  /* ------------------------------------------------------------ modo demo */

  #startSimulated(game) {
    const session = this.store.startSession(game, { simulated: true, process: 'simulado' });
    this.running.set(game.id, {
      sessionId: session.id,
      startedAt: Date.now(),
      pid: null,
      method: 'demo',
      simulated: true,
      match: null,
      sawMatch: true,
    });
    this.#log(game, 'Sesion de demostracion iniciada');
    this.emit('session:start', { game, session });
    return session;
  }

  /* ------------------------------------------------------------- vigilancia */

  async tick() {
    if (!this.running.size) return;
    const processes = await listProcesses();
    const now = Date.now();
    for (const [gameId, info] of [...this.running.entries()]) {
      const game = this.store.get(gameId);
      if (!game) {
        this.running.delete(gameId);
        continue;
      }
      if (info.simulated) {
        this.store.heartBeat(info.sessionId);
        continue;
      }
      const pidAlive = info.pid ? isPidAlive(info.pid) : false;
      const match = info.match ? this.#findMatch(processes, info) : null;
      if (!info.sawMatch && match) info.sawMatch = true;

      const elapsed = now - info.startedAt;
      const stillRunning = pidAlive || Boolean(match);

      if (stillRunning) {
        this.store.heartBeat(info.sessionId, { process: match?.name || info.processName, pid: pidAlive ? info.pid : match?.pid });
        continue;
      }

      /* el lanzador murio: se espera un poco por si el juego real arranca despues */
      if (!info.sawMatch && elapsed < LAUNCHER_GRACE_MS) {
        continue;
      }
      this.#end(gameId, { detected: info.sawMatch ? 'proceso detectado y finalizado' : 'pivote de lanzamiento finalizado' });
    }
  }

  #findMatch(processes, info) {
    const matchKey = info.match;
    if (!matchKey) return null;
    const exeName = info.processName ? normalize(path.basename(info.processName, path.extname(info.processName))) : null;
    for (const proc of processes) {
      const cmd = normalize(`${proc.name} ${proc.cmd}`).replace(/\s+/g, ' ');
      if (matchKey && matchKey.length > 6 && cmd.includes(matchKey)) {
        if (proc.pid === process.pid) continue;
        return proc;
      }
    }
    if (exeName && exeName.length > 3) {
      for (const proc of processes) {
        if (proc.pid === process.pid) continue;
        const name = normalize(proc.name.replace(/\.exe$/i, ''));
        if (name === exeName && proc.pid !== info.pid) return proc;
      }
    }
    return null;
  }

  #end(gameId, options) {
    const info = this.running.get(gameId);
    this.running.delete(gameId);
    if (!info) return;
    const entry = this.store.endSession(info.sessionId, options);
    if (entry) {
      const game = this.store.get(gameId);
      this.#log(game, `Sesion finalizada (${Math.round(entry.seconds / 60)} min)`);
      this.emit('session:end', { game, session: entry });
      if (this.store.settings.closeLauncher) this.#closeLauncherFor(game);
    }
  }

  async #closeLauncherFor(game) {
    if (!game) return;
    /* cierra lanzadores intermedios que quedan abiertos (ventanas de tienda) */
    const names = IS_WIN ? ['steamwebhelper.exe'] : [];
    if (!names.length) return;
    for (const name of names) {
      await execFileAsync(IS_WIN ? 'taskkill' : 'pkill', IS_WIN ? ['/IM', name, '/F'] : [name]);
    }
  }

  /** Cierre manual desde la interfaz. */
  async stopGame(gameId) {
    const info = this.running.get(gameId);
    if (!info) throw new Error('El juego no esta en ejecucion');
    if (info.simulated) {
      this.#end(gameId, { detected: 'cierre manual' });
      return { killed: true, pids: [] };
    }

    const processes = await listProcesses();
    const match = info.match ? this.#findMatch(processes, info) : null;
    const pids = [...new Set([info.pid, match?.pid].filter((pid) => pid && pid !== process.pid))];
    if (!pids.length) {
      this.#end(gameId, { detected: 'cierre manual' });
      return { killed: false, pids: [] };
    }

    for (const pid of pids) await killTree(pid);
    this.store.heartBeat(info.sessionId);

    /* la sesion termina en cuanto el proceso desaparezca de verdad */
    const deadline = Date.now() + 12_000;
    const wait = setInterval(async () => {
      const stillAlive = pids.some((pid) => isPidAlive(pid));
      const expired = Date.now() > deadline;
      if (stillAlive && !expired) return;
      clearInterval(wait);
      if (stillAlive) for (const pid of pids) await killTree(pid, { force: true }).catch(() => {});
      if (!this.running.has(gameId)) return;
      this.#end(gameId, { detected: 'cierre manual' });
      this.emit('session:stop', { gameId });
    }, 700);
    if (wait.unref) wait.unref();
    return { killed: true, pids };
  }

  /** Estado en vivo para la interfaz. */
  status() {
    const now = Date.now();
    const sessions = {};
    for (const [gameId, info] of this.running.entries()) {
      sessions[gameId] = {
        sessionId: info.sessionId,
        startedAt: new Date(info.startedAt).toISOString(),
        elapsedSeconds: Math.round((now - info.startedAt) / 1000),
        method: info.method,
        pid: info.pid,
        simulated: Boolean(info.simulated),
      };
    }
    return { sessions, count: Object.keys(sessions).length, log: this.log.slice(-40).reverse() };
  }

  async revealGame(gameId) {
    const game = this.store.get(gameId);
    if (!game) throw new Error('Juego no encontrado');
    const target = game.installDir || game.executable;
    if (!target || !existsSync(target)) throw new Error('La ruta no existe');
    return revealInFileManager(target);
  }

  #log(game, message) {
    this.log.push({ at: new Date().toISOString(), game: game?.name || '?', gameId: game?.id || null, message });
    if (this.log.length > 200) this.log.shift();
  }
}

/* --------------------------------------------------------------- utilidades */

/** Reemplaza marcadores en un comando: {exe} {dir} {rom} {romName} {name} {console} */
export function renderTemplate(template, game) {
  if (!template) return '';
  const rom = game.extra?.rom || "";
  const map = {
    '{exe}': game.executable || '',
    '{dir}': game.installDir || '',
    '{name}': game.name || '',
    '{rom}': rom,
    '{romName}': rom ? path.basename(rom, path.extname(rom)) : game.name || '',
    '{romDir}': rom ? path.dirname(rom) : game.installDir || '',
    '{console}': game.extra?.console || '',
    '{args}': game.launchArgs || '',
  };
  let out = String(template);
  for (const [key, value] of Object.entries(map)) {
    out = out.split(key).join(value);
  }
  return out;
}

/** Divide una linea de comandos respetando comillas simples y dobles. */
export function splitCommand(line) {
  const args = splitArgs(line);
  if (!args.length) return [];
  return args;
}

export function splitArgs(line) {
  const out = [];
  let current = '';
  let quote = null;
  const text = String(line || '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        out.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) out.push(current);
  return out;
}
