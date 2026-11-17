// launchpad.js — „Apps“: alle Programme als Raster über dem Schreibtisch, mit Suche, Seiten und Entfernen-Modus

import { $, h, clamp } from '../../core/util.js';
import { icon } from '../../core/icons.js';
import { sfx } from '../../core/audio.js';
import { bus } from '../bus.js';
import { sys, apps, appIcon } from '../sys.js';
import { registry } from '../registry.js';
import { openMenu, confirmDialog } from '../ui.js';

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const GLYPH = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor" stroke="none">${[5, 12, 19].flatMap((y) => [5, 12, 19].map((x) => `<rect x="${x - 2.2}" y="${y - 2.2}" width="4.4" height="4.4" rx="1.3"/>`)).join('')}</g></svg>`;

/** Fragt nach und entfernt eine Store- oder Web-App. */
export async function removeApp(id) {
  const app = apps.get(id);
  if (!app || !registry.isRemovable(id)) return false;
  const yes = await confirmDialog({
    app, title: `„${app.name}“ entfernen?`, ok: 'Entfernen', danger: true,
    text: app.webApp
      ? 'Die Web-App verschwindet aus fableOS. Die Website selbst bleibt natürlich bestehen.'
      : 'Die App und ihre gespeicherten Daten werden von diesem Gerät gelöscht. Du kannst sie jederzeit wieder aus dem App Store laden.',
  });
  if (!yes) return false;
  registry.uninstall(id);
  sfx.drop();
  return true;
}

export function initLaunchpad() {
  const input = h('input.kit-field', { type: 'text', placeholder: 'Suchen', autocomplete: 'off', spellcheck: false, 'aria-label': 'Apps durchsuchen' });
  const pages = h('div.lp-pages');
  const dots = h('div.lp-dots');
  const el = h('div#launchpad', { hidden: true, role: 'dialog', 'aria-label': 'Apps' },
    h('div.lp-search.kit-search', { html: icon('search') }, input), pages, dots);
  $('#desktop').append(el);
  let open = false;
  let edit = false;
  let hideTimer = 0;

  const setEdit = (on) => { edit = on; el.classList.toggle('is-edit', on); };
  const close = () => {
    if (!open) return;
    open = false;
    setEdit(false);
    el.classList.remove('on');
    document.body.classList.remove('lp-open');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { el.hidden = true; }, 280);
  };
  const run = (app) => { close(); setTimeout(() => sys.open(app.id), 60); };

  const item = (app) => {
    const removable = registry.isRemovable(app.id);
    const b = h('button.lp-item', { type: 'button', dataset: { app: app.id }, class: removable ? 'is-removable' : '' },
      appIcon(app, 'lp'), h('span.lp-name', app.name),
      removable ? h('span.lp-x', { role: 'button', 'aria-label': `${app.name} entfernen`, html: icon('close') }) : null);
    let press = 0;
    let held = false;      // der Klick, der einen langen Druck beendet, zählt nicht
    b.addEventListener('pointerdown', () => { held = false; press = setTimeout(() => { held = true; setEdit(true); sfx.tick(); }, 560); });
    for (const evt of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(evt, () => clearTimeout(press));
    b.addEventListener('click', (e) => {
      if (held) { held = false; return; }
      if (e.target.closest('.lp-x')) { removeApp(app.id); return; }
      if (edit) { setEdit(false); return; }
      run(app);
    });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pinned = registry.isPinned(app.id);
      openMenu([
        { heading: app.name },
        { label: 'Öffnen', run: () => run(app) },
        { label: pinned ? 'Aus dem Dock entfernen' : 'Im Dock behalten', run: () => (pinned ? registry.unpin(app.id) : registry.pin(app.id)) },
        registry.isInstalled(app.id) && { label: 'Im App Store zeigen', run: () => { close(); sys.open('store', { app: app.id }); } },
        removable && '-',
        removable && { label: 'Entfernen …', icon: 'trash', danger: true, run: () => removeApp(app.id) },
      ].filter(Boolean), { x: e.clientX, y: e.clientY });
    });
    return b;
  };

  const paintDots = () => {
    const i = Math.round(pages.scrollLeft / Math.max(1, pages.clientWidth));
    [...dots.children].forEach((d, j) => d.classList.toggle('is-on', i === j));
  };
  const render = () => {
    const q = norm(input.value.trim());
    const sysApps = [...apps.values()].filter((a) => !a.hidden && !registry.isRemovable(a.id));
    const extra = [...apps.values()].filter((a) => !a.hidden && registry.isRemovable(a.id)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    const all = [...sysApps, ...extra].filter((a) => !q || norm(a.name).includes(q) || norm(a.keywords || '').includes(q));
    const cols = clamp(Math.floor((innerWidth - 100) / 148), 3, 7);
    const rows = clamp(Math.floor((innerHeight - 280) / 138), 2, 5);
    const per = cols * rows;
    pages.style.setProperty('--cols', cols);
    const chunks = [];
    for (let i = 0; i < all.length; i += per) chunks.push(all.slice(i, i + per));
    pages.replaceChildren(...(chunks.length ? chunks.map((c) => h('div.lp-page', c.map(item))) : [h('div.lp-page.is-empty', h('p', `Keine App für „${input.value.trim()}“ – vielleicht gibt es sie im App Store.`),
      h('button.kit-btn.round', { type: 'button', onclick: () => { const v = input.value.trim(); close(); sys.open('store', { q: v }); } }, 'Im App Store suchen'))]));
    dots.replaceChildren(...(chunks.length > 1 ? chunks.map((_, i) => h('button', { type: 'button', 'aria-label': `Seite ${i + 1}`, onclick: () => pages.scrollTo({ left: i * pages.clientWidth, behavior: 'smooth' }) })) : []));
    paintDots();
  };

  const show = () => {
    if (open) return;
    open = true;
    clearTimeout(hideTimer);
    sys.wm.toggleOverview(false);
    sys.center?.close();
    el.hidden = false;
    input.value = '';
    render();
    pages.scrollLeft = 0;
    document.body.classList.add('lp-open');
    requestAnimationFrame(() => { el.classList.add('on'); input.focus({ preventScroll: true }); });
    sfx.tick();
  };

  input.addEventListener('input', render);
  pages.addEventListener('scroll', paintDots, { passive: true });
  pages.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    pages.scrollLeft += e.deltaY;
  }, { passive: false });
  el.addEventListener('click', (e) => {
    if (e.target.closest('.lp-item, .lp-search, .lp-dots, .kit-btn')) return;
    if (edit) setEdit(false); else close();
  });
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { if (edit) setEdit(false); else if (input.value) { input.value = ''; render(); } else close(); return; }
    const list = [...pages.querySelectorAll('.lp-item')];
    if (e.key === 'Enter') { const t = list.includes(document.activeElement) ? document.activeElement : list[0]; t?.click(); return; }
    const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: Number(getComputedStyle(pages).getPropertyValue('--cols')) || 5, ArrowUp: -(Number(getComputedStyle(pages).getPropertyValue('--cols')) || 5) }[e.key];
    if (!d || (document.activeElement === input && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && input.value)) return;
    e.preventDefault();
    const i = list.indexOf(document.activeElement);
    const next = list[clamp(i < 0 ? 0 : i + d, 0, list.length - 1)];
    next?.focus();
    next?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  });
  bus.on('apps', () => { if (open) render(); });
  addEventListener('resize', () => { if (open) render(); });

  apps.set('launchpad', {
    id: 'launchpad', name: 'Apps', glyph: GLYPH, colors: ['#9aa7ff', '#4b57d6'], keywords: 'launchpad programme alle apps übersicht',
    hidden: true, action: () => (open ? close() : show()),
  });
  sys.launchpad = { open: show, close, toggle: () => (open ? close() : show()), get isOpen() { return open; } };
  return sys.launchpad;
}
