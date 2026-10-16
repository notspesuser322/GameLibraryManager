/* Buscar juegos: asistente de detección, carpetas y alta manual. */
import { api } from '../api.js';
import { state, refresh, emit } from '../store.js';
import {
  esc, fmtBytes, fmtDuration, openModal, toast, confirmDialog, fmtDate,
} from '../util.js';

/* ------------------------------------------------------------ vista "Buscar" */

export function renderScan(root) {
  const summary = state.scan?.summary;
  const roots = state.settings?.scanRoots || [];
  const profiles = state.settings?.emulatorProfiles || [];
  const sources = state.settings?.sources || {};

  root.innerHTML = `
    <div class="view-head">
      <div>
        <h1>Buscar juegos</h1>
        <p>Detecta lo que ya está instalado en este equipo y súmalo a la biblioteca</p>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <h3>Detección automática</h3>
        <p class="panel-note">Revisa los lanzadores instalados (Steam, Epic, GOG, Heroic, Lutris) y las carpetas que hayas registrado.</p>
        <div class="grid-3" style="margin:12px 0">
          ${Object.entries(sourceLabels()).map(([id, label]) => `
            <label class="switch"><input type="checkbox" disabled ${sources[id] !== false ? 'checked' : ''}><span class="txt"><b>${esc(label)}</b></span></label>
          `).join('')}
        </div>
        <div class="inline-actions">
          <button class="btn primary" data-action="wizard">Buscar juegos instalados</button>
          <button class="btn" data-action="add-folder">Agregar una carpeta</button>
          <button class="btn ghost" data-action="add-manual">Alta manual</button>
        </div>
      </div>

      <div class="panel">
        <h3>Último resultado</h3>
        ${summary ? `
          <p class="panel-note">${esc(fmtDate(summary.at, { hour: '2-digit', minute: '2-digit' }))}</p>
          <div class="grid-3" style="margin-top:12px">
            <div class="stat"><b>${summary.counts.new}</b><span>nuevos</span></div>
            <div class="stat"><b>${summary.counts.known}</b><span>ya en la biblioteca</span></div>
            <div class="stat"><b>${summary.scanned.reduce((sum, s) => sum + s.found, 0)}</b><span>detectados</span></div>
          </div>
          <div class="mt tiny muted">
            ${summary.scanned.map((s) => `${esc(s.source)}: ${s.found} (${s.ms} ms)`).join(' · ')}
          </div>
          ${summary.errors?.length ? `<p class="tiny" style="color:var(--warn)">${summary.errors.map((e) => `${esc(e.source)}: ${esc(e.message)}`).join('<br>')}</p>` : ''}
        ` : '<p class="panel-note">Todavía no se hizo ningún escaneo en esta sesión.</p>'}
      </div>
    </div>

    <div class="section-title"><h2>Carpetas vigiladas</h2><span class="spacer" style="flex:1"></span>
      <button class="btn small" data-action="add-folder">Agregar carpeta</button>
    </div>
    <div class="panel">
      ${roots.length ? `<div class="list">${roots.map((root) => `
        <div class="row" style="grid-template-columns:1fr 120px 90px 120px">
          <div class="name"><b>${esc(root.label || root.path)}</b><span class="mono">${esc(root.path)}</span></div>
          <div class="cell">${root.kind === 'rom' ? 'ROMs' : root.kind === 'single' ? 'juego individual' : 'colección'}</div>
          <div class="cell">${esc(root.recursive ? 'recursivo' : '')}</div>
          <div class="cell right"><button class="btn small ghost" data-remove-root="${root.id}">Quitar</button></div>
        </div>`).join('')}</div>`
        : '<p class="panel-note">Sin carpetas registradas. Agrega la carpeta donde guardas tus juegos o tus ROMs para detectarlos automáticamente.</p>'}
    </div>

    <div class="section-title"><h2>Emuladores configurados</h2><span class="spacer" style="flex:1"></span>
      <button class="btn small" data-action="goto-settings">Configurar</button>
    </div>
    <div class="panel">
      ${profiles.length ? `<div class="list">${profiles.map((profile) => `
        <div class="row" style="grid-template-columns:1fr 120px">
          <div class="name"><b>${esc(profile.name)}</b><span class="mono">${esc(profile.command)}</span></div>
          <div class="cell">${(profile.consoles || []).length} consolas</div>
        </div>`).join('')}</div>`
        : '<p class="panel-note">Sin emuladores. Puedes agregarlos desde Ajustes para lanzar ROMs con un clic.</p>'}
    </div>
  `;

  root.querySelector('[data-action="wizard"]')?.addEventListener('click', openScanWizard);
  root.querySelectorAll('[data-action="add-folder"]').forEach((button) => button.addEventListener('click', () => openFolderWizard()));
  root.querySelector('[data-action="add-manual"]')?.addEventListener('click', openAddManual);
  root.querySelector('[data-action="goto-settings"]')?.addEventListener('click', () => import('../store.js').then((m) => m.setView('settings')));
  root.querySelectorAll('[data-remove-root]').forEach((button) => {
    button.addEventListener('click', async () => {
      await api.removeRoot(button.dataset.removeRoot);
      await refresh({ quiet: true });
      toast('Carpeta quitada', { type: 'ok' });
    });
  });
}

function sourceLabels() {
  return {
    steam: 'Steam', epic: 'Epic Games', gog: 'GOG Galaxy', heroic: 'Heroic',
    xbox: 'Xbox / Game Pass', lutris: 'Lutris', itch: 'itch.io',
  };
}

/* --------------------------------------------------------- asistente de escaneo */

export function openScanWizard({ initialResult = null } = {}) {
  const sources = state.settings?.sources || {};
  const roots = state.settings?.scanRoots || [];
  let lastResult = initialResult;
  let selected = null;

  const body = document.createElement('div');
  const steps = { current: lastResult ? 'results' : 'options' };

  const modal = openModal({
    title: 'Buscar juegos instalados',
    size: 'wide',
    body,
    footer: document.createElement('div'),
  });

  function renderOptions() {
    steps.current = 'options';
    body.innerHTML = `
      <p class="panel-note">Se revisan los lanzadores detectados en este equipo y las carpetas registradas. Puedes desmarcar lo que no quieras revisar.</p>
      <div class="grid-2 mt">
        <div>
          <h3>Lanzadores</h3>
          <div class="scroll-y">
            ${Object.entries(sourceLabels()).map(([id, label]) => `
              <label class="switch"><input type="checkbox" data-source="${id}" ${sources[id] !== false ? 'checked' : ''}>
                <span class="txt"><b>${esc(label)}</b><span>manifiestos y configuraciones locales</span></span>
              </label>`).join('')}
          </div>
        </div>
        <div>
          <h3>Carpetas registradas</h3>
          <div class="scroll-y">
            ${roots.length ? roots.map((root) => `
              <label class="switch"><input type="checkbox" data-root="${root.id}" checked>
                <span class="txt"><b>${esc(root.label || root.path)}</b><span>${esc(root.kind === 'rom' ? 'ROMs' : 'carpeta de juegos')} · <span class="mono">${esc(root.path)}</span></span></span>
              </label>`).join('') : '<p class="panel-note">No hay carpetas registradas. Puedes agregarlas desde la vista “Buscar juegos”.</p>'}
          </div>
        </div>
      </div>
      ${lastResult ? renderResultSummary(lastResult) : ''}
    `;
    setFooter([
      { label: 'Cancelar', class: 'ghost', action: () => modal.close() },
      { label: 'Buscar ahora', class: 'primary', action: runScan },
    ]);
    body.querySelectorAll('[data-source]').forEach((input) => { input.checked = sources[input.dataset.source] !== false; });
  }

  async function runScan() {
    const pickedSources = {};
    body.querySelectorAll('[data-source]').forEach((input) => { pickedSources[input.dataset.source] = input.checked; });
    const pickedRoots = roots.filter((root) => body.querySelector(`[data-root="${root.id}"]`)?.checked);
    steps.current = 'running';
    body.innerHTML = `
      <div style="text-align:center;padding:26px 0">
        <h3>Revisando el equipo…</h3>
        <p class="panel-note">Steam, Epic, GOG, Heroic, Lutris y tus carpetas. Puede tardar unos segundos.</p>
        <progress></progress>
      </div>`;
    setFooter([{ label: 'Cancelar', class: 'ghost', action: () => modal.close() }]);
    try {
      lastResult = await api.scan({ sources: pickedSources, roots: pickedRoots });
      state.scan = { running: false, summary: { at: lastResult.at, counts: lastResult.counts, scanned: lastResult.scanned, errors: lastResult.errors } };
      renderResults();
    } catch (err) {
      toast(err.message, { type: 'err', title: 'Error al buscar' });
      renderOptions();
    }
  }

  let filter = 'new';
  let onlySelected = true;

  function renderResults() {
    steps.current = 'results';
    const findings = lastResult.findings.map((item) => ({ ...item, checked: !item.existingId }));
    selected = findings;
    const counts = lastResult.counts;
    /* si no hay novedades, se muestran todos para no dejar la lista vacía */
    if (!counts.new && counts.known) filter = 'all';

    function visible() {
      if (filter === 'all') return selected;
      if (filter === 'new') return selected.filter((item) => !item.existingId);
      if (filter === 'known') return selected.filter((item) => item.existingId);
      return selected.filter((item) => item.candidate.platform === filter);
    }

    function render() {
      const list = visible();
      body.innerHTML = `
        ${renderResultSummary(lastResult)}
        <div class="filters">
          <div class="chips">
            <button class="chip ${filter === 'new' ? 'active' : ''}" data-filter="new">Nuevos <span class="cnt">${counts.new}</span></button>
            <button class="chip ${filter === 'known' ? 'active' : ''}" data-filter="known">Ya en la biblioteca <span class="cnt">${counts.known}</span></button>
            <button class="chip ${filter === 'all' ? 'active' : ''}" data-filter="all">Todos <span class="cnt">${counts.new + counts.known}</span></button>
            ${['steam', 'epic', 'gog', 'heroic', 'lutris', 'manual', 'emulator'].filter((id) => counts[id]).map((id) => `
              <button class="chip ${filter === id ? 'active' : ''}" data-filter="${id}">${esc(sourceLabel(id))} <span class="cnt">${counts[id]}</span></button>`).join('')}
          </div>
          <div style="flex:1"></div>
          <button class="btn small ghost" data-bulk="all">Marcar todos</button>
          <button class="btn small ghost" data-bulk="none">Desmarcar</button>
        </div>
        <div class="scroll-y" style="max-height:44vh">
          ${list.length ? list.map((item, index) => `
            <label class="scan-item" data-item="${findingsIndex(item)}">
              <input type="checkbox" data-check ${item.checked ? 'checked' : ''} ${item.existingId ? '' : ''}>
              <img src="${item.existingId ? `/api/games/${item.existingId}/cover` : placeholderCover(item.candidate.name)}" alt="" loading="lazy">
              <span class="meta">
                <b>${esc(item.candidate.name)}</b>
                <span>${esc(sourceLabel(item.candidate.platform))}${item.candidate.consoleLabel ? ` · ${esc(item.candidate.consoleLabel)}` : ''} · ${esc(item.candidate.installDir || item.candidate.extra?.rom || item.candidate.launchCommand || '')}</span>
              </span>
              ${item.existingId ? '<span class="pill">ya está</span>' : '<span class="pill" style="color:var(--ok)">nuevo</span>'}
              ${item.candidate.sizeBytes ? `<span class="tiny muted">${esc(fmtBytes(item.candidate.sizeBytes))}</span>` : ''}
            </label>`).join('') : '<p class="panel-note">Nada para mostrar con este filtro.</p>'}
        </div>
        <hr class="sep">
        <div class="form-grid">
          <label class="field"><span>Estado inicial</span>
            <select class="select" data-opt-status>
              ${state.statuses.map((s) => `<option value="${s.id}" ${s.id === 'backlog' ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
            </select>
          </label>
          <label class="field"><span>Etiquetas para lo nuevo</span>
            <input class="input" data-opt-tags placeholder="instalado, pendiente">
          </label>
          <label class="field" style="justify-content:flex-end">
            <span>Opciones</span>
            <label class="switch" style="padding:0"><input type="checkbox" data-opt-update checked><span class="txt"><b>Actualizar los que ya están</b><span>refresca rutas y arte</span></span></label>
          </label>
        </div>
      `;
      wire();
    }

    function wire() {
      body.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { filter = button.dataset.filter; render(); }));
      body.querySelectorAll('[data-check]').forEach((input) => {
        const index = Number(input.closest('[data-item]').dataset.item);
        input.addEventListener('change', () => { selected[index].checked = input.checked; });
      });
      body.querySelector('[data-bulk="all"]')?.addEventListener('click', () => {
        for (const item of selected) if (!item.existingId) item.checked = true;
        render();
      });
      body.querySelector('[data-bulk="none"]')?.addEventListener('click', () => {
        for (const item of selected) item.checked = false;
        render();
      });
    }

    render();
    setFooter([
      { label: 'Elegir otras fuentes', class: 'ghost', action: renderOptions },
      { label: 'Cerrar', class: 'ghost', action: () => modal.close() },
      { label: 'Agregar seleccionados', class: 'primary', action: importSelected },
    ]);

    async function importSelected() {
      const chosen = findings.filter((item) => item.checked);
      if (!chosen.length) {
        toast('No marcaste ningún juego', { type: 'err' });
        return;
      }
      const status = body.querySelector('[data-opt-status]')?.value;
      const tags = (body.querySelector('[data-opt-tags]')?.value || '').split(',').map((t) => t.trim()).filter(Boolean);
      const updateExisting = body.querySelector('[data-opt-update]')?.checked !== false;
      const button = modal.footer.querySelector('.btn.primary');
      if (button) { button.disabled = true; button.textContent = 'Agregando…'; }
      try {
        const result = await api.importFindings(chosen, { status, tags, updateExisting });
        toast(`${result.added} juegos agregados${result.updated ? `, ${result.updated} actualizados` : ''}`, { type: 'ok', title: 'Listo' });
        if (result.errors?.length) toast(`${result.errors.length} errores`, { type: 'err' });
        await refresh({ quiet: true });
        modal.close();
      } catch (err) {
        toast(err.message, { type: 'err' });
        if (button) { button.disabled = false; button.textContent = 'Agregar seleccionados'; }
      }
    }
  }

  function findingsIndex(item) {
    return selected.indexOf(item);
  }

  function setFooter(buttons) {
    modal.footer.innerHTML = '<div style="flex:1"></div>';
    for (const button of buttons) {
      const node = document.createElement('button');
      node.className = `btn ${button.class || ''}`;
      node.textContent = button.label;
      node.addEventListener('click', button.action);
      modal.footer.append(node);
    }
  }

  renderOptions();
  return modal;
}

function renderResultSummary(result) {
  return `<div class="grid-3" style="margin:8px 0 4px">
    <div class="stat"><b>${result.counts.new}</b><span>nuevos</span></div>
    <div class="stat"><b>${result.counts.known}</b><span>ya en la biblioteca</span></div>
    <div class="stat"><b>${result.scanned.reduce((sum, s) => sum + s.found, 0)}</b><span>detectados en total</span></div>
  </div>`;
}

function sourceLabel(id) {
  return sourceLabels()[id] || (id === 'manual' ? 'Carpeta propia' : id === 'emulator' ? 'ROM' : id);
}

function placeholderCover(name) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="80"><rect width="60" height="80" fill="#1d2030"/><text x="30" y="44" font-size="20" text-anchor="middle" fill="#8d93a1" font-family="sans-serif">${esc((name || '?').slice(0, 2)).toUpperCase()}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/* --------------------------------------------------------- explorador de carpetas */

export function openFileBrowser({ startPath = '', title = 'Elegir carpeta', allowFiles = false, onPick } = {}) {
  const body = document.createElement('div');
  const crumbs = document.createElement('div');
  const entries = document.createElement('div');
  entries.className = 'entries';
  let current = startPath;

  const modal = openModal({
    title,
    size: '',
    body,
    footer: document.createElement('div'),
  });

  const footer = modal.footer;
  footer.innerHTML = '<div style="flex:1"></div>';
  const pickButton = document.createElement('button');
  pickButton.className = 'btn primary';
  pickButton.textContent = allowFiles ? 'Usar esta carpeta' : 'Elegir esta carpeta';
  pickButton.addEventListener('click', () => {
    if (!current) return;
    modal.close();
    onPick?.(current);
  });
  const cancel = document.createElement('button');
  cancel.className = 'btn ghost';
  cancel.textContent = 'Cancelar';
  cancel.addEventListener('click', () => modal.close());
  footer.append(pickButton, cancel);

  async function go(target) {
    entries.innerHTML = '<p class="panel-note" style="padding:12px">Leyendo…</p>';
    try {
      const data = await api.fs(target);
      current = data.path;
      crumbs.innerHTML = `
        <code data-go="${esc(data.home)}">~ inicio</code>
        ${(data.roots || []).filter((r) => r.path !== data.home).map((r) => `<code data-go="${esc(r.path)}">${esc(r.name)}</code>`).join('')}
        ${data.parent ? `<code data-go="${esc(data.parent)}">.. subir</code>` : ''}
        <span class="mono" style="color:var(--text)">${esc(data.path)}</span>`;
      crumbs.querySelectorAll('[data-go]').forEach((node) => node.addEventListener('click', () => go(node.dataset.go)));
      entries.innerHTML = data.entries.length ? data.entries.map((entry) => `
        <button class="entry" data-path="${esc(entry.path)}" data-type="${entry.type}">
          <span style="opacity:.7">${entry.type === 'dir' ? '📁' : '▶️'}</span>
          <span>${esc(entry.name)}</span>
          ${entry.size ? `<span class="size">${esc(fmtBytes(entry.size))}</span>` : ''}
        </button>`).join('') : '<p class="panel-note" style="padding:12px">Carpeta vacía.</p>';
      entries.querySelectorAll('.entry').forEach((button) => {
        button.addEventListener('click', () => {
          if (button.dataset.type === 'dir') go(button.dataset.path);
          else if (allowFiles) {
            modal.close();
            onPick?.(button.dataset.path, 'file');
          }
        });
      });
    } catch (err) {
      entries.innerHTML = `<p class="panel-note" style="padding:12px;color:var(--warn)">${esc(err.message)}</p>`;
    }
  }

  body.append(crumbs, entries);
  body.querySelector('.crumbs')?.classList.add('crumbs');
  body.classList.add('browser');
  go(startPath || undefined);

  if (allowFiles) pickButton.textContent = 'Elegir esta carpeta';
  return modal;
}

/* ------------------------------------------------- asistente de carpeta propia */

export function openFolderWizard({ path: initialPath = '' } = {}) {
  let step = initialPath ? 'kind' : 'browse';
  let folder = initialPath;
  let kind = 'collection';
  let analysis = null;
  const chosen = new Set();

  const body = document.createElement('div');
  const modal = openModal({ title: 'Agregar desde una carpeta', size: 'wide', body, footer: document.createElement('div') });

  function setFooter(buttons) {
    modal.footer.innerHTML = '<div style="flex:1"></div>';
    for (const button of buttons) {
      const node = document.createElement('button');
      node.className = `btn ${button.class || ''}`;
      node.textContent = button.label;
      node.disabled = Boolean(button.disabled);
      node.addEventListener('click', button.action);
      modal.footer.append(node);
    }
  }

  function renderBrowse() {
    step = 'browse';
    body.innerHTML = `
      <p class="panel-note">Elige la carpeta que quieres revisar. Puede ser una carpeta con varios juegos, la de un juego concreto o tu carpeta de ROMs.</p>
      <div class="browser" data-browser></div>`;
    setFooter([{ label: 'Cancelar', class: 'ghost', action: () => modal.close() }]);
    const holder = body.querySelector('[data-browser]');
    const crumbs = document.createElement('div');
    crumbs.className = 'crumbs';
    const entries = document.createElement('div');
    entries.className = 'entries';
    holder.append(crumbs, entries);

    async function go(target) {
      entries.innerHTML = '<p class="panel-note" style="padding:12px">Leyendo…</p>';
      try {
        const data = await api.fs(target);
        folder = data.path;
        crumbs.innerHTML = `
          <code data-go="${esc(data.home)}">~ inicio</code>
          ${(data.roots || []).filter((r) => r.path !== data.home).map((r) => `<code data-go="${esc(r.path)}">${esc(r.name)}</code>`).join('')}
          ${data.parent ? `<code data-go="${esc(data.parent)}">.. subir</code>` : ''}
          <span class="mono" style="color:var(--text)">${esc(data.path)}</span>
          <span style="flex:1"></span>
          <button class="btn small primary" data-pick>Usar esta carpeta</button>`;
        crumbs.querySelectorAll('[data-go]').forEach((node) => node.addEventListener('click', () => go(node.dataset.go)));
        crumbs.querySelector('[data-pick]')?.addEventListener('click', () => renderKind());
        entries.innerHTML = data.entries.filter((e) => e.type === 'dir').map((entry) => `
          <button class="entry" data-path="${esc(entry.path)}"><span style="opacity:.7">📁</span><span>${esc(entry.name)}</span></button>`).join('')
          || '<p class="panel-note" style="padding:12px">Sin subcarpetas.</p>';
        entries.querySelectorAll('.entry').forEach((button) => {
          button.addEventListener('click', () => go(button.dataset.path));
          button.addEventListener('dblclick', () => renderKind());
        });
      } catch (err) {
        entries.innerHTML = `<p class="panel-note" style="padding:12px;color:var(--warn)">${esc(err.message)}</p>`;
      }
    }
    go(initialPath || undefined);
  }

  function renderKind() {
    step = 'kind';
    body.innerHTML = `
      <p class="panel-note">Carpeta elegida: <span class="mono">${esc(folder)}</span></p>
      <div class="grid-3 mt">
        ${[
          ['collection', 'Contiene varios juegos', 'Cada subcarpeta con ejecutable se agrega como un juego.'],
          ['single', 'Es un solo juego', 'Se analiza y se elige el ejecutable principal.'],
          ['rom', 'Contiene ROMs', 'Agrupa por consola según la extensión del archivo.'],
        ].map(([id, title, hint]) => `
          <label class="panel" style="cursor:pointer;display:block">
            <label class="switch" style="padding:0 0 6px"><input type="radio" name="kind" value="${id}" ${kind === id ? 'checked' : ''}><span class="txt"><b>${esc(title)}</b></span></label>
            <span class="panel-note">${esc(hint)}</span>
          </label>`).join('')}
      </div>
      <p class="tiny muted mt">Esta carpeta queda guardada y Nébula la revisa sola cada vez que abres el programa.</p>
      <div class="inline-actions mt">
        <label class="switch"><input type="checkbox" data-opt-size><span class="txt"><b>Calcular tamaño en disco</b><span>puede tardar en carpetas grandes</span></span></label>
        <label class="switch"><input type="checkbox" data-opt-deep checked><span class="txt"><b>Búsqueda profunda</b><span>revisa subcarpetas</span></span></label>
      </div>`;
    body.querySelectorAll('input[name="kind"]').forEach((input) => input.addEventListener('change', () => { kind = input.value; }));
    setFooter([
      { label: 'Cambiar carpeta', class: 'ghost', action: renderBrowse },
      { label: 'Analizar', class: 'primary', action: analyze },
    ]);
  }

  /* Una carpeta analizada desde aquí queda registrada: Nébula la revisa sola en
     cada arranque y descubre los juegos que se instalen después. */
  async function guardarCarpeta(deep) {
    const normalizar = (valor) => String(valor || '').replace(/[\\/]+$/, '').toLowerCase();
    const yaEstaba = (state.settings?.scanRoots || []).some((root) => normalizar(root.path) === normalizar(folder));
    try {
      await api.addRoot({
        path: folder,
        kind,
        label: folder.split(/[\\/]/).filter(Boolean).pop() || folder,
        recursive: Boolean(deep),
      });
      await refresh({ quiet: true });
      return !yaEstaba;
    } catch {
      return false;
    }
  }

  async function analyze() {
    const withSize = body.querySelector('[data-opt-size]')?.checked;
    const deep = body.querySelector('[data-opt-deep]')?.checked;
    body.innerHTML = '<div style="text-align:center;padding:24px 0"><h3>Analizando…</h3><progress></progress></div>';
    setFooter([{ label: 'Cancelar', class: 'ghost', action: () => modal.close() }]);
    try {
      analysis = await api.folders({ path: folder, kind, withSize, deep });
      const nuevaVigilada = await guardarCarpeta(deep);
      renderResults();
      if (nuevaVigilada) {
        toast('La carpeta quedó guardada: se revisará sola en cada arranque', {
          type: 'ok', title: 'Carpeta vigilada',
        });
      }
    } catch (err) {
      toast(err.message, { type: 'err' });
      renderKind();
    }
  }

  function renderResults() {
    step = 'results';
    if (kind === 'single') renderSingle();
    else if (kind === 'rom') renderRoms();
    else renderCollection();
  }

  function renderCollection() {
    const findings = analysis.findings || [];
    findings.forEach((finding) => chosen.add(finding.executable || finding.name));
    body.innerHTML = `
      <p class="panel-note">${findings.length} juegos detectados en <span class="mono">${esc(folder)}</span></p>
      <div class="scroll-y" style="max-height:46vh">
        ${findings.length ? findings.map((finding, index) => `
          <label class="scan-item">
            <input type="checkbox" ${finding.executable ? 'checked' : ''} data-idx="${index}">
            <span class="meta">
              <b>${esc(finding.name)}</b>
              <span class="mono">${esc(finding.executable || 'sin ejecutable detectado')}</span>
            </span>
            <span class="pill">confianza ${finding.confidence ?? '—'}</span>
          </label>`).join('') : '<p class="panel-note">No se detectaron juegos en esta carpeta. Prueba con “Es un solo juego” o agrega manualmente.</p>'}
      </div>`;
    const list = findings.filter((f) => f.executable);
    list.forEach((f) => chosen.add(f.executable));
    body.querySelectorAll('[data-idx]').forEach((input) => {
      const finding = findings[Number(input.dataset.idx)];
      input.addEventListener('change', () => {
        if (input.checked) chosen.add(finding.executable || finding.name);
        else chosen.delete(finding.executable || finding.name);
      });
    });
    setFooter([
      { label: 'Elegir otra carpeta', class: 'ghost', action: renderBrowse },
      { label: 'Cancelar', class: 'ghost', action: () => modal.close() },
      { label: 'Agregar seleccionados', class: 'primary', action: importCollection, disabled: !findings.length },
    ]);
  }

  async function importCollection() {
    const findings = analysis.findings || [];
    const picked = findings.filter((f) => chosen.has(f.executable || f.name));
    if (!picked.length) {
      toast('No marcaste ningún juego', { type: 'err' });
      return;
    }
    try {
      const result = await api.importFindings(picked.map((candidate) => ({ candidate })), { status: 'backlog' });
      toast(`${result.added} juegos agregados`, { type: 'ok', title: 'Listo' });
      await refresh({ quiet: true });
      modal.close();
    } catch (err) {
      toast(err.message, { type: 'err' });
    }
  }

  function renderSingle() {
    const candidates = analysis.candidates || [];
    body.innerHTML = `
      <p class="panel-note">Carpeta: <span class="mono">${esc(analysis.installDir || folder)}</span>${analysis.sizeBytes ? ` · ${esc(fmtBytes(analysis.sizeBytes))}` : ''}</p>
      <div class="form-grid mt">
        <label class="field full"><span>Nombre del juego</span><input class="input" data-name value="${esc(analysis.name || '')}"></label>
        <label class="field full"><span>Ejecutable</span>
          <select class="select" data-exe>
            ${candidates.length ? candidates.map((c) => `<option value="${esc(c.path)}">${esc(c.name)} (confianza ${c.score})</option>`).join('') : '<option value="">— no se detectó ningún ejecutable —</option>'}
          </select>
        </label>
        <label class="field full"><span>Argumentos</span><input class="input" data-args placeholder="(opcional)"></label>
      </div>
      ${analysis.coverFile ? `<p class="tiny muted mt">Carátula local encontrada: <span class="mono">${esc(analysis.coverFile)}</span></p>` : ''}
      <p class="tiny muted mt">¿Es un juego emulado? Luego puedes asignarle un perfil de emulador desde su ficha.</p>`;
    setFooter([
      { label: 'Elegir otra carpeta', class: 'ghost', action: renderBrowse },
      { label: 'Cancelar', class: 'ghost', action: () => modal.close() },
      { label: 'Agregar juego', class: 'primary', action: importSingle },
    ]);
  }

  async function importSingle() {
    const name = body.querySelector('[data-name]')?.value?.trim();
    const executable = body.querySelector('[data-exe]')?.value || null;
    const launchArgs = body.querySelector('[data-args]')?.value || '';
    if (!name) {
      toast('Ponle un nombre al juego', { type: 'err' });
      return;
    }
    try {
      await api.createGame({
        name,
        executable,
        launchArgs,
        installDir: analysis.installDir || folder,
        workDir: analysis.installDir || folder,
        coverFile: analysis.coverFile || null,
        backgroundFile: analysis.backgroundFile || null,
        sizeBytes: analysis.sizeBytes || 0,
        platform: 'manual',
        status: 'backlog',
      });
      toast(`“${name}” agregado`, { type: 'ok' });
      await refresh({ quiet: true });
      modal.close();
    } catch (err) {
      toast(err.message, { type: 'err' });
    }
  }

  function renderRoms() {
    const findings = analysis.findings || [];
    findings.forEach((f) => chosen.add(f.romPath));
    const consoles = analysis.consoles || [];
    const profiles = state.settings?.emulatorProfiles || [];
    body.innerHTML = `
      <p class="panel-note">${findings.length} ROMs detectadas${analysis.truncated ? ' (se alcanzó el límite, agrega por partes)' : ''}</p>
      <div class="chips" style="margin:10px 0">
        ${consoles.map((c) => `<span class="chip">${esc(c.label)} <span class="cnt">${c.count}</span></span>`).join('')}
      </div>
      <label class="field">
        <span>Perfil de emulador para estas ROMs</span>
        <select class="select" data-profile>
          <option value="">— asignar después —</option>
          ${profiles.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
        </select>
        <span class="hint">Se usa para lanzarlas. ${profiles.length ? '' : 'Configura emuladores en Ajustes.'}</span>
      </label>
      <div class="scroll-y mt" style="max-height:40vh">
        ${findings.map((finding, index) => `
          <label class="scan-item">
            <input type="checkbox" checked data-idx="${index}">
            <span class="meta">
              <b>${esc(finding.name)}</b>
              <span class="mono">${esc(finding.consoleLabel)} · ${esc(finding.romPath)}</span>
            </span>
          </label>`).join('')}
      </div>`;
    body.querySelectorAll('[data-idx]').forEach((input) => {
      const finding = findings[Number(input.dataset.idx)];
      input.addEventListener('change', () => {
        if (input.checked) chosen.add(finding.romPath);
        else chosen.delete(finding.romPath);
      });
    });
    setFooter([
      { label: 'Elegir otra carpeta', class: 'ghost', action: renderBrowse },
      { label: 'Cancelar', class: 'ghost', action: () => modal.close() },
      { label: 'Agregar ROMs', class: 'primary', action: importRoms },
    ]);

    async function importRoms() {
      const emulatorProfileId = body.querySelector('[data-profile]')?.value || null;
      const picked = findings.filter((f) => chosen.has(f.romPath));
      if (!picked.length) {
        toast('No marcaste ninguna ROM', { type: 'err' });
        return;
      }
      try {
        const result = await api.importFindings(
          picked.map((candidate) => ({ candidate: { ...candidate, emulatorProfileId } })),
          { status: 'backlog', emulatorProfileId }
        );
        toast(`${result.added} ROMs agregadas`, { type: 'ok' });
        await refresh({ quiet: true });
        modal.close();
      } catch (err) {
        toast(err.message, { type: 'err' });
      }
    }
  }

  if (step === 'kind') renderKind();
  else renderBrowse();
  return modal;
}

/* ----------------------------------------------------------------- alta manual */

export function openAddManual() {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <label class="field full"><span>Nombre *</span><input class="input" data-name placeholder="Mi juego"></label>
      <label class="field"><span>Plataforma</span>
        <select class="select" data-platform>
          ${state.platforms.map((p) => `<option value="${p.id}" ${p.id === 'manual' ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
        </select>
      </label>
      <label class="field"><span>Estado</span>
        <select class="select" data-status>
          ${state.statuses.map((s) => `<option value="${s.id}" ${s.id === 'playing' ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
        </select>
      </label>
      <label class="field full"><span>Ejecutable</span>
        <span class="inline-actions" style="gap:8px">
          <input class="input" data-executable style="flex:1" placeholder="C:\\Juegos\\MiJuego\\juego.exe">
          <button class="btn small" data-browse>Examinar…</button>
        </span>
      </label>
      <label class="field full"><span>Carpeta de instalación</span><input class="input" data-install placeholder="/home/usuario/Juegos/MiJuego"></label>
      <label class="field full"><span>Argumentos</span><input class="input" data-args placeholder="(opcional)"></label>
      <label class="field full"><span>Comando o URI (alternativa al ejecutable)</span><input class="input" data-command placeholder="steam://rungameid/123456"></label>
      <label class="field full"><span>Géneros / etiquetas</span><input class="input" data-tags placeholder="rpg, coop"></label>
    </div>
    <p class="tiny muted mt">Consejo: puedes lanzar cualquier cosa que se ejecute desde la terminal, por ejemplo <code>firefox {name}</code> o <code>retroarch -L …</code>.</p>`;

  const modal = openModal({
    title: 'Agregar juego manualmente',
    body,
    footer: document.createElement('div'),
  });
  modal.footer.innerHTML = '<div style="flex:1"></div>';
  const cancel = document.createElement('button');
  cancel.className = 'btn ghost';
  cancel.textContent = 'Cancelar';
  cancel.addEventListener('click', () => modal.close());
  const save = document.createElement('button');
  save.className = 'btn primary';
  save.textContent = 'Agregar';
  save.addEventListener('click', async () => {
    const name = body.querySelector('[data-name]').value.trim();
    if (!name) {
      toast('El nombre es obligatorio', { type: 'err' });
      return;
    }
    const tags = body.querySelector('[data-tags]').value.split(',').map((t) => t.trim()).filter(Boolean);
    save.disabled = true;
    try {
      await api.createGame({
        name,
        platform: body.querySelector('[data-platform]').value,
        status: body.querySelector('[data-status]').value,
        executable: body.querySelector('[data-executable]').value.trim() || null,
        installDir: body.querySelector('[data-install]').value.trim() || null,
        launchArgs: body.querySelector('[data-args]').value.trim(),
        launchCommand: body.querySelector('[data-command]').value.trim() || null,
        tags,
      });
      toast(`“${name}” agregado a la biblioteca`, { type: 'ok' });
      await refresh({ quiet: true });
      modal.close();
    } catch (err) {
      toast(err.message, { type: 'err' });
      save.disabled = false;
    }
  });
  modal.footer.append(save, cancel);

  body.querySelector('[data-args]')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') save.click();
  });

  body.querySelector('[data-browse]')?.addEventListener('click', () => {
    openFileBrowser({
      title: 'Elegir ejecutable',
      allowFiles: true,
      onPick: (picked) => {
        body.querySelector('[data-executable]').value = picked;
        const install = body.querySelector('[data-install]');
        if (!install.value) install.value = picked.replace(/[\\/][^\\/]+$/, '');
        const nameInput = body.querySelector('[data-name]');
        if (!nameInput.value) {
          const base = picked.split(/[\\/]/).pop().replace(/\.[^.]+$/, '').replace(/[._-]+/g, ' ');
          nameInput.value = base.charAt(0).toUpperCase() + base.slice(1);
        }
      },
    });
  });

  return modal;
}
