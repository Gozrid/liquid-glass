// files.js — Dateimanager auf dem virtuellen Dateisystem

import { h, coarse } from '../../core/util.js';
import { icon } from '../../core/icons.js';
import { bus } from '../bus.js';
import { sys } from '../sys.js';
import { vfs, HOME, TRASH, basename, dirname, formatSize } from '../vfs.js';
import { openMenu, fileIcon, fsops, renameInline } from '../ui.js';

const PLACES = [
  ['Persönlich', HOME, 'user'],
  ['Schreibtisch', `${HOME}/Schreibtisch`, 'layers'],
  ['Dokumente', `${HOME}/Dokumente`, 'file'],
  ['Bilder', `${HOME}/Bilder`, 'image'],
  ['Musik', `${HOME}/Musik`, 'music'],
  ['Papierkorb', TRASH, 'trash'],
];
const DEVICES = [['fableOS', '/', 'drop'], ['System', '/System', 'gear']];

export default {
  id: 'files', name: 'Dateien', icon: 'folder', colors: ['#62b6ff', '#2a6df4'], keywords: 'finder explorer ordner',
  width: 780, height: 490, minW: 480, minH: 300,

  mount(win, args) {
    let cwd = args.path && vfs.isDir(args.path) ? args.path : HOME;
    let back = [];
    let fwd = [];
    let view = 'grid';
    let sel = null;

    const side = h('nav.files-side.scroll');
    const crumbs = h('div.files-crumbs.no-drag');
    const list = h('div.files-list.scroll', { tabIndex: 0 });
    const status = h('div.files-status');
    const btn = (name, label, fn) => h('button.tool', { type: 'button', 'aria-label': label, title: label, html: icon(name), onclick: fn });
    const bBack = btn('chevronLeft', 'Zurück', () => { if (back.length) { fwd.push(cwd); go(back.pop(), false); } });
    const bFwd = btn('chevronRight', 'Vorwärts', () => { if (fwd.length) { back.push(cwd); go(fwd.pop(), false); } });
    const bView = btn('list', 'Ansicht wechseln', () => { view = view === 'grid' ? 'rows' : 'grid'; render(); });
    const bNew = btn('plus', 'Neuer Ordner', () => { const p = fsops.newFolder(cwd); if (p) { sel = p; render(); startRename(p); } });
    const bEmpty = h('button.btn.small.glass.flat', { type: 'button', onclick: () => vfs.emptyTrash() }, 'Papierkorb leeren');
    const toolbar = h('div.files-bar', bBack, bFwd, crumbs, bEmpty, bNew, bView);
    win.body.append(h('div.files', side, h('div.files-main', toolbar, list, status)));

    const go = (path, push = true) => {
      if (!vfs.isDir(path)) return;
      if (push && path !== cwd) { back.push(cwd); fwd = []; }
      cwd = path;
      sel = null;
      render();
    };
    const open = (st) => (st.type === 'dir' ? go(st.path) : sys.openPath(st.path));
    const startRename = (path) => {
      const el = [...list.children].find((c) => c.dataset.path === path);
      if (el) renameInline(el.querySelector('.fitem-name'), (name) => { const p = fsops.rename(path, name); if (p) sel = p; });
    };
    const itemMenu = (st, e) => {
      const inTrash = st.path.startsWith(`${TRASH}/`);
      openMenu([
        { label: 'Öffnen', icon: 'arrowUpRight', run: () => open(st) },
        st.type === 'file' && { label: 'Im Terminal anzeigen', icon: 'terminal', run: () => sys.open('terminal', { path: dirname(st.path), cmd: `cat "${st.name}"` }) },
        '-',
        { label: 'Umbenennen', icon: 'note', run: () => startRename(st.path) },
        { label: 'Duplizieren', icon: 'copy', run: () => { try { vfs.copy(st.path, `${cwd}/${vfs.unique(cwd, st.name)}`); } catch (err) { fsops.fail(err); } } },
        inTrash && { label: 'Zurück auf den Schreibtisch', icon: 'undo', run: () => { try { vfs.move(st.path, `${HOME}/Schreibtisch/${vfs.unique(`${HOME}/Schreibtisch`, st.name)}`); } catch (err) { fsops.fail(err); } } },
        '-',
        { label: inTrash ? 'Endgültig löschen' : 'In den Papierkorb', icon: 'trash', run: () => fsops.trash(st.path) },
      ], { x: e.clientX, y: e.clientY });
    };

    function render() {
      if (!vfs.isDir(cwd)) cwd = HOME;
      win.setTitle(cwd === '/' ? 'fableOS' : basename(cwd));
      bBack.disabled = !back.length;
      bFwd.disabled = !fwd.length;
      bEmpty.hidden = cwd !== TRASH;
      bView.innerHTML = icon(view === 'grid' ? 'list' : 'grid');

      const place = (title, entries) => [h('div.files-head', title), ...entries.map(([name, path, ic]) =>
        h('button', { type: 'button', class: path === cwd ? 'is-on' : '', html: icon(ic), onclick: () => go(path) }, h('span', name)))];
      side.replaceChildren(...place('Favoriten', PLACES), ...place('Orte', DEVICES));

      const segs = cwd.split('/').filter(Boolean);
      crumbs.replaceChildren(
        h('button', { type: 'button', onclick: () => go('/') }, 'fableOS'),
        ...segs.flatMap((s, i) => [h('i', { html: icon('chevronRight') }), h('button', { type: 'button', onclick: () => go(`/${segs.slice(0, i + 1).join('/')}`) }, s)]),
      );

      const items = vfs.list(cwd);
      list.className = `files-list scroll is-${view}`;
      list.replaceChildren(...(items.length ? items.map((st) => {
        const el = h('button.fitem', { type: 'button', dataset: { path: st.path }, class: st.path === sel ? 'is-sel' : '' },
          fileIcon(st), h('span.fitem-name', st.name),
          h('span.fitem-meta', st.type === 'dir' ? 'Ordner' : formatSize(st.size)),
          h('span.fitem-meta', new Date(st.mtime).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })));
        el.addEventListener('click', () => {
          if (coarse.matches) { open(st); return; }
          sel = st.path;
          for (const c of list.children) c.classList.toggle('is-sel', c === el);
        });
        el.addEventListener('dblclick', () => open(st));
        el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); sel = st.path; for (const c of list.children) c.classList.toggle('is-sel', c === el); itemMenu(st, e); });
        return el;
      }) : [h('div.files-empty', { html: `${icon(cwd === TRASH ? 'trash' : 'folder')}<span>${cwd === TRASH ? 'Der Papierkorb ist leer' : 'Dieser Ordner ist leer'}</span>` })]));
      const bytes = items.reduce((s, i) => s + i.size, 0);
      status.textContent = `${items.length} ${items.length === 1 ? 'Objekt' : 'Objekte'} · ${formatSize(bytes)}`;
    }

    list.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openMenu([
        { label: 'Neuer Ordner', icon: 'folder', run: () => bNew.click() },
        { label: 'Neue Textdatei', icon: 'file', run: () => { const p = fsops.newFile(cwd); if (p) { sel = p; render(); startRename(p); } } },
        '-',
        { label: 'Terminal hier öffnen', icon: 'terminal', run: () => sys.open('terminal', { path: cwd }) },
      ], { x: e.clientX, y: e.clientY });
    });
    win.el.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea')) return;
      const st = sel && vfs.stat(sel);
      if (e.key === 'Enter' && st) open(st);
      else if ((e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) && st) fsops.trash(st.path);
      else if (e.key === 'Backspace' && cwd !== '/') go(dirname(cwd));
      else if (e.key === 'F2' && st) startRename(st.path);
    });

    const off = bus.on('fs', () => render());
    render();
    return {
      onClose: off,
      onArgs: (a) => { if (a.path) go(a.path); },
      menus: () => [{
        label: 'Gehe zu',
        items: [
          ...PLACES.map(([name, path, ic]) => ({ label: name, icon: ic, run: () => go(path) })),
          '-',
          { label: 'Übergeordneter Ordner', disabled: cwd === '/', run: () => go(dirname(cwd)) },
        ],
      }],
    };
  },
};
