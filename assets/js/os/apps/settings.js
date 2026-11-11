// settings.js — Einstellungen: Aussehen, Hintergrund, Glas, Ton, System

import { h } from '../../core/util.js';
import { icon } from '../../core/icons.js';
import { initControls } from '../../core/controls.js';
import { sfx } from '../../core/audio.js';
import { bus } from '../bus.js';
import { sys, settings, set, WALLPAPERS, ACCENTS, DEFAULTS } from '../sys.js';
import { vfs, formatSize } from '../vfs.js';

const TABS = [
  ['look', 'Erscheinungsbild', 'sun'],
  ['wall', 'Hintergrund', 'image'],
  ['glass', 'Glas & Dock', 'layers'],
  ['sound', 'Ton & Mitteilungen', 'volume'],
  ['system', 'System', 'gear'],
];

export default {
  id: 'settings', name: 'Einstellungen', icon: 'gear', colors: ['#b1b9cf', '#596280'], keywords: 'optionen design hintergrund',
  singleton: true, width: 720, height: 500, minW: 520, minH: 360,

  mount(win, args) {
    let tab = args.tab || 'look';
    const side = h('nav.set-side');
    const panel = h('div.set-panel.scroll');
    win.body.append(h('div.set', side, panel));

    const row = (label, sub, control) => h('div.set-row', h('div', h('b', label), sub ? h('small', sub) : null), control);
    const sw = (key, onChange) => {
      const b = h('button.gswitch', { type: 'button', 'aria-checked': String(!!settings[key]), 'aria-label': key });
      b.addEventListener('change', (e) => { set(key, e.detail.checked); onChange?.(e.detail.checked); });
      return b;
    };
    const slider = (key, min, max, step, fmt) => {
      const out = h('output', fmt(settings[key]));
      const s = h('div.gslider', { dataset: { min, max, step, value: settings[key] }, 'aria-label': key });
      s.addEventListener('input', (e) => { set(key, e.detail.value); out.textContent = fmt(e.detail.value); });
      return h('div.set-slider', s, out);
    };

    const panels = {
      look: () => [
        h('h2', 'Erscheinungsbild'),
        h('div.set-themes', ...[['light', 'Hell'], ['dark', 'Dunkel']].map(([mode, name]) =>
          h('button', { type: 'button', class: `theme-card t-${mode}${settings.theme === mode ? ' is-on' : ''}`, onclick: () => set('theme', mode) },
            h('span.theme-prev', h('i'), h('i'), h('i')), h('b', name)))),
        h('h3', 'Akzentfarbe'),
        h('div.set-swatches',
          ...ACCENTS.map(([name, col]) => h('button', {
            type: 'button', title: name, 'aria-label': name, class: settings.accent === col ? 'is-on' : '',
            style: { '--c': col }, onclick: () => set('accent', col),
          })),
          h('label.set-custom', { title: 'Eigene Farbe' }, h('input', { type: 'color', value: settings.accent, oninput: (e) => set('accent', e.target.value) }))),
        h('p.set-note', 'Die Akzentfarbe färbt Schalter, Regler, Auswahl und Hervorhebungen im ganzen System.'),
      ],
      wall: () => [
        h('h2', 'Hintergrund'),
        h('div.set-walls', ...Object.entries(WALLPAPERS).map(([key, w]) =>
          h('button', { type: 'button', class: settings.wallpaper === key ? 'is-on' : '', onclick: () => set('wallpaper', key) },
            h('span', { style: { background: w.css } }), h('b', w.name)))),
        row('Live-Hintergrund', 'Der Hintergrund wird als Shader berechnet und bewegt sich langsam. Aus spart Energie.', sw('animate')),
      ],
      glass: () => [
        h('h2', 'Glas & Dock'),
        row('Unschärfe', 'Wie stark das Glas den Hintergrund weichzeichnet.', slider('blur', 0, 44, 1, (v) => `${v} px`)),
        row('Fensterdeckkraft', 'Niedrig = durchsichtiger, hoch = besser lesbar.', slider('opacity', 0.2, 0.95, 0.01, (v) => `${Math.round(v * 100)} %`)),
        row('Dock-Größe', null, slider('dockSize', 38, 72, 1, (v) => `${v} px`)),
        row('Lupe im Dock', 'Vergrößerung der Symbole unter dem Zeiger.', slider('dockMag', 1, 2.1, 0.01, (v) => `${v.toFixed(2)}×`)),
      ],
      sound: () => [
        h('h2', 'Ton & Mitteilungen'),
        row('Systemtöne', 'Leise, synthetisierte Klänge für Fenster und Mitteilungen.', sw('sounds', () => sfx.pop())),
        row('Lautstärke', null, slider('volume', 0, 1, 0.01, (v) => `${Math.round(v * 100)} %`)),
        row('Nicht stören', 'Mitteilungen werden gesammelt, aber nicht eingeblendet.', sw('dnd')),
        row('Ausprobieren', null, h('button.btn.small.glass.flat', {
          type: 'button', onclick: () => sys.notify({ title: 'Testmitteilung', body: 'So klingt und so sieht das aus.', app: 'settings', force: true }),
        }, 'Mitteilung senden')),
      ],
      system: () => {
        const used = vfs.usage() + JSON.stringify(settings).length;
        const name = h('input.set-input', { type: 'text', value: settings.user, maxLength: 24, 'aria-label': 'Benutzername' });
        name.addEventListener('change', () => set('user', name.value.trim() || 'Gast'));
        const danger = (label, confirm, fn) => {
          const b = h('button.btn.small.glass.flat', { type: 'button' }, label);
          let armed = false;
          b.addEventListener('click', () => {
            if (!armed) { armed = true; b.textContent = confirm; b.classList.add('is-armed'); setTimeout(() => { armed = false; b.textContent = label; b.classList.remove('is-armed'); }, 3000); return; }
            fn();
          });
          return b;
        };
        return [
          h('h2', 'System'),
          row('Benutzername', 'Erscheint auf dem Sperrbildschirm.', name),
          row('Speicher', `${formatSize(used)} von rund 5 MB im lokalen Speicher des Browsers belegt.`,
            h('div.set-meter', h('i', { style: { width: `${Math.min(100, (used / 5e6) * 100).toFixed(1)}%` } }))),
          row('Dateisystem zurücksetzen', 'Stellt die ursprünglichen Dateien wieder her. Eigene Dateien gehen verloren.',
            danger('Zurücksetzen', 'Wirklich löschen?', () => { vfs.reset(); sys.notify({ title: 'Dateisystem zurückgesetzt', body: 'Alles ist wieder wie am ersten Tag.', app: 'settings', force: true }); render(); })),
          row('Einstellungen zurücksetzen', 'Design, Hintergrund und Regler auf Werkseinstellung.',
            danger('Zurücksetzen', 'Wirklich zurücksetzen?', () => { for (const [k, v] of Object.entries(DEFAULTS)) if (k !== 'firstRun') set(k, v); render(); })),
          h('p.set-note', `fableOS ${sys.version} · gespeichert wird ausschließlich in diesem Browser (localStorage) – nichts verlässt dein Gerät.`),
        ];
      },
    };

    function render() {
      side.replaceChildren(...TABS.map(([id, name, ic]) =>
        h('button', { type: 'button', class: id === tab ? 'is-on' : '', html: icon(ic), onclick: () => { tab = id; render(); } }, h('span', name))));
      panel.replaceChildren(...panels[tab]().filter(Boolean));
      initControls(panel);
    }
    render();
    // Änderungen von außen (Kontrollzentrum, Terminal) spiegeln – aber nicht mitten im Ziehen eines Reglers
    const off = bus.on('setting', (key) => {
      if (panel.querySelector('.gslider.is-drag') || document.activeElement?.type === 'color') return;
      if (['theme', 'accent', 'wallpaper', 'animate', 'sounds', 'dnd'].includes(key)) render();
    });
    return { onClose: off, onArgs: (a) => { if (a.tab) { tab = a.tab; render(); } } };
  },
};
