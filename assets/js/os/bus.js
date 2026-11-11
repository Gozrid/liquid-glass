// bus.js — winziger Ereignisbus, über den die Teile von fableOS miteinander reden

const listeners = new Map();

export const bus = {
  on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => listeners.get(evt)?.delete(fn);
  },
  emit(evt, data) {
    for (const fn of [...(listeners.get(evt) || [])]) {
      try { fn(data); } catch (err) { console.error(`[bus:${evt}]`, err); }
    }
  },
};
