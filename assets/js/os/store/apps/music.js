// music.js — Musik: ein generativer Player. Acht Stücke, die beim Abspielen live über WebAudio entstehen.

import { h, clamp, ticker, TAU } from '../../../core/util.js';
import { icon } from '../../../core/icons.js';
import { initControls } from '../../../core/controls.js';
import { audio, midiToFreq as mtof } from '../../../core/audio.js';
import { sys } from '../../sys.js';
import { openMenu } from '../../ui.js';
import { style, appStore, emptyState, toast } from '../../kit.js';

// ==========================================================================
// Die Stücke: Tonart, Tempo, Akkordfolge und Aufbau – der Rest wird gerechnet
// ==========================================================================
const SCALES = {
  moll: [0, 2, 3, 5, 7, 8, 10],
  dorisch: [0, 2, 3, 5, 7, 9, 10],
  dur: [0, 2, 4, 5, 7, 9, 11],
  lydisch: [0, 2, 4, 6, 7, 9, 11],
};
const MOODS = ['Ambient', 'Lo-Fi', 'Synthwave', 'Minimal', 'Chiptune'];
const MOOD_COLORS = { Ambient: '#5b9df0', 'Lo-Fi': '#e58a5b', Synthwave: '#ff3d9a', Minimal: '#a9b2cf', Chiptune: '#5fe36a' };

// form: [Abschnitt, Takte] · prog: Stufen der Akkorde · span: Takte je Akkord · tail: Ausklang in Sekunden
const TRACKS = [
  { id: 'nebelmeer', title: 'Nebelmeer', artist: 'Luma Wend', mood: 'Ambient', style: 'ambient', bpm: 60, root: 50, scale: 'dorisch', key: 'D-Dorisch',
    prog: [0, 3, 5, 4], span: 2, tail: 5, seed: 11, colors: ['#0d1b3e', '#3d6fb8', '#9fe3ff'],
    form: [['intro', 4], ['a', 8], ['b', 8], ['c', 8], ['b', 8], ['outro', 4]] },
  { id: 'tiefsee', title: 'Tiefsee', artist: 'Tomke Lindqvist', mood: 'Ambient', style: 'ambient', bpm: 52, root: 53, scale: 'lydisch', key: 'F-Lydisch',
    prog: [0, 1, 5, 0], span: 2, tail: 5, seed: 23, colors: ['#04222b', '#0f7c82', '#7af0c8'],
    form: [['intro', 4], ['a', 6], ['b', 8], ['c', 8], ['outro', 6]] },
  { id: 'regenfenster', title: 'Regenfenster', artist: 'Kaya Morgenrot', mood: 'Lo-Fi', style: 'lofi', bpm: 78, root: 51, scale: 'dur', key: 'Es-Dur', swing: 0.3, lp: 3600,
    prog: [1, 4, 0, 5], span: 1, tail: 2.5, seed: 37, colors: ['#f1dcc2', '#e58a5b', '#6a5a8c'],
    form: [['intro', 4], ['a', 8], ['b', 8], ['break', 4], ['a2', 8], ['b2', 12], ['outro', 4]] },
  { id: 'kaffee', title: 'Kaffee um vier', artist: 'Kaya Morgenrot', mood: 'Lo-Fi', style: 'lofi', bpm: 86, root: 57, scale: 'dorisch', key: 'A-Dorisch', swing: 0.24, lp: 4200,
    prog: [0, 3, 6, 2], span: 1, tail: 2.5, seed: 41, colors: ['#ead7b8', '#b9643c', '#3f5d54'],
    form: [['intro', 4], ['a', 8], ['b', 12], ['break', 4], ['a2', 8], ['b2', 12], ['outro', 4]] },
  { id: 'neonkueste', title: 'Neonküste', artist: 'Velours 84', mood: 'Synthwave', style: 'synthwave', bpm: 104, root: 45, scale: 'moll', key: 'a-Moll',
    prog: [0, 5, 2, 6], span: 2, tail: 3, seed: 53, colors: ['#170634', '#ff3d9a', '#ffb347'],
    form: [['intro', 8], ['a', 8], ['b', 16], ['break', 8], ['a2', 8], ['b2', 12], ['outro', 4]] },
  { id: 'nachtfahrt', title: 'Nachtfahrt', artist: 'Neon Atlas', mood: 'Synthwave', style: 'synthwave', bpm: 116, root: 40, scale: 'moll', key: 'e-Moll',
    prog: [0, 6, 5, 4], span: 2, tail: 3, seed: 67, colors: ['#050a2a', '#3d5bff', '#3ff0e0'],
    form: [['intro', 8], ['a', 16], ['b', 16], ['break', 8], ['a2', 8], ['b2', 12], ['outro', 4]] },
  { id: 'glasperlen', title: 'Glasperlen', artist: 'Mira Holt', mood: 'Minimal', style: 'minimal', bpm: 126, root: 60, scale: 'lydisch', key: 'C-Lydisch',
    prog: [0, 4, 3, 5], span: 4, tail: 3, seed: 79, colors: ['#eef0f4', '#2a2f45', '#ff6a3d'],
    form: [['intro', 8], ['a', 12], ['b', 16], ['c', 16], ['break', 8], ['d', 12], ['outro', 8]] },
  { id: 'pixelpfad', title: 'Pixelpfad', artist: 'Bit & Bolle', mood: 'Chiptune', style: 'chiptune', bpm: 148, root: 60, scale: 'dur', key: 'C-Dur',
    prog: [0, 4, 5, 3], span: 1, tail: 1.6, seed: 97, colors: ['#1b1d4a', '#5fe36a', '#ffd84a'],
    form: [['intro', 8], ['a', 16], ['b', 16], ['break', 8], ['a2', 16], ['c', 12], ['outro', 4]] },
];
const TR = {};
for (const tr of TRACKS) {
  tr.stepDur = 60 / tr.bpm / 4;
  tr.swing = tr.swing || 0;
  let at = 0;
  tr.secs = tr.form.map(([name, bars]) => { const sec = { name, bars, start: at }; at += bars; return sec; });
  tr.bars = at;
  tr.steps = at * 16;
  tr.dur = tr.steps * tr.stepDur;
  TR[tr.id] = tr;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Fester Zufallswert in [0, 1) für (a, b, c) – so klingt ein Takt bei jedem Hören gleich. */
function h01(a, b, c) {
  let x = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 362437)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** Stufe d der Tonleiter (auch negativ / über die Oktave hinaus) als MIDI-Note. */
function note(tr, d, oct = 0) {
  const sc = SCALES[tr.scale];
  return tr.root + sc[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7) + 12 * oct;
}
const fold = (m, lo, hi) => { while (m < lo) m += 12; while (m > hi) m -= 12; return m; };
/** Nächster Akkordton (Grundton, Terz, Quinte der Stufe cd) zu einer Tonleiterstufe. */
function snap(d, cd) {
  let best = d, dist = 99;
  for (let k = d - 3; k <= d + 3; k++) {
    const rel = (((k - cd) % 7) + 7) % 7;
    if ((rel === 0 || rel === 2 || rel === 4) && Math.abs(k - d) < dist) { best = k; dist = Math.abs(k - d); }
  }
  return best;
}

const motifs = new Map();
/** Ein Motiv: Töne (Stufe + Länge) auf einem Raster aus Sechzehnteln, je Stück und Abschnitt fest. */
function motif(tr, key, slots, density, span) {
  const id = `${tr.id}:${key}`;
  if (motifs.has(id)) return motifs.get(id);
  const r = rng(tr.seed * 977 + key.length * 131 + key.charCodeAt(0));
  const out = new Array(slots).fill(null);
  let d = [2, 4, 7][(r() * 3) | 0];
  for (let i = 0; i < slots; i++) {
    const weight = i % 4 === 0 ? 1.5 : i % 2 === 0 ? 1 : 0.4;
    if (r() >= density * weight) continue;
    d = clamp(d + [-2, -1, -1, 1, 1, 2, 0, 3, -3][(r() * 9) | 0], 0, span);
    out[i] = { d, len: 1 };
  }
  let prev = null;
  out.forEach((n, i) => {
    if (!n) return;
    if (prev) prev.n.len = Math.min(6, i - prev.i);
    prev = { n, i };
  });
  if (prev) prev.n.len = Math.min(8, slots - prev.i);
  motifs.set(id, out);
  return out;
}

// ==========================================================================
// Klangerzeugung: Stimmen mit Hüllkurve, Rauschen, Hall und Echo
// ==========================================================================
const FX = { ready: false };
let noiseBuf = null;

function ensureFX() {
  if (FX.ready) return;
  const { ctx, out } = audio();
  FX.master = ctx.createGain();
  FX.master.gain.value = P.volume * 0.9;
  FX.master.connect(out);
  FX.wet = ctx.createGain();
  FX.wet.connect(FX.master);
  // Hall: Impulsantwort aus abklingendem Rauschen
  const len = Math.floor(ctx.sampleRate * 2.8);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const k = i / len;
      lp += ((Math.random() * 2 - 1) - lp) * (0.55 - k * 0.4);
      d[i] = lp * Math.pow(1 - k, 2.6) * (i < 400 ? i / 400 : 1);
    }
  }
  FX.conv = ctx.createConvolver();
  FX.conv.buffer = ir;
  const revGain = ctx.createGain();
  revGain.gain.value = 0.9;
  FX.conv.connect(revGain);
  revGain.connect(FX.wet);
  // Echo mit Rückkopplung
  FX.delay = ctx.createDelay(1.5);
  const fb = ctx.createGain();
  fb.gain.value = 0.36;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 2600;
  FX.delay.connect(tone);
  tone.connect(fb);
  fb.connect(FX.delay);
  tone.connect(FX.wet);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  FX.ready = true;
}

/** Eine Sitzung = die Wiedergabe von „jetzt bis Pause“. Beim Schließen verstummt alles, was schon geplant war. */
function openSession(tr) {
  const { ctx } = audio();
  ensureFX();
  const now = ctx.currentTime;
  const S = { dry: ctx.createGain(), rev: ctx.createGain(), del: ctx.createGain(), lp: null };
  S.dry.gain.setValueAtTime(0, now);
  S.dry.gain.linearRampToValueAtTime(1, now + 0.04);
  if (tr.lp) {
    S.lp = ctx.createBiquadFilter();
    S.lp.type = 'lowpass';
    S.lp.frequency.value = tr.lp;
    S.lp.Q.value = 0.4;
    S.dry.connect(S.lp);
    S.lp.connect(FX.master);
  } else S.dry.connect(FX.master);
  S.rev.connect(FX.conv);
  S.del.connect(FX.delay);
  FX.delay.delayTime.setValueAtTime(Math.min(1.4, tr.stepDur * 3), now);
  FX.wet.gain.cancelScheduledValues(now);
  FX.wet.gain.setTargetAtTime(1, now, 0.03);
  return S;
}
function closeSession(S, fade = 0.07) {
  if (!S) return;
  const { ctx } = audio();
  const now = ctx.currentTime;
  for (const g of [S.dry, S.rev, S.del]) {
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now);
    g.gain.linearRampToValueAtTime(0, now + fade);
  }
  setTimeout(() => { for (const n of [S.dry, S.rev, S.del, S.lp]) { try { n?.disconnect(); } catch { /* schon getrennt */ } } }, fade * 1000 + 120);
}

function route(S, g, o) {
  const { ctx } = audio();
  let tail = g;
  if (o.pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(o.pan, -1, 1);
    g.connect(p);
    tail = p;
  }
  tail.connect(S.dry);
  if (o.rev) { const s = ctx.createGain(); s.gain.value = o.rev; tail.connect(s); s.connect(S.rev); }
  if (o.del) { const s = ctx.createGain(); s.gain.value = o.del; tail.connect(s); s.connect(S.del); }
}

/**
 * Eine Stimme. decay: klingt wie eine gezupfte Saite über dur aus; sonst Anschlag – Halten – Loslassen.
 * det: zweiter, verstimmter Oszillator (Cent) · cut/cutEnd: Tiefpass mit Fahrt · vib: Vibrato · rev/del: Anteil Hall/Echo
 */
function voice(S, o) {
  const { ctx } = audio();
  const { t, f, dur } = o;
  const vol = o.vol ?? 0.1, a = o.a ?? 0.005, r = o.r ?? 0.08;
  const g = ctx.createGain();
  let end;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + a);
  if (o.decay) {
    const tau = Math.max(0.01, (dur - a) / 4.2);
    g.gain.setTargetAtTime(0, t + a, tau);
    g.gain.setValueAtTime(vol * Math.exp(-(dur - a) / tau), t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.03);
    end = t + dur + 0.05;
  } else {
    const hold = t + Math.max(a, dur);
    g.gain.setValueAtTime(vol, hold);
    g.gain.linearRampToValueAtTime(0, hold + r);
    end = hold + r + 0.02;
  }
  let dest = g;
  if (o.cut) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = o.q ?? 0.8;
    lp.frequency.setValueAtTime(o.cut, t);
    if (o.cutEnd) lp.frequency.exponentialRampToValueAtTime(o.cutEnd, t + (o.cutT || dur));
    lp.connect(g);
    dest = lp;
  }
  const oscs = [ctx.createOscillator()];
  if (o.det) oscs.push(ctx.createOscillator());
  oscs.forEach((osc, i) => {
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(f, t);
    if (o.glide) osc.frequency.exponentialRampToValueAtTime(o.glide, t + (o.glideT || dur));
    if (o.det) osc.detune.value = i ? o.det : -o.det;
    osc.connect(dest);
    osc.start(t);
    osc.stop(end);
  });
  if (o.vib) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 5.2;
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(f * 0.004 * o.vib, t + Math.min(0.35, dur));
    lfo.connect(depth);
    for (const osc of oscs) depth.connect(osc.frequency);
    lfo.start(t);
    lfo.stop(end);
  }
  route(S, g, o);
}

/** Gefiltertes Rauschen mit kurzer Hüllkurve: Becken, Snare, Knistern. */
function hit(S, o) {
  const { ctx } = audio();
  const { t, dur } = o;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const fl = ctx.createBiquadFilter();
  fl.type = o.type || 'highpass';
  fl.frequency.setValueAtTime(o.f || 7000, t);
  if (o.f2) fl.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
  fl.Q.value = o.q ?? 0.7;
  const g = ctx.createGain();
  const a = o.a ?? 0.001;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.vol ?? 0.1, t + a);
  g.gain.setTargetAtTime(0, t + a, Math.max(0.004, (dur - a) / 4));
  src.connect(fl);
  fl.connect(g);
  src.start(t, Math.random() * 0.8);
  src.stop(t + dur + 0.06);
  route(S, g, o);
}
const kick = (S, t, vol = 0.5, f0 = 150, f1 = 44, dur = 0.3) => voice(S, { t, f: f0, glide: f1, glideT: dur * 0.6, dur, vol, decay: true, a: 0.002 });
function snare(S, t, vol = 0.3, dur = 0.17, o = {}) {
  hit(S, { t, dur, vol, type: 'bandpass', f: o.f || 2400, q: 0.5, rev: o.rev || 0 });
  voice(S, { t, f: 200, glide: 140, dur: 0.1, vol: vol * 0.7, type: 'triangle', decay: true, a: 0.002 });
}
const hat = (S, t, vol = 0.06, open = false, pan = 0) => hit(S, { t, dur: open ? 0.24 : 0.045, vol, f: 7600, pan });

// ==========================================================================
// Die fünf Stimmungen: jede Funktion setzt die Töne eines Sechzehntels
// K: {S, t, s (Schritt im Takt), bar, g (Schritt im Stück), sn (Abschnitt), sb (Takt im Abschnitt), sl (Länge des Abschnitts),
//     cd (Akkordstufe), chordStart, chordLeft (Schritte bis zum Wechsel), first, rnd(k), rs(k)}
// ==========================================================================
const STYLES = {
  ambient(tr, K) {
    const { S, t, s, sn, cd } = K;
    const L = { intro: [0, 0, 0], a: [1, 0, 0], b: [1, 1, 0], c: [1.3, 1, 1], outro: [0.5, 0, 0] }[sn];   // Glocken, Schimmer, Puls
    if (K.chordStart || K.first) {
      const dur = K.chordLeft * tr.stepDur;
      const at = Math.min(2.4, dur * 0.4);
      [note(tr, cd, 0), note(tr, cd + 4, 0), note(tr, cd + 2, 1), note(tr, cd + 6, 1)].forEach((m, i) => voice(S, {
        t: t + i * 0.08, f: mtof(m), dur: dur - 0.1, type: 'sawtooth', det: 9, cut: 480 + i * 130, q: 0.4, a: at, r: 3.2, vol: 0.042, rev: 0.7, pan: (i - 1.5) * 0.4,
      }));
      voice(S, { t, f: mtof(fold(note(tr, cd, -2), 31, 43)), dur, a: 1.2, r: 2.6, vol: 0.15 });
      if (K.sb === 0 && sn !== 'a' && sn !== 'b') hit(S, { t, dur: Math.min(8, dur), vol: 0.035, type: 'bandpass', f: 320, f2: 1500, q: 1.2, a: Math.min(3, dur * 0.45), rev: 0.5 });
    }
    if (L[0] && s % 2 === 0 && K.rs(1) < 0.115 * L[0]) {
      const d = [0, 2, 4, 6, 7, 9, 11][(K.rs(2) * 7) | 0];
      const f = mtof(note(tr, cd + d, 1));
      const pan = K.rs(3) * 1.4 - 0.7;
      voice(S, { t, f, dur: 3.2, decay: true, vol: 0.06, a: 0.004, rev: 0.75, del: 0.45, pan });
      voice(S, { t, f: f * 2.76, dur: 0.9, decay: true, vol: 0.012, rev: 0.6, pan });
    }
    if (L[1] && s % 4 === 2) {
      const i = (K.bar * 4 + (s >> 2)) % 4;
      voice(S, { t, f: mtof(note(tr, cd + [0, 2, 4, 6][i], 2)), dur: 1.5, decay: true, type: 'triangle', vol: 0.022, rev: 0.6, del: 0.5, pan: i % 2 ? 0.5 : -0.5 });
    }
    if (L[2] && (s === 0 || s === 10)) kick(S, t, s ? 0.14 : 0.22, 86, 40, 0.34);
  },

  lofi(tr, K) {
    const { S, t, s, sn, cd, bar } = K;
    // Tasten, Schlagzeug, Bass, Melodie, Becken dichter
    const L = { intro: { k: 1 }, a: { k: 1, d: 1, b: 1 }, b: { k: 1, d: 1, b: 1, m: 1 }, break: { k: 1, b: 1, m: 0.7 }, a2: { k: 1, d: 1, b: 1, h: 1 }, b2: { k: 1, d: 1, b: 1, m: 1, h: 1 }, outro: { k: 1, b: 1 } }[sn];
    const fading = sn === 'outro' ? 1 - K.sb / K.sl : 1;
    if (L.k && (s === 0 || s === 6 || (s === 11 && K.rnd(1) < 0.45) || (K.first && s < 6))) {
      const long = s === 0 || K.first;
      [2, 4, 6, 8].forEach((k, i) => {
        const f = mtof(fold(note(tr, cd + k, 0), 55, 74));
        const at = t + i * 0.016 + Math.random() * 0.006;
        const vol = 0.085 * fading * (long ? 1 : 0.75);
        voice(S, { t: at, f, dur: long ? 2.7 : 1.3, decay: true, det: 5, vol, rev: 0.22 });
        voice(S, { t: at, f, dur: long ? 1.5 : 0.7, decay: true, type: 'triangle', cut: 1400, vol: vol * 0.45 });
      });
    }
    if (L.b) {
      const root = fold(note(tr, cd, -2), 31, 43);
      if (s === 0) voice(S, { t, f: mtof(root), dur: tr.stepDur * 6, type: 'triangle', cut: 420, a: 0.012, r: 0.18, vol: 0.3 * fading });
      else if (s === 10) voice(S, { t, f: mtof(K.rnd(2) < 0.5 ? root + 7 : root), dur: tr.stepDur * 3.5, type: 'triangle', cut: 420, a: 0.012, r: 0.14, vol: 0.24 * fading });
      else if (s === 14 && K.rnd(3) < 0.4) voice(S, { t, f: mtof(root + (K.rnd(4) < 0.5 ? 10 : 5)), dur: tr.stepDur * 1.6, type: 'triangle', cut: 420, a: 0.01, r: 0.1, vol: 0.2 });
    }
    if (L.d) {
      if (s === 0 || s === (bar % 2 ? 7 : 10)) kick(S, t, 0.5, 120, 46, 0.26);
      if (s === 4 || s === 12) snare(S, t, 0.2, 0.2, { f: 1700, rev: 0.12 });
      if (s === 15 && K.rnd(5) < 0.25) snare(S, t, 0.07, 0.1, { f: 1700 });
      if (s % 2 === 0) hat(S, t, (s % 4 === 2 ? 0.05 : 0.028) * (0.7 + Math.random() * 0.5), false, 0.25);
      else if (L.h && K.rs(6) < 0.3) hat(S, t, 0.018, false, 0.25);
    }
    if (L.m) {
      const mo = motif(tr, sn[0], 32, 0.3, 9);
      const n = mo[(K.sb % 2) * 16 + s];
      if (n) {
        const d = s % 4 === 0 ? snap(n.d + 7, cd) : n.d + 7;
        voice(S, { t, f: mtof(fold(note(tr, d, 0), 67, 88)), dur: n.len * tr.stepDur * 0.92, type: 'triangle', cut: 2300, a: 0.014, r: 0.22, vol: 0.1 * L.m, vib: 2.5, del: 0.28, rev: 0.3 });
      }
    }
    if (K.rs(7) < 0.42) hit(S, { t: t + Math.random() * tr.stepDur, dur: 0.004 + Math.random() * 0.01, vol: 0.012 + Math.random() * 0.022, f: 2200, pan: Math.random() * 1.6 - 0.8 });
  },

  synthwave(tr, K) {
    const { S, t, s, sn, cd, bar } = K;
    // Fläche, Arpeggio, Bass, Schlagzeug, Melodie, dichte Becken
    const L = { intro: { arp: 0.5 }, a: { arp: 1, b: 1, d: 1 }, b: { arp: 1, b: 1, d: 1, l: 1 }, break: { arp: 0.7, l: 0.6 }, a2: { arp: 1, b: 1, d: 1, h: 1 }, b2: { arp: 1, b: 1, d: 1, l: 1, h: 1 }, outro: { arp: 0.6, d: 0.5 } }[sn];
    const rise = sn === 'intro' ? K.sb / K.sl : 1;
    if (K.chordStart || K.first) {
      const dur = K.chordLeft * tr.stepDur;
      [0, 2, 4].forEach((k, i) => voice(S, { t, f: mtof(fold(note(tr, cd + k, 1), 55, 72)), dur: dur - 0.05, type: 'sawtooth', det: 11, cut: 1300, q: 0.5, a: 0.3, r: 0.9, vol: L.d ? 0.03 : 0.05, rev: 0.4, pan: (i - 1) * 0.5 }));
    }
    if (L.b && (s % 2 === 0 || L.h)) {
      const root = fold(note(tr, cd, -2), 33, 45);
      voice(S, { t, f: mtof(s % 8 === 6 ? root + 12 : root), dur: tr.stepDur * (L.h ? 1.3 : 2.1), decay: true, type: 'sawtooth', cut: 1000, cutEnd: 170, q: 2.5, vol: s % 4 === 0 ? 0.19 : 0.15 });
    }
    if (L.arp) {
      const i = [0, 1, 2, 3, 2, 1, 2, 3][s % 8];
      const f = mtof(fold(note(tr, cd + [0, 2, 4, 7][i], 1), 57, 81));
      voice(S, { t, f, dur: tr.stepDur * 1.5, decay: true, type: 'sawtooth', cut: (700 + 1900 * rise) * L.arp + 300, cutEnd: 420, q: 1.5, vol: L.d ? 0.05 : 0.085, del: 0.32, rev: 0.12, pan: s % 2 ? 0.35 : -0.35 });
    }
    if (L.d) {
      if (s % 4 === 0) kick(S, t, 0.55 * L.d, 150, 46, 0.3);
      if ((s === 4 || s === 12) && L.d === 1) snare(S, t, 0.3, 0.3, { f: 2100, rev: 0.45 });
      if (s % 4 === 2) hat(S, t, 0.07 * L.d, s === 14 && bar % 2 === 1, -0.2);
      else if (L.h && s % 2 === 1) hat(S, t, 0.03, false, -0.2);
      if (K.sb === K.sl - 1 && s >= 12 && L.d === 1) voice(S, { t, f: 220 - (s - 12) * 34, glide: 90, dur: 0.22, decay: true, vol: 0.3, rev: 0.3, pan: (s - 13.5) * 0.4 });
    }
    if (L.l) {
      const mo = motif(tr, sn[0], 32, 0.34, 8);
      const n = mo[(K.sb % 2) * 16 + s];
      if (n) {
        const d = s % 4 === 0 ? snap(n.d + 7, cd) : n.d + 7;
        voice(S, { t, f: mtof(fold(note(tr, d, 1), 69, 90)), dur: n.len * tr.stepDur * 0.95, type: 'sawtooth', det: 7, cut: 3200, q: 1, a: 0.02, r: 0.25, vol: 0.075 * L.l, vib: 4, del: 0.42, rev: 0.3 });
      }
    }
  },

  minimal(tr, K) {
    const { S, t, s, sn, cd, g } = K;
    // zweite Stimme, Puls, Glas, Becken
    const L = { intro: {}, a: { v2: 1 }, b: { v2: 1, p: 1 }, c: { v2: 1, p: 1, gl: 1, h: 1 }, break: { v2: 1, gl: 1 }, d: { v2: 1, p: 1, gl: 1, h: 1 }, outro: { v2: 0.5 } }[sn];
    // Zelle aus zwölf Sechzehnteln gegen den Viervierteltakt: das Muster wandert von selbst
    const cell = motif(tr, 'zelle', 12, 0.78, 8);
    const thin = sn === 'outro' ? 1 - (K.sb / K.sl) * 0.85 : sn === 'intro' ? 0.45 + 0.55 * (K.sb / K.sl) : 1;
    const mallet = (n, pan, vol, oct) => {
      if (!n) return;
      const f = mtof(fold(note(tr, snap(cd + n.d, cd), oct), 60 + oct * 12, 84 + oct * 12));
      voice(S, { t, f, dur: 0.42, decay: true, vol, a: 0.002, rev: 0.22, pan });
      voice(S, { t, f: f * 4, dur: 0.08, decay: true, vol: vol * 0.18, a: 0.001, pan });
    };
    if (K.rs(1) < thin) mallet(cell[g % 12], -0.55, L.p ? 0.11 : 0.15, 0);
    if (L.v2 && K.rs(2) < thin * L.v2) {
      const shift = 1 + Math.floor(K.bar / 4);
      mallet(cell[(g + shift) % 12], 0.55, L.p ? 0.085 : 0.11, s % 8 < 4 ? 0 : 1);
    }
    if (L.p) {
      if (s % 4 === 0) kick(S, t, 0.34, 110, 48, 0.22);
      if (s === 0) voice(S, { t, f: mtof(fold(note(tr, cd, -2), 36, 47)), dur: tr.stepDur * 14, a: 0.03, r: 0.3, vol: 0.2 });
    }
    if (L.h && s % 2 === 0) hit(S, { t, dur: 0.05, vol: s % 4 === 2 ? 0.04 : 0.02, type: 'bandpass', f: 5600, q: 1.4, a: 0.008, pan: 0.2 });
    if (L.gl && s === 0 && K.bar % 2 === 0) {
      const f = mtof(note(tr, cd + [4, 2, 6, 7][(K.bar >> 1) % 4], 1));
      voice(S, { t, f, dur: tr.stepDur * 26, a: tr.stepDur * 10, r: 1.6, vol: 0.05, rev: 0.6, det: 4 });
    }
  },

  chiptune(tr, K) {
    const { S, t, s, sn, cd, bar } = K;
    // Arpeggio, Bass, Schlagzeug, Melodie (1 = normal, 2 = eine Oktave höher)
    const L = { intro: { arp: 1, b: K.sb >= 4 ? 1 : 0 }, a: { arp: 1, b: 1, d: 1, l: 1 }, b: { arp: 1, b: 1, d: 1, l: 1 }, break: { b: 1, d: 1, arp: K.sb >= 4 ? 1 : 0 }, a2: { arp: 1, b: 1, d: 1, l: 1 }, c: { arp: 1, b: 1, d: 1, l: 2 }, outro: { arp: 1, b: 1, d: 1 } }[sn];
    const lastBar = sn === 'outro' && K.sb === K.sl - 1;
    if (lastBar) {
      // Schlusskadenz: zwei Schläge, dann der Grundakkord
      if (s === 0 || s === 4) { kick(S, t, 0.4, 130, 50, 0.12); [0, 2, 4].forEach((k) => voice(S, { t, f: mtof(note(tr, k + (s ? 0 : 4), 0)), dur: tr.stepDur * 2, type: 'square', vol: 0.035, a: 0.002, r: 0.02 })); }
      if (s === 8) [0, 2, 4, 7].forEach((k) => voice(S, { t, f: mtof(note(tr, k, 0)), dur: tr.stepDur * 7, type: 'square', vol: 0.035, a: 0.002, r: 0.3 }));
      if (s === 8) voice(S, { t, f: mtof(fold(note(tr, 0, -2), 36, 47)), dur: tr.stepDur * 7, type: 'triangle', vol: 0.22, r: 0.3 });
      return;
    }
    if (L.arp) {
      const k = [0, 2, 4, 2][s % 4] + (s % 8 >= 4 && sn !== 'intro' ? 7 : 0);
      voice(S, { t, f: mtof(fold(note(tr, cd + k, 0), 60, 84)), dur: tr.stepDur * 0.8, type: 'square', vol: L.l ? 0.03 : 0.075, a: 0.002, r: 0.01, pan: -0.3 });
    }
    if (L.b && s % 2 === 0) {
      const root = fold(note(tr, cd, -2), 36, 47);
      const m = root + [0, 0, 7, 0, 0, 0, 7, 12][s >> 1];
      voice(S, { t, f: mtof(m), dur: tr.stepDur * 1.6, type: 'triangle', vol: 0.24, a: 0.003, r: 0.03 });
    }
    if (L.d) {
      if (s % 8 === 0 || s === 10) kick(S, t, 0.4, 130, 50, 0.1);
      if (s === 4 || s === 12) hit(S, { t, dur: 0.09, vol: 0.13, type: 'bandpass', f: 1800, q: 0.4 });
      if (s % 4 === 2) hit(S, { t, dur: 0.025, vol: 0.05, f: 8000 });
      if (K.sb === K.sl - 1 && s >= 12) hit(S, { t, dur: 0.05, vol: 0.11, type: 'bandpass', f: 1800, q: 0.4 });
    }
    if (L.l) {
      const mo = motif(tr, sn[0], 32, 0.52, 9);
      const n = mo[(K.sb % 2) * 16 + s];
      if (n) {
        const d = s % 4 === 0 ? snap(n.d + 7, cd) : n.d + 7;
        const m = fold(note(tr, d, 0), 72, 88) + (L.l === 2 && bar % 4 >= 2 ? 12 : 0);
        voice(S, { t, f: mtof(m), dur: n.len * tr.stepDur * 0.86, type: 'square', vol: 0.06, a: 0.002, r: 0.03, vib: n.len > 3 ? 3 : 0, del: 0.12, pan: 0.2 });
      }
    }
  },
};

function scheduleStep(tr, g, time, first) {
  const bar = Math.floor(g / 16), s = g % 16;
  const sec = tr.secs.find((x) => bar < x.start + x.bars) || tr.secs[tr.secs.length - 1];
  STYLES[tr.style](tr, {
    S: P.S, g, s, bar, first,
    t: time + (s % 2 ? tr.swing * tr.stepDur : 0),
    sn: sec.name, sb: bar - sec.start, sl: sec.bars,
    cd: tr.prog[Math.floor(bar / tr.span) % tr.prog.length],
    chordStart: s === 0 && bar % tr.span === 0,
    chordLeft: (tr.span - (bar % tr.span)) * 16 - s,
    rnd: (k) => h01(tr.seed, bar, k),
    rs: (k) => h01(tr.seed, g, k + 100),
  });
}

// ==========================================================================
// Der Player lebt im Modul: Fenster und Widget sind nur Fernbedienungen
// ==========================================================================
const store = appStore('music');
const saved = store.get('state', {});
const P = {
  cur: TR[saved.cur] ? saved.cur : TRACKS[0].id,
  playing: false, pos: 0, step: 0, nextT: 0, endAt: 0, first: false, S: null, timer: 0,
  volume: clamp(Number(saved.volume ?? 0.8), 0, 1),
  shuffle: !!saved.shuffle,
  repeat: ['off', 'all', 'one'].includes(saved.repeat) ? saved.repeat : 'all',
  list: TRACKS.map((t) => t.id), listName: 'Alle Stücke', order: null,
  queue: [],
  announced: false,
};
const subs = new Set();
const emit = (why) => {
  announce();
  for (const fn of [...subs]) { try { fn(why); } catch (err) { console.error(err); } }
};
const persist = () => store.set('state', { cur: P.cur, volume: P.volume, shuffle: P.shuffle, repeat: P.repeat });

const position = () => {
  const tr = TR[P.cur];
  if (!P.playing) return clamp(P.pos, 0, tr.dur);
  return clamp(P.step * tr.stepDur - (P.nextT - audio().ctx.currentTime), 0, tr.dur);
};

function tick() {
  if (!P.playing) return;
  const { ctx } = audio();
  const tr = TR[P.cur];
  if (P.endAt) { if (ctx.currentTime >= P.endAt) advance(true); return; }
  if (!sys.nowPlaying) announce();                                           // eine andere App hat sich abgemeldet – wir spielen noch
  if (P.nextT < ctx.currentTime - 0.08) P.nextT = ctx.currentTime + 0.05;     // Verspätung (Tab war eingefroren): nicht nachholen
  const ahead = document.hidden ? 1.6 : 0.22;
  let guard = 0;
  while (P.nextT < ctx.currentTime + ahead && guard++ < 96) {
    if (P.step >= tr.steps) { P.endAt = P.nextT + tr.tail; break; }
    try { scheduleStep(tr, P.step, P.nextT, P.first); } catch (err) { console.error(err); }
    P.first = false;
    P.step++;
    P.nextT += tr.stepDur;
  }
}
function start() {
  const { ctx } = audio();
  const tr = TR[P.cur];
  if (P.pos >= tr.dur - 0.05) P.pos = 0;
  P.S = openSession(tr);
  P.step = clamp(Math.floor(P.pos / tr.stepDur + 1e-6), 0, tr.steps);
  P.first = true;
  P.endAt = 0;
  P.nextT = ctx.currentTime + 0.07;
  P.playing = true;
  P.announced = true;
  clearInterval(P.timer);
  P.timer = setInterval(tick, 40);
  tick();
}
function halt() {
  if (!P.playing) return;
  P.pos = position();
  P.playing = false;
  clearInterval(P.timer);
  P.timer = 0;
  closeSession(P.S);
  P.S = null;
}

function order() {
  if (!P.shuffle) return P.list;
  if (!P.order || P.order.length !== P.list.length || P.order.some((id) => !P.list.includes(id))) {
    const rest = P.list.filter((id) => id !== P.cur);
    for (let i = rest.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [rest[i], rest[j]] = [rest[j], rest[i]]; }
    P.order = P.list.includes(P.cur) ? [P.cur, ...rest] : rest;
  }
  return P.order;
}
/** Die nächsten Stücke aus der aktuellen Liste (ohne Warteschlange). */
function upcoming(n = 8) {
  const o = order();
  if (!o.length) return [];
  const i = o.indexOf(P.cur);
  const out = [];
  for (let k = 1; k <= o.length && out.length < n; k++) {
    const j = i + k;
    if (j >= o.length && P.repeat === 'off') break;
    out.push(o[j % o.length]);
  }
  return out;
}
function load(id, autoplay) {
  halt();
  P.cur = id;
  P.pos = 0;
  persist();
  if (autoplay) start();
  emit('track');
}
function advance(auto) {
  const was = P.playing;
  if (auto && P.repeat === 'one') { halt(); P.pos = 0; start(); emit('track'); return; }
  const next = P.queue.length ? P.queue.shift() : upcoming(1)[0];
  if (!next) { halt(); P.pos = 0; emit('state'); return; }
  if (!P.queue.length && P.shuffle && order().indexOf(next) === 0) P.order = null;      // neue Runde, neu gemischt
  load(next, auto || was);
}

const Player = {
  play(id, list, listName) {
    if (list) { P.list = [...list]; P.listName = listName || 'Auswahl'; P.order = null; }
    if (id && id !== P.cur) load(id, true);
    else if (id) { halt(); P.pos = 0; start(); emit('track'); } else if (!P.playing) { start(); emit('state'); }
  },
  pause() { if (P.playing) { halt(); emit('state'); } },
  toggle() { if (P.playing) Player.pause(); else Player.play(); },
  next() { advance(false); },
  prev() {
    if (position() > 3) { Player.seek(0); return; }
    const o = order();
    const i = o.indexOf(P.cur);
    const id = i > 0 ? o[i - 1] : P.repeat === 'off' ? null : o[o.length - 1];
    if (id) load(id, P.playing); else Player.seek(0);
  },
  seek(sec) {
    const was = P.playing;
    halt();
    P.pos = clamp(sec, 0, TR[P.cur].dur - 0.02);
    if (was) start();
    emit('seek');
  },
  /** Alles anhalten und abmelden (Fenster geschlossen). */
  stop() {
    halt();
    if (FX.ready) FX.wet.gain.setTargetAtTime(0, audio().ctx.currentTime, 0.06);
    P.announced = false;
    emit('state');
  },
  setVolume(v) {
    P.volume = clamp(v, 0, 1);
    if (FX.ready) FX.master.gain.setTargetAtTime(P.volume * 0.9, audio().ctx.currentTime, 0.02);
    persist();
    emit('volume');
  },
  setShuffle(on) { P.shuffle = on; P.order = null; persist(); emit('mode'); },
  setRepeat(mode) { P.repeat = mode; persist(); emit('mode'); },
  cycleRepeat() { Player.setRepeat({ off: 'all', all: 'one', one: 'off' }[P.repeat]); },
  enqueue(id, front = false) { if (front) P.queue.unshift(id); else P.queue.push(id); emit('queue'); },
  dequeue(i) { P.queue.splice(i, 1); emit('queue'); },
  clearQueue() { P.queue = []; emit('queue'); },
};

/** „Läuft gerade“ im System und in der MediaSession des Browsers melden. */
let msBound = false;
function announce() {
  const tr = TR[P.cur];
  const ms = navigator.mediaSession;
  if (!P.announced) {
    if (sys.nowPlaying?.app === 'music') sys.media(null);
    try { if (ms) { ms.playbackState = 'none'; ms.metadata = null; } } catch { /* nicht unterstützt */ }
    return;
  }
  const np = sys.nowPlaying;
  if (!np || np.app !== 'music' || np.title !== tr.title || np.playing !== P.playing) {
    sys.media({ app: 'music', title: tr.title, artist: tr.artist, playing: P.playing, toggle: Player.toggle, next: Player.next, prev: Player.prev });
  }
  try {
    if (!ms) return;
    if (ms.metadata?.title !== tr.title && window.MediaMetadata) {
      ms.metadata = new MediaMetadata({ title: tr.title, artist: tr.artist, album: 'fableOS Musik', artwork: [{ src: cover(tr), sizes: '320x320', type: 'image/jpeg' }] });
    }
    ms.playbackState = P.playing ? 'playing' : 'paused';
    if (!msBound) {
      msBound = true;
      ms.setActionHandler('play', () => Player.play());
      ms.setActionHandler('pause', () => Player.pause());
      ms.setActionHandler('nexttrack', () => Player.next());
      ms.setActionHandler('previoustrack', () => Player.prev());
    }
  } catch { /* MediaSession ist optional */ }
}

// ==========================================================================
// Cover: jedes Stück bekommt ein gerechnetes Bild in seinen Farben
// ==========================================================================
const ART = {
  ambient(c, N, r, c1, c2, c3) {
    const g = c.createLinearGradient(0, 0, N, N);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    c.fillStyle = g; c.fillRect(0, 0, N, N);
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const x = r() * N, y = r() * N, rad = N * (0.25 + r() * 0.4);
      const rg = c.createRadialGradient(x, y, 0, x, y, rad);
      rg.addColorStop(0, i % 2 ? c3 : c2); rg.addColorStop(1, 'transparent');
      c.globalAlpha = 0.34; c.fillStyle = rg; c.fillRect(0, 0, N, N);
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.strokeStyle = 'rgba(255, 255, 255, .3)'; c.lineWidth = N / 320;
    const cx = N * (0.3 + r() * 0.4), cy = N * (0.55 + r() * 0.2);
    for (let i = 1; i <= 7; i++) { c.globalAlpha = 1 - i / 9; c.beginPath(); c.ellipse(cx, cy, i * N * 0.085, i * N * 0.03, 0, 0, TAU); c.stroke(); }
    c.globalAlpha = 1;
  },
  lofi(c, N, r, c1, c2, c3) {
    c.fillStyle = c1; c.fillRect(0, 0, N, N);
    c.fillStyle = c2; c.beginPath(); c.arc(N * (0.35 + r() * 0.3), N * 0.46, N * 0.24, 0, TAU); c.fill();
    for (let i = 0; i < 4; i++) {
      const y = N * (0.56 + i * 0.11), ph = r() * TAU, f = 1 + r() * 1.5;
      c.globalAlpha = 0.5 + i * 0.16; c.fillStyle = c3;
      c.beginPath(); c.moveTo(0, N);
      for (let x = 0; x <= N; x += 4) c.lineTo(x, y + Math.sin((x / N) * TAU * f + ph) * N * 0.035);
      c.lineTo(N, N); c.fill();
    }
    c.globalAlpha = 1;
    for (let i = 0; i < 1400; i++) { c.fillStyle = r() < 0.5 ? 'rgba(0, 0, 0, .07)' : 'rgba(255, 255, 255, .09)'; c.fillRect(r() * N, r() * N, 1.5, 1.5); }
  },
  synthwave(c, N, r, c1, c2, c3) {
    const hz = N * 0.62;
    const g = c.createLinearGradient(0, 0, 0, hz);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    c.fillStyle = g; c.fillRect(0, 0, N, hz);
    for (let i = 0; i < 50; i++) { c.fillStyle = `rgba(255, 255, 255, ${0.2 + r() * 0.6})`; c.fillRect(r() * N, r() * hz * 0.6, 1.4, 1.4); }
    const sg = c.createLinearGradient(0, hz - N * 0.5, 0, hz);
    sg.addColorStop(0, c3); sg.addColorStop(1, c2);
    c.fillStyle = sg; c.beginPath(); c.arc(N / 2, hz - N * 0.06, N * 0.25, 0, TAU); c.fill();
    c.fillStyle = c1;
    for (let i = 0; i < 5; i++) c.fillRect(0, hz - N * 0.2 + i * N * 0.042, N, N * (0.006 + i * 0.004));
    c.fillStyle = c1; c.fillRect(0, hz, N, N - hz);
    c.strokeStyle = c2; c.lineWidth = N / 260; c.globalAlpha = 0.9;
    for (let i = 0; i <= 8; i++) { const y = hz + Math.pow(i / 8, 2.1) * (N - hz); c.beginPath(); c.moveTo(0, y); c.lineTo(N, y); c.stroke(); }
    for (let i = -8; i <= 8; i++) { c.beginPath(); c.moveTo(N / 2 + i * N * 0.03, hz); c.lineTo(N / 2 + i * N * 0.2, N); c.stroke(); }
    c.globalAlpha = 1;
  },
  minimal(c, N, r, c1, c2, c3) {
    c.fillStyle = c1; c.fillRect(0, 0, N, N);
    const n = 7, cell = N / (n + 1), ph = r() * TAU, hot = (r() * n * n) | 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const rad = cell * (0.1 + 0.33 * (0.5 + 0.5 * Math.sin(x * 0.9 + y * 0.55 + ph)));
        c.fillStyle = y * n + x === hot ? c3 : c2;
        c.beginPath(); c.arc(cell * (x + 1), cell * (y + 1), y * n + x === hot ? cell * 0.44 : rad, 0, TAU); c.fill();
      }
    }
  },
  chiptune(c, N, r, c1, c2, c3) {
    const n = 10, px = N / n;
    c.fillStyle = c1; c.fillRect(0, 0, N, N);
    for (let i = 0; i < 9; i++) { c.fillStyle = 'rgba(255, 255, 255, .5)'; c.fillRect(((r() * n) | 0) * px + px * 0.35, ((r() * 5) | 0) * px + px * 0.35, px * 0.3, px * 0.3); }
    // spiegelsymmetrische Zufallsfigur aus Pixeln
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 3; x++) {
        if (r() < 0.62) {
          c.fillStyle = r() < 0.75 ? c2 : c3;
          c.fillRect((2 + x) * px, (2.5 + y) * px, px + 0.5, px + 0.5);
          c.fillRect((7 - x) * px, (2.5 + y) * px, px + 0.5, px + 0.5);
        }
      }
    }
    c.fillStyle = c3;
    for (let x = 0; x < n; x++) c.fillRect(x * px, (n - 1 - (r() < 0.3 ? 1 : 0)) * px, px + 0.5, px * 2);
    c.fillStyle = 'rgba(0, 0, 0, .16)';
    for (let y = 0; y < N; y += 4) c.fillRect(0, y, N, 1);
  },
};
const covers = new Map();
function cover(tr) {
  if (!covers.has(tr.id)) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 320;
    ART[tr.style](cv.getContext('2d'), 320, rng(tr.seed * 7 + 3), ...tr.colors);
    covers.set(tr.id, cv.toDataURL('image/jpeg', 0.86));
  }
  return covers.get(tr.id);
}

// ==========================================================================
// Stile
// ==========================================================================
const svg = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const IC = {
  next: svg('<path d="M5.500 6v12a.5.5 0 0 0 .8.4l8.200-6a.5.5 0 0 0 0-.8L6.300 5.600a.5.5 0 0 0-.8.4z" fill="currentColor" stroke="none"/><path d="M18 5.500v13" stroke-width="2.300"/>'),
  prev: svg('<path d="M18.500 6v12a.5.5 0 0 1-.8.4l-8.200-6a.5.5 0 0 1 0-.8l8.200-6a.5.5 0 0 1 .8.4z" fill="currentColor" stroke="none"/><path d="M6 5.500v13" stroke-width="2.300"/>'),
  shuffle: svg('<path d="M3.500 7.500h2.700c1.500 0 2.900.7 3.700 2l3.200 5c.8 1.300 2.200 2 3.700 2h3.200M17.500 13.500l3 3-3 3M3.500 16.500h2.700c1.200 0 2.300-.5 3.100-1.300M20 7.500h-3.200c-1.200 0-2.300.5-3.100 1.300M17.500 4.500l3 3-3 3"/>'),
  repeat: svg('<path d="M16.500 3.500l3 3-3 3M4.500 11v-.5a4 4 0 0 1 4-4h11M7.500 20.500l-3-3 3-3M19.500 13v.5a4 4 0 0 1-4 4h-11"/>'),
  eq: '<i class="music-eq"><b></b><b></b><b></b></i>',
};

style('music', `
.music { position: relative; }
.music-body { position: relative; display: grid; grid-template-columns: minmax(0, 1fr); flex: 1; min-height: 0; }
.music-body.has-queue { grid-template-columns: minmax(0, 1fr) 250px; }
.music-body > .kit-split { min-width: 0; }

.music-hero { position: relative; display: flex; align-items: flex-end; gap: 18px; flex: 0 1 168px; min-height: 108px; padding: 14px 18px; overflow: hidden; border-bottom: .5px solid var(--line); isolation: isolate; }
.music-hero::before { content: ""; position: absolute; inset: 0; z-index: -2; background: radial-gradient(90% 130% at 0% 0%, color-mix(in srgb, var(--c2) 46%, transparent), transparent 70%), radial-gradient(80% 120% at 100% 100%, color-mix(in srgb, var(--c3) 34%, transparent), transparent 72%); opacity: .8; transition: opacity .6s; }
.music-vis { position: absolute; inset: 0; z-index: -1; width: 100%; height: 100%; }
.music-cover { flex: none; height: 100%; max-height: 140px; aspect-ratio: 1; border-radius: 14px; background: var(--well) center / cover; box-shadow: 0 18px 40px -14px rgba(0, 0, 14, .7), inset 0 0 0 .5px rgba(255, 255, 255, .25); transform: scale(var(--pulse, 1)); }
.music-meta { display: flex; flex-direction: column; justify-content: flex-end; gap: 2px; min-width: 0; max-height: 100%; overflow: hidden; padding-bottom: 2px; }
.music-meta > * { flex: none; text-shadow: 0 1px 10px color-mix(in srgb, var(--solid) 80%, transparent); }
.music-meta small { font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--fg-3); }
.music-meta h2 { font-size: 30px; font-weight: 750; letter-spacing: -.03em; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.music-meta p { font-size: 15px; font-weight: 550; color: var(--fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.music-meta span { margin-top: 5px; font-size: 12px; color: var(--fg-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }

.music-list { flex: 1 1 0; min-height: 128px; padding: 6px 10px 12px; outline: 0; }
.music-row { display: grid; grid-template-columns: 26px 38px minmax(0, 1fr) 96px 28px 44px; align-items: center; gap: 10px; padding: 5px 8px; border-radius: 10px; font-size: 13px; }
.music-row:hover { background: var(--raise); }
.music-row.is-sel { background: var(--raise-2); }
.music-num { display: grid; place-items: center; font-size: 12.5px; color: var(--fg-3); font-variant-numeric: tabular-nums; }
.music-row img { width: 38px; height: 38px; border-radius: 7px; }
.music-tt { display: grid; min-width: 0; }
.music-tt b, .music-tt small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.music-tt b { font-weight: 600; }
.music-tt small { font-size: 12px; color: var(--fg-3); }
.music-mood { font-size: 12px; color: var(--fg-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.music-dur { text-align: right; font-size: 12.5px; color: var(--fg-3); font-variant-numeric: tabular-nums; }
.music-row .tool { opacity: 0; }
.music-row:hover .tool, .music-row .tool:focus-visible, .music-row .tool.is-in { opacity: 1; }
.music-row .tool.is-in { color: var(--accent); }
.music-row.is-cur .music-tt b { color: var(--accent); }
.music-row .music-eq { display: none; }
.music-row.is-cur .music-n { display: none; }
.music-row.is-cur .music-eq { display: flex; }
.music-eq { display: flex; align-items: flex-end; gap: 2px; height: 12px; }
.music-eq b { width: 3px; height: 30%; border-radius: 1px; background: var(--accent); }
.is-playing .music-eq b { animation: music-eq .9s ease-in-out infinite; }
.is-playing .music-eq b:nth-child(2) { animation-duration: .7s; animation-delay: -.3s; }
.is-playing .music-eq b:nth-child(3) { animation-duration: 1.1s; animation-delay: -.6s; }
@keyframes music-eq { 0%, 100% { height: 25%; } 50% { height: 100%; } }

.music-queue { display: flex; flex-direction: column; min-width: 0; min-height: 0; border-left: .5px solid var(--line); background: rgba(0, 0, 14, .1); }
.music-queue-body { flex: 1; min-height: 0; padding: 4px 8px 12px; }
.music-q { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; align-items: center; gap: 9px; width: 100%; padding: 5px 6px; border: 0; border-radius: 9px; background: none; text-align: left; }
.music-q:hover { background: var(--raise); }
.music-q img { width: 34px; height: 34px; border-radius: 6px; }
.music-q .tool { width: 22px; height: 22px; opacity: 0; }
.music-q:hover .tool, .music-q .tool:focus-visible { opacity: 1; }
.music-q .tool .ico { width: 12px; height: 12px; }
.music-q.is-now { background: var(--raise); }
.music-queue-none { padding: 4px 8px 8px; font-size: 12.5px; color: var(--fg-3); }

.music-bar { display: grid; grid-template-columns: minmax(0, 1fr) minmax(250px, 1.5fr) minmax(0, 1fr); align-items: center; gap: 14px; flex: none; padding: 8px 14px 9px; border-top: .5px solid var(--line); background: rgba(0, 0, 14, .12); }
[data-theme="light"] .music-bar, [data-theme="light"] .music-queue { background: rgba(255, 255, 255, .3); }
.music-now { display: flex; align-items: center; gap: 10px; min-width: 0; }
.music-now img { flex: none; width: 42px; height: 42px; border-radius: 8px; box-shadow: 0 4px 12px -4px rgba(0, 0, 14, .5); }
.music-mid { display: grid; gap: 3px; min-width: 0; }
.music-btns { display: flex; align-items: center; justify-content: center; gap: 6px; }
.music-btns .tool { width: 32px; height: 32px; border-radius: 50%; }
.music-btns .tool .ico { width: 19px; height: 19px; }
.music-btns .tool.is-on { background: none; color: var(--accent); }
.music-btns .tool.is-on:hover { background: var(--raise); }
.music-rep { position: relative; }
.music-rep.is-one::after { content: "1"; position: absolute; right: 2px; top: 1px; display: grid; place-items: center; width: 12px; height: 12px; border-radius: 50%; background: var(--accent); color: #fff; font-size: 8.5px; font-weight: 800; }
.music-play { display: grid; place-items: center; flex: none; width: 40px; height: 40px; margin: 0 4px; padding: 0; border: 0; border-radius: 50%; background: var(--fg); color: var(--solid); transition: transform .4s var(--spring); }
.music-play:hover { transform: scale(1.07); }
.music-play:active { transform: scale(.92); }
.music-play .ico { width: 20px; height: 20px; }
.music-time { display: grid; grid-template-columns: 34px minmax(0, 1fr) 34px; align-items: center; gap: 8px; font-size: 11.5px; color: var(--fg-3); font-variant-numeric: tabular-nums; }
.music-time span:last-child { text-align: right; }
.music-seek { position: relative; height: 16px; cursor: pointer; touch-action: none; outline: 0; }
.music-seek::before { content: ""; position: absolute; left: 0; right: 0; top: 6px; height: 4px; border-radius: 9px; background: var(--well); box-shadow: inset 0 0 0 .5px var(--line); }
.music-seek i { position: absolute; left: 0; top: 6px; width: calc(var(--p, 0) * 100%); height: 4px; border-radius: 9px; background: var(--fg-2); }
.music-seek b { position: absolute; left: calc(var(--p, 0) * 100%); top: 2px; width: 12px; height: 12px; margin-left: -6px; border-radius: 50%; background: #fff; box-shadow: 0 1px 5px rgba(0, 0, 14, .5); scale: 0; transition: scale .3s var(--spring); }
.music-seek:hover i, .music-seek.is-drag i, .music-seek:focus-visible i { background: var(--accent); }
.music-seek:hover b, .music-seek.is-drag b, .music-seek:focus-visible b { scale: 1; }
.music-side { display: flex; align-items: center; justify-content: flex-end; gap: 4px; min-width: 0; }
.music-side .gslider { flex: 0 1 96px; min-width: 60px; height: 26px; }
.music-vol { display: grid; color: var(--fg-3); }
.music-vol .ico { width: 16px; height: 16px; }

.music-w-bg, .music-w-shade { position: absolute; inset: 0; }
.music-w-bg { background: center / cover; transition: background-image .5s; }
.music-w-shade { background: linear-gradient(180deg, rgba(0, 0, 14, .05) 30%, rgba(0, 0, 14, .78)); }
.music-w-eq { position: absolute; left: 14px; top: 14px; padding: 5px 6px; border-radius: 8px; background: rgba(0, 0, 14, .4); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); opacity: 0; transition: opacity .3s; }
.music-w-eq .music-eq b { background: #fff; }
.is-playing > .music-w-eq { opacity: 1; }
.music-w-txt { position: absolute; left: 14px; right: 58px; bottom: 13px; display: grid; color: #fff; text-shadow: 0 1px 4px rgba(0, 0, 14, .5); }
.music-w-txt b { font-size: 14.5px; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.music-w-txt span { font-size: 12px; opacity: .82; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.music-w-btn { position: absolute; right: 12px; bottom: 12px; display: grid; place-items: center; width: 38px; height: 38px; padding: 0; border: 0; border-radius: 50%; background: rgba(255, 255, 255, .92); color: #10122a; box-shadow: 0 6px 16px -4px rgba(0, 0, 14, .6); transition: transform .4s var(--spring); }
.music-w-btn:hover { transform: scale(1.08); }
.music-w-btn:active { transform: scale(.9); }
.music-w-btn .ico { width: 18px; height: 18px; }

@container win (max-width: 760px) {
  .music-body.has-queue { grid-template-columns: minmax(0, 1fr); }
  .music-queue { position: absolute; inset: 0 0 0 auto; z-index: 5; width: min(270px, 86%); background: color-mix(in srgb, var(--solid) 94%, transparent); -webkit-backdrop-filter: blur(24px); backdrop-filter: blur(24px); box-shadow: -18px 0 40px -18px rgba(0, 0, 14, .6); }
  [data-theme="light"] .music-queue { background: color-mix(in srgb, var(--solid) 94%, transparent); }
  .music-bar { grid-template-columns: minmax(0, .8fr) minmax(220px, 1.5fr) auto; }
  .music-side .gslider, .music-vol { display: none; }
  .music-row { grid-template-columns: 26px 38px minmax(0, 1fr) 28px 44px; }
  .music-mood { display: none; }
}
@container win (max-width: 560px) {
  .music-hero { flex-basis: 112px; min-height: 92px; padding: 12px 14px; gap: 12px; }
  .music-cover { max-height: 88px; border-radius: 11px; }
  .music-meta h2 { font-size: 21px; }
  .music-meta p { font-size: 13.5px; }
  .music-bar { grid-template-columns: minmax(0, 1fr) auto; gap: 8px; padding-inline: 10px; }
  .music-now { display: none; }
  .music-view .ico { display: block; }
}
.music-view { display: inline-flex; align-items: center; gap: 4px; min-width: 0; padding: 4px 8px; margin-left: -4px; border: 0; border-radius: 8px; background: none; }
.music-view .ico { display: none; width: 12px; height: 12px; color: var(--fg-3); }
.music-sub { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
`);

// ==========================================================================
// App
// ==========================================================================
export default {
  singleton: true,
  width: 940, height: 620, minW: 440, minH: 400,

  mount(win) {
    let view = { kind: 'all', mood: null };
    let selId = null;
    let playlist = store.get('playlist', []).filter((id) => TR[id]);
    let showQueue = !!store.get('queue', false);
    let dragging = false;

    const viewIds = () => (view.kind === 'all' ? TRACKS.map((t) => t.id) : view.kind === 'mood' ? TRACKS.filter((t) => t.mood === view.mood).map((t) => t.id) : playlist);
    const viewName = () => (view.kind === 'all' ? 'Alle Stücke' : view.kind === 'mood' ? view.mood : 'Wiedergabeliste');
    const cur = () => TR[P.cur];

    // ---------- Gerüst ----------
    const side = h('nav.kit-side.scroll', { 'aria-label': 'Sammlung' });
    const hero = h('div.music-hero');
    const vis = h('canvas.music-vis', { 'aria-hidden': 'true' });
    const coverEl = h('div.music-cover', { role: 'img' });
    const mMood = h('small'), mTitle = h('h2'), mArtist = h('p'), mInfo = h('span');
    hero.append(vis, coverEl, h('div.music-meta', mMood, mTitle, mArtist, mInfo));
    const vTitle = h('b.kit-title');
    const vBtn = h('button.music-view', { type: 'button', 'aria-label': 'Ansicht wählen' }, vTitle, h('span', { html: icon('chevronDown') }));
    const vSub = h('span.kit-muted.music-sub');
    const bPlayAll = h('button.kit-btn.round', { type: 'button', html: icon('play') }, 'Abspielen');
    const listEl = h('div.music-list.scroll', { tabIndex: 0, role: 'listbox', 'aria-label': 'Titel' });
    const queueEl = h('aside.music-queue', { hidden: true, 'aria-label': 'Warteschlange' });
    const body = h('div.music-body', h('div.kit-split', side, h('div.kit-main', hero, h('div.kit-bar', vBtn, vSub, h('span.sp'), bPlayAll), listEl)), queueEl);

    const nowImg = h('img', { alt: '' });
    const nowT = h('b'), nowA = h('small');
    const bShuffle = h('button.tool', { type: 'button', html: IC.shuffle, onclick: () => Player.setShuffle(!P.shuffle) });
    const bRepeat = h('button.tool.music-rep', { type: 'button', html: IC.repeat, onclick: () => Player.cycleRepeat() });
    const bPrev = h('button.tool', { type: 'button', 'aria-label': 'Zurück', title: 'Zurück', html: IC.prev, onclick: () => Player.prev() });
    const bNext = h('button.tool', { type: 'button', 'aria-label': 'Weiter', title: 'Weiter', html: IC.next, onclick: () => Player.next() });
    const bPlay = h('button.music-play', { type: 'button', onclick: () => Player.toggle() });
    const tPos = h('span', '0:00'), tDur = h('span', '0:00');
    const seek = h('div.music-seek', { role: 'slider', tabIndex: 0, 'aria-label': 'Position im Stück', 'aria-valuemin': 0 }, h('i'), h('b'));
    const volSl = h('div.gslider', { dataset: { min: 0, max: 1, step: 0.01, value: P.volume }, 'aria-label': 'Lautstärke' });
    const bQueue = h('button.tool', { type: 'button', 'aria-label': 'Warteschlange', title: 'Warteschlange', html: icon('list'), onclick: () => { showQueue = !showQueue; store.set('queue', showQueue); paintQueue(); } });
    const bar = h('div.music-bar',
      h('div.music-now', nowImg, h('span.music-tt', nowT, nowA)),
      h('div.music-mid', h('div.music-btns', bShuffle, bPrev, bPlay, bNext, bRepeat), h('div.music-time', tPos, seek, tDur)),
      h('div.music-side', h('span.music-vol', { html: icon('volume') }), volSl, bQueue));
    const root = h('div.kit-app.music', body, bar);
    win.body.append(root);
    initControls(bar);
    volSl.addEventListener('input', (e) => Player.setVolume(e.detail.value));

    // ---------- Seitenleiste & Liste ----------
    /** Verschwindet das fokussierte Element beim Neuzeichnen, bleibt die Tastatur im Fenster. */
    const keepFocus = () => {
      const a = document.activeElement;
      if (sys.wm.focused === win && (!a || a === document.body || !a.isConnected)) listEl.focus({ preventScroll: true });
    };
    const setView = (kind, mood = null) => { view = { kind, mood }; selId = null; paintSide(); paintList(); listEl.scrollTop = 0; keepFocus(); };
    const viewItems = () => [
      { label: 'Alle Stücke', icon: 'music', checked: view.kind === 'all', run: () => setView('all') },
      { label: 'Wiedergabeliste', icon: 'list', checked: view.kind === 'list', run: () => setView('list') },
      '-', { heading: 'Stimmungen' },
      ...MOODS.map((m) => ({ label: m, checked: view.kind === 'mood' && view.mood === m, run: () => setView('mood', m) })),
    ];
    vBtn.addEventListener('click', () => openMenu(viewItems(), { anchor: vBtn }));
    function paintSide() {
      const b = (ic, label, n, on, run, dot) => h('button', { type: 'button', class: on ? 'is-on' : '', onclick: run },
        dot ? h('i.kit-dot', { style: { '--c': dot } }) : h('i', { html: icon(ic), style: { display: 'grid' } }), h('span', label), h('span.kit-count', String(n)));
      side.replaceChildren(
        b('music', 'Alle Stücke', TRACKS.length, view.kind === 'all', () => setView('all')),
        b('list', 'Wiedergabeliste', playlist.length, view.kind === 'list', () => setView('list')),
        h('div.kit-head', 'Stimmungen'),
        ...MOODS.map((m) => {
          const ts = TRACKS.filter((t) => t.mood === m);
          return b('', m, ts.length, view.kind === 'mood' && view.mood === m, () => setView('mood', m), MOOD_COLORS[m]);
        }));
    }

    const rows = new Map();
    function togglePlaylist(id) {
      const had = playlist.includes(id);
      playlist = had ? playlist.filter((x) => x !== id) : [...playlist, id];
      store.set('playlist', playlist);
      toast(win, had ? 'Aus der Wiedergabeliste entfernt' : 'Zur Wiedergabeliste hinzugefügt');
      paintSide();
      paintList();
      keepFocus();
    }
    const playFrom = (id) => Player.play(id, viewIds(), viewName());
    function rowMenu(id, e) {
      const inList = playlist.includes(id);
      openMenu([
        { label: 'Abspielen', icon: 'play', run: () => playFrom(id) },
        { label: 'Als Nächstes abspielen', icon: 'arrowRight', run: () => { Player.enqueue(id, true); toast(win, 'Wird als Nächstes gespielt'); } },
        { label: 'An die Warteschlange anhängen', icon: 'list', run: () => { Player.enqueue(id); toast(win, 'Zur Warteschlange hinzugefügt'); } },
        '-',
        { label: inList ? 'Aus Wiedergabeliste entfernen' : 'Zur Wiedergabeliste', icon: inList ? 'minus' : 'plus', run: () => togglePlaylist(id) },
      ], { x: e.clientX, y: e.clientY });
    }
    function paintList() {
      const ids = viewIds();
      vTitle.textContent = viewName();
      const total = ids.reduce((s, id) => s + TR[id].dur, 0);
      vSub.textContent = ids.length ? `${ids.length} ${ids.length === 1 ? 'Stück' : 'Stücke'} · ${Math.round(total / 60)} Min.` : '';
      bPlayAll.disabled = !ids.length;
      rows.clear();
      if (!ids.length) {
        listEl.replaceChildren(emptyState('music', 'Deine Wiedergabeliste ist leer', 'Füge Stücke über das Plus in der Titelliste hinzu – oder per Rechtsklick.'));
        return;
      }
      listEl.replaceChildren(...ids.map((id, i) => {
        const tr = TR[id];
        const inList = playlist.includes(id);
        const add = h('button.tool', { type: 'button', class: inList ? 'is-in' : '', html: icon(inList ? 'check' : 'plus'), title: inList ? 'In der Wiedergabeliste' : 'Zur Wiedergabeliste', 'aria-label': inList ? 'Aus Wiedergabeliste entfernen' : 'Zur Wiedergabeliste hinzufügen', onclick: (e) => { e.stopPropagation(); togglePlaylist(id); } });
        const row = h('div.music-row', { role: 'option', dataset: { id } },
          h('span.music-num', h('span.music-n', String(i + 1)), h('span', { html: IC.eq, style: { display: 'contents' } })),
          h('img', { src: cover(tr), alt: '', draggable: false }),
          h('span.music-tt', h('b', tr.title), h('small', tr.artist)),
          h('span.music-mood', tr.mood), add, h('span.music-dur', fmt(tr.dur)));
        row.addEventListener('click', () => { selId = id; paintRows(); listEl.focus({ preventScroll: true }); });
        row.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) playFrom(id); });
        row.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); selId = id; paintRows(); rowMenu(id, e); });
        rows.set(id, row);
        return row;
      }));
      paintRows();
    }
    function paintRows() {
      for (const [id, row] of rows) {
        row.classList.toggle('is-cur', id === P.cur);
        row.classList.toggle('is-sel', id === selId);
        row.setAttribute('aria-selected', String(id === selId));
      }
    }
    bPlayAll.addEventListener('click', () => {
      const ids = viewIds();
      if (!ids.length) return;
      Player.play(P.shuffle ? ids[(Math.random() * ids.length) | 0] : ids[0], ids, viewName());
    });

    // ---------- Warteschlange ----------
    function paintQueue() {
      queueEl.hidden = !showQueue;
      body.classList.toggle('has-queue', showQueue);
      bQueue.classList.toggle('is-on', showQueue);
      if (!showQueue) return;
      const item = (id, onclick, extra, cls = '') => {
        const tr = TR[id];
        return h(`div.music-q${cls}`, { role: 'button', tabIndex: 0, onclick, onkeydown: (e) => { if (e.key === 'Enter') { e.stopPropagation(); onclick(); } } },
          h('img', { src: cover(tr), alt: '' }), h('span.music-tt', h('b', tr.title), h('small', tr.artist)), extra || h('span'));
      };
      const next = upcoming(8);
      queueEl.replaceChildren(
        h('div.kit-bar', h('b.kit-title', 'Warteschlange'), h('span.sp'),
          P.queue.length ? h('button.kit-chip', { type: 'button', onclick: () => Player.clearQueue() }, 'Leeren') : null,
          h('button.tool', { type: 'button', 'aria-label': 'Warteschlange schließen', html: icon('close'), onclick: () => bQueue.click() })),
        h('div.music-queue-body.scroll',
          h('div.kit-head', 'Läuft gerade'),
          item(P.cur, () => Player.toggle(), h('span', { html: IC.eq, style: { display: 'grid' } }), '.is-now'),
          h('div.kit-head', 'Als Nächstes'),
          ...(P.queue.length
            ? P.queue.map((id, i) => item(id, () => { P.queue.splice(0, i + 1); Player.play(id); }, h('button.tool', { type: 'button', 'aria-label': 'Aus der Warteschlange entfernen', html: icon('close'), onclick: (e) => { e.stopPropagation(); Player.dequeue(i); } })))
            : [h('div.music-queue-none', 'Nichts vorgemerkt. Rechtsklick auf ein Stück → „Als Nächstes abspielen“.')]),
          h('div.kit-head', `Danach · ${P.listName}`),
          ...(next.length ? next.map((id) => item(id, () => Player.play(id))) : [h('div.music-queue-none', P.repeat === 'off' ? 'Die Liste endet hier.' : 'Keine weiteren Stücke.')])));
    }

    // ---------- Anzeige des laufenden Stücks ----------
    function paintNow() {
      const tr = cur();
      const [c1, c2, c3] = tr.colors;
      hero.style.setProperty('--c1', c1);
      hero.style.setProperty('--c2', c2);
      hero.style.setProperty('--c3', c3);
      coverEl.style.backgroundImage = `url("${cover(tr)}")`;
      coverEl.setAttribute('aria-label', `Cover von ${tr.title}`);
      mMood.textContent = tr.mood;
      mTitle.textContent = tr.title;
      mArtist.textContent = tr.artist;
      mInfo.textContent = `${tr.bpm} BPM · ${tr.key} · ${fmt(tr.dur)}`;
      nowImg.src = cover(tr);
      nowT.textContent = tr.title;
      nowA.textContent = tr.artist;
      tDur.textContent = fmt(tr.dur);
      seek.setAttribute('aria-valuemax', Math.round(tr.dur));
      win.setTitle(P.playing ? `${tr.title} – ${tr.artist}` : 'Musik');
    }
    function paintState() {
      bPlay.innerHTML = icon(P.playing ? 'pause' : 'play');
      bPlay.setAttribute('aria-label', P.playing ? 'Pause' : 'Wiedergabe');
      bPlay.title = P.playing ? 'Pause (Leertaste)' : 'Wiedergabe (Leertaste)';
      bShuffle.classList.toggle('is-on', P.shuffle);
      bShuffle.title = P.shuffle ? 'Zufällige Reihenfolge: an' : 'Zufällige Reihenfolge: aus';
      bShuffle.setAttribute('aria-label', bShuffle.title);
      bShuffle.setAttribute('aria-pressed', String(P.shuffle));
      bRepeat.classList.toggle('is-on', P.repeat !== 'off');
      bRepeat.classList.toggle('is-one', P.repeat === 'one');
      bRepeat.title = { off: 'Wiederholen: aus', all: 'Wiederholen: alle', one: 'Wiederholen: dieses Stück' }[P.repeat];
      bRepeat.setAttribute('aria-label', bRepeat.title);
      root.classList.toggle('is-playing', P.playing);
      win.setTitle(P.playing ? `${cur().title} – ${cur().artist}` : 'Musik');
    }
    function paintPos(sec = position()) {
      const tr = cur();
      seek.style.setProperty('--p', (sec / tr.dur).toFixed(4));
      const txt = fmt(sec);
      if (tPos.textContent !== txt) { tPos.textContent = txt; seek.setAttribute('aria-valuenow', Math.round(sec)); seek.setAttribute('aria-valuetext', `${txt} von ${fmt(tr.dur)}`); }
    }

    // Springen im Stück
    const seekAt = (e) => { const r = seek.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width) * cur().dur; };
    seek.addEventListener('pointerdown', (e) => {
      if (e.button && e.pointerType === 'mouse') return;
      seek.setPointerCapture(e.pointerId);
      dragging = true;
      seek.classList.add('is-drag');
      let sec = seekAt(e);
      paintPos(sec);
      const move = (ev) => { sec = seekAt(ev); paintPos(sec); };
      const up = () => {
        seek.removeEventListener('pointermove', move);
        seek.removeEventListener('pointerup', up);
        seek.removeEventListener('pointercancel', up);
        seek.classList.remove('is-drag');
        dragging = false;
        Player.seek(sec);
      };
      seek.addEventListener('pointermove', move);
      seek.addEventListener('pointerup', up);
      seek.addEventListener('pointercancel', up);
    });
    seek.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5 }[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      Player.seek(position() + d);
    });

    // ---------- Visualizer: Spektrum des Master-Ausgangs ----------
    let W = 0, H = 0, dpr = 1;
    let lv = new Float32Array(0);
    let bins = null;
    let pulse = 0;
    let running = false;
    const g2 = vis.getContext('2d');
    const ro = new ResizeObserver(() => {
      dpr = Math.min(2, devicePixelRatio || 1);
      W = hero.clientWidth; H = hero.clientHeight;
      vis.width = Math.max(1, Math.round(W * dpr));
      vis.height = Math.max(1, Math.round(H * dpr));
      const n = clamp(Math.floor(W / 9), 12, 110);
      if (lv.length !== n) lv = new Float32Array(n);
      drawVis();
    });
    ro.observe(hero);
    function drawVis() {
      g2.setTransform(dpr, 0, 0, dpr, 0, 0);
      g2.clearRect(0, 0, W, H);
      const n = lv.length;
      if (!n) return;
      const [, c2, c3] = cur().colors;
      const grad = g2.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, c2); grad.addColorStop(1, c3);
      g2.fillStyle = grad;
      g2.globalAlpha = 0.4;
      const bw = W / n;
      g2.beginPath();
      for (let i = 0; i < n; i++) {
        const hh = Math.max(0, lv[i]) * H * 0.7;
        if (hh < 0.6) continue;
        g2.roundRect(i * bw + 1.5, H - hh, Math.max(2, bw - 3), hh + 4, 2.5);
      }
      g2.fill();
      g2.globalAlpha = 1;
    }
    const frame = (dt) => {
      if (win.min) return;
      if (!dragging) paintPos();
      let peak = 0;
      const n = lv.length;
      if (P.playing) {
        const { analyser } = audio();
        if (!bins || bins.length !== analyser.frequencyBinCount) bins = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(bins);
        const lo = 2, hi = Math.min(bins.length - 1, 300);
        for (let i = 0; i < n; i++) {
          const a = Math.floor(lo * Math.pow(hi / lo, i / n)), b = Math.max(a + 1, Math.floor(lo * Math.pow(hi / lo, (i + 1) / n)));
          let m = 0;
          for (let k = a; k < b; k++) m = Math.max(m, bins[k]);
          const target = Math.pow(m / 255, 1.6);
          lv[i] += (target - lv[i]) * Math.min(1, dt * (target > lv[i] ? 26 : 9));
          peak = Math.max(peak, lv[i]);
        }
        const bass = (bins[2] + bins[3] + bins[4] + bins[5]) / 1020;
        pulse += (bass - pulse) * Math.min(1, dt * 14);
      } else {
        for (let i = 0; i < n; i++) { lv[i] *= Math.max(0, 1 - dt * 7); peak = Math.max(peak, lv[i]); }
        pulse *= Math.max(0, 1 - dt * 7);
      }
      coverEl.style.setProperty('--pulse', (1 + pulse * 0.035).toFixed(4));
      drawVis();
      if (!P.playing && peak < 0.004) { running = false; ticker.remove(frame); coverEl.style.removeProperty('--pulse'); }
    };
    const run = () => { if (!running && P.playing) { running = true; ticker.add(frame); } };

    // ---------- Ereignisse des Players ----------
    const onPlayer = (why) => {
      if (why === 'track') { paintNow(); paintRows(); const row = rows.get(P.cur); if (row && P.playing) row.scrollIntoView({ block: 'nearest' }); }
      if (why === 'volume') { if (Math.abs(volSl.value - P.volume) > 0.005) volSl.value = P.volume; return; }
      paintState();
      paintRows();
      if (!dragging) paintPos();
      paintQueue();
      keepFocus();
      run();
    };
    subs.add(onPlayer);

    // ---------- Tastatur ----------
    const moveSel = (d) => {
      const ids = viewIds();
      if (!ids.length) return;
      const i = ids.indexOf(selId);
      selId = ids[clamp(i < 0 ? (d > 0 ? 0 : ids.length - 1) : i + d, 0, ids.length - 1)];
      paintRows();
      rows.get(selId)?.scrollIntoView({ block: 'nearest' });
    };
    const onKey = (e) => {
      if (e.target.closest('input, textarea, select') || e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key === ' ') { e.preventDefault(); Player.toggle(); return; }
      if (e.target.closest('.gslider, .music-seek')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); if (e.shiftKey) Player.next(); else Player.seek(position() + 10); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); if (e.shiftKey) Player.prev(); else Player.seek(position() - 10); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
      else if (e.key === 'Enter' && selId && !e.target.closest('button, [role="button"]')) { e.preventDefault(); playFrom(selId); }
    };
    const onKeyUp = (e) => { if (e.key === ' ' && e.target.closest('button')) e.preventDefault(); };
    win.el.addEventListener('keydown', onKey);
    win.el.addEventListener('keyup', onKeyUp);

    paintSide();
    paintList();
    paintNow();
    paintState();
    paintPos();
    paintQueue();
    run();

    return {
      onClose() {
        subs.delete(onPlayer);
        ticker.remove(frame);
        ro.disconnect();
        win.el.removeEventListener('keydown', onKey);
        win.el.removeEventListener('keyup', onKeyUp);
        Player.stop();
      },
      onFocus() { if (!win.el.contains(document.activeElement)) listEl.focus({ preventScroll: true }); },
      menus: () => [
        {
          label: 'Wiedergabe',
          items: [
            { label: P.playing ? 'Pause' : 'Wiedergabe', icon: P.playing ? 'pause' : 'play', hint: 'Leertaste', run: () => Player.toggle() },
            { label: 'Nächstes Stück', hint: '⇧→', run: () => Player.next() },
            { label: 'Vorheriges Stück', hint: '⇧←', run: () => Player.prev() },
            '-',
            { label: 'Zufällige Reihenfolge', checked: P.shuffle, run: () => Player.setShuffle(!P.shuffle) },
            { heading: 'Wiederholen' },
            { label: 'Aus', checked: P.repeat === 'off', run: () => Player.setRepeat('off') },
            { label: 'Alle', checked: P.repeat === 'all', run: () => Player.setRepeat('all') },
            { label: 'Dieses Stück', checked: P.repeat === 'one', run: () => Player.setRepeat('one') },
            '-',
            { label: 'Warteschlange', icon: 'list', checked: showQueue, run: () => bQueue.click() },
          ],
        },
        { label: 'Darstellung', items: viewItems() },
      ],
    };
  },

  widgets: {
    /** Läuft gerade: Cover, Titel, Interpret – und ein Knopf, der auch ohne Fenster spielt. */
    now(el) {
      const bg = h('div.music-w-bg');
      const title = h('b'), artist = h('span');
      const btn = h('button.music-w-btn', { type: 'button', onclick: () => Player.toggle() });
      el.append(bg, h('div.music-w-shade'), h('div.music-w-eq', { html: IC.eq }), h('div.music-w-txt', title, artist), btn);
      const paint = (why) => {
        if (why === 'volume' || why === 'queue') return;
        const tr = TR[P.cur];
        bg.style.backgroundImage = `url("${cover(tr)}")`;
        title.textContent = tr.title;
        artist.textContent = tr.artist;
        btn.innerHTML = icon(P.playing ? 'pause' : 'play');
        btn.setAttribute('aria-label', P.playing ? 'Pause' : 'Wiedergabe');
        el.classList.toggle('is-playing', P.playing);
      };
      subs.add(paint);
      paint();
      return () => { subs.delete(paint); el.classList.remove('is-playing'); };
    },
  },
};
