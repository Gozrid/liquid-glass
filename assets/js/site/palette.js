// palette.js — Befehlspalette (⌘K / Strg+K)

import { $, h } from '../core/util.js';
import { icon } from '../core/icons.js';
import { toast, confetti } from './fx.js';

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Punktzahl: Teilstring schlägt Buchstabenfolge; -1 = kein Treffer */
function score(query, text) {
  if (!query) return 1;
  const q = norm(query);
  const t = norm(text);
  const idx = t.indexOf(q);
  if (idx >= 0) return 100 - idx;
  let j = 0;
  for (let i = 0; i < t.length && j < q.length; i++) if (t[i] === q[j]) j++;
  return j === q.length ? 10 : -1;
}

export function initPalette(theme) {
  const wrap = $('#palette');
  const input = $('#palette-input');
  const list = $('#palette-list');
  const go = (sel) => () => $(sel).scrollIntoView({ behavior: 'smooth', block: 'start' });

  const items = [
    { icon: 'drop', label: 'Zum Anfang', hint: 'Abschnitt', run: () => scrollTo({ top: 0, behavior: 'smooth' }) },
    { icon: 'layers', label: 'Material – das Glas-Labor', hint: 'Abschnitt', run: go('#material') },
    { icon: 'sliders', label: 'Komponenten – Schalter, Regler, Morph', hint: 'Abschnitt', run: go('#komponenten') },
    { icon: 'bolt', label: 'Können – sechs Live-Experimente', hint: 'Abschnitt', run: go('#koennen') },
    { icon: 'grid', label: 'System – der fableOS-Teaser', hint: 'Abschnitt', run: go('#system') },
    { icon: 'power', label: 'fableOS starten', hint: 'System', run: () => { location.href = 'os.html'; } },
    { icon: 'sun', label: 'Design wechseln (hell / dunkel)', hint: 'Aktion', run: () => theme.toggle({ x: innerWidth / 2, y: innerHeight / 2 }) },
    { icon: 'music', label: 'Sequencer starten oder stoppen', hint: 'Aktion', run: () => { go('#seq')(); $('#seq-play').click(); } },
    { icon: 'sparkles', label: 'Konfetti werfen', hint: 'Spaß', run: () => confetti() },
    { icon: 'bell', label: 'Mitteilung senden', hint: 'Spaß', run: () => toast({ title: 'Hallo aus der Palette', body: 'Befehle funktionieren von überall.', iconName: 'command' }) },
    {
      icon: 'copy', label: 'Link zu dieser Seite kopieren', hint: 'Aktion',
      run: () => navigator.clipboard?.writeText(location.href)
        .then(() => toast({ title: 'Link kopiert', body: location.href, iconName: 'check' }))
        .catch(() => toast({ title: 'Kopieren nicht möglich', body: 'Der Browser hat den Zugriff verweigert.', iconName: 'close' })),
    },
  ];

  let shown = [];
  let sel = 0;
  let lastFocus = null;

  const paintSel = () => {
    [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === sel)));
    list.children[sel]?.scrollIntoView({ block: 'nearest' });
  };
  const render = () => {
    const q = input.value.trim();
    shown = items
      .map((it) => ({ it, s: Math.max(score(q, it.label), score(q, it.hint) - 5) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.it);
    sel = 0;
    list.replaceChildren(...(shown.length
      ? shown.map((it, i) => {
        const li = h('li', { role: 'option', html: icon(it.icon) }, h('span', it.label), h('small', it.hint));
        li.addEventListener('pointermove', () => { if (sel !== i) { sel = i; paintSel(); } });
        li.addEventListener('click', () => run(i));
        return li;
      })
      : [h('li.palette-empty', `Nichts gefunden für „${q}“`)]));
    paintSel();
  };
  const open = () => {
    if (!wrap.hidden) return;
    lastFocus = document.activeElement;
    wrap.hidden = false;
    input.value = '';
    render();
    input.focus();
  };
  const close = () => {
    if (wrap.hidden) return;
    wrap.hidden = true;
    lastFocus?.focus?.({ preventScroll: true });
  };
  const run = (i) => {
    const it = shown[i];
    close();
    if (it) setTimeout(() => it.run(), 60);
  };

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(1, shown.length); paintSel(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + shown.length) % Math.max(1, shown.length); paintSel(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
    else if (e.key === 'Tab') e.preventDefault();
  });
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
  addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (wrap.hidden) open(); else close();
    } else if (e.key === 'Escape') close();
  });
  $('#palette-btn').addEventListener('click', open);
  return { open, close };
}
