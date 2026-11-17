// solitaire.js — Patience (Klondike): alle Karten nach Farben geordnet auf die vier Grundstapel legen

import { h, clamp, rand, ticker, reducedMotion } from '../../../core/util.js';
import { initControls } from '../../../core/controls.js';
import { tone, sfx, audioReady } from '../../../core/audio.js';
import { style, appStore, toolBtn, sheet, toast, pad2 } from '../../kit.js';

// ==========================================================================
// Regelwerk ohne DOM. Karte = 0…51: Farbe = id / 13 (0 Pik, 1 Herz, 2 Kreuz, 3 Karo), Wert = id % 13 (0 = Ass).
// Stapel heißen 'stock' (Talon), 'waste' (Ablage), 'f0'…'f3' (Grundstapel je Farbe), 't0'…'t6' (Spalten).
// Das letzte Element eines Stapels liegt oben. down[c] = Zahl der verdeckten Karten in Spalte c.
// ==========================================================================
export function patienceCore() {
  const rank = (id) => id % 13, suit = (id) => (id / 13) | 0, red = (id) => suit(id) & 1;
  const TABS = ['t0', 't1', 't2', 't3', 't4', 't5', 't6'];

  function shuffled() {
    const d = Array.from({ length: 52 }, (_, i) => i);
    for (let i = 51; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [d[i], d[j]] = [d[j], d[i]]; }
    return d;
  }
  function deal(deck, draw = 1) {
    const S = { stock: [], waste: [], found: [[], [], [], []], tab: [], down: [], draw: draw === 3 ? 3 : 1, score: 0 };
    let k = 0;
    for (let c = 0; c < 7; c++) { S.tab.push(deck.slice(k, k + c + 1)); S.down.push(c); k += c + 1; }
    S.stock = deck.slice(k).reverse();
    return S;
  }
  const clone = (S) => ({ ...S, stock: [...S.stock], waste: [...S.waste], found: S.found.map((f) => [...f]), tab: S.tab.map((t) => [...t]), down: [...S.down] });
  const pileOf = (S, name) => (name === 'stock' ? S.stock : name === 'waste' ? S.waste : name[0] === 'f' ? S.found[+name[1]] : S.tab[+name[1]]);

  /** Darf eine Folge, die mit Karte `id` beginnt (n Karten), auf den Stapel `to`? */
  function canPlace(S, id, to, n = 1) {
    if (to[0] === 'f') return n === 1 && suit(id) === +to[1] && rank(id) === S.found[+to[1]].length;
    if (to[0] !== 't') return false;
    const t = S.tab[+to[1]];
    if (!t.length) return rank(id) === 12;                                    // leere Spalte: nur König
    const top = t[t.length - 1];
    return red(top) !== red(id) && rank(top) === rank(id) + 1;                // absteigend, Farbe wechselt
  }
  /** Wie viele Karten lassen sich ab Position `index` aufnehmen? 0 = keine. */
  function grab(S, from, index) {
    const p = pileOf(S, from);
    if (from === 'stock' || index < 0 || index >= p.length) return 0;
    if (from[0] === 't') return index >= S.down[+from[1]] ? p.length - index : 0;
    return index === p.length - 1 ? 1 : 0;
  }
  function legal(S, from, to, n) {
    if (from === to || (from[0] === 'f' && to[0] === 'f')) return false;
    const p = pileOf(S, from);
    return n >= 1 && n <= p.length && grab(S, from, p.length - n) === n && canPlace(S, p[p.length - n], to, n);
  }

  /** Führt einen Zug aus: {t:'d'} ziehen, {t:'r'} Ablage zurück auf den Talon, {t:'m', from, to, n} umlegen. */
  function apply(S, rec) {
    const before = S.score;
    if (rec.t === 'd') {
      const n = Math.min(S.draw, S.stock.length);
      if (!n) return false;
      for (let i = 0; i < n; i++) S.waste.push(S.stock.pop());
      rec.n = n;
    } else if (rec.t === 'r') {
      if (S.stock.length || !S.waste.length) return false;
      rec.n = S.waste.length;
      while (S.waste.length) S.stock.push(S.waste.pop());
      S.score = Math.max(0, S.score - (S.draw === 1 ? 40 : 20));              // jeder weitere Durchgang kostet
    } else {
      if (!legal(S, rec.from, rec.to, rec.n)) return false;
      const src = pileOf(S, rec.from), dst = pileOf(S, rec.to);
      dst.push(...src.splice(src.length - rec.n));
      let ds = rec.to[0] === 'f' ? 10 : rec.from === 'waste' ? 5 : rec.from[0] === 'f' ? -15 : 0;
      rec.flip = false;
      if (rec.from[0] === 't') {
        const c = +rec.from[1];
        if (S.down[c] > 0 && src.length === S.down[c]) { S.down[c]--; rec.flip = true; ds += 5; }    // oberste Karte wird aufgedeckt
      }
      S.score = Math.max(0, S.score + ds);
    }
    rec.prev = before;
    return true;
  }
  function revert(S, rec) {
    if (rec.t === 'd') for (let i = 0; i < rec.n; i++) S.stock.push(S.waste.pop());
    else if (rec.t === 'r') for (let i = 0; i < rec.n; i++) S.waste.push(S.stock.pop());
    else {
      const src = pileOf(S, rec.from), dst = pileOf(S, rec.to);
      if (rec.flip) S.down[+rec.from[1]]++;
      src.push(...dst.splice(dst.length - rec.n));
    }
    S.score = rec.prev;
  }
  const won = (S) => S.found.every((f) => f.length === 13);
  const top = (p) => p[p.length - 1];

  /** Ein möglicher sinnvoller Zug – oder {t:'d'|'r'} für den Talon – oder null. */
  function hint(S) {
    const sources = ['waste', ...TABS];
    for (const from of sources) {                                             // 1. auf einen Grundstapel
      const p = pileOf(S, from);
      if (p.length && canPlace(S, top(p), `f${suit(top(p))}`)) return { t: 'm', from, to: `f${suit(top(p))}`, n: 1 };
    }
    for (let c = 0; c < 7; c++) {                                             // 2. eine verdeckte Karte freilegen
      const n = S.tab[c].length - S.down[c];
      if (!S.down[c] || !n) continue;
      for (const to of TABS) if (legal(S, `t${c}`, to, n)) return { t: 'm', from: `t${c}`, to, n };
    }
    if (S.waste.length) for (const to of TABS) if (legal(S, 'waste', to, 1)) return { t: 'm', from: 'waste', to, n: 1 };   // 3. von der Ablage
    for (let c = 0; c < 7; c++) {                                             // 4. Teilfolge umlegen, wenn darunter eine Karte für den Grundstapel frei wird
      const t = S.tab[c];
      for (let n = 1; n < t.length - S.down[c]; n++) {
        const under = t[t.length - n - 1];
        if (!canPlace(S, under, `f${suit(under)}`)) continue;
        for (const to of TABS) if (legal(S, `t${c}`, to, n)) return { t: 'm', from: `t${c}`, to, n };
      }
    }
    const kingWaits = (S.waste.length && rank(top(S.waste)) === 12) || S.tab.some((t, c) => S.down[c] > 0 && rank(t[S.down[c]]) === 12);
    if (kingWaits) {                                                          // 5. eine Spalte für einen wartenden König räumen
      for (let c = 0; c < 7; c++) {
        const t = S.tab[c];
        if (!t.length || S.down[c] || rank(t[0]) === 12) continue;
        for (const to of TABS) if (pileOf(S, to).length && legal(S, `t${c}`, to, t.length)) return { t: 'm', from: `t${c}`, to, n: t.length };
      }
    }
    // 6. Talon – aber nur, wenn dort überhaupt noch etwas Spielbares liegt
    const useful = [...S.stock, ...S.waste].some((id) => canPlace(S, id, `f${suit(id)}`) || TABS.some((to) => canPlace(S, id, to)));
    if (useful && (S.stock.length || S.waste.length > 1)) return { t: S.stock.length ? 'd' : 'r' };
    return null;
  }

  /** Zugfolge, die das Spiel ohne weiteres Nachdenken beendet (alles liegt offen) – oder null. */
  function autoPlan(S0) {
    if (S0.down.some((d) => d > 0) || won(S0)) return null;
    const S = clone(S0), plan = [];
    let idle = 0;
    for (let guard = 0; guard < 4000 && !won(S); guard++) {
      let rec = null, low = 99;
      for (const from of ['waste', ...TABS]) {
        const p = pileOf(S, from);
        if (p.length && canPlace(S, top(p), `f${suit(top(p))}`) && rank(top(p)) < low) { low = rank(top(p)); rec = { t: 'm', from, to: `f${suit(top(p))}`, n: 1 }; }
      }
      if (rec) idle = 0;
      else {
        if (!S.stock.length && !S.waste.length) return null;
        if (++idle > (S.stock.length + S.waste.length) * 3 + 6) return null;
        rec = { t: S.stock.length ? 'd' : 'r' };
      }
      if (!apply(S, rec)) return null;
      plan.push(rec);
    }
    return won(S) ? plan : null;
  }

  return { rank, suit, red, TABS, shuffled, deal, clone, pileOf, canPlace, grab, legal, apply, revert, won, hint, autoPlan };
}

// ==========================================================================
// Kartenblatt – eigene Zeichnung
// ==========================================================================
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'B', 'D', 'K'];
const RANK_NAMES = ['Ass', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Bube', 'Dame', 'König'];
const SUIT_NAMES = ['Pik', 'Herz', 'Kreuz', 'Karo'];
const SUITS = [
  'M12 2.800c5.200 4.400 9 7.600 9 11.200 0 2.500-1.900 4.300-4.200 4.300-1.500 0-2.800-.7-3.600-1.800.2 2.100 1 3.600 2.400 4.700H8.400c1.400-1.100 2.200-2.600 2.400-4.700-.8 1.100-2.100 1.800-3.600 1.800C4.900 18.300 3 16.500 3 14c0-3.600 3.800-6.800 9-11.200z',
  'M12 20.800C5.600 15.700 3 12.300 3 8.800 3 6 5.100 4 7.700 4c1.700 0 3.300.9 4.300 2.500C13 4.900 14.600 4 16.300 4 18.900 4 21 6 21 8.800c0 3.500-2.600 6.900-9 12z',
  'M12 2.600a4.300 4.300 0 0 1 3.700 6.500 4.300 4.300 0 1 1-1.900 7.300c.3 2 1.100 3.500 2.500 4.800H7.700c1.400-1.300 2.200-2.800 2.500-4.800a4.300 4.300 0 1 1-1.900-7.300A4.300 4.300 0 0 1 12 2.600z',
  'M12 2.400c1.900 3.700 4.300 6.800 7.400 9.600-3.100 2.800-5.500 5.900-7.400 9.600-1.900-3.700-4.300-6.800-7.400-9.600 3.100-2.800 5.500-5.900 7.400-9.600z',
];
// Bildkarten tragen ein schlichtes Zeichen über dem Buchstaben: Federkappe, Diadem, Krone
const CRESTS = [
  '<path d="M4.500 10.500c2.500-.4 5-1.700 7.500-4.500 2.500 2.800 5 4.100 7.500 4.500" fill="none" stroke="currentColor" stroke-width="1.700" stroke-linecap="round"/><circle cx="12" cy="2.800" r="1.500"/>',
  '<path d="M4 10.500c1.500-4.300 4.300-6.500 8-6.500s6.500 2.200 8 6.500" fill="none" stroke="currentColor" stroke-width="1.700" stroke-linecap="round"/><circle cx="12" cy="2" r="1.400"/><circle cx="6.300" cy="4.300" r="1.100"/><circle cx="17.700" cy="4.300" r="1.100"/>',
  '<path d="M4 11V3.500l4.200 3.700L12 1.500l3.800 5.700L20 3.500V11z"/>',
];
const suitSvg = (s, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${SUITS[s]}"/></svg>`;
function faceHtml(id) {
  const r = id % 13, s = (id / 13) | 0;
  const idx = `<span class="sol-idx">${RANKS[r]}${suitSvg(s)}</span>`;
  const mid = r >= 10
    ? `<span class="sol-court"><svg viewBox="0 0 24 12" aria-hidden="true">${CRESTS[r - 10]}</svg><b>${RANKS[r]}</b>${suitSvg(s)}</span>`
    : suitSvg(s, `sol-pip${r === 0 ? ' ace' : ''}`);
  return idx + mid + idx.replace('sol-idx', 'sol-idx b');
}
const RECYCLE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.500 12a7.500 7.500 0 1 1-2.200-5.300" fill="none" stroke="currentColor" stroke-width="1.800" stroke-linecap="round"/><path d="M19.500 4.500v4.500H15" fill="none" stroke="currentColor" stroke-width="1.800" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const fmt = (s) => { s = Math.floor(s); return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`; };

style('solitaire', `
.sol { display: flex; flex-direction: column; flex: 1; min-height: 0; --sol-red: #de3552; --sol-ink: #1c2040; }
.sol-top { display: flex; align-items: center; gap: 16px; flex: none; height: 38px; padding: 8px 16px 0; font-size: 12.5px; font-weight: 600; color: var(--fg-3); white-space: nowrap; }
.sol-top b { margin-left: 5px; font: 700 15px/1 var(--font-round); font-variant-numeric: tabular-nums; color: var(--fg); }
.sol-top .sp { flex: 1; }
.sol-board { position: relative; flex: 1; min-height: 0; overflow: hidden; outline: 0; touch-action: none; --cw: 80px; --ch: 114px; }
.sol-slot { position: absolute; left: 0; top: 0; display: grid; place-items: center; width: var(--cw); height: var(--ch); border-radius: calc(var(--cw) * .1); background: var(--well); box-shadow: inset 0 0 0 1.500px var(--line); color: var(--fg-4); transition: box-shadow .2s; }
.sol-slot svg { width: 40%; height: 40%; fill: currentColor; opacity: .7; }
.sol-slot[data-pile="stock"] { cursor: pointer; }
.sol-slot.is-target, .sol-card.is-target .sol-face { box-shadow: 0 0 0 2.500px var(--accent), 0 0 0 6px color-mix(in srgb, var(--accent) 32%, transparent); }
.sol-slot.is-cursor, .sol-card.is-cursor .sol-face, .sol-card.is-cursor .sol-back { box-shadow: 0 0 0 2.500px #fff, 0 0 0 5px var(--accent); }
.sol-card { position: absolute; left: 0; top: 0; width: var(--cw); height: var(--ch); perspective: 700px; font-size: calc(var(--cw) * .235); transition: transform .34s var(--ease-out) var(--dl, 0ms); will-change: transform; -webkit-tap-highlight-color: transparent; }
.sol-card.no-anim, .sol-card.no-anim .sol-in { transition: none; }
.sol-in { position: absolute; inset: 0; transform-style: preserve-3d; transform: rotateY(180deg); transition: transform .44s var(--ease-out) var(--dl, 0ms); }
.sol-card.is-up .sol-in { transform: none; }
.sol-face, .sol-back { position: absolute; inset: 0; overflow: hidden; border-radius: calc(var(--cw) * .1); backface-visibility: hidden; -webkit-backface-visibility: hidden; box-shadow: 0 1px 2.500px rgba(0, 0, 20, .4), 0 0 0 .5px rgba(0, 0, 20, .28); transition: box-shadow .2s; }
.sol-face { background: linear-gradient(165deg, #fff 0%, #fdfcf7 55%, #efece3 100%); color: var(--sol-ink); }
.sol-face.red { color: var(--sol-red); }
.sol-face svg { fill: currentColor; }
.sol-back { transform: rotateY(180deg); background:
  radial-gradient(circle at 50% 50%, rgba(255, 255, 255, .34) 0 17%, transparent 18%),
  radial-gradient(circle at 50% 50%, transparent 0 25%, rgba(255, 255, 255, .22) 26% 28.500%, transparent 29.500%),
  repeating-linear-gradient(45deg, rgba(255, 255, 255, .1) 0 2px, transparent 2px 9px),
  repeating-linear-gradient(-45deg, rgba(255, 255, 255, .1) 0 2px, transparent 2px 9px),
  linear-gradient(155deg, color-mix(in srgb, var(--accent) 86%, #fff), color-mix(in srgb, var(--accent) 62%, #2a1a6e)); }
.sol-back::after { content: ""; position: absolute; inset: 5%; border-radius: calc(var(--cw) * .065); box-shadow: inset 0 0 0 1.500px rgba(255, 255, 255, .55), inset 0 0 12px rgba(255, 255, 255, .18); background: linear-gradient(160deg, rgba(255, 255, 255, .28), transparent 42%); }
.sol-idx { position: absolute; left: 7%; top: 4.500%; display: flex; align-items: center; gap: .1em; font: 800 1em/1 var(--font-round); letter-spacing: -.05em; }
.sol-idx svg { width: .8em; height: .8em; }
.sol-idx.b { left: auto; top: auto; right: 7%; bottom: 4.500%; transform: rotate(180deg); }
.sol-pip { position: absolute; left: 50%; top: 53%; width: 44%; height: auto; aspect-ratio: 1; translate: -50% -50%; }
.sol-pip.ace { width: 58%; filter: drop-shadow(0 2px 3px rgba(0, 0, 20, .22)); }
.sol-court { position: absolute; inset: 21% 15% 19%; display: grid; place-content: center; justify-items: center; gap: .08em; border-radius: 14%; background: color-mix(in srgb, currentColor 8%, transparent); box-shadow: inset 0 0 0 1.500px color-mix(in srgb, currentColor 34%, transparent); }
.sol-court b { font: 800 1.750em/1 var(--font-round); }
.sol-court svg { width: 1.250em; height: .62em; }
.sol-court svg:last-child { width: .82em; height: .82em; }
.sol-card.is-drag { transition: transform .09s linear; --dl: 0ms; }
.sol-card.is-drag.lead { transition: none; }
.sol-card.is-drag .sol-face { box-shadow: 0 16px 30px -8px rgba(0, 0, 20, .6), 0 0 0 .5px rgba(0, 0, 20, .28); }
.sol-card.is-held .sol-face { box-shadow: 0 0 0 2.500px var(--accent), 0 10px 22px -6px rgba(0, 0, 20, .55); }
.sol-card.is-hint .sol-face, .sol-card.is-hint .sol-back, .sol-slot.is-hint { animation: sol-hint .55s ease-in-out 3 alternate; }
@keyframes sol-hint { to { box-shadow: 0 0 0 3px var(--c-amber), 0 0 18px 6px color-mix(in srgb, var(--c-amber) 70%, transparent); } }
.sol-card.is-nudge { animation: sol-nudge .3s; }
@keyframes sol-nudge { 25% { translate: -5px 0; } 75% { translate: 5px 0; } }
.sol-fx { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 4000; pointer-events: none; }
.sol-fx.is-on { pointer-events: auto; cursor: pointer; }
.sol-auto { position: absolute; left: 0; right: 0; bottom: 16px; z-index: 3500; width: fit-content; margin-inline: auto; box-shadow: 0 12px 30px -8px rgba(0, 0, 14, .6), inset 0 1px 0 rgba(255, 255, 255, .35); animation: sol-pop .5s var(--spring-soft) both; }
@keyframes sol-pop { from { opacity: 0; translate: 0 14px; scale: .9; } }
.sol-result { position: absolute; inset: 0; z-index: 4500; display: grid; place-items: center; padding: 12px; overflow: auto; }
.sol-result > div { display: grid; justify-items: center; gap: 10px; width: min(320px, 100%); padding: 22px 22px 18px; border-radius: 22px; text-align: center; background: color-mix(in srgb, var(--solid) 82%, transparent); -webkit-backdrop-filter: blur(22px) saturate(150%); backdrop-filter: blur(22px) saturate(150%); box-shadow: 0 30px 70px -24px rgba(0, 0, 14, .8), inset 0 0 0 .5px var(--glass-edge); animation: sol-pop .55s var(--spring-soft) both; }
.sol-result h2 { font: 800 28px/1.1 var(--font-round); letter-spacing: -.02em; }
.sol-result p { font-size: 13px; color: var(--fg-2); text-wrap: balance; }
.sol-rows { display: grid; grid-template-columns: 1fr auto; gap: 5px 18px; width: 100%; padding: 10px 14px; border-radius: 13px; background: var(--well); font-size: 13px; text-align: left; }
.sol-rows span { color: var(--fg-3); }
.sol-rows b { font-variant-numeric: tabular-nums; text-align: right; }
.sol-opts { display: grid; gap: 8px; }
.sol-opts .gseg { display: flex; }
.sol-opts small { font-size: 12px; color: var(--fg-3); }
@container win (max-width: 500px) {
  .sol-top { gap: 10px; padding: 8px 12px 0; }
  .sol-mode { display: none; }
}
`);

const db = appStore('solitaire');
const soundOn = () => sfx.enabled && audioReady();
let suitPaths = null;

export default {
  singleton: true,
  width: 820, height: 640, minW: 440, minH: 430,

  mount(win) {
    const core = patienceCore();
    let S = null, deck = null, history = [];
    let elapsed = 0, running = false, counted = false, done = false, busy = false, closed = false;
    let M = null;                              // Maße der aktuellen Auslage
    let where = [], prevPile = [];
    let dragging = null, lastTap = { id: -1, t: 0 };
    let kb = { on: false, row: 1, col: 0, held: null };
    let fx = null, autoTimer = 0, lastTick = performance.now();
    const timers = new Set();
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!closed) fn(); }, ms); timers.add(id); return id; };

    // ---------- Aufbau ----------
    const scoreEl = h('b', '0'), movesEl = h('b', '0'), timeEl = h('b', '00:00'), modeEl = h('span.sol-mode');
    const board = h('div.sol-board', { tabIndex: 0, role: 'application', 'aria-label': 'Spieltisch' });
    const slots = {};
    for (const name of ['stock', 'waste', 'f0', 'f1', 'f2', 'f3', ...core.TABS]) {
      slots[name] = h('div.sol-slot', { dataset: { pile: name }, html: name === 'stock' ? RECYCLE : name[0] === 'f' ? suitSvg(+name[1]) : '' });
      board.append(slots[name]);
    }
    const els = Array.from({ length: 52 }, (_, id) => {
      const el = h('div.sol-card', { dataset: { id }, 'aria-label': `${SUIT_NAMES[core.suit(id)]} ${RANK_NAMES[core.rank(id)]}` },
        h('div.sol-in', h('div', { class: `sol-face${core.red(id) ? ' red' : ''}`, html: faceHtml(id) }), h('div.sol-back')));
      board.append(el);
      return el;
    });
    const canvas = h('canvas.sol-fx', { 'aria-hidden': 'true' });
    board.append(canvas);
    const bHint = toolBtn('sparkles', 'Hinweis (H)', () => { showHint(); board.focus({ preventScroll: true }); });
    const bUndo = toolBtn('undo', 'Rückgängig (Z)', () => { undo(); board.focus({ preventScroll: true }); });
    win.tools.append(bHint, bUndo, toolBtn('plus', 'Neues Spiel (N)', () => newGameSheet()));
    win.body.append(h('div.sol',
      h('div.sol-top', h('span', 'Punkte', scoreEl), h('span', 'Züge', movesEl), h('span', 'Zeit', timeEl), h('span.sp'), modeEl),
      board));

    /** Verschwindet ein Knopf, der den Fokus hatte, gehören die Tasten wieder dem Spieltisch. */
    const refocus = () => { if (win.wm.focused === win && !win.el.querySelector('.kit-sheet-wrap')) board.focus({ preventScroll: true }); };

    // ---------- Auslage berechnen und anwenden ----------
    function measure() {
      const W = board.clientWidth, H = board.clientHeight;
      if (!W || !H) return null;
      const pad = W < 520 ? 8 : 16;
      const gap = clamp(W * 0.014, 5, 14);
      const cw = clamp(Math.min((W - pad * 2 - gap * 6) / 7, (H - pad * 2 - 90) / 2.98), 30, 116);
      const ch = cw * 1.42;
      const x0 = (W - (cw * 7 + gap * 6)) / 2;
      return { W, H, pad, gap, cw, ch, x: (c) => x0 + c * (cw + gap), topY: pad, tabY: pad + ch + Math.max(10, ch * 0.13), fd: clamp(ch * 0.11, 5, 16), fu: clamp(ch * 0.25, 14, 36) };
    }
    /** Abstand der Karten in einer Spalte – rückt zusammen, wenn die Spalte sonst nicht ins Fenster passt. */
    function fan(c) {
      const up = S.tab[c].length - S.down[c];
      const need = S.down[c] * M.fd + Math.max(0, up - 1) * M.fu;
      const room = M.H - M.tabY - M.ch - M.pad;
      const k = need > room ? Math.max(0.3, room / need) : 1;
      return { fd: M.fd * k, fu: M.fu * k };
    }
    const slotXY = (name) => (name === 'stock' ? [M.x(0), M.topY] : name === 'waste' ? [M.x(1), M.topY] : name[0] === 'f' ? [M.x(3 + +name[1]), M.topY] : [M.x(+name[1]), M.tabY]);
    function cardXY(name, i) {
      const p = core.pileOf(S, name);
      const [x, y] = slotXY(name);
      if (name === 'stock') { const d = Math.min(i, 5) * 0.4; return [x - d, y - d]; }
      if (name === 'waste') {
        const shown = S.draw === 3 ? Math.min(3, p.length) : 1;
        return [x + Math.max(0, i - (p.length - shown)) * M.cw * 0.42, y];
      }
      if (name[0] === 'f') return [x, y];
      const c = +name[1], f = fan(c);
      return [x, y + Math.min(i, S.down[c]) * f.fd + Math.max(0, i - S.down[c]) * f.fu];
    }
    const BASE = { stock: 0, waste: 100, f: 200, t: 300 };
    function layout({ instant = false, stagger = 0 } = {}) {
      M = measure();
      if (!M || !S) return;
      board.style.setProperty('--cw', `${M.cw.toFixed(2)}px`);
      board.style.setProperty('--ch', `${M.ch.toFixed(2)}px`);
      for (const name in slots) { const [x, y] = slotXY(name); slots[name].style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; }
      let order = 0;
      for (const name of ['stock', 'waste', 'f0', 'f1', 'f2', 'f3', ...core.TABS]) {
        const p = core.pileOf(S, name);
        const base = BASE[name] ?? BASE[name[0]];
        p.forEach((id, i) => {
          const el = els[id];
          const [x, y] = cardXY(name, i);
          const up = name !== 'stock' && !(name[0] === 't' && i < S.down[+name[1]]);
          where[id] = { pile: name, index: i };
          el.classList.toggle('no-anim', instant);
          el.classList.remove('is-drag', 'lead');
          if (stagger && name !== 'stock') el.style.setProperty('--dl', `${(order++) * stagger}ms`); else el.style.removeProperty('--dl');
          el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
          el.classList.toggle('is-up', up);
          el.hidden = false;
          // unterwegs liegen Karten über allem, danach in Stapelreihenfolge
          if (prevPile[id] !== undefined && prevPile[id] !== name && !instant) {
            el.style.zIndex = 2000 + i;
            later(() => { if (where[id]?.pile === name) el.style.zIndex = base + where[id].index; }, 350 + stagger * 30);
          } else el.style.zIndex = base + i;
          prevPile[id] = name;
        });
      }
      if (instant) { void board.offsetWidth; for (const el of els) el.classList.remove('no-anim'); }
      if (stagger) later(() => { for (const el of els) el.style.removeProperty('--dl'); }, 30 * stagger + 480);
      slots.stock.classList.toggle('is-empty', !S.stock.length);
      paintMarks();
    }
    function paintStats() {
      scoreEl.textContent = S.score.toLocaleString('de-DE');
      movesEl.textContent = String(history.length);
      timeEl.textContent = fmt(elapsed);
      modeEl.textContent = S.draw === 3 ? 'Drei Karten' : 'Eine Karte';
      bUndo.disabled = !history.length || busy || done;
      bHint.disabled = busy || done;
    }

    // ---------- Speichern ----------
    function save() {
      if (!S) return;
      db.set('game', { v: 1, deck, draw: S.draw, moves: history.map((r) => (r.t === 'm' ? { t: 'm', from: r.from, to: r.to, n: r.n } : { t: r.t })), elapsed: Math.round(elapsed), counted, done });
    }
    const stats = () => ({ played: 0, won: 0, streak: 0, bestTime: 0, bestScore: 0, ...db.get('stats', {}) });

    // ---------- Töne ----------
    function sound(kind, id = 0) {
      if (!soundOn()) return;
      if (kind === 'place') tone({ type: 'triangle', f: 250, f2: 170, dur: 0.06, vol: 0.1 });
      else if (kind === 'found') tone({ type: 'triangle', f: 330 * 2 ** (core.rank(id) / 12), dur: 0.16, vol: 0.09 });
      else if (kind === 'draw') tone({ type: 'triangle', f: 900, f2: 520, dur: 0.045, vol: 0.05 });
      else if (kind === 'flip') tone({ type: 'triangle', f: 620, f2: 880, dur: 0.05, vol: 0.04, when: 0.12 });
      else if (kind === 'deal') for (let i = 0; i < 7; i++) tone({ type: 'triangle', f: 700 + i * 40, f2: 420, dur: 0.04, vol: 0.04, when: i * 0.07 });
    }

    // ---------- Züge ----------
    const freeNow = () => !busy && !done && S;
    function act(rec, quiet = false) {
      if (!core.apply(S, rec)) return false;
      history.push(rec);
      if (!running && !done) running = true;
      if (!counted) { counted = true; const st = stats(); st.played++; db.set('stats', st); }
      kb.held = null;
      if (!quiet) {
        if (rec.t === 'm') { sound(rec.to[0] === 'f' ? 'found' : 'place', core.pileOf(S, rec.to).at(-1)); if (rec.flip) sound('flip'); }
        else sound('draw');
      }
      save();
      layout();
      paintStats();
      if (core.won(S)) later(victory, 380);
      else if (!busy) offerAuto();
      return true;
    }
    function undo() {
      if (!freeNow() || !history.length) return;
      const rec = history.pop();
      core.revert(S, rec);
      kb.held = null;
      if (soundOn()) sfx.tick();
      save();
      layout();
      paintStats();
      offerAuto();
    }
    function drawStock() {
      if (!freeNow()) return;
      if (S.stock.length) act({ t: 'd' });
      else if (S.waste.length) act({ t: 'r' });
    }
    function nudge(id) {
      const el = els[id];
      if (!el) return;
      el.classList.remove('is-nudge');
      void el.offsetWidth;
      el.classList.add('is-nudge');
      later(() => el.classList.remove('is-nudge'), 320);
    }
    /** Doppelklick: oberste Karte auf ihren Grundstapel. */
    function toFoundation(id) {
      const w = where[id];
      if (!freeNow() || !w || core.grab(S, w.pile, w.index) !== 1 || w.pile[0] === 'f') return false;
      if (act({ t: 'm', from: w.pile, to: `f${core.suit(id)}`, n: 1 })) return true;
      nudge(id);
      return false;
    }

    function mark(cls, ids = [], slotNames = []) {
      for (const el of board.querySelectorAll(`.${cls}`)) el.classList.remove(cls);
      for (const id of ids) els[id].classList.add(cls);
      for (const n of slotNames) slots[n].classList.add(cls);
    }
    /** Markiert einen Stapel: seine oberste Karte oder – wenn leer – den Platzhalter. */
    const pileMark = (name) => { const p = core.pileOf(S, name); return p.length ? [[p.at(-1)], []] : [[], [name]]; };
    function showHint() {
      if (!freeNow()) return;
      const m = core.hint(S);
      if (!m) { toast(win, 'Kein Zug mehr zu sehen – vielleicht hilft Rückgängig.', 2600); return; }
      let ids = [], names = [];
      if (m.t === 'm') {
        const p = core.pileOf(S, m.from);
        ids = p.slice(p.length - m.n);
        const [i2, n2] = pileMark(m.to);
        ids.push(...i2); names = n2;
      } else if (S.stock.length) ids = [S.stock.at(-1)];
      else names = ['stock'];
      mark('is-hint', ids, names);
      later(() => mark('is-hint'), 1750);
      if (soundOn()) tone({ f: 880, f2: 1320, dur: 0.12, vol: 0.05 });
    }

    // ---------- Automatisch fertigstellen ----------
    function offerAuto() {
      board.querySelector('.sol-auto')?.remove();
      if (!S || done || busy || !core.autoPlan(S)) return;
      board.append(h('button.kit-btn.primary.big.round.sol-auto', { type: 'button', onclick: () => runAuto() }, 'Fertigstellen'));
    }
    function runAuto() {
      const plan = freeNow() && core.autoPlan(S);
      if (!plan) return;
      board.querySelector('.sol-auto')?.remove();
      refocus();
      busy = true;
      paintStats();
      let i = 0;
      const next = () => {
        if (closed) return;
        if (i >= plan.length) { busy = false; paintStats(); return; }
        const rec = plan[i++];
        act({ t: rec.t, from: rec.from, to: rec.to, n: rec.n });
        autoTimer = later(next, rec.t === 'm' ? 95 : 55);
      };
      next();
    }

    // ---------- Sieg ----------
    function victory() {
      if (done) return;
      done = true;
      running = false;
      busy = false;
      clearTimeout(autoTimer);
      board.querySelector('.sol-auto')?.remove();
      const secs = Math.round(elapsed);
      const bonus = Math.max(0, 600 - secs);
      const total = S.score + bonus;
      const st = stats();
      st.won++;
      st.streak++;
      const bestT = !st.bestTime || secs < st.bestTime, bestS = total > st.bestScore;
      if (bestT) st.bestTime = secs;
      if (bestS) st.bestScore = total;
      db.set('stats', st);
      save();
      paintStats();
      if (soundOn()) sfx.chime();
      fountain(() => showResult({ secs, bonus, total, bestT, bestS, st }));
    }
    function showResult(r) {
      board.querySelector('.sol-result')?.remove();
      const rows = r
        ? [['Zeit', fmt(r.secs) + (r.bestT ? ' · Bestzeit!' : '')], ['Züge', String(history.length)], ['Punkte', `${S.score} + ${r.bonus} Zeitbonus`], ['Gesamt', r.total.toLocaleString('de-DE') + (r.bestS ? ' · Rekord!' : '')], ['Siege', `${r.st.won} von ${r.st.played} · Serie ${r.st.streak}`]]
        : [['Zeit', fmt(elapsed)], ['Züge', String(history.length)], ['Punkte', S.score.toLocaleString('de-DE')]];
      board.append(h('div.sol-result', h('div', { role: 'dialog', 'aria-label': 'Gewonnen' },
        h('h2.grad-text', 'Gewonnen!'),
        h('p', 'Alle 52 Karten liegen auf den Grundstapeln.'),
        h('div.sol-rows', rows.flatMap(([k, v]) => [h('span', k), h('b', v)])),
        h('button.kit-btn.primary.big.round', { type: 'button', onclick: () => start(S.draw) }, 'Neues Spiel'))));
    }
    /** Karten-Fontäne: die Grundstapel werfen ihre Karten in hohem Bogen aus – König zuerst. */
    function stopFx() {
      if (fx) { ticker.remove(fx); fx = null; }
      canvas.classList.remove('is-on');
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    }
    function fountain(after) {
      stopFx();
      if (reducedMotion.matches || !M) { after(); return; }
      suitPaths ||= SUITS.map((d) => new Path2D(d));
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const { W, H, cw, ch } = M;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      const ctx = canvas.getContext('2d');
      const font = getComputedStyle(board).fontFamily;
      const queue = [];
      for (let r = 12; r >= 0; r--) for (let s = 0; s < 4; s++) queue.push(s * 13 + r);
      const fly = [];
      let t = 0, shot = 0;
      const finish = () => { stopFx(); for (const el of els) el.hidden = false; after(); };
      canvas.classList.add('is-on');
      canvas.onclick = finish;
      fx = (dt) => {
        if (win.min) return;
        t += dt;
        while (shot < queue.length && t > shot * 0.075) {
          const id = queue[shot++];
          const [sx, sy] = slotXY(`f${core.suit(id)}`);
          els[id].hidden = true;
          const dir = sx + cw / 2 > W / 2 ? -1 : 1;
          fly.push({ id, x: sx + cw / 2, y: sy + ch / 2, vx: dir * rand(0.12, 0.62) * W, vy: -rand(0.25, 0.75) * H, rot: 0, vr: rand(-5, 5), bounced: false });
          if (soundOn() && shot % 4 === 1) tone({ type: 'triangle', f: 520 + (shot % 13) * 45, dur: 0.09, vol: 0.035 });
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        for (const c of fly) {
          c.vy += H * 2.3 * dt;
          c.x += c.vx * dt;
          c.y += c.vy * dt;
          c.rot += c.vr * dt;
          if (!c.bounced && c.y > H - ch / 2 && c.vy > 0) { c.bounced = true; c.y = H - ch / 2; c.vy *= -0.55; c.vr *= 1.4; }
          const r = c.id % 13, s = (c.id / 13) | 0;
          ctx.save();
          ctx.translate(c.x, c.y);
          ctx.rotate(c.rot);
          ctx.shadowColor = 'rgba(0, 0, 20, .4)';
          ctx.shadowBlur = 10;
          ctx.shadowOffsetY = 3;
          ctx.fillStyle = '#fdfcf7';
          ctx.beginPath();
          ctx.roundRect(-cw / 2, -ch / 2, cw, ch, cw * 0.1);
          ctx.fill();
          ctx.shadowColor = 'transparent';
          ctx.fillStyle = s & 1 ? '#de3552' : '#1c2040';
          ctx.font = `800 ${cw * 0.235}px ${font}`;
          ctx.textBaseline = 'top';
          ctx.fillText(RANKS[r], -cw / 2 + cw * 0.07, -ch / 2 + ch * 0.045);
          const k = (cw * 0.46) / 24;
          ctx.translate(-12 * k, -12 * k + ch * 0.03);
          ctx.scale(k, k);
          ctx.fill(suitPaths[s]);
          ctx.restore();
        }
        for (let i = fly.length - 1; i >= 0; i--) if (fly[i].y > H + ch || fly[i].x < -cw || fly[i].x > W + cw) fly.splice(i, 1);
        if (shot >= queue.length && !fly.length) finish();
      };
      ticker.add(fx);
    }

    // ---------- Neues Spiel ----------
    function start(draw, sameDeck = false) {
      stopFx();
      clearTimeout(autoTimer);
      board.querySelector('.sol-result')?.remove();
      board.querySelector('.sol-auto')?.remove();
      if (S && counted && !done) { const st = stats(); st.streak = 0; db.set('stats', st); }        // abgebrochen: die Serie reißt
      if (!sameDeck || !deck) deck = core.shuffled();
      S = core.deal(deck, draw);
      history = [];
      elapsed = 0;
      running = false;
      counted = false;
      done = false;
      busy = false;
      kb.held = null;
      db.set('draw', S.draw);
      save();
      // erst alles auf den Talon, dann austeilen
      const real = S;
      S = { ...real, stock: [...real.tab.flat().reverse(), ...real.stock].reverse(), tab: real.tab.map(() => []), down: real.down.map(() => 0) };
      prevPile = [];
      layout({ instant: true });
      S = real;
      requestAnimationFrame(() => { if (!closed && S === real) { layout({ stagger: reducedMotion.matches ? 0 : 16 }); sound('deal'); } });
      paintStats();
      refocus();
    }
    function newGameSheet() {
      let draw = S ? S.draw : db.get('draw', 1);
      const seg = h('div.gseg', { 'aria-label': 'Karten vom Talon' },
        h('button', { type: 'button', dataset: { value: 1 }, 'aria-selected': String(draw === 1) }, 'Eine Karte ziehen'),
        h('button', { type: 'button', dataset: { value: 3 }, 'aria-selected': String(draw === 3) }, 'Drei Karten ziehen'));
      seg.addEventListener('change', (e) => { draw = +e.detail.value; });
      const body = h('div.sol-opts', seg, h('small', 'Mit drei Karten ist nur jede dritte Karte des Talons erreichbar – das ist deutlich kniffliger.'));
      initControls(body);
      sheet(win, {
        title: 'Neues Spiel', wide: true, text: history.length && !done ? 'Das laufende Spiel wird beendet und zählt als nicht gewonnen.' : '', body, cancelValue: null,
        buttons: [{ label: 'Abbrechen', value: null }, { label: 'Dieses Spiel neu starten', value: 'again' }, { label: 'Neu mischen', value: 'new', primary: true }],
      }).then((v) => { if (v) start(draw, v === 'again'); });
    }
    function statsSheet() {
      const st = stats();
      const body = h('div.sol-rows',
        h('span', 'Gespielt'), h('b', String(st.played)),
        h('span', 'Gewonnen'), h('b', st.played ? `${st.won} (${Math.round((st.won / st.played) * 100)} %)` : '0'),
        h('span', 'Aktuelle Serie'), h('b', String(st.streak)),
        h('span', 'Bestzeit'), h('b', st.bestTime ? fmt(st.bestTime) : '–'),
        h('span', 'Höchste Punktzahl'), h('b', st.bestScore ? st.bestScore.toLocaleString('de-DE') : '–'));
      sheet(win, { title: 'Statistik', body, cancelValue: false, buttons: [{ label: 'Zurücksetzen', value: 'reset' }, { label: 'Fertig', value: false, primary: true }] })
        .then((v) => { if (v === 'reset') db.del('stats'); });
    }

    // ---------- Zeiger: Klicken, Doppelklick, Ziehen ----------
    const boardXY = (e) => { const r = board.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    function targetsFor(from, n) {
      const out = [];
      for (const to of ['f0', 'f1', 'f2', 'f3', ...core.TABS]) if (core.legal(S, from, to, n)) out.push(to);
      return out;
    }
    board.addEventListener('pointerdown', (e) => {
      if (e.button && e.pointerType === 'mouse') return;
      if (e.target.closest('button, .sol-result, .sol-fx')) return;
      if (kb.on) { kb.on = false; kb.held = null; paintMarks(); }
      if (!freeNow()) return;
      const cardEl = e.target.closest('.sol-card');
      const slotEl = e.target.closest('.sol-slot');
      const [px, py] = boardXY(e);
      if (cardEl) {
        const id = +cardEl.dataset.id, w = where[id];
        if (!w) return;
        if (w.pile === 'stock') dragging = { stock: true, x0: px, y0: py, pid: e.pointerId };
        else {
          const n = core.grab(S, w.pile, w.index);
          const p = core.pileOf(S, w.pile);
          const [cx, cy] = cardXY(w.pile, w.index);
          dragging = { id, from: w.pile, n, ids: n ? p.slice(p.length - n) : [], x0: px, y0: py, ox: px - cx, oy: py - cy, moved: false, pid: e.pointerId, targets: [] };
        }
      } else if (slotEl?.dataset.pile === 'stock') dragging = { stock: true, x0: px, y0: py, pid: e.pointerId };
      else return;
      try { board.setPointerCapture(e.pointerId); } catch { /* egal */ }
    });
    board.addEventListener('pointermove', (e) => {
      const d = dragging;
      if (!d || d.stock || !d.n || e.pointerId !== d.pid) return;
      const [px, py] = boardXY(e);
      if (!d.moved) {
        if (Math.hypot(px - d.x0, py - d.y0) < 6) return;
        d.moved = true;
        d.targets = targetsFor(d.from, d.n);
        const ids = [], names = [];
        for (const t of d.targets) { const [a, b] = pileMark(t); ids.push(...a); names.push(...b); }
        mark('is-target', ids, names);
        d.ids.forEach((id, k) => { els[id].classList.add('is-drag'); els[id].classList.toggle('lead', k === 0); els[id].style.zIndex = 3000 + k; });
      }
      const x = clamp(px - d.ox, -M.cw * 0.5, M.W - M.cw * 0.5), y = clamp(py - d.oy, -M.ch * 0.3, M.H - M.ch * 0.4);
      d.x = x;
      d.y = y;
      d.ids.forEach((id, k) => { els[id].style.transform = `translate3d(${x.toFixed(1)}px, ${(y + k * M.fu).toFixed(1)}px, 0)`; });
    });
    const dropTarget = (d) => {
      let best = null, area = 0;
      for (const to of d.targets) {
        const p = core.pileOf(S, to);
        const [tx, ty] = p.length ? cardXY(to, p.length - 1) : slotXY(to);
        const th = to[0] === 't' ? M.H - ty : M.ch;            // Spalten nehmen die Karte auf ganzer Länge an
        const ow = Math.min(d.x + M.cw, tx + M.cw) - Math.max(d.x, tx), oh = Math.min(d.y + M.ch, ty + th) - Math.max(d.y, ty);
        if (ow > 0 && oh > 0 && ow * oh > area) { area = ow * oh; best = to; }
      }
      return best;
    };
    const endDrag = (e) => {
      const d = dragging;
      if (!d || e.pointerId !== d.pid) return;
      dragging = null;
      mark('is-target');
      if (e.type === 'pointercancel') { layout(); return; }
      if (d.stock) { const [px, py] = boardXY(e); if (Math.hypot(px - d.x0, py - d.y0) < 12) drawStock(); return; }
      if (d.moved) {
        const to = dropTarget(d);
        if (!to || !act({ t: 'm', from: d.from, to, n: d.n })) layout();
        return;
      }
      // Klick ohne Ziehen: zweiter Klick auf dieselbe Karte = Doppelklick
      const now = performance.now();
      if (lastTap.id === d.id && now - lastTap.t < 420) { lastTap = { id: -1, t: 0 }; toFoundation(d.id); }
      else { lastTap = { id: d.id, t: now }; if (!d.n) nudge(d.id); }
    };
    board.addEventListener('pointerup', endDrag);
    board.addEventListener('pointercancel', endDrag);

    // ---------- Tastatur: Cursor über die Stapel, Enter nimmt auf und legt ab ----------
    const kbPile = () => (kb.row === 1 ? `t${kb.col}` : kb.col === 0 ? 'stock' : kb.col === 1 ? 'waste' : kb.col >= 3 ? `f${kb.col - 3}` : null);
    function paintMarks() {
      mark('is-cursor');
      mark('is-held');
      if (!kb.on || !S) return;
      const name = kbPile();
      if (name) { const [ids, names] = pileMark(name); mark('is-cursor', ids, names); }
      if (kb.held) { const p = core.pileOf(S, kb.held.from); mark('is-held', p.slice(p.length - kb.held.n)); }
    }
    function kbEnter() {
      const name = kbPile();
      if (!name || !freeNow()) return;
      const p = core.pileOf(S, name);
      if (kb.held) {
        if (name === kb.held.from) {
          // noch einmal auf demselben Stapel: eine Karte mehr aus der Folge, am Ende wieder loslassen
          const max = name[0] === 't' ? p.length - S.down[+name[1]] : 1;
          kb.held = kb.held.n < max ? { from: name, n: kb.held.n + 1 } : null;
        } else if (!act({ t: 'm', from: kb.held.from, to: name, n: kb.held.n })) { if (p.length) nudge(p.at(-1)); }
      } else if (name === 'stock') drawStock();
      else if (p.length && core.grab(S, name, p.length - 1)) kb.held = { from: name, n: 1 };
      paintMarks();
    }
    win.el.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea, select, .kit-sheet-wrap') || e.altKey) return;
      const key = e.key.toLowerCase();
      if (e.metaKey || e.ctrlKey) { if (key === 'z') { e.preventDefault(); undo(); } return; }
      const move = { arrowleft: [0, -1], arrowright: [0, 1], arrowup: [-1, 0], arrowdown: [1, 0] }[key];
      if (move) {
        e.preventDefault();
        if (kb.on) {
          if (move[0]) { kb.row = clamp(kb.row + move[0], 0, 1); if (kb.row === 0 && kb.col === 2) kb.col = 1; }
          else { kb.col = clamp(kb.col + move[1], 0, 6); if (kb.row === 0 && kb.col === 2) kb.col += move[1]; }
        }
        kb.on = true;
        paintMarks();
      } else if (key === 'enter' || key === ' ') {
        if (e.target.closest('button')) return;
        e.preventDefault();
        if (kb.on) kbEnter(); else drawStock();
      } else if (key === 'escape') { if (kb.held) { kb.held = null; paintMarks(); } }
      else if (key === 'f') { const name = kb.on && kbPile(); const p = name && core.pileOf(S, name); if (p?.length) toFoundation(p.at(-1)); }
      else if (key === 'z' || key === 'backspace') { e.preventDefault(); undo(); }
      else if (key === 'h') showHint();
      else if (key === 'n') newGameSheet();
      else if (key === 'a') runAuto();
    });

    // ---------- Uhr, Größe ----------
    const clock = setInterval(() => {
      const now = performance.now();
      if (running && !win.min && !document.hidden) { elapsed += (now - lastTick) / 1000; timeEl.textContent = fmt(elapsed); }
      lastTick = now;
    }, 250);
    const saver = setInterval(() => { if (running) save(); }, 5000);
    const ro = new ResizeObserver(() => { if (S && !dragging) layout({ instant: true }); });
    ro.observe(board);

    // ---------- Start: gespeichertes Spiel fortsetzen ----------
    const saved = db.get('game', null);
    if (saved && Array.isArray(saved.deck) && saved.deck.length === 52 && new Set(saved.deck).size === 52 && saved.deck.every((c) => Number.isInteger(c) && c >= 0 && c < 52)) {
      deck = saved.deck;
      S = core.deal(deck, saved.draw);
      for (const m of Array.isArray(saved.moves) ? saved.moves : []) {
        const rec = m.t === 'm' ? { t: 'm', from: String(m.from), to: String(m.to), n: +m.n } : { t: m.t === 'r' ? 'r' : 'd' };
        if (!core.apply(S, rec)) break;
        history.push(rec);
      }
      elapsed = +saved.elapsed || 0;
      counted = !!saved.counted;
      done = core.won(S);
      running = history.length > 0 && !done;
      layout({ instant: true });
      paintStats();
      if (done) showResult(null); else offerAuto();
    } else start(db.get('draw', 1));

    return {
      onFocus: () => { if (!win.el.contains(document.activeElement) || document.activeElement === win.el) board.focus({ preventScroll: true }); },
      onClose: () => {
        closed = true;
        save();
        clearInterval(clock);
        clearInterval(saver);
        for (const id of timers) clearTimeout(id);
        ro.disconnect();
        if (fx) ticker.remove(fx);
      },
      menus: () => [{
        label: 'Spiel',
        items: [
          { label: 'Neues Spiel …', icon: 'plus', hint: 'N', run: newGameSheet },
          { label: 'Dieses Spiel neu starten', icon: 'reload', disabled: !history.length, run: () => start(S.draw, true) },
          '-',
          { label: 'Rückgängig', icon: 'undo', hint: 'Z', disabled: !history.length || busy || done, run: undo },
          { label: 'Hinweis', icon: 'sparkles', hint: 'H', disabled: busy || done, run: showHint },
          { label: 'Automatisch fertigstellen', icon: 'bolt', hint: 'A', disabled: busy || done || !S || !core.autoPlan(S), run: runAuto },
          '-',
          { label: 'Statistik …', icon: 'pulse', run: statsSheet },
        ],
      }],
    };
  },
};
