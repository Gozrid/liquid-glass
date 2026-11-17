// center.js — Mitteilungszentrale (gleitet von rechts herein) und der App-Umschalter (⌥ Tab)

import { $, h } from '../../core/util.js';
import { icon } from '../../core/icons.js';
import { sfx } from '../../core/audio.js';
import { bus } from '../bus.js';
import { sys, settings, set, apps, appIcon } from '../sys.js';
import { notes } from '../ui.js';
import { timeAgo } from '../kit.js';

// ==========================================================================
// Mitteilungszentrale
// ==========================================================================
export function initCenter() {
  const head = h('div.nc-head');
  const list = h('div.nc-list.scroll');
  const el = h('aside#center.glass.thick', { hidden: true, 'aria-label': 'Mitteilungen' }, head, list);
  $('#overlays').append(el);
  let open = false;
  let hideTimer = 0;

  const render = () => {
    const d = new Date();
    const dnd = h('button.gswitch', { type: 'button', role: 'switch', 'aria-checked': String(!!settings.dnd), 'aria-label': 'Nicht stören' }, h('i'));
    dnd.addEventListener('click', () => set('dnd', !settings.dnd));
    head.replaceChildren(
      h('div', h('b.nc-day', d.toLocaleDateString('de-DE', { weekday: 'long' })), h('span.nc-date', d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }))),
      h('label.nc-dnd', h('span', 'Nicht stören'), dnd));
    if (!notes.log.length) {
      list.replaceChildren(h('div.kit-empty', { html: icon('bell') }, h('b', 'Keine Mitteilungen'), h('span', 'Alles, was Apps dir melden, sammelt sich hier.')));
      return;
    }
    list.replaceChildren(
      h('div.nc-bar', h('span', `${notes.log.length} ${notes.log.length === 1 ? 'Mitteilung' : 'Mitteilungen'}`),
        h('button.kit-chip', { type: 'button', onclick: () => { notes.clear(); sfx.drop(); } }, 'Alle löschen')),
      ...notes.log.map((n) => {
        const app = n.app && apps.get(n.app);
        const card = h('div.nc-note', { role: 'button', tabIndex: 0 },
          app ? appIcon(app, 'sm') : h('span.note-ico', { html: icon(n.icon || 'bell') }),
          h('div.note-txt', h('b', n.title), n.body ? h('span', n.body) : null, h('small', `${app ? `${app.name} · ` : ''}${timeAgo(n.time)}`)),
          h('button.note-x', { type: 'button', 'aria-label': 'Mitteilung entfernen', html: icon('close') }));
        card.addEventListener('click', (e) => {
          if (e.target.closest('.note-x')) { notes.remove(n.id); return; }
          close();
          notes.activate(n);
        });
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter') card.click(); else if (e.key === 'Delete' || e.key === 'Backspace') notes.remove(n.id); });
        return card;
      }));
  };

  function close() {
    if (!open) return;
    open = false;
    el.classList.remove('on');
    document.body.classList.remove('center-open');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { el.hidden = true; }, 420);
  }
  const show = () => {
    if (open) return;
    open = true;
    clearTimeout(hideTimer);
    sys.controlCenter?.hide();
    el.hidden = false;
    document.body.classList.add('center-open');
    notes.seen();
    render();
    requestAnimationFrame(() => el.classList.add('on'));
  };
  bus.on('notes', () => { if (open) { notes.seen(); render(); } });
  bus.on('setting:dnd', () => { if (open) render(); });
  document.addEventListener('pointerdown', (e) => {
    if (open && !el.contains(e.target) && !e.target.closest('.mb-clock, .note, .menu')) close();
  }, true);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  sys.center = { open: show, close, toggle: () => (open ? close() : show()), get isOpen() { return open; } };
  return sys.center;
}

// ==========================================================================
// App-Umschalter: ⌥ halten, Tab wechselt, loslassen aktiviert, Q beendet
// ==========================================================================
export function initSwitcher() {
  const el = h('div#switcher.glass.thick', { hidden: true, role: 'listbox', 'aria-label': 'App-Umschalter' });
  $('#overlays').append(el);
  let list = [];
  let idx = 0;
  let open = false;

  const paint = () => {
    el.replaceChildren(...list.map((app, i) => h('div.sw-item', { role: 'option', 'aria-selected': String(i === idx) }, appIcon(app), h('span', app.name))));
  };
  const close = (activate) => {
    if (!open) return;
    open = false;
    el.hidden = true;
    if (activate && list[idx]) sys.wm.showApp(list[idx].id);
  };
  const step = (dir) => {
    if (!open) {
      list = sys.wm.running();
      if (!list.length) return;
      open = true;
      idx = list.length > 1 ? (dir > 0 ? 1 : list.length - 1) : 0;
      el.hidden = false;
    } else idx = (idx + dir + list.length) % list.length;
    paint();
    sfx.tick();
  };
  addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
    else if (e.code === 'KeyQ') {
      e.preventDefault();
      e.stopPropagation();
      const app = list[idx];
      if (!app) return;
      sys.wm.quitApp(app.id);
      list.splice(idx, 1);
      if (!list.length) { close(false); return; }
      idx %= list.length;
      paint();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); step(e.key === 'ArrowRight' ? 1 : -1); }
  }, true);
  addEventListener('keyup', (e) => { if (open && e.key === 'Alt') close(true); });
  addEventListener('blur', () => close(false));
  el.addEventListener('pointerdown', (e) => {
    const item = e.target.closest('.sw-item');
    if (!item) return;
    idx = [...el.children].indexOf(item);
    close(true);
  });
  return { step, get isOpen() { return open; } };
}
