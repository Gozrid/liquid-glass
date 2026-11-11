// stage.js — WebGL2-Bühne: prozedurale Hintergründe + echtes „Liquid Glass“
// Pass 1 rendert den Hintergrund klein in ein FBO, Pass 2 setzt ihn zusammen und
// bricht ihn durch SDF-Formen (weiche Vereinigung → Tropfen verschmelzen).

import { hexToRgb } from './util.js';

const VERT = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0., 1.); }`;

const WALL_LIB = `
uniform vec3 uPal[5];
uniform int uMode;
uniform vec2 uPtr;

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// 0 · Aurora: seidige, domain-verzerrte Farbbänder
vec3 wAurora(vec2 p, float t){
  vec2 q = p * 1.45 + uPtr * .06;
  for (int i = 1; i < 5; i++) {
    float f = float(i);
    q += vec2(.6 / f * sin(f * q.y * 1.35 + t * .17 + f * 1.9),
              .6 / f * cos(f * q.x * 1.2 - t * .14 + f * 2.7));
  }
  float a = pow(.5 + .5 * sin(q.x * 1.25 + q.y * .95), 2.4);
  float b = pow(.5 + .5 * sin(q.x * .8 - q.y * 1.55 + 1.3), 3.);
  float c = pow(.5 + .5 * sin((q.x + q.y) * 1.05 - 2.1 + t * .06), 5.);
  vec3 col = uPal[0];
  col = mix(col, uPal[1], a * .95);
  col = mix(col, uPal[2], b * .85);
  col = mix(col, uPal[3], c * .62);
  col = mix(col, uPal[4], clamp(a * b * c * 1.5, 0., .7));
  col *= .94 - .3 * smoothstep(.35, 1.3, length(p));
  return col;
}

// 1 · Dünen: geschichtete Wellenkämme mit Sonne
vec3 wDunes(vec2 p, float t, float aa){
  // uPal: 0 Tiefe · 1 Himmel oben · 2 ferne Dünen · 3 nahe Dünen · 4 Sonne/Horizont
  vec3 col = mix(uPal[1], mix(uPal[4], uPal[2], .45), smoothstep(-.6, .1, p.y));
  vec2 sp = vec2(.3 + uPtr.x * .02, -.1 + uPtr.y * .01);
  float sd = length(p - sp);
  col = mix(col, uPal[4], smoothstep(.15 + aa, .15 - aa, sd) * .92);
  col += uPal[4] * .3 * exp(-sd * 3.8);
  for (int i = 0; i < 6; i++) {
    float f = float(i);
    float par = uPtr.x * .014 * (f + 1.);
    float y = .02 + f * .085
      + .075 * sin((p.x + par) * (1.3 + f * .42) + t * (.05 + f * .012) + f * 1.7)
      + .024 * sin((p.x + par) * (3.7 + f * .9) - t * .04 + f * 5.1);
    float m = smoothstep(-aa, aa, p.y - y);
    vec3 lc = mix(uPal[2], uPal[3], f / 5.);
    lc = mix(lc, uPal[0], f * .13);
    lc *= 1.25 - .6 * smoothstep(0., .4, p.y - y);
    col = mix(col, lc, m);
  }
  return col;
}

// 2 · Orbits: weiche, treibende Kugeln
vec3 wOrbs(vec2 p, float t, float aa){
  vec3 col = mix(uPal[0], uPal[1] * .45, smoothstep(-.6, .8, p.y + p.x * .3));
  for (int i = 0; i < 7; i++) {
    float f = float(i);
    vec2 c = vec2(sin(t * .06 * (1. + f * .31) + f * 2.4) * .85,
                  cos(t * .05 * (1. + f * .23) + f * 1.3) * .42) + uPtr * .02 * (f - 3.);
    float r = .12 + .1 * fract(f * .618);
    float d = length(p - c);
    vec3 oc = uPal[1 + (i % 4)];
    float body = smoothstep(r + aa, r - aa, d);
    float shade = .5 + .5 * smoothstep(r, -r, (p.y - c.y) + (p.x - c.x) * .5);
    col = mix(col, oc * shade, body * .85);
    col += oc * .15 * exp(-max(d - r, 0.) * 9.);
  }
  return col;
}

// 3 · Höhenlinien: verzerrtes Konturfeld
vec3 wLines(vec2 p, float t, float aa){
  vec2 q = p * 1.1 + uPtr * .04;
  for (int i = 1; i < 4; i++) {
    float f = float(i);
    q += vec2(.5 / f * sin(f * q.y * 1.3 + t * .11 + f * 1.3),
              .5 / f * cos(f * q.x * 1.2 - t * .09 + f * 2.1));
  }
  float v = (q.y * .9 + .4 * sin(q.x * 1.4)) * 8.;
  float w = max(fwidth(v), 1e-4);
  float dl = abs(fract(v + .5) - .5);
  float line = 1. - smoothstep(w * .7, w * 1.9, dl);
  float band = floor(v + .5);
  float hsh = fract(sin(band * 12.9898) * 43758.5453);
  vec3 base = mix(uPal[0], uPal[1] * .5, smoothstep(-.7, .7, p.y - p.x * .25));
  base += uPal[2] * .1 * hsh;
  vec3 lc = mix(uPal[2], uPal[3], hsh);
  lc = mix(lc, uPal[4], step(.8, hsh));
  vec3 col = mix(base, lc, line * .9);
  col *= 1. - .3 * smoothstep(.4, 1.3, length(p));
  return col;
}

vec3 wall(vec2 p, float t, float aa){
  if (uMode == 1) return wDunes(p, t, aa);
  if (uMode == 2) return wOrbs(p, t, aa);
  if (uMode == 3) return wLines(p, t, aa);
  return wAurora(p, t);
}
`;

const WALL_FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime, uDither;
out vec4 o;
${WALL_LIB}
void main(){
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 p = (px - .5 * uRes) / uRes.y;
  vec3 c = wall(p, uTime, 1.5 / uRes.y);
  c += (hash12(gl_FragCoord.xy + fract(uTime) * 61.) - .5) * uDither;
  o = vec4(c, 1.);
}`;

const COMP_FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime, uDpr;
uniform sampler2D uBg, uTex;
uniform vec4 uTexRect;
uniform vec2 uTexShift;
uniform float uTexOn, uWrap;
uniform int uCount;
uniform vec4 uShape[8];
uniform float uRad[8];
uniform float uK, uBezel, uRefr, uCurve, uDisp, uFrost, uTint, uSpec, uShadow;
uniform vec3 uTintCol;
out vec4 o;

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float sdBox(vec2 p, vec2 b, float r){
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r;
}
float smin(float a, float b, float k){
  float h = max(k - abs(a - b), 0.) / k;
  return min(a, b) - h * h * k * .25;
}
// Distanzfeld aller Glasformen; smin lässt sie wie Flüssigkeit verschmelzen
float field(vec2 p){
  float d = 1e5;
  for (int i = 0; i < 8; i++) {
    if (i >= uCount) break;
    float di = sdBox(p - uShape[i].xy, uShape[i].zw, uRad[i]);
    d = uK > .5 ? smin(d, di, uK) : min(d, di);
  }
  return d;
}
vec3 sceneAt(vec2 px, float lod){
  vec3 c = texture(uBg, vec2(px.x, uRes.y - px.y) / uRes).rgb;
  if (uTexOn > .5) {
    vec2 uv = (px - uTexRect.xy) / uTexRect.zw;
    bool inside = uv.y >= 0. && uv.y <= 1. && (uWrap > .5 || (uv.x >= 0. && uv.x <= 1.));
    if (inside) {
      vec4 t = textureLod(uTex, uv + uTexShift, lod);
      c = c * (1. - t.a) + t.rgb;
    }
  }
  return c;
}
// Milchglas: 8 Proben auf einer Scheibe, gröbere Mip-Stufe für größere Radien
vec3 frosted(vec2 px, float r){
  if (r < .75) return sceneAt(px, 0.);
  float lod = max(log2(r) - 1.2, 0.);
  float rot = hash12(gl_FragCoord.xy) * 6.2831;
  vec3 acc = vec3(0.);
  for (int i = 0; i < 8; i++) {
    float a = rot + float(i) * 2.39996;
    float rr = r * sqrt((float(i) + .5) / 8.);
    acc += sceneAt(px + vec2(cos(a), sin(a)) * rr, lod);
  }
  return acc / 8.;
}

void main(){
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec3 col = sceneAt(px, 0.);
  if (uCount > 0) {
    float d = field(px);
    if (d < 64. * uDpr) {
      float sh = field(px - vec2(0., 14. * uDpr));
      col *= 1. - uShadow * .3 * (1. - smoothstep(-12. * uDpr, 48. * uDpr, sh));
    }
    if (d < 1.) {
      vec2 e = vec2(1.5, 0.);
      vec2 g = vec2(field(px + e.xy) - field(px - e.xy), field(px + e.yx) - field(px - e.yx));
      float glen = length(g);
      vec2 n = glen > 1e-5 ? g / glen : vec2(0.);
      float depth = max(-d, 0.);
      float s = 1. - clamp(depth / uBezel, 0., 1.);   // 1 an der Kante → 0 im flachen Inneren
      float bend = pow(s, uCurve);
      vec2 off = -n * bend * uRefr;                    // Brechung: Blick wandert nach innen
      vec3 gc;
      if (uDisp > .01) {                               // Dispersion: R/G/B brechen verschieden stark
        float sp = uDisp * .35;
        gc = vec3(frosted(px + off * (1. - sp), uFrost).r,
                  frosted(px + off, uFrost).g,
                  frosted(px + off * (1. + sp), uFrost).b);
      } else {
        gc = frosted(px + off, uFrost);
      }
      gc = mix(gc, uTintCol, uTint);
      // Licht: Hauptlicht oben links, Gegenlicht unten rechts
      vec2 L = normalize(vec2(-.55, -.83));
      float nl = dot(n, L);
      float rim = pow(s, 7.);
      float band = pow(s, 2.4);
      float key = pow(max(nl, 0.), 1.6);
      float back = pow(max(-nl, 0.), 2.6);
      gc += vec3(1.) * (key * (rim * 1.25 + band * .16) + back * (rim * .7 + band * .07)) * uSpec;
      gc += vec3(1.) * rim * .09 * uSpec;
      gc *= 1. - .14 * band * (1. - key) * (1. - back);
      gc += .012;
      col = mix(col, gc, clamp(.5 - d, 0., 1.));
    }
  }
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 61.) - .5) * (1.6 / 255.);
  o = vec4(col, 1.);
}`;

export const PALETTES = {
  dark: ['#04061a', '#1436c4', '#5a22c6', '#e2486a', '#ffb86b'],
  light: ['#eef2ff', '#aecdff', '#d3bcff', '#ffc1b6', '#fff3d6'],
};

export class Stage {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{composite?: boolean, dprCap?: number, bgScale?: number, mode?: number, palette?: string[]}} opts
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.composite = opts.composite ?? true;
    this.dprCap = opts.dprCap ?? 2;
    this.bgScale = opts.bgScale ?? 0.25;
    this.mode = opts.mode ?? 0;
    this.pointer = [0, 0];
    this.shapes = [];                       // {x, y, w, h, r} in CSS-Pixeln (Mittelpunkt, volle Größe)
    this.params = { refr: 46, bezel: 34, curve: 2.2, disp: 0.5, frost: 0, tint: 0.03, spec: 1, shadow: 1, k: 36, tintCol: [1, 1, 1] };
    this.texRect = [0, 0, 1, 1];            // CSS-Pixel: x, y, w, h
    this.texShift = [0, 0];
    this.texOn = false;
    this.texWrap = false;
    this.pal = new Float32Array(15);
    this.palTarget = new Float32Array(15);
    this._palInit = false;
    this._texSource = null;
    this.setPalette(opts.palette || PALETTES.dark, false);

    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 nicht verfügbar');
    this.gl = gl;
    this.lost = false;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this._init(); });
    this._init();
  }

  _init() {
    const gl = this.gl;
    this.W = this.H = 0;
    this.progWall = this._program(VERT, WALL_FRAG);
    this.progComp = this.composite ? this._program(VERT, COMP_FRAG) : null;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.halfFloat = !!gl.getExtension('EXT_color_buffer_float');
    this.fbo = null;
    this.bgTex = null;
    this.tex = null;
    if (this._texSource) this.setTexture(this._texSource, this.texWrap);
  }

  _program(vsrc, fsrc) {
    const gl = this.gl;
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vsrc));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fsrc));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(p));
    const cache = new Map();
    p.u = (name) => {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(p, name));
      return cache.get(name);
    };
    return p;
  }

  setPalette(hexes, animate = true) {
    hexes.slice(0, 5).forEach((hex, i) => this.palTarget.set(hexToRgb(hex), i * 3));
    if (!animate || !this._palInit) {
      this.pal.set(this.palTarget);
      this._palInit = true;
    }
  }

  /** Inhaltsebene (Canvas/Bild, vormultipliziertes Alpha) über dem Hintergrund. */
  setTexture(source, wrap = false) {
    const gl = this.gl;
    this._texSource = source;
    this.texWrap = wrap;
    if (!source) { this.texOn = false; return; }
    if (!this.tex) this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.texOn = true;
  }

  get maxTexture() { return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE); }

  resize() {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    const w = Math.max(2, Math.round(this.canvas.clientWidth * dpr));
    const hgt = Math.max(2, Math.round(this.canvas.clientHeight * dpr));
    this.dpr = dpr;
    if (w === this.W && hgt === this.H) return false;
    this.W = this.canvas.width = w;
    this.H = this.canvas.height = hgt;
    if (this.composite) {
      this.bw = Math.max(64, Math.round(w * this.bgScale));
      this.bh = Math.max(64, Math.round(hgt * this.bgScale));
      if (!this.bgTex) this.bgTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
      if (this.halfFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, this.bw, this.bh, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.bw, this.bh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (!this.fbo) this.fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.bgTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    return true;
  }

  _wall(w, hgt, t, dither) {
    const gl = this.gl;
    const p = this.progWall;
    gl.useProgram(p);
    gl.uniform2f(p.u('uRes'), w, hgt);
    gl.uniform1f(p.u('uTime'), t);
    gl.uniform1f(p.u('uDither'), dither);
    gl.uniform3fv(p.u('uPal'), this.pal);
    gl.uniform1i(p.u('uMode'), this.mode);
    gl.uniform2f(p.u('uPtr'), this.pointer[0], this.pointer[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  render(t, dt = 0.016) {
    if (this.lost) return;
    const gl = this.gl;
    this.resize();
    const f = 1 - Math.exp(-dt * 5);
    for (let i = 0; i < 15; i++) this.pal[i] += (this.palTarget[i] - this.pal[i]) * f;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);

    if (!this.composite) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.W, this.H);
      this._wall(this.W, this.H, t, 1.6 / 255);
      return;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.bw, this.bh);
    this._wall(this.bw, this.bh, t, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.W, this.H);
    const p = this.progComp;
    const d = this.dpr;
    const P = this.params;
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
    gl.uniform1i(p.u('uBg'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texOn && this.tex ? this.tex : this.bgTex);
    gl.uniform1i(p.u('uTex'), 1);
    gl.uniform2f(p.u('uRes'), this.W, this.H);
    gl.uniform1f(p.u('uTime'), t);
    gl.uniform1f(p.u('uDpr'), d);
    gl.uniform4f(p.u('uTexRect'), this.texRect[0] * d, this.texRect[1] * d, Math.max(1, this.texRect[2] * d), Math.max(1, this.texRect[3] * d));
    gl.uniform2f(p.u('uTexShift'), this.texShift[0], this.texShift[1]);
    gl.uniform1f(p.u('uTexOn'), this.texOn && this.tex ? 1 : 0);
    gl.uniform1f(p.u('uWrap'), this.texWrap ? 1 : 0);

    const n = Math.min(8, this.shapes.length);
    const sh = (this._sh ||= new Float32Array(32));
    const rad = (this._rad ||= new Float32Array(8));
    for (let i = 0; i < n; i++) {
      const s = this.shapes[i];
      sh[i * 4] = s.x * d;
      sh[i * 4 + 1] = s.y * d;
      sh[i * 4 + 2] = (s.w / 2) * d;
      sh[i * 4 + 3] = (s.h / 2) * d;
      rad[i] = Math.min(s.r, s.w / 2, s.h / 2) * d;
    }
    gl.uniform1i(p.u('uCount'), n);
    gl.uniform4fv(p.u('uShape'), sh);
    gl.uniform1fv(p.u('uRad'), rad);
    gl.uniform1f(p.u('uK'), P.k * d);
    gl.uniform1f(p.u('uBezel'), Math.max(1, P.bezel * d));
    gl.uniform1f(p.u('uRefr'), P.refr * d);
    gl.uniform1f(p.u('uCurve'), P.curve);
    gl.uniform1f(p.u('uDisp'), P.disp);
    gl.uniform1f(p.u('uFrost'), P.frost * d);
    gl.uniform1f(p.u('uTint'), P.tint);
    gl.uniform1f(p.u('uSpec'), P.spec);
    gl.uniform1f(p.u('uShadow'), P.shadow);
    gl.uniform3f(p.u('uTintCol'), P.tintCol[0], P.tintCol[1], P.tintCol[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

/** Distanzfeld-Test in JS (für Treffer beim Ziehen von Formen). */
export function shapeDistance(s, x, y) {
  const r = Math.min(s.r, s.w / 2, s.h / 2);
  const qx = Math.abs(x - s.x) - s.w / 2 + r;
  const qy = Math.abs(y - s.y) - s.h / 2 + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
