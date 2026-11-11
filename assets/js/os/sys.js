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
  accent: '#ff6a3d',
  wallpaper: 'aurora',
  animate: true,
  blur: 24,
  opacity: 0.58,
  dockSize: 52,
  dockMag: 1.55,
  sounds: true,
  volume: 0.5,
  dnd: false,
  brightness: 1,
  user: 'Gast',
  firstRun: true,
};
export const settings = { ...DEFAULTS, ...store.get(KEY, {}) };

export const WALLPAPERS = {
  aurora: {
    name: 'Aurora', mode: 0, scale: 0.5,
    dark: ['#04061a', '#1436c4', '#5a22c6', '#e2486a', '#ffb86b'],
    light: ['#eef2ff', '#aecdff', '#d3bcff', '#ffc1b6', '#fff3d6'],
    css: 'radial-gradient(60% 80% at 15% 20%, #1436c4, transparent 65%), radial-gradient(55% 70% at 85% 30%, #5a22c6, transparent 65%), radial-gradient(60% 60% at 60% 105%, #e2486a, transparent 62%), #04061a',
  },
  duenen: {
    name: 'Dünen', mode: 1, scale: 1,
    dark: ['#0b0620', '#241a6b', '#c2476f', '#3b1a6e', '#ffb37a'],
    light: ['#3b2a6b', '#8ec5ff', '#ffb59e', '#7a5cc4', '#fff0c2'],
    css: 'radial-gradient(18% 28% at 68% 42%, #ffe1b0 0 40%, transparent 42%), linear-gradient(#241a6b 0%, #c2476f 52%, #7a2f6f 60%, #3b1a6e 78%, #0b0620 100%)',
  },
  orbits: {
    name: 'Orbits', mode: 2, scale: 1,
    dark: ['#060818', '#2f6bff', '#a04bff', '#ff5d7a', '#ffb65c'],
    light: ['#eef1ff', '#7fb2ff', '#c39bff', '#ff9bb0', '#ffd08a'],
    css: 'radial-gradient(circle at 25% 35%, #2f6bff 0 16%, transparent 17%), radial-gradient(circle at 70% 60%, #a04bff 0 22%, transparent 23%), radial-gradient(circle at 55% 22%, #ff5d7a 0 10%, transparent 11%), radial-gradient(circle at 38% 78%, #ffb65c 0 12%, transparent 13%), #060818',
  },
  linien: {
    name: 'Höhenlinien', mode: 3, scale: 1,
    dark: ['#04061a', '#0d1f5c', '#45c8ff', '#a06bff', '#ffb65c'],
    light: ['#f4f6ff', '#c9d8ff', '#2f6bff', '#8a4dff', '#ff7a3d'],
    css: 'repeating-radial-gradient(ellipse at 30% 110%, transparent 0 13px, #45c8ff 13px 14.5px, transparent 14.500px 27px, #a06bff 27px 28.500px), #060b2a',
  },
};

export const ACCENTS = [
  ['Koralle', '#ff6a3d'], ['Rose', '#ff3d81'], ['Violett', '#8b5cff'], ['Azur', '#2f8cff'],
  ['Türkis', '#14b8c4'], ['Minze', '#22c58b'], ['Bernstein', '#f59f0b'], ['Graphit', '#7d86a3'],
];

export function applySettings() {
  root.dataset.theme = settings.theme;
  root.style.setProperty('--accent', settings.accent);
  root.style.setProperty('--glass-blur', `${settings.blur}px`);
  root.style.setProperty('--win-alpha', settings.opacity);
  root.style.setProperty('--dock-size', `${settings.dockSize}px`);
  root.style.setProperty('--dim', (1 - settings.brightness).toFixed(3));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', settings.theme === 'dark' ? '#05060f' : '#e9edfb');
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
  if (key === 'theme' || key === 'blur') requestAnimationFrame(() => refreshGlass());
}

/** App-Register: id → Definition (siehe apps/*.js) */
export const apps = new Map();

export function appIcon(app, cls = '') {
  const [c1, c2] = app.colors || ['#8e97b5', '#4a516e'];
  return h(`span.app-icon${cls ? `.${cls}` : ''}`, { style: { '--c1': c1, '--c2': c2 }, html: app.glyph || icon(app.icon) });
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
export const isImage = (path, mime = '') => mime.startsWith('image/') || IMAGE_EXT.has(extname(path));

export const sys = {
  version: '5.2',
  settings, set, bus, apps,
  wm: null,          // setzt main.js
  notify: () => {},  // setzt notify.js
  open(id, args) { return sys.wm.open(id, args); },
  /** Datei oder Ordner mit der passenden App öffnen */
  openPath(path) {
    const st = vfs.stat(path);
    if (!st) { sys.notify({ title: 'Nicht gefunden', body: path, icon: 'close' }); return null; }
    if (st.type === 'dir') return sys.open('files', { path });
    if (isImage(path, st.mime)) return sys.open('paint', { path });
    return sys.open('notes', { path });
  },
  uptime: () => Math.round(performance.now() / 1000),
};
