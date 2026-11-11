// wm.js — Fenster-Manager: Ziehen, Skalieren, Einrasten, Minimieren, Übersicht

import { h, drag, clamp, reducedMotion } from '../core/util.js';
import { sfx } from '../core/audio.js';
import { icon } from '../core/icons.js';
import { bus } from './bus.js';
import { apps, sys } from './sys.js';

const MENUBAR = 34;
const KEEP = 70;       // so viel Fenster bleibt immer greifbar
const GAP = 6;

export class WM {
  constructor(layer, snapEl) {
    this.layer = layer;
    this.snapEl = snapEl;
    this.wins = [];
    this.z = 10;
    this.pid = 100;
    this.focused = null;
    this.overview = false;
    this.iconRect = () => null;   // setzt das Dock: App-ID → Rechteck des Symbols
    addEventListener('resize', () => this.onViewport());
    layer.addEventListener('click', (e) => {
      if (!this.overview) return;
      const el = e.target.closest('.win');
      const win = el && this.wins.find((w) => w.el === el);
      this.toggleOverview(false);
      if (win) this.focus(win);
    }, true);
  }

  /** Nutzbare Fläche zwischen Menüleiste und Dock */
  area() {
    const dock = document.getElementById('dock');
    const dockH = dock ? dock.offsetHeight + 14 : 0;
    return { x: 0, y: MENUBAR, w: innerWidth, h: innerHeight - MENUBAR - dockH };
  }

  open(id, args = {}) {
    const app = apps.get(id);
    if (!app) { sys.notify({ title: 'Unbekannte App', body: id, icon: 'close' }); return null; }
    if (this.overview) this.toggleOverview(false);
    if (app.singleton) {
      const ex = this.wins.find((w) => w.app === app);
      if (ex) {
        if (ex.min) ex.restore(); else this.focus(ex);
        ex.hooks.onArgs?.(args);
        return ex;
      }
    }
    const win = new Win(this, app, args);
    this.wins.push(win);
    this.layer.append(win.el);
    win.enter();
    this.focus(win);
    sfx.pop();
    bus.emit('wm');
    return win;
  }

  focus(win) {
    if (win && win.min) return;
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
  focusTop() {
    const top = this.wins.filter((w) => !w.min).sort((a, b) => b.z - a.z)[0];
    this.focus(top || null);
  }
  cycle() {
    const list = this.wins.filter((w) => !w.min).sort((a, b) => a.z - b.z);
    if (list.length > 1) this.focus(list[0]);
  }
  byApp(id) { return this.wins.filter((w) => w.app.id === id); }
  closeAll() { for (const w of [...this.wins]) w.close(); }

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

  // ---------- Übersicht: alle Fenster nebeneinander ----------
  toggleOverview(on = !this.overview) {
    const list = this.wins.filter((w) => !w.min);
    if (on && !list.length) { sys.notify({ title: 'Übersicht', body: 'Es sind keine Fenster geöffnet.', icon: 'grid' }); return; }
    if (on === this.overview) return;
    this.overview = on;
    document.body.classList.toggle('is-overview', on);
    if (!on) {
      for (const w of this.wins) w.el.style.removeProperty('--ov');
      return;
    }
    const A = this.area();
    const pad = 28;
    const n = list.length;
    const cols = Math.ceil(Math.sqrt((n * A.w) / A.h));
    const rows = Math.ceil(n / cols);
    const cw = (A.w - pad * (cols + 1)) / cols;
    const ch = (A.h - pad * (rows + 1)) / rows;
    list.sort((a, b) => a.rect.x - b.rect.x).forEach((w, i) => {
      const cx = A.x + pad + (i % cols) * (cw + pad) + cw / 2;
      const cy = A.y + pad + Math.floor(i / cols) * (ch + pad) + ch / 2;
      const s = Math.min(1, cw / w.rect.w, ch / w.rect.h);
      const tx = cx - (w.rect.x + w.rect.w / 2);
      const ty = cy - (w.rect.y + w.rect.h / 2);
      w.el.style.setProperty('--ov', `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(4)})`);
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
}

class Win {
  constructor(wm, app, args) {
    this.wm = wm;
    this.app = app;
    this.id = ++wm.pid;
    this.started = Date.now();
    this.z = 0;
    this.min = false;
    this.snapped = null;
    this.closed = false;
    this.restoreRect = null;
    this.minW = app.minW || 300;
    this.minH = app.minH || 200;

    this.titleEl = h('div.win-title', app.name);
    this.tools = h('div.win-tools');
    const ctl = h('div.win-ctl',
      h('button.wc.close', { type: 'button', 'aria-label': 'Schließen', html: icon('close'), onclick: () => this.close() }),
      h('button.wc.min', { type: 'button', 'aria-label': 'Minimieren', html: icon('minus'), onclick: () => this.minimize() }),
      h('button.wc.max', { type: 'button', 'aria-label': 'Zoomen', html: icon('plus'), onclick: () => this.toggleMax() }));
    this.bar = h('header.win-bar', ctl, this.titleEl, this.tools);
    this.body = h('div.win-body');
    this.el = h('section.win.glass', { dataset: { app: app.id }, role: 'dialog', 'aria-label': app.name, tabIndex: -1 }, this.bar, this.body);
    for (const dir of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) this.el.append(this.handle(dir));

    const A = wm.area();
    const w = Math.min(app.width || 640, A.w - 16);
    const hgt = Math.min(app.height || 440, A.h - 16);
    const k = wm.wins.length % 7;
    this.rect = {
      x: Math.round(clamp(A.x + (A.w - w) / 2 + (k - 2) * 28, 8, Math.max(8, A.w - w - 8))),
      y: Math.round(clamp(A.y + (A.h - hgt) / 2 - 16 + (k - 2) * 24, A.y + 8, Math.max(A.y + 8, A.y + A.h - hgt - 8))),
      w, h: hgt,
    };
    this.paint();

    this.el.addEventListener('pointerdown', () => { if (!wm.overview) wm.focus(this); }, true);
    this.bar.addEventListener('dblclick', (e) => { if (!e.target.closest('button, input, .no-drag')) this.toggleMax(); });
    this.initDrag();

    this.hooks = {};
    try {
      this.hooks = app.mount(this, args) || {};
    } catch (err) {
      console.error(err);
      this.body.replaceChildren(h('div.win-error', h('b', 'Diese App ist abgestürzt.'), h('pre.mono', String(err?.message || err))));
    }
    if (innerWidth < 720) { this.snapped = 'max'; this.restoreRect = { ...this.rect }; this.el.classList.add('is-max'); this.setRect(wm.rectFor('max')); }
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
    if (reducedMotion.matches) { done(); return; }
    const a = this.el.animate(
      [{ transform: 'none', opacity: 1 }, { transform: this.toIcon(), opacity: 0 }],
      { duration: 380, easing: 'cubic-bezier(.5, 0, .75, .4)' },
    );
    a.onfinish = done;
  }
  restore() {
    if (!this.min) return;
    this.min = false;
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
    if (reducedMotion.matches || this.min) gone();
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
