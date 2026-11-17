// calendar.js — Kalender: Monats- und Wochenansicht, mehrere farbige Kalender, Termine mit Erinnerung
import { h, debounce } from '../../../core/util.js';
import { icon } from '../../../core/icons.js';
import { initControls } from '../../../core/controls.js';
import { sys } from '../../sys.js';
import { openMenu } from '../../ui.js';
import { style, appStore, toolBtn, sheet, confirmSheet, promptSheet, toast, pad2 } from '../../kit.js';

const S = appStore('calendar');
const EVT = 'fableos:calendar';
const HOUR = 46;      // Höhe einer Stunde in der Wochenansicht (px)
const COLORS = [['Koralle', '#ff5d6c'], ['Azur', '#2f8cff'], ['Minze', '#22c58b'], ['Bernstein', '#f5a524'], ['Violett', '#8b5cff'], ['Rose', '#ff3d81'], ['Türkis', '#14b8c4'], ['Graphit', '#7d86a3']];
const REMIND = [['none', 'Keine'], ['0', 'Zur Zeit des Termins'], ['10', '10 Minuten vorher'], ['60', '1 Stunde vorher']];
const DOW = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

// ---------- Datum ----------
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fromYmd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const monday = (d) => addDays(d, -((d.getDay() + 6) % 7));
const midnight = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const mins = (t) => { const [hh, mm] = String(t || '0:0').split(':').map(Number); return (hh || 0) * 60 + (mm || 0); };
const hhmm = (m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}
/** „Heute“, „Morgen“ oder „Mi., 19. Nov.“ */
function dayLabel(key) {
  const diff = Math.round((fromYmd(key) - midnight()) / 864e5);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  if (diff === -1) return 'Gestern';
  return fromYmd(key).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
}
const timeLabel = (ev) => (ev.allDay ? 'ganztägig' : `${ev.start} – ${ev.end}`);

// ---------- Daten (ein Stand für Fenster, Widget und Hintergrunddienst) ----------
let db = null;
function data() {
  if (db) return db;
  db = { cals: S.get('cals', null), events: S.get('events', null), fired: S.get('fired', {}) || {} };
  if (!Array.isArray(db.cals) || !db.cals.length) {
    db.cals = [
      { id: 'privat', name: 'Privat', color: COLORS[0][1], on: true },
      { id: 'arbeit', name: 'Arbeit', color: COLORS[1][1], on: true },
      { id: 'familie', name: 'Familie', color: COLORS[2][1], on: true },
    ];
    S.set('cals', db.cals);
  }
  if (!Array.isArray(db.events)) {
    // erster Start: ein paar Beispiele rund um heute
    const t = midnight();
    const ev = (off, cal, title, start, end, more = {}) => ({
      id: uid(), cal, title, date: ymd(addDays(t, off)), allDay: !start, start: start || '09:00', end: end || '10:00', place: '', note: '', remind: 'none', ...more,
    });
    db.events = [
      ev(-1, 'privat', 'Zahnarzt', '08:30', '09:15', { place: 'Praxis am Markt' }),
      ev(0, 'arbeit', 'Team-Runde', '10:00', '11:00', { note: 'Wochenplanung und offene Punkte' }),
      ev(0, 'privat', 'Laufen im Park', '18:30', '19:30'),
      ev(1, 'privat', 'Mittagessen mit Mara', '12:30', '13:30', { place: 'Café Lumen' }),
      ev(2, 'arbeit', 'Entwurf abgeben', '16:00', '16:30'),
      ev(3, 'familie', 'Omas Geburtstag'),
      ev(5, 'familie', 'Kinoabend', '19:00', '21:30'),
      ev(9, 'arbeit', 'Workshop „Glas & Licht“', '09:30', '15:00', { place: 'Studio 2' }),
    ];
    S.set('events', db.events);
  }
  return db;
}
function save(what) {
  S.set(what, db[what]);
  dispatchEvent(new CustomEvent(EVT));
}
const calOf = (ev) => data().cals.find((c) => c.id === ev.cal) || data().cals[0];
/** Sichtbare Termine eines Tages: ganztägige zuerst, dann nach Beginn */
function eventsOn(key) {
  const on = new Set(data().cals.filter((c) => c.on).map((c) => c.id));
  return data().events.filter((e) => e.date === key && on.has(e.cal))
    .sort((a, b) => (b.allDay - a.allDay) || mins(a.start) - mins(b.start) || a.title.localeCompare(b.title, 'de'));
}

// ---------- Erinnerungen (Hintergrunddienst) ----------
function checkReminders() {
  const d = data();
  const now = Date.now();
  let dirty = false;
  for (const ev of d.events) {
    if (!ev.remind || ev.remind === 'none' || !calOf(ev)?.on) continue;
    const begin = fromYmd(ev.date);
    begin.setMinutes(ev.allDay ? 9 * 60 : mins(ev.start));      // ganztägig: Bezugspunkt 9 Uhr
    if (begin.getTime() - Number(ev.remind) * 60000 > now) continue;
    const key = `${ev.date}T${ev.allDay ? 'tag' : ev.start}|${ev.remind}`;
    if (d.fired[ev.id] === key) continue;
    d.fired[ev.id] = key;
    dirty = true;
    const end = fromYmd(ev.date);
    end.setMinutes(ev.allDay ? 24 * 60 : Math.max(mins(ev.end), mins(ev.start)));
    if (now > end.getTime()) continue;                           // längst vorbei – nicht nachträglich stören
    const id = ev.id;
    sys.notify({
      title: ev.title || 'Termin',
      body: `${dayLabel(ev.date)}, ${timeLabel(ev)}${ev.place ? ` · ${ev.place}` : ''}`,
      app: 'calendar', ttl: 9000,
      onClick: () => sys.open('calendar', { event: id }),
    });
  }
  if (dirty) S.set('fired', d.fired);
}
let service = 0;
function startService() {
  if (service) return;
  service = setInterval(checkReminders, 30000);
  addEventListener(EVT, debounce(checkReminders, 800));
  setTimeout(checkReminders, 1500);
}

/** Überlappende Termine eines Tages nebeneinander anordnen → [{ev, s, e, col, cols}] */
function layoutDay(list) {
  const out = [];
  let group = [];
  let groupEnd = -1;
  const flush = () => {
    const cols = Math.max(...group.map((g) => g.col)) + 1;
    for (const g of group) g.cols = cols;
    out.push(...group);
    group = [];
    groupEnd = -1;
  };
  for (const ev of list) {
    const s = mins(ev.start);
    const e = Math.min(24 * 60, Math.max(s + 25, mins(ev.end)));
    if (group.length && s >= groupEnd) flush();
    const used = new Set(group.filter((g) => g.e > s).map((g) => g.col));
    let col = 0;
    while (used.has(col)) col++;
    group.push({ ev, s, e, col, cols: 1 });
    groupEnd = Math.max(groupEnd, e);
  }
  if (group.length) flush();
  return out;
}

style('calendar', `
.calendar-win .win-title { display: none; }
.calendar-seg { position: absolute; left: 50%; top: 5px; translate: -50% 0; }
.calendar-seg button { padding: .3em 1em; font-size: 12px; }
.calendar .kit-split { --side: 208px; }
.calendar-side { gap: 0; padding: 12px 10px; }
.calendar-bar { gap: 4px; padding: 8px 12px 8px 16px; min-height: 48px; border-bottom: 0; }
.calendar-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 20px; font-weight: 400; letter-spacing: -.02em; color: var(--fg-2); }
.calendar-title b { font-weight: 700; color: var(--fg); }
.calendar-kw { margin-right: 4px; font-variant-numeric: tabular-nums; }
.calendar-view { position: relative; display: flex; flex-direction: column; flex: 1; min-height: 0; }
.calendar-view > * { animation: calendar-in .32s var(--ease-out) both; }
.calendar-view[data-dir="next"] > * { --from: 14px; }
.calendar-view[data-dir="prev"] > * { --from: -14px; }
@keyframes calendar-in { from { opacity: 0; transform: translateX(var(--from, 0)); } }

/* Mini-Monat */
.calendar-mini { padding: 0 2px 10px; }
.calendar-mini-head { display: flex; align-items: center; gap: 2px; padding: 0 0 6px 6px; font-size: 13px; font-weight: 700; }
.calendar-mini-head span { flex: 1; }
.calendar-mini-head span i { font-style: normal; font-weight: 500; color: var(--fg-3); }
.calendar-mini-head .tool { width: 22px; height: 22px; }
.calendar-mini-head .tool .ico { width: 13px; height: 13px; }
.calendar-mini-grid { display: grid; grid-template-columns: repeat(7, 1fr); row-gap: 1px; text-align: center; font-size: 11px; font-variant-numeric: tabular-nums; }
.calendar-mini-grid i { padding-bottom: 3px; font-style: normal; font-size: 10px; font-weight: 700; color: var(--fg-3); }
.calendar-mini-grid button { display: grid; place-items: center; height: 23px; padding: 0; border: 0; background: none; color: var(--fg-2); }
.calendar-mini-grid button span { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; transition: background-color .15s; }
.calendar-mini-grid button:hover span { background: var(--raise-2); }
.calendar-mini-grid button.is-out { color: var(--fg-4); }
.calendar-mini-grid button.is-week { background: var(--raise); }
.calendar-mini-grid button.is-week.is-ws { border-radius: 8px 0 0 8px; }
.calendar-mini-grid button.is-week.is-we { border-radius: 0 8px 8px 0; }
.calendar-mini-grid button.is-sel span { box-shadow: inset 0 0 0 1.5px var(--accent); color: var(--fg); }
.calendar-mini-grid button.is-today span { background: var(--accent); color: var(--accent-ink); font-weight: 700; box-shadow: none; }

/* Kalenderliste */
.calendar-cal { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 4px 4px 4px 8px; border-radius: 8px; font-size: 13px; color: var(--fg-2); }
.calendar-cal:hover { background: var(--raise); }
.calendar-cal > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.calendar-cal .kit-check { width: 17px; height: 17px; border-radius: 6px; box-shadow: inset 0 0 0 1.6px var(--c); }
.calendar-cal .kit-check .ico { width: 11px; height: 11px; }
.calendar-cal .tool { width: 22px; height: 22px; opacity: 0; }
.calendar-cal:hover .tool, .calendar-cal .tool:focus-visible { opacity: 1; }
.calendar-cal .tool .ico { width: 13px; height: 13px; }
.calendar-newcal { display: flex; align-items: center; gap: 7px; margin-top: 6px; padding: 6px 8px; border: 0; border-radius: 8px; background: none; font-size: 12.5px; font-weight: 600; color: var(--fg-3); text-align: left; }
.calendar-newcal:hover { background: var(--raise); color: var(--fg); }
.calendar-newcal .ico { width: 14px; height: 14px; }

/* Monat */
.calendar-dow { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); flex: none; height: 24px; padding: 0 1px; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--fg-3); }
.calendar-dow span { padding: 3px 9px 0 0; text-align: right; }
.calendar-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); flex: 1; min-height: 0; border-top: .5px solid var(--line); }
.calendar-cell { display: flex; flex-direction: column; gap: 1px; min-width: 0; min-height: 0; padding: 3px 3px 2px; overflow: hidden; border-right: .5px solid var(--line); border-bottom: .5px solid var(--line); }
.calendar-cell:nth-child(7n) { border-right: 0; }
.calendar-cell.is-weekend { background: color-mix(in srgb, var(--well) 38%, transparent); }
.calendar-cell.is-out .calendar-num { color: var(--fg-4); }
.calendar-cell.is-out .calendar-ev { opacity: .55; }
.calendar-cell.is-sel { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 70%, transparent); }
.calendar-num { align-self: flex-end; display: grid; place-items: center; flex: none; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 99px; font-size: 12.5px; font-weight: 550; font-variant-numeric: tabular-nums; color: var(--fg-2); }
.calendar-cell.is-today .calendar-num { background: var(--accent); color: var(--accent-ink); font-weight: 700; }
.calendar-ev { display: flex; align-items: center; gap: 5px; flex: none; min-width: 0; height: 18px; padding: 0 5px; border: 0; border-radius: 5px; background: none; font-size: 11.5px; font-weight: 550; text-align: left; color: var(--fg); }
.calendar-ev:hover { background: var(--raise-2); }
.calendar-ev i { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--c); }
.calendar-ev-t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.calendar-ev-h { flex: none; font-size: 10.5px; font-weight: 500; color: var(--fg-3); font-variant-numeric: tabular-nums; }
.calendar-ev.is-all { background: color-mix(in srgb, var(--c) 30%, transparent); box-shadow: inset 2.5px 0 0 var(--c); padding-left: 8px; }
.calendar-ev.is-all:hover { background: color-mix(in srgb, var(--c) 44%, transparent); }
.calendar-more { flex: none; height: 16px; padding: 0 5px; border: 0; border-radius: 5px; background: none; font-size: 10.5px; font-weight: 600; text-align: left; color: var(--fg-3); white-space: nowrap; overflow: hidden; }
.calendar-more:hover { background: var(--raise); color: var(--fg); }
.calendar-dots { display: flex; gap: 3px; justify-content: flex-end; padding: 1px 6px 0 0; border: 0; background: none; }
.calendar-dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--c); }

/* Woche */
.calendar-wscroll { position: relative; flex: 1; min-height: 0; border-top: .5px solid var(--line); }
.calendar-wtop { position: sticky; top: 0; z-index: 4; background: color-mix(in srgb, var(--solid) 86%, transparent); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); box-shadow: 0 .5px 0 var(--line); }
.calendar-whead, .calendar-allday, .calendar-wgrid { display: grid; grid-template-columns: 46px repeat(7, minmax(0, 1fr)); }
.calendar-wday { display: flex; align-items: baseline; justify-content: center; gap: 5px; min-width: 0; padding: 7px 2px 6px; border: 0; background: none; font-size: 11.5px; font-weight: 600; color: var(--fg-3); white-space: nowrap; }
.calendar-wday b { display: grid; place-items: center; min-width: 24px; height: 24px; padding: 0 4px; border-radius: 99px; font-size: 14px; font-weight: 600; color: var(--fg); font-variant-numeric: tabular-nums; }
.calendar-wday.is-today { color: var(--accent); }
.calendar-wday.is-today b { background: var(--accent); color: var(--accent-ink); }
.calendar-wday.is-sel:not(.is-today) b { box-shadow: inset 0 0 0 1.5px var(--accent); }
.calendar-gut { align-self: center; padding-right: 6px; font-size: 9.5px; font-weight: 600; text-align: right; color: var(--fg-3); }
.calendar-adcol { display: grid; align-content: start; gap: 1px; min-width: 0; min-height: 6px; padding: 0 2px 3px; border-left: .5px solid var(--line); }
.calendar-wgrid { position: relative; height: ${HOUR * 24}px; }
.calendar-hours { position: relative; }
.calendar-hours span { position: absolute; right: 6px; translate: 0 -50%; font-size: 10px; font-weight: 500; color: var(--fg-3); font-variant-numeric: tabular-nums; }
.calendar-col { position: relative; min-width: 0; border-left: .5px solid var(--line); background-image: linear-gradient(var(--line) 1px, transparent 1px); background-size: 100% ${HOUR}px; }
.calendar-col.is-today { background-color: color-mix(in srgb, var(--accent) 7%, transparent); }
.calendar-col.is-weekend:not(.is-today) { background-color: color-mix(in srgb, var(--well) 38%, transparent); }
.calendar-blk { position: absolute; display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; min-width: 0; padding: 2px 4px 2px 7px; overflow: hidden; border: 0; border-radius: 6px; background: color-mix(in srgb, var(--c) 30%, var(--solid)); box-shadow: inset 3px 0 0 var(--c), 0 0 0 1px var(--solid); font-size: 11px; line-height: 1.25; text-align: left; color: var(--fg); transition: filter .15s, transform .4s var(--spring); }
.calendar-blk:hover { filter: brightness(1.12); z-index: 2; }
.calendar-blk:active { transform: scale(.98); }
.calendar-blk b { display: block; flex: none; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.calendar-blk span { display: block; flex: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg-2); font-variant-numeric: tabular-nums; }
.calendar-now { position: absolute; left: -1px; right: 0; z-index: 3; height: 2px; margin-top: -1px; background: var(--c-coral); pointer-events: none; }
.calendar-now::before { content: ""; position: absolute; left: -4px; top: -3px; width: 8px; height: 8px; border-radius: 50%; background: var(--c-coral); }

/* Termin-Dialog */
/* Das Sheet soll nie höher werden als das Fenster: Zeile fest an die Fensterhöhe binden, dann rollt das Formular */
.calendar-win .kit-sheet-wrap { grid-template-rows: minmax(0, 1fr); align-items: start; }
.calendar-form { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 9px 12px; align-items: center; min-height: 0; padding: 2px; }
.calendar-form > label { font-size: 12.5px; font-weight: 600; color: var(--fg-3); }
.calendar-form .calendar-wide { grid-column: 1 / -1; }
.calendar-form input.calendar-wide { font-size: 16px; font-weight: 650; padding: 8px 11px; }
.calendar-form .calendar-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.calendar-form .calendar-row .kit-field { flex: 1; }
.calendar-form .calendar-row > span { color: var(--fg-3); }
.calendar-form .gswitch { --w: 42px; --h: 25px; }
.calendar-form .kit-dot { width: 12px; height: 12px; }
.calendar-del { margin-right: auto; color: var(--c-coral); }

/* Widget */
.calendar-w { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.calendar-w-day { font-size: 11.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--accent); }
.calendar-w-num { margin: -3px 0 5px; font-family: var(--font-round); font-size: 40px; font-weight: 600; line-height: 1.1; letter-spacing: -.03em; }
.calendar-w-num span { margin-left: 6px; font-family: var(--font); font-size: 12px; font-weight: 600; letter-spacing: 0; color: var(--fg-3); }
.calendar-w-list { display: grid; gap: 6px; align-content: start; flex: 1; min-height: 0; }
.calendar-w-ev { display: grid; gap: 0; min-width: 0; padding-left: 9px; box-shadow: inset 3px 0 0 var(--c); border-radius: 2px; }
.calendar-w-ev b { font-size: 12.5px; font-weight: 650; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.calendar-w-ev span { font-size: 11px; line-height: 1.3; color: var(--fg-3); font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.calendar-w-none { font-size: 12px; color: var(--fg-3); }

@container win (max-width: 1040px) {
  .calendar-ev-h { display: none; }
}
@container win (max-width: 560px) {
  .calendar-bar { padding-left: 12px; }
  .calendar-title { font-size: 17px; }
  .calendar-ev { padding: 0 3px; gap: 3px; font-size: 10.5px; }
  .calendar-ev.is-all { padding-left: 6px; }
  .calendar-dow span { padding-right: 6px; }
  .calendar-whead, .calendar-allday, .calendar-wgrid { grid-template-columns: 38px repeat(7, minmax(0, 1fr)); }
  .calendar-wday { flex-direction: column; align-items: center; gap: 0; padding-top: 4px; font-size: 10.5px; }
  .calendar-blk { padding: 2px 2px 2px 5px; font-size: 10px; }
  .calendar-blk span { display: none; }
}
`);

export default {
  singleton: true,
  width: 900, height: 600, minW: 440, minH: 380,

  mount(win, args = {}) {
    const d = data();
    startService();
    let view = S.get('view', 'month') === 'week' ? 'week' : 'month';
    let cursor = midnight();
    let fit = 3;              // so viele Termine passen in eine Monatszelle
    let needScroll = true;    // Wochenansicht beim ersten Zeigen zur aktuellen Uhrzeit rollen
    let sheetOpen = false;
    let armed = null;         // zuletzt angeklickter Tag (für den Doppelklick)

    win.el.classList.add('calendar-win');
    const seg = h('div.gseg.no-drag.calendar-seg', { 'aria-label': 'Ansicht' },
      h('button', { dataset: { value: 'month' }, 'aria-selected': String(view === 'month') }, 'Monat'),
      h('button', { dataset: { value: 'week' }, 'aria-selected': String(view === 'week') }, 'Woche'));
    const bCals = toolBtn('layers', 'Kalender ein- und ausblenden', () => openMenu(calMenu(), { anchor: bCals, align: 'right' }));
    win.tools.append(seg, bCals, toolBtn('plus', 'Neuer Termin (N)', () => edit(null)));
    initControls(win.tools);

    const mini = h('div.calendar-mini');
    const calBox = h('div');
    const title = h('h2.calendar-title');
    const kw = h('span.kit-chip.calendar-kw');
    const viewEl = h('div.calendar-view');
    win.body.append(h('div.kit-app.calendar',
      h('div.kit-split',
        h('aside.kit-side.calendar-side.scroll', mini, h('div.kit-head', 'Kalender'), calBox,
          h('button.calendar-newcal', { type: 'button', html: icon('plus'), onclick: () => newCal() }, 'Neuer Kalender')),
        h('div.kit-main',
          h('div.kit-bar.calendar-bar', title, h('span.sp'), kw,
            toolBtn('chevronLeft', 'Zurück (←)', () => step(-1)),
            h('button.kit-btn', { type: 'button', title: 'Heute (T)', onclick: () => goto(midnight()) }, 'Heute'),
            toolBtn('chevronRight', 'Weiter (→)', () => step(1))),
          viewEl))));

    // ---------- Navigation ----------
    const viewKey = () => (view === 'month' ? `m${cursor.getFullYear()}-${cursor.getMonth()}` : `w${ymd(monday(cursor))}`);
    function goto(date, dir) {
      const before = viewKey();
      const old = cursor;
      cursor = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      if (viewKey() !== before) { viewEl.dataset.dir = dir || (cursor > old ? 'next' : 'prev'); paintView(); }
      else markSelection();
      paintHead();
      paintMini();
    }
    function step(n) {
      if (view === 'week') { goto(addDays(cursor, 7 * n)); return; }
      const last = new Date(cursor.getFullYear(), cursor.getMonth() + n + 1, 0).getDate();
      goto(new Date(cursor.getFullYear(), cursor.getMonth() + n, Math.min(cursor.getDate(), last)));
    }
    function setView(v) {
      if (v === view) return;
      view = v;
      S.set('view', v);
      if (seg.index !== (v === 'month' ? 0 : 1)) seg.select(v === 'month' ? 0 : 1, false);
      needScroll = true;
      viewEl.dataset.dir = '';
      paintHead();
      paintMini();
      paintView();
    }
    seg.addEventListener('change', (e) => setView(e.detail.value));

    // ---------- Kopf, Mini-Monat, Kalenderliste ----------
    function paintHead() {
      if (view === 'month') {
        title.replaceChildren(h('b', cursor.toLocaleDateString('de-DE', { month: 'long' })), ` ${cursor.getFullYear()}`);
        kw.hidden = true;
        return;
      }
      const a = monday(cursor);
      const b = addDays(a, 6);
      const same = a.getMonth() === b.getMonth();
      const range = same
        ? `${a.getDate()}.–${b.getDate()}. ${b.toLocaleDateString('de-DE', { month: 'long' })}`
        : `${a.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })} – ${b.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}`;
      title.replaceChildren(h('b', range), ` ${b.getFullYear()}`);
      kw.hidden = false;
      kw.textContent = `KW ${isoWeek(cursor)}`;
    }
    function paintMini() {
      const y = cursor.getFullYear();
      const mo = cursor.getMonth();
      const start = monday(new Date(y, mo, 1));
      const tdy = ymd(new Date());
      const sel = ymd(cursor);
      const wk = view === 'week' ? ymd(monday(cursor)) : '';
      const cells = [];
      for (let i = 0; i < 42; i++) {
        const day = addDays(start, i);
        const key = ymd(day);
        const cls = [day.getMonth() !== mo && 'is-out', key === tdy && 'is-today', key === sel && 'is-sel',
          wk && ymd(monday(day)) === wk && 'is-week', i % 7 === 0 && 'is-ws', i % 7 === 6 && 'is-we'].filter(Boolean).join(' ');
        cells.push(h('button', { type: 'button', class: cls, 'aria-label': day.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' }), onclick: () => goto(day) }, h('span', String(day.getDate()))));
      }
      mini.replaceChildren(
        h('div.calendar-mini-head',
          h('span', cursor.toLocaleDateString('de-DE', { month: 'long' }), ' ', h('i', String(y))),
          toolBtn('chevronLeft', 'Vorheriger Monat', () => goto(new Date(y, mo - 1, 1))),
          toolBtn('chevronRight', 'Nächster Monat', () => goto(new Date(y, mo + 1, 1)))),
        h('div.calendar-mini-grid', DOW.map((n) => h('i', n)), cells));
    }
    function paintCals() {
      calBox.replaceChildren(...d.cals.map((c) => {
        const check = h('button.kit-check', { type: 'button', role: 'checkbox', 'aria-checked': String(!!c.on), 'aria-label': `${c.name} anzeigen`, html: icon('check'), onclick: () => toggleCal(c) });
        const more = toolBtn('chevronDown', `${c.name} bearbeiten`, () => openMenu(calItemMenu(c), { anchor: more, align: 'right' }));
        const row = h('div.calendar-cal', { style: { '--c': c.color } }, check, h('span', { title: c.name }, c.name), more);
        row.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); openMenu(calItemMenu(c), { x: e.clientX, y: e.clientY }); });
        row.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) renameCal(c); });
        return row;
      }));
    }
    function toggleCal(c) { c.on = !c.on; save('cals'); }
    async function newCal() {
      const name = await promptSheet(win, { title: 'Neuer Kalender', placeholder: 'Name', ok: 'Anlegen' });
      if (!name) return;
      const free = COLORS.find(([, col]) => !d.cals.some((c) => c.color === col)) || COLORS[d.cals.length % COLORS.length];
      d.cals.push({ id: uid(), name: name.slice(0, 40), color: free[1], on: true });
      save('cals');
    }
    async function renameCal(c) {
      const name = await promptSheet(win, { title: 'Kalender umbenennen', value: c.name, ok: 'Umbenennen' });
      if (!name) return;
      c.name = name.slice(0, 40);
      save('cals');
    }
    async function removeCal(c) {
      const n = d.events.filter((e) => e.cal === c.id).length;
      const yes = await confirmSheet(win, {
        title: `Kalender „${c.name}“ löschen?`,
        text: n ? `${n === 1 ? 'Der Termin' : `Alle ${n} Termine`} in diesem Kalender ${n === 1 ? 'wird' : 'werden'} ebenfalls gelöscht.` : 'Der Kalender enthält keine Termine.',
        ok: 'Löschen', danger: true,
      });
      if (!yes) return;
      for (const e of d.events) if (e.cal === c.id) delete d.fired[e.id];
      d.events = d.events.filter((e) => e.cal !== c.id);
      d.cals = d.cals.filter((x) => x !== c);
      S.set('events', d.events);
      save('cals');
    }
    const calItemMenu = (c) => [
      { label: c.on ? 'Ausblenden' : 'Einblenden', run: () => toggleCal(c) },
      { label: 'Umbenennen …', icon: 'note', run: () => renameCal(c) },
      '-', { heading: 'Farbe' },
      ...COLORS.map(([name, col]) => ({ label: name, checked: c.color === col, run: () => { c.color = col; save('cals'); } })),
      '-',
      { label: 'Löschen …', icon: 'trash', disabled: d.cals.length < 2, run: () => removeCal(c) },
    ];
    const calMenu = () => [
      { heading: 'Kalender' },
      ...d.cals.map((c) => ({ label: c.name, checked: !!c.on, run: () => toggleCal(c) })),
      '-',
      { label: 'Neuer Kalender …', icon: 'plus', run: () => newCal() },
    ];

    // ---------- Termine ----------
    const evMenu = (ev) => [
      { label: 'Bearbeiten …', icon: 'note', run: () => edit(ev) },
      { label: 'Duplizieren', icon: 'copy', run: () => { d.events.push({ ...ev, id: uid() }); save('events'); } },
      '-',
      { label: 'Löschen', icon: 'trash', run: () => remove(ev) },
    ];
    function remove(ev) {
      d.events = d.events.filter((e) => e !== ev);
      delete d.fired[ev.id];
      save('events');
      toast(win, `„${ev.title}“ gelöscht`);
    }
    /** Knopf für einen Termin; kind: 'chip' (Monat, ganztägig) oder 'blk' (Stundenraster) */
    function evButton(ev, kind) {
      const c = calOf(ev);
      const label = `${ev.title}, ${dayLabel(ev.date)}, ${timeLabel(ev)}`;
      const b = kind === 'blk'
        ? h('button.calendar-blk', { type: 'button', 'aria-label': label, title: `${ev.title}\n${timeLabel(ev)}${ev.place ? `\n${ev.place}` : ''}` }, h('b', ev.title), h('span', `${ev.start} – ${ev.end}`), ev.place ? h('span', ev.place) : null)
        : h(`button.calendar-ev${ev.allDay ? '.is-all' : ''}`, { type: 'button', 'aria-label': label, title: `${ev.title} · ${timeLabel(ev)}` }, ev.allDay ? null : h('i'), h('span.calendar-ev-t', ev.title), ev.allDay ? null : h('span.calendar-ev-h', ev.start));
      b.style.setProperty('--c', c.color);
      b.dataset.ev = ev.id;
      b.addEventListener('click', (e) => { e.stopPropagation(); edit(ev); });
      b.addEventListener('dblclick', (e) => e.stopPropagation());
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); openMenu(evMenu(ev), { x: e.clientX, y: e.clientY }); });
      b.addEventListener('keydown', (e) => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); remove(ev); } });
      return b;
    }

    /** Termin anlegen (ev = null, preset = Vorgaben) oder bearbeiten – in einem Sheet */
    async function edit(ev, preset = {}) {
      if (sheetOpen) return;
      const isNew = !ev;
      const now = new Date();
      const nextHour = Math.min(22, now.getHours() + 1) * 60;
      const startMin = preset.start ?? (ymd(cursor) === ymd(now) ? nextHour : 9 * 60);
      const cur = ev || {
        title: '', cal: (d.cals.find((c) => c.on) || d.cals[0]).id, date: preset.date || ymd(cursor), allDay: !!preset.allDay,
        start: hhmm(startMin), end: hhmm(Math.min(24 * 60 - 5, startMin + 60)), place: '', note: '', remind: 'none',
      };
      const f = {
        title: h('input.kit-field.calendar-wide', { type: 'text', value: cur.title, placeholder: 'Neuer Termin', maxLength: 120, autocomplete: 'off', 'aria-label': 'Titel', 'data-autofocus': '' }),
        cal: h('select.kit-field', { 'aria-label': 'Kalender' }, d.cals.map((c) => h('option', { value: c.id, selected: c.id === cur.cal }, c.name))),
        dot: h('i.kit-dot'),
        date: h('input.kit-field', { type: 'date', value: cur.date, 'aria-label': 'Datum' }),
        allDay: h('button.gswitch', { 'aria-checked': String(!!cur.allDay), 'aria-label': 'Ganztägig' }),
        start: h('input.kit-field', { type: 'time', value: cur.start, 'aria-label': 'Beginn' }),
        end: h('input.kit-field', { type: 'time', value: cur.end, 'aria-label': 'Ende' }),
        place: h('input.kit-field', { type: 'text', value: cur.place || '', placeholder: 'Ort hinzufügen', maxLength: 120, autocomplete: 'off', 'aria-label': 'Ort' }),
        note: h('textarea.kit-field.scroll', { rows: 2, value: cur.note || '', placeholder: 'Notiz hinzufügen', maxLength: 2000, 'aria-label': 'Notiz' }),
        remind: h('select.kit-field', { 'aria-label': 'Erinnerung' }, REMIND.map(([v, n]) => h('option', { value: v, selected: v === (cur.remind || 'none') }, n))),
      };
      const timeLbl = h('label', 'Zeit');
      const timeRow = h('div.calendar-row', f.start, h('span', '–'), f.end);
      const syncDay = () => { timeLbl.hidden = timeRow.hidden = f.allDay.checked; };
      const syncDot = () => f.dot.style.setProperty('--c', (d.cals.find((c) => c.id === f.cal.value) || d.cals[0]).color);
      let span = Math.max(15, mins(cur.end) - mins(cur.start));
      f.start.addEventListener('change', () => { if (f.start.value) f.end.value = hhmm(Math.min(24 * 60 - 1, mins(f.start.value) + span)); });
      f.end.addEventListener('change', () => { if (f.end.value && f.start.value && mins(f.end.value) > mins(f.start.value)) span = mins(f.end.value) - mins(f.start.value); });
      f.allDay.addEventListener('change', syncDay);
      f.cal.addEventListener('change', syncDot);
      const body = h('div.calendar-form.scroll',
        f.title,
        h('label', 'Kalender'), h('div.calendar-row', f.dot, f.cal),
        h('label', 'Datum'), f.date,
        h('label', 'Ganztägig'), h('div.calendar-row', f.allDay),
        timeLbl, timeRow,
        h('label', 'Ort'), f.place,
        h('label', 'Erinnerung'), f.remind,
        h('div.calendar-wide', { style: { display: 'grid' } }, f.note));
      initControls(body);
      syncDay();
      syncDot();

      sheetOpen = true;
      const done = sheet(win, {
        title: isNew ? 'Neuer Termin' : 'Termin bearbeiten', body,
        buttons: [
          !isNew && { label: 'Löschen', value: 'delete' },
          { label: 'Abbrechen', value: null },
          { label: isNew ? 'Hinzufügen' : 'Sichern', value: 'save', primary: true },
        ].filter(Boolean),
      });
      if (!isNew) win.el.querySelector('.kit-sheet-wrap:last-of-type .kit-sheet-btns button')?.classList.add('calendar-del');
      const res = await done;
      sheetOpen = false;
      refocus();
      if (res === 'delete') { remove(ev); return; }
      if (res !== 'save') return;

      const start = f.start.value || cur.start;
      let end = f.end.value || cur.end;
      if (mins(end) <= mins(start)) end = hhmm(Math.min(24 * 60 - 1, mins(start) + 60));
      const next = {
        title: f.title.value.trim() || 'Neuer Termin', cal: f.cal.value, date: f.date.value || cur.date, allDay: f.allDay.checked,
        start, end, place: f.place.value.trim(), note: f.note.value.trim(), remind: f.remind.value,
      };
      if (isNew) d.events.push({ id: uid(), ...next }); else Object.assign(ev, next);
      cursor = fromYmd(next.date);
      save('events');
    }

    // ---------- Monatsansicht ----------
    function monthRows() {
      const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      return Math.ceil((((first.getDay() + 6) % 7) + days) / 7);
    }
    const calcFit = () => (viewEl.clientHeight ? Math.max(0, Math.floor(((viewEl.clientHeight - 24) / monthRows() - 28) / 19)) : 3);
    function paintMonth() {
      const rows = monthRows();
      const mo = cursor.getMonth();
      const start = monday(new Date(cursor.getFullYear(), mo, 1));
      const tdy = ymd(new Date());
      const sel = ymd(cursor);
      fit = calcFit();
      const grid = h('div.calendar-grid', { style: { gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` } });
      for (let i = 0; i < rows * 7; i++) {
        const day = addDays(start, i);
        const key = ymd(day);
        const list = eventsOn(key);
        const cls = [day.getMonth() !== mo && 'is-out', key === tdy && 'is-today', key === sel && 'is-sel', i % 7 > 4 && 'is-weekend'].filter(Boolean).join(' ');
        const num = day.getDate() === 1 ? day.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' }) : String(day.getDate());
        const cell = h('div.calendar-cell', { class: cls, dataset: { date: key } }, h('span.calendar-num', num));
        if (list.length && fit < 1) {
          cell.append(h('button.calendar-dots', { type: 'button', 'aria-label': `${list.length} ${list.length === 1 ? 'Termin' : 'Termine'} – Woche zeigen`, onclick: (e) => { e.stopPropagation(); cursor = day; setView('week'); } },
            list.slice(0, 4).map((ev) => h('i', { style: { '--c': calOf(ev).color } }))));
        } else {
          const shown = list.length > fit ? list.slice(0, fit - 1) : list;
          for (const ev of shown) cell.append(evButton(ev, 'chip'));
          if (list.length > shown.length) {
            cell.append(h('button.calendar-more', { type: 'button', onclick: (e) => { e.stopPropagation(); cursor = day; setView('week'); } }, `+${list.length - shown.length} weitere`));
          }
        }
        grid.append(cell);
      }
      grid.addEventListener('click', (e) => {
        const cell = e.target.closest('.calendar-cell');
        if (!cell || (armed && Date.now() - armed.t < 450)) return;   // zweiter Klick eines Doppelklicks
        armed = { date: cell.dataset.date, t: Date.now() };
        goto(fromYmd(cell.dataset.date));
      });
      grid.addEventListener('dblclick', (e) => {
        // der erste Klick kann den Monat gewechselt haben – es zählt der Tag, der zuerst getroffen wurde
        const cell = e.target.closest('.calendar-cell');
        const date = armed && Date.now() - armed.t < 700 ? armed.date : cell?.dataset.date;
        if (date && !e.target.closest('button')) edit(null, { date });
      });
      viewEl.replaceChildren(h('div.calendar-dow', DOW.map((n) => h('span', n))), grid);
    }

    // ---------- Wochenansicht ----------
    let nowLine = null;
    const placeNow = () => { if (nowLine) { const n = new Date(); nowLine.style.top = `${((n.getHours() * 60 + n.getMinutes()) / 60) * HOUR}px`; } };
    function paintWeek() {
      const keep = viewEl.querySelector('.calendar-wscroll')?.scrollTop;
      const start = monday(cursor);
      const tdy = ymd(new Date());
      const sel = ymd(cursor);
      const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
      nowLine = null;
      const head = h('div.calendar-whead', h('span'), days.map((day, i) => {
        const key = ymd(day);
        return h('button.calendar-wday', { type: 'button', class: [key === tdy && 'is-today', key === sel && 'is-sel'].filter(Boolean).join(' '), dataset: { date: key }, onclick: () => goto(day) },
          h('span', DOW[i]), h('b', String(day.getDate())));
      }));
      const allday = h('div.calendar-allday', h('span.calendar-gut', 'ganzt.'), days.map((day) => {
        const key = ymd(day);
        return h('div.calendar-adcol', { dataset: { date: key } }, eventsOn(key).filter((e) => e.allDay).map((ev) => evButton(ev, 'chip')));
      }));
      const grid = h('div.calendar-wgrid',
        h('div.calendar-hours', Array.from({ length: 23 }, (_, i) => h('span', { style: { top: `${(i + 1) * HOUR}px` } }, `${pad2(i + 1)}:00`))),
        days.map((day, i) => {
          const key = ymd(day);
          const col = h('div.calendar-col', { class: [key === tdy && 'is-today', i > 4 && 'is-weekend'].filter(Boolean).join(' '), dataset: { date: key } });
          for (const b of layoutDay(eventsOn(key).filter((e) => !e.allDay))) {
            const el = evButton(b.ev, 'blk');
            const w = 100 / b.cols;
            Object.assign(el.style, { top: `${(b.s / 60) * HOUR + 1}px`, height: `${Math.max(17, ((b.e - b.s) / 60) * HOUR - 2)}px`, left: `calc(${b.col * w}% + 2px)`, width: `calc(${w}% - 4px)` });
            col.append(el);
          }
          if (key === tdy) { nowLine = h('i.calendar-now'); col.append(nowLine); }
          return col;
        }));
      placeNow();
      const scroll = h('div.calendar-wscroll.scroll', h('div.calendar-wtop', head, allday), grid);
      grid.addEventListener('dblclick', (e) => {
        const col = e.target.closest('.calendar-col');
        if (!col || e.target.closest('button')) return;
        const m = Math.floor((((e.clientY - col.getBoundingClientRect().top) / HOUR) * 60) / 30) * 30;
        edit(null, { date: col.dataset.date, start: Math.min(23 * 60, Math.max(0, m)) });
      });
      allday.addEventListener('dblclick', (e) => {
        const col = e.target.closest('.calendar-adcol');
        if (col && !e.target.closest('button')) edit(null, { date: col.dataset.date, allDay: true });
      });
      viewEl.replaceChildren(scroll);
      if (needScroll || keep == null) {
        const n = new Date();
        const hour = days.some((day) => ymd(day) === tdy) ? Math.max(0, n.getHours() - 2) : 7;
        requestAnimationFrame(() => { scroll.scrollTop = hour * HOUR; });
        if (viewEl.clientHeight) needScroll = false;
      } else scroll.scrollTop = keep;
    }

    function markSelection() {
      const sel = ymd(cursor);
      for (const el of viewEl.querySelectorAll('.calendar-cell, .calendar-wday')) el.classList.toggle('is-sel', el.dataset.date === sel);
    }
    function paintView() { if (view === 'month') paintMonth(); else paintWeek(); }
    function paintAll() { paintHead(); paintMini(); paintCals(); viewEl.dataset.dir = ''; paintView(); refocus(); }
    /** Nach dem Neuzeichnen kann das fokussierte Element verschwunden sein – Tastenkürzel sollen weiter gehen. */
    function refocus() { if (sys.wm.focused === win && !win.el.contains(document.activeElement)) win.el.focus({ preventScroll: true }); }

    // ---------- Laufendes ----------
    const onData = () => paintAll();
    addEventListener(EVT, onData);
    const ro = new ResizeObserver(() => {
      if (view === 'month') { if (calcFit() !== fit) { viewEl.dataset.dir = ''; paintMonth(); } }
      else if (needScroll) paintWeek();
    });
    ro.observe(viewEl);
    let shownDay = ymd(new Date());
    const clock = setInterval(() => {
      const t = ymd(new Date());
      if (t !== shownDay) { shownDay = t; paintAll(); } else placeNow();
    }, 30000);

    const onKey = (e) => {
      if (e.altKey || e.metaKey || e.ctrlKey || e.target.closest('input, textarea, select, [contenteditable]')) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const act = { ArrowLeft: () => step(-1), ArrowRight: () => step(1), t: () => goto(midnight()), m: () => setView('month'), w: () => setView('week'), n: () => edit(null) }[k];
      if (act) { e.preventDefault(); act(); }
    };
    win.el.addEventListener('keydown', onKey);

    function openArgs(a) {
      if (a?.event) {
        const ev = d.events.find((e) => e.id === a.event);
        if (ev) { goto(fromYmd(ev.date)); setTimeout(() => edit(ev), 350); }
      } else if (a?.date) goto(fromYmd(a.date));
    }

    paintAll();
    openArgs(args);

    return {
      onClose() {
        removeEventListener(EVT, onData);
        ro.disconnect();
        clearInterval(clock);
        win.el.removeEventListener('keydown', onKey);
      },
      onFocus: refocus,
      onArgs: openArgs,
      menus: () => [
        { label: 'Termin', items: [
          { label: 'Neuer Termin …', icon: 'plus', hint: 'N', run: () => edit(null) },
          { label: 'Neuer ganztägiger Termin …', run: () => edit(null, { allDay: true }) },
        ] },
        { label: 'Ansicht', items: [
          { label: 'Monat', hint: 'M', checked: view === 'month', run: () => setView('month') },
          { label: 'Woche', hint: 'W', checked: view === 'week', run: () => setView('week') },
          '-',
          { label: 'Heute', hint: 'T', run: () => goto(midnight()) },
          { label: 'Zurück', icon: 'chevronLeft', hint: '←', run: () => step(-1) },
          { label: 'Weiter', icon: 'chevronRight', hint: '→', run: () => step(1) },
        ] },
        { label: 'Kalender', items: calMenu() },
      ],
    };
  },

  background() { startService(); },

  widgets: {
    today(el) {
      const box = h('div.calendar-w');
      el.append(box);
      const paint = () => {
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const t0 = ymd(now);
        const t1 = ymd(addDays(now, 1));
        const next = [
          ...eventsOn(t0).filter((e) => e.allDay || mins(e.end) > nowMin),
          ...eventsOn(t1),
        ].slice(0, 2);
        box.replaceChildren(
          h('div.calendar-w-day', now.toLocaleDateString('de-DE', { weekday: 'long' })),
          h('div.calendar-w-num', String(now.getDate()), h('span', now.toLocaleDateString('de-DE', { month: 'long' }))),
          h('div.calendar-w-list', next.length
            ? next.map((ev) => h('div.calendar-w-ev', { style: { '--c': calOf(ev).color } }, h('b', ev.title),
              h('span', `${ev.date === t1 ? 'Morgen' : 'Heute'}, ${ev.allDay ? 'ganztägig' : ev.start}`)))
            : h('span.calendar-w-none', 'Keine Termine heute und morgen')));
      };
      paint();
      const id = setInterval(paint, 60000);
      addEventListener(EVT, paint);
      return () => { clearInterval(id); removeEventListener(EVT, paint); };
    },
  },
};
