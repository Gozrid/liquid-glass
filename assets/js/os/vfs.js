// vfs.js — virtuelles Dateisystem. Ein Baum aus Ordnern und Dateien, gespeichert im localStorage.

import { store, debounce } from '../core/util.js';
import { bus } from './bus.js';

const KEY = 'fableos.fs.v1';
export const HOME = '/Benutzer/gast';
export const TRASH = `${HOME}/Papierkorb`;

const D = (c = {}) => ({ t: 'd', c, m: Date.now() });
const F = (d = '', mime = 'text/plain') => ({ t: 'f', d, mime, m: Date.now() });

function seedImage() {
  try {
    const cv = document.createElement('canvas');
    cv.width = 640;
    cv.height = 400;
    const c = cv.getContext('2d');
    c.fillStyle = '#060818';
    c.fillRect(0, 0, 640, 400);
    const orbs = [[140, 120, 220, '#1b3fd6'], [470, 110, 240, '#7b2cf2'], [360, 380, 260, '#ff5a5f'], [250, 250, 120, '#ffc078']];
    c.globalCompositeOperation = 'lighter';
    for (const [x, y, r, col] of orbs) {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, col);
      g.addColorStop(1, 'transparent');
      c.fillStyle = g;
      c.fillRect(0, 0, 640, 400);
    }
    return cv.toDataURL('image/jpeg', 0.82);
  } catch { return ''; }
}

function seed() {
  const img = seedImage();
  return D({
    Benutzer: D({
      gast: D({
        Schreibtisch: D({
          'Willkommen.txt': F(
`Willkommen in fableOS!

Alles hier läuft in deinem Browser-Tab – und bleibt auch dort.
Ein paar Dinge zum Ausprobieren:

  • Fenster an den Bildschirmrand ziehen: sie rasten ein.
  • Doppelklick auf eine Titelleiste: Fenster füllt den Platz.
  • Strg/⌘ + K öffnet die Suche (Apps, Dateien, Rechnungen).
  • Im Terminal: „hilfe“, „neofetch“ oder „matrix“.
  • Rechtsklick auf den Schreibtisch für neue Dateien.

Diese Datei kannst du bearbeiten. Änderungen speichert
fableOS automatisch im lokalen Speicher deines Browsers.
`),
          'Ideen.md': F(
`# Ideen

- **Malen** öffnen und ein Bild in *Bilder* speichern
- Im **Klang**-Studio mit den Tasten A bis K spielen
- Hintergrund in den *Einstellungen* wechseln

> Glas ist eine Flüssigkeit, die vergessen hat zu fließen.
`, 'text/markdown'),
        }),
        Dokumente: D({
          Notizen: D({
            'Einkauf.txt': F('Kaffee\nHaferflocken\nZitronen\nGlasreiniger (viel)\n'),
            'Gedanken.md': F('# Gedanken\n\nEin Betriebssystem ist auch nur eine Website,\ndie sich sehr ernst nimmt.\n', 'text/markdown'),
          }),
          'Gedicht.txt': F(
`Glas

Ich bin, was hinter mir liegt,
nur etwas gebogen.
Das Licht, das mich durchquert,
hat mich nie belogen.
`),
          'geheim.txt': F('Gefunden! Tipp im Terminal einmal:  matrix\n'),
        }),
        Bilder: D(img ? { 'Aurora.jpg': F(img, 'image/jpeg') } : {}),
        Musik: D({ 'LIESMICH.txt': F('Musik entsteht hier live: öffne die App „Klang“.\n') }),
        Papierkorb: D(),
      }),
    }),
    System: D({
      'version.txt': F('fableOS 5.2 „Liquid Glass“\nGebaut von Claude Fable 5.2\n'),
      'kernel.log': F(
`[0.000] fableOS-Kernel startet
[0.012] Ereignisschleife: bereit
[0.031] Glas wird poliert … fertig
[0.048] Dateisystem eingehängt (localStorage)
[0.066] Fenster-Manager: bereit
[0.081] Willkommen.
`),
    }),
  });
}

let tree = store.get(KEY, null);
if (!tree || tree.t !== 'd') tree = seed();

const persist = debounce(() => {
  if (!store.set(KEY, tree)) bus.emit('fs:full');
}, 200);
function changed(path) {
  persist();
  bus.emit('fs', path);
}

const parts = (path) => path.split('/').filter(Boolean);
const BAD = new Set(['__proto__', 'constructor', 'prototype', '.', '..']);
function checkName(name) {
  if (!name || name.includes('/') || BAD.has(name) || name.length > 80) throw new Error(`Ungültiger Name: ${name || '(leer)'}`);
}

export function normalize(path, cwd = HOME) {
  if (!path) return cwd;
  if (path === '~' || path.startsWith('~/')) path = HOME + path.slice(1);
  if (!path.startsWith('/')) path = `${cwd}/${path}`;
  const out = [];
  for (const p of parts(path)) {
    if (p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return `/${out.join('/')}`;
}
export const dirname = (path) => `/${parts(path).slice(0, -1).join('/')}`;
export const basename = (path) => parts(path).pop() || '';
export const extname = (path) => { const b = basename(path); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
export const pretty = (path) => (path === HOME ? '~' : path.startsWith(`${HOME}/`) ? `~${path.slice(HOME.length)}` : path);

function node(path) {
  let n = tree;
  for (const p of parts(path)) {
    if (n.t !== 'd' || !Object.hasOwn(n.c, p)) return null;
    n = n.c[p];
  }
  return n;
}
function guard(path) {
  if (path === '/' || path === '/System' || path.startsWith('/System/')) throw new Error(`Schreibgeschützt: ${path}`);
}
function dirOf(path) {
  const d = node(dirname(path));
  if (!d || d.t !== 'd') throw new Error(`Kein solcher Ordner: ${dirname(path)}`);
  return d;
}
const sizeOf = (n) => (n.t === 'f' ? n.d.length : Object.values(n.c).reduce((s, c) => s + sizeOf(c), 0));

export const vfs = {
  stat(path) {
    const n = node(path);
    return n ? { type: n.t === 'd' ? 'dir' : 'file', mime: n.mime || '', mtime: n.m, size: sizeOf(n), path, name: basename(path) } : null;
  },
  exists: (path) => !!node(path),
  isDir: (path) => node(path)?.t === 'd',
  list(path) {
    const n = node(path);
    if (!n) throw new Error(`Nicht gefunden: ${path}`);
    if (n.t !== 'd') throw new Error(`Kein Ordner: ${path}`);
    return Object.keys(n.c)
      .map((name) => vfs.stat(`${path === '/' ? '' : path}/${name}`))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'de') : a.type === 'dir' ? -1 : 1));
  },
  read(path) {
    const n = node(path);
    if (!n) throw new Error(`Nicht gefunden: ${path}`);
    if (n.t !== 'f') throw new Error(`Ist ein Ordner: ${path}`);
    return n.d;
  },
  write(path, data, mime) {
    guard(path);
    checkName(basename(path));
    const d = dirOf(path);
    const name = basename(path);
    const old = Object.hasOwn(d.c, name) ? d.c[name] : null;
    if (old && old.t === 'd') throw new Error(`Ist ein Ordner: ${path}`);
    d.c[name] = F(String(data), mime || old?.mime || (/\.md$/i.test(name) ? 'text/markdown' : 'text/plain'));
    changed(path);
  },
  mkdir(path) {
    guard(path);
    checkName(basename(path));
    const d = dirOf(path);
    if (Object.hasOwn(d.c, basename(path))) throw new Error(`Existiert bereits: ${path}`);
    d.c[basename(path)] = D();
    changed(path);
  },
  remove(path) {
    guard(path);
    if (path === HOME || path === TRASH || path === '/Benutzer') throw new Error(`Geschützt: ${path}`);
    const d = dirOf(path);
    if (!Object.hasOwn(d.c, basename(path))) throw new Error(`Nicht gefunden: ${path}`);
    delete d.c[basename(path)];
    changed(path);
  },
  move(from, to) {
    guard(from);
    guard(to);
    const n = node(from);
    if (!n) throw new Error(`Nicht gefunden: ${from}`);
    if (node(to)?.t === 'd') to = `${to}/${basename(from)}`;
    if (to === from) return to;
    if (to.startsWith(`${from}/`)) throw new Error('Ein Ordner kann nicht in sich selbst verschoben werden');
    checkName(basename(to));
    const target = dirOf(to);
    if (Object.hasOwn(target.c, basename(to))) throw new Error(`Existiert bereits: ${to}`);
    if (from === HOME || from === TRASH) throw new Error(`Geschützt: ${from}`);
    delete dirOf(from).c[basename(from)];
    target.c[basename(to)] = n;
    n.m = Date.now();
    changed(to);
    return to;
  },
  copy(from, to) {
    guard(to);
    const n = node(from);
    if (!n) throw new Error(`Nicht gefunden: ${from}`);
    if (node(to)?.t === 'd') to = `${to}/${basename(from)}`;
    checkName(basename(to));
    const target = dirOf(to);
    if (Object.hasOwn(target.c, basename(to))) throw new Error(`Existiert bereits: ${to}`);
    target.c[basename(to)] = JSON.parse(JSON.stringify(n));
    changed(to);
    return to;
  },
  /** Freier Name im Ordner: „Datei.txt“, „Datei 2.txt“, … */
  unique(dir, name) {
    const d = node(dir);
    if (!d || !Object.hasOwn(d.c, name)) return name;
    const i = name.lastIndexOf('.');
    const stem = i > 0 ? name.slice(0, i) : name;
    const ext = i > 0 ? name.slice(i) : '';
    for (let k = 2; ; k++) {
      const cand = `${stem} ${k}${ext}`;
      if (!Object.hasOwn(d.c, cand)) return cand;
    }
  },
  trash(path) {
    if (path.startsWith(`${TRASH}/`)) { vfs.remove(path); return; }
    vfs.move(path, `${TRASH}/${vfs.unique(TRASH, basename(path))}`);
  },
  emptyTrash() {
    node(TRASH).c = {};
    changed(TRASH);
  },
  /** Alle Pfade, deren Name den Suchtext enthält. */
  find(query, start = '/') {
    const q = query.toLowerCase();
    const out = [];
    const walk = (path, n) => {
      for (const [name, child] of Object.entries(n.c)) {
        const p = `${path === '/' ? '' : path}/${name}`;
        if (name.toLowerCase().includes(q)) out.push(p);
        if (child.t === 'd') walk(p, child);
      }
    };
    const s = node(start);
    if (s?.t === 'd') walk(start, s);
    return out;
  },
  usage: () => JSON.stringify(tree).length,
  reset() {
    tree = seed();
    store.set(KEY, tree);
    bus.emit('fs', '/');
  },
};

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
}
