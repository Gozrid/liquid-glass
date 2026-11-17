// clock.js — Uhr: Weltuhr, Wecker, Stoppuhr und Timer; Wecker und Timer laufen auch ohne Fenster weiter
import { h, ticker, clamp, reducedMotion } from '../../../core/util.js';
import { icon } from '../../../core/icons.js';
import { initControls } from '../../../core/controls.js';
import { audio, tone, audioReady } from '../../../core/audio.js';
import { sys } from '../../sys.js';
import { openMenu } from '../../ui.js';
import { style, appStore, toolBtn, emptyState, sheet, toast, pad2 } from '../../kit.js';

const S = appStore('clock');
const EVT = 'fableos:clock';
const TABS = [['world', 'Weltuhr'], ['alarm', 'Wecker'], ['stopwatch', 'Stoppuhr'], ['timer', 'Timer']];
const DOW = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const PRESETS = [1, 3, 5, 10, 15, 30, 45, 60];
const SNOOZE_MIN = 5;
const CITIES = [
  ['berlin', 'Berlin', 'Deutschland', 'Europe/Berlin'], ['london', 'London', 'Vereinigtes Königreich', 'Europe/London'],
  ['paris', 'Paris', 'Frankreich', 'Europe/Paris'], ['madrid', 'Madrid', 'Spanien', 'Europe/Madrid'],
  ['rome', 'Rom', 'Italien', 'Europe/Rome'], ['vienna', 'Wien', 'Österreich', 'Europe/Vienna'],
  ['zurich', 'Zürich', 'Schweiz', 'Europe/Zurich'], ['amsterdam', 'Amsterdam', 'Niederlande', 'Europe/Amsterdam'],
  ['stockholm', 'Stockholm', 'Schweden', 'Europe/Stockholm'], ['helsinki', 'Helsinki', 'Finnland', 'Europe/Helsinki'],
  ['athens', 'Athen', 'Griechenland', 'Europe/Athens'], ['istanbul', 'Istanbul', 'Türkei', 'Europe/Istanbul'],
  ['moscow', 'Moskau', 'Russland', 'Europe/Moscow'], ['lisbon', 'Lissabon', 'Portugal', 'Europe/Lisbon'],
  ['reykjavik', 'Reykjavík', 'Island', 'Atlantic/Reykjavik'], ['cairo', 'Kairo', 'Ägypten', 'Africa/Cairo'],
  ['lagos', 'Lagos', 'Nigeria', 'Africa/Lagos'], ['nairobi', 'Nairobi', 'Kenia', 'Africa/Nairobi'],
  ['johannesburg', 'Johannesburg', 'Südafrika', 'Africa/Johannesburg'], ['dubai', 'Dubai', 'VAE', 'Asia/Dubai'],
  ['tehran', 'Teheran', 'Iran', 'Asia/Tehran'], ['mumbai', 'Mumbai', 'Indien', 'Asia/Kolkata'],
  ['kathmandu', 'Kathmandu', 'Nepal', 'Asia/Kathmandu'], ['bangkok', 'Bangkok', 'Thailand', 'Asia/Bangkok'],
  ['singapore', 'Singapur', 'Singapur', 'Asia/Singapore'], ['hongkong', 'Hongkong', 'China', 'Asia/Hong_Kong'],
  ['beijing', 'Peking', 'China', 'Asia/Shanghai'], ['seoul', 'Seoul', 'Südkorea', 'Asia/Seoul'],
  ['tokyo', 'Tokio', 'Japan', 'Asia/Tokyo'], ['sydney', 'Sydney', 'Australien', 'Australia/Sydney'],
  ['auckland', 'Auckland', 'Neuseeland', 'Pacific/Auckland'], ['honolulu', 'Honolulu', 'USA', 'Pacific/Honolulu'],
  ['anchorage', 'Anchorage', 'USA', 'America/Anchorage'], ['losangeles', 'Los Angeles', 'USA', 'America/Los_Angeles'],
  ['denver', 'Denver', 'USA', 'America/Denver'], ['chicago', 'Chicago', 'USA', 'America/Chicago'],
  ['newyork', 'New York', 'USA', 'America/New_York'], ['toronto', 'Toronto', 'Kanada', 'America/Toronto'],
  ['mexico', 'Mexiko-Stadt', 'Mexiko', 'America/Mexico_City'], ['bogota', 'Bogotá', 'Kolumbien', 'America/Bogota'],
  ['saopaulo', 'São Paulo', 'Brasilien', 'America/Sao_Paulo'], ['buenosaires', 'Buenos Aires', 'Argentinien', 'America/Argentina/Buenos_Aires'],
  ['santiago', 'Santiago', 'Chile', 'America/Santiago'],
].map(([id, name, country, tz]) => ({ id, name, country, tz }));
const cityById = (id) => CITIES.find((c) => c.id === id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const emit = () => dispatchEvent(new CustomEvent(EVT));

// ---------- Zeitzonen ----------
const fmts = new Map();
/** Wanduhrzeit einer Zeitzone samt Abstand zur Ortszeit; null, wenn der Browser die Zone nicht kennt */
function zoneInfo(tz, now = new Date()) {
  try {
    let f = fmts.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      fmts.set(tz, f);
    }
    const p = {};
    for (const { type, value } of f.formatToParts(now)) p[type] = Number(value);
    const there = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const here = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds());
    const days = Math.round((Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
    return { h: p.hour, m: p.minute, s: p.second, diff: Math.round((there - here) / 60000), days, night: p.hour < 6 || p.hour >= 19 };
  } catch { return null; }
}
function offsetText(z) {
  const day = z.days === 0 ? 'Heute' : z.days > 0 ? 'Morgen' : 'Gestern';
  if (!z.diff) return `${day}, gleiche Zeit`;
  const a = Math.abs(z.diff);
  return `${day}, ${z.diff > 0 ? '+' : '−'}${Math.floor(a / 60)}${a % 60 ? `:${pad2(a % 60)}` : ''} Std.`;
}

// ---------- Zustand (Modul-Scope: gilt für Fenster, Widget und Hintergrunddienst) ----------
let st = null;
function state() {
  if (st) return st;
  st = {
    world: S.get('world', ['berlin', 'london', 'newyork', 'tokyo']).filter(cityById),
    alarms: S.get('alarms', [{ id: uid(), time: '07:00', label: 'Aufstehen', days: [0, 1, 2, 3, 4], on: false, last: '' }]),
    sw: { running: false, startedAt: 0, elapsed: 0, lapBase: 0, laps: [], ...S.get('sw', {}) },
    timer: { state: 'idle', total: 0, endAt: 0, left: 0, ...S.get('timer', {}) },
    pick: { h: 0, m: 5, s: 0, ...S.get('pick', {}) },
  };
  return st;
}
const keep = (key) => { S.set(key, st[key]); emit(); };

// ---------- Töne: eigener Pegel, damit „Stopp“ sofort still ist ----------
let ringGain = null;
function hush() {
  if (!ringGain) return;
  const g = ringGain;
  ringGain = null;
  try {
    g.gain.setTargetAtTime(0.0001, audio().ctx.currentTime, 0.03);
    setTimeout(() => g.disconnect(), 400);
  } catch { /* egal */ }
}
function playPattern(kind) {
  if (!audioReady()) return;             // ohne Nutzergeste erlaubt der Browser keinen Ton
  try {
    const { ctx, out } = audio();
    if (!ringGain) { ringGain = ctx.createGain(); ringGain.connect(out); }
    const dest = ringGain;
    if (kind === 'alarm') {
      // zwei helle Doppelschläge
      for (const base of [0, 0.86]) {
        [987.77, 1318.5, 987.77, 1318.5].forEach((f, i) => {
          tone({ type: 'triangle', f, dur: 0.12, vol: 0.26, when: base + i * 0.13, dest });
          tone({ f: f * 2, dur: 0.09, vol: 0.05, when: base + i * 0.13, dest });
        });
      }
    } else {
      // sanfter Dreiklang
      [783.99, 1046.5, 1318.5].forEach((f, i) => {
        tone({ f, dur: 0.7, vol: 0.2, attack: 0.008, when: i * 0.17, dest });
        tone({ type: 'triangle', f: f * 2, dur: 0.35, vol: 0.04, when: i * 0.17, dest });
      });
    }
  } catch { /* Audio nicht verfügbar */ }
}

// ---------- Klingeln ----------
let ring = null;       // {kind, title, body, alarm?, started, loop}
function stopRing() {
  if (!ring) return;
  clearInterval(ring.loop);
  const { note } = ring;
  ring = null;
  hush();
  note?.close();          // die eigene Mitteilung wegräumen, sobald gestoppt wurde
  emit();
}
function startRing(info) {
  if (ring) { clearInterval(ring.loop); hush(); }
  const maxMs = info.kind === 'alarm' ? 45000 : 16000;
  ring = { ...info, started: Date.now() };
  const mine = ring;
  const beat = () => {
    if (ring !== mine) return;
    if (Date.now() - mine.started > maxMs) { stopRing(); return; }
    playPattern(info.kind);
  };
  ring.loop = setInterval(beat, info.kind === 'alarm' ? 1900 : 1700);
  beat();
  mine.note = sys.notify({
    title: info.title, body: info.body, app: 'clock', force: true, ttl: maxMs,
    onClick: () => { stopRing(); sys.open('clock', { tab: info.kind === 'alarm' ? 'alarm' : 'timer' }); },
  });
  emit();
}
function snooze() {
  if (!ring || ring.kind !== 'alarm') return;
  const t = new Date(Date.now() + SNOOZE_MIN * 60000);
  state().alarms.push({ id: uid(), time: `${pad2(t.getHours())}:${pad2(t.getMinutes())}`, label: ring.label || 'Wecker', days: [], on: true, last: '', temp: true });
  S.set('alarms', st.alarms);
  stopRing();
}

// ---------- Wecker ----------
const daysText = (a) => {
  const d = [...a.days].sort();
  if (a.temp) return 'Schlummert';
  if (!d.length) return 'Einmalig';
  if (d.length === 7) return 'Jeden Tag';
  if (d.join() === '0,1,2,3,4') return 'Werktags';
  if (d.join() === '5,6') return 'Am Wochenende';
  return d.map((i) => DOW[i]).join(', ');
};
/** Nächster Zeitpunkt, zu dem der Wecker klingelt */
function nextRing(a, now = new Date()) {
  const [hh, mm] = a.time.split(':').map(Number);
  for (let i = 0; i < 8; i++) {
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, hh, mm, 0, 0);
    if (t <= now) continue;
    if (!a.days.length || a.days.includes((t.getDay() + 6) % 7)) return t;
  }
  return null;
}
function inText(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `in ${m} Min.`;
  if (m < 1440) return `in ${Math.floor(m / 60)} Std.${m % 60 ? ` ${m % 60} Min.` : ''}`;
  const d = Math.floor(m / 1440);
  return `in ${d} ${d === 1 ? 'Tag' : 'Tagen'}`;
}
function checkAlarms() {
  const now = new Date();
  const hm = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const key = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}T${hm}`;
  const dow = (now.getDay() + 6) % 7;
  let hit = null;
  for (const a of state().alarms) {
    if (!a.on || a.time !== hm || a.last === key) continue;
    if (a.days.length && !a.days.includes(dow)) continue;
    a.last = key;
    if (!a.days.length) a.on = false;         // einmalige Wecker schalten sich ab
    hit = a;
  }
  if (!hit) return;
  st.alarms = st.alarms.filter((a) => !(a.temp && !a.on));
  S.set('alarms', st.alarms);
  startRing({ kind: 'alarm', title: 'Wecker', body: `${hit.time}${hit.label ? ` · ${hit.label}` : ''}`, label: hit.label });
}

// ---------- Timer ----------
const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const hh = Math.floor(s / 3600);
  return `${hh ? `${hh}:` : ''}${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
};
function durText(ms) {
  const s = Math.round(ms / 1000);
  const parts = [[Math.floor(s / 3600), 'Std.'], [Math.floor((s % 3600) / 60), 'Min.'], [s % 60, 'Sek.']].filter(([n]) => n);
  return parts.map(([n, u]) => `${n} ${u}`).join(' ') || '0 Sek.';
}
let timerTo = 0;
function armTimer() {
  clearTimeout(timerTo);
  const t = state().timer;
  if (t.state === 'run') timerTo = setTimeout(checkTimer, Math.max(0, t.endAt - Date.now()) + 15);
}
function checkTimer() {
  const t = state().timer;
  if (t.state !== 'run' || Date.now() < t.endAt) return;
  const late = Date.now() - t.endAt;
  t.state = 'done';
  keep('timer');
  if (late < 90000) startRing({ kind: 'timer', title: 'Timer abgelaufen', body: durText(t.total) });
  else if (late < 12 * 3600e3) sys.notify({ title: 'Timer abgelaufen', body: `${durText(t.total)} – schon ${inText(late).replace('in ', 'vor ')}`, app: 'clock', onClick: () => sys.open('clock', { tab: 'timer' }) });
}
const timerApi = {
  start(ms) {
    if (ms < 1000) return;
    const t = state().timer;
    Object.assign(t, { state: 'run', total: ms, endAt: Date.now() + ms, left: ms });
    if (ring?.kind === 'timer') stopRing();
    keep('timer');
    armTimer();
  },
  pause() {
    const t = state().timer;
    if (t.state !== 'run') return;
    t.left = Math.max(0, t.endAt - Date.now());
    t.state = 'pause';
    clearTimeout(timerTo);
    keep('timer');
  },
  resume() {
    const t = state().timer;
    if (t.state !== 'pause') return;
    t.endAt = Date.now() + t.left;
    t.state = 'run';
    keep('timer');
    armTimer();
  },
  reset() {
    clearTimeout(timerTo);
    if (ring?.kind === 'timer') stopRing();
    state().timer.state = 'idle';
    keep('timer');
  },
};

// ---------- Stoppuhr ----------
const swTotal = () => { const w = state().sw; return w.elapsed + (w.running ? Date.now() - w.startedAt : 0); };
const fmtSw = (ms) => {
  const cs = Math.floor(ms / 10);
  const s = Math.floor(cs / 100);
  const hh = Math.floor(s / 3600);
  return [`${hh ? `${hh}:` : ''}${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`, `,${pad2(cs % 100)}`];
};

// ---------- Hintergrunddienst ----------
let engine = 0;
function startEngine() {
  if (engine) return;
  state();
  engine = setInterval(() => { checkAlarms(); checkTimer(); }, 1000);
  checkTimer();
  armTimer();
}

/** Analoges Zifferblatt als SVG; update(h, m, s, night) stellt die Zeiger */
function makeDial() {
  const ns = 'http://www.w3.org/2000/svg';
  const el = document.createElementNS(ns, 'svg');
  el.setAttribute('viewBox', '0 0 100 100');
  el.setAttribute('class', 'clock-dial');
  el.setAttribute('aria-hidden', 'true');
  const ticks = Array.from({ length: 12 }, (_, i) => `<line class="tk${i % 3 ? '' : ' big'}" x1="50" y1="${i % 3 ? 7.5 : 6.5}" x2="50" y2="${i % 3 ? 11 : 13.5}" transform="rotate(${i * 30} 50 50)"/>`).join('');
  el.innerHTML = `<circle class="face" cx="50" cy="50" r="48"/>${ticks}<line class="hh" x1="50" y1="54" x2="50" y2="27"/><line class="mm" x1="50" y1="56" x2="50" y2="15"/><line class="ss" x1="50" y1="60" x2="50" y2="12"/><circle class="pin" cx="50" cy="50" r="2.6"/>`;
  const [hh, mm, ss] = ['.hh', '.mm', '.ss'].map((q) => el.querySelector(q));
  el.update = (hr, mi, se, night) => {
    hh.setAttribute('transform', `rotate(${((hr % 12) + mi / 60) * 30} 50 50)`);
    mm.setAttribute('transform', `rotate(${(mi + se / 60) * 6} 50 50)`);
    ss.setAttribute('transform', `rotate(${se * 6} 50 50)`);
    el.classList.toggle('is-night', !!night);
  };
  return el;
}

style('clock', `
.clock-win .win-title { display: none; }
.clock-win .kit-sheet-wrap { grid-template-rows: minmax(0, 1fr); align-items: start; }
.clock-seg { position: absolute; left: 50%; top: 5px; translate: -50% 0; }
.clock-seg button { padding: .3em .72em; font-size: 12px; }
.clock-pane { display: flex; flex-direction: column; flex: 1; min-height: 0; animation: clock-in .3s var(--ease-out) both; }
@keyframes clock-in { from { opacity: 0; transform: translateY(6px); } }

/* Klingeln */
.clock-ringing { flex: none; margin: 10px 12px 0; display: flex; align-items: center; gap: 12px; padding: 10px 12px 10px 14px; border-radius: 16px; background: color-mix(in srgb, var(--solid) 90%, transparent); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); box-shadow: 0 16px 40px -14px rgba(0, 0, 14, .6), inset 0 0 0 .5px var(--glass-edge), inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 55%, transparent); animation: clock-drop .5s var(--spring-soft) both; }
@keyframes clock-drop { from { opacity: 0; transform: translateY(-16px) scale(.96); } }
.clock-ringing > i { display: grid; place-items: center; flex: none; width: 34px; height: 34px; border-radius: 50%; background: var(--accent); color: var(--accent-ink); }
.clock-ringing > i .ico { width: 18px; height: 18px; transform-origin: 50% 10%; animation: clock-shake .9s ease-in-out infinite; }
@keyframes clock-shake { 0%, 60%, 100% { rotate: 0deg; } 10%, 30%, 50% { rotate: -16deg; } 20%, 40% { rotate: 16deg; } }
.clock-ringing div { flex: 1; min-width: 0; }
.clock-ringing b { display: block; font-size: 13.5px; }
.clock-ringing span { display: block; font-size: 12.5px; color: var(--fg-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Zifferblatt */
.clock-dial { --face: #f6f8ff; --ink: #12142a; --soft: rgba(18, 20, 42, .45); display: block; filter: drop-shadow(0 6px 12px rgba(0, 0, 14, .28)); }
.clock-dial.is-night { --face: #15172e; --ink: #f4f6ff; --soft: rgba(244, 246, 255, .45); }
.clock-dial .face { fill: var(--face); transition: fill .6s; }
.clock-dial line { stroke-linecap: round; }
.clock-dial .tk { stroke: var(--soft); stroke-width: 1.3; }
.clock-dial .tk.big { stroke: var(--ink); stroke-width: 2; }
.clock-dial .hh { stroke: var(--ink); stroke-width: 4.2; }
.clock-dial .mm { stroke: var(--ink); stroke-width: 2.8; }
.clock-dial .ss { stroke: var(--accent); stroke-width: 1.2; }
.clock-dial .pin { fill: var(--accent); stroke: var(--face); stroke-width: 1.2; }

/* Weltuhr */
.clock-world { flex: 1; min-height: 0; padding: 16px; }
.clock-cities { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.clock-city { position: relative; display: grid; justify-items: center; gap: 2px; padding: 16px 10px 13px; border-radius: 18px; background: var(--raise); text-align: center; min-width: 0; }
.clock-city .clock-dial { width: 96px; height: 96px; margin-bottom: 9px; }
.clock-city b { max-width: 100%; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.clock-city-time { font-family: var(--font-round); font-size: 26px; font-weight: 600; line-height: 1.15; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.clock-city small { font-size: 11.5px; color: var(--fg-3); }
.clock-city .tool { position: absolute; top: 6px; right: 6px; width: 22px; height: 22px; border-radius: 50%; opacity: 0; background: var(--raise-2); }
.clock-city:hover .tool, .clock-city .tool:focus-visible { opacity: 1; }
.clock-city .tool .ico { width: 11px; height: 11px; stroke-width: 2.6; }
.clock-find { display: grid; gap: 10px; min-height: 0; }
.clock-find-list { display: grid; align-content: start; gap: 1px; height: 230px; min-height: 60px; padding: 5px; border-radius: 11px; background: var(--well); box-shadow: inset 0 0 0 1px var(--line); }
.clock-find-list .kit-row { padding: 6px 9px; }
.clock-find-list .kit-row small { color: var(--fg-3); font-size: 12px; }
.clock-find-list .kit-row time { flex: none; font-variant-numeric: tabular-nums; color: var(--fg-2); }
.clock-find-list .kit-empty { padding: 20px; }

/* Wecker */
.clock-alarms { flex: 1; min-height: 0; padding: 12px 16px 16px; display: grid; align-content: start; gap: 8px; }
.clock-alarm { display: flex; align-items: center; gap: 12px; padding: 4px 16px 4px 4px; border-radius: 16px; background: var(--raise); }
.clock-alarm-main { display: grid; flex: 1; min-width: 0; padding: 8px 12px 9px; border: 0; border-radius: 13px; background: none; text-align: left; }
.clock-alarm-main:hover { background: var(--raise); }
.clock-alarm-main b { font-family: var(--font-round); font-size: 34px; font-weight: 500; line-height: 1.1; letter-spacing: -.02em; font-variant-numeric: tabular-nums; transition: color .3s; }
.clock-alarm-main span { font-size: 12.5px; color: var(--fg-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.clock-alarm.is-off .clock-alarm-main b { color: var(--fg-3); }
.clock-form { display: grid; gap: 12px; min-height: 0; padding: 2px; }
.clock-form input[type="time"] { justify-self: center; width: auto; padding: 6px 14px; font-family: var(--font-round); font-size: 34px; font-weight: 500; font-variant-numeric: tabular-nums; text-align: center; }
.clock-days { display: flex; gap: 5px; justify-content: space-between; }
.clock-days button { flex: 1; min-width: 0; height: 32px; padding: 0; border: 0; border-radius: 99px; background: var(--well); box-shadow: inset 0 0 0 1px var(--line); font-size: 12px; font-weight: 650; color: var(--fg-2); transition: background-color .2s, transform .4s var(--spring); }
.clock-days button:active { transform: scale(.9); }
.clock-days button[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); box-shadow: none; }
.clock-form-hint { text-align: center; font-size: 12.5px; color: var(--fg-3); }
.clock-del { margin-right: auto; color: var(--c-coral); }

/* Stoppuhr */
.clock-sw { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; padding: 14px 16px 0; }
.clock-big { flex: none; margin: clamp(4px, 5cqw, 26px) 0 clamp(8px, 4cqw, 22px); font-family: var(--font-round); font-size: clamp(44px, 15cqw, 84px); font-weight: 300; line-height: 1; letter-spacing: -.03em; font-variant-numeric: tabular-nums; white-space: nowrap; }
.clock-big b { font-weight: inherit; }
.clock-big small { font-size: .5em; color: var(--fg-3); }
.clock-btns { display: flex; justify-content: center; gap: 14px; flex: none; }
.clock-rbtn { min-width: 116px; padding: 10px 20px; border-radius: 99px; font-size: 14px; }
.clock-rbtn.is-stop { background: color-mix(in srgb, var(--c-coral) 24%, transparent); color: var(--c-coral); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c-coral) 40%, transparent); }
[data-theme="light"] .clock-rbtn.is-stop { color: color-mix(in srgb, var(--c-coral) 70%, var(--fg)); }
.clock-laps { align-self: stretch; flex: 1; min-height: 0; margin-top: 14px; padding: 0 4px 12px; }
.clock-lap { display: grid; grid-template-columns: 1fr auto 96px; gap: 12px; padding: 8px 12px; border-top: .5px solid var(--line); font-size: 13.5px; font-variant-numeric: tabular-nums; }
.clock-lap span:first-child { color: var(--fg-2); }
.clock-lap span:last-child { text-align: right; color: var(--fg-3); }
.clock-lap.is-best b { color: var(--c-mint); }
.clock-lap.is-worst b { color: var(--c-coral); }
[data-theme="light"] .clock-lap.is-best b { color: color-mix(in srgb, var(--c-mint) 62%, var(--fg)); }
.clock-lap b { font-weight: 600; }

/* Timer */
.clock-timer { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 14px 16px 18px; }
.clock-pick { display: flex; align-items: flex-end; gap: 8px; flex: none; }
.clock-num { display: grid; justify-items: center; gap: 2px; }
.clock-num input { width: 86px; padding: 4px 0; border: 0; outline: 0; border-radius: 16px; background: var(--well); box-shadow: inset 0 0 0 1px var(--line); font-family: var(--font-round); font-size: 46px; font-weight: 400; line-height: 1.15; text-align: center; font-variant-numeric: tabular-nums; }
.clock-num input:focus { box-shadow: inset 0 0 0 1.5px var(--accent); }
.clock-num span { font-size: 12px; font-weight: 600; color: var(--fg-3); }
.clock-num .tool { width: 30px; height: 20px; }
.clock-num .tool .ico { width: 14px; height: 14px; }
.clock-pick > i { align-self: center; font-style: normal; font-size: 34px; font-weight: 300; color: var(--fg-4); }
.clock-presets { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; flex: none; max-width: 420px; }
.clock-presets .kit-chip { padding: 5px 12px; }
.clock-presets .kit-chip.is-on:hover { background: var(--accent); }
.clock-ringbox { position: relative; flex: 1 1 0; min-height: 110px; max-height: 300px; aspect-ratio: 1; max-width: 100%; container-type: size; }
.clock-ringbox svg { width: 100%; height: 100%; rotate: -90deg; overflow: visible; }
.clock-ringbox .trk { fill: none; stroke: var(--well); stroke-width: 7; }
.clock-ringbox .edge { fill: none; stroke: var(--line); stroke-width: 8; }
.clock-ringbox .arc { fill: none; stroke: var(--accent); stroke-width: 7; stroke-linecap: round; filter: drop-shadow(0 0 5px color-mix(in srgb, var(--accent) 60%, transparent)); }
.clock-ringbox.is-pause .arc { stroke: var(--fg-3); filter: none; }
.clock-ringbox.is-done .arc { animation: clock-pulse 1.1s ease-in-out infinite; }
@keyframes clock-pulse { 50% { opacity: .35; } }
.clock-ringtxt { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 2cqmin; text-align: center; }
.clock-ringtxt b { font-family: var(--font-round); font-size: 21cqmin; font-weight: 400; line-height: 1; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.clock-ringtxt span { display: inline-flex; align-items: center; gap: 4px; font-size: max(11px, 5.4cqmin); color: var(--fg-3); font-variant-numeric: tabular-nums; }
.clock-ringtxt .ico { width: 1.25em; height: 1.25em; }

/* Widget */
.clock-w { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.clock-w-time { margin-top: -5px; font-family: var(--font-round); font-size: 44px; font-weight: 500; line-height: 1.1; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.clock-w-date { font-size: 12px; font-weight: 600; color: var(--accent); }
.clock-w-rows { display: grid; gap: 5px; margin-top: auto; }
.clock-w-row { display: flex; align-items: baseline; gap: 6px; min-width: 0; font-size: 12.5px; }
.clock-w-row i { align-self: center; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--c-amber); }
.clock-w-row.is-night i { background: var(--c-violet); }
.clock-w-row span { flex: 1; min-width: 0; font-weight: 600; color: var(--fg-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.clock-w-row b { font-variant-numeric: tabular-nums; }
.clock-w-run { display: flex; align-items: center; gap: 6px; margin-top: auto; font-size: 12.5px; font-weight: 600; color: var(--fg-2); font-variant-numeric: tabular-nums; }
.clock-w-run .ico { width: 14px; height: 14px; color: var(--accent); }

@container win (max-width: 460px) {
  .clock-world { padding: 12px; }
  .clock-cities { grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); gap: 9px; }
  .clock-city .clock-dial { width: 78px; height: 78px; }
  .clock-num input { width: 72px; font-size: 38px; }
  .clock-rbtn { min-width: 100px; }
}
`);

export default {
  singleton: true,
  width: 640, height: 540, minW: 420, minH: 400,

  mount(win, args = {}) {
    const d = state();
    startEngine();
    let tab = TABS.some(([id]) => id === args.tab) ? args.tab : S.get('tab', 'world');
    if (!TABS.some(([id]) => id === tab)) tab = 'world';
    let live = () => {};          // jede Sekunde (Weltuhr, Wecker-Hinweise)
    let frame = null;             // pro Bild (Stoppuhr, Timer-Ring), nur solange nötig
    let sheetOpen = false;

    win.el.classList.add('clock-win');
    const seg = h('div.gseg.no-drag.clock-seg', { 'aria-label': 'Bereich' },
      TABS.map(([id, name]) => h('button', { dataset: { value: id }, 'aria-selected': String(id === tab) }, name)));
    const bAdd = toolBtn('plus', 'Hinzufügen (N)', () => addCurrent());
    win.tools.append(seg, bAdd);
    initControls(win.tools);

    const banner = h('div.clock-ringing', { hidden: true, role: 'alert' });
    const paneBox = h('div.kit-app.clock', banner);
    win.body.append(paneBox);
    let pane = null;

    const setFrame = (fn) => {
      if (frame) ticker.remove(frame);
      frame = fn ? (dt, t) => { if (!win.min) fn(dt, t); } : null;
      if (frame) ticker.add(frame);
    };
    function show(id, animate = true) {
      tab = id;
      S.set('tab', id);
      const i = TABS.findIndex(([x]) => x === id);
      if (seg.index !== i) seg.select(i, false);
      bAdd.hidden = id === 'stopwatch' || id === 'timer';
      bAdd.title = id === 'alarm' ? 'Wecker hinzufügen (N)' : 'Stadt hinzufügen (N)';
      bAdd.setAttribute('aria-label', bAdd.title);
      setFrame(null);
      live = () => {};
      const next = h('div.clock-pane');
      if (!animate) next.style.animation = 'none';
      ({ world: paneWorld, alarm: paneAlarm, stopwatch: paneStopwatch, timer: paneTimer })[id](next);
      pane?.remove();
      pane = next;
      paneBox.append(pane);
      win.setTitle(`Uhr – ${TABS[i][1]}`);
      refocus();
    }
    seg.addEventListener('change', (e) => show(e.detail.value));
    const addCurrent = () => { if (tab === 'alarm') editAlarm(null); else if (tab === 'world') addCity(); };

    // ---------- Klingel-Banner ----------
    function paintBanner() {
      banner.hidden = !ring;
      if (!ring) return;
      banner.replaceChildren(
        h('i', { html: icon('bell') }),
        h('div', h('b', ring.title), h('span', ring.body)),
        ring.kind === 'alarm' ? h('button.kit-btn', { type: 'button', onclick: () => snooze() }, `Schlummern`) : null,
        h('button.kit-btn.primary', { type: 'button', onclick: () => { const k = ring?.kind; stopRing(); if (k === 'timer' && d.timer.state === 'done') timerApi.reset(); } }, 'Stopp'));
    }

    // ---------- Weltuhr ----------
    function paneWorld(root) {
      const cards = [];
      const box = h('div.clock-world.scroll');
      root.append(box);
      const paint = () => {
        cards.length = 0;
        if (!d.world.length) {
          box.replaceChildren(emptyState('clock', 'Keine Städte', 'Füge mit + Städte hinzu und sieh, wie spät es dort gerade ist.'));
          return;
        }
        box.replaceChildren(h('div.clock-cities', d.world.map((id) => {
          const c = cityById(id);
          const dial = makeDial();
          const time = h('span.clock-city-time');
          const off = h('small');
          const card = h('article.clock-city', dial, h('b', { title: `${c.name}, ${c.country}` }, c.name), time, off,
            toolBtn('close', `${c.name} entfernen`, () => removeCity(id)));
          card.addEventListener('contextmenu', (e) => {
            e.preventDefault(); e.stopPropagation();
            openMenu([
              { label: 'An den Anfang', disabled: d.world[0] === id, run: () => { d.world = [id, ...d.world.filter((x) => x !== id)]; keep('world'); } },
              { label: 'Entfernen', icon: 'trash', run: () => removeCity(id) },
            ], { x: e.clientX, y: e.clientY });
          });
          cards.push({ c, dial, time, off });
          return card;
        })));
        tick();
      };
      const tick = () => {
        const now = new Date();
        for (const k of cards) {
          const z = zoneInfo(k.c.tz, now);
          if (!z) { k.time.textContent = '–'; k.off.textContent = 'Zeitzone unbekannt'; continue; }
          k.dial.update(z.h, z.m, z.s, z.night);
          const t = `${pad2(z.h)}:${pad2(z.m)}`;
          if (k.time.textContent !== t) k.time.textContent = t;
          const o = offsetText(z);
          if (k.off.textContent !== o) k.off.textContent = o;
        }
      };
      root.repaint = paint;
      live = tick;
      paint();
    }
    function removeCity(id) {
      d.world = d.world.filter((x) => x !== id);
      keep('world');
    }
    async function addCity() {
      if (sheetOpen) return;
      const input = h('input.kit-field', { type: 'text', placeholder: 'Stadt oder Land suchen', spellcheck: false, autocomplete: 'off', 'aria-label': 'Stadt suchen', 'data-autofocus': '' });
      const list = h('div.clock-find-list.scroll');
      let hits = [];
      const paint = () => {
        const q = input.value.trim().toLocaleLowerCase('de');
        const now = new Date();
        hits = CITIES.filter((c) => !d.world.includes(c.id) && (!q || `${c.name} ${c.country} ${c.tz}`.toLocaleLowerCase('de').includes(q)));
        list.replaceChildren(...(hits.length ? hits.map((c) => {
          const z = zoneInfo(c.tz, now);
          return h('button.kit-row', { type: 'button', onclick: () => { d.world.push(c.id); keep('world'); paint(); input.focus(); } },
            h('span.grow', c.name, ' ', h('small', c.country)), h('time', z ? `${pad2(z.h)}:${pad2(z.m)}` : ''));
        }) : [h('div.kit-empty', h('span', q ? `Keine Stadt für „${input.value.trim()}“ in der Liste.` : 'Alle Städte sind schon hinzugefügt.'))]));
      };
      input.addEventListener('input', paint);
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault(); e.stopPropagation();
        if (hits[0] && input.value.trim()) { d.world.push(hits[0].id); keep('world'); input.value = ''; paint(); }
      });
      paint();
      sheetOpen = true;
      await sheet(win, { title: 'Stadt hinzufügen', body: h('div.clock-find', input, list), buttons: [{ label: 'Fertig', value: true, primary: true }] });
      sheetOpen = false;
      refocus();
    }

    // ---------- Wecker ----------
    function paneAlarm(root) {
      const box = h('div.clock-alarms.scroll');
      root.append(box);
      let hints = [];
      const paint = () => {
        hints = [];
        const list = [...d.alarms].sort((a, b) => a.time.localeCompare(b.time));
        if (!list.length) { box.replaceChildren(emptyState('bell', 'Kein Wecker gestellt', 'Mit + legst du einen an – er klingelt auch, wenn dieses Fenster zu ist.')); return; }
        box.replaceChildren(...list.map((a) => {
          const hint = h('span');
          hints.push({ a, hint });
          const sw = h('button.gswitch', { 'aria-checked': String(!!a.on), 'aria-label': `Wecker ${a.time} ${a.on ? 'ausschalten' : 'einschalten'}` });
          sw.addEventListener('change', (e) => {
            a.on = e.detail.checked;
            a.last = '';
            if (a.temp && !a.on) { d.alarms = d.alarms.filter((x) => x !== a); keep('alarms'); return; }
            S.set('alarms', d.alarms);              // ohne Neuzeichnen: der Schalter soll zu Ende gleiten
            row.classList.toggle('is-off', !a.on);
            tick();
          });
          const row = h('div.clock-alarm', { class: a.on ? '' : 'is-off' },
            h('button.clock-alarm-main', { type: 'button', 'aria-label': `Wecker ${a.time} bearbeiten`, onclick: () => editAlarm(a) }, h('b', a.time), hint), sw);
          row.addEventListener('contextmenu', (e) => {
            e.preventDefault(); e.stopPropagation();
            openMenu([{ label: 'Bearbeiten …', icon: 'note', run: () => editAlarm(a) }, { label: 'Löschen', icon: 'trash', run: () => { d.alarms = d.alarms.filter((x) => x !== a); keep('alarms'); } }], { x: e.clientX, y: e.clientY });
          });
          return row;
        }));
        initControls(box);
        tick();
      };
      const tick = () => {
        const now = new Date();
        for (const { a, hint } of hints) {
          const nx = a.on ? nextRing(a, now) : null;
          const t = [a.label, daysText(a), nx ? `klingelt ${inText(nx - now)}` : null].filter(Boolean).join(' · ');
          if (hint.textContent !== t) hint.textContent = t;
        }
      };
      root.repaint = paint;
      live = tick;
      paint();
    }
    async function editAlarm(a) {
      if (sheetOpen) return;
      const isNew = !a;
      const now = new Date();
      const cur = a || { time: `${pad2((now.getHours() + 1) % 24)}:00`, label: '', days: [] };
      const days = new Set(cur.days);
      const time = h('input.kit-field', { type: 'time', value: cur.time, 'aria-label': 'Uhrzeit', 'data-autofocus': '' });
      const label = h('input.kit-field', { type: 'text', value: cur.label || '', placeholder: 'Bezeichnung, z. B. Aufstehen', maxLength: 60, autocomplete: 'off', 'aria-label': 'Bezeichnung' });
      const hint = h('div.clock-form-hint');
      const dayBtns = DOW.map((n, i) => h('button', { type: 'button', 'aria-pressed': String(days.has(i)), 'aria-label': ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'][i],
        onclick: (e) => { if (days.has(i)) days.delete(i); else days.add(i); e.currentTarget.setAttribute('aria-pressed', String(days.has(i))); sync(); } }, n));
      const sync = () => { hint.textContent = days.size ? `Wiederholt sich: ${daysText({ days: [...days] })}` : 'Klingelt einmal und schaltet sich dann ab.'; };
      sync();
      sheetOpen = true;
      const done = sheet(win, {
        title: isNew ? 'Neuer Wecker' : 'Wecker bearbeiten',
        body: h('div.clock-form.scroll', time, label, h('div.clock-days', { role: 'group', 'aria-label': 'Wochentage' }, dayBtns), hint),
        buttons: [!isNew && { label: 'Löschen', value: 'delete' }, { label: 'Abbrechen', value: null }, { label: 'Sichern', value: 'save', primary: true }].filter(Boolean),
      });
      if (!isNew) win.el.querySelector('.kit-sheet-wrap:last-of-type .kit-sheet-btns button')?.classList.add('clock-del');
      const res = await done;
      sheetOpen = false;
      if (res === 'delete') { d.alarms = d.alarms.filter((x) => x !== a); keep('alarms'); }
      else if (res === 'save' && time.value) {
        const next = { time: time.value, label: label.value.trim(), days: [...days].sort(), on: true, last: '' };
        if (isNew) d.alarms.push({ id: uid(), ...next }); else { delete a.temp; Object.assign(a, next); }
        keep('alarms');
        const nx = nextRing(next);
        if (nx) toast(win, `Wecker klingelt ${inText(nx - Date.now())}`);
      }
      refocus();
    }

    // ---------- Stoppuhr ----------
    function paneStopwatch(root) {
      const w = d.sw;
      const big = h('div.clock-big', { role: 'timer', 'aria-label': 'Gestoppte Zeit' });
      const main = h('b');
      const frac = h('small');
      big.append(main, frac);
      const bLeft = h('button.kit-btn.clock-rbtn', { type: 'button' });
      const bMain = h('button.kit-btn.clock-rbtn', { type: 'button' });
      const laps = h('div.clock-laps.scroll');
      root.append(h('div.clock-sw', big, h('div.clock-btns', bLeft, bMain), laps));
      let liveLap = null;

      const paintTime = () => {
        const total = swTotal();
        const [a, b] = fmtSw(total);
        if (main.textContent !== a) main.textContent = a;
        frac.textContent = b;
        if (liveLap) liveLap.textContent = fmtSw(total - w.lapBase).join('');
      };
      const paint = () => {
        const total = swTotal();
        bMain.textContent = w.running ? 'Stopp' : total ? 'Weiter' : 'Start';
        bMain.classList.toggle('primary', !w.running);
        bMain.classList.toggle('is-stop', w.running);
        bLeft.textContent = w.running || !total ? 'Runde' : 'Zurücksetzen';
        bLeft.disabled = !w.running && !total;
        const best = w.laps.length > 1 ? Math.min(...w.laps) : -1;
        const worst = w.laps.length > 1 ? Math.max(...w.laps) : -1;
        liveLap = null;
        const rows = [];
        if (total) {
          liveLap = h('b');
          rows.push(h('div.clock-lap', h('span', `Runde ${w.laps.length + 1}`), liveLap, h('span')));
        }
        let sum = w.laps.reduce((x, y) => x + y, 0);
        for (let i = w.laps.length - 1; i >= 0; i--) {
          rows.push(h('div.clock-lap', { class: w.laps[i] === best ? 'is-best' : w.laps[i] === worst ? 'is-worst' : '' },
            h('span', `Runde ${i + 1}${w.laps[i] === best ? ' · schnellste' : w.laps[i] === worst ? ' · langsamste' : ''}`), h('b', fmtSw(w.laps[i]).join('')), h('span', fmtSw(sum).join(''))));
          sum -= w.laps[i];
        }
        laps.replaceChildren(...rows);
        paintTime();
        setFrame(w.running ? paintTime : null);
      };
      const toggle = () => {
        if (w.running) { w.elapsed = swTotal(); w.running = false; } else { w.startedAt = Date.now(); w.running = true; }
        keep('sw');
      };
      const lapOrReset = () => {
        if (w.running) { const t = swTotal(); w.laps.push(t - w.lapBase); w.lapBase = t; }
        else Object.assign(w, { elapsed: 0, lapBase: 0, laps: [], startedAt: 0 });
        keep('sw');
      };
      bMain.addEventListener('click', toggle);
      bLeft.addEventListener('click', lapOrReset);
      root.repaint = paint;
      root.keys = { ' ': toggle, l: () => { if (w.running) lapOrReset(); }, r: () => { if (!w.running && swTotal()) lapOrReset(); } };
      paint();
    }

    // ---------- Timer ----------
    function paneTimer(root) {
      const t = d.timer;
      const box = h('div.clock-timer');
      root.append(box);
      const C = 2 * Math.PI * 90;

      const paintIdle = () => {
        setFrame(null);
        const field = (key, unit, max) => {
          const input = h('input', { type: 'text', inputMode: 'numeric', maxLength: 2, value: pad2(d.pick[key]), 'aria-label': unit });
          const set = (v) => { d.pick[key] = clamp(Math.round(v) || 0, 0, max); input.value = pad2(d.pick[key]); S.set('pick', d.pick); sync(); };
          const bump = (n) => set((d.pick[key] + n + max + 1) % (max + 1));
          input.addEventListener('focus', () => input.select());
          input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, ''); d.pick[key] = clamp(Number(input.value) || 0, 0, max); S.set('pick', d.pick); sync(); });
          input.addEventListener('blur', () => set(d.pick[key]));
          input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); bump(e.key === 'ArrowUp' ? 1 : -1); }
            else if (e.key === 'Enter') { e.preventDefault(); set(d.pick[key]); go(); }
          });
          input.addEventListener('wheel', (e) => { e.preventDefault(); bump(e.deltaY < 0 ? 1 : -1); }, { passive: false });
          return h('div.clock-num', toolBtn('chevronDown', `${unit} erhöhen`, () => bump(1)), input, toolBtn('chevronDown', `${unit} verringern`, () => bump(-1)), h('span', unit));
        };
        const ms = () => (d.pick.h * 3600 + d.pick.m * 60 + d.pick.s) * 1000;
        const bGo = h('button.kit-btn.primary.clock-rbtn', { type: 'button' }, 'Start');
        const go = () => timerApi.start(ms());
        const chips = PRESETS.map((m) => h('button.kit-chip', { type: 'button', onclick: () => { Object.assign(d.pick, { h: Math.floor(m / 60), m: m % 60, s: 0 }); S.set('pick', d.pick); paintIdle(); } }, m === 60 ? '1 Std.' : `${m} Min.`));
        const sync = () => {
          bGo.disabled = ms() < 1000;
          chips.forEach((c, i) => c.classList.toggle('is-on', ms() === PRESETS[i] * 60000));
        };
        bGo.addEventListener('click', go);
        const nums = [field('h', 'Std.', 23), h('i', ':'), field('m', 'Min.', 59), h('i', ':'), field('s', 'Sek.', 59)];
        for (const up of nums.map((n) => n.querySelector?.('.tool')).filter(Boolean)) up.querySelector('.ico').style.rotate = '180deg';
        box.replaceChildren(h('div.clock-pick', nums), h('div.clock-presets', chips), h('div.clock-btns', bGo));
        sync();
        root.keys = { ' ': go, Enter: go };
      };

      const paintRun = () => {
        const arc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        arc.setAttribute('class', 'arc');
        for (const [k, v] of [['cx', 100], ['cy', 100], ['r', 90], ['stroke-dasharray', C.toFixed(2)]]) arc.setAttribute(k, v);
        const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgEl.setAttribute('viewBox', '0 0 200 200');
        svgEl.setAttribute('aria-hidden', 'true');
        svgEl.innerHTML = '<circle class="trk" cx="100" cy="100" r="90"/>';
        svgEl.append(arc);
        const num = h('b', { role: 'timer' });
        const sub = h('span');
        const ringBox = h('div.clock-ringbox', { class: t.state === 'pause' ? 'is-pause' : t.state === 'done' ? 'is-done' : '' }, svgEl, h('div.clock-ringtxt', num, sub));
        const left = () => (t.state === 'run' ? Math.max(0, t.endAt - Date.now()) : t.state === 'pause' ? t.left : 0);
        const paintLeft = () => {
          const l = left();
          const txt = t.state === 'done' ? 'Fertig' : fmtClock(l);
          if (num.textContent !== txt) num.textContent = txt;
          arc.style.strokeDashoffset = (C * (1 - (t.state === 'done' ? 1 : clamp(l / (t.total || 1))))).toFixed(2);
        };
        if (t.state === 'run') sub.innerHTML = `${icon('bell')}${new Date(t.endAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
        else sub.textContent = t.state === 'pause' ? 'Angehalten' : durText(t.total);
        const btns = t.state === 'done'
          ? [h('button.kit-btn.clock-rbtn', { type: 'button', onclick: () => timerApi.start(t.total) }, 'Wiederholen'), h('button.kit-btn.primary.clock-rbtn', { type: 'button', onclick: () => timerApi.reset() }, 'Fertig')]
          : [h('button.kit-btn.clock-rbtn', { type: 'button', onclick: () => timerApi.reset() }, 'Abbrechen'),
            h(`button.kit-btn.clock-rbtn${t.state === 'pause' ? '.primary' : ''}`, { type: 'button', onclick: () => (t.state === 'run' ? timerApi.pause() : timerApi.resume()) }, t.state === 'run' ? 'Pause' : 'Weiter')];
        box.replaceChildren(ringBox, h('div.clock-btns', btns));
        paintLeft();
        setFrame(t.state === 'run' && !reducedMotion.matches ? paintLeft : null);
        if (t.state === 'run' && reducedMotion.matches) live = paintLeft;
        root.keys = t.state === 'done'
          ? { ' ': () => timerApi.reset(), Enter: () => timerApi.reset() }
          : { ' ': () => (t.state === 'run' ? timerApi.pause() : timerApi.resume()), Escape: () => timerApi.reset() };
      };
      const paint = () => (t.state === 'idle' ? paintIdle() : paintRun());
      root.repaint = paint;
      paint();
    }

    // ---------- Laufendes ----------
    function refocus() { if (sys.wm.focused === win && !win.el.contains(document.activeElement)) win.el.focus({ preventScroll: true }); }
    const onData = () => { paintBanner(); pane?.repaint?.(); refocus(); };
    addEventListener(EVT, onData);
    const clock = setInterval(() => { if (!win.min) live(); }, 1000);
    const onKey = (e) => {
      if (e.altKey || e.metaKey || e.ctrlKey || e.target.closest('input, textarea, select')) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k >= '1' && k <= '4') { e.preventDefault(); show(TABS[Number(k) - 1][0]); return; }
      if (k === 'n' && !bAdd.hidden) { e.preventDefault(); addCurrent(); return; }
      if ((k === ' ' || k === 'Enter') && e.target.closest('button')) return;      // Knöpfe bedienen sich selbst
      const act = pane?.keys?.[k];
      if (act) { e.preventDefault(); act(); }
    };
    win.el.addEventListener('keydown', onKey);
    // nach einem Mausklick auf Start/Runde soll die Leertaste weiter die Uhr steuern, nicht den zuletzt geklickten Knopf
    paneBox.addEventListener('click', (e) => { if (e.detail && e.target.closest('.clock-rbtn, .kit-chip')) win.el.focus({ preventScroll: true }); });

    show(tab, false);
    paintBanner();

    return {
      onClose() {
        removeEventListener(EVT, onData);
        clearInterval(clock);
        setFrame(null);
        win.el.removeEventListener('keydown', onKey);
      },
      onFocus: refocus,
      onArgs(a) { if (TABS.some(([id]) => id === a?.tab)) show(a.tab); },
      menus: () => [
        { label: 'Ansicht', items: TABS.map(([id, name], i) => ({ label: name, hint: String(i + 1), checked: tab === id, run: () => show(id) })) },
        { label: 'Uhr', items: [
          { label: 'Stadt hinzufügen …', icon: 'plus', run: () => { show('world'); addCity(); } },
          { label: 'Neuer Wecker …', icon: 'bell', run: () => { show('alarm'); editAlarm(null); } },
          '-',
          { label: d.sw.running ? 'Stoppuhr anhalten' : 'Stoppuhr starten', run: () => { show('stopwatch'); pane.keys[' '](); } },
          { label: 'Timer abbrechen', disabled: d.timer.state === 'idle', run: () => timerApi.reset() },
          { label: 'Klingeln stoppen', disabled: !ring, run: () => stopRing() },
        ] },
      ],
    };
  },

  background() { startEngine(); },

  widgets: {
    world(el) {
      const time = h('div.clock-w-time');
      const date = h('div.clock-w-date');
      const rows = h('div.clock-w-rows');
      el.append(h('div.clock-w', time, date, rows));
      let sig = '';
      const paint = () => {
        const d = state();
        const now = new Date();
        const t = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        if (time.textContent !== t) time.textContent = t;
        const dt = now.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
        if (date.textContent !== dt) date.textContent = dt;
        // laufender Timer hat Vorrang vor der zweiten Stadt
        const items = [];
        if (d.timer.state === 'run') items.push({ run: `Timer ${fmtClock(d.timer.endAt - Date.now())}` });
        for (const id of d.world) {
          if (items.length >= 2) break;
          const c = cityById(id);
          const z = c && zoneInfo(c.tz, now);
          if (z) items.push({ name: c.name, t: `${pad2(z.h)}:${pad2(z.m)}`, night: z.night });
        }
        const s = JSON.stringify(items);
        if (s === sig) return;
        sig = s;
        rows.replaceChildren(...items.map((i) => (i.run
          ? h('div.clock-w-run', { html: icon('clock') }, i.run)
          : h('div.clock-w-row', { class: i.night ? 'is-night' : '', title: i.night ? 'Nacht' : 'Tag' }, h('i'), h('span', i.name), h('b', i.t)))));
      };
      paint();
      const id = setInterval(paint, 1000);
      addEventListener(EVT, paint);
      return () => { clearInterval(id); removeEventListener(EVT, paint); };
    },
  },
};
