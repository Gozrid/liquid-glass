// shell.js — Menüleiste, Kontrollzentrum, Dock, Suche

import { $, $$, h, ticker, coarse } from '../core/util.js';
import { icon, LOGO } from '../core/icons.js';
import { initControls } from '../core/controls.js';
import { sfx } from '../core/audio.js';
import { evaluate, formatNumber, looksLikeMath } from '../core/calc.js';
import { bus } from './bus.js';
import { sys, settings, set, apps, appIcon, WALLPAPERS } from './sys.js';
import { vfs, HOME, TRASH, pretty, basename } from './vfs.js';
import { openMenu, closeMenu, menuAnchor, fsops, fileIcon } from './ui.js';

const DESKTOP = `${HOME}/Schreibtisch`;

// ==========================================================================
// Menüleiste
// ==========================================================================
export function initMenubar(power) {
  const left = $('#mb-left');
  const right = $('#mb-right');
  const wm = sys.wm;

  const systemMenu = () => [
    { label: 'Über fableOS', icon: 'info', run: () => sys.open('about') },
    { label: 'Einstellungen …', icon: 'gear', run: () => sys.open('settings') },
    '-',
    { label: 'Übersicht', icon: 'grid', hint: 'F3', run: () => wm.toggleOverview() },
    { label: 'Suche', icon: 'search', hint: '⌘K', run: () => sys.search() },
    '-',
    { label: 'Sperren', icon: 'lock', run: power.lock },
    { label: 'Neu starten', icon: 'reload', run: power.restart },
    { label: 'Ausschalten – zur Website', icon: 'power', run: power.shutdown },
  ];

  const menusFor = (win) => {
    const file = win
      ? [
        !win.app.singleton && { label: 'Neues Fenster', run: () => sys.open(win.app.id) },
        { label: 'Fenster schließen', hint: '⌥W', run: () => win.close() },
      ]
      : [
        { label: 'Neuer Ordner', icon: 'folder', run: () => fsops.newFolder(DESKTOP) },
        { label: 'Neue Textdatei', icon: 'file', run: () => fsops.newFile(DESKTOP) },
      ];
    const extra = win ? (typeof win.hooks.menus === 'function' ? win.hooks.menus() : win.hooks.menus) || [] : [];
    const list = wm.wins.map((w) => ({
      label: w.title, checked: w === wm.focused,
      run: () => { if (w.min) w.restore(); else wm.focus(w); },
    }));
    const windows = [
      { label: 'Minimieren', hint: '⌥M', disabled: !win, run: () => win.minimize() },
      { label: 'Zoomen', hint: '⌥↩', disabled: !win, run: () => win.toggleMax() },
      '-',
      { label: 'Linke Hälfte', hint: '⌥←', disabled: !win, run: () => win.snap('left') },
      { label: 'Rechte Hälfte', hint: '⌥→', disabled: !win, run: () => win.snap('right') },
      '-',
      { label: 'Übersicht', hint: 'F3', run: () => wm.toggleOverview() },
      { label: 'Alle Fenster schließen', disabled: !wm.wins.length, run: () => wm.closeAll() },
      ...(list.length ? ['-', ...list] : []),
    ];
    const help = [
      { label: 'Willkommen & Tastenkürzel', icon: 'sparkles', run: () => sys.open('about', { tab: 'keys' }) },
      { label: 'Zurück zur Website', icon: 'arrowLeft', run: power.shutdown },
    ];
    return [{ label: 'Datei', items: file }, ...extra, { label: 'Fenster', items: windows }, { label: 'Hilfe', items: help }];
  };

  const render = () => {
    const win = wm.focused;
    const btn = (cls, content, items) => {
      const b = h(`button.mb-item${cls}`, { type: 'button' }, content);
      const show = () => {
        b.classList.add('is-open');
        openMenu(typeof items === 'function' ? items() : items, { anchor: b, onClose: () => b.classList.remove('is-open') });
      };
      b.addEventListener('click', () => { if (menuAnchor() === b) closeMenu(); else show(); });
      b.addEventListener('pointerenter', () => { const a = menuAnchor(); if (a && a !== b && left.contains(a)) show(); });
      return b;
    };
    const logo = btn('.mb-logo', null, systemMenu);
    logo.innerHTML = LOGO;
    logo.setAttribute('aria-label', 'fableOS-Menü');
    left.replaceChildren(
      logo,
      h('span.mb-app', win ? win.app.name : 'Schreibtisch'),
      ...menusFor(win).map((m) => btn('', m.label, m.items)),
    );
  };
  bus.on('focus', render);
  bus.on('wm', render);
  render();

  // ---------- rechte Seite: Status ----------
  const battery = h('span.mb-batt', { hidden: true });
  const ccBtn = h('button.mb-item.mb-ico', { type: 'button', 'aria-label': 'Kontrollzentrum', html: icon('sliders') });
  const searchBtn = h('button.mb-item.mb-ico', { type: 'button', 'aria-label': 'Suche', html: icon('search'), onclick: () => sys.search() });
  const clock = h('button.mb-item.mb-clock', { type: 'button', 'aria-label': 'Widgets ein- oder ausblenden' });
  right.replaceChildren(battery, searchBtn, ccBtn, clock);
  const tick = () => {
    const d = new Date();
    clock.replaceChildren(
      h('span.mb-date', d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })),
      h('span', d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })));
  };
  tick();
  setInterval(tick, 5000);
  clock.addEventListener('click', () => document.body.classList.toggle('hide-widgets'));
  navigator.getBattery?.().then((b) => {
    const paint = () => {
      battery.hidden = false;
      battery.innerHTML = `${icon('battery')}<i style="--l:${b.level}"></i><span>${Math.round(b.level * 100)} %</span>`;
      battery.classList.toggle('is-charging', b.charging);
    };
    paint();
    b.addEventListener('levelchange', paint);
    b.addEventListener('chargingchange', paint);
  }).catch(() => {});

  initControlCenter(ccBtn, power);
}

// ==========================================================================
// Kontrollzentrum
// ==========================================================================
function initControlCenter(btn, power) {
  const cc = $('#cc');
  const tiles = [
    { key: 'theme', icon: 'moon', label: 'Dunkel', on: () => settings.theme === 'dark', toggle: () => set('theme', settings.theme === 'dark' ? 'light' : 'dark') },
    { key: 'dnd', icon: 'focus', label: 'Nicht stören', on: () => settings.dnd, toggle: () => set('dnd', !settings.dnd) },
    { key: 'sounds', icon: 'volume', label: 'Töne', on: () => settings.sounds, toggle: () => { set('sounds', !settings.sounds); sfx.pop(); } },
    { key: 'animate', icon: 'wave', label: 'Animation', on: () => settings.animate, toggle: () => set('animate', !settings.animate) },
  ];
  const grid = h('div.cc-grid');
  const paint = () => {
    grid.replaceChildren(...tiles.map((t) => h('button.cc-tile', {
      type: 'button', 'aria-pressed': String(t.on()),
      onclick: () => { t.toggle(); sfx.tick(); },
    }, h('span.cc-ico', { html: icon(t.icon) }), h('span', h('b', t.label), h('small', t.on() ? 'An' : 'Aus')))));
  };
  const bright = h('div.gslider', { dataset: { min: 0.35, max: 1, step: 0.01, value: settings.brightness }, 'aria-label': 'Helligkeit' });
  const vol = h('div.gslider', { dataset: { min: 0, max: 1, step: 0.01, value: settings.volume }, 'aria-label': 'Lautstärke' });
  cc.replaceChildren(
    grid,
    h('div.cc-block', h('label', { html: `${icon('sun')} Helligkeit` }), bright),
    h('div.cc-block', h('label', { html: `${icon('volume')} Lautstärke` }), vol),
    h('div.cc-row',
      h('button.btn.small.glass.flat', { type: 'button', html: `${icon('grid')} Übersicht`, onclick: () => { hide(); sys.wm.toggleOverview(); } }),
      h('button.btn.small.glass.flat', { type: 'button', html: `${icon('lock')} Sperren`, onclick: () => { hide(); power.lock(); } }),
      h('button.btn.small.glass.flat', { type: 'button', html: `${icon('gear')} Mehr`, onclick: () => { hide(); sys.open('settings'); } })),
  );
  initControls(cc);
  bright.addEventListener('input', (e) => set('brightness', e.detail.value));
  vol.addEventListener('input', (e) => set('volume', e.detail.value));
  vol.addEventListener('change', () => sfx.pop());
  paint();
  bus.on('setting', () => { paint(); bright.value = settings.brightness; vol.value = settings.volume; });

  function hide() { cc.hidden = true; btn.classList.remove('is-open'); }
  btn.addEventListener('click', () => {
    cc.hidden = !cc.hidden;
    btn.classList.toggle('is-open', !cc.hidden);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!cc.hidden && !cc.contains(e.target) && !btn.contains(e.target)) hide();
  }, true);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
}

// ==========================================================================
// Dock
// ==========================================================================
const PINNED = ['files', 'terminal', 'notes', 'paint', 'synth', 'web', 'calc', 'game', 'monitor', 'settings'];

export function initDock() {
  const dock = $('#dock');
  const tip = $('#dock-tip');
  const wm = sys.wm;
  let items = [];     // {id, el, s, target}

  const launch = (id, el) => {
    const wins = wm.byApp(id);
    if (!wins.length) {
      el.classList.remove('bounce');
      void el.offsetWidth;
      el.classList.add('bounce');
      sys.open(id);
      return;
    }
    const hidden = wins.filter((w) => w.min);
    if (hidden.length) { hidden[hidden.length - 1].restore(); return; }
    const sorted = [...wins].sort((a, b) => b.z - a.z);
    // ist die App schon vorn, wandert der Fokus zu ihrem nächsten Fenster
    wm.focus(wm.focused === sorted[0] && sorted.length > 1 ? sorted[sorted.length - 1] : sorted[0]);
  };

  const build = () => {
    const running = [...new Set(wm.wins.map((w) => w.app.id))].filter((id) => !PINNED.includes(id));
    const ids = [...PINNED.filter((id) => apps.has(id)), ...running];
    const key = ids.join(',');
    if (dock.dataset.key !== key) {
      dock.dataset.key = key;
      items = ids.map((id) => {
        const app = apps.get(id);
        const el = h('button.dock-item', { type: 'button', dataset: { app: id }, 'aria-label': app.name }, appIcon(app), h('i.dock-dot'));
        el.addEventListener('click', () => launch(id, el));
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const wins = wm.byApp(id);
          openMenu([
            { heading: app.name },
            { label: wins.length && !app.singleton ? 'Neues Fenster' : 'Öffnen', run: () => sys.open(id) },
            { label: 'Alle Fenster zeigen', disabled: !wins.length, run: () => wins.forEach((w) => (w.min ? w.restore() : wm.focus(w))) },
            '-',
            { label: 'Beenden', disabled: !wins.length, run: () => wins.forEach((w) => w.close()) },
          ], { x: e.clientX - 20, y: e.clientY - 190 });
        });
        return { id, name: app.name, el, s: 1, target: 1 };
      });
      const trash = h('button.dock-item.is-trash', { type: 'button', 'aria-label': 'Papierkorb' },
        h('span.app-icon', { style: { '--c1': '#c3cadf', '--c2': '#7a839f' }, html: icon('trash') }), h('i.dock-dot'));
      trash.addEventListener('click', () => sys.open('files', { path: TRASH }));
      items.push({ id: '__trash', name: 'Papierkorb', el: trash, s: 1, target: 1 });
      dock.replaceChildren(...items.slice(0, -1).map((i) => i.el), h('span.dock-sep'), trash);
    }
    for (const it of items) {
      const wins = wm.byApp(it.id);
      it.el.classList.toggle('is-running', wins.length > 0);
      it.el.classList.toggle('is-front', !!wm.focused && wm.focused.app.id === it.id);
    }
  };
  bus.on('wm', build);
  bus.on('focus', build);
  build();
  wm.iconRect = (id) => items.find((i) => i.id === id)?.el.getBoundingClientRect() || null;

  // ---------- Lupe ----------
  let mx = null;
  let active = false;
  const frame = () => {
    let moving = false;
    const size = settings.dockSize;
    const sigma = size * 1.5;
    for (const it of items) {
      if (mx == null) it.target = 1;
      else {
        const r = it.el.getBoundingClientRect();
        const d = mx - (r.left + r.width / 2);
        it.target = 1 + (settings.dockMag - 1) * Math.exp(-(d * d) / (2 * sigma * sigma));
      }
      it.s += (it.target - it.s) * 0.28;
      if (Math.abs(it.target - it.s) > 0.002) moving = true; else it.s = it.target;
      it.el.style.setProperty('--s', it.s.toFixed(3));
    }
    if (!moving && mx == null) { ticker.remove(frame); active = false; }
  };
  const wake = () => { if (!active) { active = true; ticker.add(frame); } };
  if (!coarse.matches) {
    dock.addEventListener('pointermove', (e) => {
      mx = e.clientX;
      wake();
      const el = e.target.closest('.dock-item');
      const it = el && items.find((i) => i.el === el);
      if (it) {
        const r = el.getBoundingClientRect();
        tip.textContent = it.name;
        tip.style.left = `${r.left + r.width / 2}px`;
        tip.style.top = `${dock.getBoundingClientRect().top - 12}px`;
        tip.classList.add('on');
      } else tip.classList.remove('on');
    });
    dock.addEventListener('pointerleave', () => { mx = null; wake(); tip.classList.remove('on'); });
  }
}

// ==========================================================================
// Suche (Apps · Dateien · Befehle · Rechnen)
// ==========================================================================
export function initLauncher(power) {
  const wrap = $('#launcher');
  const input = $('#launcher-input');
  const list = $('#launcher-list');
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const commands = [
    { label: 'Dunkles Design', icon: 'moon', run: () => set('theme', 'dark') },
    { label: 'Helles Design', icon: 'sun', run: () => set('theme', 'light') },
    { label: 'Übersicht aller Fenster', icon: 'grid', run: () => sys.wm.toggleOverview(true) },
    { label: 'Alle Fenster schließen', icon: 'close', run: () => sys.wm.closeAll() },
    { label: 'Hintergrund wechseln', icon: 'image', run: () => { const k = Object.keys(WALLPAPERS); set('wallpaper', k[(k.indexOf(settings.wallpaper) + 1) % k.length]); } },
    { label: 'Sperren', icon: 'lock', run: power.lock },
    { label: 'Neu starten', icon: 'reload', run: power.restart },
    { label: 'Ausschalten – zur Website', icon: 'power', run: power.shutdown },
  ];
  let rows = [];
  let sel = 0;

  const paintSel = () => {
    $$('li[role="option"]', list).forEach((li, i) => li.setAttribute('aria-selected', String(i === sel)));
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  };
  const render = () => {
    const q = norm(input.value.trim());
    rows = [];
    const out = [];
    const group = (title, entries) => {
      if (!entries.length) return;
      out.push(h('li.launcher-head', title));
      for (const e of entries) {
        const i = rows.length;
        rows.push(e);
        const li = h('li', { role: 'option' }, e.visual, h('span', e.label), e.hint ? h('small', e.hint) : null);
        li.addEventListener('pointermove', () => { if (sel !== i) { sel = i; paintSel(); } });
        li.addEventListener('click', () => run(i));
        out.push(li);
      }
    };
    if (looksLikeMath(input.value)) {
      try {
        const v = formatNumber(evaluate(input.value));
        group('Rechner', [{
          label: `= ${v}`, hint: 'Eingabetaste kopiert', visual: h('span.l-ico', { html: icon('calc') }),
          run: () => navigator.clipboard?.writeText(v).then(() => sys.notify({ title: 'Ergebnis kopiert', body: v, icon: 'copy' })).catch(() => {}),
        }]);
      } catch { /* unvollständige Eingabe – einfach keine Zeile */ }
    }
    const appRows = [...apps.values()].filter((a) => !q || norm(a.name).includes(q) || norm(a.keywords || '').includes(q))
      .map((a) => ({ label: a.name, hint: 'App', visual: appIcon(a, 'sm'), run: () => sys.open(a.id) }));
    group('Apps', q ? appRows : appRows.slice(0, 6));
    if (q) {
      group('Dateien', vfs.find(q, HOME).slice(0, 6).map((p) => ({
        label: basename(p), hint: pretty(p), visual: fileIcon(vfs.stat(p)), run: () => sys.openPath(p),
      })));
    }
    group('Befehle', commands.filter((c) => !q || norm(c.label).includes(q)).slice(0, q ? 8 : 4)
      .map((c) => ({ label: c.label, hint: 'Befehl', visual: h('span.l-ico', { html: icon(c.icon) }), run: c.run })));
    if (!rows.length) out.push(h('li.launcher-empty', `Nichts gefunden für „${input.value.trim()}“`));
    sel = 0;
    list.replaceChildren(...out);
    paintSel();
  };
  const open = () => {
    if (!wrap.hidden) return;
    wrap.hidden = false;
    input.value = '';
    render();
    input.focus();
    sfx.tick();
  };
  const close = () => { wrap.hidden = true; };
  const run = (i) => {
    const r = rows[i];
    close();
    if (r) setTimeout(r.run, 40);
  };
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(1, rows.length); paintSel(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + rows.length) % Math.max(1, rows.length); paintSel(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
    else if (e.key === 'Escape') close();
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); close(); }
  });
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
  sys.search = () => (wrap.hidden ? open() : close());
  return { open, close, get isOpen() { return !wrap.hidden; } };
}
