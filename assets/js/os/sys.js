// sys.js — gemeinsamer Systemzustand: Einstellungen, App-Register, Dienste

import { store, h } from '../core/util.js';
import { sfx, setVolume } from '../core/audio.js';
import { refreshGlass } from '../core/glassfx.js';
import { icon } from '../core/icons.js';
import { bus } from './bus.js';
import { vfs, extname } from './vfs.js';

const root = document.documentElement;
const KEY = 'fableos.settings';

export const DEFAULTS = {
  theme: 'dark',
  autoTheme: false,         // folgt dem Gerät (hell am Tag, dunkel in der Nacht)
  accent: '#ff6a3d',
  wallpaper: 'aurora',
  wallImage: '',            // VFS-Pfad eines eigenen Hintergrundbilds
  animate: true,
  blur: 24,
  opacity: 0.58,
  dockSize: 52,
  dockMag: 1.55,
  sounds: true,
  startSound: true,
  volume: 0.5,
  dnd: false,
  sysNotes: false,          // Mitteilungen zusätzlich ans echte System geben, wenn fableOS im Hintergrund ist
  brightness: 1,
  nightShift: false,
  user: 'Gast',
  pass: '',                 // Hash des Anmeldepassworts ('' = keins)
  lockNote: '',
  firstRun: true,
  widgets: ['system:clock', 'system:calendar'],
  corners: { tl: 'none', tr: 'none', bl: 'none', br: 'none' },
  saverAfter: 5,            // Minuten bis zum Bildschirmschoner (0 = nie)
  saverLock: false,
  restore: true,            // Fenster nach dem Neustart wieder öffnen
  voice: false,             // Fable antwortet auch gesprochen
  openWith: {},             // Dateiendung → App
};
export const settings = { ...DEFAULTS, ...store.get(KEY, {}) };
settings.corners = { ...DEFAULTS.corners, ...settings.corners };

export const WALLPAPERS = {
  aurora: {
    name: 'Aurora', mode: 0, scale: 0.5,
    dark: ['#04061a', '#1436c4', '#5a22c6', '#e2486a', '#ffb86b'],
    light: ['#eef2ff', '#aecdff', '#d3bcff', '#ffc1b6', '#fff3d6'],
    css: 'radial-gradient(60% 80% at 15% 20%, #1436c4, transparent 65%), radial-gradient(55% 70% at 85% 30%, #5a22c6, transparent 65%), radial-gradient(60% 60% at 60% 105%, #e2486a, transparent 62%), #04061a',
  },
  polar: {
    name: 'Polarlicht', mode: 0, scale: 0.5,
    dark: ['#02101a', '#0b6b6f', '#16a37a', '#3a56d8', '#b8ffd9'],
    light: ['#ecfbf6', '#a8ecd9', '#b5d9ff', '#c9c4ff', '#f4ffd9'],
    css: 'radial-gradient(60% 80% at 20% 15%, #0b6b6f, transparent 65%), radial-gradient(55% 70% at 80% 35%, #3a56d8, transparent 65%), radial-gradient(60% 60% at 55% 105%, #16a37a, transparent 62%), #02101a',
  },
  duenen: {
    name: 'Dünen', mode: 1, scale: 1,
    dark: ['#0b0620', '#241a6b', '#c2476f', '#3b1a6e', '#ffb37a'],
    light: ['#3b2a6b', '#8ec5ff', '#ffb59e', '#7a5cc4', '#fff0c2'],
    css: 'radial-gradient(18% 28% at 68% 42%, #ffe1b0 0 40%, transparent 42%), linear-gradient(#241a6b 0%, #c2476f 52%, #7a2f6f 60%, #3b1a6e 78%, #0b0620 100%)',
  },
  lagune: {
    name: 'Lagune', mode: 1, scale: 1,
    dark: ['#03121c', '#0d4a66', '#2bb3a3', '#0b3550', '#d6fff0'],
    light: ['#0f4c68', '#9fe6ff', '#b9f5dc', '#3d9fbf', '#fffbe0'],
    css: 'radial-gradient(18% 28% at 30% 38%, #d6fff0 0 40%, transparent 42%), linear-gradient(#0d4a66 0%, #2bb3a3 52%, #14707c 60%, #0b3550 78%, #03121c 100%)',
  },
  orbits: {
    name: 'Orbits', mode: 2, scale: 1,
    dark: ['#060818', '#2f6bff', '#a04bff', '#ff5d7a', '#ffb65c'],
    light: ['#eef1ff', '#7fb2ff', '#c39bff', '#ff9bb0', '#ffd08a'],
    css: 'radial-gradient(circle at 25% 35%, #2f6bff 0 16%, transparent 17%), radial-gradient(circle at 70% 60%, #a04bff 0 22%, transparent 23%), radial-gradient(circle at 55% 22%, #ff5d7a 0 10%, transparent 11%), radial-gradient(circle at 38% 78%, #ffb65c 0 12%, transparent 13%), #060818',
  },
  glut: {
    name: 'Glut', mode: 2, scale: 1,
    dark: ['#140606', '#ff5a36', '#ffb03a', '#c2255c', '#ffe9a8'],
    light: ['#fff4ea', '#ffb199', '#ffd58a', '#ff9bbd', '#fff3c4'],
    css: 'radial-gradient(circle at 28% 40%, #ff5a36 0 18%, transparent 19%), radial-gradient(circle at 72% 58%, #c2255c 0 22%, transparent 23%), radial-gradient(circle at 56% 20%, #ffb03a 0 10%, transparent 11%), #140606',
  },
  linien: {
    name: 'Höhenlinien', mode: 3, scale: 1,
    dark: ['#04061a', '#0d1f5c', '#45c8ff', '#a06bff', '#ffb65c'],
    light: ['#f4f6ff', '#c9d8ff', '#2f6bff', '#8a4dff', '#ff7a3d'],
    css: 'repeating-radial-gradient(ellipse at 30% 110%, transparent 0 13px, #45c8ff 13px 14.5px, transparent 14.5px 27px, #a06bff 27px 28.5px), #060b2a',
  },
  moos: {
    name: 'Moos', mode: 3, scale: 1,
    dark: ['#04120c', '#0c3b2a', '#5fe3a1', '#c6f26b', '#ffd166'],
    light: ['#f3fbf4', '#cdeed8', '#12a36b', '#5b9c1a', '#e08a00'],
    css: 'repeating-radial-gradient(ellipse at 70% 110%, transparent 0 13px, #5fe3a1 13px 14.5px, transparent 14.5px 27px, #c6f26b 27px 28.5px), #04120c',
  },
};

export const ACCENTS = [
  ['Koralle', '#ff6a3d'], ['Rose', '#ff3d81'], ['Violett', '#8b5cff'], ['Azur', '#2f8cff'],
  ['Türkis', '#14b8c4'], ['Minze', '#22c58b'], ['Bernstein', '#f59f0b'], ['Graphit', '#7d86a3'],
];

const deviceDark = matchMedia('(prefers-color-scheme: dark)');
/** Das tatsächlich angezeigte Design (bei „Automatisch“ entscheidet das Gerät). */
export const activeTheme = () => (settings.autoTheme ? (deviceDark.matches ? 'dark' : 'light') : settings.theme);

export function applySettings() {
  const theme = activeTheme();
  root.dataset.theme = theme;
  root.style.setProperty('--accent', settings.accent);
  root.style.setProperty('--glass-blur', `${settings.blur}px`);
  root.style.setProperty('--win-alpha', settings.opacity);
  root.style.setProperty('--dock-size', `${settings.dockSize}px`);
  root.style.setProperty('--dim', (1 - settings.brightness).toFixed(3));
  root.classList.toggle('night-shift', !!settings.nightShift);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#05060f' : '#e9edfb');
  sfx.enabled = settings.sounds;
  setVolume(settings.volume);
}

export function set(key, value) {
  if (settings[key] === value) return;
  settings[key] = value;
  store.set(KEY, settings);
  applySettings();
  bus.emit('setting', key);
  bus.emit(`setting:${key}`, value);
  if (key === 'autoTheme') bus.emit('setting:theme', activeTheme());
  if (key === 'theme' || key === 'autoTheme' || key === 'blur') requestAnimationFrame(() => refreshGlass());
}
deviceDark.addEventListener('change', () => {
  if (!settings.autoTheme) return;
  applySettings();
  bus.emit('setting', 'theme');
  bus.emit('setting:theme', activeTheme());
  requestAnimationFrame(() => refreshGlass());
});

/** App-Register: id → Definition (siehe apps/*.js und registry.js) */
export const apps = new Map();

/**
 * Widget-Register: Schlüssel „app:widget“ → {key, app, id, name, size, mount(el) → aufräumen}.
 * Größe 's' = 170 × 170 px, 'm' = 354 × 170 px. Der Schreibtisch zeigt, was in settings.widgets steht.
 */
export const widgets = {
  defs: new Map(),
  register(app, id, def) {
    const key = `${app}:${id}`;
    widgets.defs.set(key, { size: 's', ...def, key, app, id });
    bus.emit('widgets', key);
  },
  unregister(app) {
    for (const [key, def] of widgets.defs) if (def.app === app) widgets.defs.delete(key);
    bus.emit('widgets', app);
  },
};

export function appIcon(app, cls = '') {
  const [c1, c2] = app.colors || ['#8e97b5', '#4a516e'];
  return h(`span.app-icon${cls ? `.${cls}` : ''}`, { style: { '--c1': c1, '--c2': c2 }, html: app.glyph || icon(app.icon) });
}

// ---------- Dateiarten ----------
const KINDS = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'],
  audio: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'weba', 'opus'],
  video: ['mp4', 'mov', 'm4v', 'webm', 'ogv'],
  code: ['js', 'mjs', 'json', 'html', 'htm', 'css', 'svg', 'xml', 'sh', 'py', 'ts', 'yml', 'yaml'],
  text: ['txt', 'md', 'log', 'csv', 'rtf', 'ini'],
  pdf: ['pdf'],
};
const KIND_NAMES = { image: 'Bild', audio: 'Audio', video: 'Video', code: 'Quelltext', text: 'Textdokument', pdf: 'PDF-Dokument', other: 'Dokument' };

/** 'image' | 'audio' | 'video' | 'code' | 'text' | 'pdf' | 'other' */
export function kindOf(path, mime = '') {
  const ext = extname(path);
  // „Aufnahme.webm“ kann Audio oder Video sein – der gespeicherte Typ entscheidet zuerst
  for (const k of ['image', 'audio', 'video']) if (mime.startsWith(`${k}/`)) return k;
  for (const [k, list] of Object.entries(KINDS)) if (list.includes(ext)) return k;
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('text/') || !ext) return 'text';
  return 'other';
}
export const kindName = (path, mime = '') => KIND_NAMES[kindOf(path, mime)];
export const isImage = (path, mime = '') => kindOf(path, mime) === 'image';

const badges = new Map();

export const sys = {
  version: '5.2',
  build: '26.11',
  settings, set, bus, apps, widgets,
  wm: null,          // setzt main.js
  notify: () => {},  // setzt ui.js
  dialog: null,      // setzt ui.js: systemweiter Dialog
  quicklook: null,   // setzt quicklook.js
  search: () => {},  // setzt shell/spotlight.js
  pwa: null,         // setzt pwa.js
  open(id, args, opts) { return sys.wm.open(id, args, opts); },

  /** Welche App öffnet diese Datei standardmäßig? null = nur Vorschau. */
  defaultApp(st) {
    const ext = extname(st.path);
    const name = st.path.toLowerCase();
    // zusammengesetzte Endungen wie „.pixel.json“ gehören eindeutig zu einer App
    const special = [...apps.values()].find((a) => a.accepts?.some((x) => x.includes('.') && name.endsWith(`.${x}`)));
    if (special) return special.id;
    const chosen = settings.openWith?.[ext];
    if (chosen && apps.has(chosen)) return chosen;
    const kind = kindOf(st.path, st.mime);
    if (kind === 'image') return apps.has('photos') ? 'photos' : 'paint';
    if (kind === 'code') return apps.has('code') ? 'code' : 'notes';
    if (kind === 'text') return 'notes';
    return [...apps.values()].find((a) => a.accepts?.includes(ext))?.id || null;
  },
  /** Alle Apps, die diese Datei öffnen können (für „Öffnen mit“). */
  handlers(st) {
    const ext = extname(st.path);
    const name = st.path.toLowerCase();
    const kind = kindOf(st.path, st.mime);
    return [...apps.values()].filter((a) => a.accepts?.some((x) => (x.includes('.') ? name.endsWith(`.${x}`) : x === ext))
      || (a.id === 'notes' && (kind === 'text' || kind === 'code'))
      || (a.id === 'paint' && kind === 'image'));
  },
  /** Datei oder Ordner mit der passenden App öffnen */
  openPath(path, appId = null) {
    const st = vfs.stat(path);
    if (!st) { sys.notify({ title: 'Nicht gefunden', body: path, icon: 'close' }); return null; }
    if (st.type === 'dir') return sys.open('files', { path });
    const id = appId && apps.has(appId) ? appId : sys.defaultApp(st);
    if (!id) { sys.quicklook?.([path]); return null; }
    return sys.open(id, { path });
  },

  /**
   * „Läuft gerade“: Apps melden ihre Wiedergabe an, das System zeigt sie im Kontrollzentrum.
   * info = {app, title, artist?, playing, toggle(), next?(), prev?()} oder null zum Abmelden.
   */
  nowPlaying: null,
  media(info) {
    sys.nowPlaying = info || null;
    bus.emit('media', sys.nowPlaying);
  },
  /** Bild aus dem Dateisystem als Hintergrund setzen ('' = zurück zum gewählten Live-Hintergrund). */
  setWallpaperImage(path) {
    set('wallImage', path || '');
  },
  /** Zahl am Dock-Symbol einer App (0 entfernt sie). */
  badge(appId, n = 0) {
    if (n) badges.set(appId, n); else badges.delete(appId);
    bus.emit('badge', appId);
  },
  badgeOf: (appId) => badges.get(appId) || 0,
  uptime: () => Math.round(performance.now() / 1000),
};
