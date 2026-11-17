// control.js — Kontrollzentrum: Schnellschalter, Helligkeit, Lautstärke, „Läuft gerade“

import { $, h } from '../../core/util.js';
import { icon } from '../../core/icons.js';
import { initControls } from '../../core/controls.js';
import { sfx } from '../../core/audio.js';
import { bus } from '../bus.js';
import { sys, settings, set, apps, appIcon, activeTheme } from '../sys.js';

// ---------- Bildschirm wach halten (Wake-Lock-API, wo vorhanden) ----------
let wakeLock = null;
let wakeWanted = false;
async function setWake(on) {
  wakeWanted = on;
  try {
    if (on && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; bus.emit('wake'); });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeWanted = false; wakeLock = null; }
  bus.emit('wake');
}
document.addEventListener('visibilitychange', () => { if (wakeWanted && !wakeLock && !document.hidden) setWake(true); });

sys.toggleFullscreen = () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => sys.notify({ title: 'Vollbild', body: 'Der Browser hat den Vollbildmodus abgelehnt.', icon: 'close' }));
};

export function initControlCenter(btn, power) {
  const cc = $('#cc');
  const tiles = [
    {
      icon: 'moon', label: 'Dunkel', on: () => activeTheme() === 'dark', sub: () => (settings.autoTheme ? 'Automatisch' : null),
      toggle: () => { if (settings.autoTheme) set('autoTheme', false); set('theme', activeTheme() === 'dark' ? 'light' : 'dark'); },
    },
    { icon: 'focus', label: 'Nicht stören', on: () => settings.dnd, toggle: () => set('dnd', !settings.dnd) },
    { icon: 'sun', label: 'Nachtlicht', on: () => settings.nightShift, toggle: () => set('nightShift', !settings.nightShift) },
    { icon: 'volume', label: 'Töne', on: () => settings.sounds, toggle: () => { set('sounds', !settings.sounds); sfx.pop(); } },
    { icon: 'wave', label: 'Bewegung', on: () => settings.animate, toggle: () => set('animate', !settings.animate) },
    document.documentElement.requestFullscreen && { icon: 'external', label: 'Vollbild', on: () => !!document.fullscreenElement, toggle: () => sys.toggleFullscreen() },
    navigator.wakeLock && { icon: 'bolt', label: 'Wachhalten', on: () => !!wakeLock, toggle: () => setWake(!wakeLock) },
    { icon: 'layers', label: 'Schreibtisch', on: () => document.body.classList.contains('show-desktop'), toggle: () => { hide(); sys.showDesktop(); } },
  ].filter(Boolean);
  const grid = h('div.cc-grid');
  const paint = () => {
    grid.replaceChildren(...tiles.map((t) => h('button.cc-tile', {
      type: 'button', 'aria-pressed': String(!!t.on()),
      onclick: () => { t.toggle(); sfx.tick(); setTimeout(paint, 60); },
    }, h('span.cc-ico', { html: icon(t.icon) }), h('span', h('b', t.label), h('small', t.sub?.() || (t.on() ? 'An' : 'Aus'))))));
  };

  // Läuft gerade
  const media = h('div.cc-media', { hidden: true });
  const paintMedia = () => {
    const m = sys.nowPlaying;
    media.hidden = !m;
    if (!m) return;
    const app = apps.get(m.app);
    const ctl = (name, label, fn) => h('button.tool', { type: 'button', 'aria-label': label, title: label, html: icon(name), disabled: !fn, onclick: () => fn?.() });
    media.replaceChildren(
      app ? appIcon(app, 'sm') : h('span.note-ico', { html: icon('music') }),
      h('button.cc-media-txt', { type: 'button', onclick: () => { hide(); if (app) sys.open(m.app); } }, h('b', m.title || 'Wiedergabe'), h('small', m.artist || app?.name || '')),
      ctl('chevronLeft', 'Vorheriger Titel', m.prev),
      ctl(m.playing ? 'pause' : 'play', m.playing ? 'Pause' : 'Wiedergabe', m.toggle),
      ctl('chevronRight', 'Nächster Titel', m.next));
  };

  const bright = h('div.gslider', { dataset: { min: 0.35, max: 1, step: 0.01, value: settings.brightness }, 'aria-label': 'Helligkeit' });
  const vol = h('div.gslider', { dataset: { min: 0, max: 1, step: 0.01, value: settings.volume }, 'aria-label': 'Lautstärke' });
  cc.replaceChildren(
    grid,
    media,
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
  paintMedia();
  bus.on('setting', () => { paint(); bright.value = settings.brightness; vol.value = settings.volume; });
  bus.on('wake', paint);
  bus.on('media', paintMedia);
  document.addEventListener('fullscreenchange', paint);

  function hide() { cc.hidden = true; btn.classList.remove('is-open'); }
  btn.addEventListener('click', () => {
    cc.hidden = !cc.hidden;
    btn.classList.toggle('is-open', !cc.hidden);
    if (!cc.hidden) { paint(); paintMedia(); }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!cc.hidden && !cc.contains(e.target) && !btn.contains(e.target)) hide();
  }, true);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  sys.controlCenter = { hide };
}
