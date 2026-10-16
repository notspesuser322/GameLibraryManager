/* Ajustes: fuentes, carpetas, emuladores, apariencia y datos. */
import { api } from '../api.js';
import { state, refresh, emit } from '../store.js';
import {
  esc, openModal, toast, confirmDialog, downloadText, pickFile, promptDialog, relTime, fmtDate,
} from '../util.js';
import { openFolderWizard, openFileBrowser } from './scan.js';
import { metadataSettingsHtml, wireMetadataSettings, METADATA_CSS } from './metadata.js';

const ACCENTS = ['#7c5cff', '#4f8cff', '#22c1a5', '#ff7847', '#ff4d9d', '#f4b942', '#59c2ff', '#a06cd5'];

export function renderSettings(root) {
  const settings = state.settings || {};
  const sources = settings.sources || {};
  const roots = settings.scanRoots || [];
  const profiles = settings.emulatorProfiles || [];
  const theme = settings.theme || {};
  const app = state.app || {};

  root.innerHTML = `
    <div class="view-head">
      <div>
        <h1>Ajustes</h1>
        <p>Fuentes de detección, emuladores, apariencia y tus datos</p>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <h3>Fuentes automáticas</h3>
        <p class="panel-note">Se revisan al buscar juegos instalados.</p>
        ${Object.entries({ steam: 'Steam', epic: 'Epic Games', gog: 'GOG Galaxy', heroic: 'Heroic', xbox: 'Xbox / Game Pass', lutris: 'Lutris', itch: 'itch.io' })
          .map(([id, label]) => `
            <label class="switch">
              <input type="checkbox" data-source="${id}" ${sources[id] !== false ? 'checked' : ''}>
              <span class="txt"><b>${esc(label)}</b></span>
            </label>`).join('')}
        <hr class="sep">
        <label class="switch"><input type="checkbox" data-setting="autoScanOnStart" ${settings.autoScanOnStart ? 'checked' : ''}>
          <span class="txt"><b>Buscar al iniciar</b><span>revisa el equipo en segundo plano al abrir la app</span></span></label>
        <label class="switch"><input type="checkbox" data-setting="trackPlaytime" ${settings.trackPlaytime !== false ? 'checked' : ''}>
          <span class="txt"><b>Medir tiempo de juego</b><span>registra inicio y fin de cada sesión</span></span></label>
        <label class="switch"><input type="checkbox" data-setting="closeLauncher" ${settings.closeLauncher ? 'checked' : ''}>
          <span class="txt"><b>Cerrar lanzadores al terminar</b><span>útil para ventanas intermedias que quedan abiertas</span></span></label>
        <label class="switch"><input type="checkbox" data-setting="fetchRemoteArt" ${settings.fetchRemoteArt !== false ? 'checked' : ''}>
          <span class="txt"><b>Descargar carátulas de las tiendas</b><span>una sola vez, desde el CDN de Steam; si se desactiva se usan carátulas generadas localmente</span></span></label>
      </div>

      <div class="panel">
        <h3>Apariencia</h3>
        <p class="panel-note">Acento de color</p>
        <div class="chips" style="margin-bottom:14px">
          ${ACCENTS.map((color) => `<button class="chip ${theme.accent === color ? 'active' : ''}" data-accent="${color}" style="background:${color}22;border-color:${color}77">
            <i style="width:12px;height:12px;border-radius:50%;background:${color};display:inline-block"></i>${color}
          </button>`).join('')}
          <button class="chip" data-accent-custom>Otro…</button>
        </div>
        <label class="field"><span>Fondo</span>
          <select class="select" data-theme="background">
            ${[['aurora', 'Aurora'], ['mesh', 'Suave'], ['plain', 'Apagado'], ['none', 'Sin fondo']]
              .map(([id, label]) => `<option value="${id}" ${theme.background === id ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        <label class="field mt"><span>Densidad</span>
          <select class="select" data-theme="density">
            ${[['comfortable', 'Cómoda'], ['compact', 'Compacta'], ['spacious', 'Amplia']]
              .map(([id, label]) => `<option value="${id}" ${theme.density === id ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        <label class="field mt"><span>Tamaño de carátulas</span>
          <input class="slider" type="range" min="0.7" max="1.6" step="0.05" value="${state.query.coverScale}" data-cover-scale>
        </label>
      </div>
    </div>

    <div class="section-title"><h2>Carpetas vigiladas</h2><span class="spacer" style="flex:1"></span>
      <button class="btn small" data-action="add-root">Agregar carpeta</button>
    </div>
    <div class="panel">
      ${roots.length ? `<div class="list">${roots.map((root) => `
        <div class="row" style="grid-template-columns:1fr 130px 90px 130px 130px">
          <div class="name"><b>${esc(root.label || root.path)}</b><span class="mono">${esc(root.path)}</span></div>
          <div class="cell">${root.kind === 'rom' ? 'ROMs' : root.kind === 'single' ? 'juego individual' : 'colección'}</div>
          <div class="cell">${esc(root.kind === 'rom' && root.recursive ? 'recursivo' : '')}</div>
          <div class="cell"><button class="btn small ghost" data-scan-root="${root.id}">Buscar aquí</button></div>
          <div class="cell right"><button class="btn small ghost" data-remove-root="${root.id}">Quitar</button></div>
        </div>`).join('')}</div>`
        : '<p class="panel-note">Sin carpetas. Agrega dónde guardas tus juegos o ROMs para que aparezcan al buscar.</p>'}
    </div>

    <div class="section-title"><h2>Emuladores</h2><span class="spacer" style="flex:1"></span>
      <button class="btn small" data-action="add-emulator">Agregar emulador</button>
    </div>
    <div class="panel">
      ${profiles.length ? `<div class="list">${profiles.map((profile) => `
        <div class="row" style="grid-template-columns:1fr 160px 120px">
          <div class="name"><b>${esc(profile.name)}</b><span class="mono">${esc(profile.command)}</span></div>
          <div class="cell">${(profile.consoles || []).length ? `${profile.consoles.length} consolas` : 'cualquiera'}</div>
          <div class="cell right">
            <button class="btn small ghost" data-edit-emulator="${profile.id}">Editar</button>
            <button class="btn small ghost" data-remove-emulator="${profile.id}">Quitar</button>
          </div>
        </div>`).join('')}</div>`
        : '<p class="panel-note">Sin emuladores configurados. Al agregarlos, las ROMs se lanzan con un clic desde la biblioteca.</p>'}
      <hr class="sep">
      <p class="tiny muted">Marcadores disponibles en el comando: <code>{rom}</code> <code>{romDir}</code> <code>{romName}</code> <code>{name}</code> <code>{dir}</code> <code>{exe}</code></p>
    </div>

    <div class="section-title"><h2>Metadatos</h2></div>
    <div class="panel" data-metadata-settings>
      ${metadataSettingsHtml(settings)}
    </div>

    <div class="section-title"><h2>Datos</h2></div>
    <div class="panel">
      <div class="inline-actions">
        <button class="btn" data-action="export">Exportar biblioteca</button>
        <button class="btn" data-action="import">Importar…</button>
        <button class="btn ghost" data-action="load-demo">Cargar biblioteca de ejemplo</button>
        <button class="btn ghost" data-action="clear-demo">Quitar ejemplos</button>
      </div>
      <hr class="sep">
      <div class="inline-actions">
        <button class="btn ghost" data-action="clean-missing">Revisar rutas faltantes</button>
        <button class="btn danger" data-action="wipe">Borrar toda la biblioteca</button>
      </div>
      <p class="tiny muted mt">Los datos viven en <span class="mono">${esc(app.dataDir || 'data')}</span>. Se guarda una copia diaria en <span class="mono">data/backups</span>.</p>
    </div>

    <div class="section-title"><h2>Acerca de</h2></div>
    <div class="panel">
      <dl class="kv">
        <dt>Versión</dt><dd>${esc(app.version || '—')}</dd>
        <dt>Sistema</dt><dd>${esc(app.platform || '')}</dd>
        <dt>Iniciada</dt><dd>${esc(app.startedAt ? relTime(app.startedAt) : '—')}</dd>
        <dt>Juegos</dt><dd>${state.facets.total}</dd>
        <dt>Datos</dt><dd class="mono">${esc(app.dataDir || '')}</dd>
      </dl>
    </div>
  `;

  wire(root);
}

function ensureStyles() {
  if (document.getElementById('metadata-css')) return;
  const tag = document.createElement('style');
  tag.id = 'metadata-css';
  tag.textContent = METADATA_CSS;
  document.head.append(tag);
}

function wire(root) {
  ensureStyles();
  wireMetadataSettings(root);
  root.querySelectorAll('[data-setting]').forEach((input) => {
    input.addEventListener('change', async () => {
      const sources = { ...(state.settings.sources || {}) };
      sources[input.dataset.source] = input.checked;
      state.settings.sources = sources;
      await api.saveSettings({ sources });
    });
  });

  root.querySelectorAll('[data-setting]').forEach((input) => {
    const path = input.dataset.setting;
    if (path.includes('.')) return; /* los ajustes anidados se manejan aparte */
    input.addEventListener('change', async () => {
      state.settings[path] = input.checked;
      await api.saveSettings({ [path]: input.checked });
      toast('Ajuste guardado', { type: 'ok' });
    });
  });

  /* ajustes de metadatos (metadata.enabled, metadata.language, …) */
  root.querySelectorAll('[data-setting^="metadata."]').forEach((input) => {
    const key = input.dataset.setting.split('.')[1];
    input.addEventListener('change', async () => {
      const value = input.type === 'checkbox' ? input.checked
        : input.type === 'range' ? Number(input.value)
        : input.value;
      state.settings.metadata = { ...(state.settings.metadata || {}), [key]: value };
      await api.saveSettings({ metadata: { [key]: value } });
    });
  });

  root.querySelectorAll('[data-accent]').forEach((button) => {
    button.addEventListener('click', () => applyTheme({ accent: button.dataset.accent }, root));
  });
  root.querySelector('[data-accent-custom]')?.addEventListener('click', async () => {
    const value = await promptDialog('Color en formato #rrggbb', { title: 'Color de acento', value: state.settings.theme?.accent || '#7c5cff' });
    if (value && /^#?[0-9a-f]{6}$/i.test(value)) applyTheme({ accent: value.startsWith('#') ? value : `#${value}` }, root);
    else if (value) toast('Color inválido', { type: 'err' });
  });
  root.querySelectorAll('[data-theme]').forEach((select) => {
    select.addEventListener('change', () => applyTheme({ [select.dataset.theme]: select.value }, root));
  });
  root.querySelector('[data-cover-scale]')?.addEventListener('input', (event) => {
    document.documentElement.style.setProperty('--cover-scale', event.target.value);
    localStorage.setItem('nebula:cover-scale', event.target.value);
  });

  root.querySelector('[data-action="add-root"]')?.addEventListener('click', addRoot);
  root.querySelectorAll('[data-remove-root]').forEach((button) => {
    button.addEventListener('click', async () => {
      await api.removeRoot(button.dataset.removeRoot);
      await refresh({ quiet: true });
      toast('Carpeta quitada', { type: 'ok' });
    });
  });
  root.querySelectorAll('[data-scan-root]').forEach((button) => {
    button.addEventListener('click', async () => {
      const root_ = (state.settings.scanRoots || []).find((r) => r.id === button.dataset.scanRoot);
      if (!root_) return;
      button.disabled = true;
      button.textContent = 'Buscando…';
      try {
        const result = await api.scan({ sources: { steam: false, epic: false, gog: false, heroic: false, lutris: false }, roots: [root_] });
        const { openScanWizard } = await import('./scan.js');
        openScanWizard({ initialResult: result });
      } catch (err) {
        toast(err.message, { type: 'err' });
      } finally {
        button.disabled = false;
        button.textContent = 'Buscar aquí';
      }
    });
  });

  root.querySelector('[data-action="add-emulator"]')?.addEventListener('click', () => openEmulatorForm());
  root.querySelectorAll('[data-edit-emulator]').forEach((button) => {
    button.addEventListener('click', () => openEmulatorForm(button.dataset.editEmulator));
  });
  root.querySelectorAll('[data-remove-emulator]').forEach((button) => {
    button.addEventListener('click', async () => {
      await api.deleteEmulator(button.dataset.removeEmulator);
      await refresh({ quiet: true });
      toast('Emulador quitado', { type: 'ok' });
    });
  });

  root.querySelector('[data-action="export"]')?.addEventListener('click', async () => {
    const payload = await api.exportAll();
    downloadText(`nebula-${new Date().toISOString().slice(0, 10)}.json`, typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2));
    toast('Archivo descargado', { type: 'ok' });
  });

  root.querySelector('[data-action="import"]')?.addEventListener('click', async () => {
    const file = await pickFile('application/json');
    if (!file) return;
    const text = await file.text();
    try {
      const payload = JSON.parse(text);
      const ok = await confirmDialog(`Se importarán ${payload.games?.length || 0} juegos. ¿Reemplazar la biblioteca actual? (Cancelar = fusionar)`, {
        title: 'Importar biblioteca', confirmLabel: 'Reemplazar', cancelLabel: 'Fusionar',
      });
      const result = await api.importAll(payload, ok ? 'replace' : 'merge');
      toast(`${result.added} agregados, ${result.updated} actualizados`, { type: 'ok' });
      await refresh();
      emit('view');
    } catch (err) {
      toast(err.message, { type: 'err', title: 'No se pudo importar' });
    }
  });

  root.querySelector('[data-action="load-demo"]')?.addEventListener('click', async () => {
    const added = await api.loadDemo();
    toast(`${added.added} juegos de ejemplo agregados`, { type: 'ok' });
    await refresh();
    emit('view');
  });

  root.querySelector('[data-action="clear-demo"]')?.addEventListener('click', async () => {
    const result = await api.clearDemo();
    toast(`${result.removed} ejemplos eliminados`, { type: 'ok' });
    await refresh();
    emit('view');
  });

  root.querySelector('[data-action="clean-missing"]')?.addEventListener('click', async () => {
    await refresh({ quiet: true });
    const missing = state.games.filter((g) => g.pathExists === false);
    if (!missing.length) {
      toast('Todas las rutas existen', { type: 'ok' });
      return;
    }
    const modal = openModal({
      title: 'Rutas faltantes',
      body: `<p class="panel-note">${missing.length} juegos apuntan a rutas que ya no existen. Puedes editarlos o quitarlos.</p>
        <div class="scroll-y">${missing.map((g) => `
          <div class="scan-item">
            <span class="meta"><b>${esc(g.name)}</b><span class="mono">${esc(g.installDir || g.executable || '')}</span></span>
            <button class="btn small ghost" data-remove="${g.id}">Quitar de la biblioteca</button>
          </div>`).join('')}</div>`,
    });
    modal.body.querySelectorAll('[data-remove]').forEach((button) => {
      button.addEventListener('click', async () => {
        await api.deleteGame(button.dataset.remove);
        button.closest('.scan-item').remove();
        toast('Juego quitado', { type: 'ok' });
        await refresh({ quiet: true });
        emit('view');
      });
    });
  });

  root.querySelector('[data-action="wipe"]')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Se borrarán todos los juegos, sesiones y horas registradas. No se tocan los archivos del disco. ¿Continuar?', {
      title: 'Borrar biblioteca', confirmLabel: 'Borrar todo', danger: true,
    });
    if (!ok) return;
    await api.deleteGames(state.games.map((g) => g.id));
    await refresh();
    emit('view');
    toast('Biblioteca vacía', { type: 'ok' });
  });
}

async function applyTheme(patch, root) {
  const theme = { ...(state.settings.theme || {}), ...patch };
  state.settings.theme = theme;
  applyThemeToDocument(theme);
  await api.saveSettings({ theme });
  if (root) { renderSettings(root); }
}

export function applyThemeToDocument(theme = {}) {
  if (theme.accent) document.documentElement.style.setProperty('--accent', theme.accent);
  document.body.dataset.background = theme.background || 'aurora';
  document.body.dataset.density = theme.density || 'comfortable';
}

async function addRoot() {
  openFileBrowser({
    title: 'Elegir carpeta para vigilar',
    onPick: async (path) => {
      const body = document.createElement('div');
      body.innerHTML = `
        <p class="panel-note">Carpeta: <span class="mono">${esc(path)}</span></p>
        <label class="field mt"><span>Tipo de contenido</span>
          <select class="select" data-kind>
            <option value="collection">Contiene varios juegos (una subcarpeta por juego)</option>
            <option value="rom">Contiene ROMs de consolas</option>
            <option value="single">Es la carpeta de un solo juego</option>
          </select>
        </label>
        <label class="field mt"><span>Nombre</span><input class="input" data-label value="${esc(path.split(/[\\/]/).pop() || path)}"></label>
        <label class="switch mt"><input type="checkbox" data-recursive><span class="txt"><b>Buscar en subcarpetas</b><span>necesario si las ROMs están organizadas por consola</span></span></label>`;
      const modal = openModal({ title: 'Agregar carpeta vigilada', size: 'narrow', body, footer: document.createElement('div') });
      modal.footer.innerHTML = '<div style="flex:1"></div>';
      const cancel = document.createElement('button');
      cancel.className = 'btn ghost';
      cancel.textContent = 'Cancelar';
      cancel.addEventListener('click', () => modal.close());
      const ok = document.createElement('button');
      ok.className = 'btn primary';
      ok.textContent = 'Agregar';
      ok.addEventListener('click', async () => {
        ok.disabled = true;
        try {
          await api.addRoot({
            path,
            kind: body.querySelector('[data-kind]').value,
            label: body.querySelector('[data-label]').value,
            recursive: body.querySelector('[data-recursive]').checked,
          });
          toast('Carpeta registrada', { type: 'ok' });
          await refresh({ quiet: true });
          modal.close();
          emit('view');
        } catch (err) {
          toast(err.message, { type: 'err' });
          ok.disabled = false;
        }
      });
      modal.footer.append(ok, cancel);
    },
  });
}

function openEmulatorForm(profileId = null) {
  const existing = (state.settings.emulatorProfiles || []).find((p) => p.id === profileId) || null;
  const presets = state.emulatorPresets || [];
  const consoles = state.consoles || [];
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <label class="field full"><span>Nombre *</span><input class="input" data-name value="${esc(existing?.name || '')}" placeholder="RetroArch"></label>
      <label class="field full"><span>Comando *</span><input class="input" data-command value="${esc(existing?.command || '')}" placeholder="retroarch -L {core} &quot;{rom}&quot;">
        <span class="hint">Marcadores: <code>{rom}</code> <code>{romDir}</code> <code>{romName}</code> <code>{name}</code></span>
      </label>
      <label class="field"><span>Carpeta de trabajo</span><input class="input" data-workdir value="${esc(existing?.workDir || '')}"></label>
      <label class="field"><span>Examinar comando</span><button class="btn small" data-browse>Buscar ejecutable…</button></label>
      <div class="field full">
        <span>Consolas</span>
        <div class="tag-cloud" style="padding:0">
          ${consoles.map((console_) => `
            <button type="button" class="chip ${existing?.consoles?.includes(console_.id) ? 'active' : ''}" data-console="${console_.id}">${esc(console_.label)}</button>`).join('')}
        </div>
      </div>
    </div>
    ${!existing && presets.length ? `
      <hr class="sep">
      <p class="tiny muted">Plantillas rápidas (ajusta la ruta según tu sistema):</p>
      <div class="chips">
        ${presets.slice(0, 8).map((preset) => `<button class="chip" data-preset="${esc(preset.name)}">${esc(preset.name)}</button>`).join('')}
      </div>` : ''}`;

  const modal = openModal({ title: existing ? 'Editar emulador' : 'Agregar emulador', body, footer: document.createElement('div') });
  const chosen = new Set(existing?.consoles || []);
  body.querySelectorAll('[data-console]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.console;
      if (chosen.has(id)) { chosen.delete(id); button.classList.remove('active'); }
      else { chosen.add(id); button.classList.add('active'); }
    });
  });
  body.querySelectorAll('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      const preset = presets.find((p) => p.name === button.dataset.preset);
      if (!preset) return;
      body.querySelector('[data-name]').value = preset.name;
      body.querySelector('[data-command]').value = preset.command;
      chosen.clear();
      for (const id of preset.consoles || []) chosen.add(id);
      body.querySelectorAll('[data-console]').forEach((node) => node.classList.toggle('active', chosen.has(node.dataset.console)));
    });
  });
  body.querySelector('[data-browse]')?.addEventListener('click', () => {
    openFileBrowser({
      title: 'Elegir ejecutable del emulador',
      allowFiles: true,
      onPick: (picked, type) => {
        if (type === 'file') {
          const current = body.querySelector('[data-command]').value;
          body.querySelector('[data-command]').value = current ? current.replace(/^\S+/, `"${picked}"`) : `"${picked}" "{rom}"`;
          const nameInput = body.querySelector('[data-name]');
          if (!nameInput.value) nameInput.value = picked.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
        }
      },
    });
  });

  modal.footer.innerHTML = '<div style="flex:1"></div>';
  const cancel = document.createElement('button');
  cancel.className = 'btn ghost';
  cancel.textContent = 'Cancelar';
  cancel.addEventListener('click', () => modal.close());
  const save = document.createElement('button');
  save.className = 'btn primary';
  save.textContent = existing ? 'Guardar' : 'Agregar';
  save.addEventListener('click', async () => {
    const name = body.querySelector('[data-name]').value.trim();
    const command = body.querySelector('[data-command]').value.trim();
    if (!name || !command) {
      toast('Nombre y comando son obligatorios', { type: 'err' });
      return;
    }
    const payload = { name, command, workDir: body.querySelector('[data-workdir]').value.trim() || null, consoles: [...chosen] };
    try {
      if (existing) await api.updateEmulator(existing.id, payload);
      else await api.addEmulator(payload);
      toast(existing ? 'Emulador actualizado' : 'Emulador agregado', { type: 'ok' });
      await refresh({ quiet: true });
      modal.close();
      emit('view');
    } catch (err) {
      toast(err.message, { type: 'err' });
    }
  });
  modal.footer.append(save, cancel);
}
