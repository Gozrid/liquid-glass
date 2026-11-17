// about.js — Willkommen, Über fableOS und Tastenkürzel

import { h } from '../../core/util.js';
import { LOGO } from '../../core/icons.js';
import { initControls } from '../../core/controls.js';
import { sys, apps, appIcon } from '../sys.js';

const KEYS = [
  ['⌘ K  /  Strg K', 'Suche: Apps, Dateien, Einstellungen, Rechnen, Umrechnen'],
  ['⌥ Leertaste', 'Fable fragen'],
  ['F3', 'Übersicht: alle Fenster und Schreibtische'],
  ['F4', 'Alle Apps'],
  ['⌥ Tab', 'Zwischen Apps wechseln – ⌥ halten, Q beendet die gewählte App'],
  ['⌃ 1  /  ⌃ 2 …', 'Schreibtisch wechseln'],
  ['⌃ ⌥ ←  /  ⌃ ⌥ →', 'Fenster in die linke oder rechte Hälfte'],
  ['⌃ ⌥ ↑  /  ⌃ ⌥ ↩', 'Fenster füllt den Platz'],
  ['⌃ ⌥ U I J K', 'Fenster in eine der vier Ecken'],
  ['⌥ W  /  ⌥ M', 'Fenster schließen oder minimieren'],
  ['⌥ H  /  ⌥ Q', 'App ausblenden oder beenden'],
  ['Leertaste', 'Vorschau der ausgewählten Datei'],
  ['⌘ ,', 'Systemeinstellungen'],
  ['⌃ ⌥ L', 'Bildschirm sperren'],
  ['⌥ Esc', 'Apps sofort beenden'],
];
const TIPS = [
  ['App Store', 'Über 20 Apps zum Laden – Kalender, Fotos, Musik, Schach, Code-Editor … Jede wird wirklich heruntergeladen und läuft danach offline.'],
  ['Als App installieren', 'fableOS lässt sich wie ein Programm installieren: Menü mit dem Tropfen oben links → „fableOS installieren …“.'],
  ['Mehrere Schreibtische', 'F3 zeigt alle Fenster. Oben fügst du Schreibtische hinzu; ⌃1, ⌃2 … wechselt zwischen ihnen.'],
  ['Einrasten & Kacheln', 'Zieh ein Fenster an den Rand – oder halte den Zeiger kurz über den grünen Knopf und wähle eine Anordnung.'],
  ['Echte Dateien', 'Zieh Dateien von deinem Computer auf den Schreibtisch. Die Leertaste zeigt eine Vorschau, das Kontextmenü lädt sie wieder herunter.'],
  ['Fable', 'Der Assistent oben rechts (das Funkeln) versteht Sätze wie „Installiere Schach“ oder „Timer 5 Minuten“.'],
];

export default {
  id: 'about', name: 'Über fableOS', icon: 'info', colors: ['#ff8a5c', '#a04bff'], glyph: LOGO, keywords: 'willkommen hilfe info tastenkürzel',
  singleton: true, noRestore: true, width: 580, height: 560, minW: 420, minH: 400,

  mount(win, args) {
    const seg = h('div.gseg.no-drag', { 'aria-label': 'Bereich' },
      h('button', { dataset: { value: 'hello' }, 'aria-selected': String(args.tab !== 'keys') }, 'Willkommen'),
      h('button', { dataset: { value: 'keys' }, 'aria-selected': String(args.tab === 'keys') }, 'Tastenkürzel'));
    const body = h('div.about-body.scroll');
    win.body.append(h('div.about', h('div.about-tabs', seg), body));
    initControls(win.body);

    const quick = ['store', 'launchpad', 'files', 'terminal', 'settings', 'game'];
    const views = {
      hello: () => [
        h('div.about-hero', h('span.about-logo', { html: LOGO }), h('h1', 'fableOS'), h('p.about-ver', `Version ${sys.version} „Liquid Glass“ · Build ${sys.build}`)),
        h('p.about-lede', 'Ein Betriebssystem, das komplett in deinem Browser läuft – mit Fenstern, Dock, App Store, Suche und einem Dateisystem. Entworfen und programmiert von Claude Fable 5.2. Kein Framework, kein Server, nichts verlässt dein Gerät.'),
        h('div.about-apps', ...quick.filter((id) => apps.has(id)).map((id) => {
          const a = apps.get(id);
          return h('button', { type: 'button', onclick: () => sys.open(id) }, appIcon(a), h('span', a.name));
        })),
        h('ul.about-tips', ...TIPS.map(([t, d]) => h('li', h('b', t), h('span', d)))),
      ],
      keys: () => [
        h('h2', 'Tastenkürzel'),
        h('dl.about-keys', ...KEYS.flatMap(([k, d]) => [h('dt', ...k.split('  /  ').flatMap((part, i) => [i ? h('i', 'oder') : null, ...part.split(' ').map((p) => h('kbd', p))])), h('dd', d)])),
        h('p.about-note', 'Auf Windows und Linux ist ⌥ die Alt-Taste und ⌃ die Strg-Taste. Browser reservieren viele ⌘-/Strg-Kürzel für sich – deshalb nutzt fableOS vor allem ⌥ und ⌃⌥. In der installierten App stehen mehr Kürzel zur Verfügung.'),
      ],
    };
    const show = (tab) => body.replaceChildren(...views[tab]().filter(Boolean));
    seg.addEventListener('change', (e) => show(e.detail.value));
    show(args.tab === 'keys' ? 'keys' : 'hello');
    return { onArgs: (a) => { if (a.tab) { seg.select(a.tab === 'keys' ? 1 : 0, false); show(a.tab === 'keys' ? 'keys' : 'hello'); } } };
  },
};
