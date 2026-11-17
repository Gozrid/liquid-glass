// saver.js — Bildschirmschoner „Strömung“ (startet nach Leerlauf) und aktive Ecken

import { $, h, ticker, TAU, reducedMotion } from '../../core/util.js';
import { bus } from '../bus.js';
import { sys, settings } from '../sys.js';

export const CORNER_ACTIONS = [
  ['none', '–'], ['overview', 'Übersicht'], ['apps', 'Apps'], ['desktop', 'Schreibtisch zeigen'],
  ['center', 'Mitteilungen'], ['search', 'Suche'], ['saver', 'Bildschirmschoner'], ['lock', 'Sperren'],
];

export function initSaver(power) {
  const cv = h('canvas');
  const clock = h('div.saver-clock', h('b'), h('span'));
  const el = h('div#saver', { hidden: true, 'aria-hidden': 'true' }, cv, clock);
  document.body.append(el);
  const ctx = cv.getContext('2d');
  const COLORS = ['#ffb65c', '#ff5d6c', '#a06bff', '#45c8ff', '#3fe0b0'];
  let on = false;
  let parts = [];
  let t = 0;
  let startedAt = 0;
  let lastInput = Date.now();

  const size = () => {
    const d = Math.min(devicePixelRatio || 1, 1.5);
    cv.width = Math.round(innerWidth * d);
    cv.height = Math.round(innerHeight * d);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = '#03040c';
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    const n = Math.round(Math.min(1100, (innerWidth * innerHeight) / 1500));
    parts = Array.from({ length: n }, (_, i) => ({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, c: COLORS[i % COLORS.length], life: Math.random() * 300 }));
  };
  const paintClock = () => {
    const d = new Date();
    clock.firstChild.textContent = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    clock.lastChild.textContent = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
    // wandert langsam, damit nichts einbrennt
    clock.style.translate = `${Math.sin(t * 0.05) * 12}vw ${Math.cos(t * 0.037) * 14}vh`;
  };
  const frame = (dt) => {
    t += dt;
    ctx.fillStyle = 'rgba(3, 4, 12, .06)';
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      // Strömungsfeld aus überlagerten Wellen – kein Rauschen nötig
      const a = (Math.sin(p.x * 0.0031 + t * 0.21) + Math.sin(p.y * 0.0043 - t * 0.17) + Math.sin((p.x + p.y) * 0.0019 + t * 0.11)) * TAU * 0.33;
      const nx = p.x + Math.cos(a) * 1.7;
      const ny = p.y + Math.sin(a) * 1.7;
      ctx.strokeStyle = p.c;
      ctx.globalAlpha = 0.34;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      p.x = nx;
      p.y = ny;
      p.life -= 1;
      if (p.life < 0 || nx < -10 || ny < -10 || nx > innerWidth + 10 || ny > innerHeight + 10) {
        p.x = Math.random() * innerWidth;
        p.y = Math.random() * innerHeight;
        p.life = 160 + Math.random() * 260;
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (((t * 2) | 0) !== (((t - dt) * 2) | 0)) paintClock();
  };

  const stop = () => {
    if (!on) return;
    on = false;
    ticker.remove(frame);
    el.classList.remove('on');
    setTimeout(() => { if (!on) el.hidden = true; }, 500);
    lastInput = Date.now();
    if (settings.saverLock && settings.pass) power.lock();
  };
  const start = () => {
    if (on) return;
    on = true;
    startedAt = performance.now();
    el.hidden = false;
    size();
    paintClock();
    requestAnimationFrame(() => el.classList.add('on'));
    if (!reducedMotion.matches) ticker.add(frame);
  };
  const wake = () => { if (on && performance.now() - startedAt > 500) stop(); };

  for (const evt of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) {
    addEventListener(evt, (e) => {
      lastInput = Date.now();
      if (!on) return;
      if (evt === 'pointermove' && Math.abs(e.movementX) + Math.abs(e.movementY) < 3) return;
      if (evt === 'keydown') { e.preventDefault(); e.stopPropagation(); }
      wake();
    }, { capture: true, passive: evt !== 'keydown' });
  }
  addEventListener('resize', () => { if (on) size(); });
  setInterval(() => {
    const min = Number(settings.saverAfter) || 0;
    if (!on && min > 0 && !document.hidden && Date.now() - lastInput > min * 60000 && !sys.nowPlaying?.playing) start();
  }, 15000);

  // ---------- Aktive Ecken ----------
  const run = {
    overview: () => sys.wm.toggleOverview(),
    apps: () => sys.launchpad?.toggle(),
    desktop: () => { document.body.classList.toggle('show-desktop'); bus.emit('peek'); },
    center: () => sys.center?.toggle(),
    search: () => sys.search(),
    saver: () => start(),
    lock: () => power.lock(),
  };
  let armed = null;
  let timer = 0;
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || e.buttons) return;
    const x = e.clientX, y = e.clientY;
    const corner = (y <= 1 ? 't' : y >= innerHeight - 2 ? 'b' : '') + (x <= 1 ? 'l' : x >= innerWidth - 2 ? 'r' : '');
    if (corner.length !== 2) { armed = null; clearTimeout(timer); return; }
    if (armed === corner) return;
    armed = corner;
    const action = settings.corners?.[corner];
    clearTimeout(timer);
    if (action && action !== 'none' && run[action] && !document.body.classList.contains('is-locked')) timer = setTimeout(run[action], 260);
  }, { passive: true });
  // „Schreibtisch zeigen“ endet, sobald wieder ein Fenster nach vorn kommt
  bus.on('focus', (w) => { if (w) document.body.classList.remove('show-desktop'); });

  sys.saver = { start, stop, get active() { return on; } };
  sys.showDesktop = run.desktop;
  void $;
  return sys.saver;
}
