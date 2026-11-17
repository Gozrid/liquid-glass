// menubar.js — Menüleiste: Systemmenü, App-Menü, Ablage/Bearbeiten/Fenster/Hilfe und die Statussymbole rechts

import { $, h } from '../../core/util.js';
import { icon, LOGO } from '../../core/icons.js';
import { bus } from '../bus.js';
import { sys, settings, set, apps, appIcon } from '../sys.js';
import { vfs, HOME, TRASH } from '../vfs.js';
import { openMenu, closeMenu, menuAnchor, fsops, dialog, confirmDialog, notes } from '../ui.js';
import { initControlCenter } from './control.js';

const DESKTOP = `${HOME}/Schreibtisch`;

// Das zuletzt benutzte Textfeld: „Bearbeiten“ wirkt darauf, auch wenn das Menü den Fokus hat
let lastField = null;
document.addEventListener('focusin', (e) => {
  const t = e.target;
  if (t.matches?.('textarea, [contenteditable="true"], input:not([type="checkbox"]):not([type="color"]):not([type="range"]):not([type="file"])')) lastField = t;
});

export function initMenubar(power) {
  const left = $('#mb-left');
  const right = $('#mb-right');
  const wm = sys.wm;

  const field = () => (lastField?.isConnected && !lastField.disabled && !lastField.readOnly ? lastField : null);
  const edit = (cmd) => () => {
    const f = field();
    if (!f) return;
    f.focus({ preventScroll: true });
    if (cmd === 'paste') {
      (navigator.clipboard?.readText?.() || Promise.reject()).then((t) => { if (t) document.execCommand('insertText', false, t); })
        .catch(() => sys.notify({ title: 'Einsetzen', body: 'Der Browser gibt die Zwischenablage nur per ⌘V / Strg+V frei.', icon: 'copy' }));
    } else document.execCommand(cmd);
  };

  // ---------- Dialoge ----------
  const aboutApp = (app) => dialog({
    app, title: app.name,
    text: app.description || app.tagline || 'Eine App für fableOS.',
    body: h('p.sysdlg-meta', `Version ${app.version || sys.version} · ${app.webApp ? 'Web-App' : app.store ? 'aus dem App Store' : 'Teil von fableOS'}`),
  });
  const forceQuit = () => {
    const running = wm.running();
    if (!running.length) { dialog({ icon: 'bolt', title: 'Sofort beenden', text: 'Im Moment läuft keine App.' }); return; }
    let pick = running[0].id;
    const list = h('div.sysdlg-list', running.map((app) => {
      const b = h('button', { type: 'button', class: app.id === pick ? 'is-on' : '' }, appIcon(app, 'sm'), h('span', app.name));
      b.addEventListener('click', () => { pick = app.id; for (const c of list.children) c.classList.toggle('is-on', c === b); });
      return b;
    }));
    dialog({
      icon: 'bolt', title: 'Apps sofort beenden',
      text: 'Reagiert eine App nicht mehr, wähle sie aus und beende sie.',
      body: list,
      buttons: [{ label: 'Abbrechen', value: null }, { label: 'Sofort beenden', value: () => pick, danger: true }],
    }).then((id) => { if (id) wm.quitApp(id); });
  };
  const askPower = (kind) => {
    const sw = h('button.gswitch', { type: 'button', role: 'switch', 'aria-checked': String(!!settings.restore), 'aria-label': 'Fenster wieder öffnen' }, h('i'));
    sw.addEventListener('click', () => sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true')));
    confirmDialog({
      icon: kind === 'restart' ? 'reload' : 'power',
      title: kind === 'restart' ? 'fableOS jetzt neu starten?' : 'fableOS jetzt ausschalten?',
      text: kind === 'restart' ? 'Alle Apps werden beendet. Gesicherte Dateien bleiben erhalten.' : 'Du landest wieder auf der Website. Gesicherte Dateien bleiben erhalten.',
      body: h('label.sysdlg-opt', sw, h('span', 'Fenster beim nächsten Start wieder öffnen')),
      ok: kind === 'restart' ? 'Neu starten' : 'Ausschalten',
    }).then((yes) => {
      if (!yes) return;
      set('restore', sw.getAttribute('aria-checked') === 'true');
      if (kind === 'restart') power.restart(); else power.shutdown();
    });
  };

  // ---------- Menüs ----------
  const systemMenu = () => {
    const ups = sys.registry?.updates().length || 0;
    return [
      { label: 'Über fableOS', icon: 'info', run: () => sys.open('about') },
      '-',
      { label: 'Systemeinstellungen …', icon: 'gear', run: () => sys.open('settings') },
      { label: 'App Store …', icon: 'download', hint: ups ? `${ups} Update${ups > 1 ? 's' : ''}` : '', run: () => sys.open('store', ups ? { view: 'updates' } : {}) },
      sys.pwa?.canOffer() && { label: 'fableOS installieren …', icon: 'plus', run: () => sys.pwa.install() },
      '-',
      { label: 'Vollbild', icon: 'layers', checked: !!document.fullscreenElement, run: () => sys.toggleFullscreen() },
      { label: 'Sofort beenden …', icon: 'bolt', hint: '⌥⎋', run: forceQuit },
      '-',
      { label: 'Bildschirmschoner', icon: 'moon', run: () => sys.saver?.start() },
      { label: 'Neu starten …', icon: 'reload', run: () => askPower('restart') },
      { label: 'Ausschalten …', icon: 'power', run: () => askPower('off') },
      '-',
      { label: 'Bildschirm sperren', icon: 'lock', hint: '⌃⌥L', run: power.lock },
    ];
  };

  const menusFor = (win) => {
    const app = win?.app;
    const appMenu = app
      ? [
        { label: `Über ${app.name}`, run: () => (app.id === 'about' ? sys.open('about') : aboutApp(app)) },
        '-',
        { label: 'Einstellungen …', hint: '⌘,', run: () => sys.open('settings') },
        '-',
        { label: `${app.name} ausblenden`, hint: '⌥H', run: () => wm.hideApp(app.id) },
        { label: 'Andere ausblenden', run: () => wm.running().forEach((a) => { if (a.id !== app.id) wm.hideApp(a.id); }) },
        { label: 'Alle einblenden', run: () => wm.wins.forEach((w) => { if (w.min && w.space === wm.space) w.restore(); }) },
        '-',
        { label: `${app.name} beenden`, hint: '⌥Q', run: () => wm.quitApp(app.id) },
      ]
      : [
        { label: 'Über fableOS', icon: 'info', run: () => sys.open('about') },
        '-',
        { label: 'Einstellungen …', hint: '⌘,', run: () => sys.open('settings') },
        { label: 'Hintergrund ändern …', run: () => sys.open('settings', { tab: 'wall' }) },
        '-',
        { label: 'Papierkorb leeren …', disabled: !vfs.list(TRASH).length, run: () => sys.emptyTrash() },
      ];
    const file = win
      ? [
        !app.singleton && { label: 'Neues Fenster', run: () => sys.open(app.id) },
        { label: 'Fenster schließen', hint: '⌥W', run: () => win.close() },
      ]
      : [
        { label: 'Neues Dateien-Fenster', icon: 'folder', run: () => sys.open('files') },
        '-',
        { label: 'Neuer Ordner', run: () => fsops.newFolder(DESKTOP) },
        { label: 'Neue Textdatei', run: () => { const p = fsops.newFile(DESKTOP); if (p) sys.openPath(p); } },
        { label: 'Vom Gerät importieren …', icon: 'download', run: () => sys.importToDesktop?.() },
      ];
    const f = field();
    const editMenu = [
      { label: 'Widerrufen', hint: '⌘Z', disabled: !f, run: edit('undo') },
      { label: 'Wiederholen', hint: '⇧⌘Z', disabled: !f, run: edit('redo') },
      '-',
      { label: 'Ausschneiden', hint: '⌘X', disabled: !f, run: edit('cut') },
      { label: 'Kopieren', hint: '⌘C', disabled: !f, run: edit('copy') },
      { label: 'Einsetzen', hint: '⌘V', disabled: !f, run: edit('paste') },
      { label: 'Alles auswählen', hint: '⌘A', disabled: !f, run: () => { const el = field(); el?.focus({ preventScroll: true }); el?.select?.(); } },
      '-',
      { label: 'Suchen …', icon: 'search', hint: '⌘K', run: () => sys.search() },
      { label: 'Fable fragen …', icon: 'sparkles', hint: '⌥Leertaste', run: () => sys.assistant?.toggle() },
    ];
    const extra = win ? (typeof win.hooks.menus === 'function' ? win.hooks.menus() : win.hooks.menus) || [] : [];
    const list = wm.wins.map((w) => ({
      label: wm.spaceCount > 1 ? `${w.title}  ·  ${w.space + 1}` : w.title, checked: w === wm.focused,
      run: () => wm.reveal(w),
    }));
    const windows = [
      { label: 'Minimieren', hint: '⌥M', disabled: !win, run: () => win.minimize() },
      { label: 'Zoomen', hint: '⌃⌥↩', disabled: !win, run: () => win.toggleMax() },
      {
        label: 'Anordnen', disabled: !win, items: win ? [
          { label: 'Linke Hälfte', hint: '⌃⌥←', run: () => win.snap('left') },
          { label: 'Rechte Hälfte', hint: '⌃⌥→', run: () => win.snap('right') },
          '-',
          { label: 'Oben links', hint: '⌃⌥U', run: () => win.snap('tl') },
          { label: 'Oben rechts', hint: '⌃⌥I', run: () => win.snap('tr') },
          { label: 'Unten links', hint: '⌃⌥J', run: () => win.snap('bl') },
          { label: 'Unten rechts', hint: '⌃⌥K', run: () => win.snap('br') },
        ] : [],
      },
      { label: 'Auf Schreibtisch bewegen', disabled: !win || wm.spaceCount < 2, items: win ? wm.spaceItems(win) : [] },
      '-',
      { label: 'Übersicht', icon: 'grid', hint: 'F3', run: () => wm.toggleOverview() },
      { label: 'Apps', icon: 'layers', hint: 'F4', run: () => sys.launchpad?.toggle() },
      { label: 'Alle Fenster schließen', disabled: !wm.wins.length, run: () => wm.closeAll() },
      ...(list.length ? ['-', ...list] : []),
    ];
    const help = [
      { label: 'Willkommen', icon: 'sparkles', run: () => sys.open('about') },
      { label: 'Tastaturkürzel', icon: 'command', run: () => sys.open('about', { tab: 'keys' }) },
      { label: 'Fable fragen …', icon: 'sparkles', run: () => sys.assistant?.toggle() },
      '-',
      { label: 'Zurück zur Website', icon: 'arrowLeft', run: power.shutdown },
    ];
    // Bringt eine App ein Menü mit, das wie ein Systemmenü heißt, wandern ihre Einträge an dessen Anfang
    const base = { Ablage: file.filter(Boolean), Bearbeiten: editMenu, Fenster: windows, Hilfe: help };
    const own = [];
    for (const m of extra) {
      const items = (typeof m.items === 'function' ? m.items() : m.items) || [];     // Apps dürfen Einträge auch als Funktion liefern
      const name = m.label === 'Datei' ? 'Ablage' : m.label;
      if (base[name]) base[name] = [...items, '-', ...base[name]];
      else own.push({ label: m.label, items });
    }
    return {
      appMenu,
      menus: [{ label: 'Ablage', items: base.Ablage }, { label: 'Bearbeiten', items: base.Bearbeiten }, ...own, { label: 'Fenster', items: base.Fenster }, { label: 'Hilfe', items: base.Hilfe }],
    };
  };

  const render = () => {
    const win = wm.focused;
    const btn = (cls, content, items) => {
      const b = h(`button.mb-item${cls}`, { type: 'button' }, content);
      const show = () => {
        b.classList.add('is-open');
        openMenu((typeof items === 'function' ? items() : items).filter(Boolean), { anchor: b, onClose: () => b.classList.remove('is-open') });
      };
      b.addEventListener('click', () => { if (menuAnchor() === b) closeMenu(); else show(); });
      b.addEventListener('pointerenter', () => { const a = menuAnchor(); if (a && a !== b && left.contains(a)) show(); });
      return b;
    };
    const logo = btn('.mb-logo', null, systemMenu);
    logo.innerHTML = LOGO;
    logo.setAttribute('aria-label', 'fableOS-Menü');
    const { menus } = menusFor(win);
    left.replaceChildren(
      logo,
      btn('.mb-app', win ? win.app.name : 'Schreibtisch', () => menusFor(wm.focused).appMenu),
      ...menus.map((m) => btn('', m.label, () => menusFor(wm.focused).menus.find((x) => x.label === m.label)?.items || m.items)),
    );
  };
  bus.on('focus', render);
  bus.on('wm', render);
  bus.on('apps', render);
  render();

  // ---------- rechte Seite: Status ----------
  const status = (cls, label, html, onclick) => h(`button.mb-item.mb-ico${cls}`, { type: 'button', 'aria-label': label, title: label, html, onclick });
  const media = status('.mb-media', 'Läuft gerade', icon('music'));
  media.hidden = true;
  const battery = h('span.mb-batt', { hidden: true });
  const net = status('.mb-net', 'Netzwerk', icon('wifi'));
  const fable = status('.mb-fable', 'Fable fragen', icon('sparkles'), () => sys.assistant?.toggle());
  const searchBtn = status('', 'Suche', icon('search'), () => sys.search());
  const ccBtn = status('', 'Kontrollzentrum', icon('sliders'));
  const clock = h('button.mb-item.mb-clock', { type: 'button', 'aria-label': 'Mitteilungen ein- oder ausblenden' });
  right.replaceChildren(media, battery, net, fable, searchBtn, ccBtn, clock);

  const tick = () => {
    const d = new Date();
    clock.replaceChildren(...[
      h('span.mb-date', d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })),
      h('span', d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })),
      notes.unread ? h('i.mb-dot', { 'aria-label': `${notes.unread} neue Mitteilungen` }) : null,
    ].filter(Boolean));
  };
  tick();
  setInterval(tick, 5000);
  bus.on('notes', tick);
  clock.addEventListener('click', () => sys.center?.toggle());

  navigator.getBattery?.().then((b) => {
    const paint = () => {
      battery.hidden = false;
      battery.innerHTML = `${icon('battery')}<i style="--l:${b.level}"></i><span>${Math.round(b.level * 100)} %</span>`;
      battery.classList.toggle('is-charging', b.charging);
    };
    paint();
    b.addEventListener('levelchange', paint);
    b.addEventListener('chargingchange', paint);
    sys.battery = b;
  }).catch(() => {});

  // Netzwerk: echter Zustand des Geräts
  const paintNet = () => net.classList.toggle('is-off', !navigator.onLine);
  paintNet();
  addEventListener('online', paintNet);
  addEventListener('offline', paintNet);
  net.addEventListener('click', () => {
    if (menuAnchor() === net) { closeMenu(); return; }
    const c = navigator.connection;
    net.classList.add('is-open');
    openMenu([
      { heading: 'Netzwerk' },
      { label: navigator.onLine ? 'Verbunden' : 'Offline', checked: navigator.onLine, disabled: true },
      c?.effectiveType && { label: `Verbindung: ${c.effectiveType.toUpperCase()}${c.downlink ? ` · ${String(c.downlink).replace('.', ',')} Mbit/s` : ''}`, disabled: true },
      { label: sys.pwa?.state.offlineReady ? 'Offline nutzbar: ja' : 'Offline nutzbar: wird vorbereitet', disabled: true },
      '-',
      { label: 'Netzwerk-Einstellungen …', icon: 'gear', run: () => sys.open('settings', { tab: 'general' }) },
    ].filter(Boolean), { anchor: net, align: 'right', onClose: () => net.classList.remove('is-open') });
  });

  // Läuft gerade
  const paintMedia = () => {
    const m = sys.nowPlaying;
    media.hidden = !m;
    media.classList.toggle('is-playing', !!m?.playing);
  };
  bus.on('media', paintMedia);
  media.addEventListener('click', () => {
    const m = sys.nowPlaying;
    if (!m) return;
    if (menuAnchor() === media) { closeMenu(); return; }
    openMenu([
      { heading: m.artist ? `${m.title} – ${m.artist}` : m.title },
      { label: m.playing ? 'Pause' : 'Wiedergabe', icon: m.playing ? 'pause' : 'play', run: () => m.toggle?.() },
      m.next && { label: 'Nächster Titel', icon: 'chevronRight', run: () => m.next() },
      m.prev && { label: 'Vorheriger Titel', icon: 'chevronLeft', run: () => m.prev() },
      '-',
      apps.has(m.app) && { label: `${apps.get(m.app).name} öffnen`, run: () => sys.open(m.app) },
    ].filter(Boolean), { anchor: media, align: 'right' });
  });

  initControlCenter(ccBtn, power);
  return { forceQuit, askPower };
}
