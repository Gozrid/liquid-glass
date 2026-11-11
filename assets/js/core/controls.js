// controls.js — Verhalten für Schalter, Regler und Segment-Auswahl (Markup + Styles in core.css)

import { clamp, LiquidIndicator } from './util.js';

export function initSwitch(el) {
  if (el._up) return el;
  el._up = true;
  el.setAttribute('role', 'switch');
  if (!el.hasAttribute('aria-checked')) el.setAttribute('aria-checked', 'false');
  if (el.tagName === 'BUTTON') el.type = 'button';
  if (!el.querySelector('i')) el.append(document.createElement('i'));
  const set = (v, fire) => {
    el.setAttribute('aria-checked', String(!!v));
    if (fire) el.dispatchEvent(new CustomEvent('change', { detail: { checked: !!v }, bubbles: true }));
  };
  el.addEventListener('click', () => set(el.getAttribute('aria-checked') !== 'true', true));
  Object.defineProperty(el, 'checked', {
    get: () => el.getAttribute('aria-checked') === 'true',
    set: (v) => set(v, false),
  });
  return el;
}

export function initSlider(el) {
  if (el._up) return el;
  el._up = true;
  const min = Number(el.dataset.min ?? 0);
  const max = Number(el.dataset.max ?? 1);
  const step = Number(el.dataset.step ?? 0);
  el.innerHTML = '<div class="tr"><div class="fl"></div><div class="th"></div></div>';
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-valuemin', min);
  el.setAttribute('aria-valuemax', max);
  const track = el.firstElementChild;
  let value = min;

  const set = (nv, fire) => {
    nv = clamp(nv, min, max);
    if (step) nv = Math.round((nv - min) / step) * step + min;
    nv = Number(nv.toFixed(6));
    const changed = nv !== value;
    value = nv;
    el.style.setProperty('--v', (value - min) / (max - min || 1));
    el.setAttribute('aria-valuenow', value);
    if (fire && changed) el.dispatchEvent(new CustomEvent('input', { detail: { value }, bubbles: true }));
  };
  Object.defineProperty(el, 'value', { get: () => value, set: (v) => set(Number(v), false) });
  value = NaN;
  set(Number(el.dataset.value ?? min), false);

  let lastX = 0;
  let lastT = 0;
  let relax;
  const fromEvent = (e) => {
    const r = track.getBoundingClientRect();
    const tw = 30;
    set(min + clamp((e.clientX - r.left - tw / 2) / Math.max(1, r.width - tw)) * (max - min), true);
    // Tropfen dehnt sich mit der Geschwindigkeit
    const now = performance.now();
    const v = Math.abs(e.clientX - lastX) / Math.max(1, now - lastT);
    lastX = e.clientX;
    lastT = now;
    const stretch = clamp(v * 0.22, 0, 0.45);
    el.style.setProperty('--sx', 1 + stretch);
    el.style.setProperty('--sy', 1 - stretch * 0.45);
    clearTimeout(relax);
    relax = setTimeout(() => { el.style.setProperty('--sx', 1); el.style.setProperty('--sy', 1); }, 70);
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button && e.pointerType === 'mouse') return;
    el.setPointerCapture(e.pointerId);
    el.classList.add('is-drag');
    lastX = e.clientX;
    lastT = performance.now();
    fromEvent(e);
    const move = (ev) => fromEvent(ev);
    const up = () => {
      el.classList.remove('is-drag');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.dispatchEvent(new CustomEvent('change', { detail: { value }, bubbles: true }));
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
  el.addEventListener('keydown', (e) => {
    const inc = step || (max - min) / 20;
    const dir = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (dir) { e.preventDefault(); set(value + dir * inc, true); }
    else if (e.key === 'Home') { e.preventDefault(); set(min, true); }
    else if (e.key === 'End') { e.preventDefault(); set(max, true); }
  });
  return el;
}

export function initSeg(el) {
  if (el._up) return el;
  el._up = true;
  el.setAttribute('role', 'tablist');
  const btns = [...el.querySelectorAll('button')];
  let ind = el.querySelector('.ind');
  if (!ind) {
    ind = document.createElement('span');
    ind.className = 'ind';
    el.append(ind);
  }
  const li = new LiquidIndicator(el, ind);
  let index = Math.max(0, btns.findIndex((b) => b.getAttribute('aria-selected') === 'true'));
  const select = (i, fire = true, instant = false) => {
    index = i;
    btns.forEach((b, j) => {
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(j === i));
    });
    li.to(btns[i], instant);
    if (fire) {
      el.dispatchEvent(new CustomEvent('change', {
        detail: { index: i, value: btns[i].dataset.value ?? btns[i].textContent.trim() },
        bubbles: true,
      }));
    }
  };
  btns.forEach((b, i) => b.addEventListener('click', () => { if (i !== index) select(i); }));
  select(index, false, true);
  new ResizeObserver(() => li.to(btns[index], true)).observe(el);
  el.select = select;
  Object.defineProperty(el, 'index', { get: () => index });
  return el;
}

export function initControls(root = document) {
  root.querySelectorAll('.gswitch').forEach(initSwitch);
  root.querySelectorAll('.gslider').forEach(initSlider);
  root.querySelectorAll('.gseg').forEach(initSeg);
}
