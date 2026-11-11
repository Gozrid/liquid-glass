// kit.js — die Komponenten in Abschnitt 02 (alle echt verdrahtet)

import { $, $$, LiquidIndicator, coarse } from '../core/util.js';
import { icon } from '../core/icons.js';
import { toast, confetti } from './fx.js';

export function initKit(theme) {
  const sec = $('#komponenten');
  const backdrop = $('#kit-backdrop');
  const root = document.documentElement;

  // ---------- Segmente: Hintergrundmotiv ----------
  $('#kit-motif').addEventListener('change', (e) => { backdrop.dataset.motif = e.detail.value; });

  // ---------- Schalter ----------
  const swDark = $('#sw-dark');
  swDark.checked = theme.mode === 'dark';
  swDark.addEventListener('change', (e) => {
    const r = swDark.getBoundingClientRect();
    theme.set(e.detail.checked ? 'dark' : 'light', { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  });
  $('#sw-sheen').addEventListener('change', (e) => root.classList.toggle('no-sheen', !e.detail.checked));
  $('#sw-motion').addEventListener('change', (e) => backdrop.classList.toggle('is-paused', !e.detail.checked));

  // ---------- Regler: verändern das Glas dieses Abschnitts ----------
  const slFill = $('#sl-fill');
  const fillDefault = () => (theme.mode === 'dark' ? 26 : 36);
  const setFill = (v, override) => {
    $('#out-fill').textContent = `${v} %`;
    if (override) sec.style.setProperty('--glass-fill', theme.mode === 'dark' ? `rgba(14,16,48,${v / 100})` : `rgba(255,255,255,${v / 100})`);
    else sec.style.removeProperty('--glass-fill');
  };
  $('#sl-blur').addEventListener('input', (e) => {
    sec.style.setProperty('--glass-blur', `${e.detail.value}px`);
    $('#out-blur').textContent = `${e.detail.value} px`;
  });
  $('#sl-hue').addEventListener('input', (e) => {
    backdrop.style.setProperty('--hue', `${e.detail.value}deg`);
    $('#out-hue').textContent = `${e.detail.value}°`;
  });
  slFill.addEventListener('input', (e) => setFill(e.detail.value, true));
  slFill.value = fillDefault();
  setFill(fillDefault(), false);

  theme.on((m) => {
    swDark.checked = m === 'dark';
    slFill.value = fillDefault();
    setFill(fillDefault(), false);
  });

  // ---------- Neigekarte ----------
  const tiltWrap = $('.tilt-wrap');
  const tilt = $('#tilt');
  if (!coarse.matches) {
    tiltWrap.addEventListener('pointermove', (e) => {
      const r = tiltWrap.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      tilt.classList.add('is-live');
      tilt.style.setProperty('--rx', `${(-y * 20).toFixed(2)}deg`);
      tilt.style.setProperty('--ry', `${(x * 24).toFixed(2)}deg`);
    });
    tiltWrap.addEventListener('pointerleave', () => {
      tilt.classList.remove('is-live');
      tilt.style.setProperty('--rx', '0deg');
      tilt.style.setProperty('--ry', '0deg');
    });
  }

  // ---------- Morph-Kapsel ----------
  const cap = $('#cap');
  const capModes = $('#cap-modes');
  const tracks = [['Glasperlenspiel', 'Fable · Synth-Demo'], ['Lichtbrechung', 'Fable · Ambient'], ['Federkonstante', 'Fable · Elektro']];
  let mode = 'idle';
  let open = false;
  let playing = true;
  let track = 0;
  let remaining = 30;
  let prog = 0;

  const sizeCap = () => {
    const st = $(`.cap-state[data-state="${cap.dataset.state}"]`, cap);
    cap.style.setProperty('--w', `${st.offsetWidth}px`);
    cap.style.setProperty('--h', `${st.offsetHeight}px`);
  };
  const setState = (s) => {
    cap.dataset.state = s;
    cap.setAttribute('aria-label', s === 'open' ? 'Statuskapsel – schließen' : 'Statuskapsel – öffnen');
    sizeCap();
  };
  const paintTrack = () => {
    for (const el of $$('.cap-track, .cap-open-head > div', cap)) {
      el.querySelector('b').textContent = tracks[track][0];
      el.querySelector('small').textContent = tracks[track][1];
    }
    requestAnimationFrame(sizeCap);
  };
  const paintTimer = () => {
    $('#cap-timer').textContent = `0:${String(Math.max(0, Math.ceil(remaining))).padStart(2, '0')}`;
    $('#cap-ring').style.setProperty('--p', Math.max(0, remaining / 30));
  };
  capModes.addEventListener('change', (e) => {
    mode = e.detail.value;
    open = false;
    if (mode === 'timer') { remaining = 30; paintTimer(); }
    setState(mode);
  });
  const toggleCap = () => { open = !open; setState(open ? 'open' : mode); };
  cap.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cap]');
    if (!btn) { toggleCap(); return; }
    const act = btn.dataset.cap;
    if (act === 'play') {
      playing = !playing;
      cap.classList.toggle('is-paused', !playing);
      btn.innerHTML = icon(playing ? 'pause' : 'play');
      btn.setAttribute('aria-label', playing ? 'Pause' : 'Wiedergabe');
    } else {
      track = (track + (act === 'next' ? 1 : tracks.length - 1)) % tracks.length;
      prog = 0;
      paintTrack();
    }
  });
  cap.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === cap) { e.preventDefault(); toggleCap(); }
  });
  const clock = () => {
    $('#cap-clock').textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  };
  clock();
  setInterval(() => {
    clock();
    if (mode === 'timer' && !open) {
      remaining -= 0.25;
      paintTimer();
      if (remaining <= 0) {
        toast({ title: 'Timer abgelaufen', body: '30 Sekunden sind um – die Kapsel ruht wieder.', iconName: 'clock' });
        mode = 'idle';
        capModes.select(0, false);
        setState('idle');
      }
    }
    if (playing) {
      prog = (prog + 0.25 / 24) % 1;
      $('#cap-prog').style.setProperty('--p', prog);
    }
  }, 250);
  setState('idle');
  paintTimer();
  new ResizeObserver(sizeCap).observe($('.cap-stage'));

  // ---------- Morph-Menü ----------
  const morph = $('#morph');
  const trig = $('.morph-trigger', morph);
  const menu = $('.morph-menu', morph);
  const sizeMorph = () => {
    const el = morph.dataset.open === 'true' ? menu : trig;
    morph.style.setProperty('--w', `${el.offsetWidth}px`);
    morph.style.setProperty('--h', `${el.offsetHeight}px`);
  };
  const setMorph = (on) => {
    morph.dataset.open = String(on);
    trig.setAttribute('aria-expanded', String(on));
    sizeMorph();
    if (on) menu.querySelector('button').focus({ preventScroll: true });
  };
  trig.addEventListener('click', () => setMorph(true));
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const r = b.getBoundingClientRect();
    if (b.dataset.fx === 'confetti') confetti(r.left + r.width / 2, r.top);
    else if (b.dataset.fx === 'theme') theme.toggle({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    else if (b.dataset.msg.startsWith('In die')) navigator.clipboard?.writeText(location.href).catch(() => {});
    if (b.dataset.msg !== 'Geschlossen') toast({ title: b.dataset.msg, body: 'Ausgelöst im Morph-Menü.', iconName: 'check' });
    setMorph(false);
  });
  document.addEventListener('pointerdown', (e) => {
    if (morph.dataset.open === 'true' && !morph.contains(e.target)) setMorph(false);
  });
  morph.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setMorph(false); trig.focus(); } });
  sizeMorph();

  // ---------- Tab-Leiste ----------
  const bar = $('#tabbar');
  const tabs = $$('button', bar);
  const pages = $$('.tabs-page', $('#tabs-screen'));
  const li = new LiquidIndicator(bar, $('.tab-ind', bar));
  let tab = 0;
  const selectTab = (i, instant = false) => {
    tab = i;
    tabs.forEach((b, j) => b.setAttribute('aria-selected', String(j === i)));
    pages.forEach((p, j) => p.classList.toggle('is-on', j === i));
    li.to(tabs[i], instant);
  };
  tabs.forEach((b, i) => b.addEventListener('click', () => selectTab(i)));
  selectTab(0, true);
  new ResizeObserver(() => li.to(tabs[tab], true)).observe(bar);

  // ---------- Mitteilungen ----------
  const msgs = [
    ['Guten Tag', 'So sieht eine Mitteilung aus Glas aus.', 'bell'],
    ['Wisch mich weg', 'Nach rechts ziehen oder einfach anklicken.', 'arrowRight'],
    ['Alles berechnet', 'Kein Bild, kein Framework – nur Code.', 'code'],
    ['Probier ⌘K', 'Die Befehlspalette kennt jede Ecke dieser Seite.', 'command'],
  ];
  let mi = 0;
  $('#toast-btn').addEventListener('click', () => {
    const [title, body, iconName] = msgs[mi++ % msgs.length];
    toast({ title, body, iconName });
  });
  $('#confetti-btn').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    confetti(r.left + r.width / 2, r.top);
  });
}
