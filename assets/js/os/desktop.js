// desktop.js — Schreibtisch: Dateisymbole, Auswahlrahmen, Kontextmenü, Widgets

import { $, $$, h, coarse, store } from '../core/util.js';
import { icon } from '../core/icons.js';
import { bus } from './bus.js';
import { sys, settings, set, widgets, apps, appIcon, isImage, WALLPAPERS } from './sys.js';
import { registry } from './registry.js';
import { vfs, HOME, formatSize } from './vfs.js';
import { openMenu, fileIcon, fsops, renameInline, dialog } from './ui.js';
import { fileDrag, hostDrop } from './dnd.js';

const DIR = `${HOME}/Schreibtisch`;

/** Kontextmenü-Einträge, die für jede Datei gelten (Schreibtisch und Dateien-App teilen sie sich). */
export function fileMenu(st, { open, rename, extra = [] } = {}) {
  const handlers = st.type === 'file' ? sys.handlers(st) : [];
  const def = st.type === 'file' ? sys.defaultApp(st) : null;
  return [
    { label: 'Öffnen', icon: 'arrowUpRight', run: open },
    handlers.length > 0 && {
      label: 'Öffnen mit', items: handlers.map((a) => ({ label: a.name, app: a, checked: a.id === def, run: () => sys.openPath(st.path, a.id) })),
    },
    { label: 'Übersicht', icon: 'search', hint: 'Leertaste', run: () => sys.quicklook([st.path]) },
    '-',
    ...extra,
    { label: 'Umbenennen', icon: 'note', run: rename },
    { label: 'Duplizieren', icon: 'copy', run: () => fsops.duplicate(st.path) },
    { label: 'Kopieren', run: () => fsops.copy([st.path]) },
    st.type === 'file' && { label: 'Auf dieses Gerät laden', icon: 'download', run: () => fsops.download(st.path) },
    st.type === 'file' && fsops.canShare() && { label: 'Teilen …', icon: 'external', run: () => fsops.share(st.path) },
    st.type === 'file' && isImage(st.path, st.mime) && { label: 'Als Hintergrund verwenden', icon: 'image', run: () => sys.setWallpaperImage(st.path) },
    '-',
    { label: 'In den Papierkorb', icon: 'trash', run: () => fsops.trash(st.path) },
  ].filter(Boolean);
}

export function initDesktop() {
  const desk = $('#desktop');
  const box = $('#icons');
  let selected = new Set();
  box.dataset.dropPath = DIR;

  const paintSel = () => $$('.dicon', box).forEach((el) => el.classList.toggle('is-sel', selected.has(el.dataset.path)));
  const render = () => {
    let list = [];
    try { list = vfs.list(DIR); } catch { /* Ordner fehlt – leerer Schreibtisch */ }
    box.replaceChildren(...list.map((st) => {
      const label = h('span.dicon-name', st.name);
      const el = h('button.dicon', { type: 'button', dataset: { path: st.path } }, fileIcon(st), label);
      if (st.type === 'dir') el.dataset.dropPath = st.path;
      const open = () => sys.openPath(st.path);
      const rename = () => renameInline(label, (name) => fsops.rename(st.path, name));
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (coarse.matches) { open(); return; }
        if (!e.shiftKey && !e.metaKey && !e.ctrlKey) selected.clear();
        selected.add(st.path);
        paintSel();
      });
      el.addEventListener('dblclick', open);
      el.addEventListener('keydown', (e) => {
        if (e.target !== el) return;
        if (e.key === 'Enter') open();
        else if (e.key === 'Delete' || e.key === 'Backspace') { for (const p of selected.size ? [...selected] : [st.path]) fsops.trash(p); }
        else if (e.key === 'F2') rename();
        else if (e.code === 'Space') { e.preventDefault(); const all = list.map((s) => s.path); sys.quicklook(all, all.indexOf(st.path)); }
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!selected.has(st.path)) selected = new Set([st.path]);
        paintSel();
        openMenu(fileMenu(st, { open, rename }), { x: e.clientX, y: e.clientY });
      });
      fileDrag(el, () => (selected.has(st.path) ? [...selected] : [st.path]));
      return el;
    }));
    selected = new Set([...selected].filter((p) => vfs.exists(p)));
    paintSel();
  };
  render();
  bus.on('fs', (path) => { if (path === '/' || path.startsWith(DIR)) render(); });
  hostDrop(desk, () => DIR);

  // ---------- Kontextmenü des Schreibtischs ----------
  desk.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.win, #dock, #menubar, .widget, #overlays, #launchpad, #spaces')) return;
    e.preventDefault();
    const keys = Object.keys(WALLPAPERS);
    openMenu([
      { label: 'Neuer Ordner', icon: 'folder', run: () => fsops.newFolder(DIR) },
      { label: 'Neue Textdatei', icon: 'file', run: () => { const p = fsops.newFile(DIR); if (p) sys.openPath(p); } },
      { label: 'Vom Gerät importieren …', icon: 'download', run: () => sys.importToDesktop() },
      { label: 'Einsetzen', disabled: !fsops.clip, run: () => fsops.paste(DIR) },
      '-',
      {
        label: 'Hintergrund', icon: 'image', items: [
          ...keys.map((k) => ({ label: WALLPAPERS[k].name, checked: !settings.wallImage && settings.wallpaper === k, run: () => { set('wallImage', ''); set('wallpaper', k); } })),
          '-',
          { label: 'Eigenes Bild …', run: () => sys.open('settings', { tab: 'wall' }) },
        ],
      },
      { label: 'Widgets bearbeiten …', icon: 'grid', run: editWidgets },
      '-',
      { label: 'Übersicht', icon: 'layers', hint: 'F3', run: () => sys.wm.toggleOverview() },
      { label: 'Systemeinstellungen …', icon: 'gear', run: () => sys.open('settings') },
    ], { x: e.clientX, y: e.clientY });
  });

  // ---------- Auswahlrahmen ----------
  const rubber = $('#rubber');
  desk.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target !== desk && e.target !== box && e.target.id !== 'windows') return;
    if (sys.wm.overview) { sys.wm.toggleOverview(false); return; }
    document.body.classList.remove('show-desktop');
    selected.clear();
    paintSel();
    if (coarse.matches) return;
    const x0 = e.clientX, y0 = e.clientY;
    const move = (ev) => {
      const x = Math.min(x0, ev.clientX), y = Math.min(y0, ev.clientY);
      const w = Math.abs(ev.clientX - x0), hgt = Math.abs(ev.clientY - y0);
      if (w + hgt < 6) return;
      rubber.hidden = false;
      Object.assign(rubber.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${hgt}px` });
      selected = new Set($$('.dicon', box).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left < x + w && r.right > x && r.top < y + hgt && r.bottom > y;
      }).map((el) => el.dataset.path));
      paintSel();
    };
    const up = () => {
      rubber.hidden = true;
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });

  initWidgets();
}

// ==========================================================================
// Widgets: der Schreibtisch zeigt, was in settings.widgets steht (Schlüssel „app:widget“)
// ==========================================================================
function clockWidget(el) {
  const marks = Array.from({ length: 12 }, (_, i) => `<i style="--a:${i * 30}deg"></i>`).join('');
  el.classList.add('w-clock');
  el.innerHTML = `<div class="dial">${marks}<b class="hh"></b><b class="mm"></b><b class="ss"></b><em></em></div><span class="w-city">Ortszeit</span>`;
  const hands = { hh: el.querySelector('.hh'), mm: el.querySelector('.mm'), ss: el.querySelector('.ss') };
  const tick = () => {
    const d = new Date();
    const s = d.getSeconds(), m = d.getMinutes() + s / 60, hr = (d.getHours() % 12) + m / 60;
    hands.hh.style.rotate = `${hr * 30}deg`;
    hands.mm.style.rotate = `${m * 6}deg`;
    hands.ss.style.rotate = `${s * 6}deg`;
  };
  tick();
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}

function calendarWidget(el) {
  el.classList.add('w-cal');
  const paint = () => {
    const now = new Date();
    const y = now.getFullYear(), mo = now.getMonth();
    const first = (new Date(y, mo, 1).getDay() + 6) % 7;      // Montag = 0
    const days = new Date(y, mo + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < first; i++) cells.push('<span></span>');
    for (let d = 1; d <= days; d++) cells.push(`<span${d === now.getDate() ? ' class="today"' : ''}>${d}</span>`);
    el.innerHTML = `<div class="cal-head"><b>${now.toLocaleDateString('de-DE', { month: 'long' })}</b><span>${y}</span></div>
      <div class="cal-grid"><i>Mo</i><i>Di</i><i>Mi</i><i>Do</i><i>Fr</i><i>Sa</i><i>So</i>${cells.join('')}</div>`;
  };
  paint();
  const id = setInterval(paint, 60000);
  return () => clearInterval(id);
}

function noteWidget(el) {
  el.classList.add('w-note');
  const KEY = 'fableos.sticky';
  const area = h('textarea', { placeholder: 'Merkzettel …', spellcheck: false, 'aria-label': 'Merkzettel', value: store.get(KEY, 'Merkzettel\n\nHier ist Platz für einen Gedanken.') });
  area.addEventListener('input', () => store.set(KEY, area.value));
  area.addEventListener('keydown', (e) => e.stopPropagation());
  el.append(area);
  return null;
}

function storageWidget(el) {
  el.classList.add('w-store');
  const paint = async () => {
    const used = vfs.usage();
    let quota = 0;
    try { quota = (await navigator.storage?.estimate?.())?.quota || 0; } catch { /* ohne Schätzung */ }
    const files = vfs.find('', '/').length;
    el.replaceChildren(
      h('span.w-cap', 'Speicher'),
      h('b.w-big', formatSize(used)),
      h('div.kit-progress', { style: { '--p': quota ? Math.max(0.02, Math.min(1, used / quota)) : 0.02 } }, h('i')),
      h('span.w-sub', quota ? `von ${formatSize(quota)} · ${files} Objekte` : `${files} Objekte`));
  };
  paint();
  return bus.on('fs', paint);
}

function batteryWidget(el) {
  el.classList.add('w-batt');
  let batt = null;
  const paint = () => {
    const l = batt ? batt.level : 1;
    el.replaceChildren(
      h('div.w-ring', { style: { '--p': l, '--c': l < 0.2 ? 'var(--c-coral)' : 'var(--c-mint)' } }, h('b', batt ? `${Math.round(l * 100)}` : '–'), h('small', '%')),
      h('span.w-sub', !batt ? 'Akku nicht verfügbar' : batt.charging ? 'Lädt' : 'Akku'));
  };
  paint();
  navigator.getBattery?.().then((b) => {
    batt = b;
    paint();
    b.addEventListener('levelchange', paint);
    b.addEventListener('chargingchange', paint);
  }).catch(() => {});
  return () => { batt?.removeEventListener('levelchange', paint); batt?.removeEventListener('chargingchange', paint); };
}

/** Dialog „Widgets bearbeiten“: alles, was System und installierte Apps anbieten, ein- und ausschalten. */
function editWidgets() {
  const rows = [];
  for (const def of widgets.defs.values()) rows.push({ key: def.key, name: def.name, size: def.size, app: def.app === 'system' ? null : apps.get(def.app) });
  for (const app of apps.values()) {
    for (const w of app.widgetList || []) {
      const key = `${app.id}:${w.id}`;
      if (!rows.some((r) => r.key === key)) rows.push({ key, name: w.name, size: w.size, app, lazy: true });
    }
  }
  const list = h('div.wg-list.scroll', rows.map((r) => {
    const sw = h('button.gswitch', { type: 'button', role: 'switch', 'aria-checked': String(settings.widgets.includes(r.key)), 'aria-label': r.name }, h('i'));
    sw.addEventListener('click', async () => {
      const on = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', String(on));
      if (on && r.lazy) await registry.load(r.app.id, true);
      set('widgets', on ? [...settings.widgets.filter((k) => k !== r.key), r.key] : settings.widgets.filter((k) => k !== r.key));
    });
    return h('div.wg-row', r.app ? appIcon(r.app, 'sm') : h('span.note-ico', { html: icon('grid') }),
      h('span.wg-txt', h('b', r.name), h('small', `${r.app ? r.app.name : 'fableOS'} · ${r.size === 'm' ? 'breit' : 'klein'}`)), sw);
  }));
  dialog({
    icon: 'grid', title: 'Widgets', wide: true,
    text: 'Wähle, was rechts auf dem Schreibtisch liegt. Installierte Apps bringen eigene Widgets mit.',
    body: list, buttons: [{ label: 'Fertig', value: true, primary: true }],
  });
}
sys.editWidgets = editWidgets;

function initWidgets() {
  const box = $('#widgets');
  const live = new Map();     // Schlüssel → {el, def, cleanup}
  widgets.register('system', 'clock', { name: 'Uhr', size: 's', mount: clockWidget });
  widgets.register('system', 'calendar', { name: 'Kalender', size: 's', mount: calendarWidget });
  widgets.register('system', 'note', { name: 'Merkzettel', size: 's', mount: noteWidget });
  widgets.register('system', 'storage', { name: 'Speicher', size: 's', mount: storageWidget });
  if (navigator.getBattery) widgets.register('system', 'battery', { name: 'Akku', size: 's', mount: batteryWidget });

  const drop = (key) => {
    const w = live.get(key);
    if (!w) return;
    try { w.cleanup?.(); } catch (err) { console.error(err); }
    w.el.remove();
    live.delete(key);
  };
  const render = () => {
    const keys = [...new Set(settings.widgets || [])];
    for (const [key, w] of live) if (!keys.includes(key) || widgets.defs.get(key) !== w.def) drop(key);
    for (const key of keys) {
      const def = widgets.defs.get(key);
      if (!def || live.has(key)) continue;
      const el = h('div.widget.glass', { dataset: { key, size: def.size || 's' }, 'aria-label': def.name || key });
      let cleanup = null;
      try { cleanup = def.mount(el); } catch (err) { console.error(err); el.replaceChildren(h('span.widget-err', 'Widget nicht verfügbar')); }
      live.set(key, { el, def, cleanup });
    }
    const order = keys.map((k) => live.get(k)?.el).filter(Boolean);
    if (order.length !== box.children.length || order.some((el, i) => box.children[i] !== el)) box.replaceChildren(...order);
  };
  box.addEventListener('click', (e) => {
    const el = e.target.closest('.widget');
    if (!el || e.target.closest('button, input, select, textarea, a, [data-no-open]')) return;
    const app = el.dataset.key.split(':')[0];
    if (app !== 'system' && sys.apps.has(app)) sys.open(app);
  });
  box.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.widget');
    if (!el || e.target.closest('textarea, input')) return;
    e.preventDefault();
    e.stopPropagation();
    openMenu([
      { label: 'Widget entfernen', icon: 'close', run: () => set('widgets', settings.widgets.filter((k) => k !== el.dataset.key)) },
      { label: 'Widgets bearbeiten …', icon: 'grid', run: editWidgets },
    ], { x: e.clientX, y: e.clientY });
  });
  bus.on('widgets', render);
  bus.on('setting:widgets', render);
  render();
}
