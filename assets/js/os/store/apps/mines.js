// mines.js — Minenfeld: Felder aufdecken, ohne eine Mine zu treffen – drei Größen, Fahnen, Bestzeiten

import { h, clamp, rand, pick, TAU, ticker, reducedMotion } from '../../../core/util.js';
import { icon } from '../../../core/icons.js';
import { initControls } from '../../../core/controls.js';
import { tone, sfx, audioReady } from '../../../core/audio.js';
import { style, appStore } from '../../kit.js';

// ==========================================================================
// Logik ohne DOM. Felder sind zeilenweise durchnummeriert.
// ==========================================================================
export function minesCore(cols, rows, count) {
  const n = cols * rows;
  const mine = new Uint8Array(n), num = new Uint8Array(n), open = new Uint8Array(n), flag = new Uint8Array(n);
  const near = Array.from({ length: n }, (_, i) => {
    const x = i % cols, y = (i / cols) | 0, out = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((dx || dy) && nx >= 0 && ny >= 0 && nx < cols && ny < rows) out.push(ny * cols + nx);
      }
    }
    return out;
  });
  const S = { placed: false, opened: 0, flags: 0 };

  /** Verteilt die Minen – das erste Feld und seine Nachbarn bleiben frei, so öffnet der erste Klick eine Fläche. */
  function place(safe) {
    const banned = new Set([safe, ...near[safe]]);
    const pool = [];
    for (let i = 0; i < n; i++) if (!banned.has(i)) pool.push(i);
    for (let k = 0; k < count && k < pool.length; k++) {
      const j = k + ((Math.random() * (pool.length - k)) | 0);
      [pool[k], pool[j]] = [pool[j], pool[k]];
      mine[pool[k]] = 1;
    }
    for (let i = 0; i < n; i++) num[i] = near[i].reduce((s, j) => s + mine[j], 0);
    S.placed = true;
  }

  /** Deckt ein Feld auf (leere Flächen breiten sich aus). Liefert die neu offenen Felder oder null bei einer Mine. */
  function reveal(i) {
    if (open[i] || flag[i]) return [];
    if (!S.placed) place(i);
    if (mine[i]) return null;
    const out = [i];
    open[i] = 1;
    for (let k = 0; k < out.length; k++) {
      const c = out[k];
      if (num[c]) continue;
      for (const j of near[c]) if (!open[j] && !flag[j]) { open[j] = 1; out.push(j); }
    }
    S.opened += out.length;
    return out;
  }

  /** Klick auf eine offene Zahl: stimmt die Zahl der Fahnen ringsum, werden die übrigen Nachbarn aufgedeckt. */
  function chord(i) {
    if (!open[i] || !num[i]) return { cells: [], hit: -1, ready: false };
    if (near[i].filter((j) => flag[j]).length !== num[i]) return { cells: [], hit: -1, ready: false };
    const targets = near[i].filter((j) => !open[j] && !flag[j]);
    const boom = targets.find((j) => mine[j]);
    if (boom !== undefined) return { cells: [], hit: boom, ready: true };
    const cells = [];
    for (const j of targets) cells.push(...reveal(j));
    return { cells, hit: -1, ready: true };
  }

  function toggleFlag(i) {
    if (open[i]) return false;
    flag[i] ^= 1;
    S.flags += flag[i] ? 1 : -1;
    return true;
  }

  return {
    cols, rows, count, n, mine, num, open, flag, near, place, reveal, chord, toggleFlag,
    get placed() { return S.placed; },
    get flags() { return S.flags; },
    get won() { return S.placed && S.opened === n - count; },
  };
}

// ==========================================================================
// Oberfläche
// ==========================================================================
const SIZES = [
  { id: 'klein', name: 'Klein', cols: 9, rows: 9, mines: 10, cell: 38 },
  { id: 'mittel', name: 'Mittel', cols: 16, rows: 16, mines: 40, cell: 30 },
  { id: 'gross', name: 'Groß', cols: 30, rows: 16, mines: 99, cell: 28 },
];
const GAP = 2, PAD = 14;
const CONFETTI = ['#ffb65c', '#ff5d6c', '#a06bff', '#45c8ff', '#3fe0b0', '#ffffff'];

// eigene Zeichen: Mine (Kugel mit acht Zündern) und Fahne (Wimpel am Mast)
const MINE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.500v17M3.500 12h17M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round"/><circle cx="12" cy="12" r="5.800" fill="currentColor"/><circle class="hl" cx="10" cy="10" r="1.700"/></svg>';
const FLAG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.500 5.200c3.600-1.700 5.700 1.700 10 .2v7.300c-4.300 1.500-6.400-1.900-10-.2z" class="pn"/><path d="M8 4v16.500M5.200 20.500h5.600" fill="none" stroke="currentColor" stroke-width="2.100" stroke-linecap="round"/></svg>';
const CLOCK = icon('clock');
const fmtLive = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtBest = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0').replace('.', ',')} min` : `${s.toFixed(1).replace('.', ',')} s`);

style('mines', `
.mines { display: flex; flex-direction: column; flex: 1; min-height: 0; --m1: #6cb8ff; --m2: #5fe0a0; --m3: #ff7d8a; --m4: #b79bff; --m5: #ffb65c; --m6: #4fd8e0; --m7: #f4f6ff; --m8: #a9afca; --m-ink: #f4f6ff; }
[data-theme="light"] .mines { --m1: #1f6fe0; --m2: #0f8a52; --m3: #d92b45; --m4: #6a3fd0; --m5: #b56200; --m6: #0a8691; --m7: #1c2040; --m8: #6b718c; --m-ink: #1c2040; }
.mines-top { display: flex; align-items: center; gap: 8px; flex: none; padding: 12px 14px 0; }
.mines-top .sp { flex: 1; }
.mines-top .gseg { flex: none; }
.mines-top .gseg button { padding: .42em .85em; font-size: 12.5px; }
.mines-stat { display: inline-flex; align-items: center; justify-content: center; gap: 5px; flex: none; min-width: 58px; height: 30px; padding: 0 9px; border-radius: 10px; background: var(--well); box-shadow: inset 0 0 0 .5px var(--line); font: 650 14.500px/1 var(--font-round); font-variant-numeric: tabular-nums; }
.mines-stat svg { width: 15px; height: 15px; flex: none; }
.mines-stat .ico { color: var(--fg-3); }
.mines svg .pn { fill: var(--c-coral); }
.mines .tool.is-on svg .pn { fill: #fff; }
.mines svg .hl { fill: #fff; opacity: .75; }
.mines-area { position: relative; display: flex; flex: 1; min-height: 0; }
.mines-stage { display: flex; flex: 1; min-width: 0; padding: ${PAD}px; }
.mines-grid { display: grid; grid-template-columns: repeat(var(--cols), var(--cell)); grid-auto-rows: var(--cell); gap: ${GAP}px; flex: none; margin: auto; outline: 0; touch-action: manipulation; }
.mines-grid.is-shake { animation: mines-shake .45s; }
@keyframes mines-shake { 15% { transform: translate(-5px, 2px); } 35% { transform: translate(5px, -3px); } 55% { transform: translate(-3px, 1px); } 75% { transform: translate(2px, -1px); } }
.mines-c { position: relative; display: grid; place-items: center; border-radius: calc(var(--cell) * .2); background-color: var(--raise-2); box-shadow: inset 0 1px 0 rgba(255, 255, 255, .22), inset 0 0 0 .5px var(--line); color: var(--m-ink); font: 800 calc(var(--cell) * .56)/1 var(--font-round); cursor: pointer; transition: transform .3s var(--spring), filter .15s; }
[data-theme="light"] .mines-c { box-shadow: inset 0 1px 0 #fff, inset 0 0 0 .5px var(--line), 0 1px 2px rgba(40, 50, 120, .14); }
.mines-c:hover { filter: brightness(1.18); }
[data-theme="light"] .mines-c:hover { filter: brightness(.95); }
.mines-c.is-press, .mines-c.is-peek { transform: scale(.86); filter: brightness(.9); }
.mines-c svg { width: 68%; height: 68%; pointer-events: none; }
.mines-c.is-flag svg { animation: mines-pop .4s var(--spring) both; transform-origin: 40% 90%; }
@keyframes mines-pop { from { transform: scale(0) rotate(-24deg); } }
.mines-c.is-open { background-color: var(--well); box-shadow: none; cursor: default; filter: none; animation: mines-open .32s var(--ease-out) var(--d, 0ms) both; }
@keyframes mines-open { from { background-color: var(--raise-2); color: transparent; box-shadow: inset 0 1px 0 rgba(255, 255, 255, .22), inset 0 0 0 .5px var(--line); } 45% { transform: scale(.72); border-radius: 50%; } }
.mines-c.is-open svg { animation: mines-fade .2s var(--d, 0ms) both; }
@keyframes mines-fade { from { opacity: 0; } }
.mines-c.n1 { color: var(--m1); } .mines-c.n2 { color: var(--m2); } .mines-c.n3 { color: var(--m3); } .mines-c.n4 { color: var(--m4); }
.mines-c.n5 { color: var(--m5); } .mines-c.n6 { color: var(--m6); } .mines-c.n7 { color: var(--m7); } .mines-c.n8 { color: var(--m8); }
.mines-c.is-mine { color: var(--m-ink); }
.mines-c.is-boom { background-color: var(--c-coral); color: #2a0710; }
.mines-c.is-wrong::after { content: ""; position: absolute; inset: 14%; background: linear-gradient(45deg, transparent 45.500%, var(--m-ink) 45.500% 54.500%, transparent 54.500%), linear-gradient(-45deg, transparent 45.500%, var(--m-ink) 45.500% 54.500%, transparent 54.500%); animation: mines-fade .3s .3s both; }
.mines-c.is-wrong svg { opacity: .55; }
.mines-c.is-cursor { outline: 2.500px solid var(--accent); outline-offset: 1px; z-index: 1; }
.mines-grid.is-over .mines-c { cursor: default; }
.mines-grid.is-over .mines-c:hover { filter: none; }
.mines-fx { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.mines-result { position: absolute; left: 12px; right: 12px; bottom: 18px; z-index: 2; display: flex; align-items: center; gap: 12px; width: fit-content; max-width: calc(100% - 24px); margin-inline: auto; padding: 8px 8px 8px 16px; border-radius: 99px; background: color-mix(in srgb, var(--solid) 86%, transparent); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); box-shadow: 0 14px 34px -10px rgba(0, 0, 14, .6), inset 0 0 0 .5px var(--glass-edge); white-space: nowrap; animation: mines-result .5s var(--spring-soft) .35s both; }
@keyframes mines-result { from { opacity: 0; translate: 0 16px; scale: .9; } }
.mines-result div { display: grid; min-width: 0; }
.mines-result b { font-size: 13.500px; }
.mines-result span { font-size: 12px; color: var(--fg-3); overflow: hidden; text-overflow: ellipsis; }
@container win (max-width: 430px) {
  .mines-top { flex-wrap: wrap; gap: 8px 6px; padding: 10px 12px 0; }
  .mines-top .gseg { display: flex; flex: 1 0 100%; }
  .mines-top .sp { display: none; }
  .mines-stat { flex: 1; }
}
`);

const db = appStore('mines');
const soundOn = () => sfx.enabled && audioReady();

export default {
  singleton: true,
  width: 420, height: 510, minW: 350, minH: 420,

  mount(win) {
    let cfg = SIZES.find((s) => s.id === db.get('size', 'klein')) || SIZES[0];
    let G = null, els = [];
    let state = 'ready';              // ready | play | won | lost
    let t0 = 0, secs = 0;
    let cursor = 0, showCursor = false, flagMode = false;
    let press = null, lastLong = 0;
    let fx = null;

    // ---------- Aufbau ----------
    const seg = h('div.gseg', { 'aria-label': 'Feldgröße' }, SIZES.map((s) => h('button', {
      type: 'button', dataset: { value: s.id }, title: `${s.cols} × ${s.rows} Felder, ${s.mines} Minen`, 'aria-selected': String(s === cfg),
    }, s.name)));
    const leftEl = h('b', '0'), timeEl = h('b', '0:00');
    const bFlag = h('button.tool', { type: 'button', 'aria-label': 'Fahnen-Modus: Tippen setzt Fahnen', title: 'Fahnen-Modus: Tippen setzt Fahnen', html: FLAG, onclick: () => { flagMode = !flagMode; bFlag.classList.toggle('is-on', flagMode); grid.focus({ preventScroll: true }); } });
    const bNew = h('button.tool', { type: 'button', 'aria-label': 'Neues Spiel (N)', title: 'Neues Spiel (N)', html: icon('reload'), onclick: () => { newGame(); grid.focus({ preventScroll: true }); } });
    const grid = h('div.mines-grid', { tabIndex: 0, role: 'application', 'aria-label': 'Minenfeld' });
    const stage = h('div.mines-stage.scroll', grid);
    const canvas = h('canvas.mines-fx', { 'aria-hidden': 'true' });
    const area = h('div.mines-area', stage, canvas);
    win.body.append(h('div.mines',
      h('div.mines-top', seg, h('span.sp'),
        h('span.mines-stat', { title: 'Minen ohne Fahne', html: MINE }, leftEl),
        h('span.mines-stat', { title: 'Zeit', html: CLOCK }, timeEl),
        bFlag, bNew),
      area));
    initControls(win.body);
    bFlag.querySelector('svg').style.cssText = 'width:17px;height:17px';

    // ---------- Darstellung ----------
    const xy = (i) => [i % cfg.cols, (i / cfg.cols) | 0];
    function paintCell(i, delay = 0) {
      const el = els[i];
      el.style.setProperty('--d', `${delay}ms`);
      if (G.open[i]) { el.className = `mines-c is-open n${G.num[i]}`; el.textContent = G.num[i] || ''; }
      else if (G.flag[i]) { if (!el.classList.contains('is-flag')) { el.className = 'mines-c is-flag'; el.innerHTML = FLAG; } }
      else { el.className = 'mines-c'; el.textContent = ''; }
      el.classList.toggle('is-cursor', showCursor && i === cursor);
    }
    function paintStats() {
      leftEl.textContent = String(cfg.mines - G.flags);
      timeEl.textContent = fmtLive(secs);
    }
    function moveCursor(i) {
      els[cursor]?.classList.remove('is-cursor');
      cursor = i;
      els[cursor]?.classList.toggle('is-cursor', showCursor);
    }
    function layout() {
      const w = stage.clientWidth - PAD * 2, hgt = stage.clientHeight - PAD * 2;
      if (w <= 0 || hgt <= 0) return;
      const fit = Math.floor(Math.min((w - (cfg.cols - 1) * GAP) / cfg.cols, (hgt - (cfg.rows - 1) * GAP) / cfg.rows));
      grid.style.setProperty('--cell', `${clamp(fit, 20, 46)}px`);
    }
    /** Fenster an die Feldgröße anpassen (nicht, wenn es eingerastet oder maximiert ist). */
    function fitWindow(animate) {
      if (win.snapped) return;
      const A = win.wm.area();
      const w = clamp(cfg.cols * cfg.cell + (cfg.cols - 1) * GAP + PAD * 2, Math.max(win.minW, 380), A.w - 16);
      // schmale Fenster brauchen zwei Zeilen für die Leiste (siehe Container-Query)
      const hgt = clamp(cfg.rows * cfg.cell + (cfg.rows - 1) * GAP + PAD * 2 + 42 + (w <= 430 ? 82 : 42), win.minH, A.h - 16);
      const cx = win.rect.x + win.rect.w / 2;
      win.setRect({
        x: Math.round(clamp(cx - w / 2, 8, Math.max(8, A.w - w - 8))),
        y: Math.round(clamp(win.rect.y, A.y + 8, Math.max(A.y + 8, A.y + A.h - hgt - 8))),
        w, h: hgt,
      }, animate);
    }

    // ---------- Spielablauf ----------
    function stopClock() {
      if (t0) { secs = (performance.now() - t0) / 1000; t0 = 0; }
    }
    function newGame() {
      stopFx();
      area.querySelector('.mines-result')?.remove();
      G = minesCore(cfg.cols, cfg.rows, cfg.mines);
      state = 'ready';
      t0 = 0;
      secs = 0;
      grid.style.setProperty('--cols', cfg.cols);
      grid.classList.remove('is-over', 'is-shake');
      els = Array.from({ length: G.n }, (_, i) => h('div.mines-c', { dataset: { i } }));
      grid.replaceChildren(...els);
      cursor = Math.min(cursor, G.n - 1);
      if (showCursor) els[cursor].classList.add('is-cursor');
      layout();
      paintStats();
    }
    function setSize(id) {
      const next = SIZES.find((s) => s.id === id);
      if (!next || next === cfg) return;
      cfg = next;
      db.set('size', cfg.id);
      cursor = 0;
      newGame();
      fitWindow(true);
    }

    function showOpened(cells, from) {
      const [fx0, fy0] = xy(from);
      for (const i of cells) {
        const [x, y] = xy(i);
        paintCell(i, reducedMotion.matches ? 0 : Math.min(900, Math.hypot(x - fx0, y - fy0) * 34));
      }
      if (soundOn()) {
        if (cells.length > 3) [0, 1, 2, 3].forEach((k) => tone({ type: 'triangle', f: 420 + k * 120, dur: 0.07, vol: 0.05, when: k * 0.05 }));
        else tone({ type: 'triangle', f: 640, f2: 520, dur: 0.05, vol: 0.07 });
      }
    }
    function open(i) {
      if (state === 'won' || state === 'lost') return;
      if (G.flag[i]) return;
      if (G.open[i]) {
        const r = G.chord(i);
        if (r.hit >= 0) { lose(r.hit); return; }
        if (r.cells.length) { showOpened(r.cells, i); if (G.won) win_(); }
        return;
      }
      if (state === 'ready') { state = 'play'; t0 = performance.now(); }
      const cells = G.reveal(i);
      if (!cells) { lose(i); return; }
      showOpened(cells, i);
      if (G.won) win_();
    }
    function toggleFlag(i) {
      if (state === 'won' || state === 'lost' || !G.toggleFlag(i)) return;
      paintCell(i);
      paintStats();
      if (soundOn()) tone({ f: G.flag[i] ? 880 : 520, f2: G.flag[i] ? 1180 : 400, dur: 0.07, vol: 0.06 });
    }

    function result(title, text) {
      area.querySelector('.mines-result')?.remove();
      area.append(h('div.mines-result', { role: 'status' }, h('div', h('b', title), h('span', text)),
        h('button.kit-btn.primary.round', { type: 'button', onclick: () => { newGame(); grid.focus({ preventScroll: true }); } }, 'Nochmal')));
    }
    function lose(hit) {
      stopClock();
      state = 'lost';
      grid.classList.add('is-over');
      const [hx, hy] = xy(hit);
      for (let i = 0; i < G.n; i++) {
        const [x, y] = xy(i);
        const d = reducedMotion.matches ? 0 : Math.min(1400, Math.hypot(x - hx, y - hy) * 55);
        if (G.mine[i] && !G.flag[i]) {
          const el = els[i];
          el.style.setProperty('--d', `${d}ms`);
          el.className = `mines-c is-open is-mine${i === hit ? ' is-boom' : ''}`;
          el.innerHTML = MINE;
        } else if (G.flag[i] && !G.mine[i]) els[i].classList.add('is-wrong');
      }
      if (!reducedMotion.matches) {
        grid.classList.remove('is-shake');
        void grid.offsetWidth;
        grid.classList.add('is-shake');
      }
      if (soundOn()) {
        tone({ type: 'sawtooth', f: 140, f2: 38, dur: 0.5, vol: 0.16 });
        tone({ type: 'square', f: 70, f2: 30, dur: 0.35, vol: 0.08, when: 0.03 });
      }
      paintStats();
      result('Mine getroffen', `Nach ${fmtBest(secs)} war Schluss.`);
    }
    function win_() {
      stopClock();
      state = 'won';
      grid.classList.add('is-over');
      for (let i = 0; i < G.n; i++) if (G.mine[i] && !G.flag[i]) { G.toggleFlag(i); paintCell(i); }
      paintStats();
      const best = db.get('best', {});
      const old = best[cfg.id];
      const record = !old || secs < old;
      if (record) { best[cfg.id] = Math.round(secs * 10) / 10; db.set('best', best); }
      if (soundOn()) sfx.chime();
      celebrate();
      result('Geschafft!', record ? `${fmtBest(secs)} – ${old ? 'neue Bestzeit' : 'deine erste Bestzeit'}!` : `${fmtBest(secs)} · Bestzeit ${fmtBest(old)}`);
    }

    // ---------- Sieg: aus jeder Mine steigt Konfetti ----------
    function stopFx() {
      if (fx) { ticker.remove(fx); fx = null; }
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    }
    function celebrate() {
      if (reducedMotion.matches) return;
      stopFx();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const W = area.clientWidth, H = area.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      const ctx = canvas.getContext('2d');
      const box = area.getBoundingClientRect();
      const parts = [];
      for (let i = 0; i < G.n; i++) {
        if (!G.mine[i]) continue;
        const r = els[i].getBoundingClientRect();
        const cx = r.left - box.left + r.width / 2, cy = r.top - box.top + r.height / 2;
        const wait = rand(0, 0.5);
        for (let k = 0; k < (G.count > 50 ? 4 : 7); k++) {
          const a = rand(TAU), s = rand(80, 330);
          parts.push({ x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 190, rot: rand(TAU), vr: rand(-9, 9), w: rand(4, 8), life: rand(1.1, 2.1), wait, c: pick(CONFETTI), round: Math.random() < 0.3 });
        }
      }
      fx = (dt) => {
        if (win.min) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        let alive = 0;
        for (const p of parts) {
          if (p.wait > 0) { p.wait -= dt; alive++; continue; }
          if (p.life <= 0) continue;
          alive++;
          p.life -= dt;
          p.vy += 620 * dt;
          p.vx *= 1 - dt * 0.9;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.rot += p.vr * dt;
          ctx.globalAlpha = clamp(p.life * 1.6);
          ctx.fillStyle = p.c;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w * 0.45, 0, TAU); ctx.fill(); }
          else ctx.fillRect(-p.w / 2, -p.w * 0.3, p.w, p.w * 0.6 * Math.abs(Math.cos(p.rot * 1.7)) + 1);
          ctx.restore();
        }
        ctx.globalAlpha = 1;
        if (!alive) stopFx();
      };
      ticker.add(fx);
    }

    // ---------- Eingabe ----------
    const cellAt = (e) => { const c = e.target.closest?.('.mines-c'); return c ? +c.dataset.i : -1; };
    const clearPress = () => {
      if (!press) return;
      clearTimeout(press.timer);
      els[press.i]?.classList.remove('is-press');
      for (const j of press.peek) els[j]?.classList.remove('is-peek');
      press = null;
    };
    grid.addEventListener('pointerdown', (e) => {
      const i = cellAt(e);
      if (i < 0 || state === 'won' || state === 'lost') return;
      if (showCursor) { showCursor = false; els[cursor]?.classList.remove('is-cursor'); }
      cursor = i;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      clearPress();
      press = { i, x: e.clientX, y: e.clientY, peek: [], timer: 0, long: false };
      if (G.open[i]) {
        // offene Zahl: zeigen, welche Nachbarn gemeint sind
        if (G.num[i]) { press.peek = G.near[i].filter((j) => !G.open[j] && !G.flag[j]); for (const j of press.peek) els[j].classList.add('is-peek'); }
      } else {
        els[i].classList.add('is-press');
        if (e.pointerType !== 'mouse') {
          press.timer = setTimeout(() => {
            if (!press || press.i !== i) return;
            press.long = true;
            lastLong = performance.now();
            els[i].classList.remove('is-press');
            toggleFlag(i);
          }, 380);
        }
      }
    });
    grid.addEventListener('pointermove', (e) => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) clearPress(); });
    grid.addEventListener('pointerleave', clearPress);
    grid.addEventListener('pointercancel', clearPress);
    grid.addEventListener('pointerup', (e) => {
      const p = press;
      clearPress();
      if (!p || p.long || cellAt(e) !== p.i) return;
      if (flagMode && !G.open[p.i]) toggleFlag(p.i); else open(p.i);
    });
    grid.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const i = cellAt(e);
      if (i < 0 || performance.now() - lastLong < 700) return;
      clearPress();
      toggleFlag(i);
    });
    seg.addEventListener('change', (e) => { setSize(e.detail.value); grid.focus({ preventScroll: true }); });

    win.el.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea, select, .kit-sheet-wrap') || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const d = { arrowup: [0, -1], arrowdown: [0, 1], arrowleft: [-1, 0], arrowright: [1, 0] }[key];
      if (d) {
        e.preventDefault();
        const [x, y] = xy(cursor);
        if (showCursor) moveCursor(clamp(y + d[1], 0, cfg.rows - 1) * cfg.cols + clamp(x + d[0], 0, cfg.cols - 1));
        else { showCursor = true; moveCursor(cursor); }
        els[cursor].scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } else if (key === ' ' || key === 'enter') {
        if (e.target.closest('button')) return;
        e.preventDefault();
        showCursor = true;
        moveCursor(cursor);
        open(cursor);
      } else if (key === 'f') {
        showCursor = true;
        moveCursor(cursor);
        toggleFlag(cursor);
      } else if (key === 'n' || key === 'f2') newGame();
    });

    const clock = setInterval(() => {
      if (!t0) return;
      secs = (performance.now() - t0) / 1000;
      if (!win.min) timeEl.textContent = fmtLive(secs);
    }, 200);
    const ro = new ResizeObserver(layout);
    ro.observe(stage);

    newGame();
    fitWindow(false);

    return {
      onFocus: () => { if (!win.el.contains(document.activeElement) || document.activeElement === win.el) grid.focus({ preventScroll: true }); },
      onClose: () => { clearInterval(clock); ro.disconnect(); clearPress(); if (fx) ticker.remove(fx); },
      menus: () => [{
        label: 'Spiel',
        items: [
          { label: 'Neues Spiel', icon: 'reload', hint: 'N', run: newGame },
          '-',
          { heading: 'Feldgröße' },
          ...SIZES.map((s) => ({ label: `${s.name} – ${s.cols} × ${s.rows}, ${s.mines} Minen`, checked: s === cfg, run: () => { seg.select(SIZES.indexOf(s), false); setSize(s.id); } })),
          '-',
          { heading: 'Bestzeiten' },
          ...SIZES.map((s) => { const b = db.get('best', {})[s.id]; return { label: `${s.name}: ${b ? fmtBest(b) : '–'}`, disabled: true }; }),
        ],
      }],
    };
  },
};
