// sudoku.js — Sudoku: Rätsel mit eindeutiger Lösung in vier Stufen, mit Notizen, Hinweisen und Bestzeiten

import { h, reducedMotion } from '../../../core/util.js';
import { icon } from '../../../core/icons.js';
import { initControls } from '../../../core/controls.js';
import { tone, sfx, audioReady } from '../../../core/audio.js';
import { style, appStore, toolBtn, sheet, toast, pad2 } from '../../kit.js';

// ==========================================================================
// Logik ohne DOM: Löser (zählt Lösungen), Bewertung nach nötigen Techniken, Generator
// Ein Gitter ist ein Array mit 81 Ziffern (0 = leer), zeilenweise.
// ==========================================================================
export function sudokuCore() {
  const BOX = Array.from({ length: 81 }, (_, i) => Math.floor(i / 27) * 3 + Math.floor((i % 9) / 3));
  const UNITS = [];
  for (let k = 0; k < 9; k++) UNITS.push(Array.from({ length: 9 }, (_, j) => k * 9 + j));
  for (let k = 0; k < 9; k++) UNITS.push(Array.from({ length: 9 }, (_, j) => j * 9 + k));
  for (let k = 0; k < 9; k++) UNITS.push(Array.from({ length: 81 }, (_, i) => i).filter((i) => BOX[i] === k));
  const PEERS = Array.from({ length: 81 }, (_, i) => {
    const s = new Set();
    for (const u of UNITS) if (u.includes(i)) for (const c of u) if (c !== i) s.add(c);
    return [...s];
  });
  const POP = new Uint8Array(1024);
  for (let m = 1; m < 1024; m++) POP[m] = POP[m >> 1] + (m & 1);
  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };

  /** Backtracking mit „engste Zelle zuerst“. Zählt Lösungen bis `limit`; random mischt die Ziffernfolge. */
  function solve(grid, limit = 2, random = false) {
    const g = Array.from(grid);
    const rows = new Int32Array(9), cols = new Int32Array(9), boxes = new Int32Array(9);
    for (let i = 0; i < 81; i++) {
      const d = g[i];
      if (!d) continue;
      const bit = 1 << d, r = (i / 9) | 0, c = i % 9;
      if ((rows[r] | cols[c] | boxes[BOX[i]]) & bit) return { count: 0, solution: null };
      rows[r] |= bit; cols[c] |= bit; boxes[BOX[i]] |= bit;
    }
    let count = 0, solution = null;
    const rec = () => {
      let best = -1, bestMask = 0, bestN = 10;
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        const m = ~(rows[(i / 9) | 0] | cols[i % 9] | boxes[BOX[i]]) & 0x3fe;
        if (POP[m] < bestN) { best = i; bestMask = m; bestN = POP[m]; if (bestN <= 1) break; }
      }
      if (best < 0) { count++; solution ||= g.slice(); return; }
      if (!bestN) return;
      const r = (best / 9) | 0, c = best % 9, b = BOX[best];
      const ds = [];
      for (let d = 1; d <= 9; d++) if (bestMask & (1 << d)) ds.push(d);
      if (random) shuffle(ds);
      for (const d of ds) {
        const bit = 1 << d;
        g[best] = d; rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
        rec();
        g[best] = 0; rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit;
        if (count >= limit) return;
      }
    };
    rec();
    return { count, solution };
  }

  /** Kandidaten (Bitmaske je Zelle) eines Gitters. */
  function candidates(grid) {
    const cand = new Int32Array(81);
    for (let i = 0; i < 81; i++) {
      if (grid[i]) continue;
      let m = 0x3fe;
      for (const p of PEERS[i]) if (grid[p]) m &= ~(1 << grid[p]);
      cand[i] = m;
    }
    return cand;
  }

  /**
   * Löst mit menschlichen Techniken und meldet die schwerste nötige:
   * 0 = nur eine Ziffer passt, 1 = Ziffer hat nur einen Platz, 2 = Blockade (Reihe/Block) oder nacktes Paar.
   * solved = false: diese Techniken reichen nicht.
   */
  function rate(grid) {
    const val = Array.from(grid);
    const cand = candidates(val);
    let left = val.filter((v) => !v).length, tech = 0;
    const put = (i, d) => {
      val[i] = d;
      cand[i] = 0;
      left--;
      for (const p of PEERS[i]) cand[p] &= ~(1 << d);
    };
    const drop = (i, mask) => {
      if (!(cand[i] & mask)) return false;
      cand[i] &= ~mask;
      return true;
    };
    while (left > 0) {
      let moved = false;
      for (let i = 0; i < 81; i++) {
        if (val[i]) continue;
        const m = cand[i];
        if (!m) return { solved: false, tech };
        if (POP[m] === 1) { put(i, 31 - Math.clz32(m)); moved = true; }
      }
      if (moved) continue;
      for (const u of UNITS) {
        for (let d = 1; d <= 9; d++) {
          const bit = 1 << d;
          let at = -1, n = 0;
          for (const c of u) if (cand[c] & bit) { at = c; n++; }
          if (n === 1) { put(at, d); moved = true; }
        }
      }
      if (moved) { tech = Math.max(tech, 1); continue; }
      // Blockaden: stehen alle Plätze einer Ziffer einer Einheit auch in einer zweiten, fällt sie dort sonst weg
      for (const u of UNITS) {
        for (let d = 1; d <= 9; d++) {
          const bit = 1 << d;
          const cells = u.filter((c) => cand[c] & bit);
          if (cells.length < 2 || cells.length > 3) continue;
          for (const o of UNITS) {
            if (o === u || !cells.every((c) => o.includes(c))) continue;
            for (const c of o) if (!cells.includes(c) && drop(c, bit)) moved = true;
          }
        }
        // nackte Paare
        for (let a = 0; a < 9; a++) {
          const m = cand[u[a]];
          if (POP[m] !== 2) continue;
          for (let b = a + 1; b < 9; b++) {
            if (cand[u[b]] !== m) continue;
            for (let k = 0; k < 9; k++) if (k !== a && k !== b && drop(u[k], m)) moved = true;
          }
        }
      }
      if (!moved) return { solved: false, tech };
      tech = 2;
    }
    return { solved: true, tech };
  }

  const TARGET = [[40, 44], [32, 36], [27, 31], [22, 26]];     // Vorgaben je Stufe

  /** Ein Versuch: volles Gitter erzeugen, punktsymmetrisch Ziffern entfernen, solange es eindeutig (und passend schwer) bleibt. */
  function attempt(level) {
    const solution = solve(new Array(81).fill(0), 1, true).solution;
    const puzzle = solution.slice();
    const [lo, hi] = TARGET[level];
    const target = lo + ((Math.random() * (hi - lo + 1)) | 0);
    let givens = 81;
    for (const i of shuffle(Array.from({ length: 41 }, (_, k) => k))) {
      if (givens <= target) break;
      const j = 80 - i, a = puzzle[i], b = puzzle[j];
      puzzle[i] = 0;
      puzzle[j] = 0;
      let ok = solve(puzzle, 2).count === 1;
      if (ok && level < 3) {
        const r = rate(puzzle);
        ok = r.solved && r.tech <= (level === 2 ? 2 : 1);
      }
      if (ok) givens -= i === j ? 1 : 2; else { puzzle[i] = a; puzzle[j] = b; }
    }
    const r = rate(puzzle);
    const tech = r.solved ? r.tech : 3;
    const fits = level === 0 ? true : level === 1 ? givens <= 37 && tech === 1 : level === 2 ? tech === 2 : tech === 3;
    return { puzzle, solution, givens, tech, fits };
  }

  /** Mehrere Versuche, bis die Stufe passt; sonst der beste Fund. */
  function generate(level, tries = 60) {
    let best = null;
    for (let n = 0; n < tries; n++) {
      const a = attempt(level);
      if (!best || a.fits || a.tech > best.tech || (a.tech === best.tech && a.givens < best.givens)) best = a;
      if (a.fits) break;
    }
    return best;
  }

  return { BOX, UNITS, PEERS, solve, rate, candidates, attempt, generate };
}

// ==========================================================================
// Oberfläche
// ==========================================================================
const LEVELS = ['Leicht', 'Mittel', 'Schwer', 'Experte'];
const ABOUT = [
  'Viele Vorgaben – jede Ziffer lässt sich direkt ablesen.',
  'Weniger Vorgaben, aber immer findet sich eine Zelle mit nur einer Möglichkeit.',
  'Hier brauchst du Notizen: Paare und Blockaden schränken die Kandidaten ein.',
  'Sehr wenige Vorgaben. Verlangt fortgeschrittene Techniken und Geduld.',
];
const PENCIL = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.500 19.500l1-4.300L16.300 4.400a2.100 2.100 0 0 1 3 0l.300.300a2.100 2.100 0 0 1 0 3L8.800 18.500z"/><path d="M14.500 6.200l3.300 3.300"/></svg>';
const fmt = (s) => {
  s = Math.floor(s);
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${pad2(m % 60)}:${pad2(s % 60)}` : `${pad2(m)}:${pad2(s % 60)}`;
};

style('sudoku', `
.sudoku { display: flex; flex: 1; min-height: 0; --sd-cell: var(--solid); --sd-thick: color-mix(in srgb, var(--fg) 58%, var(--solid)); --sd-thin: color-mix(in srgb, var(--fg) 17%, var(--solid)); --sd-ink: color-mix(in srgb, var(--accent) 74%, var(--fg)); }
.sudoku-main { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.sudoku-top { display: flex; align-items: center; gap: 8px; flex: none; padding: 12px 16px 0; }
.sudoku-top .sp { flex: 1; }
.sudoku-time { min-width: 52px; font: 650 16px/1 var(--font-round); font-variant-numeric: tabular-nums; text-align: right; color: var(--fg); }
.sudoku-info { font-size: 12px; font-weight: 600; color: var(--fg-3); white-space: nowrap; }
.sudoku-stage { display: grid; place-items: center; flex: 1; min-height: 0; padding: 12px 16px 16px; container-type: size; }
.sudoku-board { position: relative; display: grid; grid-template: repeat(3, 1fr) / repeat(3, 1fr); gap: 2.5px; width: min(100cqw, 100cqh); aspect-ratio: 1; padding: 2.5px; border-radius: 12px; overflow: hidden; outline: 0; background: var(--sd-thick); box-shadow: 0 18px 40px -20px rgba(0, 0, 14, .55); }
.sudoku-box { display: grid; grid-template: repeat(3, 1fr) / repeat(3, 1fr); gap: 1px; background: var(--sd-thin); }
.sudoku-cell { position: relative; display: grid; place-items: center; min-width: 0; min-height: 0; background: var(--sd-cell); color: var(--sd-ink); font: 600 5.700cqmin/1 var(--font-round); cursor: pointer; transition: background-color .12s; }
.sudoku-cell.is-given { color: var(--fg); font-weight: 700; }
.sudoku-cell.is-hint { color: var(--c-mint); }
[data-theme="light"] .sudoku-cell.is-hint { color: #0c8f6c; }
.sudoku-cell.is-peer { background: color-mix(in srgb, var(--accent) 12%, var(--sd-cell)); }
.sudoku-cell.is-same { background: color-mix(in srgb, var(--accent) 30%, var(--sd-cell)); }
.sudoku-cell.is-sel { background: color-mix(in srgb, var(--accent) 46%, var(--sd-cell)); box-shadow: inset 0 0 0 2px var(--accent); color: var(--fg); }
.sudoku-cell.is-err { color: var(--c-coral); background: color-mix(in srgb, var(--c-coral) 20%, var(--sd-cell)); }
[data-theme="light"] .sudoku-cell.is-err { color: #d2203a; }
.sudoku-cell.is-err.is-sel { box-shadow: inset 0 0 0 2px var(--c-coral); background: color-mix(in srgb, var(--c-coral) 34%, var(--sd-cell)); }
.sudoku-cell.is-nudge { animation: sudoku-nudge .28s; }
@keyframes sudoku-nudge { 25% { transform: translateX(-6%); } 75% { transform: translateX(6%); } }
.sudoku-cell.is-flash { animation: sudoku-flash .5s var(--ease-out) var(--d, 0s) both; }
@keyframes sudoku-flash { 40% { background: color-mix(in srgb, var(--accent) 60%, var(--sd-cell)); transform: scale(.86); border-radius: 22%; } }
.sudoku-cell.is-win { animation: sudoku-win .7s var(--ease-out) var(--d, 0s) both; }
@keyframes sudoku-win { 35% { background: var(--accent); color: #fff; transform: scale(.8); border-radius: 30%; } }
.sudoku-notes { position: absolute; inset: 6%; display: grid; grid-template: repeat(3, 1fr) / repeat(3, 1fr); place-items: center; font: 600 max(7px, 2.300cqmin)/1 var(--font-round); color: var(--fg-3); }
.sudoku-notes i { font-style: normal; opacity: 0; }
.sudoku-notes i.on { opacity: 1; }
.sudoku-notes i.hit { color: var(--sd-ink); font-weight: 800; }
.sudoku-board.is-veiled .sudoku-cell { color: transparent; background: var(--sd-cell); box-shadow: none; }
.sudoku-board.is-veiled .sudoku-notes { visibility: hidden; }
.sudoku-cover { position: absolute; inset: 0; z-index: 3; display: grid; place-content: center; justify-items: center; gap: 10px; background: color-mix(in srgb, var(--solid) 55%, transparent); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); text-align: center; animation: sudoku-fade .25s both; }
@keyframes sudoku-fade { from { opacity: 0; } }
.sudoku-cover b { font: 700 20px var(--font-round); }
.sudoku-cover span { font-size: 12.5px; color: var(--fg-3); }
.sudoku-pad { display: flex; flex-direction: column; gap: 12px; flex: none; width: 214px; padding: 12px 16px 16px 0; }
.sudoku-digits { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.sudoku-digit { display: grid; place-content: center; justify-items: center; gap: 2px; aspect-ratio: 1 / .92; padding: 0; border: 0; border-radius: 13px; background: var(--raise); box-shadow: inset 0 0 0 .5px var(--line); color: var(--fg); font: 600 23px/1 var(--font-round); transition: transform .4s var(--spring), background-color .15s, opacity .2s; }
.sudoku-digit:hover { background: var(--raise-2); }
.sudoku-digit:active { transform: scale(.9); }
.sudoku-digit small { font: 600 10px/1 var(--font); color: var(--fg-3); font-variant-numeric: tabular-nums; }
.sudoku-digit.is-done { opacity: .32; }
.sudoku-pad.is-notes .sudoku-digit { color: var(--sd-ink); box-shadow: inset 0 0 0 1.500px color-mix(in srgb, var(--accent) 55%, transparent); }
.sudoku-row { display: grid; gap: 12px; }
.sudoku-tools { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
.sudoku-tool { display: grid; place-items: center; height: 36px; padding: 0; border: 0; border-radius: 10px; background: var(--raise); box-shadow: inset 0 0 0 .5px var(--line); color: var(--fg-2); transition: transform .4s var(--spring), background-color .15s, color .15s; }
.sudoku-tool:hover:not(:disabled) { background: var(--raise-2); color: var(--fg); }
.sudoku-tool:active:not(:disabled) { transform: scale(.9); }
.sudoku-tool:disabled { opacity: .35; cursor: default; }
.sudoku-tool.is-on { background: var(--accent); color: #fff; }
.sudoku-tool .ico { width: 17px; height: 17px; }
.sudoku-opt { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; font-weight: 600; color: var(--fg-2); }
.sudoku-opt .gswitch { --w: 44px; --h: 26px; }
.sudoku-pad .sp { flex: 1; }
.sudoku-lv { display: grid; gap: 10px; }
.sudoku-lv .gseg { display: flex; }
.sudoku-lv .gseg button { padding-inline: .4em; }
.sudoku-lv p { min-height: 3em; font-size: 13px; color: var(--fg-2); text-wrap: pretty; }
.sudoku-lv small { font-size: 12px; font-weight: 600; color: var(--fg-3); }
@container win (max-width: 600px) {
  .sudoku { flex-direction: column; }
  .sudoku-top { padding: 10px 12px 0; }
  .sudoku-stage { padding: 10px 12px; }
  .sudoku-pad { width: auto; gap: 8px; padding: 0 12px 12px; }
  .sudoku-digits { grid-template-columns: repeat(9, 1fr); gap: 4px; }
  .sudoku-digit { aspect-ratio: auto; height: 46px; border-radius: 10px; font-size: 19px; }
  .sudoku-digit small { font-size: 9px; }
  .sudoku-row { display: flex; align-items: center; gap: 10px; }
  .sudoku-tools { flex: 1; }
  .sudoku-opt { font-size: 12px; white-space: nowrap; }
  .sudoku-pad .sp, .sudoku-new { display: none; }
}
`);

const db = appStore('sudoku');
const soundOn = () => sfx.enabled && audioReady();

export default {
  singleton: true,
  width: 780, height: 600, minW: 360, minH: 540,

  mount(win) {
    const core = sudokuCore();
    let S = null;                 // laufendes Rätsel
    let sel = 40, notesMode = false, paused = false, busy = false, closed = false;
    let check = !!db.get('check', false);
    let undoStack = [], redoStack = [];
    let runSince = 0, genToken = 0, saveTick = 0;

    // ---------- Aufbau ----------
    const cells = [];
    const boxes = Array.from({ length: 9 }, () => h('div.sudoku-box'));
    for (let i = 0; i < 81; i++) {
      const c = h('div.sudoku-cell', { dataset: { i } });
      cells.push(c);
      boxes[core.BOX[i]].append(c);
    }
    const cover = h('div.sudoku-cover', { hidden: true });
    const board = h('div.sudoku-board', { tabIndex: 0, role: 'application', 'aria-label': 'Sudoku-Feld' }, boxes, cover);
    const levelEl = h('button.kit-chip', { type: 'button', title: 'Neues Spiel', onclick: () => newGameSheet() });
    const infoEl = h('span.sudoku-info');
    const timeEl = h('span.sudoku-time', '00:00');
    const bPause = toolBtn('pause', 'Pause (P)', () => setPaused(!paused));
    const digitBtns = [];
    const digits = h('div.sudoku-digits', Array.from({ length: 9 }, (_, k) => {
      const b = h('button.sudoku-digit', { type: 'button', 'aria-label': `Ziffer ${k + 1}`, onclick: () => enter(k + 1) }, String(k + 1), h('small', '9'));
      digitBtns.push(b);
      return b;
    }));
    const tool = (svgHtml, label, fn) => h('button.sudoku-tool', { type: 'button', 'aria-label': label, title: label, html: svgHtml, onclick: fn });
    const bNotes = tool(PENCIL, 'Notizen (N)', () => setNotes(!notesMode));
    const bErase = tool(icon('eraser'), 'Löschen (Entf)', () => erase());
    const bUndo = tool(icon('undo'), 'Rückgängig (⌘Z)', () => undo());
    const bRedo = tool(icon('redo'), 'Wiederholen (⇧⌘Z)', () => redo());
    const bHint = tool(icon('sparkles'), 'Hinweis (H)', () => hint());
    const swCheck = h('button.gswitch', { 'aria-checked': String(check), 'aria-label': 'Fehler prüfen' });
    const pad = h('aside.sudoku-pad',
      digits,
      h('div.sudoku-row',
        h('div.sudoku-tools', bNotes, bErase, bUndo, bRedo, bHint),
        h('label.sudoku-opt', { title: 'Falsche Ziffern rot markieren' }, h('span', 'Fehler prüfen'), swCheck)),
      h('span.sp'),
      h('button.kit-btn.sudoku-new', { type: 'button', onclick: () => newGameSheet() }, 'Neues Spiel'));
    initControls(pad);
    swCheck.addEventListener('change', (e) => { check = e.detail.checked; db.set('check', check); paint(); });
    win.tools.append(toolBtn('plus', 'Neues Spiel', () => newGameSheet()));
    win.body.append(h('div.sudoku',
      h('div.sudoku-main',
        h('div.sudoku-top', levelEl, infoEl, h('span.sp'), timeEl, bPause),
        h('div.sudoku-stage', board)),
      pad));

    // ---------- Zeit ----------
    const elapsed = () => (S ? S.elapsed + (runSince ? (performance.now() - runSince) / 1000 : 0) : 0);
    function run(on) {
      if (on && !runSince && S && !S.done && !paused && !busy) runSince = performance.now();
      else if (!on && runSince) { S.elapsed += (performance.now() - runSince) / 1000; runSince = 0; }
    }
    const timer = setInterval(() => {
      if (win.min && runSince) setPaused(true);
      timeEl.textContent = fmt(elapsed());
      if (runSince && ++saveTick % 16 === 0) save();
    }, 250);

    function save() {
      if (!S) return;
      db.set('game', { ...S, elapsed: elapsed() });
    }

    // ---------- Darstellung ----------
    const playable = () => S && !S.done && !paused && !busy;
    function showCover(title, text, button) {
      cover.replaceChildren(h('b', title), text ? h('span', text) : null, button || null);
      cover.hidden = false;
      board.classList.add('is-veiled');
    }
    function hideCover() {
      cover.hidden = true;
      board.classList.remove('is-veiled');
    }

    function paint() {
      if (!S) return;
      const sv = S.vals[sel];
      const sr = Math.floor(sel / 9), sc = sel % 9, sb = core.BOX[sel];
      const counts = new Array(10).fill(0);
      for (let i = 0; i < 81; i++) {
        const el = cells[i], v = S.vals[i], n = S.notes[i];
        counts[v]++;
        const cl = el.classList;
        cl.toggle('is-given', !!S.puzzle[i]);
        cl.toggle('is-hint', !!S.fixed[i]);
        cl.toggle('is-sel', i === sel);
        cl.toggle('is-peer', i !== sel && (Math.floor(i / 9) === sr || i % 9 === sc || core.BOX[i] === sb));
        cl.toggle('is-same', i !== sel && !!sv && v === sv);
        cl.toggle('is-err', check && !!v && v !== S.solution[i]);
        const key = v ? `v${v}` : n ? `n${n}:${sv}` : '';
        if (el._key !== key) {
          el._key = key;
          if (v) el.textContent = v;
          else if (n) el.replaceChildren(h('div.sudoku-notes', Array.from({ length: 9 }, (_, k) => h('i', { class: `${n & (2 << k) ? 'on' : ''}${sv === k + 1 ? ' hit' : ''}` }, String(k + 1)))));
          else el.textContent = '';
        }
      }
      digitBtns.forEach((b, k) => {
        const left = Math.max(0, 9 - counts[k + 1]);
        b.lastChild.textContent = left;
        b.classList.toggle('is-done', left === 0);
      });
      levelEl.textContent = LEVELS[S.level];
      infoEl.textContent = [check ? `Fehler: ${S.mistakes}` : '', S.hints ? `Hinweise: ${S.hints}` : ''].filter(Boolean).join(' · ');
      timeEl.textContent = fmt(elapsed());
      bUndo.disabled = !undoStack.length || !playable();
      bRedo.disabled = !redoStack.length || !playable();
      bHint.disabled = bErase.disabled = !playable();
      bNotes.classList.toggle('is-on', notesMode);
      pad.classList.toggle('is-notes', notesMode);
      bPause.innerHTML = icon(paused ? 'play' : 'pause');
      bPause.disabled = !S || S.done || busy;
      bPause.setAttribute('aria-label', paused ? 'Weiter (P)' : 'Pause (P)');
      bPause.title = paused ? 'Weiter (P)' : 'Pause (P)';
    }

    function setPaused(v) {
      if (!S || S.done || busy || paused === v) return;
      paused = v;
      if (v) {
        run(false);
        save();
        showCover('Pause', 'Das Feld ist verdeckt, die Uhr steht.', h('button.kit-btn.primary.big.round', { type: 'button', onclick: () => setPaused(false) }, 'Weiter'));
      } else {
        hideCover();
        run(true);
        board.focus({ preventScroll: true });
      }
      paint();
    }
    function setNotes(v) { notesMode = v; paint(); }
    function select(i) { sel = Math.min(80, Math.max(0, i)); paint(); }
    function nudge(i) {
      const el = cells[i];
      el.classList.remove('is-nudge');
      void el.offsetWidth;
      el.classList.add('is-nudge');
      setTimeout(() => el.classList.remove('is-nudge'), 320);
    }
    function animate(list, cls, step) {
      if (reducedMotion.matches) return;
      list.forEach(([i, order]) => {
        const el = cells[i];
        el.style.setProperty('--d', `${order * step}ms`);
        el.classList.remove(cls);
        void el.offsetWidth;
        el.classList.add(cls);
        setTimeout(() => el.classList.remove(cls), order * step + 800);
      });
    }

    // ---------- Züge ----------
    function apply(changes, dir) {
      for (const c of changes) {
        S.vals[c.i] = dir ? c.v1 : c.v0;
        S.notes[c.i] = dir ? c.n1 : c.n0;
        if ('f1' in c) S.fixed[c.i] = dir ? c.f1 : c.f0;
      }
    }
    function commit(changes) {
      if (!changes.length) return;
      apply(changes, true);
      undoStack.push(changes);
      redoStack = [];
      save();
      paint();
    }
    function undo() {
      if (!playable() || !undoStack.length) return;
      const ch = undoStack.pop();
      apply(ch, false);
      redoStack.push(ch);
      sel = ch[0].i;
      if (soundOn()) sfx.tick();
      save();
      paint();
    }
    function redo() {
      if (!playable() || !redoStack.length) return;
      const ch = redoStack.pop();
      apply(ch, true);
      undoStack.push(ch);
      sel = ch[0].i;
      if (soundOn()) sfx.tick();
      save();
      paint();
      afterPlace(sel, false);
    }

    function enter(d, asNote = notesMode) {
      if (!playable()) return;
      const i = sel;
      if (S.puzzle[i] || S.fixed[i]) { nudge(i); return; }
      const bit = 1 << d;
      if (asNote) {
        if (S.vals[i]) { nudge(i); return; }
        commit([{ i, v0: 0, n0: S.notes[i], v1: 0, n1: S.notes[i] ^ bit }]);
        if (soundOn()) tone({ type: 'triangle', f: 1500, f2: 1100, dur: 0.03, vol: 0.035 });
        return;
      }
      if (S.vals[i] === d) { erase(); return; }
      const ch = [{ i, v0: S.vals[i], n0: S.notes[i], v1: d, n1: 0 }];
      // Notizen bereinigen: die Ziffer kann in Zeile, Spalte und Block nicht mehr vorkommen
      for (const p of core.PEERS[i]) if (!S.vals[p] && S.notes[p] & bit) ch.push({ i: p, v0: 0, n0: S.notes[p], v1: 0, n1: S.notes[p] & ~bit });
      const wrong = d !== S.solution[i];
      if (check && wrong) S.mistakes++;
      commit(ch);
      if (soundOn()) {
        if (check && wrong) sfx.error();
        else tone({ type: 'triangle', f: 520 + d * 34, f2: 420 + d * 34, dur: 0.06, vol: 0.07 });
      }
      afterPlace(i, true);
    }
    function erase() {
      if (!playable()) return;
      const i = sel;
      if (S.puzzle[i] || S.fixed[i]) { nudge(i); return; }
      if (!S.vals[i] && !S.notes[i]) return;
      commit([{ i, v0: S.vals[i], n0: S.notes[i], v1: 0, n1: 0 }]);
      if (soundOn()) sfx.tick();
    }
    function hint() {
      if (!playable()) return;
      let i = sel;
      if (S.vals[i] === S.solution[i]) {
        // die Zelle mit den wenigsten Möglichkeiten – dort wäre man selbst als Nächstes fündig geworden
        const cand = core.candidates(S.vals.map((v, k) => (v === S.solution[k] ? v : 0)));
        let best = -1, bn = 99;
        for (let k = 0; k < 81; k++) {
          if (S.vals[k] === S.solution[k]) continue;
          let n = 0;
          for (let d = 1; d <= 9; d++) if (cand[k] & (1 << d)) n++;
          if (n < bn) { bn = n; best = k; }
        }
        if (best < 0) return;
        i = best;
      }
      const d = S.solution[i], bit = 1 << d;
      const ch = [{ i, v0: S.vals[i], n0: S.notes[i], v1: d, n1: 0, f0: S.fixed[i], f1: 1 }];
      for (const p of core.PEERS[i]) if (!S.vals[p] && S.notes[p] & bit) ch.push({ i: p, v0: 0, n0: S.notes[p], v1: 0, n1: S.notes[p] & ~bit });
      S.hints++;
      sel = i;
      commit(ch);
      animate([[i, 0]], 'is-flash', 0);
      if (soundOn()) sfx.pop();
      afterPlace(i, false);
    }

    /** Nach einer gesetzten Ziffer: volle Einheiten aufblitzen lassen, Ende erkennen. */
    function afterPlace(i, flash) {
      if (S.vals.every((v, k) => v === S.solution[k])) { finish(i); return; }
      if (flash) {
        const done = new Map();
        for (const u of core.UNITS) {
          if (!u.includes(i)) continue;
          const seen = new Set(u.map((c) => S.vals[c]));
          if (seen.size === 9 && !seen.has(0)) u.forEach((c, k) => { if (!done.has(c)) done.set(c, k); });
        }
        if (done.size) {
          animate([...done], 'is-flash', 28);
          if (soundOn()) tone({ f: 660, f2: 990, dur: 0.14, vol: 0.06 });
        }
      }
      if (S.vals.every(Boolean) && !check) toast(win, 'Noch nicht ganz – irgendwo steckt ein Fehler.');
    }

    function finish(from) {
      run(false);
      S.done = true;
      const secs = Math.round(S.elapsed);
      const best = db.get('best', {});
      const old = best[S.level];
      const counts = S.hints === 0;
      const record = counts && (!old || secs < old);
      if (record) { best[S.level] = secs; db.set('best', best); }
      save();
      paint();
      const fr = Math.floor(from / 9), fc = from % 9;
      animate(cells.map((_, i) => [i, Math.hypot(Math.floor(i / 9) - fr, (i % 9) - fc)]), 'is-win', 55);
      if (soundOn()) sfx.chime();
      const text = `${LEVELS[S.level]} in ${fmt(secs)} gelöst.`
        + (record ? (old ? ` Neue Bestzeit – bisher ${fmt(old)}!` : ' Das ist deine erste Bestzeit auf dieser Stufe.')
          : counts ? ` Deine Bestzeit: ${fmt(old)}.` : ` Mit ${S.hints === 1 ? 'einem Hinweis' : `${S.hints} Hinweisen`} – Bestzeiten zählen nur ohne Hilfe.`);
      setTimeout(() => {
        if (closed) return;
        sheet(win, { title: 'Gelöst!', text, cancelValue: false, buttons: [{ label: 'Schließen', value: false }, { label: 'Neues Spiel', value: true, primary: true }] })
          .then((again) => { if (again) newGameSheet(); });
      }, reducedMotion.matches ? 200 : 1300);
    }

    // ---------- Neues Spiel ----------
    async function start(level) {
      const token = ++genToken;
      run(false);
      busy = true;
      paused = false;
      db.set('level', level);
      showCover('Einen Moment …', 'Ein neues Rätsel entsteht.');
      paint();
      await new Promise((r) => setTimeout(r, 30));
      let best = null;
      try {
        for (let n = 0; n < 60 && !closed && token === genToken; n++) {
          const a = core.attempt(level);
          if (!best || a.fits || a.tech > best.tech || (a.tech === best.tech && a.givens < best.givens)) best = a;
          if (a.fits) break;
          await new Promise((r) => setTimeout(r, 0));     // Fenster bleibt bedienbar
        }
      } catch (err) {
        console.error(err);
      }
      if (closed || token !== genToken) return;
      busy = false;
      if (!best) { showCover('Das hat nicht geklappt', 'Bitte versuch es noch einmal.', h('button.kit-btn.primary', { type: 'button', onclick: () => start(level) }, 'Neu erzeugen')); return; }
      S = {
        v: 1, level, puzzle: best.puzzle, solution: best.solution, vals: best.puzzle.slice(),
        notes: new Array(81).fill(0), fixed: new Array(81).fill(0), elapsed: 0, hints: 0, mistakes: 0, done: false,
      };
      undoStack = [];
      redoStack = [];
      sel = S.vals.findIndex((v) => !v);
      for (const c of cells) c._key = null;
      hideCover();
      save();
      paint();
      run(true);
      animate(cells.map((_, i) => [i, Math.floor(i / 9) + (i % 9)]), 'is-flash', 14);
    }

    function newGameSheet() {
      let level = S ? S.level : db.get('level', 0);
      const best = db.get('best', {});
      const about = h('p'), rec = h('small');
      const show = () => { about.textContent = ABOUT[level]; rec.textContent = best[level] ? `Bestzeit: ${fmt(best[level])}` : 'Noch keine Bestzeit'; };
      const seg = h('div.gseg', { 'aria-label': 'Stufe' }, LEVELS.map((name, i) => h('button', { type: 'button', dataset: { value: i }, 'aria-selected': String(i === level) }, name)));
      seg.addEventListener('change', (e) => { level = +e.detail.value; show(); });
      const body = h('div.sudoku-lv', seg, about, rec);
      initControls(body);
      show();
      const running = S && !S.done && undoStack.length > 0;
      sheet(win, {
        title: 'Neues Sudoku', text: running ? 'Das laufende Rätsel wird dabei verworfen.' : '', body, cancelValue: false,
        buttons: [{ label: 'Abbrechen', value: false }, { label: 'Starten', value: true, primary: true }],
      }).then((ok) => { if (ok) start(level); });
    }

    // ---------- Eingabe ----------
    board.addEventListener('pointerdown', (e) => {
      const c = e.target.closest('.sudoku-cell');
      if (c && playable()) select(+c.dataset.i);
    });
    win.el.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea, select, .kit-sheet-wrap') || e.altKey) return;
      const key = e.key.toLowerCase();
      if (e.metaKey || e.ctrlKey) {
        if (key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
        else if (key === 'y') { e.preventDefault(); redo(); }
        return;
      }
      const digit = /^(Digit|Numpad)([0-9])$/.exec(e.code);
      const move = { arrowup: -9, arrowdown: 9, arrowleft: -1, arrowright: 1 }[key];
      if (key === 'p' || (key === ' ' && !e.target.closest('button'))) { e.preventDefault(); setPaused(!paused); }
      else if (!playable()) return;
      else if (move) {
        e.preventDefault();
        const r = Math.floor(sel / 9), c = sel % 9;
        if (move === -9 && r > 0) select(sel - 9);
        else if (move === 9 && r < 8) select(sel + 9);
        else if (move === -1 && c > 0) select(sel - 1);
        else if (move === 1 && c < 8) select(sel + 1);
      } else if (digit) {
        e.preventDefault();
        if (digit[2] === '0') erase(); else enter(+digit[2], notesMode !== e.shiftKey);
      } else if (key === 'backspace' || key === 'delete') { e.preventDefault(); erase(); }
      else if (key === 'n') setNotes(!notesMode);
      else if (key === 'h') hint();
      else if (key === 'u') undo();
      else if (key === 'r') redo();
    });

    // ---------- Start: gespeichertes Rätsel fortsetzen ----------
    const saved = db.get('game', null);
    const ok81 = (a) => Array.isArray(a) && a.length === 81;
    if (saved && ok81(saved.puzzle) && ok81(saved.solution) && ok81(saved.vals) && ok81(saved.notes) && ok81(saved.fixed)) {
      S = { level: 0, elapsed: 0, hints: 0, mistakes: 0, done: false, ...saved };
      sel = Math.max(0, S.vals.findIndex((v) => !v));
      paint();
      if (!S.done) {
        // nach dem Öffnen läuft die Uhr nicht heimlich los
        if (S.elapsed > 0) setPaused(true); else run(true);
      }
    } else start(db.get('level', 0));

    return {
      onFocus: () => { if (!win.el.contains(document.activeElement) || document.activeElement === win.el) board.focus({ preventScroll: true }); },
      onClose: () => { closed = true; genToken++; run(false); save(); clearInterval(timer); },
      menus: () => [{
        label: 'Spiel',
        items: [
          { label: 'Neues Spiel …', icon: 'plus', run: newGameSheet },
          { label: paused ? 'Weiter' : 'Pause', icon: paused ? 'play' : 'pause', hint: 'P', disabled: !S || S.done || busy, run: () => setPaused(!paused) },
          { label: 'Hinweis', icon: 'sparkles', hint: 'H', disabled: !playable(), run: hint },
          '-',
          { label: 'Rückgängig', icon: 'undo', hint: '⌘Z', disabled: !undoStack.length || !playable(), run: undo },
          { label: 'Wiederholen', icon: 'redo', hint: '⇧⌘Z', disabled: !redoStack.length || !playable(), run: redo },
          '-',
          { label: 'Notizen-Modus', hint: 'N', checked: notesMode, run: () => setNotes(!notesMode) },
          { label: 'Fehler prüfen', checked: check, run: () => { check = !check; swCheck.checked = check; db.set('check', check); paint(); } },
        ],
      }],
    };
  },
};
