// synth.js — „Klang“: polyphoner Synthesizer mit Klaviatur, Filter, Echo und Oszilloskop

import { h, ticker } from '../../core/util.js';
import { icon } from '../../core/icons.js';
import { initControls } from '../../core/controls.js';
import { audio, midiToFreq } from '../../core/audio.js';

const WAVES = [['sine', 'Sinus'], ['triangle', 'Dreieck'], ['sawtooth', 'Säge'], ['square', 'Rechteck']];
// physische Tastenlage (funktioniert auf QWERTZ wie QWERTY)
const KEYMAP = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14 };
const BLACK = new Set([1, 3, 6, 8, 10]);
const DEMO = [0, 7, 12, 16, 19, 16, 12, 7, 5, 12, 17, 21, 24, 21, 17, 12];

export default {
  id: 'synth', name: 'Klang', icon: 'music', colors: ['#ff8a5c', '#ff3d81'], keywords: 'synthesizer musik piano ton',
  width: 760, height: 430, minW: 560, minH: 380,

  mount(win) {
    const P = { wave: 'sawtooth', cutoff: 2400, release: 0.5, echo: true, octave: 4 };
    const voices = new Map();
    let bus = null, wet = null;

    const graph = () => {
      if (bus) return;
      const { ctx, out } = audio();
      bus = ctx.createGain();
      bus.gain.value = 0.5;
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.29;
      const fb = ctx.createGain();
      fb.gain.value = 0.36;
      wet = ctx.createGain();
      wet.gain.value = P.echo ? 0.4 : 0;
      bus.connect(out);
      bus.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      delay.connect(wet);
      wet.connect(out);
    };
    const noteOn = (midi) => {
      if (voices.has(midi)) return;
      graph();
      const { ctx } = audio();
      const t = ctx.currentTime;
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      const lp = ctx.createBiquadFilter();
      const g = ctx.createGain();
      o1.type = o2.type = P.wave;
      o1.frequency.value = midiToFreq(midi);
      o2.frequency.value = midiToFreq(midi) * 1.005;
      lp.type = 'lowpass';
      lp.Q.value = 5;
      lp.frequency.setValueAtTime(Math.min(12000, P.cutoff * 2.2), t);
      lp.frequency.exponentialRampToValueAtTime(P.cutoff, t + 0.18);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.26, t + 0.012);
      o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(bus);
      o1.start(t); o2.start(t);
      voices.set(midi, { o1, o2, g });
      keyEls.get(midi)?.classList.add('is-down');
    };
    const noteOff = (midi) => {
      const v = voices.get(midi);
      if (!v) return;
      voices.delete(midi);
      const { ctx } = audio();
      const t = ctx.currentTime;
      v.g.gain.cancelScheduledValues(t);
      v.g.gain.setValueAtTime(Math.max(0.0001, v.g.gain.value), t);
      v.g.gain.exponentialRampToValueAtTime(0.0001, t + P.release);
      v.o1.stop(t + P.release + 0.05);
      v.o2.stop(t + P.release + 0.05);
      keyEls.get(midi)?.classList.remove('is-down');
    };
    const allOff = () => { for (const m of [...voices.keys()]) noteOff(m); };

    // ---------- Oberfläche ----------
    const scope = h('canvas.synth-scope', { 'aria-label': 'Oszilloskop' });
    const waves = h('div.gseg', { 'aria-label': 'Wellenform' }, ...WAVES.map(([id, name]) => h('button', { dataset: { value: id }, 'aria-selected': String(id === P.wave) }, name)));
    const cutoff = h('div.gslider', { dataset: { min: 200, max: 8000, step: 10, value: P.cutoff }, 'aria-label': 'Filter' });
    const release = h('div.gslider', { dataset: { min: 0.08, max: 2, step: 0.01, value: P.release }, 'aria-label': 'Ausklang' });
    const echo = h('button.gswitch', { type: 'button', 'aria-checked': 'true', 'aria-label': 'Echo' });
    const octOut = h('output', `C${P.octave}`);
    const bDemo = h('button.btn.small.primary', { type: 'button', html: `${icon('play')} Demo` });
    const keys = h('div.synth-keys');
    const keyEls = new Map();
    win.body.append(h('div.synth',
      h('div.synth-top',
        scope,
        h('div.synth-ctl',
          waves,
          h('div.synth-row', h('span', 'Filter'), cutoff),
          h('div.synth-row', h('span', 'Ausklang'), release),
          h('div.synth-row', h('span', 'Echo'), echo, h('span.sp'), h('span', 'Oktave'),
            h('button.tool', { type: 'button', 'aria-label': 'Oktave tiefer', html: icon('minus'), onclick: () => shift(-1) }), octOut,
            h('button.tool', { type: 'button', 'aria-label': 'Oktave höher', html: icon('plus'), onclick: () => shift(1) })),
          bDemo)),
      keys,
      h('p.synth-hint', 'Klick auf die Tasten oder spiel auf der Tastatur: A S D F G H J K (weiß) · W E T Z U O (schwarz)')));
    initControls(win.body);

    const buildKeys = () => {
      allOff();
      keyEls.clear();
      const base = P.octave * 12 + 12;
      const frag = [];
      let white = 0;
      for (let i = 0; i < 25; i++) {
        const midi = base + i;
        const black = BLACK.has(i % 12);
        const el = h(`button.key${black ? '.black' : ''}`, { type: 'button', 'aria-label': `Note ${midi}`, style: black ? { '--i': white } : null });
        if (!black) white++;
        el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); noteOn(midi); });
        el.addEventListener('pointerup', () => noteOff(midi));
        el.addEventListener('pointercancel', () => noteOff(midi));
        el.addEventListener('lostpointercapture', () => noteOff(midi));
        keyEls.set(midi, el);
        frag.push(el);
      }
      keys.replaceChildren(...frag);
      octOut.textContent = `C${P.octave}`;
    };
    const shift = (d) => { P.octave = Math.min(6, Math.max(1, P.octave + d)); buildKeys(); };

    waves.addEventListener('change', (e) => { P.wave = e.detail.value; });
    cutoff.addEventListener('input', (e) => { P.cutoff = e.detail.value; });
    release.addEventListener('input', (e) => { P.release = e.detail.value; });
    echo.addEventListener('change', (e) => { P.echo = e.detail.checked; graph(); wet.gain.setTargetAtTime(P.echo ? 0.4 : 0, audio().ctx.currentTime, 0.03); });

    const down = new Set();
    win.el.addEventListener('keydown', (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || !(e.code in KEYMAP)) return;
      e.preventDefault();
      down.add(e.code);
      noteOn(P.octave * 12 + 12 + KEYMAP[e.code]);
    });
    win.el.addEventListener('keyup', (e) => {
      if (!down.delete(e.code)) return;
      noteOff(P.octave * 12 + 12 + KEYMAP[e.code]);
    });
    win.el.addEventListener('blur', allOff, true);

    let demoTimer = 0;
    const stopDemo = () => { clearInterval(demoTimer); demoTimer = 0; bDemo.innerHTML = `${icon('play')} Demo`; allOff(); };
    bDemo.addEventListener('click', () => {
      if (demoTimer) { stopDemo(); return; }
      bDemo.innerHTML = `${icon('stop')} Stopp`;
      let i = 0;
      let prev = null;
      const base = P.octave * 12 + 12;
      const step = () => {
        if (prev != null) noteOff(prev);
        prev = base + DEMO[i % DEMO.length];
        noteOn(prev);
        i++;
        if (i > DEMO.length * 2) stopDemo();
      };
      step();
      demoTimer = setInterval(step, 170);
    });

    // ---------- Oszilloskop ----------
    const sctx = scope.getContext('2d');
    const buf = new Uint8Array(1024);
    const draw = () => {
      if (win.min) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const w = scope.clientWidth, hgt = scope.clientHeight;
      if (!w) return;
      if (scope.width !== Math.round(w * dpr)) { scope.width = Math.round(w * dpr); scope.height = Math.round(hgt * dpr); }
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sctx.clearRect(0, 0, w, hgt);
      sctx.strokeStyle = 'rgba(255,255,255,.1)';
      sctx.lineWidth = 1;
      sctx.beginPath();
      sctx.moveTo(0, hgt / 2);
      sctx.lineTo(w, hgt / 2);
      sctx.stroke();
      if (bus) audio().analyser.getByteTimeDomainData(buf); else buf.fill(128);
      const grad = sctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, '#ffb65c'); grad.addColorStop(0.5, '#ff5d6c'); grad.addColorStop(1, '#a06bff');
      sctx.strokeStyle = grad;
      sctx.lineWidth = 2;
      sctx.lineJoin = 'round';
      sctx.beginPath();
      for (let i = 0; i < 512; i++) {
        const x = (i / 511) * w;
        const y = hgt / 2 + ((buf[i] - 128) / 128) * hgt * 0.9;
        if (i) sctx.lineTo(x, y); else sctx.moveTo(x, y);
      }
      sctx.stroke();
    };
    ticker.add(draw);
    buildKeys();

    return {
      onFocus: () => win.el.focus({ preventScroll: true }),
      onClose: () => { ticker.remove(draw); stopDemo(); allOff(); if (bus) { const b = bus; setTimeout(() => b.disconnect(), 2500); } },
    };
  },
};
