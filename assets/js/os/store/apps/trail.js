// trail.js — Lichtspur: eine leuchtende Spur wächst mit jedem Funken – Arcade-Spiel mit Kombos und Sonderfunken

import { h, clamp, rand, TAU, ticker, reducedMotion } from '../../../core/util.js';
import { icon } from '../../../core/icons.js';
import { initControls } from '../../../core/controls.js';
import { tone, sfx, audioReady } from '../../../core/audio.js';
import { bus } from '../../bus.js';
import { style, appStore } from '../../kit.js';

const COLS = 24, ROWS = 18;
const COMBO_STEPS = 30;          // so viele Schritte bleibt Zeit bis zum nächsten Funken, damit die Serie hält
const MAX_MULT = 8;
const PACES = [{ name: 'Ruhig', step: 0.17 }, { name: 'Flott', step: 0.125 }, { name: 'Rasant', step: 0.092 }];
const KINDS = {
  spark: { c: '#ffb65c', rgb: '255,182,92', name: '' },
  slow: { c: '#45c8ff', rgb: '69,200,255', name: 'Zeitlupe', about: 'bremst die Spur eine Weile' },
  ghost: { c: '#b58cff', rgb: '181,140,255', name: 'Geist', about: 'einmal durch dich selbst hindurch' },
  shrink: { c: '#3fe0b0', rgb: '63,224,176', name: 'Schrumpfen', about: 'kürzt die Spur deutlich' },
};

// ==========================================================================
// Spiellogik ohne DOM: ein Schritt = ein Feld. step() meldet, was passiert ist.
// ==========================================================================
export function trailCore({ cols = COLS, rows = ROWS, walls = true } = {}) {
  const occ = new Uint8Array(cols * rows);          // wie viele Spurglieder auf einem Feld liegen
  const at = (x, y) => y * cols + x;
  const S = {
    cols, rows, walls,
    trail: [], dir: { x: 1, y: 0 }, queue: [], grow: 0,
    gone: null,                 // Feld, das das Spurende im laufenden Schritt verlässt (für die fließende Darstellung)
    score: 0, eaten: 0, combo: 0, comboLeft: 0, maxCombo: 0,
    ghost: 0, phasing: false, phaseLeft: 0, slow: 0, tempo: 1,
    spark: null, special: null, untilSpecial: 4, dead: false,
  };
  const y0 = rows >> 1;
  for (let i = 0; i < 4; i++) { S.trail.push({ x: 6 - i, y: y0 }); occ[at(6 - i, y0)]++; }

  const same = (a, x, y) => !!a && a.x === x && a.y === y;
  function freeCell() {
    const head = S.trail[0];
    for (let n = 0; n < 300; n++) {
      const x = (Math.random() * cols) | 0, y = (Math.random() * rows) | 0;
      if (occ[at(x, y)] || same(S.spark, x, y) || same(S.special, x, y)) continue;
      if (n < 200 && Math.abs(x - head.x) + Math.abs(y - head.y) < 4) continue;      // nicht direkt vor die Nase
      return { x, y };
    }
    for (let i = 0; i < occ.length; i++) {
      const x = i % cols, y = (i / cols) | 0;
      if (!occ[i] && !same(S.spark, x, y) && !same(S.special, x, y)) return { x, y };
    }
    return null;
  }
  S.spark = freeCell();

  /** Richtungswechsel vormerken (höchstens zwei); Umkehren auf der Stelle gibt es nicht. */
  function turn(x, y) {
    const last = S.queue.length ? S.queue[S.queue.length - 1] : S.dir;
    if ((x === last.x && y === last.y) || (x === -last.x && y === -last.y) || S.queue.length >= 2) return false;
    S.queue.push({ x, y });
    return true;
  }

  /** Der Kopf ist auf seinem Feld angekommen: Funken einsammeln. */
  function arrive(ev) {
    const { x: nx, y: ny } = S.trail[0];
    if (same(S.spark, nx, ny)) {
      S.combo++;
      S.comboLeft = COMBO_STEPS;
      S.maxCombo = Math.max(S.maxCombo, S.combo);
      const mult = Math.min(S.combo, MAX_MULT), gain = 10 * mult;
      S.score += gain;
      S.eaten++;
      S.grow += 2;
      S.tempo = Math.max(0.55, S.tempo * 0.985);
      ev.push({ type: 'eat', kind: 'spark', x: nx, y: ny, gain, mult });
      S.spark = freeCell();
      if (!S.special && --S.untilSpecial <= 0) {
        const c = freeCell();
        if (c) {
          const pool = ['slow', S.ghost ? 'slow' : 'ghost', S.trail.length >= 10 ? 'shrink' : 'ghost'];
          S.special = { ...c, kind: pool[(Math.random() * pool.length) | 0], left: 70, total: 70 };
          S.untilSpecial = 3 + ((Math.random() * 4) | 0);
          ev.push({ type: 'spawn', x: c.x, y: c.y, kind: S.special.kind });
        }
      }
    } else if (same(S.special, nx, ny)) {
      const kind = S.special.kind, cut = [];
      let gain = 20 * Math.max(1, Math.min(S.combo, MAX_MULT));
      if (kind === 'slow') S.slow = 45;
      else if (kind === 'ghost') { if (S.ghost) gain += 30; else S.ghost = 1; }
      else {
        const n = Math.max(0, Math.min(S.trail.length - 4, Math.floor(S.trail.length * 0.4)));
        for (let i = 0; i < n; i++) { const c = S.trail.pop(); occ[at(c.x, c.y)]--; cut.push(c); }
        S.grow = 0;
        S.gone = null;
      }
      S.score += gain;
      if (S.combo) S.comboLeft = COMBO_STEPS;
      S.special = null;
      ev.push({ type: 'eat', kind, x: nx, y: ny, gain, cut });
    }
  }

  /**
   * Ein Schritt. Die Darstellung lässt den Kopf während des Schritts von trail[1] nach trail[0] gleiten –
   * darum wird erst hier, beim Ankommen, eingesammelt und dann das nächste Feld betreten (oder eben nicht).
   */
  function step() {
    const ev = [];
    if (S.dead) return ev;
    arrive(ev);
    if (S.queue.length) S.dir = S.queue.shift();
    const head = S.trail[0];
    let nx = head.x + S.dir.x, ny = head.y + S.dir.y;
    if (walls) {
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) { S.dead = true; ev.push({ type: 'die', why: 'wall' }); return ev; }
    } else { nx = (nx + cols) % cols; ny = (ny + rows) % rows; }
    const tail = S.trail[S.trail.length - 1];
    const leaving = S.grow === 0 && tail.x === nx && tail.y === ny && occ[at(nx, ny)] === 1;     // das Ende macht gerade Platz
    const hit = occ[at(nx, ny)] > 0 && !leaving;
    if (hit && S.phasing && --S.phaseLeft <= 0) S.phasing = false;        // der Geist trägt nur ein paar Felder weit
    if (hit && !S.phasing) {
      if (S.ghost > 0) { S.ghost--; S.phasing = true; S.phaseLeft = 6; ev.push({ type: 'phase', x: nx, y: ny }); }
      else { S.dead = true; ev.push({ type: 'die', why: 'self' }); return ev; }
    } else if (!hit && S.phasing) S.phasing = false;
    if (S.grow > 0) { S.grow--; S.gone = null; } else { S.gone = S.trail.pop(); occ[at(S.gone.x, S.gone.y)]--; }
    S.trail.unshift({ x: nx, y: ny });
    occ[at(nx, ny)]++;
    if (S.comboLeft > 0 && --S.comboLeft === 0) S.combo = 0;
    if (S.slow > 0) S.slow--;
    if (S.special && --S.special.left <= 0) { ev.push({ type: 'expire', x: S.special.x, y: S.special.y, kind: S.special.kind }); S.special = null; }
    return ev;
  }

  return { S, occ, turn, step, freeCell };
}

// ==========================================================================
// Oberfläche
// ==========================================================================
style('trail', `
.trail { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.trail-hud { display: flex; align-items: center; gap: 10px; flex: none; height: 46px; padding: 6px 12px 0 16px; }
.trail-hud .sp { flex: 1; }
.trail-score { font: 750 24px/1 var(--font-round); font-variant-numeric: tabular-nums; min-width: 2ch; }
.trail-mult { position: relative; display: grid; place-items: center; min-width: 46px; height: 26px; padding: 0 9px; border-radius: 99px; overflow: hidden; background: var(--well); box-shadow: inset 0 0 0 .5px var(--line); font: 750 13px/1 var(--font-round); color: var(--fg-3); transition: color .2s; }
.trail-mult i { position: absolute; inset: 0; transform-origin: left; transform: scaleX(var(--p, 0)); background: linear-gradient(90deg, var(--c-amber), var(--c-coral)); opacity: .9; }
.trail-mult b { position: relative; }
.trail-mult.is-on { color: #fff; }
.trail-mult.is-bump { animation: trail-bump .35s var(--spring); }
@keyframes trail-bump { 40% { transform: scale(1.25); } }
.trail-fx { display: flex; gap: 6px; min-width: 0; }
.trail-chip { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px; border-radius: 99px; background: color-mix(in srgb, var(--c) 22%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 60%, transparent); font-size: 12px; font-weight: 650; white-space: nowrap; animation: trail-chip .35s var(--spring-soft) both; }
.trail-chip::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--c); box-shadow: 0 0 8px var(--c); }
@keyframes trail-chip { from { opacity: 0; scale: .7; } }
.trail-best { font-size: 12px; font-weight: 600; color: var(--fg-3); white-space: nowrap; font-variant-numeric: tabular-nums; }
.trail-stage { position: relative; flex: 1; min-height: 0; }
.trail-cv { position: absolute; inset: 0; width: 100%; height: 100%; outline: 0; touch-action: none; font-family: var(--font-round); }
.trail-veil { position: absolute; inset: 0; display: grid; place-items: center; padding: 12px; overflow: auto; }
.trail-card { display: grid; justify-items: center; gap: 11px; width: min(340px, 100%); padding: 20px 20px 18px; border-radius: 22px; background: color-mix(in srgb, var(--solid) 80%, transparent); -webkit-backdrop-filter: blur(22px) saturate(150%); backdrop-filter: blur(22px) saturate(150%); box-shadow: 0 30px 70px -24px rgba(0, 0, 14, .8), inset 0 0 0 .5px var(--glass-edge), inset 0 1px 0 var(--glass-lo); text-align: center; animation: trail-card .5s var(--spring-soft) both; }
@keyframes trail-card { from { opacity: 0; scale: .88; translate: 0 14px; } }
.trail-card h2 { font: 800 30px/1.05 var(--font-round); letter-spacing: -.02em; }
.trail-card h2.num { font-size: 52px; font-variant-numeric: tabular-nums; }
.trail-card p { font-size: 13px; color: var(--fg-2); text-wrap: balance; }
.trail-card .kit-label { letter-spacing: .04em; text-transform: uppercase; font-size: 11px; }
.trail-card .gseg { display: flex; width: 100%; }
.trail-card .gseg button { padding: .5em .4em; font-size: 12.5px; }
.trail-legend { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 12px; font-size: 12px; color: var(--fg-3); }
.trail-legend span { display: inline-flex; align-items: center; gap: 5px; }
.trail-legend span::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--c); box-shadow: 0 0 8px var(--c); }
.trail-card small { font-size: 11.5px; color: var(--fg-3); }
.trail-card .kit-btn.big { min-width: 150px; }
.trail-row { display: flex; gap: 8px; }
@container win (max-width: 430px) {
  .trail-best { display: none; }
  .trail-card { gap: 8px; padding: 14px 14px 12px; }
  .trail-card h2 { font-size: 24px; }
  .trail-card h2.num { font-size: 40px; }
  .trail-legend, .trail-card small { display: none; }
}
`);

const db = appStore('trail');
const soundOn = () => sfx.enabled && audioReady();
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];        // Dur-Pentatonik: die Serie klettert hörbar

export default {
  singleton: true,
  width: 680, height: 600, minW: 360, minH: 430,

  mount(win) {
    const prefs = { walls: true, pace: 1, ...db.get('prefs', {}) };
    let G = trailCore({ walls: prefs.walls });
    let state = 'title';                 // title | play | pause | over
    let acc = 0, hold = 0, awake = false, time = 0, shake = 0, deathT = 0, overTimer = 0;
    let parts = [], texts = [];
    let W = 0, H = 0, dpr = 1, cell = 20, ox = 0, oy = 0;
    let swipe = null;

    // ---------- Aufbau ----------
    const cv = h('canvas.trail-cv', { tabIndex: 0, 'aria-label': 'Spielfeld von Lichtspur' });
    const ctx = cv.getContext('2d');
    const bg = document.createElement('canvas');
    const scoreEl = h('span.trail-score', '0');
    const multBar = h('i'), multTxt = h('b', '×1');
    const multEl = h('span.trail-mult', { title: 'Serie: schnell hintereinander gesammelte Funken zählen mehrfach' }, multBar, multTxt);
    const fxEl = h('span.trail-fx');
    const bestEl = h('span.trail-best');
    const bPause = h('button.tool', { type: 'button', 'aria-label': 'Pause (P)', title: 'Pause (P)', html: icon('pause'), onclick: () => { if (state === 'play') pause(); else if (state === 'pause') resume(); cv.focus({ preventScroll: true }); } });
    const veil = h('div.trail-veil');
    win.body.append(h('div.trail',
      h('div.trail-hud', scoreEl, multEl, fxEl, h('span.sp'), bestEl, bPause),
      h('div.trail-stage', cv, veil)));

    const bestKey = () => `${prefs.walls ? 'w' : 'o'}${prefs.pace}`;
    const best = () => db.get('best', {})[bestKey()] || 0;

    // ---------- Anzeige ----------
    let lastFx = '';
    function hud() {
      const S = G.S;
      scoreEl.textContent = S.score.toLocaleString('de-DE');
      const mult = Math.min(Math.max(S.combo, 1), MAX_MULT);
      multTxt.textContent = `×${mult}`;
      const live = state === 'play' || state === 'pause';
      multEl.classList.toggle('is-on', live && S.combo > 0);
      if (!live || !S.combo) multBar.style.setProperty('--p', 0);
      const key = live ? `${S.slow > 0}|${S.ghost}|${S.phasing}` : '';
      if (key !== lastFx) {
        lastFx = key;
        fxEl.textContent = '';
        if (live && S.slow > 0) fxEl.append(h('span.trail-chip', { style: { '--c': KINDS.slow.c } }, 'Zeitlupe'));
        if (live && (S.ghost || S.phasing)) fxEl.append(h('span.trail-chip', { style: { '--c': KINDS.ghost.c } }, 'Geist'));
      }
      bestEl.textContent = best() ? `Bestwert ${best().toLocaleString('de-DE')}` : '';
      bPause.innerHTML = icon(state === 'pause' ? 'play' : 'pause');
      bPause.disabled = state !== 'play' && state !== 'pause';
    }

    function segs() {
      const mode = h('div.gseg', { 'aria-label': 'Spielfeld' },
        h('button', { type: 'button', dataset: { value: 'w' }, 'aria-selected': String(prefs.walls), title: 'Der Rand ist tödlich' }, 'Feste Wände'),
        h('button', { type: 'button', dataset: { value: 'o' }, 'aria-selected': String(!prefs.walls), title: 'Die Spur kommt auf der anderen Seite wieder heraus' }, 'Offener Rand'));
      const pace = h('div.gseg', { 'aria-label': 'Tempo' }, PACES.map((p, i) => h('button', { type: 'button', dataset: { value: i }, 'aria-selected': String(i === prefs.pace) }, p.name)));
      const rec = h('small');
      const show = () => { rec.textContent = best() ? `Bestwert in diesem Modus: ${best().toLocaleString('de-DE')}` : 'In diesem Modus gibt es noch keinen Bestwert.'; };
      const changed = () => {
        db.set('prefs', prefs);
        show();
        if (state !== 'play' && state !== 'pause') { reset(); paintBg(); hud(); draw(); }
      };
      mode.addEventListener('change', (e) => { prefs.walls = e.detail.value === 'w'; changed(); });
      pace.addEventListener('change', (e) => { prefs.pace = +e.detail.value; changed(); });
      show();
      return [mode, pace, rec];
    }
    function card(...kids) {
      const el = h('div.trail-card', { role: 'dialog', 'aria-label': 'Lichtspur' }, kids);
      veil.replaceChildren(el);
      veil.hidden = false;
      initControls(el);
    }
    function hideCard() {
      veil.hidden = true;
      veil.replaceChildren();
      // der Knopf, der eben noch den Fokus hatte, ist weg – die Tasten gehören jetzt dem Spielfeld
      if (win.wm.focused === win) cv.focus({ preventScroll: true });
    }
    const playBtn = (label, fn) => h('button.kit-btn.primary.big.round', { type: 'button', onclick: () => { fn(); cv.focus({ preventScroll: true }); } }, label);

    function showTitle() {
      state = 'title';
      const [mode, pace, rec] = segs();
      card(
        h('h2.grad-text', 'Lichtspur'),
        h('p', 'Lenke die Spur, sammle Funken – und berühre dich nicht selbst. Schnelle Folgen zählen mehrfach.'),
        mode, pace,
        h('div.trail-legend', ['slow', 'ghost', 'shrink'].map((k) => h('span', { style: { '--c': KINDS[k].c }, title: KINDS[k].about }, KINDS[k].name))),
        playBtn('Spielen', start),
        rec,
        h('small', 'Pfeiltasten, WASD oder Wischen · P = Pause'));
      hud();
    }
    function showOver(record, old, why) {
      const S = G.S;
      const [mode, pace] = segs();
      card(
        h('span.kit-label', why === 'self' ? 'Spur verknotet' : 'An der Wand erloschen'),
        h('h2.num.grad-text', S.score.toLocaleString('de-DE')),
        h('p', record ? (old ? `Neuer Bestwert – bisher ${old.toLocaleString('de-DE')}!` : 'Dein erster Bestwert in diesem Modus!') : best() ? `Bestwert ${best().toLocaleString('de-DE')}` : 'Sammle Funken, um einen Bestwert zu setzen.'),
        h('small', `${S.eaten} Funken · Länge ${S.trail.length} · beste Serie ×${Math.min(Math.max(S.maxCombo, 1), MAX_MULT)}`),
        mode, pace,
        playBtn('Nochmal', start));
      hud();
    }
    function showPause() {
      card(
        h('h2', 'Pause'),
        h('p', 'Die Spur wartet auf dich.'),
        h('div.trail-row',
          h('button.kit-btn.big.round', { type: 'button', onclick: () => { reset(); showTitle(); draw(); } }, 'Beenden'),
          playBtn('Weiter', resume)),
        h('small', 'Leertaste oder P setzt fort'));
      hud();
    }

    // ---------- Ablauf ----------
    function wake() {
      if (awake) return;
      awake = true;
      ticker.add(frame);
    }
    function reset() {
      clearTimeout(overTimer);
      G = trailCore({ walls: prefs.walls });
      acc = 0;
      deathT = 0;
      shake = 0;
      parts = [];
      texts = [];
      lastFx = '';
    }
    function start() {
      reset();
      state = 'play';
      hold = 0.5;                    // kurzer Anlauf, bevor es losgeht
      hideCard();
      paintBg();
      hud();
      if (soundOn()) sfx.pop();
      wake();
    }
    function pause() {
      if (state !== 'play') return;
      state = 'pause';
      showPause();
      draw();
    }
    function resume() {
      if (state !== 'pause') return;
      state = 'play';
      hold = 0.4;
      hideCard();
      hud();
      wake();
    }

    const px = (c) => [ox + (c.x + 0.5) * cell, oy + (c.y + 0.5) * cell];
    function burst(c, rgb, n, speed = 1) {
      if (reducedMotion.matches) n = Math.ceil(n / 4);
      const [x, y] = px(c);
      for (let i = 0; i < n; i++) {
        const a = rand(TAU), s = rand(30, 190) * speed;
        parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.75), max: 0.75, rgb, r: rand(1.2, 2.8) });
      }
    }
    function floatText(c, text, color) {
      const [x, y] = px(c);
      texts.push({ x, y: y - cell * 0.6, text, color, life: 0.9 });
    }

    function handle(events) {
      for (const e of events) {
        if (e.type === 'eat') {
          const k = KINDS[e.kind];
          burst(e, k.rgb, e.kind === 'spark' ? 14 : 26, e.kind === 'spark' ? 1 : 1.4);
          floatText(e, e.kind === 'spark' ? `+${e.gain}` : k.name, k.c);
          for (const c of e.cut || []) burst(c, KINDS.shrink.rgb, 3, 0.6);
          if (e.kind === 'spark' && e.mult > 1) {
            multEl.classList.remove('is-bump');
            void multEl.offsetWidth;
            multEl.classList.add('is-bump');
          }
          if (soundOn()) {
            if (e.kind === 'spark') {
              const f = 392 * 2 ** (SCALE[Math.min(e.mult, SCALE.length) - 1] / 12);
              tone({ type: 'triangle', f, dur: 0.16, vol: 0.11 });
              tone({ f: f * 2, dur: 0.1, vol: 0.03 });
            } else if (e.kind === 'slow') { tone({ f: 880, f2: 330, dur: 0.4, vol: 0.08 }); }
            else if (e.kind === 'ghost') { tone({ f: 494, dur: 0.18, vol: 0.07 }); tone({ f: 740, dur: 0.3, vol: 0.07, when: 0.09 }); }
            else { tone({ type: 'triangle', f: 660, f2: 990, dur: 0.12, vol: 0.08 }); tone({ type: 'triangle', f: 990, f2: 1480, dur: 0.14, vol: 0.06, when: 0.08 }); }
          }
        } else if (e.type === 'phase') {
          burst(e, KINDS.ghost.rgb, 22, 1.3);
          floatText(e, 'Geist!', KINDS.ghost.c);
          if (soundOn()) tone({ f: 300, f2: 1100, dur: 0.28, vol: 0.08 });
        } else if (e.type === 'expire') burst(e, KINDS[e.kind].rgb, 6, 0.5);
        else if (e.type === 'spawn') { if (soundOn()) tone({ f: 1320, f2: 1760, dur: 0.09, vol: 0.035 }); }
        else if (e.type === 'die') die(e.why);
      }
      hud();
    }

    function die(why) {
      const S = G.S;
      state = 'over';
      acc = 1;
      deathT = 0.001;
      shake = reducedMotion.matches ? 0 : 0.45;
      S.trail.forEach((c, i) => { if (i % 2 === 0 || i < 6) burst(c, i < 3 ? '255,255,255' : '160,150,255', i < 3 ? 8 : 3, 0.9); });
      if (soundOn()) {
        tone({ type: 'sawtooth', f: 330, f2: 55, dur: 0.55, vol: 0.12 });
        tone({ type: 'square', f: 110, f2: 40, dur: 0.3, vol: 0.05, when: 0.04 });
      }
      const all = db.get('best', {});
      const old = all[bestKey()] || 0;
      const record = S.score > old;
      if (record) { all[bestKey()] = S.score; db.set('best', all); }
      clearTimeout(overTimer);
      overTimer = setTimeout(() => { if (state === 'over') showOver(record, old, why); }, 750);
    }

    // ---------- Zeichnen ----------
    function size() {
      dpr = Math.min(devicePixelRatio || 1, 2);
      W = cv.clientWidth;
      H = cv.clientHeight;
      if (!W || !H) return;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cell = Math.max(6, Math.min((W - 24) / COLS, (H - 24) / ROWS));
      ox = (W - cell * COLS) / 2;
      oy = (H - cell * ROWS) / 2;
      paintBg();
      draw();
    }
    const field = (c, grow = 0) => {
      c.beginPath();
      c.roundRect(ox - grow, oy - grow, cell * COLS + grow * 2, cell * ROWS + grow * 2, Math.min(18, cell * 0.7) + grow);
    };
    /** Statischer Teil (Fläche, Rasterpunkte, Rand) – einmal vorab gemalt. */
    function paintBg() {
      if (!W) return;
      bg.width = cv.width;
      bg.height = cv.height;
      const b = bg.getContext('2d');
      b.setTransform(dpr, 0, 0, dpr, 0, 0);
      const g = b.createLinearGradient(0, oy, 0, oy + cell * ROWS);
      g.addColorStop(0, '#12153d');
      g.addColorStop(1, '#070819');
      b.fillStyle = g;
      b.shadowColor = 'rgba(0, 0, 14, .55)';
      b.shadowBlur = 18;
      b.shadowOffsetY = 6;
      field(b);
      b.fill();
      b.shadowColor = 'transparent';
      b.fillStyle = 'rgba(255, 255, 255, .075)';
      for (let x = 1; x < COLS; x++) for (let y = 1; y < ROWS; y++) b.fillRect(ox + x * cell - 0.75, oy + y * cell - 0.75, 1.5, 1.5);
      b.lineWidth = 2;
      if (prefs.walls) {
        b.strokeStyle = 'rgba(120, 240, 205, .9)';
        b.shadowColor = '#3fe0b0';
        b.shadowBlur = 12;
      } else {
        b.strokeStyle = 'rgba(181, 140, 255, .8)';
        b.setLineDash([2, 7]);
        b.lineCap = 'round';
      }
      field(b, -1);
      b.stroke();
    }

    /** Linienzüge der Spur in Feldkoordinaten; t = Fortschritt des laufenden Schritts. Am offenen Rand wird geteilt. */
    function pieces(t) {
      const S = G.S, tr = S.trail, out = [];
      let cur = [];
      const seg = (A, B, s0, s1) => {
        let dx = B.x - A.x, dy = B.y - A.y;
        if (dx > 1) dx = -1; else if (dx < -1) dx = 1;
        if (dy > 1) dy = -1; else if (dy < -1) dy = 1;
        const wrap = B.x !== A.x + dx || B.y !== A.y + dy;
        if (!wrap) {
          if (!cur.length) cur.push(A.x + dx * s1, A.y + dy * s1);
          cur.push(A.x + dx * s0, A.y + dy * s0);
        } else {
          if (!cur.length) cur.push(B.x - dx * (1 - s1), B.y - dy * (1 - s1));
          cur.push(B.x - dx * (1 - s0), B.y - dy * (1 - s0));
          out.push(cur);
          cur = [A.x + dx * s1, A.y + dy * s1, A.x + dx * s0, A.y + dy * s0];
        }
      };
      if (tr.length > 1) seg(tr[1], tr[0], 0, t);
      for (let i = 1; i < tr.length - 1; i++) seg(tr[i + 1], tr[i], 0, 1);
      if (S.gone) seg(S.gone, tr[tr.length - 1], t, 1);
      if (cur.length) out.push(cur);
      return out;
    }

    function drawSpark(c, kind, left = 1) {
      const k = KINDS[kind];
      const [x, y] = px(c);
      const pulse = 0.5 + 0.5 * Math.sin(time * 5 + c.x);
      const r = cell * (kind === 'spark' ? 1.25 : 1.5);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${k.rgb}, .95)`);
      g.addColorStop(0.3, `rgba(${k.rgb}, .38)`);
      g.addColorStop(1, `rgba(${k.rgb}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = `rgba(${k.rgb}, 1)`;
      ctx.lineWidth = Math.max(1.5, cell * 0.09);
      ctx.lineCap = 'round';
      if (kind === 'spark') {
        // vierstrahliger Funke, der sich langsam dreht
        const a = time * 1.4, r1 = cell * (0.34 + pulse * 0.07), r2 = cell * 0.12;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const rr = i % 2 ? r2 : r1, an = a + (i * TAU) / 8;
          ctx.lineTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr);
        }
        ctx.closePath();
        ctx.fill();
        return;
      }
      // Sonderfunken: Ring zeigt die verbleibende Zeit, innen ein eigenes Zeichen
      const blink = left < 0.25 && Math.sin(time * 22) > 0;
      ctx.globalAlpha = blink ? 0.35 : 1;
      ctx.beginPath();
      ctx.arc(x, y, cell * 0.44, -TAU / 4, -TAU / 4 + TAU * left);
      ctx.stroke();
      const s = cell * 0.2;
      ctx.beginPath();
      if (kind === 'slow') { ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.lineTo(x + s, y + s); ctx.closePath(); ctx.fill(); }
      else if (kind === 'ghost') { ctx.arc(x, y, s * 0.95, 0, TAU); ctx.lineWidth = Math.max(1.5, cell * 0.11); ctx.strokeStyle = '#fff'; ctx.stroke(); }
      else { ctx.moveTo(x, y - s * 1.15); ctx.lineTo(x + s * 1.15, y); ctx.lineTo(x, y + s * 1.15); ctx.lineTo(x - s * 1.15, y); ctx.closePath(); ctx.fill(); }
      ctx.globalAlpha = 1;
    }

    function draw() {
      if (!W) return;
      const S = G.S;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      if (shake > 0) ctx.translate(rand(-1, 1) * shake * 10, rand(-1, 1) * shake * 10);
      ctx.drawImage(bg, 0, 0, W, H);
      ctx.save();
      field(ctx, -1);
      ctx.clip();

      ctx.globalCompositeOperation = 'lighter';
      if (S.spark) drawSpark(S.spark, 'spark');
      if (S.special) drawSpark(S.special, S.special.kind, S.special.left / S.special.total);

      // Spur: Lichthof, darüber der farbige Kern
      const t = clamp(state === 'play' || state === 'pause' ? acc : state === 'over' ? 1 : 0);
      const fade = (1 - clamp(deathT)) * (S.phasing ? 0.55 : 1);
      const list = pieces(t);
      const rgb = S.slow > 0 ? KINDS.slow.rgb : '70,235,190';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const path = (p) => {
        ctx.beginPath();
        ctx.moveTo(ox + (p[0] + 0.5) * cell, oy + (p[1] + 0.5) * cell);
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(ox + (p[i] + 0.5) * cell, oy + (p[i + 1] + 0.5) * cell);
        if (p.length === 2) ctx.lineTo(ox + (p[0] + 0.5) * cell + 0.01, oy + (p[1] + 0.5) * cell);
      };
      if (fade > 0.01) {
        // weicher Lichthof: ein breiter, zarter Strich mit Unschärfe
        ctx.strokeStyle = `rgba(${rgb}, ${0.2 * fade})`;
        ctx.lineWidth = cell * 0.95;
        ctx.shadowColor = `rgba(${rgb}, ${0.95 * fade})`;
        ctx.shadowBlur = cell * 1.15;
        for (const p of list) { path(p); ctx.stroke(); }
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = fade;
        ctx.lineWidth = cell * 0.58;
        const total = Math.max(1, list.reduce((n, p) => n + p.length / 2 - 1, 0));
        let k = 0;
        for (const p of list) {
          for (let i = 0; i + 3 < p.length; i += 2, k++) {
            const f = k / total;
            ctx.strokeStyle = `hsl(${(S.slow > 0 ? 195 : 162) + f * 105}, 92%, ${64 - f * 12}%)`;
            ctx.beginPath();
            ctx.moveTo(ox + (p[i] + 0.5) * cell, oy + (p[i + 1] + 0.5) * cell);
            ctx.lineTo(ox + (p[i + 2] + 0.5) * cell, oy + (p[i + 3] + 0.5) * cell);
            ctx.stroke();
          }
        }
        // heller Faden in der Mitte
        ctx.strokeStyle = 'rgba(255, 255, 255, .55)';
        ctx.lineWidth = cell * 0.14;
        for (const p of list) { path(p); ctx.stroke(); }
        // Kopf – an jedem Linienzug-Anfang, der zum Kopf gehört (am offenen Rand sind es kurz zwei)
        ctx.globalCompositeOperation = 'lighter';
        const heads = [list[0]];
        if (list.length > 1 && list[0].length === 4 && (list[0][2] < 0 || list[0][3] < 0 || list[0][2] >= COLS || list[0][3] >= ROWS)) heads.push(list[1]);
        for (const p of heads) {
          if (!p) continue;
          const x = ox + (p[0] + 0.5) * cell, y = oy + (p[1] + 0.5) * cell;
          const g = ctx.createRadialGradient(x, y, 0, x, y, cell * 1.3);
          g.addColorStop(0, 'rgba(255, 255, 255, .95)');
          g.addColorStop(0.25, `rgba(${rgb}, .6)`);
          g.addColorStop(1, `rgba(${rgb}, 0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, cell * 1.3, 0, TAU);
          ctx.fill();
          if (S.ghost) {
            ctx.strokeStyle = `rgba(${KINDS.ghost.rgb}, ${0.55 + 0.3 * Math.sin(time * 6)})`;
            ctx.lineWidth = Math.max(1.5, cell * 0.08);
            ctx.beginPath();
            ctx.arc(x, y, cell * 0.62, 0, TAU);
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
      }

      ctx.globalCompositeOperation = 'lighter';
      for (const p of parts) {
        ctx.fillStyle = `rgba(${p.rgb}, ${clamp((p.life / p.max) * 1.4)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      if (texts.length) {
        ctx.font = `750 ${Math.max(11, cell * 0.62)}px ${getComputedStyle(cv).fontFamily}`;
        ctx.textAlign = 'center';
        for (const tx of texts) {
          ctx.globalAlpha = clamp(tx.life * 2.2);
          ctx.fillStyle = tx.color;
          ctx.fillText(tx.text, clamp(tx.x, ox + 30, ox + cell * COLS - 30), Math.max(oy + 14, tx.y));
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      ctx.restore();
    }

    function frame(dt) {
      if (win.min) { pause(); return; }
      time += dt;
      if (state === 'play') {
        const S = G.S;
        if (hold > 0) hold -= dt;
        else acc += dt / (PACES[prefs.pace].step * S.tempo * (S.slow > 0 ? 1.6 : 1));
        while (acc >= 1 && state === 'play') { acc -= 1; handle(G.step()); }
        multBar.style.setProperty('--p', S.combo ? clamp((S.comboLeft - clamp(acc)) / COMBO_STEPS).toFixed(3) : 0);
      }
      if (deathT > 0 && deathT < 1) deathT = Math.min(1, deathT + dt * 1.5);
      shake = Math.max(0, shake - dt * 1.4);
      for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - dt * 2.4; p.vy *= 1 - dt * 2.4; p.life -= dt; }
      parts = parts.filter((p) => p.life > 0);
      for (const tx of texts) { tx.y -= dt * 34; tx.life -= dt; }
      texts = texts.filter((tx) => tx.life > 0);
      draw();
      // Ruhe, sobald nichts mehr in Bewegung ist
      if (state !== 'play' && !parts.length && !texts.length && shake <= 0 && (deathT === 0 || deathT >= 1)) {
        awake = false;
        ticker.remove(frame);
      }
    }

    // ---------- Eingabe ----------
    const DIRS = { arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1], arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0] };
    win.el.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, textarea, select')) return;
      const key = e.key.toLowerCase();
      const d = DIRS[key];
      if (d) {
        if (state !== 'play') return;
        e.preventDefault();
        G.turn(d[0], d[1]);
      } else if (key === ' ' || key === 'enter') {
        // auf einem Knopf gilt die Taste dem Knopf – außer Enter auf der Modus-Auswahl: das startet
        if (e.target.closest('button') && !(key === 'enter' && e.target.closest('.gseg'))) return;
        e.preventDefault();
        if (state === 'play') { if (key === ' ') pause(); }
        else if (state === 'pause') resume();
        else if (!veil.hidden) start();
      } else if (key === 'p') { if (state === 'play') pause(); else if (state === 'pause') resume(); }
      else if (key === 'escape' && state === 'play') pause();
    });
    cv.addEventListener('pointerdown', (e) => {
      swipe = { x: e.clientX, y: e.clientY, id: e.pointerId };
      try { cv.setPointerCapture(e.pointerId); } catch { /* egal */ }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!swipe || e.pointerId !== swipe.id || state !== 'play') return;
      const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
      if (Math.hypot(dx, dy) < 22) return;
      if (Math.abs(dx) > Math.abs(dy)) G.turn(Math.sign(dx), 0); else G.turn(0, Math.sign(dy));
      swipe.x = e.clientX;
      swipe.y = e.clientY;
    });
    const endSwipe = () => { swipe = null; };
    cv.addEventListener('pointerup', endSwipe);
    cv.addEventListener('pointercancel', endSwipe);

    // Fokus weg oder Tab im Hintergrund → Pause
    const offFocus = bus.on('focus', (w) => { if (w !== win) pause(); });
    const onHide = () => { if (document.hidden) pause(); };
    document.addEventListener('visibilitychange', onHide);
    const ro = new ResizeObserver(size);
    ro.observe(cv);

    showTitle();
    size();

    return {
      onFocus: () => { if (!win.el.contains(document.activeElement) || document.activeElement === win.el) cv.focus({ preventScroll: true }); },
      onClose: () => {
        state = 'closed';
        clearTimeout(overTimer);
        ticker.remove(frame);
        ro.disconnect();
        offFocus();
        document.removeEventListener('visibilitychange', onHide);
      },
      menus: () => [{
        label: 'Spiel',
        items: [
          { label: 'Neues Spiel', icon: 'play', run: start },
          { label: state === 'pause' ? 'Weiter' : 'Pause', icon: state === 'pause' ? 'play' : 'pause', hint: 'P', disabled: state !== 'play' && state !== 'pause', run: () => (state === 'pause' ? resume() : pause()) },
        ],
      }],
    };
  },
};
