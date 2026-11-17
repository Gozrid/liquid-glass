// maps.js — Karten: OpenStreetMap-Karte mit Ortssuche, wählbaren Ebenen, Favoriten und Standort
import { h, clamp } from '../../../core/util.js';
import { icon } from '../../../core/icons.js';
import { bus } from '../../bus.js';
import { sys } from '../../sys.js';
import { openMenu } from '../../ui.js';
import { style, appStore, toolBtn, emptyState, promptSheet, toast } from '../../kit.js';

const S = appStore('maps');
const EVT = 'fableos:maps';
const EMBED = 'https://www.openstreetmap.org/export/embed.html';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const LAYERS = [['mapnik', 'Standard', ''], ['cyclosm', 'Rad', 'Y'], ['transportmap', 'ÖPNV', 'T'], ['hot', 'Humanitär', 'H']];
const START = { bbox: [-12, 35, 32, 61], marker: null, name: 'Europa', sub: '' };
const KINDS = {
  country: 'Land', state: 'Region', region: 'Region', county: 'Kreis', city: 'Stadt', town: 'Stadt', municipality: 'Gemeinde', village: 'Dorf', hamlet: 'Weiler',
  suburb: 'Stadtteil', city_district: 'Bezirk', neighbourhood: 'Viertel', quarter: 'Viertel', road: 'Straße', building: 'Gebäude', house_number: 'Adresse',
  railway: 'Bahn', aeroway: 'Flughafen', tourism: 'Sehenswert', historic: 'Historisch', natural: 'Natur', peak: 'Berg', water: 'Gewässer', waterway: 'Fluss',
  island: 'Insel', leisure: 'Freizeit', amenity: 'Ort', shop: 'Geschäft',
};
const svg = (body) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const I = {
  pin: svg('<path d="M12 21s-6.500-5.700-6.500-11a6.500 6.500 0 0 1 13 0C18.500 15.300 12 21 12 21z"/><circle cx="12" cy="10" r="2.300"/>'),
  star: svg('<path d="M12 3.600l2.500 5.300 5.800.7-4.300 4 1.100 5.700L12 16.500l-5.100 2.800L8 13.600l-4.300-4 5.800-.7z"/>'),
  locate: svg('<circle cx="12" cy="12" r="6.200"/><circle cx="12" cy="12" r="1.800" fill="currentColor" stroke="none"/><path d="M12 2.500v3.300M12 18.200v3.300M2.500 12h3.300M18.200 12h3.300"/>'),
};

// ---------- gemeinsame Daten aller Karten-Fenster ----------
let db = null;
function data() {
  if (!db) db = { favs: S.get('favs', []) || [], recent: S.get('recent', []) || [] };
  return db;
}
const save = (key) => { S.set(key, db[key]); dispatchEvent(new CustomEvent(EVT)); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const near = (a, b) => !!a && !!b && Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4;

// ---------- Geometrie ----------
const lonSpan = (lat, d) => d / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
const around = (lat, lon, d = 0.012) => [lon - lonSpan(lat, d), lat - d, lon + lonSpan(lat, d), lat + d];
/** Ausschnitt um den Faktor f größer (f > 1) oder kleiner ziehen, innerhalb der Welt bleiben */
function scaled([w, s, e, n], f) {
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  const hw = clamp(((e - w) / 2) * f, 0.0005, 180);
  const hh = clamp(((n - s) / 2) * f, 0.0003, 85);
  return [clamp(cx - hw, -180, 180), clamp(cy - hh, -85, 85), clamp(cx + hw, -180, 180), clamp(cy + hh, -85, 85)];
}
/** Treffer-Rahmen mit etwas Luft und einer Mindestgröße */
function framed(box, lat, lon) {
  if (!box || box.some((v) => !Number.isFinite(v))) return around(lat, lon);
  const min = around(lat, lon, 0.004);
  const b = scaled(box, 1.14);
  return [Math.min(b[0], min[0]), Math.min(b[1], min[1]), Math.max(b[2], min[2]), Math.max(b[3], min[3])];
}
const center = (v) => v.marker || { lat: (v.bbox[1] + v.bbox[3]) / 2, lon: (v.bbox[0] + v.bbox[2]) / 2 };
const zoomOf = (b, px) => clamp(Math.round(Math.log2((360 * Math.max(200, px)) / (256 * Math.max(1e-6, b[2] - b[0])))), 2, 19);
const coordText = (p) => `${Math.abs(p.lat).toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}° ${p.lat >= 0 ? 'N' : 'S'}, ${Math.abs(p.lon).toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}° ${p.lon >= 0 ? 'O' : 'W'}`;

// ---------- Ortssuche (Nominatim): nie beim Tippen, höchstens eine Anfrage pro Sekunde – über alle Fenster hinweg ----------
let lastRequest = 0;
async function lookup(q) {
  const wait = lastRequest + 1100 - Date.now();
  lastRequest = Date.now() + Math.max(0, wait);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(`${NOMINATIM}?format=jsonv2&limit=6&accept-language=de&q=${encodeURIComponent(q)}`, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();
    return (Array.isArray(list) ? list : []).map((x) => {
      const parts = String(x.display_name || '').split(', ');
      const name = x.name || parts[0] || 'Ort';
      const lat = Number(x.lat);
      const lon = Number(x.lon);
      const bb = Array.isArray(x.boundingbox) ? x.boundingbox.map(Number) : null;      // [Süd, Nord, West, Ost]
      return {
        name, sub: (parts[0] === name ? parts.slice(1) : parts).join(', '), lat, lon,
        kind: KINDS[x.addresstype] || KINDS[x.type] || KINDS[x.category] || '',
        bbox: framed(bb && [bb[2], bb[0], bb[3], bb[1]], lat, lon),
      };
    }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  } finally { clearTimeout(to); }
}
/** „52.52, 13.405“ → Koordinaten, sonst null */
function parseCoords(q) {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(q);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* älterer Weg */ }
  const ta = h('textarea', { value: text, style: { position: 'fixed', opacity: '0' } });
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* geht nicht */ }
  ta.remove();
  return ok;
}

style('maps', `
.maps-win .kit-sheet-wrap { grid-template-rows: minmax(0, 1fr); align-items: start; }
.maps .kit-split { --side: 216px; }
.maps-side { gap: 1px; padding: 8px 8px 12px; }
.maps-side .kit-head { display: flex; align-items: center; gap: 6px; }
.maps-side .kit-head span { flex: 1; }
.maps-side .kit-head button { padding: 1px 6px; border: 0; border-radius: 6px; background: none; font-size: 10.5px; font-weight: 700; letter-spacing: 0; text-transform: none; color: var(--fg-3); }
.maps-side .kit-head button:hover { background: var(--raise); color: var(--fg); }
.maps-row { display: flex; align-items: center; min-width: 0; border-radius: 8px; }
.maps-row:hover, .maps-row:focus-within { background: var(--raise); }
.maps-row.is-on { background: var(--raise-2); }
.maps-row-main { display: flex; align-items: center; gap: 9px; flex: 1; min-width: 0; padding: 6px 4px 6px 8px; border: 0; border-radius: 8px; background: none; text-align: left; font-size: 13px; font-weight: 500; color: var(--fg-2); }
.maps-row.is-on .maps-row-main { color: var(--fg); }
.maps-row-main .ico { width: 15px; height: 15px; color: var(--accent); }
.maps-row-main.is-recent .ico { color: var(--fg-3); }
.maps-row-main span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.maps-row .tool { width: 22px; height: 22px; margin-right: 3px; opacity: 0; }
.maps-row:hover .tool, .maps-row .tool:focus-visible { opacity: 1; }
.maps-row .tool .ico { width: 13px; height: 13px; }
.maps-hint { padding: 2px 8px 6px; font-size: 12px; line-height: 1.4; color: var(--fg-3); }

.maps-bar { gap: 8px; }
.maps-bar .kit-search { flex: 1; }
.maps-bar .maps-fav-menu { display: none; }
.maps-stage { position: relative; flex: 1; min-height: 0; background: var(--well); }
.maps-frame { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: var(--well); }
.maps-shield { position: absolute; inset: 0; z-index: 2; }
/* eigene Knöpfe links in der Mitte – oben rechts sitzen die der eingebetteten Karte, unten ihre Quellenangabe */
.maps-ctl { position: absolute; left: 10px; top: 50%; z-index: 3; display: grid; gap: 8px; translate: 0 -50%; }
.maps-ctl > div, .maps-ctl > button { display: grid; border-radius: 12px; overflow: hidden; background: color-mix(in srgb, var(--solid) 88%, transparent); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); box-shadow: 0 8px 22px -8px rgba(0, 0, 14, .55), inset 0 0 0 .5px var(--glass-edge); }
.maps-ctl button { display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 0; background: none; color: var(--fg); transition: background-color .15s, transform .4s var(--spring); }
.maps-ctl > button { background: color-mix(in srgb, var(--solid) 88%, transparent); }
.maps-ctl button:hover { background-color: var(--raise-2); }
.maps-ctl button:active { transform: scale(.9); }
.maps-ctl button + button { box-shadow: 0 -.5px 0 var(--line); }
.maps-ctl .ico { width: 17px; height: 17px; }
.maps-ctl button.is-busy .ico { animation: maps-pulse 1s ease-in-out infinite; }
@keyframes maps-pulse { 50% { opacity: .3; } }
.maps-results { position: absolute; left: 8px; top: 8px; z-index: 5; display: flex; flex-direction: column; width: min(380px, calc(100% - 16px)); max-height: calc(100% - 16px); border-radius: 14px; overflow: hidden; background: color-mix(in srgb, var(--solid) 93%, transparent); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); box-shadow: 0 18px 44px -14px rgba(0, 0, 14, .6), inset 0 0 0 .5px var(--glass-edge); animation: maps-drop .28s var(--ease-out) both; }
@keyframes maps-drop { from { opacity: 0; transform: translateY(-8px); } }
.maps-results header { display: flex; align-items: center; gap: 8px; flex: none; padding: 7px 7px 5px 13px; font-size: 12px; font-weight: 700; color: var(--fg-3); }
.maps-results header span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.maps-results header .tool { width: 22px; height: 22px; }
.maps-results header .tool .ico { width: 12px; height: 12px; stroke-width: 2.4; }
.maps-list { display: grid; align-content: start; gap: 1px; min-height: 0; padding: 0 5px 6px; }
.maps-list .kit-row { align-items: flex-start; padding: 7px 9px; }
.maps-list .kit-row > .ico { width: 15px; height: 15px; margin-top: 2px; color: var(--accent); }
.maps-list .kit-row b { display: block; font-size: 13.5px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.maps-list .kit-row small { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; white-space: normal; font-size: 11.5px; line-height: 1.35; color: var(--fg-3); }
.maps-list .kit-chip { margin-top: 1px; padding: 2px 8px; font-size: 11px; }
.maps-msg { display: grid; justify-items: center; gap: 6px; padding: 14px 18px 18px; text-align: center; font-size: 12.5px; color: var(--fg-3); }
.maps-msg b { font-size: 13.5px; color: var(--fg-2); }
.maps-msg .kit-btn { margin-top: 4px; }
.maps-msg .ico { width: 22px; height: 22px; animation: maps-spin 1s linear infinite; }
@keyframes maps-spin { to { rotate: 360deg; } }
.maps-loading { position: absolute; left: 50%; top: 10px; z-index: 4; display: flex; align-items: center; gap: 7px; padding: 5px 12px 5px 9px; border-radius: 99px; background: color-mix(in srgb, var(--solid) 90%, transparent); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); box-shadow: 0 8px 22px -8px rgba(0, 0, 14, .5), inset 0 0 0 .5px var(--glass-edge); font-size: 12px; font-weight: 600; white-space: nowrap; translate: -50% 0; pointer-events: none; }
.maps-loading .ico { width: 14px; height: 14px; animation: maps-spin 1s linear infinite; }
.maps-veil { position: absolute; inset: 0; z-index: 6; display: grid; background: color-mix(in srgb, var(--solid) 90%, transparent); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
.maps-veil .kit-btn { margin-top: 8px; }
.maps-foot { gap: 6px; padding: 5px 8px 5px 12px; min-height: 34px; }
.maps-foot > .ico { width: 14px; height: 14px; color: var(--accent); }
.maps-foot b { flex: 0 1 auto; min-width: 0; font-size: 12.5px; color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.maps-coords { flex: none; font-variant-numeric: tabular-nums; white-space: nowrap; }
.maps-foot .tool { width: 24px; height: 24px; }
.maps-foot .tool .ico { width: 14px; height: 14px; }
.maps-credit { flex: none; font-size: 11.5px; font-weight: 550; color: var(--fg-2); white-space: nowrap; }
.maps-credit:hover { color: var(--fg); text-decoration: underline; }
.maps-star.is-on .ico { fill: currentColor; }

@container win (max-width: 560px) {
  .maps-bar .maps-fav-menu { display: inline-grid; }
  .maps-coords { display: none; }
  .maps-ctl button { width: 32px; height: 32px; }
}
`);

export default {
  width: 920, height: 620, minW: 420, minH: 360,

  mount(win) {
    const d = data();
    let view = { ...START, ...(S.get('view', null) || {}) };
    if (!Array.isArray(view.bbox) || view.bbox.length !== 4 || view.bbox.some((v) => !Number.isFinite(v))) view = { ...START };
    let layer = LAYERS.some(([id]) => id === S.get('layer', 'mapnik')) ? S.get('layer', 'mapnik') : 'mapnik';
    let hits = null;            // letzte Trefferliste: {q, list} – beim erneuten Fokus ohne neue Anfrage wieder zeigen
    let busy = false;
    let slow = 0;
    let wanted = '';            // Adresse, die geladen werden soll, sobald wieder Netz da ist

    win.el.classList.add('maps-win');
    const bLayer = toolBtn('layers', 'Kartenebene', () => openMenu(layerMenu(), { anchor: bLayer, align: 'right' }));
    const bStar = h('button.tool.maps-star', { type: 'button', html: I.star, onclick: () => toggleFav() });
    win.tools.append(bLayer, bStar);

    const side = h('aside.kit-side.maps-side.scroll');
    const input = h('input.kit-field', { type: 'search', placeholder: 'Ort, Adresse oder Koordinaten suchen', spellcheck: false, autocomplete: 'off', enterKeyHint: 'search', 'aria-label': 'Ort suchen' });
    const bGo = h('button.kit-btn.primary', { type: 'submit' }, 'Suchen');
    const bFavs = toolBtn('list', 'Favoriten und Verlauf', () => openMenu(placesMenu(), { anchor: bFavs }), 'maps-fav-menu');
    const form = h('form.kit-bar.maps-bar', { role: 'search' }, bFavs, h('div.kit-search', { html: icon('search') }, input), bGo);
    const frame = h('iframe.maps-frame', { title: 'Karte von OpenStreetMap', referrerPolicy: 'no-referrer', sandbox: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox' });
    const shield = h('div.maps-shield', { hidden: true, title: 'Klicken, um die Karte zu bedienen' });
    const results = h('div.maps-results', { hidden: true });
    const loading = h('div.maps-loading', { hidden: true, html: icon('reload'), role: 'status' }, h('span', 'Karte lädt …'));
    const veil = h('div.maps-veil', { hidden: true });
    const bLocate = h('button', { type: 'button', 'aria-label': 'Mein Standort', title: 'Mein Standort', html: I.locate, onclick: () => locate() });
    const ctl = h('div.maps-ctl',
      h('div',
        h('button', { type: 'button', 'aria-label': 'Vergrößern', title: 'Vergrößern (+)', html: icon('plus'), onclick: () => zoom(0.5) }),
        h('button', { type: 'button', 'aria-label': 'Verkleinern', title: 'Verkleinern (−)', html: icon('minus'), onclick: () => zoom(2) })),
      bLocate);
    const stage = h('div.maps-stage', frame, shield, ctl, loading, results, veil);
    const fName = h('b');
    const fCoords = h('span.maps-coords');
    const foot = h('div.kit-foot.maps-foot', { html: I.pin }, fName, fCoords,
      toolBtn('copy', 'Koordinaten kopieren', () => copyCoords()),
      toolBtn('external', 'In OpenStreetMap öffnen', () => openOsm()),
      h('span.sp'),
      h('a.maps-credit', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener noreferrer' }, '© OpenStreetMap-Mitwirkende'));
    win.body.append(h('div.kit-app.maps', h('div.kit-split', side, h('div.kit-main', form, stage, foot))));

    // ---------- Karte ----------
    function frameUrl() {
      const b = view.bbox.map((v) => v.toFixed(5)).join('%2C');
      return `${EMBED}?bbox=${b}&layer=${layer}${view.marker ? `&marker=${view.marker.lat.toFixed(5)}%2C${view.marker.lon.toFixed(5)}` : ''}`;
    }
    function showVeil(kind) {
      veil.hidden = !kind;
      if (!kind) return;
      const e = kind === 'offline'
        ? emptyState('wifi', 'Keine Verbindung', 'Die Karte kommt aus dem Netz. Sobald du wieder online bist, lädt sie von selbst.')
        : emptyState('compass', 'Die Karte lädt nicht', 'OpenStreetMap antwortet gerade nicht oder sehr langsam.');
      e.append(h('button.kit-btn.primary', { type: 'button', onclick: () => loadFrame(true) }, 'Erneut versuchen'));
      veil.replaceChildren(e);
    }
    function loadFrame(force = false) {
      const url = frameUrl();
      clearTimeout(slow);
      if (navigator.onLine === false) { wanted = url; loading.hidden = true; showVeil('offline'); return; }
      showVeil(null);
      if (!force && frame.src === url) return;
      wanted = '';
      loading.hidden = false;
      frame.src = url;
      slow = setTimeout(() => { loading.hidden = true; showVeil('slow'); }, 20000);
    }
    frame.addEventListener('load', () => { clearTimeout(slow); loading.hidden = true; if (navigator.onLine !== false) showVeil(null); });

    function paintFoot() {
      const p = center(view);
      fName.textContent = view.name || 'Kartenausschnitt';
      fName.title = [view.name, view.sub].filter(Boolean).join(' – ');
      fCoords.textContent = coordText(p);
      const fav = d.favs.some((f) => near(f, p));
      bStar.classList.toggle('is-on', fav);
      bStar.title = fav ? 'Aus den Favoriten entfernen' : 'Zu den Favoriten hinzufügen';
      bStar.setAttribute('aria-label', bStar.title);
      win.setTitle(view.name ? `${view.name} – Karten` : 'Karten');
    }
    /** Ausschnitt setzen und alles Abhängige nachziehen */
    function setView(next, { remember = false } = {}) {
      view = { name: '', sub: '', marker: null, ...next };
      S.set('view', view);
      if (remember) {
        const p = { name: view.name, sub: view.sub, lat: view.marker.lat, lon: view.marker.lon, bbox: view.bbox };
        d.recent = [p, ...d.recent.filter((r) => !near(r, p))].slice(0, 8);
        save('recent');
      }
      loadFrame();
      paintFoot();
      paintSide();
    }
    const show = (p, opts) => setView({ bbox: p.bbox || around(p.lat, p.lon), marker: { lat: p.lat, lon: p.lon }, name: p.name, sub: p.sub || '' }, opts);
    function zoom(f) {
      const b = scaled(view.bbox, f);
      if (b.every((v, i) => Math.abs(v - view.bbox[i]) < 1e-7)) { toast(win, f < 1 ? 'Näher geht es nicht' : 'Weiter weg geht es nicht'); return; }
      view = { ...view, bbox: b };
      S.set('view', view);
      loadFrame();
    }
    function setLayer(id) {
      layer = id;
      S.set('layer', id);
      loadFrame();
    }
    const layerMenu = () => [{ heading: 'Kartenebene' }, ...LAYERS.map(([id, name]) => ({ label: name, checked: layer === id, run: () => setLayer(id) }))];

    function locate() {
      if (!navigator.geolocation) { toast(win, 'Dieser Browser kann keinen Standort ermitteln'); return; }
      if (bLocate.classList.contains('is-busy')) return;
      bLocate.classList.add('is-busy');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          bLocate.classList.remove('is-busy');
          if (win.closed) return;
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          show({ name: 'Mein Standort', sub: '', lat, lon, bbox: around(lat, lon, 0.008) });
        },
        (err) => {
          bLocate.classList.remove('is-busy');
          if (!win.closed) toast(win, err.code === 1 ? 'Der Standort wurde nicht freigegeben' : 'Der Standort ließ sich nicht ermitteln', 2600);
        },
        { timeout: 12000, maximumAge: 300000 });
    }
    async function copyCoords() {
      const p = center(view);
      toast(win, (await copyText(`${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`)) ? 'Koordinaten kopiert' : 'Kopieren nicht möglich');
    }
    function openOsm() {
      const p = center(view);
      const z = zoomOf(view.bbox, stage.clientWidth);
      const code = LAYERS.find(([id]) => id === layer)[2];
      const url = `https://www.openstreetmap.org/${view.marker ? `?mlat=${p.lat.toFixed(5)}&mlon=${p.lon.toFixed(5)}` : ''}#map=${z}/${p.lat.toFixed(5)}/${p.lon.toFixed(5)}${code ? `&layers=${code}` : ''}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    }

    // ---------- Suche ----------
    function closeResults() { results.hidden = true; }
    function resultsHead(text) {
      return h('header', h('span', text), toolBtn('close', 'Treffer schließen', () => { closeResults(); refocus(); }));
    }
    function paintHits() {
      results.hidden = false;
      if (!hits.list.length) {
        results.replaceChildren(resultsHead(`Suche nach „${hits.q}“`),
          h('div.maps-msg', h('b', 'Nichts gefunden'), h('span', 'Prüfe die Schreibweise oder ergänze den Ort, etwa „Marktplatz, Bremen“.')));
        return;
      }
      results.replaceChildren(resultsHead(`${hits.list.length} Treffer für „${hits.q}“`),
        h('div.maps-list.scroll', hits.list.map((p) => h('button.kit-row', { type: 'button', html: I.pin, onclick: () => { closeResults(); show(p, { remember: true }); refocus(); } },
          h('span.grow', h('b', p.name), h('small', p.sub || coordText(p))), p.kind ? h('span.kit-chip', p.kind) : null))));
    }
    async function search() {
      const q = input.value.trim();
      if (!q || busy) return;
      const xy = parseCoords(q);
      if (xy) { closeResults(); show({ name: 'Koordinaten', sub: '', ...xy }, { remember: true }); return; }
      if (hits && hits.q === q && hits.list.length) { paintHits(); return; }      // dieselbe Suche: keine neue Anfrage
      busy = true;
      bGo.disabled = true;
      results.hidden = false;
      results.replaceChildren(resultsHead(`Suche nach „${q}“`), h('div.maps-msg', { html: icon('reload') }, h('span', 'Suche läuft …')));
      try {
        const list = await lookup(q);
        if (win.closed) return;
        hits = { q, list };
        paintHits();
        if (list.length === 1) { closeResults(); show(list[0], { remember: true }); }
      } catch {
        if (win.closed) return;
        const msg = h('div.maps-msg', h('b', 'Suche nicht möglich'),
          h('span', navigator.onLine === false ? 'Du bist offline. Die Ortssuche braucht eine Internetverbindung.' : 'Der Suchdienst antwortet gerade nicht. Versuch es in einem Moment noch einmal.'),
          h('button.kit-btn', { type: 'button', onclick: () => search() }, 'Erneut versuchen'));
        results.replaceChildren(resultsHead(`Suche nach „${q}“`), msg);
      } finally {
        busy = false;
        bGo.disabled = false;
      }
    }
    form.addEventListener('submit', (e) => { e.preventDefault(); search(); });
    input.addEventListener('focus', () => { if (hits && hits.q === input.value.trim() && hits.list.length > 1 && results.hidden) paintHits(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); if (!results.hidden) closeResults(); else { input.blur(); refocus(); } } });

    // ---------- Favoriten und Verlauf ----------
    async function toggleFav() {
      const p = center(view);
      const old = d.favs.find((f) => near(f, p));
      if (old) {
        d.favs = d.favs.filter((f) => f !== old);
        save('favs');
        toast(win, `„${old.name}“ aus den Favoriten entfernt`);
        return;
      }
      const name = await promptSheet(win, { title: 'Zu den Favoriten', text: 'Unter welchem Namen möchtest du diesen Ort sichern?', value: view.name || 'Kartenausschnitt', ok: 'Sichern' });
      if (!name) return;
      d.favs.push({ id: uid(), name: name.slice(0, 60), sub: view.sub || '', lat: p.lat, lon: p.lon, bbox: view.bbox });
      save('favs');
      toast(win, `„${name.slice(0, 60)}“ gesichert`);
    }
    async function renameFav(f) {
      const name = await promptSheet(win, { title: 'Favorit umbenennen', value: f.name, ok: 'Umbenennen' });
      if (!name) return;
      f.name = name.slice(0, 60);
      save('favs');
    }
    function removeFav(f) {
      d.favs = d.favs.filter((x) => x !== f);
      save('favs');
      toast(win, `„${f.name}“ gelöscht`);
    }
    const favMenu = (f) => [
      { label: 'Anzeigen', icon: 'arrowUpRight', run: () => show(f) },
      { label: 'Umbenennen …', icon: 'note', run: () => renameFav(f) },
      '-',
      { label: 'Löschen', icon: 'trash', run: () => removeFav(f) },
    ];
    const placesMenu = () => [
      { heading: 'Favoriten' },
      ...(d.favs.length ? d.favs.map((f) => ({ label: f.name, checked: near(f, center(view)), run: () => show(f) })) : [{ label: 'Noch keine', disabled: true }]),
      '-', { heading: 'Zuletzt gesucht' },
      ...(d.recent.length ? d.recent.map((r) => ({ label: r.name, run: () => show(r) })) : [{ label: 'Noch nichts', disabled: true }]),
    ];
    function paintSide() {
      const cur = center(view);
      side.replaceChildren(
        h('div.kit-head', h('span', 'Favoriten')),
        ...(d.favs.length ? d.favs.map((f) => {
          const more = toolBtn('chevronDown', `${f.name} bearbeiten`, () => openMenu(favMenu(f), { anchor: more, align: 'right' }));
          const row = h('div.maps-row', { class: near(f, cur) ? 'is-on' : '' },
            h('button.maps-row-main', { type: 'button', html: I.star, title: [f.name, f.sub].filter(Boolean).join(' – '), onclick: () => show(f) }, h('span', f.name)), more);
          row.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); openMenu(favMenu(f), { x: e.clientX, y: e.clientY }); });
          row.addEventListener('dblclick', (e) => { if (!e.target.closest('.tool')) renameFav(f); });
          return row;
        }) : [h('div.maps-hint', 'Mit dem Stern oben sicherst du den gezeigten Ort.')]),
        h('div.kit-head', h('span', 'Zuletzt gesucht'), d.recent.length ? h('button', { type: 'button', onclick: () => { d.recent = []; save('recent'); } }, 'Leeren') : null),
        ...(d.recent.length ? d.recent.map((r) => h('div.maps-row',
          h('button.maps-row-main.is-recent', { type: 'button', html: icon('clock'), title: [r.name, r.sub].filter(Boolean).join(' – '), onclick: () => show(r) }, h('span', r.name))))
          : [h('div.maps-hint', 'Deine letzten Suchen erscheinen hier.')]));
    }

    // ---------- Laufendes ----------
    function refocus() { if (sys.wm.focused === win && !win.el.contains(document.activeElement)) win.el.focus({ preventScroll: true }); }
    const onData = () => { paintSide(); paintFoot(); };
    addEventListener(EVT, onData);
    const onOnline = () => { if (wanted || !veil.hidden) loadFrame(true); };
    addEventListener('online', onOnline);      // offline bleibt die sichtbare Karte stehen; erst ein neuer Ausschnitt zeigt den Hinweis
    // Klicks in die Karte erreichen das System nicht – ein Schild holt ein Fenster im Hintergrund erst nach vorn
    const offFocus = bus.on('focus', (w) => { shield.hidden = w === win; });
    const onKey = (e) => {
      if (e.altKey || e.metaKey || e.ctrlKey || e.target.closest('input, textarea, select')) return;
      const act = { '/': () => { input.focus(); input.select(); }, '+': () => zoom(0.5), '=': () => zoom(0.5), '-': () => zoom(2), Escape: () => closeResults() }[e.key];
      if (act) { e.preventDefault(); act(); }
    };
    win.el.addEventListener('keydown', onKey);

    paintSide();
    paintFoot();
    loadFrame(true);

    return {
      onClose() {
        removeEventListener(EVT, onData);
        removeEventListener('online', onOnline);
        offFocus();
        clearTimeout(slow);
        win.el.removeEventListener('keydown', onKey);
        frame.src = 'about:blank';
      },
      onFocus: refocus,
      menus: () => [
        { label: 'Karte', items: [
          ...layerMenu(),
          '-',
          { label: 'Vergrößern', icon: 'plus', hint: '+', run: () => zoom(0.5) },
          { label: 'Verkleinern', icon: 'minus', hint: '−', run: () => zoom(2) },
          { label: 'Mein Standort', run: () => locate() },
          { label: 'Ort suchen', icon: 'search', hint: '/', run: () => { input.focus(); input.select(); } },
          '-',
          { label: 'Koordinaten kopieren', icon: 'copy', run: () => copyCoords() },
          { label: 'In OpenStreetMap öffnen', icon: 'external', run: () => openOsm() },
        ] },
        { label: 'Favoriten', items: [
          { label: d.favs.some((f) => near(f, center(view))) ? 'Aus den Favoriten entfernen' : 'Zu den Favoriten hinzufügen …', run: () => toggleFav() },
          { label: 'Favorit umbenennen …', disabled: !d.favs.some((f) => near(f, center(view))), run: () => renameFav(d.favs.find((f) => near(f, center(view)))) },
          '-',
          ...placesMenu(),
        ] },
      ],
    };
  },
};
