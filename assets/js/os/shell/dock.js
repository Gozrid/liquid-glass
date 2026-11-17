// dock.js — Dock: angeheftete und laufende Apps, Lupe, Umsortieren per Ziehen, Papierkorb

import { $, h, ticker, coarse } from '../../core/util.js';
import { icon } from '../../core/icons.js';
import { sfx } from '../../core/audio.js';
import { bus } from '../bus.js';
import { sys, settings, apps, appIcon } from '../sys.js';
import { registry } from '../registry.js';
import { vfs, TRASH } from '../vfs.js';
import { openMenu } from '../ui.js';

export function initDock() {
  const dock = $('#dock');
  const tip = $('#dock-tip');
  const wm = sys.wm;
  let items = [];     // {id, name, el, s, target}
  let dragging = null;
  let noClick = false;
  let mx = null;
  let active = false;

  const bounce = (el) => {
    el.classList.remove('bounce');
    void el.offsetWidth;
    el.classList.add('bounce');
  };
  const launch = (id, el) => {
    const app = apps.get(id);
    if (!app) return;
    if (app.action) { app.action(); return; }
    const wins = wm.byApp(id);
    if (!wins.length) { bounce(el); sys.open(id); return; }
    const here = wins.filter((w) => w.space === wm.space);
    if (!here.length) { wm.showApp(id); return; }                 // die App lebt auf einem anderen Schreibtisch
    const hidden = here.filter((w) => w.min);
    if (hidden.length) { hidden[hidden.length - 1].restore(); return; }
    const sorted = [...here].sort((a, b) => b.z - a.z);
    // ist die App schon vorn, wandert der Fokus zu ihrem nächsten Fenster
    wm.focus(wm.focused === sorted[0] && sorted.length > 1 ? sorted[sorted.length - 1] : sorted[0]);
  };

  const menuFor = (id, e) => {
    const app = apps.get(id);
    const wins = wm.byApp(id);
    const pinned = registry.isPinned(id);
    openMenu([
      { heading: app.name },
      !app.action && { label: wins.length && !app.singleton ? 'Neues Fenster' : 'Öffnen', run: () => sys.open(id) },
      app.action && { label: 'Öffnen', run: () => app.action() },
      !app.action && { label: 'Alle Fenster zeigen', disabled: !wins.length, run: () => wm.showApp(id) },
      !app.action && { label: 'Ausblenden', disabled: !wins.some((w) => !w.min), run: () => wm.hideApp(id) },
      '-',
      {
        label: 'Optionen', items: [
          { label: 'Im Dock behalten', checked: pinned, run: () => (pinned ? registry.unpin(id) : registry.pin(id)) },
          registry.isInstalled(id) && { label: 'Im App Store zeigen', run: () => sys.open('store', { app: id }) },
        ].filter(Boolean),
      },
      !app.action && '-',
      !app.action && { label: 'Beenden', disabled: !wins.length, run: () => wm.quitApp(id) },
    ].filter(Boolean), { x: e.clientX - 20, y: e.clientY - 230 });
  };

  // ---------- Umsortieren: Symbol ziehen; weit nach oben gezogen verlässt es das Dock ----------
  const armDrag = (it) => {
    const el = it.el;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || coarse.matches) return;
      const x0 = e.clientX, y0 = e.clientY;
      let on = false;
      const move = (ev) => {
        const dy = ev.clientY - y0;
        if (!on) {
          if (Math.hypot(ev.clientX - x0, dy) < 7) return;
          on = true;
          dragging = it;
          mx = null;
          wake();
          tip.classList.remove('on');
          el.classList.add('is-dragging');
        }
        const row = items.filter((i) => i.id !== '__trash').map((i) => i.el);
        const idx = row.indexOf(el);
        const mid = (n) => { const r = n.getBoundingClientRect(); return r.left + r.width / 2; };
        const prev = row[idx - 1], next = row[idx + 1];
        if (prev && ev.clientX < mid(prev)) dock.insertBefore(el, prev);
        else if (next && ev.clientX > mid(next)) dock.insertBefore(next, el);
        items.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
        const base = dock.getBoundingClientRect().left + el.offsetLeft + el.offsetWidth / 2;
        el.style.translate = `${ev.clientX - base}px ${Math.min(0, dy)}px`;
        el.classList.toggle('is-out', dy < -110);
      };
      const up = (ev) => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        removeEventListener('pointercancel', up);
        if (!on) return;
        const out = ev.clientY - y0 < -110;
        el.classList.remove('is-dragging', 'is-out');
        el.style.translate = '';
        dragging = null;
        noClick = true;
        setTimeout(() => { noClick = false; }, 60);
        if (out && registry.isPinned(it.id)) { registry.unpin(it.id); sfx.drop(); }
        else registry.setPins(items.filter((i) => i.id !== '__trash' && (registry.isPinned(i.id) || i === it)).map((i) => i.id));
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
    });
  };

  const trashFull = () => { try { return vfs.list(TRASH).length > 0; } catch { return false; } };

  const build = () => {
    if (dragging) return;
    const pins = registry.pins;
    const running = [...new Set(wm.wins.map((w) => w.app.id))].filter((id) => !pins.includes(id) && apps.has(id));
    const ids = [...pins, ...running];
    const key = ids.join(',');
    if (dock.dataset.key !== key) {
      dock.dataset.key = key;
      items = ids.map((id) => {
        const app = apps.get(id);
        const el = h('button.dock-item', { type: 'button', dataset: { app: id }, 'aria-label': app.name }, appIcon(app), h('i.dock-dot'), h('b.dock-badge', { hidden: true }));
        const it = { id, name: app.name, el, s: 1, target: 1 };
        el.addEventListener('click', () => { if (!noClick) launch(id, el); });
        el.addEventListener('contextmenu', (e) => { e.preventDefault(); menuFor(id, e); });
        armDrag(it);
        return it;
      });
      const trash = h('button.dock-item.is-trash', { type: 'button', 'aria-label': 'Papierkorb', dataset: { dropPath: TRASH } },
        h('span.app-icon', { style: { '--c1': '#c3cadf', '--c2': '#7a839f' }, html: icon('trash') }), h('i.dock-dot'));
      trash.addEventListener('click', () => sys.open('files', { path: TRASH }));
      trash.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openMenu([
          { heading: 'Papierkorb' },
          { label: 'Öffnen', run: () => sys.open('files', { path: TRASH }) },
          { label: 'Papierkorb leeren …', disabled: !trashFull(), run: () => sys.emptyTrash() },
        ], { x: e.clientX - 20, y: e.clientY - 120 });
      });
      items.push({ id: '__trash', name: 'Papierkorb', el: trash, s: 1, target: 1 });
      dock.replaceChildren(...items.slice(0, -1).map((i) => i.el), h('span.dock-sep'), trash);
    }
    for (const it of items) {
      if (it.id === '__trash') { it.el.classList.toggle('is-full', trashFull()); continue; }
      const wins = wm.byApp(it.id);
      it.el.classList.toggle('is-running', wins.length > 0);
      it.el.classList.toggle('is-front', !!wm.focused && wm.focused.app.id === it.id);
      const n = sys.badgeOf(it.id);
      const badge = it.el.querySelector('.dock-badge');
      badge.hidden = !n;
      badge.textContent = n > 99 ? '99+' : String(n);
    }
  };
  bus.on('wm', build);
  bus.on('focus', build);
  bus.on('apps', build);
  bus.on('badge', build);
  bus.on('fs', (p) => { if (p === '/' || p.startsWith(TRASH)) build(); });
  bus.on('launching', (id) => { const it = items.find((i) => i.id === id); if (it) bounce(it.el); });
  build();
  wm.iconRect = (id) => items.find((i) => i.id === id)?.el.getBoundingClientRect() || null;

  // ---------- Lupe ----------
  const frame = () => {
    let moving = false;
    const size = settings.dockSize;
    const sigma = size * 1.5;
    for (const it of items) {
      if (mx == null) it.target = 1;
      else {
        const r = it.el.getBoundingClientRect();
        const d = mx - (r.left + r.width / 2);
        it.target = 1 + (settings.dockMag - 1) * Math.exp(-(d * d) / (2 * sigma * sigma));
      }
      it.s += (it.target - it.s) * 0.28;
      if (Math.abs(it.target - it.s) > 0.002) moving = true; else it.s = it.target;
      it.el.style.setProperty('--s', it.s.toFixed(3));
    }
    if (!moving && mx == null) { ticker.remove(frame); active = false; }
  };
  function wake() { if (!active) { active = true; ticker.add(frame); } }
  if (!coarse.matches) {
    dock.addEventListener('pointermove', (e) => {
      if (dragging) return;
      mx = e.clientX;
      wake();
      const el = e.target.closest('.dock-item');
      const it = el && items.find((i) => i.el === el);
      if (it) {
        const r = el.getBoundingClientRect();
        tip.textContent = it.name;
        tip.style.left = `${r.left + r.width / 2}px`;
        tip.style.top = `${dock.getBoundingClientRect().top - 12}px`;
        tip.classList.add('on');
      } else tip.classList.remove('on');
    });
    dock.addEventListener('pointerleave', () => { mx = null; wake(); tip.classList.remove('on'); });
  }
}
