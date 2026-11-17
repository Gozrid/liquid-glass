// photos.js — Fotos: Mediathek für die Bilder in ~/Bilder mit Betrachter, Diashow und Bearbeitung

import { h, clamp, debounce, drag, reducedMotion, pick, TAU } from '../../../core/util.js';
import { icon } from '../../../core/icons.js';
import { initControls } from '../../../core/controls.js';
import { sys } from '../../sys.js';
import { bus } from '../../bus.js';
import { vfs, HOME, basename, dirname, extname } from '../../vfs.js';
import { openMenu } from '../../ui.js';
import { style, appStore, toolBtn, emptyState, toast, confirmSheet, promptSheet, importFiles, readFile, download } from '../../kit.js';

const PICS = `${HOME}/Bilder`;
const EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const MAX_EDGE = 2000;      // größere Importe werden verkleinert
const PAD = 14;             // Rand um das Bild im Betrachter

const svg = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const HEART = 'M12 20.4C7 17 4.200 13.800 4.200 10.200A4.200 4.200 0 0 1 12 7.900a4.200 4.200 0 0 1 7.800 2.300c0 3.600-2.800 6.800-7.800 10.200z';
const IC = {
  heart: svg(`<path d="${HEART}"/>`),
  heartFill: svg(`<path d="${HEART}" fill="currentColor"/>`),
  rotate: svg('<path d="M19 9.500V5M19 9.500h-4.500"/><path d="M18.400 9.500A7.500 7.500 0 1 0 19.500 13"/>'),
  flip: svg('<path d="M12 3.500v17" stroke-dasharray="2.200 2.600"/><path d="M8.500 8L3.500 16.500h5zM15.500 8l5 8.500h-5z"/>'),
  desk: svg('<rect x="3" y="4.500" width="18" height="12.500" rx="2.600"/><path d="M8.500 20.500h7M12 17v3.500"/>'),
};
const tool = (html, label, onclick) => h('button.tool', { type: 'button', 'aria-label': label, title: label, html, onclick });

// ==========================================================================
// Mediathek lesen, Bilder laden, Miniaturen (im Arbeitsspeicher zwischengespeichert)
// ==========================================================================
const isPic = (st) => st.type === 'file' && (EXT.has(extname(st.path)) || (st.mime || '').startsWith('image/'));

/** Alle Bilder unter ~/Bilder (rekursiv, neueste zuerst) und alle Unterordner als Alben. */
function scan() {
  const items = [];
  const albums = [];
  const walk = (dir, depth) => {
    let list = [];
    try { list = vfs.list(dir); } catch { return 0; }
    let own = 0;
    for (const st of list) {
      if (st.type === 'dir') {
        if (depth > 5) continue;
        const album = { path: st.path, name: st.name, count: 0 };
        albums.push(album);
        album.count = walk(st.path, depth + 1);
      } else if (isPic(st)) { items.push(st); own++; }
    }
    return own;
  };
  walk(PICS, 0);
  items.sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name, 'de'));
  return { items, albums };
}

const loadImg = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Bild lässt sich nicht lesen'));
  img.src = src;
});

const thumbs = new Map();   // „pfad|mtime|größe“ → Promise<{url, w, h}>
function thumb(st, size = 360) {
  const key = `${st.path}|${st.mtime}|${size}`;
  let p = thumbs.get(key);
  if (!p) {
    p = (async () => {
      const src = vfs.read(st.path);
      const img = await loadImg(src);
      const w = img.naturalWidth, hgt = img.naturalHeight;
      const k = size / Math.min(w, hgt);
      if (k >= 1 || src.length < 60000) return { url: src, w, h: hgt };
      const cv = document.createElement('canvas');
      cv.width = Math.round(w * k);
      cv.height = Math.round(hgt * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const jpeg = /^jpe?g$/.test(extname(st.path));
      return { url: cv.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.82), w, h: hgt };
    })();
    p.catch(() => thumbs.delete(key));
    thumbs.set(key, p);
    if (thumbs.size > 600) thumbs.delete(thumbs.keys().next().value);
  }
  return p;
}

/** Tatsächliche Dateigröße einer Data-URL in Bytes (Base64 → 3/4). */
const bytesOf = (data) => Math.max(0, Math.round((data.length - data.indexOf(',') - 1) * 0.75));
const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toLocaleString('de-DE', { maximumFractionDigits: 0 })} KB` : `${(n / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`);
const stemOf = (name) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) : name; };
const prettyPath = (p) => (p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);

function groupLabel(ts) {
  const now = new Date();
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= day0) return 'Heute';
  if (ts >= day0 - 864e5) return 'Gestern';
  if (ts >= day0 - 6 * 864e5) return 'Diese Woche';
  return new Date(ts).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}

// ==========================================================================
// Entwickeln: Regler und Filter werden Pixel für Pixel auf einem Canvas gerechnet
// ==========================================================================
const LOOKS = [
  { id: 'none', name: 'Original', p: {} },
  { id: 'vivid', name: 'Lebhaft', p: { sat: 0.4, con: 0.16, bri: 0.04 } },
  { id: 'sun', name: 'Sonnig', p: { warm: 0.55, sat: 0.12, bri: 0.06, fade: 0.18 } },
  { id: 'frost', name: 'Frost', p: { warm: -0.6, sat: -0.1, con: 0.1 } },
  { id: 'mono', name: 'Mono', p: { sat: -1, con: 0.24 } },
  { id: 'nostalgia', name: 'Nostalgie', p: { sepia: 0.6, fade: 0.6, sat: -0.2, vig: 0.4, warm: 0.12 } },
  { id: 'drama', name: 'Drama', p: { con: 0.5, sat: -0.32, vig: 0.6, bri: -0.06 } },
];
const ADJ = [['bri', 'Helligkeit', -100], ['con', 'Kontrast', -100], ['sat', 'Sättigung', -100], ['warm', 'Wärme', -100], ['vig', 'Vignette', 0]];
const satK = (v) => (v >= 0 ? 1 + v * 1.25 : 1 + v);

/** Voreinstellung und Regler zu einem Parametersatz verrechnen. */
function mixParams(look, adj) {
  const l = look.p;
  return {
    bri: clamp((l.bri || 0) + adj.bri, -1, 1),
    con: clamp((l.con || 0) + adj.con, -1, 1),
    sat: satK(l.sat || 0) * satK(adj.sat),
    warm: clamp((l.warm || 0) + adj.warm, -1.4, 1.4),
    vig: clamp((l.vig || 0) + adj.vig, 0, 1),
    fade: l.fade || 0,
    sepia: l.sepia || 0,
  };
}

/** src → dst (beide RGBA, w × h). Reihenfolge: Tonwerte, Sättigung, Sepia, Wärme, Vignette. */
function develop(src, dst, w, hgt, p) {
  const lut = new Float32Array(256);
  const gamma = Math.pow(2, -p.bri * 0.85);
  const c = p.con >= 0 ? 1 + p.con * 1.1 : 1 + p.con * 0.65;
  for (let i = 0; i < 256; i++) {
    let v = Math.pow(i / 255, gamma);
    v = (v - 0.5) * c + 0.5;
    v = v * (1 - p.fade * 0.22) + p.fade * 0.1;
    lut[i] = clamp(v, 0, 1) * 255;
  }
  const { sat, sepia, vig } = p;
  const wr = p.warm * 26, wg = p.warm * 5, wb = -p.warm * 30;
  const cx = (w - 1) / 2, cy = (hgt - 1) / 2;
  const inv = 1 / (cx * cx + cy * cy || 1);
  let i = 0;
  for (let y = 0; y < hgt; y++) {
    const dy2 = (y - cy) * (y - cy);
    for (let x = 0; x < w; x++, i += 4) {
      let r = lut[src[i]], g = lut[src[i + 1]], b = lut[src[i + 2]];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      if (sat !== 1) { r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat; }
      if (sepia) {
        r += (l * 1.06 + 22 - r) * sepia;
        g += (l * 0.94 + 8 - g) * sepia;
        b += (l * 0.76 - 8 - b) * sepia;
      }
      r += wr; g += wg; b += wb;
      if (vig) {
        const d = ((x - cx) * (x - cx) + dy2) * inv;
        const t = clamp((d - 0.16) / 0.84, 0, 1);
        const k = 1 - vig * 0.9 * t * t * (3 - 2 * t);
        r *= k; g *= k; b *= k;
      }
      dst[i] = r; dst[i + 1] = g; dst[i + 2] = b; dst[i + 3] = src[i + 3];
    }
  }
}

/** Bild mit Drehung (Vierteldrehungen) und Spiegelung auf ein Canvas der Kantenlänge ≤ maxEdge zeichnen. */
function drawGeometry(img, rot, flip, maxEdge) {
  const k = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const hgt = Math.max(1, Math.round(img.naturalHeight * k));
  const cv = document.createElement('canvas');
  cv.width = rot % 2 ? hgt : w;
  cv.height = rot % 2 ? w : hgt;
  const c = cv.getContext('2d', { willReadFrequently: true });
  c.translate(cv.width / 2, cv.height / 2);
  c.rotate(rot * Math.PI / 2);
  c.scale(flip ? -1 : 1, 1);
  c.drawImage(img, -w / 2, -hgt / 2, w, hgt);
  return cv;
}

// ==========================================================================
// Beispielbilder: sechs kleine generative Motive
// ==========================================================================
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lin = (c, x0, y0, x1, y1, stops) => {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((s, i) => g.addColorStop(typeof s === 'string' ? i / (stops.length - 1) : s[0], typeof s === 'string' ? s : s[1]));
  return g;
};
/** Welliger Horizont: gefüllte Fläche von der Kurve bis zum unteren Rand. */
function ridge(c, W, H, y, amp, r, fill, steps = 5) {
  const ph = [r() * TAU, r() * TAU, r() * TAU];
  const f = [0.6 + r() * 0.6, 1.6 + r() * 1.2, 3.4 + r() * 2];
  c.beginPath();
  c.moveTo(0, H);
  for (let x = 0; x <= W; x += steps) {
    const u = x / W;
    c.lineTo(x, y + amp * (Math.sin(u * TAU * f[0] + ph[0]) * 0.6 + Math.sin(u * TAU * f[1] + ph[1]) * 0.28 + Math.sin(u * TAU * f[2] + ph[2]) * 0.12));
  }
  c.lineTo(W, H);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
}

const SAMPLES = [
  ['Dünen im Abendlicht', 960, 640, (c, W, H, r) => {
    c.fillStyle = lin(c, 0, 0, 0, H, ['#2a1b5e', '#8a3a7e', '#f0736a', '#ffc27a']);
    c.fillRect(0, 0, W, H);
    const sx = W * 0.68, sy = H * 0.46;
    const glow = c.createRadialGradient(sx, sy, 0, sx, sy, H * 0.6);
    glow.addColorStop(0, 'rgba(255, 236, 190, .9)');
    glow.addColorStop(0.12, 'rgba(255, 210, 150, .55)');
    glow.addColorStop(1, 'rgba(255, 180, 120, 0)');
    c.fillStyle = glow;
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#fff3d6';
    c.beginPath(); c.arc(sx, sy, H * 0.085, 0, TAU); c.fill();
    const cols = [['#d9697a', '#b04a78'], ['#b44a7c', '#7f3277'], ['#7d2f78', '#4f2069'], ['#4a1f66', '#2a1450'], ['#231046', '#0f0726']];
    cols.forEach(([a, b], i) => {
      const y = H * (0.56 + i * 0.09);
      ridge(c, W, H, y, H * (0.035 + i * 0.012), r, lin(c, 0, y - 40, 0, H, [a, b]));
    });
  }],
  ['Nordlicht', 640, 960, (c, W, H, r) => {
    c.fillStyle = lin(c, 0, 0, 0, H, ['#020512', '#07182e', '#0c2c3c']);
    c.fillRect(0, 0, W, H);
    for (let i = 0; i < 240; i++) {
      c.fillStyle = `rgba(255, 255, 255, ${0.15 + r() * 0.75})`;
      const s = r() < 0.08 ? 2 : 1;
      c.fillRect(r() * W, r() * H * 0.8, s, s);
    }
    c.globalCompositeOperation = 'lighter';
    const veils = [['64, 255, 170', 0.3, 0.5], ['70, 220, 255', 0.42, 0.42], ['170, 110, 255', 0.2, 0.36]];
    for (const [rgb, top, len] of veils) {
      const ph = r() * TAU, ph2 = r() * TAU, f = 1 + r() * 1.5;
      for (let x = 0; x < W; x += 3) {
        const u = x / W;
        const y = H * (top + 0.07 * Math.sin(u * TAU * f + ph) + 0.03 * Math.sin(u * TAU * 3.7 + ph2));
        const hh = H * len * (0.6 + 0.4 * Math.sin(u * TAU * 5.3 + ph));
        const a = 0.1 + 0.09 * Math.sin(u * TAU * 9 + ph2);
        c.fillStyle = lin(c, 0, y - hh * 0.25, 0, y + hh, [`rgba(${rgb}, 0)`, [0.22, `rgba(${rgb}, ${a.toFixed(3)})`], `rgba(${rgb}, 0)`]);
        c.fillRect(x, y - hh * 0.25, 3, hh * 1.25);
      }
    }
    c.globalCompositeOperation = 'source-over';
    ridge(c, W, H, H * 0.82, H * 0.035, r, '#06121f');
    ridge(c, W, H, H * 0.88, H * 0.025, r, '#020912');
    const lake = lin(c, 0, H * 0.93, 0, H, ['rgba(70, 230, 190, .22)', 'rgba(8, 20, 32, .1)']);
    c.fillStyle = lake;
    c.fillRect(0, H * 0.945, W, H * 0.055);
  }],
  ['Seifenblasen', 800, 800, (c, W, H, r) => {
    c.fillStyle = lin(c, 0, 0, W, H, ['#ffe3ec', '#e4dcff', '#cfeeff']);
    c.fillRect(0, 0, W, H);
    const hues = ['255, 120, 170', '130, 140, 255', '90, 200, 255', '255, 190, 110', '120, 225, 190'];
    for (let i = 0; i < 30; i++) {
      const x = r() * W, y = r() * H, rad = 26 + r() * r() * 150;
      const rgb = hues[i % hues.length];
      const g = c.createRadialGradient(x, y, rad * 0.35, x, y, rad);
      g.addColorStop(0, `rgba(${rgb}, .03)`);
      g.addColorStop(0.82, `rgba(${rgb}, .2)`);
      g.addColorStop(0.97, `rgba(${rgb}, .62)`);
      g.addColorStop(1, `rgba(${rgb}, 0)`);
      c.fillStyle = g;
      c.beginPath(); c.arc(x, y, rad, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(255, 255, 255, .85)';
      c.lineWidth = Math.max(1.5, rad * 0.045);
      c.lineCap = 'round';
      c.beginPath(); c.arc(x, y, rad * 0.74, Math.PI * 1.12, Math.PI * 1.42); c.stroke();
      c.fillStyle = 'rgba(255, 255, 255, .7)';
      c.beginPath(); c.arc(x + rad * 0.42, y + rad * 0.46, rad * 0.05, 0, TAU); c.fill();
    }
  }],
  ['Stadt bei Nacht', 960, 640, (c, W, H, r) => {
    const horizon = H * 0.72;
    c.fillStyle = lin(c, 0, 0, 0, horizon, ['#0a0f33', '#3a2a78', '#c2567e', '#ffa26b']);
    c.fillRect(0, 0, W, horizon);
    c.fillStyle = '#fff6dd';
    c.beginPath(); c.arc(W * 0.22, H * 0.2, 34, 0, TAU); c.fill();
    c.fillStyle = '#16184a';
    c.beginPath(); c.arc(W * 0.22 + 13, H * 0.2 - 8, 30, 0, TAU); c.fill();
    const layers = [['#3b2c70', 0.34, 0.9, 0], ['#221b52', 0.26, 1.25, 0.5], ['#0c0b28', 0.17, 1.7, 0.85]];
    for (const [col, minH, wk, lights] of layers) {
      let x = -10;
      while (x < W) {
        const bw = (28 + r() * 46) * wk, bh = H * (minH * 0.45 + r() * minH);
        c.fillStyle = col;
        c.fillRect(x, horizon - bh, bw, bh);
        if (r() < 0.3) c.fillRect(x + bw * 0.45, horizon - bh - 16 - r() * 22, 3, 40);
        if (lights) {
          for (let wy = horizon - bh + 9; wy < horizon - 8; wy += 11) {
            for (let wx = x + 6; wx < x + bw - 8; wx += 10) {
              if (r() < 0.34 * lights) { c.fillStyle = r() < 0.75 ? 'rgba(255, 214, 130, .9)' : 'rgba(150, 220, 255, .85)'; c.fillRect(wx, wy, 4.5, 5.5); }
            }
          }
        }
        x += bw + r() * 5;
      }
    }
    // Spiegelung im Wasser
    c.save();
    c.translate(0, horizon * 2);
    c.scale(1, -1);
    c.globalAlpha = 0.5;
    c.drawImage(c.canvas, 0, horizon - (H - horizon), W, H - horizon, 0, horizon - (H - horizon), W, H - horizon);
    c.restore();
    c.fillStyle = lin(c, 0, horizon, 0, H, ['rgba(10, 12, 48, .35)', 'rgba(4, 5, 22, .88)']);
    c.fillRect(0, horizon, W, H - horizon);
    c.strokeStyle = 'rgba(255, 255, 255, .07)';
    for (let y = horizon + 6; y < H; y += 7) {
      c.beginPath(); c.moveTo(r() * W * 0.4, y); c.lineTo(W * (0.5 + r() * 0.5), y); c.stroke();
    }
  }],
  ['Papierberge', 640, 960, (c, W, H, r) => {
    c.fillStyle = lin(c, 0, 0, 0, H, ['#fff1d8', '#ffd9c2', '#f6b8b0']);
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#ff8a6b';
    c.beginPath(); c.arc(W * 0.66, H * 0.24, 62, 0, TAU); c.fill();
    const cols = ['#f3a59d', '#d98a98', '#aa7398', '#77608f', '#4d4d82', '#2f3a6b', '#1a2550'];
    c.shadowColor = 'rgba(30, 20, 60, .28)';
    c.shadowBlur = 22;
    c.shadowOffsetY = -6;
    cols.forEach((col, i) => ridge(c, W, H, H * (0.36 + i * 0.09), H * (0.05 - i * 0.003), r, col, 4));
    c.shadowColor = 'transparent';
  }],
  ['Farbfelder', 960, 640, (c, W, H, r) => {
    const pal = ['#f2542d', '#f5b82e', '#0e9594', '#127475', '#253d5b', '#f5dfbb'];
    c.fillStyle = '#f6ead7';
    c.fillRect(0, 0, W, H);
    const s = 160;
    for (let y = 0; y < H; y += s) {
      for (let x = 0; x < W; x += s) {
        const a = pal[(r() * 5) | 0];
        let b = pal[(r() * 6) | 0];
        if (a === b) b = pal[5];
        c.save();
        c.beginPath(); c.rect(x, y, s, s); c.clip();
        c.fillStyle = a;
        c.fillRect(x, y, s, s);
        c.fillStyle = b;
        const kind = (r() * 6) | 0, q = (r() * 4) | 0;
        const cxs = [x, x + s, x + s, x], cys = [y, y, y + s, y + s];
        c.beginPath();
        if (kind === 0) c.arc(cxs[q], cys[q], s, 0, TAU);
        else if (kind === 1) c.arc(x + s / 2, y + s / 2, s * 0.34, 0, TAU);
        else if (kind === 2) c.arc(x + s / 2, cys[q], s / 2, 0, TAU);
        else if (kind === 3) { c.moveTo(cxs[q], cys[q]); c.lineTo(cxs[(q + 1) % 4], cys[(q + 1) % 4]); c.lineTo(cxs[(q + 2) % 4], cys[(q + 2) % 4]); }
        else if (kind === 4) { for (let k = 0; k < 4; k++) c.rect(x + k * s / 4, y, s / 8, s); }
        else { c.arc(cxs[q], cys[q], s * 0.5, 0, TAU); c.arc(cxs[(q + 2) % 4], cys[(q + 2) % 4], s * 0.5, 0, TAU); }
        c.fill();
        c.restore();
      }
    }
  }],
];

function makeSamples() {
  if (!vfs.exists(PICS)) vfs.mkdir(PICS);
  let n = 0;
  SAMPLES.forEach(([name, W, H, draw], i) => {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    draw(cv.getContext('2d'), W, H, rng(Date.now() + i * 7919));
    vfs.write(`${PICS}/${vfs.unique(PICS, `${name}.jpg`)}`, cv.toDataURL('image/jpeg', 0.84), 'image/jpeg');
    n++;
  });
  return n;
}

// ==========================================================================
// Stile
// ==========================================================================
style('photos', `
.photos { position: relative; }
.photos-bar .gslider { width: 120px; flex: none; }
.photos-view { display: inline-flex; align-items: center; gap: 4px; min-width: 0; padding: 4px 8px; border: 0; border-radius: 8px; background: none; }
.photos-view .ico { display: none; width: 12px; height: 12px; color: var(--fg-3); }
.photos-count { font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.photos-zico { display: grid; color: var(--fg-3); }
.photos-zico .ico { width: 14px; height: 14px; }
.photos-zico.big .ico { width: 19px; height: 19px; }
.photos-side .photos-new { color: var(--fg-3); }
.photos-side .photos-new .ico { color: var(--fg-3); }
.photos-grid { flex: 1; min-height: 0; padding: 2px 14px 18px; outline: 0; }
.photos-sec { padding: 12px 2px 7px; font-size: 13px; font-weight: 700; color: var(--fg-2); }
.photos-sec span { margin-left: 7px; font-weight: 500; color: var(--fg-3); font-variant-numeric: tabular-nums; }
.photos-cells { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(var(--cell, 150px), 100%), 1fr)); gap: 6px; }
.photos-cell { position: relative; aspect-ratio: 1; min-width: 0; padding: 0; border: 0; border-radius: 10px; overflow: hidden; background: var(--well); outline: 0; transition: transform .4s var(--spring), box-shadow .2s; }
.photos-cell img { width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity .35s; -webkit-user-drag: none; }
.photos-cell img.is-in { opacity: 1; }
.photos-cell.is-sel { transform: scale(.93); box-shadow: 0 0 0 3px var(--accent); }
.photos-cell i { position: absolute; right: 6px; bottom: 6px; display: grid; color: #fff; filter: drop-shadow(0 1px 2px rgba(0, 0, 14, .7)); }
.photos-cell i .ico { width: 15px; height: 15px; }
.photos-empty { display: grid; place-content: center; justify-items: center; flex: 1; min-height: 100%; }
.photos-empty .kit-empty { flex: none; padding-bottom: 14px; }
.photos-empty-btns { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; padding: 0 16px 24px; }
.photos-drop { position: absolute; inset: 8px; z-index: 30; display: grid; place-content: center; justify-items: center; gap: 8px; border-radius: 14px; background: color-mix(in srgb, var(--accent) 20%, var(--solid)); box-shadow: inset 0 0 0 2px var(--accent); font-weight: 650; pointer-events: none; animation: photos-in .2s var(--ease-out) both; }
.photos-drop .ico { width: 34px; height: 34px; }

.photos.is-viewing > .kit-split { visibility: hidden; }
.photos-viewer { position: absolute; inset: 0; z-index: 20; display: flex; flex-direction: column; animation: photos-in .26s var(--ease-out) both; }
@keyframes photos-in { from { opacity: 0; transform: scale(1.03); } }
.photos-vname { flex: 1 1 0; min-width: 0; padding: 0 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13.5px; font-weight: 650; }
.photos-vname small { margin-left: 8px; font-size: 12px; font-weight: 500; color: var(--fg-3); font-variant-numeric: tabular-nums; }
.photos-vbar .tool.is-fav { color: var(--c-coral); }
.photos-vmain { position: relative; display: grid; grid-template-columns: minmax(0, 1fr); flex: 1; min-height: 0; }
.photos-stage { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: rgba(0, 0, 14, .34); touch-action: none; outline: 0; }
[data-theme="light"] .photos-stage { background: rgba(11, 16, 48, .12); }
.photos-stage img { position: absolute; left: ${PAD}px; top: ${PAD}px; width: calc(100% - ${PAD * 2}px); height: calc(100% - ${PAD * 2}px); max-width: none; object-fit: contain; opacity: 0; transition: opacity var(--fade, .22s) ease; pointer-events: none; -webkit-user-drag: none; }
.photos-stage img.is-on { opacity: 1; }
.photos-stage img.is-ease { transition: opacity var(--fade, .22s) ease, transform .36s var(--ease-out); }
.photos-stage.is-zoom { cursor: grab; }
.photos-stage.is-pan { cursor: grabbing; }
.photos-nav { position: absolute; top: 50%; z-index: 3; display: grid; place-items: center; width: 38px; height: 38px; margin-top: -19px; padding: 0; border: 0; border-radius: 50%; background: color-mix(in srgb, var(--solid) 78%, transparent); color: var(--fg); box-shadow: 0 6px 18px -6px rgba(0, 0, 14, .6), inset 0 0 0 .5px var(--glass-edge); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); opacity: 0; transition: opacity .2s, transform .4s var(--spring); }
.photos-nav.prev { left: 12px; }
.photos-nav.next { right: 12px; }
.photos-stage:hover .photos-nav, .photos-nav:focus-visible { opacity: 1; }
.photos-nav:active { transform: scale(.88); }
.photos-nav:disabled { display: none; }
.photos-zoom { position: absolute; left: 50%; bottom: 14px; z-index: 3; padding: 4px 11px; border-radius: 99px; background: color-mix(in srgb, var(--solid) 80%, transparent); font-size: 12px; font-weight: 650; font-variant-numeric: tabular-nums; translate: -50% 0; opacity: 0; transition: opacity .3s; pointer-events: none; }
.photos-zoom.on { opacity: 1; }
.photos-info { position: absolute; top: 12px; right: 12px; z-index: 4; display: grid; gap: 9px; width: min(250px, calc(100% - 24px)); padding: 14px; border-radius: 14px; background: color-mix(in srgb, var(--solid) 88%, transparent); -webkit-backdrop-filter: blur(22px); backdrop-filter: blur(22px); box-shadow: 0 18px 44px -16px rgba(0, 0, 14, .6), inset 0 0 0 .5px var(--glass-edge); animation: photos-pop .32s var(--spring-soft) both; }
@keyframes photos-pop { from { opacity: 0; transform: translateY(-8px) scale(.96); } }
.photos-info b { font-size: 13.5px; overflow-wrap: anywhere; }
.photos-info dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 5px 12px; margin: 0; font-size: 12.5px; }
.photos-info dt { color: var(--fg-3); }
.photos-info dd { margin: 0; text-align: right; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }

.photos-viewer.is-slide { background: #03040c; }
.photos-viewer.is-slide .photos-vbar, .photos-viewer.is-slide .photos-nav, .photos-viewer.is-slide .photos-info { display: none; }
.photos-viewer.is-slide .photos-stage { background: none; cursor: none; --fade: 1.1s; }
.photos-viewer.is-slide .photos-stage img { left: 0; top: 0; width: 100%; height: 100%; }
.photos-slidehint { position: absolute; left: 50%; bottom: 16px; z-index: 5; padding: 5px 12px; border-radius: 99px; background: rgba(255, 255, 255, .14); color: #fff; font-size: 12px; font-weight: 600; translate: -50% 0; pointer-events: none; animation: photos-hint 3.2s both; }
@keyframes photos-hint { 0%, 100% { opacity: 0; } 12%, 70% { opacity: 1; } }

.photos-viewer.is-edit .photos-vmain { grid-template-columns: minmax(0, 1fr) 268px; }
.photos-viewer.is-edit .photos-nav, .photos-viewer.is-edit .photos-stage img { display: none; }
.photos-canvas { position: absolute; left: ${PAD}px; top: ${PAD}px; width: calc(100% - ${PAD * 2}px); height: calc(100% - ${PAD * 2}px); max-width: none; object-fit: contain; }
.photos-edit { display: flex; flex-direction: column; min-width: 0; min-height: 0; border-left: .5px solid var(--line); }
.photos-edit-body { flex: 1; min-height: 0; padding: 12px 14px; display: flex; flex-direction: column; gap: 9px; }
.photos-edit-body > * { flex: none; }
.photos-looks { display: grid; grid-auto-flow: column; grid-auto-columns: 58px; gap: 8px; margin: -5px -14px 0; padding: 5px 14px 2px; overflow-x: auto; scrollbar-width: none; scroll-snap-type: x proximity; scroll-padding-inline: 14px; }
.photos-looks::-webkit-scrollbar { display: none; }
.photos-looks button { scroll-snap-align: start; }
.photos-looks button { display: grid; justify-items: center; gap: 4px; min-width: 0; padding: 0; border: 0; background: none; font-size: 11px; font-weight: 600; color: var(--fg-3); }
.photos-looks canvas { width: 100%; aspect-ratio: 1; border-radius: 9px; background: var(--well); transition: transform .4s var(--spring), box-shadow .2s; }
.photos-looks button:hover canvas { transform: scale(1.06); }
.photos-looks button.is-on { color: var(--fg); }
.photos-looks button.is-on canvas { box-shadow: 0 0 0 2px var(--solid), 0 0 0 4px var(--accent); }
.photos-looks span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.photos-adj { display: grid; grid-template-columns: 1fr auto; align-items: baseline; row-gap: 0; }
.photos-adj span { font-size: 12.5px; font-weight: 600; color: var(--fg-2); }
.photos-adj output { font: 500 11.5px var(--mono); color: var(--fg-3); }
.photos-adj .gslider { grid-column: 1 / -1; height: 24px; }
.photos-geo { display: flex; gap: 6px; flex-wrap: wrap; }
.photos-geo .kit-btn { flex: 1 1 0; padding-inline: 8px; }
.photos-geo .kit-btn.photos-reset { flex: 0 0 auto; }
.photos-edit-foot { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; flex: none; padding: 10px 14px 12px; border-top: .5px solid var(--line); }
.photos-edit-foot .kit-btn { flex: 1 1 auto; }

.photos-w-img { position: absolute; inset: 0; background: center / cover no-repeat; opacity: 0; transition: opacity 1.2s ease; }
.photos-w-img.is-on { opacity: 1; }
.photos-w-empty { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 8px; font-size: 12px; font-weight: 600; color: var(--fg-3); background: radial-gradient(120% 90% at 20% 10%, color-mix(in srgb, var(--c-violet) 30%, transparent), transparent 60%), radial-gradient(110% 90% at 90% 100%, color-mix(in srgb, var(--c-amber) 28%, transparent), transparent 62%); }
.photos-w-empty .ico { width: 34px; height: 34px; stroke-width: 1.3; }

@container win (max-width: 560px) {
  .photos-view .ico { display: block; }
  .photos-bar .gslider { width: 90px; }
  .photos-zico { display: none; }
  .photos-grid { padding-inline: 10px; }
  .photos-viewer.is-edit .photos-vmain { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(90px, 1fr) minmax(0, 1.25fr); }
  .photos-edit { border-left: 0; border-top: .5px solid var(--line); }
  .photos-vname small { display: none; }
}
@container win (max-width: 470px) {
  .photos-count { display: none; }
}
`);

// ==========================================================================
// App
// ==========================================================================
export default {
  singleton: true,
  width: 920, height: 640, minW: 420, minH: 340,

  mount(win, args) {
    const S = appStore('photos');
    let lib = { items: [], albums: [] };
    let view = { kind: 'all', path: null };
    let shown = [];
    let sel = new Set();
    let anchor = null;
    let favs = new Set(S.get('favs', []));
    let closed = false;
    const cellEls = new Map();

    const saveFavs = () => S.set('favs', [...favs]);
    const say = (text) => toast(win, text);
    const fail = (err) => say(`Das hat nicht geklappt: ${err?.message || err}`);

    // ---------- Gerüst ----------
    const side = h('nav.kit-side.scroll.photos-side', { 'aria-label': 'Ansichten' });
    const grid = h('div.photos-grid.scroll', { tabIndex: 0, 'aria-label': 'Fotos' });
    const titleEl = h('b.kit-title');
    const viewBtn = h('button.photos-view', { type: 'button', 'aria-label': 'Ansicht wählen' }, titleEl, h('span', { html: icon('chevronDown') }));
    const countEl = h('span.kit-muted.photos-count');
    const sizeSl = h('div.gslider', { dataset: { min: 90, max: 260, step: 2, value: clamp(S.get('cell', 150), 90, 260) }, 'aria-label': 'Größe der Miniaturen' });
    const bar = h('div.kit-bar.photos-bar', viewBtn, countEl, h('span.sp'),
      h('span.photos-zico', { html: icon('image') }), sizeSl, h('span.photos-zico.big', { html: icon('image') }));
    const root = h('div.kit-app.photos', h('div.kit-split', side, h('div.kit-main', bar, grid)));
    win.body.append(root);
    initControls(bar);
    grid.style.setProperty('--cell', `${sizeSl.value}px`);
    sizeSl.addEventListener('input', (e) => grid.style.setProperty('--cell', `${e.detail.value}px`));
    sizeSl.addEventListener('change', (e) => S.set('cell', e.detail.value));
    win.tools.append(toolBtn('plus', 'Vom Gerät importieren', () => importFromDevice()));

    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        io.unobserve(en.target);
        const st = en.target._st;
        const img = en.target.firstElementChild;
        thumb(st).then((t) => { img.src = t.url; img.onload = () => img.classList.add('is-in'); }, () => { en.target.title = `${st.name} (nicht lesbar)`; });
      }
    }, { root: grid, rootMargin: '300px' });

    // ---------- Ansichten ----------
    const viewName = () => (view.kind === 'all' ? 'Mediathek' : view.kind === 'favs' ? 'Favoriten' : basename(view.path));
    const listFor = (v) => (v.kind === 'all' ? lib.items : v.kind === 'favs' ? lib.items.filter((s) => favs.has(s.path)) : lib.items.filter((s) => dirname(s.path) === v.path));
    const targetDir = () => (view.kind === 'album' && vfs.isDir(view.path) ? view.path : PICS);
    const setView = (kind, path = null) => {
      view = { kind, path };
      sel.clear();
      anchor = null;
      paint();
      grid.scrollTop = 0;
    };
    const viewItems = () => [
      { label: 'Mediathek', icon: 'image', checked: view.kind === 'all', run: () => setView('all') },
      { label: 'Favoriten', checked: view.kind === 'favs', run: () => setView('favs') },
      ...(lib.albums.length ? ['-', { heading: 'Alben' }] : []),
      ...lib.albums.map((a) => ({ label: a.name, icon: 'folder', checked: view.kind === 'album' && view.path === a.path, run: () => setView('album', a.path) })),
      '-',
      { label: 'Neues Album …', icon: 'plus', run: newAlbum },
    ];
    viewBtn.addEventListener('click', () => openMenu(viewItems(), { anchor: viewBtn }));

    function paintSide() {
      const btn = (html, label, n, on, run) => h('button', { type: 'button', class: on ? 'is-on' : '', onclick: run },
        h('i', { html, style: { display: 'grid' } }), h('span', label), h('span.kit-count', String(n)));
      side.replaceChildren(
        btn(icon('image'), 'Mediathek', lib.items.length, view.kind === 'all', () => setView('all')),
        btn(IC.heart, 'Favoriten', lib.items.filter((s) => favs.has(s.path)).length, view.kind === 'favs', () => setView('favs')),
        h('div.kit-head', 'Alben'),
        ...lib.albums.map((a) => {
          const b = btn(icon('folder'), a.name, a.count, view.kind === 'album' && view.path === a.path, () => setView('album', a.path));
          b.title = prettyPath(a.path);
          return b;
        }),
        h('button.photos-new', { type: 'button', onclick: newAlbum }, h('i', { html: icon('plus'), style: { display: 'grid' } }), h('span', 'Neues Album')),
      );
    }

    function paintGrid() {
      shown = listFor(view);
      titleEl.textContent = viewName();
      countEl.textContent = shown.length === 1 ? '1 Foto' : `${shown.length.toLocaleString('de-DE')} Fotos`;
      io.disconnect();
      cellEls.clear();
      if (!shown.length) {
        const whole = !lib.items.length;
        const box = whole
          ? emptyState('image', 'Deine Mediathek ist noch leer', 'Importiere Bilder von deinem Gerät, zieh sie einfach auf dieses Fenster – oder lass dir ein paar Beispiele zeichnen.')
          : view.kind === 'favs'
            ? emptyState('sparkles', 'Noch keine Favoriten', 'Markiere Fotos mit dem Herz, dann findest du sie hier wieder.')
            : emptyState('folder', 'Dieses Album ist leer', 'Importierte Bilder landen im geöffneten Album.');
        grid.replaceChildren(h('div.photos-empty', box, h('div.photos-empty-btns',
          whole ? h('button.kit-btn.primary.big', { type: 'button', onclick: createSamples }, 'Beispielbilder erzeugen') : null,
          view.kind !== 'favs' ? h('button.kit-btn.big', { type: 'button', onclick: () => importFromDevice() }, 'Importieren …') : null)));
        return;
      }
      const frag = [];
      let label = null;
      let cells = null;
      let head = null;
      for (const st of shown) {
        const l = groupLabel(st.mtime);
        if (l !== label) {
          label = l;
          cells = h('div.photos-cells');
          head = h('span', '0');
          frag.push(h('div.photos-sec', l, head), cells);
        }
        const el = h('button.photos-cell', { type: 'button', tabIndex: -1, title: st.name, 'aria-label': st.name, dataset: { path: st.path } },
          h('img', { alt: '', draggable: false }), favs.has(st.path) ? h('i', { html: IC.heartFill }) : null);
        el._st = st;
        cells.append(el);
        head.textContent = String(cells.children.length);
        cellEls.set(st.path, el);
        io.observe(el);
      }
      grid.replaceChildren(...frag);
      paintSel();
    }
    const paint = () => { paintSide(); paintGrid(); keepFocus(); };
    const paintSel = () => { for (const [p, el] of cellEls) el.classList.toggle('is-sel', sel.has(p)); };
    /** Verschwindet das fokussierte Element, bleibt die Tastatur trotzdem im Fenster. */
    const keepFocus = () => {
      const a = document.activeElement;
      if (sys.wm.focused === win && (!a || a === document.body || !a.isConnected || a.closest('[hidden]'))) (V.open ? stage : grid).focus({ preventScroll: true });
    };

    const reload = () => {
      if (closed) return;
      lib = scan();
      const all = new Set(lib.items.map((s) => s.path));
      sel = new Set([...sel].filter((p) => all.has(p)));
      if (view.kind === 'album' && !vfs.isDir(view.path)) view = { kind: 'all', path: null };
      paint();
      viewerSync();
    };

    // ---------- Auswahl & Raster-Bedienung ----------
    const selected = () => shown.filter((s) => sel.has(s.path));
    const select = (path, e = {}) => {
      if (e.shiftKey && anchor) {
        const a = shown.findIndex((s) => s.path === anchor), b = shown.findIndex((s) => s.path === path);
        if (a >= 0 && b >= 0) { sel = new Set(shown.slice(Math.min(a, b), Math.max(a, b) + 1).map((s) => s.path)); paintSel(); return; }
      }
      if (e.metaKey || e.ctrlKey) { if (sel.has(path)) sel.delete(path); else sel.add(path); } else sel = new Set([path]);
      anchor = path;
      paintSel();
    };
    grid.addEventListener('click', (e) => {
      const cell = e.target.closest('.photos-cell');
      if (cell) { select(cell.dataset.path, e); grid.focus({ preventScroll: true }); }
      else if (!e.target.closest('button')) { sel.clear(); paintSel(); }
    });
    grid.addEventListener('dblclick', (e) => {
      const cell = e.target.closest('.photos-cell');
      if (cell) openViewer(cell.dataset.path);
    });
    grid.addEventListener('contextmenu', (e) => {
      const cell = e.target.closest('.photos-cell');
      if (!cell) return;
      e.preventDefault();
      e.stopPropagation();
      if (!sel.has(cell.dataset.path)) select(cell.dataset.path);
      openMenu(itemMenu(selected()), { x: e.clientX, y: e.clientY });
    });
    const moveSel = (dx, dy, e) => {
      if (!shown.length) return;
      const curPath = anchor && cellEls.has(anchor) ? anchor : null;
      if (!curPath) { select(shown[0].path); cellEls.get(shown[0].path)?.scrollIntoView({ block: 'nearest' }); return; }
      let i = shown.findIndex((s) => s.path === curPath);
      if (dx) i = clamp(i + dx, 0, shown.length - 1);
      else {
        // nächste Zeile: die Kachel, die waagerecht am nächsten liegt
        const r0 = cellEls.get(curPath).getBoundingClientRect();
        let best = -1, bestD = Infinity, rowTop = null;
        for (let k = i + dy; k >= 0 && k < shown.length; k += dy) {
          const r = cellEls.get(shown[k].path).getBoundingClientRect();
          if (Math.abs(r.top - r0.top) < 4) continue;
          if (rowTop == null) rowTop = r.top;
          if (Math.abs(r.top - rowTop) > 4) break;
          const d = Math.abs(r.left - r0.left);
          if (d < bestD) { bestD = d; best = k; }
        }
        if (best < 0) return;
        i = best;
      }
      const path = shown[i].path;
      if (e.shiftKey) { sel.add(path); anchor = path; paintSel(); } else select(path);
      cellEls.get(path)?.scrollIntoView({ block: 'nearest' });
    };

    // ---------- Aktionen ----------
    const isFav = (p) => favs.has(p);
    function toggleFav(paths) {
      const on = !paths.every(isFav);
      for (const p of paths) { if (on) favs.add(p); else favs.delete(p); }
      saveFavs();
      paint();
      viewerPaintBar();
    }
    function rekey(from, to) {
      if (favs.delete(from)) { favs.add(to); saveFavs(); }
      if (sys.settings.wallImage === from) sys.setWallpaperImage(to);
    }
    async function rename(st) {
      const ext = extname(st.path);
      const name = await promptSheet(win, { title: 'Foto umbenennen', value: stemOf(st.name), ok: 'Umbenennen' });
      if (!name || name === stemOf(st.name)) return;
      try {
        const to = `${dirname(st.path)}/${name}${ext ? `.${ext}` : ''}`;
        if (vfs.exists(to)) throw new Error('Diesen Namen gibt es hier schon');
        if (V.open && V.list[V.i] === st.path) V.list[V.i] = to;
        if (sel.delete(st.path)) sel.add(to);
        if (anchor === st.path) anchor = to;
        rekey(st.path, to);
        vfs.move(st.path, to);
      } catch (err) { fail(err); }
    }
    function trash(list) {
      if (!list.length) return;
      let n = 0;
      for (const st of list) {
        try { vfs.trash(st.path); favs.delete(st.path); n++; } catch (err) { fail(err); }
      }
      saveFavs();
      if (n) say(n === 1 ? 'In den Papierkorb gelegt' : `${n} Fotos in den Papierkorb gelegt`);
    }
    function exportPics(list) {
      list.forEach((st, i) => setTimeout(() => { try { download(st.name, vfs.read(st.path), st.mime); } catch (err) { fail(err); } }, i * 180));
      if (list.length) say(list.length === 1 ? `„${list[0].name}“ exportiert` : `${list.length} Fotos exportiert`);
    }
    function setWallpaper(st) {
      sys.setWallpaperImage(st.path);
      say('Als Hintergrund gesetzt');
    }
    function moveTo(list, dir) {
      let n = 0;
      for (const st of list) {
        if (dirname(st.path) === dir) continue;
        try {
          const to = `${dir}/${vfs.unique(dir, st.name)}`;
          rekey(st.path, to);
          vfs.move(st.path, to);
          n++;
        } catch (err) { fail(err); }
      }
      if (n) say(`${n === 1 ? 'Foto' : `${n} Fotos`} nach „${dir === PICS ? 'Bilder' : basename(dir)}“ bewegt`);
    }
    async function newAlbum() {
      const name = await promptSheet(win, { title: 'Neues Album', placeholder: 'Name des Albums', ok: 'Anlegen' });
      if (!name) return null;
      try {
        if (!vfs.exists(PICS)) vfs.mkdir(PICS);
        const path = `${PICS}/${name}`;
        if (vfs.exists(path)) throw new Error('Dieses Album gibt es schon');
        vfs.mkdir(path);
        lib = scan();
        setView('album', path);
        return path;
      } catch (err) { fail(err); return null; }
    }
    function createSamples() {
      try { makeSamples(); say('Sechs Beispielbilder gezeichnet'); } catch (err) { fail(err); }
    }

    function itemMenu(list) {
      if (!list.length) return [];
      const one = list.length === 1 ? list[0] : null;
      const paths = list.map((s) => s.path);
      const dirs = [{ path: PICS, name: 'Bilder' }, ...lib.albums].filter((a) => list.some((s) => dirname(s.path) !== a.path)).slice(0, 7);
      return [
        one && { label: 'Öffnen', icon: 'arrowUpRight', run: () => openViewer(one.path) },
        one && { label: 'Bearbeiten', icon: 'sliders', run: () => { openViewer(one.path); startEdit(); } },
        { label: paths.every(isFav) ? 'Aus Favoriten entfernen' : 'Zu Favoriten', run: () => toggleFav(paths) },
        '-',
        one && { label: 'Umbenennen …', icon: 'note', run: () => rename(one) },
        one && { label: 'Als Hintergrund', icon: 'image', run: () => setWallpaper(one) },
        { label: list.length > 1 ? `${list.length} Fotos exportieren` : 'Exportieren', icon: 'download', run: () => exportPics(list) },
        ...(dirs.length ? ['-', { heading: 'Bewegen nach' }, ...dirs.map((a) => ({ label: a.name, icon: 'folder', run: () => moveTo(list, a.path) }))] : []),
        '-',
        { label: 'In den Papierkorb', icon: 'trash', run: () => trash(list) },
      ];
    }

    // ---------- Importieren ----------
    async function addFiles(files) {
      if (!files.length) return;
      const dir = targetDir();
      let n = 0, bad = 0;
      try { if (!vfs.exists(PICS)) vfs.mkdir(PICS); } catch { /* gleich unten gemeldet */ }
      for (const f of files) {
        try {
          const img = await loadImg(f.data);
          const w = img.naturalWidth, hgt = img.naturalHeight;
          const type = (/^data:([^;,]+)/.exec(f.data) || [])[1] || f.type || '';
          let data = f.data, mime = type, ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[type];
          if (!ext || Math.max(w, hgt) > MAX_EDGE || f.data.length > 1500000) {
            const k = Math.min(1, MAX_EDGE / Math.max(w, hgt));
            const cv = document.createElement('canvas');
            cv.width = Math.round(w * k);
            cv.height = Math.round(hgt * k);
            const c = cv.getContext('2d');
            c.fillStyle = '#fff';
            c.fillRect(0, 0, cv.width, cv.height);
            c.drawImage(img, 0, 0, cv.width, cv.height);
            data = cv.toDataURL('image/jpeg', 0.86);
            mime = 'image/jpeg';
            ext = 'jpg';
          }
          const stem = stemOf(f.name || 'Bild').replace(/[/\\]/g, '-').trim().slice(0, 60) || 'Bild';
          vfs.write(`${dir}/${vfs.unique(dir, `${stem}.${ext}`)}`, data, mime);
          n++;
        } catch { bad++; }
      }
      say(n ? `${n === 1 ? 'Ein Foto' : `${n} Fotos`} importiert${bad ? ` · ${bad} nicht lesbar` : ''}` : 'Diese Dateien lassen sich nicht als Bild lesen');
    }
    async function importFromDevice() {
      const files = await importFiles({ accept: 'image/*', multiple: true });
      if (!closed) addFiles(files);
    }
    let dropEl = null;
    let dropDepth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    const dropOff = () => { dropDepth = 0; dropEl?.remove(); dropEl = null; };
    root.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      dropDepth++;
      if (!dropEl) root.append(dropEl = h('div.photos-drop', { html: icon('download') }, h('span', `In „${view.kind === 'album' ? basename(targetDir()) : 'Bilder'}“ importieren`)));
    });
    root.addEventListener('dragleave', () => { if (--dropDepth <= 0) dropOff(); });
    root.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    root.addEventListener('drop', async (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dropOff();
      const out = [];
      for (const f of e.dataTransfer.files) {
        if (!f.type.startsWith('image/')) continue;
        try { out.push({ name: f.name, type: f.type, data: await readFile(f) }); } catch { /* überspringen */ }
      }
      if (out.length) addFiles(out); else say('Hier lassen sich nur Bilder ablegen');
    });

    // ======================================================================
    // Betrachter
    // ======================================================================
    const V = { open: false, list: [], i: 0, z: 1, tx: 0, ty: 0, nat: null, token: 0, slide: 0, info: false, edit: null, shownM: null };
    const imgs = [h('img', { alt: '', draggable: false }), h('img', { alt: '', draggable: false })];
    let front = 0;
    const vName = h('div.photos-vname');
    const bFav = tool(IC.heart, 'Favorit', () => toggleFav([V.list[V.i]]));
    const bSlide = tool(icon('play'), 'Diashow (Leertaste)', () => slideshow(true));
    const bInfo = tool(icon('info'), 'Infos (I)', () => { V.info = !V.info; paintInfo(); });
    const bEdit = tool(icon('sliders'), 'Bearbeiten (E)', () => startEdit());
    const bMore = tool(svg('<circle cx="5.500" cy="12" r="1.300" fill="currentColor"/><circle cx="12" cy="12" r="1.300" fill="currentColor"/><circle cx="18.500" cy="12" r="1.300" fill="currentColor"/>'), 'Weitere Aktionen', () => {
      const st = curStat();
      if (!st) return;
      openMenu([
        { label: 'Als Hintergrund', icon: 'image', run: () => setWallpaper(st) },
        { label: 'Umbenennen …', icon: 'note', run: () => rename(st) },
        { label: 'Exportieren', icon: 'download', run: () => exportPics([st]) },
        '-',
        { label: 'In den Papierkorb', icon: 'trash', hint: '⌫', run: () => trash([st]) },
      ], { anchor: bMore, align: 'right' });
    });
    const bWall = tool(IC.desk, 'Als Hintergrund', () => { const st = curStat(); if (st) setWallpaper(st); });
    const vBar = h('div.kit-bar.photos-vbar', tool(icon('chevronLeft'), 'Zurück zur Übersicht (Esc)', () => closeViewer()), vName, bFav, bSlide, bInfo, bWall, bEdit, bMore);
    const bPrev = h('button.photos-nav.prev', { type: 'button', 'aria-label': 'Vorheriges Foto', html: icon('chevronLeft'), onclick: () => step(-1) });
    const bNext = h('button.photos-nav.next', { type: 'button', 'aria-label': 'Nächstes Foto', html: icon('chevronRight'), onclick: () => step(1) });
    const zoomTag = h('div.photos-zoom');
    const stage = h('div.photos-stage', { tabIndex: -1 }, imgs[0], imgs[1], bPrev, bNext, zoomTag);
    const vMain = h('div.photos-vmain', stage);
    const viewer = h('div.photos-viewer', { hidden: true }, vBar, vMain);
    root.append(viewer);

    const curStat = () => (V.open ? vfs.stat(V.list[V.i]) : null);
    const natOf = (img) => ({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });

    function viewerPaintBar() {
      if (!V.open) return;
      const st = curStat();
      if (!st) return;
      vName.replaceChildren(st.name, h('small', `${V.i + 1} von ${V.list.length}`));
      const fav = favs.has(st.path);
      bFav.innerHTML = fav ? IC.heartFill : IC.heart;
      bFav.classList.toggle('is-fav', fav);
      bFav.title = fav ? 'Aus Favoriten entfernen' : 'Zu Favoriten';
      bFav.setAttribute('aria-label', bFav.title);
      bInfo.classList.toggle('is-on', V.info);
      bPrev.disabled = V.list.length < 2;
      bNext.disabled = V.list.length < 2;
      win.setTitle(`${st.name} – Fotos`);
    }

    let infoEl = null;
    function paintInfo() {
      infoEl?.remove();
      infoEl = null;
      bInfo.classList.toggle('is-on', V.info);
      const st = curStat();
      if (!V.info || !st || V.edit) return;
      const row = (k, v) => [h('dt', k), h('dd', v)];
      let size = '–';
      try { size = fmtBytes(bytesOf(vfs.read(st.path))); } catch { /* fehlt */ }
      const type = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP', 'image/gif': 'GIF' }[st.mime] || (extname(st.path) || 'Bild').toUpperCase();
      infoEl = h('div.photos-info', h('b', st.name), h('dl',
        row('Maße', V.nat ? `${V.nat.w.toLocaleString('de-DE')} × ${V.nat.h.toLocaleString('de-DE')} px` : '–'),
        row('Größe', size),
        row('Format', type),
        row('Geändert', new Date(st.mtime).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })),
        row('Ort', prettyPath(dirname(st.path)))));
      vMain.append(infoEl);
    }

    // Zoom & Verschieben
    function applyZoom(ease = false) {
      const img = imgs[front];
      const full = viewer.classList.contains('is-slide') ? 0 : PAD * 2;
      const W = stage.clientWidth - full, H = stage.clientHeight - full;
      if (V.nat && W > 0 && H > 0) {
        const f = Math.min(W / V.nat.w, H / V.nat.h);
        const mx = Math.max(0, (V.nat.w * f * V.z - stage.clientWidth) / 2), my = Math.max(0, (V.nat.h * f * V.z - stage.clientHeight) / 2);
        V.tx = clamp(V.tx, -mx, mx);
        V.ty = clamp(V.ty, -my, my);
      }
      img.classList.toggle('is-ease', ease && !reducedMotion.matches);
      img.style.transform = V.z === 1 ? '' : `translate(${V.tx.toFixed(1)}px, ${V.ty.toFixed(1)}px) scale(${V.z.toFixed(4)})`;
      stage.classList.toggle('is-zoom', V.z > 1);
    }
    let zoomTimer = 0;
    function zoomTo(z, px = 0, py = 0, ease = false) {
      z = clamp(z, 1, 8);
      if (Math.abs(z - 1) < 0.02) z = 1;
      // der Punkt unter dem Zeiger bleibt an seiner Stelle
      const qx = (px - V.tx) / V.z, qy = (py - V.ty) / V.z;
      V.tx = z === 1 ? 0 : px - qx * z;
      V.ty = z === 1 ? 0 : py - qy * z;
      V.z = z;
      applyZoom(ease);
      zoomTag.textContent = `${Math.round(z * 100)} %`;
      zoomTag.classList.add('on');
      clearTimeout(zoomTimer);
      zoomTimer = setTimeout(() => zoomTag.classList.remove('on'), 900);
    }
    const rel = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2]; };
    stage.addEventListener('wheel', (e) => {
      if (V.edit || V.slide) return;
      e.preventDefault();
      const [x, y] = rel(e);
      zoomTo(V.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0022)), x, y);
    }, { passive: false });
    stage.addEventListener('dblclick', (e) => {
      if (V.edit || e.target.closest('button')) return;
      if (V.slide) { slideshow(false); return; }
      const [x, y] = rel(e);
      zoomTo(V.z > 1 ? 1 : 2.5, x, y, true);
    });
    let pan = null;
    drag(stage, {
      start: (e) => {
        if (V.edit || e.target.closest('button')) return false;
        if (V.slide) { slideshow(false); return false; }
        pan = { tx: V.tx, ty: V.ty };
        return true;
      },
      move: (e, c) => {
        if (V.z <= 1) return;
        stage.classList.add('is-pan');
        V.tx = pan.tx + c.dx;
        V.ty = pan.ty + c.dy;
        applyZoom();
      },
      end: (e, c) => {
        stage.classList.remove('is-pan');
        if (V.z <= 1 && Math.abs(c.dx) > 70 && Math.abs(c.dx) > Math.abs(c.dy) * 1.5) step(c.dx < 0 ? 1 : -1);
      },
    });

    async function show(slow = false) {
      const token = ++V.token;
      const path = V.list[V.i];
      viewerPaintBar();
      let data = '';
      try { data = vfs.read(path); } catch { /* gleich leer */ }
      V.shownM = vfs.stat(path)?.mtime ?? null;
      const back = imgs[1 - front];
      back.classList.remove('is-ease');
      back.style.transform = '';
      stage.style.setProperty('--fade', V.slide ? '1.1s' : slow ? '.5s' : '.22s');
      try {
        back.src = data;
        await back.decode();
      } catch { /* defektes Bild: leer zeigen */ }
      if (token !== V.token) return;
      imgs[front].classList.remove('is-on');
      back.classList.add('is-on');
      front = 1 - front;
      V.nat = natOf(back);
      V.z = 1; V.tx = 0; V.ty = 0;
      stage.classList.remove('is-zoom');
      paintInfo();
    }
    function step(d) {
      if (!V.open || V.edit || V.list.length < 2) return;
      V.i = (V.i + d + V.list.length) % V.list.length;
      show();
    }

    function openViewer(path) {
      if (!vfs.exists(path)) return;
      let list = shown.map((s) => s.path);
      if (!list.includes(path)) {
        // Bild außerhalb der gezeigten Ansicht: mit seinen Nachbarn im selben Ordner blättern
        try { list = vfs.list(dirname(path)).filter(isPic).sort((a, b) => b.mtime - a.mtime).map((s) => s.path); } catch { list = [path]; }
        if (!list.includes(path)) list = [path];
      }
      if (V.edit) endEdit();
      V.list = list;
      V.i = list.indexOf(path);
      if (!V.open) {
        V.open = true;
        for (const im of imgs) { im.classList.remove('is-on'); im.removeAttribute('src'); }
        viewer.hidden = false;
        root.classList.add('is-viewing');
      }
      show();
      stage.focus({ preventScroll: true });
    }
    function closeViewer() {
      if (!V.open) return;
      slideshow(false);
      if (V.edit) endEdit();
      const path = V.list[V.i];
      V.open = false;
      V.info = false;
      V.token++;
      paintInfo();
      viewer.hidden = true;
      root.classList.remove('is-viewing');
      win.setTitle('Fotos');
      if (cellEls.has(path)) { sel = new Set([path]); anchor = path; paintSel(); cellEls.get(path).scrollIntoView({ block: 'nearest' }); }
      grid.focus({ preventScroll: true });
    }
    /** Nach Änderungen im Dateisystem: Liste des Betrachters nachführen. */
    function viewerSync() {
      if (!V.open) return;
      const cur = V.list[V.i];
      const list = V.list.filter((p) => vfs.exists(p));
      if (!list.length) { closeViewer(); return; }
      if (!vfs.exists(cur)) {
        if (V.edit) endEdit();
        V.list = list;
        V.i = Math.min(V.i, list.length - 1);
        show();
        return;
      }
      V.list = list;
      V.i = list.indexOf(cur);
      const st = vfs.stat(cur);
      if (V.shownM !== st.mtime && !V.edit) { V.shownM = st.mtime; show(); } else viewerPaintBar();
    }

    // Diashow
    function slideshow(on) {
      if (!!V.slide === on) return;
      clearInterval(V.slide);
      V.slide = 0;
      viewer.classList.toggle('is-slide', on);
      viewer.querySelector('.photos-slidehint')?.remove();
      if (on) {
        if (V.edit) return;
        V.info = false;
        paintInfo();
        zoomTo(1);
        zoomTag.classList.remove('on');
        viewer.append(h('div.photos-slidehint', 'Diashow · Leertaste oder Esc beendet'));
        V.slide = setInterval(() => {
          if (win.min || V.list.length < 2) return;
          V.i = (V.i + 1) % V.list.length;
          show(true);
        }, 4000);
      } else requestAnimationFrame(() => applyZoom());
    }

    // ======================================================================
    // Bearbeiten
    // ======================================================================
    const canvas = h('canvas.photos-canvas', { 'aria-label': 'Vorschau der Bearbeitung' });
    const looksEl = h('div.photos-looks', { role: 'listbox', 'aria-label': 'Filter' });
    const sliders = {};
    const adjRows = ADJ.map(([key, label, min]) => {
      const out = h('output', '0');
      const sl = h('div.gslider', { dataset: { min, max: 100, step: 1, value: 0 }, 'aria-label': label, title: 'Doppelklick setzt zurück' });
      sl.addEventListener('input', (e) => {
        if (!V.edit) return;
        V.edit.adj[key] = e.detail.value / 100;
        out.textContent = (e.detail.value > 0 && min < 0 ? '+' : '') + e.detail.value;
        queueRender();
      });
      sl.addEventListener('dblclick', () => { if (!V.edit) return; sl.value = 0; V.edit.adj[key] = 0; out.textContent = '0'; queueRender(); });
      sliders[key] = { sl, out };
      return h('div.photos-adj', h('span', label), out, sl);
    });
    const bSave = h('button.kit-btn.primary', { type: 'button', onclick: () => saveEdit(false) }, 'Sichern');
    const bCopy = h('button.kit-btn', { type: 'button', onclick: () => saveEdit(true) }, 'Als Kopie sichern');
    const bReset = h('button.kit-btn.photos-reset', { type: 'button', title: 'Alle Änderungen zurücksetzen', 'aria-label': 'Zurücksetzen', html: icon('undo'), onclick: () => resetEdit() });
    const editPanel = h('aside.photos-edit', { hidden: true },
      h('div.photos-edit-body.scroll',
        looksEl, ...adjRows,
        h('div.photos-geo',
          h('button.kit-btn', { type: 'button', title: 'Um 90° drehen', onclick: () => { if (V.edit) { V.edit.rot = (V.edit.rot + 1) % 4; prepare(); } } }, h('span', { html: IC.rotate, style: { display: 'grid' } }), 'Drehen'),
          h('button.kit-btn', { type: 'button', title: 'Waagerecht spiegeln', onclick: () => { if (V.edit) { V.edit.flip = !V.edit.flip; prepare(); } } }, h('span', { html: IC.flip, style: { display: 'grid' } }), 'Spiegeln'),
          bReset)),
      h('div.photos-edit-foot', h('button.kit-btn', { type: 'button', onclick: () => cancelEdit() }, 'Abbrechen'), bCopy, bSave));
    vMain.append(editPanel);
    initControls(editPanel);

    const isDirty = (E = V.edit) => !!E && (E.look !== LOOKS[0] || E.rot !== 0 || E.flip || Object.values(E.adj).some((v) => v !== 0));

    async function startEdit() {
      if (!V.open || V.edit) return;
      slideshow(false);
      const path = V.list[V.i];
      let img;
      try { img = await loadImg(vfs.read(path)); } catch (err) { fail(err); return; }
      if (!V.open || V.list[V.i] !== path) return;
      V.info = false;
      paintInfo();
      V.edit = { path, img, look: LOOKS[0], adj: { bri: 0, con: 0, sat: 0, warm: 0, vig: 0 }, rot: 0, flip: false, src: null, out: null, raf: 0 };
      for (const { sl, out } of Object.values(sliders)) { sl.value = 0; out.textContent = '0'; }
      viewer.classList.add('is-edit');
      editPanel.hidden = false;
      stage.append(canvas);
      bEdit.classList.add('is-on');
      prepare();
    }
    /** Geometrie neu zeichnen (Drehen/Spiegeln), Vorschaubilder der Filter erneuern. */
    function prepare() {
      const E = V.edit;
      const cv = drawGeometry(E.img, E.rot, E.flip, 1100);
      canvas.width = cv.width;
      canvas.height = cv.height;
      E.src = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
      E.out = new ImageData(cv.width, cv.height);
      // Mini-Vorschauen: quadratischer Ausschnitt
      const mini = document.createElement('canvas');
      mini.width = mini.height = 84;
      const side2 = Math.min(cv.width, cv.height);
      const mc = mini.getContext('2d', { willReadFrequently: true });
      mc.drawImage(cv, (cv.width - side2) / 2, (cv.height - side2) / 2, side2, side2, 0, 0, 84, 84);
      const msrc = mc.getImageData(0, 0, 84, 84);
      looksEl.replaceChildren(...LOOKS.map((look) => {
        const c2 = h('canvas', { width: 84, height: 84 });
        const o = new ImageData(84, 84);
        develop(msrc.data, o.data, 84, 84, mixParams(look, { bri: 0, con: 0, sat: 0, warm: 0, vig: 0 }));
        c2.getContext('2d').putImageData(o, 0, 0);
        const btn = h('button', { type: 'button', role: 'option', class: look === E.look ? 'is-on' : '', 'aria-selected': String(look === E.look) }, c2, h('span', look.name));
        btn._look = look;
        btn.addEventListener('click', () => {
          E.look = look;
          for (const o2 of looksEl.children) { o2.classList.toggle('is-on', o2._look === look); o2.setAttribute('aria-selected', String(o2._look === look)); }
          queueRender();
        });
        return btn;
      }));
      render();
    }
    function render() {
      const E = V.edit;
      if (!E) return;
      E.raf = 0;
      develop(E.src.data, E.out.data, E.src.width, E.src.height, mixParams(E.look, E.adj));
      canvas.getContext('2d').putImageData(E.out, 0, 0);
      const dirty = isDirty();
      bSave.disabled = !dirty;
      bCopy.disabled = !dirty;
      bReset.disabled = !dirty;
    }
    function queueRender() { if (V.edit && !V.edit.raf) V.edit.raf = requestAnimationFrame(render); }
    function resetEdit() {
      const E = V.edit;
      if (!E) return;
      E.look = LOOKS[0];
      E.rot = 0;
      E.flip = false;
      for (const k of Object.keys(E.adj)) E.adj[k] = 0;
      for (const { sl, out } of Object.values(sliders)) { sl.value = 0; out.textContent = '0'; }
      prepare();
    }
    function endEdit() {
      if (!V.edit) return;
      cancelAnimationFrame(V.edit.raf);
      V.edit = null;
      viewer.classList.remove('is-edit');
      editPanel.hidden = true;
      canvas.remove();
      bEdit.classList.remove('is-on');
      keepFocus();
      requestAnimationFrame(() => applyZoom());
    }
    async function cancelEdit() {
      if (!V.edit) return true;
      if (isDirty() && !(await confirmSheet(win, { title: 'Änderungen verwerfen?', text: 'Die Bearbeitung dieses Fotos geht verloren.', ok: 'Verwerfen', danger: true }))) return false;
      endEdit();
      return true;
    }
    function saveEdit(asCopy) {
      const E = V.edit;
      if (!E || !isDirty()) return;
      try {
        const cv = drawGeometry(E.img, E.rot, E.flip, 2400);
        const c = cv.getContext('2d');
        const px = c.getImageData(0, 0, cv.width, cv.height);
        develop(px.data, px.data, cv.width, cv.height, mixParams(E.look, E.adj));
        c.putImageData(px, 0, 0);
        const ext = extname(E.path);
        // PNG und WebP bleiben, was sie sind; alles andere wird als JPEG gesichert
        const want = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        const data = cv.toDataURL(want, 0.9);
        const mime = (/^data:([^;,]+)/.exec(data) || [])[1] || 'image/png';
        const keeps = mime === want && (want !== 'image/jpeg' || /^jpe?g$/.test(ext));
        const outExt = keeps ? ext : mime === 'image/jpeg' ? 'jpg' : 'png';
        const dir = dirname(E.path);
        const stem = stemOf(basename(E.path));
        const overwrite = !asCopy && keeps;
        const target = overwrite ? E.path : `${dir}/${vfs.unique(dir, `${stem}${asCopy ? ' (bearbeitet)' : ''}.${outExt}`)}`;
        vfs.write(target, data, mime);
        const i = V.list.indexOf(E.path);
        if (!overwrite) { V.list.splice(i + 1, 0, target); V.i = i + 1; }
        endEdit();
        V.shownM = null;
        say(overwrite ? 'Gesichert' : `Als „${basename(target)}“ gesichert`);
      } catch (err) { fail(err); }
    }

    // ---------- Tastatur ----------
    const onKey = (e) => {
      if (e.target.closest('input, textarea, select') || e.altKey) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key;
      if (V.open) {
        if (V.edit) {
          if (k === 'Escape') { e.preventDefault(); cancelEdit(); }
          else if (mod && k.toLowerCase() === 's') { e.preventDefault(); saveEdit(e.shiftKey); }
          return;
        }
        if (e.target.closest('.gslider')) return;
        const stop = () => { e.preventDefault(); if (V.slide && k !== ' ') slideshow(false); };
        if (k === 'Escape') { e.preventDefault(); if (V.slide) slideshow(false); else if (V.info) { V.info = false; paintInfo(); } else closeViewer(); }
        else if (k === 'ArrowLeft') { stop(); step(-1); }
        else if (k === 'ArrowRight') { stop(); step(1); }
        else if (k === ' ') { e.preventDefault(); slideshow(!V.slide); }
        else if (k === 'i' || k === 'I') { stop(); V.info = !V.info; paintInfo(); }
        else if (k === 'e' || k === 'E') { stop(); startEdit(); }
        else if (k === 'f' || k === 'F') { stop(); toggleFav([V.list[V.i]]); }
        else if (k === '+' || k === '=') { stop(); zoomTo(V.z * 1.4, 0, 0, true); }
        else if (k === '-') { stop(); zoomTo(V.z / 1.4, 0, 0, true); }
        else if (k === '0') { stop(); zoomTo(1, 0, 0, true); }
        else if (k === 'Delete' || k === 'Backspace') { stop(); const st = curStat(); if (st) trash([st]); }
        return;
      }
      if (e.target.closest('.gslider, .kit-side')) return;
      if (k === 'ArrowLeft') { e.preventDefault(); moveSel(-1, 0, e); }
      else if (k === 'ArrowRight') { e.preventDefault(); moveSel(1, 0, e); }
      else if (k === 'ArrowUp') { e.preventDefault(); moveSel(0, -1, e); }
      else if (k === 'ArrowDown') { e.preventDefault(); moveSel(0, 1, e); }
      else if (k === 'Enter' || k === ' ') {
        if (e.target.closest('button:not(.photos-cell)')) return;
        const st = selected()[0];
        if (st) { e.preventDefault(); openViewer(st.path); }
      } else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); trash(selected()); }
      else if (mod && k.toLowerCase() === 'a') { e.preventDefault(); sel = new Set(shown.map((s) => s.path)); paintSel(); }
      else if (k === 'Escape') { sel.clear(); paintSel(); }
      else if (k === 'F2') { const st = selected()[0]; if (st) rename(st); }
    };
    win.el.addEventListener('keydown', onKey);
    // Leertaste auf Knöpfen soll im Betrachter nur die Diashow schalten
    const onKeyUp = (e) => { if (e.key === ' ' && V.open && !V.edit && e.target.closest('button')) e.preventDefault(); };
    win.el.addEventListener('keyup', onKeyUp);

    const ro = new ResizeObserver(() => { if (V.open && !V.edit) applyZoom(); });
    ro.observe(stage);
    const offFs = bus.on('fs', debounce(reload, 90));

    // ---------- Start ----------
    lib = scan();
    paint();
    const openArg = (a) => {
      if (!a?.path || !vfs.exists(a.path) || vfs.isDir(a.path)) return;
      if (V.edit) endEdit();
      if (lib.items.some((s) => s.path === a.path) && !shown.some((s) => s.path === a.path)) setView('all');
      openViewer(a.path);
    };
    openArg(args);

    return {
      onClose() {
        closed = true;
        clearInterval(V.slide);
        clearTimeout(zoomTimer);
        if (V.edit) cancelAnimationFrame(V.edit.raf);
        V.token++;
        io.disconnect();
        ro.disconnect();
        offFs();
        win.el.removeEventListener('keydown', onKey);
        win.el.removeEventListener('keyup', onKeyUp);
      },
      onArgs: openArg,
      onFocus() { if (!win.el.contains(document.activeElement)) (V.open ? stage : grid).focus({ preventScroll: true }); },
      menus: () => {
        const list = V.open ? [curStat()].filter(Boolean) : selected();
        const one = list.length === 1 ? list[0] : null;
        return [
          {
            label: 'Ablage',
            items: [
              { label: 'Importieren …', icon: 'plus', run: () => importFromDevice() },
              { label: 'Neues Album …', icon: 'folder', run: newAlbum },
              { label: 'Beispielbilder erzeugen', icon: 'sparkles', run: createSamples },
              '-',
              { label: 'Exportieren', icon: 'download', disabled: !list.length, run: () => exportPics(list) },
              { label: 'Umbenennen …', icon: 'note', disabled: !one, run: () => rename(one) },
              { label: 'Als Hintergrund', icon: 'image', disabled: !one, run: () => setWallpaper(one) },
              { label: 'Hintergrundbild entfernen', disabled: !sys.settings.wallImage, run: () => { sys.setWallpaperImage(''); say('Hintergrundbild entfernt'); } },
              '-',
              { label: 'In den Papierkorb', icon: 'trash', hint: '⌫', disabled: !list.length, run: () => trash(list) },
            ],
          },
          {
            label: 'Foto',
            items: [
              { label: 'Öffnen', hint: '↩', disabled: !one || V.open, run: () => openViewer(one.path) },
              { label: 'Bearbeiten', icon: 'sliders', hint: 'E', disabled: !one || !!V.edit, run: () => { if (!V.open) openViewer(one.path); startEdit(); } },
              { label: one && isFav(one.path) ? 'Aus Favoriten entfernen' : 'Zu Favoriten', hint: 'F', disabled: !list.length, run: () => toggleFav(list.map((s) => s.path)) },
              { label: 'Infos', icon: 'info', hint: 'I', checked: V.info, disabled: !V.open || !!V.edit, run: () => { V.info = !V.info; paintInfo(); } },
              '-',
              { label: V.slide ? 'Diashow beenden' : 'Diashow starten', icon: 'play', hint: 'Leertaste', disabled: !shown.length && !V.open, run: () => { if (!V.open) openViewer((selected()[0] || shown[0]).path); slideshow(!V.slide); } },
            ],
          },
          { label: 'Darstellung', items: viewItems() },
        ];
      },
    };
  },

  widgets: {
    /** Zeigt ein Foto aus der Mediathek, alle 20 Sekunden ein anderes. */
    pick(el) {
      const layers = [h('div.photos-w-img'), h('div.photos-w-img')];
      const empty = h('div.photos-w-empty', { html: icon('image') }, h('span', 'Noch keine Fotos'));
      el.append(empty, ...layers);
      let front = 0;
      let cur = null;
      let token = 0;
      const next = async () => {
        const my = ++token;
        const { items } = scan();
        if (!items.length) {
          cur = null;
          empty.hidden = false;
          for (const l of layers) l.classList.remove('is-on');
          return;
        }
        const rest = items.filter((s) => s.path !== cur);
        const st = rest.length ? pick(rest) : items[0];
        try {
          const t = await thumb(st, 420);
          if (my !== token) return;
          const back = layers[1 - front];
          back.style.backgroundImage = `url("${t.url}")`;
          back.classList.add('is-on');
          layers[front].classList.remove('is-on');
          front = 1 - front;
          cur = st.path;
          empty.hidden = true;
        } catch { /* nächstes Mal ein anderes */ }
      };
      next();
      const id = setInterval(next, 20000);
      const off = bus.on('fs', debounce(() => { if (!cur || !vfs.exists(cur)) next(); }, 400));
      return () => { token++; clearInterval(id); off(); };
    },
  },
};
