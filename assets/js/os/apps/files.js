// files.js — Dateimanager auf dem virtuellen Dateisystem: Symbol-, Listen- und Spaltenansicht,
// Mehrfachauswahl, Ziehen & Ablegen, Vorschau (Leertaste), Import/Export zum echten Gerät

import { h, coarse, clamp } from '../../core/util.js';
import { icon } from '../../core/icons.js';
import { bus } from '../bus.js';
import { sys, apps, appIcon, kindName } from '../sys.js';
import { registry } from '../registry.js';
import { vfs, HOME, TRASH, basename, dirname, formatSize, pretty } from '../vfs.js';
import { openMenu, fileIcon, fsops, renameInline } from '../ui.js';
import { sheet } from '../kit.js';
import { fileDrag, hostDrop } from '../dnd.js';
import { fileMenu } from '../desktop.js';

const APPS = 'apps:';      // virtueller Ort „Programme“
const PLACES = [
  ['Persönlich', HOME, 'user'],
  ['Schreibtisch', `${HOME}/Schreibtisch`, 'layers'],
  ['Dokumente', `${HOME}/Dokumente`, 'file'],
  ['Downloads', `${HOME}/Downloads`, 'download'],
  ['Bilder', `${HOME}/Bilder`, 'image'],
  ['Musik', `${HOME}/Musik`, 'music'],
  ['Programme', APPS, 'grid'],
  ['Papierkorb', TRASH, 'trash'],
];
const DEVICES = [['fableOS', '/', 'drop'], ['System', '/System', 'gear']];
const VIEWS = [['grid', 'Symbole', 'grid'], ['rows', 'Liste', 'list'], ['cols', 'Spalten', 'sliders']];
const fmtDate = (t) => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });

export default {
  id: 'files', name: 'Dateien', icon: 'folder', colors: ['#62b6ff', '#2a6df4'], keywords: 'finder explorer ordner dokumente',
  width: 820, height: 510, minW: 480, minH: 300,

  mount(win, args) {
    let cwd = args.path === APPS || (args.path && vfs.isDir(args.path)) ? args.path : HOME;
    let back = [];
    let fwd = [];
    let view = 'grid';
    let sel = new Set();
    let anchor = null;
    let query = '';

    const side = h('nav.files-side.scroll');
    const crumbs = h('div.files-crumbs.no-drag');
    const list = h('div.files-list.scroll', { tabIndex: 0 });
    const status = h('div.files-status');
    const search = h('input.kit-field', { type: 'text', placeholder: 'Suchen', spellcheck: false, autocomplete: 'off', 'aria-label': 'In diesem Ordner suchen' });
    const btn = (name, label, fn) => h('button.tool', { type: 'button', 'aria-label': label, title: label, html: icon(name), onclick: fn });
    const bBack = btn('chevronLeft', 'Zurück', () => { if (back.length) { fwd.push(cwd); go(back.pop(), false); } });
    const bFwd = btn('chevronRight', 'Vorwärts', () => { if (fwd.length) { back.push(cwd); go(fwd.pop(), false); } });
    const bView = btn('grid', 'Darstellung', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      openMenu(VIEWS.map(([id, name, ic]) => ({ label: name, icon: ic, checked: view === id, run: () => { view = id; render(); } })), { x: r.left - 120, y: r.bottom + 6 });
    });
    const bNew = btn('plus', 'Neuer Ordner', () => newFolder());
    const bImport = btn('download', 'Vom Gerät importieren', () => sys.importFrom(cwd));
    const bEmpty = h('button.kit-btn.round', { type: 'button', onclick: () => sys.emptyTrash() }, 'Leeren');
    const toolbar = h('div.files-bar', bBack, bFwd, crumbs, bEmpty, h('label.kit-search.files-search.no-drag', { html: icon('search') }, search), bImport, bNew, bView);
    win.body.append(h('div.files', side, h('div.files-main', toolbar, list, status)));

    const real = () => cwd !== APPS;
    const items = () => {
      if (!real()) return [];
      const q = query.trim().toLowerCase();
      if (!q) return vfs.list(cwd);
      return vfs.find(q, cwd).map((p) => vfs.stat(p)).filter(Boolean).slice(0, 200);
    };
    const go = (path, push = true) => {
      if (path !== APPS && !vfs.isDir(path)) return;
      if (push && path !== cwd) { back.push(cwd); fwd = []; }
      cwd = path;
      sel = new Set();
      anchor = null;
      query = '';
      search.value = '';
      render();
      win.wm.saveSession();
    };
    const open = (st) => (st.type === 'dir' ? go(st.path) : sys.openPath(st.path));
    const elFor = (path) => [...list.querySelectorAll('[data-path]')].find((c) => c.dataset.path === path);
    const startRename = (path) => {
      const el = elFor(path);
      if (el) renameInline(el.querySelector('.fitem-name'), (name) => { const p = fsops.rename(path, name); if (p) sel = new Set([p]); });
    };
    const newFolder = () => { if (!real()) return; const p = fsops.newFolder(cwd); if (p) { sel = new Set([p]); render(); startRename(p); } };
    const newFile = () => { if (!real()) return; const p = fsops.newFile(cwd); if (p) { sel = new Set([p]); render(); startRename(p); } };
    const paintSel = () => {
      for (const c of list.querySelectorAll('[data-path]')) c.classList.toggle('is-sel', sel.has(c.dataset.path));
      paintStatus();
    };
    const paintStatus = () => {
      if (!real()) { status.textContent = `${[...apps.values()].filter((a) => !a.hidden).length} Apps`; return; }
      const all = items();
      const bytes = all.reduce((s, i) => s + i.size, 0);
      status.textContent = sel.size
        ? `${sel.size} von ${all.length} ausgewählt`
        : `${all.length} ${all.length === 1 ? 'Objekt' : 'Objekte'} · ${formatSize(bytes)}${query ? ` · Suche in „${basename(cwd) || 'fableOS'}“` : ''}`;
    };
    const info = (st) => {
      const rows = [
        ['Art', st.type === 'dir' ? 'Ordner' : kindName(st.path, st.mime)],
        ['Größe', st.type === 'dir' ? `${formatSize(st.size)} · ${vfs.list(st.path).length} Objekte` : formatSize(st.size)],
        ['Ort', pretty(dirname(st.path))],
        ['Geändert', new Date(st.mtime).toLocaleString('de-DE', { dateStyle: 'long', timeStyle: 'short' })],
      ];
      const app = st.type === 'file' ? sys.defaultApp(st) : null;
      if (app && apps.has(app)) rows.push(['Öffnet mit', apps.get(app).name]);
      sheet(win, {
        title: st.name,
        body: h('div.files-info', fileIcon(st), h('dl', rows.flatMap(([k, v]) => [h('dt', k), h('dd', v)]))),
        buttons: [{ label: 'Fertig', value: true, primary: true }],
      });
    };
    const itemMenu = (st, e) => {
      const inTrash = st.path.startsWith(`${TRASH}/`);
      const many = sel.size > 1;
      const base = fileMenu(st, {
        open: () => open(st), rename: () => startRename(st.path),
        extra: [
          { label: 'Informationen', icon: 'info', run: () => info(st) },
          st.type === 'file' && { label: 'Im Terminal anzeigen', icon: 'terminal', run: () => sys.open('terminal', { path: dirname(st.path), cmd: `cat "${st.name}"` }) },
          inTrash && { label: 'Zurück auf den Schreibtisch', icon: 'undo', run: () => fsops.moveInto([st.path], `${HOME}/Schreibtisch`) },
          '-',
        ].filter(Boolean),
      });
      const last = base[base.length - 1];
      last.label = many ? `${sel.size} Objekte in den Papierkorb` : inTrash ? 'Endgültig löschen' : 'In den Papierkorb';
      last.run = () => { for (const p of many ? [...sel] : [st.path]) fsops.trash(p); };
      const copy = base.find((i) => i.label === 'Kopieren');
      if (copy && many) { copy.label = `${sel.size} Objekte kopieren`; copy.run = () => fsops.copy([...sel]); }
      openMenu(base, { x: e.clientX, y: e.clientY });
    };

    const wire = (el, st, all) => {
      el.addEventListener('click', (e) => {
        if (coarse.matches) { open(st); return; }
        if (e.shiftKey && anchor) {
          const paths = all.map((s) => s.path);
          const a = paths.indexOf(anchor), b = paths.indexOf(st.path);
          if (a >= 0) sel = new Set(paths.slice(Math.min(a, b), Math.max(a, b) + 1));
        } else if (e.metaKey || e.ctrlKey) { if (sel.has(st.path)) sel.delete(st.path); else sel.add(st.path); anchor = st.path; }
        else { sel = new Set([st.path]); anchor = st.path; if (view === 'cols') { render(); return; } }
        paintSel();
      });
      el.addEventListener('dblclick', () => open(st));
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!sel.has(st.path)) { sel = new Set([st.path]); anchor = st.path; paintSel(); }
        itemMenu(st, e);
      });
      if (st.type === 'dir') el.dataset.dropPath = st.path;
      fileDrag(el, () => (sel.has(st.path) ? [...sel] : [st.path]));
    };
    const fitem = (st, all) => {
      const el = h('button.fitem', { type: 'button', dataset: { path: st.path }, class: sel.has(st.path) ? 'is-sel' : '', tabIndex: -1 },
        fileIcon(st), h('span.fitem-name', st.name),
        h('span.fitem-meta', st.type === 'dir' ? 'Ordner' : formatSize(st.size)),
        h('span.fitem-meta', query ? pretty(dirname(st.path)) : fmtDate(st.mtime)));
      wire(el, st, all);
      return el;
    };
    const renderApps = () => {
      list.className = 'files-list scroll is-grid';
      delete list.dataset.dropPath;
      const all = [...apps.values()].filter((a) => !a.hidden).sort((a, b) => a.name.localeCompare(b.name, 'de'));
      list.replaceChildren(...all.map((a) => {
        const el = h('button.fitem.is-app', { type: 'button', tabIndex: -1 }, appIcon(a), h('span.fitem-name', a.name));
        el.addEventListener(coarse.matches ? 'click' : 'dblclick', () => sys.open(a.id));
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const pinned = registry.isPinned(a.id);
          openMenu([
            { label: 'Öffnen', icon: 'arrowUpRight', run: () => sys.open(a.id) },
            { label: pinned ? 'Aus dem Dock entfernen' : 'Im Dock behalten', run: () => (pinned ? registry.unpin(a.id) : registry.pin(a.id)) },
            registry.isInstalled(a.id) && { label: 'Im App Store zeigen', run: () => sys.open('store', { app: a.id }) },
          ].filter(Boolean), { x: e.clientX, y: e.clientY });
        });
        return el;
      }));
    };
    const renderCols = () => {
      const segs = cwd.split('/').filter(Boolean);
      const one = [...sel].length === 1 ? vfs.stat([...sel][0]) : null;
      const chain = ['/', ...segs.map((_, i) => `/${segs.slice(0, i + 1).join('/')}`)].slice(one?.type === 'file' ? -2 : -3);
      const cols = chain.map((dir, ci) => {
        const all = vfs.list(dir);
        const col = h('div.fcol.scroll', { dataset: { dropPath: dir } });
        col.append(...all.map((st) => {
          const on = chain[ci + 1] === st.path || (ci === chain.length - 1 && sel.has(st.path));
          const el = h('button.fcol-item', { type: 'button', dataset: { path: st.path }, class: `${on ? 'is-on' : ''}${ci === chain.length - 1 && sel.has(st.path) ? ' is-sel' : ''}`, tabIndex: -1 },
            fileIcon(st), h('span.fitem-name', st.name), st.type === 'dir' ? h('i', { html: icon('chevronRight') }) : null);
          if (ci === chain.length - 1) wire(el, st, all);
          else {
            el.addEventListener('click', () => (st.type === 'dir' ? go(st.path) : (go(dir), sel = new Set([st.path]), render())));
            if (st.type === 'dir') el.dataset.dropPath = st.path;
          }
          return el;
        }));
        if (!all.length) col.append(h('div.fcol-empty', 'Leer'));
        return col;
      });
      if (one && one.type === 'file') {
        cols.push(h('div.fcol.fcol-prev', fileIcon(one), h('b', one.name), h('span', kindName(one.path, one.mime)), h('span', formatSize(one.size)), h('span', fmtDate(one.mtime)),
          h('button.kit-btn.round', { type: 'button', onclick: () => open(one) }, 'Öffnen')));
      }
      list.className = 'files-list is-cols scroll';
      delete list.dataset.dropPath;
      list.replaceChildren(...cols);
      list.scrollLeft = list.scrollWidth;
    };

    function render() {
      if (real() && !vfs.isDir(cwd)) cwd = HOME;
      win.setTitle(!real() ? 'Programme' : cwd === '/' ? 'fableOS' : basename(cwd));
      bBack.disabled = !back.length;
      bFwd.disabled = !fwd.length;
      bEmpty.hidden = cwd !== TRASH;
      bNew.disabled = bImport.disabled = !real() || cwd.startsWith('/System') || cwd === '/';
      search.parentElement.hidden = !real();

      const place = (title, entries) => [h('div.files-head', title), ...entries.map(([name, path, ic]) => {
        const b = h('button', { type: 'button', class: path === cwd ? 'is-on' : '', html: icon(ic), onclick: () => go(path) }, h('span', name));
        if (path !== APPS && path !== '/' && !path.startsWith('/System')) b.dataset.dropPath = path;
        return b;
      })];
      side.replaceChildren(...place('Favoriten', PLACES), ...place('Orte', DEVICES));

      const segs = real() ? cwd.split('/').filter(Boolean) : [];
      crumbs.replaceChildren(
        h('button', { type: 'button', onclick: () => go('/') }, 'fableOS'),
        ...(real() ? segs.flatMap((s, i) => [h('i', { html: icon('chevronRight') }), h('button', { type: 'button', onclick: () => go(`/${segs.slice(0, i + 1).join('/')}`) }, s)])
          : [h('i', { html: icon('chevronRight') }), h('button', { type: 'button' }, 'Programme')]),
      );
      if (!real()) { renderApps(); paintStatus(); return; }
      sel = new Set([...sel].filter((p) => vfs.exists(p)));
      if (view === 'cols' && !query) { renderCols(); paintStatus(); return; }
      const all = items();
      list.className = `files-list scroll is-${view === 'cols' ? 'rows' : view}`;
      list.dataset.dropPath = cwd;
      list.replaceChildren(...(all.length ? all.map((st) => fitem(st, all))
        : [h('div.files-empty', { html: `${icon(query ? 'search' : cwd === TRASH ? 'trash' : 'folder')}<span>${query ? 'Nichts gefunden' : cwd === TRASH ? 'Der Papierkorb ist leer' : 'Dieser Ordner ist leer'}</span>` })]));
      paintStatus();
    }

    search.addEventListener('input', () => { query = search.value; sel = new Set(); render(); });
    search.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { search.value = ''; query = ''; render(); list.focus(); } });
    list.addEventListener('pointerdown', (e) => { if (e.target === list || e.target.classList.contains('fcol')) { sel = new Set(); paintSel(); if (view === 'cols') render(); } });
    list.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!real()) return;
      openMenu([
        { label: 'Neuer Ordner', icon: 'folder', disabled: bNew.disabled, run: newFolder },
        { label: 'Neue Textdatei', icon: 'file', disabled: bNew.disabled, run: newFile },
        { label: 'Vom Gerät importieren …', icon: 'download', disabled: bNew.disabled, run: () => sys.importFrom(cwd) },
        { label: 'Einsetzen', disabled: !fsops.clip || bNew.disabled, run: () => fsops.paste(cwd) },
        '-',
        { label: 'Darstellung', items: VIEWS.map(([id, name, ic]) => ({ label: name, icon: ic, checked: view === id, run: () => { view = id; render(); } })) },
        { label: 'Terminal hier öffnen', icon: 'terminal', run: () => sys.open('terminal', { path: cwd }) },
        { label: 'Informationen', icon: 'info', run: () => info(vfs.stat(cwd)) },
      ], { x: e.clientX, y: e.clientY });
    });
    hostDrop(list, () => (real() && !bNew.disabled ? cwd : null));

    win.el.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea') || !real()) return;
      const all = items();
      const paths = all.map((s) => s.path);
      const cur = anchor && sel.has(anchor) ? anchor : [...sel][0];
      const st = cur && vfs.stat(cur);
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Enter' && st) open(st);
      else if (e.code === 'Space' && st) { e.preventDefault(); sys.quicklook(paths, paths.indexOf(cur)); }
      else if ((e.key === 'Delete' || (e.key === 'Backspace' && mod)) && sel.size) { for (const p of [...sel]) fsops.trash(p); }
      else if (e.key === 'Backspace' && cwd !== '/') go(dirname(cwd));
      else if (e.key === 'F2' && st) startRename(st.path);
      else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); sel = new Set(paths); paintSel(); }
      else if (mod && e.key.toLowerCase() === 'c' && sel.size) fsops.copy([...sel]);
      else if (mod && e.key.toLowerCase() === 'v' && fsops.clip && !bNew.disabled) fsops.paste(cwd);
      else if (e.key.startsWith('Arrow') && paths.length) {
        e.preventDefault();
        let step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 }[e.key];
        if (view === 'grid' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
          const first = list.querySelector('.fitem');
          step *= Math.max(1, Math.floor(list.clientWidth / (first?.offsetWidth + 6 || 100)));
        }
        const i = clamp((cur ? paths.indexOf(cur) : -1) + step, 0, paths.length - 1);
        sel = new Set([paths[i]]);
        anchor = paths[i];
        if (view === 'cols' && !query) render(); else paintSel();
        elFor(paths[i])?.scrollIntoView({ block: 'nearest' });
      }
    });

    const offFs = bus.on('fs', () => { if (real()) render(); });
    const offApps = bus.on('apps', () => { if (!real()) render(); });
    render();
    return {
      onClose: () => { offFs(); offApps(); },
      onArgs: (a) => { if (a.path) go(a.path); },
      state: () => ({ path: cwd }),
      menus: () => [
        {
          label: 'Darstellung',
          items: VIEWS.map(([id, name, ic]) => ({ label: name, icon: ic, checked: view === id, run: () => { view = id; render(); } })),
        },
        {
          label: 'Gehe zu',
          items: [
            ...PLACES.map(([name, path, ic]) => ({ label: name, icon: ic, run: () => go(path) })),
            '-',
            { label: 'Übergeordneter Ordner', disabled: !real() || cwd === '/', run: () => go(dirname(cwd)) },
          ],
        },
      ],
    };
  },
};
