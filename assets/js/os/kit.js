// kit.js — Baukasten für Apps: eigene Stile, App-Speicher, Dialoge (Sheets), Dateidialoge, Import/Export

import { h, store } from '../core/util.js';
import { icon } from '../core/icons.js';
import { vfs, HOME, TRASH, basename } from './vfs.js';
import { fileIcon } from './ui.js';

// ==========================================================================
// Stile und Speicher
// ==========================================================================
const styled = new Set();

/** Hängt die Stile einer App genau einmal ins Dokument. */
export function style(id, css) {
  if (styled.has(id)) return;
  styled.add(id);
  document.head.append(h('style', { dataset: { app: id }, text: css }));
}

/** Dauerhafter Speicher einer App (localStorage, eigener Namensraum). Werte müssen JSON-tauglich sein. */
export function appStore(appId) {
  const pre = `fableos.app.${appId}.`;
  return {
    get: (key, fallback = null) => store.get(pre + key, fallback),
    set: (key, value) => store.set(pre + key, value),
    del: (key) => store.del(pre + key),
    clear() {
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith(pre)) localStorage.removeItem(k);
      } catch { /* egal */ }
    },
  };
}

// ==========================================================================
// Kleine Bausteine
// ==========================================================================
/** Symbol-Knopf für Werkzeugleisten und win.tools. */
export const toolBtn = (name, label, onclick, cls = '') =>
  h(`button.tool${cls ? `.${cls}` : ''}`, { type: 'button', 'aria-label': label, title: label, html: icon(name), onclick });

/** Platzhalter für leere Ansichten. */
export const emptyState = (name, title, text = '') =>
  h('div.kit-empty', { html: icon(name) }, h('b', title), text ? h('span', text) : null);

/** Kurzer Hinweis am unteren Rand des Fensters. */
export function toast(win, text, ms = 1900) {
  win.body.querySelector(':scope > .kit-toast')?.remove();
  const el = h('div.kit-toast', { role: 'status' }, text);
  win.body.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
}

export const pad2 = (n) => String(n).padStart(2, '0');

/** „gerade eben“, „vor 5 Min.“, „gestern“, sonst Datum. */
export function timeAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 50) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} Std.`;
  if (s < 172800) return 'gestern';
  return new Date(ts).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ==========================================================================
// Sheets: Dialoge, die aus der Titelleiste des Fensters gleiten
// ==========================================================================
function mountSheet(win, card, onCancel, onEnter) {
  const wrap = h('div.kit-sheet-wrap', card);
  const before = document.activeElement;
  wrap.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    else if (e.key === 'Enter' && !e.target.closest('textarea, button, select')) { e.preventDefault(); onEnter?.(); }
    else if (e.key === 'Tab') {
      const f = [...card.querySelectorAll('button, input, select, textarea, [tabindex]')].filter((el) => !el.disabled && el.tabIndex >= 0);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  });
  wrap.addEventListener('pointerdown', (e) => e.stopPropagation());
  wrap.addEventListener('contextmenu', (e) => e.stopPropagation());
  win.el.append(wrap);
  requestAnimationFrame(() => (card.querySelector('[data-autofocus]') || card.querySelector('input, textarea, select') || card.querySelector('.kit-btn.primary') || card.querySelector('button'))?.focus({ preventScroll: true }));
  return () => {
    wrap.remove();
    if (before?.isConnected) before.focus?.({ preventScroll: true });
  };
}

/**
 * Allgemeiner Dialog. buttons: [{label, value, primary?, danger?}] – value darf eine Funktion sein.
 * Liefert den Wert des gedrückten Knopfs, bei Esc `cancelValue`.
 */
export function sheet(win, { title, text, body = null, wide = false, buttons = [{ label: 'OK', value: true, primary: true }], cancelValue = null } = {}) {
  return new Promise((resolve) => {
    let close = () => {};
    const done = (v) => { close(); resolve(v); };
    const btns = buttons.map((b) => h(`button.kit-btn${b.primary ? '.primary' : ''}${b.danger ? '.danger' : ''}`, {
      type: 'button', onclick: () => done(typeof b.value === 'function' ? b.value() : b.value),
    }, b.label));
    const card = h(`div.kit-sheet${wide ? '.wide' : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' },
      title ? h('b.kit-sheet-title', title) : null,
      text ? h('p.kit-sheet-text', text) : null,
      body,
      h('div.kit-sheet-btns', btns));
    close = mountSheet(win, card, () => done(cancelValue), () => (btns.find((b) => b.classList.contains('primary') || b.classList.contains('danger')) || btns[btns.length - 1])?.click());
  });
}

/** Ja/Nein-Frage → Promise<boolean> */
export const confirmSheet = (win, { title, text = '', ok = 'OK', cancel = 'Abbrechen', danger = false } = {}) =>
  sheet(win, { title, text, cancelValue: false, buttons: [{ label: cancel, value: false }, { label: ok, value: true, primary: !danger, danger }] });

/** Texteingabe → Promise<string | null> */
export function promptSheet(win, { title, text = '', value = '', placeholder = '', ok = 'OK', cancel = 'Abbrechen' } = {}) {
  const input = h('input.kit-field', { type: 'text', value, placeholder, spellcheck: false, autocomplete: 'off', 'aria-label': title || 'Eingabe' });
  requestAnimationFrame(() => input.select());
  return sheet(win, { title, text, body: input, buttons: [{ label: cancel, value: null }, { label: ok, value: () => input.value.trim() || null, primary: true }] });
}

// ==========================================================================
// Dateidialoge auf dem virtuellen Dateisystem
// ==========================================================================
const PLACES = [['Persönlich', HOME], ['Schreibtisch', `${HOME}/Schreibtisch`], ['Dokumente', `${HOME}/Dokumente`], ['Bilder', `${HOME}/Bilder`], ['Musik', `${HOME}/Musik`]];

function fileDialog(win, { title, dir, filter, save, name, ok }) {
  return new Promise((resolve) => {
    let cwd = dir && vfs.isDir(dir) ? dir : HOME;
    let sel = null;
    let close = () => {};
    const done = (v) => { close(); resolve(v); };
    const path = h('div.kit-fd-path');
    const list = h('div.kit-fd-list.scroll');
    const nameIn = save ? h('input.kit-field', { type: 'text', value: name || 'Unbenannt.txt', spellcheck: false, autocomplete: 'off', 'aria-label': 'Dateiname', 'data-autofocus': '' }) : null;
    const bOk = h('button.kit-btn.primary', { type: 'button' }, ok || (save ? 'Sichern' : 'Öffnen'));
    const bPlace = h('select.kit-field', { 'aria-label': 'Ort', style: { width: 'auto', flex: 'none' } }, PLACES.map(([n, p]) => h('option', { value: p }, n)));

    const paint = () => {
      const segs = cwd.split('/').filter(Boolean);
      path.replaceChildren(
        h('button', { type: 'button', onclick: () => go('/') }, 'fableOS'),
        ...segs.flatMap((s, i) => [h('i', { html: icon('chevronRight') }), h('button', { type: 'button', onclick: () => go(`/${segs.slice(0, i + 1).join('/')}`) }, s)]));
      const items = vfs.list(cwd).filter((st) => st.path !== TRASH);
      list.replaceChildren(...(items.length ? items.map((st) => {
        const usable = st.type === 'dir' || !filter || filter(st);
        const row = h('button.kit-row', { type: 'button', class: `${usable ? '' : 'is-off'}${st.path === sel ? ' is-on' : ''}`, disabled: !usable && !save }, fileIcon(st), h('span.grow', st.name));
        row.addEventListener('click', () => {
          if (st.type === 'dir') { go(st.path); return; }
          sel = st.path;
          if (nameIn) nameIn.value = st.name;
          for (const c of list.children) c.classList.toggle('is-on', c === row);
          bOk.disabled = false;
        });
        row.addEventListener('dblclick', () => { if (st.type === 'file' && usable) finish(); });
        row.addEventListener('keydown', (e) => { if (e.key === 'Enter' && st.type === 'file' && usable && st.path === sel) { e.preventDefault(); finish(); } });
        return row;
      }) : [h('div.kit-empty', h('span', 'Dieser Ordner ist leer.'))]));
      bOk.disabled = !save && !sel;
      bPlace.value = PLACES.some(([, p]) => p === cwd) ? cwd : '';
    };
    const go = (p) => { if (vfs.isDir(p)) { cwd = p; sel = null; paint(); } };
    const finish = async () => {
      if (!save) { if (sel) done(sel); return; }
      const n = nameIn.value.trim();
      if (!n || n.includes('/')) { nameIn.focus(); return; }
      const target = `${cwd === '/' ? '' : cwd}/${n}`;
      if (vfs.isDir(target)) { go(target); return; }
      if (vfs.exists(target)) {
        const yes = await confirmSheet(win, { title: `„${n}“ ersetzen?`, text: 'In diesem Ordner gibt es bereits eine Datei mit diesem Namen.', ok: 'Ersetzen', danger: true });
        if (!yes) return;
      }
      done(target);
    };
    bOk.addEventListener('click', finish);
    bPlace.addEventListener('change', () => go(bPlace.value));

    const card = h('div.kit-sheet.wide', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('b.kit-sheet-title', title),
      nameIn ? h('label.kit-fd-name', h('span', 'Sichern als'), nameIn) : null,
      h('div.kit-fd', h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', minWidth: 0 } }, bPlace, path), list),
      h('div.kit-sheet-btns', h('button.kit-btn', { type: 'button', onclick: () => done(null) }, 'Abbrechen'), bOk));
    paint();
    close = mountSheet(win, card, () => done(null), finish);
  });
}

/** Datei aus dem virtuellen Dateisystem wählen → Promise<Pfad | null>. filter(stat) blendet Unpassendes aus. */
export const openDialog = (win, { title = 'Öffnen', dir = HOME, filter = null, ok } = {}) => fileDialog(win, { title, dir, filter, ok, save: false });

/** Zielpfad zum Sichern wählen → Promise<Pfad | null>. Fragt vor dem Überschreiben nach. */
export const saveDialog = (win, { title = 'Sichern', dir = `${HOME}/Dokumente`, name = 'Unbenannt.txt', filter = null, ok } = {}) => fileDialog(win, { title, dir, name, filter, ok, save: true });

// ==========================================================================
// Austausch mit dem echten Gerät
// ==========================================================================
/** Liest ein File/Blob als Data-URL ('dataURL') oder Text ('text'). */
export const readFile = (file, as = 'dataURL') => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  if (as === 'text') r.readAsText(file); else r.readAsDataURL(file);
});

/** Öffnet den Dateiwähler des Geräts → Promise<[{name, type, size, data}]> (leer bei Abbruch). */
export function importFiles({ accept = '', multiple = false, as = 'dataURL' } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, hidden: true });
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; input.remove(); resolve(v); } };
    input.addEventListener('change', async () => {
      const out = [];
      for (const f of input.files) {
        try { out.push({ name: f.name, type: f.type, size: f.size, data: await readFile(f, as) }); } catch { /* unlesbar – überspringen */ }
      }
      finish(out);
    });
    input.addEventListener('cancel', () => finish([]));
    document.body.append(input);
    input.click();
  });
}

/** Lädt Text, eine Data-URL oder einen Blob als Datei auf das Gerät herunter. */
export function download(name, data, mime = 'text/plain') {
  const isBlob = data instanceof Blob;
  const url = isBlob ? URL.createObjectURL(data) : /^data:/.test(data) ? data : URL.createObjectURL(new Blob([data], { type: mime }));
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export { basename };
