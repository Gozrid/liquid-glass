// beats.js — Beats: Step-Sequencer mit 16 Schritten und 8 Spuren – Schlagzeug, Bass und Lead aus dem Synthesizer

import { h, clamp, ticker, debounce, reducedMotion } from '../../../core/util.js';
import { icon } from '../../../core/icons.js';
import { initControls } from '../../../core/controls.js';
import { audio, tone, midiToFreq } from '../../../core/audio.js';
import { sys } from '../../sys.js';
import { openMenu } from '../../ui.js';
import { style, appStore, toast } from '../../kit.js';

const STEPS = 16;
const SLOTS = ['A', 'B', 'C', 'D'];
const SCALE = [0, 3, 5, 7, 10];                 // Moll-Pentatonik
const NOTES = 11;                               // zwei Oktaven plus Grundton
const NAMES = ['C', 'Cis', 'D', 'Dis', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'B', 'H'];
const TRACKS = [
  { id: 'kick', name: 'Kick', short: 'Kick', color: 'var(--c-coral)' },
  { id: 'snare', name: 'Snare', short: 'Snr', color: 'var(--c-amber)' },
  { id: 'hat', name: 'Hi-Hat', short: 'HH', color: 'var(--c-cyan)' },
  { id: 'open', name: 'Offene Hi-Hat', short: 'OH', color: 'color-mix(in srgb, var(--c-cyan) 50%, var(--c-mint))' },
  { id: 'clap', name: 'Clap', short: 'Clap', color: 'var(--c-violet)' },
  { id: 'tom', name: 'Tom', short: 'Tom', color: 'var(--c-mint)' },
  { id: 'bass', name: 'Bass', short: 'Bass', color: 'var(--accent)', base: 33, first: 1 },
  { id: 'lead', name: 'Lead', short: 'Lead', color: 'color-mix(in srgb, var(--c-violet) 45%, var(--c-coral))', base: 57, first: 6 },
];
const N = TRACKS.length;
const midiOf = (tr, v) => tr.base + SCALE[(v - 1) % 5] + 12 * Math.floor((v - 1) / 5);
const nameOf = (tr, v) => { const m = midiOf(tr, v); return `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`; };

// Muster als Text: Schlagzeug „x“ = Schlag, Bass/Lead Ziffer 1–9, a, b = Ton der Skala
const parse = (rows) => rows.map((row) => [...row.padEnd(STEPS, '.')].slice(0, STEPS).map((ch) => (ch === 'x' ? 1 : /[1-9ab]/.test(ch) ? parseInt(ch, 16) : 0)));
const empty = () => Array.from({ length: N }, () => new Array(STEPS).fill(0));
const PRESETS = [
  { name: 'Boom Bap', bpm: 90, swing: 60, rows: ['x......x..x.....', '....x.......x...', 'x.x.x.x.x.x.x.x.', '..............x.', '................', '................', '1......1..3..2..', '......6.....5.4.'] },
  { name: 'Vier auf dem Boden', bpm: 124, swing: 0, rows: ['x...x...x...x...', '................', 'xx.xxx.xxx.xxx.x', '..x...x...x...x.', '....x.......x...', '................', '..1...1...1..1.3', '6..6..6...5..5..'] },
  { name: 'Kellertechno', bpm: 132, swing: 0, rows: ['x...x...x...x...', '................', '..x...x...x...x.', '................', '....x.......x..x', '......x......x..', '1.11.1.21.11.1.3', '....9.......9.7.'] },
  { name: 'Halbzeit', bpm: 140, swing: 0, rows: ['x......x..x.....', '........x.......', 'x.x.x.xxx.x.xxxx', '..............x.', '........x.......', '................', '1......1..3.....', '6...9...8...6.5.'] },
  { name: 'Funk-Taxi', bpm: 104, swing: 35, rows: ['x..x..x...x..x..', '....x.......x..x', 'x.xxx.xxx.xxx.xx', '......x.........', '....x.......x...', '..............x.', '1..1.3.5..1.6.5.', '..7...8.7....5..'] },
  { name: 'Synthpop', bpm: 112, swing: 0, rows: ['x.......x..x....', '....x.......x...', 'x.x.x.x.x.x.x.x.', '................', '............x...', '..............xx', '1.1.1.1.4.4.3.3.', '6.9.8.6.9.8.6.5.'] },
];

function randomPattern() {
  const p = empty();
  const r = Math.random;
  const four = r() < 0.4;
  for (let s = 0; s < STEPS; s++) {
    p[0][s] = s === 0 || (four ? s % 4 === 0 : r() < (s % 4 === 2 ? 0.3 : s % 2 === 0 ? 0.16 : 0.07)) ? 1 : 0;
    p[1][s] = (!four && (s === 4 || s === 12)) || r() < 0.04 ? 1 : 0;
    p[4][s] = (four && (s === 4 || s === 12)) || (s === 12 && r() < 0.3) ? 1 : 0;
    p[5][s] = s >= 13 && r() < 0.3 ? 1 : 0;
  }
  const dense = r() < 0.5;
  for (let s = 0; s < STEPS; s++) {
    p[3][s] = s % 4 === 2 && r() < 0.28 ? 1 : 0;
    p[2][s] = !p[3][s] && (s % 2 === 0 ? r() < 0.9 : dense && r() < 0.6) ? 1 : 0;
  }
  const bassNotes = [1, 1, 1, 3, 4, 5, 6];
  for (let s = 0; s < STEPS; s++) if (p[0][s] ? r() < 0.75 : r() < 0.14) p[6][s] = bassNotes[(r() * bassNotes.length) | 0];
  p[6][0] = 1;
  let v = 6 + ((r() * 3) | 0);
  for (let s = 0; s < STEPS; s++) {
    if (r() < (s % 2 === 0 ? 0.42 : 0.12)) { v = clamp(v + [-2, -1, -1, 1, 1, 2][(r() * 6) | 0], 4, NOTES); p[7][s] = v; }
  }
  return p;
}

// ==========================================================================
// Klangerzeugung: jede Spur spielt in ihren eigenen Lautstärke-Knoten
// ==========================================================================
let noiseBuf = null;
function burst(t, dest, { dur, vol, type = 'highpass', f = 7500, q = 0.7 }) {
  const { ctx } = audio();
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const fl = ctx.createBiquadFilter();
  fl.type = type;
  fl.frequency.value = f;
  fl.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(fl); fl.connect(g); g.connect(dest);
  src.start(t, Math.random() * 0.7);
  src.stop(t + dur + 0.03);
}
function synth(t, dest, f, { types, cut, cutEnd, q, dur, vol, sweep }) {
  const { ctx } = audio();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = q;
  lp.frequency.setValueAtTime(cut, t);
  lp.frequency.exponentialRampToValueAtTime(cutEnd, t + sweep);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  types.forEach((type, i) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = i ? 9 : -4;
    o.connect(lp);
    o.start(t);
    o.stop(t + dur + 0.03);
  });
  lp.connect(g);
  g.connect(dest);
}
/** Spur i zum Zeitpunkt t (Audio-Uhr) auslösen; v ist der Wert der Zelle (bei Bass/Lead der Ton). */
function hit(i, t, v, dest) {
  const tr = TRACKS[i];
  switch (tr.id) {
    case 'kick':
      tone({ f: 150, f2: 42, dur: 0.32, vol: 0.9, attack: 0.002, when: t, abs: true, dest });
      break;
    case 'snare':
      burst(t, dest, { dur: 0.18, vol: 0.5, f: 1400 });
      tone({ type: 'triangle', f: 210, f2: 150, dur: 0.09, vol: 0.35, when: t, abs: true, dest });
      break;
    case 'hat':
      burst(t, dest, { dur: 0.05, vol: 0.24 });
      break;
    case 'open':
      burst(t, dest, { dur: 0.3, vol: 0.2, f: 6800 });
      break;
    case 'clap':
      for (const d of [0, 0.011, 0.023]) burst(t + d, dest, { dur: 0.03, vol: 0.34, type: 'bandpass', f: 1300, q: 0.9 });
      burst(t + 0.034, dest, { dur: 0.16, vol: 0.3, type: 'bandpass', f: 1300, q: 0.9 });
      break;
    case 'tom':
      tone({ f: 190, f2: 88, dur: 0.3, vol: 0.7, attack: 0.003, when: t, abs: true, dest });
      burst(t, dest, { dur: 0.02, vol: 0.08, f: 3000 });
      break;
    case 'bass':
      synth(t, dest, midiToFreq(midiOf(tr, v)), { types: ['sawtooth', 'square'], cut: 1200, cutEnd: 150, q: 6, sweep: 0.2, dur: 0.3, vol: 0.42 });
      break;
    default:
      synth(t, dest, midiToFreq(midiOf(tr, v)), { types: ['square', 'sawtooth'], cut: 3400, cutEnd: 900, q: 3, sweep: 0.18, dur: 0.24, vol: 0.2 });
  }
}

const svg = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const IC = {
  dice: svg('<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.200" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="1.200" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r="1.200" fill="currentColor" stroke="none"/><circle cx="9" cy="15" r="1.200" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.200" fill="currentColor" stroke="none"/>'),
};

style('beats', `
.beats { --lab: 228px; }
.beats-top { display: flex; align-items: center; gap: 14px; flex: none; padding: 10px 14px; border-bottom: .5px solid var(--line); }
.beats-play { display: grid; place-items: center; flex: none; width: 42px; height: 42px; padding: 0; border: 0; border-radius: 50%; background: var(--accent); color: #fff; box-shadow: inset 0 1px 0 rgba(255, 255, 255, .4), 0 8px 18px -8px var(--accent); transition: transform .4s var(--spring); }
.beats-play:hover { transform: scale(1.07); }
.beats-play:active { transform: scale(.92); }
.beats-play .ico { width: 20px; height: 20px; }
.beats-knob { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 12px; font-weight: 600; color: var(--fg-3); }
.beats-knob .gslider { width: 120px; flex: 0 1 120px; min-width: 70px; height: 26px; }
.beats-knob output { min-width: 62px; font: 600 12.5px var(--font); color: var(--fg); font-variant-numeric: tabular-nums; white-space: nowrap; }
.beats-knob.swing output { min-width: 38px; }
.beats-top .sp { flex: 1; }
.beats-top .gseg button { padding: .4em .85em; }
.beats-top .gseg button.is-next { animation: beats-blink .5s steps(2) infinite; }
@keyframes beats-blink { 50% { opacity: .35; } }

.beats-grid { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 8px 14px 14px; }
.beats-head, .beats-row { display: grid; grid-template-columns: var(--lab) repeat(${STEPS}, minmax(0, 1fr)); column-gap: 4px; align-items: center; }
.beats-head { flex: none; height: 20px; font-size: 10.5px; font-weight: 600; color: var(--fg-4); font-variant-numeric: tabular-nums; }
.beats-head span { text-align: center; border-radius: 6px; transition: color .1s; }
.beats-head span:nth-child(4n + 2) { color: var(--fg-3); }
.beats-head span.is-now { color: var(--accent); }
.beats-rows { flex: 1; min-height: 0; display: grid; grid-template-rows: repeat(${N}, minmax(24px, 46px)); row-gap: 5px; align-content: center; }
.beats-row { min-height: 0; height: 100%; }
.beats-head span:nth-child(4n + 2):not(:nth-child(2)), .beats-cell:nth-child(4n + 2):not(:nth-child(2)) { margin-left: 5px; }
.beats-lab { display: flex; align-items: center; gap: 5px; min-width: 0; padding-right: 8px; }
.beats-name { display: flex; align-items: center; gap: 7px; flex: 1; min-width: 0; padding: 4px 6px; border: 0; border-radius: 7px; background: none; font-size: 12.5px; font-weight: 600; text-align: left; }
.beats-name:hover { background: var(--raise); }
.beats-name i { flex: none; width: 9px; height: 9px; border-radius: 50%; background: var(--tc); }
.beats-name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.beats-name .s { display: none; }
.beats-ms { flex: none; width: 21px; height: 21px; padding: 0; border: 0; border-radius: 6px; background: var(--raise); font-size: 10.5px; font-weight: 800; color: var(--fg-3); transition: transform .3s var(--spring); }
.beats-ms:active { transform: scale(.85); }
.beats-ms[aria-pressed="true"] { background: var(--c-amber); color: #10122a; }
.beats-ms.solo[aria-pressed="true"] { background: var(--c-cyan); }
.beats-vol { position: relative; flex: none; width: 44px; height: 16px; border-radius: 5px; background: var(--well); box-shadow: inset 0 0 0 .5px var(--line); overflow: hidden; cursor: ew-resize; touch-action: none; outline: 0; }
.beats-vol i { position: absolute; inset: 0 auto 0 0; width: calc(var(--v, .8) * 100%); background: var(--tc); opacity: .85; }
.beats-vol:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
.beats-cell { position: relative; min-width: 0; height: 100%; padding: 0; border: 0; border-radius: 8px; background: var(--well); box-shadow: inset 0 0 0 .5px var(--line); overflow: hidden; font-size: 10px; font-weight: 700; color: rgba(5, 6, 30, .82); touch-action: none; transition: background-color .12s, filter .12s; }
.beats-cell:nth-child(8n + 2), .beats-cell:nth-child(8n + 3), .beats-cell:nth-child(8n + 4), .beats-cell:nth-child(8n + 5) { background: var(--raise); }
.beats-cell:hover { filter: brightness(1.25); }
.beats-cell.is-now { background: var(--raise-2); }
.beats-cell.is-on { background: var(--tc); box-shadow: inset 0 1px 0 rgba(255, 255, 255, .45), inset 0 -6px 10px -6px rgba(0, 0, 20, .35); }
.beats-cell.is-on.is-now { filter: brightness(1.3) saturate(1.15); }
.beats-cell b { position: absolute; left: 0; right: 0; bottom: 0; height: calc(var(--n, 0) * 100%); background: rgba(255, 255, 255, .32); pointer-events: none; }
.beats-cell span { position: relative; pointer-events: none; }
.beats-cell:focus-visible { outline: 2px solid var(--fg); outline-offset: 1px; }
.beats-row.is-off .beats-cell.is-on { opacity: .4; }
.beats-row.is-off .beats-name { color: var(--fg-3); }

@container win (max-width: 800px) {
  .beats { --lab: 158px; }
  .beats-vol { width: 38px; }
  .beats-name .l { display: none; }
  .beats-name .s { display: block; }
  .beats-name { padding-inline: 3px; gap: 5px; }
  .beats-lab { gap: 4px; padding-right: 6px; }
  .beats-top { gap: 10px; padding-inline: 12px; }
  .beats-knob > span { display: none; }
  .beats-knob .gslider { width: 92px; flex-basis: 92px; }
  .beats-cell { font-size: 9px; border-radius: 6px; }
  .beats-grid { padding-inline: 12px; }
  .beats-head, .beats-row { column-gap: 3px; }
}
`);

export default {
  singleton: true,
  width: 940, height: 500, minW: 620, minH: 400,

  mount(win) {
    const S = appStore('beats');
    const saved = S.get('state', null);
    const st = {
      bpm: clamp(Number(saved?.bpm) || 110, 60, 180),
      swing: clamp(Number(saved?.swing) || 0, 0, 100),
      vols: TRACKS.map((_, i) => clamp(Number(saved?.vols?.[i] ?? 0.8), 0, 1)),
      mute: TRACKS.map((_, i) => !!saved?.mute?.[i]),
      solo: TRACKS.map((_, i) => !!saved?.solo?.[i]),
      slot: clamp(Number(saved?.slot) || 0, 0, 3),
      pats: SLOTS.map((_, k) => {
        const p = saved?.pats?.[k];
        return Array.isArray(p) && p.length === N ? p.map((row) => Array.from({ length: STEPS }, (_, s) => clamp(Number(row?.[s]) || 0, 0, NOTES))) : k === 0 && !saved ? parse(PRESETS[0].rows) : empty();
      }),
    };
    if (!saved) { st.bpm = PRESETS[0].bpm; st.swing = PRESETS[0].swing; }
    const save = debounce(() => S.set('state', st), 250);
    const last = TRACKS.map((tr) => tr.first || 1);          // zuletzt gesetzter Ton je Spur
    const undo = [];
    const remember = () => { undo.push(JSON.stringify(st.pats)); if (undo.length > 40) undo.shift(); };
    const pat = () => st.pats[st.slot];
    const stepDur = () => 60 / st.bpm / 4;

    let G = null;                  // Audio-Knoten: {mix, tg[], delay}
    let playing = false;
    let step = 0, nextT = 0, timer = 0;
    let playSlot = st.slot;        // spielendes Muster (wechselt am Taktanfang)
    let queue = [];                // geplante Schritte für die Anzeige: {i, t, slot}
    let nowCol = -1;
    let closed = false;

    // ---------- Gerüst ----------
    const bPlay = h('button.beats-play', { type: 'button', onclick: () => toggle() });
    const oBpm = h('output');
    const sBpm = h('div.gslider', { dataset: { min: 60, max: 180, step: 1, value: st.bpm }, 'aria-label': 'Tempo' });
    const oSwing = h('output');
    const sSwing = h('div.gslider', { dataset: { min: 0, max: 100, step: 1, value: st.swing }, 'aria-label': 'Swing' });
    const seg = h('div.gseg', { 'aria-label': 'Muster' }, SLOTS.map((n, k) => h('button', { type: 'button', dataset: { value: k }, 'aria-selected': String(k === st.slot) }, n)));
    const top = h('div.beats-top', bPlay,
      h('div.beats-knob', h('span', 'Tempo'), sBpm, oBpm),
      h('div.beats-knob.swing', h('span', 'Swing'), sSwing, oSwing),
      h('span.sp'), seg);
    const head = h('div.beats-head', h('span'), Array.from({ length: STEPS }, (_, s) => h('span', String(s + 1))));
    const rowsEl = h('div.beats-rows');
    win.body.append(h('div.kit-app.beats', top, h('div.beats-grid.scroll', head, rowsEl)));
    initControls(top);

    /** Menü, nach dessen Schließen die Tastatur wieder dem Fenster gehört. */
    const menu = (items, pos) => openMenu(items, { ...pos, onClose: () => setTimeout(() => {
      const a = document.activeElement;
      if (!closed && sys.wm.focused === win && (!a || a === document.body || !a.isConnected)) win.el.focus({ preventScroll: true });
    }, 0) });
    const bPreset = h('button.tool', { type: 'button', 'aria-label': 'Vorlagen', title: 'Vorlagen', html: icon('sparkles') });
    bPreset.addEventListener('click', () => menu([{ heading: 'Vorlage in Muster ' + SLOTS[st.slot] + ' laden' }, ...PRESETS.map((p) => ({ label: p.name, hint: `${p.bpm} BPM`, run: () => loadPreset(p) }))], { anchor: bPreset, align: 'right' }));
    const bCopy = h('button.tool', { type: 'button', 'aria-label': 'Muster kopieren', title: 'Muster kopieren', html: icon('copy') });
    bCopy.addEventListener('click', () => menu(copyItems(), { anchor: bCopy, align: 'right' }));
    win.tools.append(bPreset,
      h('button.tool', { type: 'button', 'aria-label': 'Zufallsmuster', title: 'Zufallsmuster', html: IC.dice, onclick: () => randomize() }),
      bCopy,
      h('button.tool', { type: 'button', 'aria-label': 'Muster leeren', title: 'Muster leeren', html: icon('eraser'), onclick: () => clear() }));

    // ---------- Raster ----------
    const cells = [];          // cells[spur][schritt]
    const rowEls = [];
    const volEls = [];
    TRACKS.forEach((tr, i) => {
      const bM = h('button.beats-ms', { type: 'button', 'aria-pressed': String(st.mute[i]), 'aria-label': `${tr.name} stumm`, title: 'Stumm', onclick: () => { st.mute[i] = !st.mute[i]; paintMix(); } }, 'M');
      const bS = h('button.beats-ms.solo', { type: 'button', 'aria-pressed': String(st.solo[i]), 'aria-label': `${tr.name} solo`, title: 'Solo', onclick: () => { st.solo[i] = !st.solo[i]; paintMix(); } }, 'S');
      const vol = h('div.beats-vol', { role: 'slider', tabIndex: 0, 'aria-label': `Lautstärke ${tr.name}`, 'aria-valuemin': 0, 'aria-valuemax': 100, title: 'Lautstärke (Doppelklick: zurücksetzen)' }, h('i'));
      const setVol = (v) => { st.vols[i] = clamp(Math.round(v * 20) / 20, 0, 1); paintMix(); };
      vol.addEventListener('pointerdown', (e) => {
        if (e.button && e.pointerType === 'mouse') return;
        vol.setPointerCapture(e.pointerId);
        const at = (ev) => { const r = vol.getBoundingClientRect(); setVol((ev.clientX - r.left) / r.width); };
        at(e);
        const up = () => { vol.removeEventListener('pointermove', at); vol.removeEventListener('pointerup', up); vol.removeEventListener('pointercancel', up); };
        vol.addEventListener('pointermove', at);
        vol.addEventListener('pointerup', up);
        vol.addEventListener('pointercancel', up);
      });
      vol.addEventListener('dblclick', () => setVol(0.8));
      vol.addEventListener('wheel', (e) => { e.preventDefault(); setVol(st.vols[i] + (e.deltaY < 0 ? 0.05 : -0.05)); }, { passive: false });
      vol.addEventListener('keydown', (e) => {
        const d = { ArrowRight: 0.05, ArrowUp: 0.05, ArrowLeft: -0.05, ArrowDown: -0.05 }[e.key];
        if (!d) return;
        e.preventDefault();
        e.stopPropagation();
        setVol(st.vols[i] + d);
      });
      const name = h('button.beats-name', { type: 'button', title: `${tr.name} anspielen`, onclick: () => preview(i, last[i]) }, h('i'), h('span.l', tr.name), h('span.s', tr.short));
      const row = h('div.beats-row', { style: { '--tc': tr.color }, role: 'row' }, h('div.beats-lab', name, bM, bS, vol));
      cells[i] = [];
      for (let s = 0; s < STEPS; s++) {
        const c = h('button.beats-cell', { type: 'button', tabIndex: i === 0 && s === 0 ? 0 : -1, dataset: { t: i, s } }, h('b'), h('span'));
        cells[i][s] = c;
        row.append(c);
      }
      rowEls[i] = row;
      volEls[i] = { vol, bM, bS };
      rowsEl.append(row);
    });

    function paintCell(i, s) {
      const v = pat()[i][s];
      const c = cells[i][s];
      const tr = TRACKS[i];
      c.classList.toggle('is-on', v > 0);
      c.setAttribute('aria-pressed', String(v > 0));
      c.setAttribute('aria-label', `${tr.name}, Schritt ${s + 1}${v ? (tr.base ? `, ${nameOf(tr, v)}` : ', an') : ', aus'}`);
      if (tr.base) {
        c.lastChild.textContent = v ? nameOf(tr, v) : '';
        c.style.setProperty('--n', v ? (0.12 + 0.88 * ((v - 1) / (NOTES - 1))).toFixed(3) : 0);
      }
    }
    const paintGrid = () => { for (let i = 0; i < N; i++) for (let s = 0; s < STEPS; s++) paintCell(i, s); };
    const audible = (i) => (st.solo.some(Boolean) ? st.solo[i] : !st.mute[i]);
    function paintMix() {
      TRACKS.forEach((_, i) => {
        const { vol, bM, bS } = volEls[i];
        vol.style.setProperty('--v', st.vols[i]);
        vol.setAttribute('aria-valuenow', Math.round(st.vols[i] * 100));
        bM.setAttribute('aria-pressed', String(st.mute[i]));
        bS.setAttribute('aria-pressed', String(st.solo[i]));
        rowEls[i].classList.toggle('is-off', !audible(i));
        if (G) G.tg[i].gain.setTargetAtTime(audible(i) ? st.vols[i] : 0, audio().ctx.currentTime, 0.012);
      });
      save();
    }
    function paintTop() {
      bPlay.innerHTML = icon(playing ? 'stop' : 'play');
      bPlay.setAttribute('aria-label', playing ? 'Stopp' : 'Start');
      bPlay.title = playing ? 'Stopp (Leertaste)' : 'Start (Leertaste)';
      oBpm.textContent = `${st.bpm} BPM`;
      oSwing.textContent = `${st.swing} %`;
      [...seg.querySelectorAll('button')].forEach((b, k) => b.classList.toggle('is-next', playing && k === st.slot && playSlot !== st.slot));
    }

    // ---------- Audio ----------
    function graph() {
      if (G) return G;
      const { ctx, out } = audio();
      const mix = ctx.createGain();
      mix.gain.value = 0.85;
      mix.connect(out);
      const tg = TRACKS.map((_, i) => { const g = ctx.createGain(); g.gain.value = audible(i) ? st.vols[i] : 0; g.connect(mix); return g; });
      // Echo auf dem Lead, im Takt (punktierte Achtel)
      const delay = ctx.createDelay(1.2);
      const fb = ctx.createGain();
      fb.gain.value = 0.32;
      const wet = ctx.createGain();
      wet.gain.value = 0.3;
      delay.delayTime.value = Math.min(1.1, stepDur() * 3);
      tg[N - 1].connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(mix);
      G = { mix, tg, delay };
      return G;
    }
    function preview(i, v) {
      if (playing) return;
      try { hit(i, audio().ctx.currentTime + 0.01, v, graph().tg[i]); } catch { /* ohne Ton */ }
    }
    function tick() {
      if (!playing) return;
      const { ctx } = audio();
      if (nextT < ctx.currentTime - 0.1) nextT = ctx.currentTime + 0.03;      // Tab war eingefroren: nicht nachholen
      const ahead = document.hidden ? 1.2 : 0.12;
      while (nextT < ctx.currentTime + ahead) {
        if (step === 0 && playSlot !== st.slot) { playSlot = st.slot; paintTop(); announce(); }
        const sd = stepDur();
        const t = nextT + (step % 2 ? (st.swing / 100) * sd / 3 : 0);
        const p = st.pats[playSlot];
        for (let i = 0; i < N; i++) if (p[i][step]) hit(i, t, p[i][step], G.tg[i]);
        queue.push({ i: step, t, slot: playSlot });
        nextT += sd;
        step = (step + 1) % STEPS;
      }
    }
    function showStep(col, slot) {
      if (nowCol >= 0) { for (let i = 0; i < N; i++) cells[i][nowCol].classList.remove('is-now'); head.children[nowCol + 1].classList.remove('is-now'); }
      nowCol = col;
      if (col < 0) return;
      head.children[col + 1].classList.add('is-now');
      const p = st.pats[slot];
      for (let i = 0; i < N; i++) {
        const c = cells[i][col];
        c.classList.add('is-now');
        if (slot === st.slot && p[i][col] && audible(i) && !reducedMotion.matches) c.animate([{ transform: 'scale(1.24)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'cubic-bezier(.3, 1.6, .5, 1)' });
      }
    }
    const frame = () => {
      if (!playing) return;
      const now = audio().ctx.currentTime;
      let cur = null;
      while (queue.length && queue[0].t <= now + 0.012) cur = queue.shift();
      if (cur && !win.min) showStep(cur.i, cur.slot);
    };
    function announce() {
      sys.media({ app: 'beats', title: `Beats – Muster ${SLOTS[playSlot]}`, artist: `${st.bpm} BPM`, playing, toggle });
    }
    function start() {
      if (playing || closed) return;
      const { ctx } = audio();
      graph();
      G.mix.gain.cancelScheduledValues(ctx.currentTime);
      G.mix.gain.setTargetAtTime(0.85, ctx.currentTime, 0.01);
      playing = true;
      step = 0;
      playSlot = st.slot;
      queue = [];
      nextT = ctx.currentTime + 0.06;
      clearInterval(timer);
      timer = setInterval(tick, 25);
      tick();
      ticker.add(frame);
      paintTop();
      announce();
    }
    function stop() {
      if (!playing) return;
      playing = false;
      clearInterval(timer);
      timer = 0;
      ticker.remove(frame);
      queue = [];
      showStep(-1);
      paintTop();
      announce();
    }
    function toggle() { if (playing) stop(); else start(); }

    // ---------- Bearbeiten ----------
    function setCell(i, s, v, sound = true) {
      const p = pat();
      if (p[i][s] === v) return;
      p[i][s] = v;
      if (v && TRACKS[i].base) last[i] = v;
      paintCell(i, s);
      save();
      if (v && sound) preview(i, v);
    }
    const cellAt = (x, y) => document.elementFromPoint(x, y)?.closest?.('.beats-cell');
    rowsEl.addEventListener('pointerdown', (e) => {
      const c = e.target.closest('.beats-cell');
      if (!c || (e.button && e.pointerType === 'mouse')) return;
      const i = Number(c.dataset.t), s = Number(c.dataset.s);
      const tr = TRACKS[i];
      const was = pat()[i][s];
      remember();
      focusCell(i, s);
      c.setPointerCapture(e.pointerId);
      let moved = false;
      let move;
      if (tr.base) {
        // Bass/Lead: Klick setzt den Ton, Ziehen nach oben/unten wählt ihn
        const from = was || last[i];
        if (!was) setCell(i, s, from);
        const y0 = e.clientY;
        move = (ev) => {
          const v = clamp(from + Math.round((y0 - ev.clientY) / 9), 1, NOTES);
          if (Math.abs(ev.clientY - y0) > 4) moved = true;
          setCell(i, s, v);
        };
      } else {
        // Schlagzeug: Klick schaltet um, Ziehen über die Zeile malt weiter
        const v = was ? 0 : 1;
        setCell(i, s, v);
        move = (ev) => {
          const o = cellAt(ev.clientX, ev.clientY);
          if (o && Number(o.dataset.t) === i) setCell(i, Number(o.dataset.s), v, false);
        };
      }
      const up = () => {
        c.removeEventListener('pointermove', move);
        c.removeEventListener('pointerup', up);
        c.removeEventListener('pointercancel', up);
        if (tr.base && was && !moved) setCell(i, s, 0);
        if (JSON.stringify(st.pats) === undo[undo.length - 1]) undo.pop();
      };
      c.addEventListener('pointermove', move);
      c.addEventListener('pointerup', up);
      c.addEventListener('pointercancel', up);
    });
    rowsEl.addEventListener('wheel', (e) => {
      const c = e.target.closest('.beats-cell');
      if (!c) return;
      const i = Number(c.dataset.t), s = Number(c.dataset.s);
      if (!TRACKS[i].base || !pat()[i][s]) return;
      e.preventDefault();
      remember();
      setCell(i, s, clamp(pat()[i][s] + (e.deltaY < 0 ? 1 : -1), 1, NOTES));
    }, { passive: false });
    rowsEl.addEventListener('contextmenu', (e) => {
      const c = e.target.closest('.beats-cell');
      if (!c) return;
      const i = Number(c.dataset.t), s = Number(c.dataset.s);
      const tr = TRACKS[i];
      if (!tr.base) return;
      e.preventDefault();
      e.stopPropagation();
      const cur = pat()[i][s];
      menu([
        { heading: `${tr.name} · Schritt ${s + 1}` },
        ...Array.from({ length: NOTES }, (_, k) => NOTES - k).map((v) => ({ label: nameOf(tr, v), checked: cur === v, run: () => { remember(); setCell(i, s, v); } })),
        '-',
        { label: 'Aus', checked: !cur, run: () => { remember(); setCell(i, s, 0); } },
      ], { x: e.clientX, y: e.clientY });
    });

    let focus = [0, 0];
    function focusCell(i, s, really = false) {
      cells[focus[0]][focus[1]].tabIndex = -1;
      focus = [clamp(i, 0, N - 1), clamp(s, 0, STEPS - 1)];
      const c = cells[focus[0]][focus[1]];
      c.tabIndex = 0;
      if (really) c.focus({ preventScroll: true });
    }

    function applyPattern(p, text) {
      remember();
      st.pats[st.slot] = p;
      paintGrid();
      save();
      if (text) toast(win, text);
    }
    function loadPreset(preset) {
      st.bpm = preset.bpm;
      st.swing = preset.swing;
      sBpm.value = st.bpm;
      sSwing.value = st.swing;
      applyPattern(parse(preset.rows), `„${preset.name}“ in Muster ${SLOTS[st.slot]} geladen`);
      setTempo();
    }
    const randomize = () => applyPattern(randomPattern(), `Muster ${SLOTS[st.slot]} gewürfelt`);
    function clear() {
      if (!pat().some((row) => row.some(Boolean))) return;
      applyPattern(empty(), `Muster ${SLOTS[st.slot]} geleert`);
    }
    const copyItems = () => [{ heading: `Muster ${SLOTS[st.slot]} kopieren` }, ...SLOTS.map((n, k) => (k === st.slot ? null : {
      label: `Nach ${n}`, icon: 'copy', run: () => { remember(); st.pats[k] = pat().map((row) => [...row]); save(); toast(win, `Muster ${SLOTS[st.slot]} nach ${n} kopiert`); },
    })).filter(Boolean)];
    function undoLast() {
      const snap = undo.pop();
      if (!snap) { toast(win, 'Nichts zu widerrufen'); return; }
      st.pats = JSON.parse(snap);
      paintGrid();
      save();
    }
    function setTempo() {
      paintTop();
      if (G) G.delay.delayTime.setTargetAtTime(Math.min(1.1, stepDur() * 3), audio().ctx.currentTime, 0.05);
      if (playing) announce();
      save();
    }
    sBpm.addEventListener('input', (e) => { st.bpm = e.detail.value; setTempo(); });
    sSwing.addEventListener('input', (e) => { st.swing = e.detail.value; paintTop(); save(); });
    seg.addEventListener('change', (e) => {
      st.slot = Number(e.detail.value);
      if (!playing) playSlot = st.slot;
      paintGrid();
      paintTop();
      save();
    });
    const setSlot = (k) => { if (k !== st.slot) seg.select(k); };

    // ---------- Tastatur ----------
    const onKey = (e) => {
      if (e.target.closest('input, textarea, select') || e.altKey) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === ' ') { e.preventDefault(); toggle(); return; }
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undoLast(); return; }
      if (mod) return;
      const c = e.target.closest('.beats-cell');
      if (c) {
        const i = Number(c.dataset.t), s = Number(c.dataset.s);
        const tr = TRACKS[i];
        const v = pat()[i][s];
        const d = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
        if (d && e.shiftKey && tr.base && v) { e.preventDefault(); remember(); setCell(i, s, clamp(v - d[0] + d[1], 1, NOTES)); }
        else if (d) { e.preventDefault(); focusCell(i + d[0], s + d[1], true); }
        else if (e.key === 'Enter') { e.preventDefault(); remember(); setCell(i, s, v ? 0 : tr.base ? last[i] : 1); }
        else if ((e.key === '+' || e.key === '-') && tr.base && v) { e.preventDefault(); remember(); setCell(i, s, clamp(v + (e.key === '+' ? 1 : -1), 1, NOTES)); }
        else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); remember(); setCell(i, s, 0); }
        return;
      }
      if (e.target.closest('.gslider, .gseg, .beats-vol')) return;
      if (/^[1-4]$/.test(e.key)) setSlot(Number(e.key) - 1);
    };
    const onKeyUp = (e) => { if (e.key === ' ' && e.target.closest('button')) e.preventDefault(); };
    win.el.addEventListener('keydown', onKey);
    win.el.addEventListener('keyup', onKeyUp);

    paintGrid();
    paintMix();
    paintTop();

    return {
      onClose() {
        closed = true;
        stop();
        S.set('state', st);
        if (sys.nowPlaying?.app === 'beats') sys.media(null);
        if (G) {
          const { ctx } = audio();
          G.mix.gain.cancelScheduledValues(ctx.currentTime);
          G.mix.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
          const g = G;
          setTimeout(() => { try { g.mix.disconnect(); } catch { /* schon getrennt */ } }, 250);
          G = null;
        }
        win.el.removeEventListener('keydown', onKey);
        win.el.removeEventListener('keyup', onKeyUp);
      },
      onFocus() { if (!win.el.contains(document.activeElement)) bPlay.focus({ preventScroll: true }); },
      menus: () => [{
        label: 'Muster',
        items: [
          { label: playing ? 'Stopp' : 'Start', icon: playing ? 'stop' : 'play', hint: 'Leertaste', run: toggle },
          '-',
          ...SLOTS.map((n, k) => ({ label: `Muster ${n}`, checked: st.slot === k, hint: String(k + 1), run: () => setSlot(k) })),
          '-',
          ...copyItems().slice(1),
          '-',
          { label: 'Zufallsmuster', run: randomize },
          { label: 'Leeren', icon: 'eraser', run: clear },
          { label: 'Widerrufen', icon: 'undo', hint: '⌘Z', disabled: !undo.length, run: undoLast },
        ],
      }, {
        label: 'Vorlagen',
        items: PRESETS.map((p) => ({ label: p.name, hint: `${p.bpm} BPM`, run: () => loadPreset(p) })),
      }],
    };
  },
};
