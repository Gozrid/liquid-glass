// main.js — Einstieg der Showcase-Seite

import { $, $$, h, ticker, rand, reducedMotion, LiquidIndicator, whenVisible, coarse } from '../core/util.js';
import { Stage, PALETTES } from '../core/stage.js';
import { initGlass, initSheen, refreshGlass } from '../core/glassfx.js';
import { initControls } from '../core/controls.js';
import { hydrateIcons, LOGO } from '../core/icons.js';
import { theme } from './state.js';
import { initCursor, initMagnets } from './fx.js';
import { initHero } from './hero.js';
import { initLab } from './lab.js';
import { initKit } from './kit.js';
import { initDemos } from './demos.js';
import { initPalette } from './palette.js';

const root = document.documentElement;

// ---------- Grundausstattung ----------
$$('[data-logo]').forEach((el) => { el.innerHTML = LOGO; });
hydrateIcons();
initControls();
initSheen();

// ---------- WebGL-Bühne (Hintergrund + Hero-Glas) ----------
let stage = null;
let hero = null;
try {
  stage = new Stage($('#stage'), { composite: true, dprCap: 2, bgScale: 0.22, palette: PALETTES[theme.mode] });
  root.classList.add('gl');
  hero = initHero(stage, theme);
} catch (err) {
  console.warn('WebGL2 nicht verfügbar – statischer Hintergrund aktiv.', err);
  root.classList.add('no-gl');
}
if (stage) {
  let time = rand(200);
  let pxT = 0, pyT = 0;
  let skip = false;
  let carry = 0;
  addEventListener('pointermove', (e) => {
    pxT = (e.clientX / innerWidth) * 2 - 1;
    pyT = (e.clientY / innerHeight) * 2 - 1;
  }, { passive: true });
  ticker.add((dt, t) => {
    if (!reducedMotion.matches) time += dt;
    const k = 1 - Math.exp(-dt * 2.5);
    stage.pointer[0] += (pxT - stage.pointer[0]) * k;
    stage.pointer[1] += (pyT - stage.pointer[1]) * k;
    hero.update(dt, t);
    // Außerhalb des Heros reichen 30 fps für den ruhigen Hintergrund
    if (!hero.visible) {
      skip = !skip;
      if (skip) { carry += dt; return; }
    }
    stage.render(time, dt + carry);
    carry = 0;
  });
  theme.on((m) => stage.setPalette(PALETTES[m]));
}

// ---------- Abschnitte ----------
initLab(theme);
initKit(theme);
initDemos(theme);
initPalette(theme);
initCursor();
initMagnets();
initGlass();
theme.on(() => requestAnimationFrame(() => refreshGlass()));

// ---------- Theme-Knopf ----------
$('#theme-btn').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  theme.toggle({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
});

// ---------- Navigation: Liquid-Indikator, Kompaktmodus, Fortschritt ----------
const nav = $('#nav');
const linkBox = $('#nav-links');
const links = $$('a', linkBox);
const sections = links.map((a) => $(a.getAttribute('href')));
const navInd = new LiquidIndicator(linkBox, $('.nav-ind', linkBox));
const here = h('button.nav-here', { type: 'button', 'aria-label': 'Navigation ausklappen' });
nav.insertBefore(here, $('.nav-actions', nav));
const bar = $('.scroll-bar');
let active = -2;
let lastY = scrollY;
let compact = false;
let queued = false;

const setCompact = (on) => {
  if (on === compact) return;
  compact = on;
  nav.classList.toggle('is-compact', on);
  if (!on && active >= 0) setTimeout(() => navInd.to(links[active], true), 60);
};
here.addEventListener('click', () => setCompact(false));

const onScroll = () => {
  queued = false;
  const y = scrollY;
  const max = document.documentElement.scrollHeight - innerHeight;
  bar.style.setProperty('--p', max > 0 ? (y / max).toFixed(4) : 0);
  let idx = -1;
  sections.forEach((s, i) => { if (s.getBoundingClientRect().top < innerHeight * 0.42) idx = i; });
  if (idx !== active) {
    active = idx;
    links.forEach((a, i) => a.classList.toggle('is-active', i === idx));
    linkBox.classList.toggle('has-active', idx >= 0);
    if (idx >= 0) navInd.to(links[idx]);
    here.textContent = idx >= 0 ? sections[idx].dataset.section : '';
  }
  const dy = y - lastY;
  if (y < 240) setCompact(false);
  else if (dy > 6) setCompact(true);
  else if (dy < -6) setCompact(false);
  lastY = y;
};
addEventListener('scroll', () => {
  if (!queued) { queued = true; requestAnimationFrame(onScroll); }
}, { passive: true });
addEventListener('resize', () => { if (active >= 0) navInd.to(links[active], true); });
onScroll();

// ---------- Einblenden beim Scrollen ----------
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add('in');
    io.unobserve(e.target);
  }
}, { rootMargin: '0px 0px -6% 0px', threshold: 0.04 });
$$('[data-reveal]').forEach((el) => io.observe(el));

// ---------- fableOS-Teaser ----------
const device = $('#device');
const screen = $('#device-screen');
if (!coarse.matches) {
  device.addEventListener('pointermove', (e) => {
    const r = device.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    device.classList.add('is-live');
    screen.style.setProperty('--rx', `${(4 - y * 9).toFixed(2)}deg`);
    screen.style.setProperty('--ry', `${(x * 11).toFixed(2)}deg`);
  });
  device.addEventListener('pointerleave', () => {
    device.classList.remove('is-live');
    screen.style.removeProperty('--rx');
    screen.style.removeProperty('--ry');
  });
}

// Mini-Terminal tippt eine kleine Sitzung
{
  const out = $('#mini-term');
  const script = [
    { cmd: 'neofetch', res: '<b>fableOS 5.2</b> · Liquid Glass\nShell   fsh\nFenster 3 offen\n' },
    { cmd: 'ls Schreibtisch', res: 'Willkommen.txt  Ideen.md  <em>Bilder/</em>\n' },
    { cmd: 'open malen', res: '<em>Malen</em> wird geöffnet …\n' },
  ];
  let done = '';
  let line = 0;
  let ch = 0;
  let wait = 0;
  let on = false;
  const stepType = () => {
    if (!on) return;
    if (wait > 0) { wait--; return; }
    const cur = script[line];
    if (ch <= cur.cmd.length) {
      out.innerHTML = `${done}<b>›</b> ${cur.cmd.slice(0, ch)}▍`;
      ch++;
      return;
    }
    done += `<b>›</b> ${cur.cmd}\n${cur.res}`;
    out.innerHTML = `${done}<b>›</b> ▍`;
    line++;
    ch = 0;
    wait = 12;
    if (line >= script.length) { line = 0; wait = 50; setTimeout(() => { done = ''; }, 3200); }
  };
  setInterval(stepType, 75);
  whenVisible(device, (v) => { on = v; });
  const clock = () => { $('#mini-clock').textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); };
  clock();
  setInterval(clock, 20000);
}

// Übergang zum Betriebssystem: mit View Transitions wächst der Mini-Bildschirm zum Vollbild
const crossDocVT = 'CSSViewTransitionRule' in window;
for (const a of $$('[data-os-link]')) {
  a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    if (crossDocVT && !reducedMotion.matches) {
      if (a === device) screen.style.viewTransitionName = 'os-screen';
      return;
    }
    e.preventDefault();
    document.body.classList.add('leaving');
    setTimeout(() => { location.href = a.href; }, 240);
  });
}
// abgebrochene Übergänge (z. B. bei sehr schnellem Klicken) sind kein Fehler
addEventListener('pageswap', (e) => { e.viewTransition?.finished.catch(() => {}); });
addEventListener('pagereveal', (e) => { e.viewTransition?.finished.catch(() => {}); });
addEventListener('pageshow', () => {
  document.body.classList.remove('leaving');
  screen.style.viewTransitionName = '';
});
