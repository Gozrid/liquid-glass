// desktop.js — Schreibtisch: Dateisymbole, Auswahlrahmen, Kontextmenü, Widgets

import { $, $$, h, drag, coarse } from '../core/util.js';
import { bus } from './bus.js';
import { sys, settings, set, WALLPAPERS } from './sys.js';
import { vfs, HOME } from './vfs.js';
import { openMenu, fileIcon, fsops, renameInline } from './ui.js';

const DIR = `${HOME}/Schreibtisch`;

export function initDesktop() {
  const desk = $('#desktop');
  const box = $('#icons');
  let selected = new Set();

  const paintSel = () => $$('.dicon', box).forEach((el) => el.classList.toggle('is-sel', selected.has(el.dataset.path)));
  const render = () => {
    let list = [];
    try { list = vfs.list(DIR); } catch { /* Ordner fehlt – leerer Schreibtisch */ }
    box.replaceChildren(...list.map((st) => {
      const label = h('span.dicon-name', st.name);
      const el = h('button.dicon', { type: 'button', dataset: { path: st.path } }, fileIcon(st), label);
      const open = () => sys.openPath(st.path);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (coarse.matches) { open(); return; }
        if (!e.shiftKey && !e.metaKey && !e.ctrlKey) selected.clear();
        selected.add(st.path);
        paintSel();
      });
      el.addEventListener('dblclick', open);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') open();
        else if (e.key === 'Delete' || e.key === 'Backspace') fsops.trash(st.path);
        else if (e.key === 'F2') renameInline(label, (name) => fsops.rename(st.path, name));
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        selected = new Set([st.path]);
        paintSel();
        openMenu([
          { label: 'Öffnen', icon: 'arrowUpRight', run: open },
          { label: 'Umbenennen', icon: 'note', run: () => renameInline(label, (name) => fsops.rename(st.path, name)) },
          { label: 'Duplizieren', icon: 'copy', run: () => { try { vfs.copy(st.path, `${DIR}/${vfs.unique(DIR, st.name)}`); } catch (err) { fsops.fail(err); } } },
          '-',
          { label: 'In den Papierkorb', icon: 'trash', run: () => fsops.trash(st.path) },
        ], { x: e.clientX, y: e.clientY });
      });
      return el;
    }));
    selected = new Set([...selected].filter((p) => vfs.exists(p)));
    paintSel();
  };
  render();
  bus.on('fs', (path) => { if (path === '/' || path.startsWith(DIR)) render(); });

  // ---------- Kontextmenü des Schreibtischs ----------
  desk.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.win, #dock, #menubar, .widget, #overlays')) return;
    e.preventDefault();
    const keys = Object.keys(WALLPAPERS);
    openMenu([
      { label: 'Neuer Ordner', icon: 'folder', run: () => fsops.newFolder(DIR) },
      { label: 'Neue Textdatei', icon: 'file', run: () => { const p = fsops.newFile(DIR); if (p) sys.openPath(p); } },
      '-',
      { heading: 'Hintergrund' },
      ...keys.map((k) => ({ label: WALLPAPERS[k].name, checked: settings.wallpaper === k, run: () => set('wallpaper', k) })),
      '-',
      { label: 'Übersicht', icon: 'grid', run: () => sys.wm.toggleOverview() },
      { label: 'Einstellungen …', icon: 'gear', run: () => sys.open('settings') },
      { label: 'Über fableOS', icon: 'info', run: () => sys.open('about') },
    ], { x: e.clientX, y: e.clientY });
  });

  // ---------- Auswahlrahmen ----------
  const rubber = $('#rubber');
  desk.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target !== desk && e.target !== box && e.target.id !== 'windows') return;
    if (sys.wm.overview) { sys.wm.toggleOverview(false); return; }
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
// Widgets: Uhr und Kalender
// ==========================================================================
function initWidgets() {
  const box = $('#widgets');

  // Uhr
  const marks = Array.from({ length: 12 }, (_, i) => `<i style="--a:${i * 30}deg"></i>`).join('');
  const clock = h('div.widget.w-clock.glass', { html: `<div class="dial">${marks}<b class="hh"></b><b class="mm"></b><b class="ss"></b><em></em></div><span class="w-city">Ortszeit</span>` });
  const hands = { hh: clock.querySelector('.hh'), mm: clock.querySelector('.mm'), ss: clock.querySelector('.ss') };
  const tick = () => {
    const d = new Date();
    const s = d.getSeconds(), m = d.getMinutes() + s / 60, hr = (d.getHours() % 12) + m / 60;
    hands.hh.style.rotate = `${hr * 30}deg`;
    hands.mm.style.rotate = `${m * 6}deg`;
    hands.ss.style.rotate = `${s * 6}deg`;
  };
  tick();
  setInterval(tick, 1000);

  // Kalender
  const cal = h('div.widget.w-cal.glass');
  const paintCal = () => {
    const now = new Date();
    const y = now.getFullYear(), mo = now.getMonth();
    const first = (new Date(y, mo, 1).getDay() + 6) % 7;      // Montag = 0
    const days = new Date(y, mo + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < first; i++) cells.push('<span></span>');
    for (let d = 1; d <= days; d++) cells.push(`<span${d === now.getDate() ? ' class="today"' : ''}>${d}</span>`);
    cal.innerHTML = `<div class="cal-head"><b>${now.toLocaleDateString('de-DE', { month: 'long' })}</b><span>${y}</span></div>
      <div class="cal-grid"><i>Mo</i><i>Di</i><i>Mi</i><i>Do</i><i>Fr</i><i>Sa</i><i>So</i>${cells.join('')}</div>`;
  };
  paintCal();
  setInterval(paintCal, 60000);

  box.append(clock, cal);
  for (const w of [clock, cal]) {
    let ox = 0, oy = 0, bx = 0, by = 0;
    drag(w, {
      start: () => { bx = ox; by = oy; w.classList.add('is-drag'); },
      move: (e, c) => { ox = bx + c.dx; oy = by + c.dy; w.style.translate = `${ox}px ${oy}px`; },
      end: () => w.classList.remove('is-drag'),
    });
  }
}
