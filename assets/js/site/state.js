// state.js — Erscheinungsbild (hell/dunkel) als kleiner gemeinsamer Zustand

import { store, reducedMotion } from '../core/util.js';

const root = document.documentElement;
const listeners = new Set();

export const theme = {
  get mode() { return root.dataset.theme === 'light' ? 'light' : 'dark'; },
  on(fn) { listeners.add(fn); },
  /** origin: {x, y} – von dort breitet sich das neue Design kreisförmig aus */
  set(mode, origin) {
    if (mode === this.mode) return;
    const apply = () => {
      root.dataset.theme = mode;
      store.set('fable.theme', mode);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#05060f' : '#e9edfb');
      for (const fn of listeners) fn(mode);
    };
    if (!document.startViewTransition || reducedMotion.matches) { apply(); return; }
    const x = origin?.x ?? innerWidth / 2;
    const y = origin?.y ?? 0;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const vt = document.startViewTransition(apply);
    vt.finished.catch(() => {});
    vt.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 750, easing: 'cubic-bezier(.22,1,.36,1)', pseudoElement: '::view-transition-new(root)' },
      );
    }).catch(() => {});
  },
  toggle(origin) { this.set(this.mode === 'dark' ? 'light' : 'dark', origin); },
};
