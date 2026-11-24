// shooter.js — Sperrzone: taktischer 3D-Shooter aus der Ich-Perspektive.
// Alles entsteht im Code: WebGL2-Renderer, Texturen, Karten, Figuren, Waffen und Klänge – keine Bild- oder Tondateien.
//
// Aufbau der Datei:
//   1 Mathematik · 2 Texturen · 3 Geometrie · 4 Renderer · 5 Welt und Karten · 6 Kollision und Wege
//   7 Waffen und Daten · 8 Klang · 9 Spiel (Effekte, Figuren, Partie mit Bots und Abgleich im Netz)
//   10 Netz (Verbindung, Lobby) · 11 Menüs · 12 Oberfläche im Einsatz · 13 App

import { h, clamp, lerp, TAU, ticker } from '../../../core/util.js';
import { icon } from '../../../core/icons.js';
import { initSwitch, initSlider, initSeg } from '../../../core/controls.js';
import { audio, sfx, audioReady } from '../../../core/audio.js';
import { bus } from '../../bus.js';
import { sys, settings } from '../../sys.js';
import { style, appStore } from '../../kit.js';

// ==========================================================================
// 1 · Mathematik (Matrizen spaltenweise wie in WebGL)
// ==========================================================================
const DEG = Math.PI / 180;
const mat4 = () => new Float32Array(16);
const rnd = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const pickOf = (arr) => arr[(Math.random() * arr.length) | 0];
/** Winkelabstand a → b im Bereich −π … π */
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };
const approach = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));
/** Zeitunabhängiges Angleichen: nach 1/rate Sekunden sind rund 63 % des Wegs geschafft. */
const damp = (v, target, rate, dt) => target + (v - target) * Math.exp(-rate * dt);

function mPerspective(o, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  o.fill(0);
  o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1; o[14] = 2 * far * near * nf;
  return o;
}
function mOrtho(o, l, r, b, t, n, f) {
  o.fill(0);
  o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n);
  o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1;
  return o;
}
/** o = a · b (o darf weder a noch b sein) */
function mMul(o, a, b) {
  for (let c = 0; c < 16; c += 4) {
    const b0 = b[c], b1 = b[c + 1], b2 = b[c + 2], b3 = b[c + 3];
    o[c] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    o[c + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    o[c + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    o[c + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return o;
}
/**
 * Blickrichtung: yaw 0 schaut nach −Z, wachsender yaw dreht nach rechts (+X); pitch > 0 schaut nach oben.
 * Liefert rechts/oben/vorn in `B` (9 Werte) – Grundlage für Sicht- und Kameramatrix.
 */
const B = new Float32Array(9);
function basis(yaw, pitch, roll = 0) {
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  let rx = cy, ry = 0, rz = sy, ux = -sy * sp, uy = cp, uz = cy * sp;
  if (roll) {
    const c = Math.cos(roll), s = Math.sin(roll);
    const ax = rx * c + ux * s, ay = ry * c + uy * s, az = rz * c + uz * s;
    ux = ux * c - rx * s; uy = uy * c - ry * s; uz = uz * c - rz * s;
    rx = ax; ry = ay; rz = az;
  }
  B[0] = rx; B[1] = ry; B[2] = rz; B[3] = ux; B[4] = uy; B[5] = uz; B[6] = sy * cp; B[7] = sp; B[8] = -cy * cp;
  return B;
}
function mView(o, ex, ey, ez, yaw, pitch, roll = 0) {
  basis(yaw, pitch, roll);
  o[0] = B[0]; o[4] = B[1]; o[8] = B[2]; o[12] = -(B[0] * ex + B[1] * ey + B[2] * ez);
  o[1] = B[3]; o[5] = B[4]; o[9] = B[5]; o[13] = -(B[3] * ex + B[4] * ey + B[5] * ez);
  o[2] = -B[6]; o[6] = -B[7]; o[10] = -B[8]; o[14] = B[6] * ex + B[7] * ey + B[8] * ez;
  o[3] = 0; o[7] = 0; o[11] = 0; o[15] = 1;
  return o;
}
/** Kamera → Welt: x rechts, y oben, −z vorn (für das Waffenmodell in der Hand). */
function mCamWorld(o, ex, ey, ez, yaw, pitch, roll = 0) {
  basis(yaw, pitch, roll);
  o[0] = B[0]; o[1] = B[1]; o[2] = B[2]; o[3] = 0;
  o[4] = B[3]; o[5] = B[4]; o[6] = B[5]; o[7] = 0;
  o[8] = -B[6]; o[9] = -B[7]; o[10] = -B[8]; o[11] = 0;
  o[12] = ex; o[13] = ey; o[14] = ez; o[15] = 1;
  return o;
}
function mLookAt(o, ex, ey, ez, tx, ty, tz) {
  let fx = tx - ex, fy = ty - ey, fz = tz - ez;
  let l = 1 / Math.hypot(fx, fy, fz); fx *= l; fy *= l; fz *= l;
  const upz = Math.abs(fy) > 0.999 ? 1 : 0, upy = upz ? 0 : 1;
  let rx = fy * upz - fz * upy, ry = fz * 0 - fx * upz, rz = fx * upy - fy * 0;
  l = 1 / Math.hypot(rx, ry, rz); rx *= l; ry *= l; rz *= l;
  const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
  o[0] = rx; o[4] = ry; o[8] = rz; o[12] = -(rx * ex + ry * ey + rz * ez);
  o[1] = ux; o[5] = uy; o[9] = uz; o[13] = -(ux * ex + uy * ey + uz * ez);
  o[2] = -fx; o[6] = -fy; o[10] = -fz; o[14] = fx * ex + fy * ey + fz * ez;
  o[3] = 0; o[7] = 0; o[11] = 0; o[15] = 1;
  return o;
}
// Kleine Matrix-Werkbank für Figuren: jede Operation hängt rechts an (M = M · Op)
function mIdent(o) { o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; return o; }
function mCopy(o, a) { o.set(a); return o; }
function mTrans(o, x, y, z) {
  o[12] += o[0] * x + o[4] * y + o[8] * z;
  o[13] += o[1] * x + o[5] * y + o[9] * z;
  o[14] += o[2] * x + o[6] * y + o[10] * z;
  return o;
}
function mRotY(o, a) {
  const c = Math.cos(a), s = Math.sin(a);
  for (let i = 0; i < 3; i++) { const p = o[i], q = o[8 + i]; o[i] = p * c - q * s; o[8 + i] = p * s + q * c; }
  return o;
}
function mRotX(o, a) {
  const c = Math.cos(a), s = Math.sin(a);
  for (let i = 0; i < 3; i++) { const p = o[4 + i], q = o[8 + i]; o[4 + i] = p * c + q * s; o[8 + i] = q * c - p * s; }
  return o;
}
function mRotZ(o, a) {
  const c = Math.cos(a), s = Math.sin(a);
  for (let i = 0; i < 3; i++) { const p = o[i], q = o[4 + i]; o[i] = p * c + q * s; o[4 + i] = q * c - p * s; }
  return o;
}

// ==========================================================================
// 2 · Texturen: jede Oberfläche wird einmal berechnet (256², kachelbar) und landet in einem Textur-Array.
//     Dazu ein zweites Array mit Details (Normale, Rauheit, Vertiefung) aus Höhe und Rauheit, die jede Malfunktion mitliefert.
// ==========================================================================
const TEX = 256;
const MAT = {};          // Name → Lage im Textur-Array
const MAT_DEF = [];      // { name, scale: Meter je Wiederholung, fit: je Fläche einmal, hit: Einschlag-Art, paint }
const defMat = (name, scale, hit, paint, fit = false) => { MAT[name] = MAT_DEF.length; MAT_DEF.push({ name, scale, hit, paint, fit }); };
// Malfunktion paint(u, v, o, N): o[0..2] = Farbe, o[3] = Glanzstärke, o[4] = Höhe (0 … 1, Vorgabe 0,5), o[5] = Rauheit (Vorgabe 0,9).
// Höhen in den Malfunktionen: hgt(Summe) bildet −1 … 1 auf 0 … 1 ab (−1 = tiefste Fuge, +1 = höchste Kante).
const hgt = (x) => 0.5 + 0.5 * clamp(x, -1, 1);
/** Normalen-Stärke je Material (Höhe → Normale im Detail-Array) */
const MAT_BUMP = { plain: 0, concrete: 0.6, asphalt: 0.8, rib: 1.6, plate: 1, wood: 1, brick: 1.4, plaster: 0.4, sand: 0.7, tile: 1, roof: 0.6, hazard: 0.4, cloth: 0.5, gravel: 1.3, planks: 1 };

/** Kachelbares Werte-Rauschen auf festen Gittern (ein Gitter je Lage, damit sich Oktaven nicht gleichen). */
function noiseSet(seed) {
  let s = seed >>> 0;
  const next = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const N = 64, grids = [];
  for (let g = 0; g < 6; g++) { const a = new Float32Array(N * N); for (let i = 0; i < a.length; i++) a[i] = next(); grids.push(a); }
  const at = (g, x, y, px, py) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py, x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), G = grids[g];
    const a = G[y0 * N + x0], b = G[y0 * N + x1], c = G[y1 * N + x0], d = G[y1 * N + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  /** fbm über das Einheitsquadrat; fu/fv ganzzahlig (≤ 8 bei vier Oktaven), damit die Kachel nahtlos bleibt */
  const fbm = (u, v, fu, fv, oct = 4) => {
    let sum = 0, amp = 0.5, tot = 0;
    for (let i = 0; i < oct && fu <= N && fv <= N; i++) { sum += amp * at(i, u * fu, v * fv, fu, fv); tot += amp; amp *= 0.5; fu *= 2; fv *= 2; }
    return sum / tot;
  };
  return { at, fbm, white: next };
}
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const gray = (o, c, s) => { o[0] = c; o[1] = c; o[2] = c; o[3] = s; };

defMat('plain', 2, 'concrete', (u, v, o, N) => {
  const n = N.fbm(u, v, 8, 8, 3);
  gray(o, 0.92 + 0.08 * n, 0.1);
  o[5] = 0.9 + (n - 0.5) * 0.2;
});
defMat('concrete', 3, 'concrete', (u, v, o, N) => {
  const n = N.fbm(u, v, 4, 4, 5), f = N.at(4, u * 64, v * 64, 64, 64), st = N.fbm(u, v, 16, 2, 3), w = N.white();
  let c = 0.5 + (n - 0.5) * 0.3 + (f - 0.5) * 0.06 + (w - 0.5) * 0.05 - Math.max(0, st - 0.56) * 0.4;
  let h = (n - 0.5) * 0.6 + (f - 0.5) * 0.3;
  if (w > 0.985) { c -= 0.1; h -= 0.6; }                                    // Poren
  if (Math.min(u, 1 - u, v, 1 - v) < 0.006) { c *= 0.7; h = -1; }           // Plattenfugen
  o[0] = c; o[1] = c * 0.99; o[2] = c * 0.96; o[3] = 0.08;
  o[4] = hgt(h); o[5] = 0.88 + (n - 0.5) * 0.2;
});
defMat('asphalt', 4, 'concrete', (u, v, o, N) => {
  const n = N.fbm(u, v, 4, 4, 4), f = N.at(4, u * 64, v * 64, 64, 64), w = N.white();
  let c = 0.17 + (n - 0.5) * 0.1 + (f - 0.5) * 0.05 + (w - 0.5) * 0.08;
  let h = (f - 0.5) * 0.5 + (w - 0.5) * 0.12;                               // Korn
  if (w > 0.982) c += 0.13;
  if (Math.abs(N.fbm(u, v, 3, 3, 4) - 0.5) < 0.0045) { c *= 0.5; h = -1; }   // Risse
  o[0] = c; o[1] = c; o[2] = c * 1.04; o[3] = 0.1 + 0.3 * n;
  o[4] = hgt(h); o[5] = 0.82 + (n - 0.5) * 0.2;
});
defMat('rib', 2.44, 'metal', (u, v, o, N) => {          // Wellblech eines Containers: senkrechte Rippen
  const p = (u * 8) % 1, w = sstep(0.1, 0.25, p) - sstep(0.6, 0.75, p), n = N.fbm(u, v, 4, 4, 4);
  let c = 0.74 + 0.18 * w + 0.1 * sstep(0.1, 0.18, p) * (1 - sstep(0.18, 0.26, p)) - 0.15 * sstep(0.58, 0.66, p) * (1 - sstep(0.66, 0.76, p));
  c *= 0.94 + 0.2 * (n - 0.5) - Math.max(0, N.fbm(u, v, 16, 2, 3) - 0.56) * 0.5;
  if (N.fbm(u, v, 8, 8, 3) > 0.72) c *= 0.9;
  gray(o, c, 0.35);
  o[4] = w; o[5] = 0.5 + (n - 0.5) * 0.2;                                   // Rippenprofil
});
defMat('plate', 2, 'metal', (u, v, o, N) => {
  const n = N.fbm(u, v, 4, 4, 4), eu = Math.min(u, 1 - u), ev = Math.min(v, 1 - v);
  let c = 0.66 + (n - 0.5) * 0.16 + (N.at(4, u * 8, v * 64, 8, 64) > 0.86 ? 0.05 : 0);
  let h = (n - 0.5) * 0.2;
  if (Math.min(eu, ev) < 0.008) { c *= 0.6; h = -1; }                       // Kanten
  const ru = Math.abs(((v * 8) % 1) - 0.5), rv = Math.abs(((u * 8) % 1) - 0.5);
  if ((eu > 0.025 && eu < 0.05 && ru < 0.1) || (ev > 0.025 && ev < 0.05 && rv < 0.1)) {
    c *= 0.7;
    const a = eu > 0.025 && eu < 0.05 && ru < 0.1 ? [(eu - 0.0375) / 0.0125, ru / 0.1] : [(ev - 0.0375) / 0.0125, rv / 0.1];
    h = Math.max(h, Math.sqrt(Math.max(0, 1 - a[0] * a[0] - a[1] * a[1])) * 2 - 1);       // Nieten als Kuppen
  }
  gray(o, c, 0.5);
  o[4] = hgt(h); o[5] = 0.4 + (n - 0.5) * 0.2;
});
defMat('wood', 1, 'wood', (u, v, o, N) => {             // Kistenseite: Rahmen, Bretter, Diagonalstrebe
  const e = Math.min(u, 1 - u, v, 1 - v), frame = e < 0.12, diag = !frame && Math.abs(u - v) < 0.07;
  const upright = frame ? Math.min(u, 1 - u) < Math.min(v, 1 - v) : diag;
  const g = upright ? N.fbm(u, v, 32, 2, 3) : N.fbm(u, v, 2, 32, 3);
  let c = 0.72 + 0.5 * (g - 0.5) * 2 * 0.5, h = (g - 0.5) * 2 * 0.2;      // Maserung
  if (frame) { c *= 1.1; h += 0.5; }                                         // Rahmen
  else if (diag) { c *= 1.04; h += 0.5; }
  else {
    if (((v * 5) % 1) < 0.045) { c *= 0.5; h = -1; }                        // Brettfugen
    if (e < 0.14 || Math.abs(Math.abs(u - v) - 0.078) < 0.01) c *= 0.62;
  }
  o[0] = 0.66 * c; o[1] = 0.48 * c; o[2] = 0.29 * c; o[3] = 0.04;
  o[4] = hgt(h); o[5] = 0.75 + (g - 0.5) * 0.2;
}, true);
defMat('brick', 2, 'concrete', (u, v, o, N) => {
  const row = Math.floor(v * 8), uu = u * 4 + (row % 2) * 0.5, bx = uu % 1, by = (v * 8) % 1;
  const n = N.fbm(u, v, 8, 8, 3);
  o[5] = 0.85 + (n - 0.5) * 0.2;
  if (bx < 0.05 || by < 0.11) { const c = 0.56 + (n - 0.5) * 0.2; o[0] = c; o[1] = c * 0.97; o[2] = c * 0.92; o[3] = 0.02; o[4] = 0; return; }   // Mörtel
  const t = N.at(5, (Math.floor(uu) % 4) + 0.5, row + 0.5, 4, 8), c = 0.72 + 0.5 * (t - 0.5) + (n - 0.5) * 0.25;
  o[0] = 0.58 * c; o[1] = 0.3 * c; o[2] = 0.23 * c; o[3] = 0.05;
  o[4] = hgt(0.4 + (n - 0.5) * 2 * 0.2);                                    // Stein mit Rauschen
});
defMat('plaster', 3, 'concrete', (u, v, o, N) => {
  const n = N.fbm(u, v, 3, 3, 5), f = N.at(4, u * 64, v * 64, 64, 64);
  let c = 0.8 + (n - 0.5) * 0.24 + (f - 0.5) * 0.05, h = (n - 0.5) * 2 * 0.3 + (f - 0.5) * 0.2;
  if (Math.abs(N.fbm(u, v, 5, 5, 3) - 0.5) < 0.0028) { c *= 0.9; h -= 0.6; }   // Riss
  o[0] = c; o[1] = c * 0.97; o[2] = c * 0.92; o[3] = 0.03;
  o[4] = hgt(h); o[5] = 0.92 + (n - 0.5) * 0.2;
});
defMat('sand', 4, 'sand', (u, v, o, N) => {
  const n = N.fbm(u, v, 4, 4, 4), f = N.at(4, u * 64, v * 64, 64, 64), rip = Math.sin(TAU * (v * 12 + N.fbm(u, v, 2, 2, 3) * 2));
  const c = 0.8 + (n - 0.5) * 0.22 + rip * 0.022 + (f - 0.5) * 0.07;
  o[0] = c; o[1] = c * 0.86; o[2] = c * 0.63; o[3] = 0.02;
  o[4] = hgt(rip * 0.5 + (n - 0.5) * 0.6 + (f - 0.5) * 0.3); o[5] = 0.95 + (n - 0.5) * 0.2;   // Rippel und Rauschen
});
defMat('tile', 2.4, 'concrete', (u, v, o, N) => {
  const tu = (u * 4) % 1, tv = (v * 4) % 1, n = N.fbm(u, v, 8, 8, 3);
  let c = ((Math.floor(u * 4) + Math.floor(v * 4)) % 2 ? 0.56 : 0.47) + (n - 0.5) * 0.12, h = (n - 0.5) * 0.1;
  if (tu < 0.03 || tv < 0.03) { c = 0.27; h = -1; }                         // Fugen
  gray(o, c, 0.35);
  o[4] = hgt(h); o[5] = 0.25 + (n - 0.5) * 0.2;
});
defMat('roof', 4, 'concrete', (u, v, o, N) => {
  const n = N.fbm(u, v, 6, 6, 4);
  let c = 0.2 + (n - 0.5) * 0.12, h = (n - 0.5) * 2 * 0.2;
  if (((v * 4) % 1) < 0.02) { c *= 0.6; h = -1; }                           // Nähte
  o[0] = c; o[1] = c; o[2] = c * 1.06; o[3] = 0.15;
  o[4] = hgt(h); o[5] = 0.7 + (n - 0.5) * 0.2;
});
defMat('hazard', 1, 'metal', (u, v, o, N) => {
  const wear = N.fbm(u, v, 6, 6, 4), y = ((u + v) * 4) % 1 < 0.5;
  const k = wear > 0.62 ? 0.75 : 1;
  o[0] = (y ? 0.95 : 0.09) * k; o[1] = (y ? 0.74 : 0.09) * k; o[2] = (y ? 0.1 : 0.09) * k; o[3] = 0.2;
  o[4] = hgt(wear > 0.62 ? -0.4 : 0); o[5] = 0.5 + (wear - 0.5) * 0.2;      // Abplatzer
});
defMat('cloth', 1.5, 'cloth', (u, v, o, N) => {
  const f = N.at(4, u * 64, v * 64, 64, 64), band = ((u * 4) % 1) < 0.5;
  gray(o, (band ? 1 : 0.7) * (0.9 + 0.1 * f), 0.02);
  o[4] = hgt((band ? 0.2 : -0.2) + 0.5 * Math.sin(TAU * u * 32) * Math.sin(TAU * v * 32)); o[5] = 0.95 + (f - 0.5) * 0.2;   // Gewebestreifen
});
defMat('gravel', 3, 'sand', (u, v, o, N) => {
  const n = N.fbm(u, v, 8, 8, 4), p = N.at(4, u * 48, v * 48, 48, 48), w = N.white();
  const c = 0.42 + (n - 0.5) * 0.26 + (p - 0.5) * 0.16 + (w - 0.5) * 0.12 + (w > 0.97 ? 0.12 : 0);
  o[0] = c * 1.02; o[1] = c * 0.97; o[2] = c * 0.9; o[3] = 0.04;
  o[4] = hgt((p - 0.5) * 2.2); o[5] = 0.9 + (n - 0.5) * 0.2;                // Kiesel
});
defMat('planks', 2, 'wood', (u, v, o, N) => {
  const row = Math.floor(v * 6), g = N.fbm(u, v, 2, 48, 3), t = N.at(5, 0.5, row + 0.5, 1, 6);
  let c = (0.72 + 0.5 * (g - 0.5)) * (0.85 + 0.3 * t), h = (g - 0.5) * 2 * 0.25;   // Maserung
  if (((v * 6) % 1) < 0.04 || ((u * 2 + row * 0.37) % 1) < 0.008) { c *= 0.5; h = -1; }   // Fugen
  o[0] = 0.52 * c; o[1] = 0.37 * c; o[2] = 0.23 * c; o[3] = 0.06;
  o[4] = hgt(h); o[5] = 0.78 + (g - 0.5) * 0.2;
});

/**
 * Malt alle Lagen in der Kantenlänge size. Jede Malfunktion läuft je Texel genau einmal (sie zieht fortlaufende Zufallszahlen):
 * Farbe (nur wenn color) und zugleich Höhe und Rauheit in Float32Array.
 */
function paintLayers(size, color) {
  const N = noiseSet(20261), o = [0, 0, 0, 0, 0.5, 0.9];
  const out = { color: [], height: [], rough: [] };
  for (const def of MAT_DEF) {
    const px = color ? new Uint8Array(size * size * 4) : null, hh = new Float32Array(size * size), rr = new Float32Array(size * size);
    for (let y = 0, i = 0, j = 0; y < size; y++) {
      for (let x = 0; x < size; x++, i += 4, j++) {
        o[4] = 0.5; o[5] = 0.9;
        def.paint((x + 0.5) / size, (y + 0.5) / size, o, N);
        if (px) { px[i] = clamp(o[0], 0, 1) * 255; px[i + 1] = clamp(o[1], 0, 1) * 255; px[i + 2] = clamp(o[2], 0, 1) * 255; px[i + 3] = clamp(o[3], 0, 1) * 255; }
        hh[j] = clamp(o[4], 0, 1); rr[j] = clamp(o[5], 0, 1);
      }
    }
    out.color.push(px); out.height.push(hh); out.rough.push(rr);
  }
  return out;
}
let texCache = null;
const detailCache = {};
/** Berechnet alle Oberflächen (einmal je Sitzung): { color: RGBA je Lage, height, rough } in 256². */
function paintTextures() {
  if (!texCache) texCache = paintLayers(TEX, true);
  return texCache;
}
/**
 * Detail-Array (RGBA8 ohne sRGB) je Lage: R, G = Normale x, y (·0,5 + 0,5), B = Rauheit, A = Vertiefung (0,5 + (h − h_weich)·4,
 * h_weich = Mittel über 5×5). Die Normale entsteht aus zentralen Differenzen der Höhe mit Umlauf an den Rändern (die Kachel bleibt nahtlos).
 * size 256 nutzt die Höhen aus dem Farbdurchlauf; 512 malt die Lagen noch einmal (eigene Zufallsfolge, die Farbe bleibt unberührt).
 */
function detailTextures(size) {
  if (detailCache[size]) return detailCache[size];
  const src = size === TEX ? paintTextures() : paintLayers(size, false);
  const k0 = (size / 256) * 4, S = size, m = S - 1;
  detailCache[size] = MAT_DEF.map((def, l) => {
    const H = src.height[l], R = src.rough[l], k = k0 * MAT_BUMP[def.name], px = new Uint8Array(S * S * 4);
    const row = new Float32Array(S * S), soft = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {             // 5×5-Mittel, getrennt nach Zeilen und Spalten
      let a = 0; for (let d = -2; d <= 2; d++) a += H[y * S + ((x + d) & m)]; row[y * S + x] = a / 5;
    }
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let a = 0; for (let d = -2; d <= 2; d++) a += row[((y + d) & m) * S + x]; soft[y * S + x] = a / 5;
    }
    for (let y = 0, i = 0, j = 0; y < S; y++) {
      for (let x = 0; x < S; x++, i += 4, j++) {
        const dx = (H[y * S + ((x + 1) & m)] - H[y * S + ((x - 1) & m)]) * 0.5 * k, dy = (H[((y + 1) & m) * S + x] - H[((y - 1) & m) * S + x]) * 0.5 * k;
        const il = 1 / Math.hypot(dx, dy, 1);
        px[i] = (-dx * il * 0.5 + 0.5) * 255; px[i + 1] = (-dy * il * 0.5 + 0.5) * 255;
        px[i + 2] = R[j] * 255; px[i + 3] = clamp(0.5 + (H[j] - soft[j]) * 4, 0, 1) * 255;
      }
    }
    return px;
  });
  return detailCache[size];
}

// ==========================================================================
// 3 · Geometrie: statische Welt aus Quadern und Zylindern
// ==========================================================================
const VSTRIDE = 14;      // Position 3 · Normale 3 · UV + Lage 3 · Tönung + Leuchten 4 · Höhe über der Unterkante 1
// je Fläche: Normale · Ursprung (0 = min, 1 = max) · Kante u · Kante v   (u × v = Normale → Vorderseite gegen den Uhrzeigersinn)
const FACES = [
  [1, 0, 0, 1, 0, 1, 0, 0, -1, 0, 1, 0],
  [-1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0],
  [0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, -1],
  [0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  [0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0],
  [0, 0, -1, 1, 0, 0, -1, 0, 0, 0, 1, 0],
];

function meshBuilder() {
  const verts = [], idx = [];
  let nv = 0;
  const quadIdx = () => { idx.push(nv, nv + 1, nv + 2, nv, nv + 2, nv + 3); nv += 4; };

  /** Quader ab der Ecke (x, y, z). rot dreht nur die Darstellung um die Mitte (yaw, danach Neigung um die eigene X-Achse). */
  function box(x, y, z, sx, sy, sz, m, tint, emis = 0, { yaw = 0, tilt = 0, noAO = false, skip = 0 } = {}) {
    const def = MAT_DEF[m], inv = 1 / def.scale;
    const cx = x + sx / 2, cy = y + sy / 2, cz = z + sz / 2;
    const rot = yaw !== 0 || tilt !== 0;
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
    const turn = (vx, vy, vz) => {
      const y1 = vy * ct - vz * st, z1 = vy * st + vz * ct;       // Neigung
      return [vx * cyw + z1 * syw, y1, -vx * syw + z1 * cyw];      // Drehung um die Hochachse
    };
    for (let f = 0; f < 6; f++) {
      if (skip & (1 << f)) continue;
      const F = FACES[f];
      let n = [F[0], F[1], F[2]];
      if (rot) n = turn(n[0], n[1], n[2]);
      for (let k = 0; k < 4; k++) {
        const a = k === 1 || k === 2 ? 1 : 0, b = k >= 2 ? 1 : 0;
        let px = x + (F[3] ? sx : 0) + (F[6] * a + F[9] * b) * sx;
        let py = y + (F[4] ? sy : 0) + (F[7] * a + F[10] * b) * sy;
        let pz = z + (F[5] ? sz : 0) + (F[8] * a + F[11] * b) * sz;
        let u, v;
        if (def.fit) { u = a; v = b; }
        else if (F[0]) { u = pz * inv; v = py * inv; }
        else if (F[1]) { u = px * inv; v = pz * inv; }
        else { u = px * inv; v = py * inv; }
        const hgt = noAO ? 9 : F[1] > 0 ? 9 : F[1] < 0 ? 0 : py - y;
        if (rot) { const p = turn(px - cx, py - cy, pz - cz); px = cx + p[0]; py = cy + p[1]; pz = cz + p[2]; }
        verts.push(px, py, pz, n[0], n[1], n[2], u, v, m, tint[0], tint[1], tint[2], emis, hgt);
      }
      quadIdx();
    }
  }

  /** Stehender Zylinder (Fass, Mast, Stamm) als Prisma mit weichen Normalen. */
  function cyl(cx, y, cz, r, hgt, m, tint, emis = 0, seg = 10) {
    const inv = 1 / MAT_DEF[m].scale;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const u0 = a0 * r * inv, u1 = a1 * r * inv;
      verts.push(cx + c1 * r, y, cz + s1 * r, c1, 0, s1, u1, y * inv, m, tint[0], tint[1], tint[2], emis, 0);
      verts.push(cx + c0 * r, y, cz + s0 * r, c0, 0, s0, u0, y * inv, m, tint[0], tint[1], tint[2], emis, 0);
      verts.push(cx + c0 * r, y + hgt, cz + s0 * r, c0, 0, s0, u0, (y + hgt) * inv, m, tint[0], tint[1], tint[2], emis, hgt);
      verts.push(cx + c1 * r, y + hgt, cz + s1 * r, c1, 0, s1, u1, (y + hgt) * inv, m, tint[0], tint[1], tint[2], emis, hgt);
      quadIdx();
      // Deckel als Fächer (ein entartetes Viereck je Segment)
      verts.push(cx, y + hgt, cz, 0, 1, 0, cx * inv, cz * inv, m, tint[0] * 0.85, tint[1] * 0.85, tint[2] * 0.85, emis, 9);
      verts.push(cx + c1 * r, y + hgt, cz + s1 * r, 0, 1, 0, (cx + c1 * r) * inv, (cz + s1 * r) * inv, m, tint[0] * 0.85, tint[1] * 0.85, tint[2] * 0.85, emis, 9);
      verts.push(cx + c0 * r, y + hgt, cz + s0 * r, 0, 1, 0, (cx + c0 * r) * inv, (cz + s0 * r) * inv, m, tint[0] * 0.85, tint[1] * 0.85, tint[2] * 0.85, emis, 9);
      idx.push(nv, nv + 1, nv + 2);
      nv += 3;
    }
  }

  return { box, cyl, finish: () => ({ verts: new Float32Array(verts), idx: new Uint32Array(idx) }) };
}

/** Einheitswürfel (−0,5 … 0,5) für alles Bewegliche: Figuren, Waffen, Granaten. */
function unitCube() {
  const v = [], i = [];
  FACES.forEach((F, f) => {
    for (let k = 0; k < 4; k++) {
      const a = k === 1 || k === 2 ? 1 : 0, b = k >= 2 ? 1 : 0;
      v.push((F[3] ? 0.5 : -0.5) + F[6] * a + F[9] * b, (F[4] ? 0.5 : -0.5) + F[7] * a + F[10] * b, (F[5] ? 0.5 : -0.5) + F[8] * a + F[11] * b, F[0], F[1], F[2]);
    }
    i.push(f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3);
  });
  return { verts: new Float32Array(v), idx: new Uint16Array(i) };
}

// ==========================================================================
// 4 · Renderer (WebGL2): Schattenkarte der Sonne, Welt, bewegliche Quader, Himmel, Effekte, Waffe in der Hand
//     Bildkette (Vertrag V4): Schatten → Szene (HDR, Tiefe; auf „Hoch“ 4-fach abgetastet) → Auflösen → Durchsichtiges (fboFx,
//     Tiefentest im Shader) → Belichtung → Glühen → Schluss (ACES, Farbstimmung, Vignette, Korn; sonst FXAA danach).
// ==========================================================================
const MAX_LIGHTS = 8;
const ISTRIDE = 20;      // je Quader: Matrix 16 · Farbe 3 · Art 1
const QSTRIDE = 10;      // je Effekt-Ecke: Position 3 · UV 2 · Farbe 4 · Art 1
const MAX_INST = 1400, MAX_QUADS = 1600;
const K_MATTE = 0, K_CAMO = 1, K_METAL = 2, K_GLOW = 3;
const Q_GLOW = 0, Q_SMOKE = 1, Q_BEAM = 2, Q_DECAL = 3, Q_FLASH = 4, Q_DUST = 5;
/**
 * Qualitätsstufen (Vertrag V4). scale = Auflösung, msaa = 4-fach abgetastet (sonst FXAA), glow = Stufen des Glühens,
 * ssao = Proben (0 = aus), shadowTaps = Schatten-Abtastungen, rays = Sonnenstrahlen, detail = Kantenlänge der Detail-Texturen,
 * particles = Anteil der Partikel-Obergrenze, dust = Schwebstaub. „Auto“ beginnt wie „Mittel“ mit voller Auflösung (siehe draw in der App).
 */
const TIERS = {
  low: { scale: 0.6, msaa: false, glow: 3, ssao: 0, shadowTaps: 4, rays: false, detail: 256, particles: 0.6, dust: false },
  medium: { scale: 0.8, msaa: false, glow: 5, ssao: 6, shadowTaps: 9, rays: true, detail: 256, particles: 1, dust: true },
  high: { scale: 1, msaa: true, glow: 5, ssao: 10, shadowTaps: 16, rays: true, detail: 512, particles: 1, dust: true },
};
/** Belichtungsanpassung: Zielwert des Mittels, Grenzen um env.exposure, Zeiten in s (Bild wird heller → hell, dunkler → dunkel). */
const BEL = { key: 0.18, lo: 0.66, hi: 1.5, hell: 0.35, dunkel: 1.2 };
const GRADE_NEUTRAL = { shadow: [1, 1, 1], light: [1, 1, 1], sat: 1, contrast: 1, rays: 0 };
const Q_FLAT = 0.25;     // zur Art addiert: flach auf einer Fläche (Zeichen am Boden) – harter Tiefentest wie Einschusslöcher statt weicher Kante

// Bildkette: die Szene entsteht als linearer HDR-Wert in einem Zwischenbild; Belichtung, Tonwertkurve (ACES) und Gamma
// kommen erst im Schlussschritt. Nur im Rückfall ohne Float-Ziele (uLdr = 1) wenden shade() und der Himmel die Kurve selbst an.
const GLSL_ACES = `
vec3 aces(vec3 c) { return (c * (2.51 * c + .03)) / (c * (2.43 * c + .59) + .14); }`;
const GLSL_LIGHT = `
uniform vec3 uCam, uSunDir, uSunCol, uSkyCol, uGndCol, uFogCol;
uniform float uFogDen, uExposure, uShadowTexel, uShadowOn, uLdr;
uniform mat4 uShadowMat;
uniform highp sampler2DShadow uShadow;
uniform vec4 uLights[${MAX_LIGHTS}];
uniform vec3 uLightCol[${MAX_LIGHTS}];

float sunShadow(vec3 wp, vec3 n, float ndl) {
  if (uShadowOn < .5) return 1.;
  vec4 sp = uShadowMat * vec4(wp + n * (.05 + .12 * (1. - ndl)), 1.);
  vec3 c = sp.xyz;
  if (c.x < 0. || c.x > 1. || c.y < 0. || c.y > 1. || c.z > 1.) return 1.;
  c.z -= .0009;
  float t = uShadowTexel * .8;
  return (texture(uShadow, c + vec3(-t, -t, 0.)) + texture(uShadow, c + vec3(t, -t, 0.))
        + texture(uShadow, c + vec3(-t, t, 0.)) + texture(uShadow, c + vec3(t, t, 0.))) * .25;
}
${GLSL_ACES}
vec3 tonemap(vec3 c) { return pow(clamp(aces(c * uExposure), 0., 1.), vec3(1. / 2.2)); }
vec3 shade(vec3 albedo, vec3 n, vec3 wp, float spec, float ao, float emis) {
  float ndl = max(dot(n, uSunDir), 0.);
  float sh = ndl > 0. ? sunShadow(wp, n, ndl) : 0.;
  vec3 light = mix(uGndCol, uSkyCol, n.y * .5 + .5) * ao + uSunCol * ndl * sh;
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    float r = uLights[i].w;
    if (r <= 0.) continue;
    vec3 d = uLights[i].xyz - wp;
    float a = max(0., 1. - dot(d, d) / (r * r));
    light += uLightCol[i] * a * a * (.3 + .7 * max(dot(n, normalize(d)), 0.));
  }
  vec3 col = albedo * light;
  vec3 view = uCam - wp;
  float dist = length(view);
  col += uSunCol * spec * sh * pow(max(dot(n, normalize(uSunDir + view / dist)), 0.), 48.);
  col = mix(col, albedo * EMIS_K, emis);
  col = mix(col, uFogCol, clamp(1. - exp(-dist * uFogDen), 0., 1.));
  return uLdr > .5 ? tonemap(col) : col;
}`;

const VS_WORLD = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec3 aUV;
layout(location=3) in vec4 aTint; layout(location=4) in float aH;
uniform mat4 uVP;
out vec3 vPos, vNor, vUV; out vec4 vTint; out float vH;
void main() { vPos = aPos; vNor = aNor; vUV = aUV; vTint = aTint; vH = aH; gl_Position = uVP * vec4(aPos, 1.); }`;
const FS_WORLD = `#version 300 es
precision highp float; precision highp sampler2DArray;
#define EMIS_K 2.4
uniform sampler2DArray uTex;
${GLSL_LIGHT}
in vec3 vPos, vNor, vUV; in vec4 vTint; in float vH;
out vec4 o;
void main() {
  vec4 t = texture(uTex, vUV);
  float ao = mix(.62, 1., smoothstep(0., .75, vH));
  o = vec4(shade(t.rgb * vTint.rgb, normalize(vNor), vPos, t.a, ao, vTint.a), 1.);
}`;
const VS_INST = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor;
layout(location=2) in vec4 iM0; layout(location=3) in vec4 iM1; layout(location=4) in vec4 iM2; layout(location=5) in vec4 iM3;
layout(location=6) in vec4 iCol;
uniform mat4 uVP;
out vec3 vPos, vNor, vLocal; out vec4 vCol;
void main() {
  mat4 M = mat4(iM0, iM1, iM2, iM3);
  vec4 wp = M * vec4(aPos, 1.);
  vPos = wp.xyz; vNor = mat3(M) * aNor; vCol = iCol;
  vLocal = aPos * vec3(length(iM0.xyz), length(iM1.xyz), length(iM2.xyz));
  gl_Position = uVP * wp;
}`;
const FS_INST = `#version 300 es
precision highp float;
#define EMIS_K 1.4
${GLSL_LIGHT}
in vec3 vPos, vNor, vLocal; in vec4 vCol;
out vec4 o;
float h3(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec3 c = vCol.rgb; float k = vCol.a, spec = .04;
  if (k > .5 && k < 1.5) {                                   // Tarnstoff: grobe und feine Flecken
    float a = h3(floor(vLocal * 11.) + 3.), b = h3(floor(vLocal * 23.));
    c *= .8 + .3 * step(.5, a) + .12 * (b - .5);
  } else if (k > 1.5 && k < 2.5) { spec = .55; c *= .9 + .2 * h3(floor(vLocal * 40.)); }
  o = vec4(shade(c, normalize(vNor), vPos, spec, 1., k > 2.5 ? 1. : 0.), 1.);
}`;
const VS_SHADOW = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uVP;
void main() { gl_Position = uVP * vec4(aPos, 1.); }`;
const VS_SHADOW_INST = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=2) in vec4 iM0; layout(location=3) in vec4 iM1; layout(location=4) in vec4 iM2; layout(location=5) in vec4 iM3;
uniform mat4 uVP;
void main() { gl_Position = uVP * (mat4(iM0, iM1, iM2, iM3) * vec4(aPos, 1.)); }`;
const FS_EMPTY = `#version 300 es
precision mediump float;
void main() {}`;
const VS_SKY = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vNdc;
void main() { vNdc = aPos; gl_Position = vec4(aPos, 1., 1.); }`;
const FS_SKY = `#version 300 es
precision highp float;
uniform vec3 uF, uR, uU, uSunDir, uSunCol, uZenith, uFogCol;
uniform float uTime, uCloud, uExposure, uLdr;
in vec2 vNdc; out vec4 o;
${GLSL_ACES}
float h2(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0., a = .5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 11.7; a *= .5; } return s; }
void main() {
  vec3 d = normalize(uF + uR * vNdc.x + uU * vNdc.y);
  float up = max(d.y, 0.);
  vec3 col = mix(uFogCol, uZenith, 1. - pow(1. - up, 3.5));
  float sd = max(dot(d, uSunDir), 0.);
  col += uSunCol * (pow(sd, 420.) * 2.2 + pow(sd, 14.) * .14 + pow(sd, 3.) * .03);
  if (d.y > .005 && uCloud > 0.) {
    vec2 p = d.xz / (d.y + .14) * 1.3 + uTime * .004;
    float c = smoothstep(1. - uCloud, 1.22 - uCloud * .5, fbm(p) + .35 * fbm(p * 3.1 + 4.));
    vec3 cc = mix(uFogCol * 1.1, vec3(1.05) + uSunCol * .12 * (.4 + sd), .55 + .45 * fbm(p * 1.7 - 2.));
    col = mix(col, cc, c * smoothstep(.005, .16, d.y) * .9);
  }
  o = vec4(uLdr > .5 ? pow(clamp(aces(col * uExposure), 0., 1.), vec3(1. / 2.2)) : col, 1.);
}`;
const VS_QUAD = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec2 aUV; layout(location=2) in vec4 aCol; layout(location=3) in float aKind;
uniform mat4 uVP;
out vec2 vUV; out vec4 vCol; out float vKind;
void main() { vUV = aUV; vCol = aCol; vKind = aKind; gl_Position = uVP * vec4(aPos, 1.); }`;
// Tiefe aus der Tiefentextur linear machen (nah 0,07, fern 500). Die Welt liegt im Tiefenbereich 0,1…1, die Waffe in der Hand in 0…0,1
// (liefert Werte unter 0,07, liegt also vor allem); Himmel = 1,0 → 500.
const GLSL_LINZ = `
float linZ(float d) { float z = (d - .1) / .9 * 2. - 1.; return 2. * .07 * 500. / (500.07 - z * 499.93); }`;
// Durchsichtiges zeichnet in fboFx (nur Farbe, keine Tiefe) und prüft die Tiefe selbst gegen uTiefe.
const FS_QUAD = `#version 300 es
precision highp float;
uniform highp sampler2D uTiefe;
uniform float uExposure, uLdr, uTest;
in vec2 vUV; in vec4 vCol; in float vKind;
out vec4 o;
float h2(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
// Die Effektfarben sind als Anzeigewerte gedacht: Umkehrung von Gamma und ACES (bei der Grundbelichtung der Karte) liefert den linearen Wert,
// der nach dem Schlussschritt wieder so aussieht.
vec3 lin(vec3 c) {
  vec3 y = pow(min(c, vec3(.97)), vec3(2.2)), a = 2.51 - 2.43 * y, b = .03 - .59 * y;
  return (sqrt(b * b + .56 * a * y) - b) / (2. * a) / uExposure;
}
${GLSL_LINZ}
void main() {
  float k = floor(vKind + .01), szene = 1e9, ich = 0.;
  bool flach = vKind - k > .1;
  if (uTest > .5) {                                                                        // Tiefentest gegen die Szene
    szene = linZ(texelFetch(uTiefe, ivec2(gl_FragCoord.xy), 0).r); ich = linZ(gl_FragCoord.z);
    if (flach || k == 3.) { if (ich >= szene + .02 + .0005 * ich) discard; }               // Einschusslöcher, Zeichen am Boden
    else if (k == 2. || k == 4.) { if (ich > szene) discard; }                             // Leuchtspur, fremdes Mündungsfeuer
  }
  vec2 p = vUV * 2. - 1.;
  float d = length(p), a = 0., add = 1.;
  if (k < .5) a = pow(max(0., 1. - d), 2.);                                                // Glühen
  else if (k < 1.5) { a = smoothstep(1., .25, d) * (.55 + .45 * vn(vUV * 5. + vCol.a * 7.)); add = 0.; }   // Rauch
  else if (k < 2.5) a = (1. - abs(p.y)) * smoothstep(0., .15, vUV.x) * smoothstep(1., .6, vUV.x);         // Leuchtspur
  else if (k < 3.5) { a = smoothstep(1., .35, d + .25 * vn(vUV * 9.)); add = 0.; }         // Einschussloch
  else if (k < 4.5) { float ang = atan(p.y, p.x); a = pow(max(0., 1. - d * (1.25 - .45 * cos(ang * 4.))), 1.6); }   // Mündungsfeuer
  else { a = smoothstep(1., .1, d) * .8; add = 0.; }                                       // Staub
  a *= vCol.a;
  if (uTest > .5 && !flach && (k == 0. || k == 1. || k == 5.)) a *= clamp((szene - ich) / .4, 0., 1.);   // Rauch, Staub, Glühen: weiche Kante an Flächen
  if (uLdr > .5) o = vec4(vCol.rgb * a, add > .5 ? 0. : a);
  else if (add > .5 && !flach) o = vec4(pow(vCol.rgb, vec3(2.2)) * a * (k == 4. ? 8. : k == 2. ? 5. : 3.), 0.);   // Leuchtendes als HDR: Mündungsfeuer ×8, Leuchtspur ×5, Glühen ×3
  else o = add > .5 ? vec4(lin(vCol.rgb * a), 0.) : vec4(lin(vCol.rgb) * a, a);
}`;
// Bildschirmfüllendes Dreieck (Puffer des Himmels) für alle Schritte nach der Szene
const VS_POST = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUV;
void main() { vUV = aPos * .5 + .5; gl_Position = vec4(aPos, 0., 1.); }`;
// Glühen: Vorfilter bei halber Auflösung (4 Proben über 4×4 Pixel, weiche Schwelle auf dem belichteten Wert), dann je Stufe halbieren
// (13 Proben), mit 3×3-Zelt wieder hoch (additiv in die größere Stufe). Ergebnis in Stufe 0, schon belichtet.
const FS_GLOW_PRE = `#version 300 es
precision highp float;
uniform sampler2D uQuelle, uBel;
uniform vec2 uPx;
uniform float uLdr, uSchwelle, uKnie;
in vec2 vUV; out vec4 o;
void main() {
  vec3 c = (texture(uQuelle, vUV + vec2(-1., -1.) * uPx).rgb + texture(uQuelle, vUV + vec2(1., -1.) * uPx).rgb
          + texture(uQuelle, vUV + vec2(-1., 1.) * uPx).rgb + texture(uQuelle, vUV + vec2(1., 1.) * uPx).rgb) * .25;
  c = min(c * (uLdr > .5 ? 1. : texelFetch(uBel, ivec2(0), 0).r), vec3(64.));
  float br = max(c.r, max(c.g, c.b)), q = clamp(br - uSchwelle + uKnie, 0., 2. * uKnie);
  o = vec4(c * max(q * q / (4. * uKnie + 1e-5), br - uSchwelle) / max(br, 1e-4), 1.);
}`;
const FS_GLOW_DOWN = `#version 300 es
precision highp float;
uniform sampler2D uQuelle;
uniform vec2 uPx;
in vec2 vUV; out vec4 o;
vec3 t(float x, float y) { return texture(uQuelle, vUV + vec2(x, y) * uPx).rgb; }
void main() {
  o = vec4((t(-1., -1.) + t(1., -1.) + t(-1., 1.) + t(1., 1.)) * .125 + (t(-2., -2.) + t(2., -2.) + t(-2., 2.) + t(2., 2.)) * .03125
         + (t(0., -2.) + t(-2., 0.) + t(2., 0.) + t(0., 2.)) * .0625 + t(0., 0.) * .125, 1.);
}`;
const FS_GLOW_UP = `#version 300 es
precision highp float;
uniform sampler2D uQuelle;
uniform vec2 uPx;
in vec2 vUV; out vec4 o;
vec3 t(float x, float y) { return texture(uQuelle, vUV + vec2(x, y) * uPx).rgb; }
void main() {
  o = vec4((t(0., 0.) * 4. + (t(-1., 0.) + t(1., 0.) + t(0., -1.) + t(0., 1.)) * 2. + t(-1., -1.) + t(1., -1.) + t(-1., 1.) + t(1., 1.)) / 16., 1.);
}`;
// Belichtung: mittlere Leuchtdichte (geometrisches Mittel, ohne die Waffe in der Hand) in 64×64, Mip-Kette bis 1×1.
// R = Logarithmus mal Gewicht, G = Gewicht; die oberste Stufe liefert das gewichtete Mittel. Keine Rücklesung auf die CPU.
const FS_LUM = `#version 300 es
precision highp float;
uniform sampler2D uQuelle;
uniform highp sampler2D uTiefe;
in vec2 vUV; out vec4 o;
void main() {
  vec2 s = vec2(textureSize(uTiefe, 0));
  float r = 0., w = 0.;
  for (int i = 0; i < 4; i++) {
    vec2 uv = vUV + (vec2(i & 1, i >> 1) - .5) * (.5 / 64.);
    float k = texelFetch(uTiefe, ivec2(uv * s), 0).r < .1 ? 0. : 1.;              // Waffe in der Hand zählt nicht
    r += log(dot(texture(uQuelle, uv).rgb, vec3(.2126, .7152, .0722)) + 1e-4) * k; w += k;
  }
  o = vec4(r * .25, w * .25, 0., 1.);
}`;
// Anpassung im Wechsel zweier 1×1-Bilder: ziel = clamp(0,18 / mittel, 0,66 … 1,5) · env.exposure, mittel gemessen am mit env.exposure
// belichteten Bild – so bleibt ein gewöhnlicher Blick bei der Grundbelichtung der Karte, nur deutlich Helleres oder Dunkleres wird ausgeglichen.
// Wird das Bild heller, folgt die Belichtung in 0,35 s, wird es dunkler, in 1,2 s (wie das Auge: Blenden geht schneller als Gewöhnen ans Dunkel).
const FS_ADAPT = `#version 300 es
precision highp float;
uniform sampler2D uLum, uAlt;
uniform float uDt, uKey;
uniform vec4 uBelK;      // Zielwert, untere und obere Grenze, Zeit zum Abdunkeln (BEL)
uniform float uBelDunkel;
in vec2 vUV; out vec4 o;
void main() {
  vec2 m = textureLod(uLum, vec2(.5), 6.).rg;
  float mittel = (m.g > 1e-3 ? exp(m.r / m.g) : uBelK.x / uKey) * uKey, ziel = clamp(uBelK.x / (mittel + 1e-4), uBelK.y, uBelK.z) * uKey;
  float alt = texelFetch(uAlt, ivec2(0), 0).r;
  o = vec4(alt + (ziel - alt) * (1. - exp(-uDt / (ziel < alt ? uBelK.w : uBelDunkel))), mittel, 0., 1.);
}`;
// Korn (bewegt, im Dunkeln stärker) und Rasterung ±0,5/255 – ganz am Ende, bei FXAA erst nach der Kantenglättung
const GLSL_KORN = `
uniform float uKorn, uZeit;
float hk(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec3 korn(vec3 c) {
  vec2 p = gl_FragCoord.xy;
  float l = clamp(dot(c, vec3(.2126, .7152, .0722)), 0., 1.);
  c += (hk(p + uZeit) - .5) * 2. * uKorn * (1. - .7 * l);
  return c + (hk(p * 1.31 + 57.3 + uZeit * .37) - .5) / 255.;
}`;
// Schlussschritt: HDR-Zwischenbild → Belichtung → Glühen → ACES → Gamma → Farbstimmung → Vignette → Korn → Bildfläche.
// Plätze für spätere Phasen: Verzerrung (Bildwellen) vor dem Lesen von uFarbe, SSAO und Sonnenstrahlen vor der Belichtung,
// Bildwirkungen aus f.post nach der Farbstimmung.
const FS_FINAL = `#version 300 es
precision highp float;
uniform sampler2D uFarbe, uGlow, uBel;
uniform float uLdr, uGlowK, uSatt, uKontrast, uVig, uKornHier;
uniform vec3 uTonS, uTonL;
in vec2 vUV; out vec4 o;
${GLSL_ACES}
${GLSL_KORN}
void main() {
  vec3 c = texture(uFarbe, vUV).rgb, g = texture(uGlow, vUV).rgb * uGlowK;
  if (uLdr < .5) c = pow(clamp(aces(c * texelFetch(uBel, ivec2(0), 0).r + g), 0., 1.), vec3(1. / 2.2));
  else c = min(c + g, 1.);
  float l = dot(c, vec3(.2126, .7152, .0722));
  c *= mix(uTonS, uTonL, smoothstep(.15, .85, l));                       // Farbstimmung: Schatten und Lichter getönt
  c = clamp((mix(vec3(l), c, uSatt) - .5) * uKontrast + .5, 0., 1.);    // Sättigung, Kontrast
  vec2 q = vUV - .5;
  c *= 1. - uVig * pow(dot(q, q) * 2., 1.5);                             // Vignette
  o = vec4(uKornHier > .5 ? korn(c) : c, 1.);
}`;
// Kantenglättung ohne Mehrfachabtastung (FXAA nach Lottes, schlanke Fassung): liest das fertige RGBA8-Bild, schreibt auf die Bildfläche
const FS_FXAA = `#version 300 es
precision highp float;
uniform sampler2D uBild;
uniform vec2 uPx;
in vec2 vUV; out vec4 o;
${GLSL_KORN}
void main() {
  const vec3 L = vec3(.299, .587, .114);
  vec3 m = texture(uBild, vUV).rgb;
  float nw = dot(texture(uBild, vUV + vec2(-1., -1.) * uPx).rgb, L), ne = dot(texture(uBild, vUV + vec2(1., -1.) * uPx).rgb, L);
  float sw = dot(texture(uBild, vUV + vec2(-1., 1.) * uPx).rgb, L), se = dot(texture(uBild, vUV + vec2(1., 1.) * uPx).rgb, L), lm = dot(m, L);
  float lo = min(lm, min(min(nw, ne), min(sw, se))), hi = max(lm, max(max(nw, ne), max(sw, se)));
  vec2 dir = vec2(-((nw + ne) - (sw + se)), (nw + sw) - (ne + se));
  float red = max((nw + ne + sw + se) * .03125, 1. / 128.);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), -8., 8.) * uPx;
  vec3 a = .5 * (texture(uBild, vUV - dir / 6.).rgb + texture(uBild, vUV + dir / 6.).rgb);
  vec3 b = a * .5 + .25 * (texture(uBild, vUV - dir * .5).rgb + texture(uBild, vUV + dir * .5).rgb);
  float lb = dot(b, L);
  o = vec4(korn(lb < lo || lb > hi ? a : b), 1.);
}`;

function createRenderer(canvas, { shadowSize = 2048, ldr: forceLdr = false } = {}) {
  // Gezeichnet wird in eigene Zwischenbilder; die Bildfläche bekommt nur den Schlussschritt (ohne Tiefe, ohne Kantenglättung).
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  if (!gl) return null;
  const floatOk = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));

  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Shader: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const program = (vs, fs) => {
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Programm: ${gl.getProgramInfoLog(p)}`);
    const u = {};
    for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
      const name = gl.getActiveUniform(p, i).name;
      u[name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  };
  const P = {
    world: program(VS_WORLD, FS_WORLD), inst: program(VS_INST, FS_INST),
    shadow: program(VS_SHADOW, FS_EMPTY), shadowInst: program(VS_SHADOW_INST, FS_EMPTY),
    sky: program(VS_SKY, FS_SKY), quad: program(VS_QUAD, FS_QUAD),
    final: program(VS_POST, FS_FINAL), fxaa: program(VS_POST, FS_FXAA),
    lum: program(VS_POST, FS_LUM), adapt: program(VS_POST, FS_ADAPT),
    glowPre: program(VS_POST, FS_GLOW_PRE), glowDown: program(VS_POST, FS_GLOW_DOWN), glowUp: program(VS_POST, FS_GLOW_UP),
  };

  // ---------- Texturen ----------
  const tex = gl.createTexture();
  {
    const layers = paintTextures().color;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.log2(TEX) + 1, gl.SRGB8_ALPHA8, TEX, TEX, layers.length);
    layers.forEach((px, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, TEX, TEX, 1, gl.RGBA, gl.UNSIGNED_BYTE, px));
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  }
  // Detail-Array (Normale, Rauheit, Vertiefung) auf Einheit 7; Kantenlänge nach Qualitätsstufe (TIERS.detail), bei Wechsel neu angelegt
  let detailTex = null, detailSize = 0;
  function loadDetail(size) {
    if (detailTex && size === detailSize) return;
    const layers = detailTextures(size);
    if (detailTex) gl.deleteTexture(detailTex);
    detailTex = gl.createTexture(); detailSize = size;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, detailTex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.log2(size) + 1, gl.RGBA8, size, size, layers.length);
    layers.forEach((px, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, px));
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  }
  loadDetail(TEX);

  // ---------- Schattenkarte ----------
  let shadowRes = shadowSize, shadowOk = true;
  const maxShadow = Math.max(1024, Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048));      // WebGL 2 sichert nur 2048 zu
  const shadowTex = gl.createTexture();
  const shadowFbo = gl.createFramebuffer();
  function allocShadow(size) {
    size = Math.min(size, maxShadow);
    shadowRes = size;
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    shadowOk = gl.isContextLost() || gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  allocShadow(shadowSize);

  // ---------- Puffer ----------
  const cube = unitCube();
  const cubeVbo = gl.createBuffer(), cubeIbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cubeVbo);
  gl.bufferData(gl.ARRAY_BUFFER, cube.verts, gl.STATIC_DRAW);
  function instVao() {
    const vao = gl.createVertexArray(), buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeVbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cubeIbo);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_INST * ISTRIDE * 4, gl.DYNAMIC_DRAW);
    for (let i = 0; i < 5; i++) {
      gl.enableVertexAttribArray(2 + i);
      gl.vertexAttribPointer(2 + i, 4, gl.FLOAT, false, ISTRIDE * 4, i * 16);
      gl.vertexAttribDivisor(2 + i, 1);
    }
    gl.bindVertexArray(null);
    return { vao, buf };
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cubeIbo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cube.idx, gl.STATIC_DRAW);
  const instWorld = instVao(), instView = instVao();

  const quadVao = gl.createVertexArray(), quadVbo = gl.createBuffer(), quadIbo = gl.createBuffer();
  {
    gl.bindVertexArray(quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_QUADS * 4 * QSTRIDE * 4, gl.DYNAMIC_DRAW);
    const st = QSTRIDE * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, st, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, st, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, st, 20);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, st, 36);
    const qi = new Uint16Array(MAX_QUADS * 6);
    for (let i = 0; i < MAX_QUADS; i++) qi.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, qi, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }
  // Himmel: ein einziges Dreieck über das ganze Bild. Mit eigenem Puffer auf Attribut 0 –
  // ohne müsste Firefox auf Desktop-GL (etwa am Mac) jeden Aufruf aufwendig nachbilden.
  const skyVao = gl.createVertexArray(), skyVbo = gl.createBuffer();
  {
    gl.bindVertexArray(skyVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, skyVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  // ---------- Zwischenbilder (bei jeder Größenänderung neu) ----------
  // Einheiten 0, 1 und 7 gehören der Szene (Textur-Array, Schattenkarte, Detail-Array); die Schritte danach lesen nur aus Einheit 2 bis 6.
  // So hängt nie eine Textur, die gerade gelesen wird, zugleich am gezeichneten Framebuffer.
  let ldr = !floatOk || forceLdr, tW = 0, tH = 0, msaa = 0;
  let tier = { msaa: true };                     // gewünschte Merkmale der Qualitätsstufe (setTier)
  // szene: Ziel der Szene (bei Mehrfachabtastung: ms, danach Auflösen in auf); fx: nur farbe; ldr/ldrF: fertiges Bild vor FXAA
  // glow/glowF: Stufen des Glühens (Textur und Framebuffer je Stufe, Größe in glowW/glowH)
  const T = { farbe: null, tiefe: null, szene: null, fx: null, msFarbe: null, msTiefe: null, ms: null, ldr: null, ldrF: null, glow: [], glowF: [],
    lum: null, lumF: null, bel: [], belF: [] };
  let belCur = 0, belReset = true, lastT = 0, frameNo = 0;
  const lastCam = [0, -1e9, 0];
  const glowW = [], glowH = [];
  const samplesOf = (fmt) => { try { return [...(gl.getInternalformatParameter(gl.RENDERBUFFER, fmt, gl.SAMPLES) || [])]; } catch { return []; } };
  function rbTarget(w, h, fmt) {
    const r = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, r);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, fmt, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    return r;
  }
  function texTarget(w, h, fmt, filter = gl.LINEAR) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  /** Framebuffer aus Farbe (Textur) und Tiefe (Textur); prüft die Vollständigkeit. */
  function fboOf(color, depth) {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    if (color) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    if (depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
    f.ok = gl.isContextLost() || gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    return f;
  }
  function freeTargets() {
    const del = (o) => {
      if (o instanceof WebGLTexture) gl.deleteTexture(o);
      else if (o instanceof WebGLFramebuffer) gl.deleteFramebuffer(o);
      else if (o instanceof WebGLRenderbuffer) gl.deleteRenderbuffer(o);
    };
    for (const k of Object.keys(T)) {
      if (Array.isArray(T[k])) { T[k].forEach(del); T[k] = []; } else { del(T[k]); T[k] = null; }
    }
  }
  function allocTargets(w, h) {
    freeTargets();
    tW = w; tH = h;
    const fmt = ldr ? gl.RGBA8 : gl.RGBA16F;
    T.farbe = texTarget(w, h, fmt);
    T.tiefe = texTarget(w, h, gl.DEPTH_COMPONENT24, gl.NEAREST);
    T.szene = fboOf(T.farbe, T.tiefe);
    T.fx = fboOf(T.farbe, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!T.szene.ok && !ldr) { ldr = true; allocTargets(w, h); return; }      // Float-Ziel abgelehnt: Rückfall auf RGBA8
    // Mehrfachabtastung nur, wenn Farbe und Tiefe 4 Abtastungen anbieten und der Framebuffer vollständig ist; sonst FXAA
    msaa = 0;
    if (tier.msaa && samplesOf(fmt).includes(4) && samplesOf(gl.DEPTH_COMPONENT24).includes(4)) {
      T.msFarbe = rbTarget(w, h, fmt);
      T.msTiefe = rbTarget(w, h, gl.DEPTH_COMPONENT24);
      T.ms = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.ms);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, T.msFarbe);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, T.msTiefe);
      if (gl.isContextLost() || gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) msaa = 4;
      else { gl.deleteFramebuffer(T.ms); gl.deleteRenderbuffer(T.msFarbe); gl.deleteRenderbuffer(T.msTiefe); T.ms = T.msFarbe = T.msTiefe = null; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    if (!msaa) {
      T.ldr = texTarget(w, h, gl.RGBA8);
      T.ldrF = fboOf(T.ldr, null);
    }
    // Glühen: Stufe 0 in halber Auflösung, jede weitere halb so groß
    glowW.length = glowH.length = 0;
    for (let i = 0, gw = w, gh = h; i < (tier.glow || 5); i++) {
      gw = Math.max(1, Math.ceil(gw / 2)); gh = Math.max(1, Math.ceil(gh / 2));
      glowW.push(gw); glowH.push(gh);
      T.glow.push(texTarget(gw, gh, fmt));
      T.glowF.push(fboOf(T.glow[i], null));
    }
    // Belichtung (nur mit Float-Zielen): 64×64 mit Mip-Kette, zwei 1×1 im Wechsel
    if (!ldr) {
      T.lum = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, T.lum);
      gl.texStorage2D(gl.TEXTURE_2D, 7, gl.RGBA16F, 64, 64);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      T.lumF = fboOf(T.lum, null);
      for (let i = 0; i < 2; i++) { T.bel.push(texTarget(1, 1, gl.RGBA16F, gl.NEAREST)); T.belF.push(fboOf(T.bel[i], null)); }
      belReset = true;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  /** Ein Schritt nach der Szene: bildschirmfüllendes Dreieck in fbo (null = Bildfläche). */
  function post(pr, fbo, w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(pr.p);
    gl.bindVertexArray(skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function bindTex(unit, t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); }

  let worldVao = null, worldVbo = null, worldIbo = null, worldCount = 0;
  const lightVP = mat4(), shadowMat = mat4();
  let env = null;

  /** Lädt die statische Geometrie einer Karte und richtet die Schattenkarte auf ihre Ausdehnung aus. */
  function setWorld(world) {
    if (worldVao) { gl.deleteVertexArray(worldVao); gl.deleteBuffer(worldVbo); gl.deleteBuffer(worldIbo); }
    env = world.env;
    belReset = true;
    worldVao = gl.createVertexArray(); worldVbo = gl.createBuffer(); worldIbo = gl.createBuffer();
    gl.bindVertexArray(worldVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, worldVbo);
    gl.bufferData(gl.ARRAY_BUFFER, world.mesh.verts, gl.STATIC_DRAW);
    const st = VSTRIDE * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, st, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, st, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, st, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, st, 36);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, st, 52);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, worldIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, world.mesh.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    worldCount = world.mesh.idx.length;

    // Sonne: orthografische Sicht, die genau die Karte umfasst
    const b = world.bounds, s = env.sunDir;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, cy = b.y1 / 2;
    const lv = mLookAt(mat4(), cx + s[0] * 150, cy + s[1] * 150, cz + s[2] * 150, cx, cy, cz);
    let l = 1e9, r = -1e9, bo = 1e9, t = -1e9, n = 1e9, f = -1e9;
    for (let i = 0; i < 8; i++) {
      const x = i & 1 ? b.x1 : b.x0, y = i & 2 ? b.y1 : 0, z = i & 4 ? b.z1 : b.z0;
      const vx = lv[0] * x + lv[4] * y + lv[8] * z + lv[12], vy = lv[1] * x + lv[5] * y + lv[9] * z + lv[13], vz = lv[2] * x + lv[6] * y + lv[10] * z + lv[14];
      l = Math.min(l, vx); r = Math.max(r, vx); bo = Math.min(bo, vy); t = Math.max(t, vy); n = Math.min(n, -vz); f = Math.max(f, -vz);
    }
    mMul(lightVP, mOrtho(mat4(), l, r, bo, t, n - 5, f + 5), lv);
    const bias = mat4();
    bias[0] = bias[5] = bias[10] = 0.5; bias[12] = bias[13] = bias[14] = 0.5; bias[15] = 1;
    mMul(shadowMat, bias, lightVP);
  }

  const proj = mat4(), view = mat4(), vp = mat4(), vmProj = mat4(), vmVP = mat4();
  const lightPos = new Float32Array(MAX_LIGHTS * 4), lightCol = new Float32Array(MAX_LIGHTS * 3);
  let shadowsOn = true, tanHalf = 1, aspect = 1, drawMs = 0;

  function useLit(pr, cam) {
    const u = pr.u;
    gl.useProgram(pr.p);
    gl.uniform3f(u.uCam, cam.x, cam.y, cam.z);
    gl.uniform3fv(u.uSunDir, env.sunDir);
    gl.uniform3fv(u.uSunCol, env.sunCol);
    gl.uniform3fv(u.uSkyCol, env.skyCol);
    gl.uniform3fv(u.uGndCol, env.gndCol);
    gl.uniform3fv(u.uFogCol, env.fogCol);
    gl.uniform1f(u.uFogDen, env.fogDen);
    gl.uniform1f(u.uExposure, env.exposure);
    gl.uniform1f(u.uLdr, ldr ? 1 : 0);
    gl.uniform1f(u.uShadowTexel, 1 / shadowRes);
    gl.uniform1f(u.uShadowOn, shadowsOn ? 1 : 0);
    gl.uniformMatrix4fv(u.uShadowMat, false, shadowMat);
    gl.uniform1i(u.uShadow, 1);
    gl.uniform4fv(u.uLights, lightPos);
    gl.uniform3fv(u.uLightCol, lightCol);
  }

  /**
   * Zeichnet ein Bild. f: { cam: {x, y, z, yaw, pitch, roll, fov}, inst, instCount, instShadowCount (≥ instCount: dahinter Quader nur
   *   für die Schattenkarte), vm, vmCount, vmFov, quads, quadCount (Welt), vmQuadCount (danach im Puffer, mit der Waffe gezeichnet),
   *   lights: [[x, y, z, r, cr, cg, cb]], time, shadows, post: { …, dt } (Bildwirkungen ab Phase 5; dt ersetzt die eigene Bildzeit) }
   */
  const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2'), queries = [];
  let gpuMs = null;
  function render(f) {
    if (!worldVao || gl.isContextLost()) return;
    const t0 = performance.now();
    const q = tq && queries.length < 4 ? gl.createQuery() : null;      // Zeit auf der Grafikkarte, sofern der Browser sie misst
    if (q) gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
    draw(f);
    if (q) { gl.endQuery(tq.TIME_ELAPSED_EXT); queries.push(q); }
    while (queries.length && gl.getQueryParameter(queries[0], gl.QUERY_RESULT_AVAILABLE)) {
      const done = queries.shift();
      if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) { const ms = gl.getQueryParameter(done, gl.QUERY_RESULT) / 1e6; gpuMs = gpuMs === null ? ms : gpuMs + (ms - gpuMs) * 0.1; }
      gl.deleteQuery(done);
    }
    drawMs += (performance.now() - t0 - drawMs) * 0.1;      // Zeit auf der CPU, geglättet (für _sz.bild.stats)
  }
  function draw(f) {
    const cam = f.cam, W = canvas.width, H = canvas.height;
    if (W !== tW || H !== tH) allocTargets(W, H);
    aspect = W / H;
    tanHalf = Math.tan((cam.fov * DEG) / 2);
    mPerspective(proj, cam.fov * DEG, aspect, 0.07, 500);
    mView(view, cam.x, cam.y, cam.z, cam.yaw, cam.pitch, cam.roll || 0);
    mMul(vp, proj, view);

    lightPos.fill(0);
    const L = f.lights || [];
    for (let i = 0; i < Math.min(MAX_LIGHTS, L.length); i++) { lightPos.set(L[i].slice(0, 4), i * 4); lightCol.set(L[i].slice(4, 7), i * 3); }

    const nShadow = Math.max(f.instCount || 0, f.instShadowCount || 0);     // dahinter: Quader nur für die Schattenkarte
    gl.bindBuffer(gl.ARRAY_BUFFER, instWorld.buf);
    if (nShadow) gl.bufferSubData(gl.ARRAY_BUFFER, 0, f.inst, 0, nShadow * ISTRIDE);
    gl.bindBuffer(gl.ARRAY_BUFFER, instView.buf);
    if (f.vmCount) gl.bufferSubData(gl.ARRAY_BUFFER, 0, f.vm, 0, f.vmCount * ISTRIDE);
    const nQuads = (f.quadCount || 0) + (f.vmQuadCount || 0);
    if (nQuads) { gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo); gl.bufferSubData(gl.ARRAY_BUFFER, 0, f.quads, 0, nQuads * 4 * QSTRIDE); }

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    // --- Schatten der Sonne ---
    shadowsOn = f.shadows !== false && shadowOk;
    if (shadowsOn) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
      gl.viewport(0, 0, shadowRes, shadowRes);
      gl.depthRange(0, 1);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1.5, 3);
      gl.useProgram(P.shadow.p);
      gl.uniformMatrix4fv(P.shadow.u.uVP, false, lightVP);
      gl.bindVertexArray(worldVao);
      gl.drawElements(gl.TRIANGLES, worldCount, gl.UNSIGNED_INT, 0);
      if (nShadow) {
        gl.useProgram(P.shadowInst.p);
        gl.uniformMatrix4fv(P.shadowInst.u.uVP, false, lightVP);
        gl.bindVertexArray(instWorld.vao);
        gl.drawElementsInstanced(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0, nShadow);
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // --- Welt (ins HDR-Zwischenbild): Welt, Figuren und Himmel im Tiefenbereich 0,1…1 ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, msaa ? T.ms : T.szene);
    gl.viewport(0, 0, W, H);
    gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);
    gl.depthRange(0.1, 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, detailTex);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    useLit(P.world, cam);
    gl.uniformMatrix4fv(P.world.u.uVP, false, vp);
    gl.uniform1i(P.world.u.uTex, 0);
    gl.uniform1i(P.world.u.uDetail, 7);
    gl.bindVertexArray(worldVao);
    gl.drawElements(gl.TRIANGLES, worldCount, gl.UNSIGNED_INT, 0);

    useLit(P.inst, cam);
    if (f.instCount) {
      gl.uniformMatrix4fv(P.inst.u.uVP, false, vp);
      gl.bindVertexArray(instWorld.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0, f.instCount);
    }

    // --- Himmel (nur wo noch nichts steht) ---
    basis(cam.yaw, cam.pitch, cam.roll || 0);
    gl.useProgram(P.sky.p);
    gl.uniform3f(P.sky.u.uR, B[0] * tanHalf * aspect, B[1] * tanHalf * aspect, B[2] * tanHalf * aspect);
    gl.uniform3f(P.sky.u.uU, B[3] * tanHalf, B[4] * tanHalf, B[5] * tanHalf);
    gl.uniform3f(P.sky.u.uF, B[6], B[7], B[8]);
    gl.uniform3fv(P.sky.u.uSunDir, env.sunDir);
    gl.uniform3fv(P.sky.u.uSunCol, env.sunCol);
    gl.uniform3fv(P.sky.u.uZenith, env.zenith);
    gl.uniform3fv(P.sky.u.uFogCol, env.fogCol);
    gl.uniform1f(P.sky.u.uTime, f.time || 0);
    gl.uniform1f(P.sky.u.uCloud, env.cloud);
    gl.uniform1f(P.sky.u.uExposure, env.exposure);
    gl.uniform1f(P.sky.u.uLdr, ldr ? 1 : 0);
    gl.depthMask(false);
    gl.bindVertexArray(skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // --- Waffe in der Hand: eigene Brennweite, vorderster Tiefenbereich, im selben Durchgang ---
    mPerspective(vmProj, (f.vmFov || 55) * DEG, aspect, 0.02, 20);
    mMul(vmVP, vmProj, view);
    if (f.vmCount) {
      gl.depthRange(0, 0.1);
      gl.depthMask(true);
      gl.useProgram(P.inst.p);
      gl.uniformMatrix4fv(P.inst.u.uVP, false, vmVP);
      gl.bindVertexArray(instView.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0, f.vmCount);
      gl.depthRange(0.1, 1);
    }

    // --- Auflösen: mehrfach abgetastete Farbe und Tiefe → texFarbe, texTiefe ---
    if (msaa) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, T.ms);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.szene);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }

    // --- Durchsichtiges: fboFx (nur Farbe), Tiefentest und weiche Kanten im Shader gegen texTiefe ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fx);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    bindTex(2, T.tiefe);
    gl.useProgram(P.quad.p);
    gl.uniform1i(P.quad.u.uTiefe, 2);
    gl.uniform1f(P.quad.u.uExposure, env.exposure);
    gl.uniform1f(P.quad.u.uLdr, ldr ? 1 : 0);
    gl.bindVertexArray(quadVao);
    if (f.quadCount) {
      gl.uniform1f(P.quad.u.uTest, 1);
      gl.uniformMatrix4fv(P.quad.u.uVP, false, vp);
      gl.drawElements(gl.TRIANGLES, f.quadCount * 6, gl.UNSIGNED_SHORT, 0);
    }
    if (f.vmQuadCount) {                       // Mündungsfeuer der eigenen Waffe: ohne Tiefentest
      gl.uniform1f(P.quad.u.uTest, 0);
      gl.uniformMatrix4fv(P.quad.u.uVP, false, vmVP);
      gl.drawElements(gl.TRIANGLES, f.vmQuadCount * 6, gl.UNSIGNED_SHORT, (f.quadCount || 0) * 12);
    }
    gl.depthRange(0, 1);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // --- Belichtung: Leuchtdichte → 64×64 → Mip-Kette → Anpassung im Wechsel (springt bei Kameraschnitt oder neuer Karte sofort) ---
    const now = performance.now(), dt = f.post?.dt ?? Math.min(0.25, lastT ? (now - lastT) / 1000 : 0);
    lastT = now;
    frameNo++;
    if (Math.hypot(cam.x - lastCam[0], cam.y - lastCam[1], cam.z - lastCam[2]) > 3) belReset = true;
    lastCam[0] = cam.x; lastCam[1] = cam.y; lastCam[2] = cam.z;
    if (!ldr) {
      bindTex(2, T.farbe);
      bindTex(3, T.tiefe);
      gl.useProgram(P.lum.p);
      gl.uniform1i(P.lum.u.uQuelle, 2);
      gl.uniform1i(P.lum.u.uTiefe, 3);
      post(P.lum, T.lumF, 64, 64);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      bindTex(5, T.lum);
      gl.generateMipmap(gl.TEXTURE_2D);
      bindTex(6, T.bel[belCur]);
      belCur ^= 1;
      gl.useProgram(P.adapt.p);
      gl.uniform1i(P.adapt.u.uLum, 5);
      gl.uniform1i(P.adapt.u.uAlt, 6);
      gl.uniform1f(P.adapt.u.uDt, belReset ? 1e6 : dt);
      gl.uniform1f(P.adapt.u.uKey, env.exposure);
      gl.uniform4f(P.adapt.u.uBelK, BEL.key, BEL.lo, BEL.hi, BEL.hell);
      gl.uniform1f(P.adapt.u.uBelDunkel, BEL.dunkel);
      post(P.adapt, T.belF[belCur], 1, 1);
      bindTex(4, T.bel[belCur]);
      belReset = false;
    }

    // --- Glühen: Vorfilter, Stufen hinab, mit Zelt wieder hinauf ---
    const nG = T.glow.length;
    bindTex(2, T.farbe);
    gl.useProgram(P.glowPre.p);
    gl.uniform1i(P.glowPre.u.uQuelle, 2);
    gl.uniform1i(P.glowPre.u.uBel, 4);
    gl.uniform2f(P.glowPre.u.uPx, 1 / W, 1 / H);
    gl.uniform1f(P.glowPre.u.uLdr, ldr ? 1 : 0);
    gl.uniform1f(P.glowPre.u.uSchwelle, ldr ? 0.8 : 1);         // im Rückfall liegen die Werte schon im Anzeigeraum
    gl.uniform1f(P.glowPre.u.uKnie, ldr ? 0.1 : 0.5);
    post(P.glowPre, T.glowF[0], glowW[0], glowH[0]);
    gl.useProgram(P.glowDown.p);
    gl.uniform1i(P.glowDown.u.uQuelle, 2);
    for (let i = 1; i < nG; i++) {
      bindTex(2, T.glow[i - 1]);
      gl.uniform2f(P.glowDown.u.uPx, 1 / glowW[i - 1], 1 / glowH[i - 1]);
      post(P.glowDown, T.glowF[i], glowW[i], glowH[i]);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(P.glowUp.p);
    gl.uniform1i(P.glowUp.u.uQuelle, 2);
    for (let i = nG - 1; i > 0; i--) {
      bindTex(2, T.glow[i]);
      gl.uniform2f(P.glowUp.u.uPx, 1 / glowW[i], 1 / glowH[i]);
      post(P.glowUp, T.glowF[i - 1], glowW[i - 1], glowH[i - 1]);
    }
    gl.disable(gl.BLEND);

    // --- Schluss: Belichtung, Glühen, Tonwertkurve, Gamma → Bildfläche ---
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    bindTex(2, T.farbe);
    bindTex(3, T.glow[0]);
    gl.useProgram(P.final.p);
    gl.uniform1i(P.final.u.uFarbe, 2);
    gl.uniform1i(P.final.u.uGlow, 3);
    gl.uniform1f(P.final.u.uGlowK, 0.1);
    gl.uniform1i(P.final.u.uBel, 4);
    gl.uniform1f(P.final.u.uLdr, ldr ? 1 : 0);
    const gr = env.grade || GRADE_NEUTRAL;
    gl.uniform3fv(P.final.u.uTonS, gr.shadow);
    gl.uniform3fv(P.final.u.uTonL, gr.light);
    gl.uniform1f(P.final.u.uSatt, gr.sat);
    gl.uniform1f(P.final.u.uKontrast, gr.contrast);
    gl.uniform1f(P.final.u.uVig, 0.22);
    gl.uniform1f(P.final.u.uKorn, 0.018);
    gl.uniform1f(P.final.u.uZeit, (frameNo % 997) * 7.31);
    gl.uniform1f(P.final.u.uKornHier, msaa ? 1 : 0);
    post(P.final, msaa ? null : T.ldrF, W, H);
    if (!msaa) {                                 // ohne Mehrfachabtastung: FXAA auf dem fertigen Bild
      bindTex(2, T.ldr);
      gl.useProgram(P.fxaa.p);
      gl.uniform1i(P.fxaa.u.uBild, 2);
      gl.uniform2f(P.fxaa.u.uPx, 1 / W, 1 / H);
      gl.uniform1f(P.fxaa.u.uKorn, 0.018);
      gl.uniform1f(P.fxaa.u.uZeit, (frameNo % 997) * 7.31);
      post(P.fxaa, null, W, H);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
  }

  /** Weltpunkt → Bildschirm (0 … 1, y nach unten). Liefert null, wenn der Punkt hinter der Kamera liegt. */
  function project(x, y, z, out) {
    const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    if (w <= 0.01) return null;
    out[0] = ((vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w) * 0.5 + 0.5;
    out[1] = 0.5 - ((vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w) * 0.5;
    out[2] = w;
    return out;
  }

  function resize(w, h2) {
    w = Math.max(2, Math.round(w)); h2 = Math.max(2, Math.round(h2));
    if (canvas.width !== w || canvas.height !== h2) { canvas.width = w; canvas.height = h2; }
  }

  return {
    gl, render, setWorld, project, resize,
    setShadowSize(size) { if (Math.min(size, maxShadow) !== shadowRes) allocShadow(size); },
    /** Merkmale der Qualitätsstufe (siehe TIERS); Zwischenbilder entstehen beim nächsten Bild neu, wenn sich etwas ändert. */
    setTier(t) { if (!!t.msaa !== !!tier.msaa || t.glow !== tier.glow) tW = 0; tier = { ...t }; loadDetail(t.detail || TEX); },
    /** Rückfall ohne Float-Ziele erzwingen (Prüfhaken); ohne Float-Unterstützung bleibt er immer an. */
    setLdr(on) { const v = !!on || !floatOk; if (v !== ldr) { ldr = v; tW = 0; } },
    stats() {
      let exposure = null, mean = null;
      if (!ldr && T.belF.length && !gl.isContextLost()) {             // nur für Prüfungen: einmal zurücklesen
        const px = new Float32Array(4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, T.belF[belCur]);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        exposure = Math.round(px[0] * 1000) / 1000; mean = Math.round(px[1] * 1000) / 1000;
      }
      return { hdr: !ldr, msaa, fxaa: !msaa, glow: T.glow.length, floatOk, exposure, mean, drawMs: Math.round(drawMs * 100) / 100,
        gpuMs: gpuMs === null ? null : Math.round(gpuMs * 100) / 100, w: tW, h: tH, features: { ...tier } };
    },
    dispose() { gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
}

// ==========================================================================
// 5 · Welt: Baukasten für Karten. Alles Feste ist ein achsparalleler Quader – das hält Kollision und Wegesuche einfach.
// ==========================================================================
const WHITE = [1, 1, 1];
const norm3 = (x, y, z) => { const l = 1 / Math.hypot(x, y, z); return [x * l, y * l, z * l]; };
const shadeOf = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

function worldBuilder() {
  const mesh = meshBuilder();
  const cols = [];           // [x0, y0, z0, x1, y1, z1, Material]
  const W = {
    flip: false,             // true: alles wird an der Mittellinie gespiegelt (z → −z)
    name: '', env: null, bounds: null, ground: 'concrete',
    spawns: [[], []], pois: [], flags: [], lamps: [],

    /** Quader ab der Ecke (x, y, z). o: tint, emis, ghost (nur sichtbar), clip (nur Hindernis), yaw/tilt (nur Optik), noAO */
    box(x, y, z, sx, sy, sz, m = 'concrete', o = {}) {
      if (W.flip) z = -z - sz;
      const mi = MAT[m];
      if (!o.clip) {
        const flat = !o.yaw && !o.tilt;
        mesh.box(x, y, z, sx, sy, sz, mi, o.tint || WHITE, o.emis || 0, {
          yaw: W.flip ? -(o.yaw || 0) : o.yaw || 0, tilt: W.flip ? -(o.tilt || 0) : o.tilt || 0, noAO: o.noAO, skip: flat && y <= 0.001 ? 8 : 0,
        });
      }
      if (!o.ghost) cols.push([x, y, z, x + sx, y + sy, z + sz, o.clip ? 255 : mi]);
      return W;
    },
    cyl(cx, y, cz, r, hgt, m = 'plate', o = {}) {
      if (W.flip) cz = -cz;
      mesh.cyl(cx, y, cz, r, hgt, MAT[m], o.tint || WHITE, o.emis || 0, o.seg || 10);
      if (!o.ghost) cols.push([cx - r * 0.82, y, cz - r * 0.82, cx + r * 0.82, y + hgt, cz + r * 0.82, MAT[m]]);
      return W;
    },
    /** Mauer entlang einer Achse mit Öffnungen [von, bis, Brüstung, Sturz]. axis 'x': bei z = fixed, 'z': bei x = fixed. */
    wall(axis, c0, c1, fixed, y, hgt, t, m, o = {}, openings = []) {
      const put = (a, b, yy, hh) => {
        if (b - a < 0.01 || hh < 0.01) return;
        if (axis === 'x') W.box(a, yy, fixed, b - a, hh, t, m, o); else W.box(fixed, yy, a, t, hh, b - a, m, o);
      };
      let cur = c0;
      for (const [a, b, lo = 0, hi = 2.2] of [...openings].sort((p, q) => p[0] - q[0])) {
        put(cur, a, y, hgt);
        put(a, b, y, lo);
        put(a, b, y + hi, hgt - hi);
        cur = b;
      }
      put(cur, c1, y, hgt);
      return W;
    },
    /** Treppe: (x, z) ist die Ecke am Fuß, dir die Richtung nach oben ('x+', 'x-', 'z+', 'z-'). */
    stairs(x, y, z, dir, n, width, m = 'concrete', rise = 0.25, run = 0.35, o = {}) {
      for (let i = 0; i < n; i++) {
        const hh = (i + 1) * rise;
        if (dir === 'x+') W.box(x + i * run, y, z, run, hh, width, m, o);
        else if (dir === 'x-') W.box(x - (i + 1) * run, y, z, run, hh, width, m, o);
        else if (dir === 'z+') W.box(x, y, z + i * run, width, hh, run, m, o);
        else W.box(x, y, z - (i + 1) * run, width, hh, run, m, o);
      }
      return W;
    },
    spawn(team, x, z, yaw) { W.spawns[team].push({ x, z, yaw }); return W; },
    poi(x, z) { W.pois.push({ x, z: W.flip ? -z : z }); return W; },
    flag(name, x, z) { W.flags.push({ name, x, z }); return W; },
    /** Lichtquelle: leuchtet in der Nähe der Kamera wirklich (die nächsten gewinnen). */
    lamp(x, y, z, r, col) { W.lamps.push([x, y, W.flip ? -z : z, r, col[0], col[1], col[2]]); return W; },
    /** Beide Hälften bauen: einmal wie beschrieben, einmal gespiegelt. */
    mirror(fn) { fn(); W.flip = true; fn(); W.flip = false; return W; },

    finish() {
      const n = cols.length, c = new Float32Array(n * 6), cm = new Uint8Array(n);
      cols.forEach((b, i) => { c.set(b.slice(0, 6), i * 6); cm[i] = b[6]; });
      return { name: W.name, env: W.env, bounds: W.bounds, groundHit: W.ground, mesh: mesh.finish(), cols: c, colMat: cm, colCount: n, spawns: W.spawns, pois: W.pois, flags: W.flags, lamps: W.lamps };
    },
  };
  return W;
}

// ---------- Bauteile ----------
const C_RED = [0.6, 0.18, 0.12], C_BLUE = [0.14, 0.29, 0.52], C_GREEN = [0.18, 0.4, 0.29], C_YEL = [0.85, 0.54, 0.1];
const C_WHITE = [0.78, 0.79, 0.77], C_TEAL = [0.09, 0.42, 0.46], C_DARK = [0.16, 0.17, 0.19], C_STEEL = [0.5, 0.53, 0.58];
const CONT_W = 2.44, CONT_H = 2.59, CONT_20 = 6.06, CONT_40 = 12.19;

/** Frachtcontainer; open = begehbar (beide Stirnseiten offen). */
function container(W, x, z, len, along, tint, y = 0, open = false) {
  const sx = along === 'x' ? len : CONT_W, sz = along === 'x' ? CONT_W : len, dark = shadeOf(tint, 0.62);
  if (open) {
    W.box(x, y, z, sx, 0.14, sz, 'planks');
    W.box(x, y + CONT_H - 0.1, z, sx, 0.1, sz, 'rib', { tint, noAO: true });
    if (along === 'x') { W.box(x, y, z, sx, CONT_H, 0.1, 'rib', { tint }); W.box(x, y, z + sz - 0.1, sx, CONT_H, 0.1, 'rib', { tint }); }
    else { W.box(x, y, z, 0.1, CONT_H, sz, 'rib', { tint }); W.box(x + sx - 0.1, y, z, 0.1, CONT_H, sz, 'rib', { tint }); }
  } else W.box(x, y, z, sx, CONT_H, sz, 'rib', { tint });
  // Eckpfosten und Rahmen an den Stirnseiten (nur Zierde)
  for (const e of [0, 1]) {
    for (const s of [0, 1]) {
      if (along === 'x') W.box(x + e * (sx - 0.14) - 0.02 + e * 0.04, y, z + s * (sz - 0.14) - 0.02 + s * 0.04, 0.14, CONT_H + 0.02, 0.14, 'plate', { tint: dark, ghost: true });
      else W.box(x + s * (sx - 0.14) - 0.02 + s * 0.04, y, z + e * (sz - 0.14) - 0.02 + e * 0.04, 0.14, CONT_H + 0.02, 0.14, 'plate', { tint: dark, ghost: true });
    }
    if (along === 'x') W.box(x + e * (sx - 0.1) - 0.02 + e * 0.04, y + CONT_H - 0.12, z, 0.1, 0.14, sz, 'plate', { tint: dark, ghost: true, noAO: true });
    else W.box(x, y + CONT_H - 0.12, z + e * (sz - 0.1) - 0.02 + e * 0.04, sx, 0.14, 0.1, 'plate', { tint: dark, ghost: true, noAO: true });
  }
}
const crate = (W, x, y, z, s, tint) => W.box(x, y, z, s, s, s, 'wood', tint ? { tint } : {});
const barrel = (W, cx, cz, tint, y = 0) => W.cyl(cx, y, cz, 0.31, 0.92, 'plate', { tint });
/** Betonleitwand */
function barrier(W, x, z, len, along) {
  if (along === 'x') { W.box(x, 0, z, len, 0.42, 0.64, 'concrete'); W.box(x, 0.42, z + 0.17, len, 0.55, 0.3, 'concrete', { noAO: true }); }
  else { W.box(x, 0, z, 0.64, 0.42, len, 'concrete'); W.box(x + 0.17, 0.42, z, 0.3, 0.55, len, 'concrete', { noAO: true }); }
}
/** Lastwagen mit Auflieger, Fahrerhaus zeigt nach −x. */
function truck(W, x, z, tint, trailerTint) {
  W.box(x, 0.55, z + 0.1, 2.4, 2.45, 2.4, 'plate', { tint, noAO: true });
  W.box(x, 0, z + 0.1, 2.4, 0.55, 2.4, 'plain', { clip: true });
  W.box(x - 0.04, 1.75, z + 0.3, 0.06, 0.85, 2.0, 'plain', { tint: [0.06, 0.08, 0.1], ghost: true, noAO: true });
  W.box(x - 0.12, 0.45, z + 0.05, 0.2, 0.4, 2.5, 'plate', { tint: C_DARK, ghost: true, noAO: true });
  W.box(x + 0.3, 0.45, z + 0.45, 11.6, 0.4, 1.7, 'plate', { tint: C_DARK, ghost: true, noAO: true });
  W.box(x + 2.8, 1.2, z, 9.2, 2.75, 2.6, 'rib', { tint: trailerTint, noAO: true });
  W.box(x + 2.8, 0, z, 9.2, 1.2, 2.6, 'plain', { clip: true });
  for (const wx of [0.6, 8.6, 10.0]) for (const wz of [0.02, 2.2]) W.box(x + wx, 0, z + wz, 1.0, 1.0, 0.38, 'plain', { tint: [0.05, 0.05, 0.055], ghost: true });
}
/** Mast mit Leuchtkopf */
function lampPost(W, x, z, hgt, arm = 1) {
  W.cyl(x, 0, z, 0.09, hgt, 'plate', { tint: C_DARK, seg: 6 });
  W.box(x - 0.08, hgt - 0.1, z - 0.08 + (arm > 0 ? 0 : -0.9), 0.16, 0.12, 1.06, 'plate', { tint: C_DARK, ghost: true, noAO: true });
  W.box(x - 0.16, hgt - 0.2, z + arm * 0.62 - 0.25, 0.32, 0.1, 0.5, 'plain', { tint: [1, 0.93, 0.75], emis: 1, ghost: true, noAO: true });
}

// ---------- Karte 1: Frachthof ----------
function mapFrachthof(W) {
  W.name = 'Frachthof';
  W.bounds = { x0: -37, x1: 37, z0: -31, z1: 31, y1: 12 };
  W.env = {
    sunDir: norm3(-0.5, 0.6, 0.62), sunCol: [2.9, 2.25, 1.55], skyCol: [0.42, 0.52, 0.7], gndCol: [0.3, 0.26, 0.22],
    fogCol: [0.74, 0.64, 0.53], fogDen: 0.004, zenith: [0.15, 0.31, 0.6], cloud: 0.5, exposure: 0.8,
    grade: { shadow: [0.96, 1.0, 1.06], light: [1.06, 1.0, 0.94], sat: 1.05, contrast: 1.06, rays: 0.5 },     // Farbstimmung im Schlussschritt
  };
  const BRICK = { tint: [0.92, 0.9, 0.88] }, CRANE = { tint: [0.9, 0.6, 0.08] };

  W.box(-140, -0.5, -140, 280, 0.5, 280, 'asphalt', { ghost: true });
  // Umfassung – darüber eine unsichtbare Sperre: von der Empore der Halle aus käme man sonst mit einem Sprung
  // auf die Mauerkrone und von dort hinaus, ohne Weg zurück. Geschosse und Granaten fliegen hindurch.
  W.box(-36.6, 0, -30, 0.6, 5, 60, 'concrete');
  W.box(36, 0, -30, 0.6, 5, 60, 'concrete');
  W.box(-36.6, 5, -30.6, 0.6, 9, 61.2, 'plain', { clip: true });
  W.box(36, 5, -30.6, 0.6, 9, 61.2, 'plain', { clip: true });

  // ---------- Lagerhalle (Westen) ----------
  W.box(-36, 0, -16, 18.7, 0.02, 32, 'tile', { ghost: true, noAO: true });
  W.wall('z', -16.3, 16.3, -17.3, 0, 7, 0.3, 'brick', BRICK, [[-9.4, -7.9, 0, 2.3], [-5.6, -3.6, 1.1, 2.4], [-2.4, 2.4, 0, 3.6], [3.6, 5.6, 1.1, 2.4], [7.9, 9.4, 0, 2.3]]);
  W.box(-36, 7, -1.5, 9, 0.3, 3, 'roof', { noAO: true });
  W.box(-23, 7, -1.5, 6, 0.3, 3, 'roof', { noAO: true });
  W.lamp(-26.5, 5.6, 0, 12, [1.5, 1.2, 0.8]);
  W.box(-26.9, 6.3, -0.2, 0.8, 0.12, 0.4, 'plain', { tint: [1, 0.9, 0.7], emis: 1, ghost: true, noAO: true });
  // Gabelstapler
  W.box(-31.2, 0.25, 3.2, 1.2, 0.9, 2.0, 'plate', { tint: C_YEL, noAO: true });
  W.box(-31.2, 0, 3.2, 1.2, 0.25, 2.0, 'plain', { clip: true });
  W.box(-31.1, 1.15, 4.3, 1.0, 1.0, 0.08, 'plate', { tint: C_DARK, ghost: true, noAO: true });
  W.box(-31.05, 0.1, 5.2, 0.12, 2.3, 0.12, 'plate', { tint: C_DARK, noAO: true });
  W.box(-30.27, 0.1, 5.2, 0.12, 2.3, 0.12, 'plate', { tint: C_DARK, noAO: true });
  W.box(-31.0, 0.12, 5.3, 0.14, 0.06, 1.1, 'plate', { tint: C_STEEL, ghost: true, noAO: true });
  W.box(-30.34, 0.12, 5.3, 0.14, 0.06, 1.1, 'plate', { tint: C_STEEL, ghost: true, noAO: true });

  // ---------- Mitte: begehbarer Container, darüber ein zweiter, Portalkran ----------
  container(W, -6.1, -1.22, CONT_40, 'x', C_YEL, 0, true);
  container(W, -6.1, -1.22, CONT_40, 'x', C_TEAL, CONT_H);
  W.box(-16.4, 9.4, -3.7, 28.2, 0.9, 1.1, 'plate', { ...CRANE, noAO: true });
  W.box(-16.4, 9.4, 2.6, 28.2, 0.9, 1.1, 'plate', { ...CRANE, noAO: true });
  W.box(-6.5, 9.2, -3.7, 3, 0.5, 7.4, 'plate', { tint: C_DARK, ghost: true, noAO: true });
  for (const cx of [-6, -4.1]) for (const cz of [-0.9, 0.8]) W.box(cx, 5.3, cz, 0.06, 4, 0.06, 'plain', { tint: C_DARK, ghost: true, noAO: true });

  // ---------- Laderampe (Osten) mit Büro ----------
  W.box(30, 0, -19, 6, 1.1, 38, 'concrete');
  W.box(29.94, 0.82, -19, 0.08, 0.28, 38, 'hazard', { ghost: true, noAO: true });
  W.stairs(28.4, 0, -1, 'x+', 4, 2, 'concrete', 0.275, 0.4);
  W.wall('z', -4, 4, 32.4, 1.1, 2.7, 0.2, 'plaster', {}, [[-3.2, -1.7, 1, 2], [-0.6, 0.6, 0, 2.1], [1.7, 3.2, 1, 2]]);
  W.box(32.2, 3.8, -4.2, 3.9, 0.2, 8.4, 'roof', { noAO: true });
  W.box(34.6, 1.1, -0.9, 1.0, 0.8, 1.8, 'planks', { noAO: true });
  W.lamp(34, 3.2, 0, 6, [1.2, 1.1, 0.9]);

  W.mirror(() => {
    W.box(-36.6, 0, -30.6, 73.2, 5, 0.6, 'concrete');
    W.box(-36.6, 5, -30.6, 73.2, 9, 0.6, 'plain', { clip: true });
    // Lagerhalle: Stirnwand mit Tor, Dach mit Oberlicht, Empore mit Treppe
    W.wall('x', -36, -17, -16.3, 0, 7, 0.3, 'brick', BRICK, [[-29.5, -24.5, 0, 4.2]]);
    W.box(-36, 7, -16.3, 19, 0.3, 5.3, 'roof', { noAO: true });
    W.box(-36, 7, -11, 6, 0.3, 3, 'roof', { noAO: true });
    W.box(-26, 7, -11, 9, 0.3, 3, 'roof', { noAO: true });
    W.box(-36, 7, -8, 19, 0.3, 6.5, 'roof', { noAO: true });
    for (const z of [-12, -6]) W.box(-36, 6.5, z, 18.7, 0.3, 0.2, 'plate', { tint: C_DARK, ghost: true, noAO: true });
    W.lamp(-26.5, 5.6, -10, 12, [1.5, 1.2, 0.8]);
    W.box(-36, 3, -16, 7.5, 0.25, 8, 'planks', { noAO: true });
    W.box(-28.8, 0, -8.3, 0.3, 3, 0.3, 'plate', { tint: C_DARK });
    W.box(-28.8, 0, -16, 0.3, 3, 0.3, 'plate', { tint: C_DARK });
    W.stairs(-36, 0, -3.45, 'z-', 13, 1.4, 'plate', 0.25, 0.35, { tint: C_STEEL });
    W.box(-28.6, 3.25, -16, 0.1, 1, 8, 'plate', { tint: C_DARK, noAO: true });
    W.box(-34.6, 3.25, -8.1, 6.1, 1, 0.1, 'plate', { tint: C_DARK, noAO: true });
    crate(W, -35.3, 3.25, -15.3, 1.1);
    crate(W, -32.5, 0, -15.4, 1.3);
    crate(W, -30.9, 0, -15.2, 1.0);
    crate(W, -24.2, 0, -13, 1.5); crate(W, -24.2, 1.5, -13, 1.5);
    crate(W, -24.2, 0, -11.3, 1.5);
    crate(W, -24.1, 0, -9.6, 1.3);
    crate(W, -24.2, 0, -6.6, 1.5); crate(W, -24.05, 1.5, -6.5, 1.2);
    crate(W, -19.2, 0, -13.6, 1.4);
    barrel(W, -18.2, -11.5, C_BLUE); barrel(W, -18.9, -11.0, C_RED);

    // Deckung vor dem Startbereich
    container(W, -10.1, -21.6, CONT_40, 'x', C_RED);
    container(W, 6.5, -23, CONT_20, 'x', C_WHITE);
    container(W, 6.5, -23, CONT_20, 'x', C_GREEN, CONT_H);
    barrier(W, -16.2, -22.4, 4, 'x');
    crate(W, 17, 0, -24.2, 1.4); crate(W, 18.6, 0, -23.9, 1.1); crate(W, 17.2, 1.4, -24.1, 1.0);

    // Mittelgasse
    container(W, -12.6, -16.6, CONT_40, 'z', C_BLUE);
    container(W, 3.6, -13.6, CONT_20, 'z', C_GREEN);
    container(W, 3.6, -13.6, CONT_20, 'z', C_YEL, CONT_H);
    crate(W, -5.2, 0, -11.8, 1.3); crate(W, -3.8, 0, -11.2, 1.1); crate(W, -5.05, 1.3, -11.65, 0.9);
    barrel(W, -2.2, -10.4, C_RED); barrel(W, -1.5, -10.9, C_BLUE);
    barrier(W, -2, -6.4, 4, 'x');
    W.box(-15.6, 0, -3.6, 0.9, 9.4, 0.9, 'plate', CRANE);
    W.box(10.6, 0, -3.6, 0.9, 9.4, 0.9, 'plate', CRANE);

    // Trennung zur Rampe, Lastwagen, Deckung im Osten
    container(W, 13, -17, CONT_40, 'z', C_YEL);
    container(W, 13, -17, CONT_20, 'z', C_WHITE, CONT_H);
    W.stairs(30.2, 0, -20.6, 'z+', 4, 1.6, 'concrete', 0.275, 0.4);
    truck(W, 17.9, -12.3, C_BLUE, C_WHITE);
    barrier(W, 20, -5.4, 4, 'x');
    barrier(W, 24.6, -18.6, 3, 'z');
    crate(W, 33.6, 1.1, -15.2, 1.2); crate(W, 34.7, 1.1, -13.7, 1.0); barrel(W, 31, -9.5, C_GREEN, 1.1);
    crate(W, 26.2, 0, -3.2, 1.2);
    // Büro auf der Rampe: Seitenwand mit Fenster
    W.wall('x', 32.4, 36, -4.2, 1.1, 2.7, 0.2, 'plaster', {}, [[33.3, 35.1, 1, 2]]);
    lampPost(W, 14.2, -26, 7);
    lampPost(W, -16.5, -19.5, 7);

    // Kulisse hinter der Mauer
    for (let i = 0; i < 5; i++) {
      const tint = [C_RED, C_BLUE, C_WHITE, C_GREEN, C_YEL][i];
      W.box(-34 + i * 14, 0, -37 - (i % 2) * 2.6, CONT_40, CONT_H * (2 + (i % 3)), CONT_W, 'rib', { tint, ghost: true });
    }
    W.box(-70, 0, -75, 60, 16, 24, 'rib', { tint: [0.42, 0.45, 0.5], ghost: true });
    W.box(20, 0, -80, 40, 11, 20, 'brick', { ghost: true });
    for (const tx of [-8, 6]) { W.box(tx, 0, -58, 1.6, 34, 1.6, 'plate', { tint: [0.75, 0.3, 0.12], ghost: true }); }
    W.box(-12, 32, -59, 26, 2.2, 3.6, 'plate', { tint: [0.75, 0.3, 0.12], ghost: true, noAO: true });
    W.box(-2, 34, -78, 2.4, 2.4, 40, 'plate', { tint: [0.75, 0.3, 0.12], ghost: true, noAO: true });
    W.poi(-26, -10).poi(-3, -15).poi(9, -8).poi(22, -8).poi(33, -12).poi(-14.5, -10).poi(-33, -12);
  });
  // Kulisse im Westen und Osten
  W.box(-62, 0, -40, 20, 13, 80, 'rib', { tint: [0.36, 0.4, 0.44], ghost: true });
  for (let i = 0; i < 4; i++) W.box(40, 0, -26 + i * 14, CONT_W, CONT_H * (3 - (i % 2)), CONT_40, 'rib', { tint: [C_TEAL, C_RED, C_YEL, C_BLUE][i], ghost: true });

  for (let i = 0; i < 8; i++) {
    const x = -30 + i * 8;
    W.spawn(0, x, 27, 0).spawn(0, x + 2, 28.6, 0);
    W.spawn(1, x, -27, Math.PI).spawn(1, x + 2, -28.6, Math.PI);
  }
  W.poi(0, 0).poi(-26, 0).poi(33.5, 0.2).poi(9, 0).poi(-9, 0).poi(22, 0);
  W.flag('A', -3, -16).flag('B', 9.2, 0).flag('C', -3, 16);
}

// ---------- Karte 2: Oase ----------
const OASE_HELL = [1, 0.93, 0.8], OASE_OCKER = [0.96, 0.8, 0.58], OASE_TERRA = [0.9, 0.66, 0.48], OASE_KALK = [0.95, 0.9, 0.84];
const OASE_HOLZ = [0.62, 0.46, 0.3], OASE_DUNKEL = [0.3, 0.21, 0.14], OASE_BLAU = [0.1, 0.4, 0.5], OASE_STEIN = [1, 0.86, 0.64];
const oaseDeko = (tint) => ({ tint, ghost: true, noAO: true });

/** Palme: der Stamm ist ein schmales Hindernis, die Wedel sind nur Zierde. */
function oasePalme(W, x, z, hgt = 6, turn = 0) {
  W.cyl(x, 0, z, 0.2, hgt, 'planks', { tint: [0.6, 0.48, 0.34], seg: 7 });
  W.box(x - 0.3, hgt - 0.3, z - 0.3, 0.6, 0.55, 0.6, 'planks', oaseDeko([0.36, 0.3, 0.17]));
  for (let i = 0; i < 12; i++) {
    const top = i >= 7, a = (top ? (i - 7) / 5 : i / 7) * TAU + turn + (top ? 0.5 : 0);
    const len = top ? 2 : 2.7 + (i % 3) * 0.25, droop = top ? 0.12 : 0.5 + (i % 3) * 0.13, half = (len / 2) * Math.cos(droop);
    const cx = x + Math.sin(a) * half, cz = z + Math.cos(a) * half, cy = hgt + 0.15 - (len / 2) * Math.sin(droop);
    W.box(cx - 0.32, cy - 0.03, cz - len / 2, 0.64, 0.06, len, 'cloth', { tint: top ? [0.3, 0.5, 0.17] : [0.21, 0.4, 0.13], ghost: true, noAO: true, yaw: a, tilt: droop });
  }
}

/**
 * Lehmhaus mit Flachdach: vier Mauern (0,4 m) mit Öffnungen je Seite { n, s, w, e } als [von, bis, Brüstung, Sturz],
 * dazu Dachplatte, Boden und Zierde (Stürze, Fensterläden, Balkenköpfe).
 */
function oaseHaus(W, x0, z0, x1, z1, hgt, tint, open = {}, deck = 0.24) {
  const t = 0.4, P = { tint }, holz = oaseDeko(OASE_DUNKEL), blau = oaseDeko(OASE_BLAU);
  W.wall('x', x0, x1, z0, 0, hgt, t, 'plaster', P, open.n);
  W.wall('x', x0, x1, z1 - t, 0, hgt, t, 'plaster', P, open.s);
  W.wall('z', z0 + t, z1 - t, x0, 0, hgt, t, 'plaster', P, open.w);
  W.wall('z', z0 + t, z1 - t, x1 - t, 0, hgt, t, 'plaster', P, open.e);
  W.box(x0, hgt, z0, x1 - x0, deck, z1 - z0, 'plaster', { tint: shadeOf(tint, 0.9), noAO: true });
  W.box(x0 + t, 0, z0 + t, x1 - x0 - 2 * t, 0.02, z1 - z0 - 2 * t, 'tile', oaseDeko([0.86, 0.72, 0.58]));
  // Zierde an einer Wand: axis wie bei W.wall, fixed = Innenkante der Wand, out = Richtung nach draußen
  const put = (axis, a, b, p0, p1, y0, y1, m, o) => (axis === 'x' ? W.box(a, y0, p0, b - a, y1 - y0, p1 - p0, m, o) : W.box(p0, y0, a, p1 - p0, y1 - y0, b - a, m, o));
  const trim = (axis, fixed, out, list = []) => {
    for (const [a, b, lo = 0, hi = 2.2] of list) {
      put(axis, a - 0.15, b + 0.15, fixed - 0.05, fixed + t + 0.05, hi - 0.03, hi + 0.15, 'planks', holz);
      if (!lo) continue;
      put(axis, a - 0.1, b + 0.1, fixed - 0.08, fixed + t + 0.08, lo - 0.07, lo + 0.02, 'planks', holz);
      const p0 = out < 0 ? fixed - 0.06 : fixed + t + 0.01;
      put(axis, a - 0.52, a - 0.02, p0, p0 + 0.05, lo, hi, 'planks', blau);
      put(axis, b + 0.02, b + 0.52, p0, p0 + 0.05, lo, hi, 'planks', blau);
    }
  };
  trim('x', z0, -1, open.n); trim('x', z1 - t, 1, open.s); trim('z', x0, -1, open.w); trim('z', x1 - t, 1, open.e);
  for (let x = x0 + 0.9; x < x1 - 0.5; x += 1.7) {
    W.box(x - 0.07, hgt - 0.42, z0 - 0.3, 0.14, 0.14, 0.34, 'planks', holz);
    W.box(x - 0.07, hgt - 0.42, z1 - 0.04, 0.14, 0.14, 0.34, 'planks', holz);
  }
}
/** Brüstung rund ums Dach (nur Zierde, für Dächer, die niemand betritt). */
function oaseKranz(W, x0, z0, x1, z1, y, tint, hh = 0.35) {
  const o = oaseDeko(shadeOf(tint, 0.94));
  W.box(x0, y, z0, x1 - x0, hh, 0.25, 'plaster', o); W.box(x0, y, z1 - 0.25, x1 - x0, hh, 0.25, 'plaster', o);
  W.box(x0, y, z0 + 0.25, 0.25, hh, z1 - z0 - 0.5, 'plaster', o); W.box(x1 - 0.25, y, z0 + 0.25, 0.25, hh, z1 - z0 - 0.5, 'plaster', o);
}
/** Marktstand: Theke als Deckung an der Seite `front`, Tuchdach auf vier Stangen, etwas Ware. */
function oaseStand(W, x, z, sx, sz, front, tint) {
  const cx = front === 'e' ? x + sx - 0.8 : x, cz = front === 's' ? z + sz - 0.8 : z, wide = front === 'n' || front === 's';
  const cw = wide ? sx : 0.8, cd = wide ? 0.8 : sz;
  W.box(cx, 0, cz, cw, 0.95, cd, 'planks', { tint: OASE_HOLZ });
  for (let i = 0; i < 3; i++) {
    const k = 0.25 + i * (wide ? (sx - 1.1) / 2 : (sz - 1.1) / 2);
    W.box(wide ? cx + k : cx + 0.12, 0.95, wide ? cz + 0.12 : cz + k, 0.55, 0.22, 0.55, 'wood', oaseDeko([[1, 0.75, 0.4], [0.75, 0.95, 0.5], [1, 0.55, 0.4]][i]));
  }
  for (const px of [x, x + sx - 0.09]) for (const pz of [z, z + sz - 0.09]) W.box(px, 0, pz, 0.09, 2.36, 0.09, 'planks', oaseDeko(OASE_DUNKEL));
  W.box(x - 0.3, 2.3, z - 0.3, sx + 0.6, 0.06, sz + 0.6, 'cloth', { tint, ghost: true, noAO: true, tilt: front === 'n' ? -0.09 : front === 's' ? 0.09 : 0 });
}
/** Karren: die Ladefläche gibt Deckung, Räder und Deichsel sind Zierde. */
function oaseKarren(W, x, z, along) {
  const sx = along === 'x' ? 2.6 : 1.3, sz = along === 'x' ? 1.3 : 2.6, dark = oaseDeko([0.2, 0.15, 0.1]);
  W.box(x, 0.55, z, sx, 0.75, sz, 'planks', { tint: OASE_HOLZ, noAO: true });
  W.box(x, 0, z, sx, 0.55, sz, 'plain', { clip: true });
  W.box(x + 0.2, 1.3, z + 0.2, sx - 0.4, 0.32, sz - 0.4, 'cloth', oaseDeko([0.82, 0.74, 0.58]));
  if (along === 'x') {
    for (const wz of [z - 0.11, z + sz + 0.01]) W.box(x + 0.85, 0, wz, 0.95, 0.95, 0.1, 'planks', dark);
    W.box(x + sx, 0.62, z + sz / 2 - 0.04, 1.4, 0.08, 0.08, 'planks', dark);
  } else {
    for (const wx of [x - 0.11, x + sx + 0.01]) W.box(wx, 0, z + 0.85, 0.1, 0.95, 0.95, 'planks', dark);
    W.box(x + sx / 2 - 0.04, 0.62, z + sz, 0.08, 0.08, 1.4, 'planks', dark);
  }
}
const oaseKrug = (W, x, z, r = 0.24, hh = 0.52) => W.cyl(x, 0, z, r, hh, 'plain', { tint: [0.72, 0.36, 0.2], ghost: true, seg: 8 });
/** Wandleuchte im Haus: kleines Leuchtkästchen unter der Decke und das Licht dazu. */
function oaseLicht(W, x, y, z, r) {
  W.box(x - 0.18, y + 0.2, z - 0.18, 0.36, 0.12, 0.36, 'plain', { tint: [1, 0.82, 0.55], emis: 1, ghost: true, noAO: true });
  W.lamp(x, y, z, r, [1.35, 1.0, 0.58]);
}

function mapOase(W) {
  W.name = 'Oase';
  W.bounds = { x0: -33, x1: 33, z0: -33, z1: 33, y1: 11 };
  W.env = {
    sunDir: norm3(0.42, 0.95, 0.36), sunCol: [3.0, 2.8, 2.4], skyCol: [0.46, 0.58, 0.8], gndCol: [0.44, 0.37, 0.27],
    fogCol: [0.83, 0.82, 0.76], fogDen: 0.003, zenith: [0.1, 0.29, 0.68], cloud: 0.25, exposure: 0.62,
    grade: { shadow: [1.0, 0.98, 1.04], light: [1.08, 1.02, 0.92], sat: 1.10, contrast: 1.04, rays: 0.8 },
  };
  const OCK = { tint: OASE_OCKER }, HEL = { tint: OASE_HELL }, TER = { tint: OASE_TERRA }, KAL = { tint: OASE_KALK }, STEIN = { tint: OASE_STEIN };
  const rand = oaseDeko(shadeOf(OASE_OCKER, 0.82));

  W.box(-160, -0.5, -160, 320, 0.5, 320, 'sand', { ghost: true });
  // Umfassung im Westen und Osten – darüber eine unsichtbare Sperre: vom Dach der Hütten an der Mauer käme man sonst
  // auf die Mauerkrone und von dort hinaus, ohne Weg zurück. Geschosse und Granaten fliegen hindurch.
  W.box(-32, 0, -31.4, 0.6, 4.6, 62.8, 'plaster', OCK);
  W.box(31.4, 0, -31.4, 0.6, 4.6, 62.8, 'plaster', OCK);
  W.box(-32, 4.6, -32, 0.6, 9.4, 64, 'plain', { clip: true });
  W.box(31.4, 4.6, -32, 0.6, 9.4, 64, 'plain', { clip: true });
  W.box(-32.1, 4.6, -32.1, 0.8, 0.22, 64.2, 'plaster', rand);
  W.box(31.3, 4.6, -32.1, 0.8, 0.22, 64.2, 'plaster', rand);

  // ---------- Markt (Mitte): Pflaster, Brunnen, Pflanzkübel ----------
  W.box(-10.5, 0, -14, 21, 0.02, 28, 'brick', oaseDeko([0.98, 1.1, 1.08]));
  W.cyl(-5.5, 0, 0, 1.15, 0.8, 'brick', { tint: OASE_KALK, seg: 12 });
  W.cyl(-5.5, 0, 0, 0.85, 0.82, 'plain', { tint: [0.04, 0.17, 0.22], seg: 12, ghost: true });
  for (const pz of [-1.06, 0.94]) W.box(-5.56, 0.8, pz, 0.12, 1.75, 0.12, 'planks', oaseDeko(OASE_DUNKEL));
  W.box(-5.58, 2.5, -1.2, 0.16, 0.12, 2.4, 'planks', oaseDeko(OASE_DUNKEL));
  W.box(-6.5, 2.62, -1.4, 2, 0.07, 2.8, 'planks', oaseDeko(OASE_HOLZ));
  W.box(-5.53, 1.5, -0.03, 0.06, 1, 0.06, 'plain', oaseDeko([0.5, 0.42, 0.3]));
  W.box(4.3, 0, -1.2, 2.4, 0.6, 2.4, 'brick', KAL);
  W.box(4.5, 0.6, -1, 2, 0.04, 2, 'gravel', oaseDeko([0.5, 0.36, 0.24]));
  oasePalme(W, 5.5, 0, 6.8, 0.4);

  // ---------- Oase (Westen): Teich mit Steinrand ----------
  W.box(-29.5, 0, -3.2, 9.5, 0.05, 6.4, 'plain', oaseDeko([0.022, 0.095, 0.115]));
  W.box(-30, 0, -3.2, 0.5, 0.3, 6.4, 'concrete', STEIN);
  W.box(-20, 0, -3.2, 0.5, 0.3, 6.4, 'concrete', STEIN);

  // ---------- Ruine (Osten): Sturz über den beiden hohen Säulen, alter Boden ----------
  W.box(15.55, 2.6, -2.25, 0.9, 0.45, 4.5, 'plaster', { tint: OASE_KALK, noAO: true });
  W.box(14.6, 0, -4.2, 10.4, 0.02, 8.4, 'tile', oaseDeko([0.82, 0.7, 0.56]));

  W.mirror(() => {
    // Umfassung mit Strebepfeilern
    W.box(-32, 0, -32, 64, 4.6, 0.6, 'plaster', OCK);
    W.box(-32, 4.6, -32, 64, 9.4, 0.6, 'plain', { clip: true });
    W.box(-32.1, 4.6, -32.1, 64.2, 0.22, 0.8, 'plaster', rand);
    for (const bx of [-24, -8, 8, 24]) W.box(bx - 0.5, 0, -31.4, 1, 3.7, 0.35, 'plaster', oaseDeko(OASE_OCKER));
    for (const bz of [-24, -8]) { W.box(-31.4, 0, bz - 0.5, 0.35, 3.7, 1, 'plaster', oaseDeko(OASE_OCKER)); W.box(31.05, 0, bz - 0.5, 0.35, 3.7, 1, 'plaster', oaseDeko(OASE_OCKER)); }

    // ---------- Reihe 1: Haus A, Torbau mit Turm, Haus C ----------
    oaseHaus(W, -25, -25, -8, -19, 3.1, OASE_HELL, { n: [[-21.25, -19.75]], s: [[-18.25, -16.75, 1.05, 2.1], [-13.25, -11.75]], w: [[-23.25, -21.75]], e: [[-22.75, -21.25, 1.05, 2.1]] });
    W.wall('z', -24.6, -19.4, -15.2, 0, 3.1, 0.3, 'plaster', HEL, [[-23.25, -21.75]]);
    oaseKranz(W, -25, -25, -8, -19, 3.34, OASE_HELL);
    crate(W, -24.4, 0, -20.7, 1.2);
    W.box(-19.1, 0, -20.6, 2.6, 0.85, 1, 'planks', { tint: OASE_HOLZ });
    W.box(-10.2, 0, -24.5, 1.6, 1.9, 0.6, 'planks', { tint: OASE_DUNKEL });
    crate(W, -14.6, 0, -20.5, 1); barrel(W, -9.1, -19.9, OASE_TERRA);
    W.box(-23.6, 0.02, -24.2, 3, 0.02, 2, 'cloth', oaseDeko([0.6, 0.16, 0.12]));
    oaseLicht(W, -17, 2.6, -22, 8);

    oaseHaus(W, 8, -25, 25, -19, 3.1, OASE_KALK, { n: [[19.75, 21.25]], s: [[11.75, 13.25], [16.75, 18.25, 1.05, 2.1]], e: [[-23.25, -21.75]], w: [[-22.75, -21.25, 1.05, 2.1]] });
    W.wall('z', -24.6, -19.4, 14.9, 0, 3.1, 0.3, 'plaster', KAL, [[-23.25, -21.75]]);
    oaseKranz(W, 8, -25, 25, -19, 3.34, OASE_KALK);
    crate(W, 23.2, 0, -20.7, 1.2); crate(W, 22.1, 0, -20.5, 0.9);
    W.box(16.4, 0, -20.6, 2.4, 0.85, 1, 'planks', { tint: OASE_HOLZ });
    W.box(8.6, 0, -24.5, 2.2, 1.9, 0.6, 'planks', { tint: OASE_DUNKEL });
    barrel(W, 13.9, -24.1, OASE_BLAU); barrel(W, 13.2, -24.2, OASE_TERRA);
    W.box(17, 0.02, -24, 3.2, 0.02, 2.2, 'cloth', oaseDeko([0.2, 0.3, 0.5]));
    oaseLicht(W, 17, 2.6, -22, 8);

    W.box(-4.5, 0, -25, 9, 4.4, 6, 'plaster', OCK);
    oaseKranz(W, -4.5, -25, 4.5, -19, 4.4, OASE_OCKER, 0.4);
    W.box(-1.7, 4.4, -23.7, 3.4, 4.2, 3.4, 'plaster', oaseDeko(OASE_HELL));
    W.box(-2, 8.6, -24, 4, 0.3, 4, 'plaster', rand);
    W.box(-1.2, 8.9, -23.2, 2.4, 0.7, 2.4, 'plaster', oaseDeko(OASE_KALK));
    W.box(-0.7, 9.6, -22.7, 1.4, 0.5, 1.4, 'plaster', oaseDeko(OASE_KALK));
    for (const fz of [-23.73, -20.33]) W.box(-0.35, 6.5, fz, 0.7, 1.4, 0.06, 'plain', oaseDeko([0.05, 0.04, 0.04]));
    for (const fx of [-1.73, 1.67]) W.box(fx, 6.5, -22.35, 0.06, 1.4, 0.7, 'plain', oaseDeko([0.05, 0.04, 0.04]));
    W.box(-0.9, 0, -19.05, 1.8, 2.5, 0.08, 'planks', oaseDeko(OASE_DUNKEL));
    W.box(-1.7, 2.75, -19, 3.4, 0.06, 1.5, 'cloth', { tint: [0.72, 0.2, 0.14], ghost: true, noAO: true, tilt: 0.3 });

    // Hütten an der Außenmauer: versperren die lange Sicht durch die Seitengassen
    W.box(-31.4, 0, -18.5, 4.4, 2.8, 3, 'plaster', TER);
    oaseKranz(W, -31.4, -18.5, -27, -15.5, 2.8, OASE_TERRA, 0.3);
    W.box(-27.04, 0, -17.6, 0.07, 2.05, 1.1, 'planks', oaseDeko(OASE_BLAU));
    W.box(27, 0, -18.5, 4.4, 2.8, 3, 'plaster', HEL);
    oaseKranz(W, 27, -18.5, 31.4, -15.5, 2.8, OASE_HELL, 0.3);
    W.box(26.97, 0, -17.6, 0.07, 2.05, 1.1, 'planks', oaseDeko(OASE_DUNKEL));

    // ---------- Reihe 2: Haus D und Haus E, beide mit Außentreppe aufs Dach ----------
    oaseHaus(W, -25, -14, -14, -6.5, 2.9, OASE_OCKER, { n: [[-22.25, -20.75], [-18.25, -16.75, 1.05, 2.1]], s: [[-21.25, -19.75], [-17.75, -16.25, 1.05, 2.1]], e: [[-11.25, -9.75]] }, 0.22);
    W.stairs(-27, 0, -6, 'z-', 12, 2, 'plaster', 0.26, 0.5, { tint: shadeOf(OASE_OCKER, 0.95) });
    W.box(-27, 0, -14, 2, 3.12, 2, 'plaster', { tint: shadeOf(OASE_OCKER, 0.95) });
    W.box(-25, 3.12, -14, 11, 0.9, 0.3, 'plaster', { tint: OASE_OCKER, noAO: true });
    W.box(-25, 3.12, -6.8, 11, 0.9, 0.3, 'plaster', { tint: OASE_OCKER, noAO: true });
    W.box(-14.3, 3.12, -13.7, 0.3, 0.9, 6.9, 'plaster', { tint: OASE_OCKER, noAO: true });
    W.box(-25, 3.12, -13.7, 0.3, 0.9, 0.45, 'plaster', { tint: OASE_OCKER, noAO: true });
    W.box(-25, 3.12, -11.75, 0.3, 0.9, 4.95, 'plaster', { tint: OASE_OCKER, noAO: true });
    crate(W, -16.6, 3.12, -9.4, 1); W.cyl(-22.6, 3.12, -8.2, 0.6, 1.2, 'plate', { tint: [0.5, 0.56, 0.6] });
    for (const px of [-20.4, -17.1]) for (const pz of [-12.9, -10.4]) W.box(px, 3.12, pz, 0.08, 2.1, 0.08, 'planks', oaseDeko(OASE_DUNKEL));
    W.box(-20.7, 5.2, -13.2, 4, 0.05, 3.2, 'cloth', { tint: [0.85, 0.8, 0.66], ghost: true, noAO: true, tilt: 0.06 });
    W.box(-19.5, 0, -11.6, 3, 0.95, 0.7, 'planks', { tint: OASE_HOLZ });
    crate(W, -24.5, 0, -8.2, 1.2); crate(W, -15.6, 0, -13.4, 1);
    W.box(-19, 0.02, -9.8, 2.6, 0.02, 1.8, 'cloth', oaseDeko([0.6, 0.2, 0.1]));
    oaseLicht(W, -19.5, 2.5, -10.2, 7.5);

    oaseHaus(W, 14, -14, 25, -6.5, 2.9, OASE_TERRA, { n: [[20.75, 22.25], [16.75, 18.25, 1.05, 2.1]], s: [[19.75, 21.25], [16.25, 17.75, 1.05, 2.1]], w: [[-11.25, -9.75]] }, 0.22);
    W.stairs(25, 0, -6, 'z-', 12, 2, 'plaster', 0.26, 0.5, { tint: shadeOf(OASE_TERRA, 0.95) });
    W.box(25, 0, -14, 2, 3.12, 2, 'plaster', { tint: shadeOf(OASE_TERRA, 0.95) });
    W.box(14, 3.12, -14, 11, 0.9, 0.3, 'plaster', { tint: OASE_TERRA, noAO: true });
    W.box(14, 3.12, -6.8, 11, 0.9, 0.3, 'plaster', { tint: OASE_TERRA, noAO: true });
    W.box(14, 3.12, -13.7, 0.3, 0.9, 6.9, 'plaster', { tint: OASE_TERRA, noAO: true });
    W.box(24.7, 3.12, -13.7, 0.3, 0.9, 0.45, 'plaster', { tint: OASE_TERRA, noAO: true });
    W.box(24.7, 3.12, -11.75, 0.3, 0.9, 4.95, 'plaster', { tint: OASE_TERRA, noAO: true });
    W.box(17.2, 3.12, -9.6, 2.4, 1.1, 0.5, 'plaster', { tint: OASE_TERRA });
    crate(W, 22.4, 3.12, -8.3, 1.1);
    W.box(21.4, 0, -13.4, 3, 1.9, 0.6, 'planks', { tint: OASE_DUNKEL });
    W.box(16, 0, -8.2, 0.8, 0.95, 1, 'planks', { tint: OASE_HOLZ }); crate(W, 23.3, 0, -8.3, 1.2);
    W.box(17.6, 0.02, -11.6, 3, 0.02, 2, 'cloth', oaseDeko([0.2, 0.42, 0.36]));
    oaseLicht(W, 19.5, 2.5, -10.2, 7.5);

    // ---------- Markt: Mauer mit Torbogen, Säulengänge, Stände ----------
    W.wall('x', -10.5, 10.5, -14.4, 0, 3.2, 0.4, 'plaster', KAL, [[-2, 2, 0, 2.8]]);
    W.box(-2.4, 0, -14.5, 0.4, 3.5, 0.6, 'plaster', oaseDeko(OASE_OCKER));
    W.box(2, 0, -14.5, 0.4, 3.5, 0.6, 'plaster', oaseDeko(OASE_OCKER));
    W.box(-2.7, 3.2, -14.55, 5.4, 0.4, 0.7, 'plaster', oaseDeko(OASE_OCKER));
    for (const pz of [-11.5, -7.5, -3.5]) {
      W.box(-10.8, 0, pz - 0.3, 0.6, 3, 0.6, 'plaster', KAL);
      W.box(10.2, 0, pz - 0.3, 0.6, 3, 0.6, 'plaster', KAL);
    }
    W.box(-10.9, 3, -14, 0.8, 0.36, 14, 'plaster', oaseDeko(OASE_OCKER));
    W.box(10.1, 3, -14, 0.8, 0.36, 14, 'plaster', oaseDeko(OASE_OCKER));
    oaseStand(W, -8.6, -11.2, 3.2, 2.4, 's', [0.8, 0.26, 0.16]);
    oaseStand(W, 4.6, -9.6, 2.4, 3.2, 'w', [0.2, 0.42, 0.62]);
    crate(W, -8.4, 0, -11, 0.8); crate(W, 6.1, 0, -9.4, 0.8);
    W.box(-3.4, 0, -4.6, 2.8, 1.05, 0.5, 'plaster', OCK);
    W.box(1.6, 0, -7, 0.5, 1.05, 2.6, 'plaster', OCK);
    crate(W, -1.6, 0, -13.2, 1.1); barrel(W, -3.1, -13.4, OASE_TERRA); barrel(W, 2.9, -13.3, OASE_BLAU);
    oaseKarren(W, 6.4, -13.6, 'x');
    W.box(-4.2, 0.02, -8.2, 2.4, 0.02, 1.6, 'cloth', oaseDeko([0.62, 0.18, 0.14]));
    oaseKrug(W, -9.6, -13.3); oaseKrug(W, -9.1, -13.5, 0.2, 0.42); oaseKrug(W, 9.6, -5.2);

    // ---------- Querstraße vor dem Markt, Seitengassen ----------
    crate(W, 2.7, 0, -18.9, 1.2); crate(W, 3.95, 0, -18.7, 0.9);
    barrel(W, -3.4, -18.5, OASE_TERRA); barrel(W, -2.7, -18.2, OASE_HOLZ);
    oaseKarren(W, -19.2, -17.2, 'x');
    W.box(16.5, 0, -16.6, 2.8, 1.05, 0.5, 'plaster', TER);
    oasePalme(W, 22.8, -16.4, 6.4, 0.9);
    oasePalme(W, -12.2, -18.3, 5.8, 2.1);
    W.box(-30.6, 0, -22.2, 2.8, 1.1, 0.5, 'plaster', TER);
    oasePalme(W, -30.2, -24.4, 6.2, 1);
    oaseKarren(W, 28.4, -23.6, 'z');
    oasePalme(W, 30.3, -25.2, 5.6, 2.6);
    barrel(W, -30.8, -9.8, OASE_TERRA); barrel(W, -30.9, -9, OASE_BLAU); crate(W, -31.3, 0, -11.6, 1.1);
    W.box(28.5, 0, -10.2, 0.5, 1.1, 2.6, 'plaster', HEL);
    crate(W, 30.2, 0, -7.6, 1.1);
    oaseKrug(W, -13.6, -8); oaseKrug(W, -13.5, -7.4, 0.19, 0.4); oaseKrug(W, 13.6, -12.6); oaseKrug(W, -24.4, -5.9); oaseKrug(W, 24.3, -18.4, 0.28, 0.6);
    W.box(-13.95, 0, -12.8, 0.45, 0.45, 1.8, 'planks', oaseDeko(OASE_HOLZ));
    W.box(13.5, 0, -8.8, 0.45, 0.45, 1.8, 'planks', oaseDeko(OASE_HOLZ));

    // ---------- Oase: Steinrand, Palmen, Felsen, Schilf ----------
    W.box(-30, 0, -3.7, 10.5, 0.3, 0.5, 'concrete', STEIN);
    oasePalme(W, -30.6, -5, 6.6, 0.3); oasePalme(W, -18.8, -4.7, 5.6, 1.7); oasePalme(W, -24.6, -4.9, 7.4, 2.9);
    W.box(-17.4, 0, -2.6, 1.9, 1.5, 1.7, 'concrete', STEIN);
    W.box(-17.9, 0, -3.1, 1.3, 0.9, 1.2, 'concrete', { tint: OASE_STEIN, ghost: true, yaw: 0.5 });
    W.box(-16.6, 0.9, -2.3, 1.2, 0.9, 1.1, 'concrete', { tint: shadeOf(OASE_STEIN, 0.92), ghost: true, yaw: -0.4, tilt: 0.15 });
    W.box(-15.3, 0, -1.2, 0.9, 0.5, 0.8, 'concrete', { tint: OASE_STEIN, ghost: true, yaw: 0.9 });
    for (let i = 0; i < 6; i++) W.box(-28.9 + i * 0.32, 0, -3.1 + (i % 2) * 0.22, 0.07, 1.1 + (i % 3) * 0.3, 0.07, 'cloth', { tint: [0.2, 0.33, 0.1], ghost: true, noAO: true, tilt: 0.1 - (i % 3) * 0.1 });
    for (let i = 0; i < 5; i++) W.box(-22.4 + i * 0.3, 0, -3.05 + (i % 2) * 0.2, 0.07, 0.9 + (i % 2) * 0.4, 0.07, 'cloth', { tint: [0.2, 0.33, 0.1], ghost: true, noAO: true, tilt: (i % 3) * 0.1 - 0.1 });

    // ---------- Ruine: Mauerreste, Säulen, gestürzte Blöcke ----------
    W.box(15, 0, -4.6, 2.5, 2.7, 0.4, 'plaster', KAL);
    W.box(17.5, 0, -4.6, 2, 1.75, 0.4, 'plaster', KAL);
    W.box(19.5, 0, -4.6, 1.5, 1.0, 0.4, 'plaster', KAL);
    W.box(22.5, 0, -4.6, 2, 2.3, 0.4, 'plaster', KAL);
    W.cyl(16, 0, -1.8, 0.42, 2.6, 'plaster', { tint: OASE_KALK, seg: 9 });
    W.cyl(20.6, 0, -1.8, 0.42, 1.25, 'plaster', { tint: OASE_KALK, seg: 9 });
    W.box(27.4, 0, -2.4, 1.5, 0.95, 1.2, 'plaster', KAL);
    W.box(26.2, 0, -1, 1.1, 0.5, 0.7, 'plaster', { tint: OASE_KALK, ghost: true, yaw: 0.6 });
    W.box(22.1, 0, -3.2, 1.2, 0.4, 0.6, 'plaster', { tint: OASE_KALK, ghost: true, yaw: -0.3, tilt: 0.12 });
    oasePalme(W, 30.2, -4.6, 6.2, 0.8);

    // ---------- Startbereich: Tor zur Zierde, Sonnensegel an der Mauer ----------
    oasePalme(W, -30.2, -30.3, 5.8, 0.2); oasePalme(W, 30.4, -30.2, 6.4, 1.3);
    crate(W, 2.5, 0, -26.3, 1.2); crate(W, 3.75, 0, -26.1, 0.9);
    W.box(-0.9, 0, -25.03, 1.8, 2.5, 0.08, 'planks', oaseDeko(OASE_DUNKEL));
    W.box(-1.7, 2.75, -26.5, 3.4, 0.06, 1.5, 'cloth', { tint: [0.2, 0.36, 0.5], ghost: true, noAO: true, tilt: -0.3 });
    for (const [tx, tint] of [[-20, [0.85, 0.78, 0.62]], [16, [0.7, 0.3, 0.2]]]) {
      for (const px of [tx, tx + 3.92]) W.box(px, 0, -29.4, 0.08, 2.3, 0.08, 'planks', oaseDeko(OASE_DUNKEL));
      W.box(tx - 0.2, 2.42, -31.4, 4.4, 0.05, 2.2, 'cloth', { tint, ghost: true, noAO: true, tilt: 0.14 });
      W.box(tx + 0.5, 0.02, -31.1, 1.9, 0.03, 0.8, 'cloth', oaseDeko([0.5, 0.42, 0.3]));
      crate(W, tx + 2.9, 0, -31.3, 0.8);
      oaseKrug(W, tx + 2.5, -31, 0.2, 0.42);
    }

    // ---------- Kulisse: Häuser, Turm und Dünen hinter der Mauer ----------
    for (let i = 0; i < 8; i++) {
      const hh = 4.5 + ((i * 5) % 4) * 1.5, wd = 8 + (i % 3) * 2.5;
      W.box(-52 + i * 14, 0, -42 - (i % 3) * 4.5, wd, hh, 7, 'plaster', oaseDeko([OASE_HELL, OASE_OCKER, OASE_KALK, OASE_TERRA][i % 4]));
      if (i % 2) W.box(-50 + i * 14, hh, -41 - (i % 3) * 4.5, 3.5, 2.6, 4, 'plaster', oaseDeko(OASE_KALK));
    }
    W.box(-21, 0, -60, 4.5, 19, 4.5, 'plaster', oaseDeko(OASE_HELL));
    W.box(-21.5, 19, -60.5, 5.5, 0.5, 5.5, 'plaster', rand);
    W.box(-20, 19.5, -59, 2.5, 2.4, 2.5, 'plaster', oaseDeko(OASE_KALK));
    W.box(-200, -9, -150, 400, 12, 70, 'sand', { ghost: true, noAO: true, tilt: 0.1 });
    W.box(40, -6, -110, 120, 9, 50, 'sand', { ghost: true, noAO: true, tilt: 0.13, yaw: 0.25 });
    for (const [px, pz, ph] of [[-40, -38, 7], [-37, -36.5, 6], [37, -37, 7.5], [12, -36.4, 6.4]]) oasePalme(W, px, pz, ph, px);

    W.poi(-28.5, -22).poi(-20.5, -22.5).poi(-11.5, -21.5).poi(11.5, -21.5).poi(20.5, -22.5).poi(28.5, -21).poi(-6.5, -16.5).poi(6.5, -16.5);
    W.poi(-19.5, -10.5).poi(19.5, -10.5).poi(-12.5, -10.5).poi(12.5, -10.5).poi(-5.5, -7.5).poi(7.5, -11.5).poi(-29.5, -10.5).poi(29.5, -12.5).poi(-22.5, -5.5).poi(20.5, -5.5);
  });
  // Dünen im Westen und Osten
  W.box(-315, -9, -35, 400, 12, 70, 'sand', { ghost: true, noAO: true, yaw: Math.PI / 2, tilt: 0.1 });
  W.box(-85, -9, -35, 400, 12, 70, 'sand', { ghost: true, noAO: true, yaw: Math.PI / 2, tilt: -0.1 });
  for (let i = 0; i < 4; i++) {
    W.box(-48 - (i % 2) * 5, 0, -30 + i * 16, 7, 5 + (i % 3) * 1.6, 10, 'plaster', oaseDeko([OASE_KALK, OASE_TERRA, OASE_HELL, OASE_OCKER][i]));
    W.box(41 + (i % 2) * 4, 0, -34 + i * 17, 8, 4.6 + ((i + 1) % 3) * 1.8, 9, 'plaster', oaseDeko([OASE_OCKER, OASE_HELL, OASE_TERRA, OASE_KALK][i]));
  }

  for (let i = 0; i < 7; i++) {
    const x = -27 + i * 9;
    W.spawn(0, x, 28, 0).spawn(1, x, -28, Math.PI);
    if (i < 6) W.spawn(0, x + 4.5, 30, 0).spawn(1, x + 4.5, -30, Math.PI);
  }
  W.poi(0, 0).poi(-24.5, 0).poi(18.5, 0).poi(-12.5, 0).poi(12.5, 0).poi(-8.5, 0.5);
  W.flag('A', 0, -16.5).flag('B', 0, 0).flag('C', 0, 16.5);
}

const MAPS = [
  { id: 'frachthof', name: 'Frachthof', about: 'Containerhafen bei tief stehender Sonne: Lagerhalle, Mittelgasse, Laderampe.', build: mapFrachthof },
  { id: 'oase', name: 'Oase', about: 'Wüstenstadt in der Mittagssonne: Markt mit Torbögen, Lehmhäuser mit Dachterrassen, Teich und Ruine.', build: mapOase, ground: 'sand' },
];
const worldCache = new Map();
function buildWorld(id) {
  if (!worldCache.has(id)) {
    const W = worldBuilder(), def = MAPS.find((m) => m.id === id) || MAPS[0];
    W.ground = def.ground || 'concrete';
    def.build(W);
    worldCache.set(id, W.finish());
  }
  return worldCache.get(id);
}

// ==========================================================================
// 6 · Kollision und Wege
// ==========================================================================
const BODY_R = 0.3, STAND_H = 1.8, CROUCH_H = 1.2, EYE_STAND = 1.62, EYE_CROUCH = 1.02, STEP_H = 0.52, GRAVITY = 20;
const RAY = { t: 0, i: -1, axis: 0 };       // letzter Treffer von raycast(): Quader (−2 = Boden), getroffene Achse

function createPhysics(world) {
  const C = world.cols, M = world.colMat, n = world.colCount, END = n * 6, E = 0.001;

  /** Strahl gegen die Welt. Liefert die Entfernung oder Infinity; Einzelheiten stehen in RAY. */
  function raycast(ox, oy, oz, dx, dy, dz, maxT) {
    if (Math.abs(dx) < 1e-9) dx = 1e-9;
    if (Math.abs(dy) < 1e-9) dy = 1e-9;
    if (Math.abs(dz) < 1e-9) dz = 1e-9;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    let best = maxT, bi = -1, bax = 0;
    for (let i = 0, o = 0; i < n; i++, o += 6) {
      let t0 = (C[o] - ox) * ix, t1 = (C[o + 3] - ox) * ix, ax = 0;
      if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
      if (t0 >= best || t1 < 0) continue;
      let a = (C[o + 1] - oy) * iy, b = (C[o + 4] - oy) * iy;
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) { t0 = a; ax = 1; }
      if (b < t1) t1 = b;
      if (t0 > t1) continue;
      a = (C[o + 2] - oz) * iz; b = (C[o + 5] - oz) * iz;
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) { t0 = a; ax = 2; }
      if (b < t1) t1 = b;
      if (t0 > t1 || t0 < 0 || t0 >= best || M[i] === 255) continue;
      best = t0; bi = i; bax = ax;
    }
    if (dy < 0) { const t = -oy / dy; if (t >= 0 && t < best) { best = t; bi = -2; bax = 1; } }
    RAY.t = best; RAY.i = bi; RAY.axis = bax;
    return bi === -1 ? Infinity : best;
  }
  /** Freie Sicht zwischen zwei Punkten? */
  function los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, l = Math.hypot(dx, dy, dz);
    return l < 0.01 || raycast(ax, ay, az, dx / l, dy / l, dz / l, l - 0.02) === Infinity;
  }
  function blocked(x0, y0, z0, x1, y1, z1) {
    for (let o = 0; o < END; o += 6) {
      if (x1 > C[o] + E && x0 < C[o + 3] - E && z1 > C[o + 2] + E && z0 < C[o + 5] - E && y1 > C[o + 1] + E && y0 < C[o + 4] - E) return true;
    }
    return false;
  }
  const bodyBlocked = (x, y, z, r, hh) => y < -E || blocked(x - r, y, z - r, x + r, y + hh, z + r);
  /** Höchste Standfläche unter dem Fußabdruck, die nicht über y liegt (0 = Boden). */
  function floorBelow(x, y, z, r) {
    let f = 0;
    for (let o = 0; o < END; o += 6) {
      if (x + r > C[o] + E && x - r < C[o + 3] - E && z + r > C[o + 2] + E && z - r < C[o + 5] - E) {
        const top = C[o + 4];
        if (top <= y + E && top > f) f = top;
      }
    }
    return f;
  }

  function slide(e, axis, d) {
    if (!d) return;
    const r = e.r, nx = e.x + (axis === 0 ? d : 0), nz = e.z + (axis === 2 ? d : 0);
    const x0 = nx - r, x1 = nx + r, z0 = nz - r, z1 = nz + r, y0 = e.y, y1 = e.y + e.h;
    let top = -1, wall = false, any = false, lim = axis === 0 ? nx : nz;
    for (let o = 0; o < END; o += 6) {
      if (x1 > C[o] + E && x0 < C[o + 3] - E && z1 > C[o + 2] + E && z0 < C[o + 5] - E && y1 > C[o + 1] + E && y0 < C[o + 4] - E) {
        any = true;
        if (C[o + 4] - e.y > STEP_H) wall = true; else if (C[o + 4] > top) top = C[o + 4];
        if (d > 0) lim = Math.min(lim, C[o + axis] - r - 2 * E); else lim = Math.max(lim, C[o + 3 + axis] + r + 2 * E);
      }
    }
    if (!any) { e.x = nx; e.z = nz; return; }
    // Steckt der Körper schon in einem Quader, läge dessen Kante weit hinter ihm: höchstens ein Stück zurückweichen, nie quer über die Karte springen
    const cur = axis === 0 ? e.x : e.z;
    lim = d > 0 ? Math.max(lim, cur - 0.3) : Math.min(lim, cur + 0.3);
    if (!wall && top > e.y && !bodyBlocked(nx, top, nz, r, e.h)) {       // Stufe hinauf
      e.stepOff -= top - e.y; e.y = top; e.x = nx; e.z = nz;
      if (e.vy < 0) e.vy = 0;
      e.ground = true;
      return;
    }
    if (axis === 0) { e.x = lim; e.vx = 0; } else { e.z = lim; e.vz = 0; }
    e.bump = true;
  }

  /** Bewegt einen Körper {x, y, z, r, h, vx, vy, vz, ground, stepOff} um (dx, dy, dz) und löst Kollisionen auf. */
  function moveBody(e, dx, dy, dz) {
    const was = e.ground;
    e.bump = false;
    slide(e, 0, dx);
    slide(e, 2, dz);
    const r = e.r;
    let ny = e.y + dy;
    if (dy <= 0) {
      const f = floorBelow(e.x, e.y, e.z, r);
      if (ny <= f) { ny = f; e.ground = true; if (e.vy < 0) { e.landed = -e.vy; e.vy = 0; } }
      else if (was && e.vy <= 0 && e.y - f <= STEP_H) { e.stepOff += e.y - f; ny = f; e.ground = true; e.vy = 0; }     // Stufe hinab
      else e.ground = false;
    } else {
      e.ground = false;
      const head = e.y + e.h;
      for (let o = 0; o < END; o += 6) {
        if (e.x + r > C[o] + E && e.x - r < C[o + 3] - E && e.z + r > C[o + 2] + E && e.z - r < C[o + 5] - E && C[o + 1] >= head - E && ny + e.h > C[o + 1]) {
          ny = C[o + 1] - e.h; e.vy = 0;
        }
      }
    }
    e.y = ny;
  }

  return { raycast, los, blocked, bodyBlocked, floorBelow, moveBody };
}

/** Wegenetz für die Bots: ein Raster im Meterabstand, je Zelle alle Ebenen, auf denen man stehen kann. */
function buildNav(world, phys) {
  const R = 0.34, bd = world.bounds, C = world.cols, END = world.colCount * 6;
  const x0 = Math.ceil(bd.x0), z0 = Math.ceil(bd.z0), nx = Math.floor(bd.x1) - x0, nz = Math.floor(bd.z1) - z0;
  const X = [], Y = [], Z = [], adj = [], cells = new Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const px = x0 + ix + 0.5, pz = z0 + iz + 0.5, ys = [0], ids = [];
      for (let o = 0; o < END; o += 6) if (px + BODY_R > C[o] && px - BODY_R < C[o + 3] && pz + BODY_R > C[o + 2] && pz - BODY_R < C[o + 5] && C[o + 4] < 6) ys.push(C[o + 4]);
      ys.sort((a, b) => a - b);
      let last = -9;
      for (const y of ys) {
        if (y - last < 0.05 || phys.bodyBlocked(px, y, pz, BODY_R, STAND_H)) continue;
        last = y;
        ids.push(X.length); X.push(px); Y.push(y); Z.push(pz); adj.push([]);
      }
      cells[iz * nx + ix] = ids;
    }
  }
  /** Probegehen: kommt ein Körper geradewegs von A nach B (Stufen bis STEP_H) und landet auf der Höhe von B? */
  function stride(ax, ay, az, bx, by, bz) {
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.17);
    let y = ay;
    for (let i = 1; i <= n; i++) {
      const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t, fl = phys.floorBelow(x, y + STEP_H, z, BODY_R);
      if (y - fl > STEP_H || phys.bodyBlocked(x, fl, z, BODY_R, STAND_H)) return false;
      y = fl;
    }
    return Math.abs(y - by) < 0.06;
  }
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      for (const a of cells[iz * nx + ix]) {
        DIRS.forEach(([dx, dz], di) => {
          const jx = ix + dx, jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) return;
          for (const b of cells[jz * nx + jx]) {
            const dy = Y[b] - Y[a], ym = Math.max(Y[a], Y[b]), mx = (X[a] + X[b]) / 2, mz = (Z[a] + Z[b]) / 2;
            let ok = false;
            if (Math.abs(dy) < 0.02) ok = !phys.bodyBlocked(mx, ym, mz, R, STAND_H) && phys.floorBelow(mx, ym + 0.01, mz, BODY_R) > ym - 0.03;
            else if (Math.abs(dy) <= 1.05) ok = stride(X[a], Y[a], Z[a], X[b], Y[b], Z[b]);          // Treppen, Schwellen
            if (ok && di >= 4) {                    // schräg nur, wenn beide Ecken frei und begehbar sind
              ok = !phys.bodyBlocked(X[b], ym, Z[a], R, STAND_H) && !phys.bodyBlocked(X[a], ym, Z[b], R, STAND_H)
                && phys.floorBelow(X[b], ym + 0.01, Z[a], BODY_R) > ym - 0.75 && phys.floorBelow(X[a], ym + 0.01, Z[b], BODY_R) > ym - 0.75;
            }
            if (ok) adj[a].push(b, (di >= 4 ? 1.414 : 1) + Math.abs(dy));
            else if (dy < -0.5 && dy > -3.3 && di < 4 && !phys.blocked(X[b] - R, Y[b] + 0.01, Z[b] - R, X[b] + R, Y[a] + STAND_H, Z[b] + R)) adj[a].push(b, 2.5 - dy);         // Absprung: nur abwärts
          }
        });
      }
    }
  }
  const N = X.length;
  const cellOf = (x, z) => { const ix = Math.floor(x - x0), iz = Math.floor(z - z0); return ix < 0 || iz < 0 || ix >= nx || iz >= nz ? null : cells[iz * nx + ix]; };
  // Hauptnetz: alles, was vom ersten Startpunkt aus erreichbar ist
  const main = new Uint8Array(N);
  let mainList = [];
  function flood(from) {
    const q = [from];
    main[from] = 1;
    while (q.length) { const a = q.pop(); mainList.push(a); for (let k = 0; k < adj[a].length; k += 2) { const b = adj[a][k]; if (!main[b]) { main[b] = 1; q.push(b); } } }
  }
  function nearest(x, y, z, anyNet = false) {
    let best = -1, bd2 = 1e9;
    for (let r = 0; r <= 3 && (r <= 2 || best < 0); r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        for (const a of cellOf(x + dx, z + dz) || []) {
          if (!anyNet && !main[a]) continue;
          const d = (X[a] - x) ** 2 + (Z[a] - z) ** 2 + ((Y[a] - y) * 2.5) ** 2;
          if (d < bd2) { bd2 = d; best = a; }
        }
      }
    }
    return best;
  }
  const s0 = world.spawns[0][0];
  const start = nearest(s0.x, 0, s0.z, true);
  if (start >= 0) flood(start);

  // A* mit binärem Heap; Markierungen über Stempel, damit nichts zurückgesetzt werden muss
  const g = new Float32Array(N), f = new Float32Array(N), from = new Int32Array(N), seen = new Uint32Array(N), done = new Uint32Array(N);
  let stamp = 0;
  const heap = [];
  const push = (a) => { let i = heap.length; heap.push(a); while (i > 0) { const p = (i - 1) >> 1; if (f[heap[p]] <= f[a]) break; heap[i] = heap[p]; i = p; } heap[i] = a; };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && f[heap[c + 1]] < f[heap[c]]) c++;
        if (f[heap[c]] >= f[last]) break;
        heap[i] = heap[c]; i = c;
      }
      heap[i] = last;
    }
    return top;
  };
  /** Kürzester Weg als Liste von Knoten (ohne den Start) oder null. avoid(a) darf Knoten verteuern. */
  function path(a, b, avoid = null) {
    if (a < 0 || b < 0) return null;
    if (a === b) return [b];
    stamp++;
    heap.length = 0;
    g[a] = 0; f[a] = 0; seen[a] = stamp; from[a] = -1;
    push(a);
    let guard = 0;
    while (heap.length && guard++ < 20000) {
      const cur = pop();
      if (cur === b) {
        const out = [];
        for (let k = b; k !== a; k = from[k]) out.push(k);
        return out.reverse();
      }
      if (done[cur] === stamp) continue;
      done[cur] = stamp;
      const L = adj[cur];
      for (let k = 0; k < L.length; k += 2) {
        const nb = L[k];
        if (done[nb] === stamp) continue;
        const ng = g[cur] + L[k + 1] + (avoid ? avoid(nb) : 0);
        if (seen[nb] === stamp && ng >= g[nb]) continue;
        seen[nb] = stamp; g[nb] = ng; from[nb] = cur;
        f[nb] = ng + Math.hypot(X[nb] - X[b], Z[nb] - Z[b], Y[nb] - Y[b]);
        push(nb);
      }
    }
    return null;
  }
  /** Lässt sich die Strecke geradeaus gehen (keine Wand, keine Kante)? */
  function walkable(ax, ay, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az), steps = Math.ceil(d / 0.4);
    let y = ay;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const fl = phys.floorBelow(x, y + STEP_H + 0.01, z, BODY_R);
      if (Math.abs(fl - y) > STEP_H || phys.bodyBlocked(x, fl, z, BODY_R, STAND_H)) return false;
      y = fl;
    }
    return true;
  }
  return { X, Y, Z, N, main, mainList, nearest, path, walkable, random: () => mainList[(Math.random() * mainList.length) | 0] };
}

// ==========================================================================
// 7 · Waffen
// ==========================================================================
// Farben der Modelle: [r, g, b, Art]
const GUN = {
  m: [0.02, 0.021, 0.024, K_METAL], d: [0.008, 0.008, 0.01, K_MATTE], p: [0.03, 0.032, 0.03, K_MATTE], o: [0.065, 0.08, 0.042, K_MATTE],
  t: [0.2, 0.155, 0.09, K_MATTE], w: [0.085, 0.045, 0.022, K_MATTE], s: [0.4, 0.42, 0.45, K_METAL], g: [1, 0.2, 0.1, K_GLOW], l: [0.3, 0.55, 0.9, K_GLOW],
};
// Modellteile: [x, y, z, Breite, Höhe, Länge, Farbe, Neigung]. Ursprung am Griff, −z zeigt zur Mündung.
// stats: dmg/dmgFar zwischen r0 und r1 Metern, hip/adsSpr Streuung in Grad, kickV/kickH Rückstoß in Grad, ads Sekunden bis zum Anlegen
const WEAPONS = {
  falke: {
    name: 'AR-7 Falke', type: 'Sturmgewehr', about: 'Ausgewogen auf jede Entfernung.', level: 1, slot: 0, auto: true, snd: 'rifle',
    rpm: 690, dmg: 30, dmgFar: 21, r0: 24, r1: 58, head: 1.5, mag: 30, reserve: 150, reload: 2.1,
    hip: 2.7, adsSpr: 0.1, bloom: 0.3, kickV: 0.82, kickH: 0.36, ads: 0.24, zoom: 1.4, move: 0.96, pellets: 1,
    sight: 0.112, muzzle: [0, 0.035, -0.78], hold: [0.15, -0.165, -0.5], adsZ: -0.28, stats: [62, 58, 66, 64],
    model: [
      [0, 0.03, -0.1, 0.05, 0.085, 0.34, 'm'], [0, 0.03, -0.4, 0.05, 0.07, 0.26, 'o'], [0, 0.035, -0.63, 0.02, 0.02, 0.22, 'm'],
      [0, 0.035, -0.755, 0.032, 0.032, 0.05, 'd'], [0, 0.025, 0.17, 0.04, 0.08, 0.2, 'o'], [0, 0.005, 0.285, 0.046, 0.13, 0.03, 'd'],
      [0, -0.065, 0.025, 0.036, 0.11, 0.05, 'p', -0.3], [0, -0.1, -0.13, 0.03, 0.16, 0.065, 'm', 0.14],
      [0, 0.085, -0.02, 0.012, 0.03, 0.012, 'd'], [0.016, 0.095, 0.02, 0.008, 0.036, 0.02, 'd'], [-0.016, 0.095, 0.02, 0.008, 0.036, 0.02, 'd'],
      [0, 0.09, -0.5, 0.008, 0.045, 0.012, 'd'], [0, 0.078, -0.18, 0.03, 0.012, 0.3, 'd'],
    ],
  },
  wespe: {
    name: 'MP-9 Wespe', type: 'Maschinenpistole', about: 'Schnell, wendig, stark auf kurze Entfernung.', level: 1, slot: 0, auto: true, snd: 'smg',
    rpm: 880, dmg: 24, dmgFar: 14, r0: 11, r1: 30, head: 1.4, mag: 32, reserve: 160, reload: 1.7,
    hip: 1.9, adsSpr: 0.22, bloom: 0.24, kickV: 0.62, kickH: 0.44, ads: 0.17, zoom: 1.25, move: 1.04, pellets: 1,
    sight: 0.1, muzzle: [0, 0.03, -0.42], hold: [0.14, -0.16, -0.46], adsZ: -0.27, stats: [48, 82, 38, 88],
    model: [
      [0, 0.03, -0.06, 0.046, 0.08, 0.26, 'm'], [0, 0.03, -0.26, 0.04, 0.052, 0.14, 'p'], [0, 0.03, -0.37, 0.018, 0.018, 0.09, 'd'],
      [0, -0.065, 0.03, 0.034, 0.11, 0.048, 'p', -0.28], [0, -0.12, -0.1, 0.026, 0.2, 0.042, 'm'], [0, 0.05, 0.16, 0.02, 0.02, 0.2, 'd'],
      [0, 0.02, 0.265, 0.034, 0.09, 0.02, 'd'], [0.014, 0.085, 0.03, 0.007, 0.03, 0.016, 'd'], [-0.014, 0.085, 0.03, 0.007, 0.03, 0.016, 'd'],
      [0, 0.082, -0.3, 0.007, 0.036, 0.01, 'd'], [0, 0.074, -0.1, 0.026, 0.01, 0.18, 'd'],
    ],
  },
  rammbock: {
    name: 'M12 Rammbock', type: 'Schrotflinte', about: 'Acht Schrote je Schuss – auf wenige Meter tödlich.', level: 2, slot: 0, auto: false, snd: 'shotgun',
    rpm: 72, dmg: 17, dmgFar: 4, r0: 7, r1: 22, head: 1.2, mag: 6, reserve: 30, reload: 0.52, shells: true,
    hip: 5.2, adsSpr: 4.1, bloom: 0, kickV: 4.2, kickH: 1.1, ads: 0.26, zoom: 1.2, move: 0.94, pellets: 8,
    sight: 0.075, muzzle: [0, 0.04, -0.74], hold: [0.15, -0.16, -0.48], adsZ: -0.38, stats: [92, 22, 24, 60],
    model: [
      [0, 0.04, -0.42, 0.028, 0.028, 0.62, 'm'], [0, 0.008, -0.36, 0.024, 0.024, 0.46, 'm'], [0, 0.006, -0.36, 0.046, 0.046, 0.16, 'w'],
      [0, 0.025, -0.04, 0.046, 0.078, 0.22, 'm'], [0, 0, 0.19, 0.04, 0.085, 0.24, 'w', 0.16], [0, -0.03, 0.31, 0.044, 0.12, 0.03, 'd'],
      [0, -0.05, 0.045, 0.034, 0.07, 0.05, 'w', -0.5], [0, 0.066, -0.72, 0.008, 0.02, 0.008, 's'],
    ],
  },
  luchs: {
    name: 'SG-4 Luchs', type: 'Selbstladegewehr', about: 'Ein Schuss je Abzug. Zwei Treffer genügen.', level: 4, slot: 0, auto: false, snd: 'dmr',
    rpm: 290, dmg: 52, dmgFar: 44, r0: 38, r1: 80, head: 2, mag: 12, reserve: 60, reload: 2.3,
    hip: 3.6, adsSpr: 0.04, bloom: 0.5, kickV: 1.9, kickH: 0.5, ads: 0.3, zoom: 2.4, move: 0.93, pellets: 1,
    sight: 0.128, muzzle: [0, 0.035, -0.88], hold: [0.15, -0.165, -0.5], adsZ: -0.2, stats: [78, 36, 84, 52], optic: true,
    model: [
      [0, 0.03, -0.1, 0.05, 0.08, 0.36, 'm'], [0, 0.028, -0.42, 0.046, 0.06, 0.3, 't'], [0, 0.035, -0.7, 0.02, 0.02, 0.3, 'm'],
      [0, 0.035, -0.86, 0.03, 0.03, 0.045, 'd'], [0, 0.015, 0.18, 0.042, 0.085, 0.24, 't'], [0, -0.005, 0.305, 0.046, 0.13, 0.03, 'd'],
      [0, -0.065, 0.025, 0.036, 0.11, 0.05, 'p', -0.3], [0, -0.07, -0.13, 0.03, 0.1, 0.07, 'm'],
      [-0.021, 0.128, -0.14, 0.006, 0.048, 0.1, 'd'], [0.021, 0.128, -0.14, 0.006, 0.048, 0.1, 'd'], [0, 0.149, -0.14, 0.048, 0.006, 0.1, 'd'],
      [0, 0.107, -0.14, 0.048, 0.006, 0.1, 'd'], [0, 0.088, -0.14, 0.018, 0.034, 0.06, 'd'],
    ],
  },
  habicht: {
    name: 'SR-90 Habicht', type: 'Scharfschützengewehr', about: 'Zielfernrohr, ein Treffer in den Oberkörper genügt.', level: 6, slot: 0, auto: false, snd: 'sniper',
    rpm: 44, dmg: 115, dmgFar: 105, r0: 60, r1: 120, head: 2, mag: 5, reserve: 30, reload: 2.9,
    hip: 6.5, adsSpr: 0, bloom: 0, kickV: 3.4, kickH: 0.7, ads: 0.38, zoom: 5.5, move: 0.9, pellets: 1, scope: true,
    sight: 0.108, muzzle: [0, 0.035, -1.0], hold: [0.15, -0.165, -0.48], adsZ: -0.1, stats: [98, 10, 96, 40],
    model: [
      [0, 0.03, -0.08, 0.05, 0.07, 0.32, 'm'], [0, 0.035, -0.58, 0.024, 0.024, 0.72, 'm'], [0, 0.035, -0.97, 0.036, 0.036, 0.07, 'd'],
      [0, 0.005, 0.2, 0.046, 0.1, 0.3, 'o'], [0, 0.015, -0.3, 0.05, 0.05, 0.24, 'o'], [0, -0.012, 0.345, 0.05, 0.14, 0.03, 'd'],
      [0, -0.06, 0.03, 0.036, 0.1, 0.05, 'p', -0.3], [0, -0.04, -0.1, 0.03, 0.06, 0.07, 'm'],
      [0, 0.108, -0.08, 0.042, 0.042, 0.3, 'd'], [0, 0.108, -0.25, 0.058, 0.058, 0.06, 'd'], [0, 0.108, 0.085, 0.05, 0.05, 0.05, 'd'],
      [0, 0.075, -0.16, 0.02, 0.03, 0.03, 'd'], [0, 0.075, 0, 0.02, 0.03, 0.03, 'd'],
    ],
  },
  amboss: {
    name: 'MG-5 Amboss', type: 'Maschinengewehr', about: 'Achtzig Schuss im Gurt. Schwer, aber unerbittlich.', level: 8, slot: 0, auto: true, snd: 'lmg',
    rpm: 610, dmg: 33, dmgFar: 26, r0: 30, r1: 70, head: 1.4, mag: 80, reserve: 160, reload: 4.4,
    hip: 3.6, adsSpr: 0.16, bloom: 0.22, kickV: 0.9, kickH: 0.5, ads: 0.4, zoom: 1.4, move: 0.86, pellets: 1,
    sight: 0.118, muzzle: [0, 0.035, -0.86], hold: [0.16, -0.175, -0.5], adsZ: -0.28, stats: [72, 54, 70, 30],
    model: [
      [0, 0.03, -0.1, 0.06, 0.095, 0.4, 'm'], [0, 0.03, -0.44, 0.05, 0.06, 0.28, 'p'], [0, 0.035, -0.7, 0.028, 0.028, 0.28, 'm'],
      [0, 0.035, -0.85, 0.036, 0.036, 0.04, 'd'], [0, 0.02, 0.2, 0.046, 0.09, 0.22, 'p'], [0, 0, 0.32, 0.05, 0.13, 0.03, 'd'],
      [0, -0.068, 0.03, 0.036, 0.11, 0.05, 'p', -0.3], [-0.01, -0.085, -0.14, 0.1, 0.12, 0.12, 'o'], [0, 0.095, -0.14, 0.02, 0.03, 0.2, 'd'],
      [0.016, 0.102, 0.03, 0.008, 0.034, 0.02, 'd'], [-0.016, 0.102, 0.03, 0.008, 0.034, 0.02, 'd'], [0, 0.098, -0.56, 0.008, 0.044, 0.012, 'd'],
      [0.03, -0.03, -0.6, 0.012, 0.012, 0.2, 'd'], [-0.03, -0.03, -0.6, 0.012, 0.012, 0.2, 'd'],
    ],
  },
  marder: {
    name: 'P9 Marder', type: 'Pistole', about: 'Die Zweitwaffe: zieht schnell, trifft sauber.', level: 1, slot: 1, auto: false, snd: 'pistol',
    rpm: 420, dmg: 34, dmgFar: 20, r0: 12, r1: 32, head: 1.5, mag: 12, reserve: 48, reload: 1.4,
    hip: 1.7, adsSpr: 0.2, bloom: 0.5, kickV: 1.5, kickH: 0.4, ads: 0.14, zoom: 1.18, move: 1.06, pellets: 1,
    sight: 0.066, muzzle: [0, 0.04, -0.17], hold: [0.12, -0.14, -0.5], adsZ: -0.36, stats: [44, 40, 36, 96], oneHand: true,
    model: [
      [0, 0.04, -0.06, 0.03, 0.04, 0.2, 'm'], [0, 0.012, -0.045, 0.028, 0.026, 0.15, 'p'], [0, -0.05, 0.02, 0.03, 0.1, 0.046, 'p', -0.22],
      [0.01, 0.066, 0.03, 0.006, 0.014, 0.01, 'd'], [-0.01, 0.066, 0.03, 0.006, 0.014, 0.01, 'd'], [0, 0.066, -0.15, 0.006, 0.014, 0.008, 'd'],
    ],
  },
};
const PRIMARIES = ['falke', 'wespe', 'rammbock', 'luchs', 'habicht', 'amboss'];
const KNIFE = [[0, 0.02, -0.16, 0.006, 0.034, 0.19, 's'], [0, 0.02, -0.05, 0.03, 0.012, 0.012, 'd'], [0, 0.02, 0.01, 0.024, 0.03, 0.11, 'd']];
const NADE = { fuse: 2.7, radius: 6.8, dmg: 165, speed: 16.5, count: 2 };
const MELEE = { range: 2.3, dmg: 100, time: 0.62 };

const RANKS = ['Rekrut', 'Gefreiter', 'Obergefreiter', 'Stabsgefreiter', 'Unteroffizier', 'Stabsunteroffizier', 'Feldwebel', 'Oberfeldwebel', 'Hauptfeldwebel',
  'Stabsfeldwebel', 'Leutnant', 'Oberleutnant', 'Hauptmann', 'Stabshauptmann', 'Major', 'Oberstleutnant', 'Oberst', 'Brigadegeneral', 'Generalmajor', 'General'];
const MAX_LEVEL = 40;
/** Erfahrungspunkte, die für eine Stufe insgesamt nötig sind (Stufe 1 = 0). */
const xpFor = (level) => Math.round(250 * (level - 1) * (1 + (level - 1) * 0.22));
const levelOf = (xp) => { let l = 1; while (l < MAX_LEVEL && xp >= xpFor(l + 1)) l++; return l; };
const rankOf = (level) => RANKS[Math.min(RANKS.length - 1, Math.floor((level - 1) / 2))];

const BOT_NAMES = ['Brandt', 'Keller', 'Vogel', 'Kraus', 'Wolff', 'Lang', 'Busch', 'Hahn', 'Schuster', 'Krüger', 'Lorenz', 'Jäger', 'Stark', 'Winter', 'Kühn',
  'Dietrich', 'Roth', 'Albrecht', 'Falk', 'Hartmann', 'Voss', 'Reuter', 'Engel', 'Sturm', 'Berg', 'Haas', 'Seidel', 'Kern', 'Nowak', 'Petrov', 'Marek', 'Ilic'];
const SKILLS = [
  { name: 'Rekrut', react: 0.62, err: 4.6, turn: 4.5, dmg: 0.55, burst: 0.6, about: 'Gegner reagieren langsam und treffen selten.' },
  { name: 'Soldat', react: 0.4, err: 2.9, turn: 6.5, dmg: 0.8, burst: 0.8, about: 'Ein fairer Kampf.' },
  { name: 'Veteran', react: 0.24, err: 1.7, turn: 9, dmg: 1, burst: 1, about: 'Gegner zielen schnell und genau.' },
];
const MODES = {
  tdm: { name: 'Team-Deathmatch', about: 'Zwei Teams. Jeder Abschuss zählt für dein Team.', limits: [50, 75, 100, 150], teams: true },
  ffa: { name: 'Frei für alle', about: 'Jeder gegen jeden. Wer zuerst die Abschüsse hat, gewinnt.', limits: [20, 30, 50], teams: false },
  dom: { name: 'Herrschaft', about: 'Erobert die Stellungen A, B und C und haltet sie.', limits: [100, 150, 200], teams: true },
};

// ==========================================================================
// 8 · Klang: alles wird im Augenblick erzeugt (Rauschen, Filter, ein paar Schwinger)
// ==========================================================================
const SHOT_SND = {
  rifle: { cut: 5200, dur: 0.2, noise: 0.85, f: 170, body: 0.6, rate: 1 },
  smg: { cut: 6500, dur: 0.13, noise: 0.7, f: 230, body: 0.4, rate: 1.3 },
  shotgun: { cut: 3000, dur: 0.4, noise: 1.1, f: 105, body: 1, rate: 0.75 },
  dmr: { cut: 4600, dur: 0.28, noise: 1, f: 150, body: 0.8, rate: 0.88 },
  sniper: { cut: 4000, dur: 0.55, noise: 1.2, f: 92, body: 1.1, rate: 0.7 },
  lmg: { cut: 4200, dur: 0.24, noise: 0.95, f: 135, body: 0.8, rate: 0.9 },
  pistol: { cut: 5600, dur: 0.15, noise: 0.7, f: 250, body: 0.45, rate: 1.2 },
};

function createSound(getVolume) {
  let out = null, noiseBuf = null, ctx = null, shots = 0, shotsAt = 0, gone = false;
  const ok = () => !gone && sfx.enabled && audioReady() && getVolume() > 0;
  function chain(pan = 0, vol = 1) {
    const a = audio();
    ctx = a.ctx;
    if (!out) { out = ctx.createGain(); out.connect(a.out); }
    out.gain.value = getVolume();
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const g = ctx.createGain();
    g.gain.value = vol;
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); p.connect(out); } else g.connect(out);
    return g;
  }
  /** Rauschstoß durch einen Filter. */
  function burst(dest, { type = 'lowpass', f = 2000, f2 = 0, q = 0.7, dur = 0.1, vol = 0.5, rate = 1, when = 0, attack = 0.001 }) {
    const t = ctx.currentTime + when, src = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf; src.loop = true; src.playbackRate.value = rate;
    fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(fl); fl.connect(g); g.connect(dest);
    src.start(t, Math.random() * 0.8); src.stop(t + dur + 0.03);
  }
  function osc(dest, { type = 'sine', f = 440, f2 = 0, dur = 0.1, vol = 0.3, when = 0, attack = 0.003 }) {
    const t = ctx.currentTime + when, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.03);
  }
  /** Lautstärke und Stereo-Lage eines Geräuschs in der Welt, vom Hörer aus. */
  function place(L, x, y, z, reach) {
    const dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, y - L.y, dz);
    if (d > reach) return null;
    const vol = 1 / (1 + (d / (reach * 0.16)) ** 2);
    const side = d < 0.5 ? 0 : (dx * Math.cos(L.yaw) + dz * Math.sin(L.yaw)) / d;
    return { vol: vol * (1 - d / reach * 0.4), pan: side * 0.85, far: clamp(d / reach, 0, 1) };
  }
  const S = {
    /** Schuss. L = Hörer {x, y, z, yaw}; own = die eigene Waffe (voll, mit Nachhall). */
    shot(kind, L, x, y, z, own = false) {
      if (!ok()) return;
      const p = SHOT_SND[kind] || SHOT_SND.rifle;
      let pl = { vol: 1, pan: 0, far: 0 };
      if (!own) {
        pl = place(L, x, y, z, 110);
        if (!pl) return;
        const now = performance.now();
        if (now - shotsAt > 100) { shotsAt = now; shots = 0; }
        if (++shots > 3) return;                    // dichtes Feuergefecht: nicht jeden Schuss einzeln
      }
      const g = chain(pl.pan, (own ? 0.5 : 0.42) * pl.vol);
      const cut = p.cut * (1 - pl.far * 0.75);
      burst(g, { f: cut, f2: Math.max(200, cut * 0.14), dur: p.dur * (1 + pl.far), vol: p.noise, rate: p.rate });
      osc(g, { type: 'triangle', f: p.f, f2: p.f * 0.32, dur: p.dur * 0.7, vol: p.body });
      if (pl.far < 0.5) burst(g, { type: 'highpass', f: 3500, dur: 0.035, vol: 0.4 * (1 - pl.far * 2) });
      if (own || pl.far < 0.3) burst(g, { f: 900, f2: 240, dur: 0.5 + p.dur, vol: p.noise * 0.14, attack: 0.03, rate: 0.6 });
    },
    explosion(L, x, y, z) {
      if (!ok()) return;
      const pl = place(L, x, y, z, 140);
      if (!pl) return;
      const g = chain(pl.pan, 0.9 * pl.vol);
      burst(g, { f: 1800 * (1 - pl.far * 0.6), f2: 90, dur: 1.1, vol: 1.3, rate: 0.5 });
      osc(g, { f: 82, f2: 30, dur: 0.75, vol: 1.3 });
      burst(g, { type: 'highpass', f: 2200, dur: 0.07, vol: 0.5 });
      burst(g, { f: 500, f2: 120, dur: 2, vol: 0.22, attack: 0.1, rate: 0.4 });
    },
    impact(L, x, y, z, kind) {
      if (!ok()) return;
      const pl = place(L, x, y, z, 26);
      if (!pl) return;
      const g = chain(pl.pan, 0.28 * pl.vol);
      if (kind === 'metal') { osc(g, { type: 'square', f: rnd(1500, 2600), f2: 900, dur: 0.07, vol: 0.2 }); burst(g, { type: 'bandpass', f: 4200, q: 4, dur: 0.05, vol: 0.5 }); }
      else if (kind === 'wood') burst(g, { type: 'bandpass', f: 700, q: 2, dur: 0.07, vol: 0.9 });
      else if (kind === 'body') burst(g, { f: 500, dur: 0.08, vol: 0.9 });
      else burst(g, { type: 'bandpass', f: rnd(1400, 2200), q: 1.2, dur: 0.06, vol: 0.8 });
    },
    step(L, x, y, z, own, loud = 1) {
      if (!ok()) return;
      const pl = own ? { vol: 1, pan: 0 } : place(L, x, y, z, 18);
      if (!pl) return;
      const g = chain(pl.pan, (own ? 0.1 : 0.16) * pl.vol * loud);
      burst(g, { f: rnd(260, 420), f2: 110, dur: 0.09, vol: 1, rate: 0.7 });
      burst(g, { type: 'bandpass', f: rnd(1800, 2600), q: 1.5, dur: 0.03, vol: 0.2 });
    },
    land() { if (ok()) { const g = chain(0, 0.3); burst(g, { f: 300, f2: 80, dur: 0.16, vol: 1, rate: 0.6 }); osc(g, { f: 90, f2: 45, dur: 0.14, vol: 0.5 }); } },
    reload(part) {
      if (!ok()) return;
      const g = chain(0.1, 0.3);
      if (part === 'out') { burst(g, { type: 'bandpass', f: 1900, q: 3, dur: 0.05, vol: 0.9 }); osc(g, { type: 'square', f: 420, f2: 210, dur: 0.05, vol: 0.12 }); }
      else if (part === 'in') { burst(g, { type: 'bandpass', f: 1300, q: 2.5, dur: 0.07, vol: 1 }); osc(g, { type: 'square', f: 260, f2: 150, dur: 0.07, vol: 0.2 }); }
      else if (part === 'shell') { burst(g, { type: 'bandpass', f: 1500, q: 3, dur: 0.05, vol: 0.8 }); osc(g, { type: 'triangle', f: 520, f2: 300, dur: 0.05, vol: 0.2 }); }
      else { burst(g, { type: 'bandpass', f: 2600, q: 4, dur: 0.04, vol: 0.9 }); burst(g, { type: 'bandpass', f: 1700, q: 4, dur: 0.05, vol: 0.9, when: 0.09 }); }
    },
    dry() { if (ok()) burst(chain(0, 0.2), { type: 'bandpass', f: 3200, q: 5, dur: 0.03, vol: 0.9 }); },
    swap() { if (ok()) burst(chain(0, 0.14), { type: 'bandpass', f: 900, q: 0.8, dur: 0.16, vol: 0.9, attack: 0.05 }); },
    swing() { if (ok()) burst(chain(0, 0.25), { type: 'bandpass', f: 1200, f2: 3200, q: 1.2, dur: 0.16, vol: 0.9, attack: 0.04 }); },
    hit(head, kill) {
      if (!ok()) return;
      const g = chain(0, 0.34);
      burst(g, { type: 'bandpass', f: head ? 3600 : 2500, q: 6, dur: 0.045, vol: 1 });
      osc(g, { type: 'triangle', f: head ? 1900 : 1300, dur: 0.05, vol: 0.3 });
      if (kill) { osc(g, { f: 880, dur: 0.12, vol: 0.28, when: 0.05 }); osc(g, { f: 1318, dur: 0.2, vol: 0.26, when: 0.12 }); }
    },
    hurt() { if (ok()) { const g = chain(0, 0.4); burst(g, { f: 420, f2: 120, dur: 0.14, vol: 1 }); osc(g, { f: 120, f2: 60, dur: 0.13, vol: 0.6 }); } },
    whiz(pan) { if (ok()) burst(chain(pan, 0.2), { type: 'bandpass', f: 2800, f2: 900, q: 3, dur: 0.11, vol: 0.9, attack: 0.02 }); },
    bounce(L, x, y, z) { const pl = ok() && place(L, x, y, z, 30); if (pl) osc(chain(pl.pan, 0.2 * pl.vol), { type: 'triangle', f: rnd(900, 1300), f2: 500, dur: 0.06, vol: 0.6 }); },
    pin() { if (ok()) { const g = chain(0, 0.25); osc(g, { type: 'square', f: 2400, f2: 1600, dur: 0.03, vol: 0.3 }); burst(g, { type: 'bandpass', f: 800, q: 1, dur: 0.2, vol: 0.5, when: 0.06, attack: 0.06 }); } },
    ui(kind = 'tick') {
      if (!ok()) return;
      const g = chain(0, 0.22);
      if (kind === 'tick') osc(g, { type: 'triangle', f: 1500, f2: 1100, dur: 0.03, vol: 0.25 });
      else if (kind === 'ok') { osc(g, { f: 620, f2: 930, dur: 0.09, vol: 0.4 }); }
      else if (kind === 'back') osc(g, { f: 700, f2: 420, dur: 0.09, vol: 0.35 });
      else if (kind === 'beep') osc(g, { type: 'square', f: 880, dur: 0.09, vol: 0.14 });
      else if (kind === 'go') { osc(g, { type: 'square', f: 1320, dur: 0.3, vol: 0.14 }); }
    },
    /** Kurze Tonfolgen für Ereignisse */
    jingle(kind) {
      if (!ok()) return;
      const g = chain(0, 0.3);
      const seq = {
        win: [[392, 0], [523, 0.14], [659, 0.28], [784, 0.42], [1046, 0.62]],
        lose: [[392, 0], [349, 0.2], [311, 0.4], [261, 0.62]],
        level: [[523, 0], [659, 0.1], [784, 0.2], [1046, 0.32], [1318, 0.46]],
        streak: [[659, 0], [988, 0.1]],
        uav: [[1175, 0], [1175, 0.16], [1568, 0.32]],
        capture: [[523, 0], [784, 0.12]],
        lost: [[523, 0], [370, 0.14]],
        medal: [[880, 0], [1175, 0.08]],
      }[kind] || [];
      seq.forEach(([f, when], i) => {
        osc(g, { type: 'triangle', f, dur: i === seq.length - 1 ? 0.6 : 0.24, vol: 0.4, when, attack: 0.01 });
        osc(g, { f: f * 2, dur: 0.2, vol: 0.08, when, attack: 0.01 });
      });
    },
    /** App geschlossen: nichts mehr spielen, den eigenen Ausgang abhängen (was schon klingt, klingt kurz aus). */
    dispose() {
      gone = true;
      const o = out;
      out = null;
      if (o) setTimeout(() => { try { o.disconnect(); } catch { /* schon ab */ } }, 2500);
    },
  };
  return S;
}

// ==========================================================================
// 9 · Spiel
// ==========================================================================
// ---------- 9a · Effekte: Funken, Staub, Leuchtspuren, Einschusslöcher, Lichtblitze ----------
function createFx() {
  const quads = new Float32Array(MAX_QUADS * 4 * QSTRIDE);
  const parts = [], tracers = [], decals = [], lights = [];
  let qn = 0, rx = 1, ry = 0, rz = 0, ux = 0, uy = 1, uz = 0, cx = 0, cy = 0, cz = 0;

  function corner(o, x, y, z, u, v, r, g, b, a, k) {
    quads[o] = x; quads[o + 1] = y; quads[o + 2] = z; quads[o + 3] = u; quads[o + 4] = v;
    quads[o + 5] = r; quads[o + 6] = g; quads[o + 7] = b; quads[o + 8] = a; quads[o + 9] = k;
  }
  /** Viereck aus Mittelpunkt und zwei Halbachsen */
  function quad(x, y, z, ax, ay, az, bx, by, bz, r, g, b, a, k) {
    if (qn >= MAX_QUADS) return;
    const o = qn++ * 4 * QSTRIDE;
    corner(o, x - ax - bx, y - ay - by, z - az - bz, 0, 0, r, g, b, a, k);
    corner(o + QSTRIDE, x + ax - bx, y + ay - by, z + az - bz, 1, 0, r, g, b, a, k);
    corner(o + 2 * QSTRIDE, x + ax + bx, y + ay + by, z + az + bz, 1, 1, r, g, b, a, k);
    corner(o + 3 * QSTRIDE, x - ax + bx, y - ay + by, z - az + bz, 0, 1, r, g, b, a, k);
  }
  /** Zur Kamera gedrehtes Viereck */
  function bill(x, y, z, s, r, g, b, a, k, rot = 0) {
    const c = Math.cos(rot) * s, sn = Math.sin(rot) * s;
    quad(x, y, z, rx * c + ux * sn, ry * c + uy * sn, rz * c + uz * sn, ux * c - rx * sn, uy * c - ry * sn, uz * c - rz * sn, r, g, b, a, k);
  }
  function puff(x, y, z, vx, vy, vz, o) {
    if (parts.length > 520) parts.shift();
    parts.push({ x, y, z, vx, vy, vz, life: o.life, max: o.life, s: o.s, grow: o.grow || 0, r: o.c[0], g: o.c[1], b: o.c[2], a: o.a ?? 1, k: o.k, grav: o.grav || 0, drag: o.drag || 0, rot: Math.random() * TAU });
  }
  const DUST = { concrete: [0.62, 0.6, 0.57], sand: [0.72, 0.6, 0.42], wood: [0.5, 0.36, 0.2], cloth: [0.7, 0.7, 0.7], metal: [0.45, 0.45, 0.47] };

  const F = {
    quads, lights,
    light(x, y, z, r, col, life) { if (lights.length > 5) lights.shift(); lights.push({ x, y, z, r, c: col, life, max: life }); },
    tracer(x0, y0, z0, x1, y1, z1, thin) {
      const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      if (len < 1.5) return;
      if (tracers.length > 60) tracers.shift();
      tracers.push({ x0, y0, z0, x1, y1, z1, len, t: 0, dur: Math.max(0.035, len / 300), w: thin ? 0.018 : 0.03 });
    },
    /** Einschlag in die Welt: Loch, Staub oder Funken. axis/sign beschreiben die getroffene Fläche. */
    impact(x, y, z, axis, sign, kind) {
      if (decals.length > 170) decals.shift();
      decals.push({ x, y, z, axis, sign, s: rnd(0.014, 0.022), life: 40, k: Q_DECAL, c: 0.035 });
      const n = [0, 0, 0];
      n[axis] = sign;
      const col = DUST[kind] || DUST.concrete;
      if (kind === 'metal') {
        for (let i = 0; i < 5; i++) puff(x, y, z, n[0] * rnd(2, 6) + rnd(-2, 2), n[1] * rnd(2, 6) + rnd(-1, 3), n[2] * rnd(2, 6) + rnd(-2, 2), { life: rnd(0.12, 0.3), s: 0.025, c: [1, 0.75, 0.35], k: Q_GLOW, grav: 12 });
        puff(x + n[0] * 0.03, y + n[1] * 0.03, z + n[2] * 0.03, 0, 0, 0, { life: 0.06, s: 0.22, c: [1, 0.8, 0.5], k: Q_GLOW });
      }
      for (let i = 0; i < 3; i++) puff(x + n[0] * 0.05, y + n[1] * 0.05, z + n[2] * 0.05, n[0] * rnd(0.6, 2) + rnd(-0.5, 0.5), n[1] * rnd(0.6, 2) + rnd(-0.2, 0.9), n[2] * rnd(0.6, 2) + rnd(-0.5, 0.5),
        { life: rnd(0.35, 0.7), s: rnd(0.05, 0.09), grow: rnd(0.5, 0.9), c: col, a: kind === 'metal' ? 0.25 : 0.55, k: Q_DUST, drag: 3, grav: -0.3 });
    },
    /** Treffer an einer Figur */
    flesh(x, y, z, dx, dy, dz) {
      for (let i = 0; i < 3; i++) puff(x, y, z, -dx * rnd(0.5, 1.6) + rnd(-0.7, 0.7), rnd(-0.2, 0.9), -dz * rnd(0.5, 1.6) + rnd(-0.7, 0.7), { life: rnd(0.2, 0.4), s: rnd(0.04, 0.07), grow: 0.5, c: [0.36, 0.05, 0.04], a: 0.8, k: Q_DUST, drag: 4, grav: 2 });
    },
    explosion(x, y, z) {
      F.light(x, y + 0.6, z, 18, [5, 3.2, 1.6], 0.4);
      puff(x, y + 0.5, z, 0, 0, 0, { life: 0.14, s: 4.5, c: [1, 0.85, 0.6], k: Q_GLOW });
      for (let i = 0; i < 9; i++) puff(x + rnd(-0.6, 0.6), y + rnd(0.2, 1), z + rnd(-0.6, 0.6), rnd(-2.5, 2.5), rnd(0.5, 4), rnd(-2.5, 2.5), { life: rnd(0.25, 0.45), s: rnd(0.7, 1.2), grow: 3.5, c: [1, 0.5, 0.14], k: Q_GLOW, drag: 3 });
      for (let i = 0; i < 12; i++) puff(x + rnd(-0.8, 0.8), y + rnd(0.2, 1.2), z + rnd(-0.8, 0.8), rnd(-2, 2), rnd(0.8, 3.2), rnd(-2, 2), { life: rnd(1.2, 2.4), s: rnd(0.8, 1.4), grow: 1.5, c: [0.16, 0.15, 0.14], a: 0.75, k: Q_SMOKE, drag: 1.6, grav: -0.5 });
      for (let i = 0; i < 18; i++) puff(x, y + 0.3, z, rnd(-11, 11), rnd(2, 12), rnd(-11, 11), { life: rnd(0.3, 0.8), s: 0.04, c: [1, 0.7, 0.3], k: Q_GLOW, grav: 16, drag: 0.6 });
      for (let i = 0; i < 10; i++) { const a = rnd(TAU); puff(x, y + 0.15, z, Math.cos(a) * rnd(3, 7), rnd(0.2, 1), Math.sin(a) * rnd(3, 7), { life: rnd(0.7, 1.3), s: 0.5, grow: 2.2, c: [0.5, 0.45, 0.38], a: 0.5, k: Q_DUST, drag: 2.6 }); }
      if (y < 0.4) decals.push({ x, y: 0, z, axis: 1, sign: 1, s: rnd(1.5, 2.1), life: 60, k: Q_DECAL, c: 0.015 });
    },
    /** Mündungsfeuer einer fremden Waffe */
    muzzle(x, y, z) { puff(x, y, z, 0, 0, 0, { life: 0.05, s: rnd(0.2, 0.3), c: [1, 0.8, 0.45], k: Q_FLASH }); },
    /** Leuchtende Scheibe am Boden (nur während build(): markiert Stellungen) */
    disc(x, y, z, r, c, a) { quad(x, y, z, r, 0, 0, 0, 0, r, c[0], c[1], c[2], a, Q_GLOW + Q_FLAT); },
    /** Rauchfaden an der Mündung nach langem Feuer */
    wisp(x, y, z) { puff(x, y, z, rnd(-0.2, 0.2), rnd(0.3, 0.7), rnd(-0.2, 0.2), { life: rnd(0.5, 0.9), s: 0.05, grow: 0.3, c: [0.7, 0.7, 0.7], a: 0.22, k: Q_SMOKE, drag: 1 }); },

    update(dt) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if ((p.life -= dt) <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
        p.vy -= p.grav * dt;
        if (p.drag) { const k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vy *= k; p.vz *= k; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.y < 0.02 && p.grav > 0) { p.y = 0.02; p.vy *= -0.3; p.vx *= 0.5; p.vz *= 0.5; }
        p.s += p.grow * dt;
      }
      for (let i = tracers.length - 1; i >= 0; i--) if ((tracers[i].t += dt) > tracers[i].dur) tracers.splice(i, 1);
      for (let i = decals.length - 1; i >= 0; i--) if ((decals[i].life -= dt) <= 0) decals.splice(i, 1);
      for (let i = lights.length - 1; i >= 0; i--) if ((lights[i].life -= dt) <= 0) lights.splice(i, 1);
    },
    /** Füllt den Puffer für dieses Bild. Liefert die Zahl der Vierecke. */
    build(cam, extra) {
      qn = 0;
      basis(cam.yaw, cam.pitch, cam.roll || 0);
      rx = B[0]; ry = B[1]; rz = B[2]; ux = B[3]; uy = B[4]; uz = B[5]; cx = cam.x; cy = cam.y; cz = cam.z;
      for (const d of decals) {
        const a = Math.min(1, d.life / 4) * 0.85, o = 0.012 * d.sign, s = d.s;
        if (d.axis === 0) quad(d.x + o, d.y, d.z, 0, 0, s, 0, s, 0, d.c, d.c, d.c, a, d.k);
        else if (d.axis === 1) quad(d.x, d.y + o, d.z, s, 0, 0, 0, 0, s, d.c, d.c, d.c, a, d.k);
        else quad(d.x, d.y, d.z + o, s, 0, 0, 0, s, 0, d.c, d.c, d.c, a, d.k);
      }
      for (const p of parts) if (p.k === Q_SMOKE || p.k === Q_DUST) { const t = p.life / p.max; bill(p.x, p.y, p.z, p.s, p.r, p.g, p.b, p.a * Math.min(1, t * 2), p.k, p.rot); }
      if (extra) extra();
      for (const p of parts) if (p.k === Q_GLOW || p.k === Q_FLASH) { const t = p.life / p.max; bill(p.x, p.y, p.z, p.s, p.r, p.g, p.b, p.a * t, p.k, p.k === Q_FLASH ? p.rot : 0); }
      for (const t of tracers) {
        const k = t.t / t.dur, dx = (t.x1 - t.x0) / t.len, dy = (t.y1 - t.y0) / t.len, dz = (t.z1 - t.z0) / t.len;
        const head = k * t.len, tail = Math.max(0, head - Math.min(10, t.len * 0.5));
        const mx = t.x0 + dx * (head + tail) / 2, my = t.y0 + dy * (head + tail) / 2, mz = t.z0 + dz * (head + tail) / 2;
        // Breite quer zur Blickrichtung
        const vx = cx - mx, vy = cy - my, vz = cz - mz;
        let sx = dy * vz - dz * vy, sy = dz * vx - dx * vz, sz = dx * vy - dy * vx;
        const sl = t.w * (1 + Math.hypot(vx, vy, vz) * 0.03) / (Math.hypot(sx, sy, sz) || 1), hl = (head - tail) / 2;
        sx *= sl; sy *= sl; sz *= sl;
        quad(mx, my, mz, dx * hl, dy * hl, dz * hl, sx, sy, sz, 1, 0.86, 0.55, 0.9, Q_BEAM);
      }
      return qn;
    },
    /** Mündungsfeuer der eigenen Waffe: wird mit der Waffe gezeichnet (hinter den Welt-Effekten im Puffer). */
    flash(x, y, z, size) {
      const before = qn;
      bill(x, y, z, size, 1, 0.82, 0.5, 1, Q_FLASH, Math.random() * TAU);
      bill(x, y, z, size * 1.9, 1, 0.6, 0.25, 0.35, Q_GLOW);
      return qn - before;
    },
    clear() { parts.length = 0; tracers.length = 0; decals.length = 0; lights.length = 0; },
  };
  return F;
}

// ---------- 9b · Figuren und Waffen zeichnen ----------
function instWriter(max) {
  const buf = new Float32Array(max * ISTRIDE);
  let n = 0;
  return {
    buf,
    get count() { return n; },
    reset() { n = 0; },
    /** Quader um den Ursprung der Matrix M mit den Kantenlängen sx, sy, sz; col = [r, g, b, Art] */
    box(M, sx, sy, sz, col) {
      if (n >= max) return;
      const o = n++ * ISTRIDE;
      buf[o] = M[0] * sx; buf[o + 1] = M[1] * sx; buf[o + 2] = M[2] * sx; buf[o + 3] = 0;
      buf[o + 4] = M[4] * sy; buf[o + 5] = M[5] * sy; buf[o + 6] = M[6] * sy; buf[o + 7] = 0;
      buf[o + 8] = M[8] * sz; buf[o + 9] = M[9] * sz; buf[o + 10] = M[10] * sz; buf[o + 11] = 0;
      buf[o + 12] = M[12]; buf[o + 13] = M[13]; buf[o + 14] = M[14]; buf[o + 15] = 1;
      buf[o + 16] = col[0]; buf[o + 17] = col[1]; buf[o + 18] = col[2]; buf[o + 19] = col[3];
    },
  };
}
const TM = mat4(), TA = mat4(), TB = mat4(), TG = mat4(), TR = mat4();
function part(I, M, x, y, z, sx, sy, sz, col, rx = 0, ry = 0, rz = 0) {
  mCopy(TM, M); mTrans(TM, x, y, z);
  if (ry) mRotY(TM, ry);
  if (rx) mRotX(TM, rx);
  if (rz) mRotZ(TM, rz);
  I.box(TM, sx, sy, sz, col);
}
/** Stab von A nach B (Arm, Bein) */
function limb(I, M, ax, ay, az, bx, by, bz, thick, col) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, l = Math.hypot(dx, dy, dz) || 0.001;
  mCopy(TM, M); mTrans(TM, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  mRotY(TM, Math.atan2(dx, dz)); mRotX(TM, -Math.asin(clamp(dy / l, -1, 1)));
  I.box(TM, thick, thick, l + thick * 0.5, col);
}
function arm(I, M, sx, sy, sz, hx, hy, hz, pal, out, drop = 0.12) {
  const ex = (sx + hx) / 2 + out * 0.07, ey = (sy + hy) / 2 - drop, ez = (sz + hz) / 2 + 0.03;
  limb(I, M, sx, sy, sz, ex, ey, ez, 0.1, pal.cloth);
  limb(I, M, ex, ey, ez, hx, hy, hz, 0.085, pal.cloth);
  part(I, M, hx, hy, hz, 0.07, 0.075, 0.09, pal.glove);
}
function drawGun(I, M, model) { for (const p of model) part(I, M, p[0], p[1], p[2], p[3], p[4], p[5], GUN[p[6]], p[7] || 0); }

const PAL = {
  friend: { cloth: [0.075, 0.1, 0.055, K_CAMO], vest: [0.028, 0.032, 0.028, K_MATTE], helm: [0.06, 0.08, 0.045, K_CAMO], mark: [0.08, 0.36, 1, K_GLOW], skin: [0.42, 0.26, 0.18, K_MATTE], boot: [0.012, 0.012, 0.012, K_MATTE], glove: [0.02, 0.02, 0.02, K_MATTE] },
  foe: { cloth: [0.23, 0.17, 0.095, K_CAMO], vest: [0.085, 0.03, 0.022, K_MATTE], helm: [0.16, 0.12, 0.07, K_CAMO], mark: [1, 0.1, 0.05, K_GLOW], skin: [0.42, 0.26, 0.18, K_MATTE], boot: [0.02, 0.015, 0.012, K_MATTE], glove: [0.035, 0.026, 0.018, K_MATTE] },
};
const eyeOf = (s) => lerp(EYE_STAND, EYE_CROUCH, s.crouchK);

/** Figur aus Quadern. fall 0 … 1 lässt sie umkippen (dir: +1 nach hinten, −1 nach vorn). Merkt sich die Mündung der Waffe. */
function drawSoldier(I, s, pal, fall = 0, dir = 1) {
  const c = s.crouchK, hipY = 0.93 - 0.42 * c;
  mIdent(TR); mTrans(TR, s.x, s.y, s.z); mRotY(TR, -s.yaw);
  if (fall) { mRotX(TR, fall * dir * 1.52); mTrans(TR, 0, fall * 0.1, 0); }
  const amp = clamp(s.speed / 4, 0, 1.25) * (s.ground ? 1 : 0.35) * (1 - fall);
  for (const side of [-1, 1]) {
    const ph = s.phase + (side > 0 ? Math.PI : 0);
    const thigh = Math.sin(ph) * 0.72 * amp + c * 1.2 + fall * side * 0.25;
    const knee = (0.5 - 0.5 * Math.cos(ph + 0.9)) * 0.95 * amp + c * 2 + fall * 0.3;
    mCopy(TA, TR); mTrans(TA, side * 0.105, hipY, 0); mRotX(TA, thigh);
    part(I, TA, 0, -0.23, 0, 0.155, 0.48, 0.17, pal.cloth);
    mTrans(TA, 0, -0.46, 0); mRotX(TA, -knee);
    part(I, TA, 0, -0.22, 0, 0.13, 0.46, 0.145, pal.cloth);
    part(I, TA, 0, -0.42, -0.04, 0.14, 0.1, 0.25, pal.boot);
  }
  const lean = s.pitch * 0.3 - c * 0.25 - (s.sprinting ? 0.28 : 0);
  mCopy(TB, TR); mTrans(TB, 0, hipY, 0); mRotX(TB, lean);
  part(I, TB, 0, 0.06, 0, 0.36, 0.2, 0.22, pal.cloth);
  part(I, TB, 0, 0.36, 0, 0.4, 0.42, 0.23, pal.cloth);
  part(I, TB, 0, 0.38, -0.01, 0.43, 0.32, 0.29, pal.vest);
  part(I, TB, 0, 0.36, 0.17, 0.3, 0.3, 0.1, pal.vest);
  part(I, TB, 0.255, 0.5, 0, 0.07, 0.09, 0.14, pal.mark);
  part(I, TB, -0.255, 0.5, 0, 0.07, 0.09, 0.14, pal.mark);
  mCopy(TA, TB); mTrans(TA, 0, 0.6, 0); mRotX(TA, s.pitch * 0.45 - lean * 0.5);
  part(I, TA, 0, 0.03, 0, 0.11, 0.08, 0.11, pal.skin);
  part(I, TA, 0, 0.16, 0, 0.19, 0.21, 0.21, pal.skin);
  part(I, TA, 0, 0.26, 0.01, 0.24, 0.11, 0.27, pal.helm);
  part(I, TA, 0, 0.19, -0.105, 0.17, 0.05, 0.02, GUN.d);
  part(I, TA, 0, 0.27, 0.15, 0.1, 0.05, 0.02, pal.mark);

  // Waffe im Anschlag, Arme greifen an Griff und Vorderschaft
  const w = WEAPONS[s.guns[s.cur].id];
  mCopy(TG, TR); mTrans(TG, 0, hipY + 0.5, 0);
  mRotX(TG, fall ? -0.9 * fall : s.pitch - (s.sprinting ? 0.55 : 0) - (s.reloadT > 0 ? 0.3 : 0));
  mTrans(TG, 0.13, -0.07, -0.36);
  if (!fall) drawGun(I, TG, w.model);
  arm(I, TG, 0.12, 0.07, 0.36, 0.01, -0.05, 0.04, pal, 1);
  if (w.oneHand) arm(I, TG, -0.38, 0.07, 0.36, -0.03, -0.06, 0.03, pal, -1);
  else arm(I, TG, -0.38, 0.07, 0.36, -0.01, -0.02, w.muzzle[2] * 0.5, pal, -1);
  const mz = w.muzzle;
  s.mx = TG[0] * mz[0] + TG[4] * mz[1] + TG[8] * mz[2] + TG[12];
  s.my = TG[1] * mz[0] + TG[5] * mz[1] + TG[9] * mz[2] + TG[13];
  s.mzz = TG[2] * mz[0] + TG[6] * mz[1] + TG[10] * mz[2] + TG[14];
}

const VM = mat4(), VK = mat4();
const VM_FOV = 55;
/**
 * Waffe aus der eigenen Sicht. vs = Bewegungszustand der Ansicht (Schwanken, Schritt, Absenken).
 * Merkt sich die Mündung: s.vmx/y/z im Raum der Waffenansicht, s.mx/my/mzz dort, wo sie im Weltbild erscheint.
 */
function drawView(V, s, cam, vs, mainFov) {
  const gun = s.guns[s.cur], w = WEAPONS[gun.id], a = s.ads;
  mCamWorld(VM, cam.x, cam.y, cam.z, cam.yaw, cam.pitch, cam.roll || 0);
  const hip = 1 - a * 0.92, sp = vs.sprintK * (1 - a);
  const rel = s.reloadT > 0 && s.reloadMax > 0 ? Math.sin(Math.PI * clamp(1 - s.reloadT / s.reloadMax, 0, 1)) : 0;
  const low = Math.max(vs.lowK, s.mantle ? 1 : 0);
  let x = lerp(w.hold[0], 0, a) + (vs.swayX + Math.cos(vs.bobT) * 0.007 * vs.bobAmp) * hip - sp * 0.05;
  let y = lerp(w.hold[1], -w.sight, a) + (vs.swayY - Math.abs(Math.sin(vs.bobT)) * 0.011 * vs.bobAmp) * hip + vs.jumpY - low * 0.26 - rel * 0.09 - sp * 0.03;
  const z = lerp(w.hold[2], w.adsZ, a) + s.kickAnim * 0.055 * (1 - a * 0.45) + sp * 0.05;
  if (s.meleeT > 0) { x += 0.06; y -= 0.08; }
  mTrans(VM, x, y, z);
  mRotY(VM, -vs.swayX * 2.2 * hip + sp * 0.75);
  mRotX(VM, s.kickAnim * 0.075 * (1 - a * 0.5) + vs.swayY * 2.4 * hip - low * 0.9 - rel * 0.5 - sp * 0.3);
  mRotZ(VM, rel * 0.45 - vs.swayX * 1.4 * hip + sp * 0.2);
  drawGun(V, VM, w.model);
  // Arme: rechts am Griff, links am Vorderschaft (beim Nachladen am Magazin)
  arm(V, VM, 0.1, -0.16, 0.5, 0.008, -0.055, 0.04, PAL.friend, 1, 0.03);
  if (w.oneHand) arm(V, VM, -0.28, -0.2, 0.42, -0.028, -0.065, 0.035, PAL.friend, -1, 0.03);
  else {
    const fz = w.muzzle[2] * 0.5;
    arm(V, VM, -0.3, -0.22 - rel * 0.1, 0.36, lerp(-0.012, 0, rel), lerp(-0.025, -0.16, rel), lerp(fz, -0.13, rel), PAL.friend, -1, 0.03);
  }
  // Mündung
  const m = w.muzzle;
  s.vmx = VM[0] * m[0] + VM[4] * m[1] + VM[8] * m[2] + VM[12];
  s.vmy = VM[1] * m[0] + VM[5] * m[1] + VM[9] * m[2] + VM[13];
  s.vmz = VM[2] * m[0] + VM[6] * m[1] + VM[10] * m[2] + VM[14];
  basis(cam.yaw, cam.pitch, cam.roll || 0);
  const k = Math.tan(mainFov * DEG / 2) / Math.tan(VM_FOV * DEG / 2);
  const dx = s.vmx - cam.x, dy = s.vmy - cam.y, dz = s.vmz - cam.z;
  const lr = (dx * B[0] + dy * B[1] + dz * B[2]) * k, lu = (dx * B[3] + dy * B[4] + dz * B[5]) * k, lf = dx * B[6] + dy * B[7] + dz * B[8];
  s.mx = cam.x + B[0] * lr + B[3] * lu + B[6] * lf;
  s.my = cam.y + B[1] * lr + B[4] * lu + B[7] * lf;
  s.mzz = cam.z + B[2] * lr + B[5] * lu + B[8] * lf;
  // Messer beim Nahkampf: zieht von rechts nach links durchs Bild
  if (s.meleeT > 0) {
    const t = 1 - s.meleeT / MELEE.time, sw = Math.sin(Math.min(1, t * 1.7) * Math.PI);
    mCamWorld(VK, cam.x, cam.y, cam.z, cam.yaw, cam.pitch, cam.roll || 0);
    mTrans(VK, lerp(0.22, -0.2, Math.min(1, t * 1.7)), -0.11 + sw * 0.03, -0.3 - sw * 0.14);
    mRotY(VK, lerp(-0.9, 0.9, Math.min(1, t * 1.7)));
    mRotX(VK, -0.2);
    drawGun(V, VK, KNIFE);
    arm(V, VK, 0.02, -0.2, 0.45, 0, 0.01, 0.02, PAL.friend, 1, 0.03);
  }
}

// ---------- 9c · Partie: Soldaten, Waffenlogik, Bots, Spielmodi ----------
const BOT_GUNS = ['falke', 'falke', 'falke', 'wespe', 'wespe', 'rammbock', 'luchs', 'amboss', 'habicht'];
const THINK = 0.16;
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.15;
/** Strahl gegen einen Quader (ix, iy, iz = Kehrwerte der Richtung). Liefert die Eintrittsentfernung oder Infinity. */
function slab(ox, oy, oz, ix, iy, iz, x0, y0, z0, x1, y1, z1) {
  let t0 = (x0 - ox) * ix, t1 = (x1 - ox) * ix;
  if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
  let a = (y0 - oy) * iy, b = (y1 - oy) * iy;
  if (a > b) { const t = a; a = b; b = t; }
  if (a > t0) t0 = a;
  if (b < t1) t1 = b;
  a = (z0 - oz) * iz; b = (z1 - oz) * iz;
  if (a > b) { const t = a; a = b; b = t; }
  if (a > t0) t0 = a;
  if (b < t1) t1 = b;
  return t1 >= Math.max(t0, 0) ? Math.max(t0, 0) : Infinity;
}

const HIT_KINDS = ['concrete', 'metal', 'wood', 'sand', 'cloth'];
/** Aufstellung: Menschen abwechselnd auf die Teams, Bots füllen auf. humans: [{ id, name }] (id = Kennung im Netz, 0 = Gastgeber). */
function makeRoster(cfg, humans) {
  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5), teams = MODES[cfg.mode].teams;
  const bot = (team) => ({ name: names.pop() || 'Bot', team, peer: null, primary: pickOf(BOT_GUNS) });
  if (!teams) {
    const out = humans.map((p, i) => ({ name: p.name, team: i, peer: p.id }));
    while (out.length < cfg.size) out.push(bot(out.length));
    return out;
  }
  const side = [[], []];
  humans.forEach((p, i) => side[i % 2].push({ name: p.name, team: i % 2, peer: p.id }));
  for (const t of [0, 1]) while (side[t].length < cfg.size) side[t].push(bot(t));
  return [...side[0], ...side[1]];
}

/**
 * Eine Partie. cfg: { map, mode, limit, minutes, size, skill, loadout: { primary, secondary }, name }
 * hooks: { snd: createSound(), emit(type, data) } – die Oberfläche hört auf Ereignisse (Treffer, Abschüsse, Ende …).
 */
const navCache = new WeakMap();        // Karte → Wegenetz: hängt nur von der Karte ab, also einmal je Sitzung bauen

function createMatch(cfg, hooks) {
  const world = buildWorld(cfg.map), phys = createPhysics(world);
  // Netz: null (allein), sonst { role: 'host' | 'client', id, send(msg, to, reliable) }. Der Gastgeber rechnet die Partie samt Bots;
  // Mitspieler bewegen nur die eigene Figur und melden Treffer – alles andere kommt als Zustand vom Gastgeber.
  const net = cfg.net || null, client = net?.role === 'client', hosting = net?.role === 'host';
  if (!client && !navCache.has(world)) navCache.set(world, buildNav(world, phys));
  const nav = client ? null : navCache.get(world);
  const teams = MODES[cfg.mode].teams, skill = SKILLS[cfg.skill];
  const fx = createFx(), I = instWriter(MAX_INST), V = instWriter(160);
  const soldiers = [], corpses = [], nades = [], packs = [], feed = [];
  const S = hooks.snd, emit = hooks.emit;
  const L = { x: 0, y: 1.6, z: 0, yaw: 0 };          // Hörer (= Kamera)
  const cam = { x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0, roll: 0, fov: 75 };
  const view = { swayX: 0, swayY: 0, bobT: 0, bobAmp: 0, jumpY: 0, lowK: 0, sprintK: 0, shake: 0, roll: 0, lookDX: 0, lookDY: 0 };
  const M = {
    world, phys, nav, fx, soldiers, corpses, feed, cfg, mode: cfg.mode, teams, cam, view, nades, net,
    time: 0, clock: cfg.minutes * 60, state: 'warmup', warm: 4.2, overT: 0, scores: [0, 0], winner: null, draw: false,
    flags: [], uav: [0, 0], me: null, firstBlood: false, flashT: 0, scoped: false, domT: 0, spec: null,
    fixedCam: null,                                // Prüfhaken: feste Kamera [x, y, z, yaw, pitch, fov] (siehe _sz.probe)
  };

  const isEnemy = (a, b) => a !== b && (!teams || a.team !== b.team);
  M.isEnemy = isEnemy;

  // ---------- Aufstellung ----------
  function soldier(name, team, me) {
    const s = {
      id: soldiers.length, name, team, me, bot: null,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: BODY_R, h: STAND_H, ground: true, stepOff: 0, bump: false, landed: 0,
      yaw: 0, pitch: 0, kickP: 0, kickY: 0, kickAnim: 0,
      crouching: false, crouchK: 0, sprinting: false, ads: 0, speed: 0, phase: 0, stepAcc: 0, mantle: null,
      hp: 100, alive: false, respawnT: 0, protect: 0, hurtAt: -99, shotAt: -99, lastAttacker: null, lastKiller: null, damagers: new Map(),
      guns: [], cur: 0, nades: 0, fireT: 0, reloadT: 0, reloadMax: 0, reloadStage: 0, switchT: 0, sprintOut: 0, meleeT: 0, nadeT: 0, bloomK: 0, held: false, jumpHeld: false,
      kills: 0, deaths: 0, assists: 0, score: 0, streak: 0, best: 0, lastKillAt: -99, multi: 0, shots: 0, hits: 0, heads: 0, byWeapon: {},
      in: { mx: 0, mz: 0, jump: false, crouch: false, sprint: false, fire: false, ads: false, reload: false, swap: -1, nade: false, melee: false },
      mx: 0, my: 0, mzz: 0, vmx: 0, vmy: 0, vmz: 0, uavReady: false, uavT: 0, primary: 'falke', peer: null, ext: false, spawnAt: 0,
    };
    soldiers.push(s);
    return s;
  }
  const newBot = () => ({
    target: null, seeT: 0, last: null, lastT: -99, path: null, pi: 0, goal: null, repath: 0, think: Math.random() * THINK,
    strafe: 1, strafeT: 0, crouch: false, burst: 0, rest: 0, tap: 0, ex: 0, ey: 0, etx: 0, ety: 0, errT: 0,
    stuckT: 0, px: 0, pz: 0, jam: 0, nadeCd: rnd(6, 20), nade: null, scanYaw: 0, scanT: 0, hold: 0, lostAt: -99, lostDir: 0,
  });
  {
    const myPeer = net ? net.id : 0;
    for (const r of cfg.roster || makeRoster(cfg, [{ id: 0, name: cfg.name || 'Du' }])) {
      const s = soldier(r.name, r.team, r.peer === myPeer);
      s.peer = r.peer; s.primary = r.primary || 'falke';
      if (s.me) M.me = s;
      else if (client || r.peer != null) s.ext = true;        // wird von außen bewegt
      else s.bot = newBot();
    }
    if (cfg.mode === 'dom') M.flags = world.flags.map((f) => ({ ...f, y: phys.floorBelow(f.x, 2, f.z, 0.3), owner: -1, prog: 0, capBy: -1, mine: false, contested: false }));
  }
  const me = M.me;
  const friendly = (s) => (teams ? s.team === me.team : s === me);
  M.friendly = friendly;

  function pickSpawn(s) {
    let best = null, bs = -1e9;
    world.spawns.forEach((list, side) => {
      for (const p of list) {
        let near = 1e9, taken = false;
        for (const e of soldiers) {
          if (!e.alive || e === s) continue;
          const d = Math.hypot(e.x - p.x, e.z - p.z);
          if (d < 1.3) taken = true;
          if (isEnemy(s, e)) near = Math.min(near, d);
        }
        if (taken) continue;
        let sc = Math.min(near, 45) + Math.random() * 8;
        if (teams && side === s.team) sc += 18;
        if (near < 10) sc -= 50;
        if (sc > bs) { bs = sc; best = p; }
      }
    });
    return best || world.spawns[0][0];
  }
  /** Stellt eine Figur frisch an einen Ort (auch auf Zuruf des Gastgebers). */
  function place(s, x, y, z, yaw, guns) {
    s.x = s.tx = x; s.y = s.ty = y; s.z = s.tz = z; s.yaw = s.tyaw = yaw; s.pitch = s.tpitch = 0;
    s.vx = s.vy = s.vz = 0; s.kickP = s.kickY = 0; s.kickAnim = 0;
    s.hp = 100; s.alive = true; s.protect = 1.6; s.crouching = false; s.crouchK = 0; s.h = STAND_H; s.ads = 0; s.sprinting = false;
    s.fireT = 0.25; s.reloadT = 0; s.switchT = 0; s.meleeT = 0; s.nadeT = 0; s.bloomK = 0; s.mantle = null; s.ground = true; s.stepOff = 0;
    s.damagers.clear(); s.spawnAt = M.time;
    Object.assign(s.in, { swap: -1, nade: false, melee: false, reload: false });      // nichts ausführen, was vor dem Einstieg gedrückt wurde
    guns = (Array.isArray(guns) ? guns : []).filter((id) => WEAPONS[id]).slice(0, 2);
    if (!guns.length) guns = ['falke', 'marder'];          // ohne Waffe gäbe es nichts zu zeichnen und nichts zu rechnen
    s.guns = guns.map((id) => ({ id, mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve }));
    s.cur = 0; s.nades = NADE.count;
    if (s.bot) { const b = s.bot; b.target = null; b.last = null; b.path = null; b.goal = null; b.px = s.x; b.pz = s.z; b.nade = null; b.hold = 0; b.scanYaw = s.yaw; b.jam = 0; }
    emit('spawn', s);
  }
  function spawn(s) {
    const p = pickSpawn(s);
    const prim = s.me ? cfg.loadout.primary : s.primary;
    place(s, p.x, phys.floorBelow(p.x, 2.5, p.z, BODY_R), p.z, teams ? p.yaw : Math.atan2(-p.x, p.z), [WEAPONS[prim] ? prim : 'falke', 'marder']);
    if (hosting) net.send({ t: 'spawn', id: s.id, x: s.x, y: s.y, z: s.z, yaw: s.yaw, g: s.guns.map((g) => g.id) }, null, true);
  }

  // ---------- Treffer ----------
  const HIT = { s: null, zone: 1, t: 0, wall: false, i: -1, axis: 0 };
  function trace(shooter, ox, oy, oz, dx, dy, dz, max) {
    const tw = phys.raycast(ox, oy, oz, dx, dy, dz, max);
    HIT.i = RAY.i; HIT.axis = RAY.axis;
    let best = Math.min(tw, max), who = null, zone = 1;
    const ix = 1 / (Math.abs(dx) < 1e-9 ? 1e-9 : dx), iy = 1 / (Math.abs(dy) < 1e-9 ? 1e-9 : dy), iz = 1 / (Math.abs(dz) < 1e-9 ? 1e-9 : dz);
    for (const e of soldiers) {
      if (!e.alive || !isEnemy(shooter, e)) continue;
      const cx = e.x - ox, cy = e.y + 0.9 - oy, cz = e.z - oz, tc = cx * dx + cy * dy + cz * dz;
      if (tc < -1 || tc > best + 1) continue;
      const px = cx - dx * tc, py = cy - dy * tc, pz = cz - dz * tc;
      if (px * px + py * py + pz * pz > 1.4) continue;
      const H = lerp(STAND_H, CROUCH_H + 0.08, e.crouchK);
      let t = slab(ox, oy, oz, ix, iy, iz, e.x - 0.15, e.y + H - 0.29, e.z - 0.15, e.x + 0.15, e.y + H + 0.03, e.z + 0.15);
      if (t < best) { best = t; who = e; zone = 0; }
      t = slab(ox, oy, oz, ix, iy, iz, e.x - 0.25, e.y + H * 0.44, e.z - 0.25, e.x + 0.25, e.y + H - 0.29, e.z + 0.25);
      if (t < best) { best = t; who = e; zone = 1; }
      t = slab(ox, oy, oz, ix, iy, iz, e.x - 0.2, e.y, e.z - 0.2, e.x + 0.2, e.y + H * 0.44, e.z + 0.2);
      if (t < best) { best = t; who = e; zone = 2; }
    }
    HIT.s = who; HIT.zone = zone; HIT.t = best; HIT.wall = !who && tw !== Infinity;
    return HIT;
  }

  /** Punkte gutschreiben und dem Betroffenen anzeigen */
  function award(s, label, pts) {
    s.score += pts;
    if (s.me) emit('points', { label, pts }); else if (hosting && s.peer != null) net.send({ t: 'pts', l: label, p: pts }, s.peer, true);
  }
  const claims = [];             // Mitspieler: Treffer dieses Schusses, die der Gastgeber werten soll
  function damage(v, a, dmg, info) {
    if (client) { if (a.me && v !== a) claims.push([v.id, info.zone ?? 1, Math.round(info.dist * 10) / 10]); return false; }
    if (!v.alive || v.protect > 0 || M.state !== 'live') return false;
    if (a.bot) dmg *= v.bot ? 0.5 : skill.dmg;          // Bots untereinander kämpfen länger – so bleibt Zeit einzugreifen
    v.hp -= dmg; v.hurtAt = M.time;
    if (a !== v) { v.lastAttacker = a; v.damagers.set(a.id, (v.damagers.get(a.id) || 0) + dmg); }
    const dead = v.hp <= 0;
    if (a.me && a !== v) emit('hit', { head: !!info.head, kill: dead });
    else if (hosting && a.peer != null && a !== v) net.send({ t: 'hit', h: info.head ? 1 : 0, k: dead ? 1 : 0, g: Object.hasOwn(WEAPONS, info.weapon) ? 1 : 0 }, a.peer, true);
    if (v.me) { view.shake = Math.min(1, view.shake + dmg * 0.012); emit('hurt', { from: a, dmg }); }
    else if (hosting && v.peer != null) net.send({ t: 'dmg', from: a.id, d: Math.round(dmg), hp: Math.max(0, v.hp) }, v.peer, true);
    if (v.bot && a !== v && !v.bot.target) { const b = v.bot; b.last = { x: a.x, y: a.y, z: a.z }; b.lastT = M.time; b.goal = null; b.repath = 0; b.think = 0; b.scanYaw = Math.atan2(a.x - v.x, -(a.z - v.z)); }
    if (dead) kill(v, a, info);
    return true;
  }

  /** Figur fällt: liegen bleiben, Meldung, Zähler (auf allen Geräten gleich) */
  function fall(v, a, weapon, head) {
    v.alive = false; v.hp = 0; v.deaths++; v.streak = 0; v.lastKiller = a; v.multi = 0;
    const toA = Math.sin(v.yaw) * (a.x - v.x) - Math.cos(v.yaw) * (a.z - v.z);
    corpses.push({ s: { x: v.x, y: v.y, z: v.z, yaw: v.yaw, pitch: 0, crouchK: v.crouchK, phase: v.phase, speed: 0, ground: true, sprinting: false, reloadT: 0, guns: v.guns, cur: v.cur }, t: 0, dir: toA >= 0 ? 1 : -1, pal: friendly(v) ? PAL.friend : PAL.foe });
    if (corpses.length > 14) corpses.shift();
    feed.push({ a: a === v ? null : a, v, weapon, head, t: M.time });
    if (feed.length > 6) feed.shift();
  }
  function kill(v, a, info) {
    fall(v, a, info.weapon, !!info.head);
    v.respawnT = teams ? 4 : 3;
    packs.push({ x: v.x, y: v.y, z: v.z, t: 22 });
    if (packs.length > 10) packs.shift();
    const self = a === v;
    let sent = 0, sentMedals = [];
    if (!self) {
      a.kills++; a.streak++; a.best = Math.max(a.best, a.streak);
      a.byWeapon[info.weapon] = (a.byWeapon[info.weapon] || 0) + 1;
      if (cfg.mode === 'tdm') M.scores[a.team]++;
      let pts = 100;
      const medals = [];
      if (info.head) { pts += 50; a.heads++; medals.push('Kopfschuss'); }
      if (info.weapon === 'knife') { pts += 25; medals.push('Lautlos'); }
      if (M.time - a.lastKillAt < 3.5) { a.multi++; pts += 50 * a.multi; medals.push(['Doppelabschuss', 'Dreifachabschuss', 'Vierfachabschuss'][Math.min(2, a.multi - 1)]); } else a.multi = 0;
      a.lastKillAt = M.time;
      if (!M.firstBlood) { M.firstBlood = true; pts += 50; medals.push('Erster Abschuss'); }
      if (a.lastKiller === v) { pts += 25; medals.push('Vergeltung'); a.lastKiller = null; }
      if (info.dist > 45 && info.weapon !== 'nade') { pts += 25; medals.push('Fernschuss'); }
      if ([3, 5, 7, 10, 15, 20].includes(a.streak)) { pts += a.streak * 10; medals.push(`Serie ×${a.streak}`); }
      if (a.streak === 3) a.uavReady = true;
      a.score += pts;
      for (const [id, d] of v.damagers) {
        const hlp = soldiers[id];
        if (hlp && hlp !== a && d >= 25 && isEnemy(hlp, v)) { hlp.assists++; award(hlp, 'Vorlage', 40); }
      }
      if (a.me) emit('killed', { v, pts, medals, head: !!info.head });
      sent = pts; sentMedals = medals;
    }
    if (hosting) net.send({ t: 'kill', v: v.id, a: a.id, w: info.weapon, h: info.head ? 1 : 0, p: sent, m: sentMedals }, null, true);
    if (v.me) emit('died', { by: a, weapon: info.weapon });
    emit('feed');
    checkEnd();
  }

  function finish(winner) {
    if (M.state === 'over') return;
    M.state = 'over'; M.winner = winner; M.draw = winner == null; M.overT = 0;
    if (hosting) { sendTable(); net.send({ t: 'end', w: winner == null ? null : teams ? winner : winner.id }, null, true); }
    emit('end');
  }
  function leader() {
    let top = null, tie = false;
    if (teams) { if (M.scores[0] === M.scores[1]) return null; return M.scores[0] > M.scores[1] ? 0 : 1; }
    for (const s of soldiers) { if (!top || s.kills > top.kills) { top = s; tie = false; } else if (s.kills === top.kills) tie = true; }
    return tie ? null : top;
  }
  function checkEnd() {
    if (M.state !== 'live') return;
    // Erreichen beide Teams das Ziel im selben Takt (Herrschaft), gewinnt das mit mehr Punkten – bei Gleichstand keines
    if (teams) { if (M.scores[0] >= cfg.limit || M.scores[1] >= cfg.limit) finish(leader()); }
    else { for (const s of soldiers) if (s.kills >= cfg.limit) { finish(s); break; } }
  }

  // ---------- Waffen ----------
  function startReload(s) {
    const gun = s.guns[s.cur], w = WEAPONS[gun.id];
    if (s.reloadT > 0 || gun.mag >= w.mag || gun.reserve <= 0 || s.switchT > 0) return;
    s.reloadT = s.reloadMax = w.reload + (w.shells ? 0.2 : 0);
    s.reloadStage = 0;
    if (s.me) S.reload('out');
  }
  function fire(s) {
    const gun = s.guns[s.cur], w = WEAPONS[gun.id];
    gun.mag--; s.fireT = 60 / w.rpm; s.shotAt = M.time; s.reloadT = 0; s.shots++;
    s.protect = 0;                    // wer selbst angreift, gibt den Schutz nach dem Einstieg auf
    const move = clamp(s.speed / 4.6, 0, 1.5);
    const hip = w.hip * (1 + move * 0.6) * (s.ground ? 1 : 1.9) * (s.crouching ? 0.78 : 1) + s.bloomK;
    const spread = lerp(hip, w.adsSpr + s.bloomK * 0.25, s.ads * s.ads) + (s.bot ? skill.err * 0.22 : 0);
    basis(s.yaw + s.kickY, s.pitch + s.kickP);
    const rx = B[0], ry = B[1], rz = B[2], ux = B[3], uy = B[4], uz = B[5], fwx = B[6], fwy = B[7], fwz = B[8];
    const ox = s.x, oy = s.y + eyeOf(s), oz = s.z, end = [0, 0, 0];
    let hitAny = false, endK = -1;
    claims.length = 0;
    for (let p = 0; p < w.pellets; p++) {
      const a = Math.random() * TAU, r = Math.tan(Math.sqrt(Math.random()) * spread * DEG), sx = Math.cos(a) * r, sy = Math.sin(a) * r;
      let dx = fwx + rx * sx + ux * sy, dy = fwy + ry * sx + uy * sy, dz = fwz + rz * sx + uz * sy;
      const l = 1 / Math.hypot(dx, dy, dz);
      dx *= l; dy *= l; dz *= l;
      const hit = trace(s, ox, oy, oz, dx, dy, dz, 240);
      const t = hit.t, ex = ox + dx * t, ey = oy + dy * t, ez = oz + dz * t;
      if (p < 4) fx.tracer(s.mx, s.my, s.mzz, ex, ey, ez, s.me);
      if (hit.s) {
        const mult = hit.zone === 0 ? w.head : hit.zone === 2 ? 0.85 : 1;
        fx.flesh(ex, ey, ez, dx, dy, dz);
        if (p === 0) S.impact(L, ex, ey, ez, 'body');
        if (damage(hit.s, s, lerp(w.dmg, w.dmgFar, sstep(w.r0, w.r1, t)) * mult, { head: hit.zone === 0, zone: hit.zone, weapon: gun.id, dist: t })) hitAny = true;
        if (p === 0) { end[0] = ex; end[1] = ey; end[2] = ez; endK = -1; }
      } else {
        if (p === 0) { end[0] = ex; end[1] = ey; end[2] = ez; endK = -1; }
        if (hit.wall) {
          const kind = hit.i === -2 ? world.groundHit : MAT_DEF[world.colMat[hit.i]].hit;
          const d = hit.axis === 0 ? dx : hit.axis === 1 ? dy : dz;
          fx.impact(ex, ey, ez, hit.axis, d > 0 ? -1 : 1, kind);
          if (p === 0) { S.impact(L, ex, ey, ez, kind); endK = hit.axis * 2 + (d > 0 ? 0 : 1) + 6 * Math.max(0, HIT_KINDS.indexOf(kind)); }
        }
      }
      // Kugeln, die knapp am eigenen Kopf vorbeigehen, pfeifen
      if (p === 0 && !s.me && me.alive && hit.s !== me && isEnemy(s, me)) {
        const cx = me.x - ox, cy = me.y + 1.5 - oy, cz = me.z - oz, tc = cx * dx + cy * dy + cz * dz;
        if (tc > 2 && tc < t) {
          const qx = cx - dx * tc, qy = cy - dy * tc, qz = cz - dz * tc;
          if (qx * qx + qy * qy + qz * qz < 2.2) S.whiz(clamp(-(qx * Math.cos(L.yaw) + qz * Math.sin(L.yaw)), -1, 1));
        }
      }
    }
    if (hitAny) s.hits++;
    s.bloomK = Math.min(2.6, s.bloomK + w.bloom);
    if (!s.bot) {
      const kv = w.kickV * DEG * rnd(0.85, 1.15) * lerp(1, 0.72, s.ads) * (s.crouching ? 0.85 : 1);
      s.pitch = Math.min(1.5, s.pitch + kv * 0.35);
      s.kickP += kv * 0.65;
      s.kickY += rnd(-1, 1) * w.kickH * DEG;
    }
    s.kickAnim = Math.min(1.6, s.kickAnim + (w.pellets > 1 || w.scope ? 1.5 : w.auto ? 0.75 : 1.1));
    fx.light(s.mx, s.my, s.mzz, 7, [2.6, 1.8, 0.8], 0.05);
    if (s.me) M.flashT = 0.04; else fx.muzzle(s.mx, s.my, s.mzz);
    S.shot(w.snd, L, s.x, s.y + 1.4, s.z, s.me);
    if (net) {
      const e = end.map((v) => Math.round(v * 100) / 100);
      if (client) net.send({ t: 'fire', w: gun.id, h: claims.slice(0, 8), e, k: endK }, null, true);
      else net.send({ t: 'shot', id: s.id, w: gun.id, e, k: endK }, null, false);
    }
  }
  /** Schuss einer Figur, die anderswo gerechnet wird: nur Bild und Ton */
  function shotFx(s, wid, e, k) {
    const w = WEAPONS[wid];
    if (!w || !s || !Array.isArray(e)) return;
    s.shotAt = M.time; s.kickAnim = Math.min(1.6, s.kickAnim + 0.8);
    fx.tracer(s.mx, s.my, s.mzz, e[0], e[1], e[2], false);
    fx.light(s.mx, s.my, s.mzz, 7, [2.6, 1.8, 0.8], 0.05);
    fx.muzzle(s.mx, s.my, s.mzz);
    S.shot(w.snd, L, s.x, s.y + 1.4, s.z, false);
    if (k >= 0) { const kind = HIT_KINDS[Math.floor(k / 6)] || 'concrete'; fx.impact(e[0], e[1], e[2], (k % 6) >> 1, k % 2 ? 1 : -1, kind); S.impact(L, e[0], e[1], e[2], kind); }
  }
  function melee(s) {
    s.meleeT = MELEE.time; s.reloadT = 0; s.protect = 0;
    if (s.me) S.swing();
    basis(s.yaw, s.pitch);
    const fwx = B[6], fwy = B[7], fwz = B[8], ey = s.y + eyeOf(s);
    let best = null, bd = MELEE.range;
    for (const e of soldiers) {
      if (!e.alive || !isEnemy(s, e)) continue;
      const dx = e.x - s.x, dy = e.y + 1 - ey, dz = e.z - s.z, d = Math.hypot(dx, dy, dz);
      if (d < bd && (dx * fwx + dy * fwy + dz * fwz) / d > 0.5 && phys.los(s.x, ey, s.z, e.x, e.y + 1, e.z)) { best = e; bd = d; }
    }
    if (best) {
      fx.flesh(best.x, best.y + 1.2, best.z, fwx, 0, fwz); S.impact(L, best.x, best.y + 1, best.z, 'body');
      if (client) net.send({ t: 'melee', v: best.id }, null, true); else damage(best, s, MELEE.dmg, { weapon: 'knife', dist: bd });
    }
  }
  function throwNade(s) {
    s.nades--; s.nadeT = 1; s.protect = 0;
    basis(s.yaw, s.pitch + 0.1);
    const v = NADE.speed, x = s.x + B[6] * 0.35 + B[0] * 0.15, y = s.y + eyeOf(s) - 0.12 + B[7] * 0.35, z = s.z + B[8] * 0.35 + B[2] * 0.15;
    const free = !phys.blocked(x - 0.08, y - 0.08, z - 0.08, x + 0.08, y + 0.08, z + 0.08);
    const g = { x: free ? x : s.x, y: free ? y : s.y + eyeOf(s), z: free ? z : s.z, vx: B[6] * v + s.vx * 0.5, vy: B[7] * v + 1.2, vz: B[8] * v + s.vz * 0.5, fuse: NADE.fuse, owner: s, rot: 0, rest: false };
    if (client) net.send({ t: 'nade', p: [g.x, g.y, g.z], v: [g.vx, g.vy, g.vz] }, null, true); else nades.push(g);
    if (s.me) S.pin();
  }
  function boom(x, y, z) {
    fx.explosion(x, y, z);
    S.explosion(L, x, y, z);
    const dm = Math.hypot(me.x - x, me.y + 1 - y, me.z - z);
    if (dm < 22) view.shake = Math.min(1.4, view.shake + (1 - dm / 22) * 1.1);
  }
  function explode(g) {
    boom(g.x, g.y, g.z);
    if (hosting) net.send({ t: 'boom', p: [g.x, g.y, g.z] }, null, true);
    for (const s of soldiers) {
      if (!s.alive || !(s === g.owner || isEnemy(g.owner, s))) continue;
      const d = Math.hypot(s.x - g.x, s.y + 0.9 - g.y, s.z - g.z);
      if (d >= NADE.radius) continue;
      const open = phys.los(g.x, g.y + 0.3, g.z, s.x, s.y + 1.1, s.z) || phys.los(g.x, g.y + 0.3, g.z, s.x, s.y + 0.3, s.z);
      damage(s, g.owner, NADE.dmg * (1 - d / NADE.radius) ** 1.15 * (open ? 1 : 0.12) * (s === g.owner ? 0.7 : 1), { weapon: 'nade', dist: d });
    }
  }
  function stepNades(dt) {
    for (let i = nades.length - 1; i >= 0; i--) {
      const g = nades[i];
      if ((g.fuse -= dt) <= 0) { nades.splice(i, 1); explode(g); continue; }
      if (g.rest) continue;
      g.vy -= 15 * dt;
      g.rot += dt * 9;
      let rem = dt;
      for (let n = 0; n < 3 && rem > 1e-5; n++) {
        const sp = Math.hypot(g.vx, g.vy, g.vz);
        if (sp < 0.01) break;
        const dx = g.vx / sp, dy = g.vy / sp, dz = g.vz / sp, len = sp * rem;
        const t = phys.raycast(g.x, g.y, g.z, dx, dy, dz, len + 0.07);
        if (t === Infinity) { g.x += dx * len; g.y += dy * len; g.z += dz * len; break; }
        const adv = Math.max(0, t - 0.07), ax = RAY.axis;
        g.x += dx * adv; g.y += dy * adv; g.z += dz * adv;
        rem -= adv / sp;
        g.vx *= ax === 0 ? -0.4 : 0.72; g.vy *= ax === 1 ? -0.36 : 0.72; g.vz *= ax === 2 ? -0.4 : 0.72;
        if (sp > 2.5) S.bounce(L, g.x, g.y, g.z);
        if (ax === 1 && Math.abs(g.vy) < 1.2 && Math.hypot(g.vx, g.vz) < 0.7) { g.rest = true; break; }
      }
    }
  }

  // ---------- Bewegung und Handlungen einer Figur ----------
  function stepSoldier(s, dt, frozen) {
    const inp = s.in;
    let gun = s.guns[s.cur], w = WEAPONS[gun.id];
    s.protect -= dt; s.fireT -= dt; s.switchT -= dt; s.meleeT -= dt; s.nadeT -= dt;
    s.bloomK = damp(s.bloomK, 0, 7, dt);
    s.kickP = damp(s.kickP, 0, 8, dt); s.kickY = damp(s.kickY, 0, 8, dt); s.kickAnim = damp(s.kickAnim, 0, 13, dt);
    s.stepOff = damp(s.stepOff, 0, 13, dt);
    if (!client && s.hp < 100 && M.time - s.hurtAt > 4.5) s.hp = Math.min(100, s.hp + 38 * dt);

    // Klettern über eine Kante
    if (s.mantle) {
      const m = s.mantle;
      m.t = Math.min(1, m.t + dt / m.dur);
      const up = Math.min(1, m.t / 0.65), fw = clamp((m.t - 0.45) / 0.55, 0, 1);
      s.y = lerp(m.y0, m.y1, up * up * (3 - 2 * up)); s.x = lerp(m.x0, m.x1, fw); s.z = lerp(m.z0, m.z1, fw);
      s.vx = s.vy = s.vz = 0; s.speed = 0; s.ads = 0; s.sprinting = false;
      if (m.t >= 1) { s.mantle = null; s.ground = true; }
      s.held = inp.fire; s.jumpHeld = inp.jump;
      return;
    }

    // Haltung
    if (inp.crouch) s.crouching = true;
    else if (s.crouching && !phys.bodyBlocked(s.x, s.y, s.z, s.r, STAND_H)) s.crouching = false;
    s.crouchK = approach(s.crouchK, s.crouching ? 1 : 0, dt * 7);
    s.h = s.crouching ? CROUCH_H : STAND_H;
    const wantAds = inp.ads && s.reloadT <= 0 && s.switchT <= 0 && s.meleeT <= 0;
    s.ads = approach(s.ads, wantAds ? 1 : 0, dt / w.ads);

    // Bewegung
    let mx = inp.mx, mz = inp.mz;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    if (frozen) { mx = 0; mz = 0; }
    s.sprinting = inp.sprint && mz > 0.6 && !s.crouching && s.ads < 0.1 && s.ground && !inp.fire && s.meleeT <= 0;
    if (s.sprinting) s.sprintOut = 0.2; else s.sprintOut -= dt;
    const top = 4.6 * w.move * (s.crouching ? 0.52 : s.sprinting ? 1.45 : 1) * lerp(1, 0.62, s.ads);
    const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw);
    const wx = (cy * mx + sy * mz) * top, wz = (sy * mx - cy * mz) * top;
    const k = Math.min(1, dt * (s.ground ? 11 : 1.6));
    s.vx += (wx - s.vx) * k; s.vz += (wz - s.vz) * k;
    if (inp.jump && !s.jumpHeld && s.ground && !frozen && !s.crouching) { s.vy = 6.4; s.ground = false; }
    s.jumpHeld = inp.jump;
    s.vy -= GRAVITY * dt;
    for (const o of soldiers) {          // nicht ineinander stehen
      if (o === s || !o.alive) continue;
      const dx = s.x - o.x, dz = s.z - o.z, d2 = dx * dx + dz * dz;
      if (d2 > 0.42 || d2 < 1e-6 || Math.abs(s.y - o.y) > 1.6) continue;
      const d = Math.sqrt(d2), push = ((0.65 - d) / d) * 4 * dt;
      s.vx += dx * push * 8; s.vz += dz * push * 8;
    }
    s.landed = 0;
    phys.moveBody(s, s.vx * dt, s.vy * dt, s.vz * dt);
    if (s.landed > 6 && s.me) { S.land(); view.jumpY = -0.03; }
    if (s.landed > 14) damage(s, s, (s.landed - 14) * 7, { weapon: 'fall', dist: 0 });
    if (!s.alive) return;
    s.speed = Math.hypot(s.vx, s.vz);
    s.phase += s.speed * dt * 2.4;
    if (s.ground && (s.stepAcc += s.speed * dt) > (s.sprinting ? 2.3 : 1.75)) { s.stepAcc = 0; S.step(L, s.x, s.y, s.z, s.me, s.sprinting ? 1.3 : s.crouching ? 0.35 : 1); }
    // Kante vor der Brust: hochziehen
    if (inp.jump && s.bump && !frozen) {
      const fx2 = s.x + sy * 0.55, fz2 = s.z - cy * 0.55, topY = phys.floorBelow(fx2, s.y + 1.75, fz2, 0.2), hh = topY - s.y;
      if (hh > STEP_H && hh <= 1.65 && !phys.bodyBlocked(fx2, topY, fz2, s.r, STAND_H) && !phys.blocked(s.x - s.r, s.y + s.h, s.z - s.r, s.x + s.r, topY + STAND_H, s.z + s.r)) {
        s.mantle = { t: 0, dur: 0.34 + hh * 0.16, x0: s.x, y0: s.y, z0: s.z, x1: fx2, y1: topY, z1: fz2 };
        s.reloadT = 0;
      }
    }
    if (frozen) { s.held = inp.fire; return; }

    // Waffe wechseln
    if (inp.swap >= 0 && inp.swap !== s.cur && s.guns[inp.swap] && s.switchT <= 0.1) {
      s.cur = inp.swap; s.reloadT = 0; s.ads = 0; s.bloomK = 0;
      gun = s.guns[s.cur]; w = WEAPONS[gun.id];
      s.switchT = w.slot === 1 ? 0.32 : 0.48;
      if (s.me) S.swap();
    }
    inp.swap = -1;
    // Nachladen
    if (s.reloadT > 0) {
      s.reloadT -= dt;
      if (!w.shells && s.reloadStage === 0 && s.reloadT < s.reloadMax * 0.45) { s.reloadStage = 1; if (s.me) S.reload('in'); }
      if (s.reloadT <= 0) {
        if (w.shells) {
          gun.mag++; gun.reserve--;
          if (s.me) S.reload('shell');
          if (gun.mag < w.mag && gun.reserve > 0 && !inp.fire) s.reloadT = s.reloadMax = w.reload; else if (s.me) S.reload('bolt');
        } else {
          const n = Math.min(w.mag - gun.mag, gun.reserve);
          gun.mag += n; gun.reserve -= n;
          if (s.me) S.reload('bolt');
        }
      }
    }
    if (inp.reload) startReload(s);
    // Feuern
    const trigger = inp.fire && (w.auto || !s.held);
    s.held = inp.fire;
    if (trigger && s.fireT <= 0 && s.switchT <= 0 && s.sprintOut <= 0 && s.meleeT <= 0 && (s.reloadT <= 0 || (w.shells && gun.mag > 0))) {
      if (gun.mag > 0) fire(s);
      else if (gun.reserve > 0) startReload(s);
      else {
        const other = s.guns.findIndex((g2, i) => i !== s.cur && (g2.mag > 0 || g2.reserve > 0));
        if (other >= 0) inp.swap = other; else if (s.me && s.fireT < -0.25) { S.dry(); s.fireT = 0; }
      }
    }
    if (inp.melee && s.meleeT <= 0 && s.switchT <= 0) melee(s);
    inp.melee = false;
    if (inp.nade && s.nades > 0 && s.nadeT <= 0 && s.meleeT <= 0) throwNade(s);
    inp.nade = false;
    // Munition einsammeln
    for (let i = packs.length - 1; i >= 0; i--) {
      const p = packs[i];
      if (Math.abs(p.x - s.x) < 0.9 && Math.abs(p.z - s.z) < 0.9 && Math.abs(p.y - s.y) < 1.2) {
        let got = false;
        for (const g2 of s.guns) { const w2 = WEAPONS[g2.id]; if (g2.reserve < w2.reserve) { g2.reserve = Math.min(w2.reserve, g2.reserve + w2.mag); got = true; } }
        if (s.nades < NADE.count && Math.random() < 0.5) { s.nades++; got = true; }
        if (got) { packs.splice(i, 1); if (s.me) emit('pack'); }
      }
    }
  }

  // ---------- Bots ----------
  function roamGoal(s) {
    if (cfg.mode === 'dom' && M.flags.length) {
      const open = M.flags.filter((f) => f.owner !== s.team);
      const list = open.length ? open : M.flags;
      let best = list[0], bs = 1e9;
      for (const f of list) { const sc = Math.hypot(f.x - s.x, f.z - s.z) * rnd(0.5, 1.5); if (sc < bs) { bs = sc; best = f; } }
      return { x: best.x + rnd(-2.2, 2.2), y: best.y, z: best.z + rnd(-2.2, 2.2), hold: open.length ? 6 : rnd(3, 8) };
    }
    if (Math.random() < 0.45) {
      const foes = soldiers.filter((e) => e.alive && isEnemy(s, e));
      if (foes.length) { const e = pickOf(foes); return { x: e.x + rnd(-6, 6), y: e.y, z: e.z + rnd(-6, 6), hold: rnd(0.8, 2.5) }; }
    }
    if (world.pois.length && Math.random() < 0.85) { const p = pickOf(world.pois); return { x: p.x + rnd(-1.5, 1.5), y: 0, z: p.z + rnd(-1.5, 1.5), hold: rnd(1, 4) }; }
    const n = nav.random();
    return { x: nav.X[n], y: nav.Y[n], z: nav.Z[n], hold: rnd(0.5, 2) };
  }
  function botThink(s) {
    const b = s.bot, ex = s.x, ey = s.y + eyeOf(s), ez = s.z, fwx = Math.sin(s.yaw), fwz = -Math.cos(s.yaw);
    let best = null, bs = 1e9;
    for (const e of soldiers) {
      if (!e.alive || !isEnemy(s, e)) continue;
      const dx = e.x - ex, dz = e.z - ez, d = Math.hypot(dx, dz, e.y - s.y);
      if (d > 90) continue;
      const facing = (dx * fwx + dz * fwz) / (Math.hypot(dx, dz) || 1);
      if (!(e === b.target || d < 4 || facing > 0.3 || (M.time - e.shotAt < 0.6 && d < 30))) continue;
      const eh = eyeOf(e);
      if (!phys.los(ex, ey, ez, e.x, e.y + eh - 0.08, e.z) && !phys.los(ex, ey, ez, e.x, e.y + eh * 0.55, e.z)) continue;
      const sc = d * (e === b.target ? 0.65 : 1) * (e === s.lastAttacker ? 0.8 : 1);
      if (sc < bs) { bs = sc; best = e; }
    }
    if (best) {
      if (b.target !== best) {
        b.target = best; b.seeT = 0; b.errT = 0; b.burst = 0; b.rest = 0;
        // erst stehen und schießen; wer das Ziel eben erst aus den Augen verlor, bleibt länger an der Ecke
        b.strafe = 0; b.strafeT = M.time - b.lostAt < 1.5 ? rnd(1.4, 2.4) : rnd(0.4, 0.9);
      }
      b.last = { x: best.x, y: best.y, z: best.z }; b.lastT = M.time;
    } else if (b.target) { b.target = null; b.seeT = 0; b.goal = null; b.repath = 0; b.lostAt = M.time; b.lostDir = b.strafe; }
    if (!b.target && cfg.mode !== 'dom' && (!b.last || M.time - b.lastT > 2)) {              // Schüsse in der Nähe hören
      for (const e of soldiers) {
        if (!e.alive || !isEnemy(s, e) || M.time - e.shotAt > 0.5) continue;
        if (Math.hypot(e.x - s.x, e.z - s.z) < 36 && Math.random() < 0.5) { b.last = { x: e.x + rnd(-3, 3), y: e.y, z: e.z + rnd(-3, 3) }; b.lastT = M.time; b.goal = null; b.repath = 0; break; }
      }
    }
    if (b.last && M.time - b.lastT > (cfg.mode === 'dom' ? 3.5 : 9)) b.last = null;      // in „Herrschaft“ zählt die Stellung mehr als die Jagd
    // Granate dorthin, wo der Gegner eben verschwunden ist
    b.nadeCd -= THINK;
    if (!b.target && b.last && !b.nade && b.nadeCd <= 0 && s.nades > 0 && M.time - b.lastT > 0.7 && M.time - b.lastT < 4) {
      const dx = b.last.x - s.x, dz = b.last.z - s.z, d = Math.hypot(dx, dz), q = (15 * d) / (NADE.speed * NADE.speed);
      if (d > 9 && d < 17 && q < 1 && Math.random() < 0.35) { b.nade = { yaw: Math.atan2(dx, -dz), pitch: 0.5 * Math.asin(q) + 0.02, t: 0.45 }; b.nadeCd = rnd(14, 28); }
    }

    // Wohin gehen?
    b.repath -= THINK;
    let goal = null, why = '';
    if (b.target) {
      const w = WEAPONS[s.guns[s.cur].id], d = Math.hypot(b.target.x - s.x, b.target.z - s.z), pref = w.pellets > 1 ? 6 : w.snd === 'smg' ? 12 : 0;
      if (pref && d > pref * 1.6) { goal = b.target; why = 'push'; } else { b.path = null; return; }
    } else if (b.last && (cfg.mode !== 'dom' || Math.hypot(b.last.x - s.x, b.last.z - s.z) < 9)) { goal = b.last; why = 'hunt'; }
    else if (b.path && b.pi < b.path.length) why = 'go';
    else if (b.hold > 0) { b.hold -= THINK; return; }
    else { goal = b.goal = roamGoal(s); why = 'roam'; }
    if (why !== 'go' && (why === 'roam' || b.repath <= 0 || !b.path)) {
      const from = nav.nearest(s.x, s.y, s.z), to = nav.nearest(goal.x, goal.y || 0, goal.z);
      b.path = from >= 0 && to >= 0 ? nav.path(from, to) : null;
      b.pi = 0; b.repath = why === 'push' ? 0.8 : 1.6;
      if (!b.path) { if (why === 'hunt') b.last = null; b.goal = null; }
    }
    // Ecken abkürzen, wenn der übernächste Punkt geradeaus erreichbar ist
    const p = b.path;
    for (let n = 0; p && n < 3 && b.pi + 1 < p.length; n++) {
      const nx = p[b.pi + 1];
      if (Math.abs(nav.Y[nx] - s.y) > 0.3 || !nav.walkable(s.x, s.y, s.z, nav.X[nx], nav.Z[nx])) break;
      b.pi++;
    }
  }
  function botStep(s, dt) {
    const b = s.bot, inp = s.in, gun = s.guns[s.cur], w = WEAPONS[gun.id];
    if ((b.think -= dt) <= 0) { b.think = THINK * rnd(0.85, 1.15); botThink(s); }
    inp.fire = false; inp.ads = false; inp.jump = false; inp.sprint = false; inp.reload = false; inp.mx = 0; inp.mz = 0; inp.crouch = false;
    let lookYaw = null, lookPitch = 0, wx = 0, wz = 0, turn = skill.turn;
    const t = b.target;
    if (t && t.alive) {
      b.seeT += dt;
      const dx = t.x - s.x, dz = t.z - s.z, dist = Math.hypot(dx, dz) || 0.01;
      if ((b.errT -= dt) <= 0) {
        b.errT = rnd(0.25, 0.6);
        const k = skill.err * DEG * (1 + t.speed * 0.13 + s.speed * 0.06) * (b.seeT < 0.7 ? 1.7 : 1);
        b.etx = gauss() * k; b.ety = gauss() * k * 0.55;
      }
      b.ex = damp(b.ex, b.etx, 5, dt); b.ey = damp(b.ey, b.ety, 5, dt);
      const aimY = t.y + lerp(1.2, 0.8, t.crouchK) + (cfg.skill === 2 ? 0.15 : 0);
      lookYaw = Math.atan2(dx, -dz) + b.ex;
      lookPitch = Math.atan2(aimY - (s.y + eyeOf(s)), dist) + b.ey;
      const off = Math.abs(angDiff(s.yaw, lookYaw)) + Math.abs(lookPitch - s.pitch);
      if (b.seeT > skill.react && off < Math.atan2(0.5, dist) * 2 + 0.05) {
        if (b.rest > 0) b.rest -= dt;
        else if (w.auto) {
          inp.fire = true;
          if ((b.burst += dt) > (dist > 28 ? 0.3 : dist > 12 ? 0.55 : 1.4) * rnd(0.7, 1.3)) { b.burst = 0; b.rest = rnd(0.16, 0.5) / skill.burst; }
        } else if ((b.tap -= dt) <= 0) { inp.fire = true; b.tap = 60 / w.rpm + rnd(0.06, 0.3) / skill.burst; }
      }
      inp.ads = dist > 9;
      if ((b.strafeT -= dt) <= 0 || (s.bump && b.strafe)) {
        b.strafeT = rnd(0.5, 1.4);
        let dir = s.bump && b.strafe ? -b.strafe : pickOf([-1, 1, 1, -1, 0]);
        if (dir && dir === b.lostDir && M.time - b.lostAt < 5) dir = Math.random() < 0.5 ? -dir : 0;      // nicht wieder hinter die Ecke treten
        b.strafe = dir; b.crouch = dist > 16 && Math.random() < 0.3;
      }
      const pref = w.pellets > 1 ? 5 : w.snd === 'smg' ? 10 : w.scope ? 42 : 20;
      const fw = dist > pref * 1.5 ? 1 : dist < pref * 0.45 ? -0.8 : 0, nx = dx / dist, nz = dz / dist;
      if (b.path && b.pi < b.path.length) { const n = b.path[b.pi], px = nav.X[n] - s.x, pz = nav.Z[n] - s.z, pd = Math.hypot(px, pz); if (pd < 0.55) b.pi++; else { wx = px / pd; wz = pz / pd; } }
      else { wx = nx * fw - nz * b.strafe * 0.9; wz = nz * fw + nx * b.strafe * 0.9; }
      inp.crouch = b.crouch && !fw;
      if (dist < 2 && Math.abs(angDiff(s.yaw, lookYaw)) < 0.5 && Math.random() < dt * 3) inp.melee = true;
    } else if (b.nade) {
      lookYaw = b.nade.yaw; lookPitch = b.nade.pitch; turn = 12;
      if ((b.nade.t -= dt) <= 0) { if (Math.abs(angDiff(s.yaw, lookYaw)) < 0.12) inp.nade = true; b.nade = null; }
    } else {
      const p = b.path;
      if (p && b.pi < p.length) {
        const n = p[b.pi], dx = nav.X[n] - s.x, dz = nav.Z[n] - s.z, d = Math.hypot(dx, dz);
        if (d < 0.5 || (d < 1 && b.pi + 1 < p.length)) {
          if (++b.pi >= p.length) { b.hold = b.goal?.hold || rnd(0.5, 1.5); b.goal = null; if (b.last && Math.hypot(b.last.x - s.x, b.last.z - s.z) < 3) b.last = null; b.scanYaw = s.yaw + rnd(-1, 1); }
        } else { wx = dx / d; wz = dz / d; }
        const ahead = p[Math.min(p.length - 1, b.pi + 2)], ax = nav.X[ahead] - s.x, az = nav.Z[ahead] - s.z;
        if (b.last && Math.hypot(b.last.x - s.x, b.last.z - s.z) < 14) lookYaw = Math.atan2(b.last.x - s.x, -(b.last.z - s.z));
        else if (ax * ax + az * az > 0.3) lookYaw = Math.atan2(ax, -az);
        inp.sprint = !b.last && p.length - b.pi > 5;
        turn *= 0.7;
      } else {
        if ((b.scanT -= dt) <= 0) { b.scanT = rnd(0.7, 1.8); b.scanYaw = s.yaw + rnd(-1.7, 1.7); }
        lookYaw = b.scanYaw; turn *= 0.45;
      }
      if (gun.mag < w.mag * 0.45 && gun.reserve > 0) inp.reload = true;
    }
    if (gun.mag === 0) { if (gun.reserve > 0) inp.reload = true; else { gun.reserve = WEAPONS[gun.id].mag * 2; } }
    // Einer scharfen Granate ausweichen
    for (const g of nades) {
      const dx = s.x - g.x, dz = s.z - g.z, d = Math.hypot(dx, dz);
      if (d < 6.5 && g.fuse < 1.7 && d > 0.05) { wx = dx / d; wz = dz / d; inp.sprint = !t; inp.crouch = false; break; }
    }
    if (lookYaw !== null) {
      s.yaw += clamp(angDiff(s.yaw, lookYaw) * Math.min(1, dt * 10), -turn * dt, turn * dt);
      s.pitch += clamp((lookPitch - s.pitch) * Math.min(1, dt * 10), -turn * dt, turn * dt);
    }
    if (wx || wz) {
      const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw);
      inp.mz = wx * sy - wz * cy; inp.mx = wx * cy + wz * sy;
      // Festgefahren? Springen, dann neuen Weg suchen
      if ((b.stuckT += dt) > 0.9) {
        if (Math.hypot(s.x - b.px, s.z - b.pz) < 0.3) { b.jam++; inp.jump = true; b.strafe = -b.strafe || 1; if (b.jam > 2) { b.path = null; b.goal = null; b.last = null; b.jam = 0; } }
        else b.jam = 0;
        b.px = s.x; b.pz = s.z; b.stuckT = 0;
      }
    } else b.stuckT = 0;
  }

  // ---------- Herrschaft: Stellungen ----------
  function stepFlags(dt) {
    if (cfg.mode !== 'dom' || M.state !== 'live') return;
    for (const f of M.flags) {
      let n0 = 0, n1 = 0;
      f.mine = false;
      for (const s of soldiers) {
        if (!s.alive || Math.hypot(s.x - f.x, s.z - f.z) > 3.4 || Math.abs(s.y - f.y) > 2.5) continue;
        if (s.team === 0) n0++; else n1++;
        if (s.me) f.mine = true;
      }
      const t = n0 && !n1 ? 0 : n1 && !n0 ? 1 : -1;
      f.contested = n0 > 0 && n1 > 0;
      if (t >= 0 && f.owner !== t) {
        if (f.capBy !== t) { f.capBy = t; f.prog = 0; }
        f.prog += dt * (0.15 + 0.05 * Math.min(3, (t ? n1 : n0) - 1));
        if (f.prog >= 1) {
          const was = f.owner;
          f.owner = t; f.prog = 0; f.capBy = -1;
          for (const s of soldiers) if (s.alive && s.team === t && Math.hypot(s.x - f.x, s.z - f.z) < 3.4) award(s, `Stellung ${f.name} erobert`, 150);
          emit('flag', { f, was });
          if (hosting) net.send({ t: 'flag', i: M.flags.indexOf(f), o: t, was }, null, true);
        }
      } else if (!f.contested) { f.prog = Math.max(0, f.prog - dt * 0.3); if (!f.prog) f.capBy = -1; }
    }
    if ((M.domT += dt) >= 4) { M.domT -= 4; for (const f of M.flags) if (f.owner >= 0) M.scores[f.owner]++; checkEnd(); }
  }

  // ---------- Netz ----------
  /** Figur, die anderswo gerechnet wird, weich an den gemeldeten Zustand heranführen */
  function extStep(s, dt) {
    const k = 1 - Math.exp(-16 * dt), ox = s.x, oz = s.z;
    if (Math.hypot(s.tx - s.x, s.tz - s.z) > 6) { s.x = s.tx; s.y = s.ty; s.z = s.tz; }
    s.x += (s.tx - s.x) * k; s.y += (s.ty - s.y) * k; s.z += (s.tz - s.z) * k;
    s.yaw += angDiff(s.yaw, s.tyaw) * k; s.pitch += (s.tpitch - s.pitch) * k;
    s.speed = damp(s.speed, Math.hypot(s.x - ox, s.z - oz) / Math.max(dt, 1e-4), 10, dt);
    s.phase += s.speed * dt * 2.4;
    s.ground = Math.abs(s.ty - s.y) < 0.25;
    s.crouchK = approach(s.crouchK, s.crouching ? 1 : 0, dt * 7);
    s.kickAnim = damp(s.kickAnim, 0, 13, dt);
    if (s.ground && (s.stepAcc += s.speed * dt) > (s.sprinting ? 2.3 : 1.75)) { s.stepAcc = 0; S.step(L, s.x, s.y, s.z, false, s.sprinting ? 1.3 : s.crouching ? 0.35 : 1); }
    if (!client) { s.protect -= dt; if (s.hp < 100 && M.time - s.hurtAt > 4.5) s.hp = Math.min(100, s.hp + 38 * dt); }
  }
  const r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
  /** Zahl aus dem Netz – oder der Ersatz, wenn dort keine endliche Zahl steht */
  const fin = (v, d) => (Number.isFinite(v) ? v : d);
  /** Drei endliche Zahlen aus dem Netz, dem Betrag nach begrenzt – sonst null */
  const vec3 = (a, lim) => (Array.isArray(a) && Number.isFinite(a[0]) && Number.isFinite(a[1]) && Number.isFinite(a[2])
    ? [clamp(a[0], -lim, lim), clamp(a[1], -lim, lim), clamp(a[2], -lim, lim)] : null);
  const bits = (s) => (s.alive ? 1 : 0) | (s.crouching ? 2 : 0) | (s.sprinting ? 4 : 0) | (s.ads > 0.5 ? 8 : 0) | (s.reloadT > 0 ? 16 : 0) | (s.protect > 0 ? 32 : 0) | (s.uavT > M.time ? 64 : 0) | (s.uavReady ? 128 : 0);
  function sendTable() { net.send({ t: 'tbl', r: soldiers.map((s) => [s.id, s.kills, s.deaths, s.assists, s.score, s.best]) }, null, true); }
  let netAcc = 0, tblAcc = 0;
  function netTick(dt) {
    if ((netAcc += dt) < 0.05) return;
    netAcc = 0;
    if (client) { if (me.alive) net.send({ t: 'u', a: [r2(me.x), r2(me.y), r2(me.z), r3(me.yaw), r3(me.pitch), bits(me), me.cur] }, null, false); return; }
    net.send({
      t: 's', st: ['warmup', 'live', 'over'].indexOf(M.state), c: Math.round(M.clock * 10) / 10, w: r2(M.warm), sc: M.scores, uv: [r2(M.uav[0] - M.time), r2(M.uav[1] - M.time)],
      f: M.flags.map((f) => [f.owner, Math.round(f.prog * 100), f.capBy]),
      p: soldiers.map((s) => [s.id, r2(s.x), r2(s.y), r2(s.z), r3(s.yaw), r3(s.pitch), bits(s), Math.round(s.hp), s.cur]),
      g: nades.map((g) => [r2(g.x), r2(g.y), r2(g.z)]),
    }, null, false);
    if ((tblAcc += 0.05) >= 1) { tblAcc = 0; sendTable(); }
  }
  /** Nachricht aus dem Netz. from = Absender (beim Mitspieler immer der Gastgeber). */
  M.onNet = (from, m) => {
    if (!net || !m || typeof m.t !== 'string') return;
    if (hosting) {
      const s = soldiers.find((x) => x.peer === from);
      if (!s || s.me) return;
      if (m.t === 'u' && Array.isArray(m.a)) {
        const [x, y, z, yaw, pitch, fl, c] = m.a.map(Number);
        if (!s.alive || ![x, y, z, yaw, pitch].every(Number.isFinite) || (M.time - s.spawnAt < 1 && Math.hypot(x - s.x, z - s.z) > 5)) return;
        s.tx = clamp(x, world.bounds.x0, world.bounds.x1); s.ty = clamp(y, 0, 40); s.tz = clamp(z, world.bounds.z0, world.bounds.z1); s.tyaw = yaw; s.tpitch = clamp(pitch, -1.55, 1.55);
        s.crouching = !!(fl & 2); s.sprinting = !!(fl & 4); s.ads = fl & 8 ? 1 : 0; s.reloadT = fl & 16 ? 1 : 0;
        if (s.guns[c]) s.cur = c;
      } else if (m.t === 'fire') {
        const w = s.guns.some((g) => g.id === m.w) ? WEAPONS[m.w] : null;       // nur Waffen, die die Figur wirklich trägt
        if (!w || !s.alive || M.state !== 'live') return;
        s.shots++; s.shotAt = M.time; s.protect = 0;
        let any = false;
        for (const c of Array.isArray(m.h) ? m.h.slice(0, w.pellets) : []) {
          if (!Array.isArray(c)) continue;
          const v = Number.isInteger(c[0]) ? soldiers[c[0]] : null, zone = c[1] | 0, dist = clamp(Number(c[2]) || 0, 0, 260);
          if (!v || !v.alive || !isEnemy(s, v) || Math.abs(Math.hypot(v.x - s.x, v.z - s.z, v.y - s.y) - dist) > 8) continue;
          if (damage(v, s, lerp(w.dmg, w.dmgFar, sstep(w.r0, w.r1, dist)) * (zone === 0 ? w.head : zone === 2 ? 0.85 : 1), { head: zone === 0, zone, weapon: m.w, dist })) any = true;
        }
        if (any) s.hits++;
        const e = vec3(m.e, 600), k = Number.isInteger(m.k) ? m.k : -1;
        if (!e) return;                           // ohne brauchbaren Endpunkt gibt es weder Bild noch Ton
        shotFx(s, m.w, e, k);
        net.send({ t: 'shot', id: s.id, w: m.w, e, k }, null, false);
      } else if (m.t === 'melee') {
        const v = Number.isInteger(m.v) ? soldiers[m.v] : null;
        if (s.alive) s.protect = 0;
        if (v && v.alive && s.alive && isEnemy(s, v) && Math.hypot(v.x - s.x, v.z - s.z) < 4) damage(v, s, MELEE.dmg, { weapon: 'knife', dist: 1 });
      } else if (m.t === 'nade' && s.alive && s.nades > 0) {
        const p = vec3(m.p, 600), v = vec3(m.v, 40);
        if (p && v && Math.hypot(p[0] - s.x, p[2] - s.z) < 4 && Math.hypot(v[0], v[1], v[2]) < 30) {
          s.nades--; s.protect = 0;
          nades.push({ x: p[0], y: p[1], z: p[2], vx: v[0], vy: v[1], vz: v[2], fuse: NADE.fuse, owner: s, rot: 0, rest: false });
        }
      } else if (m.t === 'lo') {
        if (!PRIMARIES.includes(m.p)) return;
        s.primary = m.p;
        if (M.state === 'warmup' && s.guns[0]?.id !== m.p) spawn(s);          // vor dem Start gleich mit der gewählten Waffe
      }
      else if (m.t === 'uav') useUav(s);
      return;
    }
    // ----- Mitspieler: Zustand und Ereignisse vom Gastgeber -----
    // Auch dem Gastgeber wird nicht blind geglaubt: eine verstümmelte Nachricht darf weder Zahlen verderben noch das Bild anhalten.
    if (m.t === 's') {
      if (!Array.isArray(m.p)) return;
      const st = ['warmup', 'live', 'over'][m.st] || 'live';
      if (st === 'live' && M.state === 'warmup') { M.state = 'live'; emit('go'); } else if (M.state !== 'over') M.state = st === 'over' ? M.state : st;
      M.clock = fin(m.c, M.clock); M.warm = fin(m.w, M.warm);
      if (Array.isArray(m.sc)) { M.scores[0] = fin(m.sc[0], M.scores[0]); M.scores[1] = fin(m.sc[1], M.scores[1]); }
      if (Array.isArray(m.uv)) { M.uav[0] = M.time + fin(m.uv[0], 0); M.uav[1] = M.time + fin(m.uv[1], 0); }
      if (Array.isArray(m.f)) {
        m.f.forEach((a, i) => {
          const f = M.flags[i];
          if (!f || !Array.isArray(a)) return;
          f.owner = a[0] === 0 || a[0] === 1 ? a[0] : -1; f.prog = clamp(fin(a[1], 0) / 100, 0, 1); f.capBy = a[2] === 0 || a[2] === 1 ? a[2] : -1;
          f.mine = me.alive && Math.hypot(me.x - f.x, me.z - f.z) < 3.4;
        });
      }
      for (const a of m.p) {
        const s = Array.isArray(a) && Number.isInteger(a[0]) ? soldiers[a[0]] : null;
        if (!s) continue;
        const fl = a[6] | 0, hp = clamp(fin(a[7], s.hp), 0, 100);
        s.uavT = fl & 64 ? M.time + 0.5 : 0; s.protect = fl & 32 ? 0.3 : 0;
        if (s === me) { me.hp = hp; me.uavReady = !!(fl & 128); continue; }
        const p = vec3(a.slice(1, 4), 600);
        if (!p || !Number.isFinite(a[4]) || !Number.isFinite(a[5])) continue;
        s.tx = p[0]; s.ty = p[1]; s.tz = p[2]; s.tyaw = a[4]; s.tpitch = clamp(a[5], -1.55, 1.55);
        s.crouching = !!(fl & 2); s.sprinting = !!(fl & 4); s.ads = fl & 8 ? 1 : 0; s.reloadT = fl & 16 ? 1 : 0; s.hp = hp;
        if (Number.isInteger(a[8]) && s.guns[a[8]]) s.cur = a[8];
      }
      nades.length = 0;
      for (const g of Array.isArray(m.g) ? m.g.slice(0, 32) : []) { const p = vec3(g, 600); if (p) nades.push({ x: p[0], y: p[1], z: p[2], rot: M.time * 9, fuse: 9 }); }
    } else if (m.t === 'shot') { const e = vec3(m.e, 600); if (e && m.id !== me.id && Number.isInteger(m.id)) shotFx(soldiers[m.id], m.w, e, Number.isInteger(m.k) ? m.k : -1); }
    else if (m.t === 'spawn') {
      const s = Number.isInteger(m.id) ? soldiers[m.id] : null, p = vec3([m.x, m.y, m.z], 600);
      if (!s || !p) return;
      place(s, p[0], p[1], p[2], fin(m.yaw, 0), m.g);
      if (s.me) net.send({ t: 'lo', p: cfg.loadout.primary }, null, true);
    } else if (m.t === 'kill') {
      const v = Number.isInteger(m.v) ? soldiers[m.v] : null, a = Number.isInteger(m.a) ? soldiers[m.a] : null, pts = fin(m.p, 0), w = String(m.w);
      if (!v || !a) return;
      fall(v, a, w, !!m.h);
      if (a !== v) {
        a.kills++; a.score += pts; a.streak++; a.best = Math.max(a.best, a.streak);
        if (a.me) { a.byWeapon[w] = (a.byWeapon[w] || 0) + 1; if (m.h) a.heads++; emit('killed', { v, pts, medals: Array.isArray(m.m) ? m.m.slice(0, 8).map(String) : [], head: !!m.h }); }
      }
      if (v.me) { v.respawnT = teams ? 4 : 3; emit('died', { by: a, weapon: w }); }
      emit('feed');
    } else if (m.t === 'dmg') {
      const d = clamp(fin(m.d, 0), 0, 500);
      me.hp = clamp(fin(m.hp, me.hp), 0, 100); me.hurtAt = M.time; view.shake = Math.min(1, view.shake + d * 0.012);
      emit('hurt', { from: (Number.isInteger(m.from) && soldiers[m.from]) || me, dmg: d });
    } else if (m.t === 'hit') {
      // gezählt wird wie beim Gastgeber: ein Treffer je Schuss – nicht je Schrotkugel, und weder Messer noch Granate
      if (m.g !== 0 && me.hitAt !== me.shots) { me.hitAt = me.shots; me.hits++; }
      emit('hit', { head: !!m.h, kill: !!m.k });
    }
    else if (m.t === 'pts') { const pts = fin(m.p, 0); me.score += pts; emit('points', { label: String(m.l), pts }); }
    else if (m.t === 'boom') { const p = vec3(m.p, 600); if (p) boom(p[0], p[1], p[2]); }
    else if (m.t === 'flag') { const f = Number.isInteger(m.i) ? M.flags[m.i] : null; if (f && (m.o === 0 || m.o === 1)) { f.owner = m.o; emit('flag', { f, was: m.was }); } }
    else if (m.t === 'tbl') {
      for (const r of Array.isArray(m.r) ? m.r : []) {
        const s = Array.isArray(r) && Number.isInteger(r[0]) ? soldiers[r[0]] : null;
        if (s) { s.kills = fin(r[1], s.kills); s.deaths = fin(r[2], s.deaths); s.assists = fin(r[3], s.assists); s.score = fin(r[4], s.score); s.best = fin(r[5], s.best); }
      }
    } else if (m.t === 'end' && M.state !== 'over') {
      const w = m.w === 0 || m.w === 1 || (!teams && Number.isInteger(m.w)) ? (teams ? m.w : soldiers[m.w] || null) : null;
      M.state = 'over'; M.winner = w; M.draw = w == null; M.overT = 0; emit('end');
    }
  };
  /** Ein Mitspieler ist gegangen: ein Bot übernimmt seine Figur. */
  M.dropPeer = (id) => {
    const s = soldiers.find((x) => x.peer === id);
    if (!hosting || !s || s.me) return;
    s.peer = null; s.ext = false; s.bot = newBot(); s.bot.px = s.x; s.bot.pz = s.z;
    Object.assign(s.in, { mx: 0, mz: 0, jump: false, crouch: false, sprint: false, fire: false, ads: false, reload: false, swap: -1, nade: false, melee: false });
  };

  // ---------- Takt ----------
  /** Gefallene bleiben neun Sekunden liegen; in den letzten anderthalb versinken sie im Boden. */
  function stepCorpses(dt) {
    for (let i = corpses.length - 1; i >= 0; i--) {
      const c = corpses[i];
      if ((c.t += dt) > 9) corpses.splice(i, 1); else if (c.t > 7.5) c.s.y -= 0.72 * dt;
    }
  }
  M.step = (dt) => {
    M.time += dt;
    if (client) {
      M.flashT -= dt;
      if (M.state === 'over') M.overT += dt;
      if (me.alive) stepSoldier(me, dt, M.state !== 'live'); else me.respawnT -= dt;
      for (const s of soldiers) if (s.ext && s.alive) extStep(s, dt);
      fx.update(dt);
      stepCorpses(dt);
      netTick(dt);
      return;
    }
    if (M.state === 'warmup') { if ((M.warm -= dt) <= 0) { M.state = 'live'; emit('go'); } }
    else if (M.state === 'live') { if ((M.clock -= dt) <= 0) { M.clock = 0; finish(leader()); } }
    else M.overT += dt;
    M.flashT -= dt;
    const frozen = M.state !== 'live';
    for (const s of soldiers) {
      if (s.alive) {
        if (s.ext) { extStep(s, dt); continue; }
        if (s.bot && !frozen) botStep(s, dt);
        else if (frozen) { s.in.fire = false; s.in.mx = 0; s.in.mz = 0; }
        stepSoldier(s, dt, frozen);
      } else if (M.state !== 'over' && (s.respawnT -= dt) <= 0) spawn(s);
    }
    if (hosting) netTick(dt);
    stepNades(dt);
    stepFlags(dt);
    fx.update(dt);
    stepCorpses(dt);
    for (let i = packs.length - 1; i >= 0; i--) if ((packs[i].t -= dt) <= 0) packs.splice(i, 1);
  };

  /** Kamera für dieses Bild. fovBase = eingestelltes Sichtfeld (senkrecht, Grad). */
  M.aim = (dt, fovBase) => {
    const s = me, v = view;
    v.shake = damp(v.shake, 0, 5, dt);
    const sh = v.shake * 0.02, tt = M.time * 47;
    if (M.fixedCam) {                               // Prüfhaken: feste Kamera, ohne Wackeln und ohne Waffe
      const p = M.fixedCam;
      cam.x = p[0]; cam.y = p[1]; cam.z = p[2]; cam.yaw = p[3]; cam.pitch = p[4]; cam.roll = 0; cam.fov = p[5]; M.scoped = false;
    } else if (M.spec) {                            // Zuschauer: schräg hinter einer anderen Figur
      const o = M.spec;
      basis(o.yaw, o.pitch * 0.5);
      cam.x = o.x - B[6] * 3.2 + B[0] * 0.5; cam.y = o.y + 2 - B[7] * 3.2; cam.z = o.z - B[8] * 3.2 + B[2] * 0.5;
      cam.yaw = o.yaw; cam.pitch = o.pitch * 0.5 - 0.12; cam.roll = 0; cam.fov = fovBase; M.scoped = false;
    } else if (s.alive) {
      const w = WEAPONS[s.guns[s.cur].id];
      v.bobAmp = damp(v.bobAmp, s.ground ? clamp(s.speed / 4.6, 0, 1.6) : 0, 8, dt);
      v.bobT = s.phase;
      v.sprintK = damp(v.sprintK, s.sprinting ? 1 : 0, 9, dt);
      v.lowK = s.switchT > 0 ? clamp(s.switchT / 0.28, 0, 1) : damp(v.lowK, s.nadeT > 0.55 ? 0.7 : 0, 14, dt);
      v.jumpY = damp(v.jumpY, s.ground ? 0 : clamp(-s.vy * 0.004, -0.025, 0.03), 9, dt);
      v.swayX = damp(v.swayX, clamp(-v.lookDX * 0.5, -0.025, 0.025), 9, dt);
      v.swayY = damp(v.swayY, clamp(v.lookDY * 0.5, -0.02, 0.02), 9, dt);
      v.lookDX = 0; v.lookDY = 0;
      v.roll = damp(v.roll, -s.in.mx * 0.012 * (s.ground ? 1 : 0.3), 8, dt);
      cam.x = s.x; cam.z = s.z;
      cam.y = s.y + eyeOf(s) + s.stepOff - Math.abs(Math.sin(s.phase)) * 0.028 * v.bobAmp * (1 - s.ads * 0.7);
      cam.yaw = s.yaw + s.kickY + Math.sin(tt) * sh;
      cam.pitch = clamp(s.pitch + s.kickP + Math.sin(tt * 1.3 + 1) * sh, -1.55, 1.55);
      cam.roll = v.roll + Math.sin(tt * 0.9 + 2) * sh * 0.8;
      const z = lerp(1, w.zoom, s.ads * s.ads * (3 - 2 * s.ads));
      cam.fov = (2 * Math.atan(Math.tan((fovBase * DEG) / 2) / z)) / DEG + v.sprintK * 4;
      M.scoped = !!w.scope && s.ads > 0.86;
    } else {
      // gefallen: die Kamera sinkt und dreht sich zum Schützen
      const kx = s.lastKiller && s.lastKiller !== s ? s.lastKiller : null;
      cam.y = damp(cam.y, s.y + 0.4, 4, dt);
      cam.roll = damp(cam.roll, 0.42, 3, dt);
      cam.pitch = damp(cam.pitch, 0.12, 3, dt);
      if (kx) cam.yaw += angDiff(cam.yaw, Math.atan2(kx.x - cam.x, -(kx.z - cam.z))) * Math.min(1, dt * 3);
      cam.fov = damp(cam.fov, fovBase, 6, dt);
      M.scoped = false;
    }
    L.x = cam.x; L.y = cam.y; L.z = cam.z; L.yaw = cam.yaw;
  };

  const FLAG_COL = { n: [0.85, 0.85, 0.85, K_MATTE], f: [0.1, 0.42, 1, K_GLOW], e: [1, 0.12, 0.06, K_GLOW] };
  const PACK = [0.2, 0.24, 0.14, K_MATTE], PACK_L = [1, 0.75, 0.2, K_GLOW], NADE_C = [0.13, 0.17, 0.1, K_MATTE], POLE = [0.1, 0.1, 0.11, K_METAL];
  const lightsOut = [];
  /** Sammelt alles Bewegliche für den Renderer. */
  M.frame = (shadows) => {
    I.reset(); V.reset();
    for (const s of soldiers) if (s.alive && (s !== me || M.spec)) drawSoldier(I, s, friendly(s) ? PAL.friend : PAL.foe);
    for (const c of corpses) {
      const k = Math.min(1, c.t / 0.5);
      drawSoldier(I, c.s, c.pal, 1 - (1 - k) * (1 - k), c.dir);
    }
    for (const g of nades) { mIdent(TA); mTrans(TA, g.x, g.y, g.z); mRotY(TA, g.rot); mRotX(TA, g.rot * 0.7); I.box(TA, 0.085, 0.11, 0.085, NADE_C); part(I, TA, 0, 0.07, 0, 0.03, 0.04, 0.03, GUN.s); }
    for (const p of packs) { mIdent(TA); mTrans(TA, p.x, p.y + 0.16 + Math.sin(M.time * 2.5 + p.x) * 0.04, p.z); mRotY(TA, M.time * 1.3 + p.z); I.box(TA, 0.34, 0.2, 0.22, PACK); part(I, TA, 0, 0.04, 0, 0.35, 0.04, 0.23, PACK_L); }
    for (const f of M.flags) {
      const col = f.owner < 0 ? FLAG_COL.n : f.owner === me.team ? FLAG_COL.f : FLAG_COL.e;
      mIdent(TA); mTrans(TA, f.x, f.y, f.z);
      part(I, TA, 0, 1.7, 0, 0.07, 3.4, 0.07, POLE);
      part(I, TA, 0.42, 3.05, 0, 0.78, 0.5, 0.03, col, 0, 0, Math.sin(M.time * 2 + f.x) * 0.04);
    }
    if (M.spec || M.fixedCam) { /* keine Waffe im Bild */ } else if (me.alive && !M.scoped) drawView(V, me, cam, view, cam.fov);
    else if (me.alive) { basis(cam.yaw, cam.pitch); me.mx = cam.x + B[6] * 0.9 - B[3] * 0.08; me.my = cam.y + B[7] * 0.9 - B[4] * 0.08; me.mzz = cam.z + B[8] * 0.9 - B[5] * 0.08; }
    const quadCount = fx.build(cam, () => {
      for (const f of M.flags) {
        const c = f.owner < 0 ? [0.9, 0.9, 0.9] : f.owner === me.team ? [0.2, 0.5, 1] : [1, 0.2, 0.12];
        fx.disc(f.x, f.y + 0.03, f.z, 3.4, c, 0.22 + (f.capBy >= 0 ? 0.12 * Math.sin(M.time * 8) : 0));
      }
    });
    const vmQuadCount = me.alive && M.flashT > 0 && V.count ? fx.flash(me.vmx, me.vmy, me.vmz, 0.085 + Math.random() * 0.03) : 0;
    lightsOut.length = 0;
    for (const l of fx.lights) { const k = l.life / l.max; lightsOut.push([l.x, l.y, l.z, l.r, l.c[0] * k, l.c[1] * k, l.c[2] * k]); }
    const lamps = world.lamps.length > MAX_LIGHTS - lightsOut.length
      ? [...world.lamps].sort((p, q) => Math.hypot(p[0] - cam.x, p[2] - cam.z) - Math.hypot(q[0] - cam.x, q[2] - cam.z)) : world.lamps;
    for (const l of lamps) { if (lightsOut.length >= MAX_LIGHTS) break; lightsOut.push(l); }
    return { cam, inst: I.buf, instCount: I.count, vm: V.buf, vmCount: V.count, vmFov: VM_FOV, quads: fx.quads, quadCount, vmQuadCount, lights: lightsOut, time: M.time, shadows };
  };

  /** Aufklärung einsetzen (ab drei Abschüssen in Folge): Gegner erscheinen eine Weile auf dem Radar. */
  function useUav(s) {
    if (!s.uavReady || !s.alive || M.state !== 'live') return false;
    s.uavReady = false;
    if (teams) M.uav[s.team] = M.time + 25; else s.uavT = M.time + 25;
    return true;
  }
  M.useUav = () => {
    if (client) { if (me.uavReady) { net.send({ t: 'uav' }, null, true); emit('uav'); } return me.uavReady; }
    if (!useUav(me)) return false;
    emit('uav');
    return true;
  };
  /** Sekunden, die die eigene Aufklärung noch läuft */
  M.uavLeft = () => Math.max(0, (teams ? M.uav[me.team] : me.uavT) - M.time);
  /** Wer steht gerade im Fadenkreuz? (Gegner oder null) */
  M.target = () => { basis(cam.yaw, cam.pitch); return trace(me, cam.x, cam.y, cam.z, B[6], B[7], B[8], 140).s; };
  /** Rangliste für Punktetafel und Abschluss */
  // „Frei für alle“ wird über Abschüsse entschieden – also ordnet die Tafel dort zuerst nach Abschüssen, sonst nach Punkten
  M.table = () => [...soldiers].sort((a, b) => (teams ? 0 : b.kills - a.kills) || b.score - a.score || b.kills - a.kills);
  M.place = () => M.table().indexOf(me) + 1;

  for (const s of soldiers) spawn(s);
  M.aim(0.016, 75);
  return M;
}

// ==========================================================================
// 10 · Netz: Partien von Gerät zu Gerät (WebRTC-Datenkanäle), ganz ohne Server.
// Wer ein Spiel eröffnet, ist die Mitte eines Sterns: alle anderen verbinden sich nur mit ihm.
// Zusammengefunden wird über zwei Codes, die sich die Spieler selbst schicken – die Einladung hin, die Antwort zurück.
// ==========================================================================
const NET_CSS = `
.szn { container: szn / inline-size; display: flex; flex-direction: column; gap: 14px; min-width: 0; min-height: 0; font-size: 13px; color: var(--fg); }
.szn-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
.szn-head > div { display: grid; gap: 2px; flex: 1; min-width: 0; }
.szn-head b { font-size: 16px; font-weight: 750; letter-spacing: -.01em; }
.szn-sum { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--fg-3); }
.szn-choice { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.szn-pick { display: grid; align-content: start; justify-items: start; gap: 6px; padding: 16px; border: 0; border-radius: 16px; background: var(--raise); box-shadow: inset 0 0 0 .5px var(--line); text-align: left; transition: transform .4s var(--spring), background-color .15s; }
.szn-pick:hover { background: var(--raise-2); }
.szn-pick:active { transform: scale(.97); }
.szn-pick .ico { width: 26px; height: 26px; margin-bottom: 2px; color: var(--accent); }
.szn-pick b { font-size: 15px; font-weight: 700; }
.szn-pick span { font-size: 12.5px; line-height: 1.4; color: var(--fg-3); text-wrap: pretty; }
.szn-how { display: grid; gap: 9px; margin: 0; padding: 14px; border-radius: 16px; background: var(--well); list-style: none; counter-reset: szn; }
.szn-how li { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 10px; align-items: start; font-size: 12.5px; line-height: 1.45; color: var(--fg-2); text-wrap: pretty; counter-increment: szn; }
.szn-how li::before, .szn-step i { content: counter(szn); display: grid; place-items: center; flex: none; width: 22px; height: 22px; border-radius: 50%; background: var(--raise-2); font: 700 11.5px/1 var(--font-round); font-style: normal; color: var(--fg); }
.szn-fine { font-size: 11.5px; line-height: 1.45; color: var(--fg-3); text-wrap: pretty; }
.szn-card { display: grid; gap: 10px; padding: 14px; border-radius: 16px; background: var(--raise); box-shadow: inset 0 0 0 .5px var(--line); }
.szn-step { display: flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 650; }
.szn-step i { background: var(--accent); color: #fff; }
.szn-text { font-size: 12.5px; line-height: 1.45; color: var(--fg-2); text-wrap: pretty; }
.szn-code { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.szn-code textarea { flex: 1; height: 62px; padding: 7px 9px; font: 11px/1.45 var(--mono); word-break: break-all; }
.szn-code textarea[readonly] { color: var(--fg-2); }
.szn-code .kit-btn { min-width: 112px; padding: 8px 12px; }
.szn-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; min-width: 0; }
.szn-row .sp { flex: 1; }
.szn-row .szn-fine { flex: 1 1 14em; min-width: 0; }
.szn-list { display: grid; gap: 6px; }
.szn-list-head { display: flex; align-items: baseline; gap: 8px; padding: 0 2px; font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--fg-3); }
.szn-list-head span { flex: 1; }
.szn-list-head em { font-style: normal; letter-spacing: 0; font-variant-numeric: tabular-nums; }
.szn-players { display: grid; gap: 2px; max-height: 232px; overflow: auto; }
.szn-player { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 6px 8px; border-radius: 11px; background: var(--well); animation: szn-in .35s var(--ease-out) both; }
@keyframes szn-in { from { opacity: 0; translate: 0 6px; } }
.szn-ava { display: grid; place-items: center; flex: none; width: 26px; height: 26px; border-radius: 50%; background: hsl(var(--hue, 210) 58% 46%); font: 750 12px/1 var(--font-round); color: #fff; }
.szn-name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.szn-tag { flex: none; padding: 2px 7px; border-radius: 99px; background: var(--raise-2); font-size: 10.5px; font-weight: 700; color: var(--fg-2); }
.szn-tag.host { background: color-mix(in srgb, var(--accent) 26%, transparent); color: var(--fg); }
.szn-player .sp { flex: 1; }
.szn-ping { display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px; flex: none; min-width: 60px; font-size: 12px; color: var(--fg-3); font-variant-numeric: tabular-nums; }
.szn-ping::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--c, var(--c-mint)); box-shadow: 0 0 8px var(--c, var(--c-mint)); }
.szn-kick { display: grid; place-items: center; flex: none; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 50%; background: none; color: var(--fg-3); }
.szn-kick:hover { background: var(--raise-2); color: var(--c-coral); }
.szn-kick .ico { width: 13px; height: 13px; stroke-width: 2.4; }
.szn-err, .szn-note { min-height: 1.3em; font-size: 12.5px; line-height: 1.35; text-wrap: pretty; }
.szn-err { color: var(--c-coral); }
.szn-note { color: var(--c-mint); }
.szn-err:empty, .szn-note:empty { display: none; }
.szn-wait { display: flex; align-items: center; gap: 9px; font-size: 12.5px; color: var(--fg-2); }
.szn-spin { flex: none; width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--fg-4); border-top-color: var(--accent); animation: szn-spin .8s linear infinite; }
@keyframes szn-spin { to { rotate: 360deg; } }
.szn-ok { display: flex; align-items: center; gap: 9px; padding: 11px 13px; border-radius: 14px; background: color-mix(in srgb, var(--c-mint) 16%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c-mint) 45%, transparent); font-size: 13px; font-weight: 600; }
.szn-ok .ico { flex: none; width: 17px; height: 17px; color: var(--c-mint); stroke-width: 2.4; }
.szn-foot { display: flex; align-items: center; gap: 12px; min-width: 0; }
.szn-foot .szn-fine { flex: 1; min-width: 0; }
.szn-link { padding: 4px 6px; border: 0; border-radius: 7px; background: none; font-size: 12.5px; font-weight: 600; color: var(--fg-3); }
.szn-link:hover { background: var(--raise); color: var(--fg); }
@container szn (max-width: 470px) {
  .szn-choice { grid-template-columns: 1fr; }
  .szn-code { flex-direction: column; align-items: stretch; }
  .szn-code textarea { flex: none; }
  .szn-foot { flex-direction: column; align-items: stretch; }
}
@media (prefers-reduced-motion: reduce) { .szn-player { animation: none; } }
`;

/**
 * Verbindung zu den Mitspielern. opts: { name, onPeers(list), onMessage(fromId, msg, reliable), onStatus(text), onClosed(reason) }
 * Nachrichten sind JSON-taugliche Objekte; das Feld „_“ ist für den Eigenbedarf dieser Schicht reserviert.
 */
function createNet(opts = {}) {
  const MAX = 8;                              // Spieler je Partie, den Gastgeber mitgezählt
  const PING_MS = 2000, DEAD_MS = 8000;       // Lebenszeichen alle zwei Sekunden; nach acht Sekunden Stille gilt jemand als weg
  const OPEN_MS = 22000, INVITE_MS = 20 * 60000, BIG = 14000;
  const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  const subs = new Set();                     // Zuhörer der Lobby: fn(Art, Daten)
  const links = new Map();                    // Gastgeber: Kennung → Verbindung { id, name, pc, r, u, seen, ping, ready }
  const pending = new Map();                  // Gastgeber: offene Einladungen { key, pc, r, u, at, busy }
  let role = null, myId = -1, peers = [], up = null, nextId = 1, timer = 0, status = '';
  const cleanName = (n) => String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, 20) || 'Spieler';
  let name = cleanName(opts.name);

  const call = (fn, ...args) => { try { fn?.(...args); } catch (err) { console.error('[Netz]', err); } };
  const tell = (type, data) => { for (const fn of [...subs]) call(fn, type, data); };
  function say(text) { status = text; call(opts.onStatus, text); tell('status', text); }
  function setPeers(list) {
    peers = list.map((p) => ({ id: p.id, name: p.name, ping: Math.round(p.ping) || 0, me: p.id === myId })).sort((a, b) => a.id - b.id);
    call(opts.onPeers, peers);
    tell('peers', peers);
  }
  const hostList = () => [{ id: 0, name, ping: 0 }, ...[...links.values()].map((l) => ({ id: l.id, name: l.name, ping: Math.round(l.ping) }))];
  function syncPeers() { const list = hostList(); setPeers(list); cast({ _: 'peers', list }); }

  // ---------- Codes: gepacktes JSON, als Text, der jeden Messenger übersteht ----------
  const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64 = (str) => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/')); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };
  const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  // Wiederkehrende Stücke einer Verbindungsbeschreibung (SDP) werden vor dem Packen durch je ein Zeichen ersetzt.
  // Das ist verlustfrei: was ein Browser anders schreibt, bleibt einfach stehen. Die Reihenfolge gehört zum Format „SZ1“.
  const WORDS = [
    ' 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\n',
    '\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n',
    '\r\na=ice-options:trickle\r\na=fingerprint:sha-256 ',
    ' typ host generation 0 network-cost 999\r\n', ' generation 0 network-cost 999\r\n', ' generation 0 network-id ', ' network-cost ',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n', 'c=IN IP4 0.0.0.0\r\n', 'a=group:BUNDLE 0\r\n', 'a=msid-semantic:', 'a=sendrecv\r\n', 'a=end-of-candidates\r\n',
    'a=max-message-size:', 'a=sctp-port:5000\r\n', 'a=mid:0\r\n', 'a=ice-options:trickle\r\n', 'a=fingerprint:sha-256 ',
    '\r\na=setup:actpass', '\r\na=setup:active', '\r\na=setup:passive', 'a=setup:',
    'v=0\r\no=- ', 'v=0\r\no=', '\r\na=ice-pwd:', 'a=ice-ufrag:', 'a=candidate:', ' typ srflx raddr ', ' typ host', ' rport ', ' 1 udp ', ' 1 tcp ', ' tcptype ', '.local ', ' IN IP4 ', '\r\n',
  ];
  const TOK = 0xa1, FP = String.fromCharCode(TOK + WORDS.length);        // Platzhalter ab U+00A1; FP leitet einen umgerechneten Fingerabdruck ein
  function shrink(sdp) {
    if (/[^\x00-\x7f]/.test(sdp)) return null;                           // unerwartete Zeichen: lieber unverändert lassen
    let s = sdp.replace(/a=fingerprint:sha-256 ((?:[0-9A-F]{2}:){31}[0-9A-F]{2})(?=\r\n)/, (m, hex) => FP + b64(Uint8Array.from(hex.split(':'), (x) => parseInt(x, 16))));
    WORDS.forEach((w, i) => { s = s.split(w).join(String.fromCharCode(TOK + i)); });
    return s;
  }
  function grow(s) {
    WORDS.forEach((w, i) => { s = s.split(String.fromCharCode(TOK + i)).join(w); });
    return s.replace(new RegExp(`${FP}([A-Za-z0-9_-]{43})`), (m, b) => `a=fingerprint:sha-256 ${[...unb64(b)].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':')}`);
  }
  /** → „SZ1-“ + Packart (d = gepackt, j = roh) + Inhalt + „=“ als Schlusszeichen */
  async function pack(obj) {
    const z = shrink(obj.s);
    if (z != null) obj = { ...obj, s: z, z: 1 };
    let bytes = new TextEncoder().encode(JSON.stringify(obj)), tag = 'j';
    if (typeof CompressionStream === 'function') {
      try { bytes = await pipe(bytes, new CompressionStream('deflate-raw')); tag = 'd'; } catch { /* dann eben ungepackt */ }
    }
    return `SZ1-${tag}${b64(bytes)}=`;
  }
  const BROKEN = 'Der Code ist beschädigt. Kopiere ihn bitte noch einmal vollständig.';
  async function unpack(text, want) {
    const flat = String(text ?? '').replace(/\s+/g, '');
    if (!flat) throw new Error('Füge zuerst den Code ein.');
    const m = flat.match(/SZ1-([dj])([A-Za-z0-9_-]+)(=?)/);
    if (!m) throw new Error('Das ist kein Sperrzone-Code. Ein Code beginnt mit „SZ1-“.');
    if (!m[3]) throw new Error('Der Code ist unvollständig. Kopiere ihn bitte ganz – bis zum „=“ am Ende.');
    let obj = null, old = false;
    try {
      let bytes = unb64(m[2]);
      if (m[1] === 'd') {
        if (typeof DecompressionStream !== 'function') { old = true; throw new Error('alt'); }
        bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
      }
      obj = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error(old ? 'Dieser Browser kann den Code nicht entpacken. Nimm bitte einen aktuellen Browser.' : BROKEN);
    }
    if (!obj || typeof obj.s !== 'string' || typeof obj.i !== 'string' || (obj.k !== 'i' && obj.k !== 'a')) throw new Error(BROKEN);
    if (obj.k !== want) {
      throw new Error(want === 'i'
        ? 'Das ist ein Antwortcode. Hier gehört der Einladungscode des Gastgebers hinein.'
        : 'Das ist ein Einladungscode. Hier gehört der Antwortcode deines Mitspielers hinein.');
    }
    if (obj.z) obj.s = grow(obj.s);
    return obj;
  }

  // ---------- Verbindungsaufbau ----------
  function peerConnection() {
    if (typeof RTCPeerConnection !== 'function') throw new Error('Dieser Browser kann keine direkten Verbindungen aufbauen (WebRTC fehlt).');
    return new RTCPeerConnection(ICE);
  }
  /** Wartet, bis der Browser seine Wege gesammelt hat – höchstens drei Sekunden (ohne Netz kommt nie ein „fertig“). */
  const gathered = (pc) => new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') { resolve(); return; }
    const done = () => { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', check); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    const t = setTimeout(done, navigator.onLine === false ? 600 : 3000);
    pc.addEventListener('icegatheringstatechange', check);
  });
  const opened = (ch, pc) => new Promise((resolve, reject) => {
    if (ch.readyState === 'open') { resolve(); return; }
    const fin = (fn) => { clearTimeout(t); ch.removeEventListener('open', ok); pc.removeEventListener('connectionstatechange', st); fn(); };
    const ok = () => fin(resolve);
    const st = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') fin(reject); };
    const t = setTimeout(() => fin(reject), OPEN_MS);
    ch.addEventListener('open', ok);
    pc.addEventListener('connectionstatechange', st);
  });
  const rid = () => Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  const onHide = () => close();
  // Ohne einen einzigen Verbindungsweg (ICE-Kandidaten) in der eigenen Beschreibung kann der Code nie funktionieren:
  // lieber gleich sagen, als beide Seiten Codes tauschen und dann vergeblich warten zu lassen.
  const NO_WAY = 'Dein Browser hat keinen Weg für eine direkte Verbindung gefunden. Prüfe die Netzverbindung – oder versuche es in einem anderen Browser.';
  const hasWay = (pc) => /^a=candidate:/m.test(pc.localDescription?.sdp || '');

  // ---------- Senden und Empfangen ----------
  /** Schickt fertigen Text über einen Kanal. Unzuverlässig heißt: lieber weglassen als stauen. */
  function push(link, data, reliable) {
    const ch = reliable ? link.r : link.u;
    if (!ch || ch.readyState !== 'open') return 0;
    if (!reliable && ch.bufferedAmount > 65536) return 0;
    try { ch.send(data); return 1; } catch { return 0; }
  }
  /** Eigenbedarf (Lebenszeichen, Spielerliste): unzuverlässig, wenn es geht – sonst über den sicheren Kanal. */
  const raw = (link, obj, reliable) => { const data = JSON.stringify(obj); return push(link, data, reliable) || (!reliable && push(link, data, true)); };
  function cast(obj) { const data = JSON.stringify(obj); for (const l of links.values()) push(l, data, true); }

  function receiver(link, reliable) {
    return (e) => {
      link.seen = performance.now();
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (typeof msg._ === 'string') inner(link, msg);
      else if (link.ready) call(opts.onMessage, link.id, msg, reliable);
    };
  }
  function inner(link, msg) {
    if (msg._ === 'ping') raw(link, { _: 'pong', t: msg.t }, false);
    else if (msg._ === 'pong') { const rt = performance.now() - msg.t; if (rt >= 0 && rt < 60000) link.ping = link.ping ? link.ping * 0.7 + rt * 0.3 : rt; }
    else if (role === 'client' && link === up) {
      if (msg._ === 'welcome') {
        myId = msg.id; link.ready = true;
        setPeers(msg.list || []);
        say(`Verbunden mit ${link.name}.`);
        tell('open', myId);
      } else if (msg._ === 'peers') setPeers(msg.list || []);
      else if (msg._ === 'bye') shut(msg.why === 'kick' ? 'kick' : 'host');
    } else if (role === 'host' && msg._ === 'bye') drop(link);
  }
  /** Verbindung abbauen: Kanäle sauber schließen (das schickt noch Ausstehendes), den Rest kurz danach. */
  function end(link) {
    if (link.r) link.r.onclose = null;
    link.pc.onconnectionstatechange = null;
    link.pc.ondatachannel = null;
    try { link.r?.close(); link.u?.close(); } catch { /* schon zu */ }
    setTimeout(() => { try { link.pc.close(); } catch { /* schon zu */ } }, 250);
  }
  function startTimer() { if (!timer) timer = setInterval(tick, PING_MS); addEventListener('pagehide', onHide); }
  function stopTimer() { clearInterval(timer); timer = 0; removeEventListener('pagehide', onHide); }
  function tick() {
    const now = performance.now();
    if (role === 'host') {
      for (const l of [...links.values()]) { if (now - l.seen > DEAD_MS) drop(l); else raw(l, { _: 'ping', t: now }, false); }
      for (const inv of [...pending.values()]) if (!inv.busy && Date.now() - inv.at > INVITE_MS) { pending.delete(inv.key); inv.pc.close(); }
      if (links.size) syncPeers();              // verteilt auch die gemessenen Laufzeiten
    } else if (up?.ready) {
      if (now - up.seen > DEAD_MS) shut('host'); else raw(up, { _: 'ping', t: now }, false);
    }
  }

  // ---------- Gastgeber ----------
  function host() {
    if (role === 'host') return;
    if (role === 'client') shut(null);
    peerConnection().close();                   // früh melden, wenn WebRTC fehlt
    role = 'host'; myId = 0; nextId = 1;
    startTimer();
    setPeers(hostList());
    say('Spiel eröffnet.');
  }
  /** Einladung für genau einen Mitspieler → Promise<Code> */
  async function createInvite() {
    if (role !== 'host') throw new Error('Eröffne zuerst ein Spiel.');
    if (peers.length >= MAX) throw new Error(`Das Spiel ist voll (${MAX} Spieler).`);
    for (const old of [...pending.values()]) { if (pending.size < 6) break; if (!old.busy) { pending.delete(old.key); old.pc.close(); } }     // die ältesten verfallen
    const pc = peerConnection();
    const inv = { key: rid(), code: '', pc, at: Date.now(), busy: false, r: pc.createDataChannel('r', { ordered: true }), u: pc.createDataChannel('u', { ordered: false, maxRetransmits: 0 }) };
    pending.set(inv.key, inv);
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      if (!pending.has(inv.key)) throw new Error('Die Einladung wurde verworfen.');
      if (!hasWay(pc)) throw new Error(NO_WAY);
      inv.code = await pack({ k: 'i', i: inv.key, n: name, s: pc.localDescription.sdp });
      tell('code', 'i');
      return inv.code;
    } catch (err) {
      pending.delete(inv.key);
      pc.close();
      throw err;
    }
  }
  /** Antwort eines Mitspielers einlösen → Promise<{ id, name }>, sobald die Verbindung steht */
  async function acceptAnswer(code) {
    if (role !== 'host') throw new Error('Eröffne zuerst ein Spiel.');
    const a = await unpack(code, 'a');
    const inv = pending.get(a.i);
    if (!inv) throw new Error(pending.size ? 'Diese Antwort gehört zu keiner offenen Einladung. Dein Mitspieler braucht einen aktuellen Einladungscode.' : 'Zu dieser Antwort gibt es keine offene Einladung mehr. Erstelle eine neue Einladung.');
    if (inv.busy) throw new Error('Diese Antwort wird gerade schon verarbeitet.');
    if (peers.length >= MAX) throw new Error(`Das Spiel ist voll (${MAX} Spieler).`);
    inv.busy = true;
    try {
      await inv.pc.setRemoteDescription({ type: 'answer', sdp: a.s });
      await opened(inv.r, inv.pc);
    } catch {
      pending.delete(inv.key);
      inv.pc.close();
      throw Object.assign(new Error('Die Verbindung kam nicht zustande. Erstelle eine neue Einladung und versucht es noch einmal.'), { gone: true });
    }
    if (role !== 'host' || !pending.delete(inv.key)) { inv.pc.close(); throw new Error('Das Spiel wurde inzwischen geschlossen.'); }
    let nick = cleanName(a.n);
    for (let k = 2; peers.some((p) => p.name === nick); k++) nick = `${cleanName(a.n).slice(0, 17)} ${k}`;
    const link = { id: nextId++, name: nick, pc: inv.pc, r: inv.r, u: inv.u, seen: performance.now(), ping: 0, ready: true };
    links.set(link.id, link);
    link.r.onmessage = receiver(link, true);
    link.u.onmessage = receiver(link, false);
    link.r.onclose = () => drop(link);
    link.pc.onconnectionstatechange = () => { if (link.pc.connectionState === 'failed' || link.pc.connectionState === 'closed') drop(link); };
    raw(link, { _: 'welcome', id: link.id, list: hostList() }, true);
    syncPeers();
    say(`${link.name} ist dabei.`);
    tell('joined', { id: link.id, name: link.name });
    return { id: link.id, name: link.name };
  }
  /** Gastgeber: ein Mitspieler ist weg (gegangen, entfernt oder verstummt) */
  function drop(link, why = '') {
    if (links.get(link.id) !== link) return;
    links.delete(link.id);
    if (why) raw(link, { _: 'bye', why }, true);
    end(link);
    syncPeers();
    say(why === 'kick' ? `${link.name} wurde entfernt.` : `${link.name} hat das Spiel verlassen.`);
    tell('left', { id: link.id, name: link.name });
  }
  function kick(id) { const link = links.get(id); if (role === 'host' && link) drop(link, 'kick'); }

  // ---------- Mitspieler ----------
  /** Einladung annehmen → Promise<Antwortcode>. Verbunden ist man erst, wenn der Gastgeber die Antwort einlöst. */
  async function join(code) {
    if (role === 'host') throw new Error('Du hast selbst ein Spiel eröffnet. Schließe es, bevor du einem anderen beitrittst.');
    const inv = await unpack(code, 'i');
    if (up) shut(null);                         // ein früherer Versuch
    const pc = peerConnection();
    const link = { id: 0, name: cleanName(inv.n), pc, r: null, u: null, seen: performance.now(), ping: 0, ready: false };
    up = link; role = 'client'; myId = -1;
    pc.ondatachannel = (e) => {
      const ch = e.channel, sure = ch.label === 'r';
      if (sure) { link.r = ch; ch.onclose = () => { if (up === link) shut('host'); }; } else link.u = ch;
      ch.onmessage = receiver(link, sure);
    };
    pc.onconnectionstatechange = () => { if (up === link && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) shut('host'); };
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: inv.s });
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
    } catch {
      if (up === link) shut(null);
      throw new Error('Mit dieser Einladung lässt sich keine Verbindung aufbauen. Bitte den Gastgeber um eine neue.');
    }
    if (up !== link) throw new Error('Der Beitritt wurde abgebrochen.');
    if (!hasWay(pc)) { shut(null); throw new Error(NO_WAY); }
    startTimer();
    say(`Warte auf ${link.name} …`);
    const reply = await pack({ k: 'a', i: inv.i, n: name, s: pc.localDescription.sdp });
    if (up === link) { link.code = reply; tell('code', 'a'); }         // bleibt abrufbar, solange auf den Gastgeber gewartet wird
    return reply;
  }
  /** Mitspieler: Verbindung zum Gastgeber ist zu Ende. reason: 'host' | 'kick' | null (selbst gegangen) */
  function shut(reason) {
    const link = up;
    if (!link) return;
    up = null; role = null; myId = -1;
    stopTimer();
    end(link);
    setPeers([]);
    if (reason) {
      say(reason === 'kick' ? 'Der Gastgeber hat dich aus dem Spiel entfernt.' : 'Die Verbindung zum Gastgeber ist getrennt.');
      call(opts.onClosed, reason);
      tell('closed', reason);
    }
  }

  // ---------- für alle ----------
  /** msg an to (Kennung) oder an alle (null); Mitspieler erreichen immer nur den Gastgeber. Liefert, ob etwas hinausging. */
  function send(msg, to = null, reliable = true) {
    const data = JSON.stringify(msg);
    if (data.length > BIG) console.warn(`[Netz] Große Nachricht (${data.length} Zeichen) – besser aufteilen.`);
    let n = 0;
    if (role === 'host') { for (const l of links.values()) if (to == null || l.id === to) n += push(l, data, reliable); }
    else if (up?.ready) n = push(up, data, reliable);
    return n > 0;
  }
  /** Alles beenden: Mitspielern Bescheid geben, Verbindungen und Zeitgeber abräumen. */
  function close() {
    if (role === 'host') {
      cast({ _: 'bye', why: 'host' });
      for (const l of links.values()) end(l);
      links.clear();
      for (const inv of pending.values()) inv.pc.close();
      pending.clear();
    } else if (up) {
      if (up.ready) raw(up, { _: 'bye' }, true);
      end(up);
      up = null;
    }
    const was = role;
    role = null; myId = -1; nextId = 1; status = '';
    stopTimer();
    if (was || peers.length) { setPeers([]); tell('status', ''); }
  }

  return {
    maxPeers: MAX,
    get role() { return role; },
    get id() { return myId; },
    get peers() { return peers; },
    /** true, sobald Nachrichten fließen können (Gastgeber: sofort; Mitspieler: nach der Begrüßung) */
    get connected() { return role === 'host' || !!up?.ready; },
    get status() { return status; },
    get invites() { return pending.size; },
    /** Codes aller Einladungen, die noch eingelöst werden können */
    get openInvites() { return [...pending.values()].filter((v) => v.code).map((v) => v.code); },
    /** Der eigene Antwortcode, solange der Gastgeber ihn noch nicht eingelöst hat (sonst leer) */
    get answerCode() { return up && !up.ready ? up.code || '' : ''; },
    get name() { return name; },
    /** Name für künftige Einladungen und Beitritte */
    setName(n) { name = cleanName(n); if (role === 'host') syncPeers(); },
    /** Zuhören (für die Lobby): fn(Art, Daten) mit 'peers' | 'status' | 'open' | 'joined' | 'left' | 'closed' → Abmelden */
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    host, createInvite, acceptAnswer, join, send, kick, close,
  };
}

/**
 * Mehrspieler-Seite fürs Menü: Spiel eröffnen oder beitreten, Codes austauschen, Spielerliste.
 * opts: { user, onStart(), canStart(), summary() }. Liefert eine Aufräum-Funktion; aufräumen(true) lässt die Verbindung bestehen
 * (wenn die Partie beginnt), ohne Argument wird sie geschlossen.
 */
function netLobby(container, net, opts = {}) {
  const root = h('div.szn', { tabIndex: -1, style: { outline: 'none' } });
  let view = net.role === 'host' ? 'host' : net.role === 'client' ? 'join' : 'choice';
  let flash = '';                       // Hinweis über der Auswahl, etwa nach einer Trennung
  let answer = net.answerCode || '';    // Beitritt: der eigene Antwortcode, solange auf den Gastgeber gewartet wird
  let refresh = () => {};               // aktualisiert die laufende Ansicht, ohne Eingaben zu verlieren
  let alive = true;
  if (opts.user) net.setName(opts.user);

  /** Knopf mit (optionalem) Symbol; die Beschriftung lässt sich nachträglich ändern */
  function btn(cls, label, ico, onclick) {
    const b = h(`button.kit-btn${cls}`, { type: 'button', onclick });
    b.innerHTML = `${ico ? icon(ico) : ''}<span></span>`;
    b.lastChild.textContent = label;
    return b;
  }
  const setLabel = (b, label) => { b.lastChild.textContent = label; };
  const setIcon = (b, name) => { const svg = b.querySelector('svg'); if (svg) svg.outerHTML = icon(name); };
  const step = (n, text) => h('div.szn-step', h('i', String(n)), h('span', text));
  /** Textfeld für Codes. Tasten bleiben im Feld (außer Esc), damit das Spiel darunter nichts mitliest. */
  function field(props) {
    const el = h('textarea.kit-field', { rows: 3, spellcheck: false, autocomplete: 'off', autocapitalize: 'off', ...props });
    el.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    return el;
  }
  /** Code zum Weitergeben: nur lesbar, mit Kopierknopf */
  function codeBox(code, label, first = false) {
    const area = field({ readOnly: true, value: code, 'aria-label': label });
    area.addEventListener('focus', () => area.select());
    const b = btn('', 'Kopieren', 'copy', async () => {
      let ok = false;
      try { await navigator.clipboard.writeText(code); ok = true; } catch { /* Zwischenablage gesperrt */ }
      if (!ok) { area.focus(); area.select(); try { ok = document.execCommand('copy'); } catch { ok = false; } }
      setIcon(b, ok ? 'check' : 'copy');
      setLabel(b, ok ? 'Kopiert' : 'Markiert');
      setTimeout(() => { if (b.isConnected) { setIcon(b, 'copy'); setLabel(b, 'Kopieren'); } }, 1800);
    });
    if (first) b.dataset.autofocus = '';
    return h('div.szn-code', area, b);
  }
  function playerRow(p) {
    const tone = p.ping < 90 ? 'var(--c-mint)' : p.ping < 180 ? 'var(--c-amber)' : 'var(--c-coral)';
    return h('div.szn-player',
      h('span.szn-ava', { style: { '--hue': (p.id * 67 + 205) % 360 } }, (p.name.trim()[0] || '?').toUpperCase()),
      h('span.szn-name', p.name),
      p.id === 0 ? h('span.szn-tag.host', 'Gastgeber') : null,
      p.me ? h('span.szn-tag', 'du') : null,
      h('span.sp'),
      p.id === 0 || (p.me && net.role === 'host') ? null : h('span.szn-ping', { style: { '--c': tone }, title: 'Laufzeit zum Gastgeber' }, p.ping ? `${p.ping} ms` : '– ms'),
      net.role === 'host' && !p.me ? h('button.szn-kick', { type: 'button', title: `${p.name} entfernen`, 'aria-label': `${p.name} entfernen`, html: icon('close'), onclick: () => net.kick(p.id) }) : null);
  }
  function playerList() {
    const count = h('em'), rows = h('div.szn-players.scroll');
    let key = '';
    const paint = () => {
      count.textContent = `${net.peers.length} von ${net.maxPeers}`;
      // nur neu aufbauen, wenn sich die Besetzung ändert – sonst bloß die Laufzeiten nachtragen
      const k = net.peers.map((p) => `${p.id}:${p.name}`).join('|');
      if (k !== key) { key = k; rows.replaceChildren(...net.peers.map(playerRow)); return; }
      net.peers.forEach((p, i) => {
        const el = rows.children[i]?.querySelector('.szn-ping');
        if (!el) return;
        el.textContent = p.ping ? `${p.ping} ms` : '– ms';
        el.style.setProperty('--c', p.ping < 90 ? 'var(--c-mint)' : p.ping < 180 ? 'var(--c-amber)' : 'var(--c-coral)');
      });
    };
    paint();
    return { el: h('div.szn-list', h('div.szn-list-head', h('span', 'Spieler'), count), rows), paint };
  }
  const FINE = 'Ihr spielt direkt von Gerät zu Gerät, ohne Server. Um den Weg durchs Netz zu finden, fragt dein Browser dabei einen öffentlichen STUN-Dienst von Google (stun.l.google.com) – erst, wenn du ein Spiel eröffnest oder beitrittst.';

  // ---------- Auswahl ----------
  function choiceView() {
    refresh = () => {};
    const err = h('div.szn-err', { role: 'alert' }, flash);
    flash = '';
    const pick = (ico, title, text, fn) => h('button.szn-pick', { type: 'button', html: icon(ico), onclick: fn }, h('b', title), h('span', text));
    return [
      err,
      h('div.szn-choice',
        pick('wifi', 'Spiel eröffnen', `Du bist Gastgeber, lädst bis zu ${net.maxPeers - 1} Mitspieler ein und startest die Partie.`, () => {
          try { net.host(); show('host'); } catch (e) { err.textContent = e.message; }
        }),
        pick('arrowRight', 'Spiel beitreten', 'Du hast von jemandem einen Einladungscode bekommen.', () => { answer = ''; show('join'); })),
      h('ol.szn-how',
        h('li', 'Eine Person eröffnet das Spiel und schickt jedem Mitspieler einen eigenen Einladungscode – per Messenger, Mail, wie ihr mögt.'),
        h('li', 'Wer beitritt, fügt den Code ein und schickt den Antwortcode zurück, der daraufhin erscheint.'),
        h('li', 'Sobald der Gastgeber die Antwort einfügt, seid ihr verbunden. Er startet die Partie für alle.')),
      h('p.szn-fine', `Du spielst als ${net.name}. ${FINE}`),
    ];
  }

  // ---------- Gastgeber ----------
  function hostView() {
    const sum = h('span.szn-sum'), list = playerList(), box = h('div.szn-card');
    const err = h('div.szn-err', { role: 'alert' }), note = h('div.szn-note', { role: 'status' });
    const bStart = btn('.primary.big', 'Partie starten', 'play', () => opts.onStart?.());
    let sure = 0;
    const bLeave = btn('', 'Spiel schließen', '', () => {
      if (net.peers.length > 1 && !sure) {
        setLabel(bLeave, 'Wirklich schließen?');
        bLeave.classList.add('danger');
        sure = setTimeout(() => { sure = 0; if (bLeave.isConnected) { setLabel(bLeave, 'Spiel schließen'); bLeave.classList.remove('danger'); } }, 3000);
        return;
      }
      clearTimeout(sure);
      net.close();
      show('choice');
    });

    // Einladen: der zuletzt erstellte Code steht da; das Antwortfeld löst jede noch offene Einladung ein
    let code = net.openInvites[net.openInvites.length - 1] || '', making = false;      // nach einem Seitenwechsel: die jüngste offene Einladung
    const input = field({ placeholder: 'Antwortcode hier einfügen (beginnt mit SZ1-)', 'aria-label': 'Antwortcode' });
    const bGo = btn('.primary', 'Verbinden', 'check', async () => {
      err.textContent = ''; note.textContent = '';
      bGo.disabled = true;
      setLabel(bGo, 'Verbinde …');
      try {
        const who = await net.acceptAnswer(input.value);
        if (!alive || view !== 'host') return;
        input.value = '';
        paintBox();
        note.textContent = `${who.name} ist dabei.`;
      } catch (e) {
        if (!alive || view !== 'host') return;
        if (e.gone) { input.value = ''; paintBox(); }          // diese Einladung ist verbraucht
        err.textContent = e.message;
      }
      bGo.disabled = false;
      setLabel(bGo, 'Verbinden');
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); bGo.click(); } });
    const answerRow = h('div.szn-code', input, bGo);
    const bNew = btn('', 'Einladung erstellen', 'plus', async () => {
      err.textContent = ''; note.textContent = '';
      making = true;
      paintNew();
      try { code = await net.createInvite(); } catch (e) { if (alive) err.textContent = e.message; }
      making = false;
      if (alive && view === 'host') paintBox();
    });
    function paintNew() {
      bNew.disabled = making || net.peers.length >= net.maxPeers;
      bNew.classList.toggle('primary', !code);
      setLabel(bNew, making ? 'Einladung wird erstellt …' : code ? 'Weitere Einladung' : 'Einladung erstellen');
    }
    function paintBox() {
      if (code && !net.openInvites.includes(code)) code = '';
      const prev = document.activeElement, had = root.contains(prev);
      const full = net.peers.length >= net.maxPeers, typing = prev === input;
      paintNew();
      if (code) {
        box.replaceChildren(
          step(1, 'Schick diesen Einladungscode an einen Mitspieler'),
          codeBox(code, 'Einladungscode'),
          step(2, 'Füge hier den Antwortcode ein, den du zurückbekommst'),
          answerRow, note, err,
          h('div.szn-row', h('p.szn-fine', 'Jede Einladung gilt für eine Person. Mehrere dürfen gleichzeitig offen sein.'), bNew));
      } else {
        box.replaceChildren(
          h('div.szn-step', h('span', 'Mitspieler einladen')),
          h('p.szn-text', full ? 'Das Spiel ist voll.' : 'Jeder Mitspieler bekommt eine eigene Einladung: Code erstellen, verschicken, Antwort einfügen – fertig.'),
          h('div.szn-row', bNew),
          net.invites ? h('div.szn-step', h('span', 'Antwort auf eine frühere Einladung')) : '',
          net.invites ? answerRow : '',
          note, err);
      }
      if (typing) input.focus({ preventScroll: true }); else keepFocus(had, prev);
    }
    refresh = (type, data) => {
      sum.textContent = opts.summary?.() || '';
      list.paint();
      bStart.disabled = opts.canStart ? !opts.canStart() : false;
      if (type === 'left' || type === 'joined') paintBox();
      if (type === 'left' && data) note.textContent = `${data.name} hat das Spiel verlassen.`;
      if (type === 'code' && !code && !making) { code = net.openInvites[net.openInvites.length - 1] || ''; paintBox(); }      // eine Einladung wurde fertig, während die Seite verlassen war
    };
    paintBox();
    refresh();
    return [
      h('div.szn-head', h('div', h('b', 'Dein Spiel'), sum), bLeave),
      list.el,
      box,
      h('div.szn-foot', h('p.szn-fine', 'Freie Plätze füllen Bots auf. Wer später dazukommen soll, braucht wieder eine Einladung von dir.'), bStart),
    ];
  }

  // ---------- Mitspieler ----------
  function joinView() {
    const err = h('div.szn-err', { role: 'alert' });
    const back = btn('', net.connected ? 'Spiel verlassen' : 'Zurück', net.connected ? '' : 'arrowLeft', () => { answer = ''; net.close(); show('choice'); });
    if (net.role === 'client' && net.connected) {
      const sum = h('span.szn-sum'), list = playerList();
      refresh = () => { sum.textContent = opts.summary?.() || ''; list.paint(); };
      refresh();
      return [
        h('div.szn-head', h('div', h('b', 'Du bist dabei'), sum), back),
        h('div.szn-ok', { html: icon('check') }, h('span', 'Verbunden. Der Gastgeber startet die Partie – du musst nichts weiter tun.')),
        list.el,
      ];
    }
    refresh = () => {};
    if (answer && net.role === 'client') {
      return [
        h('div.szn-head', h('div', h('b', 'Spiel beitreten'), h('span.szn-sum', net.status)), back),
        h('div.szn-card',
          step(2, 'Schick diesen Antwortcode zurück an den Gastgeber'),
          codeBox(answer, 'Antwortcode', true),
          h('p.szn-text', 'Sobald der Gastgeber deinen Code einfügt, seid ihr verbunden. Lass dieses Fenster so lange offen.'),
          h('div.szn-row',
            h('div.szn-wait', h('span.szn-spin'), h('span', 'Warte auf den Gastgeber …')), h('span.sp'),
            h('button.szn-link', { type: 'button', onclick: () => { answer = ''; net.close(); show('join'); } }, 'Anderen Code eingeben'))),
        h('p.szn-fine', FINE),
      ];
    }
    const input = field({ placeholder: 'Einladungscode hier einfügen (beginnt mit SZ1-)', 'aria-label': 'Einladungscode' });
    const bGo = btn('.primary', 'Antwort erzeugen', 'arrowRight', async () => {
      err.textContent = '';
      bGo.disabled = true;
      setLabel(bGo, 'Einen Moment …');
      try {
        const code = await net.join(input.value);
        if (!alive || view !== 'join') return;
        answer = code;
        render();
      } catch (e) {
        if (!alive || view !== 'join') return;
        err.textContent = e.message;
        bGo.disabled = false;
        setLabel(bGo, 'Antwort erzeugen');
      }
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); bGo.click(); } });
    requestAnimationFrame(() => { if (input.isConnected) input.focus({ preventScroll: true }); });
    return [
      h('div.szn-head', h('div', h('b', 'Spiel beitreten'), h('span.szn-sum', `Du spielst als ${net.name}`)), back),
      h('div.szn-card',
        step(1, 'Füge den Einladungscode des Gastgebers ein'),
        h('div.szn-code', input, bGo),
        err,
        h('p.szn-text', 'Danach bekommst du einen Antwortcode, den du dem Gastgeber zurückschickst.')),
      h('p.szn-fine', FINE),
    ];
  }

  /**
   * Nach einem Umbau den Fokus in der Ansicht halten: auf dem Element von vorher, sonst auf dem nächsten sinnvollen Schritt –
   * nie von selbst auf „Schließen“ oder „Verlassen“. Ohne das fiele er aufs Dokument, und Tab oder Esc liefen am Menü vorbei.
   */
  function keepFocus(had, prev) {
    if (!had || root.contains(document.activeElement)) return;
    const next = (prev?.isConnected && !prev.disabled ? prev : null) || root.querySelector('[data-autofocus]') || root.querySelector('button.primary:not(:disabled)') || root;
    next.focus({ preventScroll: true });
  }
  function render() {
    const prev = document.activeElement, had = root.contains(prev);
    root.replaceChildren(...(view === 'host' ? hostView() : view === 'join' ? joinView() : choiceView()).filter(Boolean));
    keepFocus(had, prev);
  }
  function show(v) { view = v; render(); }

  const off = net.on((type, data) => {
    if (!alive) return;
    if (type === 'closed') {
      answer = '';
      flash = data === 'kick' ? 'Der Gastgeber hat dich aus dem Spiel entfernt.' : 'Die Verbindung zum Gastgeber ist getrennt.';
      show('choice');
    } else if (type === 'open') render();
    else if (view === 'host' && net.role !== 'host') show('choice');        // von außen geschlossen
    else if (type === 'code' && view === 'join') { if (!answer && net.answerCode) { answer = net.answerCode; render(); } }      // Antwort wurde fertig, während die Seite verlassen war
    else refresh(type, data);
  });

  container.append(root);
  render();
  return (keep = false) => {
    alive = false;
    off();
    root.remove();
    if (!keep) net.close();
  };
}

// ==========================================================================
// 11 · Menüs
// ==========================================================================
// ---------- Menüs: Hauptmenü, Pause, Auswertung, Ladebild ----------
// Eigene Farbwerte (immer dunkel, unabhängig vom Design des Systems); die Größen hängen an der Bühne (Container „szm“).
const MENU_CSS = `
.szm { position: absolute; inset: 0; z-index: 20; overflow: hidden; container: szm / size; color-scheme: dark; outline: 0;
  --fg: #f2f5fb; --fg-2: rgba(242, 245, 251, .78); --fg-3: rgba(242, 245, 251, .56); --fg-4: rgba(242, 245, 251, .28);
  --line: rgba(255, 255, 255, .12); --well: rgba(0, 0, 0, .36); --raise: rgba(255, 255, 255, .075); --raise-2: rgba(255, 255, 255, .15);
  --glass-hi: rgba(255, 255, 255, .5); --glass-edge: rgba(255, 255, 255, .15);
  --szm-ink: 6, 8, 13; --szm-own: #5aa8ff; --szm-foe: #ff6b62; --szm-gold: #ffc56b;
  color: var(--fg); font-family: var(--font); line-height: 1.35; cursor: default; user-select: none; -webkit-user-select: none; }
.szm button { -webkit-tap-highlight-color: transparent; }
.szm :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.szm-screen { position: absolute; inset: 0; display: flex; min-width: 0; font-size: clamp(11.5px, .65cqw + .95cqh, 20px); animation: szm-fade .3s ease both; }
@keyframes szm-fade { from { opacity: 0; } }
@keyframes szm-rise { from { opacity: 0; transform: translateY(.7em); } }
@keyframes szm-pop { 0% { transform: scale(.7); opacity: 0; } 60% { transform: scale(1.08); } }

/* ---------- Gerüst: Seitenleiste und Inhalt ---------- */
.szm-shell { gap: 1.5em; padding: 1.9em 2em 1.7em 2.2em;
  background: linear-gradient(90deg, rgba(var(--szm-ink), .92) 0%, rgba(var(--szm-ink), .74) 22%, rgba(var(--szm-ink), .26) 58%, rgba(var(--szm-ink), .4) 100%), linear-gradient(0deg, rgba(var(--szm-ink), .6), transparent 42%); }
.szm-shell.is-pause { background: linear-gradient(90deg, rgba(var(--szm-ink), .93) 0%, rgba(var(--szm-ink), .78) 24%, rgba(var(--szm-ink), .5) 100%); -webkit-backdrop-filter: blur(5px) saturate(80%); backdrop-filter: blur(5px) saturate(80%); }
.szm-side { display: flex; flex-direction: column; flex: none; width: 16.5em; min-height: 0; }
.szm-logo { font-size: 2.75em; font-weight: 900; letter-spacing: .045em; line-height: .92; text-transform: uppercase; text-shadow: 0 .1em .9em rgba(0, 0, 0, .55); }
.szm-logo em { display: block; font-style: normal; color: var(--accent); }
.szm-stripe { flex: none; width: 8.4em; height: .42em; margin: .8em 0 .65em; border-radius: 1px; background: repeating-linear-gradient(-45deg, var(--accent) 0 .42em, transparent .42em .84em); }
.szm-tag { font: 600 .72em/1.3 var(--mono); letter-spacing: .16em; text-transform: uppercase; color: var(--fg-3); }
.szm-nav { display: flex; flex-direction: column; gap: .22em; margin-top: 1.5em; }
.szm-nav button { position: relative; display: flex; align-items: center; gap: .8em; padding: .6em .8em; border: 0; border-radius: .7em; background: none; color: var(--fg-2);
  font-size: 1.1em; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; text-align: left; transition: background-color .2s, color .2s, transform .4s var(--spring); }
.szm-nav button i { font: 600 .62em/1 var(--mono); letter-spacing: .04em; font-style: normal; color: var(--fg-4); }
.szm-nav button:hover { background: var(--raise); color: var(--fg); }
.szm-nav button:active { transform: scale(.975); }
.szm-nav button[aria-current] { background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 34%, transparent), transparent 88%); color: #fff; }
.szm-nav button[aria-current]::before { content: ""; position: absolute; left: 0; top: 20%; bottom: 20%; width: 3px; border-radius: 3px; background: var(--accent); box-shadow: 0 0 .8em var(--accent); }
.szm-nav button[aria-current] i { color: var(--accent); }
.szm-nav button.is-danger:hover { color: var(--szm-foe); }
.szm-nav button.is-go { color: #fff; }
.szm-nav button.is-go i { color: var(--accent); }
.szm-nav button span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.szm-me { display: grid; grid-template-columns: auto 1fr; gap: .1em .8em; align-items: center; margin-top: auto; padding: .8em .9em; border-radius: .9em;
  background: rgba(var(--szm-ink), .55); box-shadow: inset 0 0 0 .5px var(--line); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
.szm-ins { display: grid; place-items: center; width: 2.9em; height: 2.9em; border-radius: .7em; color: var(--szm-gold);
  background: linear-gradient(160deg, rgba(255, 255, 255, .14), rgba(255, 255, 255, .03)); box-shadow: inset 0 0 0 .5px var(--glass-edge); }
.szm-ins svg { width: 82%; height: 82%; }
.szm-me .szm-ins { grid-row: 1 / span 2; }
.szm-me b { overflow: hidden; font-size: 1.02em; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; align-self: end; }
.szm-me small { font-size: .82em; color: var(--fg-3); align-self: start; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.szm-me .szm-xp { grid-column: 1 / -1; margin-top: .55em; }
.szm-xpt { grid-column: 1 / -1; display: flex; justify-content: space-between; gap: 1em; margin-top: .3em; font: 600 .7em/1.2 var(--mono); letter-spacing: .05em; color: var(--fg-3); white-space: nowrap; }
.szm-xp { height: .5em; border-radius: 99px; overflow: hidden; background: var(--well); box-shadow: inset 0 0 0 1px var(--line); }
.szm-xp i { display: block; width: calc(var(--p, 0) * 100%); height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--szm-gold), var(--accent)); }
.szm-main { display: flex; flex: 1; min-width: 0; min-height: 0; max-width: 62em; }

/* ---------- Tafel ---------- */
.szm-panel { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; overflow: hidden; border-radius: 1.1em; background: rgba(9, 12, 19, .7);
  -webkit-backdrop-filter: blur(18px) saturate(140%); backdrop-filter: blur(18px) saturate(140%);
  box-shadow: inset 0 0 0 .5px var(--glass-edge), inset 0 1px 0 rgba(255, 255, 255, .09), 0 2em 5em -2em rgba(0, 0, 0, .85); animation: szm-rise .38s var(--ease-out) both; }
.szm-head { display: flex; align-items: baseline; gap: 1em; flex: none; padding: 1em 1.4em .8em; border-bottom: .5px solid var(--line); }
.szm-head h2 { font-size: 1.2em; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; }
.szm-head span { min-width: 0; overflow: hidden; font-size: .9em; color: var(--fg-3); text-overflow: ellipsis; white-space: nowrap; }
.szm-body { flex: 1; min-height: 0; padding: 1.1em 1.4em 1.3em; overflow: auto; scrollbar-width: thin; scrollbar-color: var(--fg-4) transparent; }
.szm-foot { display: flex; align-items: center; gap: 1em; flex: none; padding: .8em 1.4em; border-top: .5px solid var(--line); background: rgba(0, 0, 0, .24); }
.szm-foot p { flex: 1; min-width: 0; overflow: hidden; font-size: .88em; color: var(--fg-3); text-overflow: ellipsis; white-space: nowrap; }
.szm-sec + .szm-sec { margin-top: 1.25em; }
.szm-lab { display: flex; align-items: center; gap: .7em; margin-bottom: .65em; font: 650 .72em/1 var(--mono); letter-spacing: .16em; text-transform: uppercase; color: var(--fg-3); white-space: nowrap; }
.szm-lab::after { content: ""; flex: 1; height: .5px; background: var(--line); }
.szm-note { display: flex; align-items: center; gap: .6em; padding: .6em .8em; border-radius: .7em; background: color-mix(in srgb, var(--accent) 14%, transparent); box-shadow: inset 0 0 0 .5px color-mix(in srgb, var(--accent) 50%, transparent); font-size: .88em; color: var(--fg-2); }
.szm-note .ico { width: 1.1em; height: 1.1em; color: var(--accent); }

/* ---------- Knöpfe und Bedienelemente ---------- */
.szm-btn { display: inline-flex; align-items: center; justify-content: center; gap: .5em; flex: none; padding: .62em 1.15em; border: 0; border-radius: .75em; background: var(--raise); color: var(--fg);
  font-size: .95em; font-weight: 700; letter-spacing: .03em; line-height: 1.2; white-space: nowrap; box-shadow: inset 0 0 0 .5px var(--line); transition: transform .4s var(--spring), background-color .15s, filter .15s; }
.szm-btn:hover:not(:disabled) { background: var(--raise-2); }
.szm-btn:active:not(:disabled) { transform: scale(.96); }
.szm-btn .ico { width: 1.05em; height: 1.05em; }
.szm-btn.primary { background: linear-gradient(160deg, rgba(255, 255, 255, .3), rgba(255, 255, 255, 0) 45%, rgba(0, 0, 0, .14)), var(--accent); color: #fff; letter-spacing: .1em; text-transform: uppercase;
  box-shadow: 0 .9em 2em -.9em color-mix(in srgb, var(--accent) 85%, transparent), inset 0 1px 0 rgba(255, 255, 255, .45); }
.szm-btn.primary:hover:not(:disabled) { background: linear-gradient(160deg, rgba(255, 255, 255, .3), rgba(255, 255, 255, 0) 45%, rgba(0, 0, 0, .14)), var(--accent); filter: brightness(1.12); }
.szm-btn.danger { background: #d9434a; color: #fff; }
.szm-btn.danger:hover:not(:disabled) { background: #d9434a; filter: brightness(1.12); }
.szm-btn.big { padding: .85em 1.7em; font-size: 1.05em; }
.szm-btn.small { padding: .45em .9em; font-size: .86em; }
.szm-cards { display: grid; gap: .55em; }
.szm-card { position: relative; display: grid; gap: .2em; align-content: start; min-width: 0; padding: .7em .9em; border: 0; border-radius: .8em; background: var(--raise); color: var(--fg-3); text-align: left;
  box-shadow: inset 0 0 0 .5px var(--line); transition: background-color .2s, box-shadow .2s, transform .4s var(--spring); }
.szm-card b { font-size: 1.02em; font-weight: 750; letter-spacing: .02em; color: var(--fg); }
.szm-card span { font-size: .84em; text-wrap: pretty; }
.szm-card:hover { background: var(--raise-2); }
.szm-card:active { transform: scale(.985); }
.szm-card[aria-checked="true"] { background: color-mix(in srgb, var(--accent) 20%, rgba(255, 255, 255, .05)); box-shadow: inset 0 0 0 1.5px var(--accent); color: var(--fg-2); }
.szm-card[aria-checked="true"]::after { content: ""; position: absolute; top: .7em; right: .7em; width: .55em; height: .55em; border-radius: 50%; background: var(--accent); box-shadow: 0 0 .7em var(--accent); }
.szm-map { padding: 0; overflow: hidden; }
.szm-map .szm-art { height: 4.6em; }
.szm-art svg { display: block; width: 100%; height: 100%; }
.szm-map b, .szm-map span { padding: 0 .85em; }
.szm-map b { margin-top: .5em; }
.szm-map span { padding-bottom: .7em; }
.szm-map[aria-checked="true"]::after { top: .6em; right: .6em; box-shadow: 0 0 0 .2em rgba(0, 0, 0, .35), 0 0 .7em var(--accent); }
.szm-row { display: flex; flex-wrap: wrap; align-items: center; gap: .4em 1em; min-height: 3em; padding: .45em 0; border-top: .5px solid var(--line); }
.szm-row:first-child, .szm-lab + .szm-row { border-top: 0; padding-top: 0; }
.szm-row-t { flex: 1 1 8em; min-width: 0; }
.szm-row-t b { display: block; font-weight: 600; }
.szm-row-t small { display: block; font-size: .84em; color: var(--fg-3); text-wrap: pretty; }
.szm-ctl { display: flex; align-items: center; justify-content: flex-end; gap: .7em; min-width: 0; }
.szm-val { min-width: 3.6em; font: 600 .9em/1 var(--mono); color: var(--fg-2); text-align: right; white-space: nowrap; }
.szm .gslider { width: 12em; }
.szm .gswitch { --w: 3.4em; --h: 2em; }
.szm .gseg button { padding: .45em .95em; font-size: .88em; }
.szm .gseg .ind.ind { background: linear-gradient(170deg, rgba(255, 255, 255, .22), rgba(255, 255, 255, .06)), var(--raise); box-shadow: inset 0 1px 0 var(--glass-hi), inset 0 0 0 .5px var(--glass-edge), 0 4px 14px rgba(0, 0, 0, .22); }
.szm-step { display: inline-flex; align-items: center; gap: .15em; padding: .2em; border-radius: 99px; background: var(--well); box-shadow: inset 0 0 0 1px var(--line); }
.szm-step button { display: grid; place-items: center; width: 2em; height: 2em; padding: 0; border: 0; border-radius: 50%; background: var(--raise); color: var(--fg); transition: background-color .15s, transform .4s var(--spring); }
.szm-step button:hover:not(:disabled) { background: var(--raise-2); }
.szm-step button:active:not(:disabled) { transform: scale(.88); }
.szm-step button:disabled { opacity: .35; }
.szm-step button .ico { width: 1em; height: 1em; }
.szm-step output { min-width: 2.3em; font: 750 1.08em/1 var(--font-round); font-variant-numeric: tabular-nums; text-align: center; }

/* ---------- Einsatz ---------- */
.szm-play { display: grid; grid-template-columns: 1.1fr 1fr; gap: 1.2em 1.7em; align-items: start; }
.szm-play > div { min-width: 0; }
.szm-maps { grid-template-columns: repeat(auto-fit, minmax(9.5em, 1fr)); }

/* ---------- Ausrüstung ---------- */
.szm-load { display: grid; grid-template-columns: minmax(11.5em, 15.5em) minmax(0, 1fr); gap: 1.2em; align-items: start; }
.szm-wlist { display: flex; flex-direction: column; gap: .4em; }
.szm-w { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) 4.4em; align-items: center; gap: 0 .6em; min-width: 0; padding: .5em .7em .5em .8em; border: 0; border-radius: .75em; background: var(--raise); color: var(--fg-3); text-align: left;
  box-shadow: inset 0 0 0 .5px var(--line); transition: background-color .2s, box-shadow .2s, opacity .2s; }
.szm-w b { overflow: hidden; font-weight: 700; color: var(--fg); text-overflow: ellipsis; white-space: nowrap; }
.szm-w small { grid-column: 1; overflow: hidden; font-size: .8em; text-overflow: ellipsis; white-space: nowrap; }
.szm-w .szm-mini { grid-area: 1 / 2 / span 2; height: 2em; opacity: .9; }
.szm-mini svg { display: block; width: 100%; height: 100%; }
.szm-w:hover { background: var(--raise-2); }
.szm-w.is-view { box-shadow: inset 0 0 0 1px var(--fg-3); }
.szm-w[aria-checked="true"] { background: color-mix(in srgb, var(--accent) 20%, rgba(255, 255, 255, .05)); box-shadow: inset 0 0 0 1.5px var(--accent); }
.szm-w[aria-checked="true"] small { color: var(--accent); font-weight: 650; }
.szm-w.is-locked b, .szm-w.is-locked .szm-mini { opacity: .5; }
.szm-w.is-locked small { display: flex; align-items: center; gap: .35em; }
.szm-w.is-locked small .ico { width: .95em; height: .95em; }
.szm-wd { display: flex; flex-direction: column; gap: .85em; min-width: 0; }
.szm-wart { position: relative; display: grid; place-items: center; height: 10.4em; overflow: hidden; border-radius: .9em; box-shadow: inset 0 0 0 .5px var(--line);
  background: radial-gradient(80% 120% at 50% 0%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 70%),
    linear-gradient(rgba(255, 255, 255, .045) 1px, transparent 1px) 0 0 / 100% 1.5em, linear-gradient(90deg, rgba(255, 255, 255, .045) 1px, transparent 1px) 0 0 / 1.5em 100%, rgba(0, 0, 0, .34); }
.szm-wart svg { width: 86%; height: 78%; filter: drop-shadow(0 .5em .9em rgba(0, 0, 0, .65)); animation: szm-rise .35s var(--ease-out) both; }
.szm-wart .szm-tag { position: absolute; left: .9em; top: .8em; }
.szm-wart .szm-lock { position: absolute; right: .8em; top: .7em; display: flex; align-items: center; gap: .4em; padding: .3em .7em; border-radius: 99px; background: rgba(0, 0, 0, .5); box-shadow: inset 0 0 0 .5px var(--line); font-size: .8em; font-weight: 650; color: var(--szm-gold); }
.szm-lock .ico { width: 1em; height: 1em; }
.szm-wart.is-locked svg { opacity: .62; filter: grayscale(1); }
.szm-wname { display: flex; flex-wrap: wrap; align-items: baseline; gap: .2em .8em; }
.szm-wname b { font-size: 1.35em; font-weight: 800; letter-spacing: .02em; }
.szm-wname span { color: var(--fg-3); }
.szm-wd > p { margin-top: -.5em; font-size: .92em; color: var(--fg-2); text-wrap: pretty; }
.szm-stats { display: grid; grid-template-columns: auto minmax(0, 1fr) 2.2em; gap: .5em .9em; align-items: center; font-size: .9em; }
.szm-stats span { color: var(--fg-2); }
.szm-stats b { font: 650 .92em/1 var(--mono); color: var(--fg-2); text-align: right; }
.szm-bar { height: .44em; overflow: hidden; border-radius: 99px; background: var(--well); box-shadow: inset 0 0 0 1px var(--line); }
.szm-bar i { display: block; width: calc(var(--v, 0) * 1%); height: 100%; border-radius: inherit; background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 55%, #fff 8%), var(--accent)); transition: width .45s var(--ease-out); }
.szm-facts { display: flex; flex-wrap: wrap; gap: .4em; }
.szm-chip { display: inline-flex; align-items: center; gap: .4em; padding: .3em .7em; border-radius: 99px; background: var(--raise); box-shadow: inset 0 0 0 .5px var(--line); font-size: .82em; font-weight: 600; color: var(--fg-2); white-space: nowrap; }
.szm-chip b { font-family: var(--font-round); font-weight: 750; color: var(--fg); }
.szm-kit { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .55em; }
.szm-kit > div { display: grid; grid-template-columns: 3em minmax(0, 1fr); align-items: center; gap: 0 .6em; padding: .55em .7em; border-radius: .75em; background: rgba(0, 0, 0, .22); box-shadow: inset 0 0 0 .5px var(--line); }
.szm-kit .szm-mini { grid-row: 1 / span 2; height: 1.9em; color: var(--fg-2); }
.szm-kit b { overflow: hidden; font-size: .9em; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.szm-kit small { overflow: hidden; font-size: .76em; color: var(--fg-3); text-overflow: ellipsis; white-space: nowrap; }

/* ---------- Laufbahn ---------- */
.szm-rank { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: .1em 1.1em; align-items: center; }
.szm-rank .szm-ins { grid-row: 1 / span 3; width: 4.6em; height: 4.6em; border-radius: 1em; }
.szm-rank h3 { font-size: 1.5em; font-weight: 800; letter-spacing: .02em; line-height: 1.1; }
.szm-rank h3 small { margin-left: .6em; font: 650 .5em/1 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--accent); vertical-align: middle; }
.szm-rank .szm-xp { height: .6em; margin-top: .45em; }
.szm-rank .szm-xpt { grid-column: 2; }
.szm-ladder { display: flex; gap: .35em; padding: .15em .1em .5em; overflow-x: auto; scrollbar-width: thin; scrollbar-color: var(--fg-4) transparent; }
.szm-ladder > div { display: grid; justify-items: center; align-content: start; gap: .2em; flex: none; width: 6.2em; padding: .5em .2em .45em; border-radius: .7em; background: rgba(0, 0, 0, .2); box-shadow: inset 0 0 0 .5px var(--line); color: var(--fg-4); text-align: center; }
.szm-ladder svg { width: 2em; height: 2em; }
.szm-ladder b { display: grid; align-items: center; max-width: 100%; min-height: 2.4em; font-size: .68em; font-weight: 650; line-height: 1.15; color: var(--fg-3); hyphens: auto; -webkit-hyphens: auto; overflow-wrap: anywhere; }
.szm-ladder small { font: 600 .62em/1 var(--mono); letter-spacing: .05em; }
.szm-ladder > .is-done { color: color-mix(in srgb, var(--szm-gold) 70%, transparent); }
.szm-ladder > .is-done b { color: var(--fg-2); }
.szm-ladder > .is-now { background: color-mix(in srgb, var(--accent) 22%, transparent); box-shadow: inset 0 0 0 1.5px var(--accent); color: var(--szm-gold); }
.szm-ladder > .is-now b { color: #fff; }
.szm-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .55em; }
.szm-tile { display: grid; gap: .15em; min-width: 0; padding: .7em .85em; border-radius: .8em; background: var(--raise); box-shadow: inset 0 0 0 .5px var(--line); }
.szm-tile span { overflow: hidden; font: 650 .66em/1.2 var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--fg-3); text-overflow: ellipsis; white-space: nowrap; }
.szm-tile b { font: 800 1.6em/1.1 var(--font-round); font-variant-numeric: tabular-nums; }
.szm-tile small { font-size: .78em; color: var(--fg-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.szm-two { display: grid; grid-template-columns: 1.25fr 1fr; gap: 1.2em 1.7em; align-items: start; }
.szm-two > div { min-width: 0; }
.szm-wk { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: .5em .9em; align-items: center; font-size: .9em; }
.szm-wk span { color: var(--fg-2); white-space: nowrap; }
.szm-wk b { min-width: 2em; font: 650 .92em/1 var(--mono); text-align: right; }
.szm-next { display: grid; gap: .5em; padding: .8em .9em; border-radius: .8em; background: rgba(0, 0, 0, .22); box-shadow: inset 0 0 0 .5px var(--line); }
.szm-next .szm-mini { height: 2.6em; }
.szm-next b { font-weight: 750; }
.szm-next small { color: var(--fg-3); font-size: .86em; }

/* ---------- Einstellungen ---------- */
.szm-keys { display: grid; grid-template-columns: repeat(auto-fill, minmax(13.5em, 1fr)); gap: .5em 1.4em; }
.szm-keys > div { display: flex; align-items: center; gap: .35em; min-width: 0; font-size: .88em; color: var(--fg-2); }
.szm-keys span { margin-left: auto; padding-left: .5em; overflow: hidden; color: var(--fg-3); text-overflow: ellipsis; white-space: nowrap; }
.szm-keys kbd { flex: none; min-width: 1.9em; padding: .25em .5em; border-radius: .45em; background: rgba(255, 255, 255, .1); box-shadow: inset 0 -1.5px 0 rgba(0, 0, 0, .45), inset 0 0 0 .5px var(--line); font: 650 .82em/1.2 var(--mono); color: var(--fg); text-align: center; }
.szm-empty { display: grid; justify-items: center; align-content: center; gap: .5em; min-height: 100%; padding: 2em 1em; color: var(--fg-3); text-align: center; }
.szm-empty .ico { width: 2.6em; height: 2.6em; color: var(--fg-4); }
.szm-empty b { font-size: 1.1em; color: var(--fg); }
.szm-empty span { max-width: 26em; font-size: .9em; text-wrap: balance; }
.szm-lobby { min-height: 100%; }

/* ---------- Rückfrage ---------- */
.szm-dim { position: absolute; inset: 0; z-index: 5; display: grid; place-items: center; padding: 1em; background: rgba(4, 6, 10, .62); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  font-size: clamp(11.5px, .65cqw + .95cqh, 20px); animation: szm-fade .2s ease both; }
.szm-dlg { display: grid; gap: .5em; width: min(25em, 100%); padding: 1.3em 1.4em 1.2em; border-radius: 1.1em; background: rgba(14, 17, 26, .94); box-shadow: inset 0 0 0 .5px var(--glass-edge), 0 2em 5em -1.5em rgba(0, 0, 0, .9); animation: szm-rise .3s var(--ease-out) both; }
.szm-dlg b { font-size: 1.15em; font-weight: 800; }
.szm-dlg p { font-size: .92em; color: var(--fg-2); text-wrap: pretty; }
.szm-dlg div { display: flex; justify-content: flex-end; gap: .6em; margin-top: .7em; }

/* ---------- Auswertung ---------- */
.szm-end { align-items: center; justify-content: center; padding: 1.5em; background: radial-gradient(120% 100% at 50% 0%, rgba(var(--szm-ink), .5), rgba(var(--szm-ink), .9)); }
.szm-end .szm-panel { flex: none; width: min(100%, 66em); max-height: 100%; }
.szm-end-head { display: flex; align-items: flex-end; gap: 1em 1.5em; flex: none; padding: 1.2em 1.6em 1em; border-bottom: .5px solid var(--line);
  background: linear-gradient(100deg, color-mix(in srgb, var(--szm-res) 26%, transparent), transparent 60%); }
.szm-end.is-win { --szm-res: var(--accent); }
.szm-end.is-loss { --szm-res: #7d8698; }
.szm-end.is-draw { --szm-res: var(--szm-gold); }
.szm-end-head > div { min-width: 0; }
.szm-end-title { font-size: 2.9em; font-weight: 900; letter-spacing: .06em; line-height: .95; text-transform: uppercase; white-space: nowrap; }
.szm-end.is-win .szm-end-title { color: var(--accent); text-shadow: 0 0 1.1em color-mix(in srgb, var(--accent) 60%, transparent); }
.szm-end.is-draw .szm-end-title { color: var(--szm-gold); }
.szm-end-head .szm-stripe { width: 7em; margin: .55em 0 .5em; background: repeating-linear-gradient(-45deg, var(--szm-res) 0 .42em, transparent .42em .84em); }
.szm-end-score { display: flex; align-items: center; gap: .5em; margin-left: auto; font: 800 2.5em/1 var(--font-round); font-variant-numeric: tabular-nums; }
.szm-end-score span { display: grid; justify-items: center; gap: .3em; }
.szm-end-score small { font: 650 .24em/1 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--fg-3); }
.szm-end-score i { font-style: normal; color: var(--fg-4); font-size: .7em; }
.szm-end-score .own { color: var(--szm-own); }
.szm-end-score .foe { color: var(--szm-foe); }
.szm-end-body { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 1.2em 1.6em; flex: 1; min-height: 0; padding: 1em 1.6em 1.2em; overflow: auto; scrollbar-width: thin; scrollbar-color: var(--fg-4) transparent; }
.szm-end-body > div { min-width: 0; }
.szm-tab { width: 100%; border-collapse: collapse; font-size: .92em; }
.szm-tab + .szm-tab { margin-top: .9em; }
.szm-tab th { padding: .2em .55em .45em; font: 650 .68em/1 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--fg-3); text-align: right; white-space: nowrap; }
.szm-tab th:nth-child(2) { text-align: left; }
.szm-tab th.szm-team { font-size: .78em; }
.szm-tab.own th.szm-team { color: var(--szm-own); }
.szm-tab.foe th.szm-team { color: var(--szm-foe); }
.szm-tab td { padding: .33em .55em; font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; border-top: .5px solid var(--line); }
.szm-tab td:first-child { width: 1.6em; padding-right: 0; font: 600 .78em/1 var(--mono); color: var(--fg-4); text-align: left; }
.szm-tab td:nth-child(2) { max-width: 0; width: 100%; overflow: hidden; font-weight: 600; text-align: left; text-overflow: ellipsis; }
.szm-tab td:nth-child(3) { font-weight: 750; }
.szm-tab tr.is-me td { background: color-mix(in srgb, var(--accent) 22%, transparent); border-top-color: transparent; }
.szm-tab tr.is-me td:first-child { border-radius: .5em 0 0 .5em; color: var(--accent); }
.szm-tab tr.is-me td:last-child { border-radius: 0 .5em .5em 0; }
.szm-tab tr.is-me + tr td { border-top-color: transparent; }
.szm-tab td em { margin-left: .5em; padding: .1em .45em; border-radius: 99px; background: var(--accent); font: 700 .7em/1 var(--mono); font-style: normal; letter-spacing: .08em; color: #fff; vertical-align: .1em; }
.szm-tab td.is-human::after { content: ""; display: inline-block; width: .4em; height: .4em; margin-left: .5em; border-radius: 50%; background: var(--szm-gold); vertical-align: .15em; }
.szm-xpl { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .32em 1em; font-size: .92em; }
.szm-xpl span { overflow: hidden; color: var(--fg-2); text-overflow: ellipsis; white-space: nowrap; }
.szm-xpl b { font: 650 .95em/1.35 var(--mono); text-align: right; }
.szm-xpl .sum { margin-top: .3em; padding-top: .5em; border-top: .5px solid var(--line); font-weight: 750; color: var(--fg); }
.szm-xpl b.sum { color: var(--accent); }
.szm-lvl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: .1em .8em; align-items: center; margin-top: 1em; padding: .8em .9em; border-radius: .9em; background: rgba(0, 0, 0, .24); box-shadow: inset 0 0 0 .5px var(--line); }
.szm-lvl .szm-ins { grid-row: 1 / span 2; }
.szm-lvl b { font-weight: 750; }
.szm-lvl b.is-up { animation: szm-pop .5s var(--spring) both; color: var(--szm-gold); }
.szm-lvl small { font-size: .82em; color: var(--fg-3); }
.szm-lvl .szm-xp, .szm-lvl .szm-xpt { grid-column: 1 / -1; }
.szm-lvl .szm-xp { margin-top: .55em; }
.szm-unl { display: grid; gap: .45em; margin-top: .7em; }
.szm-unl:empty { display: none; }
.szm-lvl ~ .szm-sec { margin-top: 1.1em; }
.szm-unl > div { display: grid; grid-template-columns: 4.4em minmax(0, 1fr); align-items: center; gap: 0 .8em; padding: .55em .8em; border-radius: .8em; background: color-mix(in srgb, var(--szm-gold) 16%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--szm-gold) 60%, transparent); animation: szm-pop .5s var(--spring) both; }
.szm-unl .szm-mini { grid-row: 1 / span 2; height: 2.2em; }
.szm-unl small { font: 650 .66em/1.2 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--szm-gold); }
.szm-unl b { overflow: hidden; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
.szm-medals { display: flex; flex-wrap: wrap; gap: .4em; }
.szm-end .szm-foot { justify-content: flex-end; }

/* ---------- Ladebild ---------- */
.szm-loading { flex-direction: column; justify-content: flex-end; padding: 2.4em 2.8em 2.2em; overflow: hidden; background: #06080d; animation: none; }
.szm-load-bg { position: absolute; inset: 0; overflow: hidden; }
.szm-load-bg .szm-art { position: absolute; inset: -4%; filter: blur(.55em) saturate(115%); opacity: .85; }
.szm-loading::before { content: ""; position: absolute; inset: 0; z-index: 1;
  background: linear-gradient(0deg, rgba(var(--szm-ink), .97) 0%, rgba(var(--szm-ink), .8) 30%, rgba(var(--szm-ink), .3) 62%, rgba(var(--szm-ink), .5) 100%),
    linear-gradient(rgba(255, 255, 255, .035) 1px, transparent 1px) 0 0 / 100% 2.6em, linear-gradient(90deg, rgba(255, 255, 255, .035) 1px, transparent 1px) 0 0 / 2.6em 100%; }
.szm-load-in { position: relative; z-index: 2; display: grid; gap: .5em; min-width: 0; }
.szm-load-in .szm-stripe { margin: .1em 0 .2em; }
.szm-load-mark { position: absolute; z-index: 2; top: 1.6em; left: 1.9em; font-size: 1.25em; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
.szm-load-mark em { font-style: normal; color: var(--accent); }
.szm-load-name { font-size: 4.2em; font-weight: 900; letter-spacing: .05em; line-height: .95; text-transform: uppercase; }
.szm-load-in > p { max-width: 38em; color: var(--fg-2); text-wrap: pretty; }
.szm-load-tip { display: flex; align-items: baseline; gap: .8em; max-width: 46em; margin-top: 1.2em; color: var(--fg-2); }
.szm-load-tip b { flex: none; padding: .25em .6em; border-radius: .4em; background: var(--accent); font: 700 .7em/1.2 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: #fff; }
.szm-load-bar { height: .4em; margin-top: .5em; overflow: hidden; border-radius: 99px; background: rgba(255, 255, 255, .1); }
.szm-load-bar i { display: block; width: calc(var(--p, 0) * 100%); height: 100%; border-radius: inherit; transition: width .25s ease;
  background: repeating-linear-gradient(-45deg, var(--accent) 0 .5em, color-mix(in srgb, var(--accent) 72%, #000) .5em 1em); }
.szm-load-st { display: flex; justify-content: space-between; gap: 1em; font: 600 .74em/1.2 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--fg-3); }

/* ---------- Schmale und niedrige Bühnen ---------- */
@container szm (max-width: 900px) {
  .szm-shell { gap: 1em; padding: 1.2em 1.2em 1.1em 1.3em; }
  .szm-side { width: 12.4em; }
  .szm-logo { font-size: 2.1em; }
  .szm-nav button { gap: .6em; padding: .5em .65em; font-size: .98em; letter-spacing: .05em; }
  .szm-nav button i { display: none; }
  .szm-head { padding: .75em 1.1em .6em; }
  .szm-body { padding: .9em 1.1em 1em; }
  .szm-foot { padding: .6em 1.1em; }
  .szm-play, .szm-two { grid-template-columns: minmax(0, 1fr); }
  .szm-modes { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .szm-modes .szm-card span { display: none; }
  .szm-modes .szm-card[aria-checked="true"]::after { display: none; }
  .szm-map .szm-art { height: 3.4em; }
  .szm-map span { display: none; }
  .szm-map b { padding-bottom: .55em; }
  .szm-load { grid-template-columns: 10.6em minmax(0, 1fr); gap: .9em; }
  .szm-w { grid-template-columns: minmax(0, 1fr); }
  .szm-w .szm-mini { display: none; }
  .szm-wart { height: 7em; }
  .szm-kit { grid-template-columns: minmax(0, 1fr); }
  .szm-tile { padding: .55em .65em; }
  .szm-tile b { font-size: 1.35em; }
  .szm-tile small { display: none; }
  .szm .gslider { width: 9em; }
  .szm-end { padding: .9em; }
  .szm-end-head { padding: .8em 1.1em .7em; }
  .szm-end-title { font-size: 2.1em; }
  .szm-end-score { font-size: 1.9em; }
  .szm-end-body { grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr); gap: 1em 1.2em; padding: .8em 1.1em 1em; }
  .szm-tab td, .szm-tab th { padding-left: .4em; padding-right: .4em; }
  .szm-loading { padding: 1.6em 1.7em 1.5em; }
  .szm-load-name { font-size: 3em; }
}
@container szm (max-width: 590px) {
  .szm-end-body { grid-template-columns: minmax(0, 1fr); }
}
@container szm (max-height: 480px) {
  .szm-side .szm-tag { display: none; }
  .szm-side .szm-stripe { margin: .6em 0 0; }
  .szm-nav { gap: .08em; margin-top: .9em; }
  .szm-me { padding: .55em .7em; }
  .szm-me .szm-ins { width: 2.5em; height: 2.5em; }
  .szm-end-head .szm-stripe { display: none; }
  .szm-load-tip { margin-top: .5em; }
  .szm-load-in .szm-stripe { display: none; }
}
`;

/**
 * Baut alle Menüs in `root` (liegt über der Bühne). Zeigt immer höchstens einen Bildschirm:
 * 'main' · 'pause' · 'end' · 'loading'. Ohne Bildschirm ist root versteckt und lässt Zeiger durch.
 */
function createMenus(root, api) {
  const nf = (n) => Math.round(n || 0).toLocaleString('de-DE');
  const pct = (v) => `${Math.round(v * 100)} %`;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const snd = (kind) => { try { api.snd?.(kind); } catch { /* ohne Ton */ } };
  const DEFAULTS = { sens: 1, adsSens: 0.8, invertY: false, fov: 75, volume: 0.8, quality: 'auto', shadows: true, fps: false, toggleAds: false, toggleCrouch: true };
  const STAT_NAMES = ['Schaden', 'Feuerrate', 'Reichweite', 'Beweglichkeit'];
  const TIPS = [
    'Wer rennt, kann nicht schießen – nimm rechtzeitig Tempo heraus.',
    'Kopftreffer richten deutlich mehr Schaden an.',
    'Nach ein paar Sekunden ohne Treffer erholst du dich von selbst.',
    'Mit der Leertaste kletterst du auf Kisten und Container.',
    'Drei Abschüsse in Folge bringen dir die Aufklärung – Taste 3.',
    'Geduckt streut deine Waffe weniger.',
    'Granaten prallen ab: Wirf sie um die Ecke.',
    'Aus der Hüfte triffst du nur auf kurze Entfernung – leg mit Rechtsklick an.',
    'Schüsse verraten deine Stellung auf der Karte der Gegner.',
    'Das Messer (V) erledigt Gegner in Reichweite mit einem einzigen Hieb.',
  ];
  const KEYS = [
    [['W', 'A', 'S', 'D'], 'Bewegen'], [['Maus'], 'Zielen'], [['Linksklick'], 'Feuern'], [['Rechtsklick'], 'Anlegen'], [['R'], 'Nachladen'],
    [['Umschalt'], 'Sprinten'], [['C'], 'Ducken'], [['Leertaste'], 'Springen, Klettern'], [['1', '2', 'Q', 'Mausrad'], 'Waffe wechseln'],
    [['G'], 'Granate'], [['V'], 'Messer'], [['3'], 'Aufklärung'], [['Tab'], 'Punktetafel'], [['Esc'], 'Pause'],
  ];
  const NAV = {
    main: [['play', 'Einsatz'], ['multi', 'Mehrspieler'], ['loadout', 'Ausrüstung'], ['career', 'Laufbahn'], ['settings', 'Einstellungen']],
    pause: [['resume', 'Weiter'], ['loadout', 'Ausrüstung'], ['settings', 'Einstellungen'], ['leave', 'Partie verlassen']],
  };

  let screen = null, shell = null, page = null, pageOff = null, dlg = null, loading = null, saveT = 0, raf = 0, focusRaf = 0;
  const timers = new Set();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
  const level = () => levelOf(api.profile.xp || 0);
  /** Anteil des Wegs zur nächsten Stufe (0 … 1) */
  const xpPart = (xp, lvl = levelOf(xp)) => (lvl >= MAX_LEVEL ? 1 : clamp((xp - xpFor(lvl)) / (xpFor(lvl + 1) - xpFor(lvl)), 0, 1));
  const xpText = (xp, lvl = levelOf(xp)) => (lvl >= MAX_LEVEL ? `${nf(xp)} EP` : `${nf(xp - xpFor(lvl))} / ${nf(xpFor(lvl + 1) - xpFor(lvl))} EP`);

  root.classList.add('szm');
  root.tabIndex = -1;
  root.hidden = true;

  // ==========================================================================
  // Zeichnungen: Waffen von der Seite, Rangabzeichen, Kartenbild
  // ==========================================================================
  const FILL = { m: '#5d6779', d: '#2a2f39', p: '#414854', o: '#6f7c50', t: '#a98e61', w: '#8b5c35', s: '#c5cbd5', g: '#ff5a3c', l: '#58a6ff' };
  /** Seitenansicht aus den Modellteilen: z liegt waagrecht (Mündung links), y senkrecht; Maße in Millimetern. */
  function gunSvg(model) {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, out = '';
    for (const [, y, z, , hh, len, col, tilt = 0] of model) {
      const c = Math.abs(Math.cos(tilt)), s = Math.abs(Math.sin(tilt)), ex = (len * c + hh * s) / 2, ey = (len * s + hh * c) / 2;
      x0 = Math.min(x0, z - ex); x1 = Math.max(x1, z + ex); y0 = Math.min(y0, -y - ey); y1 = Math.max(y1, -y + ey);
      const turn = tilt ? ` transform="rotate(${(tilt * 180 / Math.PI).toFixed(1)} ${(z * 1000).toFixed(1)} ${(-y * 1000).toFixed(1)})"` : '';
      out += `<rect x="${((z - len / 2) * 1000).toFixed(1)}" y="${((-y - hh / 2) * 1000).toFixed(1)}" width="${(len * 1000).toFixed(1)}" height="${(hh * 1000).toFixed(1)}" rx="${(Math.min(len, hh) * 170).toFixed(1)}" fill="${FILL[col] || FILL.m}" stroke="rgba(255,255,255,.16)" stroke-width="1.6"${turn}/>`;
    }
    const pad = 12;
    return `<svg viewBox="${(x0 * 1000 - pad).toFixed(0)} ${(y0 * 1000 - pad).toFixed(0)} ${((x1 - x0) * 1000 + pad * 2).toFixed(0)} ${((y1 - y0) * 1000 + pad * 2).toFixed(0)}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${out}</svg>`;
  }
  const NADE_SVG = '<svg viewBox="0 0 48 30" aria-hidden="true"><rect x="16" y="9" width="16" height="19" rx="7" fill="#6f7c50"/><path d="M16 15h16M16 21h16M24 9v19" stroke="#4a5435" stroke-width="1.6"/><rect x="20" y="4" width="8" height="6" rx="1.5" fill="#5d6779"/><path d="M27 5.500h6.500l2 9" fill="none" stroke="#c5cbd5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="17" cy="5.500" r="3" fill="none" stroke="#c5cbd5" stroke-width="1.5"/></svg>';
  const KNIFE_SVG = '<svg viewBox="0 0 48 30" aria-hidden="true"><path d="M3 16.500L25 11h3v7H9z" fill="#c5cbd5"/><rect x="27" y="8.500" width="2.600" height="12" rx="1" fill="#2a2f39"/><rect x="29.500" y="11" width="15" height="7" rx="2.500" fill="#414854"/></svg>';
  /** Abzeichen: Winkel zählen innerhalb einer Laufbahngruppe, Rauten darüber zeigen die Gruppe. */
  function rankSvg(lvl) {
    const idx = Math.min(RANKS.length - 1, Math.floor((lvl - 1) / 2)), chev = (idx % 4) + 1, pips = Math.floor(idx / 4);
    const hgt = chev * 6 + (pips ? 9 : 0), top = 20 - hgt / 2;
    let out = '';
    for (let i = 0; i < pips; i++) out += `<path d="M${(20 + (i - (pips - 1) / 2) * 7.5).toFixed(2)} ${(top - 0.2).toFixed(2)}l3.2 3.2-3.2 3.2-3.2-3.2z" fill="currentColor"/>`;
    for (let i = 0; i < chev; i++) out += `<path d="M9 ${(top + (pips ? 9 : 0) + i * 6 + 5.5).toFixed(2)}l11-5.500 11 5.500" fill="none" stroke="currentColor" stroke-width="2.600" stroke-linecap="round" stroke-linejoin="round"/>`;
    return `<svg viewBox="0 0 40 40" aria-hidden="true">${out}</svg>`;
  }
  const MAP_ART = {
    frachthof: { sky: ['#2c4168', '#e7a56b'], ground: '#33363d', hues: ['#a8442c', '#2f5d91', '#d49a2a', '#2e7f84', '#c9cbc6', '#3f7a58'] },
    oase: { sky: ['#3a86c4', '#f3dfb0'], ground: '#b89a66', hues: ['#d9c08e', '#c9a877', '#e8d6ac', '#b98f5e', '#f0e4c4'] },
  };
  /** Kleines Kartenbild: Himmel, Horizont und ein paar Blöcke – aus der Kennung der Karte erzeugt. */
  function mapArt(m) {
    const id = String(m.id).replace(/[^\w-]/g, '');
    let seed = 7;
    for (const ch of id) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
    const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const a = MAP_ART[id] || { sky: [`hsl(${seed % 360} 38% 30%)`, `hsl(${(seed + 40) % 360} 55% 72%)`], ground: '#3a3d44', hues: ['#7d8794', '#5d6673', '#9aa3ad', '#49515c'] };
    const sun = `<circle cx="${(20 + rand() * 60).toFixed(0)}" cy="${(13 + rand() * 12).toFixed(0)}" r="4.500" fill="#fff" opacity=".8"/>`;
    let blocks = '';
    for (let i = 0, x = -5; x < 104; i++) {
      const w = 8 + rand() * 15, hh = (5 + rand() * 15) * (i % 3 === 0 ? 1.5 : 0.85);
      blocks += `<rect x="${x.toFixed(1)}" y="${(40 - hh).toFixed(1)}" width="${w.toFixed(1)}" height="${hh.toFixed(1)}" fill="${a.hues[(rand() * a.hues.length) | 0]}"/>`;
      x += w + rand() * 6;
    }
    return `<svg viewBox="0 0 100 56" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="szm-sky-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a.sky[0]}"/><stop offset=".7" stop-color="${a.sky[1]}"/></linearGradient></defs>`
      + `<rect width="100" height="56" fill="url(#szm-sky-${id})"/>${sun}${blocks}<rect y="12" width="100" height="28" fill="${a.sky[1]}" opacity=".3"/><rect y="40" width="100" height="16" fill="${a.ground}"/><rect y="40" width="100" height="1.500" fill="#000" opacity=".25"/></svg>`;
  }
  const mini = (svg) => h('span.szm-mini', { html: svg });

  // ==========================================================================
  // Bausteine
  // ==========================================================================
  const lab = (text) => h('div.szm-lab', text);
  const sec = (title, ...kids) => h('div.szm-sec', title ? lab(title) : null, kids);
  const row = (title, hint, ...ctl) => h('div.szm-row', h('div.szm-row-t', h('b', title), hint ? h('small', hint) : null), h('div.szm-ctl', ctl));
  const btn = (cls, label, onclick, ico = '') => h(`button.szm-btn${cls}`, { type: 'button', onclick }, ico ? h('span', { html: icon(ico), style: { display: 'contents' } }) : null, label);
  const focusables = (el) => [...el.querySelectorAll('button, [tabindex], input, select, textarea, a[href]')].filter((n) => !n.disabled && n.tabIndex >= 0 && n.getClientRects().length);
  const focusIn = (el) => { const f = el.querySelector('[data-autofocus]') || focusables(el)[0]; f?.focus({ preventScroll: true }); return !!f; };
  const savePrefs = () => { clearTimeout(saveT); saveT = setTimeout(() => { saveT = 0; api.save('prefs'); }, 60); };

  /**
   * Auswahlgruppe mit einem Knopf je Eintrag: Pfeiltasten wandern (und wählen), Tab verlässt die Gruppe.
   * make(item) baut den Knopf, isOn(item) markiert den gewählten, pick(item) wählt (false = abgelehnt).
   */
  function choice(cls, label, items, make, isOn, pick, isTab = isOn) {
    const el = h(`div.${cls}`, { role: 'radiogroup', 'aria-label': label });
    const btns = items.map((it) => { const b = make(it); b.type = 'button'; b.setAttribute('role', 'radio'); return b; });
    const paint = () => {
      const any = items.some(isTab);
      btns.forEach((b, i) => { b.setAttribute('aria-checked', String(!!isOn(items[i]))); b.tabIndex = isTab(items[i]) || (!any && i === 0) ? 0 : -1; });
    };
    const take = (i, focus) => { const ok = pick(items[i]) !== false; paint(); if (focus) btns[i].focus({ preventScroll: false }); return ok; };
    btns.forEach((b, i) => {
      b.addEventListener('click', () => { snd(take(i, false) ? 'ok' : 'tick'); });
      b.addEventListener('pointerenter', () => snd('tick'));
    });
    el.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key], i = btns.indexOf(document.activeElement);
      if (!d || i < 0) return;
      e.preventDefault();
      e.stopPropagation();
      take((i + d + btns.length) % btns.length, true);
      snd('tick');
    });
    el.append(...btns);
    paint();
    return { el, paint };
  }
  /** Segment-Auswahl des Systems; opts = [[Wert, Beschriftung], …]. Pfeiltasten wechseln. */
  function seg(label, opts, value, onChange) {
    const btns = opts.map(([v, text]) => h('button', { type: 'button', 'aria-selected': String(v === value) }, text));
    const el = h('div.gseg', { 'aria-label': label }, btns);
    initSeg(el);
    const tabs = () => btns.forEach((b, i) => { b.tabIndex = i === el.index ? 0 : -1; });
    el.addEventListener('change', (e) => { e.stopPropagation(); tabs(); snd('tick'); onChange(opts[e.detail.index][0]); });
    el.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      const i = (el.index + d + btns.length) % btns.length;
      el.select(i);
      btns[i].focus();
    });
    tabs();
    return el;
  }
  function slider(label, min, max, step, value, show, onInput) {
    const val = h('span.szm-val', show(value));
    const el = h('div.gslider', { 'aria-label': label, dataset: { min, max, step, value } });
    initSlider(el);
    el.addEventListener('keydown', (e) => { if (e.key.startsWith('Arrow')) e.stopPropagation(); });
    el.addEventListener('input', (e) => { e.stopPropagation(); val.textContent = show(e.detail.value); onInput(e.detail.value); });
    el.addEventListener('change', (e) => { e.stopPropagation(); snd('tick'); });
    return [el, val];
  }
  function toggle(label, on, onChange) {
    const el = h('button.gswitch', { type: 'button', 'aria-label': label, 'aria-checked': String(!!on) });
    initSwitch(el);
    el.addEventListener('change', (e) => { e.stopPropagation(); snd('tick'); onChange(e.detail.checked); });
    return el;
  }
  function stepper(label, min, max, value, show, onChange) {
    const out = h('output', show(value));
    const bDn = h('button', { type: 'button', 'aria-label': `${label} verringern`, html: icon('minus') });
    const bUp = h('button', { type: 'button', 'aria-label': `${label} erhöhen`, html: icon('plus') });
    const set = (v) => {
      v = clamp(v, min, max);
      if (v !== value) { value = v; snd('tick'); onChange(v); }
      out.textContent = show(value);
      bDn.disabled = value <= min;
      bUp.disabled = value >= max;
    };
    bDn.addEventListener('click', () => set(value - 1));
    bUp.addEventListener('click', () => set(value + 1));
    const el = h('div.szm-step', { role: 'group', 'aria-label': label }, bDn, out, bUp);
    el.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      const keep = document.activeElement;
      set(value + d);
      if (keep.disabled) (d > 0 ? bDn : bUp).focus();
    });
    set(value);
    return el;
  }
  /** Rückfrage über dem Menü. */
  function ask({ title, text, ok, danger = false }, onOk) {
    const before = document.activeElement;
    const close = () => { dlg?.el.remove(); dlg = null; if (before?.isConnected) before.focus({ preventScroll: true }); };
    const bNo = btn('', 'Abbrechen', () => { snd('back'); close(); });
    const bOk = btn(danger ? '.danger' : '.primary', ok, () => { snd('ok'); close(); onOk(); });
    const el = h('div.szm-dim', { role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title }, h('div.szm-dlg', h('b', title), h('p', text), h('div', bNo, bOk)));
    dlg = { el, close };
    root.append(el);
    bNo.focus({ preventScroll: true });
  }
  function playerCard() {
    const xp = api.profile.xp || 0, lvl = levelOf(xp);
    return h('div.szm-me', { 'aria-label': 'Dein Profil' },
      h('span.szm-ins', { html: rankSvg(lvl) }), h('b', String(api.user || 'Gast')), h('small', `Stufe ${lvl} · ${rankOf(lvl)}`),
      h('div.szm-xp', { style: { '--p': xpPart(xp, lvl) } }, h('i')),
      h('div.szm-xpt', h('span', xpText(xp, lvl)), h('span', lvl >= MAX_LEVEL ? 'Höchste Stufe' : `Stufe ${lvl + 1}`)));
  }

  // ==========================================================================
  // Seiten: liefern { title, sub, body, foot?, off? }
  // ==========================================================================
  function pagePlay() {
    const s = api.setup;
    const mem = { team: 6, ffa: 8 };
    const teams = () => (MODES[s.mode] || MODES.tdm).teams;
    /** Nach jeder Änderung für gültige Werte sorgen (Limit und Größe hängen am Modus). */
    const fix = () => {
      if (!MODES[s.mode]) s.mode = 'tdm';
      const m = MODES[s.mode];
      if (!m.limits.includes(s.limit)) s.limit = m.limits[Math.min(1, m.limits.length - 1)];
      s.size = m.teams ? clamp(Math.round(s.size) || 6, 3, 8) : clamp(Math.round(s.size) || 8, 4, 12);
      if (!MAPS.some((x) => x.id === s.map)) s.map = MAPS[0].id;
      if (![5, 10, 15].includes(s.minutes)) s.minutes = 10;
      s.skill = clamp(s.skill | 0, 0, SKILLS.length - 1);
    };
    fix();
    mem[teams() ? 'team' : 'ffa'] = s.size;
    const sum = h('p');
    const opts = h('div');
    const changed = () => {
      fix();
      api.save('setup');
      const m = MODES[s.mode], map = MAPS.find((x) => x.id === s.map);
      sum.textContent = `${m.name} · ${map.name} · ${m.teams ? `${s.size} gegen ${s.size}` : `${s.size} Spieler`} · ${SKILLS[s.skill].name}`;
    };
    function paintOpts() {
      const m = MODES[s.mode], hint = h('small', SKILLS[s.skill].about);
      const unit = s.mode === 'ffa' ? 'Abschüsse' : 'Punkte';
      opts.replaceChildren(lab('Regeln'),
        h('div.szm-row', h('div.szm-row-t', h('b', 'Schwierigkeit'), hint),
          h('div.szm-ctl', seg('Schwierigkeit', SKILLS.map((k, i) => [i, k.name]), s.skill, (v) => { s.skill = v; hint.textContent = SKILLS[v].about; changed(); }))),
        m.teams
          ? row('Teamgröße', 'Du und deine Kameraden gegen ebenso viele Gegner', stepper('Teamgröße', 3, 8, s.size, (v) => `${v}`, (v) => { s.size = mem.team = v; changed(); }))
          : row('Spieler', 'Du und die Gegner zusammen', stepper('Spieler', 4, 12, s.size, (v) => `${v}`, (v) => { s.size = mem.ffa = v; changed(); })),
        row('Ziel', `${unit} bis zum Sieg`, seg(`${unit} bis zum Sieg`, m.limits.map((v) => [v, String(v)]), s.limit, (v) => { s.limit = v; changed(); })),
        row('Zeitlimit', 'Danach gewinnt, wer vorn liegt', seg('Zeitlimit', [5, 10, 15].map((v) => [v, `${v} Min.`]), s.minutes, (v) => { s.minutes = v; changed(); })));
    }
    const modes = choice('szm-cards.szm-modes', 'Modus', Object.keys(MODES),
      (id) => h('button.szm-card', h('b', MODES[id].name), h('span', MODES[id].about)),
      (id) => id === s.mode,
      (id) => {
        if (id === s.mode) return;
        const was = teams();
        s.mode = id;
        if (teams() !== was) s.size = mem[teams() ? 'team' : 'ffa'];
        changed();
        paintOpts();
      });
    const maps = choice('szm-cards.szm-maps', 'Karte', MAPS,
      (m) => h('button.szm-card.szm-map', h('div.szm-art', { html: mapArt(m) }), h('b', m.name), h('span', m.about || '')),
      (m) => m.id === s.map,
      (m) => { s.map = m.id; changed(); });
    paintOpts();
    changed();
    const go = btn('.primary.big', 'Einsatz starten', () => { snd('ok'); api.start(); }, 'play');
    go.dataset.autofocus = '';
    return {
      title: 'Einsatz', sub: 'Gefecht gegen Bots – allein oder im Team',
      body: h('div.szm-play', h('div', sec('Modus', modes.el), sec('Karte', maps.el)), opts),
      foot: [sum, go],
    };
  }

  function pageMulti() {
    const box = h('div.szm-lobby');
    let off = null;
    try { off = api.mountLobby?.(box) ?? null; } catch (err) { console.error(err); }
    if (typeof off !== 'function' && !box.childNodes.length) {
      box.append(h('div.szm-empty', { html: icon('wifi') }, h('b', 'Mehrspieler ist noch nicht verfügbar'),
        h('span', 'Gefechte mit Freunden über das Netz folgen in einer späteren Fassung. Bis dahin warten die Bots im Einsatz auf dich.')));
    }
    return { title: 'Mehrspieler', sub: 'Mit Freunden über das Netz', body: box, off: typeof off === 'function' ? off : null };
  }

  function pageLoadout() {
    const L = api.loadout, lvl = level();
    if (!WEAPONS[L.primary]) L.primary = PRIMARIES[0];
    const open = (id) => WEAPONS[id].level <= lvl;
    let view = L.primary;
    const detail = h('div.szm-wd');
    function paintDetail() {
      const w = WEAPONS[view], locked = !open(view);
      const mode = w.auto ? 'Dauerfeuer' : w.pellets > 1 ? 'Vorderschaft-Repetierer' : w.scope ? 'Repetierer' : 'Einzelfeuer';
      detail.replaceChildren(
        h(`div.szm-wart${locked ? '.is-locked' : ''}`, { html: gunSvg(w.model) }, h('span.szm-tag', w.type),
          locked ? h('span.szm-lock', { html: icon('lock') }, `Ab Stufe ${w.level}`) : null),
        h('div.szm-wname', h('b', w.name), h('span', locked ? `Noch ${nf(xpFor(w.level) - (api.profile.xp || 0))} EP bis zur Freischaltung` : view === L.primary ? 'Ausgerüstet' : '')),
        h('p', w.about),
        h('div.szm-stats', w.stats.flatMap((v, i) => [h('span', STAT_NAMES[i]), h('div.szm-bar', { role: 'img', 'aria-label': `${STAT_NAMES[i]} ${v} von 100`, style: { '--v': v } }, h('i')), h('b', String(v))])),
        h('div.szm-facts',
          h('span.szm-chip', 'Magazin ', h('b', String(w.mag))), h('span.szm-chip', 'Reserve ', h('b', String(w.reserve))),
          h('span.szm-chip', h('b', String(w.rpm)), ' Schuss/Min.'), h('span.szm-chip', mode), w.scope ? h('span.szm-chip', 'Zielfernrohr') : null));
    }
    const sub = (id) => (id === L.primary ? 'Ausgerüstet' : WEAPONS[id].type);
    const list = choice('szm-wlist', 'Hauptwaffe', PRIMARIES,
      (id) => {
        const w = WEAPONS[id];
        return h(`button.szm-w${open(id) ? '' : '.is-locked'}`, { dataset: { id }, 'aria-disabled': open(id) ? null : 'true' }, h('b', w.name),
          open(id) ? h('small', sub(id)) : h('small', { html: icon('lock') }, `Ab Stufe ${w.level}`), mini(gunSvg(w.model)));
      },
      (id) => id === L.primary,
      (id) => {
        view = id;
        const ok = open(id);
        if (ok && L.primary !== id) { L.primary = id; api.save('loadout'); }
        paint();
        return ok;
      },
      (id) => id === view);
    function paint() {
      for (const b of list.el.children) {
        const id = b.dataset.id;
        b.classList.toggle('is-view', id === view && id !== L.primary);
        if (open(id)) b.querySelector('small').textContent = sub(id);
      }
      paintDetail();
    }
    paint();
    const side = WEAPONS[L.secondary] || WEAPONS.marder;
    const kit = h('div.szm-kit',
      h('div', mini(gunSvg(side.model)), h('b', side.name), h('small', 'Zweitwaffe · Taste 2')),
      h('div', mini(NADE_SVG), h('b', 'Splittergranate'), h('small', 'Zwei Stück · Taste G')),
      h('div', mini(KNIFE_SVG), h('b', 'Kampfmesser'), h('small', 'Nahkampf · Taste V')));
    return {
      title: 'Ausrüstung', sub: 'Deine Hauptwaffe – neue Modelle gibt es mit höherer Stufe',
      body: h('div', api.inMatch?.() ? h('div.szm-note', { html: icon('info'), style: { marginBottom: '1em' } }, 'Änderungen gelten ab deinem nächsten Einstieg.') : null,
        h('div.szm-load', h('div', lab('Hauptwaffe'), list.el), h('div', detail, h('div.szm-sec', { style: { marginTop: '1.2em' } }, lab('Immer dabei'), kit)))),
    };
  }

  function pageCareer() {
    const p = api.profile, xp = p.xp || 0, lvl = levelOf(xp), kills = p.kills || 0;
    const kd = (p.deaths ? kills / p.deaths : kills).toFixed(2).replace('.', ',');
    const idx = Math.min(RANKS.length - 1, Math.floor((lvl - 1) / 2));
    const hours = Math.floor((p.time || 0) / 3600), mins = Math.floor(((p.time || 0) % 3600) / 60);
    const tile = (name, value, hint) => h('div.szm-tile', h('span', name), h('b', value), h('small', hint || ' '));
    const ladder = h('div.szm-ladder', { tabIndex: 0, role: 'list', 'aria-label': 'Ränge' }, RANKS.map((name, i) =>
      h(`div${i < idx ? '.is-done' : i === idx ? '.is-now' : ''}`, { role: 'listitem', title: `${name} – ab Stufe ${i * 2 + 1}`, html: rankSvg(i * 2 + 1) }, h('b', name), h('small', `Stufe ${i * 2 + 1}`))));
    later(() => { const now = ladder.querySelector('.is-now'); if (now) ladder.scrollLeft = now.offsetLeft - ladder.clientWidth / 2 + now.offsetWidth / 2; }, 0);
    const by = PRIMARIES.concat('marder').map((id) => [id, p.byWeapon?.[id] || 0]).sort((a, b) => b[1] - a[1]);
    const top = Math.max(1, by[0][1]);
    const next = PRIMARIES.map((id) => WEAPONS[id]).filter((w) => w.level > lvl).sort((a, b) => a.level - b.level)[0];
    return {
      title: 'Laufbahn', sub: `${nf(p.matches)} ${p.matches === 1 ? 'Einsatz' : 'Einsätze'} · ${nf(xp)} Erfahrungspunkte`,
      body: h('div',
        h('div.szm-sec', h('div.szm-rank',
          h('span.szm-ins', { html: rankSvg(lvl) }),
          h('h3', rankOf(lvl), h('small', `Stufe ${lvl}`)),
          h('div.szm-xp', { style: { '--p': xpPart(xp, lvl) } }, h('i')),
          h('div.szm-xpt', h('span', xpText(xp, lvl)), h('span', lvl >= MAX_LEVEL ? 'Höchste Stufe erreicht' : idx < RANKS.length - 1 ? `${RANKS[idx + 1]} ab Stufe ${(idx + 1) * 2 + 1}` : `Stufe ${lvl + 1}`)))),
        sec('Ränge', ladder),
        sec('Bilanz', h('div.szm-tiles',
          tile('K/D', kd, `${nf(kills)} Abschüsse · ${nf(p.deaths)} Tode`),
          tile('Trefferquote', p.shots ? pct((p.hits || 0) / p.shots) : '–', `${nf(p.hits)} von ${nf(p.shots)} Schuss`),
          tile('Kopfschüsse', nf(p.headshots), kills ? `${pct((p.headshots || 0) / kills)} der Abschüsse` : ''),
          tile('Siege', nf(p.wins), p.matches ? `${pct((p.wins || 0) / p.matches)} von ${nf(p.matches)}` : 'Noch kein Einsatz'),
          tile('Vorlagen', nf(p.assists), 'Gegner angeschossen'),
          tile('Beste Serie', nf(p.bestStreak), 'Abschüsse ohne Tod'),
          tile('Einsätze', nf(p.matches), p.matches ? `${nf((p.matches || 0) - (p.wins || 0))} nicht gewonnen` : ''),
          tile('Spielzeit', hours ? `${hours} Std.` : `${mins} Min.`, hours ? `und ${mins} Min.` : ''))),
        h('div.szm-sec.szm-two',
          h('div', lab('Abschüsse je Waffe'), h('div.szm-wk', by.flatMap(([id, n]) => [h('span', WEAPONS[id].name), h('div.szm-bar', { style: { '--v': (n / top) * 100 } }, h('i')), h('b', nf(n))]))),
          h('div', lab('Nächste Freischaltung'), next
            ? h('div.szm-next', mini(gunSvg(next.model)), h('b', next.name), h('small', `${next.type} · ab Stufe ${next.level} · noch ${nf(xpFor(next.level) - xp)} EP`))
            : h('div.szm-next', h('b', 'Alles freigeschaltet'), h('small', 'Dir stehen sämtliche Waffen offen.'))))),
    };
  }

  function pageSettings() {
    const P = api.prefs;
    const body = h('div');
    const bFull = btn('.small', '', () => { snd('tick'); api.toggleFullscreen(); later(paintFull, 250); }, 'external');
    const fullText = h('span');
    bFull.append(fullText);
    function paintFull() { fullText.textContent = api.isFullscreen?.() ? 'Vollbild beenden' : 'Vollbild'; }
    const live = (key) => (v) => { P[key] = v; savePrefs(); };
    function paint() {
      const two = (v) => v.toFixed(2).replace('.', ',');
      body.replaceChildren(
        sec('Steuerung',
          row('Maus-Empfindlichkeit', '', slider('Maus-Empfindlichkeit', 0.2, 3, 0.05, P.sens, two, live('sens'))),
          row('Empfindlichkeit beim Zielen', 'Anteil, sobald du angelegt hast', slider('Empfindlichkeit beim Zielen', 0.3, 1.5, 0.05, P.adsSens, pct, live('adsSens'))),
          row('Blick umkehren', 'Maus nach vorn schaut nach unten', toggle('Blick umkehren', P.invertY, live('invertY'))),
          row('Anlegen umschalten', 'Rechtsklick wechselt, statt gehalten zu werden', toggle('Anlegen umschalten', P.toggleAds, live('toggleAds'))),
          row('Ducken umschalten', 'C wechselt, statt gehalten zu werden', toggle('Ducken umschalten', P.toggleCrouch, live('toggleCrouch')))),
        sec('Bild',
          row('Sichtfeld', '', slider('Sichtfeld', 60, 100, 1, P.fov, (v) => `${Math.round(v)}°`, live('fov'))),
          row('Qualität', 'Auto passt Auflösung und Effekte an die Bildrate an', seg('Qualität', [['auto', 'Auto'], ['low', 'Niedrig'], ['medium', 'Mittel'], ['high', 'Hoch']], P.quality, live('quality'))),
          row('Schatten', '', toggle('Schatten', P.shadows, live('shadows'))),
          row('Bildrate anzeigen', '', toggle('Bildrate anzeigen', P.fps, live('fps'))),
          row('Vollbild', 'Das Spiel füllt den ganzen Bildschirm', bFull)),
        sec('Ton',
          row('Lautstärke', 'Zusätzlich zur Lautstärke des Systems', slider('Lautstärke', 0, 1, 0.05, P.volume, pct, live('volume')))),
        sec('Tastenbelegung', h('div.szm-keys', KEYS.map(([keys, what]) => h('div', keys.map((k) => h('kbd', k)), h('span', what))))),
        h('div.szm-sec', { style: { display: 'flex', justifyContent: 'flex-end' } },
          btn('.small', 'Standard wiederherstellen', () => { Object.assign(P, DEFAULTS); snd('ok'); clearTimeout(saveT); saveT = 0; api.save('prefs'); paint(); focusables(body).pop()?.focus({ preventScroll: true }); }, 'reload')));
      paintFull();
    }
    paint();
    document.addEventListener('fullscreenchange', paintFull);
    return { title: 'Einstellungen', sub: 'Gelten sofort und bleiben gespeichert', body, off: () => document.removeEventListener('fullscreenchange', paintFull) };
  }
  const PAGES = { play: pagePlay, multi: pageMulti, loadout: pageLoadout, career: pageCareer, settings: pageSettings };

  // ==========================================================================
  // Bildschirme
  // ==========================================================================
  function closePage() {
    try { pageOff?.(); } catch (err) { console.error(err); }
    pageOff = null;
    page = null;
  }
  function buildShell(kind, d = {}) {
    const isMain = kind === 'main';
    const holder = h('div.szm-main');
    const btns = NAV[kind].map(([id, text], i) => h(`button${id === 'leave' ? '.is-danger' : id === 'resume' ? '.is-go' : ''}`, { type: 'button', dataset: { id } }, h('i', `0${i + 1}`), h('span', text)));
    const nav = h('nav.szm-nav', { 'aria-label': isMain ? 'Hauptmenü' : 'Pause' }, btns);
    const mark = () => btns.forEach((b) => { if (b.dataset.id === page) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    /** Zeigt eine Seite (null schließt sie – nur in der Pause). */
    function open(id) {
      if (id === page) return;
      closePage();
      if (id && PAGES[id]) {
        const p = PAGES[id]();
        page = id;
        pageOff = p.off || null;
        holder.replaceChildren(h('section.szm-panel', { 'aria-label': p.title },
          h('header.szm-head', h('h2', p.title), h('span', p.sub || '')),
          h('div.szm-body', p.body),
          p.foot ? h('footer.szm-foot', p.foot) : null));
      } else holder.replaceChildren();
      mark();
    }
    function act(id, intoPage) {
      if (id === 'resume') { snd('ok'); api.resume(); return; }
      if (id === 'leave') {
        ask({ title: 'Partie verlassen?', text: 'Der Einsatz endet sofort. Punkte und Erfahrung dieser Partie gehen verloren.', ok: 'Verlassen', danger: true }, () => api.leave());
        return;
      }
      snd('ok');
      open(id);
      if (intoPage) focusIn(holder);
    }
    btns.forEach((b) => {
      b.addEventListener('click', (e) => act(b.dataset.id, e.detail === 0));
      b.addEventListener('pointerenter', () => snd('tick'));
    });
    nav.addEventListener('keydown', (e) => {
      const i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      const d = { ArrowDown: 1, ArrowUp: -1 }[e.key];
      if (d) {
        e.preventDefault();
        const b = btns[(i + d + btns.length) % btns.length];
        b.focus();
        snd('tick');
        if (isMain) open(b.dataset.id);
      } else if (e.key === 'ArrowRight' && PAGES[btns[i].dataset.id]) { e.preventDefault(); act(btns[i].dataset.id, true); }
    });
    shell = { kind, holder, btns, open, navBtn: () => btns.find((b) => b.dataset.id === page) || btns[0] };
    const side = h('div.szm-side',
      isMain ? h('div.szm-logo', { role: 'heading', 'aria-level': '1', 'aria-label': 'Sperrzone' }, 'Sperr', h('em', 'zone')) : h('div.szm-logo', { role: 'heading', 'aria-level': '1' }, 'Pause'),
      h('div.szm-stripe'),
      h('div.szm-tag', isMain ? 'Taktischer Shooter' : api.online?.() ? 'Die Partie läuft weiter' : 'Der Einsatz ruht'),
      nav, playerCard());
    const el = h(`div.szm-screen.szm-shell${isMain ? '' : '.is-pause'}`, side, holder);
    if (isMain) open(PAGES[d.page] ? d.page : 'play');
    else { btns[0].dataset.autofocus = ''; if (PAGES[d.page]) open(d.page); }
    return el;
  }

  function buildEnd(d = {}) {
    const mode = MODES[d.mode] || MODES.tdm, map = MAPS.find((m) => m.id === d.map);
    const kind = d.win ? 'win' : /unentschieden/i.test(d.title || '') ? 'draw' : 'loss';
    const rows = [...(d.rows || [])].sort((a, b) => (mode.teams ? 0 : b.kills - a.kills) || b.score - a.score || b.kills - a.kills);
    const secs = Math.max(0, Math.round(d.time || 0));
    const table = (list, cls, name) => h(`table.szm-tab${cls}`,
      h('thead', h('tr', h('th'), h('th.szm-team', name), h('th', 'Punkte'), h('th', { title: 'Abschüsse' }, 'Absch.'), h('th', 'Tode'), h('th', { title: 'Vorlagen' }, 'Vorl.'))),
      h('tbody', list.map((r, i) => h(`tr${r.me ? '.is-me' : ''}`,
        h('td', String(i + 1)), h(`td${!r.bot && !r.me ? '.is-human' : ''}`, String(r.name), r.me ? h('em', 'Du') : null),
        h('td', nf(r.score)), h('td', nf(r.kills)), h('td', nf(r.deaths)), h('td', nf(r.assists))))));
    const board = mode.teams
      ? [table(rows.filter((r) => r.team === 0), '.own', 'Dein Team'), table(rows.filter((r) => r.team !== 0), '.foe', 'Gegner')]
      : [table(rows, '', 'Alle gegen alle')];

    // Erfahrung: Posten, Summe, Balken (läuft von vorher nach nachher), Freischaltungen
    const from = d.xpBefore || 0, to = Math.max(from, d.xpAfter ?? from);
    const insEl = h('span.szm-ins'), lvlEl = h('b'), rankEl = h('small'), barEl = h('div.szm-xp', h('i')), txtEl = h('span'), nextEl = h('span');
    const unl = h('div.szm-unl');
    const xpBox = h('div', { dataset: { done: '0' } },
      lab('Erfahrung'),
      h('div.szm-xpl', (d.xp || []).flatMap(([name, pts]) => [h('span', String(name)), h('b', `+${nf(pts)}`)]), h('span.sum', 'Gesamt'), h('b.sum', `+${nf(to - from)} EP`)),
      h('div.szm-lvl', insEl, lvlEl, rankEl, barEl, h('div.szm-xpt', txtEl, nextEl)), unl,
      d.medals?.length ? h('div.szm-sec', lab('Auszeichnungen'), h('div.szm-medals', d.medals.map(([name, n]) => h('span.szm-chip', String(name), n > 1 ? h('b', `× ${n}`) : null)))) : null);
    let shown = 0;
    const paintXp = (xp) => {
      const lvl = levelOf(xp);
      if (lvl !== shown) {
        insEl.innerHTML = rankSvg(lvl);
        lvlEl.textContent = `Stufe ${lvl}`;
        rankEl.textContent = rankOf(lvl);
        nextEl.textContent = lvl >= MAX_LEVEL ? 'Höchste Stufe' : `Stufe ${lvl + 1}`;
        if (shown) { lvlEl.classList.remove('is-up'); void lvlEl.offsetWidth; lvlEl.classList.add('is-up'); snd('ok'); }
        shown = lvl;
      }
      barEl.style.setProperty('--p', xpPart(xp, lvl));
      txtEl.textContent = xpText(xp, lvl);
    };
    const finish = () => {
      if (xpBox.dataset.done === '1') return;
      cancelAnimationFrame(raf);
      paintXp(to);
      for (const id of d.unlocks || []) {
        const w = WEAPONS[id];
        if (w) unl.append(h('div', mini(gunSvg(w.model)), h('small', 'Freigeschaltet'), h('b', `${w.name} · ${w.type}`)));
      }
      xpBox.dataset.done = '1';
    };
    paintXp(from);
    if (reduced.matches || to === from) finish();
    else {
      const dur = clamp(900 + (to - from) * 0.5, 1200, 2600);
      later(() => {
        const t0 = performance.now();
        const step = (now) => {
          const k = clamp((now - t0) / dur, 0, 1);
          paintXp(lerp(from, to, 1 - (1 - k) ** 3));
          if (k < 1) raf = requestAnimationFrame(step); else finish();
        };
        raf = requestAnimationFrame(step);
        later(finish, dur + 1500);              // falls der Tab keine Bilder zeichnet
      }, 550);
    }

    const again = btn('.primary', 'Nochmal', () => { snd('ok'); api.start(); }, 'reload');
    again.dataset.autofocus = '';
    return h(`div.szm-screen.szm-end.is-${kind}`,
      h('section.szm-panel', { 'aria-label': 'Auswertung' },
        h('header.szm-end-head',
          h('div', h('div.szm-end-title', String(d.title || (d.win ? 'Sieg' : 'Niederlage'))), h('div.szm-stripe'),
            h('div.szm-tag', [mode.name, map?.name, `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} Min.`].filter(Boolean).join(' · '))),
          d.scores ? h('div.szm-end-score', { 'aria-label': `Endstand ${d.scores[0]} zu ${d.scores[1]}` },
            h('span.own', nf(d.scores[0]), h('small', 'Dein Team')), h('i', ':'), h('span.foe', nf(d.scores[1]), h('small', 'Gegner'))) : null),
        h('div.szm-end-body', h('div', board), xpBox),
        h('footer.szm-foot', btn('', 'Hauptmenü', () => { snd('back'); show('main'); }), again)));
  }

  function buildLoading(d = {}) {
    const map = MAPS.find((m) => m.id === (d.map || api.setup.map)) || MAPS[0], mode = MODES[d.mode || api.setup.mode];
    const bar = h('i'), text = h('span', 'Wird geladen …'), num = h('span', '0 %');
    loading = { bar, text, num };
    return h('div.szm-screen.szm-loading', { role: 'status', 'aria-label': `${map.name} wird geladen` },
      h('div.szm-load-bg', h('div.szm-art', { html: mapArt(map) })),
      h('div.szm-load-mark', { 'aria-hidden': 'true' }, 'Sperr', h('em', 'zone')),
      h('div.szm-load-in',
        h('div.szm-tag', mode ? mode.name : 'Einsatz'),
        h('div.szm-load-name', map.name),
        h('div.szm-stripe'),
        h('p', map.about || ''),
        h('div.szm-load-tip', h('b', 'Hinweis'), h('span', TIPS[(Math.random() * TIPS.length) | 0])),
        h('div.szm-load-bar', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar),
        h('div.szm-load-st', text, num)));
  }

  function clearScreen() {
    dlg?.el.remove();
    dlg = null;
    closePage();
    for (const id of timers) clearTimeout(id);
    timers.clear();
    cancelAnimationFrame(raf);
    cancelAnimationFrame(focusRaf);
    if (saveT) { clearTimeout(saveT); saveT = 0; api.save('prefs'); }
    shell = null;
    loading = null;
    root.replaceChildren();
  }
  /** Zeigt einen Bildschirm; show(null) blendet die Menüs aus. data: main/pause { page }, end siehe oben, loading { map, mode }. */
  function show(name, data) {
    const had = root.contains(document.activeElement);
    clearScreen();
    screen = ['main', 'pause', 'end', 'loading'].includes(name) ? name : null;
    root.hidden = !screen;
    if (!screen) { if (had) document.activeElement?.blur?.(); return; }
    root.append(screen === 'end' ? buildEnd(data) : screen === 'loading' ? buildLoading(data) : buildShell(screen, data));
    focusMain();
  }
  /** Fokus auf das wichtigste Element des Bildschirms. Wartet, bis das Menü im Dokument steht (beim Öffnen des Fensters ist es das noch nicht). */
  function focusMain(tries = 0) {
    cancelAnimationFrame(focusRaf);
    if (!screen || api.active?.() === false) return;       // liegt ein anderes Fenster vorn, bleibt die Tastatur dort; onFocus holt den Fokus später
    if (!root.getClientRects().length) { if (tries < 60) focusRaf = requestAnimationFrame(() => focusMain(tries + 1)); return; }
    if (dlg) focusIn(dlg.el);
    else if (root.querySelector('[data-autofocus]')) focusIn(root);
    else if (shell) shell.navBtn().focus({ preventScroll: true });
    else root.focus({ preventScroll: true });
  }
  /** Eine Ebene zurück (Esc). false: es gab nichts mehr zu schließen. */
  function back() {
    if (!screen) return false;
    if (dlg) { snd('back'); dlg.close(); return true; }
    if (!shell) return false;
    if (shell.kind === 'pause') {
      if (!page) return false;
      const b = shell.navBtn();
      shell.open(null);
      b.focus({ preventScroll: true });
      snd('back');
      return true;
    }
    if (shell.holder.contains(document.activeElement)) { shell.navBtn().focus({ preventScroll: true }); snd('back'); return true; }
    return false;
  }
  function setLoading(text, progress = 0) {
    if (!loading) return;
    const p = clamp(progress || 0, 0, 1);
    if (text) loading.text.textContent = text;
    loading.bar.style.setProperty('--p', p);
    loading.num.textContent = `${Math.round(p * 100)} %`;
    loading.bar.parentNode.setAttribute('aria-valuenow', String(Math.round(p * 100)));
  }

  // Tastatur: Esc geht zurück (in der Pause am Ende: weiterspielen), Tab bleibt im Menü
  function onKey(e) {
    if (!screen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (!back() && screen === 'pause') { snd('ok'); api.resume(); }
    } else if (e.key === 'Tab') {
      const list = focusables(dlg ? dlg.el : root);
      if (!list.length) { e.preventDefault(); return; }
      const i = list.indexOf(document.activeElement);
      e.preventDefault();
      list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length].focus();
    }
  }
  root.addEventListener('keydown', onKey);
  const stop = (e) => e.stopPropagation();
  root.addEventListener('contextmenu', stop);

  return {
    show, back, setLoading,
    hide: () => show(null),
    /** Holt den Fokus ins Menü zurück (etwa wenn das Fenster wieder nach vorn kommt). */
    focus() { if (screen && !root.contains(document.activeElement)) focusMain(); },
    get screen() { return screen; },
    get page() { return page; },
    destroy() {
      clearScreen();
      screen = null;
      root.hidden = true;
      root.removeEventListener('keydown', onKey);
      root.removeEventListener('contextmenu', stop);
      root.classList.remove('szm');
    },
  };
}

// ==========================================================================
// 12 · Oberfläche im Einsatz: Anzeige, Eingabe, Ablauf
// ==========================================================================
const HUD_CSS = `
.sz { position: relative; flex: 1; min-height: 0; overflow: hidden; background: #05060a; color: #fff; container: sz / size; outline: 0; user-select: none; -webkit-user-select: none; font-family: var(--font); color-scheme: dark; }
.sz:fullscreen { width: 100vw; height: 100vh; }
.sz-gl, .sz-fx { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.sz-fx, .szh { pointer-events: none; }
.sz-err { position: absolute; inset: 0; z-index: 30; display: grid; place-content: center; gap: 8px; padding: 24px; text-align: center; color: rgba(255, 255, 255, .75); background: rgba(5, 6, 10, .86); }
.sz-err b { font-size: 17px; color: #fff; }
.sz-toast { position: absolute; z-index: 40; left: 50%; top: 18px; translate: -50% 0; max-width: min(80%, 460px); display: grid; gap: 2px; padding: 10px 16px; border-radius: 12px; background: rgba(8, 10, 18, .84); box-shadow: inset 0 0 0 .5px rgba(255, 255, 255, .2), 0 8px 30px rgba(0, 0, 0, .4); font-size: 13px; line-height: 1.35; text-align: center; color: rgba(255, 255, 255, .85); pointer-events: none; animation: sz-toast 6.5s both; }
.sz-toast b { color: #fff; }
@keyframes sz-toast { 0% { opacity: 0; translate: -50% -8px; } 5% { opacity: 1; translate: -50% 0; } 90% { opacity: 1; } 100% { opacity: 0; } }
.sz-ui { position: absolute; inset: 0; }
.szh { position: absolute; inset: 0; font-size: clamp(11px, 2.05cqh, 19px); line-height: 1.2; text-shadow: 0 1px 2px rgba(0, 0, 0, .75); font-variant-numeric: tabular-nums; }
.szh-pane { background: rgba(8, 10, 18, .46); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); box-shadow: inset 0 0 0 .5px rgba(255, 255, 255, .14); border-radius: .6em; }
.szh-top { position: absolute; top: .7em; left: 50%; translate: -50% 0; display: flex; align-items: stretch; gap: .4em; }
.szh-team { position: relative; min-width: 5.4em; padding: .32em .75em .5em; overflow: hidden; }
.szh-team b { display: block; font: 800 1.55em/1 var(--font-round); }
.szh-team small { font-size: .6em; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; opacity: .8; }
.szh-team i { position: absolute; left: 0; bottom: 0; height: .2em; width: calc(var(--p, 0) * 100%); background: var(--c); transition: width .3s; }
.szh-team.own { --c: #4d9bff; text-align: right; }
.szh-team.own i { left: auto; right: 0; }
.szh-team.foe { --c: #ff5a48; }
.szh-team b { color: color-mix(in srgb, var(--c) 55%, #fff); }
.szh-clock { display: grid; place-items: center; align-content: center; gap: .15em; min-width: 4.6em; padding: 0 .8em; font: 700 1.15em/1 var(--font-round); }
.szh-clock small { font: 700 .5em/1 var(--font); letter-spacing: .1em; text-transform: uppercase; opacity: .7; }
.szh-flags { position: absolute; top: 4.3em; left: 50%; translate: -50% 0; display: flex; gap: .5em; }
.szh-flag { position: relative; display: grid; place-items: center; width: 2em; height: 2em; border-radius: 50%; overflow: hidden; background: rgba(8, 10, 18, .55); box-shadow: inset 0 0 0 .12em var(--c, rgba(255, 255, 255, .6)); font: 800 .95em/1 var(--font-round); }
.szh-flag i { position: absolute; inset: auto 0 0 0; height: calc(var(--p, 0) * 100%); background: var(--k, #fff); opacity: .55; }
.szh-flag b { position: relative; }
.szh-flag.own { --c: #4d9bff; background: rgba(40, 110, 230, .55); }
.szh-flag.foe { --c: #ff5a48; background: rgba(220, 60, 40, .55); }
.szh-flag.on { animation: szh-pulse .7s infinite alternate; }
@keyframes szh-pulse { to { scale: 1.14; } }
.szh-feed { position: absolute; top: .7em; right: .8em; display: grid; justify-items: end; gap: .25em; font-size: .78em; }
.szh-feed div { display: flex; align-items: center; gap: .5em; padding: .24em .6em; border-radius: .45em; background: rgba(8, 10, 18, .5); animation: szh-feed 6.5s both; }
.szh-feed div.me { box-shadow: inset 0 0 0 .1em rgba(255, 255, 255, .55); }
.szh-feed .f { color: #7db6ff; font-weight: 700; }
.szh-feed .e { color: #ff7a68; font-weight: 700; }
.szh-feed em { font-style: normal; opacity: .8; font-size: .9em; }
.szh-feed em.hs { color: #ffd257; opacity: 1; }
@keyframes szh-feed { 0% { opacity: 0; translate: 1em 0; } 4% { opacity: 1; translate: 0 0; } 88% { opacity: 1; } 100% { opacity: 0; } }
.szh-radar { position: absolute; top: .7em; left: .8em; width: 9.4em; height: 9.4em; border-radius: 50%; overflow: hidden; background: rgba(8, 10, 18, .5); box-shadow: inset 0 0 0 .5px rgba(255, 255, 255, .25), 0 .3em 1em rgba(0, 0, 0, .35); }
.szh-radar canvas { width: 100%; height: 100%; }
.szh-uav { position: absolute; top: 10.5em; left: .8em; width: 9.4em; text-align: center; font-size: .68em; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #9fd0ff; }
.szh-hp { position: absolute; left: .9em; bottom: .9em; display: flex; align-items: center; gap: .6em; padding: .5em .8em; }
.szh-hp b { font: 800 1.5em/1 var(--font-round); min-width: 2.1ch; text-align: right; }
.szh-hp .bar { width: 8em; height: .42em; border-radius: 1em; background: rgba(255, 255, 255, .16); overflow: hidden; }
.szh-hp .bar i { display: block; height: 100%; width: calc(var(--p, 1) * 100%); background: #fff; border-radius: inherit; transition: width .15s; }
.szh-hp.low b { color: #ff6a58; }
.szh-hp.low .bar i { background: #ff5a48; }
.szh-ammo { position: absolute; right: .9em; bottom: .9em; display: grid; justify-items: end; gap: .15em; padding: .5em .85em .55em; text-align: right; }
.szh-ammo .gun { font-size: .7em; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; opacity: .85; }
.szh-ammo .num { font: 800 2.1em/1 var(--font-round); }
.szh-ammo .num small { font-size: .5em; font-weight: 700; opacity: .7; }
.szh-ammo .num.low { color: #ffb14d; }
.szh-ammo .num.out { color: #ff5a48; }
.szh-ammo .row { display: flex; align-items: center; gap: .5em; font-size: .7em; font-weight: 700; }
.szh-ammo .nade { display: inline-block; width: .62em; height: .78em; border-radius: .2em .2em .3em .3em; background: #c6d48f; margin-left: .2em; }
.szh-ammo .nade.off { background: rgba(255, 255, 255, .2); }
.szh-streak { position: absolute; right: .9em; bottom: 6.6em; padding: .4em .7em; font-size: .72em; font-weight: 700; color: #9fd0ff; animation: szh-pulse .8s infinite alternate; }
.szh-streak kbd { display: inline-block; margin-left: .4em; padding: 0 .4em; border-radius: .3em; background: rgba(255, 255, 255, .2); font: inherit; color: #fff; }
.szh-pops { position: absolute; left: 50%; top: 61%; translate: -50% 0; display: grid; justify-items: center; gap: .2em; }
.szh-pops div { font-size: .9em; font-weight: 700; white-space: nowrap; animation: szh-pop 2.2s both; }
.szh-pops div b { color: #ffd257; margin-right: .45em; }
.szh-pops div.medal { font-size: 1.05em; letter-spacing: .06em; text-transform: uppercase; color: #ffd257; }
@keyframes szh-pop { 0% { opacity: 0; scale: 1.5; } 10% { opacity: 1; scale: 1; } 78% { opacity: 1; translate: 0 0; } 100% { opacity: 0; translate: 0 -.8em; } }
.szh-big { position: absolute; left: 50%; top: 24%; translate: -50% 0; font: 900 3.4em/1 var(--font); letter-spacing: .12em; text-align: center; white-space: nowrap; animation: szh-big .5s var(--ease-out) both; }
.szh-big small { display: block; margin-top: .5em; font: 600 .26em/1.3 var(--font); letter-spacing: .08em; opacity: .9; }
.szh-big.win { color: #8fd0ff; }
.szh-big.lose { color: #ff8a78; }
@keyframes szh-big { from { opacity: 0; scale: 1.6; letter-spacing: .4em; } }
.szh-dead { position: absolute; left: 50%; bottom: 22%; translate: -50% 0; display: grid; justify-items: center; gap: .3em; padding: .7em 1.4em; text-align: center; }
.szh-dead small { font-size: .7em; letter-spacing: .1em; text-transform: uppercase; opacity: .75; }
.szh-dead b { font-size: 1.25em; color: #ff7a68; }
.szh-dead span { font-size: .8em; opacity: .85; }
.szh-hint { position: absolute; left: 50%; bottom: 13%; translate: -50% 0; padding: .45em 1em; font-size: .8em; font-weight: 600; white-space: nowrap; }
.szh-hint kbd { display: inline-block; margin: 0 .2em; padding: .05em .45em; border-radius: .3em; background: rgba(255, 255, 255, .2); font: inherit; }
.szh-hurt { position: absolute; inset: 0; background: radial-gradient(ellipse at center, transparent 42%, rgba(190, 10, 0, .78) 118%); opacity: 0; }
.szh-flashbang { position: absolute; inset: 0; background: #fff; opacity: 0; }
.szh-scope { position: absolute; inset: 0; background:
  linear-gradient(#000, #000) center / 100% .12em no-repeat, linear-gradient(#000, #000) center / .12em 100% no-repeat,
  radial-gradient(circle at center, transparent 0, transparent calc(46cqh - 1px), rgba(0, 0, 0, .96) 46cqh, #000 100%); }
.szh-board { position: absolute; left: 50%; top: 50%; translate: -50% -50%; display: flex; gap: .8em; align-items: flex-start; max-width: 96%; padding: .9em; font-size: .82em; text-shadow: none; }
.szh-board table { border-collapse: collapse; min-width: 17em; }
.szh-board caption { padding: 0 .5em .45em; text-align: left; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.szh-board th { padding: .2em .55em; font-size: .72em; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; opacity: .65; text-align: right; }
.szh-board td { padding: .26em .55em; text-align: right; }
.szh-board th:first-child, .szh-board td:first-child { text-align: left; max-width: 11em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.szh-board tr.me td { background: rgba(255, 255, 255, .14); font-weight: 700; }
.szh-board tr.dead td:first-child { opacity: .5; }
.szh-board .own caption { color: #7db6ff; }
.szh-board .foe caption { color: #ff7a68; }
.szh-fps { position: absolute; left: 50%; bottom: .3em; translate: -50% 0; font: 600 .62em/1 var(--mono); opacity: .7; }
@container sz (max-height: 520px) { .szh-radar { width: 7.6em; height: 7.6em; } .szh-uav { top: 8.7em; width: 7.6em; } }
@media (prefers-reduced-motion: reduce) { .szh-flag.on, .szh-streak { animation: none; } }
`;

const WNAME = { nade: 'Granate', knife: 'Messer', fall: 'Sturz' };
const weaponLabel = (id) => WNAME[id] || WEAPONS[id]?.name || '';
const mmss = (t) => { t = Math.max(0, Math.ceil(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const SHADOW_RES = { low: 1024, medium: 2048, high: 4096, auto: 2048 };
// „Auto“: Merkmale wie „Mittel“. Zuerst sinkt die Auflösung bis 0,7, dann fallen SSAO und Sonnenstrahlen weg (ab AUTO_LITE), erst danach sinkt sie weiter.
const AUTO = [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.7, 0.64, 0.58, 0.52, 0.5], AUTO_LITE = 6;

function createApp(win) {
  style('shooter', HUD_CSS + MENU_CSS + NET_CSS);
  const db = appStore('shooter');
  // Gespeichertes kann alt, von Hand verändert oder beschädigt sein: erst auf gültige Werte bringen, dann benutzen.
  const stored = (key) => { const v = db.get(key, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
  const num = (v, d, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);
  const PREFS = { sens: 1, adsSens: 0.8, invertY: false, fov: 75, volume: 0.8, quality: 'auto', shadows: true, fps: false, toggleAds: false, toggleCrouch: true };
  const prefs = { ...PREFS, ...stored('prefs') };
  prefs.sens = num(prefs.sens, PREFS.sens, 0.2, 3); prefs.adsSens = num(prefs.adsSens, PREFS.adsSens, 0.3, 1.5);
  prefs.fov = num(prefs.fov, PREFS.fov, 60, 100); prefs.volume = num(prefs.volume, PREFS.volume, 0, 1);
  if (!Object.hasOwn(SHADOW_RES, prefs.quality)) prefs.quality = PREFS.quality;
  for (const k of ['invertY', 'shadows', 'fps', 'toggleAds', 'toggleCrouch']) if (typeof prefs[k] !== 'boolean') prefs[k] = PREFS[k];
  const profile = { xp: 0, kills: 0, deaths: 0, assists: 0, headshots: 0, matches: 0, wins: 0, bestStreak: 0, shots: 0, hits: 0, time: 0, byWeapon: {}, ...stored('profile') };
  for (const k of ['xp', 'kills', 'deaths', 'assists', 'headshots', 'matches', 'wins', 'bestStreak', 'shots', 'hits', 'time']) profile[k] = Math.round(num(profile[k], 0, 0, 1e9));
  profile.hits = Math.min(profile.hits, profile.shots);       // mehr Treffer als Schüsse kann es nicht geben
  profile.wins = Math.min(profile.wins, profile.matches);
  profile.byWeapon = Object.fromEntries(Object.entries(profile.byWeapon && typeof profile.byWeapon === 'object' ? profile.byWeapon : {})
    .filter(([id, n]) => (Object.hasOwn(WEAPONS, id) || Object.hasOwn(WNAME, id)) && Number.isFinite(n) && n > 0));
  const setup = { mode: 'tdm', map: MAPS[0].id, skill: 1, size: 6, limit: 75, minutes: 10, ...stored('setup') };
  const loadout = { primary: 'falke', secondary: 'marder', ...stored('loadout') };
  if (!MAPS.some((m) => m.id === setup.map)) setup.map = MAPS[0].id;
  if (!Object.hasOwn(MODES, setup.mode)) setup.mode = 'tdm';
  if (!MODES[setup.mode].limits.includes(setup.limit)) setup.limit = MODES[setup.mode].limits[1];
  setup.size = MODES[setup.mode].teams ? Math.round(num(setup.size, 6, 3, 8)) : Math.round(num(setup.size, 8, 4, 12));
  if (![5, 10, 15].includes(setup.minutes)) setup.minutes = 10;
  setup.skill = Math.round(num(setup.skill, 1, 0, SKILLS.length - 1));
  if (!PRIMARIES.includes(loadout.primary) || WEAPONS[loadout.primary].level > levelOf(profile.xp)) loadout.primary = 'falke';
  loadout.secondary = 'marder';

  // ---------- Aufbau ----------
  const gl = h('canvas.sz-gl'), fxc = h('canvas.sz-fx'), g2 = fxc.getContext('2d');
  const el = (cls, ...kids) => h(`div.${cls.split(' ').join('.')}`, ...kids);
  const scoreOwn = h('b', '0'), scoreFoe = h('b', '0'), labOwn = h('small', 'Dein Team'), labFoe = h('small', 'Gegner');
  const teamOwn = el('szh-team szh-pane own', scoreOwn, labOwn, h('i')), teamFoe = el('szh-team szh-pane foe', scoreFoe, labFoe, h('i'));
  const clockT = h('span', '0:00'), clockL = h('small', '');
  const flagsEl = el('szh-flags'), feedEl = el('szh-feed'), popsEl = el('szh-pops'), bigEl = el('szh-big'), deadEl = el('szh-dead szh-pane'), hintEl = el('szh-hint szh-pane');
  const radarCv = h('canvas'), radar = radarCv.getContext('2d'), uavEl = el('szh-uav');
  const hpNum = h('b', '100'), hpBar = h('i'), hpEl = el('szh-hp szh-pane', hpNum, el('bar', hpBar));
  const gunEl = h('span.gun'), numEl = h('span.num'), rowEl = h('span.row'), ammoEl = el('szh-ammo szh-pane', gunEl, numEl, rowEl);
  const streakEl = el('szh-streak szh-pane'), hurtEl = el('szh-hurt'), scopeEl = el('szh-scope'), boardEl = el('szh-board szh-pane'), fpsEl = el('szh-fps');
  const hud = el('szh', hurtEl, scopeEl, el('szh-top', teamOwn, el('szh-clock szh-pane', clockT, clockL), teamFoe), flagsEl, feedEl, el('szh-radar', radarCv), uavEl,
    hpEl, ammoEl, streakEl, popsEl, bigEl, deadEl, hintEl, boardEl, fpsEl);
  const ui = el('sz-ui');
  const stage = h('div.sz', { tabIndex: 0, 'aria-label': 'Sperrzone' }, gl, fxc, hud, ui);
  win.body.append(stage);
  for (const e of [bigEl, deadEl, hintEl, boardEl, scopeEl, streakEl, flagsEl, uavEl, fpsEl]) e.hidden = true;
  hud.hidden = true;

  let R = null;
  try { R = createRenderer(gl); } catch (err) { console.error(err); }
  if (!R) {
    stage.append(el('sz-err', h('b', 'Sperrzone braucht WebGL 2'), h('span', 'Dieser Browser oder diese Grafikkarte stellt es gerade nicht bereit.')));
    return { onClose() {} };
  }
  const S = createSound(() => prefs.volume);

  // ---------- Zustand ----------
  let M = null, paused = false, closed = false, locked = false, menuWorld = null, menuT = Math.random() * 50;
  let net = null, lobbyOff = null, starting = false, startSeq = 0, startNet = false;
  const netQueue = [];            // Nachrichten, die eintreffen, während die Karte noch gebaut wird
  let forceLdr = false;           // Rückfall ohne Float-Ziele erzwungen (_sz.bild.ldr)
  let autoLvl = 0, lastQuality = '';   // Stufe auf der Leiter AUTO
  let scale = 1, slow = 0, fast = 0, fpsAcc = 0, fpsN = 0, endTimer = 0, faults = 0, wheelAt = 0, lostEl = null, bg = null, simAt = performance.now();
  let hitT = 0, hitKill = false, hitHead = false, hurtK = 0, lastWarm = 9, boardT = 0, hudT = 0, crouchOn = false, adsOn = false, radarMap = null;
  const arcs = [], keys = new Set(), P3 = [0, 0, 0];
  const playing = () => !!M && !paused && M.state !== 'over';

  function applyPrefs() {
    R.setShadowSize(SHADOW_RES[prefs.quality] || 2048);
    if (prefs.quality === 'auto') {
      if (lastQuality !== 'auto') autoLvl = 0;          // „Auto“ beginnt mit voller Auflösung
      scale = AUTO[autoLvl];
      R.setTier(autoLvl >= AUTO_LITE ? { ...TIERS.medium, ssao: 0, rays: false } : TIERS.medium);
    } else {
      scale = TIERS[prefs.quality].scale;
      R.setTier(TIERS[prefs.quality]);
    }
    lastQuality = prefs.quality;
    fpsEl.hidden = !prefs.fps;
    size();
  }
  function size() {
    const w = stage.clientWidth, hh = stage.clientHeight;
    if (!w || !hh) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    R.resize(w * dpr * scale, hh * dpr * scale);
    const fw = Math.round(w * dpr), fh = Math.round(hh * dpr);
    if (fxc.width !== fw || fxc.height !== fh) { fxc.width = fw; fxc.height = fh; }
    const rs = Math.round(radarCv.clientWidth * dpr) || 160;
    if (radarCv.width !== rs) { radarCv.width = rs; radarCv.height = rs; }
  }
  function showMenuWorld() {
    const w = buildWorld(setup.map);
    if (w !== menuWorld) { menuWorld = w; R.setWorld(w); }
  }

  // ---------- Menüs ----------
  const api = {
    user: settings.user || 'Gast', profile, prefs, setup, loadout,
    save(what) {
      db.set(what, { prefs, setup, loadout }[what]);
      if (what === 'prefs') applyPrefs();
      if (what === 'setup' && !M) showMenuWorld();
    },
    start: () => startMatch(),
    resume: () => resume(),
    leave: () => leave(),
    toggleFullscreen() { if (document.fullscreenElement) document.exitFullscreen?.(); else stage.requestFullscreen?.().catch(() => {}); },
    isFullscreen: () => document.fullscreenElement === stage,
    snd: (kind) => S.ui(kind),
    inMatch: () => !!M && M.state !== 'over',
    /** Liegt dieses Fenster vorn? (Nur dann dürfen Menüs den Tastaturfokus an sich ziehen.) */
    active: () => mine(),
    /** Läuft gerade eine Partie im Netz? (Sie ruht in der Pause nicht.) */
    online: () => !!M?.net,
    /** Mehrspieler-Seite: Lobby einhängen. Beim Verlassen der Seite bleibt die Verbindung bestehen. */
    mountLobby(container) {
      if (typeof RTCPeerConnection !== 'function') return null;
      if (!net) {
        net = createNet({ name: api.user, onMessage: onNet, onClosed: onNetClosed });
        net.on((type, d) => { if (type === 'left' && M?.net) M.dropPeer(d?.id ?? d); });
      }
      const mode = () => `${MODES[setup.mode].name} · ${(MAPS.find((m) => m.id === setup.map) || MAPS[0]).name} · ${SKILLS[setup.skill].name}`;
      const off = netLobby(container, net, { user: api.user, onStart: () => api.start(), canStart: () => !M, summary: () => (net.role === 'host' ? mode() : '') });
      lobbyOff = () => { lobbyOff = null; off(true); };
      return () => lobbyOff?.();
    },
  };
  const menus = createMenus(ui, api);

  /** Mitteilung an den Spieler. Im Vollbild des Spiels sind die Mitteilungen des Systems nicht zu sehen – dann erscheint sie im Spiel selbst. */
  function notice(title, body, icon = 'info', more = {}) {
    if (document.fullscreenElement !== stage) { sys.notify({ title, body, icon, app: 'shooter', ...more }); return; }
    const box = el('sz-toast', h('b', title), h('span', body));
    box.setAttribute('role', 'status');
    stage.append(box);
    setTimeout(() => box.remove(), 6500);
  }

  // ---------- Netz ----------
  const online = () => !!net && net.role && net.peers.length > 1;
  function onNet(from, m) {
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'start' && net.role === 'client') { const cfg = remoteCfg(m.cfg); if (cfg) startMatch(cfg); return; }
    if (m.t === 'bye' && net.role === 'client') { if (M?.net || (starting && startNet)) { leave(true); notice('Sperrzone', 'Der Gastgeber hat die Partie beendet.'); } return; }
    if (starting) { if (netQueue.length < 400) netQueue.push([from, m]); } else if (M?.net) M.onNet(from, m);
  }
  /** Vorgaben des Gastgebers prüfen – nur was hier ankommt, erreicht die Partie. Liefert null, wenn sie nicht zu gebrauchen sind. */
  function remoteCfg(c) {
    if (!c || typeof c !== 'object' || !MAPS.some((x) => x.id === c.map) || !Object.hasOwn(MODES, c.mode) || !Array.isArray(c.roster)) return null;
    const teams = MODES[c.mode].teams;
    const roster = c.roster.slice(0, 24).filter((r) => r && typeof r === 'object').map((r) => ({
      name: String(r.name ?? 'Spieler').slice(0, 20), team: teams ? (r.team === 1 ? 1 : 0) : r.team | 0,
      peer: Number.isInteger(r.peer) ? r.peer : null, primary: PRIMARIES.includes(r.primary) ? r.primary : 'falke',
    }));
    if (!roster.some((r) => r.peer === net.id)) return null;          // ohne eigene Figur gäbe es nichts zu spielen
    return { map: c.map, mode: c.mode, limit: Math.round(num(c.limit, 50, 1, 999)), minutes: num(c.minutes, 10, 1, 60), size: Math.round(num(c.size, 6, 1, 12)), skill: Math.round(num(c.skill, 1, 0, SKILLS.length - 1)), roster };
  }
  function onNetClosed(reason) {
    if (!M?.net && !(starting && startNet)) {
      if (!lobbyOff) notice('Verbindung getrennt', reason === 'kick' ? 'Der Gastgeber hat dich aus dem Spiel entfernt.' : 'Die Verbindung zum Gastgeber ist getrennt.', 'close');
      return;
    }
    leave(true);
    notice('Verbindung getrennt', reason === 'kick' ? 'Du wurdest aus der Partie entfernt.' : 'Die Verbindung zum Gastgeber ist abgerissen.', 'close', { force: true });
  }

  // ---------- Ablauf ----------
  /** Startet eine Partie. remote = Vorgaben des Gastgebers (nur als Mitspieler). */
  function startMatch(remote = null) {
    if (starting) return;
    if (!remote && net?.role === 'client') {          // nur der Gastgeber startet – auch solange die Verbindung erst entsteht
      menus.show('main', { page: 'multi' });
      notice('Sperrzone', net.connected ? 'Der Gastgeber startet die nächste Partie.' : 'Du wartest noch auf den Gastgeber. Wenn du lieber allein spielst, verlasse das Spiel hier im Mehrspieler-Menü.');
      return;
    }
    clearTimeout(endTimer);
    if (M?.state === 'over') settle(M);             // die neue Partie beginnt, bevor die alte abgerechnet war
    const hosting = !remote && online() && net.role === 'host';
    const cfg = remote
      ? { ...remote, loadout, net: { role: 'client', id: net.id, send: (msg, to, rel) => net.send(msg, null, rel) } }
      : { map: setup.map, mode: setup.mode, limit: setup.limit, minutes: setup.minutes, size: setup.size, skill: setup.skill, loadout, name: api.user };
    if (hosting) {
      const base = { map: cfg.map, mode: cfg.mode, limit: cfg.limit, minutes: cfg.minutes, size: cfg.size, skill: cfg.skill };
      base.roster = makeRoster(base, net.peers.map((p) => ({ id: p.id, name: p.name })));
      net.send({ t: 'start', cfg: base }, null, true);
      cfg.roster = base.roster;
      cfg.net = { role: 'host', id: 0, send: (msg, to, rel) => net.send(msg, to, rel) };
    }
    lobbyOff?.();
    starting = true; startNet = !!cfg.net;
    const seq = ++startSeq;
    netQueue.length = 0;
    const map = MAPS.find((m) => m.id === cfg.map) || MAPS[0];
    menus.show('loading', { map: cfg.map, mode: cfg.mode });
    menus.setLoading(map.name, 0.2);
    hud.hidden = true;
    setTimeout(() => {
      if (closed || seq !== startSeq) return;       // inzwischen verlassen, geschlossen oder getrennt
      starting = false;
      try {
        M = createMatch(cfg, { snd: S, emit });
      } catch (err) {
        console.error('[Sperrzone]', err);
        if (cfg.net?.role === 'host') net?.send({ t: 'bye' }, null, true);      // die Mitspieler laden schon – sie sollen nicht vergeblich warten
        M = null;
        leave(true);
        notice('Sperrzone', 'Die Partie konnte nicht gestartet werden.', 'close');
        return;
      }
      if (cfg.net?.role === 'client') cfg.net.send({ t: 'lo', p: loadout.primary }, null, true);
      for (const [from, m] of netQueue.splice(0)) { try { M.onNet(from, m); } catch (err) { console.error('[Sperrzone]', err); } }
      menuWorld = M.world;
      R.setWorld(M.world);
      radarMap = paintRadar(M.world);
      paused = false; crouchOn = false; adsOn = false; lastWarm = 9; arcs.length = 0; hurtK = 0; hitT = 0; faults = 0; medalCount = {};
      feedEl.replaceChildren(); popsEl.replaceChildren();
      for (const e of [bigEl, deadEl, boardEl, streakEl, uavEl]) e.hidden = true;
      flagsEl.hidden = M.mode !== 'dom';
      flagsEl.replaceChildren(...M.flags.map((f) => { f.el = el('szh-flag', h('i'), h('b', f.name)); return f.el; }));
      labOwn.textContent = M.teams ? 'Dein Team' : 'Du';
      labFoe.textContent = M.teams ? 'Gegner' : 'Führender';
      clockL.textContent = `${MODES[M.mode].name.split('-')[0]} · ${M.cfg.limit}`;
      menus.show(null);
      hud.hidden = false;
      keys.clear();
      simAt = performance.now();                 // die Ladezeit zählt nicht als Spielzeit
      if (M.net) bgStart();
      if (mine()) { stage.focus({ preventScroll: true }); lock(); }       // im Netz kann die Partie beginnen, während ein anderes Fenster vorn liegt
    }, 60);
  }
  function pause() {
    if (closed || !M || paused || M.state === 'over') return;
    paused = true;
    keys.clear();
    unlock();
    menus.show('pause');
  }
  function resume() {
    if (!M || !paused) return;
    paused = false;
    menus.show(null);
    stage.focus({ preventScroll: true });
    lock();
  }
  /** Partie verlassen. quiet: die Verbindung ist schon weg oder wurde vom Gastgeber beendet. */
  function leave(quiet = false) {
    clearTimeout(endTimer); clearTimeout(big.t);
    if (M?.state === 'over') settle(M);             // eine beendete Partie zählt, auch wenn das Abschlussbild noch nicht da war
    if ((M?.net || (starting && startNet)) && !quiet && net) {
      if (net.role === 'host') net.send({ t: 'bye' }, null, true); else net.close();
    }
    M = null; paused = false; starting = false; startSeq++;
    bgStop();
    keys.clear();
    unlock();
    hud.hidden = true;
    g2.clearRect(0, 0, fxc.width, fxc.height);
    showMenuWorld();
    menus.show('main');
  }
  function lock() {
    if (document.pointerLockElement === stage) return;
    try {
      const p = stage.requestPointerLock({ unadjustedMovement: true });
      if (p?.catch) p.catch(() => { try { stage.requestPointerLock()?.catch?.(() => {}); } catch { /* ohne Zeigersperre */ } });
    } catch { /* ohne Zeigersperre */ }
  }
  function unlock() { if (document.pointerLockElement === stage) document.exitPointerLock(); }

  /** Wie ist die Partie für den Spieler ausgegangen? Unentschieden gilt in „Frei für alle“ nur für die Punktgleichen an der Spitze. */
  function verdict(match) {
    const me = match.me, won = match.teams ? match.winner === me.team : match.winner === me, place = match.place();
    const draw = match.draw && (match.teams || me.kills === match.table()[0].kills);
    const good = won || (!match.teams && place <= 3);           // „Frei für alle“: die ersten drei Plätze zählen als Erfolg
    const title = draw ? 'Unentschieden' : match.teams ? (won ? 'Sieg' : 'Niederlage') : place === 1 ? 'Sieg' : `Platz ${place}`;
    return { won, draw, good, place, title };
  }
  /** Rechnet eine beendete Partie genau einmal ab (Erfahrung, Laufbahn) und liefert die Daten fürs Abschlussbild. */
  function settle(match) {
    if (match.result) return match.result;
    const me = match.me, { won, draw, good, place, title } = verdict(match);
    const xp = [['Punkte aus dem Einsatz', Math.max(0, Math.round(me.score) || 0)], [won ? 'Sieg' : draw ? 'Unentschieden' : good ? 'Unter den ersten drei' : 'Einsatz beendet', good ? 500 : draw ? 300 : 200]];
    const bonus = [0, 0.1, 0.25][match.cfg.skill] || 0;
    if (bonus) xp.push([`Schwierigkeit „${SKILLS[match.cfg.skill].name}“`, Math.round((xp[0][1] + xp[1][1]) * bonus)]);
    const gained = xp.reduce((sum, r) => sum + r[1], 0), before = profile.xp, l0 = levelOf(before);
    profile.xp += gained; profile.kills += me.kills; profile.deaths += me.deaths; profile.assists += me.assists; profile.headshots += me.heads;
    profile.matches++; profile.wins += good ? 1 : 0; profile.bestStreak = Math.max(profile.bestStreak, me.best);
    profile.shots += me.shots; profile.hits += Math.min(me.hits, me.shots); profile.time += Math.round(match.time);
    for (const [id, n] of Object.entries(me.byWeapon)) profile.byWeapon[id] = (profile.byWeapon[id] || 0) + n;
    db.set('profile', profile);
    const l1 = levelOf(profile.xp);
    match.result = {
      title, win: good, won, place, levelUp: l1 > l0, mode: match.mode, map: match.cfg.map, time: match.time,
      scores: match.teams ? [match.scores[me.team], match.scores[1 - me.team]] : null,
      rows: match.table().map((s) => ({ name: s.name, team: match.friendly(s) ? 0 : 1, kills: s.kills, deaths: s.deaths, assists: s.assists, score: s.score, me: s.me, bot: !!s.bot })),
      xp, xpBefore: before, xpAfter: profile.xp, unlocks: PRIMARIES.filter((id) => WEAPONS[id].level > l0 && WEAPONS[id].level <= l1),
      medals: Object.entries(medalCount).sort((a, b) => b[1] - a[1]),
    };
    return match.result;
  }
  /** Partie vorbei: kurz ausklingen lassen, dann Abrechnung und Abschlussbild. */
  function onEnd() {
    const match = M, me = match.me, { draw, good, title } = verdict(match);
    big(title.toUpperCase(), 0, good ? 'win' : draw ? '' : 'lose', match.teams ? `${match.scores[me.team]} : ${match.scores[1 - me.team]}` : `${me.kills} Abschüsse`);
    S.jingle(good ? 'win' : 'lose');
    clearTimeout(endTimer);
    endTimer = setTimeout(() => {
      if (closed || M !== match) return;
      const result = settle(match);
      unlock();
      hud.hidden = true;
      g2.clearRect(0, 0, fxc.width, fxc.height);
      M = null;
      bgStop();
      if (result.levelUp) S.jingle('level');
      menus.show('end', result);
    }, 4600);
  }

  // ---------- Ereignisse aus der Partie ----------
  let medalCount = {};
  function pop(text, pts, cls = '') {
    const row = h(`div${cls ? `.${cls}` : ''}`, pts ? h('b', `+${pts}`) : null, text);
    popsEl.append(row);
    while (popsEl.children.length > 5) popsEl.firstChild.remove();
    setTimeout(() => row.remove(), 2200);
  }
  function big(text, secs, cls = '', sub = '') {
    bigEl.className = `szh-big ${cls}`;
    bigEl.replaceChildren(text, sub ? h('small', sub) : '');
    bigEl.hidden = false;
    bigEl.style.animation = 'none'; void bigEl.offsetWidth; bigEl.style.animation = '';
    clearTimeout(big.t);
    if (secs) big.t = setTimeout(() => { bigEl.hidden = true; }, secs * 1000);
  }
  function emit(type, d) {
    if (!M && type !== 'spawn') return;
    if (type === 'go') { big('LOS!', 0.9); S.ui('go'); medalCount = {}; }
    else if (type === 'hit') { hitT = 0.24; hitKill = d.kill; hitHead = d.head; S.hit(d.head, d.kill); }
    else if (type === 'hurt') { hurtK = Math.min(1, hurtK + d.dmg / 55); if (d.from !== M.me) arcs.push({ x: d.from.x, z: d.from.z, t: 1.4 }); S.hurt(); }
    else if (type === 'killed') {
      pop(d.v.name, d.pts);
      for (const m of d.medals) { pop(m, 0, 'medal'); medalCount[m] = (medalCount[m] || 0) + 1; }
      if (d.medals.some((m) => m.startsWith('Serie'))) S.jingle('streak');
    } else if (type === 'points') pop(d.label, d.pts);
    else if (type === 'pack') pop('Munition aufgenommen', 0);
    else if (type === 'died') {
      adsOn = false; crouchOn = false;
      const self = d.by === M.me;
      deadEl.replaceChildren(h('small', self ? 'Ausgeschaltet' : 'Ausgeschaltet von'), h('b', self ? (d.weapon === 'fall' ? 'Sturz' : 'eigene Granate') : d.by.name), self ? '' : h('span', weaponLabel(d.weapon)));
      deadEl.hidden = false;
    } else if (type === 'spawn') { if (d.me) deadEl.hidden = true; }
    else if (type === 'feed') paintFeed();
    else if (type === 'flag') {
      const mine = d.f.owner === M.me.team;
      big(`Stellung ${d.f.name}`, 1.6, mine ? 'win' : 'lose', mine ? 'erobert' : 'verloren');
      S.jingle(mine ? 'capture' : 'lost');
    } else if (type === 'uav') { pop('Aufklärung aktiv', 0, 'medal'); S.jingle('uav'); }
    else if (type === 'end') onEnd();
  }
  function paintFeed() {
    const f = M.feed[M.feed.length - 1];
    if (!f) return;
    const cls = (s) => (M.friendly(s) ? 'f' : 'e');
    const row = h(`div${(f.a && f.a.me) || f.v.me ? '.me' : ''}`, f.a ? h(`span.${cls(f.a)}`, f.a.name) : null, h(`em${f.head ? '.hs' : ''}`, `${weaponLabel(f.weapon)}${f.head ? ' ✦' : ''}`), h(`span.${cls(f.v)}`, f.v.name));
    feedEl.append(row);
    while (feedEl.children.length > 5) feedEl.firstChild.remove();
    setTimeout(() => row.remove(), 6500);
  }

  // ---------- Anzeige ----------
  function paintRadar(world) {
    const b = world.bounds, sc = 4, c = document.createElement('canvas');
    c.width = Math.ceil((b.x1 - b.x0) * sc); c.height = Math.ceil((b.z1 - b.z0) * sc);
    const g = c.getContext('2d'), C = world.cols;
    g.fillStyle = 'rgba(200, 210, 230, .13)';
    g.fillRect(0, 0, c.width, c.height);
    const order = [...Array(world.colCount).keys()].sort((p, q) => C[p * 6 + 4] - C[q * 6 + 4]);
    for (const i of order) {
      const o = i * 6, top = C[o + 4];
      if (world.colMat[i] === 255 || top < 0.5 || C[o + 1] > 2.2) continue;
      const k = clamp(top / 5, 0.2, 1);
      g.fillStyle = `rgba(${200 + 50 * k}, ${208 + 44 * k}, ${225 + 30 * k}, ${0.22 + 0.55 * k})`;
      g.fillRect((C[o] - b.x0) * sc, (C[o + 2] - b.z0) * sc, (C[o + 3] - C[o]) * sc, (C[o + 5] - C[o + 2]) * sc);
    }
    return { c, sc, x0: b.x0, z0: b.z0 };
  }
  function drawRadar() {
    const W = radarCv.width, me = M.me, cam = M.cam, k = W / 64, uav = M.uavLeft() > 0;      // 64 m Durchmesser
    radar.setTransform(1, 0, 0, 1, 0, 0);
    radar.clearRect(0, 0, W, W);
    radar.translate(W / 2, W / 2);
    radar.rotate(-cam.yaw);
    radar.scale(k, k);
    radar.translate(-me.x, -me.z);
    radar.drawImage(radarMap.c, radarMap.x0, radarMap.z0, radarMap.c.width / radarMap.sc, radarMap.c.height / radarMap.sc);
    for (const f of M.flags) {
      radar.fillStyle = f.owner < 0 ? 'rgba(255,255,255,.85)' : f.owner === me.team ? '#4d9bff' : '#ff5a48';
      radar.beginPath(); radar.arc(f.x, f.z, 1.7, 0, TAU); radar.fill();
    }
    for (const s of M.soldiers) {
      if (!s.alive || s === me) continue;
      if (M.friendly(s)) { radar.fillStyle = '#5aa5ff'; radar.beginPath(); radar.arc(s.x, s.z, 1.15, 0, TAU); radar.fill(); continue; }
      const seen = uav ? 1 : clamp(1 - (M.time - s.shotAt) / 1.6, 0, 1);
      if (seen <= 0) continue;
      radar.fillStyle = `rgba(255, 80, 60, ${seen})`;
      radar.beginPath(); radar.arc(s.x, s.z, 1.3, 0, TAU); radar.fill();
    }
    radar.setTransform(1, 0, 0, 1, W / 2, W / 2);
    radar.fillStyle = '#fff';
    radar.beginPath(); radar.moveTo(0, -W * 0.055); radar.lineTo(W * 0.04, W * 0.04); radar.lineTo(0, W * 0.02); radar.lineTo(-W * 0.04, W * 0.04); radar.closePath(); radar.fill();
  }

  /** Fadenkreuz, Treffermarken, Schadensrichtung, Namen, Stellungen, Granatenwarnung */
  function drawOverlay(dt) {
    const W = fxc.width, H = fxc.height, me = M.me, cam = M.cam, u = H / 720;
    g2.setTransform(1, 0, 0, 1, 0, 0);
    g2.clearRect(0, 0, W, H);
    if (!me.alive && M.state !== 'over') return;
    const cx = W / 2, cy = H / 2;
    g2.textAlign = 'center';
    g2.textBaseline = 'middle';
    // Namen der Kameraden, Stellungen
    g2.font = `600 ${Math.round(12 * u)}px system-ui, sans-serif`;
    for (const s of M.soldiers) {
      if (!s.alive || s === me || !M.friendly(s)) continue;
      const p = R.project(s.x, s.y + lerp(2.02, 1.5, s.crouchK), s.z, P3);
      if (!p || p[2] > 70 || p[0] < 0 || p[0] > 1 || p[1] < 0 || p[1] > 1) continue;
      g2.globalAlpha = clamp(1.25 - p[2] / 60, 0.3, 0.95);
      g2.fillStyle = '#8cc0ff';
      g2.shadowColor = 'rgba(0,0,0,.8)'; g2.shadowBlur = 3 * u;
      g2.fillText(s.name, p[0] * W, p[1] * H);
    }
    g2.shadowBlur = 0;
    for (const f of M.flags) {
      const p = R.project(f.x, f.y + 3.9, f.z, P3);
      if (!p) continue;
      const x = clamp(p[0], 0.05, 0.95) * W, y = clamp(p[1], 0.14, 0.9) * H;
      g2.globalAlpha = 0.9;
      g2.fillStyle = f.owner < 0 ? 'rgba(235,235,235,.9)' : f.owner === me.team ? '#3d8bff' : '#f04a3a';
      g2.beginPath(); g2.arc(x, y, 12 * u, 0, TAU); g2.fill();
      g2.fillStyle = f.owner < 0 ? '#111' : '#fff';
      g2.font = `800 ${Math.round(13 * u)}px system-ui, sans-serif`;
      g2.fillText(f.name, x, y + u);
      g2.font = `600 ${Math.round(10 * u)}px system-ui, sans-serif`;
      g2.fillStyle = '#fff';
      g2.fillText(`${Math.round(Math.hypot(f.x - me.x, f.z - me.z))} m`, x, y + 22 * u);
    }
    // Granaten in der Nähe
    for (const g of M.nades) {
      const d = Math.hypot(g.x - me.x, g.z - me.z);
      if (d > 9) continue;
      const p = R.project(g.x, g.y + 0.3, g.z, P3);
      let x, y;
      if (p && p[0] > 0.04 && p[0] < 0.96 && p[1] > 0.04 && p[1] < 0.96) { x = p[0] * W; y = p[1] * H; }
      else { const a = Math.atan2(g.x - me.x, -(g.z - me.z)) - cam.yaw; x = cx + Math.sin(a) * 150 * u; y = cy - Math.cos(a) * 150 * u; }
      g2.globalAlpha = 0.95;
      g2.fillStyle = '#ffc93c';
      g2.beginPath(); g2.arc(x, y, 11 * u, 0, TAU); g2.fill();
      g2.fillStyle = '#201400';
      g2.font = `900 ${Math.round(15 * u)}px system-ui, sans-serif`;
      g2.fillText('!', x, y + u);
    }
    g2.globalAlpha = 1;
    if (!me.alive) return;
    // Schadensrichtung
    for (let i = arcs.length - 1; i >= 0; i--) {
      const a = arcs[i];
      if ((a.t -= dt) <= 0) { arcs.splice(i, 1); continue; }
      const ang = Math.atan2(a.x - me.x, -(a.z - me.z)) - cam.yaw - Math.PI / 2;
      g2.strokeStyle = `rgba(255, 60, 40, ${Math.min(1, a.t) * 0.85})`;
      g2.lineWidth = 9 * u;
      g2.lineCap = 'round';
      g2.beginPath(); g2.arc(cx, cy, 118 * u, ang - 0.3, ang + 0.3); g2.stroke();
    }
    // Fadenkreuz
    const w = WEAPONS[me.guns[me.cur].id];
    const tgt = M.state === 'live' ? M.target() : null;
    const cross = (1 - me.ads * 1.6) * (me.sprinting || me.mantle ? 0.25 : 1) * (me.switchT > 0 ? 0.4 : 1);
    if (cross > 0.02 && !M.scoped) {
      const move = clamp(me.speed / 4.6, 0, 1.5);
      const spread = w.hip * (1 + move * 0.6) * (me.ground ? 1 : 1.9) * (me.crouching ? 0.78 : 1) + me.bloomK;
      const gap = Math.max(4 * u, (Math.tan(spread * DEG) / Math.tan((cam.fov * DEG) / 2)) * (H / 2)), len = 9 * u;
      g2.globalAlpha = cross;
      g2.lineCap = 'butt';
      for (const [col, lw] of [['rgba(0,0,0,.55)', 4 * u], [tgt ? '#ff6a58' : '#fff', 2 * u]]) {
        g2.strokeStyle = col; g2.lineWidth = lw;
        g2.beginPath();
        g2.moveTo(cx - gap - len, cy); g2.lineTo(cx - gap, cy); g2.moveTo(cx + gap, cy); g2.lineTo(cx + gap + len, cy);
        g2.moveTo(cx, cy - gap - len); g2.lineTo(cx, cy - gap); g2.moveTo(cx, cy + gap); g2.lineTo(cx, cy + gap + len);
        g2.stroke();
      }
      g2.fillStyle = tgt ? '#ff6a58' : '#fff';
      g2.fillRect(cx - u, cy - u, 2 * u, 2 * u);
      g2.globalAlpha = 1;
    } else if (!M.scoped && w.optic && me.ads > 0.7) {            // Leuchtpunkt der Optik
      g2.fillStyle = 'rgba(255, 60, 40, .95)';
      g2.beginPath(); g2.arc(cx, cy, 2.2 * u, 0, TAU); g2.fill();
    }
    if (tgt) {
      g2.font = `700 ${Math.round(12 * u)}px system-ui, sans-serif`;
      g2.fillStyle = '#ff8a78';
      g2.shadowColor = 'rgba(0,0,0,.8)'; g2.shadowBlur = 3 * u;
      g2.fillText(tgt.name, cx, cy + 34 * u);
      g2.shadowBlur = 0;
    }
    // Treffermarke
    if (hitT > 0) {
      hitT -= dt;
      const k = clamp(hitT / 0.24, 0, 1), r0 = (7 + (1 - k) * 4) * u, r1 = r0 + 9 * u;
      g2.globalAlpha = Math.min(1, k * 2);
      g2.strokeStyle = hitKill ? '#ff4a3a' : hitHead ? '#ffd257' : '#fff';
      g2.lineWidth = (hitKill ? 3 : 2.2) * u;
      g2.beginPath();
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { g2.moveTo(cx + sx * r0, cy + sy * r0); g2.lineTo(cx + sx * r1, cy + sy * r1); }
      g2.stroke();
      g2.globalAlpha = 1;
    }
    // Nachlade-Fortschritt
    if (me.reloadT > 0 && me.reloadMax > 0 && !w.shells) {
      const k = 1 - me.reloadT / me.reloadMax;
      g2.strokeStyle = 'rgba(255,255,255,.25)'; g2.lineWidth = 3 * u;
      g2.beginPath(); g2.arc(cx, cy, 22 * u, 0, TAU); g2.stroke();
      g2.strokeStyle = '#fff';
      g2.beginPath(); g2.arc(cx, cy, 22 * u, -Math.PI / 2, -Math.PI / 2 + TAU * k); g2.stroke();
    }
  }

  function drawHud(dt) {
    const me = M.me;
    hurtK = damp(hurtK, 0, 1.6, dt);
    hurtEl.style.opacity = clamp(hurtK * 0.75 + (me.alive ? (1 - me.hp / 100) ** 1.6 * 0.85 : 0.5), 0, 1).toFixed(3);
    scopeEl.hidden = !M.scoped;
    drawOverlay(dt);
    drawRadar();
    if ((hudT -= dt) > 0) return;
    hudT = 0.1;
    // Punktestand
    let own, foe, lim = M.cfg.limit;
    if (M.teams) { own = M.scores[me.team]; foe = M.scores[1 - me.team]; }
    else { own = me.kills; foe = 0; for (const s of M.soldiers) if (s !== me && s.kills > foe) foe = s.kills; }
    scoreOwn.textContent = own; scoreFoe.textContent = foe;
    teamOwn.style.setProperty('--p', clamp(own / lim, 0, 1));
    teamFoe.style.setProperty('--p', clamp(foe / lim, 0, 1));
    clockT.textContent = mmss(M.clock);
    for (const f of M.flags) {
      f.el.className = `szh-flag${f.owner < 0 ? '' : f.owner === me.team ? ' own' : ' foe'}${f.mine && f.owner !== me.team ? ' on' : ''}`;
      f.el.style.setProperty('--p', f.prog.toFixed(2));
      f.el.style.setProperty('--k', f.capBy === me.team ? '#4d9bff' : '#ff5a48');
    }
    // Gesundheit, Munition
    const hp = Math.max(0, Math.ceil(me.hp));
    hpNum.textContent = hp;
    hpBar.parentNode.style.setProperty('--p', hp / 100);
    hpEl.classList.toggle('low', hp < 40);
    const gun = me.guns[me.cur], w = WEAPONS[gun.id];
    gunEl.textContent = w.name;
    numEl.replaceChildren(String(gun.mag), h('small', ` / ${gun.reserve}`));
    numEl.className = `num${gun.mag === 0 ? ' out' : gun.mag <= w.mag * 0.25 ? ' low' : ''}`;
    const other = me.guns[1 - me.cur];
    rowEl.replaceChildren(other ? h('span', { style: { opacity: 0.7 } }, WEAPONS[other.id].name) : '', h('span', [0, 1].map((i) => h(`i.nade${i < me.nades ? '' : '.off'}`))));
    streakEl.hidden = !me.uavReady;
    if (me.uavReady && !streakEl.firstChild) streakEl.append('Aufklärung bereit', h('kbd', '3'));
    const uavLeft = M.uavLeft();
    uavEl.hidden = uavLeft <= 0;
    if (uavLeft > 0) uavEl.textContent = `Aufklärung ${Math.ceil(uavLeft)} s`;
    // Hinweise
    let hint = null;
    if (!locked && playing()) hint = ['Klicke ins Bild, um zu zielen'];
    else if (me.alive && M.state === 'live') {
      if (gun.mag === 0 && gun.reserve === 0) hint = ['Keine Munition – ', h('kbd', 'Q'), ' wechselt die Waffe'];
      else if (gun.mag <= w.mag * 0.25 && me.reloadT <= 0 && gun.reserve > 0) hint = [h('kbd', 'R'), ' Nachladen'];
    }
    hintEl.hidden = !hint;
    if (hint) hintEl.replaceChildren(...hint);
    if (!me.alive && M.state !== 'over' && !deadEl.hidden) {
      const t = deadEl.querySelector('i') || deadEl.appendChild(h('i', { style: { fontStyle: 'normal', fontSize: '.75em', opacity: 0.8 } }));
      t.textContent = `Wiedereinstieg in ${Math.max(0, me.respawnT).toFixed(1).replace('.', ',')} s`;
    }
    // Countdown vor dem Start
    if (M.state === 'warmup') {
      const n = Math.ceil(M.warm - 0.4);
      if (n !== lastWarm && n >= 1 && n <= 3) { big(String(n), 0, '', `${MODES[M.mode].name} · ${M.world.name}`); S.ui('beep'); }
      lastWarm = n;
    }
    if (!boardEl.hidden && (boardT -= 0.1) <= 0) { boardT = 0.5; paintBoard(); }
  }
  function paintBoard() {
    const rows = M.table();
    const table = (list, cls, title) => h(`table.${cls}`, h('caption', title),
      h('tr', h('th', 'Name'), h('th', 'Punkte'), h('th', 'A'), h('th', 'T'), h('th', 'V')),
      list.map((s) => h(`tr${s.me ? '.me' : ''}${s.alive ? '' : '.dead'}`, h('td', s.name), h('td', String(s.score)), h('td', String(s.kills)), h('td', String(s.deaths)), h('td', String(s.assists)))));
    if (M.teams) {
      const t = M.me.team;
      boardEl.replaceChildren(table(rows.filter((s) => s.team === t), 'own', `Dein Team · ${M.scores[t]}`), table(rows.filter((s) => s.team !== t), 'foe', `Gegner · ${M.scores[1 - t]}`));
    } else boardEl.replaceChildren(table(rows, 'own', `Frei für alle · bis ${M.cfg.limit}`));
  }

  // ---------- Eingabe ----------
  function readInput() {
    const me = M.me, inp = me.in;
    const k = (c) => keys.has(c);
    inp.mx = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    inp.mz = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    inp.jump = k('Space');
    inp.sprint = k('ShiftLeft') || k('ShiftRight');
    if (inp.sprint && inp.mz > 0) crouchOn = false;
    inp.crouch = prefs.toggleCrouch ? crouchOn : k('KeyC');
    inp.fire = k('Mouse0');
    inp.ads = prefs.toggleAds ? adsOn : k('Mouse2');
  }
  function press(code) {
    if (!playing()) return false;
    const me = M.me, inp = me.in;
    if (!me.alive) {                  // gefallen: nichts vormerken, was beim Wiedereinstieg von selbst losginge (Granate, Waffenwechsel …)
      if (code === 'Tab') { boardEl.hidden = false; boardT = 0; }
      return /^(Key[WASDCRQGVFE]|Digit[123]|Arrow|Shift|Mouse|Tab|Space)/.test(code);
    }
    if (code === 'KeyC') { if (prefs.toggleCrouch) crouchOn = !crouchOn; }
    else if (code === 'Space') { if (crouchOn) { crouchOn = false; keys.delete('Space'); return true; } }
    else if (code === 'KeyR') inp.reload = true;
    else if (code === 'Digit1') inp.swap = 0;
    else if (code === 'Digit2') inp.swap = 1;
    else if (code === 'KeyQ') inp.swap = 1 - me.cur;
    else if (code === 'KeyG') inp.nade = true;
    else if (code === 'KeyV' || code === 'KeyF') inp.melee = true;
    else if (code === 'Digit3' || code === 'KeyE') M.useUav();
    else if (code === 'Mouse2') { if (prefs.toggleAds) adsOn = !adsOn; }
    else if (code === 'Tab') { boardEl.hidden = false; boardT = 0; }
    else return /^(Key[WASD]|Arrow|Shift|Mouse)/.test(code);
    return true;
  }
  const mine = () => !closed && sys.wm?.focused === win;
  const onKeyDown = (e) => {
    if (!mine() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Escape') {
      if (e.repeat) { e.preventDefault(); return; }
      if (menus.screen) { if (!menus.back() && paused) resume(); e.preventDefault(); }
      else if (playing()) { pause(); e.preventDefault(); }
      return;
    }
    if (menus.screen || e.target.closest?.('input, textarea, select')) return;
    if (!e.repeat) keys.add(e.code);
    if ((!e.repeat && press(e.code)) || (playing() && /^(Tab|Space|Arrow)/.test(e.code))) e.preventDefault();
  };
  const onKeyUp = (e) => {
    keys.delete(e.code);
    if (e.code === 'KeyR' && M) M.me.in.reload = false;
    if (e.code === 'Tab') boardEl.hidden = true;
  };
  const onMouseDown = (e) => {
    if (!playing()) return;
    if (!locked) { lock(); stage.focus({ preventScroll: true }); if (e.button === 0) return; }
    keys.add(`Mouse${e.button}`);
    press(`Mouse${e.button}`);
    e.preventDefault();
  };
  const onMouseUp = (e) => keys.delete(`Mouse${e.button}`);
  const onMouseMove = (e) => {
    if (!playing() || !(locked || e.buttons)) return;
    const me = M.me;
    if (!me.alive) return;
    const dx = clamp(e.movementX || 0, -400, 400), dy = clamp(e.movementY || 0, -400, 400);
    const zoom = Math.tan((M.cam.fov * DEG) / 2) / Math.tan((prefs.fov * DEG) / 2);
    const s = 0.0022 * prefs.sens * lerp(1, prefs.adsSens, me.ads) * Math.min(1, zoom);
    me.yaw += dx * s;
    me.pitch = clamp(me.pitch - dy * s * (prefs.invertY ? -1 : 1), -1.5, 1.5);
    M.view.lookDX += dx * s; M.view.lookDY += dy * s;
  };
  const onWheel = (e) => {
    if (!playing()) return;
    e.preventDefault();
    const fresh = e.timeStamp - wheelAt > 180;      // ein Dreh am Rad (oder ein Wisch auf dem Trackpad) meldet sich viele Male: nur sein Anfang zählt
    wheelAt = e.timeStamp;
    if (fresh && M.me.alive) M.me.in.swap = 1 - M.me.cur;
  };
  const onBlur = () => keys.clear();                // Tasten, die beim Wechsel in ein anderes Programm gehalten waren, kämen nie wieder hoch
  const onLock = () => {
    locked = document.pointerLockElement === stage;
    if (!locked && playing() && M.state === 'live') pause();
    if (!locked) keys.clear();
  };
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);
  stage.addEventListener('mousedown', onMouseDown);
  addEventListener('mouseup', onMouseUp);
  stage.addEventListener('mousemove', onMouseMove);
  stage.addEventListener('wheel', onWheel, { passive: false });
  addEventListener('blur', onBlur);
  stage.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
  document.addEventListener('pointerlockchange', onLock);
  const offFocus = bus.on('focus', (w) => { if (w !== win) pause(); });
  const offWm = bus.on('wm', () => { if (win.min) pause(); });
  const onHide = () => { if (document.hidden) pause(); };
  document.addEventListener('visibilitychange', onHide);
  const onFs = () => size();
  document.addEventListener('fullscreenchange', onFs);
  const ro = new ResizeObserver(size);
  ro.observe(stage);
  // Der Browser darf die Grafik jederzeit zurücksetzen (Treiber, Ruhezustand, zu viele 3D-Flächen). Dann: sagen, was los ist, und alles neu aufbauen.
  const lostNote = (title, text) => { lostEl?.remove(); lostEl = el('sz-err', h('b', title), h('span', text)); stage.append(lostEl); };
  gl.addEventListener('webglcontextlost', (e) => {
    if (closed) return;
    e.preventDefault();           // nur dann gibt der Browser den Kontext später zurück
    pause();
    lostNote('Die Grafik wurde zurückgesetzt', 'Sperrzone stellt das Bild gleich wieder her …');
  });
  gl.addEventListener('webglcontextrestored', () => {
    if (closed) return;
    let fresh = null;
    try { fresh = createRenderer(gl, { ldr: forceLdr }); } catch (err) { console.error(err); }
    if (!fresh) { lostNote('Die Grafik ließ sich nicht wiederherstellen', 'Bitte schließe Sperrzone und öffne es erneut.'); return; }
    R = fresh;
    lostEl?.remove(); lostEl = null;
    applyPrefs();
    const w = M ? M.world : menuWorld;
    if (w) R.setWorld(w);
  });

  // ---------- Bildtakt ----------
  const IDLE = { mx: 0, mz: 0, jump: false, sprint: false, fire: false, ads: false };
  /** Rechnet die Partie um dt weiter (in Schritten von höchstens 1/60 s). idle: niemand steuert die eigene Figur. */
  function simulate(dt, idle) {
    if (idle) Object.assign(M.me.in, IDLE); else readInput();
    const sim = M.state === 'over' && !M.net ? dt * 0.3 : dt, n = Math.max(1, Math.ceil(sim / (1 / 60)));
    for (let i = 0; i < n && M; i++) M.step(sim / n);
  }
  /**
   * Fehler im Takt abfangen: der gemeinsame Zeitgeber würde eine Funktion, die einmal scheitert, nie wieder aufrufen –
   * das Bild bliebe für immer stehen. Ein einzelnes schlechtes Bild wird übergangen; hört es nicht auf, endet die Partie sauber.
   */
  function guard(fn, dt) {
    try { fn(dt); faults = Math.max(0, faults - 0.02); }
    catch (err) {
      console.error('[Sperrzone]', err);
      if (++faults < 4) return;
      faults = 0;
      const had = !!M;
      try { if (had) leave(); else menuWorld = null; } catch (err2) { console.error('[Sperrzone]', err2); M = null; }
      if (had) notice('Sperrzone', 'Die Partie wurde wegen eines Fehlers beendet.', 'close', { force: true });
    }
  }
  const unseen = () => win.min || document.hidden || !stage.clientWidth;
  /**
   * Zeit seit dem letzten Takt der Partie, höchstens eine Viertelsekunde. Der gemeinsame Zeitgeber reicht je Bild nie mehr als 50 ms durch –
   * unter 20 Bildern je Sekunde liefe die Partie sonst in Zeitlupe (beim Gastgeber für alle). So folgt sie der Uhr, nicht der Bildrate;
   * simulate() teilt die Spanne in Schritte von höchstens 1/60 s.
   */
  function elapsed() { const now = performance.now(), dt = clamp((now - simAt) / 1000, 0, 0.25); simAt = now; return dt; }
  let dprSeen = devicePixelRatio;
  function draw(dt) {
    const real = elapsed();
    if (devicePixelRatio !== dprSeen) { dprSeen = devicePixelRatio; size(); }       // anderer Monitor oder Zoom: die Fenstergröße bleibt, die Pixeldichte nicht
    // Auflösung und Merkmale der Leistung anpassen (Leiter AUTO)
    if (prefs.quality === 'auto') {
      if (dt > 1 / 45) { slow += dt; fast = 0; } else if (dt < 1 / 57) { fast += dt; slow = Math.max(0, slow - dt * 0.5); }
      if (slow > 1.5 && autoLvl < AUTO.length - 1) { autoLvl = Math.min(AUTO.length - 1, autoLvl + 2); slow = 0; applyPrefs(); }
      else if (fast > 8 && autoLvl > 0) { autoLvl--; fast = 0; applyPrefs(); }
    }
    if (prefs.fps) { fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { fpsEl.textContent = `${Math.round(fpsN / fpsAcc)} B/s · ${Math.round(scale * 100)} %`; fpsAcc = 0; fpsN = 0; } }
    if (M) {
      const live = !paused || !!M.net;             // im Netz läuft die Partie weiter, auch wenn das Menü offen ist
      if (live) simulate(real, paused);
      if (!M) return;
      M.aim(live ? real : 0.0001, prefs.fov);
      R.render(M.frame(prefs.shadows));
      if (!hud.hidden) drawHud(live ? real : 0);
    } else if (menuWorld) {
      menuT += dt;
      const b = menuWorld.bounds, r = Math.max(b.x1 - b.x0, b.z1 - b.z0) * 0.36, a = menuT * 0.045;
      const x = Math.sin(a) * r, z = Math.cos(a) * r, y = 9 + Math.sin(menuT * 0.11) * 2.5;
      R.render({ cam: { x, y, z, yaw: Math.atan2(-x, z) + 0.25, pitch: -0.2, fov: 62 }, instCount: 0, vmCount: 0, quadCount: 0, lights: menuWorld.lamps, time: menuT, shadows: prefs.shadows });
    }
  }
  function frame(dt) {
    if (closed || unseen()) return;                // ungesehen rechnet höchstens der Hintergrundtakt weiter
    guard(draw, dt);
  }
  // Im Netz darf die Partie nicht stehen bleiben, nur weil dieses Fenster gerade verdeckt, verkleinert oder der Tab im Hintergrund ist:
  // beim Gastgeber stünde sie sonst für alle still. Bilder gibt es dann keine – also tickt ein Worker, den der Browser nicht drosselt.
  function bgTick() {
    if (closed || !M?.net || !unseen()) return;      // sichtbar rechnet der Bildtakt – dann hier auch keine Zeit verbrauchen
    const dt = elapsed();
    if (dt > 0) guard((t) => simulate(t, true), dt);
  }
  function bgStart() {
    if (bg) return;
    try {
      const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 33);'], { type: 'text/javascript' }));
      const wk = new Worker(url);
      const stop = () => { wk.terminate(); URL.revokeObjectURL(url); };
      wk.onmessage = bgTick;
      wk.onerror = () => { if (bg !== stop) return; stop(); const id = setInterval(bgTick, 100); bg = () => clearInterval(id); };     // Worker verweigert: gedrosselter Ersatz
      bg = stop;
    } catch {
      const id = setInterval(bgTick, 100);          // ohne Worker: gedrosselt, aber besser als Stillstand
      bg = () => clearInterval(id);
    }
  }
  function bgStop() { bg?.(); bg = null; }

  applyPrefs();
  showMenuWorld();
  menus.show('main');
  if (matchMedia('(hover: none) and (pointer: coarse)').matches) sys.notify({ title: 'Sperrzone', body: 'Zum Spielen brauchst du Maus und Tastatur – eine Steuerung für Touch-Geräte gibt es noch nicht.', icon: 'info', app: 'shooter' });
  ticker.add(frame);
  stage._sz = { get M() { return M; }, get net() { return net; }, api, keys, press, start: startMatch, snd: S };      // für Tests und zum Nachsehen in der Konsole
  // Prüfhaken: cam([x, y, z, yaw, pitch, fov] | null) setzt oder löst die feste Kamera, freeze(true) hält die Partie im Aufwärmen
  stage._sz.probe = {
    cam(pose) { if (M) M.fixedCam = pose ? [...pose] : null; },
    freeze(on) { if (M) M.warm = on ? 999 : 0; },
  };
  // Prüfhaken Bild: tier('high'|'medium'|'low'|'auto') stellt die Qualität (ohne zu speichern), ldr(true) erzwingt den Rückfall ohne Float-Ziele
  stage._sz.bild = {
    tier(name) { if (Object.hasOwn(SHADOW_RES, name)) { prefs.quality = name; applyPrefs(); } },
    ldr(on) { forceLdr = !!on; R.setLdr(forceLdr); },
    stats: () => ({ tier: prefs.quality, scale, ...R.stats() }),
  };

  return {
    onFocus: () => { if (menus.screen) menus.focus(); else if (!stage.contains(document.activeElement)) stage.focus({ preventScroll: true }); },
    onClose: () => {
      if (M?.state === 'over') settle(M);
      closed = true; startSeq++;
      clearTimeout(endTimer); clearTimeout(big.t);
      ticker.remove(frame);
      bgStop();
      unlock();
      if (document.fullscreenElement === stage) document.exitFullscreen?.();
      removeEventListener('keydown', onKeyDown);
      removeEventListener('keyup', onKeyUp);
      removeEventListener('mouseup', onMouseUp);
      removeEventListener('blur', onBlur);
      document.removeEventListener('pointerlockchange', onLock);
      document.removeEventListener('visibilitychange', onHide);
      document.removeEventListener('fullscreenchange', onFs);
      offFocus(); offWm(); ro.disconnect();
      menus.destroy();
      net?.close();
      S.dispose();
      R?.dispose();
    },
    menus: () => [{
      label: 'Spiel',
      items: [
        { label: paused ? 'Weiter' : 'Pause', icon: paused ? 'play' : 'pause', hint: 'esc', disabled: !M || M.state === 'over', run: () => (paused ? resume() : pause()) },
        { label: 'Vollbild', icon: 'layers', checked: api.isFullscreen(), run: () => api.toggleFullscreen() },
        '-',
        { label: 'Partie verlassen', icon: 'close', disabled: !M, run: () => leave() },
      ],
    }],
  };
}

// ==========================================================================
// 13 · App
// ==========================================================================
export default {
  singleton: true,
  width: 1100, height: 700, minW: 640, minH: 440,
  mount: (win) => createApp(win),
};
