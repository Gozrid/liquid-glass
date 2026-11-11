// web.js — kleiner Browser: lädt Seiten in einem iframe, mit Lesezeichen und eigenem Verlauf

import { h } from '../../core/util.js';
import { icon } from '../../core/icons.js';

const BOOKMARKS = [
  { name: 'Showcase', url: 'index.html', text: 'Die Liquid-Glass-Seite, von der du kommst – jetzt im Fenster.', ic: 'drop' },
  { name: 'fableOS in fableOS', url: 'os.html', text: 'Ein Betriebssystem im Browser im Betriebssystem im Browser.', ic: 'layers' },
  { name: 'Karte', url: 'https://www.openstreetmap.org/export/embed.html?bbox=13.30%2C52.47%2C13.48%2C52.56&layer=mapnik', text: 'OpenStreetMap, live eingebettet (lädt von openstreetmap.org).', ic: 'compass' },
];

export default {
  id: 'web', name: 'Web', icon: 'compass', colors: ['#62e0ff', '#2f7cf6'], keywords: 'browser internet surfen',
  width: 900, height: 600, minW: 480, minH: 340,

  mount(win, args) {
    let stack = [];
    let at = -1;

    const url = h('input.web-url.no-drag', { type: 'text', placeholder: 'Adresse eingeben', spellcheck: false, autocomplete: 'off', 'aria-label': 'Adresse' });
    const btn = (name, label, fn) => h('button.tool', { type: 'button', 'aria-label': label, title: label, html: icon(name), onclick: fn });
    const bBack = btn('chevronLeft', 'Zurück', () => { if (at > 0) { at--; show(); } });
    const bFwd = btn('chevronRight', 'Vorwärts', () => { if (at < stack.length - 1) { at++; show(); } });
    const bHome = btn('grid', 'Startseite', () => go(null));
    const bReload = btn('reload', 'Neu laden', () => { if (stack[at]) frame.src = stack[at]; });
    const bOut = btn('external', 'In neuem Tab öffnen', () => { if (stack[at]) window.open(stack[at], '_blank', 'noopener'); });
    const frame = h('iframe.web-frame', { title: 'Webseite', hidden: true, referrerPolicy: 'no-referrer' });
    const start = h('div.web-start.scroll',
      h('h2', 'Wohin soll es gehen?'),
      h('div.web-tiles', ...BOOKMARKS.map((b) => h('button', { type: 'button', onclick: () => go(b.url) },
        h('span.web-ico', { html: icon(b.ic) }), h('b', b.name), h('span', b.text)))),
      h('p', 'Du kannst oben auch jede Adresse eingeben. Viele Websites verbieten allerdings das Einbetten in fremde Seiten – bleibt das Fenster leer, öffne die Adresse über das Pfeilsymbol in einem neuen Tab.'));
    win.body.append(h('div.web', h('div.web-bar', bBack, bFwd, bHome, bReload, url, bOut), start, frame));

    const show = () => {
      const u = stack[at] || null;
      frame.hidden = !u;
      start.hidden = !!u;
      if (u) {
        if (frame.getAttribute('src') !== u) {
          // Fremde Seiten laufen in einer Sandbox (dürfen z. B. das Hauptfenster nicht umleiten);
          // die eigenen Seiten brauchen keine.
          if (/^https?:/i.test(u)) frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups');
          else frame.removeAttribute('sandbox');
          frame.src = u;
        }
      } else frame.removeAttribute('src');
      url.value = u || '';
      win.setTitle(u ? `${BOOKMARKS.find((b) => b.url === u)?.name || u.replace(/^https?:\/\//, '').split('/')[0]} – Web` : 'Web');
      bBack.disabled = at <= 0;
      bFwd.disabled = at >= stack.length - 1;
      bReload.disabled = bOut.disabled = !u;
    };
    function go(u) {
      stack = stack.slice(0, at + 1);
      stack.push(u);
      at = stack.length - 1;
      show();
    }
    url.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key !== 'Enter') return;
      let v = url.value.trim();
      if (!v) return;
      if (!/^[a-z]+:\/\//i.test(v) && !/^[\w./-]+\.html?$/i.test(v)) v = `https://${v}`;
      if (/^(javascript|data|file):/i.test(v)) return;
      go(v);
    });
    url.addEventListener('focus', () => url.select());

    go(args.url || null);
    return {
      onArgs: (a) => { if (a.url) go(a.url); },
      menus: [{ label: 'Lesezeichen', items: BOOKMARKS.map((b) => ({ label: b.name, icon: b.ic, run: () => go(b.url) })) }],
    };
  },
};
