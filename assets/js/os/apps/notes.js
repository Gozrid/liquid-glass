// notes.js — Texteditor mit automatischem Speichern und Markdown-Vorschau

import { h, debounce, escapeHtml as esc } from '../../core/util.js';
import { icon } from '../../core/icons.js';
import { bus } from '../bus.js';
import { isImage } from '../sys.js';
import { vfs, HOME, basename, dirname } from '../vfs.js';
import { fsops } from '../ui.js';

const DEFAULT_DIR = `${HOME}/Dokumente/Notizen`;

/** Sehr kleines Markdown: Überschriften, Listen, Zitate, fett, kursiv, Code. */
function markdown(src) {
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  const out = [];
  let listOpen = false;
  let para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.join('<br>')}</p>`); para = []; } };
  const endList = () => { if (listOpen) { out.push('</ul>'); listOpen = false; } };
  for (const line of src.split('\n')) {
    const hd = /^(#{1,3})\s+(.*)/.exec(line);
    const li = /^\s*[-*•]\s+(.*)/.exec(line);
    const q = /^>\s?(.*)/.exec(line);
    if (hd) { flush(); endList(); out.push(`<h${hd[1].length}>${inline(hd[2])}</h${hd[1].length}>`); }
    else if (li) { flush(); if (!listOpen) { out.push('<ul>'); listOpen = true; } out.push(`<li>${inline(li[1])}</li>`); }
    else if (q) { flush(); endList(); out.push(`<blockquote>${inline(q[1])}</blockquote>`); }
    else if (!line.trim()) { flush(); endList(); }
    else { endList(); para.push(inline(line)); }
  }
  flush();
  endList();
  return out.join('');
}

export default {
  id: 'notes', name: 'Notizen', icon: 'note', colors: ['#ffd96b', '#ff9f1a'], keywords: 'editor text schreiben markdown',
  width: 740, height: 500, minW: 440, minH: 300,

  mount(win, args) {
    let path = null;
    let dir = DEFAULT_DIR;
    let preview = false;
    let lastSave = 0;

    const side = h('nav.notes-side.scroll');
    const area = h('textarea.notes-area.scroll', { spellcheck: false, placeholder: 'Schreib los …', 'aria-label': 'Text' });
    const view = h('div.notes-preview.scroll', { hidden: true });
    const status = h('span.notes-status');
    const bPrev = h('button.tool', { type: 'button', 'aria-label': 'Vorschau umschalten', title: 'Markdown-Vorschau', html: icon('sparkles') });
    const bNew = h('button.tool', { type: 'button', 'aria-label': 'Neue Notiz', title: 'Neue Notiz', html: icon('plus') });
    const bDel = h('button.tool', { type: 'button', 'aria-label': 'Notiz löschen', title: 'In den Papierkorb', html: icon('trash') });
    win.tools.append(bNew, bPrev, bDel);
    win.body.append(h('div.notes', side, h('div.notes-main', area, view, h('div.notes-foot', status))));

    const count = () => {
      const t = area.value.trim();
      const words = t ? t.split(/\s+/).length : 0;
      return `${words} ${words === 1 ? 'Wort' : 'Wörter'} · ${area.value.length} Zeichen`;
    };
    const paintStatus = (state) => { status.textContent = `${state} · ${count()}`; };
    const save = debounce(() => {
      if (!path || area.readOnly) return;
      try {
        lastSave = Date.now();
        vfs.write(path, area.value);
        paintStatus('Gespeichert');
      } catch (err) { paintStatus(`Nicht gespeichert: ${err.message}`); }
    }, 350);

    const paintSide = () => {
      let files = [];
      try { files = vfs.list(dir).filter((s) => s.type === 'file' && !isImage(s.path, s.mime)); } catch { /* Ordner fehlt */ }
      side.replaceChildren(
        h('div.notes-head', basename(dir) || 'fableOS'),
        ...(files.length ? files.map((s) => {
          const first = vfs.read(s.path).split('\n').find((l) => l.trim()) || 'Leer';
          return h('button', { type: 'button', class: s.path === path ? 'is-on' : '', onclick: () => load(s.path) },
            h('b', s.name), h('span', first.replace(/^#+\s*/, '').slice(0, 44)));
        }) : [h('div.notes-none', 'Noch keine Notizen in diesem Ordner.')]),
      );
    };
    const paintPreview = () => {
      view.hidden = !preview;
      area.hidden = preview;
      bPrev.classList.toggle('is-on', preview);
      if (preview) view.innerHTML = markdown(area.value) || '<p class="dim">Nichts zu sehen.</p>';
    };

    function load(p) {
      if (!vfs.exists(p) || vfs.isDir(p)) return;
      path = p;
      dir = dirname(p);
      area.value = vfs.read(p);
      area.readOnly = p.startsWith('/System/');
      win.setTitle(`${basename(p)} – Notizen`);
      paintStatus(area.readOnly ? 'Schreibgeschützt' : 'Gespeichert');
      paintSide();
      paintPreview();
    }
    function create() {
      if (!vfs.exists(dir) || dir.startsWith('/System')) dir = DEFAULT_DIR;
      if (!vfs.exists(dir)) { try { vfs.mkdir(dir); } catch { dir = HOME; } }
      const p = fsops.newFile(dir, 'Notiz.txt');
      if (p) { load(p); area.focus(); }
    }

    area.addEventListener('input', () => { paintStatus('Speichert …'); save(); });
    area.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end');
      area.dispatchEvent(new Event('input'));
    });
    bPrev.addEventListener('click', () => { preview = !preview; paintPreview(); });
    bNew.addEventListener('click', create);
    bDel.addEventListener('click', () => {
      if (!path || area.readOnly) return;
      const old = path;
      path = null;
      fsops.trash(old);
      const next = vfs.list(dir).find((s) => s.type === 'file' && !isImage(s.path, s.mime));
      if (next) load(next.path); else { area.value = ''; win.setTitle('Notizen'); paintStatus('Keine Notiz geöffnet'); paintSide(); }
    });

    const off = bus.on('fs', (changed) => {
      if (Date.now() - lastSave < 600 && changed === path) return;
      if (path && !vfs.exists(path)) { path = null; area.value = ''; win.setTitle('Notizen'); }
      paintSide();
    });

    if (args.path) load(args.path);
    else {
      const first = vfs.exists(dir) ? vfs.list(dir).find((s) => s.type === 'file') : null;
      if (first) load(first.path); else create();
    }
    return {
      onClose: off,
      onArgs: (a) => { if (a.path) load(a.path); },
      onFocus: () => { if (!preview && !document.activeElement?.closest?.('.rename')) area.focus({ preventScroll: true }); },
      menus: [{
        label: 'Notiz',
        items: [
          { label: 'Neue Notiz', icon: 'plus', run: create },
          { label: 'Markdown-Vorschau', icon: 'sparkles', run: () => bPrev.click() },
          '-',
          { label: 'In den Papierkorb', icon: 'trash', run: () => bDel.click() },
        ],
      }],
    };
  },
};
