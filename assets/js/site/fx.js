// fx.js — Mitteilungen, Konfetti, Glas-Zeiger, magnetische Knöpfe

import { $, $$, h, Spring, ticker, rand, pick, coarse, TAU } from '../core/util.js';
import { icon } from '../core/icons.js';

// ---------- Mitteilungen ----------
export function toast({ title, body = '', iconName = 'bell', ttl = 4200 }) {
  const box = $('#toasts');
  const el = h('div.toast.glass.thick', { role: 'status' },
    h('div.toast-ico', { html: icon(iconName) }),
    h('div', h('b', title), h('span', body)));
  box.prepend(el);
  let gone = false;
  let timer = 0;
  const close = () => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    el.classList.add('out');
    setTimeout(() => el.remove(), 520);
  };
  timer = setTimeout(close, ttl);
  el.addEventListener('click', close);
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', () => { if (!gone) timer = setTimeout(close, 1500); });
  // Wischen zum Schließen
  let x0 = null;
  el.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  el.addEventListener('pointermove', (e) => { if (x0 != null && e.clientX - x0 > 40) close(); });
  el.addEventListener('pointerup', () => { x0 = null; });
  const live = [...box.children].filter((c) => !c.classList.contains('out'));
  live.slice(4).forEach((c) => c.remove());
  return close;
}

// ---------- Konfetti ----------
const COLORS = ['#ffb65c', '#ff5d6c', '#a06bff', '#45c8ff', '#3fe0b0', '#ffffff'];
let parts = [];
let confettiRunning = false;

export function confetti(x = innerWidth / 2, y = innerHeight * 0.35, n = 150) {
  const cv = $('#confetti');
  const ctx = cv.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  if (cv.width !== Math.round(innerWidth * dpr) || cv.height !== Math.round(innerHeight * dpr)) {
    cv.width = Math.round(innerWidth * dpr);
    cv.height = Math.round(innerHeight * dpr);
  }
  for (let i = 0; i < n; i++) {
    const a = rand(TAU);
    const sp = rand(180, 900);
    parts.push({
      x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 320,
      w: rand(6, 12), hgt: rand(9, 17),
      rot: rand(TAU), vr: rand(-12, 12),
      tilt: rand(TAU), vt: rand(4, 11),
      c: pick(COLORS), life: rand(0.9, 1.5),
    });
  }
  if (confettiRunning) return;
  confettiRunning = true;
  const step = (dt) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 1500 * dt;
      p.vx *= 1 - 1.3 * dt;
      p.vy *= 1 - 0.6 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.tilt += p.vt * dt;
      p.life -= dt * 0.42;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.tilt));
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2.2));
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.roundRect(-p.w / 2, -p.hgt / 2, p.w, p.hgt, 2.5);
      ctx.fill();
      ctx.restore();
    }
    parts = parts.filter((p) => p.life > 0 && p.y < innerHeight + 60);
    if (!parts.length) {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      confettiRunning = false;
      ticker.remove(step);
    }
  };
  ticker.add(step);
}

// ---------- Glas-Zeiger: schmiegt sich an Knöpfe (wie ein iPad-Zeiger) ----------
export function initCursor() {
  if (coarse.matches) return;
  const el = $('#cursor');
  const SEL = '[data-magnet], .icon-btn, .nav-links a, .gseg button, .tabbar button, .morph-trigger, .palette-list li, .scroll-cue';
  const s = {
    x: new Spring(0, 1100, 66), y: new Spring(0, 1100, 66),
    w: new Spring(20, 520, 36), hgt: new Spring(20, 520, 36), r: new Spring(10, 520, 40),
  };
  let px = 0, py = 0, seen = false, down = false;
  let target = null, targetRadius = 12;

  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    px = e.clientX;
    py = e.clientY;
    if (!seen) {
      seen = true;
      s.x.snap(px);
      s.y.snap(py);
      el.classList.add('on');
    }
    const t = e.target instanceof Element ? e.target.closest(SEL) : null;
    if (t !== target) {
      target = t;
      if (t) targetRadius = parseFloat(getComputedStyle(t).borderTopLeftRadius) || 12;
    }
  }, { passive: true });
  addEventListener('pointerdown', () => { down = true; }, { passive: true });
  addEventListener('pointerup', () => { down = false; }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => el.classList.remove('on'));
  document.documentElement.addEventListener('pointerenter', () => { if (seen) el.classList.add('on'); });

  ticker.add((dt) => {
    if (!seen) return;
    let tx = px, ty = py, tw = down ? 14 : 20, th = tw, tr = tw / 2;
    if (target && target.isConnected) {
      const r = target.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      tx = cx + (px - cx) * 0.06;
      ty = cy + (py - cy) * 0.06;
      const grow = down ? 2 : 10;
      tw = r.width + grow;
      th = r.height + grow;
      tr = Math.min(targetRadius + grow / 2, th / 2);
    } else target = null;
    s.x.t = tx; s.y.t = ty; s.w.t = tw; s.hgt.t = th; s.r.t = tr;
    for (const k in s) s[k].step(dt);
    const w = Math.max(2, s.w.v);
    const hh = Math.max(2, s.hgt.v);
    el.style.transform = `translate3d(${(s.x.v - w / 2).toFixed(2)}px, ${(s.y.v - hh / 2).toFixed(2)}px, 0)`;
    el.style.width = `${w.toFixed(2)}px`;
    el.style.height = `${hh.toFixed(2)}px`;
    el.style.borderRadius = `${Math.max(1, s.r.v).toFixed(2)}px`;
  });
}

// ---------- Magnetische Knöpfe ----------
export function initMagnets() {
  if (coarse.matches) return;
  for (const el of $$('[data-magnet]')) {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      el.classList.remove('is-back');
      el.style.translate = `${(dx * 0.2).toFixed(1)}px ${(dy * 0.28).toFixed(1)}px`;
    });
    el.addEventListener('pointerleave', () => {
      el.classList.add('is-back');
      el.style.translate = '0px 0px';
    });
  }
}
