// util.js — kleine gemeinsame Werkzeuge (keine Abhängigkeiten)

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const remap = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c);
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const TAU = Math.PI * 2;

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
export const coarse = matchMedia('(hover: none), (pointer: coarse)');

/** Hyperscript: h('div.card', {onclick, style:{}, dataset:{}, html}, child, …) */
export function h(spec, props, ...kids) {
  if (props instanceof Node || typeof props === 'string' || Array.isArray(props)) {
    kids.unshift(props);
    props = null;
  }
  const [tagPart, ...classes] = spec.split('.');
  const [tag, id] = tagPart.split('#');
  const el = document.createElement(tag || 'div');
  if (id) el.id = id;
  if (classes.length) el.className = classes.join(' ');
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || (v === false && !(k in el)) || (k === 'class' && !v)) continue;
      if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      } else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k in el && k !== 'list' && k !== 'form') {
        try { el[k] = v; } catch { el.setAttribute(k, v); }
      } else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const kid of kids) {
    if (kid == null || kid === false) continue;
    if (Array.isArray(kid)) append(el, kid);
    else el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}

/** Gedämpfte Feder (halb-implizites Euler-Verfahren, in Teilschritten stabil). */
export class Spring {
  constructor(value = 0, k = 170, c = 26) {
    this.v = value;
    this.t = value;
    this.vel = 0;
    this.k = k;
    this.c = c;
  }
  step(dt) {
    const n = Math.max(1, Math.ceil(dt / 0.006));
    const hstep = dt / n;
    for (let i = 0; i < n; i++) {
      this.vel += (-this.k * (this.v - this.t) - this.c * this.vel) * hstep;
      this.v += this.vel * hstep;
    }
    return this.v;
  }
  snap(v) {
    this.v = this.t = v;
    this.vel = 0;
  }
  get settled() {
    return Math.abs(this.v - this.t) < 0.05 && Math.abs(this.vel) < 0.05;
  }
}

/** Ein gemeinsamer rAF-Takt für alles. fn(dt, t) – dt in Sekunden. */
export const ticker = (() => {
  const fns = new Set();
  let last = 0;
  let running = false;
  function frame(now) {
    if (!fns.size) { running = false; return; }
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    for (const fn of fns) {
      try { fn(dt, now / 1000); } catch (err) { console.error(err); fns.delete(fn); }
    }
    requestAnimationFrame(frame);
  }
  return {
    add(fn) {
      fns.add(fn);
      if (!running) {
        running = true;
        last = performance.now();
        requestAnimationFrame(frame);
      }
      return () => fns.delete(fn);
    },
    remove(fn) { fns.delete(fn); },
  };
})();

/** Ruft cb(true/false) auf, sobald el sichtbar wird bzw. den Viewport verlässt. */
export function whenVisible(el, cb, margin = '100px') {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) cb(e.isIntersecting);
  }, { rootMargin: margin });
  io.observe(el);
  return () => io.disconnect();
}

export const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  },
  del(key) { try { localStorage.removeItem(key); } catch { /* egal */ } },
};

export function debounce(fn, ms = 150) {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
}

/** Zeiger-Ziehen mit Pointer Capture. Handler bekommen (event, {dx, dy, x0, y0}). */
export function drag(el, { start, move, end, button = 0 } = {}) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== button && e.pointerType === 'mouse') return;
    const ctx = { x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 };
    if (start && start(e, ctx) === false) return;
    try { el.setPointerCapture(e.pointerId); } catch { /* egal */ }
    const onMove = (ev) => {
      ctx.dx = ev.clientX - ctx.x0;
      ctx.dy = ev.clientY - ctx.y0;
      move && move(ev, ctx);
    };
    const onEnd = (ev) => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onEnd);
      el.removeEventListener('pointercancel', onEnd);
      end && end(ev, ctx);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onEnd);
    el.addEventListener('pointercancel', onEnd);
  });
}

export function hexToRgb(hex) {
  const s = hex.replace('#', '');
  const n = parseInt(s.length === 3 ? s.replace(/./g, '$&$&') : s, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Liquid-Indikator: zwei Federn für linke/rechte Kante → die Pille dehnt sich beim Wandern. */
export class LiquidIndicator {
  constructor(track, ind) {
    this.track = track;
    this.ind = ind;
    this.l = new Spring(0, 260, 26);
    this.r = new Spring(0, 260, 26);
    this.ready = false;
    this._tick = (dt) => {
      this.l.step(dt);
      this.r.step(dt);
      this.paint();
      if (this.l.settled && this.r.settled) {
        this.l.snap(this.l.t);
        this.r.snap(this.r.t);
        this.paint();
        ticker.remove(this._tick);
      }
    };
  }
  paint() {
    const w = Math.max(0, this.r.v - this.l.v);
    this.ind.style.transform = `translate3d(${this.l.v.toFixed(2)}px,0,0)`;
    this.ind.style.width = `${w.toFixed(2)}px`;
  }
  to(target, instant = false) {
    if (!target) return;
    // Layout-Maße statt getBoundingClientRect: unabhängig von laufenden Transform-Animationen
    if (!target.offsetWidth) return;
    const L = target.offsetLeft;
    const R = L + target.offsetWidth;
    if (instant || !this.ready || reducedMotion.matches) {
      this.l.snap(L);
      this.r.snap(R);
      this.ready = true;
      this.paint();
      return;
    }
    const right = L > this.l.t;
    // führende Kante straff, nachlaufende weich
    this.r.k = right ? 420 : 150;
    this.l.k = right ? 150 : 420;
    this.r.c = right ? 30 : 20;
    this.l.c = right ? 20 : 30;
    this.l.t = L;
    this.r.t = R;
    ticker.add(this._tick);
  }
}
