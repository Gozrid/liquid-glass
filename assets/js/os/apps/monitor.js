// monitor.js — „Aktivität“: echte Messwerte dieses Tabs (Bildrate, Fenster, Speicher)

import { h, ticker, clamp } from '../../core/util.js';
import { icon } from '../../core/icons.js';
import { bus } from '../bus.js';
import { sys, appIcon } from '../sys.js';
import { vfs, formatSize } from '../vfs.js';

const N = 60;       // 30 s bei 2 Messungen pro Sekunde

export default {
  id: 'monitor', name: 'Aktivität', icon: 'pulse', colors: ['#45e3b4', '#0c9a78'], keywords: 'monitor prozesse leistung fps',
  singleton: true, width: 640, height: 520, minW: 460, minH: 400,

  mount(win) {
    const data = new Array(N).fill(null);
    let frames = 0, acc = 0, worst = 0, hover = -1, geo = null;

    const stat = (label, unit) => {
      const v = h('span.stat-value', '–');
      return { v, el: h('div.stat', h('span.stat-label', label), v, h('span.stat-unit', unit)) };
    };
    const sFps = stat('Bildrate', 'fps');
    const sMs = stat('Langsamster Frame', 'ms');
    const sWin = stat('Fenster', 'offen');
    const sMem = stat('Dateisystem', '');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const tip = h('div.chart-tip', { hidden: true }, h('b'), h('span'));
    const chart = h('div.mon-chart', { tabIndex: 0, 'aria-label': 'Liniendiagramm: Bildrate der letzten 30 Sekunden' }, svg, tip);
    const table = h('div.mon-procs.scroll');
    win.body.append(h('div.mon',
      h('div.mon-stats', sFps.el, sMs.el, sWin.el, sMem.el),
      h('h3', 'Bildrate · letzte 30 Sekunden'), chart,
      h('h3', 'Prozesse'), table));

    const render = () => {
      const W = chart.clientWidth, H = chart.clientHeight;
      if (!W || !H) return;
      const L = 34, R = 8, T = 8, B = 20;
      const iw = W - L - R, ih = H - T - B;
      const max = Math.max(60, Math.ceil(Math.max(...data.map((d) => d || 0)) / 30) * 30);
      const X = (i) => L + (i / (N - 1)) * iw;
      const Y = (v) => T + ih - (v / max) * ih;
      geo = { L, iw };
      let line = '';
      let started = false;
      let firstX = null;
      data.forEach((v, i) => {
        if (v == null) return;
        if (firstX == null) firstX = X(i);
        line += `${started ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`;
        started = true;
      });
      const grid = [0, max / 2, max].map((v) => {
        const y = Math.round(Y(v)) + 0.5;
        return `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="axis-label" x="${L - 7}" y="${y + 4}" text-anchor="end">${v}</text>`;
      }).join('');
      const labels = `<text class="axis-label" x="${L}" y="${H - 4}">−30 s</text><text class="axis-label" x="${W - R}" y="${H - 4}" text-anchor="end">jetzt</text>`;
      const last = data[N - 1];
      const hv = hover >= 0 ? data[hover] : null;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.innerHTML = `${grid}${labels}
        ${line ? `<path class="series-area" d="${line}L${X(N - 1)} ${Y(0)}L${firstX} ${Y(0)}Z"/><path class="series-line" d="${line}"/>` : ''}
        ${hv != null ? `<line class="crosshair" x1="${X(hover)}" x2="${X(hover)}" y1="${T}" y2="${T + ih}"/><circle class="end-dot" cx="${X(hover)}" cy="${Y(hv)}" r="5"/>` : ''}
        ${last != null ? `<circle class="end-dot" cx="${X(N - 1)}" cy="${Y(last)}" r="5"/>` : ''}`;
      if (hv != null) {
        tip.hidden = false;
        tip.firstChild.textContent = `${hv} fps`;
        const ago = (N - 1 - hover) / 2;
        tip.lastChild.textContent = ago ? `vor ${ago.toLocaleString('de-DE')} s` : 'jetzt';
        tip.style.left = `${clamp(X(hover), 44, W - 44)}px`;
        tip.style.top = `${Y(hv)}px`;
      } else tip.hidden = true;
    };

    const paintProcs = () => {
      const wins = sys.wm.wins;
      table.replaceChildren(
        h('div.mon-row.head', h('span', 'App'), h('span', 'PID'), h('span', 'Laufzeit'), h('span', 'Elemente'), h('span')),
        ...wins.map((w) => {
          const sec = Math.round((Date.now() - w.started) / 1000);
          return h('div.mon-row',
            h('span.mon-app', appIcon(w.app, 'xs'), h('b', w.title)),
            h('span', String(w.id)),
            h('span', sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)} min`),
            h('span', String(w.el.querySelectorAll('*').length)),
            h('button.tool', { type: 'button', 'aria-label': `${w.title} beenden`, title: 'Beenden', html: icon('close'), onclick: () => w.close() }));
        }));
      sWin.v.textContent = String(wins.length);
      sMem.v.textContent = formatSize(vfs.usage());
    };

    const frame = (dt) => {
      frames++;
      acc += dt;
      worst = Math.max(worst, dt * 1000);
      if (acc < 0.5) return;
      const fps = Math.round(frames / acc);
      data.push(fps);
      data.shift();
      sFps.v.textContent = String(fps);
      sMs.v.textContent = worst.toFixed(1).replace('.', ',');
      frames = 0;
      acc = 0;
      worst = 0;
      if (!win.min) { render(); paintProcs(); }
    };
    ticker.add(frame);

    const indexAt = (x) => (geo ? clamp(Math.round(((x - chart.getBoundingClientRect().left - geo.L) / geo.iw) * (N - 1)), 0, N - 1) : -1);
    chart.addEventListener('pointermove', (e) => { hover = indexAt(e.clientX); render(); });
    chart.addEventListener('pointerleave', () => { hover = -1; render(); });
    chart.addEventListener('focus', () => { if (hover < 0) hover = N - 1; render(); });
    chart.addEventListener('blur', () => { hover = -1; render(); });
    chart.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      hover = clamp((hover < 0 ? N - 1 : hover) + d, 0, N - 1);
      render();
    });
    const ro = new ResizeObserver(render);
    ro.observe(chart);
    const off = bus.on('wm', paintProcs);
    paintProcs();
    return { onClose: () => { ticker.remove(frame); ro.disconnect(); off(); } };
  },
};
