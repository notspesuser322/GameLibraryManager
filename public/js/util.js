/* Utilidades de interfaz: formato, avisos, modales y menú contextual. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Escapa texto para insertarlo en HTML. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/* ------------------------------------------------------------------- formato */

export function fmtDuration(seconds = 0, style = 'short') {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (style === 'clock') {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  if (style === 'long') {
    if (h) return `${h} h ${m} min`;
    if (m) return `${m} min`;
    return `${s} s`;
  }
  if (h) return m ? `${h} h ${m} min` : `${h} h`;
  if (m) return `${m} min`;
  return `${s} s`;
}

/** Horas con un decimal, en formato local (12,5 h). */
export function fmtHours(seconds = 0) {
  const hours = seconds / 3600;
  if (hours === 0) return '0 h';
  if (hours < 0.5) return `${Math.max(1, Math.round(seconds / 60))} min`;
  if (hours < 10) return `${hours.toFixed(1).replace('.', ',')} h`;
  return `${Math.round(hours).toLocaleString('es')} h`;
}

export function fmtBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : 1).replace('.', ',')} ${units[i]}`;
}

export function fmtDate(value, options = {}) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric', ...options });
}

export function fmtDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return date.toLocaleString('es', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function relTime(value) {
  if (!value) return 'nunca';
  const then = new Date(value).getTime();
  const diff = Date.now() - then;
  if (Number.isNaN(then)) return 'nunca';
  const min = Math.round(diff / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  const months = Math.round(days / 30);
  if (months < 12) return `hace ${months} ${months === 1 ? 'mes' : 'meses'}`;
  const years = Math.round(months / 12);
  return `hace ${years} ${years === 1 ? 'año' : 'años'}`;
}

/* -------------------------------------------------------------------- avisos */

export function toast(message, { type = '', title = '', timeout = 4200 } = {}) {
  const root = $('#toasts');
  if (!root) return;
  const node = el('div', { class: `toast ${type}` });
  if (title) node.append(el('b', {}, title));
  node.append(el('span', {}, message));
  root.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity 200ms, transform 200ms';
    node.style.opacity = '0';
    node.style.transform = 'translateX(14px)';
    setTimeout(() => node.remove(), 220);
  }, timeout);
  return node;
}

/* -------------------------------------------------------------------- modales */

const modalStack = [];

export function openModal({
  title,
  size = '',
  body,
  footer,
  onClose,
  closeOnBackdrop = true,
} = {}) {
  const root = $('#modal-root');
  const layer = el('div', { class: 'modal-layer' });
  const backdrop = el('div', { class: 'backdrop' });
  const modal = el('div', { class: `modal ${size}` });
  const head = el('div', { class: 'modal-head' });
  head.append(el('h2', {}, title || ''));
  head.append(el('div', { class: 'spacer' }));
  const closeBtn = el('button', { class: 'icon-btn', title: 'Cerrar (Esc)', 'aria-label': 'Cerrar' });
  closeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  head.append(closeBtn);
  modal.append(head);

  const bodyWrap = el('div', { class: 'modal-body' });
  if (body instanceof Node) bodyWrap.append(body);
  else bodyWrap.innerHTML = body || '';
  modal.append(bodyWrap);

  const foot = el('div', { class: 'modal-foot' });
  if (footer instanceof Node) foot.append(footer);
  else if (footer) foot.innerHTML = footer;
  if (foot.childNodes.length) modal.append(foot);
  else foot.remove();

  layer.append(backdrop, modal);
  root.hidden = false;
  root.append(layer);

  const handle = {
    layer,
    modal,
    body: bodyWrap,
    head,
    footer: foot,
    close() {
      const index = modalStack.indexOf(handle);
      if (index >= 0) modalStack.splice(index, 1);
      layer.remove();
      if (!modalStack.length) root.hidden = true;
      onClose?.();
    },
    setTitle(text) {
      head.querySelector('h2').textContent = text;
    },
  };

  closeBtn.addEventListener('click', () => handle.close());
  backdrop.addEventListener('click', () => { if (closeOnBackdrop) handle.close(); });
  modal.addEventListener('mousedown', (event) => event.stopPropagation());
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      const primary = foot.querySelector('.btn.primary');
      primary?.click();
    }
  });
  modal.setAttribute('tabindex', '-1');

  modalStack.push(handle);
  const focusable = modal.querySelector('input, select, textarea, button.primary');
  setTimeout(() => focusable?.focus(), 30);
  return handle;
}

export function closeTopModal() {
  const top = modalStack[modalStack.length - 1];
  if (top) {
    top.close();
    return true;
  }
  return false;
}

export function anyModalOpen() {
  return modalStack.length > 0;
}

/** Diálogo de confirmación con promesa. */
export function confirmDialog(message, { title = 'Confirmar', confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false } = {}) {
  return new Promise((resolve) => {
    const body = el('div', {});
    body.innerHTML = `<p style="margin:0 0 6px">${esc(message)}</p>`;
    const footer = el('div', { class: 'inline-actions', style: 'width:100%' });
    const cancel = el('button', { class: 'btn ghost' }, cancelLabel);
    const ok = el('button', { class: `btn ${danger ? 'danger' : 'primary'}` }, confirmLabel);
    footer.append(el('div', { class: 'spacer', style: 'flex:1' }), cancel, ok);
    const modal = openModal({ title, size: 'narrow', body, footer });
    cancel.addEventListener('click', () => { modal.close(); resolve(false); });
    ok.addEventListener('click', () => { modal.close(); resolve(true); });
    modal.layer.addEventListener('modal-closed', () => resolve(false));
    ok.focus();
  });
}

/** Diálogo con un campo de texto. */
export function promptDialog(message, { title = '', value = '', placeholder = '', confirmLabel = 'Guardar' } = {}) {
  return new Promise((resolve) => {
    const body = el('div', { class: 'form-grid' });
    const label = el('label', { class: 'field full' });
    label.innerHTML = `<span>${esc(message)}</span>`;
    const input = el('input', { class: 'input', value, placeholder });
    label.append(input);
    body.append(label);
    const footer = el('div', { class: 'inline-actions', style: 'width:100%' });
    const cancel = el('button', { class: 'btn ghost' }, 'Cancelar');
    const ok = el('button', { class: 'btn primary' }, confirmLabel);
    footer.append(el('div', { style: 'flex:1' }), cancel, ok);
    const modal = openModal({ title, size: 'narrow', body, footer });
    let result = null;
    cancel.addEventListener('click', () => { result = null; modal.close(); });
    ok.addEventListener('click', () => { result = input.value.trim(); modal.close(); });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { result = input.value.trim(); modal.close(); }
    });
    modal.layer.addEventListener('transitionend', () => {});
    const observer = new MutationObserver(() => {
      if (!document.body.contains(modal.layer)) {
        observer.disconnect();
        resolve(result);
      }
    });
    observer.observe($('#modal-root'), { childList: true });
    setTimeout(() => { input.focus(); input.select(); }, 40);
  });
}

/* ------------------------------------------------------- menú contextual */

export function contextMenu(x, y, items) {
  const menu = $('#ctx-menu');
  menu.innerHTML = '';
  for (const item of items) {
    if (item.sep) {
      menu.append(el('div', { class: 'sep' }));
      continue;
    }
    if (item.labelOnly) {
      menu.append(el('div', { class: 'label' }, item.labelOnly));
      continue;
    }
    const button = el('button', { class: item.danger ? 'danger' : '' });
    button.innerHTML = `${item.icon || ''}<span>${esc(item.label)}</span>`;
    button.addEventListener('click', () => {
      hideContextMenu();
      item.action?.();
    });
    menu.append(button);
  }
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 10);
  const top = Math.min(y, window.innerHeight - rect.height - 10);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

export function hideContextMenu() {
  const menu = $('#ctx-menu');
  if (menu) menu.hidden = true;
}

/* -------------------------------------------------------------------- otros */

export function debounce(fn, ms = 220) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function downloadText(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

export function pickFile(accept = 'image/*') {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept });
    input.style.display = 'none';
    document.body.append(input);
    input.addEventListener('change', () => {
      const file = input.files?.[0] || null;
      input.remove();
      resolve(file);
    });
    input.click();
  });
}

export function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function sortGames(games, key, direction = 'asc') {
  const dir = direction === 'desc' ? -1 : 1;
  const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
  const sorters = {
    name: (a, b) => collator.compare(a.name, b.name),
    playtime: (a, b) => (a.playtimeSeconds || 0) - (b.playtimeSeconds || 0),
    lastPlayed: (a, b) => new Date(a.lastPlayed || 0) - new Date(b.lastPlayed || 0),
    added: (a, b) => new Date(a.addedAt || 0) - new Date(b.addedAt || 0),
    rating: (a, b) => (a.rating || 0) - (b.rating || 0),
    release: (a, b) => new Date(a.releaseDate || 0) - new Date(b.releaseDate || 0),
    size: (a, b) => (a.sizeBytes || 0) - (b.sizeBytes || 0),
  };
  const sorter = sorters[key] || sorters.name;
  return [...games].sort((a, b) => sorter(a, b) * dir);
}

export function groupGames(games, groupBy, statuses = []) {
  if (!groupBy || groupBy === 'none') return [{ key: 'all', label: '', games }];
  const buckets = new Map();
  const push = (key, label, game) => {
    if (!buckets.has(key)) buckets.set(key, { key, label, games: [] });
    buckets.get(key).games.push(game);
  };
  for (const game of games) {
    if (groupBy === 'platform') push(game.platform, game.platformLabel || game.platform, game);
    else if (groupBy === 'status') {
      const meta = statuses.find((s) => s.id === game.status) || { id: game.status, label: game.status };
      push(meta.id, meta.label, game);
    } else if (groupBy === 'letter') {
      const letter = (game.name || '#').trim().charAt(0).toUpperCase() || '#';
      push(/[A-Z]/.test(letter) ? letter : '#', /[A-Z]/.test(letter) ? letter : '#', game);
    } else if (groupBy === 'year') {
      const year = (game.releaseDate || '').slice(0, 4) || 'Sin año';
      push(year, year, game);
    } else if (groupBy === 'genre') {
      const genre = (game.genres || [])[0] || 'Sin género';
      push(genre, genre, game);
    }
  }
  return [...buckets.values()];
}

export function humanizeDay(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  return date.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
}
