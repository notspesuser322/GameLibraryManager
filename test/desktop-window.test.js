/**
 * Comprobación real del ciclo de vida de la ventana:
 * el programa se abre con su ventana y se cierra solo cuando esa ventana se cierra.
 *
 * Se usa un «navegador» de mentira (un proceso que permanece vivo) y se acortan
 * los tiempos por variables de entorno, así la prueba dura unos segundos.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function puertoLibre() {
  const net = await import('node:net');
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function pidsDe(patron) {
  const salida = [];
  const lista = spawn('ps', ['-eo', 'pid,args']);
  lista.stdout.on('data', (d) => salida.push(String(d)));
  await new Promise((r) => lista.on('close', r));
  return salida.join('')
    .split('\n')
    .filter((linea) => linea.includes(patron) && !linea.includes('ps -eo'))
    .map((linea) => Number(linea.trim().split(/\s+/)[0]))
    .filter((pid) => Number.isFinite(pid));
}

/* La ventana simulada es un proceso de verdad; se mata con ps/kill, disponible en Linux. */
const soloLinux = process.platform === 'linux'
  ? false
  : 'la ventana simulada solo se puede cerrar por proceso en Linux';

test('el programa abre su ventana y se cierra cuando esa ventana se cierra', { timeout: 60000, skip: soloLinux }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-ventana-'));
  const puerto = await puertoLibre();
  const navegadorFalso = path.join(tmp, `navegador-falso-${process.pid}`);
  fs.writeFileSync(navegadorFalso, '#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n', { mode: 0o755 });

  const servidor = spawn(process.execPath, [
    'server/index.js', '--port', String(puerto), '--host', '127.0.0.1',
    '--data-dir', tmp, '--demo', '--open',
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEBULA_NAVEGADOR: navegadorFalso,
      DISPLAY: ':0',                       /* se simula un equipo con pantalla */
      NEBULA_VENTANA_ESPERA: '1200',       /* tiempos cortos para la prueba */
      NEBULA_VENTANA_INTERVALO: '400',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let salida = '';
  servidor.stdout.on('data', (d) => { salida += d; });
  servidor.stderr.on('data', (d) => { salida += d; });

  try {
    /* 1. arranca y responde */
    let responde = false;
    for (let i = 0; i < 30 && !responde; i++) {
      await esperar(300);
      responde = await fetch(`http://127.0.0.1:${puerto}/api/health`).then((r) => r.ok).catch(() => false);
    }
    assert.equal(responde, true, 'el servidor debería responder');
    assert.match(salida, /Ventana:\s+.*en modo aplicación/, `debía abrir la ventana: ${salida}`);

    /* 2. se cierra la ventana (el «navegador») */
    const pids = await pidsDe(`navegador-falso-${process.pid}`);
    assert.ok(pids.length, 'no se encontró el proceso de la ventana');
    for (const pid of pids) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* ya no estaba */ }
    }

    /* 3. el programa termina solo */
    let terminado = false;
    for (let i = 0; i < 40 && !terminado; i++) {
      await esperar(300);
      terminado = servidor.exitCode !== null;
    }
    assert.equal(terminado, true, `el programa debía cerrarse solo. Salida: ${salida}`);
    assert.match(salida, /cerrando el programa/, 'debe avisar de que se cierra');
  } finally {
    servidor.kill('SIGKILL');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('con --keep-alive el programa sigue vivo aunque se cierre la ventana', { timeout: 40000, skip: soloLinux }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-keep-'));
  const puerto = await puertoLibre();
  const navegadorFalso = path.join(tmp, `navegador-falso-${process.pid}`);
  fs.writeFileSync(navegadorFalso, '#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n', { mode: 0o755 });

  const servidor = spawn(process.execPath, [
    'server/index.js', '--port', String(puerto), '--host', '127.0.0.1',
    '--data-dir', tmp, '--demo', '--open', '--keep-alive',
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEBULA_NAVEGADOR: navegadorFalso,
      DISPLAY: ':0',
      NEBULA_VENTANA_ESPERA: '1200',
      NEBULA_VENTANA_INTERVALO: '400',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    let responde = false;
    for (let i = 0; i < 30 && !responde; i++) {
      await esperar(300);
      responde = await fetch(`http://127.0.0.1:${puerto}/api/health`).then((r) => r.ok).catch(() => false);
    }
    assert.equal(responde, true);

    const pids = await pidsDe(`navegador-falso-${process.pid}`);
    for (const pid of pids) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* ya no estaba */ }
    }
    await esperar(3000);
    assert.equal(servidor.exitCode, null, 'con --keep-alive debe seguir en marcha');

    const sigue = await fetch(`http://127.0.0.1:${puerto}/api/health`).then((r) => r.ok).catch(() => false);
    assert.equal(sigue, true, 'y debe seguir respondiendo');
  } finally {
    servidor.kill('SIGKILL');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
