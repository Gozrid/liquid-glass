// reminders.js — Erinnerungen: Aufgabenlisten mit Fälligkeit, Priorität, Markierung und Mitteilungen
import { h, debounce, reducedMotion } from '../../../core/util.js';
import { icon } from '../../../core/icons.js';
import { initControls } from '../../../core/controls.js';
import { sys } from '../../sys.js';
import { openMenu } from '../../ui.js';
import { style, appStore, toolBtn, emptyState, sheet, confirmSheet, promptSheet, toast, pad2 } from '../../kit.js';

const S = appStore('reminders');
const EVT = 'fableos:reminders';
const COLORS = [['Bernstein', '#f5a524'], ['Koralle', '#ff5d6c'], ['Azur', '#2f8cff'], ['Minze', '#22c58b'], ['Violett', '#8b5cff'], ['Rose', '#ff3d81'], ['Türkis', '#14b8c4'], ['Graphit', '#7d86a3']];
const PRIO = ['Keine', 'Niedrig', 'Mittel', 'Hoch'];
const svg = (body) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const I = {
  cal: svg('<rect x="4" y="5" width="16" height="15" rx="3.500"/><path d="M4 10h16M8.500 3v3.500M15.500 3v3.500"/>'),
  eye: svg('<path d="M2.500 12s3.500-6.500 9.500-6.500 9.500 6.500 9.500 6.500-3.500 6.500-9.500 6.500S2.500 12 2.500 12z"/><circle cx="12" cy="12" r="2.800"/>'),
  flag: svg('<path d="M6 21V4.500"/><path d="M6 5h11.500l-2.500 3.800 2.500 3.700H6z" fill="currentColor"/>'),
};
/** Die vier intelligenten Listen */
const SMART = [
  { id: 'today', name: 'Heute', color: 'var(--c-cyan)', empty: ['Heute steht nichts an', 'Alles, was heute fällig oder überfällig ist, erscheint hier.'] },
  { id: 'scheduled', name: 'Geplant', color: 'var(--c-coral)', ico: I.cal, empty: ['Nichts geplant', 'Erinnerungen mit Datum sammeln sich hier, nach Tagen sortiert.'] },
  { id: 'all', name: 'Alle', color: 'var(--c-violet)', ico: icon('layers'), empty: ['Keine Erinnerungen', 'Tippe unten, um die erste anzulegen.'] },
  { id: 'done', name: 'Erledigt', color: 'var(--c-mint)', ico: icon('check'), empty: ['Noch nichts erledigt', 'Abgehakte Erinnerungen wandern hierher.'] },
];

// ---------- Datum ----------
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fromYmd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const dayKey = (off = 0) => { const n = new Date(); return ymd(new Date(n.getFullYear(), n.getMonth(), n.getDate() + off)); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
/** Fälligkeit als Zeitstempel (ohne Uhrzeit: Ende des Tages) */
function dueTs(t) {
  if (!t.due) return null;
  const d = fromYmd(t.due);
  if (t.time) { const [hh, mm] = t.time.split(':').map(Number); d.setHours(hh, mm, 0, 0); } else d.setHours(23, 59, 59, 0);
  return d.getTime();
}
const isOver = (t) => !t.done && !!t.due && dueTs(t) < Date.now();
function dayName(key) {
  const diff = Math.round((fromYmd(key) - fromYmd(dayKey())) / 864e5);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  if (diff === -1) return 'Gestern';
  const d = fromYmd(key);
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}
const dueLabel = (t) => (t.due ? `${dayName(t.due)}${t.time ? `, ${t.time}` : ''}` : '');

// ---------- Daten (ein Stand für Fenster, Widget und Hintergrunddienst) ----------
let db = null;
function data() {
  if (db) return db;
  db = { lists: S.get('lists', null), tasks: S.get('tasks', null) };
  if (!Array.isArray(db.lists) || !db.lists.length) {
    db.lists = [
      { id: 'main', name: 'Erinnerungen', color: COLORS[0][1] },
      { id: 'einkauf', name: 'Einkauf', color: COLORS[3][1] },
      { id: 'arbeit', name: 'Arbeit', color: COLORS[2][1] },
    ];
    S.set('lists', db.lists);
  }
  if (!Array.isArray(db.tasks)) {
    let n = Date.now() - 1000;
    const t = (list, title, more = {}) => ({ id: uid(), list, title, note: '', done: false, doneAt: 0, due: null, time: null, prio: 0, flag: false, created: n++, told: '', ...more });
    db.tasks = [
      t('main', 'Pflanzen gießen', { due: dayKey(0) }),
      t('main', 'Paket zur Post bringen', { due: dayKey(-1), prio: 2 }),
      t('main', 'Geschenk für Oma besorgen', { due: dayKey(2), flag: true, note: 'Sie mag Krimis und dunkle Schokolade' }),
      t('main', 'Fahrrad aufpumpen'),
      t('einkauf', 'Haferflocken'),
      t('einkauf', 'Zitronen'),
      t('einkauf', 'Kaffeebohnen', { prio: 1 }),
      t('arbeit', 'Folien für Donnerstag fertig machen', { due: dayKey(1), time: '09:00', prio: 3 }),
      t('arbeit', 'Reisekosten einreichen', { due: dayKey(4) }),
    ];
    S.set('tasks', db.tasks);
  }
  return db;
}
/** Sichert und sagt allen Bescheid; `from` erlaubt dem Absender, sein eigenes Ereignis zu überhören */
function save(what = 'tasks', from = null) {
  S.set(what, db[what]);
  dispatchEvent(new CustomEvent(EVT, { detail: { from } }));
}
const listOf = (t) => data().lists.find((l) => l.id === t.list) || data().lists[0];
const openToday = () => data().tasks.filter((t) => !t.done && t.due && t.due <= dayKey())
  .sort((a, b) => dueTs(a) - dueTs(b) || b.prio - a.prio || a.created - b.created);
function setDone(t, done) {
  t.done = done;
  t.doneAt = done ? Date.now() : 0;
}

// ---------- Hintergrunddienst: fällige Erinnerungen mit Uhrzeit melden ----------
function checkDue() {
  const d = data();
  const now = Date.now();
  let dirty = false;
  for (const t of d.tasks) {
    if (t.done || !t.due || !t.time) continue;
    const ts = dueTs(t);
    const key = `${t.due}T${t.time}`;
    if (ts > now || t.told === key) continue;
    t.told = key;
    dirty = true;
    if (now - ts > 12 * 3600e3) continue;        // lange her – nicht nachträglich melden
    const id = t.id;
    sys.notify({
      title: t.title || 'Erinnerung', body: `Jetzt fällig · ${listOf(t).name}`, app: 'reminders', ttl: 9000,
      onClick: () => sys.open('reminders', { task: id }),
    });
  }
  if (dirty) S.set('tasks', d.tasks);
}
let service = 0;
function startService() {
  if (service) return;
  service = setInterval(checkDue, 20000);
  addEventListener(EVT, debounce(checkDue, 800));
  setTimeout(checkDue, 1500);
}

style('reminders', `
.reminders-win .kit-sheet-wrap { grid-template-rows: minmax(0, 1fr); align-items: start; }
.reminders .kit-split { --side: 216px; }
.reminders-side { gap: 0; padding: 12px 10px; }
.reminders-tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
.reminders-tile { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 4px 6px; min-width: 0; padding: 9px 10px 8px; border: 0; border-radius: 13px; background: var(--raise); text-align: left; transition: transform .4s var(--spring), background-color .2s; }
.reminders-tile:hover { background: var(--raise-2); }
.reminders-tile:active { transform: scale(.96); }
.reminders-tile.is-on { background: var(--c); color: #fff; }
.reminders-ico { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--c); color: #fff; font-size: 12.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
.reminders-ico .ico { width: 15px; height: 15px; stroke-width: 2.1; }
.reminders-tile.is-on .reminders-ico { background: #fff; color: var(--c); }
.reminders-tile b { justify-self: end; font-family: var(--font-round); font-size: 20px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
.reminders-tile > span:last-child { grid-column: 1 / -1; font-size: 12.5px; font-weight: 650; color: var(--fg-2); }
.reminders-tile.is-on > span:last-child { color: #fff; }
.reminders-side > button .kit-dot { width: 11px; height: 11px; }
.reminders-side > .reminders-newlist { margin-top: 6px; font-size: 12.5px; font-weight: 600; color: var(--fg-3); }
.reminders-side > .reminders-newlist:hover { color: var(--fg); }
.reminders-side > .reminders-newlist .ico { width: 14px; height: 14px; }

.reminders-head { display: flex; align-items: flex-end; gap: 10px; flex: none; padding: 14px 20px 8px; }
.reminders-name { display: flex; align-items: center; gap: 4px; min-width: 0; padding: 0; border: 0; background: none; font-size: 26px; font-weight: 750; letter-spacing: -.03em; line-height: 1.15; color: var(--c); cursor: default; }
.reminders-name span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reminders-name .ico { display: none; width: 18px; height: 18px; stroke-width: 2.4; }
.reminders-total { margin-left: auto; font-family: var(--font-round); font-size: 26px; font-weight: 700; line-height: 1.15; color: var(--c); font-variant-numeric: tabular-nums; }
[data-theme="light"] .reminders-name, [data-theme="light"] .reminders-total, [data-theme="light"] .reminders-group.is-list { color: color-mix(in srgb, var(--c) 80%, var(--fg)); }
.reminders-body { display: flex; flex-direction: column; flex: 1; min-height: 0; padding: 0 12px 12px 8px; }
.reminders-group { flex: none; margin: 12px 0 2px 12px; padding-bottom: 4px; border-bottom: .5px solid var(--line); font-size: 13px; font-weight: 700; color: var(--fg-2); }
.reminders-group.is-over { color: var(--c-coral); }
.reminders-group.is-list { color: var(--c); }

.reminders-task { display: flex; align-items: flex-start; gap: 10px; flex: none; min-width: 0; padding: 6px 4px 6px 12px; border-radius: 10px; overflow: hidden; }
.reminders-task:hover, .reminders-task:focus-within { background: var(--raise); }
.reminders-body.is-fresh .reminders-task { animation: reminders-in .34s var(--ease-out) both; animation-delay: calc(min(var(--i), 14) * 16ms); }
@keyframes reminders-in { from { opacity: 0; transform: translateY(6px); } }
.reminders-task.is-flash { animation: reminders-flash 1.4s var(--ease-out); }
@keyframes reminders-flash { 0%, 35% { background: color-mix(in srgb, var(--accent) 34%, transparent); } }
.reminders-check { position: relative; margin-top: 1px; }
.reminders-check .ico { stroke-dasharray: 22; stroke-dashoffset: 22; transition: stroke-dashoffset .26s var(--ease-out) .08s; }
.reminders-check[aria-checked="true"] .ico { stroke-dashoffset: 0; }
.reminders-check[aria-checked="true"].is-pop { animation: reminders-pop .5s var(--spring-soft); }
.reminders-check.is-pop::after { content: ""; position: absolute; inset: 0; border-radius: 50%; box-shadow: 0 0 0 2px var(--c, var(--accent)); animation: reminders-ring .55s var(--ease-out) forwards; pointer-events: none; }
@keyframes reminders-pop { 0% { transform: scale(.7); } }
@keyframes reminders-ring { from { opacity: .7; transform: scale(1); } to { opacity: 0; transform: scale(2); } }
.reminders-main { display: grid; gap: 1px; flex: 1; min-width: 0; }
.reminders-line { display: flex; align-items: center; gap: 5px; min-width: 0; }
.reminders-prio { flex: none; font-weight: 800; font-size: 13.5px; color: var(--c, var(--accent)); letter-spacing: .02em; }
.reminders-title { flex: 1; min-width: 0; padding: 0; border: 0; outline: 0; background: none; font-size: 14px; line-height: 1.5; color: var(--fg); text-overflow: ellipsis; transition: color .3s; }
.reminders-title::placeholder { color: var(--fg-3); }
.reminders-task.is-done .reminders-title { color: var(--fg-3); text-decoration: line-through; text-decoration-color: var(--fg-4); }
.reminders-task.is-done .reminders-prio { opacity: .5; }
.reminders-flag { display: grid; flex: none; color: var(--c-amber); }
.reminders-flag .ico { width: 14px; height: 14px; }
.reminders-meta { display: flex; flex-wrap: wrap; gap: 0 8px; min-width: 0; font-size: 12px; line-height: 1.35; color: var(--fg-3); }
.reminders-note { flex: 1 1 100%; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reminders-due { font-variant-numeric: tabular-nums; }
.reminders-due.is-over { color: var(--c-coral); font-weight: 600; }
.reminders-meta:empty { display: none; }
.reminders-info { opacity: 0; width: 24px; height: 24px; margin-top: -1px; color: var(--accent); }
.reminders-task:hover .reminders-info, .reminders-task:focus-within .reminders-info { opacity: 1; }
.reminders-new { display: flex; align-items: center; gap: 10px; flex: none; margin-top: 2px; padding: 6px 4px 6px 12px; border-radius: 10px; }
.reminders-new i { display: grid; place-items: center; flex: none; width: 20px; height: 20px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--fg-4); color: var(--fg-3); }
.reminders-new i .ico { width: 12px; height: 12px; stroke-width: 2.4; }
.reminders-new:focus-within i { box-shadow: inset 0 0 0 1.6px var(--c, var(--accent)); color: var(--c, var(--accent)); }
.reminders-body .kit-empty { min-height: 120px; }

/* Details */
.reminders-form { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 9px 12px; align-items: center; min-height: 0; padding: 2px; }
.reminders-form > label { font-size: 12.5px; font-weight: 600; color: var(--fg-3); }
.reminders-form .reminders-wide { grid-column: 1 / -1; }
.reminders-form input.reminders-wide { font-size: 16px; font-weight: 650; padding: 8px 11px; }
.reminders-form .reminders-row { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
.reminders-form .reminders-row .kit-field { flex: 1 1 110px; }
.reminders-form .gswitch { --w: 42px; --h: 25px; }
.reminders-form .gseg { display: flex; }
.reminders-form .gseg button { padding: .32em .5em; font-size: 12.5px; }
.reminders-del { margin-right: auto; color: var(--c-coral); }

/* Widget */
.reminders-w { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.reminders-w-head { display: flex; align-items: baseline; justify-content: space-between; margin: -4px 0 6px; }
.reminders-w-head b { font-family: var(--font-round); font-size: 36px; font-weight: 700; line-height: 1.1; letter-spacing: -.03em; color: var(--accent); font-variant-numeric: tabular-nums; }
.reminders-w-head span { font-size: 12.5px; font-weight: 700; color: var(--fg-2); }
.reminders-w-list { display: grid; align-content: start; gap: 7px; flex: 1; min-height: 0; }
.reminders-w-row { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 12.5px; font-weight: 550; line-height: 1.3; }
.reminders-w-row span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: color .3s; }
.reminders-w-row.is-over span { color: var(--c-coral); }
.reminders-w-row.is-done span { color: var(--fg-3); text-decoration: line-through; }
.reminders-w-row .kit-check { width: 17px; height: 17px; }
.reminders-w-row .kit-check .ico { width: 10px; height: 10px; }
.reminders-w-more { font-size: 11px; font-weight: 600; color: var(--fg-3); }
.reminders-w-none { display: grid; justify-items: start; gap: 4px; font-size: 12.5px; color: var(--fg-3); }

@container win (max-width: 560px) {
  .reminders-name { cursor: pointer; }
  .reminders-name .ico { display: block; }
  .reminders-head { padding: 10px 14px 6px; }
  .reminders-name, .reminders-total { font-size: 22px; }
  .reminders-body { padding: 0 8px 10px 4px; }
  .reminders-info { opacity: 1; }
}
`);

export default {
  singleton: true,
  width: 760, height: 540, minW: 380, minH: 360,

  mount(win, args = {}) {
    const d = data();
    startService();
    const me = {};                                   // Kennung dieses Fensters für eigene Änderungen
    let sel = S.get('sel', 'today');
    let showDone = !!S.get('showDone', false);
    if (!SMART.some((s) => s.id === sel) && !d.lists.some((l) => l.id === sel)) sel = 'today';

    win.el.classList.add('reminders-win');
    const bDone = h('button.tool', { type: 'button', html: I.eye, onclick: () => { showDone = !showDone; S.set('showDone', showDone); paintMain(); } });
    win.tools.append(bDone, toolBtn('plus', 'Neue Erinnerung (N)', () => focusNew()));

    const side = h('aside.kit-side.reminders-side.scroll');
    const name = h('button.reminders-name', { type: 'button' });
    const total = h('span.reminders-total');
    const head = h('header.reminders-head', name, total);
    const body = h('div.reminders-body.scroll');
    win.body.append(h('div.kit-app.reminders', h('div.kit-split', side, h('div.kit-main', head, body))));

    const smart = () => SMART.find((s) => s.id === sel) || null;
    const curList = () => d.lists.find((l) => l.id === sel) || null;
    const counts = () => {
      const today = dayKey();
      const open = d.tasks.filter((t) => !t.done);
      return { today: open.filter((t) => t.due && t.due <= today).length, scheduled: open.filter((t) => t.due).length, all: open.length, done: d.tasks.length - open.length };
    };
    function select(id, flashId = null) {
      sel = id;
      S.set('sel', id);
      paintSide();
      paintMain(true);
      if (flashId) {
        const row = body.querySelector(`.reminders-task[data-id="${flashId}"]`);
        if (row) { row.scrollIntoView({ block: 'nearest' }); row.classList.add('is-flash'); }
      }
    }

    // ---------- Seitenleiste ----------
    function paintSide() {
      const c = counts();
      side.replaceChildren(
        h('div.reminders-tiles', SMART.map((s) => h('button.reminders-tile', { type: 'button', class: sel === s.id ? 'is-on' : '', style: { '--c': s.color }, onclick: () => select(s.id) },
          h('span.reminders-ico', s.ico ? { html: s.ico } : null, s.ico ? null : String(new Date().getDate())), h('b', String(c[s.id])), h('span', s.name)))),
        h('div.kit-head', 'Meine Listen'),
        ...d.lists.map((l) => {
          const b = h('button', { type: 'button', class: sel === l.id ? 'is-on' : '', onclick: () => select(l.id) },
            h('i.kit-dot', { style: { '--c': l.color } }), h('span', l.name), h('span.kit-count', String(d.tasks.filter((t) => t.list === l.id && !t.done).length)));
          b.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); openMenu(listMenu(l), { x: e.clientX, y: e.clientY }); });
          b.addEventListener('dblclick', () => renameList(l));
          return b;
        }),
        h('button.reminders-newlist', { type: 'button', html: icon('plus'), onclick: () => newList() }, h('span', 'Neue Liste')));
    }
    const listMenu = (l) => [
      { label: 'Umbenennen …', icon: 'note', run: () => renameList(l) },
      '-', { heading: 'Farbe' },
      ...COLORS.map(([n, col]) => ({ label: n, checked: l.color === col, run: () => { l.color = col; save('lists'); } })),
      '-',
      { label: 'Löschen …', icon: 'trash', disabled: d.lists.length < 2, run: () => removeList(l) },
    ];
    async function newList() {
      const n = await promptSheet(win, { title: 'Neue Liste', placeholder: 'Name', ok: 'Anlegen' });
      if (!n) return;
      const free = COLORS.find(([, col]) => !d.lists.some((l) => l.color === col)) || COLORS[d.lists.length % COLORS.length];
      const l = { id: uid(), name: n.slice(0, 40), color: free[1] };
      d.lists.push(l);
      sel = l.id;
      S.set('sel', sel);
      save('lists');
      focusNew();
    }
    async function renameList(l) {
      const n = await promptSheet(win, { title: 'Liste umbenennen', value: l.name, ok: 'Umbenennen' });
      if (!n) return;
      l.name = n.slice(0, 40);
      save('lists');
    }
    async function removeList(l) {
      const n = d.tasks.filter((t) => t.list === l.id).length;
      const yes = await confirmSheet(win, {
        title: `Liste „${l.name}“ löschen?`,
        text: n ? `${n === 1 ? 'Die Erinnerung' : `Alle ${n} Erinnerungen`} in dieser Liste ${n === 1 ? 'wird' : 'werden'} ebenfalls gelöscht.` : 'Die Liste ist leer.',
        ok: 'Löschen', danger: true,
      });
      if (!yes) return;
      d.tasks = d.tasks.filter((t) => t.list !== l.id);
      d.lists = d.lists.filter((x) => x !== l);
      if (sel === l.id) { sel = 'all'; S.set('sel', sel); }
      S.set('tasks', d.tasks);
      save('lists');
    }
    const switchMenu = () => [
      ...SMART.map((s) => ({ label: `${s.name}`, checked: sel === s.id, hint: String(counts()[s.id]), run: () => select(s.id) })),
      '-', { heading: 'Meine Listen' },
      ...d.lists.map((l) => ({ label: l.name, checked: sel === l.id, hint: String(d.tasks.filter((t) => t.list === l.id && !t.done).length), run: () => select(l.id) })),
      '-',
      { label: 'Neue Liste …', icon: 'plus', run: () => newList() },
    ];
    name.addEventListener('click', () => { if (win.body.clientWidth <= 560) openMenu(switchMenu(), { anchor: name }); });

    // ---------- Aufgaben der aktuellen Ansicht ----------
    /** → [{head?, cls?, color?}, task, …] in Anzeige-Reihenfolge */
    function rows() {
      const today = dayKey();
      const byDue = (a, b) => dueTs(a) - dueTs(b) || b.prio - a.prio || a.created - b.created;
      const doneLast = (a, b) => (a.done - b.done) || (a.done ? b.doneAt - a.doneAt : a.created - b.created);
      const vis = (t) => showDone || !t.done;
      if (sel === 'done') return d.tasks.filter((t) => t.done).sort((a, b) => b.doneAt - a.doneAt);
      if (sel === 'today') {
        return d.tasks.filter((t) => t.due && t.due <= today && (!t.done || (showDone && ymd(new Date(t.doneAt)) === today)))
          .sort((a, b) => (a.done - b.done) || byDue(a, b));
      }
      if (sel === 'scheduled') {
        const out = [];
        let last = null;
        for (const t of d.tasks.filter((x) => x.due && vis(x)).sort(byDue)) {
          const g = t.due < today ? 'Überfällig' : dayName(t.due);
          if (g !== last) { out.push({ head: g, cls: t.due < today ? 'is-over' : '' }); last = g; }
          out.push(t);
        }
        return out;
      }
      if (sel === 'all') {
        const out = [];
        for (const l of d.lists) {
          const ts = d.tasks.filter((t) => t.list === l.id && vis(t)).sort(doneLast);
          if (ts.length) out.push({ head: l.name, cls: 'is-list', color: l.color }, ...ts);
        }
        return out;
      }
      return d.tasks.filter((t) => t.list === sel && vis(t)).sort(doneLast);
    }

    function taskRow(t, i) {
      const l = listOf(t);
      const check = h('button.kit-check.reminders-check', { type: 'button', role: 'checkbox', 'aria-checked': String(t.done), 'aria-label': `„${t.title}“ erledigt`, html: icon('check') });
      const input = h('input.reminders-title', { type: 'text', value: t.title, title: t.title, maxLength: 200, spellcheck: false, autocomplete: 'off', 'aria-label': 'Titel' });
      const meta = h('div.reminders-meta',
        t.note ? h('span.reminders-note', t.note) : null,
        sel === 'done' && t.doneAt ? h('span', `Erledigt: ${dayName(ymd(new Date(t.doneAt)))}`) : null,
        t.due ? h('span.reminders-due', { class: isOver(t) ? 'is-over' : '' }, dueLabel(t)) : null,
        smart() && sel !== 'all' ? h('span', l.name) : null);
      const row = h('div.reminders-task', { class: t.done ? 'is-done' : '', dataset: { id: t.id }, style: { '--c': l.color, '--i': i } },
        check,
        h('div.reminders-main',
          h('div.reminders-line', t.prio ? h('span.reminders-prio', { title: `Priorität: ${PRIO[t.prio]}` }, '!'.repeat(t.prio)) : null, input,
            t.flag ? h('span.reminders-flag', { html: I.flag, title: 'Markiert' }) : null),
          meta),
        toolBtn('info', 'Details', () => details(t), 'reminders-info'));

      check.addEventListener('click', () => {
        setDone(t, !t.done);
        check.setAttribute('aria-checked', String(t.done));
        check.classList.toggle('is-pop', t.done);
        row.classList.toggle('is-done', t.done);
        save('tasks', me);
        paintSide();
        settle();
      });
      const commit = () => {
        const v = input.value.trim();
        if (!v) { input.value = t.title; return; }
        if (v !== t.title) { t.title = input.title = v; save('tasks', me); }
      };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); focusNew(); }
        else if (e.key === 'Escape') { e.stopPropagation(); input.value = t.title; input.blur(); win.el.focus({ preventScroll: true }); }
        else if (e.key === 'Backspace' && !input.value) {
          e.preventDefault();
          const at = [...body.querySelectorAll('.reminders-task')].indexOf(row);
          remove(t, true);
          ([...body.querySelectorAll('.reminders-task .reminders-title')][Math.max(0, at - 1)] || newInput())?.focus();
        }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); (sibling(row, e.key === 'ArrowDown' ? 1 : -1) || (e.key === 'ArrowDown' ? newInput() : null))?.focus(); }
      });
      row.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) { e.preventDefault(); details(t); } });
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); openMenu(taskMenu(t), { x: e.clientX, y: e.clientY }); });
      return row;
    }
    /** Titel-Eingabefeld der Nachbarzeile */
    function sibling(row, dir) {
      const all = [...body.querySelectorAll('.reminders-task')];
      return all[all.indexOf(row) + dir]?.querySelector('.reminders-title') || null;
    }
    const newInput = () => body.querySelector('.reminders-new input');
    function focusNew() {
      if (sel === 'done') select(d.lists[0].id);
      const el = newInput();
      if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }); }
    }

    /** Abgehakte Zeilen bleiben kurz stehen, dann gleiten sie hinaus */
    const settle = debounce(() => {
      const leaving = showDone || sel === 'done' ? [] : [...body.querySelectorAll('.reminders-task.is-done')];
      if (!leaving.length || reducedMotion.matches) { paintMain(); return; }
      let left = leaving.length;
      for (const row of leaving) {
        const a = row.animate([{ height: `${row.offsetHeight}px`, opacity: 1 }, { height: '0px', paddingBlock: '0px', opacity: 0 }], { duration: 280, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' });
        a.onfinish = a.oncancel = () => { if (--left === 0) paintMain(); };
      }
    }, 850);

    function add(title, focus = true) {
      const l = curList() || d.lists[0];
      const t = { id: uid(), list: l.id, title, note: '', done: false, doneAt: 0, due: sel === 'today' || sel === 'scheduled' ? dayKey() : null, time: null, prio: 0, flag: false, created: Date.now(), told: '' };
      d.tasks.push(t);
      save('tasks', me);
      paintSide();
      paintMain();
      if (focus) focusNew();
    }
    function remove(t, quiet = false) {
      d.tasks = d.tasks.filter((x) => x !== t);
      save('tasks', me);
      paintSide();
      paintMain();
      if (!quiet) toast(win, `„${t.title}“ gelöscht`);
    }
    const patch = (t, p) => { Object.assign(t, p); save('tasks', me); paintSide(); paintMain(); };
    const taskMenu = (t) => [
      { label: 'Details …', icon: 'info', run: () => details(t) },
      { label: t.flag ? 'Markierung entfernen' : 'Markieren', run: () => patch(t, { flag: !t.flag }) },
      '-', { heading: 'Fällig' },
      { label: 'Heute', checked: t.due === dayKey(), run: () => patch(t, { due: dayKey() }) },
      { label: 'Morgen', checked: t.due === dayKey(1), run: () => patch(t, { due: dayKey(1) }) },
      { label: 'Kein Datum', checked: !t.due, run: () => patch(t, { due: null, time: null }) },
      '-', { heading: 'Priorität' },
      ...PRIO.map((n, i) => ({ label: i ? `${n}  ${'!'.repeat(i)}` : n, checked: t.prio === i, run: () => patch(t, { prio: i }) })),
      '-',
      { label: 'Löschen', icon: 'trash', run: () => remove(t) },
    ];

    function paintMain(fresh = false) {
      const s = smart();
      const l = curList();
      const color = s ? s.color : l.color;
      head.style.setProperty('--c', color);
      body.style.setProperty('--c', color);
      name.replaceChildren(h('span', s ? s.name : l.name));
      name.insertAdjacentHTML('beforeend', icon('chevronDown'));
      const c = counts();
      total.textContent = String(s ? c[s.id] : d.tasks.filter((t) => t.list === l.id && !t.done).length);
      win.setTitle(`${s ? s.name : l.name} – Erinnerungen`);
      bDone.classList.toggle('is-on', showDone);
      bDone.disabled = sel === 'done';
      bDone.title = showDone ? 'Erledigte ausblenden' : 'Erledigte einblenden';
      bDone.setAttribute('aria-label', bDone.title);

      const keep = body.scrollTop;
      const list = rows();
      let i = 0;
      const kids = list.map((r) => (r.head
        ? h('div.reminders-group', { class: r.cls || '', style: r.color ? { '--c': r.color } : null }, r.head)
        : taskRow(r, i++)));
      if (!i) {
        const [t1, t2] = s ? s.empty : ['Keine Erinnerungen', showDone ? 'Tippe unten, um die erste anzulegen.' : 'Hier ist alles erledigt – oder noch nichts angelegt.'];
        kids.push(emptyState('check', t1, t2));
      }
      if (sel !== 'done') {
        const input = h('input.reminders-title', { type: 'text', placeholder: 'Neue Erinnerung', maxLength: 200, spellcheck: false, autocomplete: 'off', 'aria-label': 'Neue Erinnerung' });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); const v = input.value.trim(); input.value = ''; if (v) add(v); }
          else if (e.key === 'Escape') { e.stopPropagation(); input.value = ''; input.blur(); win.el.focus({ preventScroll: true }); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); [...body.querySelectorAll('.reminders-task .reminders-title')].pop()?.focus(); }
        });
        input.addEventListener('blur', () => { const v = input.value.trim(); if (v && input.isConnected) add(v, false); });
        kids.push(h('label.reminders-new', h('i', { html: icon('plus') }), input));
      }
      body.classList.toggle('is-fresh', fresh);
      body.replaceChildren(...kids);
      body.scrollTop = fresh ? 0 : keep;
      refocus();
    }

    // ---------- Details ----------
    let sheetOpen = false;
    async function details(t) {
      if (sheetOpen) return;
      const f = {
        title: h('input.kit-field.reminders-wide', { type: 'text', value: t.title, placeholder: 'Titel', maxLength: 200, autocomplete: 'off', 'aria-label': 'Titel', 'data-autofocus': '' }),
        note: h('textarea.kit-field.scroll', { rows: 2, value: t.note || '', placeholder: 'Notiz hinzufügen', maxLength: 2000, 'aria-label': 'Notiz' }),
        list: h('select.kit-field', { 'aria-label': 'Liste' }, d.lists.map((l) => h('option', { value: l.id, selected: l.id === t.list }, l.name))),
        due: h('input.kit-field', { type: 'date', value: t.due || '', 'aria-label': 'Fällig am' }),
        time: h('input.kit-field', { type: 'time', value: t.time || '', 'aria-label': 'Uhrzeit' }),
        prio: h('div.gseg', { 'aria-label': 'Priorität' }, PRIO.map((n, i) => h('button', { dataset: { value: i }, 'aria-selected': String(i === t.prio), title: n }, i ? '!'.repeat(i) : 'Keine'))),
        flag: h('button.gswitch', { 'aria-checked': String(!!t.flag), 'aria-label': 'Markiert' }),
      };
      let prio = t.prio;
      f.prio.addEventListener('change', (e) => { prio = Number(e.detail.value); });
      const sync = () => { f.time.disabled = !f.due.value; if (!f.due.value) f.time.value = ''; };
      f.due.addEventListener('input', sync);
      const quick = (label, off) => h('button.kit-chip', { type: 'button', onclick: () => { f.due.value = off == null ? '' : dayKey(off); sync(); } }, label);
      const form = h('div.reminders-form.scroll',
        f.title,
        h('div.reminders-wide', { style: { display: 'grid' } }, f.note),
        h('label', 'Liste'), f.list,
        h('label', 'Fällig'), h('div.reminders-row', f.due, f.time),
        h('span'), h('div.reminders-row', quick('Heute', 0), quick('Morgen', 1), quick('In einer Woche', 7), quick('Kein Datum', null)),
        h('label', 'Priorität'), f.prio,
        h('label', 'Markiert'), h('div.reminders-row', f.flag));
      initControls(form);
      sync();
      sheetOpen = true;
      const done = sheet(win, {
        title: 'Details', body: form,
        buttons: [{ label: 'Löschen', value: 'delete' }, { label: 'Abbrechen', value: null }, { label: 'Fertig', value: 'save', primary: true }],
      });
      win.el.querySelector('.kit-sheet-wrap:last-of-type .kit-sheet-btns button')?.classList.add('reminders-del');
      const res = await done;
      sheetOpen = false;
      if (res === 'delete') { remove(t); return; }
      if (res === 'save') {
        patch(t, {
          title: f.title.value.trim() || t.title, note: f.note.value.trim(), list: f.list.value,
          due: f.due.value || null, time: f.due.value && f.time.value ? f.time.value : null, prio, flag: f.flag.checked,
        });
      }
      refocus();
    }

    async function clearDone() {
      const n = d.tasks.filter((t) => t.done).length;
      if (!n) { toast(win, 'Es gibt nichts Erledigtes zu löschen'); return; }
      const yes = await confirmSheet(win, { title: 'Erledigte löschen?', text: `${n === 1 ? 'Eine erledigte Erinnerung wird' : `${n} erledigte Erinnerungen werden`} endgültig entfernt.`, ok: 'Löschen', danger: true });
      if (!yes) return;
      d.tasks = d.tasks.filter((t) => !t.done);
      save('tasks');
    }

    // ---------- Laufendes ----------
    function refocus() { if (sys.wm.focused === win && !win.el.contains(document.activeElement)) win.el.focus({ preventScroll: true }); }
    const onData = (e) => {
      if (e.detail?.from === me) return;
      if (!SMART.some((s) => s.id === sel) && !d.lists.some((l) => l.id === sel)) sel = 'all';
      paintSide();
      // nicht mitten im Tippen neu zeichnen
      if (body.contains(document.activeElement) && document.activeElement.matches('input')) return;
      paintMain();
    };
    addEventListener(EVT, onData);
    let shownDay = dayKey();
    const clock = setInterval(() => {
      if (win.min) return;
      const typing = body.contains(document.activeElement) && document.activeElement.matches('input');
      if (dayKey() !== shownDay) { shownDay = dayKey(); paintSide(); if (!typing) paintMain(); return; }
      // überfällig gewordene Einträge rot färben
      for (const row of body.querySelectorAll('.reminders-task')) {
        const t = d.tasks.find((x) => x.id === row.dataset.id);
        row.querySelector('.reminders-due')?.classList.toggle('is-over', !!t && isOver(t));
      }
    }, 30000);
    const onKey = (e) => {
      if (e.altKey || e.metaKey || e.ctrlKey || e.target.closest('input, textarea, select')) return;
      if (e.key.toLowerCase() === 'n') { e.preventDefault(); focusNew(); }
    };
    win.el.addEventListener('keydown', onKey);

    function openArgs(a) {
      const t = a?.task && d.tasks.find((x) => x.id === a.task);
      if (t) select(t.done ? 'done' : t.list, t.id);
    }
    paintSide();
    paintMain(true);
    openArgs(args);

    return {
      onClose() {
        removeEventListener(EVT, onData);
        clearInterval(clock);
        win.el.removeEventListener('keydown', onKey);
      },
      onFocus: refocus,
      onArgs: openArgs,
      menus: () => [
        { label: 'Erinnerung', items: [
          { label: 'Neue Erinnerung', icon: 'plus', hint: 'N', run: () => focusNew() },
          '-',
          { label: 'Erledigte einblenden', checked: showDone, disabled: sel === 'done', run: () => bDone.click() },
          { label: 'Erledigte löschen …', icon: 'trash', run: () => clearDone() },
        ] },
        { label: 'Liste', items: [
          ...switchMenu().slice(0, -1),
          { label: 'Neue Liste …', icon: 'plus', run: () => newList() },
          { label: 'Liste umbenennen …', disabled: !curList(), run: () => renameList(curList()) },
          { label: 'Liste löschen …', icon: 'trash', disabled: !curList() || d.lists.length < 2, run: () => removeList(curList()) },
        ] },
      ],
    };
  },

  background() { startService(); },

  widgets: {
    today(el) {
      const box = h('div.reminders-w');
      el.append(box);
      let hold = 0;
      const paint = () => {
        const list = openToday();
        box.replaceChildren(
          h('div.reminders-w-head', h('b', String(list.length)), h('span', 'Heute')),
          list.length
            ? h('div.reminders-w-list', list.slice(0, 3).map((t) => {
              const check = h('button.kit-check.reminders-check', { type: 'button', role: 'checkbox', 'aria-checked': 'false', 'aria-label': `„${t.title}“ erledigt`, html: icon('check'), style: { '--c': listOf(t).color } });
              const row = h('div.reminders-w-row', { class: isOver(t) ? 'is-over' : '' }, check, h('span', t.title));
              check.addEventListener('click', () => {
                setDone(t, !t.done);
                check.setAttribute('aria-checked', String(t.done));
                check.classList.toggle('is-pop', t.done);
                row.classList.toggle('is-done', t.done);
                clearTimeout(hold);
                hold = setTimeout(() => { hold = 0; paint(); }, 900);     // kurz stehen lassen, dann nachrücken
                save('tasks', box);
              });
              return row;
            }), list.length > 3 ? h('span.reminders-w-more', `+${list.length - 3} weitere`) : null)
            : h('div.reminders-w-none', h('span', 'Für heute ist alles erledigt.')));
      };
      const onData = (e) => { if (e.detail?.from !== box) { clearTimeout(hold); hold = 0; paint(); } };
      paint();
      const id = setInterval(() => { if (!hold) paint(); }, 60000);
      addEventListener(EVT, onData);
      return () => { clearInterval(id); clearTimeout(hold); removeEventListener(EVT, onData); };
    },
  },
};
