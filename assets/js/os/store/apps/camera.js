// camera.js — Kamera: Live-Bild mit Filtern, Selbstauslöser und Serienstreifen; Fotos landen in ~/Bilder/Kamera

import { h, debounce, ticker, reducedMotion } from '../../../core/util.js';
import { icon } from '../../../core/icons.js';
import { tone } from '../../../core/audio.js';
import { sys, settings } from '../../sys.js';
import { bus } from '../../bus.js';
import { vfs, HOME, extname } from '../../vfs.js';
import { style, appStore, toolBtn, toast, pad2 } from '../../kit.js';

const PICS = `${HOME}/Bilder`;
const DIR = `${PICS}/Kamera`;
const CELLS = 72;          // „Pixel“-Filter: so viele Klötzchen in der Breite
const TIMERS = [0, 3, 10];
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}.${pad2(d.getMinutes())}.${pad2(d.getSeconds())}`;

// ==========================================================================
// Filter: werden auf den Pixeln gerechnet – Vorschau und Foto benutzen dieselbe Funktion
// ==========================================================================
const lut = (fn) => { const t = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) t[i] = fn(i); return t; };
const CURVE = lut((i) => { const x = i / 255; const y = x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x); return 255 * (x * 0.3 + y * 0.7); });
const POSTER = lut((i) => Math.round(i / 42.5) * 42.5);
const HEAT = [[0, 0, 0, 36], [0.18, 30, 0, 130], [0.38, 160, 0, 160], [0.58, 238, 50, 50], [0.78, 255, 165, 0], [1, 255, 255, 215]];
const heat = (ch) => lut((i) => {
  const x = i / 255;
  let k = 1;
  while (k < HEAT.length - 1 && HEAT[k][0] < x) k++;
  const a = HEAT[k - 1], b = HEAT[k];
  return a[ch] + (b[ch] - a[ch]) * ((x - a[0]) / (b[0] - a[0]));
});
const HR = heat(1), HG = heat(2), HB = heat(3);
const luma = (d, i) => (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;

const FILTERS = [
  { id: 'normal', name: 'Normal' },
  { id: 'mono', name: 'Mono', px(d) { for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = CURVE[luma(d, i)]; } },
  { id: 'sepia', name: 'Sepia', px(d) {
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      d[i] = r * 0.393 + g * 0.769 + b * 0.189;
      d[i + 1] = r * 0.349 + g * 0.686 + b * 0.168;
      d[i + 2] = r * 0.272 + g * 0.534 + b * 0.131;
    }
  } },
  { id: 'cool', name: 'Kühl', px(d) { for (let i = 0; i < d.length; i += 4) { d[i] *= 0.82; d[i + 1] = d[i + 1] * 0.97 + 3; d[i + 2] = d[i + 2] * 1.1 + 16; } } },
  { id: 'warm', name: 'Warm', px(d) { for (let i = 0; i < d.length; i += 4) { d[i] = d[i] * 1.08 + 12; d[i + 1] = d[i + 1] * 1.02 + 3; d[i + 2] *= 0.78; } } },
  { id: 'punch', name: 'Kontrast', px(d) {
    for (let i = 0; i < d.length; i += 4) {
      const r = CURVE[d[i]], g = CURVE[d[i + 1]], b = CURVE[d[i + 2]];
      const l = (r * 77 + g * 150 + b * 29) >> 8;
      d[i] = l + (r - l) * 1.35; d[i + 1] = l + (g - l) * 1.35; d[i + 2] = l + (b - l) * 1.35;
    }
  } },
  { id: 'pixel', name: 'Pixel', mosaic: true, px(d) { for (let i = 0; i < d.length; i += 4) { d[i] = POSTER[d[i]]; d[i + 1] = POSTER[d[i + 1]]; d[i + 2] = POSTER[d[i + 2]]; } } },
  { id: 'thermo', name: 'Thermo', px(d) { for (let i = 0; i < d.length; i += 4) { const l = luma(d, i); d[i] = HR[l]; d[i + 1] = HG[l]; d[i + 2] = HB[l]; } } },
];

/**
 * Zeichnet ein gespiegeltes, gefiltertes Bild der Quelle auf c (W × H).
 * crop = [sx, sy, sw, sh] wählt einen Ausschnitt; cells bestimmt die Klötzchen-Größe des Pixel-Filters.
 */
function paintFrame(c, W, H, source, crop, f, scratch, cells = CELLS) {
  const [sx, sy, sw, sh] = crop;
  if (f.mosaic) {
    const block = Math.max(2, Math.round(W / cells));
    const cols = Math.ceil(W / block), rows = Math.ceil(H / block);
    if (scratch.width !== cols || scratch.height !== rows) { scratch.width = cols; scratch.height = rows; }
    const sc = scratch.getContext('2d', { willReadFrequently: true });
    sc.setTransform(-1, 0, 0, 1, cols, 0);
    sc.drawImage(source, sx, sy, sw, sh, 0, 0, cols, rows);
    sc.setTransform(1, 0, 0, 1, 0, 0);
    const im = sc.getImageData(0, 0, cols, rows);
    f.px(im.data);
    sc.putImageData(im, 0, 0);
    c.imageSmoothingEnabled = false;
    c.drawImage(scratch, 0, 0, cols, rows, 0, 0, cols * block, rows * block);
    c.imageSmoothingEnabled = true;
    return;
  }
  c.setTransform(-1, 0, 0, 1, W, 0);
  c.drawImage(source, sx, sy, sw, sh, 0, 0, W, H);
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (f.px) {
    const im = c.getImageData(0, 0, W, H);
    f.px(im.data);
    c.putImageData(im, 0, 0);
  }
}

const svg = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const IC = {
  timer: svg('<circle cx="12" cy="13.500" r="7.500"/><path d="M12 9.500v4l2.500 1.500M9.500 3h5M12 3v3"/>'),
  strip: svg('<rect x="7" y="2.500" width="10" height="19" rx="2.200"/><path d="M7 7.500h10M7 12h10M7 16.500h10"/>'),
  single: svg('<rect x="3.500" y="5.500" width="17" height="13" rx="2.800"/><circle cx="12" cy="12" r="2.800"/>'),
  swap: svg('<path d="M4 9.500a8 8 0 0 1 14.300-3M20 14.500a8 8 0 0 1-14.300 3"/><path d="M18.500 2.500v4h-4M5.500 21.500v-4h4"/>'),
  cam: svg('<path d="M4 9a2.500 2.500 0 0 1 2.500-2.500h1.700L9.500 4.500h5l1.300 2h1.700A2.500 2.500 0 0 1 20 9v7.500a2.500 2.500 0 0 1-2.500 2.500h-11A2.500 2.500 0 0 1 4 16.500z"/><circle cx="12" cy="12.500" r="3.300"/>'),
};

style('camera', `
.camera { background: rgba(0, 0, 10, .2); }
.camera-stage { position: relative; display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); place-items: center; flex: 1; min-height: 0; padding: 12px 12px 6px; }
.camera-view { max-width: 100%; max-height: 100%; width: auto; height: auto; aspect-ratio: 4 / 3; border-radius: 14px; background: rgba(0, 0, 10, .55); box-shadow: 0 16px 44px -18px rgba(0, 0, 14, .8), inset 0 0 0 .5px rgba(255, 255, 255, .12); }
.camera-video { position: absolute; width: 2px; height: 2px; opacity: 0; pointer-events: none; }
.camera-flash { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; }
.camera-count { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; color: #fff; font: 800 clamp(90px, 34cqw, 200px) / 1 var(--font-round); text-shadow: 0 8px 40px rgba(0, 0, 14, .55); font-variant-numeric: tabular-nums; }
.camera-count b { animation: camera-count .95s var(--ease-out) both; }
@keyframes camera-count { 0% { opacity: 0; transform: scale(1.7); } 18% { opacity: 1; transform: scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: scale(.8); } }
.camera-badge { position: absolute; left: 50%; top: 22px; padding: 4px 12px; border-radius: 99px; background: rgba(0, 0, 14, .55); color: #fff; font-size: 12px; font-weight: 700; translate: -50% 0; -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); font-variant-numeric: tabular-nums; }
.camera-msg { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 10px; padding: 24px; text-align: center; }
.camera-msg .ico { width: 46px; height: 46px; stroke-width: 1.2; color: var(--fg-3); }
.camera-msg b { font-size: 15px; }
.camera-msg p { max-width: 30em; font-size: 12.5px; color: var(--fg-3); text-wrap: pretty; }
.camera-msg .kit-btn { margin-top: 6px; }
.camera-spin { width: 26px; height: 26px; border-radius: 50%; border: 2.5px solid var(--fg-4); border-top-color: var(--fg); animation: camera-spin .8s linear infinite; }
@keyframes camera-spin { to { rotate: 360deg; } }

.camera-filters { display: flex; gap: 8px; flex: none; padding: 6px 12px 8px; overflow-x: auto; scrollbar-width: none; justify-content: safe center; }
.camera-filters::-webkit-scrollbar { display: none; }
.camera-filters button { display: grid; justify-items: center; gap: 3px; flex: none; padding: 0; border: 0; background: none; font-size: 11px; font-weight: 600; color: var(--fg-3); }
.camera-filters canvas { width: 62px; height: 46px; border-radius: 9px; background: var(--well); transition: transform .4s var(--spring), box-shadow .2s; }
.camera-filters button:hover canvas { transform: scale(1.06); }
.camera-filters button[aria-pressed="true"] { color: var(--fg); }
.camera-filters button[aria-pressed="true"] canvas { box-shadow: 0 0 0 2px var(--solid), 0 0 0 4px var(--accent); }

.camera-bar { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 12px; flex: none; padding: 8px 14px 12px; }
.camera-roll { display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; }
.camera-roll button { flex: none; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 10px; overflow: hidden; background: var(--well); box-shadow: inset 0 0 0 .5px var(--line); transition: transform .4s var(--spring); }
.camera-roll button:hover { transform: scale(1.08); }
.camera-roll button.is-new { animation: camera-pop .5s var(--spring) both; }
@keyframes camera-pop { from { transform: scale(.3); opacity: 0; } }
.camera-roll img { width: 100%; height: 100%; object-fit: cover; }
.camera-roll span { font-size: 12px; color: var(--fg-3); white-space: nowrap; }
.camera-shutter { position: relative; display: grid; place-items: center; width: 62px; height: 62px; padding: 0; border: 0; border-radius: 50%; background: none; box-shadow: inset 0 0 0 3.5px var(--fg); color: #fff; transition: transform .4s var(--spring), opacity .2s; }
.camera-shutter::before { content: ""; position: absolute; inset: 7px; border-radius: 50%; background: var(--fg); transition: inset .3s var(--spring), border-radius .3s, background-color .2s; }
.camera-shutter:hover::before { inset: 6px; }
.camera-shutter:active { transform: scale(.92); }
.camera-shutter:active::before { inset: 10px; }
.camera-shutter.is-busy::before { inset: 20px; border-radius: 6px; background: var(--c-coral); }
.camera-shutter:disabled { opacity: .35; cursor: default; }
.camera-opts { display: flex; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; }
.camera-opts .kit-btn.is-on { background: var(--accent); color: #fff; box-shadow: none; }

@container win (max-width: 540px) {
  .camera-opts .kit-btn span { display: none; }
  .camera-opts .kit-btn { padding: 7px 9px; }
  .camera-roll button:nth-child(n + 3) { display: none; }
  .camera-filters { justify-content: flex-start; }
  .camera-filters canvas { width: 54px; height: 40px; }
}
`);

export default {
  singleton: true,
  width: 760, height: 640, minW: 400, minH: 420,

  mount(win) {
    const S = appStore('camera');
    let stream = null;
    let state = 'idle';            // idle | starting | live | error
    let gen = 0;                   // macht veraltete Starts unwirksam
    let filter = FILTERS.find((f) => f.id === S.get('filter')) || FILTERS[0];
    let timer = TIMERS.includes(S.get('timer')) ? S.get('timer') : 0;
    let burst = !!S.get('burst', false);
    let deviceId = S.get('device', null);
    let devices = [];
    let busy = null;               // laufender Countdown / Serie: {cancel()}
    let closed = false;
    let vw = 0, vh = 0, W = 0, H = 0, lastT = -1, frames = 0;
    let newest = null;

    // ---------- Gerüst ----------
    const video = h('video.camera-video', { muted: true, playsInline: true, autoplay: true });
    const view = h('canvas.camera-view', { 'aria-label': 'Live-Bild der Kamera' });
    const vc = view.getContext('2d', { willReadFrequently: true });
    const scratch = document.createElement('canvas');
    const flash = h('div.camera-flash');
    const overlay = h('div');
    const stage = h('div.camera-stage', view, video, flash, overlay);
    const strip = h('div.camera-filters', { role: 'toolbar', 'aria-label': 'Filter' });
    const roll = h('div.camera-roll', { 'aria-label': 'Letzte Aufnahmen' });
    const shutter = h('button.camera-shutter', { type: 'button', 'aria-label': 'Auslösen', title: 'Auslösen (Leertaste)', disabled: true });
    const bTimer = h('button.kit-btn.round', { type: 'button' });
    const bBurst = h('button.kit-btn.round', { type: 'button' });
    const bSwap = toolBtn('reload', 'Kamera wechseln', () => swapCamera());
    bSwap.innerHTML = IC.swap;
    bSwap.hidden = true;
    win.tools.append(bSwap, toolBtn('folder', 'Ordner „Kamera“ öffnen', () => { ensureDir(); sys.openPath(DIR); }));
    win.body.append(h('div.kit-app.camera', stage, strip, h('div.camera-bar', roll, shutter, h('div.camera-opts', bTimer, bBurst))));

    const thumbs = FILTERS.map((f) => {
      const cv = h('canvas', { width: 124, height: 92 });
      const b = h('button', { type: 'button', 'aria-pressed': String(f === filter), onclick: () => setFilter(f) }, cv, h('span', f.name));
      strip.append(b);
      return { f, cv, c: cv.getContext('2d', { willReadFrequently: true }), b, scratch: document.createElement('canvas') };
    });
    function setFilter(f) {
      filter = f;
      S.set('filter', f.id);
      for (const t of thumbs) t.b.setAttribute('aria-pressed', String(t.f === f));
      thumbs.find((t) => t.f === f)?.b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      lastT = -1;
    }
    function paintOpts() {
      bTimer.replaceChildren(h('i', { html: IC.timer, style: { display: 'grid' } }), h('span', timer ? `${timer} s` : 'Aus'));
      bTimer.classList.toggle('is-on', timer > 0);
      bTimer.title = `Selbstauslöser: ${timer ? `${timer} Sekunden` : 'aus'}`;
      bTimer.setAttribute('aria-label', bTimer.title);
      bBurst.replaceChildren(h('i', { html: burst ? IC.strip : IC.single, style: { display: 'grid' } }), h('span', burst ? 'Streifen' : 'Einzelbild'));
      bBurst.classList.toggle('is-on', burst);
      bBurst.title = burst ? 'Serienbild: vier Fotos als Streifen' : 'Einzelbild';
      bBurst.setAttribute('aria-label', bBurst.title);
    }
    bTimer.addEventListener('click', () => { timer = TIMERS[(TIMERS.indexOf(timer) + 1) % TIMERS.length]; S.set('timer', timer); paintOpts(); });
    bBurst.addEventListener('click', () => { burst = !burst; S.set('burst', burst); paintOpts(); });

    // ---------- Zustände ----------
    function message(ico, title, text, retry = true) {
      overlay.replaceChildren(h('div.camera-msg', { role: 'status' }, h('i', { html: ico, style: { display: 'grid' } }), h('b', title), h('p', text),
        retry ? h('button.kit-btn.primary', { type: 'button', onclick: () => start() }, 'Erneut versuchen') : null));
    }
    function setState(s) {
      state = s;
      shutter.disabled = s !== 'live';
      view.style.visibility = s === 'live' ? '' : 'hidden';
      if (s === 'live' || s === 'idle') overlay.replaceChildren();
      else if (s === 'starting') overlay.replaceChildren(h('div.camera-msg', { role: 'status' }, h('div.camera-spin'), h('p', 'Kamera startet …')));
      keepFocus();
    }
    /** Die Tastatur bleibt im Fenster, auch wenn der fokussierte Knopf verschwindet oder gesperrt wird. */
    function keepFocus() {
      const a = document.activeElement;
      if (sys.wm.focused === win && (!a || a === document.body || !a.isConnected || a.disabled)) win.el.focus({ preventScroll: true });
    }
    function explain(err) {
      const name = err?.name || '';
      if (name === 'insecure') message(icon('lock'), 'Hier geht die Kamera nicht', 'Browser geben die Kamera nur auf sicheren Seiten frei. Öffne fableOS über https oder localhost.', false);
      else if (name === 'NotAllowedError' || name === 'SecurityError') message(IC.cam, 'Kein Zugriff auf die Kamera', 'Erlaube den Zugriff über das Kamera-Symbol in der Adressleiste deines Browsers und versuch es dann noch einmal. Deine Bilder bleiben auf diesem Gerät.');
      else if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') message(IC.cam, 'Keine Kamera gefunden', 'An diesem Gerät ist keine Kamera angeschlossen – oder sie ist ausgeschaltet.');
      else if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') message(IC.cam, 'Die Kamera ist gerade belegt', 'Vermutlich benutzt sie eine andere App oder ein anderer Tab. Schließ sie dort und versuch es erneut.');
      else message(IC.cam, 'Die Kamera startet nicht', String(err?.message || err || 'Unbekannter Fehler'));
    }

    // ---------- Stream ----------
    function stopStream() {
      gen++;
      busy?.cancel();
      if (stream) for (const t of stream.getTracks()) t.stop();
      stream = null;
      video.srcObject = null;
      ticker.remove(frame);
    }
    async function start() {
      if (closed) return;
      stopStream();
      const my = gen;
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setState('error'); explain({ name: 'insecure' }); return; }
      setState('starting');
      const want = (id) => ({ audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 }, ...(id ? { deviceId: { exact: id } } : { facingMode: 'user' }) } });
      let s = null;
      try {
        try { s = await navigator.mediaDevices.getUserMedia(want(deviceId)); }
        catch (err) {
          if (!deviceId || (err.name !== 'OverconstrainedError' && err.name !== 'NotFoundError')) throw err;
          deviceId = null;                                   // gemerkte Kamera gibt es nicht mehr
          s = await navigator.mediaDevices.getUserMedia(want(null));
        }
        if (my !== gen || closed || win.min) { for (const t of s.getTracks()) t.stop(); return; }
        stream = s;
        video.srcObject = s;
        await video.play().catch(() => {});
        if (my !== gen) return;
        s.getVideoTracks()[0]?.addEventListener('ended', () => { if (stream === s) { stopStream(); setState('error'); explain({ name: 'NotReadableError' }); } });
        vw = 0;
        lastT = -1;
        setState('live');
        ticker.add(frame);
        listDevices();
      } catch (err) {
        if (my !== gen) return;
        setState('error');
        explain(err);
      }
    }
    async function listDevices() {
      try {
        devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.deviceId);
      } catch { devices = []; }
      if (closed) return;
      bSwap.hidden = devices.length < 2;
      const cur = stream?.getVideoTracks()[0]?.getSettings?.().deviceId;
      if (cur) deviceId = cur;
      const label = devices.find((d) => d.deviceId === deviceId)?.label;
      bSwap.title = label ? `Kamera wechseln (jetzt: ${label})` : 'Kamera wechseln';
    }
    function swapCamera() {
      if (devices.length < 2) return;
      const i = devices.findIndex((d) => d.deviceId === deviceId);
      deviceId = devices[(i + 1) % devices.length].deviceId;
      S.set('device', deviceId);
      start().then(() => { const label = devices.find((d) => d.deviceId === deviceId)?.label; if (label && state === 'live') toast(win, label); });
    }

    // ---------- Bildschleife ----------
    function measure() {
      vw = video.videoWidth;
      vh = video.videoHeight;
      if (!vw || !vh) return false;
      const k = Math.min(1, 960 / vw);
      W = view.width = Math.round(vw * k);
      H = view.height = Math.round(vh * k);
      view.style.aspectRatio = `${vw} / ${vh}`;
      return true;
    }
    function frame() {
      if (state !== 'live' || win.min || video.readyState < 2) return;
      if (video.currentTime === lastT && lastT >= 0) return;
      if ((video.videoWidth !== vw || video.videoHeight !== vh) && !measure()) return;
      lastT = video.currentTime;
      paintFrame(vc, W, H, video, [0, 0, vw, vh], filter, scratch);
      if (frames++ % 6 === 0) {
        // Miniaturen: mittiger 4:3-Ausschnitt
        const sw = Math.min(vw, vh * (124 / 92)), sh = sw * (92 / 124);
        const crop = [(vw - sw) / 2, (vh - sh) / 2, sw, sh];
        for (const t of thumbs) paintFrame(t.c, 124, 92, video, crop, t.f, t.scratch, 22);
      }
    }

    // ---------- Aufnehmen ----------
    function ensureDir() {
      if (!vfs.exists(PICS)) vfs.mkdir(PICS);
      if (!vfs.exists(DIR)) vfs.mkdir(DIR);
    }
    function grab(maxEdge) {
      const k = Math.min(1, maxEdge / Math.max(vw, vh));
      const cv = document.createElement('canvas');
      cv.width = Math.round(vw * k);
      cv.height = Math.round(vh * k);
      paintFrame(cv.getContext('2d', { willReadFrequently: true }), cv.width, cv.height, video, [0, 0, vw, vh], filter, document.createElement('canvas'));
      return cv;
    }
    function save(cv, prefix) {
      ensureDir();
      const path = `${DIR}/${vfs.unique(DIR, `${prefix} ${stamp()}.jpg`)}`;
      vfs.write(path, cv.toDataURL('image/jpeg', 0.88), 'image/jpeg');
      newest = path;
      return path;
    }
    function click() {
      if (!reducedMotion.matches) flash.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 420, easing: 'cubic-bezier(.2, .7, .3, 1)' });
      if (settings.sounds) {
        try {
          tone({ type: 'square', f: 2400, f2: 900, dur: 0.028, vol: 0.05 });
          tone({ type: 'triangle', f: 340, f2: 170, dur: 0.07, vol: 0.08, when: 0.045 });
        } catch { /* ohne Ton */ }
      }
    }
    const beep = (last) => { if (settings.sounds) { try { tone({ f: last ? 1320 : 880, dur: 0.09, vol: 0.07 }); } catch { /* ohne Ton */ } } };
    /** Wartet ms; wird die Aufnahme abgebrochen, endet das Warten mit false. */
    const wait = (ms, job) => new Promise((resolve) => {
      const id = setTimeout(() => { job.wake = null; resolve(true); }, ms);
      job.wake = () => { clearTimeout(id); resolve(false); };
    });

    async function shoot() {
      if (state !== 'live') return;
      if (busy) { busy.cancel(); return; }
      const job = { off: false, wake: null, cancel() { this.off = true; this.wake?.(); } };
      busy = job;
      shutter.classList.add('is-busy');
      shutter.setAttribute('aria-label', 'Abbrechen');
      try {
        for (let n = timer; n > 0; n--) {
          overlay.replaceChildren(h('div.camera-count', { 'aria-live': 'assertive' }, h('b', String(n))));
          beep(n === 1);
          if (!(await wait(1000, job))) return;
        }
        overlay.replaceChildren();
        if (!burst) {
          click();
          save(grab(1280), 'Foto');
          return;
        }
        // Serienbild: vier Aufnahmen, zusammengesetzt zu einem Streifen wie aus dem Fotoautomaten
        const shots = [];
        const badge = h('div.camera-badge');
        overlay.replaceChildren(badge);
        for (let i = 0; i < 4; i++) {
          badge.textContent = `${i + 1} von 4`;
          if (i && !(await wait(650, job))) return;
          click();
          shots.push(grab(520));
        }
        const fw = shots[0].width, fh = shots[0].height, m = 22, gap = 14, foot = 54;
        const cv = document.createElement('canvas');
        cv.width = fw + m * 2;
        cv.height = m + 4 * fh + 3 * gap + foot;
        const c = cv.getContext('2d');
        c.fillStyle = '#fbfaf6';
        c.fillRect(0, 0, cv.width, cv.height);
        shots.forEach((s, i) => c.drawImage(s, m, m + i * (fh + gap)));
        c.fillStyle = '#8a8fa3';
        c.font = '600 17px ui-rounded, -apple-system, "Segoe UI", sans-serif';
        c.textAlign = 'center';
        c.fillText(new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }), cv.width / 2, cv.height - foot / 2 + 4);
        save(cv, 'Streifen');
        toast(win, 'Streifen gesichert');
      } catch (err) {
        toast(win, `Das Foto ließ sich nicht sichern: ${err?.message || err}`);
      } finally {
        if (busy === job) busy = null;
        shutter.classList.remove('is-busy');
        shutter.setAttribute('aria-label', 'Auslösen');
        if (state === 'live') overlay.replaceChildren();
      }
    }
    shutter.addEventListener('click', shoot);

    // ---------- Filmstreifen der letzten Aufnahmen ----------
    function paintRoll() {
      let list = [];
      try { list = vfs.list(DIR).filter((s) => s.type === 'file' && ['jpg', 'jpeg', 'png', 'webp'].includes(extname(s.path))).sort((a, b) => b.mtime - a.mtime); } catch { /* Ordner gibt es noch nicht */ }
      if (!list.length) { roll.replaceChildren(h('span', 'Noch keine Aufnahmen')); return; }
      roll.replaceChildren(...list.slice(0, 5).map((st) => {
        const b = h('button', { type: 'button', title: st.name, 'aria-label': `${st.name} öffnen`, class: st.path === newest ? 'is-new' : '', onclick: () => sys.openPath(st.path) },
          h('img', { alt: '', decoding: 'async', draggable: false }));
        try { b.firstChild.src = vfs.read(st.path); } catch { /* weg */ }
        return b;
      }));
      newest = null;
    }
    const offFs = bus.on('fs', debounce((p) => { if (!closed && (p === '/' || String(p).startsWith(PICS) || String(p).includes('Papierkorb'))) paintRoll(); }, 60));

    // Beim Minimieren Kamera freigeben, beim Zurückholen wieder starten
    let wasMin = false;
    const offWm = bus.on('wm', () => {
      if (closed || win.min === wasMin) return;
      wasMin = win.min;
      if (win.min) { stopStream(); setState('idle'); } else start();
    });
    const onDevices = () => { if (state === 'live') listDevices(); };
    navigator.mediaDevices?.addEventListener?.('devicechange', onDevices);

    // ---------- Tastatur ----------
    const onKey = (e) => {
      if (e.target.closest('input, textarea, select') || e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key === ' ' || (e.key === 'Enter' && !e.target.closest('button'))) { e.preventDefault(); shoot(); }
      else if (e.key === 'Escape' && busy) { e.preventDefault(); busy.cancel(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const i = FILTERS.indexOf(filter) + (e.key === 'ArrowRight' ? 1 : -1);
        setFilter(FILTERS[(i + FILTERS.length) % FILTERS.length]);
      } else if (e.key === 't' || e.key === 'T') bTimer.click();
      else if (e.key === 's' || e.key === 'S') bBurst.click();
    };
    const onKeyUp = (e) => { if (e.key === ' ' && e.target.closest('button')) e.preventDefault(); };
    win.el.addEventListener('keydown', onKey);
    win.el.addEventListener('keyup', onKeyUp);

    paintOpts();
    paintRoll();
    start();

    return {
      onClose() {
        closed = true;
        stopStream();
        offFs();
        offWm();
        navigator.mediaDevices?.removeEventListener?.('devicechange', onDevices);
        win.el.removeEventListener('keydown', onKey);
        win.el.removeEventListener('keyup', onKeyUp);
      },
      onFocus() { if (!win.el.contains(document.activeElement)) (shutter.disabled ? win.el : shutter).focus({ preventScroll: true }); },
      menus: () => [{
        label: 'Kamera',
        items: [
          { label: busy ? 'Abbrechen' : 'Auslösen', hint: 'Leertaste', disabled: state !== 'live', run: shoot },
          '-',
          { heading: 'Selbstauslöser' },
          ...TIMERS.map((t) => ({ label: t ? `${t} Sekunden` : 'Aus', checked: timer === t, run: () => { timer = t; S.set('timer', t); paintOpts(); } })),
          '-',
          { label: 'Serienbild als Streifen', checked: burst, hint: 'S', run: () => bBurst.click() },
          { heading: 'Filter' },
          ...FILTERS.map((f) => ({ label: f.name, checked: f === filter, run: () => setFilter(f) })),
          '-',
          { label: 'Kamera wechseln', disabled: devices.length < 2, run: swapCamera },
          { label: 'Ordner „Kamera“ öffnen', icon: 'folder', run: () => { try { ensureDir(); sys.openPath(DIR); } catch { /* Ordner lässt sich nicht anlegen */ } } },
        ],
      }],
    };
  },
};
