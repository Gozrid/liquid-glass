// dnd.js — Dateien ziehen: vom Schreibtisch in Ordner, zwischen Fenstern, in den Papierkorb.
// Zeigerbasiert (kein HTML5-Drag-and-drop): Ziele sind alle Elemente mit data-drop-path.

import { h } from '../core/util.js';
import { vfs, basename, dirname } from './vfs.js';
import { fsops, fileIcon } from './ui.js';

const valid = (paths, dir) => vfs.isDir(dir) && paths.some((p) => dirname(p) !== dir) && paths.every((p) => p !== dir && !dir.startsWith(`${p}/`));

/**
 * Macht ein Element zur Zieh-Quelle. getPaths() liefert die Pfade, die mitgezogen werden.
 * @param {HTMLElement} el
 * @param {() => string[]} getPaths
 */
export function fileDrag(el, getPaths) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.pointerType === 'touch' || e.target.closest('input, textarea')) return;
    const x0 = e.clientX, y0 = e.clientY;
    let ghost = null;
    let target = null;
    let paths = [];
    const cleanup = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', cleanup);
      target?.classList.remove('is-drop');
      ghost?.remove();
      document.body.classList.remove('is-file-drag');
    };
    function move(ev) {
      if (!ghost) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) return;
        paths = (getPaths() || []).filter((p) => vfs.exists(p));
        if (!paths.length) { cleanup(); return; }
        ghost = h('div.drag-ghost', fileIcon(vfs.stat(paths[0])), paths.length > 1 ? h('b', String(paths.length)) : h('span', basename(paths[0])));
        document.body.append(ghost);
        document.body.classList.add('is-file-drag');
        // der Klick nach dem Loslassen gehört zum Ziehen, nicht zum Symbol
        const swallow = (c) => { c.stopPropagation(); c.preventDefault(); };
        el.addEventListener('click', swallow, { capture: true, once: true });
        addEventListener('pointerup', () => setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 0), { once: true });
      }
      ghost.style.translate = `${ev.clientX + 12}px ${ev.clientY + 10}px`;
      const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-drop-path]');
      const hit = under && valid(paths, under.dataset.dropPath) ? under : null;
      if (hit !== target) {
        target?.classList.remove('is-drop');
        target = hit;
        target?.classList.add('is-drop');
      }
    }
    function up() {
      const dir = ghost && target ? target.dataset.dropPath : null;
      cleanup();
      if (dir) fsops.moveInto(paths, dir);
    }
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', cleanup);
  });
}

/** Dateien vom echten Gerät, die auf ein Element fallen, in einen Ordner übernehmen. getDir() → Zielordner. */
export function hostDrop(el, getDir) {
  el.addEventListener('dragover', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    for (const other of document.querySelectorAll('.is-host-drop')) if (other !== el) other.classList.remove('is-host-drop');
    el.classList.add('is-host-drop');
  });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('is-host-drop'); });
  el.addEventListener('drop', (e) => {
    el.classList.remove('is-host-drop');
    const list = [...(e.dataTransfer?.files || [])];
    if (!list.length) return;
    e.preventDefault();
    e.stopPropagation();
    const dir = getDir();
    if (dir) fsops.importHost(dir, list);
  });
}

// Hervorhebung verschwindet, sobald die Datei das Fenster verlässt oder irgendwo landet
for (const evt of ['drop', 'dragend']) addEventListener(evt, () => { for (const el of document.querySelectorAll('.is-host-drop')) el.classList.remove('is-host-drop'); }, true);
addEventListener('dragleave', (e) => { if (!e.relatedTarget) for (const el of document.querySelectorAll('.is-host-drop')) el.classList.remove('is-host-drop'); });
