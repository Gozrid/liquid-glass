// hero.js — die Überschrift wird in eine Textur gezeichnet, damit die Glastropfen sie brechen können

import { $, $$, Spring, clamp, rand, coarse, debounce } from '../core/util.js';

export function initHero(stage, theme) {
  const hero = $('.hero');
  const title = $('#hero-title');
  const words = $$('.w', title);
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const hasLS = 'letterSpacing' in ctx;
  let rect = { x: 0, y: 0, w: 1, h: 1 };       // Dokument-Koordinaten

  function draw() {
    const tr = title.getBoundingClientRect();
    if (!tr.width) return;
    const pad = 48;
    const w = tr.width + pad * 2;
    const hgt = tr.height + pad * 2;
    const dpr = Math.min(devicePixelRatio || 1, stage.dprCap);
    const scale = Math.min(dpr, stage.maxTexture / w, stage.maxTexture / hgt);
    cv.width = Math.ceil(w * scale);
    cv.height = Math.ceil(hgt * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const cs = getComputedStyle(title);
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if (hasLS) ctx.letterSpacing = cs.letterSpacing;
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText('Hg');
    const asc = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent;
    const desc = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent;
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim() || '#fff';
    const acc = words.filter((el) => el.classList.contains('acc')).map((el) => el.getBoundingClientRect());
    let grad = ink;
    if (acc.length) {
      const x0 = Math.min(...acc.map((r) => r.left)) - tr.left + pad;
      const x1 = Math.max(...acc.map((r) => r.right)) - tr.left + pad;
      grad = ctx.createLinearGradient(x0, 0, x1, 0);
      grad.addColorStop(0, '#ffb65c');
      grad.addColorStop(0.36, '#ff5d6c');
      grad.addColorStop(0.7, '#a06bff');
      grad.addColorStop(1, '#45c8ff');
    }
    for (const el of words) {
      const r = el.getBoundingClientRect();
      const x = r.left - tr.left + pad;
      const base = r.top - tr.top + pad + (r.height - (asc + desc)) / 2 + asc;
      ctx.fillStyle = el.classList.contains('acc') ? grad : ink;
      if (hasLS) ctx.fillText(el.textContent, x, base);
      else {
        // ältere Browser: Laufweite von Hand setzen
        const ls = parseFloat(cs.letterSpacing) || 0;
        let cx = x;
        for (const ch of el.textContent) { ctx.fillText(ch, cx, base); cx += ctx.measureText(ch).width + ls; }
      }
    }
    stage.setTexture(cv);
    rect = { x: tr.left - pad, y: tr.top + scrollY - pad, w, h: hgt };
  }

  // ---------- Tropfen ----------
  Object.assign(stage.params, { refr: 62, bezel: 78, curve: 2.1, disp: 0.45, frost: 0, tint: 0.015, spec: 1.1, shadow: 0.8, k: 52 });
  const main = { x: new Spring(innerWidth * 0.72, 90, 13), y: new Spring(innerHeight * 0.42, 90, 13), r: new Spring(0, 170, 13) };
  const sats = [
    { ax: 0.44, ay: 0.3, sp: 0.21, ph: 0.4, r: 0.52 },
    { ax: 0.3, ay: 0.42, sp: 0.16, ph: 2.6, r: 0.36 },
    { ax: 0.52, ay: 0.2, sp: 0.12, ph: 4.4, r: 0.44 },
  ];
  let drops = [];
  let px = 0, py = 0, lastMove = -1e9, pressed = false;

  addEventListener('pointermove', (e) => {
    px = e.clientX;
    py = e.clientY;
    lastMove = performance.now();
  }, { passive: true });
  hero.addEventListener('pointerdown', (e) => {
    if (e.target.closest('a, button')) return;
    pressed = true;
    px = e.clientX;
    py = e.clientY;
    lastMove = performance.now();
    main.r.vel += 420;
    for (let i = 0; i < 3; i++) {
      drops.push({ x: px, y: py, vx: rand(-300, 300), vy: rand(-560, -240), r: rand(20, 38), life: 1 });
    }
    drops = drops.slice(-4);
  });
  addEventListener('pointerup', () => { pressed = false; }, { passive: true });
  addEventListener('pointercancel', () => { pressed = false; }, { passive: true });

  let visible = true;
  function update(dt, t) {
    const hr = hero.getBoundingClientRect();
    visible = hr.bottom > 0;
    stage.texRect = [rect.x, rect.y - scrollY, rect.w, rect.h];
    if (!visible) { stage.shapes = []; return; }

    const vw = innerWidth;
    const vh = innerHeight;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y - scrollY + rect.h / 2;
    const fade = clamp(hr.bottom / (vh * 0.55));          // beim Hinausscrollen schrumpfen
    const base = clamp(vw * 0.085, 58, 132);

    const idle = performance.now() - lastMove > 3500 || (coarse.matches && !pressed && performance.now() - lastMove > 900);
    if (idle) {
      main.x.t = cx + Math.sin(t * 0.45) * rect.w * 0.34;
      main.y.t = cy + Math.sin(t * 0.72 + 1.1) * rect.h * 0.26;
    } else {
      main.x.t = px;
      main.y.t = py;
    }
    main.r.t = base * (pressed ? 1.28 : 1) * fade;
    main.x.step(dt);
    main.y.step(dt);
    main.r.step(dt);

    const shapes = [];
    const mr = Math.max(0, main.r.v);
    if (mr > 1) shapes.push({ x: main.x.v, y: main.y.v, w: mr * 2, h: mr * 2, r: mr });
    for (const s of sats) {
      const r = base * s.r * fade;
      if (r < 2) continue;
      shapes.push({
        x: cx + Math.cos(t * s.sp + s.ph) * rect.w * s.ax,
        y: cy + Math.sin(t * s.sp * 1.37 + s.ph) * rect.h * s.ay,
        w: r * 2, h: r * 2, r,
      });
    }
    for (const d of drops) {
      d.vy += 1350 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.life -= dt * 0.6;
      const r = d.r * clamp(d.life * 1.7) * fade;
      if (r > 2) shapes.push({ x: d.x, y: d.y, w: r * 2, h: r * 2, r });
    }
    drops = drops.filter((d) => d.life > 0 && d.y < vh + 80);
    stage.shapes = shapes;
  }

  draw();
  addEventListener('resize', debounce(draw, 120));
  theme.on(() => requestAnimationFrame(draw));
  document.fonts?.ready.then(draw);

  return { update, draw, get visible() { return visible; } };
}
