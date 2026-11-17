// recorder.js — Sprachmemos: aufnehmen, anhören, benennen. Die Aufnahmen liegen in ~/Musik/Memos.

import { h, clamp, ticker, debounce } from '../../../core/util.js';
import { icon } from '../../../core/icons.js';
import { initControls } from '../../../core/controls.js';
import { audio } from '../../../core/audio.js';
import { sys } from '../../sys.js';
import { bus } from '../../bus.js';
import { vfs, HOME, extname } from '../../vfs.js';
import { openMenu } from '../../ui.js';
import { style, appStore, emptyState, toast, confirmSheet, promptSheet, download, readFile, timeAgo } from '../../kit.js';

const MUSIC = `${HOME}/Musik`;
const DIR = `${MUSIC}/Memos`;
const MAX = 180;                      // längste Aufnahme in Sekunden
const AUDIO_EXT = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3' };
const SPEEDS = [0.5, 1, 1.5, 2];

const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const fmtTenth = (sec) => `${fmt(sec)},${Math.floor((sec * 10) % 10)}`;
const stemOf = (name) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(0, i) : name; };
const isAudio = (st) => st.type === 'file' && ((st.mime || '').startsWith('audio/') || Object.values(AUDIO_EXT).includes(extname(st.path)));

/** Data-URL → Mono-Samples (über einen Offline-Kontext, braucht keine Nutzergeste). */
async function decode(dataURL) {
  const bin = atob(dataURL.slice(dataURL.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const buf = await new Offline(1, 1, 44100).decodeAudioData(bytes.buffer);
  const mono = new Float32Array(buf.length);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels;
  }
  return { mono, rate: buf.sampleRate, dur: buf.duration };
}
/** Mono-Samples als WAV: lässt sich im <audio>-Element punktgenau anspringen. */
function wavBlob(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0, o = 44; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
/** Ausschläge je Abschnitt (0…1), auf den lautesten Wert normiert. */
function peaksOf(samples, n = 600) {
  const out = new Array(n).fill(0);
  const step = samples.length / n;
  let top = 0.02;
  for (let i = 0; i < n; i++) {
    let m = 0;
    const a = Math.floor(i * step), b = Math.min(samples.length, Math.floor((i + 1) * step) + 1);
    for (let k = a; k < b; k += 3) { const v = Math.abs(samples[k]); if (v > m) m = v; }
    out[i] = m;
    if (m > top) top = m;
  }
  return out.map((v) => v / top);
}
const squeeze = (arr, n) => {
  if (arr.length <= n) return arr.map((v) => Number(v.toFixed(2)));
  const out = [];
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let k = Math.floor((i * arr.length) / n); k < Math.floor(((i + 1) * arr.length) / n); k++) m = Math.max(m, arr[k]);
    out.push(Number(m.toFixed(2)));
  }
  return out;
};

const svg = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const num15 = '<text x="12" y="15.400" text-anchor="middle" font-size="7.200" font-weight="700" font-family="ui-rounded, -apple-system, sans-serif" fill="currentColor" stroke="none">15</text>';
const IC = {
  back15: svg(`<path d="M5 12.500a7 7 0 1 0 2.300-5.200"/><path d="M4.500 4.500v3.800h3.800"/>${num15}`),
  fwd15: svg(`<path d="M19 12.500a7 7 0 1 1-2.300-5.200"/><path d="M19.500 4.500v3.800h-3.800"/>${num15}`),
  mic: svg('<rect x="9" y="3" width="6" height="11.500" rx="3"/><path d="M5.500 11.500a6.500 6.500 0 0 0 13 0M12 18v3M8.500 21h7"/>'),
};

style('recorder', `
.recorder-split { display: grid; grid-template-columns: 252px minmax(0, 1fr); flex: 1; min-height: 0; }
.recorder-list { display: flex; flex-direction: column; min-width: 0; min-height: 0; border-right: .5px solid var(--line); background: rgba(0, 0, 14, .1); }
.recorder-items { flex: 1; min-height: 0; padding: 6px 8px; display: grid; align-content: start; gap: 2px; }
.recorder-item { display: grid; gap: 1px; min-width: 0; padding: 8px 10px; border: 0; border-radius: 10px; background: none; text-align: left; }
.recorder-item b { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recorder-item span { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--fg-3); font-variant-numeric: tabular-nums; }
.recorder-item:hover { background: var(--raise); }
.recorder-item.is-on { background: var(--accent); color: #fff; }
.recorder-item.is-on span { color: rgba(255, 255, 255, .82); }
.recorder-none { padding: 14px 10px; font-size: 12.5px; color: var(--fg-3); text-wrap: pretty; }
.recorder-foot { display: grid; justify-items: center; gap: 5px; flex: none; padding: 12px 10px 13px; border-top: .5px solid var(--line); }
.recorder-foot span { font-size: 12px; font-weight: 600; color: var(--fg-3); font-variant-numeric: tabular-nums; }
.recorder-rec { position: relative; display: grid; place-items: center; width: 58px; height: 58px; padding: 0; border: 0; border-radius: 50%; background: none; box-shadow: inset 0 0 0 3px var(--fg-3); transition: transform .4s var(--spring); }
.recorder-rec::before { content: ""; width: 44px; height: 44px; border-radius: 50%; background: var(--c-coral); transition: width .35s var(--spring), height .35s var(--spring), border-radius .3s; }
.recorder-rec:hover { transform: scale(1.05); }
.recorder-rec:active { transform: scale(.93); }
.recorder-rec.is-rec::before { width: 22px; height: 22px; border-radius: 6px; }
.recorder-rec.is-wait::before { animation: recorder-blink .9s ease-in-out infinite; }
.recorder-rec.is-rec::after { content: ""; position: absolute; inset: -3px; border-radius: 50%; box-shadow: 0 0 0 2px var(--c-coral); opacity: 0; animation: recorder-ring 1.6s ease-out infinite; }
@keyframes recorder-ring { from { opacity: .7; scale: .92; } to { opacity: 0; scale: 1.25; } }

.recorder-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.recorder-back { display: none; }
.recorder-body { flex: 1; min-height: 0; display: flex; flex-direction: column; justify-content: center; gap: 14px; padding: 18px 22px 22px; }
.recorder-body > * { flex: none; }
.recorder-head { display: grid; gap: 2px; text-align: center; }
.recorder-head h2 { font-size: 22px; font-weight: 720; letter-spacing: -.02em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recorder-head span { font-size: 12.5px; color: var(--fg-3); }
.recorder-wave { display: block; width: 100%; height: 132px; flex: 0 1 132px; min-height: 56px; border-radius: 14px; background: var(--well); box-shadow: inset 0 0 0 .5px var(--line); outline: 0; touch-action: none; }
canvas.recorder-wave.is-seek { cursor: pointer; }
.recorder-wave:focus-visible { box-shadow: inset 0 0 0 1.5px var(--accent); }
.recorder-times { display: flex; justify-content: space-between; margin-top: -8px; font-size: 12px; color: var(--fg-3); font-variant-numeric: tabular-nums; }
.recorder-ctl { display: flex; align-items: center; justify-content: center; gap: 16px; }
.recorder-ctl .tool { width: 40px; height: 40px; border-radius: 50%; }
.recorder-ctl .tool .ico { width: 26px; height: 26px; stroke-width: 1.5; }
.recorder-play { display: grid; place-items: center; width: 54px; height: 54px; padding: 0; border: 0; border-radius: 50%; background: var(--fg); color: var(--solid); transition: transform .4s var(--spring); }
.recorder-play:hover:not(:disabled) { transform: scale(1.06); }
.recorder-play:active:not(:disabled) { transform: scale(.92); }
.recorder-play:disabled { opacity: .4; cursor: default; }
.recorder-play .ico { width: 24px; height: 24px; }
.recorder-speed { display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 12px; font-weight: 600; color: var(--fg-3); }
.recorder-speed .gseg button { padding: .35em .8em; font-size: 12px; font-variant-numeric: tabular-nums; }
.recorder-clock { text-align: center; font: 300 clamp(40px, 11cqw, 64px) / 1.1 var(--font-round); letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.recorder-state { display: flex; align-items: center; justify-content: center; gap: 7px; font-size: 12.5px; font-weight: 600; color: var(--fg-3); }
.recorder-state i { width: 9px; height: 9px; border-radius: 50%; background: var(--c-coral); animation: recorder-blink 1.2s ease-in-out infinite; }
.recorder-state.is-paused i { background: var(--fg-4); animation: none; }
@keyframes recorder-blink { 50% { opacity: .25; } }
.recorder-recbtns { display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; }
.recorder-msg { display: grid; place-content: center; justify-items: center; gap: 9px; flex: 1; padding: 26px; text-align: center; }
.recorder-msg .ico { width: 44px; height: 44px; stroke-width: 1.2; color: var(--fg-3); }
.recorder-msg b { font-size: 15px; }
.recorder-msg p { max-width: 30em; font-size: 12.5px; color: var(--fg-3); text-wrap: pretty; }
.recorder-msg .kit-btn { margin-top: 6px; }

@container win (max-width: 560px) {
  .recorder-split { grid-template-columns: minmax(0, 1fr); }
  .recorder-list { border-right: 0; }
  .recorder-split.show-main .recorder-list, .recorder-split:not(.show-main) .recorder-main { display: none; }
  .recorder-back { display: inline-grid; }
  .recorder-body { padding: 12px 16px 16px; gap: 11px; }
  .recorder-head h2 { font-size: 19px; }
}
`);

export default {
  singleton: true,
  width: 780, height: 520, minW: 360, minH: 420,

  mount(win) {
    const S = appStore('recorder');
    let meta = S.get('meta', {});
    let memos = [];
    let sel = null;                 // Pfad des gewählten Memos
    let closed = false;
    let colors = {};
    const saveMeta = () => S.set('meta', meta);
    const say = (text) => toast(win, text);

    // ---------- Gerüst ----------
    const countEl = h('span.kit-count');
    const items = h('div.recorder-items.scroll', { role: 'listbox', 'aria-label': 'Aufnahmen' });
    const recBtn = h('button.recorder-rec', { type: 'button', 'aria-label': 'Aufnahme starten', title: 'Aufnehmen' });
    const recLabel = h('span', 'Aufnehmen');
    const listPane = h('div.recorder-list', h('div.kit-bar', h('b.kit-title', 'Alle Aufnahmen'), h('span.sp'), countEl), items, h('div.recorder-foot', recBtn, recLabel));
    const mainPane = h('div.recorder-main');
    const split = h('div.recorder-split', listPane, mainPane);
    win.body.append(h('div.kit-app.recorder', split));
    const showMain = (on) => split.classList.toggle('show-main', on);
    const backBtn = () => h('button.tool.recorder-back', { type: 'button', 'aria-label': 'Zur Liste', title: 'Zur Liste', html: icon('chevronLeft'), onclick: () => { showMain(false); keepFocus(); } });
    const keepFocus = () => {
      const a = document.activeElement;
      if (sys.wm.focused === win && (!a || a === document.body || !a.isConnected || a.disabled || !a.offsetParent)) win.el.focus({ preventScroll: true });
    };
    const readColors = () => {
      const cs = getComputedStyle(win.el);
      colors = { accent: cs.getPropertyValue('--accent').trim() || '#ff6a3d', idle: cs.getPropertyValue('--fg-4').trim() || '#888', rec: cs.getPropertyValue('--c-coral').trim() || '#ff5d6c', fg: cs.getPropertyValue('--fg').trim() || '#fff' };
    };
    readColors();

    /** Canvas an seine Größe anpassen; ruft draw() bei jeder Änderung. */
    const observers = [];
    function fit(cv, draw) {
      const ro = new ResizeObserver(() => {
        const dpr = Math.min(2, devicePixelRatio || 1);
        cv.width = Math.max(1, Math.round(cv.clientWidth * dpr));
        cv.height = Math.max(1, Math.round(cv.clientHeight * dpr));
        cv._dpr = dpr;
        draw();
      });
      ro.observe(cv);
      observers.push(ro);
      return ro;
    }
    const bars = (c, list, W, H, x0, color) => {
      c.fillStyle = color;
      c.beginPath();
      for (const [i, v] of list) {
        const hh = Math.max(2, v * (H - 14));
        c.roundRect(x0 + i * 3, (H - hh) / 2, 2, hh, 1);
      }
      c.fill();
    };

    // ======================================================================
    // Liste
    // ======================================================================
    function scan() {
      let list = [];
      try { list = vfs.list(DIR).filter(isAudio); } catch { /* Ordner gibt es noch nicht */ }
      memos = list.map((st) => ({ ...st, title: stemOf(st.name), created: meta[st.path]?.created || st.mtime, dur: meta[st.path]?.dur ?? null }))
        .sort((a, b) => b.created - a.created);
    }
    function paintList() {
      countEl.textContent = memos.length ? String(memos.length) : '';
      if (!memos.length) { items.replaceChildren(h('div.recorder-none', 'Noch keine Aufnahmen. Der rote Knopf startet dein erstes Sprachmemo.')); return; }
      items.replaceChildren(...memos.map((m) => {
        const b = h('button.recorder-item', { type: 'button', role: 'option', class: m.path === sel ? 'is-on' : '', 'aria-selected': String(m.path === sel), dataset: { path: m.path } },
          h('b', m.title), h('span', h('i', { style: { fontStyle: 'normal' } }, timeAgo(m.created)), h('i', { style: { fontStyle: 'normal' } }, m.dur != null ? fmt(m.dur) : '–:––')));
        b.addEventListener('click', () => select(m.path, true));
        b.addEventListener('dblclick', () => { select(m.path, true).then(() => { if (P.path === m.path && P.ready && P.el.paused) togglePlay(); }); });
        b.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openMenu([
            { label: 'Anhören', icon: 'play', run: () => select(m.path, true).then(() => { if (P.path === m.path && P.ready && P.el.paused) togglePlay(); }) },
            { label: 'Umbenennen …', icon: 'note', run: () => rename(m.path) },
            { label: 'Exportieren', icon: 'download', run: () => exportMemo(m.path) },
            '-',
            { label: 'In den Papierkorb', icon: 'trash', run: () => remove(m.path) },
          ], { x: e.clientX, y: e.clientY, onClose: () => setTimeout(() => { if (!closed) keepFocus(); }, 0) });
        });
        return b;
      }));
      keepFocus();
    }

    // ======================================================================
    // Anhören
    // ======================================================================
    const P = { path: null, el: null, url: '', node: null, peaks: [], dur: 0, rate: Number(S.get('speed', 1)) || 1, token: 0, ready: false, loading: null };
    const dTitle = h('h2');
    const dSub = h('span');
    const wave = h('canvas.recorder-wave.is-seek', { tabIndex: 0, role: 'slider', 'aria-label': 'Position in der Aufnahme' });
    const tCur = h('span', '0:00'), tDur = h('span', '0:00');
    const bPlay = h('button.recorder-play', { type: 'button', disabled: true, onclick: () => togglePlay() });
    const speed = h('div.gseg', { 'aria-label': 'Geschwindigkeit' }, SPEEDS.map((v) => h('button', { type: 'button', dataset: { value: v }, 'aria-selected': String(v === P.rate) }, `${String(v).replace('.', ',')}×`)));
    const detail = h('div.recorder-detail', { style: { display: 'contents' } },
      h('div.kit-bar', backBtn(), h('span.sp'),
        h('button.tool', { type: 'button', 'aria-label': 'Umbenennen', title: 'Umbenennen', html: icon('note'), onclick: () => sel && rename(sel) }),
        h('button.tool', { type: 'button', 'aria-label': 'Exportieren', title: 'Auf das Gerät exportieren', html: icon('download'), onclick: () => sel && exportMemo(sel) }),
        h('button.tool', { type: 'button', 'aria-label': 'In den Papierkorb', title: 'In den Papierkorb', html: icon('trash'), onclick: () => sel && remove(sel) })),
      h('div.recorder-body',
        h('div.recorder-head', dTitle, dSub), wave, h('div.recorder-times', tCur, tDur),
        h('div.recorder-ctl',
          h('button.tool', { type: 'button', 'aria-label': '15 Sekunden zurück', title: '15 Sekunden zurück (←)', html: IC.back15, onclick: () => skip(-15) }),
          bPlay,
          h('button.tool', { type: 'button', 'aria-label': '15 Sekunden vor', title: '15 Sekunden vor (→)', html: IC.fwd15, onclick: () => skip(15) })),
        h('div.recorder-speed', h('span', 'Tempo'), speed)));
    initControls(detail);
    speed.addEventListener('change', (e) => {
      P.rate = Number(e.detail.value) || 1;
      S.set('speed', P.rate);
      if (P.el) P.el.playbackRate = P.rate;
    });

    const pos = () => (P.el ? Math.min(P.dur, P.el.currentTime || 0) : 0);
    function drawWave() {
      const c = wave.getContext('2d');
      const dpr = wave._dpr || 1;
      const W = wave.width / dpr, H = wave.height / dpr;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, W, H);
      const pad = 10;
      const n = Math.max(4, Math.floor((W - pad * 2) / 3));
      const src = P.peaks;
      const prog = P.dur ? clamp(pos() / P.dur) : 0;
      if (src.length) {
        const done = [], rest = [];
        for (let i = 0; i < n; i++) {
          let m = 0;
          const a = Math.floor((i * src.length) / n), b = Math.max(a + 1, Math.floor(((i + 1) * src.length) / n));
          for (let k = a; k < b; k++) m = Math.max(m, src[k]);
          (i / n < prog ? done : rest).push([i, Math.pow(m, 0.8)]);
        }
        bars(c, rest, W, H, pad, colors.idle);
        bars(c, done, W, H, pad, colors.accent);
      }
      if (P.dur) {
        const x = pad + prog * (n * 3 - 1);
        c.fillStyle = colors.fg;
        c.fillRect(x - 0.75, 6, 1.5, H - 12);
        c.beginPath(); c.arc(x, 6, 3.5, 0, Math.PI * 2); c.fill();
      }
    }
    fit(wave, drawWave);
    function paintPos() {
      const p = pos();
      const txt = fmt(p);
      if (tCur.textContent !== txt) { tCur.textContent = txt; wave.setAttribute('aria-valuenow', Math.round(p)); wave.setAttribute('aria-valuetext', `${txt} von ${fmt(P.dur)}`); }
      drawWave();
    }
    function paintPlay() {
      const playing = !!P.el && !P.el.paused;
      bPlay.innerHTML = icon(playing ? 'pause' : 'play');
      bPlay.setAttribute('aria-label', playing ? 'Pause' : 'Anhören');
      bPlay.title = playing ? 'Pause (Leertaste)' : 'Anhören (Leertaste)';
      bPlay.disabled = !P.ready;
    }
    const playFrame = () => { if (!win.min) paintPos(); };

    function unload() {
      P.token++;
      ticker.remove(playFrame);
      if (P.el) {
        P.el.pause();
        P.el.onended = P.el.onplay = P.el.onpause = null;
        P.el.removeAttribute('src');
        P.el.load();
      }
      try { P.node?.disconnect(); } catch { /* schon getrennt */ }
      if (P.url) URL.revokeObjectURL(P.url);
      Object.assign(P, { path: null, el: null, url: '', node: null, peaks: [], dur: 0, ready: false });
    }

    /** Memo wählen: Wellenform aus den Samples rechnen und zum Abspielen vorbereiten. */
    function select(path, focusMain = false) {
      if (R.on) return Promise.resolve();
      if (path === P.path) { if (focusMain) { paintMain(); showMain(true); } return P.loading || Promise.resolve(); }
      P.loading = load(path, focusMain);
      return P.loading;
    }
    async function load(path, focusMain) {
      unload();
      sel = path;
      const m = memos.find((x) => x.path === path);
      if (!m) { paintList(); paintMain(); return; }
      P.path = path;
      P.peaks = meta[path]?.peaks || [];
      P.dur = m.dur || 0;
      const my = P.token;
      paintList();
      paintMain();
      if (focusMain) showMain(true);
      let data = '';
      try { data = vfs.read(path); } catch { return; }
      const el = new Audio();
      el.preload = 'auto';
      try {
        const { mono, rate, dur } = await decode(data);
        if (my !== P.token) return;
        P.peaks = peaksOf(mono);
        P.dur = dur;
        P.url = URL.createObjectURL(wavBlob(mono, rate));
        el.src = P.url;
        if (!meta[path] || Math.abs((meta[path].dur || 0) - dur) > 0.05 || !meta[path].peaks) {
          meta[path] = { created: m.created, ...meta[path], dur, peaks: squeeze(P.peaks, 120) };
          saveMeta();
          m.dur = dur;
          paintList();
        }
      } catch {
        // Format lässt sich nicht dekodieren: direkt abspielen, Wellenform aus der Aufnahme (falls vorhanden)
        if (my !== P.token) return;
        el.src = data;
      }
      el.playbackRate = P.rate;
      if ('preservesPitch' in el) el.preservesPitch = true;
      el.onended = () => { el.currentTime = 0; ticker.remove(playFrame); paintPlay(); paintPos(); };
      el.onplay = el.onpause = () => paintPlay();
      P.el = el;
      P.ready = true;
      tDur.textContent = fmt(P.dur);
      wave.setAttribute('aria-valuemax', Math.round(P.dur));
      dSub.textContent = subText(m);
      paintPlay();
      paintPos();
    }
    const subText = (m) => `${new Date(m.created).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })} · ${fmt(P.dur || m.dur || 0)}`;

    async function togglePlay() {
      if (!P.el || R.on) return;
      if (!P.el.paused) { P.el.pause(); ticker.remove(playFrame); paintPos(); return; }
      try {
        if (!P.node) {
          // erst jetzt (Nutzergeste) an den gemeinsamen Ausgang hängen
          const { ctx, out } = audio();
          P.node = ctx.createMediaElementSource(P.el);
          P.node.connect(out);
        } else audio();
        await P.el.play();
        ticker.add(playFrame);
      } catch (err) { say(`Wiedergabe nicht möglich: ${err?.message || err}`); }
      paintPlay();
    }
    function seekTo(sec) {
      if (!P.el || !P.dur) return;
      P.el.currentTime = clamp(sec, 0, Math.max(0, P.dur - 0.01));
      paintPos();
    }
    const skip = (d) => seekTo(pos() + d);
    wave.addEventListener('pointerdown', (e) => {
      if (!P.ready || (e.button && e.pointerType === 'mouse')) return;
      wave.setPointerCapture(e.pointerId);
      const at = (ev) => { const r = wave.getBoundingClientRect(); seekTo(clamp((ev.clientX - r.left - 10) / (r.width - 20)) * P.dur); };
      at(e);
      const up = () => { wave.removeEventListener('pointermove', at); wave.removeEventListener('pointerup', up); wave.removeEventListener('pointercancel', up); };
      wave.addEventListener('pointermove', at);
      wave.addEventListener('pointerup', up);
      wave.addEventListener('pointercancel', up);
    });
    wave.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 5, ArrowLeft: -5 }[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      skip(d);
    });

    // ---------- Aktionen ----------
    async function rename(path) {
      const m = memos.find((x) => x.path === path);
      if (!m) return;
      const name = await promptSheet(win, { title: 'Aufnahme umbenennen', value: m.title, ok: 'Umbenennen' });
      keepFocus();
      if (!name || name === m.title) return;
      try {
        const ext = extname(path);
        const to = `${DIR}/${name}${ext ? `.${ext}` : ''}`;
        if (vfs.exists(to)) throw new Error('Diesen Namen gibt es schon');
        meta[to] = { created: m.created, ...meta[path] };
        delete meta[path];
        saveMeta();
        if (sel === path) sel = to;
        if (P.path === path) P.path = to;
        vfs.move(path, to);
      } catch (err) { say(`Umbenennen nicht möglich: ${err.message}`); }
    }
    function exportMemo(path) {
      try {
        const st = vfs.stat(path);
        download(st.name, vfs.read(path), st.mime);
        say(`„${st.name}“ exportiert`);
      } catch (err) { say(`Export nicht möglich: ${err.message}`); }
    }
    function remove(path) {
      try {
        if (P.path === path) unload();
        if (sel === path) {
          const i = memos.findIndex((m) => m.path === path);
          sel = (memos[i + 1] || memos[i - 1])?.path || null;
        }
        vfs.trash(path);
        delete meta[path];
        saveMeta();
        say('In den Papierkorb gelegt');
      } catch (err) { say(`Löschen nicht möglich: ${err.message}`); }
    }

    // ======================================================================
    // Aufnehmen
    // ======================================================================
    const R = { on: false, paused: false, stream: null, rec: null, chunks: [], src: null, an: null, buf: null, base: 0, t0: 0, levels: [], lastLv: 0, peak: 0, timer: 0, discard: false, mime: '', mute: null };
    const rClock = h('div.recorder-clock', '0:00,0');
    const rState = h('div.recorder-state', h('i'), h('span', 'Aufnahme läuft'));
    const rWave = h('canvas.recorder-wave', { 'aria-hidden': 'true' });
    const bPause = h('button.kit-btn.big.round', { type: 'button', onclick: () => pauseRec() });
    const bDone = h('button.kit-btn.big.round.primary', { type: 'button', onclick: () => stopRec(false) }, 'Fertig');
    const bDrop = h('button.kit-btn.big.round', { type: 'button', onclick: () => dropRec() }, 'Verwerfen');
    const recView = h('div', { style: { display: 'contents' } },
      h('div.kit-bar', backBtn(), h('b.kit-title', 'Neue Aufnahme'), h('span.sp')),
      h('div.recorder-body', rClock, rState, rWave, h('div.recorder-recbtns', bDrop, bPause, bDone)));
    const elapsed = () => (R.on && !R.paused ? R.base + (performance.now() - R.t0) / 1000 : R.base);

    function drawLive() {
      const c = rWave.getContext('2d');
      const dpr = rWave._dpr || 1;
      const W = rWave.width / dpr, H = rWave.height / dpr;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, W, H);
      const n = Math.floor((W - 20) / 3);
      const from = Math.max(0, R.levels.length - n);
      const list = [];
      for (let i = from; i < R.levels.length; i++) list.push([n - (R.levels.length - i), R.levels[i]]);
      bars(c, list, W, H, 10, R.paused ? colors.idle : colors.rec);
      c.fillStyle = colors.idle;
      c.fillRect(10, H / 2 - 0.5, Math.max(0, (n - list.length) * 3 - 2), 1);
    }
    fit(rWave, drawLive);
    const recFrame = () => {
      if (!R.on) return;
      const now = performance.now();
      if (!R.paused && R.an) {
        R.an.getFloatTimeDomainData(R.buf);
        let m = 0;
        for (let i = 0; i < R.buf.length; i += 2) { const v = Math.abs(R.buf[i]); if (v > m) m = v; }
        R.peak = Math.max(R.peak, m);
        if (now - R.lastLv >= 50) {
          R.levels.push(clamp(Math.pow(R.peak * 2.4, 0.7), 0.03, 1));
          R.peak = 0;
          R.lastLv = now;
        }
      }
      if (win.min) return;
      const t = elapsed();
      rClock.textContent = fmtTenth(t);
      drawLive();
    };
    function paintRec() {
      recBtn.classList.toggle('is-rec', R.on);
      recBtn.setAttribute('aria-label', R.on ? 'Aufnahme beenden und sichern' : 'Aufnahme starten');
      recBtn.title = R.on ? 'Fertig' : 'Aufnehmen';
      bPause.textContent = R.paused ? 'Fortsetzen' : 'Pause';
      rState.classList.toggle('is-paused', R.paused);
      const t = elapsed();
      rState.lastChild.textContent = R.paused ? 'Pausiert' : t > MAX - 30 ? `Noch ${fmt(Math.max(0, MAX - t))}` : 'Aufnahme läuft';
      recLabel.textContent = R.on ? (R.paused ? `Pausiert · ${fmt(t)}` : fmt(t)) : 'Aufnehmen';
    }

    function releaseMic() {
      clearInterval(R.timer);
      ticker.remove(recFrame);
      for (const n of [R.src, R.an, R.mute]) { try { n?.disconnect(); } catch { /* schon getrennt */ } }
      if (R.stream) for (const t of R.stream.getTracks()) t.stop();
      R.stream = R.src = R.an = R.mute = null;
    }
    function micError(err) {
      const name = err?.name || '';
      const [title, text] = name === 'insecure' ? ['Hier geht das Mikrofon nicht', 'Browser geben das Mikrofon nur auf sicheren Seiten frei. Öffne fableOS über https oder localhost.']
        : name === 'unsupported' ? ['Aufnehmen wird nicht unterstützt', 'Dieser Browser kann keinen Ton aufzeichnen. Vorhandene Memos kannst du trotzdem anhören.']
          : name === 'NotAllowedError' || name === 'SecurityError' ? ['Kein Zugriff auf das Mikrofon', 'Erlaube den Zugriff über das Mikrofon-Symbol in der Adressleiste deines Browsers und versuch es noch einmal. Aufnahmen bleiben auf diesem Gerät.']
            : name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError' ? ['Kein Mikrofon gefunden', 'Schließ ein Mikrofon an oder prüfe, ob es in den Systemeinstellungen aktiv ist.']
              : name === 'NotReadableError' || name === 'AbortError' ? ['Das Mikrofon ist gerade belegt', 'Vermutlich nutzt es eine andere App. Schließ sie und versuch es erneut.']
                : ['Die Aufnahme startet nicht', String(err?.message || err || 'Unbekannter Fehler')];
      const retry = name !== 'insecure' && name !== 'unsupported';
      mainPane.replaceChildren(h('div.kit-bar', backBtn(), h('span.sp')), h('div.recorder-msg', { role: 'alert' }, h('i', { html: IC.mic, style: { display: 'grid' } }), h('b', title), h('p', text),
        retry ? h('button.kit-btn.primary', { type: 'button', onclick: () => startRec() }, 'Erneut versuchen') : h('button.kit-btn', { type: 'button', onclick: () => { paintMain(); keepFocus(); } }, 'OK')));
      showMain(true);
      keepFocus();
    }

    let starting = false;
    async function startRec() {
      if (R.on || starting || closed) return;
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { micError({ name: 'insecure' }); return; }
      if (typeof MediaRecorder === 'undefined') { micError({ name: 'unsupported' }); return; }
      starting = true;
      recBtn.classList.add('is-wait');
      recLabel.textContent = 'Mikrofon startet …';
      if (P.el && !P.el.paused) { P.el.pause(); ticker.remove(playFrame); }
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
        if (closed) { for (const t of stream.getTracks()) t.stop(); return; }
        const want = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t));
        const rec = new MediaRecorder(stream, { ...(want ? { mimeType: want } : {}), audioBitsPerSecond: 48000 });
        Object.assign(R, { on: true, paused: false, stream, rec, chunks: [], base: 0, t0: performance.now(), levels: [], lastLv: 0, peak: 0, discard: false, mime: (rec.mimeType || want || 'audio/webm').split(';')[0] });
        rec.ondataavailable = (e) => { if (e.data?.size) R.chunks.push(e.data); };
        rec.onstop = () => finishRec();
        rec.onerror = () => { say('Die Aufnahme wurde unterbrochen'); stopRec(false); };
        rec.start(1000);
        try {
          const { ctx, out } = audio();
          R.src = ctx.createMediaStreamSource(stream);
          R.an = ctx.createAnalyser();
          R.an.fftSize = 1024;
          R.buf = new Float32Array(R.an.fftSize);
          R.mute = ctx.createGain();
          R.mute.gain.value = 0;                  // nur messen – das Mikrofon kommt nicht auf die Lautsprecher
          R.src.connect(R.an);
          R.an.connect(R.mute);
          R.mute.connect(out);
        } catch { R.an = null; }
        R.timer = setInterval(() => {
          paintRec();
          if (elapsed() >= MAX) { say('Maximale Länge erreicht – die Aufnahme wird gesichert'); stopRec(false); }
        }, 250);
        ticker.add(recFrame);
        mainPane.replaceChildren(recView);
        showMain(true);
        paintRec();
        paintList();
        keepFocus();
      } catch (err) {
        if (stream) for (const t of stream.getTracks()) t.stop();
        if (!closed) micError(err);
      } finally {
        starting = false;
        recBtn.classList.remove('is-wait');
        if (!closed) paintRec();
      }
    }
    function pauseRec() {
      if (!R.on || !R.rec) return;
      try {
        if (R.paused) { R.rec.resume(); R.t0 = performance.now(); R.paused = false; }
        else { R.base = elapsed(); R.rec.pause(); R.paused = true; }
      } catch { /* Zustand passt nicht – ignorieren */ }
      paintRec();
      drawLive();
    }
    function stopRec(discard) {
      if (!R.on) return;
      R.base = elapsed();
      R.on = false;
      R.paused = false;
      R.discard = discard;
      const rec = R.rec;
      try { if (rec && rec.state !== 'inactive') rec.stop(); else finishRec(); } catch { finishRec(); }
      releaseMic();
      if (!closed) { paintRec(); paintMain(); keepFocus(); }
    }
    async function dropRec() {
      if (!R.on) return;
      if (elapsed() > 3 && !(await confirmSheet(win, { title: 'Aufnahme verwerfen?', text: 'Das Memo wird nicht gesichert.', ok: 'Verwerfen', danger: true }))) { keepFocus(); return; }
      stopRec(true);
    }
    /** MediaRecorder hat alles abgeliefert: als Data-URL ins Dateisystem schreiben. */
    async function finishRec() {
      const { chunks, mime, discard, base: dur, levels } = R;
      R.rec = null;
      R.chunks = [];
      if (discard || !chunks.length || dur < 0.3) { if (!discard && !closed) say('Die Aufnahme war zu kurz'); return; }
      try {
        const data = await readFile(new Blob(chunks, { type: mime }));
        if (!vfs.exists(MUSIC)) vfs.mkdir(MUSIC);
        if (!vfs.exists(DIR)) vfs.mkdir(DIR);
        const path = `${DIR}/${vfs.unique(DIR, `Neue Aufnahme.${AUDIO_EXT[mime] || 'webm'}`)}`;
        meta[path] = { dur, created: Date.now(), peaks: squeeze(levels, 120) };
        saveMeta();
        vfs.write(path, data, mime);
        if (closed) return;
        scan();
        say('Aufnahme gesichert');
        await select(path);
      } catch (err) {
        if (!closed) say(`Die Aufnahme ließ sich nicht sichern: ${err?.message || err}`);
      }
    }
    recBtn.addEventListener('click', () => { if (R.on) stopRec(false); else startRec(); });

    // ======================================================================
    // Hauptbereich: Aufnahme, Detail oder Leerzustand
    // ======================================================================
    function paintMain() {
      if (R.on) { if (recView.parentNode !== mainPane) mainPane.replaceChildren(recView); return; }
      const m = memos.find((x) => x.path === sel);
      if (!m) {
        mainPane.replaceChildren(h('div.kit-bar', backBtn(), h('span.sp')), emptyState('wave', memos.length ? 'Wähle eine Aufnahme' : 'Noch keine Sprachmemos', memos.length ? 'Links findest du alle Memos.' : 'Starte mit dem roten Knopf deine erste Aufnahme – sie bleibt auf diesem Gerät.'));
        return;
      }
      if (detail.parentNode !== mainPane) mainPane.replaceChildren(detail);
      dTitle.textContent = m.title;
      dSub.textContent = subText(m);
      tDur.textContent = fmt(P.dur || m.dur || 0);
      paintPlay();
      paintPos();
    }

    const reload = () => {
      if (closed) return;
      scan();
      if (sel && !memos.some((m) => m.path === sel)) { if (P.path === sel) unload(); sel = null; }
      if (P.path && !vfs.exists(P.path)) unload();
      if (sel && P.path !== sel && !R.on) { select(sel); keepFocus(); return; }
      paintList();
      if (!R.on) paintMain();
      keepFocus();
    };
    const offFs = bus.on('fs', debounce(reload, 80));
    const offFull = bus.on('fs:full', () => { if (!closed) say('Der Speicher ist voll – lösche ältere Memos'); });
    const offSet = bus.on('setting', (key) => { if (key === 'theme' || key === 'accent') requestAnimationFrame(() => { readColors(); drawWave(); drawLive(); }); });

    // ---------- Tastatur ----------
    const onKey = (e) => {
      if (e.target.closest('input, textarea, select') || e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key === ' ') { e.preventDefault(); if (R.on) pauseRec(); else togglePlay(); return; }
      if (e.target.closest('.gseg, canvas')) return;
      if (R.on) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); skip(15); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); skip(-15); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!memos.length) return;
        e.preventDefault();
        const i = memos.findIndex((m) => m.path === sel);
        const next = memos[clamp(i < 0 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1), 0, memos.length - 1)];
        select(next.path);
        items.querySelector('.is-on')?.scrollIntoView({ block: 'nearest' });
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); remove(sel); }
      else if (e.key === 'F2' && sel) rename(sel);
    };
    const onKeyUp = (e) => { if (e.key === ' ' && e.target.closest('button')) e.preventDefault(); };
    win.el.addEventListener('keydown', onKey);
    win.el.addEventListener('keyup', onKeyUp);

    // ---------- Start ----------
    for (const p of Object.keys(meta)) if (!vfs.exists(p)) delete meta[p];
    scan();
    paintList();
    paintRec();
    paintMain();
    if (memos.length) select(memos[0].path);

    return {
      onClose() {
        closed = true;
        if (R.on) stopRec(false);          // nichts verlieren: laufende Aufnahme wird noch gesichert
        releaseMic();
        unload();
        for (const ro of observers) ro.disconnect();
        offFs();
        offFull();
        offSet();
        win.el.removeEventListener('keydown', onKey);
        win.el.removeEventListener('keyup', onKeyUp);
      },
      onFocus() { if (!win.el.contains(document.activeElement)) win.el.focus({ preventScroll: true }); },
      menus: () => {
        const playing = !!P.el && !P.el.paused;
        return [{
          label: 'Aufnahme',
          items: [
            R.on ? { label: 'Fertig – Aufnahme sichern', icon: 'stop', run: () => stopRec(false) } : { label: 'Neue Aufnahme', icon: 'plus', run: () => startRec() },
            { label: R.paused ? 'Fortsetzen' : 'Pause', disabled: !R.on, hint: R.on ? 'Leertaste' : '', run: () => pauseRec() },
            '-',
            { label: playing ? 'Pause' : 'Anhören', icon: playing ? 'pause' : 'play', hint: R.on ? '' : 'Leertaste', disabled: !P.ready || R.on, run: () => togglePlay() },
            { label: '15 Sekunden zurück', hint: '←', disabled: !P.ready || R.on, run: () => skip(-15) },
            { label: '15 Sekunden vor', hint: '→', disabled: !P.ready || R.on, run: () => skip(15) },
            '-',
            { label: 'Umbenennen …', icon: 'note', disabled: !sel || R.on, run: () => rename(sel) },
            { label: 'Exportieren', icon: 'download', disabled: !sel, run: () => exportMemo(sel) },
            { label: 'In den Papierkorb', icon: 'trash', hint: '⌫', disabled: !sel || R.on, run: () => remove(sel) },
          ],
        }];
      },
    };
  },
};
