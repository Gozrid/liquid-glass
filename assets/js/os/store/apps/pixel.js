// pixel.js — Pixel: Pixel-Art-Editor mit Ebenen, Einzelbild-Animation, PNG- und Sprite-Sheet-Export
import { h, clamp, debounce, drag } from '../../../core/util.js';
import { icon } from '../../../core/icons.js';
import { initControls } from '../../../core/controls.js';
import { sys } from '../../sys.js';
import { vfs, HOME, basename, dirname, extname } from '../../vfs.js';
import { openMenu } from '../../ui.js';
import { style, appStore, toast, sheet, confirmSheet, promptSheet, openDialog, saveDialog, download } from '../../kit.js';

const db = appStore('pixel');
const SIZES = [16, 24, 32, 48, 64];
const ZOOMS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64];
const MAX_UNDO = 64;
const MAX_LAYERS = 12;
const MAX_FRAMES = 32;

// Kuratierte Standardpalette: Grautöne · warme Töne · Grün/Türkis · Blau/Violett/Rosa
const PALETTE = [
  '#14121f', '#2b2a3d', '#4a4b63', '#73758c', '#a3a7b8', '#cfd3dd', '#f1f2f6', '#ffffff',
  '#5a1a2b', '#a02a3a', '#e0484a', '#f5814f', '#fbb954', '#fde68a', '#8b4a2f', '#c9834f',
  '#17352f', '#1f6b4a', '#3aa655', '#8bd450', '#d4f078', '#1d5c6b', '#2aa5a0', '#7fe0c8',
  '#1d2a5e', '#2f54c0', '#4b93f0', '#8fd3ff', '#4a2a7a', '#8b4fd6', '#d67be8', '#ff9ec4',
];

let live = 0;            // offene Pixel-Fenster
let clipboard = null;    // {w, h, x, y, data} – gilt für alle Fenster
let seq = 0;
const uid = () => ++seq;

// ==========================================================================
// Symbole (24er-Raster, Linien)
// ==========================================================================
const svg = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const IC = {
  pen: svg('<path d="M4.500 19.500l1-4.600L16.200 4.200a2 2 0 0 1 2.800 0l.800.800a2 2 0 0 1 0 2.800L9.100 18.500z"/><path d="M14 6.500l3.500 3.500"/>'),
  fill: svg('<path d="M4.800 12.700l7.400-7.400 7.200 7.200-6.200 6.200a2.400 2.400 0 0 1-3.400 0l-5-5a.700.700 0 0 1 0-1z"/><path d="M10.200 3.200l2 2.100"/><path d="M20.200 15.500s1.600 2.100 1.600 3.300a1.600 1.600 0 0 1-3.200 0c0-1.200 1.600-3.300 1.600-3.300z" fill="currentColor" stroke="none"/>'),
  pick: svg('<path d="M13.300 6.700l4 4"/><path d="M14.800 5.200l1.300-1.300a2.300 2.300 0 0 1 3.300 0l.700.700a2.300 2.300 0 0 1 0 3.300l-1.300 1.300"/><path d="M14.300 7.700l-8.500 8.500-1.300 3.300 3.300-1.300 8.500-8.500"/>'),
  line: svg('<path d="M6 18L18 6"/><circle cx="5" cy="19" r="1.800" fill="currentColor" stroke="none"/><circle cx="19" cy="5" r="1.800" fill="currentColor" stroke="none"/>'),
  rect: svg('<rect x="4.500" y="6" width="15" height="12" rx="1.500"/>'),
  oval: svg('<ellipse cx="12" cy="12" rx="8" ry="6.200"/>'),
  move: svg('<path d="M4.500 8.500V6A1.500 1.500 0 0 1 6 4.500h2.500M11.500 4.500h2.500M17 4.500h1A1.500 1.500 0 0 1 19.500 6v2.500M4.500 11.500v2.500M4.500 17v1A1.500 1.500 0 0 0 6 19.500h2.500"/><path d="M11.500 11.500l9 3.400-3.800 1.400-1.400 3.800z" fill="currentColor" stroke="none"/>'),
  solid: svg('<rect x="4.500" y="5.500" width="15" height="13" rx="2.500" fill="currentColor"/>'),
  mirX: svg('<path d="M12 3.500v17" stroke-dasharray="2 2.600"/><path d="M8.800 7.500v9l-5.300-4.500z"/><path d="M15.200 7.500v9l5.300-4.500z"/>'),
  mirY: svg('<path d="M3.500 12h17" stroke-dasharray="2 2.600"/><path d="M7.500 8.800h9L12 3.500z"/><path d="M7.500 15.200h9l-4.500 5.300z"/>'),
  eye: svg('<path d="M2.500 12s3.500-6.500 9.500-6.500 9.500 6.500 9.500 6.500-3.500 6.500-9.500 6.500S2.500 12 2.500 12z"/><circle cx="12" cy="12" r="2.800"/>'),
  eyeOff: svg('<path d="M4.500 4.500l15 15"/><path d="M9.800 5.800a9.500 9.500 0 0 1 2.200-.300c6 0 9.500 6.500 9.500 6.500a17 17 0 0 1-2.700 3.500M6.300 7.600A16 16 0 0 0 2.500 12s3.500 6.500 9.500 6.500a9.300 9.300 0 0 0 3.800-.800"/>'),
  merge: svg('<path d="M12 3.500v9.500M8 9l4 4 4-4"/><path d="M5 17h14M5 20.500h14"/>'),
  save: svg('<path d="M6 4h10l4 4v10.500A1.500 1.500 0 0 1 18.500 20h-13A1.500 1.500 0 0 1 4 18.500v-13A1.500 1.500 0 0 1 5.500 4z"/><path d="M8 4v4.500h6.500V4M7.500 20v-6h9v6"/>'),
  up: svg('<path d="M6 15l6-6 6 6"/>'),
  swap: svg('<path d="M5 8h13M14.500 4.500L18 8l-3.500 3.500M19 16H6M9.500 12.500L6 16l3.500 3.500"/>'),
  side: svg('<rect x="3.500" y="5" width="17" height="14" rx="2.800"/><path d="M14.500 5v14"/>'),
};
const tb = (html, label, onclick, cls = '') => h(`button.tool${cls}`, { type: 'button', 'aria-label': label, title: label, html, onclick });

const TOOLS = [
  ['pen', 'Stift', 'B', IC.pen],
  ['erase', 'Radierer', 'E', icon('eraser')],
  ['fill', 'Füllen', 'G', IC.fill],
  ['pick', 'Pipette', 'I', IC.pick],
  ['line', 'Linie', 'L', IC.line],
  ['rect', 'Rechteck', 'R', IC.rect],
  ['oval', 'Ellipse', 'O', IC.oval],
  ['move', 'Auswahl verschieben', 'M', IC.move],
];

// ==========================================================================
// Farben
// ==========================================================================
const hex2 = (v) => v.toString(16).padStart(2, '0');
const rgbHex = (r, g, b) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
function hexRgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const s = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  const v = parseInt(s, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function rgbHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  let hue = 0;
  if (d) {
    if (mx === r) hue = ((g - b) / d) % 6;
    else if (mx === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return [hue, mx ? d / mx : 0, mx];
}
function hsvRgb(hue, s, v) {
  const f = (k) => {
    const x = (k + hue / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(x, 4 - x, 1))));
  };
  return [f(5), f(3), f(1)];
}
const inkFor = (hex) => { const [r, g, b] = hexRgb(hex) || [0, 0, 0]; return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#14121f' : '#ffffff'; };

// ==========================================================================
// Pixel-Rechnerei: jede Ebene eines Einzelbilds ist ein Uint8ClampedArray (RGBA, nicht vormultipliziert)
// ==========================================================================
/** Farbe (r, g, b, a) über den Pixel bei Index i legen. */
function over(d, i, r, g, b, a) {
  if (a <= 0) return;
  const da = d[i + 3];
  if (a >= 255 || da === 0) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a; return; }
  const sa = a / 255, ra = (da / 255) * (1 - sa), oa = sa + ra;
  d[i] = Math.round((r * sa + d[i] * ra) / oa);
  d[i + 1] = Math.round((g * sa + d[i + 1] * ra) / oa);
  d[i + 2] = Math.round((b * sa + d[i + 2] * ra) / oa);
  d[i + 3] = Math.round(oa * 255);
}

/** Sichtbare Ebenen eines Einzelbilds von unten nach oben zusammensetzen. */
function compose(doc, frame, out) {
  out.fill(0);
  for (let l = 0; l < doc.layers.length; l++) {
    if (!doc.layers[l].visible) continue;
    const src = frame.cels[l];
    for (let i = 0; i < src.length; i += 4) if (src[i + 3]) over(out, i, src[i], src[i + 1], src[i + 2], src[i + 3]);
  }
  return out;
}

function line(x0, y0, x1, y1, put) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    put(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
function rect(ax, ay, bx, by, fill, put) {
  for (let y = ay; y <= by; y++) {
    if (fill || y === ay || y === by) for (let x = ax; x <= bx; x++) put(x, y);
    else { put(ax, y); put(bx, y); }
  }
}
/** Ellipse, die das Rechteck (ax, ay)–(bx, by) genau ausfüllt (Bresenham-Variante für gerade und ungerade Maße). */
function oval(ax, ay, bx, by, fill, put) {
  if (bx - ax < 2 || by - ay < 2) { rect(ax, ay, bx, by, true, put); return; }
  const rows = new Map();
  const mark = (x, y) => {
    const r = rows.get(y);
    if (!r) rows.set(y, [x, x]); else { if (x < r[0]) r[0] = x; if (x > r[1]) r[1] = x; }
    if (!fill) put(x, y);
  };
  let x0 = ax, x1 = bx, y0 = ay, y1;
  let a = bx - ax;
  const b = by - ay;
  let b1 = b & 1;
  let dx = 4 * (1 - a) * b * b, dy = 4 * (b1 + 1) * a * a;
  let err = dx + dy + b1 * a * a;
  y0 += (b + 1) >> 1;
  y1 = y0 - b1;
  a = 8 * a * a;
  b1 = 8 * b * b;
  do {
    mark(x1, y0); mark(x0, y0); mark(x0, y1); mark(x1, y1);
    const e2 = 2 * err;
    if (e2 <= dy) { y0++; y1--; err += dy += a; }
    if (e2 >= dx || 2 * err > dy) { x0++; x1--; err += dx += b1; }
  } while (x0 <= x1);
  while (y0 - y1 < b) {
    mark(x0 - 1, y0); mark(x1 + 1, y0++);
    mark(x0 - 1, y1); mark(x1 + 1, y1--);
  }
  if (fill) for (const [y, [l, r]] of rows) for (let x = l; x <= r; x++) put(x, y);
}

const u32 = (px) => new Uint32Array(px.buffer, px.byteOffset, px.length >> 2);
function flipH(px, n) {
  const u = u32(px);
  for (let y = 0; y < n; y++) for (let x = 0; x < n >> 1; x++) { const a = y * n + x, b = y * n + n - 1 - x, t = u[a]; u[a] = u[b]; u[b] = t; }
}
function flipV(px, n) {
  const u = u32(px);
  for (let y = 0; y < n >> 1; y++) for (let x = 0; x < n; x++) { const a = y * n + x, b = (n - 1 - y) * n + x, t = u[a]; u[a] = u[b]; u[b] = t; }
}
function rotate(px, n, cw) {
  const u = u32(px), s = u.slice();
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (cw) u[x * n + (n - 1 - y)] = s[y * n + x]; else u[(n - 1 - x) * n + y] = s[y * n + x];
  }
}
function shiftPx(px, n, dx, dy) {
  const u = u32(px), s = u.slice();
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) u[((y + dy + n) % n) * n + ((x + dx + n) % n)] = s[y * n + x];
}

// ==========================================================================
// Dateiformat .pixel.json: Ebenen lauflängenkodiert (1 Byte Länge + RGBA), dann Base64
// ==========================================================================
function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function encodeCel(px) {
  const u = u32(px);
  const out = new Uint8Array(u.length * 5);
  let o = 0;
  for (let i = 0; i < u.length;) {
    const v = u[i];
    let run = 1;
    while (run < 255 && i + run < u.length && u[i + run] === v) run++;
    const k = i * 4;
    out[o++] = run; out[o++] = px[k]; out[o++] = px[k + 1]; out[o++] = px[k + 2]; out[o++] = px[k + 3];
    i += run;
  }
  return o < px.length ? `r${b64(out.subarray(0, o))}` : `w${b64(px)}`;
}
function decodeCel(str, n) {
  const px = new Uint8ClampedArray(n * n * 4);
  if (typeof str !== 'string' || !str) return px;
  const bytes = unb64(str.slice(1));
  if (str[0] === 'w') {
    if (bytes.length !== px.length) throw new Error('Die Datei ist beschädigt.');
    px.set(bytes);
    return px;
  }
  let p = 0;
  for (let i = 0; i + 4 < bytes.length; i += 5) {
    for (let k = bytes[i]; k > 0 && p < px.length; k--, p += 4) { px[p] = bytes[i + 1]; px[p + 1] = bytes[i + 2]; px[p + 2] = bytes[i + 3]; px[p + 3] = bytes[i + 4]; }
  }
  if (p !== px.length) throw new Error('Die Datei ist beschädigt.');
  return px;
}
const serialize = (doc) => ({
  format: 'fableos-pixel', version: 1, size: doc.size, fps: doc.fps,
  layers: doc.layers.map((l) => ({ name: l.name, visible: l.visible })),
  frames: doc.frames.map((f) => ({ cels: f.cels.map(encodeCel) })),
});
function deserialize(o) {
  if (!o || o.format !== 'fableos-pixel') throw new Error('Das ist keine Pixel-Projektdatei.');
  const n = Number(o.size) | 0;
  if (n < 1 || n > 64 || !Array.isArray(o.layers) || !Array.isArray(o.frames) || !o.layers.length || !o.frames.length) throw new Error('Die Datei ist beschädigt.');
  const layers = o.layers.slice(0, MAX_LAYERS).map((l, i) => ({ id: uid(), name: String(l?.name || `Ebene ${i + 1}`).slice(0, 40), visible: l?.visible !== false }));
  let frames;
  try {
    frames = o.frames.slice(0, MAX_FRAMES).map((f) => ({ id: uid(), cels: layers.map((_, i) => decodeCel(f?.cels?.[i], n)) }));
  } catch { throw new Error('Die Datei ist beschädigt.'); }
  return { size: n, fps: clamp(Number(o.fps) | 0 || 8, 1, 24), layers, frames };
}
const blank = (n) => ({ size: n, fps: 8, layers: [{ id: uid(), name: 'Ebene 1', visible: true }], frames: [{ id: uid(), cels: [new Uint8ClampedArray(n * n * 4)] }] });

/** Beispielmotiv für den ersten Start: ein Keimling im Topf, der sich in zwei Bildern wiegt. */
function sample() {
  const n = 16;
  const ink = { l: '#8bd450', g: '#3aa655', G: '#1f6b4a', o: '#f5814f', y: '#fbb954', t: '#c9834f', s: '#8b4a2f' };
  const draw = (rows) => {
    const px = new Uint8ClampedArray(n * n * 4);
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      const c = ink[ch] && hexRgb(ink[ch]);
      if (c) px.set([c[0], c[1], c[2], 255], (y * n + x) * 4);
    }));
    return px;
  };
  const e = '................';
  const pot = [e, e, e, e, e, e, e, e, e,
    '..oooooooooooo..',
    '..oyyoooooooos..',
    '...tyttttttts...',
    '...tyttttttss...',
    '....ttttttts....',
    '....tttttsss....',
    e];
  const plant = [e,
    '.....ll.........',
    '....lggl...ll...',
    '....lgGgl.lggl..',
    '.....gGgglgGgl..',
    '......gGggGgg...',
    '.......gGGgg....',
    '........GG......',
    '........GG......',
    e, e, e, e, e, e, e];
  const sway = plant.map((row, y) => (y >= 1 && y <= 3 ? `.${row.slice(0, n - 1)}` : row));
  return {
    size: n, fps: 3,
    layers: [{ id: uid(), name: 'Topf', visible: true }, { id: uid(), name: 'Pflanze', visible: true }],
    frames: [{ id: uid(), cels: [draw(pot), draw(plant)] }, { id: uid(), cels: [draw(pot), draw(sway)] }],
  };
}

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Das Bild lässt sich nicht lesen.'));
  img.src = src;
});
const stem = (file) => basename(file).replace(/\.pixel\.json$/i, '').replace(/\.[a-z0-9]+$/i, '') || 'Unbenannt';

// ==========================================================================
// Stile
// ==========================================================================
style('pixel', `
.pixel {
  display: grid; grid-template: auto minmax(0, 1fr) auto / auto minmax(0, 1fr) auto; flex: 1; min-width: 0; min-height: 0;
  --ck1: color-mix(in srgb, var(--fg) 17%, var(--solid)); --ck2: color-mix(in srgb, var(--fg) 8%, var(--solid));
  --gl: color-mix(in srgb, var(--fg) 22%, transparent);
  --ck: conic-gradient(var(--ck1) 25%, var(--ck2) 0 50%, var(--ck1) 0 75%, var(--ck2) 0);
}
[data-theme="light"] .pixel { --ck1: #fff; --ck2: color-mix(in srgb, var(--fg) 10%, #fff); --gl: color-mix(in srgb, var(--fg) 26%, transparent); }
.pixel hr { flex: none; width: 1px; height: 18px; margin: 0 5px; border: 0; background: var(--line); }
.pixel-bar { grid-column: 1 / -1; gap: 2px; }
.pixel-pos { flex: none; min-width: 46px; margin-right: 4px; font: 500 11.5px var(--mono); color: var(--fg-3); text-align: right; white-space: nowrap; }
.pixel-zoom { flex: none; min-width: 58px; padding: 5px 4px; border: 0; border-radius: 8px; background: none; font-size: 12px; font-weight: 650; font-variant-numeric: tabular-nums; color: var(--fg-2); }
.pixel-zoom:hover { background: var(--raise); color: var(--fg); }

.pixel-tools { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 7px; border-right: .5px solid var(--line); overflow: hidden auto; scrollbar-width: none; }
.pixel-tools .tool { width: 30px; height: 30px; }
.pixel-tools .sp { flex: 1; min-height: 6px; }
.pixel-duo { position: relative; flex: none; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 8px; background: none; }
.pixel-duo i { position: absolute; width: 18px; height: 18px; border-radius: 6px; box-shadow: 0 0 0 1.5px var(--solid), 0 0 0 2.5px var(--fg-4); }
.pixel-duo i:first-child { right: 2px; bottom: 2px; background: var(--b); }
.pixel-duo i:last-child { left: 2px; top: 2px; background: var(--a); }

.pixel-stage { position: relative; background: var(--well); cursor: crosshair; touch-action: none; outline: 0; }
.pixel-stage.is-pan { cursor: grab; }
.pixel-stage.is-panning { cursor: grabbing; }
.pixel-stage-in { display: grid; place-items: center; box-sizing: border-box; min-width: 100%; min-height: 100%; width: max-content; height: max-content; padding: 24px; }
.pixel-paper {
  position: relative; flex: none; width: calc(var(--n) * var(--z) * 1px); height: calc(var(--n) * var(--z) * 1px);
  background: var(--ck) 0 0 / 25% 25%;
  box-shadow: 0 0 0 1px var(--fg-4), 0 16px 36px -16px rgba(0, 0, 14, .6);
}
.pixel-paper canvas { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; pointer-events: none; }
.pixel-onion { opacity: .42; }
.pixel-grid {
  position: absolute; inset: 0; pointer-events: none;
  background-image: linear-gradient(to right, var(--gl) 1px, transparent 1px), linear-gradient(to bottom, var(--gl) 1px, transparent 1px);
  background-size: calc(var(--z) * 1px) calc(var(--z) * 1px);
}
.pixel-axis { position: absolute; pointer-events: none; background: var(--accent); opacity: .85; }
.pixel-axis.x { left: calc(50% - 1px); top: -8px; bottom: -8px; width: 2px; }
.pixel-axis.y { top: calc(50% - 1px); left: -8px; right: -8px; height: 2px; }
.pixel-hover { position: absolute; left: 0; top: 0; width: calc(var(--z) * 1px); height: calc(var(--z) * 1px); pointer-events: none; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .95), 0 0 0 1px rgba(0, 0, 14, .7); }
.pixel-sel { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; max-width: none; }
.pixel-sel rect { fill: none; stroke-width: 1; shape-rendering: crispEdges; }
.pixel-sel .k { stroke: rgba(0, 0, 14, .8); }
.pixel-sel .w { stroke: #fff; stroke-dasharray: 4 4; animation: pixel-ants .7s linear infinite; }
@keyframes pixel-ants { to { stroke-dashoffset: -8; } }

.pixel-side { display: flex; flex-direction: column; gap: 12px; width: 208px; padding: 12px; border-left: .5px solid var(--line); }
.pixel-sec { display: grid; gap: 8px; flex: none; }
.pixel-sec > header { display: flex; align-items: center; justify-content: space-between; min-height: 18px; font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--fg-3); }
.pixel-cur { display: flex; align-items: center; gap: 4px; }
.pixel-sw { flex: 1; min-width: 0; height: 32px; padding: 0 0 3px 7px; border: 0; border-radius: 9px; background: var(--c); color: var(--ink); box-shadow: inset 0 0 0 1px rgba(128, 128, 150, .35); font: 600 10px/1 var(--mono); text-align: left; display: flex; align-items: flex-end; transition: transform .4s var(--spring); }
.pixel-sw:active { transform: scale(.95); }
.pixel-sw.is-on { box-shadow: inset 0 0 0 1px rgba(128, 128, 150, .35), 0 0 0 2px var(--solid), 0 0 0 4px var(--accent); }
.pixel-mix { display: grid; gap: 8px; padding: 8px; border-radius: 11px; background: var(--raise); }
.pixel-sv { position: relative; height: 96px; border-radius: 8px; background: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(var(--h) 100% 50%)); box-shadow: inset 0 0 0 1px var(--line); cursor: crosshair; touch-action: none; }
.pixel-sv i { position: absolute; left: calc(var(--s) * 100%); top: calc((1 - var(--v)) * 100%); width: 12px; height: 12px; margin: -6px; border-radius: 50%; box-shadow: 0 0 0 2px #fff, 0 0 0 3px rgba(0, 0, 14, .5), inset 0 0 0 1px rgba(0, 0, 14, .4); pointer-events: none; }
.pixel-hue { position: relative; height: 12px; margin: 0 4px; border-radius: 9px; background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); cursor: pointer; touch-action: none; }
.pixel-hue i { position: absolute; top: 50%; left: calc(var(--h) / 360 * 100%); width: 8px; height: 18px; margin: -9px -4px; border-radius: 4px; background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 14, .5), inset 0 0 0 1px rgba(0, 0, 14, .25); pointer-events: none; }
.pixel-sv:focus-visible, .pixel-hue:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.pixel-mix-row { display: flex; gap: 6px; }
.pixel-mix-row .kit-field { flex: 1; width: 0; padding: 5px 8px; font-size: 12px; }
.pixel-mix-row .kit-btn { padding: 5px 9px; font-size: 12px; }
.pixel-pal { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 3px; }
.pixel-chip { position: relative; aspect-ratio: 1; min-width: 0; padding: 0; border: 0; border-radius: 5px; background: var(--c); box-shadow: inset 0 0 0 1px rgba(128, 128, 150, .3); transition: transform .35s var(--spring); }
.pixel-chip:hover { transform: scale(1.2); z-index: 1; }
.pixel-chip.is-a { box-shadow: 0 0 0 1.5px var(--solid), 0 0 0 3px var(--fg); z-index: 1; }
.pixel-chip.add { display: grid; place-items: center; background: var(--raise); color: var(--fg-3); box-shadow: inset 0 0 0 1px var(--line); }
.pixel-chip.add .ico { width: 11px; height: 11px; stroke-width: 2.4; }
span.pixel-chip.add { background: none; box-shadow: none; }
span.pixel-chip.add .ico { width: 13px; height: 13px; stroke-width: 1.8; }
span.pixel-chip.add:hover { transform: none; }
.pixel-opa { display: flex; align-items: center; gap: 8px; color: var(--fg-3); }
.pixel-opa > span { display: grid; flex: none; }
.pixel-opa .ico { width: 15px; height: 15px; }
.pixel-opa .gslider { flex: 1; min-width: 0; }
.pixel-opa output { flex: none; min-width: 40px; font-size: 11.5px; font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; color: var(--fg-2); }

.pixel-prev { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 8px; }
.pixel-prev > div { position: relative; display: grid; place-items: center; height: 100px; border-radius: 10px; background: var(--ck) 0 0 / 16px 16px; box-shadow: inset 0 0 0 1px var(--line); overflow: hidden; }
.pixel-prev canvas { image-rendering: pixelated; }

.pixel-layers { display: grid; gap: 2px; }
.pixel-layer { display: flex; align-items: center; gap: 2px; min-width: 0; padding: 2px; border-radius: 10px; }
.pixel-layer:hover { background: var(--raise); }
.pixel-layer.is-on { background: var(--raise-2); }
.pixel-layer .tool { width: 26px; height: 26px; }
.pixel-layer .tool .ico { width: 15px; height: 15px; }
.pixel-layer-main { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; padding: 2px 6px 2px 2px; border: 0; border-radius: 8px; background: none; text-align: left; }
.pixel-layer-main canvas { flex: none; width: 26px; height: 26px; border-radius: 5px; background: var(--ck) 0 0 / 8px 8px; box-shadow: 0 0 0 1px var(--line); image-rendering: pixelated; }
.pixel-layer-main span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; font-weight: 550; }
.pixel-layer.is-off .pixel-layer-main { opacity: .45; }
.pixel-ops { display: flex; gap: 1px; margin: -4px -4px -4px 0; }
.pixel-ops .tool { width: 24px; height: 24px; border-radius: 7px; }
.pixel-ops .tool .ico { width: 14px; height: 14px; }

.pixel-frames { grid-column: 1 / -1; display: flex; align-items: center; gap: 2px; min-width: 0; padding: 7px 10px; border-top: .5px solid var(--line); }
.pixel-fps { flex: none; min-width: 48px; font-size: 12px; font-weight: 650; font-variant-numeric: tabular-nums; text-align: center; color: var(--fg-2); }
.pixel-strip { display: flex; gap: 7px; flex: 1; min-width: 0; padding: 3px; overflow: auto hidden; scrollbar-width: none; }
.pixel-frame { position: relative; flex: none; width: 46px; height: 46px; padding: 0; border: 0; border-radius: 9px; background: var(--ck) 0 0 / 12px 12px; box-shadow: 0 0 0 1px var(--line); overflow: hidden; transition: transform .4s var(--spring); }
.pixel-frame:active { transform: scale(.93); }
.pixel-frame canvas { width: 100%; height: 100%; image-rendering: pixelated; }
.pixel-frame b { position: absolute; left: 3px; bottom: 3px; min-width: 14px; padding: 0 4px; border-radius: 5px; background: color-mix(in srgb, var(--solid) 84%, transparent); font-size: 10px; font-weight: 700; line-height: 14px; text-align: center; }
.pixel-frame.is-on { box-shadow: 0 0 0 2.5px var(--accent); }
.pixel-frame.is-play::after { content: ""; position: absolute; inset: 0; border-radius: inherit; box-shadow: inset 0 0 0 2.5px var(--c-mint); }
.pixel-dlg { display: grid; gap: 12px; }
.pixel-dlg .gseg { display: flex; }
.pixel-dlg-row { display: flex; align-items: center; gap: 10px; font-size: 12.5px; font-weight: 600; color: var(--fg-2); }
.pixel-dlg-row .gslider { flex: 1; }
.pixel-dlg-row output { min-width: 34px; text-align: right; font-variant-numeric: tabular-nums; }
.pixel-dlg p { font-size: 12.5px; color: var(--fg-3); }
@container win (max-width: 700px) { .pixel-pos { display: none; } }
`);

// ==========================================================================
// App
// ==========================================================================
export default {
  width: 980, height: 700, minW: 540, minH: 460,

  mount(win, args = {}) {
    live++;
    const solo = live === 1;

    // ---------- Zustand ----------
    let doc = null;                 // {size, fps, layers: [{id, name, visible}], frames: [{id, cels: [Uint8ClampedArray]}]}
    let n = 32;                     // Kantenlänge der Leinwand
    let fi = 0;                     // aktuelles Einzelbild
    let li = 0;                     // aktuelle Ebene (0 = unterste)
    let name = 'Unbenannt';
    let path = null;
    let dirty = false;
    let comp = null;                // zusammengesetztes aktuelles Bild
    let tmp = null;                 // Puffer für Vorschau, Zwiebelhaut, Miniaturen
    const undo = [];
    const redo = [];
    let heldRedo = [];
    const owned = new Set();        // Ebenen-Puffer, die seit dem letzten Schnappschuss kopiert wurden
    let tool = 'pen';
    const stored = db.get('colors', null);
    const colors = Array.isArray(stored) && stored.length === 2 && stored.every((c) => hexRgb(c)) ? stored.slice() : ['#14121f', '#ffffff'];
    let custom = (db.get('custom', []) || []).filter((c) => hexRgb(c)).slice(0, 15);
    let recent = (db.get('recent', []) || []).filter((c) => hexRgb(c)).slice(0, 8);
    let target = 0;                 // welche Farbe der Mischer bearbeitet
    let mixOpen = false;
    let hsv = rgbHsv(...hexRgb(colors[0]));
    let alpha = 100;
    let filled = false;
    let mirX = false;
    let mirY = false;
    let grid = db.get('grid', true) !== false;
    let onion = !!db.get('onion', false);
    let side = true;
    let zoom = 8;
    let autoFit = true;
    let sel = null;                 // {x, y, w, h, float: {data, base} | null}
    let stroke = null;
    let pan = null;
    let space = false;
    let playing = false;
    let playIdx = 0;
    let playTimer = 0;
    let raf = 0;
    let pending = false;
    let closed = false;
    let wheelAcc = 0;
    let lastTitle = '';

    // ---------- Aufbau ----------
    const art = h('canvas.pixel-art');
    const onionCv = h('canvas.pixel-onion', { hidden: true });
    const gridEl = h('div.pixel-grid');
    const axisX = h('i.pixel-axis.x', { hidden: true });
    const axisY = h('i.pixel-axis.y', { hidden: true });
    const hover = h('i.pixel-hover', { hidden: true });
    const paper = h('div.pixel-paper', { html: '<svg class="pixel-sel" style="display:none"><rect class="k" x=".5" y=".5"/><rect class="w" x=".5" y=".5"/></svg>' });
    const selEl = paper.firstChild;
    paper.prepend(onionCv, art, gridEl, axisX, axisY, hover);
    const stage = h('div.pixel-stage.scroll', h('div.pixel-stage-in', paper));
    const artCtx = art.getContext('2d');
    const onionCtx = onionCv.getContext('2d');

    // Titelleiste
    const bUndo = tb(icon('undo'), 'Rückgängig (⌘Z)', () => doUndo());
    const bRedo = tb(icon('redo'), 'Wiederholen (⇧⌘Z)', () => doRedo());
    const bSide = tb(IC.side, 'Seitenleiste ein- oder ausblenden', () => { side = !side; sync(); });
    win.tools.append(bUndo, bRedo, bSide);

    // Leiste oben
    const bFill = tb(IC.solid, 'Formen gefüllt zeichnen (F)', () => { filled = !filled; sync(); });
    const bMx = tb(IC.mirX, 'Beim Zeichnen horizontal spiegeln (H)', () => { mirX = !mirX; sync(); });
    const bMy = tb(IC.mirY, 'Beim Zeichnen vertikal spiegeln (V)', () => { mirY = !mirY; sync(); });
    const bGrid = tb(icon('grid'), 'Raster ein- oder ausblenden (#)', () => toggleGrid());
    const pos = h('span.pixel-pos');
    const zoomLbl = h('button.pixel-zoom', { type: 'button', title: 'Einpassen (0)', 'aria-label': 'Zoom – klicken zum Einpassen', onclick: () => { autoFit = true; fit(); } });
    const bar = h('div.kit-bar.pixel-bar',
      tb(icon('file'), 'Neues Bild …', () => newDoc()),
      tb(icon('folder'), 'Öffnen … (⌘O)', () => openFile()),
      tb(IC.save, 'Projekt sichern (⌘S)', () => saveProject(false)),
      tb(icon('external'), 'Als PNG exportieren … (⌘E)', () => exportDialog()),
      h('hr'), bFill, bMx, bMy, h('hr'), bGrid,
      h('span.sp'), pos,
      tb(icon('minus'), 'Verkleinern (−)', () => stepZoom(-1)), zoomLbl, tb(icon('plus'), 'Vergrößern (+)', () => stepZoom(1)));

    // Werkzeuge links
    const toolBtns = new Map();
    const duo = h('button.pixel-duo', { type: 'button', title: 'Primär- und Sekundärfarbe – klicken tauscht (X)', 'aria-label': 'Farben tauschen', onclick: () => swapColors() }, h('i'), h('i'));
    const tools = h('div.pixel-tools', { role: 'toolbar', 'aria-label': 'Werkzeuge' },
      TOOLS.map(([id, label, key, html]) => {
        const b = tb(html, `${label} (${key})`, () => setTool(id));
        toolBtns.set(id, b);
        return b;
      }),
      h('span.sp'), duo);

    // Seitenleiste: Farben
    const swA = h('button.pixel-sw', { type: 'button', title: 'Primärfarbe (linke Maustaste) – klicken zum Mischen', onclick: () => openMix(0) });
    const swB = h('button.pixel-sw', { type: 'button', title: 'Sekundärfarbe (rechte Maustaste) – klicken zum Mischen', onclick: () => openMix(1) });
    const svEl = h('div.pixel-sv', { tabIndex: 0, role: 'slider', 'aria-label': 'Sättigung und Helligkeit' }, h('i'));
    const hueEl = h('div.pixel-hue', { tabIndex: 0, role: 'slider', 'aria-label': 'Farbton', 'aria-valuemin': 0, 'aria-valuemax': 360 }, h('i'));
    const hexIn = h('input.kit-field.mono', { type: 'text', maxLength: 7, spellcheck: false, autocomplete: 'off', 'aria-label': 'Farbwert (HEX)' });
    const mix = h('div.pixel-mix', { hidden: true }, svEl, hueEl,
      h('div.pixel-mix-row', hexIn, h('button.kit-btn', { type: 'button', title: 'Zu den eigenen Farben legen', onclick: () => addCustom(colors[target]) }, 'Merken')));
    const palEl = h('div.pixel-pal', { role: 'group', 'aria-label': 'Palette' });
    const ownEl = h('div.pixel-pal', { role: 'group', 'aria-label': 'Eigene Farben' });
    const recEl = h('div.pixel-pal', { role: 'group', 'aria-label': 'Zuletzt benutzt' });
    const opaOut = h('output', '100 %');
    const opa = h('div.gslider', { 'data-min': 5, 'data-max': 100, 'data-step': 5, 'data-value': 100, 'aria-label': 'Deckkraft' });

    // Seitenleiste: Vorschau
    const one = h('canvas');
    const tile = h('canvas');
    const oneCtx = one.getContext('2d');
    const tileCtx = tile.getContext('2d');

    // Seitenleiste: Ebenen
    const layerList = h('div.pixel-layers', { role: 'list', 'aria-label': 'Ebenen' });
    const layerCtx = [];
    const bLAdd = tb(icon('plus'), 'Neue Ebene', () => addLayer());
    const bLUp = tb(IC.up, 'Ebene nach oben', () => moveLayer(1));
    const bLDown = tb(icon('chevronDown'), 'Ebene nach unten', () => moveLayer(-1));
    const bLMerge = tb(IC.merge, 'Mit der Ebene darunter zusammenführen', () => mergeDown());
    const bLDel = tb(icon('trash'), 'Ebene löschen', () => delLayer());

    const sideEl = h('aside.pixel-side.scroll',
      h('section.pixel-sec',
        h('header', h('span', 'Farben')),
        h('div.pixel-cur', swA, swB, tb(IC.swap, 'Farben tauschen (X)', () => swapColors())),
        mix, palEl, ownEl, recEl,
        h('div.pixel-opa', { title: 'Deckkraft' }, h('span', { html: icon('drop') }), opa, opaOut)),
      h('section.pixel-sec',
        h('header', h('span', 'Vorschau')),
        h('div.pixel-prev', h('div', { title: 'Originalgröße' }, one), h('div', { title: 'Als Kachelmuster' }, tile))),
      h('section.pixel-sec',
        h('header', h('span', 'Ebenen'), h('div.pixel-ops', bLAdd, bLUp, bLDown, bLMerge, bLDel)),
        layerList));

    // Leiste unten: Einzelbilder
    const bPlay = tb(icon('play'), 'Animation abspielen (P)', () => togglePlay());
    const fpsLbl = h('span.pixel-fps', { title: 'Bilder pro Sekunde' });
    const strip = h('div.pixel-strip', { role: 'list', 'aria-label': 'Einzelbilder' });
    const frameEls = [];
    const frameCtx = [];
    const bFAdd = tb(icon('plus'), 'Neues Einzelbild', () => addFrame());
    const bFDup = tb(icon('copy'), 'Einzelbild duplizieren', () => dupFrame());
    const bFDel = tb(icon('trash'), 'Einzelbild löschen', () => delFrame());
    const bOnion = tb(icon('layers'), 'Zwiebelhaut: vorheriges Einzelbild durchscheinen lassen', () => toggleOnion());
    const framesEl = h('div.pixel-frames',
      bPlay,
      tb(icon('minus'), 'Langsamer', () => setFps(doc.fps - 1)), fpsLbl, tb(icon('plus'), 'Schneller', () => setFps(doc.fps + 1)),
      h('hr'), strip, h('hr'), bFAdd, bFDup, bFDel, h('hr'), bOnion);

    const root = h('div.pixel', bar, tools, stage, sideEl, framesEl);
    win.body.append(root);
    initControls(root);

    /** Menüeinträge so verpacken, dass die Tastatur danach wieder dem Fenster gehört. */
    const refocus = (items) => items.map((it) => (it && typeof it === 'object' && it.run
      ? { ...it, run: () => { if (!closed) win.el.focus({ preventScroll: true }); it.run(); } } : it));
    const popup = (items, e) => openMenu(refocus(items), { x: e.clientX, y: e.clientY });

    // ---------- Anzeige ----------
    const blit = (ctx, buf) => ctx.putImageData(new ImageData(buf, n, n), 0, 0);
    const render = () => { if (!raf && !closed) raf = requestAnimationFrame(paintNow); };
    function paintNow() {
      raf = 0;
      if (closed || !doc) return;
      const f = doc.frames[fi];
      compose(doc, f, comp);
      blit(artCtx, comp);
      if (frameCtx[fi]) blit(frameCtx[fi], comp);
      if (layerCtx[li]) blit(layerCtx[li], f.cels[li]);
      paintOnion();
      if (!playing) paintPreview(comp);
    }
    function paintPreview(buf) {
      const img = new ImageData(buf, n, n);
      oneCtx.putImageData(img, 0, 0);
      for (let ty = 0; ty < 3; ty++) for (let tx = 0; tx < 3; tx++) tileCtx.putImageData(img, tx * n, ty * n);
    }
    function paintOnion() {
      const show = onion && doc.frames.length > 1 && !playing;
      onionCv.hidden = !show;
      if (!show) return;
      compose(doc, doc.frames[(fi - 1 + doc.frames.length) % doc.frames.length], tmp);
      for (let i = 0; i < tmp.length; i += 4) {      // warm einfärben, damit man es vom aktuellen Bild unterscheidet
        if (!tmp[i + 3]) continue;
        tmp[i] = (tmp[i] + 255) >> 1; tmp[i + 1] = tmp[i + 1] * 0.55; tmp[i + 2] = tmp[i + 2] * 0.65;
      }
      blit(onionCtx, tmp);
    }
    function paintLayerThumbs() {
      const f = doc.frames[fi];
      layerCtx.forEach((ctx, l) => { if (ctx && f.cels[l]) blit(ctx, f.cels[l]); });
    }
    function paintFrameThumbs() {
      doc.frames.forEach((f, i) => { if (frameCtx[i]) blit(frameCtx[i], compose(doc, f, tmp)); });
    }
    function paintLayers() {
      layerCtx.length = 0;
      const rows = [];
      for (let l = doc.layers.length - 1; l >= 0; l--) {
        const L = doc.layers[l];
        const cv = h('canvas', { width: n, height: n });
        layerCtx[l] = cv.getContext('2d');
        const label = L.visible ? `„${L.name}“ ausblenden` : `„${L.name}“ einblenden`;
        const eye = tb(L.visible ? IC.eye : IC.eyeOff, label, () => toggleLayer(l));
        const main = h('button.pixel-layer-main', { type: 'button', title: 'Doppelklick benennt um', 'aria-current': l === li ? 'true' : null }, cv, h('span', L.name));
        main.addEventListener('click', (e) => { pickLayer(l); if (e.detail === 2) renameLayer(l); });
        const row = h('div.pixel-layer', { role: 'listitem', class: `${l === li ? 'is-on' : ''}${L.visible ? '' : ' is-off'}` }, eye, main);
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          pickLayer(l);
          popup(layerMenu(), e);
        });
        rows.push(row);
      }
      layerList.replaceChildren(...rows);
      paintLayerThumbs();
    }
    function paintFrames() {
      frameEls.length = 0;
      frameCtx.length = 0;
      strip.replaceChildren(...doc.frames.map((f, i) => {
        const cv = h('canvas', { width: n, height: n });
        frameCtx[i] = cv.getContext('2d');
        const el = h('button.pixel-frame', { type: 'button', role: 'listitem', class: i === fi ? 'is-on' : '', 'aria-label': `Einzelbild ${i + 1}`, 'aria-current': i === fi ? 'true' : null, onclick: () => pickFrame(i) }, cv, h('b', String(i + 1)));
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          pickFrame(i);
          popup(frameMenu(), e);
        });
        frameEls[i] = el;
        return el;
      }));
      paintFrameThumbs();
      showFrame();
    }
    function showFrame() {
      const el = frameEls[fi];
      if (!el) return;
      const l = el.offsetLeft - strip.offsetLeft;
      if (l < strip.scrollLeft + 3) strip.scrollLeft = l - 3;
      else if (l + el.offsetWidth > strip.scrollLeft + strip.clientWidth - 3) strip.scrollLeft = l + el.offsetWidth - strip.clientWidth + 3;
    }
    function paintSel() {
      if (!sel) { selEl.style.display = 'none'; return; }
      const w = sel.w * zoom, hgt = sel.h * zoom;
      selEl.style.display = '';
      selEl.setAttribute('width', w);
      selEl.setAttribute('height', hgt);
      selEl.style.transform = `translate(${sel.x * zoom}px, ${sel.y * zoom}px)`;
      for (const r of selEl.children) { r.setAttribute('width', Math.max(0, w - 1)); r.setAttribute('height', Math.max(0, hgt - 1)); }
    }
    function layoutPreview() {
      one.style.width = one.style.height = `${n}px`;
      const t = n * 3;
      const s = t <= 96 ? Math.floor(96 / t) * t : 96;
      tile.style.width = tile.style.height = `${s}px`;
      tile.style.imageRendering = t <= 96 ? 'pixelated' : 'auto';
    }
    function title() {
      const t = `${dirty ? '• ' : ''}${name} – Pixel`;
      if (t !== lastTitle) { lastTitle = t; win.setTitle(t); }
    }
    function sync() {
      for (const [id, b] of toolBtns) { b.classList.toggle('is-on', id === tool); b.setAttribute('aria-pressed', String(id === tool)); }
      bUndo.disabled = !undo.length;
      bRedo.disabled = !redo.length;
      bFill.disabled = tool !== 'rect' && tool !== 'oval';
      const press = (b, on) => { b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); };
      press(bFill, filled); press(bMx, mirX); press(bMy, mirY); press(bGrid, grid); press(bOnion, onion); press(bSide, side);
      axisX.hidden = !mirX;
      axisY.hidden = !mirY;
      gridEl.hidden = !grid || zoom < 4;
      sideEl.hidden = !side;
      zoomLbl.textContent = `${zoom * 100} %`;
      const nl = doc.layers.length, nf = doc.frames.length;
      bLAdd.disabled = nl >= MAX_LAYERS;
      bLUp.disabled = li >= nl - 1;
      bLDown.disabled = bLMerge.disabled = li <= 0;
      bLDel.disabled = nl < 2;
      bFAdd.disabled = bFDup.disabled = nf >= MAX_FRAMES;
      bFDel.disabled = nf < 2;
      bPlay.disabled = nf < 2;
      bPlay.innerHTML = icon(playing ? 'pause' : 'play');
      bPlay.title = playing ? 'Animation anhalten (P)' : 'Animation abspielen (P)';
      bPlay.setAttribute('aria-label', bPlay.title);
      bPlay.classList.toggle('is-on', playing);
      fpsLbl.textContent = `${doc.fps} B/s`;
      stage.classList.toggle('is-pan', space);
    }

    // ---------- Verlauf (Schnappschüsse teilen sich unveränderte Puffer) ----------
    const snap = () => ({ layers: doc.layers.map((l) => ({ ...l })), frames: doc.frames.map((f) => ({ id: f.id, cels: f.cels.slice() })), fi, li });
    function pushUndo() {
      undo.push(snap());
      if (undo.length > MAX_UNDO) undo.shift();
      heldRedo = redo.splice(0);
      owned.clear();
    }
    /** Die begonnene Aktion hat nichts verändert: Schnappschuss wieder vergessen. */
    function dropUndo() {
      undo.pop();
      redo.push(...heldRedo);
      heldRedo = [];
    }
    function restore(s) {
      const vis = new Map(doc.layers.map((l) => [l.id, l.visible]));
      doc.layers = s.layers.map((l) => ({ ...l, visible: vis.has(l.id) ? vis.get(l.id) : l.visible }));
      doc.frames = s.frames.map((f) => ({ id: f.id, cels: f.cels.slice() }));
      fi = clamp(s.fi, 0, doc.frames.length - 1);
      li = clamp(s.li, 0, doc.layers.length - 1);
      owned.clear();
      sel = null;
    }
    function doUndo() {
      if (stroke || !undo.length) return;
      redo.push(snap());
      restore(undo.pop());
      structure();
    }
    function doRedo() {
      if (stroke || !redo.length) return;
      undo.push(snap());
      restore(redo.pop());
      structure();
    }
    /** Liefert den Puffer einer Ebene zum Verändern – beim ersten Zugriff nach einem Schnappschuss als Kopie. */
    function mut(f = fi, l = li) {
      const cels = doc.frames[f].cels;
      let c = cels[l];
      if (!owned.has(c)) { c = c.slice(); cels[l] = c; owned.add(c); }
      return c;
    }
    const persist = () => {
      pending = false;
      if (doc) db.set('doc', { ...serialize(doc), name, path, dirty, fi, li });
    };
    const save = debounce(() => { if (!closed && pending) persist(); }, 500);
    function touched() {
      dirty = true;
      pending = true;
      title();
      sync();
      render();
      save();
    }
    function structure() {
      paintLayers();
      paintFrames();
      paintSel();
      touched();
    }

    // ---------- Dokument ----------
    function setDoc(d, meta = {}) {
      stopPlay();
      doc = d;
      n = d.size;
      fi = clamp(meta.fi | 0, 0, d.frames.length - 1);
      li = clamp(meta.li ?? d.layers.length - 1, 0, d.layers.length - 1);
      name = meta.name || 'Unbenannt';
      path = meta.path && vfs.exists(meta.path) ? meta.path : null;
      dirty = !!meta.dirty;
      undo.length = redo.length = 0;
      heldRedo = [];
      owned.clear();
      sel = null;
      stroke = null;
      comp = new Uint8ClampedArray(n * n * 4);
      tmp = new Uint8ClampedArray(n * n * 4);
      for (const cv of [art, onionCv, one]) cv.width = cv.height = n;
      tile.width = tile.height = n * 3;
      paper.style.setProperty('--n', n);
      autoFit = true;
      fit();
      layoutPreview();
      paintLayers();
      paintFrames();
      paintSel();
      title();
      sync();
      cancelAnimationFrame(raf);
      paintNow();
    }
    const fail = (err) => sheet(win, { title: 'Das hat nicht geklappt', text: String(err?.message || err) });
    const okToReplace = async () => !dirty || confirmSheet(win, {
      title: `„${name}“ verwerfen?`, text: 'Das Bild wurde seit dem letzten Sichern geändert. Die Änderungen gehen verloren.', ok: 'Verwerfen', danger: true,
    });

    async function newDoc() {
      if (!(await okToReplace())) return;
      let size = SIZES.includes(n) ? n : 32;
      const seg = h('div.gseg', SIZES.map((s) => h('button', { 'data-value': s, 'aria-selected': String(s === size) }, `${s} × ${s}`)));
      seg.addEventListener('change', (e) => { size = Number(e.detail.value); });
      const body = h('div.pixel-dlg', seg);
      initControls(body);
      const ok = await sheet(win, {
        title: 'Neues Bild', text: 'Wie groß soll die Leinwand sein (in Pixeln)?', body, wide: true, cancelValue: false,
        buttons: [{ label: 'Abbrechen', value: false }, { label: 'Anlegen', value: true, primary: true }],
      });
      if (!ok) return;
      setDoc(blank(size));
      persist();
    }

    async function openFile() {
      const p = await openDialog(win, {
        title: 'Bild öffnen', dir: path ? dirname(path) : `${HOME}/Bilder`,
        filter: (st) => /\.pixel\.json$/i.test(st.name) || extname(st.path) === 'png',
      });
      if (p) await load(p);
    }
    async function load(p) {
      try {
        if (!vfs.exists(p) || vfs.isDir(p)) throw new Error(`„${basename(p)}“ wurde nicht gefunden.`);
        const raw = vfs.read(p);
        if (raw.startsWith('data:image/') || extname(p) === 'png') {
          if (!raw.startsWith('data:image/')) throw new Error(`„${basename(p)}“ enthält kein Bild.`);
          const img = await loadImage(raw);
          const w = img.naturalWidth, hgt = img.naturalHeight;
          if (w > 64 || hgt > 64) {
            const go = await sheet(win, {
              title: 'Dieses Bild ist zu groß für Pixel',
              text: `„${basename(p)}“ misst ${w} × ${hgt} Pixel. Pixel öffnet Bilder bis 64 × 64 – größere sind in „Malen“ besser aufgehoben.`,
              buttons: [{ label: 'In Malen öffnen', value: 'paint' }, { label: 'OK', value: null, primary: true }],
            });
            if (go === 'paint') sys.open('paint', { path: p });
            return false;
          }
          if (!(await okToReplace())) return false;
          const size = SIZES.find((s) => s >= Math.max(w, hgt));
          const cv = h('canvas', { width: size, height: size });
          const c = cv.getContext('2d');
          c.drawImage(img, (size - w) >> 1, (size - hgt) >> 1);
          const px = new Uint8ClampedArray(c.getImageData(0, 0, size, size).data);
          for (let i = 0; i < px.length; i += 4) if (!px[i + 3]) px[i] = px[i + 1] = px[i + 2] = 0;
          const d = blank(size);
          d.frames[0].cels[0] = px;
          setDoc(d, { name: stem(p) });
          persist();
          if (w !== size || hgt !== size) toast(win, `${w} × ${hgt} Pixel – mittig auf ${size} × ${size} gelegt`);
          return true;
        }
        let parsed;
        try { parsed = JSON.parse(raw); } catch { throw new Error(`„${basename(p)}“ ist keine Pixel-Projektdatei.`); }
        const d = deserialize(parsed);
        if (!(await okToReplace())) return false;
        setDoc(d, { name: stem(p), path: p });
        persist();
        return true;
      } catch (err) {
        fail(err);
        return false;
      }
    }

    async function saveProject(as) {
      let p = path;
      if (!p || as) {
        p = await saveDialog(win, { title: 'Projekt sichern', dir: path ? dirname(path) : `${HOME}/Bilder`, name: `${name}.pixel.json` });
        if (!p) return false;
        if (!/\.pixel\.json$/i.test(p)) {
          p = `${p.replace(/\.json$/i, '')}.pixel.json`;
          if (vfs.exists(p) && !(await confirmSheet(win, { title: `„${basename(p)}“ ersetzen?`, text: 'In diesem Ordner gibt es bereits eine Datei mit diesem Namen.', ok: 'Ersetzen', danger: true }))) return false;
        }
      }
      try {
        vfs.write(p, JSON.stringify(serialize(doc)), 'application/json');
        path = p;
        name = stem(p);
        dirty = false;
        title();
        persist();
        toast(win, `Gesichert: ${basename(p)}`);
        return true;
      } catch (err) {
        fail(err);
        return false;
      }
    }

    /** Sichtbare Ebenen als PNG – ein Einzelbild oder alle als Sprite-Sheet. */
    function sheetLayout(mode) {
      const count = mode === 'sheet' ? doc.frames.length : 1;
      const cols = count <= 8 ? count : Math.ceil(Math.sqrt(count));
      return { count, cols, rows: Math.ceil(count / cols) };
    }
    function renderPng(mode, scale) {
      const frames = mode === 'sheet' ? doc.frames : [doc.frames[fi]];
      const { cols, rows } = sheetLayout(mode);
      const src = h('canvas', { width: cols * n, height: rows * n });
      const sc = src.getContext('2d');
      const buf = new Uint8ClampedArray(n * n * 4);
      frames.forEach((f, i) => sc.putImageData(new ImageData(compose(doc, f, buf), n, n), (i % cols) * n, Math.floor(i / cols) * n));
      if (scale === 1) return src.toDataURL('image/png');
      const out = h('canvas', { width: src.width * scale, height: src.height * scale });
      const oc = out.getContext('2d');
      oc.imageSmoothingEnabled = false;
      oc.drawImage(src, 0, 0, out.width, out.height);
      return out.toDataURL('image/png');
    }
    async function exportDialog() {
      let mode = 'frame';
      let scale = clamp(Math.round(256 / n), 1, 16);
      const many = doc.frames.length > 1;
      const seg = h('div.gseg',
        h('button', { 'data-value': 'frame', 'aria-selected': 'true' }, many ? `Einzelbild ${fi + 1}` : 'Bild'),
        h('button', { 'data-value': 'sheet', disabled: !many }, many ? `Sprite-Sheet (${doc.frames.length} Bilder)` : 'Sprite-Sheet'));
      const slider = h('div.gslider', { 'data-min': 1, 'data-max': 16, 'data-step': 1, 'data-value': scale, 'aria-label': 'Vergrößerung' });
      const out = h('output');
      const info = h('p');
      const paint = () => {
        const { cols, rows } = sheetLayout(mode);
        out.textContent = `${scale}×`;
        info.textContent = `Ergebnis: ${(cols * n * scale).toLocaleString('de-DE')} × ${(rows * n * scale).toLocaleString('de-DE')} Pixel, sichtbare Ebenen${mode === 'sheet' ? `, ${cols} Bilder pro Zeile` : ''}.`;
      };
      seg.addEventListener('change', (e) => { mode = e.detail.value; paint(); });
      slider.addEventListener('input', (e) => { scale = e.detail.value; paint(); });
      const body = h('div.pixel-dlg', seg, h('div.pixel-dlg-row', h('span', 'Vergrößerung'), slider, out), info);
      initControls(body);
      paint();
      const how = await sheet(win, {
        title: 'Als PNG exportieren', body, wide: true,
        buttons: [{ label: 'Abbrechen', value: null }, { label: 'Herunterladen', value: 'dl' }, { label: 'In fableOS sichern …', value: 'vfs', primary: true }],
      });
      if (!how) return;
      try {
        const url = renderPng(mode, scale);
        const file = `${name}${mode === 'sheet' ? '-sheet' : many ? `-${fi + 1}` : ''}.png`;
        if (how === 'dl') { download(file, url, 'image/png'); toast(win, `Heruntergeladen: ${file}`); return; }
        let p = await saveDialog(win, { title: 'PNG sichern', dir: `${HOME}/Bilder`, name: file });
        if (!p) return;
        if (!/\.png$/i.test(p)) {
          p += '.png';
          if (vfs.exists(p) && !(await confirmSheet(win, { title: `„${basename(p)}“ ersetzen?`, text: 'In diesem Ordner gibt es bereits eine Datei mit diesem Namen.', ok: 'Ersetzen', danger: true }))) return;
        }
        vfs.write(p, url, 'image/png');
        toast(win, `Exportiert: ${basename(p)}`);
      } catch (err) { fail(err); }
    }

    // ---------- Zoom ----------
    const maxZoom = () => clamp(Math.floor(2560 / n), 8, 64);
    function applyZoom() {
      paper.style.setProperty('--z', zoom);
      hover.hidden = true;
      paintSel();
      sync();
    }
    function fit() {
      const w = stage.clientWidth, hgt = stage.clientHeight;
      if (!w || !hgt) return;
      zoom = clamp(Math.floor((Math.min(w, hgt) - 56) / n), 1, maxZoom());
      applyZoom();
    }
    function setZoom(z, at) {
      z = clamp(z, 1, maxZoom());
      if (z === zoom) return;
      const sr = stage.getBoundingClientRect();
      const cx = at ? at.clientX : sr.left + stage.clientWidth / 2;
      const cy = at ? at.clientY : sr.top + stage.clientHeight / 2;
      const r = paper.getBoundingClientRect();
      const fx = (cx - r.left) / zoom, fy = (cy - r.top) / zoom;
      zoom = z;
      applyZoom();
      const r2 = paper.getBoundingClientRect();
      stage.scrollLeft += r2.left + fx * zoom - cx;
      stage.scrollTop += r2.top + fy * zoom - cy;
    }
    function stepZoom(dir, at) {
      const list = ZOOMS.filter((z) => z <= maxZoom());
      const next = dir > 0 ? list.find((z) => z > zoom) : list.slice().reverse().find((z) => z < zoom);
      if (!next) return;
      autoFit = false;
      setZoom(next, at);
    }
    function toggleGrid() { grid = !grid; db.set('grid', grid); sync(); }
    function toggleOnion() { onion = !onion; db.set('onion', onion); sync(); paintOnion(); }

    // ---------- Farben ----------
    function paintColors() {
      swA.style.setProperty('--c', colors[0]); swA.style.setProperty('--ink', inkFor(colors[0])); swA.textContent = colors[0];
      swB.style.setProperty('--c', colors[1]); swB.style.setProperty('--ink', inkFor(colors[1])); swB.textContent = colors[1];
      swA.setAttribute('aria-label', `Primärfarbe ${colors[0]}`);
      swB.setAttribute('aria-label', `Sekundärfarbe ${colors[1]}`);
      swA.classList.toggle('is-on', mixOpen && target === 0);
      swB.classList.toggle('is-on', mixOpen && target === 1);
      duo.style.setProperty('--a', colors[0]);
      duo.style.setProperty('--b', colors[1]);
      for (const el of root.querySelectorAll('.pixel-chip[data-c]')) el.classList.toggle('is-a', el.dataset.c === colors[0]);
      mix.hidden = !mixOpen;
      svEl.style.setProperty('--h', hsv[0].toFixed(1));
      svEl.style.setProperty('--s', hsv[1].toFixed(4));
      svEl.style.setProperty('--v', hsv[2].toFixed(4));
      hueEl.style.setProperty('--h', hsv[0].toFixed(1));
      hueEl.setAttribute('aria-valuenow', Math.round(hsv[0]));
      svEl.setAttribute('aria-valuetext', `Sättigung ${Math.round(hsv[1] * 100)} %, Helligkeit ${Math.round(hsv[2] * 100)} %`);
      if (document.activeElement !== hexIn) hexIn.value = colors[target];
    }
    const chip = (hex, own) => {
      const el = h('button.pixel-chip', { type: 'button', title: `${hex} – Umschalt-Klick oder Rechtsklick: Sekundärfarbe`, 'aria-label': `Farbe ${hex}`, dataset: { c: hex }, style: { '--c': hex } });
      el.addEventListener('click', (e) => setColor(e.shiftKey ? 1 : 0, hex));
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        popup([
          { label: 'Als Primärfarbe', run: () => setColor(0, hex) },
          { label: 'Als Sekundärfarbe', run: () => setColor(1, hex) },
          own && '-',
          own && { label: 'Aus eigenen Farben entfernen', icon: 'trash', run: () => { custom = custom.filter((c) => c !== hex); db.set('custom', custom); paintChips(); } },
        ], e);
      });
      return el;
    };
    function paintChips() {
      ownEl.replaceChildren(
        h('button.pixel-chip.add', { type: 'button', title: 'Eigene Farben: Primärfarbe merken', 'aria-label': 'Primärfarbe zu den eigenen Farben legen', html: icon('plus'), onclick: () => addCustom(colors[0]) }),
        ...custom.map((c) => chip(c, true)));
      recEl.replaceChildren(h('span.pixel-chip.add', { title: 'Zuletzt benutzt', html: icon('clock') }), ...recent.slice(0, 7).map((c) => chip(c, false)));
      recEl.hidden = !recent.length;
      paintColors();
    }
    function setColor(i, hex, fromMix = false) {
      const rgb = hexRgb(hex);
      if (!rgb) return;
      colors[i] = rgbHex(...rgb);
      db.set('colors', colors);
      if (!fromMix && i === target) {
        const next = rgbHsv(...rgb);
        if (!next[1] || !next[2]) next[0] = hsv[0];     // Grau/Schwarz: Farbton behalten
        hsv = next;
      }
      paintColors();
    }
    function swapColors() {
      colors.reverse();
      db.set('colors', colors);
      hsv = rgbHsv(...hexRgb(colors[target]));
      paintColors();
    }
    function openMix(i) {
      mixOpen = !(mixOpen && target === i);
      target = i;
      hsv = rgbHsv(...hexRgb(colors[i]));
      paintColors();
    }
    function addCustom(hex) {
      if (custom.includes(hex)) { toast(win, 'Diese Farbe ist schon gemerkt.'); return; }
      if (custom.length >= 15) { toast(win, 'Mehr als 15 eigene Farben passen nicht – entferne erst eine.'); return; }
      custom = [...custom, hex];
      db.set('custom', custom);
      paintChips();
    }
    function useColor(hex) {
      if (recent[0] === hex) return;
      recent = [hex, ...recent.filter((c) => c !== hex)].slice(0, 8);
      db.set('recent', recent);
      paintChips();
    }
    const mixApply = () => setColor(target, rgbHex(...hsvRgb(hsv[0], hsv[1], hsv[2])), true);
    const svFrom = (e) => {
      const r = svEl.getBoundingClientRect();
      hsv[1] = clamp((e.clientX - r.left) / r.width);
      hsv[2] = 1 - clamp((e.clientY - r.top) / r.height);
      mixApply();
    };
    const hueFrom = (e) => {
      const r = hueEl.getBoundingClientRect();
      hsv[0] = clamp((e.clientX - r.left) / r.width) * 360;
      mixApply();
    };
    drag(svEl, { start: svFrom, move: svFrom });
    drag(hueEl, { start: hueFrom, move: hueFrom });
    svEl.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      hsv[1] = clamp(hsv[1] + d[0] * 0.02);
      hsv[2] = clamp(hsv[2] + d[1] * 0.02);
      mixApply();
    });
    hueEl.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      hsv[0] = clamp(hsv[0] + d * 3, 0, 360);
      mixApply();
    });
    hexIn.addEventListener('input', () => { if (hexRgb(hexIn.value)) setColor(target, hexIn.value); });
    hexIn.addEventListener('blur', () => { hexIn.value = colors[target]; });
    hexIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') hexIn.blur(); });
    opa.addEventListener('input', (e) => { alpha = e.detail.value; opaOut.textContent = `${alpha} %`; });
    palEl.replaceChildren(...PALETTE.map((c) => chip(c, false)));

    // ---------- Werkzeuge ----------
    function setTool(id) {
      if (stroke) return;
      tool = id;
      sync();
    }
    const visible = () => {
      if (doc.layers[li].visible) return true;
      toast(win, `Die Ebene „${doc.layers[li].name}“ ist ausgeblendet.`);
      return false;
    };
    const pixelAt = (e) => {
      const r = paper.getBoundingClientRect();
      const k = r.width / n || zoom;
      return { x: Math.floor((e.clientX - r.left) / k), y: Math.floor((e.clientY - r.top) / k) };
    };
    const inside = (p) => p.x >= 0 && p.y >= 0 && p.x < n && p.y < n;
    const inSel = (p) => !!sel && p.x >= sel.x && p.y >= sel.y && p.x < sel.x + sel.w && p.y < sel.y + sel.h;

    /** Einen Pixel des laufenden Strichs setzen – jeder Pixel wird pro Strich nur einmal gemischt. */
    function put(s, x, y) {
      if (x < 0 || y < 0 || x >= n || y >= n) return;
      const k = y * n + x;
      if (s.mask[k]) return;
      s.mask[k] = 1;
      const i = k * 4;
      if (s.t === 'erase') {
        const a = Math.round(s.base[i + 3] * (1 - s.a / 255));
        s.cel[i + 3] = a;
        if (!a) s.cel[i] = s.cel[i + 1] = s.cel[i + 2] = 0;
      } else over(s.cel, i, s.rgb[0], s.rgb[1], s.rgb[2], s.a);
    }
    function plot(s, x, y) {
      put(s, x, y);
      if (mirX) put(s, n - 1 - x, y);
      if (mirY) put(s, x, n - 1 - y);
      if (mirX && mirY) put(s, n - 1 - x, n - 1 - y);
    }
    function shape(s, p, snap45) {
      s.cel.set(s.base);
      s.mask.fill(0);
      const x0 = s.x0, y0 = s.y0;
      let x = clamp(p.x, -n, 2 * n), y = clamp(p.y, -n, 2 * n);
      const dot = (px, py) => plot(s, px, py);
      if (s.t === 'line') {
        if (snap45) {       // Umschalttaste: waagerecht, senkrecht oder diagonal
          const dx = x - x0, dy = y - y0, ax = Math.abs(dx), ay = Math.abs(dy);
          if (ax > ay * 2) y = y0;
          else if (ay > ax * 2) x = x0;
          else { const d = Math.max(ax, ay); x = x0 + Math.sign(dx) * d; y = y0 + Math.sign(dy) * d; }
        }
        line(x0, y0, x, y, dot);
        return;
      }
      if (snap45) {         // Umschalttaste: Quadrat bzw. Kreis
        const d = Math.max(Math.abs(x - x0), Math.abs(y - y0));
        x = x0 + (x < x0 ? -d : d);
        y = y0 + (y < y0 ? -d : d);
      }
      const ax = Math.min(x0, x), bx = Math.max(x0, x), ay = Math.min(y0, y), by = Math.max(y0, y);
      if (s.t === 'rect') rect(ax, ay, bx, by, filled, dot); else oval(ax, ay, bx, by, filled, dot);
    }
    function flood(s, p) {
      if (!inside(p)) return;
      const u = u32(s.cel);
      const k0 = p.y * n + p.x;
      const from = u[k0];
      const one4 = new Uint8ClampedArray(4);
      one4.set(s.cel.subarray(k0 * 4, k0 * 4 + 4));
      over(one4, 0, s.rgb[0], s.rgb[1], s.rgb[2], s.a);
      const to = u32(one4)[0];
      if (to === from) return;
      const seeds = [k0];
      if (mirX) seeds.push(p.y * n + n - 1 - p.x);
      if (mirY) seeds.push((n - 1 - p.y) * n + p.x);
      if (mirX && mirY) seeds.push((n - 1 - p.y) * n + n - 1 - p.x);
      for (const seed of seeds) {
        const stack = [seed];
        while (stack.length) {
          const k = stack.pop();
          if (u[k] !== from) continue;
          u[k] = to;
          const x = k % n;
          if (x > 0) stack.push(k - 1);
          if (x < n - 1) stack.push(k + 1);
          if (k >= n) stack.push(k - n);
          if (k < n * (n - 1)) stack.push(k + n);
        }
      }
    }
    function pickAt(p, btn) {
      if (!inside(p)) return;
      const i = (p.y * n + p.x) * 4;
      if (comp[i + 3]) setColor(btn, rgbHex(comp[i], comp[i + 1], comp[i + 2]));
    }

    // ---------- Auswahl ----------
    /** Ausschnitt einer Ebene kopieren, auf Wunsch dabei ausschneiden. */
    function grab(cel, r, clear) {
      const data = new Uint8ClampedArray(r.w * r.h * 4);
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
        const cx = r.x + x, cy = r.y + y;
        if (cx < 0 || cy < 0 || cx >= n || cy >= n) continue;
        const i = (cy * n + cx) * 4, o = (y * r.w + x) * 4;
        data[o] = cel[i]; data[o + 1] = cel[i + 1]; data[o + 2] = cel[i + 2]; data[o + 3] = cel[i + 3];
        if (clear) cel[i] = cel[i + 1] = cel[i + 2] = cel[i + 3] = 0;
      }
      return data;
    }
    /** Auswahl von der Ebene abheben: Die Pixel schweben, bis etwas anderes passiert. */
    function lift() {
      if (sel.float) return true;
      if (!visible()) return false;
      pushUndo();
      const cel = mut();
      const data = grab(cel, sel, true);
      sel.float = { data, base: cel.slice() };
      return true;
    }
    function placeFloat() {
      const f = sel.float, cel = mut();
      cel.set(f.base);
      for (let y = 0; y < sel.h; y++) for (let x = 0; x < sel.w; x++) {
        const o = (y * sel.w + x) * 4;
        const cx = sel.x + x, cy = sel.y + y;
        if (!f.data[o + 3] || cx < 0 || cy < 0 || cx >= n || cy >= n) continue;
        over(cel, (cy * n + cx) * 4, f.data[o], f.data[o + 1], f.data[o + 2], f.data[o + 3]);
      }
    }
    const anchor = () => { if (sel?.float) sel.float = null; };
    function deselect() { sel = null; paintSel(); }
    function selectAll() {
      if (stroke) return;
      anchor();
      sel = { x: 0, y: 0, w: n, h: n, float: null };
      tool = 'move';
      paintSel();
      sync();
    }
    function copySel(cutOut) {
      if (stroke || !sel) { if (!sel) toast(win, 'Erst mit „Auswahl verschieben“ (M) einen Bereich markieren.'); return; }
      const data = sel.float ? sel.float.data.slice() : grab(doc.frames[fi].cels[li], sel, false);
      clipboard = { w: sel.w, h: sel.h, x: sel.x, y: sel.y, data };
      if (cutOut) deleteSel(); else toast(win, 'Auswahl kopiert');
    }
    function deleteSel() {
      if (stroke || !sel || !visible()) return;
      if (sel.float) mut().set(sel.float.base);
      else { pushUndo(); grab(mut(), sel, true); }
      sel = null;
      paintSel();
      touched();
    }
    function paste() {
      if (stroke || !clipboard) return;
      if (!visible()) return;
      anchor();
      pushUndo();
      const cel = mut();
      sel = {
        x: clamp(clipboard.x, 1 - clipboard.w, n - 1), y: clamp(clipboard.y, 1 - clipboard.h, n - 1), w: clipboard.w, h: clipboard.h,
        float: { data: clipboard.data.slice(), base: cel.slice() },
      };
      placeFloat();
      tool = 'move';
      paintSel();
      touched();
    }
    function nudge(dx, dy) {
      if (stroke) return;
      if (sel) {
        if (!lift()) return;
        sel.x += dx;
        sel.y += dy;
        placeFloat();
        paintSel();
        touched();
      } else if (tool === 'move' && visible()) {
        pushUndo();
        shiftPx(mut(), n, dx, dy);
        touched();
      }
    }

    // ---------- Zeiger auf der Leinwand ----------
    function startStroke(e) {
      const p = pixelAt(e);
      const btn = e.button === 2 ? 1 : 0;
      const t = e.altKey && tool !== 'move' ? 'pick' : tool;
      const s = { t, btn, pid: e.pointerId, x0: p.x, y0: p.y, lx: p.x, ly: p.y };
      if (t === 'pick') { stroke = s; pickAt(p, btn); return; }
      if (t === 'move') {
        if (inSel(p)) Object.assign(s, { mode: 'drag', sx: sel.x, sy: sel.y });
        else {
          sel = null;
          paintSel();
          Object.assign(s, { mode: 'mark', x0: clamp(p.x, 0, n - 1), y0: clamp(p.y, 0, n - 1), moved: false });
        }
        stroke = s;
        return;
      }
      if (!visible()) return;
      anchor();
      pushUndo();
      s.cel = mut();
      s.base = s.cel.slice();
      s.mask = new Uint8Array(n * n);
      s.rgb = hexRgb(colors[btn]);
      s.a = Math.round(alpha * 2.55);
      stroke = s;
      if (t === 'fill') flood(s, p);
      else if (t === 'pen' || t === 'erase') plot(s, p.x, p.y);
      else shape(s, p, e.shiftKey);
      if (t !== 'erase') useColor(colors[btn]);
      render();
    }
    function moveStroke(e) {
      const s = stroke, p = pixelAt(e);
      if (s.t === 'pick') { pickAt(p, s.btn); return; }
      if (s.t === 'move') {
        if (s.mode === 'mark') {
          const x = clamp(p.x, 0, n - 1), y = clamp(p.y, 0, n - 1);
          if (x !== s.x0 || y !== s.y0) s.moved = true;
          if (!s.moved) return;
          sel = { x: Math.min(x, s.x0), y: Math.min(y, s.y0), w: Math.abs(x - s.x0) + 1, h: Math.abs(y - s.y0) + 1, float: null };
          paintSel();
        } else {
          const dx = p.x - s.x0, dy = p.y - s.y0;
          if ((!sel.float && !dx && !dy) || !lift()) return;
          sel.x = s.sx + dx;
          sel.y = s.sy + dy;
          placeFloat();
          paintSel();
          render();
        }
        return;
      }
      if (s.t === 'fill') return;
      if (s.t === 'pen' || s.t === 'erase') {
        line(s.lx, s.ly, clamp(p.x, -n, 2 * n), clamp(p.y, -n, 2 * n), (x, y) => plot(s, x, y));
        s.lx = clamp(p.x, -n, 2 * n);
        s.ly = clamp(p.y, -n, 2 * n);
      } else shape(s, p, e.shiftKey);
      render();
    }
    function endStroke(cancel = false) {
      const s = stroke;
      if (!s) return;
      stroke = null;
      if (s.t === 'pick') return;
      if (s.t === 'move') {
        if (s.mode === 'mark') { if (!s.moved) deselect(); }
        else if (sel?.float) touched();
        return;
      }
      if (cancel) s.cel.set(s.base);
      let diff = false;
      if (!cancel) for (let i = 0; i < s.cel.length; i++) if (s.cel[i] !== s.base[i]) { diff = true; break; }
      if (diff) touched(); else { dropUndo(); sync(); render(); }
    }
    function showHover(e) {
      const p = pixelAt(e);
      const on = inside(p) && !pan && !space;
      hover.hidden = !on;
      pos.textContent = inside(p) ? `${p.x + 1}, ${p.y + 1}` : '';
      if (on) hover.style.transform = `translate(${p.x * zoom}px, ${p.y * zoom}px)`;
      stage.style.cursor = !space && !pan && tool === 'move' && inSel(p) ? 'move' : '';
    }

    stage.addEventListener('pointerdown', (e) => {
      if (e.target === stage) return;                 // Rollbalken
      win.el.focus({ preventScroll: true });
      if (e.button === 1 || (e.button === 0 && space)) {
        e.preventDefault();
        try { stage.setPointerCapture(e.pointerId); } catch { /* egal */ }
        pan = { pid: e.pointerId, x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop };
        stage.classList.add('is-panning');
        hover.hidden = true;
        return;
      }
      if ((e.button !== 0 && e.button !== 2) || stroke || pan) return;
      e.preventDefault();
      try { stage.setPointerCapture(e.pointerId); } catch { /* egal */ }
      startStroke(e);
    });
    stage.addEventListener('pointermove', (e) => {
      if (pan && e.pointerId === pan.pid) {
        stage.scrollLeft = pan.sl - (e.clientX - pan.x);
        stage.scrollTop = pan.st - (e.clientY - pan.y);
        return;
      }
      showHover(e);
      if (stroke && e.pointerId === stroke.pid) moveStroke(e);
    });
    const release = (cancel) => (e) => {
      if (pan && e.pointerId === pan.pid) { pan = null; stage.classList.remove('is-panning'); return; }
      if (stroke && e.pointerId === stroke.pid) endStroke(cancel);
    };
    stage.addEventListener('pointerup', release(false));
    stage.addEventListener('pointercancel', release(true));
    stage.addEventListener('pointerleave', () => { hover.hidden = true; pos.textContent = ''; });
    stage.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
    stage.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      wheelAcc += e.deltaY;
      if (Math.abs(wheelAcc) < 40) return;
      const dir = wheelAcc < 0 ? 1 : -1;
      wheelAcc = 0;
      stepZoom(dir, e);
    }, { passive: false });
    // Nach Mausklicks auf Knöpfe gehört die Tastatur wieder der Leinwand (Leertaste = Verschieben der Ansicht)
    root.addEventListener('click', (e) => { if (e.detail > 0 && e.target.closest('button')) win.el.focus({ preventScroll: true }); });

    // ---------- Bild-Operationen ----------
    function transform(fn) {
      if (stroke) return;
      sel = null;
      pushUndo();
      for (let l = 0; l < doc.layers.length; l++) fn(mut(fi, l), n);
      paintSel();
      paintLayerThumbs();
      touched();
    }
    function clearLayer() {
      if (stroke || !visible()) return;
      const cel = doc.frames[fi].cels[li];
      if (!cel.some((v) => v)) return;
      sel = null;
      pushUndo();
      mut().fill(0);
      paintSel();
      touched();
    }

    // ---------- Ebenen ----------
    function freeName() {
      const names = new Set(doc.layers.map((l) => l.name));
      let k = doc.layers.length + 1;
      while (names.has(`Ebene ${k}`)) k++;
      return `Ebene ${k}`;
    }
    function pickLayer(l) {
      if (l === li || stroke) return;
      anchor();
      li = l;
      [...layerList.children].forEach((row, i) => {
        const on = doc.layers.length - 1 - i === li;
        row.classList.toggle('is-on', on);
        if (on) row.lastChild.setAttribute('aria-current', 'true'); else row.lastChild.removeAttribute('aria-current');
      });
      sync();
    }
    function addLayer() {
      if (stroke || doc.layers.length >= MAX_LAYERS) return;
      anchor();
      pushUndo();
      const at = li + 1;
      doc.layers.splice(at, 0, { id: uid(), name: freeName(), visible: true });
      for (const f of doc.frames) f.cels.splice(at, 0, new Uint8ClampedArray(n * n * 4));
      li = at;
      structure();
    }
    function dupLayer() {
      if (stroke || doc.layers.length >= MAX_LAYERS) return;
      anchor();
      pushUndo();
      doc.layers.splice(li + 1, 0, { id: uid(), name: `${doc.layers[li].name} Kopie`.slice(0, 40), visible: true });
      for (const f of doc.frames) f.cels.splice(li + 1, 0, f.cels[li].slice());
      li++;
      structure();
    }
    function delLayer() {
      if (stroke || doc.layers.length < 2) return;
      anchor();
      pushUndo();
      doc.layers.splice(li, 1);
      for (const f of doc.frames) f.cels.splice(li, 1);
      li = Math.max(0, li - 1);
      structure();
    }
    function moveLayer(d) {
      const to = li + d;
      if (stroke || to < 0 || to >= doc.layers.length) return;
      anchor();
      pushUndo();
      [doc.layers[li], doc.layers[to]] = [doc.layers[to], doc.layers[li]];
      for (const f of doc.frames) [f.cels[li], f.cels[to]] = [f.cels[to], f.cels[li]];
      li = to;
      structure();
    }
    function mergeDown() {
      if (stroke || li < 1) return;
      anchor();
      pushUndo();
      for (const f of doc.frames) {
        const low = f.cels[li - 1].slice(), up = f.cels[li];
        for (let i = 0; i < up.length; i += 4) if (up[i + 3]) over(low, i, up[i], up[i + 1], up[i + 2], up[i + 3]);
        f.cels.splice(li - 1, 2, low);
      }
      doc.layers.splice(li, 1);
      li--;
      structure();
    }
    function toggleLayer(l) {
      if (stroke) return;
      doc.layers[l].visible = !doc.layers[l].visible;
      paintLayers();
      paintFrameThumbs();
      touched();
    }
    async function renameLayer(l) {
      const L = doc.layers[l];
      const v = await promptSheet(win, { title: 'Ebene umbenennen', value: L.name, placeholder: 'Name der Ebene' });
      if (!v || v === L.name || !doc.layers.includes(L)) return;
      pushUndo();
      doc.layers[doc.layers.indexOf(L)].name = v.slice(0, 40);
      structure();
    }
    const layerMenu = () => [
      { label: 'Neue Ebene', icon: 'plus', disabled: doc.layers.length >= MAX_LAYERS, run: addLayer },
      { label: 'Duplizieren', icon: 'copy', disabled: doc.layers.length >= MAX_LAYERS, run: dupLayer },
      { label: 'Umbenennen …', run: () => renameLayer(li) },
      '-',
      { label: 'Nach oben', disabled: li >= doc.layers.length - 1, run: () => moveLayer(1) },
      { label: 'Nach unten', disabled: li <= 0, run: () => moveLayer(-1) },
      { label: 'Mit unterer zusammenführen', disabled: li <= 0, run: mergeDown },
      { label: 'Leeren', icon: 'eraser', run: clearLayer },
      '-',
      { label: 'Löschen', icon: 'trash', disabled: doc.layers.length < 2, run: delLayer },
    ];

    // ---------- Einzelbilder ----------
    function pickFrame(i) {
      if (i === fi || stroke) return;
      anchor();
      fi = i;
      frameEls.forEach((el, k) => {
        el.classList.toggle('is-on', k === fi);
        if (k === fi) el.setAttribute('aria-current', 'true'); else el.removeAttribute('aria-current');
      });
      showFrame();
      paintLayerThumbs();
      pending = true;
      save();
      render();
    }
    function addFrame() {
      if (stroke || doc.frames.length >= MAX_FRAMES) return;
      anchor();
      pushUndo();
      doc.frames.splice(fi + 1, 0, { id: uid(), cels: doc.layers.map(() => new Uint8ClampedArray(n * n * 4)) });
      fi++;
      structure();
    }
    function dupFrame() {
      if (stroke || doc.frames.length >= MAX_FRAMES) return;
      anchor();
      pushUndo();
      doc.frames.splice(fi + 1, 0, { id: uid(), cels: doc.frames[fi].cels.map((c) => c.slice()) });
      fi++;
      structure();
    }
    function delFrame() {
      if (stroke || doc.frames.length < 2) return;
      anchor();
      pushUndo();
      doc.frames.splice(fi, 1);
      fi = Math.min(fi, doc.frames.length - 1);
      if (doc.frames.length < 2) stopPlay();
      structure();
    }
    function moveFrame(d) {
      const to = fi + d;
      if (stroke || to < 0 || to >= doc.frames.length) return;
      anchor();
      pushUndo();
      [doc.frames[fi], doc.frames[to]] = [doc.frames[to], doc.frames[fi]];
      fi = to;
      structure();
    }
    const frameMenu = () => [
      { label: 'Neues Einzelbild', icon: 'plus', disabled: doc.frames.length >= MAX_FRAMES, run: addFrame },
      { label: 'Duplizieren', icon: 'copy', disabled: doc.frames.length >= MAX_FRAMES, run: dupFrame },
      '-',
      { label: 'Nach vorn', icon: 'arrowLeft', disabled: fi <= 0, run: () => moveFrame(-1) },
      { label: 'Nach hinten', icon: 'arrowRight', disabled: fi >= doc.frames.length - 1, run: () => moveFrame(1) },
      '-',
      { label: 'Löschen', icon: 'trash', disabled: doc.frames.length < 2, run: delFrame },
    ];

    // ---------- Animation ----------
    const markPlay = (i) => frameEls.forEach((el, k) => el.classList.toggle('is-play', k === i));
    function tick() {
      if (win.min || !doc) return;
      playIdx = (playIdx + 1) % doc.frames.length;
      paintPreview(compose(doc, doc.frames[playIdx], tmp));
      markPlay(playIdx);
    }
    function startPlay() {
      if (playing || doc.frames.length < 2) return;
      playing = true;
      playIdx = fi;
      side = true;
      playTimer = setInterval(tick, 1000 / doc.fps);
      markPlay(playIdx);
      sync();
      paintOnion();
    }
    function stopPlay() {
      if (!playing) return;
      playing = false;
      clearInterval(playTimer);
      markPlay(-1);
      sync();
      render();
    }
    const togglePlay = () => (playing ? stopPlay() : startPlay());
    function setFps(v) {
      v = clamp(v, 1, 24);
      if (v === doc.fps) return;
      doc.fps = v;
      if (playing) { clearInterval(playTimer); playTimer = setInterval(tick, 1000 / v); }
      pending = true;
      dirty = true;
      title();
      sync();
      save();
    }

    // ---------- Tastatur ----------
    const keyTool = Object.fromEntries(TOOLS.map(([id, , key]) => [key.toLowerCase(), id]));
    const onKey = (e) => {
      if (e.target.closest('input, textarea, select, [contenteditable]')) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (e.metaKey || e.ctrlKey) {
        const act = {
          z: () => (e.shiftKey ? doRedo() : doUndo()), y: doRedo,
          s: () => saveProject(e.shiftKey), o: openFile, e: exportDialog,
          a: selectAll, d: deselect, c: () => copySel(false), x: () => copySel(true), v: paste,
        }[k];
        if (act) { e.preventDefault(); act(); }
        return;
      }
      if (e.altKey) return;
      if (k === ' ') {
        if (e.target.closest('button')) return;
        e.preventDefault();
        if (!space) { space = true; hover.hidden = true; sync(); }
        return;
      }
      const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
      if (arrow) {
        if (e.target.closest('[role="slider"]') || (!sel && tool !== 'move')) return;
        e.preventDefault();
        nudge(arrow[0], arrow[1]);
        return;
      }
      const act = keyTool[k] ? () => setTool(keyTool[k]) : {
        x: swapColors,
        f: () => { filled = !filled; sync(); },
        h: () => { mirX = !mirX; sync(); },
        v: () => { mirY = !mirY; sync(); },
        p: togglePlay,
        '#': toggleGrid,
        '+': () => stepZoom(1), '=': () => stepZoom(1), '-': () => stepZoom(-1),
        0: () => { autoFit = true; fit(); },
        ',': () => pickFrame((fi - 1 + doc.frames.length) % doc.frames.length),
        '.': () => pickFrame((fi + 1) % doc.frames.length),
        Delete: deleteSel, Backspace: deleteSel,
        Escape: () => { if (stroke) endStroke(true); else if (sel) deselect(); },
      }[k];
      if (act) { e.preventDefault(); act(); }
    };
    const onKeyUp = (e) => { if (e.key === ' ' && space) { space = false; sync(); } };
    const onBlur = () => { if (space) { space = false; sync(); } };
    win.el.addEventListener('keydown', onKey);
    win.el.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    const ro = new ResizeObserver(() => { if (autoFit) fit(); showFrame(); });
    ro.observe(stage);

    // ---------- Start ----------
    let init = null;
    if (solo) {
      const saved = db.get('doc', null);
      if (saved) {
        try { init = [deserialize(saved), { name: saved.name, path: saved.path, dirty: saved.dirty, fi: saved.fi, li: saved.li }]; } catch { init = null; }
      }
      if (!init && !db.get('seeded', false)) init = [sample(), { name: 'Keimling' }];
    }
    db.set('seeded', true);
    paintChips();
    setDoc(...(init || [blank(32)]));
    // Mit einer Datei gestartet: Lässt sie sich nicht öffnen, bleibt kein leeres Fenster zurück
    if (args.path) load(args.path).then((ok) => { if (!ok && !init && !closed) win.close(); });

    const flipItems = () => [
      { label: 'Horizontal spiegeln', run: () => transform(flipH) },
      { label: 'Vertikal spiegeln', run: () => transform(flipV) },
      { label: '90° nach rechts drehen', icon: 'reload', run: () => transform((px, s) => rotate(px, s, true)) },
      { label: '90° nach links drehen', run: () => transform((px, s) => rotate(px, s, false)) },
      '-',
      { heading: 'Um einen Pixel verschieben' },
      { label: 'Nach links', icon: 'arrowLeft', run: () => transform((px, s) => shiftPx(px, s, -1, 0)) },
      { label: 'Nach rechts', icon: 'arrowRight', run: () => transform((px, s) => shiftPx(px, s, 1, 0)) },
      { label: 'Nach oben', run: () => transform((px, s) => shiftPx(px, s, 0, -1)) },
      { label: 'Nach unten', run: () => transform((px, s) => shiftPx(px, s, 0, 1)) },
    ];

    return {
      onClose() {
        closed = true;
        clearInterval(playTimer);
        cancelAnimationFrame(raf);
        ro.disconnect();
        window.removeEventListener('blur', onBlur);
        if (pending) persist();
        live--;
      },
      onArgs: (a) => { if (a?.path) load(a.path); },
      menus: () => [
        {
          label: 'Projekt',
          items: [
            { label: 'Neues Bild …', icon: 'plus', run: newDoc },
            { label: 'Öffnen …', icon: 'folder', hint: '⌘O', run: openFile },
            '-',
            { label: 'Sichern', hint: '⌘S', run: () => saveProject(false) },
            { label: 'Sichern unter …', hint: '⇧⌘S', run: () => saveProject(true) },
            { label: 'Als PNG exportieren …', icon: 'external', hint: '⌘E', run: exportDialog },
          ],
        },
        {
          label: 'Bearbeiten',
          items: [
            { label: 'Rückgängig', icon: 'undo', hint: '⌘Z', disabled: !undo.length, run: doUndo },
            { label: 'Wiederholen', icon: 'redo', hint: '⇧⌘Z', disabled: !redo.length, run: doRedo },
            '-',
            { label: 'Ausschneiden', hint: '⌘X', disabled: !sel, run: () => copySel(true) },
            { label: 'Kopieren', icon: 'copy', hint: '⌘C', disabled: !sel, run: () => copySel(false) },
            { label: 'Einfügen', hint: '⌘V', disabled: !clipboard, run: paste },
            '-',
            { label: 'Alles auswählen', hint: '⌘A', run: selectAll },
            { label: 'Auswahl aufheben', hint: '⌘D', disabled: !sel, run: deselect },
            { label: 'Auswahl löschen', hint: '⌫', disabled: !sel, run: deleteSel },
            '-',
            { label: 'Ebene leeren', icon: 'eraser', run: clearLayer },
          ],
        },
        {
          label: 'Bild',
          items: [
            ...flipItems(),
            '-',
            { heading: 'Ebene' },
            ...layerMenu().filter((it) => it !== '-' && it.label !== 'Leeren'),
            '-',
            { heading: 'Einzelbild' },
            ...frameMenu().filter((it) => it !== '-'),
          ],
        },
        {
          label: 'Ansicht',
          items: [
            { label: 'Vergrößern', hint: '+', run: () => stepZoom(1) },
            { label: 'Verkleinern', hint: '−', run: () => stepZoom(-1) },
            { label: 'Einpassen', hint: '0', run: () => { autoFit = true; fit(); } },
            '-',
            { label: 'Raster', hint: '#', checked: grid, run: toggleGrid },
            { label: 'Zwiebelhaut', checked: onion, run: toggleOnion },
            { label: 'Seitenleiste', checked: side, run: () => { side = !side; sync(); } },
            '-',
            { label: playing ? 'Animation anhalten' : 'Animation abspielen', hint: 'P', disabled: doc.frames.length < 2, run: togglePlay },
          ],
        },
      ].map((m) => ({ ...m, items: refocus(m.items) })),
    };
  },
};
