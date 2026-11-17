// main.js — fableOS: Start, Sperrbildschirm, Hintergrund, Tastenkürzel

import { $, $$, h, ticker, reducedMotion, rand } from '../core/util.js';
import { Stage } from '../core/stage.js';
import { initGlass, initSheen } from '../core/glassfx.js';
import { hydrateIcons, LOGO } from '../core/icons.js';
import { sfx } from '../core/audio.js';
import { bus } from './bus.js';
import { sys, settings, set, apps, widgets, applySettings, activeTheme, WALLPAPERS } from './sys.js';
import { vfs, ready as vfsReady, HOME, TRASH } from './vfs.js';
import { registry } from './registry.js';
import { WM } from './wm.js';
import { initNotify, closeMenu, confirmDialog, fsops } from './ui.js';
import { initMenubar } from './shell/menubar.js';
import { initDock } from './shell/dock.js';
import { initLaunchpad } from './shell/launchpad.js';
import { initSpotlight } from './shell/spotlight.js';
import { initCenter, initSwitcher } from './shell/center.js';
import { initSaver } from './shell/saver.js';
import { initAssistant } from './shell/assistant.js';
import { initDesktop } from './desktop.js';
import { initQuickLook } from './quicklook.js';
import { initPWA } from './pwa.js';
import files from './apps/files.js';
import web from './apps/web.js';
import notes from './apps/notes.js';
import store from './apps/store.js';
import settingsApp from './apps/settings.js';
import terminal from './apps/terminal.js';
import calc from './apps/calc.js';
import paint from './apps/paint.js';
import synth from './apps/synth.js';
import game from './apps/game.js';
import monitor from './apps/monitor.js';
import about from './apps/about.js';

const root = document.documentElement;
const params = new URLSearchParams(location.search);

await vfsReady;
const SYSTEM = [files, web, notes, store, settingsApp, terminal, calc, paint, synth, game, monitor, about];
for (const app of SYSTEM) apps.set(app.id, app);
registry.markSystem(SYSTEM.map((a) => a.id));
registry.init();
applySettings();
$$('[data-logo]').forEach((el) => { el.innerHTML = LOGO; });
hydrateIcons();

// ==========================================================================
// Hintergrund (Shader) — fällt ohne WebGL auf einen CSS-Verlauf zurück; eigenes Bild schlägt beides
// ==========================================================================
let stage = null;
let wallDirty = 90;
function applyWallpaper() {
  const w = WALLPAPERS[settings.wallpaper] || WALLPAPERS.aurora;
  let img = '';
  try { if (settings.wallImage && vfs.exists(settings.wallImage)) img = vfs.read(settings.wallImage); } catch { /* Bild fehlt */ }
  if (!img.startsWith('data:image/')) img = '';
  document.body.classList.toggle('has-wall-image', !!img);
  document.body.style.setProperty('--wall-css', img ? `url("${img}") center / cover no-repeat #05060f` : w.css);
  if (!stage) return;
  stage.mode = w.mode;
  stage.dprCap = w.scale >= 1 ? 1.5 : 0.6;
  stage.setPalette(w[activeTheme()] || w.dark, true);
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
bus.on('setting:wallImage', applyWallpaper);
bus.on('setting:theme', applyWallpaper);
bus.on('setting:animate', () => { wallDirty = 30; });
if (stage) {
  let time = rand(300);
  let px = 0, py = 0, skip = false, carry = 0;
  addEventListener('pointermove', (e) => { px = (e.clientX / innerWidth) * 2 - 1; py = (e.clientY / innerHeight) * 2 - 1; }, { passive: true });
  addEventListener('resize', () => { wallDirty = 10; });
  ticker.add((dt) => {
    if (document.body.classList.contains('has-wall-image') || sys.saver?.active) return;
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
const lockForm = $('#lock-form');
const lockPass = $('#lock-pass');
const off = $('#off');
let locked = true;
let started = false;
document.body.classList.add('is-locked');

/** Hash des Anmeldepassworts – hält neugierige Blicke fern, ist aber keine Verschlüsselung der Daten. */
sys.passHash = async (pass) => {
  const data = new TextEncoder().encode(`fableos:${pass}`);
  if (crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let x = 2166136261;
  for (const b of data) { x ^= b; x = Math.imul(x, 16777619); }
  return `f${(x >>> 0).toString(16)}`;
};

const power = {
  lock() {
    if (locked) return;
    locked = true;
    closeMenu();
    sys.launchpad?.close();
    sys.center?.close();
    sys.assistant?.close();
    if (wm.overview) wm.toggleOverview(false);
    paintLock();
    lock.hidden = false;
    requestAnimationFrame(() => lock.classList.remove('out'));
    document.body.classList.remove('is-on');
    document.body.classList.add('is-locked');
    if (settings.pass) setTimeout(() => lockPass.focus({ preventScroll: true }), 300);
  },
  restart() {
    wm.persist();
    sessionStorage.removeItem('fableos.booted');
    off.classList.add('on');
    setTimeout(() => location.reload(), 520);
  },
  shutdown() {
    wm.persist();
    off.classList.add('on');
    sfx.drop();
    setTimeout(() => { location.href = 'index.html'; }, 560);
  },
};
sys.power = power;
sys.emptyTrash = async () => {
  let n = 0;
  try { n = vfs.list(TRASH).length; } catch { /* kein Papierkorb */ }
  if (!n) return;
  const yes = await confirmDialog({
    icon: 'trash', title: 'Papierkorb wirklich leeren?', ok: 'Papierkorb leeren', danger: true,
    text: `${n} ${n === 1 ? 'Objekt wird' : 'Objekte werden'} endgültig gelöscht. Das lässt sich nicht widerrufen.`,
  });
  if (yes) { vfs.emptyTrash(); sfx.drop(); }
};
/** Dateiwähler des Geräts → Dateien in einen Ordner des virtuellen Dateisystems übernehmen */
sys.importFrom = (dir) => {
  const input = h('input', { type: 'file', multiple: true, hidden: true });
  input.addEventListener('change', async () => {
    const n = await fsops.importHost(dir, [...input.files]);
    input.remove();
    if (n) sys.notify({ title: `${n} ${n === 1 ? 'Datei' : 'Dateien'} importiert`, body: dir.split('/').pop(), app: 'files', onClick: () => sys.open('files', { path: dir }) });
  });
  input.addEventListener('cancel', () => input.remove());
  document.body.append(input);
  input.click();
};
sys.importToDesktop = () => sys.importFrom(`${HOME}/Schreibtisch`);

const menubar = initMenubar(power);
initLaunchpad();
initDock();
const spotlight = initSpotlight(power);
initCenter();
const switcher = initSwitcher();
initSaver(power);
initAssistant(power);
initDesktop();
initQuickLook();
initSheen();
initGlass();
initPWA();

// ---------- Sperrbildschirm ----------
function paintLock() {
  const d = new Date();
  $('#lock-time').textContent = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  $('#lock-date').textContent = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#lock-user').textContent = settings.user;
  $('#lock-note').textContent = settings.lockNote || '';
  lockForm.hidden = !settings.pass;
  $('#lock-hint').hidden = !!settings.pass;
}
setInterval(() => { if (locked) paintLock(); }, 5000);

function unlock() {
  if (!locked || !boot.hidden) return;
  locked = false;
  lock.classList.add('out');
  lockPass.value = '';
  document.body.classList.add('is-on');
  document.body.classList.remove('is-locked');
  setTimeout(() => { if (!locked) lock.hidden = true; }, 800);
  if (settings.startSound) sfx.chime();
  if (!started) { started = true; setTimeout(startSession, 420); }
}
async function tryUnlock() {
  if (!settings.pass) { unlock(); return; }
  if (!lockPass.value) { lockPass.focus({ preventScroll: true }); return; }
  if ((await sys.passHash(lockPass.value)) === settings.pass) { unlock(); return; }
  sfx.error();
  lockPass.value = '';
  lockForm.classList.remove('shake');
  void lockForm.offsetWidth;
  lockForm.classList.add('shake');
}
lock.addEventListener('click', (e) => {
  if (settings.pass) { if (!e.target.closest('#lock-form')) lockPass.focus({ preventScroll: true }); } else unlock();
});
lockForm.addEventListener('submit', (e) => { e.preventDefault(); tryUnlock(); });

// ---------- nach dem ersten Entsperren: letzte Sitzung, Startparameter, Begrüßung ----------
function startSession() {
  const dev = params.get('dev');
  if (dev) wm.ready = true; else wm.restoreSession();
  if (/^[\w-]+$/.test(dev || '')) devApp(dev, params.get('path'));
  const open = params.get('open');
  if (open && apps.has(open)) sys.open(open);
  // Geteilte Inhalte (installierte App als Teilen-Ziel) landen als Notiz
  const shared = ['share_title', 'share_text', 'share_url'].map((k) => params.get(k)).filter(Boolean).join('\n');
  if (shared) {
    const dir = `${HOME}/Dokumente/Notizen`;
    try {
      if (!vfs.exists(dir)) vfs.mkdir(dir);
      const path = `${dir}/${vfs.unique(dir, 'Geteilt.txt')}`;
      vfs.write(path, `${shared}\n`);
      sys.openPath(path);
    } catch (err) { fsops.fail(err); }
  }
  if (open || shared) history.replaceState(null, '', location.pathname);
  if (settings.firstRun) {
    set('firstRun', false);
    setTimeout(() => sys.open('about'), 250);
    setTimeout(() => sys.notify({
      title: 'Willkommen in fableOS', body: 'Alles hier läuft lokal in deinem Browser. Neue Apps findest du im App Store.', app: 'about',
    }), 1500);
  }
  registry.warm();
  sys.pwa?.started();
}

// Entwicklung: os.html?dev=<id> lädt store/apps/<id>.js direkt, startet die App und zeigt ihre Widgets
async function devApp(id, path) {
  try {
    const mod = await import(`./store/apps/${id}.js`);
    const meta = registry.entry(id) || { id, name: id, icon: 'code', colors: ['#8e97b5', '#4a516e'] };
    const def = { ...meta, ...mod.default, id, widgetList: meta.widgets || [] };
    apps.set(id, def);
    for (const w of def.widgetList) {
      if (typeof def.widgets?.[w.id] === 'function') widgets.register(id, w.id, { name: w.name, size: w.size, mount: def.widgets[w.id] });
    }
    const keys = def.widgetList.map((w) => `${id}:${w.id}`).filter((k) => widgets.defs.has(k));
    if (keys.length) set('widgets', [...new Set([...keys, ...settings.widgets])]);
    if (!registry.isLoaded(id)) def.background?.();
    bus.emit('apps');
    sys.open(id, path ? { path } : {});
  } catch (err) {
    console.error(err);
    sys.notify({ title: `App „${id}“ lädt nicht`, body: String(err?.message || err), icon: 'close', force: true });
  }
}

// ---------- Startsequenz ----------
(async () => {
  const fast = !!sessionStorage.getItem('fableos.booted') || reducedMotion.matches;
  const steps = ['Kernel wird geladen', 'Glas wird poliert', 'Dateisystem wird eingehängt', 'Apps werden registriert', 'Bereit'];
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
  if (settings.pass) lockPass.focus({ preventScroll: true });
  else if (params.has('auto') || params.has('dev') || params.has('open') || params.get('source') === 'file') unlock();
})();

// ==========================================================================
// Tastenkürzel
// ==========================================================================
// In der Capture-Phase: Systemkürzel greifen, bevor ein Eingabefeld die Taste für sich nimmt
addEventListener('keydown', (e) => {
  if (locked) {
    if (!boot.hidden || e.metaKey || e.ctrlKey || e.altKey || e.key === 'Tab') return;
    if (settings.pass) { if (document.activeElement !== lockPass) lockPass.focus({ preventScroll: true }); } else unlock();
    return;
  }
  const key = e.key.toLowerCase();
  const mod = e.metaKey || e.ctrlKey;
  const take = () => { e.preventDefault(); e.stopPropagation(); };
  if (mod && !e.altKey && key === 'k') { take(); sys.search(); return; }
  if (e.ctrlKey && !e.altKey && e.code === 'Space') { take(); sys.search(); return; }
  if (e.altKey && !mod && e.code === 'Space') { take(); sys.assistant.toggle(); return; }
  if (mod && !e.altKey && e.key === ',') { take(); sys.open('settings'); return; }
  if (e.key === 'F3') { take(); sys.launchpad.close(); wm.toggleOverview(); return; }
  if (e.key === 'F4') { take(); sys.launchpad.toggle(); return; }
  if (e.key === 'Escape') {
    if (e.altKey) { take(); menubar.forceQuit(); return; }
    if (wm.overview) wm.toggleOverview(false);
    if (spotlight.isOpen) spotlight.close();
    document.body.classList.remove('show-desktop');
    return;
  }
  // Schreibtisch wechseln: ⌃1 … ⌃6
  if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && /^Digit[1-6]$/.test(e.code)) {
    const i = Number(e.code.slice(5)) - 1;
    if (i < wm.spaceCount) { take(); wm.setSpace(i); }
    return;
  }
  const w = wm.focused;
  // Fenster anordnen: ⌃⌥ + Pfeile / ↩ / U I J K (AltGr auf Windows zählt nicht)
  if (e.ctrlKey && e.altKey && !e.metaKey && !e.getModifierState?.('AltGraph')) {
    const act = {
      ArrowLeft: () => w?.snap('left'),
      ArrowRight: () => w?.snap('right'),
      ArrowUp: () => w?.snap('max'),
      ArrowDown: () => { if (w?.snapped) w.toggleMax(); },
      Enter: () => w?.toggleMax(),
      KeyU: () => w?.snap('tl'), KeyI: () => w?.snap('tr'), KeyJ: () => w?.snap('bl'), KeyK: () => w?.snap('br'),
      KeyL: () => power.lock(),
      KeyD: () => sys.showDesktop(),
    }[e.code];
    if (act) { take(); act(); }
    return;
  }
  if (e.altKey && !e.metaKey && !e.ctrlKey) {
    const act = {
      KeyW: () => w?.close(),
      KeyM: () => w?.minimize(),
      KeyH: () => { if (w) wm.hideApp(w.app.id); },
      KeyQ: () => { if (w && !switcher.isOpen) wm.quitApp(w.app.id); },
      Tab: () => switcher.step(e.shiftKey ? -1 : 1),
      Backquote: () => wm.cycle(),
    }[e.code];
    if (act) { take(); act(); }
  }
}, true);

// ==========================================================================
// Kleinigkeiten
// ==========================================================================
bus.on('fs:full', () => sys.notify({
  title: 'Speicher voll', body: 'Der Speicher des Browsers ist erschöpft. Leere den Papierkorb oder lösche große Dateien.', icon: 'close', force: true,
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
