// registry.js — welche Apps installiert sind: Katalog, Laden bei Bedarf, Installieren, Entfernen, Dock-Plätze, Web-Apps

import { h, store, escapeHtml } from '../core/util.js';
import { icon } from '../core/icons.js';
import { bus } from './bus.js';
import { apps, widgets, sys, settings, set } from './sys.js';
import { appStore } from './kit.js';
import { CATALOG, entry } from './store/catalog.js';

const KEY = 'fableos.apps';
const APP_CACHE = 'fableos-apps';
const PREINSTALLED = ['calendar', 'photos', 'music', 'weather', 'clock'];
const DEFAULT_PINS = ['launchpad', 'files', 'web', 'notes', 'calendar', 'photos', 'music', 'terminal', 'store', 'settings'];

const state = { installed: {}, pins: [...DEFAULT_PINS], web: [], seeded: [], ...store.get(KEY, {}) };
const save = () => store.set(KEY, state);

const loaded = new Set();
const loading = new Map();
const stops = new Map();      // Aufräum-Funktionen der Hintergrunddienste
const systemIds = new Set();  // fest eingebaute Apps (setzt main.js über markSystem)

const moduleUrl = (id) => new URL(`./store/apps/${id}.js`, import.meta.url).href;
const stub = (e) => ({ ...e, widgetList: e.widgets || [], widgets: null, lazy: true, store: true });

// ---------- Web-Apps: beliebige Adressen als eigene App im Fenster ----------
function mountWeb(win) {
  const app = win.app;
  const frame = h('iframe.web-frame', { title: app.name, referrerPolicy: 'no-referrer', allow: 'fullscreen; clipboard-write' });
  if (/^https?:/i.test(app.web)) frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-same-origin allow-downloads');
  frame.src = app.web;
  const tool = (name, label, fn) => h('button.tool', { type: 'button', 'aria-label': label, title: label, html: icon(name), onclick: fn });
  win.tools.append(
    tool('reload', 'Neu laden', () => { frame.src = app.web; }),
    tool('external', 'Im Browser öffnen', () => window.open(app.web, '_blank', 'noopener')));
  win.body.append(h('div.web', frame));
  return {
    menus: [{ label: 'Seite', items: [
      { label: 'Neu laden', icon: 'reload', run: () => { frame.src = app.web; } },
      { label: 'Im Browser öffnen', icon: 'external', run: () => window.open(app.web, '_blank', 'noopener') },
    ] }],
  };
}
const webDef = (w) => ({
  id: w.id, name: w.name, colors: w.colors, web: w.url, webApp: true,
  glyph: `<span class="app-letter">${escapeHtml((w.name.trim()[0] || '?').toUpperCase())}</span>`,
  keywords: 'web app seite', tagline: w.url.replace(/^https?:\/\//, ''),
  width: 980, height: 660, minW: 420, minH: 320, mount: mountWeb,
});

function activate(id, def) {
  apps.set(id, def);
  for (const w of def.widgetList || []) {
    if (typeof def.widgets?.[w.id] === 'function') widgets.register(id, w.id, { name: w.name, size: w.size, mount: def.widgets[w.id] });
  }
  if (typeof def.background === 'function' && !stops.has(id)) {
    try { stops.set(id, def.background() || null); } catch (err) { console.error(`[${id}] Hintergrunddienst`, err); }
  }
}

async function cacheModule(id, body = null) {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open(APP_CACHE);
    const url = moduleUrl(id);
    if (body) await cache.put(url, new Response(body, { headers: { 'content-type': 'text/javascript; charset=utf-8' } }));
    else if (!(await cache.match(url))) await cache.add(url);
  } catch { /* ohne Cache läuft die App nur online */ }
}

export const registry = {
  catalog: CATALOG,
  entry,
  state,
  markSystem(ids) { for (const id of ids) systemIds.add(id); },
  isSystem: (id) => systemIds.has(id),
  isInstalled: (id) => Object.hasOwn(state.installed, id),
  isLoaded: (id) => loaded.has(id),
  isRemovable: (id) => Object.hasOwn(state.installed, id) || state.web.some((w) => w.id === id),
  info: (id) => state.installed[id] || null,

  /** Beim Start: Vorinstalliertes eintragen, Platzhalter für alle installierten Apps anmelden. */
  init() {
    for (const id of PREINSTALLED) {
      if (state.seeded.includes(id) || !entry(id)) continue;
      state.seeded.push(id);
      if (!state.installed[id]) state.installed[id] = { v: entry(id).version, at: Date.now(), pre: true };
    }
    for (const id of Object.keys(state.installed)) {
      const e = entry(id);
      if (e) apps.set(id, stub(e));      // fehlt der Eintrag (Katalog gerade nicht ladbar), bleibt die App vorgemerkt
    }
    for (const w of state.web) apps.set(w.id, webDef(w));
    save();
    bus.emit('apps');
  },

  /** Nach dem Start: Apps mit Hintergrunddienst oder platziertem Widget laden, Module offline verfügbar machen. */
  async warm() {
    const need = Object.keys(state.installed).filter((id) => {
      const e = entry(id);
      return e && (e.background || (e.widgets || []).some((w) => settings.widgets.includes(`${id}:${w.id}`)));
    });
    await Promise.all(need.map((id) => registry.load(id, true)));
    for (const id of Object.keys(state.installed)) cacheModule(id);
  },

  /** Lädt das Modul einer installierten App (einmal). Liefert true, wenn sie danach startklar ist. */
  load(id, quiet = false) {
    if (loaded.has(id)) return Promise.resolve(true);
    if (loading.has(id)) return loading.get(id);
    const e = entry(id);
    if (!e || !registry.isInstalled(id)) return Promise.resolve(false);
    const job = import(moduleUrl(id)).then((mod) => {
      if (!registry.isInstalled(id)) return false;                       // währenddessen entfernt
      loaded.add(id);
      activate(id, { ...stub(e), ...mod.default, id, lazy: false, widgetList: e.widgets || [] });
      bus.emit('apps');
      return true;
    }).catch((err) => {
      console.error(`[${id}]`, err);
      if (!quiet) {
        sys.notify({
          title: `„${e.name}“ lässt sich nicht öffnen`, icon: 'close', force: true,
          body: navigator.onLine ? 'Das App-Modul konnte nicht geladen werden.' : 'Die App ist noch nicht offline verfügbar – bitte einmal mit Netz öffnen.',
        });
      }
      return false;
    }).finally(() => loading.delete(id));
    loading.set(id, job);
    return job;
  },

  /** Lädt eine App aus dem Store: echter Download mit Fortschritt (0…1), danach sofort startklar. */
  async install(id, onProgress = () => {}) {
    const e = entry(id);
    if (!e) throw new Error('Diese App gibt es im Store nicht.');
    let res;
    try { res = await fetch(moduleUrl(id), { cache: 'reload' }); } catch { throw new Error('Keine Verbindung zum Store.'); }
    if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status}).`);
    const total = Number(res.headers.get('content-length')) || 0;
    const chunks = [];
    let got = 0;
    if (res.body?.getReader) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        onProgress(total ? Math.min(1, got / total) : 0.5);
      }
    } else {
      const buf = new Uint8Array(await res.arrayBuffer());
      chunks.push(buf);
      got = buf.length;
    }
    onProgress(1);
    await cacheModule(id, new Blob(chunks));
    state.installed[id] = { v: e.version, at: Date.now(), size: got };
    save();
    apps.set(id, stub(e));
    bus.emit('apps');
    await registry.load(id, true);
    return got;
  },

  /** Entfernt eine Store- oder Web-App. purge löscht auch ihre gespeicherten Daten. */
  uninstall(id, { purge = true } = {}) {
    if (!registry.isRemovable(id)) return;
    for (const w of sys.wm?.byApp(id) || []) w.close();
    try { stops.get(id)?.(); } catch (err) { console.error(err); }
    stops.delete(id);
    widgets.unregister(id);
    if (settings.widgets.some((k) => k.startsWith(`${id}:`))) set('widgets', settings.widgets.filter((k) => !k.startsWith(`${id}:`)));
    if (sys.nowPlaying?.app === id) sys.media(null);
    sys.badge(id, 0);
    apps.delete(id);
    loaded.delete(id);
    delete state.installed[id];
    state.web = state.web.filter((w) => w.id !== id);
    state.pins = state.pins.filter((p) => p !== id);
    save();
    if (purge) appStore(id).clear();
    if ('caches' in window) caches.open(APP_CACHE).then((c) => c.delete(moduleUrl(id))).catch(() => {});
    bus.emit('apps');
  },

  // ---------- Updates ----------
  updates: () => Object.keys(state.installed).filter((id) => entry(id) && entry(id).version !== state.installed[id].v),
  async update(id) {
    const e = entry(id);
    if (!e) return;
    const res = await fetch(moduleUrl(id), { cache: 'reload' });
    if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status}).`);
    const blob = await res.blob();
    await cacheModule(id, blob);
    state.installed[id] = { ...state.installed[id], v: e.version, size: blob.size, at: Date.now() };
    save();
    bus.emit('apps');
  },

  // ---------- Web-Apps ----------
  addWeb({ name, url, colors }) {
    const id = `web-${Date.now().toString(36)}`;
    const w = { id, name: name.trim().slice(0, 28) || 'Web-App', url, colors: colors || ['#62e0ff', '#2f7cf6'] };
    state.web.push(w);
    save();
    apps.set(id, webDef(w));
    bus.emit('apps');
    return id;
  },

  // ---------- Dock ----------
  get pins() { return state.pins.filter((id) => apps.has(id)); },
  isPinned: (id) => state.pins.includes(id),
  pin(id, index = state.pins.length) {
    state.pins = state.pins.filter((p) => p !== id);
    state.pins.splice(Math.max(0, Math.min(index, state.pins.length)), 0, id);
    save();
    bus.emit('apps');
  },
  unpin(id) {
    state.pins = state.pins.filter((p) => p !== id);
    save();
    bus.emit('apps');
  },
  setPins(ids) {
    state.pins = [...new Set(ids)];
    save();
    bus.emit('apps');
  },
  resetPins() {
    state.pins = [...DEFAULT_PINS];
    save();
    bus.emit('apps');
  },
};

sys.registry = registry;
