// ui.js — gemeinsame Bausteine der Oberfläche: Popup-Menüs, Dialoge, Mitteilungen, Datei-Symbole, Datei-Aktionen

import { $, h, clamp, store } from '../core/util.js';
import { icon } from '../core/icons.js';
import { sfx } from '../core/audio.js';
import { bus } from './bus.js';
import { sys, settings, appIcon, apps, isImage, kindOf } from './sys.js';
import { vfs, extname, basename, dirname, TRASH } from './vfs.js';

// ==========================================================================
// Popup-Menüs (Menüleiste, Kontextmenüs) – mit Untermenüs
// ==========================================================================
let stack = [];        // offene Menüs, [0] ist die Wurzel
let rootInfo = null;   // {anchor, onClose}

export function closeMenu() {
  if (!stack.length) return;
  for (const el of stack) el.remove();
  stack = [];
  const info = rootInfo;
  rootInfo = null;
  info?.onClose?.();
  // Die Tastatur gehört danach wieder dem vorderen Fenster – außer der Menüpunkt hat etwas anderes fokussiert
  setTimeout(() => {
    const a = document.activeElement;
    if (stack.length || (a && a !== document.body && a.isConnected && !a.closest('#menubar'))) return;
    const w = sys.wm?.focused;
    if (!w) return;
    if (w.hooks.onFocus) w.hooks.onFocus(); else w.el.focus({ preventScroll: true });
  }, 0);
}
export const menuAnchor = () => rootInfo?.anchor || null;

function closeFrom(level) {
  for (const el of stack.splice(level)) { el._owner?.classList.remove('is-open'); el.remove(); }
}

function place(el, x, y) {
  el.style.left = `${clamp(x, 8, Math.max(8, innerWidth - el.offsetWidth - 8))}px`;
  el.style.top = `${clamp(y, 8, Math.max(8, innerHeight - el.offsetHeight - 8))}px`;
}

function build(items, level) {
  const el = h('div.menu.glass.thick.scroll', { role: 'menu' });
  let timer = 0;
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { el.append(h('hr')); continue; }
    if (it.heading) { el.append(h('div.menu-head', it.heading)); continue; }
    const sub = Array.isArray(it.items);
    const b = h('button', { type: 'button', role: 'menuitem', disabled: !!it.disabled, class: it.danger ? 'is-danger' : '' },
      h('span.menu-ico', { html: it.checked ? icon('check') : it.icon ? icon(it.icon) : '' }),
      it.app ? appIcon(it.app, 'xs') : null,
      h('span.menu-label', it.label),
      sub ? h('span.menu-hint.menu-more', { html: icon('chevronRight') }) : it.hint ? h('span.menu-hint', it.hint) : null);
    const openSub = () => {
      if (stack[level + 1]?._owner === b) return;
      closeFrom(level + 1);
      const child = build(it.items, level + 1);
      child._owner = b;
      b.classList.add('is-open');
      $('#overlays').append(child);
      const r = b.getBoundingClientRect();
      const right = r.right - 4 + child.offsetWidth <= innerWidth - 8;
      place(child, right ? r.right - 4 : r.left - child.offsetWidth + 4, r.top - 5);
      stack.push(child);
    };
    b.addEventListener('pointerenter', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (sub && !b.disabled) openSub(); else closeFrom(level + 1); }, sub ? 110 : 160);
    });
    b.addEventListener('pointerleave', () => clearTimeout(timer));
    b.addEventListener('click', () => {
      if (sub) { openSub(); return; }
      closeMenu();
      sfx.tick();
      it.run?.();
    });
    if (sub) b._openSub = openSub;
    el.append(b);
  }
  return el;
}

/**
 * items: [{label, icon?, hint?, checked?, disabled?, danger?, run}, {label, items: […]}, '-', {heading}]
 * Position: {x, y} oder {anchor, align: 'left' | 'right'}
 */
export function openMenu(items, { x = 0, y = 0, anchor = null, align = 'left', onClose } = {}) {
  closeMenu();
  const el = build(items, 0);
  $('#overlays').append(el);
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    x = align === 'right' ? r.right - el.offsetWidth : r.left;
    y = r.bottom + 7;
  }
  place(el, x, y);
  stack = [el];
  rootInfo = { anchor, onClose };
  return el;
}

document.addEventListener('pointerdown', (e) => {
  if (!stack.length) return;
  if (stack.some((el) => el.contains(e.target)) || rootInfo?.anchor?.contains(e.target)) return;
  closeMenu();
}, true);
addEventListener('keydown', (e) => {
  if (!stack.length) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); return; }
  const top = stack[stack.length - 1];
  const btns = [...top.querySelectorAll('button:not(:disabled)')];
  const cur = document.activeElement;
  const i = btns.indexOf(cur);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
  } else if (e.key === 'ArrowRight' && cur?._openSub) {
    e.preventDefault();
    cur._openSub();
    stack[stack.length - 1].querySelector('button:not(:disabled)')?.focus();
  } else if (e.key === 'ArrowLeft' && stack.length > 1) {
    e.preventDefault();
    const owner = top._owner;
    closeFrom(stack.length - 1);
    owner?.focus();
  }
}, true);
addEventListener('blur', closeMenu);
addEventListener('resize', closeMenu);

// ==========================================================================
// Systemweiter Dialog (zentriert, über allem)
// ==========================================================================
/**
 * dialog({title, text, app?, icon?, body?, buttons: [{label, value, primary?, danger?}], cancelValue})
 * → Promise mit dem Wert des gedrückten Knopfs (Esc: cancelValue).
 */
export function dialog({ title, text = '', app = null, icon: ic = null, body = null, wide = false, buttons = [{ label: 'OK', value: true, primary: true }], cancelValue = null } = {}) {
  return new Promise((resolve) => {
    closeMenu();
    const before = document.activeElement;
    const def = app && (typeof app === 'string' ? apps.get(app) : app);
    const done = (v) => {
      wrap.classList.add('out');
      setTimeout(() => wrap.remove(), 200);
      if (before?.isConnected) before.focus?.({ preventScroll: true });
      resolve(v);
    };
    const btns = buttons.map((b) => h(`button.kit-btn${b.primary ? '.primary' : ''}${b.danger ? '.danger' : ''}`, {
      type: 'button', onclick: () => done(typeof b.value === 'function' ? b.value() : b.value),
    }, b.label));
    const card = h(`div.sysdlg.glass.thick${wide ? '.wide' : ''}`, { role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' },
      def ? appIcon(def) : ic ? h('span.sysdlg-ico', { html: icon(ic) }) : null,
      title ? h('b.sysdlg-title', title) : null,
      text ? h('p.sysdlg-text', text) : null,
      body,
      h('div.sysdlg-btns', btns));
    const wrap = h('div.sysdlg-wrap', card);
    wrap.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); done(cancelValue); }
      else if (e.key === 'Enter' && !e.target.closest('textarea, button, select')) { e.preventDefault(); (btns.find((b) => b.classList.contains('primary')) || btns[btns.length - 1])?.click(); }
      else if (e.key === 'Tab') {
        const f = [...card.querySelectorAll('button, input, select, textarea')].filter((el) => !el.disabled);
        const i = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
      }
    });
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) { card.classList.remove('nudge'); void card.offsetWidth; card.classList.add('nudge'); } });
    $('#overlays').append(wrap);
    requestAnimationFrame(() => (card.querySelector('[data-autofocus]') || card.querySelector('input, textarea, select') || btns.find((b) => b.classList.contains('primary')) || btns[0])?.focus({ preventScroll: true }));
  });
}
export const confirmDialog = (o) => dialog({
  cancelValue: false, ...o,
  buttons: [{ label: o.cancel || 'Abbrechen', value: false }, { label: o.ok || 'OK', value: true, primary: !o.danger, danger: !!o.danger }],
});
sys.dialog = dialog;
sys.confirm = confirmDialog;

// ==========================================================================
// Mitteilungen: Banner + Verlauf für die Mitteilungszentrale
// ==========================================================================
const NOTES = 'fableos.notes';
export const noteLog = store.get(NOTES, []).filter((n) => n && n.title).slice(0, 40);
const clicks = new Map();        // id → onClick (nur in dieser Sitzung)
let unread = 0;
const persistNotes = () => store.set(NOTES, noteLog.map(({ id, title, body, app, icon: ic, time }) => ({ id, title, body, app, icon: ic, time })));

export const notes = {
  log: noteLog,
  get unread() { return unread; },
  seen() { if (unread) { unread = 0; bus.emit('notes'); } },
  remove(id) {
    const i = noteLog.findIndex((n) => n.id === id);
    if (i >= 0) { noteLog.splice(i, 1); clicks.delete(id); persistNotes(); bus.emit('notes'); }
  },
  clear() { noteLog.length = 0; clicks.clear(); unread = 0; persistNotes(); bus.emit('notes'); },
  /** Führt die Aktion einer Mitteilung aus (oder öffnet ihre App). */
  activate(n) {
    const fn = clicks.get(n.id);
    if (fn) fn();
    else if (n.app && apps.has(n.app)) sys.open(n.app);
  },
};
sys.notes = notes;

export function initNotify() {
  const box = $('#notes');
  sys.notify = ({ title, body = '', icon: ic = 'bell', app = null, onClick = null, ttl = 5200, force = false }) => {
    if (app && !apps.has(app)) return;                 // die App wurde inzwischen entfernt
    const n = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title: String(title), body: String(body), app, icon: ic, time: Date.now() };
    noteLog.unshift(n);
    noteLog.length = Math.min(noteLog.length, 40);
    if (onClick) clicks.set(n.id, onClick);
    persistNotes();
    if (!document.body.classList.contains('center-open')) unread++;
    bus.emit('notes', n);
    if (settings.dnd && !force) return;
    if (document.hidden && settings.sysNotes && window.Notification?.permission === 'granted') {
      navigator.serviceWorker?.ready.then((reg) => reg.showNotification(n.title, { body: n.body, icon: 'assets/icons/icon-192.png', badge: 'assets/icons/icon-192.png', tag: n.id })).catch(() => {});
    }
    const def = app && apps.get(app);
    const el = h('div.note.glass.thick', { role: 'status' },
      def ? appIcon(def, 'sm') : h('span.note-ico', { html: icon(ic) }),
      h('div.note-txt', h('b', n.title), n.body ? h('span', n.body) : null),
      h('button.note-x', { type: 'button', 'aria-label': 'Mitteilung schließen', html: icon('close') }));
    let gone = false;
    let timer = 0;
    const close = () => {
      if (gone) return;
      gone = true;
      clearTimeout(timer);
      el.classList.add('out');
      setTimeout(() => el.remove(), 480);
    };
    el.addEventListener('click', (e) => {
      if (!e.target.closest('.note-x')) notes.activate(n);
      close();
    });
    el.addEventListener('pointerenter', () => clearTimeout(timer));
    el.addEventListener('pointerleave', () => { if (!gone) timer = setTimeout(close, 1600); });
    timer = setTimeout(close, ttl);
    box.prepend(el);
    [...box.children].filter((c) => !c.classList.contains('out')).slice(4).forEach((c) => c.remove());
    sfx.notify();
  };
}

// ==========================================================================
// Datei-Symbole
// ==========================================================================
const FOLDER = `<svg viewBox="0 0 64 54" aria-hidden="true">
  <defs>
    <linearGradient id="fd-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f9bff"/><stop offset="1" stop-color="#2a6df4"/></linearGradient>
    <linearGradient id="fd-f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd0ff"/><stop offset="1" stop-color="#3f8cff"/></linearGradient>
  </defs>
  <path d="M3 11a7 7 0 0 1 7-7h13.500a5 5 0 0 1 3.800 1.700L31 10h23a7 7 0 0 1 7 7v6H3z" fill="url(#fd-b)"/>
  <rect x="3" y="15" width="58" height="36" rx="8" fill="url(#fd-f)"/>
  <path d="M5 23.500c0-4.200 3.400-7.500 7.500-7.500h39c4.200 0 7.500 3.400 7.500 7.500" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.500"/>
</svg>`;
const doc = (tag, tint, lines = '<path d="M11 28h28M11 35h28M11 42h17" stroke="#c4cbe4" stroke-width="2.600" stroke-linecap="round"/>') => `<svg viewBox="0 0 52 64" aria-hidden="true">
  <path d="M9 3h22l16 16v36a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6V9a6 6 0 0 1 6-6z" fill="#fff"/>
  <path d="M31 3v11a5 5 0 0 0 5 5h11z" fill="#ccd4ec"/>
  ${lines}
  <rect x="9" y="48" width="${tag.length * 7 + 8}" height="10" rx="3" fill="${tint}"/>
  <text x="${13}" y="56" font-size="8" font-weight="700" font-family="ui-monospace,Menlo,monospace" fill="#fff">${tag}</text>
</svg>`;
const TINTS = { md: '#8b5cff', txt: '#7d86a3', log: '#22a57a', js: '#f59f0b', mjs: '#f59f0b', json: '#e08a00', html: '#ff5d6c', htm: '#ff5d6c', css: '#2f8cff', svg: '#14b8c4', csv: '#22a57a', pdf: '#e5484d' };
const KIND_ART = {
  audio: ['#ff3d81', '<path d="M11 36v-6M17 40V26M23 37v-8M29 42V24M35 37v-8M41 35v-4" stroke="#ff9fc3" stroke-width="2.800" stroke-linecap="round"/>'],
  video: ['#8b5cff', '<rect x="11" y="24" width="30" height="19" rx="4" fill="#ddd4ff"/><path d="M23 29v9l8-4.500z" fill="#8b5cff"/>'],
};

export function fileIcon(st) {
  if (st.type === 'dir') return h('span.ficon', { html: FOLDER });
  if (isImage(st.path, st.mime)) {
    let src = '';
    try { src = vfs.read(st.path); } catch { /* egal */ }
    const el = h('span.ficon.img');
    if (src.startsWith('data:image/')) el.style.backgroundImage = `url("${src}")`;
    return el;
  }
  const ext = extname(st.path);
  const tag = (ext || 'txt').slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const art = KIND_ART[kindOf(st.path, st.mime)];
  if (art) return h('span.ficon', { html: doc(tag, art[0], art[1]) });
  return h('span.ficon', { html: doc(tag, TINTS[ext] || '#7d86a3') });
}

// ==========================================================================
// Datei-Aktionen (von Schreibtisch, Dateien-App und Menüleiste genutzt)
// ==========================================================================
const fail = (err) => { sfx.error(); sys.notify({ title: 'Das hat nicht geklappt', body: err.message, icon: 'close', force: true }); };
const readAs = (file, as) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  if (as === 'text') r.readAsText(file); else r.readAsDataURL(file);
});
const TEXT_NAME = /\.(txt|md|log|json|js|mjs|css|html?|csv|svg|xml|ya?ml|ini|sh|py|ts)$/i;
const safeName = (name) => (name.replace(/[/\\]/g, '-').trim().slice(0, 80) || 'Datei');

/** Inhalt einer VFS-Datei als Blob (Data-URLs werden dekodiert). */
export async function fileBlob(path) {
  const st = vfs.stat(path);
  const data = vfs.read(path);
  if (data.startsWith('data:')) return (await fetch(data)).blob();
  return new Blob([data], { type: st.mime || 'text/plain' });
}

export const fsops = {
  clip: null,      // {paths, cut} – Zwischenablage für Dateien
  newFolder(dir) {
    try {
      const path = `${dir}/${vfs.unique(dir, 'Neuer Ordner')}`;
      vfs.mkdir(path);
      return path;
    } catch (err) { fail(err); return null; }
  },
  newFile(dir, name = 'Unbenannt.txt', data = '') {
    try {
      const path = `${dir}/${vfs.unique(dir, name)}`;
      vfs.write(path, data);
      return path;
    } catch (err) { fail(err); return null; }
  },
  rename(path, name) {
    try {
      name = name.trim();
      if (!name || name === path.split('/').pop()) return path;
      return vfs.move(path, `${path.slice(0, path.lastIndexOf('/'))}/${name}`);
    } catch (err) { fail(err); return null; }
  },
  duplicate(path) {
    try {
      const dir = dirname(path);
      return vfs.copy(path, `${dir === '/' ? '' : dir}/${vfs.unique(dir, basename(path))}`);
    } catch (err) { fail(err); return null; }
  },
  trash(path) { try { vfs.trash(path); sfx.drop(); } catch (err) { fail(err); } },
  /** Verschiebt Pfade in einen Ordner (Ziel TRASH = Papierkorb). Liefert die Zahl der verschobenen Objekte. */
  moveInto(paths, dir) {
    let n = 0;
    for (const p of paths) {
      if (dirname(p) === dir || p === dir) continue;
      try {
        if (dir === TRASH) vfs.trash(p);
        else vfs.move(p, `${dir === '/' ? '' : dir}/${vfs.unique(dir, basename(p))}`);
        n++;
      } catch (err) { fail(err); break; }
    }
    if (n) sfx.drop();
    return n;
  },
  copy(paths, cut = false) { fsops.clip = { paths: [...paths], cut }; },
  paste(dir) {
    const c = fsops.clip;
    if (!c) return 0;
    let n = 0;
    for (const p of c.paths) {
      if (!vfs.exists(p)) continue;
      try {
        const target = `${dir === '/' ? '' : dir}/${vfs.unique(dir, basename(p))}`;
        if (c.cut) vfs.move(p, target); else vfs.copy(p, target);
        n++;
      } catch (err) { fail(err); break; }
    }
    if (c.cut) fsops.clip = null;
    return n;
  },
  /** Dateien vom echten Gerät (File-Objekte) in einen Ordner übernehmen. */
  async importHost(dir, files) {
    let n = 0;
    for (const f of files) {
      if (f.size > 40e6) { fail(new Error(`„${f.name}“ ist größer als 40 MB.`)); continue; }
      try {
        const text = f.type.startsWith('text/') || /json|javascript|xml/.test(f.type) || TEXT_NAME.test(f.name);
        const data = await readAs(f, text ? 'text' : 'dataURL');
        vfs.write(`${dir === '/' ? '' : dir}/${vfs.unique(dir, safeName(f.name))}`, data, f.type || undefined);
        n++;
      } catch (err) { fail(err); }
    }
    if (n) sfx.pop();
    return n;
  },
  /** Datei auf das echte Gerät laden. */
  async download(path) {
    try {
      const url = URL.createObjectURL(await fileBlob(path));
      const a = h('a', { href: url, download: basename(path), hidden: true });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) { fail(err); }
  },
  canShare: () => typeof navigator.share === 'function',
  /** Datei über das Teilen-Menü des Geräts weitergeben. */
  async share(path) {
    try {
      const blob = await fileBlob(path);
      const file = new File([blob], basename(path), { type: blob.type });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: basename(path) });
      else await navigator.share({ title: basename(path), text: blob.type.startsWith('text/') ? await blob.text() : basename(path) });
    } catch (err) { if (err?.name !== 'AbortError') fail(err); }
  },
  fail,
};

/** Macht ein Label vorübergehend editierbar (Umbenennen). */
export function renameInline(label, done) {
  const old = label.textContent;
  const input = h('input.rename', { type: 'text', value: old, spellcheck: false });
  label.replaceChildren(input);
  input.focus();
  const dot = old.lastIndexOf('.');
  input.setSelectionRange(0, dot > 0 ? dot : old.length);
  let finished = false;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    const v = input.value;
    label.textContent = old;
    if (commit) done(v);
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  for (const evt of ['click', 'dblclick', 'pointerdown']) input.addEventListener(evt, (e) => e.stopPropagation());
}
