// main.js — fableOS: Start, Sperrbildschirm, Hintergrund, Tastenkürzel

import { $, $$, ticker, reducedMotion, rand } from '../core/util.js';
import { Stage } from '../core/stage.js';
import { initGlass, initSheen } from '../core/glassfx.js';
import { hydrateIcons, LOGO } from '../core/icons.js';
import { sfx } from '../core/audio.js';
import { bus } from './bus.js';
import { sys, settings, set, apps, applySettings, WALLPAPERS } from './sys.js';
import { WM } from './wm.js';
import { initNotify, closeMenu } from './ui.js';
import { initMenubar, initDock, initLauncher } from './shell.js';
import { initDesktop } from './desktop.js';
import files from './apps/files.js';
import terminal from './apps/terminal.js';
import notes from './apps/notes.js';
import paint from './apps/paint.js';
import synth from './apps/synth.js';
import web from './apps/web.js';
import calc from './apps/calc.js';
import game from './apps/game.js';
import monitor from './apps/monitor.js';
import settingsApp from './apps/settings.js';
import about from './apps/about.js';

const root = document.documentElement;
for (const app of [files, terminal, notes, paint, synth, web, calc, game, monitor, settingsApp, about]) apps.set(app.id, app);
applySettings();
$$('[data-logo]').forEach((el) => { el.innerHTML = LOGO; });
hydrateIcons();

// ==========================================================================
// Hintergrund (Shader) — fällt ohne WebGL auf einen CSS-Verlauf zurück
// ==========================================================================
let stage = null;
let wallDirty = 90;
function applyWallpaper() {
  const w = WALLPAPERS[settings.wallpaper] || WALLPAPERS.aurora;
  document.body.style.setProperty('--wall-css', w.css);
  if (!stage) return;
  stage.mode = w.mode;
  stage.dprCap = w.scale >= 1 ? 1.5 : 0.6;
  stage.setPalette(w[settings.theme] || w.dark, true);
  wallDirty = 90;
}
try {
  stage = new Stage($('#wallpaper'), { composite: false, dprCap: 1 });
  root.classList.add('gl');
} catch (err) {
  console.warn('WebGL2 nicht verfügbar – statischer Hintergrund aktiv.', err);
  root.classList.add('no-gl');
}
applyWallpaper();
bus.on('setting:wallpaper', applyWallpaper);
bus.on('setting:theme', applyWallpaper);
bus.on('setting:animate', () => { wallDirty = 30; });
if (stage) {
  let time = rand(300);
  let px = 0, py = 0, skip = false, carry = 0;
  addEventListener('pointermove', (e) => { px = (e.clientX / innerWidth) * 2 - 1; py = (e.clientY / innerHeight) * 2 - 1; }, { passive: true });
  addEventListener('resize', () => { wallDirty = 10; });
  ticker.add((dt) => {
    const moving = settings.animate && !reducedMotion.matches;
    if (!moving && wallDirty <= 0) return;      // Standbild: nichts zu tun
    wallDirty--;
    skip = !skip;
    if (skip && moving) { carry += dt; return; }  // ruhige Motive: 30 fps genügen
    if (moving) time += dt + carry;
    const k = 1 - Math.exp(-(dt + carry) * 2);
    stage.pointer[0] += (px - stage.pointer[0]) * k;
    stage.pointer[1] += (py - stage.pointer[1]) * k;
    stage.render(time, dt + carry);
    carry = 0;
  });
}

// ==========================================================================
// System hochziehen
// ==========================================================================
const wm = new WM($('#windows'), $('#snap'));
sys.wm = wm;
initNotify();

const boot = $('#boot');
const lock = $('#lock');
const off = $('#off');
let locked = true;

const power = {
  lock() {
    if (locked) return;
    locked = true;
    closeMenu();
    paintLock();
    lock.hidden = false;
    requestAnimationFrame(() => lock.classList.remove('out'));
    document.body.classList.remove('is-on');
  },
  restart() {
    sessionStorage.removeItem('fableos.booted');
    off.classList.add('on');
    setTimeout(() => location.reload(), 520);
  },
  shutdown() {
    off.classList.add('on');
    sfx.drop();
    setTimeout(() => { location.href = 'index.html'; }, 560);
  },
};
sys.power = power;

initMenubar(power);
initDock();
const launcher = initLauncher(power);
initDesktop();
initSheen();
initGlass();

// ---------- Sperrbildschirm ----------
function paintLock() {
  const d = new Date();
  $('#lock-time').textContent = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  $('#lock-date').textContent = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#lock-user').textContent = settings.user;
}
setInterval(() => { if (locked) paintLock(); }, 5000);

function unlock() {
  if (!locked || !boot.hidden) return;
  locked = false;
  lock.classList.add('out');
  document.body.classList.add('is-on');
  setTimeout(() => { if (!locked) lock.hidden = true; }, 800);
  sfx.chime();
  if (settings.firstRun) {
    set('firstRun', false);
    setTimeout(() => sys.open('about'), 650);
    setTimeout(() => sys.notify({
      title: 'Willkommen in fableOS', body: 'Alles hier läuft lokal in deinem Browser. Viel Spaß beim Erkunden!', app: 'about',
    }), 1900);
  }
}
lock.addEventListener('click', unlock);

// ---------- Startsequenz ----------
(async () => {
  const fast = !!sessionStorage.getItem('fableos.booted') || reducedMotion.matches;
  const steps = ['Kernel wird geladen', 'Glas wird poliert', 'Dateisystem wird eingehängt', 'Fenster-Manager startet', 'Bereit'];
  const bar = $('#boot-bar');
  const msg = $('#boot-msg');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(fast ? 60 : 380);
  for (let i = 0; i < steps.length; i++) {
    msg.textContent = steps[i];
    bar.style.setProperty('--p', (i + 1) / steps.length);
    await wait(fast ? 70 : 260 + rand(120));
  }
  sessionStorage.setItem('fableos.booted', '1');
  paintLock();
  lock.hidden = false;
  boot.classList.add('out');
  await wait(620);
  boot.hidden = true;
  if (new URLSearchParams(location.search).has('auto')) unlock();
})();

// ==========================================================================
// Tastenkürzel
// ==========================================================================
addEventListener('keydown', (e) => {
  if (locked) {
    if (boot.hidden && !e.metaKey && !e.ctrlKey && !e.altKey && e.key !== 'Tab') unlock();
    return;
  }
  const key = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && key === 'k') { e.preventDefault(); sys.search(); return; }
  if (e.ctrlKey && e.code === 'Space') { e.preventDefault(); sys.search(); return; }
  if (e.key === 'F3') { e.preventDefault(); wm.toggleOverview(); return; }
  if (e.key === 'Escape') {
    if (wm.overview) wm.toggleOverview(false);
    if (launcher.isOpen) launcher.close();
    return;
  }
  if (e.altKey && !e.metaKey && !e.ctrlKey) {
    const w = wm.focused;
    const act = {
      KeyW: () => w?.close(),
      KeyM: () => w?.minimize(),
      Enter: () => w?.toggleMax(),
      ArrowLeft: () => w?.snap('left'),
      ArrowRight: () => w?.snap('right'),
      ArrowUp: () => w?.snap('max'),
      Tab: () => wm.cycle(),
    }[e.code];
    if (act) { e.preventDefault(); act(); }
  }
});

// ==========================================================================
// Kleinigkeiten
// ==========================================================================
bus.on('fs:full', () => sys.notify({
  title: 'Speicher voll', body: 'Der lokale Speicher des Browsers ist erschöpft. Leere den Papierkorb oder lösche Bilder.', icon: 'close', force: true,
}));
addEventListener('offline', () => sys.notify({ title: 'Offline', body: 'Kein Netz – fableOS läuft trotzdem weiter, alles liegt lokal.', icon: 'wifi' }));
addEventListener('online', () => sys.notify({ title: 'Wieder online', body: 'Die Verbindung steht.', icon: 'wifi' }));
// Fenster nie versehentlich per Datei-Drop verlassen
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => e.preventDefault());
// Kontextmenü des Browsers nur in Textfeldern zulassen
addEventListener('contextmenu', (e) => { if (!e.target.closest('input, textarea, iframe')) e.preventDefault(); });

addEventListener('pageswap', (e) => { e.viewTransition?.finished.catch(() => {}); });
addEventListener('pagereveal', (e) => { e.viewTransition?.finished.catch(() => {}); });

// für Neugierige in der Konsole: fableOS.open('terminal')
window.fableOS = sys;
