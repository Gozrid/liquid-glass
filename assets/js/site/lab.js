// lab.js — Glas-Labor: ziehbare Linsen über einem Poster, alle Optik-Parameter live

import { $, $$, Spring, clamp, ticker, whenVisible, debounce, rand } from '../core/util.js';
import { Stage, shapeDistance } from '../core/stage.js';

const PAL = {
  dark: ['#070a1f', '#18309e', '#5a22b8', '#c93a5e', '#ffb86b'],
  light: ['#f3f5ff', '#bcd6ff', '#dcc9ff', '#ffd2c8', '#fff4da'],
};
const PRESETS = {
  klar: { refr: 46, bezel: 34, disp: 0.35, frost: 0, tint: 0.02, spec: 1, k: 40 },
  frost: { refr: 28, bezel: 26, disp: 0.12, frost: 14, tint: 0.14, spec: 0.85, k: 40 },
  prisma: { refr: 104, bezel: 64, disp: 1, frost: 0, tint: 0, spec: 1.25, k: 56 },
  tropfen: { refr: 74, bezel: 132, disp: 0.3, frost: 0, tint: 0, spec: 1.5, k: 74 },
};
const FORMAT = {
  refr: (v) => `${v.toFixed(0)} px`, bezel: (v) => `${v.toFixed(0)} px`, disp: (v) => v.toFixed(2),
  frost: (v) => `${v.toFixed(1)} px`, tint: (v) => `${Math.round(v * 100)} %`, spec: (v) => v.toFixed(2), k: (v) => `${v.toFixed(0)} px`,
};
const KINDS = ['kreis', 'pille', 'kissen'];

export function initLab(theme) {
  const view = $('#lab-view');
  const canvas = $('#lab-canvas');
  let stage;
  try {
    stage = new Stage(canvas, { composite: true, dprCap: 2, bgScale: 0.25, palette: PAL[theme.mode] });
  } catch {
    view.classList.add('no-gl');
    return;
  }

  const target = { ...PRESETS.klar };
  const cur = { ...PRESETS.klar };
  Object.assign(stage.params, cur, { curve: 2.2, shadow: 1 });
  let W = 0, H = 0, unit = 100;

  // ---------- Poster (die Szene hinter dem Glas) ----------
  const pc = document.createElement('canvas');
  function drawPoster() {
    W = view.clientWidth;
    H = view.clientHeight;
    if (!W || !H) return;
    unit = clamp(Math.min(W, H) * 0.19, 62, 124);
    const scale = Math.min(Math.min(devicePixelRatio || 1, 2), stage.maxTexture / W);
    pc.width = Math.round(W * scale);
    pc.height = Math.round(H * scale);
    const c = pc.getContext('2d');
    c.setTransform(scale, 0, 0, scale, 0, 0);
    c.clearRect(0, 0, W, H);
    const ink = theme.mode === 'dark' ? '255,255,255' : '11,16,48';
    const fam = getComputedStyle(document.body).fontFamily;

    // Raster
    const cols = Math.max(8, Math.round(W / 46));
    const g = W / cols;
    c.strokeStyle = `rgba(${ink},.075)`;
    c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i < cols; i++) { const x = Math.round(i * g) + 0.5; c.moveTo(x, 0); c.lineTo(x, H); }
    for (let y = g; y < H; y += g) { c.moveTo(0, Math.round(y) + 0.5); c.lineTo(W, Math.round(y) + 0.5); }
    c.stroke();

    // Textzeile, die horizontal nahtlos kachelt
    const row = (text, y, size, paint) => {
      c.font = `800 ${size}px ${fam}`;
      if ('letterSpacing' in c) c.letterSpacing = `${(-size * 0.045).toFixed(2)}px`;
      c.textBaseline = 'alphabetic';
      const tw = c.measureText(text).width;
      const n = Math.max(1, Math.round(W / tw));
      const k = W / n / tw;
      c.save();
      c.translate(0, y);
      c.scale(k, k);
      for (let i = -1; i <= n; i++) paint(text, i * tw);
      c.restore();
    };
    c.fillStyle = `rgba(${ink},.94)`;
    row('Liquid Glass · ', H * 0.36, H * 0.25, (t, x) => c.fillText(t, x, 0));
    c.strokeStyle = `rgba(${ink},.6)`;
    c.lineWidth = 1.6;
    row('Refraktion — Dispersion — Fresnel — ', H * 0.93, H * 0.135, (t, x) => c.strokeText(t, x, 0));

    // Formenreihe
    const colors = ['#ffb65c', '#ff5d6c', '#a06bff', '#45c8ff', '#3fe0b0'];
    const n = Math.max(4, Math.round(W / 150));
    const step = W / n;
    const cy = H * 0.59;
    const s = clamp(H * 0.058, 22, 36);
    for (let i = 0; i < n; i++) {
      const cx = (i + 0.5) * step;
      c.fillStyle = c.strokeStyle = colors[i % colors.length];
      c.beginPath();
      if (i % 3 === 0) { c.arc(cx, cy, s, 0, Math.PI * 2); c.fill(); }
      else if (i % 3 === 1) { c.lineWidth = s * 0.32; c.arc(cx, cy, s * 0.84, 0, Math.PI * 2); c.stroke(); }
      else {
        c.save();
        c.translate(cx, cy);
        c.rotate(-0.35);
        c.roundRect(-s * 1.5, -s * 0.6, s * 3, s * 1.2, s * 0.6);
        c.fill();
        c.restore();
      }
    }

    // kleine Beschriftungen
    if ('letterSpacing' in c) c.letterSpacing = '0px';
    c.font = '500 11px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    c.fillStyle = `rgba(${ink},.5)`;
    const notes = ['n = 1.52', 'λ 450 nm', 'sdf(p) < 0', 'λ 700 nm', 'θ₁ → θ₂'];
    notes.forEach((t, i) => {
      c.fillText(t, ((i + 0.5) / notes.length) * W - 26, i % 2 ? H * 0.47 : H * 0.72);
    });

    stage.setTexture(pc, true);
    stage.texRect = [0, 0, W, H];
  }

  // ---------- Formen ----------
  const dims = (kind) => {
    if (kind === 'pille') return { w: unit * 2.9, h: unit * 1.12, r: unit * 0.56 };
    if (kind === 'kissen') return { w: unit * 1.75, h: unit * 1.75, r: unit * 0.46 };
    return { w: unit * 1.9, h: unit * 1.9, r: unit * 0.95 };
  };
  const mk = (x, y, kind) => {
    const d = dims(kind);
    return {
      kind, ph: rand(6.28),
      x: new Spring(x, 230, 17), y: new Spring(y, 230, 17),
      w: new Spring(d.w, 200, 16), h: new Spring(d.h, 200, 16), r: new Spring(d.r, 200, 16),
    };
  };
  let shapes = [];
  const layout = () => {
    shapes = [
      mk(W * 0.27, H * 0.4, 'kreis'),
      mk(W * 0.56, H * 0.56, 'pille'),
      mk(W * 0.8, H * 0.3, 'kissen'),
    ];
  };
  const snapshot = (s, t) => ({
    x: s.x.v + Math.sin(t * 0.7 + s.ph) * 5,
    y: s.y.v + Math.cos(t * 0.9 + s.ph) * 6,
    w: Math.max(4, s.w.v), h: Math.max(4, s.h.v), r: Math.max(2, s.r.v),
  });
  const hit = (x, y) => {
    let best = null;
    let bd = 10;
    for (const s of shapes) {
      const d = shapeDistance({ x: s.x.v, y: s.y.v, w: s.w.v, h: s.h.v, r: s.r.v }, x, y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  };
  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  let dragging = null;
  canvas.addEventListener('pointerdown', (e) => {
    const [x, y] = local(e);
    const s = hit(x, y);
    if (!s) return;
    dragging = { s, ox: x - s.x.v, oy: y - s.y.v };
    shapes.splice(shapes.indexOf(s), 1);
    shapes.push(s);
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('is-drag');
    $('#lab-hint').classList.add('gone');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const [x, y] = local(e);
    dragging.s.x.t = clamp(x - dragging.ox, 0, W);
    dragging.s.y.t = clamp(y - dragging.oy, 0, H);
  });
  const release = () => { dragging = null; canvas.classList.remove('is-drag'); };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  // auf Touch-Geräten nur dann das Scrollen blockieren, wenn wirklich eine Form getroffen wurde
  canvas.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    const r = canvas.getBoundingClientRect();
    if (hit(t.clientX - r.left, t.clientY - r.top)) e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('dblclick', (e) => {
    const [x, y] = local(e);
    const s = hit(x, y);
    if (!s) return;
    s.kind = KINDS[(KINDS.indexOf(s.kind) + 1) % KINDS.length];
    const d = dims(s.kind);
    s.w.t = d.w; s.h.t = d.h; s.r.t = d.r;
  });

  $('#lab-add').addEventListener('click', () => {
    if (shapes.length >= 8) shapes.splice(3, 1);
    const s = mk(W * rand(0.2, 0.8), -unit, 'kreis');
    const r = unit * rand(0.45, 0.8);
    s.w.snap(r * 2); s.h.snap(r * 2); s.r.snap(r);
    s.y.t = H * rand(0.25, 0.75);
    shapes.push(s);
  });

  // ---------- Regler & Voreinstellungen ----------
  const sliders = $$('.gslider[data-param]', $('#lab-rows'));
  const outs = Object.fromEntries($$('[data-out]', $('#lab-rows')).map((o) => [o.dataset.out, o]));
  const code = $('#lab-code');
  const paintUI = () => {
    for (const sl of sliders) {
      const p = sl.dataset.param;
      sl.value = target[p];
      outs[p].textContent = FORMAT[p](target[p]);
    }
    const f = (v, d = 1) => `<b>${v.toFixed(d)}</b>`;
    code.innerHTML =
`<i>// Uniforms des Fragment-Shaders</i>
uniform float uRefr  = ${f(target.refr)};
uniform float uBezel = ${f(target.bezel)};
uniform float uDisp  = ${f(target.disp, 2)};
uniform float uFrost = ${f(target.frost)};
uniform float uTint  = ${f(target.tint, 2)};
uniform float uSpec  = ${f(target.spec, 2)};
uniform float uK     = ${f(target.k)}; <i>// smin</i>`;
  };
  for (const sl of sliders) {
    sl.addEventListener('input', (e) => {
      target[sl.dataset.param] = e.detail.value;
      paintUI();
    });
  }
  $('#lab-presets').addEventListener('change', (e) => {
    Object.assign(target, PRESETS[e.detail.value]);
    paintUI();
  });
  $('#lab-reset').addEventListener('click', () => {
    Object.assign(target, PRESETS.klar);
    $('#lab-presets').select(0, false);
    layout();
    paintUI();
  });

  // ---------- Schleife ----------
  const fpsEl = $('#lab-fps');
  let time = rand(50);
  let frames = 0;
  let acc = 0;
  const frame = (dt) => {
    time += dt;
    const k = 1 - Math.exp(-dt * 11);
    for (const p in target) cur[p] += (target[p] - cur[p]) * k;
    Object.assign(stage.params, cur);
    for (const s of shapes) { s.x.step(dt); s.y.step(dt); s.w.step(dt); s.h.step(dt); s.r.step(dt); }
    stage.shapes = shapes.map((s) => snapshot(s, time));
    stage.texShift[0] = (time * 0.011) % 1;
    stage.render(time, dt);
    frames++;
    acc += dt;
    if (acc >= 0.5) {
      fpsEl.textContent = `${Math.round(frames / acc)} fps`;
      frames = 0;
      acc = 0;
    }
  };
  whenVisible(view, (on) => { if (on) ticker.add(frame); else ticker.remove(frame); }, '80px');

  const rebuild = () => {
    const first = !W;
    const oldW = W, oldH = H;
    drawPoster();
    if (first || !shapes.length) layout();
    else if (oldW && oldH) {
      for (const s of shapes) {
        s.x.snap((s.x.v / oldW) * W);
        s.y.snap((s.y.v / oldH) * H);
        const d = dims(s.kind);
        s.w.t = d.w; s.h.t = d.h; s.r.t = d.r;
      }
    }
  };
  rebuild();
  paintUI();
  new ResizeObserver(debounce(rebuild, 120)).observe(view);
  theme.on((m) => { stage.setPalette(PAL[m]); drawPoster(); });
}
