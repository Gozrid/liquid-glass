// glassfx.js — Feinschliff fürs DOM-Glas
//  · Glanzpunkt, der dem Zeiger folgt (alle Browser)
//  · echte Kantenbrechung per SVG-Displacement im backdrop-filter (nur Chromium –
//    Safari/Firefox unterstützen url()-Filter im Backdrop nicht und behalten den Blur)

import { debounce } from './util.js';

export const isChromium = (() => {
  const brands = navigator.userAgentData?.brands;
  if (brands) return brands.some((b) => /Chromium/i.test(b.brand));
  return /Chrome\/|Chromium\//.test(navigator.userAgent);
})();

export function initSheen() {
  let cur = null;
  document.addEventListener('pointermove', (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-sheen]') : null;
    if (cur && cur !== el) cur.style.setProperty('--sheen', '0');
    if (el) {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
      el.style.setProperty('--sheen', '1');
    }
    cur = el;
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => {
    if (cur) cur.style.setProperty('--sheen', '0');
    cur = null;
  });
}

// ---------- Brechung ----------
let defs = null;
let counter = 0;

function ensureDefs() {
  if (defs) return defs;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  svg.append(defs);
  document.body.append(svg);
  return defs;
}

/**
 * Displacement-Map für ein abgerundetes Rechteck: R/G kodieren einen Vektor,
 * der an der Kante nach innen zeigt (konvexe Glaskante), in der Mitte neutral ist.
 */
function buildMap(w, hgt, radius, bezel, curve) {
  const res = Math.min(1, 640 / Math.max(w, hgt));
  const cw = Math.max(2, Math.round(w * res));
  const ch = Math.max(2, Math.round(hgt * res));
  const cv = document.createElement('canvas');
  cv.width = cw;
  cv.height = ch;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(cw, ch);
  const data = img.data;
  const hw = w / 2;
  const hh = hgt / 2;
  const r = Math.min(radius, hw, hh);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const px = (x + 0.5) / res - hw;
      const py = (y + 0.5) / res - hh;
      const qx = Math.abs(px) - (hw - r);
      const qy = Math.abs(py) - (hh - r);
      let dist, gx, gy;
      if (qx > 0 && qy > 0) {
        const l = Math.hypot(qx, qy) || 1;
        dist = l - r; gx = qx / l; gy = qy / l;
      } else if (qx > qy) {
        dist = qx - r; gx = 1; gy = 0;
      } else {
        dist = qy - r; gx = 0; gy = 1;
      }
      if (px < 0) gx = -gx;
      if (py < 0) gy = -gy;
      const depth = -dist;
      let m = 0;
      if (depth < bezel) m = Math.pow(1 - Math.max(depth, 0) / bezel, curve);
      const i = (y * cw + x) * 4;
      data[i] = Math.round(128 - gx * m * 127);
      data[i + 1] = Math.round(128 - gy * m * 127);
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}

/**
 * Hängt einem Glas-Element echte Kantenbrechung an (Chromium).
 * @param {HTMLElement} el
 * @param {{bezel?: number, scale?: number, chroma?: number, curve?: number, blur?: string}} o
 */
export function refract(el, o = {}) {
  if (!isChromium || el._lg) return;
  const opt = { bezel: 18, scale: 44, chroma: 0.16, curve: 2.4, ...o };
  const id = `lg-${++counter}`;
  const state = { w: 0, h: 0, node: null };
  el._lg = state;

  const restyle = () => {
    const cs = getComputedStyle(el);
    const blur = opt.blur || cs.getPropertyValue('--glass-blur').trim() || '16px';
    const sat = cs.getPropertyValue('--glass-sat').trim() || '150%';
    const bright = cs.getPropertyValue('--glass-bright').trim() || '1';
    el.style.backdropFilter = `blur(${blur}) url(#${id}) saturate(${sat}) brightness(${bright})`;
  };
  const update = () => {
    if (!el.isConnected) return;
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    if (!w || !hgt || (w === state.w && hgt === state.h)) return;
    state.w = w;
    state.h = hgt;
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    const bezel = Math.min(opt.bezel, Math.min(w, hgt) / 2);
    const url = buildMap(w, hgt, radius, bezel, opt.curve);
    // Einheiten relativ zur Elementbox: ändert das Element kurz seine Größe (Dock-Lupe,
    // kompakte Navigation), dehnt sich die Map mit, bis sie neu berechnet ist.
    const unit = Math.sqrt((w * w + hgt * hgt) / 2);
    const c = opt.chroma;
    const disp = (scale, result) =>
      `<feDisplacementMap in="SourceGraphic" in2="m" scale="${(scale / unit).toFixed(5)}" xChannelSelector="R" yChannelSelector="G" result="${result}"/>`;
    const markup = c > 0
      ? `${disp(opt.scale * (1 - c), 'dr')}
         <feColorMatrix in="dr" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>
         ${disp(opt.scale, 'dg')}
         <feColorMatrix in="dg" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>
         ${disp(opt.scale * (1 + c), 'db')}
         <feColorMatrix in="db" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/>
         <feBlend in="r" in2="g" mode="screen" result="rg"/>
         <feBlend in="rg" in2="b" mode="screen"/>`
      : disp(opt.scale, 'out');
    if (state.node) state.node.remove();
    ensureDefs().insertAdjacentHTML('beforeend',
      `<filter id="${id}" x="0" y="0" width="1" height="1" primitiveUnits="objectBoundingBox" color-interpolation-filters="sRGB">
         <feImage href="${url}" x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="m"/>
         ${markup}
       </filter>`);
    state.node = defs.lastElementChild;
    restyle();
  };

  state.update = restyle;
  new ResizeObserver(debounce(update, 80)).observe(el);
  update();
}

/** Alle [data-refract="bezel,scale"]-Elemente aufrüsten. */
export function initGlass(root = document) {
  for (const el of root.querySelectorAll('[data-refract]')) {
    const [bezel, scale] = (el.dataset.refract || '').split(',').map(Number);
    refract(el, {
      ...(bezel ? { bezel } : {}),
      ...(scale ? { scale } : {}),
      ...(el.dataset.refractBlur ? { blur: el.dataset.refractBlur } : {}),
    });
  }
}

/** Nach Theme-/Einstellungswechsel neu aufbauen (Blur/Sättigung stecken im Inline-Style). */
export function refreshGlass(root = document) {
  for (const el of root.querySelectorAll('[data-refract]')) el._lg?.update?.();
}
