// quicklook.js — Übersicht: schnelle Vorschau für Dateien (Leertaste), ohne eine App zu öffnen

import { h } from '../core/util.js';
import { icon } from '../core/icons.js';
import { sfx } from '../core/audio.js';
import { sys, apps, kindOf, kindName } from './sys.js';
import { vfs, basename, formatSize } from './vfs.js';
import { fileIcon, fileBlob, fsops } from './ui.js';

export function initQuickLook() {
  const title = h('b.ql-title');
  const meta = h('span.ql-meta');
  const body = h('div.ql-body');
  const bPrev = h('button.tool', { type: 'button', 'aria-label': 'Vorherige Datei', title: 'Vorherige', html: icon('chevronLeft') });
  const bNext = h('button.tool', { type: 'button', 'aria-label': 'Nächste Datei', title: 'Nächste', html: icon('chevronRight') });
  const bOpen = h('button.kit-btn.round', { type: 'button' });
  const bSave = h('button.tool', { type: 'button', 'aria-label': 'Auf dieses Gerät laden', title: 'Auf dieses Gerät laden', html: icon('download') });
  const bClose = h('button.tool', { type: 'button', 'aria-label': 'Schließen', title: 'Schließen', html: icon('close') });
  const card = h('div.ql.glass.thick', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Vorschau', tabIndex: -1 },
    h('header.ql-bar', bClose, bPrev, bNext, h('div.ql-name', title, meta), bSave, bOpen), body);
  const el = h('div#quicklook', { hidden: true }, card);
  document.getElementById('overlays').append(el);

  let list = [];
  let idx = 0;
  let blobUrl = '';
  let before = null;

  const release = () => { if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = ''; } };
  const close = () => {
    if (el.hidden) return;
    el.hidden = true;
    body.replaceChildren();          // stoppt Audio und Video
    release();
    if (before?.isConnected) before.focus?.({ preventScroll: true });
  };

  async function show() {
    const path = list[idx];
    const st = path && vfs.stat(path);
    release();
    if (!st) { close(); return; }
    const kind = st.type === 'dir' ? 'dir' : kindOf(path, st.mime);
    title.textContent = st.name;
    meta.textContent = st.type === 'dir' ? `Ordner · ${vfs.list(path).length} Objekte` : `${kindName(path, st.mime)} · ${formatSize(st.size)} · ${new Date(st.mtime).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    bPrev.hidden = bNext.hidden = list.length < 2;
    bSave.hidden = st.type === 'dir';
    const appId = st.type === 'dir' ? 'files' : sys.defaultApp(st);
    bOpen.hidden = !appId;
    bOpen.textContent = appId ? `Mit ${apps.get(appId)?.name || 'App'} öffnen` : '';
    card.dataset.kind = kind;

    let view;
    const data = st.type === 'file' ? vfs.read(path) : '';
    if (kind === 'image' && data.startsWith('data:image/')) view = h('img.ql-img', { src: data, alt: st.name, draggable: false });
    else if (kind === 'audio' && data.startsWith('data:')) view = h('div.ql-audio', fileIcon(st), h('audio', { src: data, controls: true, autoplay: true }));
    else if (kind === 'video' && data.startsWith('data:')) view = h('video.ql-video', { src: data, controls: true, autoplay: true });
    else if (kind === 'pdf' && data.startsWith('data:')) {
      try { blobUrl = URL.createObjectURL(await fileBlob(path)); view = h('iframe.ql-frame', { src: blobUrl, title: st.name }); } catch { view = null; }
    } else if ((kind === 'text' || kind === 'code') && !data.startsWith('data:')) {
      view = h('pre.ql-text.scroll', { class: kind === 'code' ? 'mono' : '' }, data.length > 200000 ? `${data.slice(0, 200000)}\n\n… (gekürzt)` : data || '(leer)');
    }
    if (list[idx] !== path) return;       // inzwischen weitergeblättert
    body.replaceChildren(view || h('div.ql-none', fileIcon(st), h('b', st.name), h('span', st.type === 'dir' ? `${vfs.list(path).length} Objekte` : 'Für diesen Dateityp gibt es keine Vorschau.')));
  }
  const step = (d) => { if (list.length > 1) { idx = (idx + d + list.length) % list.length; show(); sfx.tick(); } };
  const openIt = () => { const p = list[idx]; close(); if (p) sys.openPath(p); };

  bPrev.addEventListener('click', () => step(-1));
  bNext.addEventListener('click', () => step(1));
  bClose.addEventListener('click', close);
  bOpen.addEventListener('click', openIt);
  bSave.addEventListener('click', () => { if (list[idx]) fsops.download(list[idx]); });
  el.addEventListener('pointerdown', (e) => { if (e.target === el) close(); });
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.code === 'Space' && !e.target.closest('audio, video, button'))) { e.preventDefault(); close(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); openIt(); }
  });

  /** Vorschau für eine Liste von Pfaden öffnen; index wählt die erste gezeigte Datei. */
  sys.quicklook = (paths, index = 0) => {
    list = (paths || []).filter((p) => vfs.exists(p));
    if (!list.length) return;
    idx = Math.min(Math.max(0, index), list.length - 1);
    before = document.activeElement;
    el.hidden = false;
    show();
    card.focus({ preventScroll: true });
    sfx.pop();
  };
  sys.quicklook.close = close;
  sys.quicklook.isOpen = () => !el.hidden;
  void basename;
}
