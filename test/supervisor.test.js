/**
 * Pruebas del reparto de mando entre la ventana y el núcleo.
 *
 * La ventana nativa arranca el núcleo con `--padre <su pid>` y le pide el cierre
 * con `POST /api/shutdown`. Aquí se comprueban las dos cosas de verdad,
 * arrancando el servidor: que se apaga solo cuando quien manda desaparece y que
 * atiende la petición de cierre.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hijos = [];

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function esperarSalud(base, limiteMs = 20_000) {
  const inicio = Date.now();
  while (Date.now() - inicio < limiteMs) {
    try {
      const respuesta = await fetch(`${base}/api/health`);
      if (respuesta.ok) return true;
    } catch { /* todavía no está */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

/** Arranca el servidor y lo apunta para poder cerrarlo al final. */
function arrancar(args) {
  const hijo = spawn(process.execPath, ['server/index.js', ...args], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NEBULA_PADRE_INTERVALO: '300' },
  });
  let salida = '';
  hijo.stdout.on('data', (d) => { salida += d; });
  hijo.stderr.on('data', (d) => { salida += d; });
  hijo.detalle = () => salida;
  hijos.push(hijo);
  return hijo;
}

/** Espera a que el proceso termine por su cuenta. */
function esperarFin(hijo, limiteMs) {
  return new Promise((resolve) => {
    if (hijo.exitCode !== null || hijo.signalCode !== null) return resolve({ termino: true, codigo: hijo.exitCode });
    const reloj = setTimeout(() => resolve({ termino: false }), limiteMs);
    hijo.once('exit', (codigo) => {
      clearTimeout(reloj);
      resolve({ termino: true, codigo });
    });
  });
}

after(() => {
  for (const hijo of hijos) {
    if (hijo.exitCode === null && hijo.signalCode === null) {
      try { hijo.kill('SIGKILL'); } catch { /* ya no estaba */ }
    }
  }
});

test('el núcleo se apaga solo cuando desaparece la ventana que lo arrancó', async (t) => {
  const puerto = await freePort();
  const datos = await fsp.mkdtemp(path.join(os.tmpdir(), 'nebula-padre-'));
  /* un proceso de mentira que vive muy poco: hace de ventana que se cierra sola */
  const ventana = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 600)'], { stdio: 'ignore' });
  hijos.push(ventana);

  const servidor = arrancar(['--port', String(puerto), '--host', '127.0.0.1', '--data-dir', datos, '--no-open', '--padre', String(ventana.pid)]);
  const base = `http://127.0.0.1:${puerto}`;
  const arranco = await esperarSalud(base);
  if (!arranco) {
    t.diagnostic(servidor.detalle());
    assert.fail('el servidor no llegó a responder');
  }
  assert.equal((await fetch(`${base}/api/health`)).status, 200);

  const fin = await esperarFin(servidor, 20_000);
  if (!fin.termino) t.diagnostic(servidor.detalle());
  assert.ok(fin.termino, 'el servidor debería haberse cerrado al desaparecer la ventana');
  assert.match(servidor.detalle(), /La ventana desaparecio/);
});

test('el núcleo atiende la petición de cierre de la ventana', async (t) => {
  const puerto = await freePort();
  const datos = await fsp.mkdtemp(path.join(os.tmpdir(), 'nebula-cierre-'));
  const servidor = arrancar(['--port', String(puerto), '--host', '127.0.0.1', '--data-dir', datos, '--no-open']);
  const base = `http://127.0.0.1:${puerto}`;
  const arranco = await esperarSalud(base);
  if (!arranco) {
    t.diagnostic(servidor.detalle());
    assert.fail('el servidor no llegó a responder');
  }

  const respuesta = await fetch(`${base}/api/shutdown`, { method: 'POST' });
  const cuerpo = await respuesta.json();
  assert.equal(respuesta.status, 200);
  assert.equal(cuerpo.ok, true);
  assert.equal(cuerpo.pendiente, false, 'sin juegos en marcha el cierre es inmediato');

  const fin = await esperarFin(servidor, 15_000);
  if (!fin.termino) t.diagnostic(servidor.detalle());
  assert.ok(fin.termino, 'el servidor debería haberse cerrado tras la petición');
});

test('sin --padre el núcleo no se cierra solo', async (t) => {
  const puerto = await freePort();
  const datos = await fsp.mkdtemp(path.join(os.tmpdir(), 'nebula-solo-'));
  const servidor = arrancar(['--port', String(puerto), '--host', '127.0.0.1', '--data-dir', datos, '--no-open']);
  const base = `http://127.0.0.1:${puerto}`;
  const arranco = await esperarSalud(base);
  if (!arranco) {
    t.diagnostic(servidor.detalle());
    assert.fail('el servidor no llegó a responder');
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
  assert.equal(servidor.exitCode, null, 'el servidor debe seguir vivo');
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});
