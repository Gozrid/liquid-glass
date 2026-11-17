// focus.js — Fokus: Timer im Wechsel aus Arbeitsphasen und Pausen, mit Klangkulisse, Statistik und Widget

import { h, clamp } from '../../../core/util.js';
import { icon } from '../../../core/icons.js';
import { initControls } from '../../../core/controls.js';
import { audio, tone, audioReady } from '../../../core/audio.js';
import { sys } from '../../sys.js';
import { style, appStore, toolBtn, toast, confirmSheet, pad2 } from '../../kit.js';

const S = appStore('focus');
const EVT = 'fableos:focus';     // window-Ereignis; detail: 'tick' | 'state' | 'cfg' | 'stats' | 'amb'
const LATE = 90000;              // bis zu dieser Verspätung gilt ein Phasenende noch als pünktlich

const PHASES = { focus: 'Fokus', short: 'Kurze Pause', long: 'Lange Pause' };
const LIMITS = { focus: [1, 180], short: [1, 60], long: [1, 120], rounds: [1, 12], goal: [10, 720] };
const DEFAULTS = { focus: 25, short: 5, long: 15, rounds: 4, auto: true, chime: true, goal: 100, sound: 'off', vol: 0.7 };

const svg = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const I = {
  skip: svg('<path d="M6.500 5.800v12.400a.600.600 0 0 0 .900.500l9-6.200a.600.600 0 0 0 0-1l-9-6.200a.600.600 0 0 0-.900.500z" fill="currentColor" stroke="none"/><path d="M18.500 5.500v13"/>'),
  rain: svg('<path d="M7.200 15.500a4.200 4.200 0 0 1-.400-8.400 5.500 5.500 0 0 1 10.500 1.300 3.600 3.600 0 0 1-.300 7.100z"/><path d="M8.500 18.500l-.700 2M12.300 18.500l-.700 2M16.100 18.500l-.700 2"/>'),
  wind: svg('<path d="M3 9.500h10.200a2.600 2.600 0 1 0-2.500-3.300"/><path d="M3 13.500h14.700a2.600 2.600 0 1 1-2.500 3.300"/><path d="M3 17.500h6.500"/>'),
  brook: svg('<path d="M3 7.500c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M3 12.500c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M3 17.500c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>'),
};
const SOUNDS = [
  { id: 'brown', name: 'Rauschen', long: 'Braunes Rauschen', svg: icon('wave') },
  { id: 'rain', name: 'Regen', long: 'Regen', svg: I.rain },
  { id: 'wind', name: 'Wind', long: 'Wind', svg: I.wind },
  { id: 'brook', name: 'Bach', long: 'Bach', svg: I.brook },
];

const num = (n) => n.toLocaleString('de-DE');
const plural = (n, one, many) => (n === 1 ? `1 ${one}` : `${num(n)} ${many}`);
const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`; };
/** Symbol nur tauschen, wenn es sich ändert – sonst ginge ein Klick verloren, der gerade auf dem alten Symbol begonnen hat. */
const setIcon = (btn, name) => { if (btn.dataset.icon !== name) { btn.dataset.icon = name; btn.innerHTML = icon(name); } };
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// ==========================================================================
// Zustand – lebt im Modul: Fenster, Widget und Hintergrund teilen sich einen Timer
// ==========================================================================
function readCfg() {
  const raw = S.get('cfg', null) || {};
  const n = (k, lo, hi) => { const v = Number(raw[k]); return Number.isFinite(v) && v > 0 ? clamp(v, lo, hi) : DEFAULTS[k]; };
  return {
    focus: n('focus', 0.02, 180), short: n('short', 0.02, 60), long: n('long', 0.02, 120),
    rounds: Math.round(n('rounds', 1, 12)), goal: Math.round(n('goal', 10, 720)),
    auto: raw.auto !== false, chime: raw.chime !== false,
    sound: SOUNDS.some((s) => s.id === raw.sound) ? raw.sound : 'off',
    vol: Number.isFinite(Number(raw.vol)) && raw.vol != null ? clamp(Number(raw.vol)) : DEFAULTS.vol,
  };
}
const cfg = readCfg();
const durMs = (phase) => Math.round(cfg[phase] * 60000);

function readTimer() {
  const raw = S.get('timer', null) || {};
  const phase = PHASES[raw.phase] ? raw.phase : 'focus';
  let total = Number(raw.total) > 0 ? Number(raw.total) : durMs(phase);
  const running = raw.running === true && Number(raw.endAt) > 0;
  let remain = running ? 0 : clamp(Number(raw.remain) >= 0 ? Number(raw.remain) : total, 0, total);
  if (!running && remain >= total) total = remain = durMs(phase);     // unberührte Phase: aktuelle Dauer übernehmen
  return {
    phase, round: clamp(Math.round(Number(raw.round)) || 1, 1, 99), total, running, remain,
    endAt: running ? Number(raw.endAt) : 0,
    task: typeof raw.task === 'string' ? raw.task.slice(0, 80) : '',
  };
}
const T = readTimer();

function readDays() {
  const raw = S.get('days', null);
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && v) out[k] = { s: Math.max(0, Number(v.s) || 0), n: Math.max(0, Math.round(Number(v.n)) || 0) };
    }
  }
  return out;
}
let days = readDays();

const left = () => (T.running ? Math.max(0, T.endAt - Date.now()) : T.remain);
const fresh = () => !T.running && T.remain >= T.total;
const emit = (kind) => window.dispatchEvent(new CustomEvent(EVT, { detail: kind }));
const saveT = () => S.set('timer', T);
const saveCfg = () => S.set('cfg', cfg);

// ---------- Statistik ----------
const dayOf = (key) => days[key] || { s: 0, n: 0 };
const mins = (sec) => Math.round(sec / 60);
const active = (key) => { const d = dayOf(key); return d.n > 0 || d.s >= 60; };

function credit(ms, session, at) {
  const key = dayKey(new Date(at));
  const d = dayOf(key);
  days[key] = { s: d.s + Math.round(ms / 1000), n: d.n + (session ? 1 : 0) };
  const keys = Object.keys(days).sort();          // gut ein Jahr genügt
  for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete days[k];
  S.set('days', days);
  emit('stats');
}
/** Angefangene Fokus-Zeit gutschreiben, wenn eine Phase vorzeitig verlassen wird. */
function creditPartial() {
  if (T.phase !== 'focus') return;
  const done = T.total - left();
  if (done >= 1000) credit(done, false, Date.now());
}
function streak() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  if (!active(dayKey(d))) d.setDate(d.getDate() - 1);     // heute darf noch offen sein
  let n = 0;
  while (active(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function week() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - 6);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const v = dayOf(dayKey(d));
    out.push({ date: new Date(d), min: mins(v.s), n: v.n });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// ==========================================================================
// Timer
// ==========================================================================
let iv = 0;
let lastSec = -1;
let booted = false;

function arm() { lastSec = -1; if (!iv) iv = setInterval(tick, 250); }
function disarm() { clearInterval(iv); iv = 0; }
function tick() {
  if (!T.running) { disarm(); return; }
  const ms = T.endAt - Date.now();
  if (ms <= 0) { complete(ms < -LATE); return; }
  const sec = Math.ceil(ms / 1000);
  if (sec !== lastSec) { lastSec = sec; emit('tick'); }
}

function setPhase(phase, round, run = false) {
  T.phase = phase;
  T.round = round;
  T.total = durMs(phase);
  T.running = run;
  T.endAt = run ? Date.now() + T.total : 0;
  T.remain = run ? 0 : T.total;
}
function commit(stopSound) {
  saveT();
  if (T.running) arm(); else disarm();
  ambFollow(stopSound);
  emit('state');
}
function nextPhase() {
  if (T.phase === 'focus') return { phase: T.round >= cfg.rounds ? 'long' : 'short', round: T.round };
  if (T.phase === 'short') return { phase: 'focus', round: T.round + 1 };
  return { phase: 'focus', round: 1 };
}

function start() {
  if (T.running) return;
  if (T.remain <= 0) T.remain = T.total;
  T.running = true;
  T.endAt = Date.now() + T.remain;
  T.remain = 0;
  commit(false);
}
function pause() {
  if (!T.running) return;
  T.remain = left();
  T.running = false;
  T.endAt = 0;
  commit(true);
}
const toggle = () => (T.running ? pause() : start());
function reset() { setPhase(T.phase, T.round); commit(true); }
function skip() {
  const was = T.running;
  creditPartial();
  const n = nextPhase();
  setPhase(n.phase, n.round, was);
  commit(true);
}
function jump(phase) {
  if (phase === T.phase && fresh()) return;
  creditPartial();
  setPhase(phase, T.round);
  commit(true);
}
function restart() {
  creditPartial();
  setPhase('focus', 1);
  commit(true);
}

/** Phase ist abgelaufen. late: lange nach dem Ende bemerkt (Seite war zu, Rechner schlief). */
function complete(late) {
  const done = T.phase;
  if (done === 'focus') credit(T.total, true, T.endAt);
  const n = nextPhase();
  setPhase(n.phase, n.round, cfg.auto && !late);
  commit(true);
  announce(done, late);
}

function announce(done, late) {
  const mm = (phase) => `${num(Math.max(1, Math.round(cfg[phase])))} Min.`;
  const task = T.task.trim();
  let title;
  let body;
  if (done === 'focus') {
    title = late ? 'Fokus-Phase beendet' : 'Fokus-Phase geschafft';
    body = `${task ? `„${task}“ · ` : ''}${T.phase === 'long' ? `Zeit für eine lange Pause (${mm('long')}).` : `Jetzt ${mm('short')} Pause.`}`;
  } else {
    title = late ? `${PHASES[done]} beendet` : 'Pause vorbei';
    body = `Weiter mit Runde ${Math.min(T.round, cfg.rounds)} von ${cfg.rounds}${task ? `: „${task}“` : '.'}`;
  }
  if (late) body = `Abgelaufen, während du weg warst. ${body}`;
  const note = () => sys.notify({ title, body, app: 'focus', onClick: () => sys.open('focus') });
  if (late) setTimeout(note, 1200); else { note(); chime(done === 'focus'); }
}

/** Eigener kleiner Klang zum Phasenende: aufsteigend nach dem Fokus, zwei Töne nach der Pause. */
function chime(afterFocus) {
  if (!cfg.chime || !audioReady()) return;
  const notes = afterFocus ? [523.25, 659.25, 783.99, 1046.5] : [783.99, 587.33];
  notes.forEach((f, i) => {
    const when = 0.38 + i * 0.17;
    tone({ f, dur: 0.95, vol: 0.13, attack: 0.012, when });
    tone({ type: 'triangle', f: f * 2, dur: 0.5, vol: 0.028, attack: 0.012, when });
  });
}

function boot() {
  if (booted) return;
  booted = true;
  if (T.running) {
    if (T.endAt <= Date.now()) complete(true);      // lief ab, während die Seite zu war: einmal abschließen, ohne Ton
    else { arm(); ambFollow(false); }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}

function setCfg(key, value) {
  if (cfg[key] !== value) {
    cfg[key] = value;
    saveCfg();
    if (fresh()) { T.total = T.remain = durMs(T.phase); saveT(); }
  }
  emit('cfg');
}

// ==========================================================================
// Klangkulisse – live erzeugt, hängt am Master-Ausgang
// ==========================================================================
const buffers = {};
function noiseBuffer(kind) {
  if (buffers[kind]) return buffers[kind];
  const { ctx } = audio();
  const len = Math.round(ctx.sampleRate * (kind === 'white' ? 3 : 6));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const white = () => Math.random() * 2 - 1;
    if (kind === 'white') {
      for (let i = 0; i < len; i++) d[i] = white();
    } else if (kind === 'brown') {
      let v = 0;
      for (let i = 0; i < len; i++) { v = (v + 0.02 * white()) / 1.02; d[i] = v * 3.5; }
    } else if (kind === 'pink') {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = white();
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else {
      // „drops“: vereinzelte, schnell abklingende Knackser – das Prasseln
      let env = 0;
      for (let i = 0; i < len; i++) {
        if (Math.random() < 0.0011) env = 0.25 + Math.random() * 0.75;
        d[i] = white() * env;
        env *= 0.991;
      }
    }
    if (kind === 'brown' || kind === 'pink') {       // Nahtstelle der Schleife glätten
      const jump = d[len - 1] - d[0];
      for (let i = 0; i < len; i++) d[i] -= jump * (i / (len - 1));
    }
  }
  return (buffers[kind] = buf);
}

function buildSound(kind) {
  const { ctx } = audio();
  const nodes = [];
  const srcs = [];
  const add = (n) => { nodes.push(n); return n; };
  const gain = (v) => { const n = add(ctx.createGain()); n.gain.value = v; return n; };
  const filt = (type, f, q = 0.7) => { const n = add(ctx.createBiquadFilter()); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
  const src = (buf, rate = 1) => { const n = add(ctx.createBufferSource()); n.buffer = noiseBuffer(buf); n.loop = true; n.playbackRate.value = rate; srcs.push(n); return n; };
  const lfo = (f, depth, param) => { const o = add(ctx.createOscillator()); o.frequency.value = f; const g = gain(depth); o.connect(g); g.connect(param); srcs.push(o); };
  const chain = (...ns) => { for (let i = 0; i < ns.length - 1; i++) ns[i].connect(ns[i + 1]); };
  const out = gain(0);

  if (kind === 'brown') {
    const g = gain(1.9);
    chain(src('brown'), filt('lowpass', 540, 0.4), g, out);
    lfo(0.06, 0.12, g.gain);
  } else if (kind === 'rain') {
    chain(src('pink'), filt('highpass', 650, 0.5), filt('lowpass', 7200, 0.5), gain(1.5), out);
    chain(src('drops'), filt('bandpass', 2700, 0.7), gain(2.4), out);
    chain(src('brown', 0.8), filt('lowpass', 210, 0.5), gain(0.5), out);
  } else if (kind === 'wind') {
    const bp = filt('bandpass', 430, 1.1);
    const g = gain(1.7);
    chain(src('white'), bp, g, out);
    lfo(0.07, 190, bp.frequency);
    lfo(0.17, 90, bp.frequency);
    lfo(0.11, 0.56, g.gain);
    const whistle = filt('bandpass', 1150, 4);
    const g2 = gain(0.4);
    chain(src('white', 0.9), whistle, g2, out);
    lfo(0.05, 420, whistle.frequency);
    lfo(0.09, 0.28, g2.gain);
    chain(src('brown'), filt('lowpass', 300, 0.5), gain(0.56), out);
  } else {
    // Bach: leises Grundrauschen plus fünf schmale, wandernde Bänder, die gluckern
    chain(src('pink'), filt('highpass', 500, 0.5), filt('lowpass', 4200, 0.5), gain(0.72), out);
    [[620, 2.7, 0.8], [980, 3.9, 1.3], [1450, 5.3, 1.9], [2100, 7.1, 2.6], [2900, 8.9, 3.4]].forEach(([f, am, fm], i) => {
      const bp = filt('bandpass', f, 11);
      const g = gain(2.1);
      chain(src('white', 1 + i * 0.07), bp, g, out);
      lfo(fm, f * 0.22, bp.frequency);
      lfo(am, 1.75, g.gain);
    });
  }
  return { kind, out, nodes, srcs };
}

let amb = null;          // klingende Kulisse: {kind, out, nodes, srcs}
let ambWant = false;     // soll klingen, sobald der Browser Audio erlaubt (nach der ersten Geste)
let unlockArmed = false;
const level = () => cfg.vol * cfg.vol;
const ambActive = () => !!amb || ambWant;

function ambStart(kind) {
  if (amb?.kind === kind) return;
  ambStop();
  const { ctx, out } = audio();
  const g = buildSound(kind);
  g.out.connect(out);
  for (const s of g.srcs) s.start();
  g.out.gain.setValueAtTime(0, ctx.currentTime);
  g.out.gain.linearRampToValueAtTime(level(), ctx.currentTime + 1.2);
  amb = g;
}
function ambStop() {
  const g = amb;
  if (!g) return;
  amb = null;
  const { ctx } = audio();
  const t = ctx.currentTime;
  g.out.gain.cancelScheduledValues(t);
  g.out.gain.setValueAtTime(g.out.gain.value, t);
  g.out.gain.linearRampToValueAtTime(0, t + 0.9);
  setTimeout(() => {
    for (const s of g.srcs) { try { s.stop(); } catch { /* lief nie */ } }
    for (const n of g.nodes) { try { n.disconnect(); } catch { /* egal */ } }
  }, 1000);
}
function ambSet(on) {
  on = !!on && cfg.sound !== 'off';
  ambWant = on && !audioReady();
  if (!on) ambStop();
  else if (!ambWant) ambStart(cfg.sound);
  else if (!unlockArmed) {
    unlockArmed = true;
    const go = () => {
      unlockArmed = false;
      removeEventListener('pointerdown', go, true);
      removeEventListener('keydown', go, true);
      setTimeout(() => { if (ambWant) ambSet(true); }, 0);
    };
    addEventListener('pointerdown', go, true);
    addEventListener('keydown', go, true);
  }
  if (amb) {
    const s = SOUNDS.find((x) => x.id === amb.kind);
    sys.media({ app: 'focus', title: s.long, artist: 'Klangkulisse', playing: true, toggle: () => ambSet(!amb) });
  } else if (sys.nowPlaying?.app === 'focus') sys.media(null);
  emit('amb');
}
/** Die Kulisse begleitet laufende Fokus-Phasen und endet mit dem Timer. */
function ambFollow(stopFirst) {
  if (T.running && T.phase === 'focus' && cfg.sound !== 'off') ambSet(true);
  else if (stopFirst && ambActive()) ambSet(false);
}
function pickSound(id) {
  const stop = id === 'off' || (id === cfg.sound && ambActive());
  cfg.sound = stop ? 'off' : id;
  saveCfg();
  ambSet(!stop);
  emit('cfg');
}
function setVol(v) {
  cfg.vol = clamp(v);
  saveCfg();
  if (!amb) return;
  const { ctx } = audio();
  amb.out.gain.cancelScheduledValues(ctx.currentTime);
  amb.out.gain.setTargetAtTime(level(), ctx.currentTime, 0.04);
}

// ==========================================================================
// Stile
// ==========================================================================
style('focus', `
.focus, .focus-w { --ph: var(--accent); }
.focus[data-phase="short"], .focus-w[data-phase="short"] { --ph: var(--c-mint); }
.focus[data-phase="long"], .focus-w[data-phase="long"] { --ph: var(--c-cyan); }
.focus-bar { justify-content: center; }
.focus-bar .gseg button { padding: .42em 1em; font-size: 12.5px; }
.focus-view { flex: 1; min-height: 0; }

/* Timer */
.focus-timer { display: grid; grid-template-columns: minmax(0, 1fr) 272px; grid-template-rows: minmax(0, 1fr); }
.focus-stage { container-type: size; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; min-width: 0; min-height: 0; padding: 14px 16px; }
.focus-phases { display: flex; justify-content: center; gap: 6px; flex: none; max-width: 100%; }
.focus-phases .kit-chip { padding: 4px 11px; transition: background-color .25s, box-shadow .25s, color .25s; }
.focus-phases .kit-chip.is-on { background: color-mix(in srgb, var(--ph) 20%, transparent); box-shadow: inset 0 0 0 1.5px var(--ph); color: var(--fg); }
.focus-ring { --d: clamp(112px, min(100cqw - 12px, 100cqh - 164px), 290px); position: relative; flex: none; width: var(--d); height: var(--d); }
.focus-ring svg { width: 100%; height: 100%; overflow: visible; transform: rotate(-90deg) scaleY(-1); }
.focus-track { fill: none; stroke: var(--well); stroke-width: 9; }
.focus-arc { fill: none; stroke: var(--ph); stroke-width: 9; stroke-linecap: round; filter: drop-shadow(0 0 6px color-mix(in srgb, var(--ph) 50%, transparent)); transition: stroke-dashoffset .5s var(--ease-out), stroke .4s; }
.focus.is-run .focus-arc { transition: stroke-dashoffset 1s linear, stroke .4s; }
.focus-ring-in { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: calc(var(--d) * .028); text-align: center; }
.focus-state { font-size: clamp(10px, calc(var(--d) * .05), 12.5px); font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--fg-3); }
.focus-time { font: 650 calc(var(--d) * .225) / 1 var(--font-round); letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.focus-time.is-long { font-size: calc(var(--d) * .185); }
.focus-round { font-size: clamp(10.5px, calc(var(--d) * .052), 12.5px); font-weight: 600; color: var(--fg-3); }
.focus-dots { display: flex; gap: 5px; height: 7px; }
.focus-dots i { width: 7px; height: 7px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--fg-4); transition: background-color .3s, box-shadow .3s, scale .4s var(--spring); }
.focus-dots i.is-done { background: var(--accent); box-shadow: none; }
.focus-dots i.is-now { box-shadow: inset 0 0 0 1.5px var(--accent); scale: 1.3; }
.focus-task { flex: none; width: min(100%, 310px); text-align: center; }
.focus-ctl { display: flex; align-items: center; gap: 16px; flex: none; }
.focus-go { width: 58px; height: 58px; padding: 0; border-radius: 50%; box-shadow: inset 0 1px 0 rgba(255, 255, 255, .35), 0 12px 26px -10px color-mix(in srgb, var(--accent) 80%, transparent); }
.focus-go .ico { width: 24px; height: 24px; }
.focus-sub { width: 40px; height: 40px; padding: 0; border-radius: 50%; color: var(--fg-2); }
.focus-sub .ico { width: 18px; height: 18px; }

/* Seitenspalte: Klangkulisse, Heute */
.focus-side { display: flex; flex-direction: column; gap: 10px; min-height: 0; padding: 14px 14px 14px 0; }
.focus-card { display: grid; gap: 10px; flex: none; }
.focus-card-head { display: flex; align-items: center; gap: 8px; min-height: 14px; }
.focus-eq { display: flex; align-items: flex-end; gap: 2px; height: 12px; margin-left: auto; opacity: 0; transition: opacity .3s; }
.focus-eq i { width: 3px; height: 100%; border-radius: 2px; background: var(--accent); transform-origin: 50% 100%; animation: focus-eq 1s ease-in-out infinite alternate paused; }
.focus-eq i:nth-child(2) { animation-duration: .7s; animation-delay: -.3s; }
.focus-eq i:nth-child(3) { animation-duration: 1.25s; animation-delay: -.6s; }
.focus-amb.is-on .focus-eq { opacity: 1; }
.focus-amb.is-on .focus-eq i { animation-play-state: running; }
@keyframes focus-eq { from { transform: scaleY(.25); } to { transform: scaleY(1); } }
.focus-sounds { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.focus-sound { display: flex; align-items: center; gap: 7px; min-width: 0; padding: 8px 9px; border: 0; border-radius: 11px; background: var(--well); box-shadow: inset 0 0 0 1px var(--line); font-size: 12.5px; font-weight: 600; color: var(--fg-2); text-align: left; transition: transform .4s var(--spring), background-color .2s, box-shadow .2s, color .2s; }
.focus-sound:hover { background: var(--raise); color: var(--fg); }
.focus-sound:active { transform: scale(.95); }
.focus-sound .ico { width: 17px; height: 17px; }
.focus-sound[aria-pressed="true"] { background: color-mix(in srgb, var(--accent) 18%, transparent); box-shadow: inset 0 0 0 1.5px var(--accent); color: var(--fg); }
.focus-sound[aria-pressed="true"] .ico { color: var(--accent); }
.focus-vol { display: flex; align-items: center; gap: 8px; color: var(--fg-3); }
.focus-vol .gslider { flex: 1; min-width: 0; }
.focus-hint { min-height: 2.7em; font-size: 12px; line-height: 1.35; color: var(--fg-3); text-wrap: pretty; }
.focus-num { display: flex; align-items: baseline; gap: 6px; }
.focus-num b { font: 650 28px / 1 var(--font-round); letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.focus-num span { font-size: 12.5px; color: var(--fg-3); }
.focus-num em { margin-left: auto; font-style: normal; font-size: 12.5px; font-weight: 600; color: var(--fg-2); }
.focus-meta { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--fg-3); white-space: nowrap; }

/* Statistik */
.focus-stats, .focus-prefs { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px 18px; }
.focus-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; flex: none; }
.focus-tile { display: grid; gap: 3px; min-width: 0; padding: 10px 12px; border-radius: 14px; background: var(--raise); }
.focus-tile span { font-size: 11.5px; font-weight: 600; color: var(--fg-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.focus-tile b { font: 650 1.5rem / 1.15 var(--font-round); letter-spacing: -.02em; font-variant-numeric: tabular-nums; white-space: nowrap; }
.focus-tile b small { margin-left: 4px; font: 500 11.5px var(--font); letter-spacing: 0; color: var(--fg-3); }
.focus-goal { display: grid; gap: 8px; flex: none; }
.focus-goal-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 12.5px; color: var(--fg-2); }
.focus-goal .kit-progress { height: 8px; }
.focus-h { flex: none; margin-top: 2px; font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--fg-3); }
.focus-chart { position: relative; flex: 1 0 170px; max-height: 280px; outline: 0; cursor: crosshair; }
.focus-chart:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: 8px; }
.focus-chart svg { position: absolute; inset: 0; width: 100%; height: 100%; max-width: none; overflow: visible; }
.focus-grid { stroke: var(--line); stroke-width: 1; shape-rendering: crispEdges; }
.focus-axis { fill: var(--fg-3); font: 500 11px var(--font); font-variant-numeric: tabular-nums; }
.focus-axis.is-today { fill: var(--fg); font-weight: 700; }
.focus-band { fill: var(--raise); }
.focus-col { fill: var(--accent); opacity: .45; }
.focus-col.is-today, .focus-col.is-hover { opacity: 1; }
.focus-stub { fill: var(--fg-4); }
.focus-goal-line { stroke: var(--fg-3); stroke-width: 1; stroke-dasharray: 3 4; }
.focus-void { fill: var(--fg-3); font: 500 12.5px var(--font); }
.focus-tip { position: absolute; left: 0; top: 0; z-index: 3; padding: 5px 9px; border-radius: 10px; background: var(--solid); box-shadow: 0 8px 22px rgba(0, 0, 14, .35), inset 0 0 0 1px var(--line); font-size: 11.5px; white-space: nowrap; pointer-events: none; transform: translate(-50%, calc(-100% - 10px)); }
.focus-tip b { display: block; font-size: 13.5px; font-variant-numeric: tabular-nums; }
.focus-tip span { color: var(--fg-3); }

/* Einstellungen */
.focus-group { display: grid; gap: 1px; flex: none; border-radius: 14px; overflow: hidden; }
.focus-row { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 8px 12px 8px 14px; background: var(--raise); }
.focus-row > div:first-child { display: grid; flex: 1; min-width: 0; }
.focus-row b { font-size: 13px; font-weight: 600; }
.focus-row small { font-size: 12px; color: var(--fg-3); text-wrap: pretty; }
.focus-step { display: flex; align-items: center; gap: 4px; flex: none; }
.focus-step .kit-field { width: 46px; padding: 5px 2px; text-align: center; font-variant-numeric: tabular-nums; }
.focus-step span { width: 30px; padding-left: 3px; font-size: 12px; color: var(--fg-3); }
.focus-step .tool { background: var(--raise); box-shadow: inset 0 0 0 .5px var(--line); }
.focus-prefs-foot { display: flex; justify-content: flex-end; flex: none; }

@container win (max-width: 620px) {
  .focus-timer { display: block; }
  .focus-stage { height: min(100%, 470px); min-height: 302px; }
  .focus-side { padding: 0 14px 14px; overflow: visible; }
  .focus-tiles { grid-template-columns: 1fr 1fr; }
}

/* Widget */
.focus-w { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.focus-w-ring { position: relative; flex: none; width: 108px; height: 108px; }
.focus-w-ring svg { width: 100%; height: 100%; overflow: visible; transform: rotate(-90deg) scaleY(-1); }
.focus-w-track { fill: none; stroke: var(--well); stroke-width: 7; }
.focus-w-arc { fill: none; stroke: var(--ph); stroke-width: 7; stroke-linecap: round; transition: stroke-dashoffset .5s var(--ease-out), stroke .4s; }
.focus-w.is-run .focus-w-arc { transition: stroke-dashoffset 1s linear, stroke .4s; }
.focus-w-in { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 4px; }
.focus-w-time { font: 650 25px / 1 var(--font-round); letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.focus-w-time.is-long { font-size: 21px; }
.focus-w-phase { font-size: 9.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--fg-3); }
.focus-w-foot { display: flex; align-items: center; justify-content: space-between; gap: 6px; align-self: stretch; height: 28px; }
.focus-w-info { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; font-weight: 600; color: var(--fg-3); }
.focus-w-btn { display: grid; place-items: center; flex: none; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 50%; background: var(--accent); color: #fff; box-shadow: inset 0 1px 0 rgba(255, 255, 255, .35); transition: transform .4s var(--spring), filter .15s; }
.focus-w-btn:hover { filter: brightness(1.1); }
.focus-w-btn:active { transform: scale(.86); }
.focus-w-btn .ico { width: 14px; height: 14px; }
`);

// ==========================================================================
// App
// ==========================================================================
const LABELS = { focus: 'Fokus', short: 'Kurze Pause', long: 'Lange Pause', rounds: 'Runden bis zur langen Pause', goal: 'Tagesziel' };

export default {
  singleton: true,
  width: 760, height: 548, minW: 360, minH: 420,

  mount(win) {
    boot();
    let tab = 'timer';
    let hover = -1;
    let geo = null;
    let sig = '';
    let stale = false;

    // ---------- Timer ----------
    const chips = Object.entries(PHASES).map(([id, name]) => h('button.kit-chip', { type: 'button', dataset: { phase: id }, onclick: () => jump(id) }, name));
    const R = 88;
    const C = 2 * Math.PI * R;
    const ring = h('div.focus-ring', { html: `<svg viewBox="0 0 200 200" aria-hidden="true"><circle class="focus-track" cx="100" cy="100" r="${R}"/><circle class="focus-arc" cx="100" cy="100" r="${R}" stroke-dasharray="${C.toFixed(2)}"/></svg>` });
    const arc = ring.querySelector('.focus-arc');
    const elState = h('span.focus-state');
    const elTime = h('b.focus-time', { role: 'timer' });
    const elRound = h('span.focus-round');
    const elDots = h('div.focus-dots', { 'aria-hidden': 'true' });
    ring.append(h('div.focus-ring-in', elState, elTime, elRound, elDots));

    const task = h('input.kit-field.focus-task', { type: 'text', value: T.task, maxLength: 80, placeholder: 'Woran arbeitest du?', spellcheck: false, autocomplete: 'off', 'aria-label': 'Aktuelle Aufgabe' });
    task.addEventListener('input', () => { T.task = task.value.slice(0, 80); saveT(); });
    task.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      e.preventDefault();
      win.el.focus({ preventScroll: true });
      if (e.key === 'Enter' && T.phase === 'focus' && !T.running) start();
    });

    const bReset = h('button.kit-btn.focus-sub', { type: 'button', 'aria-label': 'Phase zurücksetzen', title: 'Zurücksetzen (R)', html: icon('reload'), onclick: reset });
    const bGo = h('button.kit-btn.primary.focus-go', { type: 'button', onclick: toggle });
    const bSkip = h('button.kit-btn.focus-sub', { type: 'button', 'aria-label': 'Phase überspringen', title: 'Überspringen (N)', html: I.skip, onclick: skip });

    // ---------- Klangkulisse, Heute ----------
    const tiles = SOUNDS.map((s) => h('button.focus-sound', { type: 'button', 'aria-pressed': 'false', dataset: { sound: s.id }, title: s.long, html: s.svg, onclick: () => pickSound(s.id) }, h('span', s.name)));
    const vol = h('div.gslider', { dataset: { min: 0, max: 1, step: 0.01, value: cfg.vol }, 'aria-label': 'Lautstärke der Klangkulisse' });
    const hint = h('p.focus-hint');
    const ambCard = h('section.kit-card.focus-card.focus-amb',
      h('div.focus-card-head', h('span.kit-label', 'Klangkulisse'), h('span.focus-eq', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))),
      h('div.focus-sounds', tiles),
      h('div.focus-vol', { html: icon('volume') }, vol),
      hint);
    vol.addEventListener('input', (e) => setVol(e.detail.value));

    const tMin = h('b');
    const tSes = h('em');
    const tBar = h('div.kit-progress', h('i'));
    const tGoal = h('span');
    const tStreak = h('span');
    const todayCard = h('section.kit-card.focus-card',
      h('div.focus-card-head', h('span.kit-label', 'Heute')),
      h('div.focus-num', tMin, h('span', 'Min. im Fokus'), tSes),
      tBar,
      h('div.focus-meta', tGoal, tStreak));

    const vTimer = h('div.focus-view.focus-timer.scroll',
      h('div.focus-stage', h('div.focus-phases', chips), ring, task, h('div.focus-ctl', bReset, bGo, bSkip)),
      h('aside.focus-side.scroll', ambCard, todayCard));

    // ---------- Statistik ----------
    const tile = (label) => { const b = h('b'); return { b, el: h('div.focus-tile', h('span', label), b) }; };
    const sMin = tile('Heute im Fokus');
    const sSes = tile('Sitzungen heute');
    const sStreak = tile('Serie');
    const sWeek = tile('Letzte 7 Tage');
    const gTxt = h('span');
    const gBar = h('div.kit-progress', h('i'));
    const chartSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const tip = h('div.focus-tip', { hidden: true }, h('b'), h('span'));
    const chart = h('div.focus-chart', { tabIndex: 0, 'aria-label': 'Balkendiagramm: Fokus-Minuten der letzten 7 Tage. Mit den Pfeiltasten Tage auswählen.' }, chartSvg, tip);
    const vStats = h('div.focus-view.focus-stats.scroll', { hidden: true },
      h('div.focus-tiles', sMin.el, sSes.el, sStreak.el, sWeek.el),
      h('section.kit-card.focus-goal', h('div.focus-goal-top', h('span.kit-label', 'Tagesziel'), gTxt), gBar),
      h('h3.focus-h', 'Fokus-Minuten · letzte 7 Tage'),
      chart);

    // ---------- Einstellungen ----------
    const syncs = [];
    const row = (title, sub, control) => h('div.focus-row', h('div', h('b', title), sub ? h('small', sub) : null), control);
    const stepper = (key, unit, step = 1) => {
      const [lo, hi] = LIMITS[key];
      const cur = () => Math.round(cfg[key]);
      const apply = (v) => setCfg(key, clamp(Math.round(v), lo, hi));
      const input = h('input.kit-field', { type: 'text', inputMode: 'numeric', autocomplete: 'off', 'aria-label': `${LABELS[key]}${unit ? ' in Minuten' : ''}` });
      const minus = toolBtn('minus', `${LABELS[key]} verringern`, () => apply(cur() - step));
      const plus = toolBtn('plus', `${LABELS[key]} erhöhen`, () => apply(cur() + step));
      input.addEventListener('change', () => { const v = parseInt(input.value, 10); if (Number.isFinite(v)) apply(v); else input.value = String(cur()); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); apply(cur() + (e.key === 'ArrowUp' ? step : -step)); }
      });
      syncs.push(() => {
        if (document.activeElement !== input || input.value !== String(cur())) input.value = String(cur());
        minus.disabled = cur() <= lo;
        plus.disabled = cur() >= hi;
      });
      return h('div.focus-step', minus, input, plus, h('span', unit));
    };
    const toggleSw = (key, label) => {
      const b = h('button.gswitch', { 'aria-checked': String(!!cfg[key]), 'aria-label': label });
      b.addEventListener('change', (e) => setCfg(key, e.detail.checked));
      syncs.push(() => { b.checked = !!cfg[key]; });
      return b;
    };
    const bWipe = h('button.kit-btn', { type: 'button' }, 'Statistik zurücksetzen …');
    bWipe.addEventListener('click', async () => {
      const yes = await confirmSheet(win, { title: 'Statistik zurücksetzen?', text: 'Alle erfassten Fokus-Minuten, Sitzungen und die Serie werden gelöscht.', ok: 'Zurücksetzen', danger: true });
      if (!yes) return;
      days = {};
      S.set('days', days);
      emit('stats');
      toast(win, 'Statistik zurückgesetzt');
    });
    const vPrefs = h('div.focus-view.focus-prefs.scroll', { hidden: true },
      h('h3.focus-h', 'Zeiten'),
      h('div.focus-group',
        row('Fokus', '', stepper('focus', 'Min.')),
        row('Kurze Pause', '', stepper('short', 'Min.')),
        row('Lange Pause', '', stepper('long', 'Min.')),
        row('Runden bis zur langen Pause', '', stepper('rounds', ''))),
      h('h3.focus-h', 'Ablauf'),
      h('div.focus-group',
        row('Phasen automatisch wechseln', 'Die nächste Phase startet von selbst.', toggleSw('auto', 'Phasen automatisch wechseln')),
        row('Ton am Phasenende', 'Ein kurzer Klang zusätzlich zur Mitteilung.', toggleSw('chime', 'Ton am Phasenende'))),
      h('h3.focus-h', 'Ziel'),
      h('div.focus-group', row('Tagesziel', 'Fokus-Minuten pro Tag.', stepper('goal', 'Min.', 10))),
      h('div.focus-prefs-foot', bWipe));

    // ---------- Gerüst ----------
    const tabs = h('div.gseg.focus-tabs', { 'aria-label': 'Bereich' },
      h('button', { dataset: { value: 'timer' }, 'aria-selected': 'true' }, 'Timer'),
      h('button', { dataset: { value: 'stats' } }, 'Statistik'),
      h('button', { dataset: { value: 'prefs' } }, 'Einstellungen'));
    const root = h('div.kit-app.focus', h('div.kit-bar.focus-bar', tabs), vTimer, vStats, vPrefs);
    win.body.append(root);
    initControls(root);

    // ---------- Zeichnen ----------
    const paintTime = () => {
      const ms = left();
      const txt = fmt(ms);
      elTime.textContent = txt;
      elTime.classList.toggle('is-long', txt.length > 5);
      const f = T.total > 0 ? clamp((ms - (T.running ? 1000 : 0)) / T.total) : 0;     // läuft dem linearen Übergang eine Sekunde voraus
      arc.style.strokeDashoffset = (C * (1 - f)).toFixed(2);
    };
    const paintTimer = () => {
      root.dataset.phase = T.phase;
      root.classList.toggle('is-run', T.running);
      for (const c of chips) {
        const on = c.dataset.phase === T.phase;
        c.classList.toggle('is-on', on);
        c.setAttribute('aria-pressed', String(on));
      }
      elState.textContent = T.running ? 'Läuft' : fresh() ? 'Bereit' : 'Pausiert';
      elRound.textContent = `Runde ${Math.min(T.round, cfg.rounds)} von ${cfg.rounds}`;
      const doneN = T.phase === 'focus' ? T.round - 1 : T.round;
      elDots.hidden = cfg.rounds > 8;
      elDots.replaceChildren(...Array.from({ length: cfg.rounds }, (_, i) => h('i', { class: i < doneN ? 'is-done' : i === doneN && T.phase === 'focus' ? 'is-now' : '' })));
      const lbl = T.running ? 'Pausieren' : fresh() ? 'Starten' : 'Fortsetzen';
      setIcon(bGo, T.running ? 'pause' : 'play');
      bGo.setAttribute('aria-label', lbl);
      bGo.title = `${lbl} (Leertaste)`;
      bReset.disabled = fresh();
      if (document.activeElement !== task) task.value = T.task;
      paintTime();
    };
    const paintAmb = () => {
      const on = ambActive();
      const s = SOUNDS.find((x) => x.id === cfg.sound);
      ambCard.classList.toggle('is-on', on);
      for (const t of tiles) t.setAttribute('aria-pressed', String(t.dataset.sound === cfg.sound));
      hint.textContent = !s ? 'Wähle eine Kulisse – sie begleitet deine Fokus-Phasen.'
        : on ? `${s.long} läuft und endet mit dem Timer. Noch ein Klick schaltet ab.`
          : `${s.long} startet mit der nächsten Fokus-Phase.`;
      if (!vol.classList.contains('is-drag')) vol.value = cfg.vol;
    };
    const paintToday = () => {
      const d = dayOf(dayKey());
      const m = mins(d.s);
      const st = streak();
      tMin.textContent = num(m);
      tSes.textContent = plural(d.n, 'Sitzung', 'Sitzungen');
      tBar.style.setProperty('--p', clamp(m / cfg.goal));
      tGoal.textContent = m >= cfg.goal ? 'Tagesziel erreicht' : `Ziel: ${num(cfg.goal)} Min.`;
      tStreak.textContent = `Serie: ${plural(st, 'Tag', 'Tage')}`;
    };

    const renderChart = () => {
      const W = chart.clientWidth;
      const H = chart.clientHeight;
      if (!W || !H) return;
      const data = week();
      const L = 36, Rm = 10, Tp = 14, B = 24;
      const iw = W - L - Rm;
      const ih = H - Tp - B;
      const top = Math.max(cfg.goal, 20, ...data.map((d) => d.min));
      const step = top <= 40 ? 10 : top <= 80 ? 20 : top <= 160 ? 40 : top <= 320 ? 80 : top <= 640 ? 160 : 320;
      const max = Math.ceil(top / step) * step;
      const slot = iw / 7;
      const bw = Math.min(40, slot * 0.56);
      const X = (i) => L + slot * (i + 0.5);
      const Y = (v) => Tp + ih - (v / max) * ih;
      const y0 = Y(0);
      geo = { L, slot };
      const grid = [0, max / 2, max].map((v) => {
        const y = Math.round(Y(v)) + 0.5;
        return `<line class="focus-grid" x1="${L}" x2="${W - Rm}" y1="${y}" y2="${y}"/><text class="focus-axis" x="${L - 7}" y="${y + 4}" text-anchor="end">${num(v)}</text>`;
      }).join('');
      const gy = Math.round(Y(cfg.goal)) + 0.5;
      const goal = `<line class="focus-goal-line" x1="${L}" x2="${W - Rm}" y1="${gy}" y2="${gy}"/><text class="focus-axis" x="${W - Rm}" y="${gy - 5}" text-anchor="end">Ziel</text>`;
      const band = hover >= 0 ? `<rect class="focus-band" x="${(L + slot * hover + 2).toFixed(1)}" y="${Tp - 6}" width="${(slot - 4).toFixed(1)}" height="${(ih + 6).toFixed(1)}" rx="8"/>` : '';
      const bars = data.map((d, i) => {
        const x = X(i) - bw / 2;
        const lab = i === 6 ? 'Heute' : d.date.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '');
        const text = `<text class="focus-axis${i === 6 ? ' is-today' : ''}" x="${X(i).toFixed(1)}" y="${H - 5}" text-anchor="middle">${lab}</text>`;
        if (!d.min) return `<rect class="focus-stub" x="${x.toFixed(1)}" y="${(y0 - 2).toFixed(1)}" width="${bw.toFixed(1)}" height="2" rx="1"/>${text}`;
        const y = Math.min(Y(d.min), y0 - 3);
        const r = Math.min(6, y0 - y, bw / 2);
        const n = (v) => v.toFixed(1);
        return `<path class="focus-col${i === 6 ? ' is-today' : ''}${i === hover ? ' is-hover' : ''}" d="M${n(x)} ${n(y0)}V${n(y + r)}Q${n(x)} ${n(y)} ${n(x + r)} ${n(y)}H${n(x + bw - r)}Q${n(x + bw)} ${n(y)} ${n(x + bw)} ${n(y + r)}V${n(y0)}Z"/>${text}`;
      }).join('');
      const empty = data.every((d) => !d.min) ? `<text class="focus-void" x="${(L + iw / 2).toFixed(1)}" y="${(Tp + ih * 0.62).toFixed(1)}" text-anchor="middle">Noch keine Fokus-Zeit in dieser Woche.</text>` : '';
      chartSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      chartSvg.innerHTML = `${band}${grid}${goal}${bars}${empty}`;
      if (hover >= 0) {
        const d = data[hover];
        tip.hidden = false;
        tip.firstChild.textContent = `${num(d.min)} Min.`;
        tip.lastChild.textContent = `${d.date.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'short' })} · ${plural(d.n, 'Sitzung', 'Sitzungen')}`;
        const half = tip.offsetWidth / 2;
        tip.style.left = `${clamp(X(hover), half, Math.max(half, W - half))}px`;
        tip.style.top = `${Y(d.min)}px`;
      } else tip.hidden = true;
    };
    const paintStats = () => {
      const d = dayOf(dayKey());
      const m = mins(d.s);
      const st = streak();
      const sum = week().reduce((a, x) => a + x.min, 0);
      const val = (el, n, unit) => el.replaceChildren(num(n), h('small', unit));
      val(sMin.b, m, 'Min.');
      val(sSes.b, d.n, d.n === 1 ? 'Sitzung' : 'Sitzungen');
      val(sStreak.b, st, st === 1 ? 'Tag' : 'Tage');
      val(sWeek.b, sum, 'Min.');
      gBar.style.setProperty('--p', clamp(m / cfg.goal));
      gTxt.textContent = m >= cfg.goal ? `Geschafft – ${num(m)} von ${num(cfg.goal)} Min.` : `${num(m)} von ${num(cfg.goal)} Min. · noch ${num(cfg.goal - m)}`;
      renderChart();
    };
    const paintPrefs = () => { for (const fn of syncs) fn(); };

    const syncTitle = () => {
      const next = [T.phase, T.running, fresh(), cfg.sound].join();
      if (next === sig) return;
      sig = next;
      win.setTitle(T.phase === 'focus' ? 'Fokus' : `${PHASES[T.phase]} – Fokus`);     // frischt auch die Menüleiste auf
    };
    const paintAll = () => {
      paintTimer();
      paintAmb();
      paintToday();
      if (tab === 'stats') paintStats();
      if (tab === 'prefs') paintPrefs();
      syncTitle();
    };
    const showTab = () => {
      vTimer.hidden = tab !== 'timer';
      vStats.hidden = tab !== 'stats';
      vPrefs.hidden = tab !== 'prefs';
      hover = -1;
      paintAll();
    };
    tabs.addEventListener('change', (e) => { tab = e.detail.value; showTab(); });

    // ---------- Diagramm: Zeiger und Tastatur ----------
    const indexAt = (x) => (geo ? clamp(Math.floor((x - chart.getBoundingClientRect().left - geo.L) / geo.slot), 0, 6) : -1);
    chart.addEventListener('pointermove', (e) => { const i = indexAt(e.clientX); if (i !== hover) { hover = i; renderChart(); } });
    chart.addEventListener('pointerleave', () => { hover = -1; renderChart(); });
    chart.addEventListener('focus', () => { if (hover < 0) hover = 6; renderChart(); });
    chart.addEventListener('blur', () => { hover = -1; renderChart(); });
    chart.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (!d || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      hover = clamp((hover < 0 ? 6 : hover) + d, 0, 6);
      renderChart();
    });
    const ro = new ResizeObserver(() => { if (tab === 'stats') renderChart(); });
    ro.observe(chart);

    // ---------- Ereignisse ----------
    const onEvt = (e) => {
      if (win.min) { stale = true; return; }                // minimiert: beim Zurückholen malt onFocus alles neu
      if (e.detail === 'tick') paintTime(); else paintAll();
    };
    addEventListener(EVT, onEvt);
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, textarea, select, button, a')) return;
      const k = e.key.toLowerCase();
      if (e.code === 'Space') { e.preventDefault(); toggle(); }
      else if (k === 'r') { e.preventDefault(); if (!fresh()) reset(); }
      else if (k === 'n') { e.preventDefault(); skip(); }
    };
    win.el.addEventListener('keydown', onKey);
    // Nach einem Mausklick auf einen Knopf gehört die Leertaste wieder dem Timer
    root.addEventListener('click', (e) => {
      const a = document.activeElement;
      if (e.detail > 0 && a?.tagName === 'BUTTON' && root.contains(a)) win.el.focus({ preventScroll: true });
    });

    paintPrefs();
    paintAll();

    const goTab = (i) => () => tabs.select(i);
    return {
      onClose() {
        removeEventListener(EVT, onEvt);
        win.el.removeEventListener('keydown', onKey);
        ro.disconnect();
        if (!T.running) ambSet(false);                      // Probehören endet mit dem Fenster; eine laufende Fokus-Phase klingt weiter
      },
      onFocus() { if (stale) { stale = false; paintAll(); } },
      menus: () => [
        {
          label: 'Timer',
          items: [
            { label: T.running ? 'Pausieren' : fresh() ? 'Starten' : 'Fortsetzen', icon: T.running ? 'pause' : 'play', hint: 'Leertaste', run: toggle },
            { label: 'Überspringen', icon: 'arrowRight', hint: 'N', run: skip },
            { label: 'Zurücksetzen', icon: 'reload', hint: 'R', disabled: fresh(), run: reset },
            { label: 'Von vorn beginnen', run: restart },
            '-',
            { heading: 'Phase' },
            ...Object.entries(PHASES).map(([id, name]) => ({ label: name, checked: T.phase === id, run: () => jump(id) })),
          ],
        },
        {
          label: 'Klang',
          items: [
            ...SOUNDS.map((s) => ({ label: s.long, checked: cfg.sound === s.id, run: () => pickSound(s.id) })),
            '-',
            { label: 'Stille', checked: cfg.sound === 'off', run: () => pickSound('off') },
          ],
        },
        {
          label: 'Ansicht',
          items: [
            { label: 'Timer', checked: tab === 'timer', run: goTab(0) },
            { label: 'Statistik', checked: tab === 'stats', run: goTab(1) },
            { label: 'Einstellungen', checked: tab === 'prefs', run: goTab(2) },
          ],
        },
      ],
    };
  },

  /** Läuft beim Systemstart: stellt einen laufenden Timer wieder her und überwacht ihn ohne Fenster. */
  background() { boot(); },

  widgets: {
    timer(el) {
      boot();
      const C = 2 * Math.PI * 43;
      el.classList.add('focus-w');
      const ring = h('div.focus-w-ring', { html: `<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="focus-w-track" cx="50" cy="50" r="43"/><circle class="focus-w-arc" cx="50" cy="50" r="43" stroke-dasharray="${C.toFixed(2)}"/></svg>` });
      const arc = ring.querySelector('.focus-w-arc');
      const time = h('b.focus-w-time');
      const phase = h('span.focus-w-phase');
      const info = h('span.focus-w-info');
      const btn = h('button.focus-w-btn', { type: 'button', onclick: toggle });
      ring.append(h('div.focus-w-in', time, phase));
      el.replaceChildren(ring, h('div.focus-w-foot', info, btn));

      const paintTime = () => {
        const ms = left();
        const txt = fmt(ms);
        time.textContent = txt;
        time.classList.toggle('is-long', txt.length > 5);
        const f = T.total > 0 ? clamp((ms - (T.running ? 1000 : 0)) / T.total) : 0;
        arc.style.strokeDashoffset = (C * (1 - f)).toFixed(2);
      };
      const paint = () => {
        el.dataset.phase = T.phase;
        el.classList.toggle('is-run', T.running);
        phase.textContent = PHASES[T.phase];
        info.textContent = T.running || !fresh() ? `Runde ${Math.min(T.round, cfg.rounds)}/${cfg.rounds}` : `Heute ${num(mins(dayOf(dayKey()).s))} Min.`;
        const lbl = T.running ? 'Pausieren' : fresh() ? 'Starten' : 'Fortsetzen';
        setIcon(btn, T.running ? 'pause' : 'play');
        btn.setAttribute('aria-label', lbl);
        btn.title = lbl;
        paintTime();
      };
      const onEvt = (e) => { if (e.detail === 'tick') paintTime(); else paint(); };
      addEventListener(EVT, onEvt);
      paint();
      return () => removeEventListener(EVT, onEvt);
    },
  },
};
