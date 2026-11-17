// board.js — Tafel: Kanban-Tafeln mit Spalten und Karten, Ziehen & Ablegen, Filtern, WIP-Limits und JSON-Austausch

import { h, clamp, ticker, reducedMotion } from '../../../core/util.js';
import { icon } from '../../../core/icons.js';
import { sfx } from '../../../core/audio.js';
import { openMenu, closeMenu, menuAnchor } from '../../ui.js';
import { style, appStore, toolBtn, emptyState, toast, sheet, confirmSheet, promptSheet, importFiles, download, pad2 } from '../../kit.js';

// ==========================================================================
// Modell
// ==========================================================================
const LABELS = [
  { id: 'coral', name: 'Rot', c: 'var(--c-coral)' },
  { id: 'amber', name: 'Gelb', c: 'var(--c-amber)' },
  { id: 'mint', name: 'Grün', c: 'var(--c-mint)' },
  { id: 'cyan', name: 'Blau', c: 'var(--c-cyan)' },
  { id: 'violet', name: 'Violett', c: 'var(--c-violet)' },
  { id: 'grey', name: 'Grau', c: 'var(--fg-3)' },
];
const LABEL = Object.fromEntries(LABELS.map((l) => [l.id, l]));
const TINTS = ['var(--accent)', 'var(--c-cyan)', 'var(--c-mint)', 'var(--c-violet)', 'var(--c-amber)', 'var(--c-coral)'];
const ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const HISTORY = 50;

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const isoDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const dayPlus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDay(d); };
const svg = (d) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const I_MORE = svg('<circle cx="5.500" cy="12" r="1.500" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.500" fill="currentColor" stroke="none"/><circle cx="18.500" cy="12" r="1.500" fill="currentColor" stroke="none"/>');
const I_TEXT = svg('<path d="M5 7.500h14M5 12h14M5 16.500h8"/>');

/** Fälligkeit in Worten und ihr Zustand (überfällig, bald, erledigt). */
function dueInfo(due, done) {
  const [y, m, d] = due.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((date - today) / 864e5);
  const word = { '-1': 'Gestern', 0: 'Heute', 1: 'Morgen' }[diff];
  const label = word || date.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', ...(y !== today.getFullYear() ? { year: 'numeric' } : {}) });
  return { label, long: date.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), state: done ? 'done' : diff < 0 ? 'late' : diff <= 1 ? 'soon' : '' };
}

/** Prüft und säubert Daten aus Speicher oder Import. keep(id) entscheidet, ob Kennungen übernommen werden. */
function cleanCard(c, keep) {
  if (!c || typeof c !== 'object') return null;
  const title = text(c.title, 200).trim();
  if (!title) return null;
  return {
    id: keep(c.id),
    title,
    desc: text(c.desc, 4000),
    labels: Array.isArray(c.labels) ? [...new Set(c.labels.filter((l) => Object.hasOwn(LABEL, l)))] : [],
    due: /^\d{4}-\d{2}-\d{2}$/.test(c.due) ? c.due : '',
    checklist: (Array.isArray(c.checklist) ? c.checklist : []).slice(0, 100)
      .map((i) => (i && text(i.text, 200).trim() ? { id: keep(i.id), text: text(i.text, 200).trim(), done: !!i.done } : null)).filter(Boolean),
    created: Number(c.created) || Date.now(),
  };
}
function cleanBoard(b, fresh = true) {
  if (!b || typeof b !== 'object' || !Array.isArray(b.cols)) return null;
  const keep = (v) => (!fresh && typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : uid());
  const labelNames = {};
  if (b.labelNames && typeof b.labelNames === 'object') {
    for (const l of LABELS) { const n = text(b.labelNames[l.id], 24).trim(); if (n) labelNames[l.id] = n; }
  }
  return {
    id: keep(b.id),
    name: text(b.name, 60).trim() || 'Tafel',
    tint: clamp(Number(b.tint) | 0, 0, TINTS.length - 1),
    labelNames,
    cols: b.cols.slice(0, 40).map((c) => (c && typeof c === 'object' ? {
      id: keep(c.id),
      name: text(c.name, 40).trim() || 'Spalte',
      limit: clamp(Number(c.limit) | 0, 0, 999),
      done: !!c.done,
      cards: (Array.isArray(c.cards) ? c.cards : []).slice(0, 1000).map((k) => cleanCard(k, keep)).filter(Boolean),
    } : null)).filter(Boolean),
  };
}
const newCard = (title) => ({ id: uid(), title, desc: '', labels: [], due: '', checklist: [], created: Date.now() });
const newCol = (name, done = false) => ({ id: uid(), name, limit: 0, done, cards: [] });
const blankBoard = (name, tint = 0) => ({ id: uid(), name, tint, labelNames: {}, cols: [newCol('Offen'), newCol('In Arbeit'), newCol('Fertig', true)] });

function sampleBoard() {
  const card = (title, o = {}) => ({
    ...newCard(title), desc: o.desc || '', labels: o.labels || [], due: o.due == null ? '' : dayPlus(o.due),
    checklist: (o.list || []).map(([t, done]) => ({ id: uid(), text: t, done: !!done })),
  });
  return {
    id: uid(), name: 'Website-Neustart', tint: 0,
    labelNames: { coral: 'Dringend', amber: 'Text', mint: 'Technik', cyan: 'Gestaltung', violet: 'Idee' },
    cols: [
      { ...newCol('Offen'), cards: [
        card('Probier es aus: Zieh diese Karte nach „In Arbeit“', { labels: ['violet'], desc: 'Karten lassen sich auch mit ⌥ und den Pfeiltasten verschieben. Ein Rechtsklick zeigt weitere Möglichkeiten.' }),
        card('Texte für die Startseite schreiben', { labels: ['amber'], due: 6, desc: 'Kurz, freundlich, ohne Fachwörter. Drei Absätze reichen.', list: [['Überschrift', true], ['Einleitung'], ['Über uns']] }),
        card('Fotos vom Team auswählen', { labels: ['cyan'] }),
        card('Kontaktformular testen', { labels: ['mint'], due: 9 }),
      ] },
      { ...newCol('In Arbeit'), limit: 3, cards: [
        card('Farben und Schriften festlegen', { labels: ['cyan', 'coral'], due: 1, list: [['Hauptfarbe', true], ['Akzentfarbe', true], ['Schrift für Überschriften'], ['Kontraste prüfen']] }),
        card('Navigation entwerfen', { labels: ['cyan'], desc: 'Höchstens fünf Punkte. Auf dem Telefon als Menü zum Aufklappen.' }),
      ] },
      { ...newCol('Fertig', true), cards: [
        card('Domain registrieren', { labels: ['mint'], list: [['Namen prüfen', true], ['Bestellen', true]] }),
        card('Ziele der neuen Seite sammeln', { due: -3 }),
      ] },
    ],
  };
}

function loadData(db) {
  const raw = db.get('data', null);
  if (raw && Array.isArray(raw.boards)) {
    const boards = raw.boards.map((b) => cleanBoard(b, false)).filter(Boolean);
    return { boards, current: boards.some((b) => b.id === raw.current) ? raw.current : boards[0]?.id || null };
  }
  const b = sampleBoard();
  return { boards: [b], current: b.id };
}

// ==========================================================================
// Stile
// ==========================================================================
style('board', `
.board { position: relative; }
.board-side { overflow-y: auto; }
.kit-side > .board-side-add { margin-top: 6px; color: var(--fg-3); }
.board-bar { flex-wrap: wrap; row-gap: 6px; }
.board-name { display: inline-flex; align-items: center; gap: 3px; flex: 0 1 auto; min-width: 0; max-width: 250px; padding: 5px 6px 5px 8px; border: 0; border-radius: 9px; background: none; font-size: 14.5px; font-weight: 700; letter-spacing: -.01em; }
.board-name:hover, .board-name.is-open { background: var(--raise); }
.board-name span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.board-name i { display: grid; flex: none; color: var(--fg-3); }
.board-name .ico { width: 14px; height: 14px; }
.board-search { flex: 1 1 120px; max-width: 230px; }
.board-dots { display: flex; flex: none; }
.board-dot { display: grid; place-items: center; width: 22px; height: 28px; padding: 0; border: 0; border-radius: 8px; background: none; }
.board-dot i { width: 12px; height: 12px; border-radius: 50%; background: var(--c); opacity: .6; outline: 1.5px solid transparent; outline-offset: 2px; transition: transform .4s var(--spring), opacity .15s, outline-color .15s; }
.board-dot:hover i { opacity: .95; transform: scale(1.15); }
.board-dot[aria-pressed="true"] i { opacity: 1; outline-color: var(--c); }
.board-dot:disabled { visibility: hidden; }
.board-clear { cursor: pointer; }
.board-clear .ico { width: 12px; height: 12px; stroke-width: 2.4; }

.board-cols { position: relative; display: flex; align-items: flex-start; gap: 12px; flex: 1; min-height: 0; padding: 14px; overflow-x: auto; overflow-y: hidden; }
.board-cols::after { content: ""; flex: none; width: 2px; height: 1px; }
.board-col { position: relative; display: flex; flex-direction: column; flex: none; width: min(248px, calc(100cqw - 64px)); max-height: 100%; border-radius: 16px; background: var(--well); box-shadow: inset 0 0 0 .5px var(--line); transition: transform .45s var(--spring-soft), box-shadow .2s; }
.board-col.is-over { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--c-coral) 80%, transparent); }
.board-col-head { display: flex; align-items: center; gap: 6px; flex: none; min-height: 40px; padding: 6px 6px 4px 12px; cursor: grab; touch-action: none; }
.board-col-head .sp { flex: 1; }
.board-col-name { min-width: 0; margin-left: -5px; padding: 2px 5px; border-radius: 6px; font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.board-col-name:focus-visible { outline-offset: 0; }
.board-col-name:has(.board-inline) { flex: 1 1 auto; width: 100%; overflow: visible; }
.board-count { flex: none; min-width: 22px; padding: 1px 7px; border-radius: 99px; background: var(--raise); font-size: 11.5px; font-weight: 650; text-align: center; color: var(--fg-3); font-variant-numeric: tabular-nums; }
.board-col.is-over .board-count { background: var(--c-coral); color: #fff; }
.board-done { display: grid; flex: none; color: var(--c-mint); }
.board-done .ico { width: 14px; height: 14px; stroke-width: 2.6; }
.board-col-more { width: 26px; height: 26px; }
.board-cards { position: relative; display: flex; flex-direction: column; gap: 7px; flex: 0 1 auto; min-height: 34px; padding: 3px 8px 7px; overflow-x: hidden; overflow-y: auto; }
.board-card { position: relative; display: grid; gap: 6px; flex: none; padding: 9px 11px 10px; border-radius: 11px; background: var(--raise); box-shadow: inset 0 0 0 .5px var(--line), 0 1px 2px rgba(0, 0, 14, .14); font-size: 13px; cursor: grab; transition: transform .45s var(--spring-soft), background-color .15s; -webkit-tap-highlight-color: transparent; }
[data-theme="light"] .board-card { background: var(--raise-2); }
.board-card:hover { background: var(--raise-2); }
[data-theme="light"] .board-card:hover { background: var(--solid); }
.board-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-radius: 11px; }
.board-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.board-tags i { width: 30px; height: 6px; border-radius: 99px; background: var(--c); }
.board-card-title { font-weight: 550; line-height: 1.35; overflow-wrap: anywhere; }
.board-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; min-height: 18px; font-size: 11.5px; font-weight: 600; color: var(--fg-3); font-variant-numeric: tabular-nums; }
.board-meta .ico { width: 12px; height: 12px; stroke-width: 2.2; }
.board-due, .board-chk { display: inline-flex; align-items: center; gap: 4px; }
.board-due { padding: 1px 7px 1px 5px; border-radius: 99px; background: var(--well); }
.board-due.is-late { background: color-mix(in srgb, var(--c-coral) 24%, transparent); color: color-mix(in srgb, var(--c-coral) 70%, var(--fg)); }
.board-due.is-soon { background: color-mix(in srgb, var(--c-amber) 26%, transparent); color: color-mix(in srgb, var(--c-amber) 58%, var(--fg)); }
.board-due.is-done, .board-chk.is-full { color: color-mix(in srgb, var(--c-mint) 58%, var(--fg)); }
.board-chk-bar { width: 34px; height: 4px; border-radius: 9px; background: var(--well); overflow: hidden; }
.board-chk-bar i { display: block; height: 100%; border-radius: inherit; background: var(--c-mint); }
.board-desc { display: grid; }
.board-hidden { flex: none; padding: 2px 4px; font-size: 11.5px; text-align: center; color: var(--fg-3); }
.board-add { display: flex; align-items: center; gap: 6px; flex: none; margin: 0 8px 8px; padding: 6px 8px; border: 0; border-radius: 9px; background: none; font-size: 12.5px; font-weight: 600; text-align: left; color: var(--fg-3); }
.board-add:hover { background: var(--raise); color: var(--fg); }
.board-add .ico { width: 14px; height: 14px; }
.board-composer { flex: none; margin: 0 8px 8px; }
.board-composer .kit-field { width: 100%; }
.board-newcol { display: flex; align-items: center; gap: 6px; flex: none; width: 190px; padding: 11px 14px; border: 0; border-radius: 16px; background: none; outline: 1.5px dashed var(--fg-4); outline-offset: -1.5px; font-size: 13px; font-weight: 600; color: var(--fg-3); }
.board-newcol:hover { background: var(--raise); color: var(--fg); }
.board-newcol .ico { width: 15px; height: 15px; }
.board-inline { display: block; width: 100%; min-width: 60px; padding: 1px 5px; border: 0; border-radius: 6px; outline: 2px solid var(--accent); background: var(--solid); color: var(--fg); font: inherit; cursor: text; }
.board-blank { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.board-blank .kit-btn { margin-top: 6px; }

/* Ziehen: Platzhalter, schwebende Kopie, neue Elemente */
.board-card.is-ph, .board-col.is-ph { background: color-mix(in srgb, var(--accent) 13%, transparent); box-shadow: none; outline: 1.5px dashed color-mix(in srgb, var(--accent) 70%, transparent); outline-offset: -1.5px; }
.board-card.is-ph > *, .board-col.is-ph > * { visibility: hidden; }
@keyframes board-pop { from { opacity: 0; scale: .9; } }
.board-card.is-new, .board-col.is-new { animation: board-pop .42s var(--spring-soft) both; }
.board-ghost { position: absolute; left: 0; top: 0; z-index: 30; margin: 0; max-height: none; pointer-events: none; will-change: transform; transition: none; animation: none; }
.board-card.board-ghost, .board-col.board-ghost { background: color-mix(in srgb, var(--solid) 86%, transparent); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); box-shadow: 0 26px 48px -14px rgba(0, 0, 14, .6), 0 6px 14px -6px rgba(0, 0, 14, .38), inset 0 0 0 .5px var(--glass-edge); }
.board.is-dragging, .board.is-dragging * { cursor: grabbing !important; }
.board.is-dragging .board-card:not(.board-ghost):not(.is-ph):hover { background: var(--raise); }
[data-theme="light"] .board.is-dragging .board-card:not(.board-ghost):not(.is-ph):hover { background: var(--raise-2); }

/* Karte bearbeiten */
.board-fit { flex: 1 1 auto; min-height: 0; margin: 0 -6px; padding: 2px 6px; }
/* gleicht den Abzug aus, den der Baukasten von der Höhe des Sheets nimmt – sonst rollt der Inhalt grundlos um 14 px */
.kit-sheet:has(> .board-fit) { margin-bottom: 14px; }
.board-sheet { display: grid; align-content: start; gap: 12px; }
.board-f { display: grid; gap: 5px; min-width: 0; }
.board-f-title.kit-field { font-size: 15px; font-weight: 650; }
.board-f-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
.board-f-due { display: flex; align-items: center; gap: 4px; min-width: 0; }
.board-f-due .kit-field { flex: 1; }
.board-f-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.board-tagchip { cursor: pointer; transition: background-color .15s, box-shadow .15s; }
.board-tagchip .kit-dot { width: 9px; height: 9px; }
.board-tagchip[aria-pressed="true"] { background: color-mix(in srgb, var(--c) 26%, transparent); box-shadow: inset 0 0 0 1.5px var(--c); color: var(--fg); }
.board-f-chead { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
.board-f-chead .kit-muted { font-size: 12px; }
.board-f-list { display: grid; gap: 1px; }
.board-f-item { display: flex; align-items: center; gap: 8px; min-width: 0; }
.board-f-item input { flex: 1; min-width: 0; padding: 4px 6px; border: 0; outline: 0; border-radius: 7px; background: none; font-size: 13.5px; }
.board-f-item input:focus { background: var(--well); }
.board-f-item.is-done input { color: var(--fg-3); text-decoration: line-through; }
.board-f-item .tool { width: 24px; height: 24px; opacity: 0; }
.board-f-item:hover .tool, .board-f-item:focus-within .tool { opacity: 1; }
.kit-sheet-btns > .board-btn-del { margin-right: auto; color: color-mix(in srgb, var(--c-coral) 78%, var(--fg)); }
.board-lab { display: grid; align-content: start; gap: 8px; }
.board-lab label { display: flex; align-items: center; gap: 10px; }
.board-lab .kit-dot { width: 14px; height: 14px; }

@container win (max-width: 560px) {
  .board-search { order: 9; flex: 1 0 100%; max-width: none; }
  .board-cols { padding: 10px; gap: 10px; }
  .board-f-row { grid-template-columns: 1fr; }
}
`);

// ==========================================================================
// App
// ==========================================================================
export default {
  singleton: true,
  width: 1000, height: 600, minW: 420, minH: 360,

  mount(win) {
    const db = appStore('board');
    const firstRun = db.get('data', null) == null;
    let data = loadData(db);
    const undo = [];
    const redo = [];
    const fl = new Set();       // aktive Etiketten-Filter
    const flyers = new Set();   // Karten, die gerade in eine andere Spalte gleiten
    let q = '';                 // Suchtext (klein geschrieben)
    let composer = null;        // Spalte, in der gerade eine neue Karte getippt wird
    let scrollEnd = null;       // Spalte, deren Liste nach dem Zeichnen ans Ende rollt
    let wantFocus = null;       // {card} | {col}: nach dem Zeichnen fokussieren
    let dnd = null;             // laufendes Ziehen
    let disarm = null;          // entfernt die Fenster-Listener eines begonnenen Zeigerdrucks
    let pressing = false;       // Zeiger ist gedrückt → Neuzeichnen warten lassen (sonst gehen Klicks verloren)
    let queued = null;
    let rendering = false;
    let justDragged = false;
    let closed = false;
    let saveTimer = 0;
    let sheetFit = null;        // beobachtet die Fenstergröße, solange ein hohes Sheet offen ist

    // ---------- Gerüst ----------
    const side = h('nav.kit-side.board-side.scroll', { 'aria-label': 'Tafeln' });
    const nameBtn = h('button.board-name', { type: 'button', title: 'Tafel wechseln', 'aria-haspopup': 'menu' }, h('span'), h('i', { html: icon('chevronDown') }));
    const search = h('input.kit-field', { type: 'text', placeholder: 'Karten suchen', 'aria-label': 'Karten suchen', spellcheck: false, autocomplete: 'off' });
    const dotBtns = LABELS.map((l) => h('button.board-dot', { type: 'button', 'aria-pressed': 'false', style: { '--c': l.c }, dataset: { label: l.id } }, h('i')));
    const dots = h('div.board-dots', { role: 'group', 'aria-label': 'Nach Etikett filtern' }, dotBtns);
    const clearBtn = h('button.kit-chip.board-clear', { type: 'button', hidden: true, title: 'Suche und Etiketten-Filter aufheben', html: icon('close') }, 'Filter');
    const bAddCol = toolBtn('plus', 'Neue Spalte', () => addCol());
    const bMore = h('button.tool', { type: 'button', 'aria-label': 'Weitere Aktionen', title: 'Weitere Aktionen', 'aria-haspopup': 'menu', html: I_MORE });
    const bUndo = toolBtn('undo', 'Rückgängig', () => doUndo());
    const bRedo = toolBtn('redo', 'Wiederholen', () => doRedo());
    const bar = h('div.kit-bar.board-bar', nameBtn, h('label.kit-search.board-search', { html: icon('search') }, search), dots, clearBtn, h('span.sp'), bAddCol, bMore);
    const cols = h('div.board-cols.scroll');
    const blank = h('div.board-blank', { hidden: true });
    const live = h('div.sr-only', { 'aria-live': 'polite' });
    const root = h('div.kit-app.board', h('div.kit-split.board-split', side, h('div.kit-main', bar, cols, blank)), live);
    win.tools.append(bUndo, bRedo);
    win.body.append(root);

    // ---------- Zugriff ----------
    const board = () => data.boards.find((b) => b.id === data.current) || null;
    const boardById = (id) => data.boards.find((b) => b.id === id) || null;
    const labelName = (b, id) => b?.labelNames?.[id] || LABEL[id].name;
    const findCol = (id) => board()?.cols.find((c) => c.id === id) || null;
    const findCard = (id) => {
      for (const col of board()?.cols || []) {
        const idx = col.cards.findIndex((c) => c.id === id);
        if (idx >= 0) return { col, idx, card: col.cards[idx] };
      }
      return null;
    };
    const filtering = () => !!q || fl.size > 0;
    const matches = (card, b) => {
      if (fl.size && !card.labels.some((l) => fl.has(l))) return false;
      if (!q) return true;
      return [card.title, card.desc, ...card.checklist.map((i) => i.text), ...card.labels.map((l) => labelName(b, l))].join('\n').toLowerCase().includes(q);
    };
    const cardNode = (id) => cols.querySelector(`.board-card[data-card="${CSS.escape(id)}"]`);
    const colNode = (id) => cols.querySelector(`.board-col[data-col="${CSS.escape(id)}"]`);
    const say = (msg) => { live.textContent = msg; };

    // ---------- Speichern, Rückgängig ----------
    const persist = () => {
      clearTimeout(saveTimer);
      if (!db.set('data', data) && !closed) toast(win, 'Speicher voll – die Änderung wurde nicht gesichert');
    };
    const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 180); };
    const record = (before) => {
      undo.push(before);
      if (undo.length > HISTORY) undo.shift();
      redo.length = 0;
      save();
    };
    /** Führt eine Änderung am Modell aus, merkt sie für „Rückgängig“ und zeichnet neu. */
    function change(fn, anim = true) {
      const before = JSON.stringify(data);
      fn();
      if (JSON.stringify(data) === before) return false;
      record(before);
      render(anim);
      return true;
    }
    function timeTravel(from, to, empty) {
      if (!from.length) { toast(win, empty); return; }
      to.push(JSON.stringify(data));
      data = JSON.parse(from.pop());
      composer = null;
      save();
      render(true);
    }
    const doUndo = () => timeTravel(undo, redo, 'Nichts zum Widerrufen');
    const doRedo = () => timeTravel(redo, undo, 'Nichts zum Wiederholen');

    // ==========================================================================
    // Zeichnen
    // ==========================================================================
    function cardEl(card, col, b) {
      const total = card.checklist.length;
      const done = card.checklist.filter((i) => i.done).length;
      const meta = [];
      if (card.due) {
        const d = dueInfo(card.due, col.done);
        meta.push(h('span.board-due', { class: d.state ? `is-${d.state}` : '', title: `Fällig: ${d.long}`, html: icon(d.state === 'done' ? 'check' : 'clock') }, d.label));
      }
      if (total) {
        meta.push(
          h('span.board-chk', { class: done === total ? 'is-full' : '', title: `Checkliste: ${done} von ${total} erledigt`, html: icon('check') }, `${done}/${total}`),
          h('span.board-chk-bar', h('i', { style: { width: `${(done / total) * 100}%` } })));
      }
      if (card.desc.trim()) meta.push(h('span.board-desc', { title: 'Hat eine Beschreibung', html: I_TEXT }));
      return h('div.board-card', { tabIndex: 0, role: 'button', dataset: { card: card.id }, 'aria-label': `Karte „${card.title}“ in ${col.name}` },
        card.labels.length ? h('div.board-tags', card.labels.map((l) => h('i', { style: { '--c': LABEL[l].c }, title: labelName(b, l) }))) : null,
        h('div.board-card-title', card.title),
        meta.length ? h('div.board-meta', meta) : null);
    }

    function composerEl(col) {
      const input = h('input.kit-field', { type: 'text', placeholder: 'Titel – Enter legt die Karte an', 'aria-label': `Neue Karte in ${col.name}`, maxLength: 200, spellcheck: false, autocomplete: 'off' });
      const commit = () => {
        const t = input.value.trim();
        if (!t) return false;
        input.value = '';
        addCard(col.id, t);
        return true;
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); scrollEnd = col.id; commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); composer = null; wantFocus = { col: col.id }; render(); }
      });
      input.addEventListener('blur', () => {
        if (rendering || !input.isConnected || composer !== col.id) return;
        composer = null;
        if (!commit()) render();
      });
      return h('div.board-composer', input);
    }

    function colEl(col, b) {
      const shown = col.cards.filter((c) => matches(c, b));
      const hidden = col.cards.length - shown.length;
      const over = col.limit > 0 && col.cards.length > col.limit;
      const count = col.limit > 0 ? `${col.cards.length}/${col.limit}` : String(col.cards.length);
      return h('section.board-col', { class: over ? 'is-over' : '', dataset: { col: col.id }, 'aria-label': `Spalte ${col.name}` },
        h('header.board-col-head',
          h('span.board-col-name', { tabIndex: 0, role: 'button', title: 'Doppelklick benennt um, Ziehen verschiebt die Spalte', 'aria-label': `Spalte ${col.name}, ${col.cards.length} ${col.cards.length === 1 ? 'Karte' : 'Karten'}` }, col.name),
          h('span.board-count', { title: over ? `WIP-Limit überschritten: ${col.cards.length} von höchstens ${col.limit} Karten` : col.limit ? `${col.cards.length} von höchstens ${col.limit} Karten` : 'Karten in dieser Spalte' }, count),
          col.done ? h('span.board-done', { title: 'Erledigt-Spalte: Fälligkeiten gelten hier als geschafft', html: icon('check') }) : null,
          h('span.sp'),
          h('button.tool.board-col-more', { type: 'button', 'aria-label': `Aktionen für Spalte ${col.name}`, title: 'Aktionen', 'aria-haspopup': 'menu', html: I_MORE })),
        h('div.board-cards.scroll', shown.map((c) => cardEl(c, col, b)),
          hidden ? h('div.board-hidden', `${hidden} ${hidden === 1 ? 'Karte' : 'Karten'} ausgeblendet`) : null),
        composer === col.id ? composerEl(col) : h('button.board-add', { type: 'button', html: icon('plus') }, h('span', 'Karte hinzufügen')));
    }

    function paintSide(b) {
      side.replaceChildren(
        h('div.kit-head', 'Tafeln'),
        ...data.boards.map((x) => {
          const n = x.cols.reduce((s, c) => s + c.cards.length, 0);
          const btn = h('button', { type: 'button', class: x === b ? 'is-on' : '', title: x.name },
            h('i.kit-dot', { style: { '--c': TINTS[x.tint] } }), h('span', x.name), h('span.kit-count', String(n)));
          btn.addEventListener('click', () => selectBoard(x.id));
          btn.addEventListener('dblclick', () => renameBoard(x.id));
          btn.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); openMenu(boardItems(x.id), { x: e.clientX, y: e.clientY }); });
          return btn;
        }),
        h('button.board-side-add', { type: 'button', html: icon('plus'), onclick: () => newBoard() }, h('span', 'Neue Tafel')));
    }

    function paintBar(b) {
      nameBtn.firstChild.textContent = b ? b.name : 'Keine Tafel';
      search.disabled = !b;
      for (const btn of dotBtns) {
        const id = btn.dataset.label;
        btn.disabled = !b;
        btn.setAttribute('aria-pressed', String(fl.has(id)));
        btn.title = `Nur „${labelName(b, id)}“ zeigen`;
        btn.setAttribute('aria-label', `Filter: ${labelName(b, id)}`);
      }
      clearBtn.hidden = !filtering();
      bAddCol.disabled = !b;
      bMore.disabled = !b;
      bUndo.disabled = !undo.length;
      bRedo.disabled = !redo.length;
    }

    /** Baut die Ansicht aus dem Modell neu auf; mit anim gleiten vorhandene Karten und Spalten an ihren neuen Platz. */
    function render(anim = false) {
      if (closed) return;
      if (pressing || dnd) { queued = { anim: anim || !!queued?.anim }; return; }
      queued = null;
      for (const f of [...flyers]) endFly(f);
      const b = board();
      const act = document.activeElement;
      const keep = wantFocus || (cols.contains(act) ? { card: act.closest('.board-card')?.dataset.card, col: act.closest('.board-col-name') ? act.closest('.board-col').dataset.col : null } : null);
      wantFocus = null;
      const prev = anim && !reducedMotion.matches ? capture() : null;
      const sx = cols.scrollLeft;
      const sy = new Map([...cols.querySelectorAll(':scope > .board-col')].map((c) => [c.dataset.col, c.querySelector('.board-cards').scrollTop]));

      rendering = true;
      paintSide(b);
      paintBar(b);
      const title = b ? `${b.name} – Tafel` : 'Tafel';
      if (win.title !== title) win.setTitle(title);
      cols.hidden = !b;
      blank.hidden = !!b;
      if (b) {
        cols.replaceChildren(...b.cols.map((c) => colEl(c, b)),
          h('button.board-newcol', { type: 'button', html: icon('plus') }, h('span', b.cols.length ? 'Spalte hinzufügen' : 'Erste Spalte anlegen')));
        cols.scrollLeft = sx;
        for (const c of cols.querySelectorAll(':scope > .board-col')) {
          const list = c.querySelector('.board-cards');
          if (scrollEnd === c.dataset.col) list.scrollTop = list.scrollHeight;
          else if (sy.get(c.dataset.col)) list.scrollTop = sy.get(c.dataset.col);
        }
      } else {
        cols.replaceChildren();
        blank.replaceChildren(emptyState('grid', 'Noch keine Tafel', 'Lege eine Tafel an oder importiere eine zuvor exportierte JSON-Datei.'));
        blank.firstChild.append(
          h('button.kit-btn.primary', { type: 'button', onclick: () => newBoard() }, 'Neue Tafel'),
          h('button.kit-btn', { type: 'button', onclick: () => importBoard() }, 'Importieren …'));
      }
      scrollEnd = null;
      rendering = false;

      const typing = composer && cols.querySelector('.board-composer input');
      if (typing) typing.focus();
      else if (keep?.card && cardNode(keep.card)) cardNode(keep.card).focus();
      else if (keep?.col && colNode(keep.col)) colNode(keep.col).querySelector('.board-col-name').focus();
      // Fokus nie im Nichts lassen (etwa nach einem Menübefehl): sonst erreichen Tastenkürzel das Fenster nicht mehr
      if ((keep || document.activeElement === document.body) && !win.el.contains(document.activeElement) && win.wm.focused === win) win.el.focus({ preventScroll: true });
      if (prev) animate(prev);
    }

    // ---------- Bewegung: FLIP für alles, was seinen Platz wechselt ----------
    function capture() {
      const m = new Map();
      for (const el of cols.querySelectorAll(':scope > .board-col')) {
        m.set(`c:${el.dataset.col}`, { r: el.getBoundingClientRect() });
        for (const k of el.querySelectorAll('.board-card')) m.set(`k:${k.dataset.card}`, { r: k.getBoundingClientRect(), col: el.dataset.col });
      }
      return m;
    }
    function play(list) {
      if (!list.length) return;
      for (const [el, dx, dy] of list) { el.style.transition = 'none'; el.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`; }
      void cols.offsetWidth;
      for (const [el] of list) { el.style.transition = ''; el.style.transform = ''; }
    }
    function animate(prev) {
      const list = [];
      for (const col of cols.querySelectorAll(':scope > .board-col')) {
        const id = col.dataset.col;
        const was = prev.get(`c:${id}`);
        if (!was) { col.classList.add('is-new'); continue; }
        const r = col.getBoundingClientRect();
        const cx = was.r.left - r.left;
        const cy = was.r.top - r.top;
        if (Math.abs(cx) > 0.5 || Math.abs(cy) > 0.5) list.push([col, cx, cy]);
        for (const el of col.querySelectorAll('.board-card')) {
          const p = prev.get(`k:${el.dataset.card}`);
          if (!p) { el.classList.add('is-new'); continue; }
          if (p.col !== id) { fly(el, p.r); continue; }
          const k = el.getBoundingClientRect();
          const dx = p.r.left - k.left - cx;      // die Spalte trägt ihre Karten mit
          const dy = p.r.top - k.top - cy;
          if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) list.push([el, dx, dy]);
        }
      }
      play(list);
    }
    /** Ordnet Elemente im DOM um (mutate) und lässt die übrigen federnd nachrücken. */
    function flip(els, mutate) {
      if (reducedMotion.matches) { mutate(); return; }
      const before = els.map((el) => el.getBoundingClientRect());
      mutate();
      for (const el of els) { el.style.transition = 'none'; el.style.transform = ''; }
      const list = [];
      els.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        const dx = before[i].left - r.left;
        const dy = before[i].top - r.top;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) list.push([el, dx, dy]);
        else el.style.transition = '';
      });
      play(list);
    }
    /** Karte wechselt die Spalte: eine Kopie gleitet über die Spaltengrenzen hinweg an den neuen Platz. */
    function fly(el, from) {
      const to = el.getBoundingClientRect();
      const rr = root.getBoundingClientRect();
      const g = el.cloneNode(true);
      g.classList.remove('is-new');
      g.classList.add('board-ghost');
      g.removeAttribute('tabindex');
      g.setAttribute('aria-hidden', 'true');
      g.style.width = `${to.width}px`;
      g.style.transform = `translate3d(${from.left - rr.left}px, ${from.top - rr.top}px, 0) scale(1.03)`;
      root.append(g);
      el.style.opacity = '0';     // nicht „visibility“: ein verstecktes Element verlöre den Tastaturfokus
      void g.offsetWidth;
      g.style.transition = 'transform .42s var(--spring-soft)';
      g.style.transform = `translate3d(${to.left - rr.left}px, ${to.top - rr.top}px, 0)`;
      const f = { g, el, t: 0 };
      f.t = setTimeout(() => endFly(f), 430);
      flyers.add(f);
    }
    function endFly(f) {
      clearTimeout(f.t);
      f.g.remove();
      f.el.style.opacity = '';
      flyers.delete(f);
    }

    // ==========================================================================
    // Ziehen & Ablegen (zeigerbasiert)
    // ==========================================================================
    function arm(e, el, kind) {
      const x0 = e.clientX;
      const y0 = e.clientY;
      const touch = e.pointerType === 'touch';
      let started = false;
      let hold = 0;
      const start = () => { started = true; begin(kind, el, x0, y0); };
      const move = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        if (ev.pointerType === 'mouse' && ev.buttons === 0) { up(ev); return; }
        if (!started) {
          const far = Math.hypot(ev.clientX - x0, ev.clientY - y0);
          if (touch && kind === 'card') { if (far > 8) off(); return; }   // Finger wischt: der Browser rollt
          if (far < 5) return;
          start();
        }
        dnd.px = ev.clientX;
        dnd.py = ev.clientY;
        hit();
      };
      const up = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        off();
        if (started) drop(ev.type === 'pointercancel');
      };
      const key = (ev) => {
        if (ev.key !== 'Escape' || !started) return;
        ev.preventDefault();
        ev.stopPropagation();
        off();
        drop(true);
      };
      const lost = () => { off(); if (started) drop(true); };
      function off() {
        clearTimeout(hold);
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        removeEventListener('pointercancel', up);
        removeEventListener('keydown', key, true);
        removeEventListener('blur', lost);
        disarm = null;
      }
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
      addEventListener('keydown', key, true);
      addEventListener('blur', lost);
      disarm = lost;
      if (touch && kind === 'card') hold = setTimeout(() => { if (el.isConnected && !dnd) start(); }, 320);   // langes Drücken hebt die Karte an
    }

    function begin(kind, el, x0, y0) {
      closeMenu();
      const r = el.getBoundingClientRect();
      const rr = root.getBoundingClientRect();
      const ghost = el.cloneNode(true);
      ghost.classList.remove('is-new');
      ghost.classList.add('board-ghost');
      ghost.setAttribute('aria-hidden', 'true');
      for (const t of [ghost, ...ghost.querySelectorAll('[tabindex]')]) t.removeAttribute('tabindex');
      ghost.style.width = `${r.width}px`;
      ghost.style.height = `${r.height}px`;
      root.append(ghost);
      if (kind === 'col') {
        const src = el.querySelector('.board-cards');
        ghost.querySelector('.board-cards').scrollTop = src.scrollTop;
      }
      el.classList.add('is-ph');
      root.classList.add('is-dragging');
      const d = {
        kind, el, ghost,
        gx: x0 - r.left, gy: y0 - r.top, w: r.width, hgt: r.height,
        x: r.left - rr.left, y: r.top - rr.top, rot: 0, px: x0, py: y0,
        home: { parent: el.parentNode, next: el.nextElementSibling },
        timer: 0,
        tick: (dt) => {
          const box = root.getBoundingClientRect();
          const tx = d.px - d.gx - box.left;
          const ty = d.py - d.gy - box.top;
          const still = reducedMotion.matches;
          const k = still ? 1 : 1 - Math.exp(-dt * 26);
          d.x += (tx - d.x) * k;
          d.y += (ty - d.y) * k;
          d.rot += ((still ? 0 : clamp((tx - d.x) * 0.22, -7, 7)) - d.rot) * (1 - Math.exp(-dt * 14));
          ghost.style.transform = `translate3d(${d.x.toFixed(1)}px, ${d.y.toFixed(1)}px, 0) rotate(${d.rot.toFixed(2)}deg) scale(1.03)`;
          if (autoScroll(dt)) hit();
        },
      };
      dnd = d;
      d.tick(0);
      ticker.add(d.tick);
      sfx.tick();
    }

    /** Rollt die Tafel bzw. die Kartenliste, wenn der Zeiger an ihren Rand kommt. */
    function autoScroll(dt) {
      let moved = false;
      const cr = cols.getBoundingClientRect();
      const E = 56;
      const vx = dnd.px < cr.left + E ? (dnd.px - cr.left - E) / E : dnd.px > cr.right - E ? (dnd.px - cr.right + E) / E : 0;
      if (vx) {
        const was = cols.scrollLeft;
        cols.scrollLeft += clamp(vx, -1.6, 1.6) * 640 * dt;
        moved = cols.scrollLeft !== was;
      }
      if (dnd.kind === 'card') {
        const list = dnd.el.parentNode;
        const lr = list.getBoundingClientRect();
        const V = 40;
        const vy = dnd.py < lr.top + V ? (dnd.py - lr.top - V) / V : dnd.py > lr.bottom - V ? (dnd.py - lr.bottom + V) / V : 0;
        if (vy) {
          const was = list.scrollTop;
          list.scrollTop += clamp(vy, -1.6, 1.6) * 520 * dt;
          moved = moved || list.scrollTop !== was;
        }
      }
      return moved;
    }

    /** Wo würde das gezogene Element landen? Platzhalter dorthin setzen, Nachbarn rücken federnd. */
    function hit() {
      const d = dnd;
      if (!d || d.landing) return;
      const colEls = [...cols.querySelectorAll(':scope > .board-col')];
      if (d.kind === 'col') {
        const cx = d.px - d.gx + d.w / 2;
        const cr = cols.getBoundingClientRect();
        const others = colEls.filter((c) => c !== d.el);
        // Layout-Maße statt Rechtecke: unabhängig von laufenden Feder-Animationen
        const ref = others.find((c) => cx < cr.left + c.offsetLeft - cols.scrollLeft + c.offsetWidth / 2) || cols.querySelector(':scope > .board-newcol');
        if (d.el.nextElementSibling === ref) return;
        flip(others, () => cols.insertBefore(d.el, ref));
        return;
      }
      let best = null;
      let dist = Infinity;
      for (const c of colEls) {
        const r = c.getBoundingClientRect();
        const dx = d.px < r.left ? r.left - d.px : d.px > r.right ? d.px - r.right : 0;
        if (dx < dist) { dist = dx; best = c; }
      }
      if (!best) return;
      const list = best.querySelector('.board-cards');
      const lr = list.getBoundingClientRect();
      const cy = d.py - d.gy + d.hgt / 2;
      const cards = [...list.querySelectorAll(':scope > .board-card')].filter((c) => c !== d.el);
      const ref = cards.find((c) => cy < lr.top + c.offsetTop - list.scrollTop + c.offsetHeight / 2) || list.querySelector(':scope > .board-hidden');
      const from = d.el.parentNode;
      if (from === list && d.el.nextElementSibling === ref) return;
      const moving = from === list ? cards : [...cards, ...[...from.querySelectorAll(':scope > .board-card')].filter((c) => c !== d.el)];
      flip(moving, () => list.insertBefore(d.el, ref));
    }

    /** Übernimmt die Lage des Platzhalters ins Modell. */
    function commitDrop(d) {
      const before = JSON.stringify(data);
      const b = board();
      if (!b) return;
      if (d.kind === 'col') {
        const order = [...cols.querySelectorAll(':scope > .board-col')].map((c) => c.dataset.col);
        b.cols.sort((x, y) => order.indexOf(x.id) - order.indexOf(y.id));
      } else {
        const f = findCard(d.el.dataset.card);
        const target = findCol(d.el.closest('.board-col')?.dataset.col);
        if (!f || !target) return;
        const prevId = d.el.previousElementSibling?.dataset.card;
        const nextId = d.el.nextElementSibling?.dataset.card;
        f.col.cards.splice(f.idx, 1);
        const pi = prevId ? target.cards.findIndex((c) => c.id === prevId) : -1;
        const ni = nextId ? target.cards.findIndex((c) => c.id === nextId) : -1;
        target.cards.splice(pi >= 0 ? pi + 1 : ni >= 0 ? ni : target.cards.length, 0, f.card);
        if (target !== f.col) say(`„${f.card.title}“ nach ${target.name} verschoben`);
      }
      if (JSON.stringify(data) !== before) record(before);
    }

    function drop(cancel) {
      const d = dnd;
      if (!d || d.landing) return;
      d.landing = true;
      ticker.remove(d.tick);
      justDragged = true;
      setTimeout(() => { justDragged = false; }, 80);
      if (cancel) {
        const sel = d.kind === 'col' ? ':scope > .board-col' : '.board-card';
        flip([...cols.querySelectorAll(sel)].filter((c) => c !== d.el), () => d.home.parent.insertBefore(d.el, d.home.next?.isConnected ? d.home.next : d.kind === 'col' ? cols.querySelector(':scope > .board-newcol') : d.home.parent.querySelector(':scope > .board-hidden')));
      } else commitDrop(d);
      const land = () => {
        d.ghost.remove();
        root.classList.remove('is-dragging');
        dnd = null;
        if (!closed) { wantFocus = d.kind === 'card' ? { card: d.el.dataset.card } : { col: d.el.dataset.col }; render(true); }
      };
      if (reducedMotion.matches) { land(); return; }
      const to = d.el.getBoundingClientRect();
      const rr = root.getBoundingClientRect();
      d.ghost.style.transition = 'transform .3s var(--spring-soft)';
      d.ghost.style.transform = `translate3d(${(to.left - rr.left).toFixed(1)}px, ${(to.top - rr.top).toFixed(1)}px, 0)`;
      d.timer = setTimeout(land, 300);
      if (!cancel) sfx.tick();
    }

    /**
     * Hält den Inhalt eines hohen Sheets so klein, dass seine Knöpfe im Fenster bleiben, und macht ihn rollbar.
     * (Die Höhenbegrenzung des Baukastens greift bei Inhalten, die höher sind als das Fenster, nicht.)
     */
    function fitSheet(body) {
      const card = body.closest('.kit-sheet');
      sheetFit?.disconnect();
      if (!card) return;
      const fit = () => {
        if (!card.isConnected) { ro.disconnect(); return; }
        body.style.maxHeight = '';
        const chrome = card.offsetHeight - body.offsetHeight;
        body.style.maxHeight = `${Math.max(80, win.body.clientHeight - 14 - chrome)}px`;
      };
      const ro = new ResizeObserver(fit);
      ro.observe(win.body);
      sheetFit = ro;
      fit();
    }

    // ==========================================================================
    // Tafeln
    // ==========================================================================
    function resetFilter(silent = false) {
      if (!filtering()) return;
      q = '';
      search.value = '';
      fl.clear();
      if (!silent) render(true);
    }
    function selectBoard(id) {
      if (id === data.current || !boardById(id)) return;
      data.current = id;
      composer = null;
      resetFilter(true);
      save();
      render();
      cols.scrollLeft = 0;
    }
    const uniqueName = (name) => {
      const names = new Set(data.boards.map((b) => b.name));
      if (!names.has(name)) return name;
      for (let k = 2; ; k++) if (!names.has(`${name} ${k}`)) return `${name} ${k}`;
    };
    async function newBoard() {
      const name = await promptSheet(win, { title: 'Neue Tafel', text: 'Sie beginnt mit den Spalten „Offen“, „In Arbeit“ und „Fertig“.', placeholder: 'Name der Tafel', ok: 'Anlegen' });
      if (!name || closed) return;
      resetFilter(true);
      change(() => {
        const b = blankBoard(name.slice(0, 60), data.boards.length % TINTS.length);
        data.boards.push(b);
        data.current = b.id;
      }, false);
    }
    async function renameBoard(id) {
      const b = boardById(id);
      if (!b) return;
      const name = await promptSheet(win, { title: 'Tafel umbenennen', value: b.name, placeholder: 'Name der Tafel', ok: 'Umbenennen' });
      const cur = boardById(id);
      if (name && cur && !closed) change(() => { cur.name = name.slice(0, 60); }, false);
    }
    function dupBoard(id) {
      const b = boardById(id);
      if (!b) return;
      resetFilter(true);
      change(() => {
        const copy = cleanBoard(JSON.parse(JSON.stringify(b)), true);
        copy.name = uniqueName(`${b.name} Kopie`.slice(0, 60));
        copy.tint = (b.tint + 1) % TINTS.length;
        data.boards.splice(data.boards.indexOf(b) + 1, 0, copy);
        data.current = copy.id;
      }, false);
    }
    async function deleteBoard(id) {
      const b = boardById(id);
      if (!b) return;
      const n = b.cols.reduce((s, c) => s + c.cards.length, 0);
      const yes = await confirmSheet(win, { title: `Tafel „${b.name}“ löschen?`, text: n ? `Sie enthält ${n} ${n === 1 ? 'Karte' : 'Karten'}. Mit „Rückgängig“ holst du sie in dieser Sitzung zurück.` : 'Die Tafel ist leer.', ok: 'Löschen', danger: true });
      const cur = boardById(id);
      if (!yes || !cur || closed) return;
      change(() => {
        const i = data.boards.indexOf(cur);
        data.boards.splice(i, 1);
        if (data.current === id) data.current = (data.boards[i] || data.boards[i - 1])?.id || null;
      }, false);
    }
    async function editLabels(id) {
      const b = boardById(id);
      if (!b) return;
      const inputs = LABELS.map((l) => h('input.kit-field', { type: 'text', value: b.labelNames[l.id] || '', placeholder: l.name, maxLength: 24, spellcheck: false, autocomplete: 'off', 'aria-label': `Name für ${l.name}` }));
      const body = h('div.board-lab.board-fit.scroll', LABELS.map((l, i) => h('label', h('i.kit-dot', { style: { '--c': l.c } }), inputs[i])));
      const pending = sheet(win, {
        title: 'Etiketten benennen', text: `Gib den Farben auf „${b.name}“ eine Bedeutung – etwa „Dringend“ oder „Idee“.`, body,
        buttons: [{ label: 'Abbrechen', value: false }, { label: 'Sichern', value: true, primary: true }], cancelValue: false,
      });
      fitSheet(body);
      const ok = await pending;
      const cur = boardById(id);
      if (!ok || !cur || closed) return;
      change(() => {
        cur.labelNames = {};
        LABELS.forEach((l, i) => { const v = inputs[i].value.trim(); if (v) cur.labelNames[l.id] = v; });
      }, false);
    }
    function exportBoard(id) {
      const b = boardById(id);
      if (!b) return;
      const out = {
        format: 'fableOS-Tafel', version: 1, exported: new Date().toISOString(),
        board: {
          name: b.name, tint: b.tint, labelNames: b.labelNames,
          cols: b.cols.map((c) => ({
            name: c.name, limit: c.limit, done: c.done,
            cards: c.cards.map((k) => ({ title: k.title, desc: k.desc, labels: k.labels, due: k.due, checklist: k.checklist.map((i) => ({ text: i.text, done: i.done })), created: k.created })),
          })),
        },
      };
      const file = `${b.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'Tafel'}.tafel.json`;
      try {
        download(file, JSON.stringify(out, null, 2), 'application/json');
        toast(win, `„${file}“ exportiert`);
      } catch { toast(win, 'Der Export hat nicht geklappt'); }
    }
    async function importBoard() {
      const files = await importFiles({ accept: '.json,application/json', as: 'text' });
      if (!files.length || closed) return;
      let b = null;
      try {
        const obj = JSON.parse(files[0].data);
        b = cleanBoard(obj?.board || obj, true);
      } catch { /* kein JSON */ }
      if (!b) {
        sheet(win, { title: 'Import nicht möglich', text: `„${files[0].name}“ enthält keine Tafel. Erwartet wird eine JSON-Datei, die mit „Exportieren“ entstanden ist.` });
        return;
      }
      resetFilter(true);
      change(() => {
        b.name = uniqueName(b.name);
        data.boards.push(b);
        data.current = b.id;
      }, false);
      const n = b.cols.reduce((s, c) => s + c.cards.length, 0);
      toast(win, `„${b.name}“ importiert · ${n} ${n === 1 ? 'Karte' : 'Karten'}`);
    }
    const boardItems = (id) => [
      { label: 'Umbenennen …', icon: 'note', run: () => renameBoard(id) },
      { label: 'Duplizieren', icon: 'copy', run: () => dupBoard(id) },
      { label: 'Etiketten benennen …', icon: 'brush', run: () => editLabels(id) },
      '-',
      { label: 'Exportieren …', icon: 'download', run: () => exportBoard(id) },
      { label: 'Importieren …', icon: 'folder', run: () => importBoard() },
      '-',
      { label: 'Tafel löschen …', icon: 'trash', run: () => deleteBoard(id) },
    ];

    // ==========================================================================
    // Spalten
    // ==========================================================================
    async function addCol() {
      if (!board()) return;
      const name = await promptSheet(win, { title: 'Neue Spalte', placeholder: 'Name der Spalte', ok: 'Anlegen' });
      const b = board();
      if (!name || !b || closed) return;
      const col = newCol(name.slice(0, 40));
      wantFocus = { col: col.id };
      change(() => { b.cols.push(col); });
      cols.scrollTo({ left: cols.scrollWidth, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }
    /** Ersetzt einen Text an Ort und Stelle durch ein Eingabefeld. */
    function inlineEdit(target, value, max, commit, back) {
      const input = h('input.board-inline', { type: 'text', value, maxLength: max, spellcheck: false, autocomplete: 'off', 'aria-label': 'Name' });
      const old = [...target.childNodes];
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        const v = input.value.trim();
        if (target.isConnected) target.replaceChildren(...old);
        if (ok && v && v !== value) commit(v);
        else back?.();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      });
      input.addEventListener('blur', () => { if (!rendering && input.isConnected) finish(true); });
      target.replaceChildren(input);
      input.focus();
      input.select();
    }
    function renameCol(id) {
      const col = findCol(id);
      const el = colNode(id)?.querySelector('.board-col-name');
      if (!col || !el) return;
      inlineEdit(el, col.name, 40, (v) => {
        const c = findCol(id);
        wantFocus = { col: id };
        if (c) change(() => { c.name = v; }, false);
      }, () => el.focus());
    }
    async function setLimit(id) {
      const col = findCol(id);
      if (!col) return;
      const input = h('input.kit-field', { type: 'number', min: 1, max: 999, step: 1, value: col.limit || '', placeholder: 'z. B. 3', inputMode: 'numeric', 'aria-label': 'Höchstzahl an Karten' });
      const res = await sheet(win, {
        title: `WIP-Limit für „${col.name}“`,
        text: 'So viele Karten dürfen höchstens gleichzeitig in dieser Spalte liegen. Werden es mehr, färbt sich die Spalte rot.',
        body: input,
        buttons: [
          ...(col.limit ? [{ label: 'Limit aufheben', value: 0 }] : []),
          { label: 'Abbrechen', value: null },
          { label: 'Festlegen', value: () => clamp(Math.round(Number(input.value)) || 0, 0, 999), primary: true },
        ],
      });
      const c = findCol(id);
      if (res == null || !c || closed) return;
      change(() => { c.limit = res; }, false);
    }
    function moveCol(id, step) {
      const b = board();
      const col = findCol(id);
      if (!b || !col) return;
      const i = b.cols.indexOf(col);
      const j = i + step;
      if (j < 0 || j >= b.cols.length) return;
      wantFocus = { col: id };
      change(() => { b.cols.splice(i, 1); b.cols.splice(j, 0, col); });
      say(`Spalte ${col.name} an Position ${j + 1} von ${b.cols.length}`);
    }
    async function deleteCol(id) {
      const col = findCol(id);
      if (!col) return;
      const n = col.cards.length;
      if (n) {
        const yes = await confirmSheet(win, { title: `Spalte „${col.name}“ löschen?`, text: `${n === 1 ? 'Die Karte' : `Alle ${n} Karten`} darin ${n === 1 ? 'wird' : 'werden'} mit gelöscht.`, ok: 'Löschen', danger: true });
        if (!yes || closed) return;
      }
      const b = board();
      const c = findCol(id);
      if (!b || !c) return;
      change(() => { b.cols.splice(b.cols.indexOf(c), 1); });
      if (!n) toast(win, `Spalte „${col.name}“ gelöscht`);
    }
    function colMenu(id, pos) {
      const b = board();
      const col = findCol(id);
      if (!b || !col) return;
      const i = b.cols.indexOf(col);
      openMenu([
        { label: 'Neue Karte', icon: 'plus', hint: 'N', run: () => openComposer(id) },
        { label: 'Umbenennen', icon: 'note', hint: 'F2', run: () => renameCol(id) },
        { label: col.limit ? `WIP-Limit ändern (${col.limit}) …` : 'WIP-Limit festlegen …', icon: 'sliders', run: () => setLimit(id) },
        { label: 'Erledigt-Spalte', icon: 'check', checked: col.done, run: () => { const c = findCol(id); if (c) change(() => { c.done = !c.done; }, false); } },
        '-',
        { label: 'Nach links', icon: 'arrowLeft', hint: '⌥←', disabled: i === 0, run: () => moveCol(id, -1) },
        { label: 'Nach rechts', icon: 'arrowRight', hint: '⌥→', disabled: i === b.cols.length - 1, run: () => moveCol(id, 1) },
        '-',
        { label: 'Spalte löschen', icon: 'trash', run: () => deleteCol(id) },
      ], pos);
    }

    // ==========================================================================
    // Karten
    // ==========================================================================
    function openComposer(colId) {
      const b = board();
      if (!b) return;
      if (!b.cols.length) { addCol(); return; }
      composer = findCol(colId) ? colId : b.cols[0].id;
      scrollEnd = composer;
      render();
    }
    function addCard(colId, title) {
      const col = findCol(colId);
      const b = board();
      if (!col) return;
      const card = newCard(title.slice(0, 200));
      if (filtering() && !matches(card, b)) {
        resetFilter(true);
        toast(win, 'Filter aufgehoben, damit die neue Karte sichtbar bleibt');
      }
      change(() => { col.cards.push(card); });
    }
    function dupCard(id) {
      const f = findCard(id);
      if (!f) return;
      const copy = cleanCard(JSON.parse(JSON.stringify(f.card)), uid);
      copy.title = `${f.card.title} (Kopie)`.slice(0, 200);
      copy.created = Date.now();
      wantFocus = { card: copy.id };
      change(() => { f.col.cards.splice(f.idx + 1, 0, copy); });
    }
    function delCard(id) {
      const f = findCard(id);
      const b = board();
      if (!f) return;
      const vis = f.col.cards.filter((c) => matches(c, b));
      const i = vis.indexOf(f.card);
      const next = vis[i + 1] || vis[i - 1];
      wantFocus = next ? { card: next.id } : { col: f.col.id };
      change(() => { f.col.cards.splice(f.idx, 1); });
      toast(win, 'Karte gelöscht · Rückgängig mit ⌘Z');
    }
    function moveCardTo(id, colId, top = false) {
      const f = findCard(id);
      const target = findCol(colId);
      if (!f || !target) return;
      wantFocus = { card: id };
      change(() => {
        f.col.cards.splice(f.idx, 1);
        if (top) target.cards.unshift(f.card); else target.cards.push(f.card);
      });
      if (target !== f.col) say(`„${f.card.title}“ nach ${target.name} verschoben`);
    }
    /** Tastatur: Karte um einen Platz bzw. in die Nachbarspalte schieben (zählt nur sichtbare Karten). */
    function moveCardBy(id, dir) {
      const f = findCard(id);
      const b = board();
      if (!f) return;
      const vis = (col) => col.cards.filter((c) => c.id === id || matches(c, b));
      const mine = vis(f.col);
      const vi = mine.indexOf(f.card);
      if (dir === 'up' || dir === 'down') {
        const other = mine[vi + (dir === 'up' ? -1 : 1)];
        if (!other) return;
        wantFocus = { card: id };
        change(() => {
          f.col.cards.splice(f.idx, 1);
          f.col.cards.splice(f.col.cards.indexOf(other) + (dir === 'up' ? 0 : 1), 0, f.card);
        });
        say(`Position ${vi + (dir === 'up' ? 0 : 2)} von ${mine.length}`);
        return;
      }
      const target = b.cols[b.cols.indexOf(f.col) + (dir === 'left' ? -1 : 1)];
      if (!target) return;
      wantFocus = { card: id };
      change(() => {
        f.col.cards.splice(f.idx, 1);
        const before = vis(target)[vi];
        target.cards.splice(before ? target.cards.indexOf(before) : target.cards.length, 0, f.card);
      });
      say(`„${f.card.title}“ nach ${target.name} verschoben`);
    }
    function renameCard(id) {
      const f = findCard(id);
      const el = cardNode(id);
      if (!f || !el) return;
      inlineEdit(el.querySelector('.board-card-title'), f.card.title, 200, (v) => {
        const g = findCard(id);
        wantFocus = { card: id };
        if (g) change(() => { g.card.title = v; }, false);
      }, () => el.focus());
    }
    function toggleLabel(id, label) {
      const f = findCard(id);
      if (!f) return;
      wantFocus = { card: id };
      change(() => {
        const i = f.card.labels.indexOf(label);
        if (i >= 0) f.card.labels.splice(i, 1);
        else f.card.labels = LABELS.map((l) => l.id).filter((l) => l === label || f.card.labels.includes(l));
      });
    }
    function cardMenu(id, pos) {
      const f = findCard(id);
      const b = board();
      if (!f) return;
      openMenu([
        { label: 'Bearbeiten …', icon: 'note', hint: '↩', run: () => editCard(id) },
        { label: 'Titel ändern', hint: 'F2', run: () => renameCard(id) },
        { label: 'Duplizieren', icon: 'copy', hint: '⌘D', run: () => dupCard(id) },
        '-',
        { heading: 'Verschieben nach' },
        ...b.cols.map((c) => ({ label: c.name, checked: c === f.col, disabled: c === f.col, run: () => moveCardTo(id, c.id) })),
        { label: 'Ganz nach oben', disabled: f.idx === 0, run: () => moveCardTo(id, f.col.id, true) },
        { label: 'Ganz nach unten', disabled: f.idx === f.col.cards.length - 1, run: () => moveCardTo(id, f.col.id) },
        '-',
        { heading: 'Etiketten' },
        ...LABELS.map((l) => ({ label: labelName(b, l.id), checked: f.card.labels.includes(l.id), run: () => toggleLabel(id, l.id) })),
        '-',
        { label: 'Löschen', icon: 'trash', hint: '⌫', run: () => delCard(id) },
      ], pos);
    }

    /** Karte im Sheet bearbeiten: Titel, Spalte, Fälligkeit, Etiketten, Beschreibung, Checkliste. */
    async function editCard(id) {
      const f = findCard(id);
      const b = board();
      if (!f) return;
      const draft = JSON.parse(JSON.stringify(f.card));
      const title = h('input.kit-field.board-f-title', { type: 'text', value: draft.title, placeholder: 'Titel', maxLength: 200, spellcheck: false, autocomplete: 'off', 'aria-label': 'Titel' });
      const desc = h('textarea.kit-field.scroll', { rows: 3, value: draft.desc, placeholder: 'Notizen, Links, Einzelheiten …', maxLength: 4000, 'aria-label': 'Beschreibung' });
      const colSel = h('select.kit-field', { 'aria-label': 'Spalte' }, b.cols.map((c) => h('option', { value: c.id, selected: c === f.col }, c.name)));
      const due = h('input.kit-field', { type: 'date', value: draft.due, 'aria-label': 'Fällig am' });
      const tags = h('div.board-f-tags', LABELS.map((l) => {
        const btn = h('button.kit-chip.board-tagchip', { type: 'button', 'aria-pressed': String(draft.labels.includes(l.id)), style: { '--c': l.c } }, h('i.kit-dot'), labelName(b, l.id));
        btn.addEventListener('click', () => {
          const on = !draft.labels.includes(l.id);
          draft.labels = LABELS.map((x) => x.id).filter((x) => (x === l.id ? on : draft.labels.includes(x)));
          btn.setAttribute('aria-pressed', String(on));
        });
        return btn;
      }));

      const list = h('div.board-f-list');
      const progress = h('div.kit-progress', h('i'));
      const progressText = h('span.kit-muted');
      const addIn = h('input.kit-field', { type: 'text', placeholder: 'Eintrag hinzufügen – Enter', maxLength: 200, spellcheck: false, autocomplete: 'off', 'aria-label': 'Neuer Eintrag der Checkliste' });
      const paintProgress = () => {
        const n = draft.checklist.length;
        const d = draft.checklist.filter((i) => i.done).length;
        progressText.textContent = n ? `${d} von ${n} erledigt` : 'Noch keine Einträge';
        progress.hidden = !n;
        progress.style.setProperty('--p', n ? d / n : 0);
      };
      const paintList = () => {
        list.replaceChildren(...draft.checklist.map((it, i) => {
          const box = h('button.kit-check', { type: 'button', role: 'checkbox', 'aria-checked': String(it.done), 'aria-label': `„${it.text}“ erledigt`, html: icon('check') });
          const inp = h('input', { type: 'text', value: it.text, maxLength: 200, spellcheck: false, autocomplete: 'off', 'aria-label': `Eintrag ${i + 1}` });
          const row = h('div.board-f-item', { class: it.done ? 'is-done' : '' }, box, inp,
            h('button.tool', { type: 'button', 'aria-label': `Eintrag „${it.text}“ entfernen`, title: 'Entfernen', html: icon('close'), onclick: () => { draft.checklist.splice(i, 1); paintList(); addIn.focus(); } }));
          box.addEventListener('click', () => {
            it.done = !it.done;
            box.setAttribute('aria-checked', String(it.done));
            row.classList.toggle('is-done', it.done);
            paintProgress();
          });
          inp.addEventListener('input', () => { it.text = inp.value; });
          inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addIn.focus(); } });
          return row;
        }));
        paintProgress();
      };
      addIn.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();
        const t = addIn.value.trim();
        if (!t || draft.checklist.length >= 100) return;
        draft.checklist.push({ id: uid(), text: t, done: false });
        addIn.value = '';
        paintList();
        addIn.scrollIntoView({ block: 'nearest' });
      });
      paintList();

      const body = h('div.board-sheet.board-fit.scroll',
        title,
        h('div.board-f-row',
          h('label.board-f', h('span.kit-label', 'Spalte'), colSel),
          h('label.board-f', h('span.kit-label', 'Fällig am'), h('div.board-f-due', due,
            h('button.tool', { type: 'button', 'aria-label': 'Fälligkeit entfernen', title: 'Fälligkeit entfernen', html: icon('close'), onclick: () => { due.value = ''; } })))),
        h('div.board-f', h('span.kit-label', 'Etiketten'), tags),
        h('label.board-f', h('span.kit-label', 'Beschreibung'), desc),
        h('div.board-f', h('div.board-f-chead', h('span.kit-label', 'Checkliste'), progressText), progress, list, addIn));
      const pending = sheet(win, {
        title: 'Karte bearbeiten', body, wide: true,
        buttons: [{ label: 'Löschen', value: 'delete' }, { label: 'Duplizieren', value: 'dup' }, { label: 'Abbrechen', value: null }, { label: 'Sichern', value: 'save', primary: true }],
      });
      body.closest('.kit-sheet')?.querySelector('.kit-sheet-btns')?.firstElementChild?.classList.add('board-btn-del');
      fitSheet(body);
      const res = await pending;
      if (!res || closed) return;
      const g = findCard(id);
      if (!g) return;
      if (res === 'delete') { delCard(id); return; }
      wantFocus = { card: id };
      change(() => {
        g.card.title = title.value.trim().slice(0, 200) || g.card.title;
        g.card.desc = desc.value.slice(0, 4000);
        g.card.labels = draft.labels;
        g.card.due = /^\d{4}-\d{2}-\d{2}$/.test(due.value) ? due.value : '';
        g.card.checklist = draft.checklist.map((i) => ({ ...i, text: i.text.trim().slice(0, 200) })).filter((i) => i.text);
        const target = findCol(colSel.value);
        if (target && target !== g.col) {
          g.col.cards.splice(g.idx, 1);
          target.cards.push(g.card);
        }
      });
      if (res === 'dup') dupCard(id);
    }

    // ==========================================================================
    // Ereignisse
    // ==========================================================================
    const onDown = () => { pressing = true; };
    const onUp = () => {
      if (!pressing) return;
      pressing = false;
      if (queued && !dnd) setTimeout(() => { if (queued && !pressing && !dnd) render(queued.anim); }, 0);
    };
    const onStray = (e) => { if (pressing && e.pointerType === 'mouse' && e.buttons === 0) onUp(); };
    root.addEventListener('pointerdown', onDown, true);
    root.addEventListener('pointermove', onStray, true);
    addEventListener('pointerup', onUp, true);
    addEventListener('pointercancel', onUp, true);

    cols.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || dnd || disarm) return;
      if (e.target.closest('input, textarea, select, button')) return;
      const card = e.target.closest('.board-card');
      const head = card ? null : e.target.closest('.board-col-head');
      if (card) arm(e, card, 'card');
      else if (head) arm(e, head.parentElement, 'col');
    });
    cols.addEventListener('touchmove', (e) => { if (dnd) e.preventDefault(); }, { passive: false });
    cols.addEventListener('click', (e) => {
      if (justDragged || dnd) return;
      const t = e.target;
      if (t.closest('input')) return;
      const more = t.closest('.board-col-more');
      if (more) {
        if (menuAnchor() === more) closeMenu();
        else colMenu(more.closest('.board-col').dataset.col, { anchor: more });
        return;
      }
      const add = t.closest('.board-add');
      if (add) { openComposer(add.closest('.board-col').dataset.col); return; }
      if (t.closest('.board-newcol')) { addCol(); return; }
      const card = t.closest('.board-card');
      if (card) editCard(card.dataset.card);
    });
    cols.addEventListener('dblclick', (e) => {
      const name = e.target.closest('.board-col-name');
      if (name && !e.target.closest('input')) renameCol(name.closest('.board-col').dataset.col);
    });
    cols.addEventListener('contextmenu', (e) => {
      if (e.target.closest('input, textarea')) return;
      e.preventDefault();
      e.stopPropagation();
      if (dnd) return;
      const pos = { x: e.clientX, y: e.clientY };
      const card = e.target.closest('.board-card');
      const col = e.target.closest('.board-col');
      if (card) { card.focus(); cardMenu(card.dataset.card, pos); }
      else if (col) colMenu(col.dataset.col, pos);
      else if (board()) openMenu([{ label: 'Neue Spalte …', icon: 'plus', run: () => addCol() }, '-', ...boardItems(data.current)], pos);
    });
    // Mausrad über der Tafel rollt seitwärts, solange die Liste darunter nichts zu rollen hat
    cols.addEventListener('wheel', (e) => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const list = e.target.closest?.('.board-cards');
      if (list && list.scrollHeight > list.clientHeight + 1) return;
      if (cols.scrollWidth <= cols.clientWidth) return;
      e.preventDefault();
      cols.scrollLeft += e.deltaY;
    }, { passive: false });

    search.addEventListener('input', () => { q = search.value.trim().toLowerCase(); render(true); });
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (search.value) { search.value = ''; q = ''; render(true); }
      else win.el.focus({ preventScroll: true });
    });
    for (const btn of dotBtns) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.label;
        if (fl.has(id)) fl.delete(id); else fl.add(id);
        render(true);
      });
    }
    clearBtn.addEventListener('click', () => resetFilter());
    nameBtn.addEventListener('click', () => {
      if (menuAnchor() === nameBtn) { closeMenu(); return; }
      nameBtn.classList.add('is-open');
      openMenu([
        { heading: 'Tafeln' },
        ...data.boards.map((b) => ({ label: b.name, checked: b.id === data.current, run: () => selectBoard(b.id) })),
        data.boards.length ? '-' : null,
        { label: 'Neue Tafel …', icon: 'plus', run: () => newBoard() },
        { label: 'Importieren …', icon: 'folder', run: () => importBoard() },
      ], { anchor: nameBtn, onClose: () => nameBtn.classList.remove('is-open') });
    });
    bMore.addEventListener('click', () => {
      if (menuAnchor() === bMore) closeMenu();
      else if (board()) openMenu(boardItems(data.current), { anchor: bMore, align: 'right' });
    });

    /** Fokus mit den Pfeiltasten von Karte zu Karte bewegen. */
    function stepFocus(el, dir) {
      const col = el.closest('.board-col');
      const mine = [...col.querySelectorAll('.board-card')];
      const i = mine.indexOf(el);
      if (dir === 'up' || dir === 'down') {
        const next = mine[i + (dir === 'up' ? -1 : 1)];
        if (next) next.focus();
        else if (dir === 'up') col.querySelector('.board-col-name').focus();
        return;
      }
      const all = [...cols.querySelectorAll(':scope > .board-col')];
      const other = all[all.indexOf(col) + (dir === 'left' ? -1 : 1)];
      if (!other) return;
      const theirs = [...other.querySelectorAll('.board-card')];
      (i >= 0 && theirs.length ? theirs[Math.min(i, theirs.length - 1)] : other.querySelector('.board-col-name')).focus();
    }
    const onKey = (e) => {
      const t = e.target;
      if (!t.closest) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && !e.altKey && key === 'f') {
        if (!board()) return;
        e.preventDefault();
        search.focus();
        search.select();
        return;
      }
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      if (mod && !e.altKey && (key === 'z' || key === 'y')) {
        e.preventDefault();
        if (key === 'y' || e.shiftKey) doRedo(); else doUndo();
        return;
      }
      const card = t.closest('.board-card');
      const name = t.closest('.board-col-name');
      const dir = ARROWS[e.key];
      if (card) {
        const id = card.dataset.card;
        if (e.altKey && !mod && dir) { e.preventDefault(); e.stopPropagation(); moveCardBy(id, dir); return; }   // ⌥+Pfeile gehören sonst dem Fenster
        if (mod && !e.altKey && key === 'd') { e.preventDefault(); dupCard(id); return; }
        if (!mod && !e.altKey) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editCard(id); return; }
          if (e.key === 'F2') { e.preventDefault(); renameCard(id); return; }
          if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); delCard(id); return; }
          if (dir) { e.preventDefault(); stepFocus(card, dir); return; }
        }
      } else if (name) {
        const id = name.closest('.board-col').dataset.col;
        if (e.altKey && !mod && dir) {
          e.preventDefault();
          e.stopPropagation();
          if (dir === 'left' || dir === 'right') moveCol(id, dir === 'left' ? -1 : 1);
          return;
        }
        if (!mod && !e.altKey) {
          if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); renameCol(id); return; }
          if (dir === 'down') { e.preventDefault(); name.closest('.board-col').querySelector('.board-card')?.focus(); return; }
          if (dir === 'left' || dir === 'right') { e.preventDefault(); stepFocus(name, dir); return; }
        }
      }
      if (!mod && !e.altKey && key === 'n' && board()) {
        e.preventDefault();
        openComposer(t.closest('.board-col')?.dataset.col);
      }
    };
    win.el.addEventListener('keydown', onKey);
    // Liegt der Fokus nirgends (z. B. nach einem abgebrochenen Dialog), gelten die Kürzel des vordersten Fensters trotzdem
    const onStrayKey = (e) => {
      if (e.target === document.body && win.wm.focused === win && !win.min && document.body.classList.contains('is-on')) onKey(e);
    };
    document.addEventListener('keydown', onStrayKey);

    // ---------- Start ----------
    if (firstRun) db.set('data', data);
    render();

    return {
      onClose() {
        closed = true;
        disarm?.();
        if (dnd) { clearTimeout(dnd.timer); ticker.remove(dnd.tick); dnd.ghost.remove(); dnd = null; }
        for (const f of [...flyers]) endFly(f);
        removeEventListener('pointerup', onUp, true);
        removeEventListener('pointercancel', onUp, true);
        win.el.removeEventListener('keydown', onKey);
        document.removeEventListener('keydown', onStrayKey);
        sheetFit?.disconnect();
        persist();
      },
      menus: () => {
        const b = board();
        return [
          {
            label: 'Tafel',
            items: [
              { label: 'Neue Tafel …', icon: 'plus', run: () => newBoard() },
              { label: 'Umbenennen …', icon: 'note', disabled: !b, run: () => renameBoard(data.current) },
              { label: 'Duplizieren', icon: 'copy', disabled: !b, run: () => dupBoard(data.current) },
              { label: 'Etiketten benennen …', icon: 'brush', disabled: !b, run: () => editLabels(data.current) },
              '-',
              { label: 'Exportieren …', icon: 'download', disabled: !b, run: () => exportBoard(data.current) },
              { label: 'Importieren …', icon: 'folder', run: () => importBoard() },
              '-',
              { label: 'Tafel löschen …', icon: 'trash', disabled: !b, run: () => deleteBoard(data.current) },
            ],
          },
          {
            label: 'Bearbeiten',
            items: [
              { label: 'Rückgängig', icon: 'undo', hint: '⌘Z', run: () => doUndo() },
              { label: 'Wiederholen', icon: 'redo', hint: '⇧⌘Z', run: () => doRedo() },
              '-',
              { label: 'Neue Karte', icon: 'plus', hint: 'N', disabled: !b, run: () => openComposer() },
              { label: 'Neue Spalte …', disabled: !b, run: () => addCol() },
              '-',
              { label: 'Karten suchen', icon: 'search', hint: '⌘F', disabled: !b, run: () => { search.focus(); search.select(); } },
              { label: 'Filter aufheben', disabled: !b, run: () => resetFilter() },
            ],
          },
        ];
      },
    };
  },
};
