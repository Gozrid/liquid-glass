// spotlight.js — Suche: Apps, Dateien (Name und Inhalt), Einstellungen, Store, Befehle, Rechnen, Umrechnen, Zwischenablage

import { $, $$, h } from '../../core/util.js';
import { icon } from '../../core/icons.js';
import { sfx } from '../../core/audio.js';
import { evaluate, formatNumber, looksLikeMath } from '../../core/calc.js';
import { sys, settings, set, apps, appIcon, kindOf, WALLPAPERS } from '../sys.js';
import { registry } from '../registry.js';
import { vfs, HOME, pretty, basename } from '../vfs.js';
import { fileIcon } from '../ui.js';
import { PANES } from '../apps/settings.js';

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

// ---------- Umrechnen: „5 km in mi“, „72 f in c“ ----------
const UNITS = {
  mm: ['len', 0.001], cm: ['len', 0.01], m: ['len', 1], km: ['len', 1000], in: ['len', 0.0254], zoll: ['len', 0.0254], ft: ['len', 0.3048], yd: ['len', 0.9144], mi: ['len', 1609.344], meilen: ['len', 1609.344],
  mg: ['mass', 1e-6], g: ['mass', 0.001], kg: ['mass', 1], t: ['mass', 1000], oz: ['mass', 0.028349523], lb: ['mass', 0.45359237],
  s: ['time', 1], min: ['time', 60], h: ['time', 3600], std: ['time', 3600], d: ['time', 86400], tage: ['time', 86400], wochen: ['time', 604800],
  b: ['data', 1], kb: ['data', 1e3], mb: ['data', 1e6], gb: ['data', 1e9], tb: ['data', 1e12],
  ml: ['vol', 0.001], cl: ['vol', 0.01], l: ['vol', 1], gal: ['vol', 3.785411784],
  'km/h': ['spd', 1 / 3.6], kmh: ['spd', 1 / 3.6], mph: ['spd', 0.44704], 'm/s': ['spd', 1], kn: ['spd', 0.514444],
};
const TEMP = { c: [1, 0], '°c': [1, 0], f: [5 / 9, -32 * 5 / 9], '°f': [5 / 9, -32 * 5 / 9], k: [1, -273.15] };
function convert(text) {
  const m = /^\s*(-?[\d.,]+)\s*(°?[a-zµ/]+)\s+(?:in|nach|to|zu|als)\s+(°?[a-z/]+)\s*$/i.exec(text);
  if (!m) return null;
  const v = parseFloat(m[1].replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  const a = m[2].toLowerCase(), b = m[3].toLowerCase();
  if (Number.isNaN(v)) return null;
  if (TEMP[a] && TEMP[b]) {
    const c = v * TEMP[a][0] + TEMP[a][1];
    return `${formatNumber((c - TEMP[b][1]) / TEMP[b][0])} ${b.replace('°', '').toUpperCase() === 'K' ? 'K' : `°${b.replace('°', '').toUpperCase()}`}`;
  }
  const ua = UNITS[a], ub = UNITS[b];
  if (!ua || !ub || ua[0] !== ub[0]) return null;
  return `${formatNumber((v * ua[1]) / ub[1])} ${m[3]}`;
}

// ---------- Zwischenablage-Verlauf (nur was in fableOS kopiert wurde) ----------
const clips = [];
for (const evt of ['copy', 'cut']) {
  document.addEventListener(evt, () => {
    const el = document.activeElement;
    const t = (el?.matches?.('input, textarea') && el.selectionStart != null ? el.value.slice(el.selectionStart, el.selectionEnd) : String(getSelection() || '')).trim();
    if (!t || t.length > 2000) return;
    const i = clips.indexOf(t);
    if (i >= 0) clips.splice(i, 1);
    clips.unshift(t);
    clips.length = Math.min(clips.length, 12);
  });
}

export function initSpotlight(power) {
  const wrap = $('#launcher');
  const input = $('#launcher-input');
  const list = $('#launcher-list');
  const commands = [
    { label: 'Dunkles Design', icon: 'moon', run: () => { set('autoTheme', false); set('theme', 'dark'); } },
    { label: 'Helles Design', icon: 'sun', run: () => { set('autoTheme', false); set('theme', 'light'); } },
    { label: 'Übersicht aller Fenster', icon: 'grid', kw: 'mission control exposé', run: () => sys.wm.toggleOverview(true) },
    { label: 'Alle Apps zeigen', icon: 'layers', kw: 'launchpad programme', run: () => sys.launchpad?.open() },
    { label: 'Mitteilungen zeigen', icon: 'bell', run: () => sys.center?.open() },
    { label: 'Hintergrund wechseln', icon: 'image', kw: 'wallpaper', run: () => { const k = Object.keys(WALLPAPERS); set('wallImage', ''); set('wallpaper', k[(k.indexOf(settings.wallpaper) + 1) % k.length]); } },
    { label: 'Nicht stören umschalten', icon: 'focus', kw: 'fokus dnd', run: () => set('dnd', !settings.dnd) },
    { label: 'Nachtlicht umschalten', icon: 'sun', kw: 'night shift warm', run: () => set('nightShift', !settings.nightShift) },
    { label: 'Vollbild umschalten', icon: 'layers', run: () => sys.toggleFullscreen() },
    { label: 'Neuer Schreibtisch', icon: 'plus', kw: 'space desktop', run: () => { sys.wm.addSpace(); sys.wm.setSpace(sys.wm.spaceCount - 1); } },
    { label: 'Alle Fenster schließen', icon: 'close', run: () => sys.wm.closeAll() },
    { label: 'Papierkorb leeren', icon: 'trash', run: () => sys.emptyTrash() },
    { label: 'Bildschirmschoner starten', icon: 'moon', kw: 'ruhezustand', run: () => sys.saver?.start() },
    { label: 'fableOS installieren', icon: 'download', kw: 'pwa app dock', run: () => sys.pwa?.install() },
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
  const copy = (text, title = 'Kopiert') => navigator.clipboard?.writeText(text).then(() => sys.notify({ title, body: text.slice(0, 80), icon: 'copy' })).catch(() => {});

  const fileRows = (q) => {
    const seen = new Set();
    const out = [];
    for (const p of vfs.find(q, HOME)) {
      if (out.length >= 6) break;
      seen.add(p);
      out.push({ label: basename(p), hint: pretty(p), visual: fileIcon(vfs.stat(p)), run: () => sys.openPath(p), path: p });
    }
    if (q.length >= 3 && out.length < 6) {
      // Volltext: nur Textdateien, deren Name nicht schon getroffen hat
      for (const p of vfs.find('', HOME).slice(0, 600)) {
        if (out.length >= 6) break;
        if (seen.has(p)) continue;
        const st = vfs.stat(p);
        if (!st || st.type !== 'file' || st.size > 200000 || !['text', 'code'].includes(kindOf(p, st.mime))) continue;
        const text = vfs.read(p);
        const at = norm(text).indexOf(q);
        if (at < 0) continue;
        const snip = text.slice(Math.max(0, at - 18), at + 46).replace(/\s+/g, ' ').trim();
        out.push({ label: basename(p), hint: `… ${snip} …`, visual: fileIcon(st), run: () => sys.openPath(p), path: p });
      }
    }
    return out;
  };

  const render = () => {
    const raw = input.value.trim();
    const q = norm(raw);
    rows = [];
    const out = [];
    const group = (title, entries) => {
      if (!entries.length) return;
      out.push(h('li.launcher-head', title));
      for (const e of entries) {
        const i = rows.length;
        rows.push(e);
        const li = h('li', { role: 'option' }, e.visual, h('span.l-label', e.label), e.hint ? h('small', e.hint) : null);
        li.addEventListener('pointermove', () => { if (sel !== i) { sel = i; paintSel(); } });
        li.addEventListener('click', () => run(i));
        out.push(li);
      }
    };
    const ico = (name) => h('span.l-ico', { html: icon(name) });

    if (looksLikeMath(input.value)) {
      try {
        const v = formatNumber(evaluate(input.value));
        group('Rechner', [{ label: `= ${v}`, hint: 'Eingabetaste kopiert', visual: ico('calc'), run: () => copy(v, 'Ergebnis kopiert') }]);
      } catch { /* unvollständige Eingabe – einfach keine Zeile */ }
    }
    const conv = convert(input.value);
    if (conv) group('Umrechnung', [{ label: `= ${conv}`, hint: 'Eingabetaste kopiert', visual: ico('reload'), run: () => copy(conv, 'Ergebnis kopiert') }]);

    const appRows = [...apps.values()].filter((a) => !q || norm(a.name).includes(q) || norm(a.keywords || '').includes(q))
      .sort((a, b) => (q ? Number(norm(b.name).startsWith(q)) - Number(norm(a.name).startsWith(q)) : 0))
      .map((a) => ({ label: a.name, hint: a.webApp ? 'Web-App' : 'App', visual: appIcon(a, 'sm'), run: () => sys.open(a.id) }));
    group('Apps', q ? appRows.slice(0, 7) : appRows.filter((r) => r.label !== 'Apps').slice(0, 6));
    if (q) {
      group('Einstellungen', PANES.filter(([, name, , kw]) => norm(name).includes(q) || norm(kw).includes(q)).slice(0, 3)
        .map(([tab, name, ic]) => ({ label: name, hint: 'Systemeinstellungen', visual: ico(ic), run: () => sys.open('settings', { tab }) })));
      group('Dateien', fileRows(q));
      group('App Store', registry.catalog.filter((e) => !registry.isInstalled(e.id) && (norm(e.name).includes(q) || norm(e.keywords || '').includes(q) || norm(e.category || '').includes(q))).slice(0, 4)
        .map((e) => ({ label: e.name, hint: 'Laden', visual: appIcon(e, 'sm'), run: () => sys.open('store', { app: e.id }) })));
    }
    group('Befehle', commands.filter((c) => !q || norm(c.label).includes(q) || norm(c.kw || '').includes(q)).slice(0, q ? 6 : 4)
      .map((c) => ({ label: c.label, hint: 'Befehl', visual: ico(c.icon), run: c.run })));
    if (clips.length && (!q || 'zwischenablage'.includes(q) || 'clipboard'.includes(q))) {
      group('Zwischenablage', clips.slice(0, q ? 8 : 3).map((t) => ({ label: t.replace(/\s+/g, ' ').slice(0, 60), hint: 'Erneut kopieren', visual: ico('copy'), run: () => copy(t) })));
    }
    if (q) {
      group('Mehr', [
        { label: `Fable fragen: „${raw}“`, hint: 'Assistent', visual: ico('sparkles'), run: () => sys.assistant?.ask(raw) },
        { label: `Im Web suchen: „${raw}“`, hint: 'öffnet einen neuen Tab', visual: ico('compass'), run: () => window.open(`https://duckduckgo.com/?q=${encodeURIComponent(raw)}`, '_blank', 'noopener') },
      ]);
    }
    if (!rows.length) out.push(h('li.launcher-empty', `Nichts gefunden für „${raw}“`));
    sel = 0;
    list.replaceChildren(...out);
    paintSel();
  };
  const open = (text = '') => {
    if (!wrap.hidden) return;
    sys.launchpad?.close();
    wrap.hidden = false;
    input.value = text;
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
    else if (e.key === ' ' && e.altKey) { e.preventDefault(); close(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); close(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y' && rows[sel]?.path) { e.preventDefault(); const p = rows[sel].path; close(); sys.quicklook?.([p]); }
  });
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
  sys.search = (text) => (wrap.hidden ? open(typeof text === 'string' ? text : '') : close());
  return { open, close, get isOpen() { return !wrap.hidden; } };
}
