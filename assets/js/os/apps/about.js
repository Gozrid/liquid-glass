// about.js — Willkommen, Über fableOS und Tastenkürzel

import { h } from '../../core/util.js';
import { LOGO } from '../../core/icons.js';
import { initControls } from '../../core/controls.js';
import { sys, apps, appIcon } from '../sys.js';

const KEYS = [
  ['⌘ K  /  Strg K', 'Suche öffnen (Apps, Dateien, Befehle, Rechnen)'],
  ['F3', 'Übersicht aller Fenster'],
  ['⌥ W', 'Fenster schließen'],
  ['⌥ M', 'Fenster minimieren'],
  ['⌥ ↩', 'Fenster zoomen'],
  ['⌥ ←  /  ⌥ →', 'Fenster in die linke oder rechte Hälfte'],
  ['⌥ Tab', 'Zum nächsten Fenster wechseln'],
  ['Esc', 'Menüs, Suche und Übersicht schließen'],
];
const TIPS = [
  ['Einrasten', 'Zieh ein Fenster an den linken, rechten oder oberen Rand – in den Ecken wird es zum Viertel.'],
  ['Alles bleibt', 'Dateien, Notizen, Bilder und Einstellungen liegen im lokalen Speicher deines Browsers.'],
  ['Rechtsklick', 'Auf dem Schreibtisch, auf Dateien und im Dock gibt es Kontextmenüs.'],
];

export default {
  id: 'about', name: 'Über fableOS', icon: 'info', colors: ['#ff8a5c', '#a04bff'], glyph: LOGO, keywords: 'willkommen hilfe info tastenkürzel',
  singleton: true, width: 560, height: 520, minW: 420, minH: 400,

  mount(win, args) {
    const seg = h('div.gseg.no-drag', { 'aria-label': 'Bereich' },
      h('button', { dataset: { value: 'hello' }, 'aria-selected': String(args.tab !== 'keys') }, 'Willkommen'),
      h('button', { dataset: { value: 'keys' }, 'aria-selected': String(args.tab === 'keys') }, 'Tastenkürzel'));
    const body = h('div.about-body.scroll');
    win.body.append(h('div.about', h('div.about-tabs', seg), body));
    initControls(win.body);

    const quick = ['terminal', 'files', 'paint', 'synth', 'game', 'settings'];
    const views = {
      hello: () => [
        h('div.about-hero', h('span.about-logo', { html: LOGO }), h('h1', 'fableOS'), h('p.about-ver', `Version ${sys.version} „Liquid Glass“`)),
        h('p.about-lede', 'Ein kleines Betriebssystem, das komplett in diesem Browser-Tab läuft – entworfen und programmiert von Claude Fable 5.2. Kein Framework, keine Bilddateien, kein Server.'),
        h('div.about-apps', ...quick.filter((id) => apps.has(id)).map((id) => {
          const a = apps.get(id);
          return h('button', { type: 'button', onclick: () => sys.open(id) }, appIcon(a), h('span', a.name));
        })),
        h('ul.about-tips', ...TIPS.map(([t, d]) => h('li', h('b', t), h('span', d)))),
      ],
      keys: () => [
        h('h2', 'Tastenkürzel'),
        h('dl.about-keys', ...KEYS.flatMap(([k, d]) => [h('dt', ...k.split('  /  ').flatMap((part, i) => [i ? h('i', 'oder') : null, ...part.split(' ').map((p) => h('kbd', p))])), h('dd', d)])),
        h('p.about-note', 'Auf Windows und Linux ist ⌥ die Alt-Taste. Browser reservieren viele ⌘-/Strg-Kürzel für sich – deshalb nutzt fableOS vor allem ⌥.'),
      ],
    };
    const show = (tab) => body.replaceChildren(...views[tab]().filter(Boolean));
    seg.addEventListener('change', (e) => show(e.detail.value));
    show(args.tab === 'keys' ? 'keys' : 'hello');
    return { onArgs: (a) => { if (a.tab) { seg.select(a.tab === 'keys' ? 1 : 0, false); show(a.tab === 'keys' ? 'keys' : 'hello'); } } };
  },
};
