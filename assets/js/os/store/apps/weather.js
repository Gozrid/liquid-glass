// weather.js — Wetter: Vorhersage von Open-Meteo mit animierter Himmelsszene, Stunden- und 7-Tage-Übersicht
import { h, clamp, lerp, rand, TAU, ticker, debounce, drag, reducedMotion, whenVisible } from '../../../core/util.js';
import { icon } from '../../../core/icons.js';
import { sys } from '../../sys.js';
import { openMenu } from '../../ui.js';
import { style, appStore, toolBtn, emptyState, sheet, timeAgo } from '../../kit.js';

const S = appStore('weather');
const EVT = 'fableos:weather';
const FRESH = 15 * 60000;          // das Fenster lädt höchstens alle 15 Minuten neu
const FRESH_WIDGET = 30 * 60000;   // Widgets höchstens alle 30 Minuten
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const API = 'https://api.open-meteo.com/v1/forecast';
const QUERY = 'current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day'
  + '&hourly=temperature_2m,weather_code,precipitation_probability'
  + '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_sum&timezone=auto&forecast_days=7';

/** WMO-Wettercode → [Beschreibung, Symbolart] */
const WMO = {
  0: ['Klar', 'clear'], 1: ['Überwiegend klar', 'mostly'], 2: ['Teils bewölkt', 'partly'], 3: ['Bedeckt', 'cloudy'],
  45: ['Nebel', 'fog'], 48: ['Reifnebel', 'fog'],
  51: ['Leichter Nieselregen', 'drizzle'], 53: ['Nieselregen', 'drizzle'], 55: ['Starker Nieselregen', 'drizzle'],
  56: ['Gefrierender Nieselregen', 'sleet'], 57: ['Gefrierender Nieselregen', 'sleet'],
  61: ['Leichter Regen', 'rain'], 63: ['Regen', 'rain'], 65: ['Starker Regen', 'rain'],
  66: ['Gefrierender Regen', 'sleet'], 67: ['Gefrierender Regen', 'sleet'],
  71: ['Leichter Schneefall', 'snow'], 73: ['Schneefall', 'snow'], 75: ['Starker Schneefall', 'snow'], 77: ['Schneegriesel', 'snow'],
  80: ['Leichte Regenschauer', 'rain'], 81: ['Regenschauer', 'rain'], 82: ['Heftige Regenschauer', 'rain'],
  85: ['Leichte Schneeschauer', 'snow'], 86: ['Schneeschauer', 'snow'],
  95: ['Gewitter', 'thunder'], 96: ['Gewitter mit Hagel', 'thunder'], 99: ['Gewitter mit Hagel', 'thunder'],
};
const wmo = (code) => WMO[code] || ['Wetter unbekannt', 'cloudy'];
const deg = (v) => `${Math.round(v) || 0}°`;
const num = (v, digits = 0) => Number(v || 0).toLocaleString('de-DE', { maximumFractionDigits: digits });
const hm = (iso) => String(iso || '').slice(11, 16) || '–';

// ---------- eigene Wettersymbole ----------
const CLOUD = 'M6.8 19a4.300 4.300 0 0 1-.7-8.540 5.800 5.800 0 0 1 11.200-1.060A4.850 4.850 0 0 1 17.300 19z';
function wxIcon(code, day = true) {
  const kind = wmo(code)[1];
  const sun = '<circle class="s" cx="12" cy="12" r="4.400"/><path class="sr" d="M12 2.800v2M12 19.200v2M2.800 12h2M19.200 12h2M5.500 5.500l1.400 1.400M17.100 17.100l1.400 1.400M5.500 18.500l1.400-1.400M17.100 6.900l1.400-1.400"/>';
  const moon = '<path class="m" d="M19.500 14.300A8 8 0 0 1 9.700 4.500a8 8 0 1 0 9.800 9.800z"/><circle class="m" cx="17.500" cy="5.500" r=".9"/>';
  const sunS = '<circle class="s" cx="16.700" cy="7.800" r="3.300"/><path class="sr" d="M16.700 1.700V3M22.800 7.800h-1.300M21 3.500l-.9.9M12.400 3.500l.9.9"/>';
  const moonS = '<path class="m" d="M21.800 8.800a5.200 5.200 0 0 1-6.300-6.300 5.200 5.200 0 1 0 6.300 6.300z"/>';
  const cloud = (dy = 0, sc = 1) => `<path class="c" transform="translate(${(1 - sc) * 8} ${dy + (1 - sc) * 19}) scale(${sc})" d="${CLOUD}"/>`;
  const body = {
    clear: day ? sun : moon,
    mostly: `${day ? sunS : moonS}${cloud(1, 0.82)}`,
    partly: `${day ? sunS : moonS}${cloud(0.500, 0.94)}`,
    cloudy: `<path class="c2" transform="translate(5.500 -3.200) scale(.72)" d="${CLOUD}"/>${cloud(0.500)}`,
    fog: `${cloud(-4)}<path class="fg" d="M5 18.300h14M7.500 21.500h9"/>`,
    drizzle: `${cloud(-3.200)}<path class="r" d="M9.300 18.300l-.6 1.900M14.300 18.300l-.6 1.900"/>`,
    rain: `${cloud(-3.200)}<path class="r" d="M8.300 18l-1 3.200M12.500 18l-1 3.200M16.700 18l-1 3.200"/>`,
    sleet: `${cloud(-3.200)}<path class="r" d="M8.500 18l-1 3.200"/><circle class="f" cx="12.300" cy="19.300" r="1.150"/><circle class="f" cx="16.300" cy="21" r="1.150"/>`,
    snow: `${cloud(-3.200)}<circle class="f" cx="8" cy="19" r="1.150"/><circle class="f" cx="12.200" cy="21.200" r="1.150"/><circle class="f" cx="16.400" cy="19" r="1.150"/>`,
    thunder: `${cloud(-3.200)}<path class="b" d="M13.200 13.800l-3.600 4.900h2.600l-1.100 3.900 4-5.400h-2.600l1.300-3.400z"/>`,
  }[kind];
  return `<svg class="weather-ico" viewBox="0 0 24 24" role="img" aria-label="${wmo(code)[0]}">${body}</svg>`;
}
const svg = (body) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const I = {
  wind: svg('<path d="M3 9h10.500a2.700 2.700 0 1 0-2.600-3.500M3 14h14.500a2.700 2.700 0 1 1-2.600 3.500M3 11.500h6"/>'),
  rise: svg('<path d="M3 18.500h18M6.500 18.500a5.500 5.500 0 0 1 11 0M12 5v3.500M5.300 9.800l1.500 1.500M18.700 9.800l-1.500 1.500"/>'),
  rain: svg('<path d="M4 12a8 8 0 0 1 16 0zM12 12v6.500a2.200 2.200 0 0 1-4.400 0M12 2.500V4"/>'),
  temp: svg('<path d="M10 14.200V5.500a2 2 0 0 1 4 0v8.700a4 4 0 1 1-4 0z"/><circle cx="12" cy="17.500" r="1.300" fill="currentColor" stroke="none"/>'),
  pin: svg('<path d="M12 21s-6.500-5.700-6.500-11a6.500 6.500 0 0 1 13 0C18.500 15.300 12 21 12 21z"/><circle cx="12" cy="10" r="2.300"/>'),
};

// ---------- Zeit am Ort ----------
// Die Vorhersage kommt in Ortszeit; gerechnet wird mit „Wanduhr-Millisekunden“ (Ortszeit, als wäre sie UTC).
const isoMs = (s) => Date.parse(`${s}${s.length === 10 ? 'T00:00' : ''}:00Z`);
const placeNow = (d) => Date.now() + d.off * 1000;
const hourIdx = (d) => Math.floor((placeNow(d) - isoMs(d.h.t0)) / 3600e3);
const dayIdx = (d) => clamp(Math.floor((placeNow(d) - isoMs(d.d.time[0])) / 864e5), 0, d.d.time.length - 1);
const expired = (d) => hourIdx(d) >= d.h.temp.length - 1;
/** Ist es zur Stunde i (ab Beginn der Vorhersage) hell? */
function isDayAt(d, i) {
  const k = clamp(Math.floor(i / 24), 0, d.d.time.length - 1);
  const t = isoMs(d.h.t0) + i * 3600e3;
  return t >= isoMs(d.d.rise[k]) && t < isoMs(d.d.set[k]);
}

// ---------- Daten (ein Stand für Fenster und Widgets) ----------
let db = null;
function data() {
  if (db) return db;
  db = { places: S.get('places', null), sel: S.get('sel', null), cache: S.get('cache', {}) || {} };
  if (!Array.isArray(db.places)) {
    db.places = [{ id: 'g2950159', name: 'Berlin', admin: 'Berlin', country: 'Deutschland', lat: 52.52437, lon: 13.41053 }];
    S.set('places', db.places);
  }
  if (!db.places.some((p) => p.id === db.sel)) db.sel = db.places[0]?.id || null;
  return db;
}
const emit = (detail) => dispatchEvent(new CustomEvent(EVT, { detail }));
const current = () => data().places.find((p) => p.id === db.sel) || null;
const cached = (p) => { const c = p && data().cache[p.id]; return c && !expired(c.d) ? c : null; };

async function getJson(url) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(to); }
}
/** Antwort von Open-Meteo auf das eindampfen, was die App braucht */
function slim(r) {
  const c = r.current;
  const hr = r.hourly;
  const dy = r.daily;
  if (!c || !hr?.time?.length || !dy?.time?.length) throw new Error('Unerwartete Antwort');
  return {
    off: r.utc_offset_seconds || 0,
    cur: { time: c.time, temp: c.temperature_2m, feel: c.apparent_temperature, hum: c.relative_humidity_2m, code: c.weather_code, wind: c.wind_speed_10m, day: !!c.is_day },
    h: { t0: hr.time[0], temp: hr.temperature_2m, code: hr.weather_code, pop: hr.precipitation_probability },
    d: { time: dy.time, code: dy.weather_code, max: dy.temperature_2m_max, min: dy.temperature_2m_min, rise: dy.sunrise, set: dy.sunset, uv: dy.uv_index_max, rain: dy.precipitation_sum },
  };
}
const inflight = new Map();
/** Vorhersage für einen Ort: aus dem Cache, solange er frisch genug ist, sonst vom Netz. Wirft bei Fehlern. */
function load(place, { force = false, maxAge = FRESH } = {}) {
  const c = cached(place);
  if (!force && c && Date.now() - c.t < maxAge) return Promise.resolve(c);
  if (inflight.has(place.id)) return inflight.get(place.id);
  const job = getJson(`${API}?latitude=${place.lat}&longitude=${place.lon}&${QUERY}`)
    .then((r) => {
      const entry = { t: Date.now(), d: slim(r) };
      if (data().places.some((p) => p.id === place.id)) { db.cache[place.id] = entry; S.set('cache', db.cache); }
      emit({ place: place.id });
      return entry;
    })
    .finally(() => inflight.delete(place.id));
  inflight.set(place.id, job);
  return job;
}
async function geocode(q) {
  const r = await getJson(`${GEO}?name=${encodeURIComponent(q)}&count=6&language=de`);
  return (r.results || []).map((x) => ({ id: `g${x.id}`, name: x.name, admin: x.admin1 || '', country: x.country || '', lat: x.latitude, lon: x.longitude }));
}

// ---------- Himmelsszene (Canvas) ----------
function sceneFor(code, night) {
  const kind = wmo(code)[1];
  const rain = { 51: 0.2, 53: 0.35, 55: 0.5, 56: 0.3, 57: 0.45, 61: 0.45, 63: 0.7, 65: 1, 66: 0.45, 67: 0.75, 80: 0.5, 81: 0.75, 82: 1, 95: 0.8, 96: 0.9, 99: 1 }[code] || 0;
  const snow = { 56: 0.2, 57: 0.25, 66: 0.2, 67: 0.3, 71: 0.35, 73: 0.65, 75: 1, 77: 0.4, 85: 0.5, 86: 0.9 }[code] || 0;
  const cloud = { clear: 0, mostly: 0.22, partly: 0.5, cloudy: 1, fog: 0.72 }[kind] ?? 0.92;
  return { cloud, rain, snow, fog: kind === 'fog' ? 1 : 0, thunder: kind === 'thunder', night };
}
function makeScene(canvas) {
  const g = canvas.getContext('2d');
  let W = 1, H = 1, dpr = 1;
  let p = { cloud: 0, rain: 0, snow: 0, fog: 0, thunder: false, night: false, sun: 0.5, dusk: 0 };
  let stars = [], clouds = [], drops = [], flakes = [], fogs = [];
  let sprite = null, haze = null, moon = null;
  let bolt = null, flash = 0, nextBolt = 1.5, meteor = null, nextMeteor = 5;
  let time = rand(60);
  const mix = (a, b, k) => a.map((v, i) => Math.round(lerp(v, b[i], clamp(k))));
  const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  function sky() {
    let top, bot;
    if (p.night) {
      const k = Math.max(p.cloud * 0.7, p.rain, p.snow * 0.6, p.fog * 0.7);
      top = mix([6, 9, 32], [16, 19, 36], k);
      bot = mix([28, 36, 88], [46, 52, 80], k);
    } else {
      top = mix([34, 108, 212], [84, 102, 134], p.cloud * 0.9);
      bot = mix([110, 180, 246], [146, 162, 188], p.cloud * 0.9);
      top = mix(top, [56, 68, 94], p.rain * 0.75);
      bot = mix(bot, [100, 114, 140], p.rain * 0.75);
      top = mix(top, [102, 116, 146], p.snow * 0.6);
      bot = mix(bot, [168, 180, 202], p.snow * 0.6);
      top = mix(top, [104, 114, 134], p.fog * 0.8);
      bot = mix(bot, [152, 160, 176], p.fog * 0.8);
    }
    if (p.thunder) { top = mix(top, [28, 28, 52], 0.75); bot = mix(bot, [66, 68, 100], 0.75); }
    return [top, bot];
  }
  function soft(w, hgt, puffs, color) {
    const c = document.createElement('canvas');
    c.width = w; c.height = hgt;
    const x = c.getContext('2d');
    for (const [px, py, r] of puffs) {
      const gr = x.createRadialGradient(px, py - r * 0.25, r * 0.1, px, py, r);
      gr.addColorStop(0, rgb(color, 0.95)); gr.addColorStop(0.55, rgb(color, 0.62)); gr.addColorStop(1, rgb(color, 0));
      x.fillStyle = gr;
      x.beginPath(); x.arc(px, py, r, 0, TAU); x.fill();
    }
    return c;
  }
  function seed() {
    const wet = Math.max(p.rain, p.thunder ? 0.8 : 0);
    const col = p.night ? mix([92, 104, 150], [54, 60, 92], Math.max(wet, p.cloud * 0.5)) : mix(mix([255, 255, 255], [168, 178, 196], wet), [86, 90, 118], p.thunder ? 0.8 : 0);
    sprite = soft(320, 160, [[70, 106, 46], [118, 86, 58], [174, 74, 64], [228, 98, 52], [150, 114, 60], [262, 114, 38], [96, 118, 40]], col);
    haze = soft(400, 120, [[90, 60, 60], [200, 60, 60], [310, 60, 60], [145, 60, 58], [255, 60, 58]], p.night ? [120, 130, 160] : [236, 240, 248]);
    // Mondsichel: Scheibe, aus der eine versetzte Scheibe ausgestanzt wird
    const mr = clamp(H * 0.115, 16, 34) * 0.82;
    moon = document.createElement('canvas');
    moon.width = moon.height = Math.ceil((mr + 2) * 4);
    const mx = moon.getContext('2d');
    mx.scale(2, 2);
    mx.fillStyle = '#f4f1e2';
    mx.beginPath(); mx.arc(mr + 2, mr + 2, mr, 0, TAU); mx.fill();
    mx.globalCompositeOperation = 'destination-out';
    mx.beginPath(); mx.arc(mr + 2 + mr * 0.44, mr + 2 - mr * 0.18, mr * 0.9, 0, TAU); mx.fill();
    const area = (W * H) / 1000;
    stars = p.night ? Array.from({ length: Math.round(area * 0.55 * (1 - p.cloud * 0.85)) }, () => ({ x: rand(W), y: rand(H * 0.8), r: rand(0.5, 1.5), ph: rand(TAU), sp: rand(0.6, 2.4) })) : [];
    const nCloud = p.cloud ? Math.round(1 + p.cloud * 7) : 0;
    clouds = Array.from({ length: nCloud }, (_, i) => {
      const s = rand(0.45, 1.25) * clamp(H / 220, 0.7, 1.3);
      return { x: rand(-160, W), y: H * (p.cloud > 0.8 ? rand(-0.08, 0.42) : rand(0, 0.34)) + (i % 2) * 8, s, v: rand(4, 12) * (0.5 + s * 0.6), a: (p.night ? rand(0.5, 0.8) : rand(0.62, 0.95)) };
    }).sort((a, b) => a.s - b.s);
    drops = Array.from({ length: Math.min(260, Math.round(p.rain * W * 0.34)) }, () => ({ x: rand(-40, W), y: rand(H), l: rand(9, 20), v: rand(520, 880), near: Math.random() < 0.45 }));
    flakes = Array.from({ length: Math.min(170, Math.round(p.snow * W * 0.26)) }, () => ({ x: rand(W), y: rand(H), r: rand(0.8, 2.7), v: rand(18, 52), sw: rand(8, 22), ph: rand(TAU) }));
    fogs = p.fog ? Array.from({ length: 5 }, (_, i) => ({ x: rand(-200, W), y: H * (0.28 + i * 0.13), s: rand(1.2, 2.2), v: rand(5, 14) * (i % 2 ? 1 : -1), a: rand(0.16, 0.3) })) : [];
    bolt = null; flash = 0; meteor = null;
  }
  function draw(dt) {
    time += dt;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const [top, bot] = sky();
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, rgb(top)); gr.addColorStop(1, rgb(bot));
    g.globalAlpha = 1;
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    if (p.dusk > 0.02) {                                   // Dämmerung: warmer Horizont
      const d2 = g.createLinearGradient(0, H * 0.25, 0, H);
      d2.addColorStop(0, 'rgba(255,140,90,0)'); d2.addColorStop(1, `rgba(255,150,96,${0.6 * p.dusk * (1 - p.cloud * 0.6)})`);
      g.fillStyle = d2;
      g.fillRect(0, 0, W, H);
    }
    for (const s of stars) {
      g.globalAlpha = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(time * s.sp + s.ph));
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(s.x, s.y, s.r * 0.6, 0, TAU); g.fill();
    }
    g.globalAlpha = 1;
    if (p.night && p.cloud < 0.4 && !reducedMotion.matches) {    // ab und zu eine Sternschnuppe
      nextMeteor -= dt;
      if (nextMeteor <= 0 && !meteor) { meteor = { x: rand(W * 0.2, W * 0.8), y: rand(H * 0.05, H * 0.3), life: 0 }; nextMeteor = rand(7, 16); }
      if (meteor) {
        meteor.life += dt;
        const k = meteor.life / 0.7;
        const mx = meteor.x + k * 150, my = meteor.y + k * 60;
        const mg = g.createLinearGradient(mx - 60, my - 24, mx, my);
        mg.addColorStop(0, 'rgba(255,255,255,0)'); mg.addColorStop(1, `rgba(255,255,255,${0.8 * Math.sin(Math.min(1, k) * Math.PI)})`);
        g.strokeStyle = mg; g.lineWidth = 1.4; g.lineCap = 'round';
        g.beginPath(); g.moveTo(mx - 60, my - 24); g.lineTo(mx, my); g.stroke();
        if (k >= 1) meteor = null;
      }
    }
    // Sonne oder Mond wandern mit der Tageszeit über die rechte Bildhälfte
    const cx = W * lerp(0.5, 0.9, p.sun);
    const cy = H * (0.72 - Math.sin(p.sun * Math.PI) * 0.52);
    const vis = 1 - clamp((p.cloud - 0.5) / 0.36);       // hinter dichten Wolken verschwinden sie ganz
    if (vis > 0.03) {
      const R = clamp(H * 0.115, 16, 34);
      if (!p.night) {
        const glow = g.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 6.5);
        glow.addColorStop(0, `rgba(255,236,170,${0.55 * vis})`); glow.addColorStop(0.4, `rgba(255,226,150,${0.16 * vis})`); glow.addColorStop(1, 'rgba(255,226,150,0)');
        g.fillStyle = glow;
        g.fillRect(0, 0, W, H);
        g.save();
        g.translate(cx, cy);
        g.rotate(time * 0.05);
        const beam = g.createRadialGradient(0, 0, R, 0, 0, R * 5.6);
        beam.addColorStop(0, `rgba(255,244,200,${0.11 * vis})`); beam.addColorStop(1, 'rgba(255,244,200,0)');
        g.fillStyle = beam;
        for (let i = 0; i < 10; i++) { g.rotate(TAU / 10); g.beginPath(); g.moveTo(0, 0); g.lineTo(R * 5.6, -R * 0.6); g.lineTo(R * 5.6, R * 0.6); g.closePath(); g.fill(); }
        g.restore();
        const disc = g.createRadialGradient(cx - R * 0.25, cy - R * 0.25, R * 0.1, cx, cy, R);
        disc.addColorStop(0, `rgba(255,253,236,${vis})`); disc.addColorStop(1, `rgba(255,214,120,${vis})`);
        g.fillStyle = disc;
        g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
      } else {
        const r2 = R * 0.82;
        const halo = g.createRadialGradient(cx, cy, r2 * 0.6, cx, cy, r2 * 4.5);
        halo.addColorStop(0, `rgba(210,220,255,${0.26 * vis})`); halo.addColorStop(1, 'rgba(210,220,255,0)');
        g.fillStyle = halo;
        g.fillRect(0, 0, W, H);
        g.globalAlpha = vis;
        g.drawImage(moon, cx - r2 - 2, cy - r2 - 2, moon.width / 2, moon.height / 2);
        g.globalAlpha = 1;
      }
    }
    for (const c of clouds) {
      c.x += c.v * dt;
      if (c.x > W + 20) c.x = -320 * c.s - rand(60);
      g.globalAlpha = c.a;
      g.drawImage(sprite, c.x, c.y, 320 * c.s, 160 * c.s);
    }
    g.globalAlpha = 1;
    if (p.thunder && !reducedMotion.matches) {
      nextBolt -= dt;
      if (nextBolt <= 0) {
        const pts = [[rand(W * 0.42, W * 0.9), H * 0.22]];
        while (pts[pts.length - 1][1] < H * 0.82) { const [bx, by] = pts[pts.length - 1]; pts.push([bx + rand(-16, 14), by + rand(10, 24)]); }
        bolt = { pts, life: 0.2 };
        flash = 1;
        nextBolt = rand(2.6, 7);
      }
      if (bolt) {
        bolt.life -= dt;
        g.lineJoin = 'round'; g.lineCap = 'round';
        for (const [lw, a] of [[6, 0.22], [1.6, 0.95]]) {
          g.strokeStyle = `rgba(236,240,255,${a * clamp(bolt.life / 0.12)})`; g.lineWidth = lw;
          g.beginPath(); bolt.pts.forEach(([bx, by], i) => (i ? g.lineTo(bx, by) : g.moveTo(bx, by))); g.stroke();
        }
        if (bolt.life <= 0) bolt = null;
      }
      flash *= Math.exp(-dt * 6);
      if (flash > 0.02) { g.fillStyle = `rgba(226,232,255,${flash * 0.32})`; g.fillRect(0, 0, W, H); }
    }
    if (drops.length) {
      g.lineCap = 'round';
      for (const near of [false, true]) {
        g.strokeStyle = near ? 'rgba(214,232,255,.5)' : 'rgba(214,232,255,.26)';
        g.lineWidth = near ? 1.3 : 0.9;
        g.beginPath();
        for (const d of drops) {
          if (d.near !== near) continue;
          const sp = d.v * (near ? 1 : 0.72);
          d.y += sp * dt; d.x += sp * 0.2 * dt;
          if (d.y > H + 20) { d.y = -20; d.x = rand(-60, W); }
          g.moveTo(d.x, d.y); g.lineTo(d.x - d.l * 0.2, d.y - d.l);
        }
        g.stroke();
      }
    }
    if (flakes.length) {
      g.fillStyle = '#fff';
      for (const f of flakes) {
        f.y += f.v * (0.6 + f.r * 0.3) * dt;
        if (f.y > H + 6) { f.y = -6; f.x = rand(W); }
        g.globalAlpha = clamp(0.35 + f.r * 0.22);
        g.beginPath(); g.arc(f.x + Math.sin(time * 0.9 + f.ph) * f.sw, f.y, f.r, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
    }
    for (const f of fogs) {
      f.x += f.v * dt;
      if (f.v > 0 && f.x > W + 40) f.x = -400 * f.s; else if (f.v < 0 && f.x < -400 * f.s - 40) f.x = W;
      g.globalAlpha = f.a;
      g.drawImage(haze, f.x, f.y, 400 * f.s, 120 * f.s);
    }
    g.globalAlpha = 1;
    // zwei Hügelketten geben dem Bild Boden
    const land = p.snow > 0.3 ? [232, 238, 250] : p.night ? [4, 6, 22] : mix([20, 52, 78], [34, 40, 58], Math.max(p.cloud, p.rain));
    for (const [amp, base, a, ph, f] of [[9, 0.87, 0.34, 0.6, 1.1], [13, 0.94, 0.62, 2.4, 0.7]]) {
      g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W + 12; x += 12) g.lineTo(x, H * base + Math.sin((x / W) * TAU * f + ph) * amp + Math.sin((x / W) * TAU * f * 2.3 + ph) * amp * 0.35);
      g.lineTo(W, H); g.closePath();
      g.fillStyle = rgb(land, a * (p.snow > 0.3 ? 0.85 : 1));
      g.fill();
    }
  }
  return {
    resize(w, hgt) {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, Math.round(w)); H = Math.max(1, Math.round(hgt));
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      seed();
      draw(0);
    },
    set(next) {
      const before = JSON.stringify({ ...p, sun: 0, dusk: 0 });
      p = { ...p, ...next };
      if (JSON.stringify({ ...p, sun: 0, dusk: 0 }) !== before) seed();
      draw(0);
    },
    draw,
  };
}

/** Farbe zu einer Temperatur – aus den Farbtönen des Systems gemischt */
function tempColor(t) {
  const stops = [[-12, 'var(--c-violet)'], [0, 'var(--c-cyan)'], [12, 'var(--c-mint)'], [23, 'var(--c-amber)'], [34, 'var(--c-coral)']];
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) return `color-mix(in oklab, ${stops[i][1]} ${Math.round(((t - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0])) * 100)}%, ${stops[i - 1][1]})`;
  }
  return stops[stops.length - 1][1];
}
const windText = (v) => ['Windstille', 'Leiser Zug', 'Leichte Brise', 'Schwache Brise', 'Mäßige Brise', 'Frische Brise', 'Starker Wind', 'Steifer Wind', 'Stürmischer Wind', 'Sturm', 'Schwerer Sturm', 'Orkanartiger Sturm', 'Orkan'][[1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118].findIndex((x) => v < x)] ?? 'Orkan';
const uvText = (v) => (v < 3 ? 'Niedrig' : v < 6 ? 'Mäßig' : v < 8 ? 'Hoch' : v < 11 ? 'Sehr hoch' : 'Extrem');
const humText = (v) => (v < 35 ? 'Trockene Luft' : v < 65 ? 'Angenehm' : v < 85 ? 'Feucht' : 'Sehr feucht');
const dayName = (iso, i, today) => (i === today ? 'Heute' : new Date(isoMs(iso)).toLocaleDateString('de-DE', { weekday: 'short', timeZone: 'UTC' }));
const placeSub = (p) => (p.here ? `${num(p.lat, 2)}° N, ${num(p.lon, 2)}° O` : [p.admin !== p.name ? p.admin : '', p.country].filter(Boolean).join(', '));

style('weather', `
.weather-win .kit-sheet-wrap { grid-template-rows: minmax(0, 1fr); align-items: start; }
.weather-ico { display: block; flex: none; width: 26px; height: 26px; overflow: visible; --wx-cloud: color-mix(in srgb, var(--fg) 74%, transparent); }
[data-theme="light"] .weather-ico { --wx-cloud: color-mix(in srgb, var(--fg) 36%, transparent); }
.weather-ico .s, .weather-ico .b { fill: var(--c-amber); }
.weather-ico .sr { fill: none; stroke: var(--c-amber); stroke-width: 1.7; stroke-linecap: round; }
.weather-ico .m { fill: var(--c-violet); }
.weather-ico .c { fill: var(--wx-cloud); }
.weather-ico .c2 { fill: var(--wx-cloud); opacity: .5; }
.weather-ico .r { fill: none; stroke: var(--c-cyan); stroke-width: 1.8; stroke-linecap: round; }
.weather-ico .f { fill: var(--c-cyan); }
.weather-ico .fg { fill: none; stroke: var(--fg-3); stroke-width: 1.7; stroke-linecap: round; }
[data-theme="light"] .weather-ico .s, [data-theme="light"] .weather-ico .b { fill: color-mix(in srgb, var(--c-amber) 86%, var(--c-coral)); }
[data-theme="light"] .weather-ico .sr { stroke: color-mix(in srgb, var(--c-amber) 86%, var(--c-coral)); }
[data-theme="light"] .weather-ico .r { stroke: color-mix(in srgb, var(--c-cyan) 78%, var(--fg)); }
[data-theme="light"] .weather-ico .f { fill: color-mix(in srgb, var(--c-cyan) 78%, var(--fg)); }

.weather .kit-split { --side: 220px; }
.weather-side { gap: 2px; padding: 10px 8px; }
.weather-side > .weather-place { gap: 8px; padding: 8px 10px 8px 12px; border-radius: 12px; color: var(--fg); transition: background-color .2s, transform .4s var(--spring); }
.weather-side > .weather-place:active { transform: scale(.98); }
.weather-place > div { display: grid; flex: 1; min-width: 0; }
.weather-place b { font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.weather-place small { font-size: 11.5px; font-weight: 500; color: var(--fg-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.weather-side > .weather-place > span:first-of-type { display: flex; align-items: center; gap: 4px; flex: none; overflow: visible; font-family: var(--font-round); font-size: 19px; font-weight: 500; font-variant-numeric: tabular-nums; }
.weather-place .weather-ico { width: 22px; height: 22px; }
.weather-side > .weather-addbtn { margin-top: 4px; font-size: 12.5px; font-weight: 600; color: var(--fg-3); }
.weather-side > .weather-addbtn:hover { color: var(--fg); }
.weather-side > .weather-addbtn .ico { width: 14px; height: 14px; }

.weather-main { flex: 1; min-height: 0; padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 12px; }
.weather-main > * { flex: none; }
.weather-note { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 13px; border-radius: 12px; background: color-mix(in srgb, var(--c-amber) 20%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c-amber) 40%, transparent); font-size: 12.5px; }
.weather-note span { flex: 1; min-width: 0; }
.weather-note .kit-btn { padding: 4px 11px; font-size: 12px; }
.weather-hero { position: relative; display: grid; align-content: space-between; height: 232px; padding: 16px 20px 18px; overflow: hidden; border-radius: 20px; color: #fff; background: #2a6fd6; box-shadow: inset 0 0 0 .5px rgba(255, 255, 255, .25), 0 14px 30px -18px rgba(0, 0, 14, .6); isolation: isolate; }
.weather-hero canvas { position: absolute; inset: 0; z-index: -2; width: 100%; height: 100%; }
.weather-hero::before { content: ""; position: absolute; inset: 0; z-index: -1; background: linear-gradient(100deg, rgba(0, 4, 30, .34), rgba(0, 4, 30, .1) 46%, transparent 68%); }
.weather-name { display: inline-flex; align-items: center; gap: 5px; justify-self: start; max-width: 100%; padding: 0; border: 0; background: none; color: inherit; font-size: 17px; font-weight: 700; text-shadow: 0 1px 8px rgba(0, 0, 30, .35); cursor: default; }
.weather-name span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.weather-name .ico { width: 15px; height: 15px; flex: none; }
.weather-name .ico:last-child { display: none; stroke-width: 2.4; }
.weather-now { display: grid; gap: 0; text-shadow: 0 1px 10px rgba(0, 0, 30, .35); }
.weather-temp { font-family: var(--font-round); font-size: 78px; font-weight: 300; line-height: 1; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }
.weather-cond { margin-top: 2px; font-size: 16px; font-weight: 650; }
.weather-sub { font-size: 13px; font-weight: 500; opacity: .88; font-variant-numeric: tabular-nums; }
.weather-card { padding: 12px 14px; border-radius: 16px; background: var(--raise); }
.weather-card h3 { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--fg-3); }
.weather-card h3 .ico { width: 13px; height: 13px; }
.weather-hours { display: flex; gap: 2px; margin: 0 -6px -6px; padding: 0 0 6px; overflow-x: auto; overflow-y: hidden; cursor: grab; }
.weather-hours:active { cursor: grabbing; }
.weather-hour { display: grid; justify-items: center; gap: 5px; flex: none; width: 54px; padding: 6px 0; border-radius: 12px; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.weather-hour.is-now { background: var(--raise); }
.weather-hour > span:first-child { font-weight: 600; color: var(--fg-2); white-space: nowrap; }
.weather-hour i { height: 13px; font-style: normal; font-size: 10.5px; font-weight: 700; line-height: 13px; color: var(--c-cyan); }
[data-theme="light"] .weather-hour i, [data-theme="light"] .weather-day-rain { color: color-mix(in srgb, var(--c-cyan) 70%, var(--fg)); }
.weather-hour b { font-size: 14.5px; font-weight: 600; }
.weather-day { display: grid; grid-template-columns: 52px 28px 56px 34px minmax(40px, 1fr) 34px; align-items: center; gap: 8px; padding: 7px 0; border-top: .5px solid var(--line); font-size: 13.5px; font-variant-numeric: tabular-nums; }
.weather-day:first-of-type { border-top: 0; }
.weather-day > span:first-child { font-weight: 650; }
.weather-day-rain { font-size: 11.5px; font-weight: 700; color: var(--c-cyan); white-space: nowrap; }
.weather-day-lo { text-align: right; color: var(--fg-3); }
.weather-day-hi { text-align: right; font-weight: 650; }
.weather-bar { position: relative; height: 6px; border-radius: 9px; background: var(--well); }
.weather-bar i { position: absolute; top: 0; bottom: 0; left: calc(var(--a) * 100%); right: calc((1 - var(--b)) * 100%); min-width: 6px; border-radius: inherit; }
.weather-bar em { position: absolute; top: 50%; left: calc(var(--n) * 100%); width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%; background: var(--fg); box-shadow: 0 0 0 2.5px var(--solid); }
.weather-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.weather-tile { display: grid; align-content: start; gap: 2px; min-width: 0; min-height: 104px; }
.weather-tile b { font-family: var(--font-round); font-size: 27px; font-weight: 500; line-height: 1.15; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.weather-tile b small { margin-left: 3px; font-family: var(--font); font-size: 13px; font-weight: 600; letter-spacing: 0; color: var(--fg-3); }
.weather-tile > span { font-size: 12.5px; color: var(--fg-2); }
.weather-uv { position: relative; height: 5px; margin: 7px 0 3px; border-radius: 9px; background: linear-gradient(90deg, var(--c-mint), var(--c-amber) 45%, var(--c-coral) 72%, var(--c-violet)); }
.weather-uv em { position: absolute; top: 50%; left: calc(var(--n) * 100%); width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px; border-radius: 50%; background: var(--fg); box-shadow: 0 0 0 2.5px var(--solid); }
.weather-arc { display: block; width: 100%; height: 46px; margin-top: 2px; overflow: visible; }
.weather-arc path { fill: none; stroke: var(--fg-4); stroke-width: 1.6; stroke-dasharray: 3 4; stroke-linecap: round; }
.weather-arc line { stroke: var(--line); stroke-width: 1; }
.weather-arc circle { fill: var(--c-amber); stroke: var(--solid); stroke-width: 2; }
.weather-arc circle.is-down { fill: var(--fg-4); }
.weather-foot { padding: 0 4px; font-size: 11.5px; color: var(--fg-3); }
.weather-foot a { text-decoration: underline; text-underline-offset: 2px; }
.weather-state { flex: 1; display: grid; }
.weather-state .kit-btn { margin-top: 8px; }
.weather-spin .ico { animation: weather-spin 1s linear infinite; }
@keyframes weather-spin { to { rotate: 360deg; } }

/* Ortssuche */
.weather-find { display: grid; gap: 10px; min-height: 0; }
.weather-find-list { display: grid; align-content: start; gap: 1px; height: 214px; min-height: 60px; padding: 5px; border-radius: 11px; background: var(--well); box-shadow: inset 0 0 0 1px var(--line); }
.weather-find-list .kit-row { padding: 6px 9px; }
.weather-find-list .kit-row small { display: block; font-size: 11.5px; color: var(--fg-3); }
.weather-find-list .kit-row .ico { width: 15px; height: 15px; color: var(--accent); }
.weather-find-list .kit-empty { padding: 18px; }
.weather-find .kit-btn .ico { color: var(--accent); }

/* Widgets */
.weather-w { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.weather-w-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; }
.weather-w-top b { min-width: 0; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.weather-w-top .weather-ico { width: 30px; height: 30px; margin: -2px -2px 0 0; }
.weather-w-temp { margin-top: -2px; font-family: var(--font-round); font-size: 52px; font-weight: 300; line-height: 1.08; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }
.weather-w-cond { margin-top: auto; font-size: 12.5px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.weather-w-sub { font-size: 12px; color: var(--fg-3); font-variant-numeric: tabular-nums; }
.weather-w-none { display: grid; place-content: center; justify-items: center; gap: 4px; height: 100%; text-align: center; font-size: 12px; color: var(--fg-3); }
.weather-w-none b { font-size: 13px; color: var(--fg-2); }
.weather-w-head { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.weather-w-head b { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.weather-w-head span { flex: 1; min-width: 0; font-size: 12.5px; color: var(--fg-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.weather-w-head em { flex: none; font-style: normal; font-family: var(--font-round); font-size: 22px; font-weight: 500; line-height: 1; }
.weather-w-days { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; margin-top: auto; }
.weather-w-day { display: grid; justify-items: center; gap: 4px; padding: 7px 0 6px; border-radius: 13px; background: var(--raise); font-size: 12px; font-variant-numeric: tabular-nums; }
.weather-w-day span:first-child { font-size: 11.5px; font-weight: 700; color: var(--fg-2); }
.weather-w-day b { font-size: 13.5px; }
.weather-w-day small { margin-top: -4px; font-size: 11.5px; color: var(--fg-3); }

@container win (max-width: 560px) {
  .weather-name { cursor: pointer; }
  .weather-name .ico:last-child { display: block; }
  .weather-main { padding: 10px; gap: 10px; }
  .weather-hero { height: 196px; padding: 14px 16px; }
  .weather-temp { font-size: 64px; }
  .weather-day { grid-template-columns: 44px 26px 34px minmax(30px, 1fr) 34px; gap: 6px; }
  .weather-day-rain { display: none; }
  .weather-tiles { grid-template-columns: 1fr 1fr; gap: 10px; }
}
`);

export default {
  singleton: true,
  width: 860, height: 640, minW: 400, minH: 420,

  mount(win) {
    const d = data();
    const errors = new Map();      // Ort → letzter Ladefehler
    let loading = false;
    let sheetOpen = false;

    win.el.classList.add('weather-win');
    const bReload = toolBtn('reload', 'Aktualisieren (R)', () => refresh(true));
    win.tools.append(bReload, toolBtn('plus', 'Ort hinzufügen (N)', () => addPlace()));

    // ---------- Gerüst (bleibt stehen, Inhalte werden nachgefüllt) ----------
    const side = h('aside.kit-side.weather-side.scroll');
    const canvas = h('canvas', { 'aria-hidden': 'true' });
    const scene = makeScene(canvas);
    const name = h('button.weather-name', { type: 'button' });
    const temp = h('div.weather-temp');
    const cond = h('div.weather-cond');
    const sub = h('div.weather-sub');
    const hero = h('section.weather-hero', canvas, name, h('div.weather-now', temp, cond, sub));
    const note = h('div.weather-note', { hidden: true, role: 'status' });
    const hours = h('div.weather-hours.scroll');
    const days = h('div');
    const tiles = h('div.weather-tiles');
    const foot = h('footer.weather-foot');
    const content = [hero,
      h('section.weather-card', h('h3', { html: icon('clock') }, 'Nächste 24 Stunden'), hours),
      h('section.weather-card', h('h3', { html: I.temp }, '7-Tage-Vorhersage'), days),
      tiles, foot];
    const state = h('div.weather-state', { hidden: true });
    const main = h('div.weather-main.scroll', note, ...content, state);
    win.body.append(h('div.kit-app.weather', h('div.kit-split', side, h('div.kit-main', main))));
    // Stundenleiste lässt sich mit der Maus ziehen
    let grab = 0;
    drag(hours, {
      start: (e) => { if (e.pointerType !== 'mouse') return false; grab = hours.scrollLeft; return true; },
      move: (e, c) => { hours.scrollLeft = grab - c.dx; },
    });

    // ---------- Seitenleiste ----------
    function paintSide() {
      side.replaceChildren(
        ...d.places.map((p) => {
          const c = cached(p);
          const b = h('button.weather-place', { type: 'button', class: p.id === d.sel ? 'is-on' : '', onclick: () => select(p.id) },
            h('div', h('b', p.name), h('small', placeSub(p))),
            c ? h('span', { html: wxIcon(c.d.cur.code, c.d.cur.day) }, deg(c.d.cur.temp)) : h('span', '–'));
          b.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); openMenu(placeMenu(p), { x: e.clientX, y: e.clientY }); });
          return b;
        }),
        h('button.weather-addbtn', { type: 'button', html: icon('plus'), onclick: () => addPlace() }, h('span', 'Ort hinzufügen')));
      refocus();
    }
    const placeMenu = (p) => [
      { label: 'Anzeigen', disabled: p.id === d.sel, run: () => select(p.id) },
      { label: 'An den Anfang', disabled: d.places[0] === p, run: () => { d.places = [p, ...d.places.filter((x) => x !== p)]; S.set('places', d.places); paintSide(); } },
      '-',
      { label: 'Entfernen', icon: 'trash', run: () => removePlace(p) },
    ];
    const switchMenu = () => [
      ...d.places.map((p) => { const c = cached(p); return { label: p.name, checked: p.id === d.sel, hint: c ? deg(c.d.cur.temp) : '', run: () => select(p.id) }; }),
      '-',
      { label: 'Ort hinzufügen …', icon: 'plus', run: () => addPlace() },
      { label: 'Diesen Ort entfernen', icon: 'trash', disabled: !current(), run: () => removePlace(current()) },
    ];
    name.addEventListener('click', () => { if (win.body.clientWidth <= 560) openMenu(switchMenu(), { anchor: name }); });

    function select(id) {
      d.sel = id;
      S.set('sel', id);
      emit({ sel: true });
      main.scrollTop = 0;
      refresh(false);
    }
    function removePlace(p) {
      d.places = d.places.filter((x) => x !== p);
      delete d.cache[p.id];
      errors.delete(p.id);
      S.set('places', d.places);
      S.set('cache', d.cache);
      if (d.sel === p.id) { d.sel = d.places[0]?.id || null; S.set('sel', d.sel); }
      emit({ sel: true });
      refresh(false);
    }
    function addOrSelect(p) {
      const i = d.places.findIndex((x) => x.id === p.id);
      if (i >= 0) d.places[i] = p; else d.places.push(p);
      if (i >= 0) delete d.cache[p.id];
      S.set('places', d.places);
      select(p.id);
    }

    // ---------- Hauptansicht ----------
    function showState(el) {
      for (const c of content) c.hidden = !!el;
      state.hidden = !el;
      if (el) { note.hidden = true; state.replaceChildren(el); }
    }
    function paintMain() {
      const p = current();
      if (!p) {
        const e = emptyState('search', 'Noch kein Ort', 'Füge einen Ort hinzu, um die Vorhersage zu sehen.');
        e.append(h('button.kit-btn.primary', { type: 'button', onclick: () => addPlace() }, 'Ort hinzufügen'));
        showState(e);
        win.setTitle('Wetter');
        return;
      }
      win.setTitle(`${p.name} – Wetter`);
      const c = cached(p);
      const err = errors.get(p.id);
      if (!c) {
        if (err) {
          const e = emptyState('wifi', 'Keine Wetterdaten', navigator.onLine === false
            ? `Du bist offline. Sobald die Verbindung steht, lädt die Vorhersage für ${p.name}.`
            : `Die Vorhersage für ${p.name} ließ sich nicht laden. Versuch es gleich noch einmal.`);
          e.append(h('button.kit-btn.primary', { type: 'button', onclick: () => refresh(true) }, 'Erneut versuchen'));
          showState(e);
        } else {
          const e = emptyState('reload', 'Vorhersage wird geladen …', p.name);
          e.classList.add('weather-spin');
          showState(e);
        }
        return;
      }
      showState(null);
      note.hidden = !err;
      if (err) {
        note.replaceChildren(h('span', `${navigator.onLine === false ? 'Offline' : 'Aktualisieren nicht möglich'} – du siehst den Stand von ${timeAgo(c.t)}.`),
          h('button.kit-btn', { type: 'button', onclick: () => refresh(true) }, 'Erneut versuchen'));
      }
      fill(p, c);
    }
    function fill(p, c) {
      const w = c.d;
      const today = dayIdx(w);
      const now = clamp(hourIdx(w), 0, w.h.temp.length - 1);
      name.replaceChildren(h('span', p.name));
      if (p.here) name.insertAdjacentHTML('afterbegin', I.pin);
      name.insertAdjacentHTML('beforeend', icon('chevronDown'));
      temp.textContent = deg(w.cur.temp);
      cond.textContent = wmo(w.cur.code)[0];
      sub.textContent = `Gefühlt ${deg(w.cur.feel)} · H ${deg(w.d.max[today])} · T ${deg(w.d.min[today])}`;

      // Szene: Stand von Sonne oder Mond aus der Ortszeit
      const t = placeNow(w);
      const rise = isoMs(w.d.rise[today]);
      const set = isoMs(w.d.set[today]);
      const known = Number.isFinite(rise) && Number.isFinite(set) && set > rise;      // Polartag und -nacht kennen keinen Auf- und Untergang
      const isDay = known ? t >= rise && t < set : w.cur.day;
      const night = t < rise ? [set - 864e5, rise] : [set, rise + 864e5];
      const sun = !known ? 0.5 : isDay ? (t - rise) / (set - rise) : clamp((t - night[0]) / (night[1] - night[0]));
      const dusk = known ? clamp(1 - Math.min(Math.abs(t - rise), Math.abs(t - set)) / (50 * 60000)) : 0;
      scene.set({ ...sceneFor(w.cur.code, !isDay), sun, dusk });

      hours.replaceChildren(...Array.from({ length: Math.min(24, w.h.temp.length - now) }, (_, k) => {
        const i = now + k;
        const pop = w.h.pop?.[i] || 0;
        const hh = new Date(isoMs(w.h.t0) + i * 3600e3).getUTCHours();
        return h('div.weather-hour', { class: k ? '' : 'is-now' },
          h('span', k ? `${hh} Uhr` : 'Jetzt'), h('span', { html: wxIcon(w.h.code[i], isDayAt(w, i)) }),
          h('i', pop >= 20 ? `${Math.round(pop / 5) * 5} %` : ''), h('b', deg(k ? w.h.temp[i] : w.cur.temp)));
      }));

      const lo = Math.min(...w.d.min.slice(today));
      const hi = Math.max(...w.d.max.slice(today));
      const span = Math.max(1, hi - lo);
      days.replaceChildren(...w.d.time.slice(today).map((iso, k) => {
        const i = today + k;
        const bar = h('div.weather-bar', h('i', { style: { '--a': (w.d.min[i] - lo) / span, '--b': (w.d.max[i] - lo) / span, background: `linear-gradient(90deg, ${tempColor(w.d.min[i])}, ${tempColor(w.d.max[i])})` } }));
        if (!k) bar.append(h('em', { style: { '--n': clamp((w.cur.temp - lo) / span) }, title: `Jetzt ${deg(w.cur.temp)}` }));
        return h('div.weather-day',
          h('span', dayName(iso, i, today)), h('span', { html: wxIcon(w.d.code[i], true) }),
          h('span.weather-day-rain', w.d.rain[i] >= 0.1 ? `${num(w.d.rain[i], 1)} mm` : ''),
          h('span.weather-day-lo', deg(w.d.min[i])), bar, h('span.weather-day-hi', deg(w.d.max[i])));
      }));

      const uv = w.d.uv[today] || 0;
      const k = isDay && known ? sun : -1;
      const dot = k < 0 ? `<circle class="is-down" r="4.500" cx="${t < rise ? 8 : 112}" cy="40"/>` : `<circle r="4.500" cx="${(8 + k * 104).toFixed(1)}" cy="${(40 - 128 * k * (1 - k)).toFixed(1)}"/>`;
      const tile = (ico, title, big, unit, ...rest) => h('section.weather-card.weather-tile', h('h3', { html: ico }, title), h('b', big, unit ? h('small', unit) : null), ...rest);
      const feel = w.cur.feel - w.cur.temp;
      tiles.replaceChildren(
        tile(I.wind, 'Wind', num(w.cur.wind), 'km/h', h('span', windText(w.cur.wind))),
        tile(icon('drop'), 'Luftfeuchte', num(w.cur.hum), '%', h('span', humText(w.cur.hum))),
        tile(icon('sun'), 'UV-Index', num(uv, 1), '', h('div.weather-uv', h('em', { style: { '--n': clamp(uv / 11) } })), h('span', `${uvText(uv)} – Höchstwert heute`)),
        tile(I.rain, 'Niederschlag', num(w.d.rain[today], 1), 'mm', h('span', today + 1 < w.d.time.length ? `Heute gesamt · morgen ${num(w.d.rain[today + 1], 1)} mm` : 'Heute gesamt')),
        tile(I.temp, 'Gefühlt', deg(w.cur.feel), '', h('span', Math.abs(feel) < 1.5 ? 'Wie gemessen' : feel < 0 ? 'Wind lässt es kühler wirken' : 'Feuchte lässt es wärmer wirken')),
        tile(I.rise, 'Sonne', hm(w.d.rise[today]), `– ${hm(w.d.set[today])}`,
          h('span', { html: `<svg class="weather-arc" viewBox="0 0 120 46" aria-hidden="true"><line x1="0" y1="40" x2="120" y2="40"/><path d="M8 40Q60 -24 112 40"/>${dot}</svg>` }),
          h('span', !known ? 'Heute kein Auf- oder Untergang' : isDay ? `Noch ${num((set - t) / 3600e3, 1)} Std. hell` : t < rise ? `Aufgang in ${num((rise - t) / 3600e3, 1)} Std.` : 'Die Sonne ist untergegangen')));
      foot.replaceChildren(`Aktualisiert ${timeAgo(c.t)} · Messzeit ${hm(w.cur.time)} Uhr Ortszeit · Wetterdaten von `,
        h('a', { href: 'https://open-meteo.com/', target: '_blank', rel: 'noopener noreferrer' }, 'open-meteo.com'));
    }

    // ---------- Laden ----------
    async function refresh(force) {
      paintSide();
      paintMain();
      const p = current();
      if (!p) return;
      const c = cached(p);
      if (!force && c && Date.now() - c.t < FRESH && !errors.has(p.id)) return;
      loading = true;
      bReload.classList.add('weather-spin');
      try {
        await load(p, { force: true });
        errors.delete(p.id);
      } catch (err) {
        errors.set(p.id, err);
      }
      loading = inflight.size > 0;
      bReload.classList.toggle('weather-spin', loading);
      paintSide();
      if (current() === p) paintMain();
    }
    /** Temperaturen der übrigen Orte in der Seitenleiste nachziehen – nacheinander, ohne Eile */
    async function refreshOthers() {
      for (const p of [...d.places]) {
        if (p.id === d.sel || !d.places.includes(p)) continue;
        const c = cached(p);
        if (c && Date.now() - c.t < FRESH) continue;
        try { await load(p); } catch { /* bleibt beim alten Stand */ }
      }
    }

    // ---------- Ort hinzufügen ----------
    async function addPlace() {
      if (sheetOpen) return;
      sheetOpen = true;
      const input = h('input.kit-field', { type: 'text', placeholder: 'Stadt oder Ort suchen', spellcheck: false, autocomplete: 'off', 'aria-label': 'Ort suchen', 'data-autofocus': '' });
      const list = h('div.weather-find-list.scroll');
      const here = h('button.kit-btn', { type: 'button', html: I.pin }, 'Meinen Standort verwenden');
      const form = h('div.weather-find', input, list, here);
      let seq = 0;
      let hits = [];
      let shownFor = '';
      const done = (p) => { if (!sheetOpen) return; addOrSelect(p); form.closest('.kit-sheet')?.querySelector('.kit-sheet-btns button')?.click(); };
      const hint = (title, text) => list.replaceChildren(h('div.kit-empty', title ? h('b', title) : null, h('span', text)));
      const run = async () => {
        const q = input.value.trim();
        const my = ++seq;
        if (q.length < 2) { hits = []; shownFor = ''; hint('', 'Tippe mindestens zwei Buchstaben, z. B. „Hamburg“ oder „Lissabon“.'); return; }
        hint('', 'Suche …');
        try {
          const r = await geocode(q);
          if (my !== seq) return;
          hits = r;
          shownFor = q;
          if (!r.length) { hint('Nichts gefunden', `Für „${q}“ gibt es keinen Treffer. Prüfe die Schreibweise.`); return; }
          list.replaceChildren(...r.map((p) => h('button.kit-row', { type: 'button', html: I.pin, onclick: () => done(p) },
            h('span.grow', p.name, h('small', placeSub(p) || 'Ort')), d.places.some((x) => x.id === p.id) ? h('small', 'gemerkt') : null)));
        } catch {
          if (my !== seq) return;
          hits = [];
          hint('Suche nicht möglich', navigator.onLine === false ? 'Du bist offline.' : 'Der Suchdienst antwortet nicht. Versuch es gleich noch einmal.');
        }
      };
      const lazy = debounce(run, 420);
      input.addEventListener('input', lazy);
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault(); e.stopPropagation();
        if (hits.length && shownFor === input.value.trim()) done(hits[0]); else run();
      });
      here.addEventListener('click', () => {
        if (!navigator.geolocation) { hint('Standort nicht verfügbar', 'Dieser Browser kann keinen Standort ermitteln.'); return; }
        here.disabled = true;
        here.lastChild.textContent = 'Standort wird ermittelt …';
        navigator.geolocation.getCurrentPosition(
          (pos) => done({ id: 'here', name: 'Mein Standort', admin: '', country: '', lat: Number(pos.coords.latitude.toFixed(4)), lon: Number(pos.coords.longitude.toFixed(4)), here: true }),
          (err) => {
            here.disabled = false;
            here.lastChild.textContent = 'Meinen Standort verwenden';
            hint('Standort nicht verfügbar', err.code === 1 ? 'Der Zugriff auf den Standort wurde nicht erlaubt.' : 'Der Standort ließ sich nicht ermitteln.');
          },
          { timeout: 12000, maximumAge: 600000 });
      });
      run();
      await sheet(win, { title: 'Ort hinzufügen', body: form, buttons: [{ label: 'Schließen', value: null }] });
      sheetOpen = false;
      seq++;
      refocus();
    }

    // ---------- Laufendes ----------
    function refocus() { if (sys.wm.focused === win && !win.el.contains(document.activeElement)) win.el.focus({ preventScroll: true }); }
    const onData = (e) => {
      paintSide();
      if (e.detail?.sel || e.detail?.place === d.sel) { if (e.detail?.place) errors.delete(d.sel); paintMain(); }
    };
    addEventListener(EVT, onData);
    const onOnline = () => { if (errors.size) refresh(true); };
    addEventListener('online', onOnline);
    const auto = setInterval(() => { if (!win.min && !document.hidden && !loading) { refresh(false); refreshOthers(); } }, 60000);

    let visible = true;
    const offVisible = whenVisible(hero, (v) => { visible = v; }, '0px');
    const ro = new ResizeObserver(() => { if (hero.clientWidth) scene.resize(hero.clientWidth, hero.clientHeight); });
    ro.observe(hero);
    let acc = 0;
    const frame = (dt) => {
      if (win.min || !visible || hero.hidden || reducedMotion.matches) return;
      acc += dt;
      if (acc < 1 / 32) return;            // 30 Bilder pro Sekunde genügen
      scene.draw(Math.min(acc, 0.1));
      acc = 0;
    };
    ticker.add(frame);

    const onKey = (e) => {
      if (e.altKey || e.metaKey || e.ctrlKey || e.target.closest('input, textarea, select')) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === 'r') { e.preventDefault(); refresh(true); }
      else if (k === 'n') { e.preventDefault(); addPlace(); }
      else if ((k === 'ArrowDown' || k === 'ArrowUp') && d.places.length > 1 && !e.target.closest('.scroll:not(.weather-side)')) {
        e.preventDefault();
        const i = d.places.findIndex((p) => p.id === d.sel);
        select(d.places[(i + (k === 'ArrowDown' ? 1 : -1) + d.places.length) % d.places.length].id);
      }
    };
    win.el.addEventListener('keydown', onKey);

    refresh(false).then(refreshOthers);

    return {
      onClose() {
        removeEventListener(EVT, onData);
        removeEventListener('online', onOnline);
        clearInterval(auto);
        ticker.remove(frame);
        ro.disconnect();
        offVisible();
        win.el.removeEventListener('keydown', onKey);
      },
      onFocus: refocus,
      menus: () => [
        { label: 'Ort', items: [
          ...switchMenu().slice(0, -2),
          { label: 'Ort hinzufügen …', icon: 'plus', hint: 'N', run: () => addPlace() },
          { label: 'Diesen Ort entfernen', icon: 'trash', disabled: !current(), run: () => removePlace(current()) },
        ] },
        { label: 'Ansicht', items: [{ label: 'Aktualisieren', icon: 'reload', hint: 'R', run: () => refresh(true) }] },
      ],
    };
  },

  widgets: {
    now(el) {
      const box = h('div.weather-w');
      el.append(box);
      return widget(box, (p, w) => {
        const today = dayIdx(w);
        box.replaceChildren(
          h('div.weather-w-top', h('b', p.name), h('span', { html: wxIcon(w.cur.code, w.cur.day) })),
          h('div.weather-w-temp', deg(w.cur.temp)),
          h('div.weather-w-cond', wmo(w.cur.code)[0]),
          h('div.weather-w-sub', `H ${deg(w.d.max[today])} · T ${deg(w.d.min[today])}`));
      });
    },
    week(el) {
      const box = h('div.weather-w');
      el.append(box);
      return widget(box, (p, w) => {
        const today = dayIdx(w);
        box.replaceChildren(
          h('div.weather-w-head', h('b', p.name), h('span', wmo(w.cur.code)[0]), h('em', deg(w.cur.temp))),
          h('div.weather-w-days', w.d.time.slice(today, today + 5).map((iso, k) => h('div.weather-w-day',
            h('span', dayName(iso, today + k, today)), h('span', { html: wxIcon(w.d.code[today + k], true) }),
            h('b', deg(w.d.max[today + k])), h('small', deg(w.d.min[today + k]))))));
      });
    },
  },
};

/** Gemeinsamer Rahmen der Widgets: zeigt den gewählten Ort aus dem Cache, lädt höchstens alle 30 Minuten nach */
function widget(box, fill) {
  let failed = false;
  const paint = () => {
    const p = current();
    const c = cached(p);
    if (p && c) { fill(p, c.d); return; }
    box.replaceChildren(h('div.weather-w-none', h('b', p ? p.name : 'Wetter'),
      h('span', !p ? 'Noch kein Ort gewählt' : failed ? 'Keine Daten – offline?' : 'Lädt …')));
  };
  const update = () => {
    const p = current();
    if (!p) { paint(); return; }
    load(p, { maxAge: FRESH_WIDGET }).then(() => { failed = false; paint(); }, () => { failed = true; paint(); });
  };
  const onData = (e) => { if (e.detail?.sel) update(); else paint(); };
  paint();
  update();
  const id = setInterval(update, 5 * 60000);
  addEventListener(EVT, onData);
  addEventListener('online', update);
  return () => { clearInterval(id); removeEventListener(EVT, onData); removeEventListener('online', update); };
}
