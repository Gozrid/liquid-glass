// colors.js — Farben: Farbwähler mit HEX/RGB/HSL/OKLCH, Harmonien, Kontrast-Prüfer, Paletten und Verlaufs-Werkstatt

import { h, clamp, debounce, reducedMotion } from '../../../core/util.js';
import { icon } from '../../../core/icons.js';
import { initControls } from '../../../core/controls.js';
import { vfs, HOME } from '../../vfs.js';
import { openMenu } from '../../ui.js';
import { style, appStore, toolBtn, emptyState, toast, confirmSheet, promptSheet, saveDialog } from '../../kit.js';

// ==========================================================================
// Farbmathe — rein rechnerisch, ohne DOM. RGB-Werte sind Tripel in 0…1, Farbton in Grad.
// sRGB ↔ HSV/HSL, sRGB ↔ OKLab/OKLCH (Matrizen nach Björn Ottosson), WCAG-Kontrast.
// ==========================================================================
/* >>> farbmathe */
const c01 = (x) => Math.min(1, Math.max(0, x));
const q8 = (x) => Math.round(c01(x) * 255);
const snap8 = (rgb) => rgb.map((x) => q8(x) / 255);
const mod360 = (x) => ((x % 360) + 360) % 360;
const trim = (x, d) => String(Number(x.toFixed(d)));
const deg = (x, d) => { const v = Number(mod360(x).toFixed(d)); return String(v >= 360 ? 0 : v); };
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hsvToRgb(hue, s, v) {
  const f = (n) => { const k = (n + hue / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}
function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let hue = 0;
  if (d > 0) {
    hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue = mod360(hue * 60);
  }
  return [hue, max > 0 ? d / max : 0, max];
}
function hsvToHsl(hue, s, v) {
  const l = v * (1 - s / 2);
  return [hue, l > 0 && l < 1 ? (v - l) / Math.min(l, 1 - l) : 0, l];
}
function hslToHsv(hue, s, l) {
  const v = l + s * Math.min(l, 1 - l);
  return [hue, v > 0 ? 2 * (1 - l / v) : 0, v];
}
const hslToRgb = (hue, s, l) => hsvToRgb(...hslToHsv(hue, s, l));
const rgbToHsl = (r, g, b) => hsvToHsl(...rgbToHsv(r, g, b));

function linToOklab(lr, lg, lb) {
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}
function rgbToOklch(r, g, b) {
  const [L, A, B] = linToOklab(toLin(r), toLin(g), toLin(b));
  const C = Math.hypot(A, B);
  return [L, C, C < 1e-5 ? 0 : mod360((Math.atan2(B, A) * 180) / Math.PI)];
}
function oklchToLin(L, C, H) {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}
/**
 * OKLCH → sRGB. Farben außerhalb von sRGB werden wie in CSS Color 4 abgebildet: Chroma bei gleichem L und H
 * reduzieren (Intervallhalbierung), bis das Abschneiden auf den Farbraum nicht mehr sichtbar ist (ΔE_OK < 0,02).
 * `clipped` meldet, ob die Eingabe merklich außerhalb lag.
 */
function oklchToRgb(L, C, H) {
  L = c01(L);
  C = Math.max(0, C);
  if (L >= 1) return { rgb: [1, 1, 1], clipped: C > 0.002 };
  if (L <= 0) return { rgb: [0, 0, 0], clipped: C > 0.002 };
  const JND = 0.02, EPS = 1e-4;
  const ca = Math.cos((H * Math.PI) / 180), sa = Math.sin((H * Math.PI) / 180);
  const inside = (v) => v.every((x) => x >= -1e-7 && x <= 1 + 1e-7);
  const cut = (v) => v.map(c01);
  const dist = (v, ch) => { const [l2, a2, b2] = linToOklab(...cut(v)); return Math.hypot(l2 - L, a2 - ch * ca, b2 - ch * sa); };
  const out = (v, clipped) => ({ rgb: cut(v).map((x) => c01(toGam(x))), clipped });
  let lin = oklchToLin(L, C, H);
  if (inside(lin)) return out(lin, false);
  const e0 = dist(lin, C);
  if (e0 < JND) return out(lin, e0 > 0.002);
  let min = 0, max = C, minInside = true;
  while (max - min > EPS) {
    const ch = (min + max) / 2;
    lin = oklchToLin(L, ch, H);
    if (minInside && inside(lin)) { min = ch; continue; }
    const e = dist(lin, ch);
    if (e < JND) {
      if (JND - e < EPS) break;
      minInside = false;
      min = ch;
    } else max = ch;
  }
  return out(lin, true);
}

function rgbToHex(r, g, b, a = 1) {
  const p = (x) => q8(x).toString(16).padStart(2, '0');
  return `#${p(r)}${p(g)}${p(b)}${a < 1 ? p(a) : ''}`.toUpperCase();
}

// ---------- Eingaben lesen: jeweils {rgb, a, hsv?, clipped?} oder null ----------
function parseHex(str) {
  let s = String(str).trim().replace(/^#/, '');
  if (!/^([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return null;
  if (s.length <= 4) s = s.replace(/./g, '$&$&');
  const n = (i) => parseInt(s.slice(i, i + 2), 16) / 255;
  return { rgb: [n(0), n(2), n(4)], a: s.length === 8 ? n(6) : 1 };
}
/** Zerlegt „fn(a, b, c / d)“ oder blanke Zahlen „a b c“ in 3–4 Teile. */
function parts(str, fn) {
  let s = String(str).trim().toLowerCase().replace(/;$/, '').trim();
  const m = new RegExp(`^${fn}a?\\s*\\((.*)\\)$`).exec(s);
  if (m) s = m[1];
  else if (/[()a-z]/.test(s.replace(/deg|none/g, ''))) return null;
  const t = s.split(/[\s,/]+/).filter(Boolean);
  return t.length === 3 || t.length === 4 ? t : null;
}
/** „50%“ → 0.5 · pct, „128“ → 128 · plain */
function numOf(t, pct = 1, plain = 1) {
  const m = /^(-?(?:\d+\.?\d*|\.\d+))(%?)$/.exec(t);
  if (!m) return NaN;
  return m[2] ? (Number(m[1]) / 100) * pct : Number(m[1]) * plain;
}
const alphaOf = (t) => (t === undefined ? 1 : c01(numOf(t)));
function parseRgb(str) {
  const t = parts(str, 'rgb');
  if (!t) return null;
  const v = t.slice(0, 3).map((x) => numOf(x, 255) / 255);
  const a = alphaOf(t[3]);
  return [...v, a].some(Number.isNaN) ? null : { rgb: v.map(c01), a };
}
function parseHsl(str) {
  const t = parts(str, 'hsl');
  if (!t) return null;
  const hue = numOf(t[0].replace(/deg$/, ''), 360);
  const s = numOf(t[1], 1, 0.01), l = numOf(t[2], 1, 0.01);
  const a = alphaOf(t[3]);
  if ([hue, s, l, a].some(Number.isNaN)) return null;
  const hsv = hslToHsv(mod360(hue), c01(s), c01(l));
  return { rgb: hsvToRgb(...hsv), a, hsv };
}
function parseOklch(str) {
  const t = parts(str, 'oklch');
  if (!t) return null;
  let L = numOf(t[0]);
  if (!t[0].endsWith('%') && L > 1) L /= 100;
  const C = numOf(t[1], 0.4);
  const H = t[2] === 'none' ? 0 : numOf(t[2].replace(/deg$/, ''), 360);
  const a = alphaOf(t[3]);
  if ([L, C, H, a].some(Number.isNaN) || C < 0 || L < 0) return null;
  return { ...oklchToRgb(L, C, mod360(H)), a };
}
function parseAny(str) {
  const s = String(str).trim().toLowerCase();
  return s.startsWith('rgb') ? parseRgb(s) : s.startsWith('hsl') ? parseHsl(s) : s.startsWith('oklch') ? parseOklch(s) : parseHex(s);
}

// ---------- Ausgaben: alle Formate beschreiben exakt die 8-Bit-Farbe des HEX-Werts ----------
const fmtHex = (rgb, a = 1) => rgbToHex(...rgb, a);
function fmtRgb(rgb, a = 1) {
  const v = rgb.map(q8).join(', ');
  return a < 1 ? `rgba(${v}, ${trim(a, 2)})` : `rgb(${v})`;
}
function fmtHsl(rgb, a = 1, hueHint = null) {
  let [hue, s, l] = rgbToHsl(...snap8(rgb));
  if (s === 0 && hueHint != null) hue = hueHint;
  const body = `${deg(hue, 1)}, ${trim(s * 100, 1)}%, ${trim(l * 100, 1)}%`;
  return a < 1 ? `hsla(${body}, ${trim(a, 2)})` : `hsl(${body})`;
}
function fmtOklch(rgb, a = 1) {
  const [L, C, H] = rgbToOklch(...snap8(rgb));
  return `oklch(${trim(L * 100, 2)}% ${trim(C, 4)} ${C < 5e-5 ? 0 : deg(H, 2)}${a < 1 ? ` / ${trim(a, 2)}` : ''})`;
}

// ---------- WCAG 2 ----------
const luminance = (rgb) => 0.2126 * toLin(rgb[0]) + 0.7152 * toLin(rgb[1]) + 0.0722 * toLin(rgb[2]);
function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/**
 * Nächstliegende Farbe mit gleichem Farbton und gleicher Sättigung (nur die HSL-Helligkeit wandert),
 * die gegen `other` mindestens `target` erreicht. null, wenn `rgb` schon besteht.
 */
function suggest(rgb, other, target) {
  if (contrast(rgb, other) >= target) return null;
  const [hue, s, l] = rgbToHsl(...rgb);
  const at = (x) => snap8(hslToRgb(hue, s, x));
  const passes = (x) => contrast(at(x), other) >= target;
  const search = (end) => {
    if (!passes(end)) return null;
    let lo = l, hi = end;              // lo besteht nicht, hi besteht
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (passes(mid)) hi = mid; else lo = mid;
    }
    return hi;
  };
  const cands = [search(1), search(0)].filter((x) => x != null);
  if (!cands.length) return null;
  cands.sort((a, b) => Math.abs(a - l) - Math.abs(b - l));
  return at(cands[0]);
}

// ---------- Abstufungen 50–950: Helligkeitsleiter in OKLCH, die Basis sitzt auf ihrer nächsten Stufe ----------
const SCALE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const SCALE_L = [0.975, 0.945, 0.89, 0.815, 0.72, 0.625, 0.535, 0.45, 0.37, 0.295, 0.2];
const SCALE_C = [0.14, 0.28, 0.5, 0.74, 0.92, 1, 1, 0.92, 0.8, 0.66, 0.5];
function scale11(rgb) {
  const [L, C, H] = rgbToOklch(...rgb);
  let bi = 0;
  SCALE_L.forEach((x, i) => { if (Math.abs(x - L) < Math.abs(SCALE_L[bi] - L)) bi = i; });
  return SCALE_STEPS.map((step, i) => (i === bi
    ? { step, rgb: snap8(rgb), base: true }
    : { step, rgb: snap8(oklchToRgb(SCALE_L[i], C * Math.min(1.6, SCALE_C[i] / SCALE_C[bi]), H).rgb), base: false }));
}

/** Grober deutscher Name für eine Farbe („Dunkelblau“, „Hellgrau“ …). */
function nameFor(rgb) {
  const [hue, s, l] = rgbToHsl(...rgb);
  if (l < 0.05) return 'Schwarz';
  if (l > 0.96) return 'Weiß';
  if (s < 0.1) return l < 0.3 ? 'Dunkelgrau' : l > 0.7 ? 'Hellgrau' : 'Grau';
  const n = [[11, 'Rot'], [42, 'Orange'], [68, 'Gelb'], [165, 'Grün'], [195, 'Türkis'], [255, 'Blau'], [290, 'Violett'], [342, 'Pink'], [361, 'Rot']].find(([end]) => hue < end)[1];
  if (n === 'Orange' && l < 0.36) return 'Braun';
  return l < 0.28 ? `Dunkel${n.toLowerCase()}` : l > 0.76 ? `Hell${n.toLowerCase()}` : n;
}

/** Farbe eines Verlaufs an Position pos (0–100); stops sortiert, gemischt wie in CSS (sRGB). */
function mixAt(stops, pos) {
  const rgb = (s) => parseHex(s.hex).rgb;
  if (pos <= stops[0].pos) return rgb(stops[0]);
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    if (pos > b.pos) continue;
    const t = b.pos === a.pos ? 1 : (pos - a.pos) / (b.pos - a.pos);
    const A = rgb(a), B = rgb(b);
    return A.map((x, k) => x + (B[k] - x) * t);
  }
  return rgb(stops[stops.length - 1]);
}
/* <<< farbmathe */

// ==========================================================================
// Daten
// ==========================================================================
const TABS = [['pick', 'Wähler'], ['harm', 'Harmonien'], ['contrast', 'Kontrast'], ['pal', 'Paletten'], ['grad', 'Verlauf']];
const FORMATS = [['hex', 'HEX', parseHex], ['rgb', 'RGB', parseRgb], ['hsl', 'HSL', parseHsl], ['oklch', 'OKLCH', parseOklch]];
const MAX_COLORS = 48;
const MAX_PALETTES = 40;
const MAX_STOPS = 5;
const INK = [11 / 255, 16 / 255, 48 / 255];

const uid = () => Math.random().toString(36).slice(2, 10);
const normHex = (hex) => rgbToHex(...parseHex(hex).rgb);
const hexRgb = (hex) => parseHex(hex).rgb;
const ink = (hex) => (contrast(hexRgb(hex), [1, 1, 1]) >= contrast(hexRgb(hex), INK) ? '#fff' : '#0b1030');
const ratioText = (r) => (Math.floor(r * 100) / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const slug = (s) => String(s).toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const samples = () => [
  ['Glas', [['Koralle', '#FF6A3D'], ['Bernstein', '#FFB65C'], ['Violett', '#A06BFF'], ['Himmel', '#45C8FF'], ['Minze', '#3FE0B0'], ['Tinte', '#0B1030']]],
  ['Nordlicht', [['Polarnacht', '#0B132B'], ['Fjord', '#1C2541'], ['Gletscher', '#3A506B'], ['Schimmer', '#5BC0BE'], ['Eisblume', '#C9F0EC'], ['Leuchten', '#B4F461']]],
  ['Sandstein', [['Kreide', '#F4EDE4'], ['Düne', '#E3CBA8'], ['Ocker', '#C99B5B'], ['Terrakotta', '#B5613C'], ['Umbra', '#5E3B2B'], ['Kohle', '#2A2320']]],
  ['Obstkorb', [['Kirsche', '#D7263D'], ['Aprikose', '#F9A03F'], ['Zitrone', '#F7E733'], ['Limette', '#7BC950'], ['Blaubeere', '#2E4A8B'], ['Pflaume', '#6B2D5C']]],
].map(([name, colors]) => ({ id: uid(), name, colors: colors.map(([n, hex]) => ({ id: uid(), name: n, hex })) }));

const defaultGrad = () => {
  const stops = [['#FF6A3D', 0], ['#A06BFF', 55], ['#45C8FF', 100]].map(([hex, pos]) => ({ id: uid(), hex, pos }));
  return { type: 'linear', angle: 135, stops, sel: stops[0].id };
};

/** Liest den gespeicherten Zustand und repariert alles, was nicht passt. */
function loadState(db) {
  const raw = db.get('state', null);
  const r = raw && typeof raw === 'object' ? raw : {};
  const fin = (x, fb, a, b) => (Number.isFinite(x) ? clamp(x, a, b) : fb);
  const hexOr = (x, fb) => (typeof x === 'string' && parseHex(x) ? normHex(x) : fb);
  const col = r.color && typeof r.color === 'object' ? r.color : {};
  const palettes = Array.isArray(r.palettes)
    ? r.palettes.filter((p) => p && typeof p === 'object').slice(0, MAX_PALETTES).map((p) => ({
      id: typeof p.id === 'string' ? p.id : uid(),
      name: String(p.name || 'Palette').slice(0, 60),
      colors: (Array.isArray(p.colors) ? p.colors : []).filter((c) => c && typeof c.hex === 'string' && parseHex(c.hex)).slice(0, MAX_COLORS)
        .map((c) => ({ id: typeof c.id === 'string' ? c.id : uid(), hex: normHex(c.hex), name: String(c.name || '').slice(0, 40) })),
    }))
    : samples();
  let grad = defaultGrad();
  if (r.grad && typeof r.grad === 'object' && Array.isArray(r.grad.stops)) {
    const stops = r.grad.stops.filter((s) => s && typeof s.hex === 'string' && parseHex(s.hex)).slice(0, MAX_STOPS)
      .map((s) => ({ id: typeof s.id === 'string' ? s.id : uid(), hex: normHex(s.hex), pos: Math.round(fin(s.pos, 0, 0, 100)) }));
    if (stops.length >= 2) {
      grad = {
        type: ['linear', 'radial', 'conic'].includes(r.grad.type) ? r.grad.type : 'linear',
        angle: Math.round(fin(r.grad.angle, 135, 0, 360)),
        stops,
        sel: stops.some((s) => s.id === r.grad.sel) ? r.grad.sel : stops[0].id,
      };
    }
  }
  return {
    tab: TABS.some(([id]) => id === r.tab) ? r.tab : 'pick',
    color: { h: fin(col.h, 14, 0, 360), s: fin(col.s, 0.76, 0, 1), v: fin(col.v, 1, 0, 1), a: fin(col.a, 1, 0, 1) },
    recent: Array.isArray(r.recent) ? r.recent.map((x) => hexOr(x, null)).filter(Boolean).slice(0, 12) : [],
    fg: hexOr(r.fg, '#0B1030'),
    bg: hexOr(r.bg, '#F4EDE4'),
    active: r.active === 'bg' ? 'bg' : 'fg',
    palettes,
    pal: palettes.some((p) => p.id === r.pal) ? r.pal : palettes[0]?.id || null,
    grad,
  };
}

// ---------- Ausgaben für Paletten und Verläufe ----------
function paletteCss(p) {
  const used = new Set();
  const lines = p.colors.map((c, i) => {
    const base = slug(c.name) || `${slug(p.name) || 'farbe'}-${i + 1}`;
    let name = base;
    for (let k = 2; used.has(name); k++) name = `${base}-${k}`;
    used.add(name);
    return `  --${name}: ${c.hex.toLowerCase()};`;
  });
  return `/* ${p.name.replace(/\*\//g, '* /')} */\n:root {\n${lines.join('\n')}\n}\n`;
}
const paletteJson = (p) => `${JSON.stringify({ name: p.name, colors: p.colors.map((c) => ({ name: c.name, hex: c.hex.toLowerCase() })) }, null, 2)}\n`;
function gradCss(g, flat = false) {
  const st = [...g.stops].sort((a, b) => a.pos - b.pos).map((s) => `${s.hex.toLowerCase()} ${s.pos}%`).join(', ');
  if (flat) return `linear-gradient(to right, ${st})`;
  if (g.type === 'radial') return `radial-gradient(circle, ${st})`;
  if (g.type === 'conic') return `conic-gradient(from ${g.angle}deg, ${st})`;
  return `linear-gradient(${g.angle}deg, ${st})`;
}

function legacyCopy(text) {
  const ta = h('textarea', { value: text, readOnly: true, style: { position: 'fixed', left: '-999px', top: '0', opacity: '0' } });
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* nicht erlaubt */ }
  ta.remove();
  return ok;
}

const svg = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const I_PIPETTE = svg('<path d="M4.5 19.5l1-3.5L14 7.5l2.5 2.5L8 18.5z"/><path d="M12.5 6l5.5 5.5"/><path d="M14 7.5l2.6-2.6a1.77 1.77 0 0 1 2.5 2.5L16.5 10"/>');
const I_SWAP = svg('<path d="M7 4.5L3.5 8 7 11.5M3.5 8h13M17 12.5l3.500 3.500-3.500 3.500M20.500 16h-13"/>');

// ==========================================================================
// Farbfläche + Regler (wird im Wähler, im Kontrast-Prüfer und in der Verlaufs-Werkstatt benutzt)
// ==========================================================================
/** Übernimmt RGB als HSV; bei Grau bzw. Schwarz bleiben Farbton bzw. Sättigung des Vorgängers stehen. */
function hsvKeep(rgb, prev, a = 1) {
  const [hue, s, v] = rgbToHsv(...rgb);
  return { h: s === 0 || v === 0 ? prev.h : hue, s: v === 0 ? prev.s : s, v, a };
}

function makePicker({ alpha = false, onInput }) {
  let c = { h: 0, s: 0, v: 1, a: 1 };
  const sv = h('div.colors-sv', { tabIndex: 0, role: 'slider', 'aria-label': 'Sättigung und Helligkeit' }, h('i'));
  const hue = h('div.colors-track.hue', { tabIndex: 0, role: 'slider', 'aria-label': 'Farbton', 'aria-valuemin': 0, 'aria-valuemax': 360 }, h('i'));
  const al = alpha ? h('div.colors-track.alpha', { tabIndex: 0, role: 'slider', 'aria-label': 'Deckkraft', 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i')) : null;
  const el = h('div.colors-picker', sv, hue, al);

  const paint = () => {
    el.style.setProperty('--hc', `hsl(${c.h} 100% 50%)`);
    el.style.setProperty('--c', rgbToHex(...hsvToRgb(c.h, c.s, c.v)));
    sv.style.setProperty('--s', c.s);
    sv.style.setProperty('--v', c.v);
    sv.setAttribute('aria-valuetext', `Sättigung ${Math.round(c.s * 100)} %, Helligkeit ${Math.round(c.v * 100)} %`);
    hue.style.setProperty('--p', c.h / 360);
    hue.setAttribute('aria-valuenow', Math.round(c.h));
    hue.setAttribute('aria-valuetext', `${Math.round(c.h)}°`);
    if (al) {
      al.style.setProperty('--p', c.a);
      al.setAttribute('aria-valuenow', Math.round(c.a * 100));
      al.setAttribute('aria-valuetext', `${Math.round(c.a * 100)} %`);
    }
  };
  const emit = () => { paint(); onInput({ ...c }); };

  // Zeiger: pad = halbe Griffbreite, damit der Griff an den Enden nicht übersteht
  const area = (node, pad, apply) => node.addEventListener('pointerdown', (e) => {
    if (e.button && e.pointerType === 'mouse') return;
    e.preventDefault();
    node.focus({ preventScroll: true });
    try { node.setPointerCapture(e.pointerId); } catch { /* egal */ }
    node.classList.add('is-drag');
    const at = (ev) => {
      const r = node.getBoundingClientRect();
      apply(clamp((ev.clientX - r.left - pad) / Math.max(1, r.width - pad * 2)), clamp((ev.clientY - r.top) / Math.max(1, r.height)));
      emit();
    };
    const up = () => {
      node.classList.remove('is-drag');
      node.removeEventListener('pointermove', at);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
    };
    node.addEventListener('pointermove', at);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    at(e);
  });
  area(sv, 0, (x, y) => { c.s = x; c.v = 1 - y; });
  area(hue, 10, (x) => { c.h = x * 360; });
  if (al) area(al, 10, (x) => { c.a = Math.round(x * 100) / 100; });

  // Pfeiltasten: 1 Schritt, mit Umschalt 10
  const keys = (node, apply) => node.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (!d || e.altKey || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    const k = e.shiftKey ? 10 : 1;
    apply(d[0] * k, d[1] * k);
    emit();
  });
  keys(sv, (dx, dy) => { c.s = clamp(Math.round(c.s * 100 + dx) / 100); c.v = clamp(Math.round(c.v * 100 + dy) / 100); });
  keys(hue, (dx, dy) => { c.h = mod360(Math.round(c.h) + dx + dy); });
  if (al) keys(al, (dx, dy) => { c.a = clamp(Math.round(c.a * 100 + dx + dy) / 100); });

  paint();
  return {
    el,
    get: () => ({ ...c }),
    set(n) { c = { h: n.h, s: n.s, v: n.v, a: n.a ?? 1 }; paint(); },
    setRgb(rgb, a = 1) { c = hsvKeep(rgb, c, a); paint(); },
  };
}

// ==========================================================================
// Stile
// ==========================================================================
style('colors', `
.colors { --chk: conic-gradient(#fff 25%, #cdd2e0 0 50%, #fff 0 75%, #cdd2e0 0) 0 0 / 12px 12px; }
.colors-bar { display: grid; grid-template-columns: 1fr auto 1fr; }
.colors-bar .gseg button { padding: .42em .95em; font-size: 12.5px; }
.colors-now { justify-self: end; display: inline-flex; align-items: center; gap: 7px; padding: 4px 11px 4px 5px; border: 0; border-radius: 99px; background: var(--raise); font-size: 12px; font-weight: 600; color: var(--fg-2); transition: transform .4s var(--spring), background-color .15s; }
.colors-now:hover { background: var(--raise-2); }
.colors-now:active { transform: scale(.95); }
.colors-now i { width: 18px; height: 18px; border-radius: 50%; background: linear-gradient(var(--c), var(--c)), var(--chk); box-shadow: inset 0 0 0 1px var(--line); }
.colors-view { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.colors-view > section { flex: 1; min-height: 0; min-width: 0; }
.colors-two { display: grid; grid-template-columns: minmax(0, 1fr) var(--right, 322px); grid-template-rows: minmax(0, 1fr); gap: 16px; padding: 14px 16px 16px; }
.colors-col { display: flex; flex-direction: column; gap: 12px; min-width: 0; min-height: 0; }
.colors-h { font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--fg-3); }
.colors .kit-field.is-bad { box-shadow: inset 0 0 0 1.5px var(--c-coral); }
.colors .kit-btn .ico { flex: none; }

/* Farbfläche und Regler */
.colors-picker { display: flex; flex-direction: column; flex: 1; gap: 14px; min-width: 0; min-height: 0; padding-bottom: 2px; }
.colors-sv { position: relative; flex: 1; min-height: 110px; border-radius: 14px; outline: 0; background: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, var(--hc, #f00)); box-shadow: inset 0 0 0 1px var(--line); cursor: crosshair; touch-action: none; }
.colors-sv i { position: absolute; left: clamp(7px, calc(var(--s, 0) * 100%), calc(100% - 7px)); top: clamp(7px, calc((1 - var(--v, 1)) * 100%), calc(100% - 7px)); width: 20px; height: 20px; margin: -10px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 2.5px #fff, 0 2px 8px rgba(0, 0, 0, .5); pointer-events: none; transition: scale .35s var(--spring); }
.colors-sv.is-drag i { scale: 1.3; }
.colors-sv:focus-visible i, .colors-track:focus-visible i { outline: 2px solid var(--accent); outline-offset: 4px; }
.colors-track { position: relative; flex: none; height: 16px; border-radius: 99px; outline: 0; box-shadow: inset 0 0 0 1px var(--line); cursor: pointer; touch-action: none; }
.colors-track.hue { background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); }
.colors-track.alpha { background: linear-gradient(to right, transparent, var(--c)), var(--chk); }
.colors-track i { position: absolute; top: 50%; left: calc(var(--p, 0) * (100% - 20px)); width: 20px; height: 20px; margin-top: -10px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 2.5px #fff, 0 2px 8px rgba(0, 0, 0, .45); pointer-events: none; transition: scale .35s var(--spring); }
.colors-track.hue i { background: var(--hc); }
.colors-track.is-drag i { scale: 1.25; }

/* Wähler */
.colors-preview { position: relative; flex: 1 1 86px; min-height: 86px; max-height: 230px; border-radius: 14px; background: linear-gradient(var(--c), var(--c)), var(--chk); box-shadow: inset 0 0 0 1px var(--line); color: var(--ink); }
.colors-preview b { position: absolute; left: 12px; top: 9px; font-size: 13px; }
.colors-preview div { position: absolute; left: 12px; right: 12px; bottom: 8px; display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
.colors-preview .w { color: #fff; }
.colors-preview .k { color: #0b1030; }
.colors-fmts { display: grid; gap: 7px; flex: none; }
.colors-fmt { display: grid; grid-template-columns: 46px minmax(0, 1fr) auto; align-items: center; gap: 4px; }
.colors-fmt .kit-field { font-size: 12.5px; }
.colors-note { flex: none; font-size: 11.5px; color: var(--fg-3); text-wrap: pretty; }
.colors-acts { display: flex; flex-wrap: wrap; gap: 8px; flex: none; }
.colors-acts .kit-btn { flex: 1 1 auto; }
.colors-recent { display: grid; gap: 7px; flex: none; }
.colors-recent div { display: flex; flex-wrap: wrap; gap: 7px; }
.colors-recent button { width: 24px; height: 24px; padding: 0; border: 0; border-radius: 50%; background: var(--c); box-shadow: inset 0 0 0 1px var(--line); transition: transform .4s var(--spring); }
.colors-recent button:hover { transform: scale(1.18); }
.colors-dot { flex: none; width: 13px; height: 13px; border-radius: 50%; background: var(--c); box-shadow: inset 0 0 0 1px var(--line); }

/* Harmonien */
.colors-harm { padding: 14px 16px 18px; }
.colors-harm-top { display: flex; align-items: center; gap: 9px; margin-bottom: 12px; min-width: 0; }
.colors-harm-top i { flex: none; width: 22px; height: 22px; border-radius: 50%; box-shadow: inset 0 0 0 1px var(--line); }
.colors-harm-top b { font-size: 14px; white-space: nowrap; }
.colors-harm-top span { flex: 1; min-width: 0; font-size: 12.5px; color: var(--fg-3); }
.colors-harm-top em { font-style: normal; font-size: 12px; color: var(--fg-3); white-space: nowrap; }
.colors-groups { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 13px 16px; }
.colors-group { min-width: 0; }
.colors-group.wide { grid-column: 1 / -1; }
.colors-group header { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; min-height: 24px; }
.colors-group header b { font-size: 13px; white-space: nowrap; }
.colors-group header span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--fg-3); }
.colors-strip { display: flex; height: 64px; border-radius: 14px; overflow: hidden; }
.colors-strip button { display: grid; align-content: end; justify-items: center; gap: 1px; flex: 1 1 0; min-width: 0; padding: 0 2px 8px; border: 0; border-radius: 0; background: var(--c); color: var(--ink); overflow: hidden; transition: flex-grow .4s var(--ease-out); }
.colors-strip button:hover, .colors-strip button:focus-visible { flex-grow: 1.4; }
.colors-strip button:focus-visible { outline-offset: -4px; outline-color: var(--ink); border-radius: 0; }
.colors-strip b { font-size: 11px; font-weight: 700; opacity: .8; }
.colors-strip span { font: 600 11px var(--mono); white-space: nowrap; }
.colors-strip .is-base b::before { content: ""; display: inline-block; width: 6px; height: 6px; margin-right: 4px; border-radius: 50%; background: currentColor; vertical-align: 1px; }

/* Kontrast */
.colors-con { --right: minmax(0, 1fr); grid-template-columns: 272px var(--right); }
.colors-wells { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 4px; flex: none; }
.colors-well { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 4px 8px; padding: 8px; border-radius: 12px; background: var(--raise); box-shadow: inset 0 0 0 1px transparent; cursor: pointer; transition: box-shadow .2s; }
.colors-well.is-on { box-shadow: inset 0 0 0 1.5px var(--accent); }
.colors-well .kit-label { grid-column: 1 / -1; }
.colors-well i { width: 26px; height: 26px; border-radius: 8px; background: var(--c); box-shadow: inset 0 0 0 1px var(--line); }
.colors-well .kit-field { width: 100%; padding: 5px 7px; font-size: 12px; }
.colors-con-r { gap: 14px; padding-right: 2px; }
.colors-sample { flex: none; display: grid; gap: 6px; padding: 18px 20px; border-radius: 16px; background: var(--bg); color: var(--fg); box-shadow: inset 0 0 0 1px var(--line); }
.colors-sample b { font-size: 24px; line-height: 1.15; letter-spacing: -.02em; }
.colors-sample p { font-size: 14px; line-height: 1.45; text-wrap: pretty; }
.colors-sample span { justify-self: start; display: inline-flex; align-items: center; gap: 6px; margin-top: 4px; padding: 5px 12px; border-radius: 99px; box-shadow: inset 0 0 0 1.5px currentColor; font-size: 12.5px; font-weight: 600; }
.colors-sample .ico { width: 14px; height: 14px; }
.colors-ratio { display: flex; align-items: baseline; gap: 10px; flex: none; flex-wrap: wrap; }
.colors-ratio b { font-size: 2.1rem; font-weight: 700; letter-spacing: -.03em; font-variant-numeric: tabular-nums; line-height: 1; }
.colors-ratio span { font-size: 13px; font-weight: 600; color: var(--fg-2); }
.colors-verdicts { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 8px 8px; flex: none; }
.colors-verdicts > div { min-width: 0; font-size: 13px; font-weight: 600; }
.colors-verdicts small { display: block; font-size: 11.5px; font-weight: 500; color: var(--fg-3); }
.colors-badge { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-width: 66px; padding: 4px 9px; border-radius: 99px; font-size: 11.5px; font-weight: 700; white-space: nowrap; }
.colors-badge .ico { width: 12px; height: 12px; stroke-width: 2.8; }
.colors-badge.ok { background: color-mix(in srgb, var(--c-mint) 26%, transparent); }
.colors-badge.ok .ico { color: color-mix(in srgb, var(--c-mint) 55%, var(--fg)); }
.colors-badge.no { background: color-mix(in srgb, var(--c-coral) 24%, transparent); }
.colors-badge.no .ico { color: color-mix(in srgb, var(--c-coral) 65%, var(--fg)); }
.colors-sugg { display: grid; gap: 8px; flex: none; padding: 12px 14px; border-radius: 14px; background: var(--raise); }
.colors-sugg-row { display: flex; align-items: center; gap: 10px; min-width: 0; font-size: 12.5px; }
.colors-sugg-row i { flex: none; width: 26px; height: 26px; border-radius: 8px; background: var(--c); box-shadow: inset 0 0 0 1px var(--line); }
.colors-sugg-row div { flex: 1; min-width: 0; }
.colors-sugg-row small { display: block; font-size: 11.5px; color: var(--fg-3); }
.colors-sugg-ok { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
.colors-sugg-ok .ico { color: color-mix(in srgb, var(--c-mint) 55%, var(--fg)); }

/* Paletten */
.colors-pal { --side: 184px; }
.colors-pal .kit-side { grid-auto-rows: max-content; }
.colors-mini { flex: none; width: 22px; height: 14px; border-radius: 5px; box-shadow: inset 0 0 0 1px var(--line); }
.colors-newpal { margin-top: 6px; color: var(--fg-3) !important; }
.colors-pal-select { display: none; flex: 1 1 0; }
.colors-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); align-content: start; gap: 14px 12px; }
.colors-tile { position: relative; display: grid; gap: 6px; min-width: 0; }
.colors-grid.is-sorting .colors-tile { transition: transform .38s var(--spring-soft); }
.colors-grid.is-sorting .colors-tile.is-drag { z-index: 3; transition: none; pointer-events: none; }
.colors-tile-sw { display: block; width: 100%; height: 78px; padding: 0; border: 0; border-radius: 14px; background: var(--c); box-shadow: inset 0 0 0 1px var(--line); cursor: grab; touch-action: none; transition: box-shadow .25s; }
.colors-tile.is-drag .colors-tile-sw { box-shadow: 0 20px 40px -12px rgba(0, 0, 14, .65), inset 0 0 0 1px var(--line); cursor: grabbing; }
.colors-tile-meta { display: grid; min-width: 0; padding: 0 2px; }
.colors-tile-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; font-weight: 600; }
.colors-tile-name.is-empty { font-weight: 500; color: var(--fg-3); }
.colors-tile-name .kit-field { width: 100%; padding: 2px 6px; font-size: 12.5px; border-radius: 6px; }
.colors-tile-hex { font-size: 11.5px; color: var(--fg-3); }
.colors-tile-x { position: absolute; top: 6px; right: 6px; display: grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%; background: rgba(0, 0, 14, .5); color: #fff; opacity: 0; transition: opacity .15s, transform .4s var(--spring); }
.colors-tile-x .ico { width: 12px; height: 12px; stroke-width: 2.6; }
.colors-tile:hover .colors-tile-x, .colors-tile-x:focus-visible { opacity: 1; }
.colors-tile-x:active { transform: scale(.85); }
@media (hover: none) { .colors-tile-x { opacity: 1; } }
.colors-empty-btns { display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap; justify-content: center; }

/* Verlauf */
.colors-grad { --right: 250px; }
.colors-gprev { flex: 1; min-height: 90px; border-radius: 16px; box-shadow: inset 0 0 0 1px var(--line); }
.colors-gtrack { position: relative; flex: none; height: 22px; margin: 3px 0; border-radius: 99px; box-shadow: inset 0 0 0 1px var(--line); cursor: copy; touch-action: none; }
.colors-stop { position: absolute; top: 50%; left: calc(11px + var(--p) * (100% - 22px)); width: 22px; height: 22px; margin: -11px 0 0 -11px; padding: 0; border: 0; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 2.5px #fff, 0 2px 8px rgba(0, 0, 0, .5); cursor: grab; touch-action: none; transition: scale .35s var(--spring), box-shadow .2s; }
.colors-stop.is-on { z-index: 1; scale: 1.22; box-shadow: 0 0 0 2.5px #fff, 0 0 0 5px var(--accent), 0 2px 8px rgba(0, 0, 0, .5); }
.colors-stop:focus-visible { outline: 0; box-shadow: 0 0 0 2.5px #fff, 0 0 0 5px var(--accent), 0 0 0 7px #fff; }
.colors-grow { display: flex; align-items: center; gap: 8px 10px; flex: none; flex-wrap: wrap; }
.colors-grow .gseg button { padding: .4em .9em; font-size: 12.5px; }
.colors-angle { display: flex; align-items: center; gap: 8px; flex: 1 1 150px; min-width: 0; font-size: 12px; font-weight: 600; color: var(--fg-3); }
.colors-angle .gslider { flex: 1; min-width: 60px; }
.colors-angle output { width: 36px; text-align: right; font-size: 12px; color: var(--fg-2); }
.colors-angle.is-off { opacity: .35; pointer-events: none; }
.colors-gout { display: flex; align-items: center; gap: 10px; flex: none; }
.colors-gcss { flex: 1; min-width: 0; padding: 8px 12px; border-radius: 10px; background: var(--well); box-shadow: inset 0 0 0 1px var(--line); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; user-select: text; -webkit-user-select: text; }
.colors-stoprow { display: grid; grid-template-columns: minmax(0, 1fr) 58px auto auto; align-items: center; gap: 6px; flex: none; }
.colors-stoprow span { margin-left: -2px; font-size: 12px; font-weight: 600; color: var(--fg-3); }
.colors-stoprow .kit-field { font-size: 12.5px; }
.colors-stophead { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex: none; min-height: 28px; }

@container win (max-width: 700px) {
  .colors-now span { display: none; }
  .colors-now { padding: 4px; }
  .colors-harm-top em { display: none; }
  .colors-group.wide .colors-strip span { display: none; }
  .colors-group.wide .colors-strip b { opacity: 1; }
}
@container win (max-width: 640px) {
  .colors-two { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; grid-auto-rows: max-content; align-content: start; overflow: auto; }
  .colors-two > .colors-col { min-height: auto; overflow: visible; }
  .colors-picker { flex: none; }
  .colors-sv { flex: none; height: 170px; }
  .colors-gprev { flex: none; height: 120px; }
  .colors-gout { flex-direction: column; align-items: stretch; }
  .colors-groups { grid-template-columns: minmax(0, 1fr); }
  .colors-group.wide:not(.colors-scale) .colors-strip span { display: block; }
}
@container win (max-width: 560px) {
  .colors-bar { grid-template-columns: minmax(0, 1fr); justify-items: center; }
  .colors-bar > span, .colors-now { display: none; }
  .colors-bar .gseg button { padding: .42em .62em; font-size: 12px; }
  .colors-pal-select { display: block; }
  .colors-pal .kit-title { display: none; }
  .colors-pal .kit-foot span:nth-child(n + 2) { display: none; }
  .colors-strip { height: 64px; }
}
`);

// ==========================================================================
// App
// ==========================================================================
export default {
  singleton: true,
  width: 860, height: 600, minW: 430, minH: 400,

  mount(win) {
    const db = appStore('colors');
    const S = loadState(db);
    const persist = () => db.set('state', S);
    const save = debounce(persist, 250);
    let closed = false;
    let dragOff = null;          // laufendes Sortieren (Listener auf window)
    let afterDrag = false;       // schluckt den Klick direkt nach dem Ablegen

    const rgbOf = (c) => hsvToRgb(c.h, c.s, c.v);
    const curHex = () => rgbToHex(...rgbOf(S.color));            // deckend, ohne Alpha
    const fmtOf = (key, c = S.color) => {
      const rgb = rgbOf(c);
      return key === 'hex' ? fmtHex(rgb, c.a) : key === 'rgb' ? fmtRgb(rgb, c.a) : key === 'hsl' ? fmtHsl(rgb, c.a, c.h) : fmtOklch(rgb, c.a);
    };

    // ---------- Zwischenablage, „Zuletzt“ ----------
    async function copy(text, what = text) {
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = legacyCopy(text); }
      if (!closed) toast(win, ok ? `${what} kopiert` : 'Kopieren hat nicht geklappt – bitte von Hand markieren');
      return ok;
    }
    const recentRow = h('div');
    const recentBox = h('div.colors-recent', h('span.colors-h', 'Zuletzt'), recentRow);
    function paintRecent() {
      recentRow.replaceChildren(...S.recent.map((hex) => h('button', {
        type: 'button', title: `${hex} übernehmen`, 'aria-label': `${hex} übernehmen`, style: { '--c': hex },
        onclick: () => setColor(hsvKeep(hexRgb(hex), S.color, 1)),
        oncontextmenu: (e) => swatchMenu(e, hex),
      })));
      recentBox.hidden = !S.recent.length;
    }
    function remember(hex) {
      S.recent = [hex, ...S.recent.filter((x) => x !== hex)].slice(0, 12);
      save();
      paintRecent();
    }
    const copyHex = (hex) => { copy(hex); remember(hex); };

    /** Kontextmenü einer Farbfläche */
    function swatchMenu(e, hex, extra = []) {
      e.preventDefault();
      e.stopPropagation();
      const rgb = hexRgb(hex);
      openMenu([
        { label: 'Im Wähler öffnen', icon: 'drop', run: () => { setColor(hsvKeep(rgb, S.color, 1)); showTab('pick'); } },
        { label: 'Zur Palette hinzufügen', icon: 'plus', run: () => addToPalette(hex) },
        '-',
        { heading: 'Kopieren als' },
        { label: 'HEX', hint: fmtHex(rgb), run: () => copyHex(hex) },
        { label: 'RGB', hint: fmtRgb(rgb), run: () => copy(fmtRgb(rgb)) },
        { label: 'HSL', hint: fmtHsl(rgb), run: () => copy(fmtHsl(rgb)) },
        { label: 'OKLCH', hint: fmtOklch(rgb), run: () => copy(fmtOklch(rgb)) },
        ...extra,
      ], { x: e.clientX, y: e.clientY });
    }

    // ======================================================================
    // Reiter 1: Wähler
    // ======================================================================
    const picker = makePicker({ alpha: true, onInput: (c) => setColor(c, 'picker') });
    const fields = {};
    const note = h('p.colors-note', { hidden: true }, 'Außerhalb von sRGB – das Chroma wurde bis zur darstellbaren Farbe reduziert.');
    const pvName = h('b');
    const pvW = h('span.w');
    const pvK = h('span.k');
    const preview = h('div.colors-preview', { title: 'Kontrast von weißem und dunklem Text auf dieser Farbe' }, pvName, h('div', pvW, pvK));
    const fmtRows = FORMATS.map(([key, label, parse]) => {
      const input = h('input.kit-field.mono', { type: 'text', spellcheck: false, autocomplete: 'off', 'aria-label': `${label}-Wert` });
      fields[key] = input;
      const tidy = () => { input.classList.remove('is-bad'); input.value = fmtOf(key); };
      input.addEventListener('input', () => {
        const p = parse(input.value);
        input.classList.toggle('is-bad', !p);
        if (!p) return;
        setColor(p.hsv ? { h: p.hsv[0], s: p.hsv[1], v: p.hsv[2], a: p.a } : hsvKeep(p.rgb, S.color, p.a), key);
        note.hidden = !p.clipped;
      });
      input.addEventListener('blur', tidy);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); tidy(); input.select(); } });
      return h('div.colors-fmt', h('span.kit-label', label), input,
        toolBtn('copy', `${label} kopieren`, () => { copy(fmtOf(key)); remember(curHex()); }));
    });

    const hasDropper = 'EyeDropper' in window;
    async function pickFromScreen() {
      try {
        const res = await new window.EyeDropper().open();
        const p = parseAny(res?.sRGBHex || '');
        if (!p || closed) return;
        setColor(hsvKeep(p.rgb, S.color, 1));
        remember(curHex());
        toast(win, `${curHex()} aufgenommen`);
      } catch (err) {
        if (err?.name !== 'AbortError' && !closed) toast(win, 'Die Pipette steht hier nicht zur Verfügung');
      }
    }
    const addDot = h('i.colors-dot');
    const pickEl = h('section.colors-two.colors-pick.scroll',
      h('div.colors-col', picker.el),
      h('div.colors-col.scroll',
        preview,
        h('div.colors-fmts', fmtRows),
        note,
        h('div.colors-acts',
          hasDropper ? h('button.kit-btn', { type: 'button', title: 'Farbe vom Bildschirm aufnehmen', html: `${I_PIPETTE}<span>Pipette</span>`, onclick: pickFromScreen }) : null,
          h('button.kit-btn', { type: 'button', title: 'Aktuelle Farbe in die gewählte Palette legen', html: `${icon('plus')}<span>Zur Palette</span>`, onclick: () => addToPalette(curHex()) })),
        recentBox));

    // ======================================================================
    // Reiter 2: Harmonien
    // ======================================================================
    const harmEl = h('section.colors-harm.scroll');
    function renderHarm() {
      const c = S.color;
      const base = snap8(rgbOf(c));
      const baseHex = rgbToHex(...base);
      const baseName = nameFor(base);
      const set = (offsets) => offsets.map((d) => {
        const rgb = d === 0 ? base : hsvToRgb(mod360(c.h + d), c.s, c.v);
        return { hex: rgbToHex(...rgb), name: nameFor(rgb), label: d === 0 ? 'Basis' : '', base: d === 0 };
      });
      const strip = (items) => h('div.colors-strip', items.map((it) => h('button', {
        type: 'button', class: it.base ? 'is-base' : '', title: `${it.hex} – klicken zum Kopieren`,
        'aria-label': `${it.label ? `${it.label}: ` : ''}${it.hex} kopieren`,
        style: { '--c': it.hex, '--ink': ink(it.hex) },
        onclick: () => copyHex(it.hex),
        oncontextmenu: (e) => swatchMenu(e, it.hex),
      }, it.label ? h('b', it.label) : null, h('span', it.hex))));
      const group = (title, text, items, { wide = false, cls = '', extra = null } = {}) => h(`div.colors-group${wide ? '.wide' : ''}${cls}`,
        h('header', h('b', title), h('span', text), extra,
          h('button.kit-chip', { type: 'button', title: 'Diese Farben als neue Palette anlegen', onclick: () => paletteFrom(`${title} ${baseHex}`, items) }, 'Als Palette')),
        strip(items));
      const sc = scale11(base).map((s) => ({ hex: rgbToHex(...s.rgb), name: `${baseName} ${s.step}`, label: String(s.step), base: s.base, step: s.step }));
      const scaleCss = () => `:root {\n${sc.map((s) => `  --${slug(baseName)}-${s.step}: ${s.hex.toLowerCase()};`).join('\n')}\n}\n`;
      harmEl.replaceChildren(
        h('div.colors-harm-top', h('i', { style: { background: baseHex } }), h('b', `Harmonien zu ${baseHex}`), h('span', baseName), h('em', 'Klick kopiert · Rechtsklick für mehr')),
        h('div.colors-groups',
          group('Komplementär', 'gegenüber im Farbkreis', set([0, 180])),
          group('Analog', 'direkte Nachbarn', set([-30, 0, 30])),
          group('Teilkomplementär', 'Nachbarn des Gegenübers', set([0, 150, 210])),
          group('Triadisch', 'gleichmäßig verteilt', set([0, 120, 240])),
          group('Tetradisch', 'vier im Quadrat', set([0, 90, 180, 270]), { wide: true }),
          group('Abstufungen', 'von hell nach dunkel, 50 bis 950', sc, {
            wide: true, cls: '.colors-scale',
            extra: h('button.kit-chip', { type: 'button', title: 'Skala als CSS-Variablen kopieren', onclick: () => copy(scaleCss(), 'Skala als CSS') }, 'CSS kopieren'),
          })));
    }

    // ======================================================================
    // Reiter 3: Kontrast
    // ======================================================================
    const cPicker = makePicker({
      onInput: (c) => {
        S[S.active] = rgbToHex(...hsvToRgb(c.h, c.s, c.v));
        save();
        paintContrast();
      },
    });
    const wells = {};
    for (const [key, label] of [['fg', 'Text'], ['bg', 'Hintergrund']]) {
      const input = h('input.kit-field.mono', { type: 'text', spellcheck: false, autocomplete: 'off', 'aria-label': `Farbe für ${label}` });
      const sw = h('i');
      const el = h('div.colors-well', { title: `${label} mit Fläche und Regler bearbeiten` }, h('span.kit-label', label), sw, input);
      el.addEventListener('pointerdown', () => activate(key));
      el.addEventListener('contextmenu', (e) => swatchMenu(e, S[key]));
      input.addEventListener('focus', () => activate(key));
      input.addEventListener('input', () => {
        const p = parseAny(input.value);
        input.classList.toggle('is-bad', !p);
        if (!p) return;
        S[key] = rgbToHex(...p.rgb);
        save();
        cPicker.setRgb(p.rgb);
        paintContrast(key);
      });
      const tidy = () => { input.classList.remove('is-bad'); input.value = S[key]; };
      input.addEventListener('blur', tidy);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); tidy(); input.select(); } });
      wells[key] = { el, input, sw };
    }
    function activate(key) {
      if (S.active === key) return;
      S.active = key;
      save();
      cPicker.setRgb(hexRgb(S[key]));
      paintContrast();
    }
    function setPair(fg, bg) {
      S.fg = fg;
      S.bg = bg;
      save();
      cPicker.setRgb(hexRgb(S[S.active]));
      paintContrast();
    }
    const cSample = h('div.colors-sample',
      h('b', 'Klar zu lesen?'),
      h('p', 'Franz jagt im komplett verwahrlosten Taxi quer durch Bayern – und liest dabei mühelos jede Zeile.'),
      h('span', { html: `${icon('check')}Schaltfläche` }));
    const cRatio = h('b');
    const cWord = h('span');
    const cVerdicts = h('div.colors-verdicts');
    const cSugg = h('div.colors-sugg');
    const badge = (ok, level, min) => h(`span.colors-badge.${ok ? 'ok' : 'no'}`, {
      title: `${level}: mindestens ${min.toLocaleString('de-DE')} : 1 – ${ok ? 'bestanden' : 'nicht bestanden'}`,
      html: `${icon(ok ? 'check' : 'close')}${level}`,
    });
    function paintContrast(src = null) {
      const fg = hexRgb(S.fg), bg = hexRgb(S.bg);
      const r = contrast(fg, bg);
      for (const key of ['fg', 'bg']) {
        const w = wells[key];
        w.sw.style.setProperty('--c', S[key]);
        w.el.classList.toggle('is-on', S.active === key);
        if (src !== key) { w.input.value = S[key]; w.input.classList.remove('is-bad'); }
      }
      cSample.style.setProperty('--bg', S.bg);
      cSample.style.setProperty('--fg', S.fg);
      cRatio.textContent = `${ratioText(r)} : 1`;
      cWord.textContent = r >= 7 ? 'Ausgezeichnet lesbar' : r >= 4.5 ? 'Gut lesbar' : r >= 3 ? 'Nur für großen Text' : 'Zu wenig Kontrast';
      cVerdicts.replaceChildren(
        h('div', 'Normaler Text'), badge(r >= 4.5, 'AA', 4.5), badge(r >= 7, 'AAA', 7),
        h('div', 'Großer Text', h('small', 'ab 24 px oder 19 px fett')), badge(r >= 3, 'AA', 3), badge(r >= 4.5, 'AAA', 4.5),
        h('div', 'Bedienelemente', h('small', 'Symbole, Rahmen, Grafiken')), badge(r >= 3, 'AA', 3), h('span'));

      // Vorschlag: zuerst AA, wenn das schon reicht AAA
      const target = r < 4.5 ? 4.5 : r < 7 ? 7 : 0;
      if (!target) {
        cSugg.replaceChildren(h('div.colors-sugg-ok', { html: `${icon('check')}<span>Dieses Paar besteht alle Stufen.</span>` }));
        return;
      }
      const row = (label, rgb, apply) => {
        if (!rgb) return null;
        const hex = rgbToHex(...rgb);
        return h('div.colors-sugg-row',
          h('i', { style: { '--c': hex } }),
          h('div', h('b.mono', hex), h('small', `${label} · ${ratioText(apply === 'fg' ? contrast(rgb, bg) : contrast(fg, rgb))} : 1`)),
          h('button.kit-btn', { type: 'button', onclick: () => (apply === 'fg' ? setPair(hex, S.bg) : setPair(S.fg, hex)) }, 'Übernehmen'));
      };
      const sFg = suggest(fg, bg, target);
      const sBg = suggest(bg, fg, target);
      cSugg.replaceChildren(...[
        h('span.colors-h', `Nächstliegende Farbe, die ${target === 4.5 ? 'AA' : 'AAA'} besteht`),
        row('Text anpassen', sFg, 'fg'),
        row('Hintergrund anpassen', sBg, 'bg'),
        !sFg && !sBg ? h('div.colors-sugg-row', h('div', 'Dafür reicht es nicht, nur die Helligkeit einer der beiden Farben zu ändern.')) : null,
      ].filter(Boolean));
    }
    const conEl = h('section.colors-two.colors-con.scroll',
      h('div.colors-col',
        h('div.colors-wells', wells.fg.el,
          h('button.tool', { type: 'button', 'aria-label': 'Text und Hintergrund tauschen', title: 'Tauschen', html: I_SWAP, onclick: () => setPair(S.bg, S.fg) }),
          wells.bg.el),
        cPicker.el,
        h('button.kit-btn', {
          type: 'button', title: 'Farbe aus dem Wähler für das markierte Feld übernehmen', html: `${icon('drop')}<span>Aus dem Wähler übernehmen</span>`,
          onclick: () => (S.active === 'fg' ? setPair(curHex(), S.bg) : setPair(S.fg, curHex())),
        })),
      h('div.colors-col.colors-con-r.scroll', cSample, h('div.colors-ratio', cRatio, cWord), cVerdicts, cSugg));

    // ======================================================================
    // Reiter 4: Paletten
    // ======================================================================
    const curPal = () => S.palettes.find((p) => p.id === S.pal) || null;
    const palSide = h('nav.kit-side.scroll', { 'aria-label': 'Paletten' });
    const palSelect = h('select.kit-field.colors-pal-select', { 'aria-label': 'Palette wählen' });
    const palTitle = h('b.kit-title', { title: 'Doppelklick zum Umbenennen' });
    const palGrid = h('div.colors-grid');
    const palBody = h('div.kit-body.scroll');
    const palFoot = h('div.kit-foot');

    function addToPalette(hex, name = '') {
      let p = curPal();
      if (!p) {
        p = { id: uid(), name: 'Meine Farben', colors: [] };
        S.palettes.push(p);
        S.pal = p.id;
      }
      if (p.colors.length >= MAX_COLORS) { toast(win, `„${p.name}“ ist voll (${MAX_COLORS} Farben)`); return; }
      p.colors.push({ id: uid(), hex, name: name || nameFor(hexRgb(hex)) });
      save();
      remember(hex);
      if (S.tab === 'pal') renderPal();
      toast(win, `${hex} liegt jetzt in „${p.name}“`);
    }
    function paletteFrom(name, items) {
      if (S.palettes.length >= MAX_PALETTES) { toast(win, 'Mehr Paletten passen nicht – lösche zuerst eine'); return; }
      const p = { id: uid(), name, colors: items.map((c) => ({ id: uid(), hex: c.hex, name: c.name || '' })) };
      S.palettes.push(p);
      S.pal = p.id;
      save();
      if (S.tab === 'pal') renderPal();
      toast(win, `Palette „${name}“ angelegt`);
    }
    async function newPalette() {
      if (S.palettes.length >= MAX_PALETTES) { toast(win, 'Mehr Paletten passen nicht – lösche zuerst eine'); return; }
      const name = await promptSheet(win, { title: 'Neue Palette', placeholder: 'Name der Palette', ok: 'Anlegen' });
      if (!name || closed) { renderPal(); return; }
      paletteFrom(name.slice(0, 60), []);
      renderPal();
    }
    async function renamePalette(p = curPal()) {
      if (!p) return;
      const name = await promptSheet(win, { title: 'Palette umbenennen', value: p.name, ok: 'Umbenennen' });
      if (!name || closed) return;
      p.name = name.slice(0, 60);
      save();
      renderPal();
    }
    async function deletePalette(p = curPal()) {
      if (!p) return;
      const yes = await confirmSheet(win, { title: `„${p.name}“ löschen?`, text: `Die Palette mit ${p.colors.length} ${p.colors.length === 1 ? 'Farbe' : 'Farben'} wird entfernt.`, ok: 'Löschen', danger: true });
      if (!yes || closed) return;
      const i = S.palettes.indexOf(p);
      S.palettes.splice(i, 1);
      if (S.pal === p.id) S.pal = (S.palettes[i] || S.palettes[i - 1] || null)?.id || null;
      save();
      renderPal();
    }
    function duplicatePalette(p = curPal()) {
      if (!p) return;
      paletteFrom(`${p.name} Kopie`.slice(0, 60), p.colors);
      renderPal();
    }
    function restoreSamples() {
      const have = new Set(S.palettes.map((p) => p.name));
      const add = samples().filter((p) => !have.has(p.name)).slice(0, MAX_PALETTES - S.palettes.length);
      S.palettes.push(...add);
      if (!curPal()) S.pal = S.palettes[0]?.id || null;
      save();
      renderPal();
      toast(win, add.length ? `${add.length} ${add.length === 1 ? 'Beispielpalette' : 'Beispielpaletten'} zurückgeholt` : 'Alle Beispielpaletten sind schon da');
    }
    async function savePalette(kind) {
      const p = curPal();
      if (!p) return;
      const ext = kind === 'json' ? 'json' : 'css';
      const path = await saveDialog(win, { title: `Palette als ${ext.toUpperCase()} sichern`, dir: `${HOME}/Dokumente`, name: `${slug(p.name) || 'palette'}.${ext}` });
      if (!path || closed) return;
      try {
        vfs.write(path, kind === 'json' ? paletteJson(p) : paletteCss(p), kind === 'json' ? 'application/json' : 'text/css');
        toast(win, `Gesichert: ${path.startsWith(HOME) ? `~${path.slice(HOME.length)}` : path}`);
      } catch (err) {
        toast(win, `Sichern hat nicht geklappt: ${err.message}`, 3200);
      }
    }
    const palMenu = (e, p) => {
      e.preventDefault();
      e.stopPropagation();       // die Liste wird gleich neu gebaut – das Ereignis darf nicht bis zum Schreibtisch steigen
      S.pal = p.id;
      save();
      renderPal();
      openMenu([
        { label: 'Umbenennen …', icon: 'note', run: () => renamePalette(p) },
        { label: 'Duplizieren', icon: 'copy', run: () => duplicatePalette(p) },
        '-',
        { label: 'Löschen …', icon: 'trash', run: () => deletePalette(p) },
      ], { x: e.clientX, y: e.clientY });
    };

    function moveColor(p, from, to) {
      to = clamp(to, 0, p.colors.length - 1);
      if (to === from) return;
      const [col] = p.colors.splice(from, 1);
      p.colors.splice(to, 0, col);
      save();
      renderPal();
      palGrid.children[to]?.querySelector('.colors-tile-sw')?.focus();
    }
    function removeColor(p, i) {
      const [col] = p.colors.splice(i, 1);
      save();
      renderPal();
      (palGrid.children[Math.min(i, p.colors.length - 1)]?.querySelector('.colors-tile-sw') || palBody).focus?.();
      toast(win, `${col.name || col.hex} entfernt`);
    }
    function renameColor(col, nameEl) {
      const input = h('input.kit-field', { type: 'text', value: col.name, maxLength: 40, spellcheck: false, autocomplete: 'off', 'aria-label': 'Name der Farbe' });
      let done = false;
      const finish = (commit) => {
        if (done) return;
        done = true;
        if (commit) { col.name = input.value.trim(); save(); }
        renderPal();
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(true));
      for (const evt of ['pointerdown', 'click', 'dblclick']) input.addEventListener(evt, (e) => e.stopPropagation());
      nameEl.classList.remove('is-empty');
      nameEl.replaceChildren(input);
      input.focus();
      input.select();
    }

    /** Sortieren mit dem Zeiger: Kachel hebt ab, die anderen rücken zur Seite. */
    function bindSort(tile, p, index) {
      tile.addEventListener('pointerdown', (e) => {
        if ((e.button && e.pointerType === 'mouse') || e.target.closest('.colors-tile-x, input') || dragOff) return;
        const x0 = e.clientX, y0 = e.clientY;
        let st = null;
        const shift = () => st.tiles.forEach((t, i) => {
          if (i === index) return;
          let slot = i;
          if (index < st.to && i > index && i <= st.to) slot = i - 1;
          else if (st.to < index && i >= st.to && i < index) slot = i + 1;
          const a = st.rects[i], b = st.rects[slot];
          t.style.transform = slot === i ? '' : `translate(${b.left - a.left}px, ${b.top - a.top}px)`;
        });
        const move = (ev) => {
          const dx = ev.clientX - x0, dy = ev.clientY - y0;
          if (!st) {
            if (Math.hypot(dx, dy) < 6) return;
            const tiles = [...palGrid.children];
            st = { tiles, rects: tiles.map((t) => t.getBoundingClientRect()), to: index };
            palGrid.classList.add('is-sorting');
            tile.classList.add('is-drag');
          }
          tile.style.transform = `translate(${dx}px, ${dy}px) scale(1.06)`;
          let best = index, bd = Infinity;
          st.rects.forEach((r, i) => {
            const d = Math.hypot(ev.clientX - (r.left + r.width / 2), ev.clientY - (r.top + r.height / 2));
            if (d < bd) { bd = d; best = i; }
          });
          if (best !== st.to) { st.to = best; shift(); }
        };
        const stop = () => {
          removeEventListener('pointermove', move);
          removeEventListener('pointerup', up);
          removeEventListener('pointercancel', up);
          dragOff = null;
        };
        const up = (ev) => {
          stop();
          if (!st) return;
          afterDrag = true;
          setTimeout(() => { afterDrag = false; }, 0);
          const from = st.rects[index], to = st.rects[st.to];
          const dx = ev.clientX - x0, dy = ev.clientY - y0;
          const target = st.to;
          if (target !== index) {
            const [col] = p.colors.splice(index, 1);
            p.colors.splice(target, 0, col);
            save();
          }
          renderPal();
          const el = palGrid.children[target];
          if (el && !reducedMotion.matches) {
            el.style.zIndex = '3';
            el.animate(
              [{ transform: `translate(${from.left + dx - to.left}px, ${from.top + dy - to.top}px) scale(1.06)` }, { transform: 'none' }],
              { duration: 340, easing: 'cubic-bezier(.3, 1.3, .5, 1)' },
            ).onfinish = () => { el.style.zIndex = ''; };
          }
        };
        addEventListener('pointermove', move);
        addEventListener('pointerup', up);
        addEventListener('pointercancel', up);
        dragOff = stop;
      });
    }

    function renderPal() {
      const p = curPal();
      palSide.replaceChildren(
        h('div.kit-head', 'Paletten'),
        ...S.palettes.map((q) => {
          const cols = q.colors.slice(0, 4);
          const bg = cols.length ? `linear-gradient(90deg, ${cols.map((c, i) => `${c.hex} ${(i / cols.length) * 100}% ${((i + 1) / cols.length) * 100}%`).join(', ')})` : 'var(--well)';
          return h('button', {
            type: 'button', class: q.id === S.pal ? 'is-on' : '', 'aria-current': q.id === S.pal ? 'true' : null,
            onclick: () => { S.pal = q.id; save(); renderPal(); },
            oncontextmenu: (e) => palMenu(e, q),
          }, h('i.colors-mini', { style: { background: bg } }), h('span', q.name), h('span.kit-count', String(q.colors.length)));
        }),
        h('button.colors-newpal', { type: 'button', html: `${icon('plus')}<span>Neue Palette</span>`, onclick: newPalette }));
      palSelect.replaceChildren(
        ...S.palettes.map((q) => h('option', { value: q.id, selected: q.id === S.pal }, q.name)),
        h('option', { value: '+' }, '＋ Neue Palette …'));
      if (!p) palSelect.selectedIndex = -1;
      palTitle.textContent = p ? p.name : 'Paletten';
      for (const b of palTools) b.disabled = !p;
      bPalCopy.disabled = bPalSave.disabled = !p || !p.colors.length;

      if (!p) {
        palBody.replaceChildren(h('div.kit-empty', { html: icon('layers') },
          h('b', 'Noch keine Palette'), h('span', 'Lege eine eigene Palette an oder hole die mitgelieferten Beispiele zurück.'),
          h('div.colors-empty-btns',
            h('button.kit-btn.primary', { type: 'button', onclick: newPalette }, 'Neue Palette'),
            h('button.kit-btn', { type: 'button', onclick: restoreSamples }, 'Beispiele laden'))));
        palFoot.textContent = 'Keine Palette gewählt';
        return;
      }
      if (!p.colors.length) {
        palBody.replaceChildren(emptyState('drop', 'Diese Palette ist leer', 'Lege die aktuelle Farbe mit „+ Farbe“ hinein – oder per Rechtsklick auf eine beliebige Farbfläche.'));
        palFoot.textContent = '0 Farben';
        return;
      }
      palGrid.classList.remove('is-sorting');
      palGrid.replaceChildren(...p.colors.map((col, i) => {
        const nameEl = h(`span.colors-tile-name${col.name ? '' : '.is-empty'}`, { title: 'Doppelklick zum Umbenennen' }, col.name || 'Ohne Namen');
        const sw = h('button.colors-tile-sw', {
          type: 'button', style: { '--c': col.hex }, title: `${col.hex} – Klick kopiert, Ziehen sortiert`,
          'aria-label': `${col.name || 'Farbe'} ${col.hex} kopieren. Alt+Pfeiltasten verschieben, Entf löscht, F2 benennt um.`,
        });
        sw.addEventListener('click', (e) => { if (afterDrag) { e.preventDefault(); return; } copyHex(col.hex); });
        sw.addEventListener('keydown', (e) => {
          const d = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
          if (e.altKey && d) { e.preventDefault(); e.stopPropagation(); moveColor(p, i, i + d); }
          else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeColor(p, i); }
          else if (e.key === 'F2') { e.preventDefault(); renameColor(col, nameEl); }
        });
        nameEl.addEventListener('dblclick', () => renameColor(col, nameEl));
        const tile = h('div.colors-tile', sw,
          h('div.colors-tile-meta', nameEl, h('span.colors-tile-hex.mono', col.hex)),
          h('button.colors-tile-x', { type: 'button', 'aria-label': `${col.name || col.hex} entfernen`, title: 'Entfernen', html: icon('close'), onclick: () => removeColor(p, i) }));
        tile.addEventListener('contextmenu', (e) => swatchMenu(e, col.hex, [
          '-',
          { label: 'Umbenennen', icon: 'note', run: () => renameColor(col, nameEl) },
          { label: 'Nach vorn', icon: 'arrowLeft', disabled: i === 0, run: () => moveColor(p, i, i - 1) },
          { label: 'Nach hinten', icon: 'arrowRight', disabled: i === p.colors.length - 1, run: () => moveColor(p, i, i + 1) },
          { label: 'Entfernen', icon: 'trash', run: () => removeColor(p, i) },
        ]));
        bindSort(tile, p, i);
        return tile;
      }));
      if (palGrid.parentNode !== palBody || palBody.children.length !== 1) palBody.replaceChildren(palGrid);
      palFoot.replaceChildren(
        h('span', `${p.colors.length} ${p.colors.length === 1 ? 'Farbe' : 'Farben'}`),
        h('span.sp'),
        h('span', 'Klick kopiert · Ziehen sortiert · Doppelklick benennt'));
    }
    const bPalAdd = h('button.kit-btn', { type: 'button', title: 'Aktuelle Farbe aus dem Wähler hinzufügen', onclick: () => addToPalette(curHex()) }, addDot, h('span', '+ Farbe'));
    const bPalCopy = toolBtn('copy', 'Palette kopieren als …', () => {
      const p = curPal();
      if (!p) return;
      openMenu([
        { label: 'CSS-Variablen', icon: 'code', run: () => copy(paletteCss(p), 'CSS-Variablen') },
        { label: 'JSON', icon: 'list', run: () => copy(paletteJson(p), 'JSON') },
      ], { anchor: bPalCopy, align: 'right' });
    });
    const bPalSave = toolBtn('download', 'Palette als Datei sichern …', () => openMenu([
      { label: 'Als CSS sichern …', icon: 'code', run: () => savePalette('css') },
      { label: 'Als JSON sichern …', icon: 'list', run: () => savePalette('json') },
    ], { anchor: bPalSave, align: 'right' }));
    const bPalName = toolBtn('note', 'Palette umbenennen', () => renamePalette());
    const bPalDel = toolBtn('trash', 'Palette löschen', () => deletePalette());
    const palTools = [bPalCopy, bPalSave, bPalName, bPalDel];     // „+ Farbe“ bleibt immer bedienbar und legt notfalls „Meine Farben“ an
    palSelect.addEventListener('change', () => {
      if (palSelect.value === '+') { newPalette(); return; }
      S.pal = palSelect.value;
      save();
      renderPal();
    });
    palTitle.addEventListener('dblclick', () => renamePalette());
    const palEl = h('section.kit-split.colors-pal', palSide,
      h('div.kit-main', h('div.kit-bar', palSelect, palTitle, h('span.sp'), bPalAdd, ...palTools), palBody, palFoot));

    // ======================================================================
    // Reiter 5: Verlauf
    // ======================================================================
    const G = S.grad;
    const selStop = () => G.stops.find((s) => s.id === G.sel) || G.stops[0];
    const gPrev = h('div.colors-gprev', { role: 'img', 'aria-label': 'Vorschau des Verlaufs' });
    const gTrack = h('div.colors-gtrack', { title: 'Klick auf die Leiste setzt einen neuen Stopp' });
    const gCss = h('code.colors-gcss.mono');
    const gType = h('div.gseg', { 'aria-label': 'Art des Verlaufs' },
      [['linear', 'Linear'], ['radial', 'Radial'], ['conic', 'Konisch']].map(([v, l]) => h('button', { dataset: { value: v }, 'aria-selected': String(G.type === v) }, l)));
    const gAngle = h('div.gslider', { dataset: { min: 0, max: 360, step: 1, value: G.angle }, 'aria-label': 'Winkel in Grad' });
    const gAngleOut = h('output.mono');
    const gAngleBox = h('div.colors-angle', h('span', 'Winkel'), gAngle, gAngleOut);
    const gHead = h('span.colors-h');
    const gHex = h('input.kit-field.mono', { type: 'text', spellcheck: false, autocomplete: 'off', 'aria-label': 'Farbe des Stopps' });
    const gPos = h('input.kit-field.mono', { type: 'number', min: 0, max: 100, step: 1, 'aria-label': 'Position des Stopps in Prozent', title: 'Position in Prozent' });
    const gDel = toolBtn('trash', 'Stopp entfernen', () => removeStop());
    const gAdd = h('button.kit-btn', { type: 'button', title: 'Neuen Stopp in die größte Lücke setzen', html: `${icon('plus')}<span>Stopp</span>`, onclick: () => addStop() });
    const gPicker = makePicker({
      onInput: (c) => {
        selStop().hex = rgbToHex(...hsvToRgb(c.h, c.s, c.v));
        save();
        paintGrad();
      },
    });

    function selectStop(id) {
      if (G.sel === id) return;
      G.sel = id;
      save();
      gPicker.setRgb(hexRgb(selStop().hex));
      paintGrad();
    }
    function addStop(pos = null) {
      if (G.stops.length >= MAX_STOPS) { toast(win, `Mehr als ${MAX_STOPS} Stopps gehen nicht`); return; }
      const sorted = [...G.stops].sort((a, b) => a.pos - b.pos);
      if (pos == null) {
        let gap = -1;
        pos = 50;
        for (let i = 1; i < sorted.length; i++) {
          const g = sorted[i].pos - sorted[i - 1].pos;
          if (g > gap) { gap = g; pos = Math.round((sorted[i].pos + sorted[i - 1].pos) / 2); }
        }
      }
      const s = { id: uid(), hex: rgbToHex(...mixAt(sorted, pos)), pos };
      G.stops.push(s);
      G.sel = s.id;
      save();
      gPicker.setRgb(hexRgb(s.hex));
      renderStops();
      paintGrad();
      gTrack.children[G.stops.length - 1]?.focus({ preventScroll: true });
    }
    function removeStop(id = G.sel) {
      if (G.stops.length <= 2) { toast(win, 'Ein Verlauf braucht mindestens zwei Stopps'); return; }
      const i = G.stops.findIndex((s) => s.id === id);
      if (i < 0) return;
      G.stops.splice(i, 1);
      G.sel = (G.stops[i] || G.stops[i - 1]).id;
      save();
      gPicker.setRgb(hexRgb(selStop().hex));
      renderStops();
      paintGrad();
    }
    function renderStops() {
      gTrack.replaceChildren(...G.stops.map((s) => {
        const b = h('button.colors-stop', { type: 'button', role: 'slider', 'aria-valuemin': 0, 'aria-valuemax': 100 });
        b.addEventListener('pointerdown', (e) => {
          if (e.button && e.pointerType === 'mouse') return;
          e.stopPropagation();
          selectStop(s.id);
          try { b.setPointerCapture(e.pointerId); } catch { /* egal */ }
          const move = (ev) => {
            const r = gTrack.getBoundingClientRect();
            s.pos = Math.round(clamp((ev.clientX - r.left - 11) / Math.max(1, r.width - 22)) * 100);
            save();
            paintGrad();
          };
          const up = () => {
            b.removeEventListener('pointermove', move);
            b.removeEventListener('pointerup', up);
            b.removeEventListener('pointercancel', up);
          };
          b.addEventListener('pointermove', move);
          b.addEventListener('pointerup', up);
          b.addEventListener('pointercancel', up);
        });
        b.addEventListener('focus', () => selectStop(s.id));
        b.addEventListener('keydown', (e) => {
          const d = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
          if (d && !e.altKey && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            s.pos = clamp(s.pos + d * (e.shiftKey ? 10 : 1), 0, 100);
            save();
            paintGrad();
          } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            removeStop(s.id);
            gTrack.querySelector('.is-on')?.focus({ preventScroll: true });
          }
        });
        return b;
      }));
    }
    function paintGrad(src = null) {
      const css = gradCss(G);
      gPrev.style.background = css;
      gTrack.style.background = gradCss(G, true);
      G.stops.forEach((s, i) => {
        const b = gTrack.children[i];
        if (!b) return;
        b.style.setProperty('--p', s.pos / 100);
        b.style.setProperty('--c', s.hex);
        b.classList.toggle('is-on', s.id === G.sel);
        b.setAttribute('aria-valuenow', s.pos);
        b.setAttribute('aria-label', `Farbstopp ${s.hex} bei ${s.pos} %`);
      });
      gCss.textContent = `background: ${css};`;
      const s = selStop();
      const order = [...G.stops].sort((a, b) => a.pos - b.pos);
      gHead.textContent = `Stopp ${order.indexOf(s) + 1} von ${G.stops.length}`;
      if (src !== 'hex') { gHex.value = s.hex; gHex.classList.remove('is-bad'); }
      if (src !== 'pos') gPos.value = s.pos;
      gDel.disabled = G.stops.length <= 2;
      gAdd.disabled = G.stops.length >= MAX_STOPS;
      gAngleOut.textContent = G.type === 'radial' ? '–' : `${G.angle}°`;
      gAngleBox.classList.toggle('is-off', G.type === 'radial');
    }
    gTrack.addEventListener('pointerdown', (e) => {
      if (e.target !== gTrack || (e.button && e.pointerType === 'mouse')) return;
      const r = gTrack.getBoundingClientRect();
      addStop(Math.round(clamp((e.clientX - r.left - 11) / Math.max(1, r.width - 22)) * 100));
    });
    gType.addEventListener('change', (e) => { e.stopPropagation(); G.type = e.detail.value; save(); paintGrad(); });
    gAngle.addEventListener('input', (e) => { G.angle = Math.round(e.detail.value); save(); paintGrad(); });
    gAngle.addEventListener('change', (e) => e.stopPropagation());
    gHex.addEventListener('input', () => {
      const p = parseAny(gHex.value);
      gHex.classList.toggle('is-bad', !p);
      if (!p) return;
      selStop().hex = rgbToHex(...p.rgb);
      save();
      gPicker.setRgb(p.rgb);
      paintGrad('hex');
    });
    gHex.addEventListener('blur', () => { gHex.classList.remove('is-bad'); gHex.value = selStop().hex; });
    gHex.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); gHex.blur(); gHex.focus(); gHex.select(); } });
    gPos.addEventListener('input', () => {
      const v = Number(gPos.value);
      if (gPos.value === '' || !Number.isFinite(v)) return;
      selStop().pos = Math.round(clamp(v, 0, 100));
      save();
      paintGrad('pos');
    });
    gPos.addEventListener('blur', () => { gPos.value = selStop().pos; });
    const gradEl = h('section.colors-two.colors-grad.scroll',
      h('div.colors-col',
        gPrev, gTrack,
        h('div.colors-grow', gType, gAngleBox, gAdd,
          h('button.tool', {
            type: 'button', 'aria-label': 'Stopps umkehren', title: 'Reihenfolge der Stopps umkehren', html: I_SWAP,
            onclick: () => { for (const s of G.stops) s.pos = 100 - s.pos; save(); paintGrad(); },
          })),
        h('div.colors-gout', gCss, h('button.kit-btn.primary', { type: 'button', html: `${icon('copy')}<span>CSS kopieren</span>`, onclick: () => copy(`background: ${gradCss(G)};`, 'CSS') }))),
      h('div.colors-col',
        h('div.colors-stophead', gHead,
          h('button.kit-chip', { type: 'button', title: 'Farbe aus dem Wähler für diesen Stopp übernehmen', onclick: () => { selStop().hex = curHex(); save(); gPicker.setRgb(hexRgb(curHex())); paintGrad(); } }, 'Aus dem Wähler')),
        gPicker.el,
        h('div.colors-stoprow', gHex, gPos, h('span', '%'), gDel)));

    // ======================================================================
    // Rahmen: Reiter, aktuelle Farbe
    // ======================================================================
    const panels = {
      pick: { el: pickEl },
      harm: { el: harmEl, show: renderHarm },
      contrast: { el: conEl, show: () => { cPicker.setRgb(hexRgb(S[S.active])); paintContrast(); } },
      pal: { el: palEl, show: renderPal },
      grad: { el: gradEl, show: () => paintGrad() },
    };
    const seg = h('div.gseg', { 'aria-label': 'Bereich' }, TABS.map(([id, label]) => h('button', { dataset: { value: id }, 'aria-selected': String(id === S.tab) }, label)));
    const nowSw = h('i');
    const nowTx = h('span.mono');
    const now = h('button.colors-now', { type: 'button', title: 'Aktuelle Farbe – zum Wähler', 'aria-label': 'Aktuelle Farbe im Wähler zeigen', onclick: () => showTab('pick') }, nowSw, nowTx);
    const root = h('div.kit-app.colors',
      h('div.kit-bar.colors-bar', h('span'), seg, now),
      h('div.colors-view', Object.values(panels).map((p) => p.el)));

    function showTab(id) {
      S.tab = id;
      save();
      for (const [key, p] of Object.entries(panels)) p.el.hidden = key !== id;
      const i = TABS.findIndex(([t]) => t === id);
      if (seg.index !== i) seg.select?.(i, false);
      panels[id].show?.();
    }
    function paintColor(src = null) {
      const c = S.color;
      const rgb = snap8(rgbOf(c));
      const hex = rgbToHex(...rgb);
      if (src !== 'picker') picker.set(c);
      for (const [key] of FORMATS) {
        if (key === src) continue;
        fields[key].value = fmtOf(key);
        fields[key].classList.remove('is-bad');
      }
      note.hidden = true;
      preview.style.setProperty('--c', rgbToHex(...rgb, c.a));
      preview.style.setProperty('--ink', c.a < 0.5 ? 'var(--fg)' : ink(hex));
      pvName.textContent = nameFor(rgb) + (c.a < 1 ? ` · ${Math.round(c.a * 100)} % deckend` : '');
      pvW.textContent = `Aa ${ratioText(contrast(rgb, [1, 1, 1]))}`;
      pvK.textContent = `Aa ${ratioText(contrast(rgb, INK))}`;
      nowSw.style.setProperty('--c', rgbToHex(...rgb, c.a));
      nowTx.textContent = hex;
      addDot.style.setProperty('--c', hex);
    }
    function setColor(c, src = null) {
      S.color = { h: clamp(c.h, 0, 360), s: clamp(c.s), v: clamp(c.v), a: clamp(c.a ?? 1) };
      save();
      paintColor(src);
      if (S.tab === 'harm') renderHarm();
    }

    win.body.append(root);
    if (hasDropper) win.tools.append(h('button.tool', { type: 'button', 'aria-label': 'Pipette', title: 'Pipette – Farbe vom Bildschirm aufnehmen', html: I_PIPETTE, onclick: pickFromScreen }));
    initControls(root);
    seg.addEventListener('change', (e) => { if (e.target === seg) showTab(e.detail.value); });
    cPicker.setRgb(hexRgb(S[S.active]));
    gPicker.setRgb(hexRgb(selStop().hex));
    renderStops();
    paintRecent();
    paintColor();
    showTab(S.tab);

    // Zifferntasten 1–5 wechseln den Reiter
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea, select')) return;
      const i = ['1', '2', '3', '4', '5'].indexOf(e.key);
      if (i >= 0) { e.preventDefault(); showTab(TABS[i][0]); }
    };
    win.el.addEventListener('keydown', onKey);

    return {
      onClose() {
        closed = true;
        dragOff?.();
        win.el.removeEventListener('keydown', onKey);
        persist();
      },
      // Tastatur landet im Fenster, auch wenn der Fokus gerade woanders liegt (frisch geöffnet, Menüleiste)
      onFocus() {
        if (!win.el.contains(document.activeElement)) win.el.focus({ preventScroll: true });
      },
      menus: () => [
        {
          label: 'Farbe',
          items: [
            ...FORMATS.map(([key, label]) => ({ label: `${label} kopieren`, icon: 'copy', hint: fmtOf(key), run: () => { copy(fmtOf(key)); remember(curHex()); } })),
            '-',
            { label: 'Zur Palette hinzufügen', icon: 'plus', run: () => addToPalette(curHex()) },
            hasDropper && { label: 'Pipette', icon: 'drop', run: pickFromScreen },
            { label: 'Zufällige Farbe', icon: 'sparkles', run: () => setColor({ h: Math.random() * 360, s: 0.45 + Math.random() * 0.5, v: 0.6 + Math.random() * 0.4, a: 1 }) },
          ],
        },
        {
          label: 'Ansicht',
          items: TABS.map(([id, label], i) => ({ label, hint: String(i + 1), checked: S.tab === id, run: () => showTab(id) })),
        },
        {
          label: 'Palette',
          items: [
            { label: 'Neue Palette …', icon: 'plus', run: () => { showTab('pal'); newPalette(); } },
            { label: 'Duplizieren', icon: 'copy', disabled: !curPal(), run: () => { showTab('pal'); duplicatePalette(); } },
            { label: 'Beispielpaletten zurückholen', icon: 'reload', run: () => { showTab('pal'); restoreSamples(); } },
            '-',
            { label: 'CSS-Variablen kopieren', disabled: !curPal()?.colors.length, run: () => copy(paletteCss(curPal()), 'CSS-Variablen') },
            { label: 'JSON kopieren', disabled: !curPal()?.colors.length, run: () => copy(paletteJson(curPal()), 'JSON') },
          ],
        },
      ],
    };
  },
};
