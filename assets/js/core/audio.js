// audio.js — alles Hörbare wird synthetisiert (WebAudio), keine Sounddateien.

let ctx = null;
let master = null;
let analyserNode = null;
let noiseBuf = null;
let unlocked = false;
let volume = 0.5;

// Browser erlauben Audio erst nach einer Nutzergeste
const unlock = () => { unlocked = true; };
addEventListener('pointerdown', unlock, { capture: true, passive: true });
addEventListener('keydown', unlock, { capture: true, passive: true });

export function audio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 1024;
    analyserNode.smoothingTimeConstant = 0.82;
    master.connect(comp);
    comp.connect(analyserNode);
    analyserNode.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return { ctx, out: master, analyser: analyserNode };
}

export const audioReady = () => unlocked;
export const getVolume = () => volume;
export function setVolume(v) {
  volume = Math.min(1, Math.max(0, v));
  if (master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
}

function noise() {
  const { ctx: c } = audio();
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  return src;
}

/** Einfacher Ton mit Hüllkurve. when = Sekunden ab jetzt ODER absolute Zeit (abs: true). */
export function tone({ type = 'sine', f = 440, f2, dur = 0.12, vol = 0.2, attack = 0.004, when = 0, abs = false, dest } = {}) {
  const { ctx: c, out } = audio();
  const t = abs ? when : c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(dest || out);
  o.start(t);
  o.stop(t + dur + 0.03);
}

// ---------- Interface-Klänge ----------
export const sfx = {
  enabled: true,
  _ok() { return this.enabled && unlocked; },
  tick() { if (this._ok()) tone({ type: 'triangle', f: 1900, f2: 1300, dur: 0.03, vol: 0.05 }); },
  pop() { if (this._ok()) tone({ f: 500, f2: 900, dur: 0.1, vol: 0.09 }); },
  drop() { if (this._ok()) tone({ f: 720, f2: 300, dur: 0.13, vol: 0.08 }); },
  notify() {
    if (!this._ok()) return;
    tone({ f: 880, dur: 0.16, vol: 0.08 });
    tone({ f: 1318.5, dur: 0.26, vol: 0.07, when: 0.09 });
  },
  error() { if (this._ok()) tone({ type: 'square', f: 170, f2: 120, dur: 0.16, vol: 0.05 }); },
  chime() {
    if (!this._ok()) return;
    [261.63, 392, 523.25, 659.25, 987.77].forEach((f, i) => {
      tone({ f, dur: 1.5 - i * 0.12, vol: 0.075, attack: 0.03, when: i * 0.075 });
      tone({ type: 'triangle', f: f * 2, dur: 0.8, vol: 0.016, attack: 0.03, when: i * 0.075 });
    });
  },
};

// ---------- Schlagzeug & Synth (Sequencer, „Klang“-App) ----------
export const drums = {
  kick(t) {
    tone({ f: 150, f2: 42, dur: 0.32, vol: 0.9, attack: 0.002, when: t, abs: true });
  },
  snare(t) {
    const { ctx: c, out } = audio();
    const n = noise();
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;
    const g = c.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    n.connect(hp); hp.connect(g); g.connect(out);
    n.start(t); n.stop(t + 0.2);
    tone({ type: 'triangle', f: 210, f2: 150, dur: 0.09, vol: 0.35, when: t, abs: true });
  },
  hat(t, open = false) {
    const { ctx: c, out } = audio();
    const n = noise();
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7500;
    const g = c.createGain();
    const dur = open ? 0.22 : 0.045;
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(hp); hp.connect(g); g.connect(out);
    n.start(t); n.stop(t + dur + 0.02);
  },
  pluck(t, freq, { type = 'sawtooth', dur = 0.28, vol = 0.22, cutoff = 2400 } = {}) {
    const { ctx: c, out } = audio();
    const o = c.createOscillator();
    const o2 = c.createOscillator();
    const lp = c.createBiquadFilter();
    const g = c.createGain();
    o.type = type;
    o2.type = type;
    o.frequency.value = freq;
    o2.frequency.value = freq * 1.006;
    lp.type = 'lowpass';
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(cutoff, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * 0.12), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(out);
    o.start(t); o2.start(t);
    o.stop(t + dur + 0.03); o2.stop(t + dur + 0.03);
  },
};

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
