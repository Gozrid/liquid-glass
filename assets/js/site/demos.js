// demos.js — die sechs Experimente in Abschnitt 03. Jedes läuft nur, solange es sichtbar ist.

import { $, $$, h, Spring, clamp, rand, ticker, whenVisible, debounce, TAU } from '../core/util.js';
import { audio, drums, midiToFreq } from '../core/audio.js';
import { icon } from '../core/icons.js';

const live = (el, frame) => whenVisible(el, (on) => { if (on) ticker.add(frame); else ticker.remove(frame); }, '60px');

// ==========================================================================
// 1 · Strömung — Partikel im Vektorfeld
// ==========================================================================
function initFlow(theme) {
  const cv = $('#flow-canvas');
  const card = cv.closest('.demo');
  const ctx = cv.getContext('2d');
  const N = 2400;
  const P = new Float32Array(N * 4);
  const PALS = [
    { dark: ['#ff9d4d', '#ff6a3d', '#ffc46b', '#ff4d6d', '#ffd9a0', '#ff7a59'], light: ['#d9480f', '#c2255c', '#e8590c', '#e03131', '#f08c00', '#d6336c'] },
    { dark: ['#6fd3ff', '#45c8ff', '#9fe8ff', '#5b8cff', '#c2f2ff', '#3fe0b0'], light: ['#1971c2', '#0b7285', '#1864ab', '#3b5bdb', '#0c8599', '#087f5b'] },
    { dark: ['#ff5df2', '#a06bff', '#3fe0b0', '#ff5d9e', '#7af0ff', '#d0a2ff'], light: ['#ae3ec9', '#7048e8', '#0ca678', '#d6336c', '#1098ad', '#9c36b5'] },
  ];
  let W = 0, H = 0, dpr = 1, mode = 0, mx = -1e4, my = -1e4;
  let tt = rand(100);

  const resize = () => {
    const first = !W;
    W = card.clientWidth;
    H = card.clientHeight;
    dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    if (first) for (let i = 0; i < N; i++) { P[i * 4] = rand(W); P[i * 4 + 1] = rand(H); }
  };
  resize();
  new ResizeObserver(debounce(resize, 100)).observe(card);

  const local = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointermove', (e) => { [mx, my] = local(e); });
  cv.addEventListener('pointerleave', () => { mx = my = -1e4; });
  cv.addEventListener('pointerdown', (e) => {
    const [x, y] = local(e);
    for (let i = 0; i < N; i++) {
      const dx = P[i * 4] - x, dy = P[i * 4 + 1] - y;
      const d = Math.hypot(dx, dy) + 0.01;
      if (d < 260) { const f = (1 - d / 260) * 1100; P[i * 4 + 2] += (dx / d) * f; P[i * 4 + 3] += (dy / d) * f; }
    }
  });
  $('#flow-mode').addEventListener('change', (e) => { mode = Number(e.detail.value); });

  live(card, (dt) => {
    tt += dt;
    const dark = theme.mode === 'dark';
    const cols = PALS[mode][theme.mode];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,.085)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
    const paths = cols.map(() => new Path2D());
    const damp = Math.exp(-dt * 2.2);
    const R = 150;
    for (let i = 0; i < N; i++) {
      const o = i * 4;
      let x = P[o], y = P[o + 1], vx = P[o + 2], vy = P[o + 3];
      const a = Math.sin(x * 0.0062 + tt * 0.23) * 1.7 + Math.cos(y * 0.0071 - tt * 0.19) * 1.7 + Math.sin((x + y) * 0.0038 + tt * 0.11) * 1.3;
      vx += Math.cos(a) * 260 * dt;
      vy += Math.sin(a) * 260 * dt;
      const dx = x - mx, dy = y - my;
      const d2 = dx * dx + dy * dy;
      if (d2 < R * R) {
        const d = Math.sqrt(d2) + 0.01;
        const f = (1 - d / R) * 2800 * dt;
        vx += (dx / d) * f;
        vy += (dy / d) * f;
      }
      vx *= damp;
      vy *= damp;
      const nx = x + vx * dt, ny = y + vy * dt;
      const p = paths[i % cols.length];
      p.moveTo(x, y);
      p.lineTo(nx, ny);
      x = nx; y = ny;
      if (x < 0) x += W; else if (x > W) x -= W;
      if (y < 0) y += H; else if (y > H) y -= H;
      if (Math.random() < 0.004) { x = rand(W); y = rand(H); vx = vy = 0; }
      P[o] = x; P[o + 1] = y; P[o + 2] = vx; P[o + 3] = vy;
    }
    ctx.lineWidth = 1.15;
    ctx.lineCap = 'round';
    ctx.globalAlpha = dark ? 0.5 : 0.8;
    paths.forEach((p, i) => { ctx.strokeStyle = cols[i]; ctx.stroke(p); });
  });
}

// ==========================================================================
// 2 · Sequencer — vier Spuren, sechzehn Schritte, alles synthetisiert
// ==========================================================================
function initSeq() {
  const el = $('#seq');
  const playBtn = $('#seq-play');
  const NAMES = ['Kick', 'Snare', 'Hat', 'Synth'];
  const NOTES = [57, 57, 60, 64, 62, 60, 57, 55, 57, 60, 64, 67, 64, 62, 60, 57];
  const DEFAULT = [
    [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0],
    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
    [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 0],
    [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0],
  ];
  const pattern = DEFAULT.map((r) => [...r]);
  const pads = [];
  const fire = (row, step, t) => {
    if (row === 0) drums.kick(t);
    else if (row === 1) drums.snare(t);
    else if (row === 2) drums.hat(t, step % 8 === 7);
    else drums.pluck(t, midiToFreq(NOTES[step] - 12), { dur: 0.3, vol: 0.2, cutoff: 2600 });
  };

  NAMES.forEach((name, r) => {
    const row = h('div.seq-row', h('span', name));
    pads[r] = [];
    for (let s = 0; s < 16; s++) {
      const pad = h('button.pad', { type: 'button', 'aria-pressed': String(!!pattern[r][s]), 'aria-label': `${name}, Schritt ${s + 1}` });
      pad.addEventListener('click', () => {
        pattern[r][s] = pattern[r][s] ? 0 : 1;
        pad.setAttribute('aria-pressed', String(!!pattern[r][s]));
        if (pattern[r][s] && !playing) fire(r, s, audio().ctx.currentTime + 0.01);
      });
      pads[r][s] = pad;
      row.append(pad);
    }
    el.append(row);
  });
  const repaint = () => pattern.forEach((row, r) => row.forEach((v, s) => pads[r][s].setAttribute('aria-pressed', String(!!v))));

  let playing = false;
  let bpm = 112;
  let step = 0;
  let nextTime = 0;
  let timer = 0;
  let queue = [];
  let shown = -1;

  const schedule = () => {
    const { ctx } = audio();
    while (nextTime < ctx.currentTime + 0.12) {
      for (let r = 0; r < 4; r++) if (pattern[r][step]) fire(r, step, nextTime);
      queue.push({ step, time: nextTime });
      nextTime += 60 / bpm / 4;
      step = (step + 1) % 16;
    }
  };
  const showStep = (s) => {
    if (shown >= 0) for (let r = 0; r < 4; r++) pads[r][shown].classList.remove('now', 'hit');
    shown = s;
    if (s < 0) return;
    for (let r = 0; r < 4; r++) {
      pads[r][s].classList.add('now');
      if (pattern[r][s]) pads[r][s].classList.add('hit');
    }
    setTimeout(() => { for (let r = 0; r < 4; r++) pads[r][s].classList.remove('hit'); }, 90);
  };
  const visual = () => {
    const now = audio().ctx.currentTime;
    while (queue.length && queue[0].time <= now) showStep(queue.shift().step);
  };
  const setPlaying = (on) => {
    if (on === playing) return;
    playing = on;
    playBtn.setAttribute('aria-pressed', String(on));
    playBtn.innerHTML = `${icon(on ? 'stop' : 'play')}<span>${on ? 'Stopp' : 'Start'}</span>`;
    if (on) {
      const { ctx } = audio();
      step = 0;
      queue = [];
      nextTime = ctx.currentTime + 0.08;
      schedule();
      timer = setInterval(schedule, 25);
      ticker.add(visual);
    } else {
      clearInterval(timer);
      ticker.remove(visual);
      queue = [];
      showStep(-1);
    }
  };
  playBtn.addEventListener('click', () => setPlaying(!playing));
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPlaying(false); });
  $('#seq-bpm').addEventListener('input', (e) => { bpm = e.detail.value; $('#seq-bpm-out').textContent = bpm; });
  $('#seq-rand').addEventListener('click', () => {
    const density = [0.3, 0.2, 0.55, 0.35];
    pattern.forEach((row, r) => row.forEach((_, s) => { row[s] = Math.random() < density[r] || (r === 0 && s % 4 === 0) ? 1 : 0; }));
    repaint();
  });
  $('#seq-clear').addEventListener('click', () => { pattern.forEach((row) => row.fill(0)); repaint(); });
}

// ==========================================================================
// 3 · Stoff — Verlet-Integration mit Abstandsbedingungen
// ==========================================================================
function initCloth(theme) {
  const cv = $('#cloth-canvas');
  const card = cv.closest('.demo');
  const ctx = cv.getContext('2d');
  const COLS = 24, ROWS = 15;
  let W = 0, H = 0, dpr = 1, sp = 14;
  let pts = [];
  let hs = [];   // waagrechte Verbindungen  (COLS-1) × ROWS
  let vs = [];   // senkrechte Verbindungen  COLS × (ROWS-1)
  const at = (i, j) => pts[j * COLS + i];

  const build = () => {
    W = card.clientWidth;
    H = card.clientHeight;
    dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const cw = Math.min(W * 0.84, 560);
    sp = cw / (COLS - 1);
    const left = (W - cw) / 2;
    const top = card.querySelector('.demo-head').offsetHeight + 26;
    pts = [];
    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < COLS; i++) {
        const x = left + i * sp, y = top + j * sp * 0.9;
        pts.push({ x, y, px: x, py: y, pin: j === 0 && (i % 4 === 0 || i === COLS - 1) });
      }
    }
    hs = new Array((COLS - 1) * ROWS).fill(true);
    vs = new Array(COLS * (ROWS - 1)).fill(true);
  };
  build();
  new ResizeObserver(debounce(() => { if (card.clientWidth !== W || card.clientHeight !== H) build(); }, 150)).observe(card);
  $('#cloth-reset').addEventListener('click', build);

  // ---------- Eingabe ----------
  let grab = null;
  let cutting = false;
  let mx = 0, my = 0;
  const local = (x, y) => { const r = cv.getBoundingClientRect(); return [x - r.left, y - r.top]; };
  const nearest = (x, y, max) => {
    let best = null, bd = max * max;
    for (const p of pts) {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };
  const cutAt = (x, y) => {
    const near = (a, b) => ((a.x + b.x) / 2 - x) ** 2 + ((a.y + b.y) / 2 - y) ** 2 < 13 * 13;
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS - 1; i++) if (hs[j * (COLS - 1) + i] && near(at(i, j), at(i + 1, j))) hs[j * (COLS - 1) + i] = false;
    for (let j = 0; j < ROWS - 1; j++) for (let i = 0; i < COLS; i++) if (vs[j * COLS + i] && near(at(i, j), at(i, j + 1))) vs[j * COLS + i] = false;
  };
  cv.addEventListener('pointerdown', (e) => {
    [mx, my] = local(e.clientX, e.clientY);
    if (e.shiftKey || !e.isPrimary) { cutting = true; cutAt(mx, my); }
    else grab = nearest(mx, my, 46);
    if (grab || cutting) { cv.setPointerCapture(e.pointerId); cv.style.cursor = cutting ? 'crosshair' : 'grabbing'; }
  });
  cv.addEventListener('pointermove', (e) => {
    [mx, my] = local(e.clientX, e.clientY);
    if (cutting) cutAt(mx, my);
  });
  const end = () => { grab = null; cutting = false; cv.style.cursor = ''; };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    const [x, y] = local(t.clientX, t.clientY);
    if (e.touches.length > 1 || nearest(x, y, 46)) e.preventDefault();
  }, { passive: false });

  // ---------- Simulation ----------
  const solve = (a, b, len, arr, idx) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 0.001;
    if (d > len * 3.6) { arr[idx] = false; return; }       // reißt bei Überdehnung
    const k = ((d - len) / d) * 0.5;
    const ox = dx * k, oy = dy * k;
    if (!a.pin && a !== grab) { a.x += b.pin || b === grab ? ox * 2 : ox; a.y += b.pin || b === grab ? oy * 2 : oy; }
    if (!b.pin && b !== grab) { b.x -= a.pin || a === grab ? ox * 2 : ox; b.y -= a.pin || a === grab ? oy * 2 : oy; }
  };
  let time = 0;
  const step = (hstep) => {
    time += hstep;
    const g = 1500 * hstep * hstep;
    for (const p of pts) {
      if (p.pin) continue;
      const wind = (Math.sin(time * 1.3 + p.y * 0.012) + Math.sin(time * 0.53 + p.x * 0.02) * 0.6) * 260 * hstep * hstep;
      const vx = (p.x - p.px) * 0.991, vy = (p.y - p.py) * 0.991;
      p.px = p.x; p.py = p.y;
      p.x += vx + wind;
      p.y += vy + g;
    }
    for (let it = 0; it < 4; it++) {
      if (grab) { grab.x = mx; grab.y = my; }
      for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS - 1; i++) { const k = j * (COLS - 1) + i; if (hs[k]) solve(at(i, j), at(i + 1, j), sp, hs, k); }
      for (let j = 0; j < ROWS - 1; j++) for (let i = 0; i < COLS; i++) { const k = j * COLS + i; if (vs[k]) solve(at(i, j), at(i, j + 1), sp * 0.9, vs, k); }
    }
  };

  let acc = 0;
  live(card, (dt) => {
    acc = Math.min(acc + dt, 0.05);
    while (acc >= 1 / 120) { step(1 / 120); acc -= 1 / 120; }
    const dark = theme.mode === 'dark';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (let j = 0; j < ROWS - 1; j++) {
      for (let i = 0; i < COLS - 1; i++) {
        if (!hs[j * (COLS - 1) + i] || !hs[(j + 1) * (COLS - 1) + i] || !vs[j * COLS + i] || !vs[j * COLS + i + 1]) continue;
        const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
        const shade = clamp((b.x - a.x) / sp, 0.35, 1.5);
        const hue = 32 - (i / (COLS - 2)) * 205;
        ctx.fillStyle = `hsla(${hue}, 92%, ${(dark ? 46 : 52) + shade * 14}%, ${(dark ? 0.2 : 0.42) + shade * 0.26})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
        ctx.fill();
      }
    }
    ctx.beginPath();
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS - 1; i++) if (hs[j * (COLS - 1) + i]) { const a = at(i, j), b = at(i + 1, j); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    for (let j = 0; j < ROWS - 1; j++) for (let i = 0; i < COLS; i++) if (vs[j * COLS + i]) { const a = at(i, j), b = at(i, j + 1); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    ctx.strokeStyle = dark ? 'rgba(255,255,255,.3)' : 'rgba(11,16,48,.22)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = dark ? '#fff' : '#0b1030';
    for (const p of pts) if (p.pin) { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, TAU); ctx.fill(); }
  });
}

// ==========================================================================
// 4 · Live-Shader — GLSL-Editor mit Sofort-Kompilierung
// ==========================================================================
const SHADERS = {
  plasma: `// r = Auflösung · t = Zeit · m = Maus (0…1)
void main() {
  vec2 p = (gl_FragCoord.xy * 2.0 - r) / r.y;
  vec2 q = m * 2.0 - 1.0;
  float v = sin(p.x * 3.0 + t)
          + sin(p.y * 4.0 - t * 1.3)
          + sin((p.x + p.y) * 2.5 + t * 0.7)
          + sin(length(p - q) * 6.0 - t * 2.0);
  vec3 c = 0.5 + 0.5 * cos(v + vec3(0.0, 2.1, 4.2));
  gl_FragColor = vec4(c, 1.0);
}`,
  ringe: `// Wellen, die von der Maus ausgehen
void main() {
  vec2 p = (gl_FragCoord.xy * 2.0 - r) / r.y;
  vec2 q = (m * 2.0 - 1.0) * vec2(r.x / r.y, 1.0);
  float d = length(p - q);
  float w = sin(d * 18.0 - t * 4.0) / (1.0 + d * 6.0);
  vec3 c = mix(vec3(0.02, 0.03, 0.1),
               vec3(1.0, 0.42, 0.3),
               smoothstep(-0.1, 0.25, w));
  c += vec3(0.2, 0.55, 1.0) * smoothstep(0.03, 0.0, abs(w));
  gl_FragColor = vec4(c, 1.0);
}`,
  kacheln: `// Truchet-Kacheln: zufällig gedrehte Viertelkreise
float h(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
void main() {
  vec2 p = gl_FragCoord.xy / r.y * (4.0 + m.x * 8.0);
  p.x += t * 0.4;
  vec2 i = floor(p), f = fract(p);
  if (h(i) > 0.5) f.x = 1.0 - f.x;
  float d = min(abs(length(f) - 0.5),
                abs(length(1.0 - f) - 0.5));
  float line = smoothstep(0.13, 0.08, d);
  vec3 col = 0.5 + 0.5 * cos(i.x * 0.4 + i.y * 0.6 + t
                             + vec3(0.0, 2.0, 4.0));
  gl_FragColor = vec4(mix(vec3(0.03, 0.04, 0.12), col, line), 1.0);
}`,
};
const SHADER_HEAD = 'precision highp float;\nuniform vec2 r;\nuniform float t;\nuniform vec2 m;\n';
const HEAD_LINES = SHADER_HEAD.split('\n').length - 1;

function initShader() {
  const cv = $('#shader-canvas');
  const src = $('#shader-src');
  const status = $('#shader-status');
  const card = cv.closest('.demo');
  const gl = cv.getContext('webgl', { antialias: false, alpha: false });
  if (!gl) {
    status.textContent = 'WebGL ist in diesem Browser nicht verfügbar.';
    status.className = 'shader-status mono err';
    src.value = SHADERS.plasma;
    return;
  }
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0., 1.); }');
  gl.compileShader(vs);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  let prog = null;
  let uni = {};
  const mouse = [0.5, 0.5];

  const compile = () => {
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, SHADER_HEAD + src.value);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(fs) || 'Unbekannter Fehler';
      const first = log.split('\n').find((l) => l.trim()) || log;
      const mm = /ERROR:\s*\d+:(\d+):\s*(.*)/.exec(first);
      status.textContent = mm ? `Zeile ${Math.max(1, Number(mm[1]) - HEAD_LINES)}: ${mm[2]}` : first;
      status.className = 'shader-status mono err';
      gl.deleteShader(fs);
      return;
    }
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'a');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      status.textContent = gl.getProgramInfoLog(p) || 'Linker-Fehler';
      status.className = 'shader-status mono err';
      return;
    }
    if (prog) gl.deleteProgram(prog);
    prog = p;
    uni = { r: gl.getUniformLocation(p, 'r'), t: gl.getUniformLocation(p, 't'), m: gl.getUniformLocation(p, 'm') };
    status.textContent = `Kompiliert · ${src.value.split('\n').length} Zeilen`;
    status.className = 'shader-status mono ok';
  };

  src.value = SHADERS.plasma;
  compile();
  src.addEventListener('input', debounce(compile, 180));
  src.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    src.setRangeText('  ', src.selectionStart, src.selectionEnd, 'end');
    src.dispatchEvent(new Event('input'));
  });
  $('#shader-presets').addEventListener('change', (e) => { src.value = SHADERS[e.detail.value]; compile(); });
  cv.addEventListener('pointermove', (e) => {
    const r = cv.getBoundingClientRect();
    mouse[0] = (e.clientX - r.left) / r.width;
    mouse[1] = 1 - (e.clientY - r.top) / r.height;
  });

  let time = 0;
  live(card, (dt) => {
    time += dt;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const w = Math.max(2, Math.round(cv.clientWidth * dpr));
    const hgt = Math.max(2, Math.round(cv.clientHeight * dpr));
    if (cv.width !== w || cv.height !== hgt) { cv.width = w; cv.height = hgt; }
    if (!prog) return;
    gl.viewport(0, 0, w, hgt);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(uni.r, w, hgt);
    gl.uniform1f(uni.t, time);
    gl.uniform2f(uni.m, mouse[0], mouse[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  });
}

// ==========================================================================
// 5 · Live-Daten — Zeigertempo als Liniendiagramm
// ==========================================================================
function initChart() {
  const box = $('#chart');
  const svg = $('#chart-svg');
  const tip = $('#chart-tip');
  const card = box.closest('.demo');
  const N = 120;                 // 12 s bei 10 Hz
  const data = new Array(N).fill(0);
  const fmt = (v) => Math.round(v).toLocaleString('de-DE');
  let acc = 0, total = 0, peak = 0, lx = null, ly = null;
  let hover = -1;                // Index unter dem Fadenkreuz
  let visible = false;
  let geo = null;

  addEventListener('pointermove', (e) => {
    if (lx != null) {
      const d = Math.hypot(e.clientX - lx, e.clientY - ly);
      acc += d;
      total += d;
    }
    lx = e.clientX;
    ly = e.clientY;
  }, { passive: true });

  const niceMax = (v) => {
    let m = 500;
    while (m < v * 1.08) m *= 2;
    return m;
  };
  const tick = (v, max) => (max >= 10000 ? `${(v / 1000).toLocaleString('de-DE')} Tsd.` : fmt(v));

  const render = () => {
    const W = box.clientWidth, H = box.clientHeight;
    if (!W || !H) return;
    const L = 46, R = 10, T = 8, B = 22;
    const iw = W - L - R, ih = H - T - B;
    const max = niceMax(Math.max(...data));
    const X = (i) => L + (i / (N - 1)) * iw;
    const Y = (v) => T + ih - (v / max) * ih;
    geo = { L, iw, X, Y, max };
    let line = '';
    for (let i = 0; i < N; i++) line += `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(data[i]).toFixed(1)}`;
    const grid = [0, 0.5, 1].map((f) => {
      const y = Math.round(Y(max * f)) + 0.5;
      return `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/>
              <text class="axis-label" x="${L - 8}" y="${y + 4}" text-anchor="end">${tick(max * f, max)}</text>`;
    }).join('');
    const xl = [[0, '−12 s', 'start'], [(N - 1) / 2, '−6 s', 'middle'], [N - 1, 'jetzt', 'end']]
      .map(([i, t, a]) => `<text class="axis-label" x="${X(i)}" y="${H - 4}" text-anchor="${a}">${t}</text>`).join('');
    let cross = '';
    if (hover >= 0) {
      cross = `<line class="crosshair" x1="${X(hover)}" x2="${X(hover)}" y1="${T}" y2="${T + ih}"/>
               <circle class="end-dot" cx="${X(hover)}" cy="${Y(data[hover])}" r="5"/>`;
    }
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `${grid}${xl}
      <path class="series-area" d="${line}L${X(N - 1)} ${Y(0)}L${X(0)} ${Y(0)}Z"/>
      <path class="series-line" d="${line}"/>
      ${cross}
      <circle class="end-dot" cx="${X(N - 1)}" cy="${Y(data[N - 1])}" r="5"/>`;
    if (hover >= 0) {
      tip.hidden = false;
      tip.querySelector('b').textContent = `${fmt(data[hover])} px/s`;
      const ago = (N - 1 - hover) / 10;
      tip.querySelector('span').textContent = ago ? `vor ${ago.toLocaleString('de-DE', { minimumFractionDigits: 1 })} s` : 'jetzt';
      tip.style.left = `${clamp(X(hover), 56, W - 56)}px`;
      tip.style.top = `${Y(data[hover])}px`;
    } else tip.hidden = true;
  };

  setInterval(() => {
    const speed = acc / 0.1;
    acc = 0;
    data.push(speed);
    data.shift();
    peak = Math.max(peak, speed);
    if (!visible) return;
    $('#st-now').textContent = fmt(speed);
    $('#st-peak').textContent = fmt(peak);
    $('#st-dist').textContent = (total * 0.0002646).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    render();
  }, 100);
  whenVisible(card, (on) => { visible = on; if (on) render(); });
  new ResizeObserver(debounce(render, 80)).observe(box);

  const indexAt = (clientX) => {
    if (!geo) return -1;
    const r = box.getBoundingClientRect();
    return clamp(Math.round(((clientX - r.left - geo.L) / geo.iw) * (N - 1)), 0, N - 1);
  };
  box.addEventListener('pointermove', (e) => { hover = indexAt(e.clientX); render(); });
  box.addEventListener('pointerleave', () => { hover = -1; render(); });
  box.addEventListener('focus', () => { if (hover < 0) hover = N - 1; render(); });
  box.addEventListener('blur', () => { hover = -1; render(); });
  box.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!d) return;
    e.preventDefault();
    hover = clamp((hover < 0 ? N - 1 : hover) + d * (e.shiftKey ? 10 : 1), 0, N - 1);
    render();
  });
}

// ==========================================================================
// 6 · Lettern — jeder Buchstabe an einer Feder
// ==========================================================================
function initType() {
  const stage = $('#type-stage');
  const input = $('#type-input');
  const card = stage.closest('.demo');
  let letters = [];
  let mx = -1e4, my = -1e4;

  const build = (word) => {
    const text = (word || 'FABLE').toUpperCase().slice(0, 12);
    const fs = Math.min(118, (stage.clientWidth * 0.9) / (text.length * 0.66));
    stage.style.setProperty('--fs', `${fs.toFixed(1)}px`);
    stage.replaceChildren();
    letters = [...text].map((ch, i) => {
      const el = h('span', { style: { '--n': i % 6 } }, ch === ' ' ? ' ' : ch);
      stage.append(el);
      return { el, x: new Spring(0, 130, 8), y: new Spring(0, 130, 8), r: new Spring(0, 110, 7), s: new Spring(1, 220, 10) };
    });
  };
  build(input.value);
  input.addEventListener('input', () => build(input.value.trim()));
  new ResizeObserver(debounce(() => build(input.value.trim()), 150)).observe(stage);

  card.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect();
    mx = e.clientX - r.left;
    my = e.clientY - r.top;
  });
  card.addEventListener('pointerleave', () => { mx = my = -1e4; });
  stage.addEventListener('pointerdown', () => {
    for (const l of letters) {
      l.x.vel += rand(-900, 900);
      l.y.vel += rand(-1400, -300);
      l.r.vel += rand(-700, 700);
      l.s.vel += rand(2, 6);
    }
  });

  let t = 0;
  live(card, (dt) => {
    t += dt;
    const R = 170;
    letters.forEach((l, i) => {
      const hx = l.el.offsetLeft + l.el.offsetWidth / 2;
      const hy = l.el.offsetTop + l.el.offsetHeight / 2;
      const dx = hx - mx, dy = hy - my;
      const d = Math.hypot(dx, dy) || 1;
      let tx = 0, ty = Math.sin(t * 1.5 + i * 0.6) * 7, tr = Math.sin(t * 1.1 + i) * 2.5;
      if (d < R) {
        const f = (1 - d / R) ** 1.4;
        tx += (dx / d) * f * 110;
        ty += (dy / d) * f * 110;
        tr += (dx / d) * f * 34;
      }
      l.x.t = tx; l.y.t = ty; l.r.t = tr;
      l.x.step(dt); l.y.step(dt); l.r.step(dt); l.s.step(dt);
      l.el.style.transform = `translate3d(${l.x.v.toFixed(1)}px, ${l.y.v.toFixed(1)}px, 0) rotate(${l.r.v.toFixed(2)}deg) scale(${Math.max(0.3, l.s.v).toFixed(3)})`;
    });
  });
}

export function initDemos(theme) {
  for (const fn of [initFlow, initSeq, initCloth, initShader, initChart, initType]) {
    try { fn(theme); } catch (err) { console.error(`Demo ${fn.name} konnte nicht starten:`, err); }
  }
}
