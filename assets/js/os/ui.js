// ui.js — gemeinsame Bausteine der Oberfläche: Popup-Menüs, Mitteilungen, Datei-Symbole, Datei-Aktionen

import { $, h, clamp } from '../core/util.js';
import { icon } from '../core/icons.js';
import { sfx } from '../core/audio.js';
import { sys, settings, appIcon, apps, isImage } from './sys.js';
import { vfs, extname } from './vfs.js';

// ==========================================================================
// Popup-Menüs (Menüleiste, Kontextmenüs)
// ==========================================================================
let cur = null;

export function closeMenu() {
  if (!cur) return;
  const c = cur;
  cur = null;
  c.el.remove();
  c.onClose?.();
}
export const menuAnchor = () => cur?.anchor || null;

/**
 * items: [{label, icon?, hint?, checked?, disabled?, run}, '-', {heading}]
 * Position: {x, y} oder {anchor, align: 'left' | 'right'}
 */
export function openMenu(items, { x = 0, y = 0, anchor = null, align = 'left', onClose } = {}) {
  closeMenu();
  const el = h('div.menu.glass.thick', { role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { el.append(h('hr')); continue; }
    if (it.heading) { el.append(h('div.menu-head', it.heading)); continue; }
    const b = h('button', { type: 'button', role: 'menuitem', disabled: !!it.disabled },
      h('span.menu-ico', { html: it.checked ? icon('check') : it.icon ? icon(it.icon) : '' }),
      h('span.menu-label', it.label),
      it.hint ? h('span.menu-hint', it.hint) : null);
    b.addEventListener('click', () => { closeMenu(); sfx.tick(); it.run?.(); });
    el.append(b);
  }
  $('#overlays').append(el);
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    x = align === 'right' ? r.right - el.offsetWidth : r.left;
    y = r.bottom + 7;
  }
  el.style.left = `${clamp(x, 8, Math.max(8, innerWidth - el.offsetWidth - 8))}px`;
  el.style.top = `${clamp(y, 8, Math.max(8, innerHeight - el.offsetHeight - 8))}px`;
  cur = { el, onClose, anchor };
  return el;
}

document.addEventListener('pointerdown', (e) => {
  if (cur && !cur.el.contains(e.target) && !(cur.anchor && cur.anchor.contains(e.target))) closeMenu();
}, true);
addEventListener('keydown', (e) => {
  if (!cur) return;
  if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const btns = [...cur.el.querySelectorAll('button:not(:disabled)')];
  const i = btns.indexOf(document.activeElement);
  btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
});
addEventListener('blur', closeMenu);
addEventListener('resize', closeMenu);

// ==========================================================================
// Mitteilungen
// ==========================================================================
export const noteLog = [];

export function initNotify() {
  const box = $('#notes');
  sys.notify = ({ title, body = '', icon: ic = 'bell', app = null, onClick = null, ttl = 5200, force = false }) => {
    noteLog.unshift({ title, body, time: Date.now() });
    noteLog.length = Math.min(noteLog.length, 40);
    if (settings.dnd && !force) return;
    const def = app && apps.get(app);
    const el = h('div.note.glass.thick', { role: 'status' },
      def ? appIcon(def, 'sm') : h('span.note-ico', { html: icon(ic) }),
      h('div.note-txt', h('b', title), body ? h('span', body) : null),
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
      if (!e.target.closest('.note-x') && onClick) onClick();
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
const doc = (tag, tint) => `<svg viewBox="0 0 52 64" aria-hidden="true">
  <path d="M9 3h22l16 16v36a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6V9a6 6 0 0 1 6-6z" fill="#fff"/>
  <path d="M31 3v11a5 5 0 0 0 5 5h11z" fill="#ccd4ec"/>
  <path d="M11 28h28M11 35h28M11 42h17" stroke="#c4cbe4" stroke-width="2.600" stroke-linecap="round"/>
  <rect x="9" y="48" width="${tag.length * 7 + 8}" height="10" rx="3" fill="${tint}"/>
  <text x="${13}" y="56" font-size="8" font-weight="700" font-family="ui-monospace,Menlo,monospace" fill="#fff">${tag}</text>
</svg>`;

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
  const tint = { md: '#8b5cff', txt: '#7d86a3', log: '#22a57a', js: '#f59f0b', json: '#f59f0b' }[ext] || '#7d86a3';
  return h('span.ficon', { html: doc((ext || 'txt').slice(0, 4).toUpperCase(), tint) });
}

// ==========================================================================
// Datei-Aktionen (von Schreibtisch, Dateien-App und Menüleiste genutzt)
// ==========================================================================
const fail = (err) => { sfx.error(); sys.notify({ title: 'Das hat nicht geklappt', body: err.message, icon: 'close', force: true }); };

export const fsops = {
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
  trash(path) { try { vfs.trash(path); sfx.drop(); } catch (err) { fail(err); } },
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
