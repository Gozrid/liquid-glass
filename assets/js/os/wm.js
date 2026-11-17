// wm.js — Fenster-Manager: Ziehen, Skalieren, Einrasten, Minimieren, Übersicht, mehrere Schreibtische

import { $, h, drag, clamp, reducedMotion, store, debounce } from '../core/util.js';
import { sfx } from '../core/audio.js';
import { icon } from '../core/icons.js';
import { bus } from './bus.js';
import { apps, sys, settings, appIcon } from './sys.js';
import { openMenu } from './ui.js';

const KEEP = 70;       // so viel Fenster bleibt immer greifbar
const GAP = 6;
const MAX_SPACES = 6;
const SESSION = 'fableos.session';
const menubarH = () => document.getElementById('menubar')?.offsetHeight || 34;

const ZONES = [
  ['left', 'Linke Hälfte'], ['right', 'Rechte Hälfte'], ['max', 'Ganzer Bildschirm'],
  ['tl', 'Oben links'], ['tr', 'Oben rechts'], ['bl', 'Unten links'], ['br', 'Unten rechts'],
];

export class WM {
  constructor(layer, snapEl) {
    this.layer = layer;
    this.snapEl = snapEl;
    this.wins = [];
    this.z = 10;
    this.pid = 100;
    this.focused = null;
    this.overview = false;
    this.space = 0;
    this.spaceCount = clamp(store.get('fableos.spaces', 1) | 0, 1, MAX_SPACES);
    this.iconRect = () => null;   // setzt das Dock: App-ID → Rechteck des Symbols
    this.strip = h('div#spaces', { hidden: true, 'aria-label': 'Schreibtische' });
    document.getElementById('desktop').append(this.strip);
    addEventListener('resize', () => this.onViewport());
    navigator.windowControlsOverlay?.addEventListener('geometrychange', () => this.onViewport());
    layer.addEventListener('click', (e) => {
      if (!this.overview) return;
      const el = e.target.closest('.win');
      const win = el && this.wins.find((w) => w.el === el);
      this.toggleOverview(false);
      if (win) this.focus(win);
    }, true);
    layer.addEventListener('contextmenu', (e) => {
      if (!this.overview) return;
      const el = e.target.closest('.win');
      const win = el && this.wins.find((w) => w.el === el);
      if (!win) return;
      e.preventDefault();
      e.stopPropagation();
      openMenu([
        { heading: win.title },
        ...this.spaceItems(win),
        '-',
        { label: 'Schließen', icon: 'close', run: () => { win.close(); if (this.overview) this.layoutOverview(); } },
      ], { x: e.clientX, y: e.clientY });
    }, true);
    this.saveSession = debounce(() => this.persist(), 400);
    bus.on('wm', this.saveSession);
    addEventListener('pagehide', () => this.persist());
  }

  /** Nutzbare Fläche zwischen Menüleiste und Dock */
  area() {
    const dock = document.getElementById('dock');
    const dockH = dock ? dock.offsetHeight + 14 : 0;
    const top = menubarH();
    return { x: 0, y: top, w: innerWidth, h: innerHeight - top - dockH };
  }

  /** opts: {rect, snapped, space, min, quiet} – für die Wiederherstellung der letzten Sitzung */
  open(id, args = {}, opts = null) {
    const app = apps.get(id);
    if (!app) { sys.notify({ title: 'Unbekannte App', body: id, icon: 'close' }); return null; }
    if (typeof app.action === 'function') { app.action(args || {}); return null; }
    if (!app.mount) {
      // installierte App, deren Modul noch nicht geladen ist
      bus.emit('launching', id);
      sys.registry?.load(id).then((ok) => { if (ok && apps.get(id)?.mount) this.open(id, args, opts); });
      return null;
    }
    if (this.overview) this.toggleOverview(false);
    if (app.singleton) {
      const ex = this.wins.find((w) => w.app.id === id);
      if (ex) {
        this.reveal(ex);
        ex.hooks.onArgs?.(args || {});
        return ex;
      }
    }
    const win = new Win(this, app, args || {}, opts);
    this.wins.push(win);
    this.layer.append(win.el);
    if (win.space !== this.space || opts?.min) {
      win.min = !!opts?.min;
      win.el.hidden = true;
    } else {
      if (!opts?.quiet) { win.enter(); sfx.pop(); }
      this.focus(win);
    }
    bus.emit('wm');
    return win;
  }

  /** Fenster nach vorn holen – wechselt bei Bedarf den Schreibtisch und holt es aus dem Dock. */
  reveal(win) {
    if (win.space !== this.space) this.setSpace(win.space);
    if (win.min) win.restore(); else this.focus(win);
  }

  focus(win) {
    if (win && (win.min || win.space !== this.space)) return;
    if (this.focused !== win) {
      this.focused?.el.classList.remove('is-focused');
      this.focused = win || null;
    }
    if (win) {
      win.z = ++this.z;
      win.el.style.zIndex = win.z;
      win.el.classList.add('is-focused');
      win.hooks.onFocus?.();
    }
    bus.emit('focus', win || null);
  }
  shown() { return this.wins.filter((w) => !w.min && w.space === this.space); }
  focusTop() {
    this.focus(this.shown().sort((a, b) => b.z - a.z)[0] || null);
  }
  cycle() {
    const list = this.shown().sort((a, b) => a.z - b.z);
    if (list.length > 1) this.focus(list[0]);
  }
  byApp(id) { return this.wins.filter((w) => w.app.id === id); }
  closeAll() { for (const w of [...this.wins]) w.close(); }
  /** Laufende Apps, zuletzt benutzte zuerst */
  running() {
    const seen = new Map();
    for (const w of [...this.wins].sort((a, b) => b.z - a.z)) if (!seen.has(w.app.id)) seen.set(w.app.id, w.app);
    return [...seen.values()];
  }
  hideApp(id) { for (const w of this.byApp(id)) if (!w.min) w.minimize(); }
  quitApp(id) { for (const w of [...this.byApp(id)]) w.close(); }
  showApp(id) {
    const wins = this.byApp(id);
    if (!wins.length) return;
    const top = [...wins].sort((a, b) => b.z - a.z)[0];
    if (top.space !== this.space) this.setSpace(top.space);
    for (const w of wins) if (w.space === this.space && w.min) w.restore();
    this.focus(top);
  }

  // ---------- Einrasten ----------
  zoneAt(x, y) {
    const A = this.area();
    const E = 10;
    if (y <= A.y) return 'max';
    const band = y < A.y + A.h * 0.3 ? 't' : y > A.y + A.h * 0.7 ? 'b' : '';
    if (x <= E) return band ? `${band}l` : 'left';
    if (x >= innerWidth - E) return band ? `${band}r` : 'right';
    return null;
  }
  rectFor(zone) {
    const A = this.area();
    const hw = (A.w - GAP * 3) / 2;
    const hh = (A.h - GAP * 3) / 2;
    const L = A.x + GAP, T = A.y + GAP, R = L + hw + GAP, B = T + hh + GAP;
    const full = A.h - GAP * 2;
    return {
      max: { x: L, y: T, w: A.w - GAP * 2, h: full },
      left: { x: L, y: T, w: hw, h: full },
      right: { x: R, y: T, w: hw, h: full },
      tl: { x: L, y: T, w: hw, h: hh }, tr: { x: R, y: T, w: hw, h: hh },
      bl: { x: L, y: B, w: hw, h: hh }, br: { x: R, y: B, w: hw, h: hh },
    }[zone];
  }
  showSnap(zone) {
    const el = this.snapEl;
    if (!zone) { el.classList.remove('on'); return; }
    const r = this.rectFor(zone);
    el.style.translate = `${r.x}px ${r.y}px`;
    el.style.width = `${r.w}px`;
    el.style.height = `${r.h}px`;
    el.classList.add('on');
  }

  // ---------- Schreibtische ----------
  setSpace(i, animate = true) {
    i = clamp(i, 0, this.spaceCount - 1);
    if (i === this.space) return;
    const dir = i > this.space ? 1 : -1;
    const leaving = this.shown();
    this.space = i;
    const entering = this.shown();
    const move = animate && !reducedMotion.matches && !this.overview;
    const shift = Math.round(innerWidth * 0.5);
    if (this.focused) { this.focused.el.classList.remove('is-focused'); this.focused = null; }
    for (const w of leaving) {
      if (!move) { w.el.hidden = true; continue; }
      w.el.animate([{ transform: 'none', opacity: 1 }, { transform: `translateX(${-dir * shift}px)`, opacity: 0 }], { duration: 300, easing: 'cubic-bezier(.4, 0, .6, 1)' })
        .onfinish = () => { if (w.space !== this.space) w.el.hidden = true; };
    }
    for (const w of entering) {
      w.el.hidden = false;
      if (move) w.el.animate([{ transform: `translateX(${dir * shift}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.2, .9, .3, 1)' });
    }
    this.focusTop();
    if (this.overview) this.layoutOverview();
    bus.emit('space', i);
    bus.emit('wm');
  }
  addSpace() {
    if (this.spaceCount >= MAX_SPACES) return;
    this.spaceCount++;
    store.set('fableos.spaces', this.spaceCount);
    if (this.overview) this.paintStrip();
    bus.emit('space', this.space);
  }
  removeSpace(i) {
    if (this.spaceCount <= 1) return;
    for (const w of this.wins) {
      if (w.space === i) w.space = Math.max(0, i - 1);
      else if (w.space > i) w.space--;
    }
    this.spaceCount--;
    store.set('fableos.spaces', this.spaceCount);
    if (this.space > i || this.space >= this.spaceCount) this.space = Math.max(0, this.space - 1);
    for (const w of this.wins) w.el.hidden = w.min || w.space !== this.space;
    this.focusTop();
    if (this.overview) this.layoutOverview();
    bus.emit('space', this.space);
    bus.emit('wm');
  }
  moveToSpace(win, i) {
    i = clamp(i, 0, this.spaceCount - 1);
    if (win.space === i) return;
    win.space = i;
    if (i !== this.space) {
      if (this.focused === win) { win.el.classList.remove('is-focused'); this.focused = null; }
      win.el.hidden = true;
      this.focusTop();
    } else win.el.hidden = win.min;
    if (this.overview) this.layoutOverview();
    bus.emit('wm');
  }
  /** Menüeinträge „Auf Schreibtisch N bewegen“ */
  spaceItems(win) {
    return Array.from({ length: this.spaceCount }, (_, i) => ({
      label: `Auf Schreibtisch ${i + 1} bewegen`, disabled: win.space === i, run: () => this.moveToSpace(win, i),
    }));
  }

  // ---------- Übersicht: alle Fenster nebeneinander, oben die Schreibtische ----------
  toggleOverview(on = !this.overview) {
    if (on === this.overview) return;
    this.overview = on;
    document.body.classList.toggle('is-overview', on);
    this.strip.hidden = !on;
    if (!on) {
      for (const w of this.wins) { w.el.style.removeProperty('--ov'); w.el.style.removeProperty('--ovs'); }
      bus.emit('overview', false);
      return;
    }
    this.layoutOverview();
    bus.emit('overview', true);
  }
  paintStrip() {
    const sw = 148, sh = Math.round(sw * (innerHeight / innerWidth));
    this.strip.replaceChildren(...[
      ...Array.from({ length: this.spaceCount }, (_, i) => {
        const minis = this.wins.filter((w) => w.space === i && !w.min).sort((a, b) => a.z - b.z).map((w) => h('i', {
          style: { left: `${(w.rect.x / innerWidth) * 100}%`, top: `${(w.rect.y / innerHeight) * 100}%`, width: `${(w.rect.w / innerWidth) * 100}%`, height: `${(w.rect.h / innerHeight) * 100}%`, '--c1': w.app.colors?.[0] || '#8e97b5' },
        }));
        const b = h('button.space', { type: 'button', class: i === this.space ? 'is-on' : '', 'aria-label': `Schreibtisch ${i + 1}`, 'aria-current': i === this.space ? 'true' : null },
          h('span.space-prev', { style: { width: `${sw}px`, height: `${sh}px` } }, minis),
          h('span.space-name', `Schreibtisch ${i + 1}`));
        b.addEventListener('click', () => this.setSpace(i));
        if (this.spaceCount > 1) {
          const x = h('span.space-x', { role: 'button', 'aria-label': `Schreibtisch ${i + 1} entfernen`, html: icon('close') });
          x.addEventListener('click', (e) => { e.stopPropagation(); this.removeSpace(i); });
          b.append(x);
        }
        return b;
      }),
      this.spaceCount < MAX_SPACES ? h('button.space.space-add', { type: 'button', 'aria-label': 'Schreibtisch hinzufügen', html: icon('plus'), onclick: () => this.addSpace() }) : null,
    ].filter(Boolean));
  }
  layoutOverview() {
    this.paintStrip();
    for (const w of this.wins) w.el.style.removeProperty('--ov');
    const list = this.shown();
    const A = this.area();
    const top = 118;          // Platz für die Leiste der Schreibtische
    const pad = 30;
    const n = list.length;
    if (!n) return;
    const W = A.w, H = A.h - top;
    const cols = Math.ceil(Math.sqrt((n * W) / H));
    const rows = Math.ceil(n / cols);
    const cw = (W - pad * (cols + 1)) / cols;
    const ch = (H - pad * (rows + 1)) / rows - 14;
    list.sort((a, b) => a.rect.x - b.rect.x).forEach((w, i) => {
      const cx = A.x + pad + (i % cols) * (cw + pad) + cw / 2;
      const cy = A.y + top + pad + Math.floor(i / cols) * (ch + 14 + pad) + ch / 2;
      const s = Math.min(1, cw / w.rect.w, ch / w.rect.h);
      const tx = cx - (w.rect.x + w.rect.w / 2);
      const ty = cy - (w.rect.y + w.rect.h / 2);
      w.el.style.setProperty('--ov', `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(4)})`);
      w.el.style.setProperty('--ovs', (1 / s).toFixed(4));
    });
  }

  onViewport() {
    if (this.overview) this.toggleOverview(false);
    const A = this.area();
    for (const w of this.wins) {
      if (w.snapped) { w.setRect(this.rectFor(w.snapped)); continue; }
      w.setRect({
        x: clamp(w.rect.x, -w.rect.w + KEEP, innerWidth - KEEP),
        y: clamp(w.rect.y, A.y, Math.max(A.y, innerHeight - 60)),
      });
    }
  }

  // ---------- Sitzung merken und wiederherstellen ----------
  persist() {
    if (!this.ready) return;
    store.set(SESSION, this.wins.filter((w) => !w.closed && !w.app.noRestore).sort((a, b) => a.z - b.z).map((w) => {
      let args = null;
      try { args = w.hooks.state?.() || null; } catch { /* ohne Zustand */ }
      return { app: w.app.id, rect: w.snapped && w.restoreRect ? w.restoreRect : w.rect, snapped: w.snapped, space: w.space, min: w.min, args };
    }));
  }
  /** Öffnet die Fenster der letzten Sitzung wieder. Liefert, wie viele es waren. */
  restoreSession() {
    this.ready = true;
    const list = settings.restore ? store.get(SESSION, []) : [];
    let n = 0;
    for (const s of Array.isArray(list) ? list.slice(0, 12) : []) {
      if (!s || !apps.has(s.app) || apps.get(s.app).action) continue;
      this.open(s.app, s.args || {}, { rect: s.rect, snapped: s.snapped, space: s.space, min: s.min, quiet: true });
      n++;
    }
    return n;
  }
}

// ---------- Kachel-Auswahl am grünen Knopf ----------
let tilePop = null;
let tileTimer = 0;
function hideTiles() {
  clearTimeout(tileTimer);
  tilePop?.remove();
  tilePop = null;
}
function showTiles(win, anchor) {
  hideTiles();
  const pop = h('div.tile-pop.glass.thick', { role: 'menu', 'aria-label': 'Fenster anordnen' },
    h('div.tile-head', 'Anordnen'),
    h('div.tile-grid', ZONES.map(([zone, label]) => h('button', { type: 'button', class: `tz-${zone}`, title: label, 'aria-label': label, onclick: () => { hideTiles(); win.snap(zone); } }, h('i')))));
  pop.addEventListener('pointerenter', () => clearTimeout(tileTimer));
  pop.addEventListener('pointerleave', () => { tileTimer = setTimeout(hideTiles, 220); });
  $('#overlays').append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${clamp(r.left - 14, 8, innerWidth - pop.offsetWidth - 8)}px`;
  pop.style.top = `${r.bottom + 9}px`;
  tilePop = pop;
}
document.addEventListener('pointerdown', (e) => { if (tilePop && !tilePop.contains(e.target)) hideTiles(); }, true);

class Win {
  constructor(wm, app, args, opts) {
    this.wm = wm;
    this.app = app;
    this.id = ++wm.pid;
    this.started = Date.now();
    this.z = 0;
    this.min = false;
    this.snapped = null;
    this.closed = false;
    this.restoreRect = null;
    this.space = opts?.space != null ? clamp(opts.space | 0, 0, wm.spaceCount - 1) : wm.space;
    this.minW = app.minW || 300;
    this.minH = app.minH || 200;

    this.titleEl = h('div.win-title', app.name);
    this.tools = h('div.win-tools');
    const bMax = h('button.wc.max', { type: 'button', 'aria-label': 'Zoomen', html: icon('plus'), onclick: () => { hideTiles(); this.toggleMax(); } });
    bMax.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse' || wm.overview) return;
      clearTimeout(tileTimer);
      tileTimer = setTimeout(() => showTiles(this, bMax), 520);
    });
    bMax.addEventListener('pointerleave', () => { clearTimeout(tileTimer); if (tilePop) tileTimer = setTimeout(hideTiles, 260); });
    const ctl = h('div.win-ctl',
      h('button.wc.close', { type: 'button', 'aria-label': 'Schließen', html: icon('close'), onclick: () => this.close() }),
      h('button.wc.min', { type: 'button', 'aria-label': 'Minimieren', html: icon('minus'), onclick: () => this.minimize() }),
      bMax);
    this.bar = h('header.win-bar', ctl, this.titleEl, this.tools);
    this.body = h('div.win-body');
    this.el = h('section.win.glass', { dataset: { app: app.id }, role: 'dialog', 'aria-label': app.name, tabIndex: -1 }, this.bar, this.body);
    for (const dir of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) this.el.append(this.handle(dir));

    const A = wm.area();
    const r = opts?.rect;
    const w = clamp(r?.w || app.width || 640, this.minW, Math.max(this.minW, A.w - 16));
    const hgt = clamp(r?.h || app.height || 440, this.minH, Math.max(this.minH, A.h - 16));
    const k = wm.wins.length % 7;
    this.rect = r
      ? { x: Math.round(clamp(r.x, -w + KEEP, innerWidth - KEEP)), y: Math.round(clamp(r.y, A.y, Math.max(A.y, innerHeight - 60))), w, h: hgt }
      : {
        x: Math.round(clamp(A.x + (A.w - w) / 2 + (k - 2) * 28, 8, Math.max(8, A.w - w - 8))),
        y: Math.round(clamp(A.y + (A.h - hgt) / 2 - 16 + (k - 2) * 24, A.y + 8, Math.max(A.y + 8, A.y + A.h - hgt - 8))),
        w, h: hgt,
      };
    this.paint();

    this.el.addEventListener('pointerdown', () => { if (!wm.overview) wm.focus(this); }, true);
    this.bar.addEventListener('dblclick', (e) => { if (!e.target.closest('button, input, .no-drag')) this.toggleMax(); });
    this.bar.addEventListener('contextmenu', (e) => {
      if (e.target.closest('button, input, select, .no-drag') || wm.overview) return;
      e.preventDefault();
      e.stopPropagation();
      openMenu([
        { label: 'Minimieren', run: () => this.minimize() },
        { label: this.snapped ? 'Größe wiederherstellen' : 'Zoomen', run: () => this.toggleMax() },
        { label: 'Anordnen', items: ZONES.map(([zone, label]) => ({ label, checked: this.snapped === zone, run: () => this.snap(zone) })) },
        wm.spaceCount > 1 && { label: 'Schreibtisch', items: wm.spaceItems(this) },
        '-',
        { label: 'Schließen', icon: 'close', run: () => this.close() },
      ], { x: e.clientX, y: e.clientY });
    });
    this.initDrag();

    this.hooks = {};
    try {
      this.hooks = app.mount(this, args) || {};
    } catch (err) {
      console.error(err);
      this.body.replaceChildren(h('div.win-error', appIcon(app), h('b', `„${app.name}“ ist abgestürzt.`), h('pre.mono', String(err?.message || err)),
        h('button.kit-btn', { type: 'button', onclick: () => { const id = app.id; this.close(); setTimeout(() => sys.open(id), 250); } }, 'Erneut öffnen')));
    }
    if (innerWidth < 720 || opts?.snapped) {
      this.snapped = innerWidth < 720 ? 'max' : opts.snapped;
      this.restoreRect = { ...this.rect };
      this.el.classList.toggle('is-max', this.snapped === 'max');
      this.setRect(wm.rectFor(this.snapped) || wm.rectFor('max'));
    }
  }

  setTitle(t) {
    this.titleEl.textContent = t;
    this.el.setAttribute('aria-label', t);
    bus.emit('wm');
  }
  get title() { return this.titleEl.textContent; }

  paint() {
    const { x, y, w, h: hgt } = this.rect;
    const s = this.el.style;
    s.translate = `${Math.round(x)}px ${Math.round(y)}px`;
    s.width = `${Math.round(w)}px`;
    s.height = `${Math.round(hgt)}px`;
  }
  setRect(r, animate = false) {
    Object.assign(this.rect, r);
    if (animate && !reducedMotion.matches) {
      this.el.classList.add('is-anim');
      clearTimeout(this._at);
      this._at = setTimeout(() => this.el.classList.remove('is-anim'), 460);
    }
    this.paint();
    this.wm.saveSession();
  }

  initDrag() {
    let d = null;
    drag(this.bar, {
      start: (e) => {
        if (e.target.closest('button, input, select, textarea, .no-drag') || this.wm.overview) return false;
        d = { x: this.rect.x, y: this.rect.y, moved: false, zone: null };
        return true;
      },
      move: (e, c) => {
        if (!d.moved) {
          if (Math.hypot(c.dx, c.dy) < 4) return;
          d.moved = true;
          this.el.classList.add('is-drag');
          if (this.snapped && this.restoreRect) {
            // lösen: alte Größe zurück, der Zeiger bleibt an derselben relativen Stelle
            const r = this.restoreRect;
            const fx = (e.clientX - this.rect.x) / this.rect.w;
            d.x = e.clientX - fx * r.w - c.dx;
            d.y = this.rect.y;
            this.snapped = null;
            this.el.classList.remove('is-max');
            this.setRect({ w: r.w, h: r.h });
          }
        }
        const A = this.wm.area();
        this.setRect({
          x: clamp(d.x + c.dx, -this.rect.w + KEEP, innerWidth - KEEP),
          y: clamp(d.y + c.dy, A.y, innerHeight - 60),
        });
        d.zone = this.wm.zoneAt(e.clientX, e.clientY);
        this.wm.showSnap(d.zone);
      },
      end: () => {
        this.el.classList.remove('is-drag');
        this.wm.showSnap(null);
        if (d?.moved && d.zone) this.snap(d.zone);
        d = null;
      },
    });
  }

  handle(dir) {
    const el = h(`i.win-rs.${dir}`);
    let s = null;
    drag(el, {
      start: () => {
        if (this.wm.overview) return false;
        s = { ...this.rect };
        this.snapped = null;
        this.el.classList.remove('is-max');
        this.el.classList.add('is-drag');
        return true;
      },
      move: (e, c) => {
        const A = this.wm.area();
        let { x, y, w, h: hgt } = s;
        if (dir.includes('e')) w = Math.max(this.minW, s.w + c.dx);
        if (dir.includes('s')) hgt = Math.max(this.minH, s.h + c.dy);
        if (dir.includes('w')) { w = Math.max(this.minW, s.w - c.dx); x = s.x + s.w - w; }
        if (dir.includes('n')) {
          hgt = Math.max(this.minH, s.h - c.dy);
          y = s.y + s.h - hgt;
          if (y < A.y) { hgt -= A.y - y; y = A.y; }
        }
        this.setRect({ x, y, w, h: hgt });
      },
      end: () => this.el.classList.remove('is-drag'),
    });
    return el;
  }

  snap(zone) {
    if (!this.snapped) this.restoreRect = { ...this.rect };
    this.snapped = zone;
    this.el.classList.toggle('is-max', zone === 'max');
    this.setRect(this.wm.rectFor(zone), true);
  }
  toggleMax() {
    if (this.snapped) {
      this.snapped = null;
      this.el.classList.remove('is-max');
      if (this.restoreRect) this.setRect(this.restoreRect, true);
    } else this.snap('max');
  }

  // ---------- Animationen ----------
  /** Transform, das das Fenster auf sein Dock-Symbol schrumpft */
  toIcon() {
    const t = this.wm.iconRect(this.app.id);
    if (!t) return 'scale(.8)';
    const { x, y, w, h: hgt } = this.rect;
    const dx = t.left + t.width / 2 - (x + w / 2);
    const dy = t.top + t.height / 2 - (y + hgt / 2);
    return `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${Math.max(0.04, t.width / w).toFixed(4)}, ${Math.max(0.04, t.height / hgt).toFixed(4)})`;
  }
  enter() {
    if (reducedMotion.matches) return;
    this.el.animate(
      [{ transform: this.toIcon(), opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 460, easing: 'cubic-bezier(.2, 1.1, .3, 1)' },
    );
  }
  minimize() {
    if (this.min || this.closed) return;
    this.min = true;
    sfx.drop();
    const done = () => {
      this.el.hidden = true;
      this.wm.focusTop();
      bus.emit('wm');
    };
    if (this.wm.focused === this) { this.el.classList.remove('is-focused'); this.wm.focused = null; }
    if (reducedMotion.matches || this.space !== this.wm.space) { done(); return; }
    const a = this.el.animate(
      [{ transform: 'none', opacity: 1 }, { transform: this.toIcon(), opacity: 0 }],
      { duration: 380, easing: 'cubic-bezier(.5, 0, .75, .4)' },
    );
    a.onfinish = done;
  }
  restore() {
    if (!this.min) return;
    this.min = false;
    if (this.space !== this.wm.space) { bus.emit('wm'); return; }
    this.el.hidden = false;
    this.wm.focus(this);
    sfx.pop();
    bus.emit('wm');
    if (reducedMotion.matches) return;
    this.el.animate(
      [{ transform: this.toIcon(), opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 440, easing: 'cubic-bezier(.2, 1.1, .3, 1)' },
    );
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.hooks.onClose?.(); } catch (err) { console.error(err); }
    sfx.drop();
    const wm = this.wm;
    wm.wins.splice(wm.wins.indexOf(this), 1);
    if (wm.focused === this) wm.focused = null;
    const gone = () => this.el.remove();
    if (reducedMotion.matches || this.min || this.space !== wm.space) gone();
    else {
      this.el.style.pointerEvents = 'none';
      const a = this.el.animate(
        [{ transform: 'none', opacity: 1 }, { transform: 'scale(.9)', opacity: 0 }],
        { duration: 190, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' },
      );
      a.onfinish = gone;
    }
    wm.focusTop();
    bus.emit('wm');
  }
}
